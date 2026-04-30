// app/purchase-history.tsx
//
// Kaufhistorie — neu im Design-System:
//   • DetailHeader (Back + Title)
//   • SegmentedTabs + PagerView für Marken / NoNames mit Counts
//   • Crossfade(fillParent) Skeleton während Initial-Load
//   • FlatList mit Infinite-Scroll-Pagination (onEndReached)
//   • PurchaseCard: Produktbild + Brand-Eyebrow + Name + Preis-Zeile
//     mit Kaufdatum (formatRelativeTime, gleicher Helper wie history)
//   • Tap → product-comparison / noname-detail mit Prefetch
//   • Footer-Bar: "X von Y Käufen · Chronologisch sortiert"
//   • Theme-Tokens via useTokens

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router, useNavigation } from 'expo-router';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DETAIL_HEADER_ROW_HEIGHT,
  DetailHeader,
} from '@/components/design/DetailHeader';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { Crossfade, Shimmer } from '@/components/design/Skeletons';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usePurchaseHistory } from '@/lib/hooks/usePurchaseHistory';
import { FirestoreService } from '@/lib/services/firestore';
import { getProductImage } from '@/lib/utils/productImage';

type Tab = 'brands' | 'nonames';

// ─── Relative timestamp helper ─────────────────────────────────────
//
// Identisch zur Logik in app/history.tsx und app/favorites.tsx, damit
// Datumstexte app-weit gleich aussehen. Ältere Käufe (>7 Tage) fallen
// auf "DD.MM. um HH:MM" bzw. "DD.MM.YYYY" zurück, was für eine
// Kaufhistorie der natürliche Default ist.
function formatPurchaseTime(input: any): string {
  if (!input) return '';
  const d = input?.toDate ? input.toDate() : new Date(input);
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();

  if (diffMin < 1) return 'gerade gekauft';
  if (diffHr < 1) return `vor ${diffMin} Min.`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (dayDelta === 0) return `heute, ${hh}:${mm}`;
  if (dayDelta === 1) return `gestern, ${hh}:${mm}`;
  if (diffDay < 7) return `vor ${dayDelta} Tagen`;
  if (yyyy === now.getFullYear()) return `${dd}.${MM}.`;
  return `${dd}.${MM}.${yyyy}`;
}

// Preis "X,YZ €" mit deutschem Komma + Suffix mit Schmal-Space.
function formatPrice(value: number | null | undefined): string {
  const n = typeof value === 'number' && isFinite(value) ? value : 0;
  return `${n.toFixed(2).replace('.', ',')} €`;
}

// ────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────

export default function PurchaseHistoryScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme } = useTokens();
  const { user } = useAuth();
  const analytics = useAnalytics();

  const {
    brandPurchases,
    noNamePurchases,
    brandLoading,
    brandLoadingMore,
    brandHasMore,
    noNameLoading,
    noNameLoadingMore,
    noNameHasMore,
    error,
    totalBrandCount,
    totalNoNameCount,
    loadBrandPurchases,
    loadNoNamePurchases,
    refreshData,
  } = usePurchaseHistory();

  const [activeTab, setActiveTab] = useState<Tab>('brands');
  const pagerRef = useRef<PagerView>(null);

  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnce = useRef(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Initial-Loader-Gate: sobald ein Tab seine erste Seite hat (oder
  // beide leer geliefert haben), Skeleton ausblenden.
  useEffect(() => {
    const isLoading = brandLoading || noNameLoading;
    if (!isLoading && !hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
    }
    if (initialLoading && !isLoading) {
      setInitialLoading(false);
    }
  }, [brandLoading, noNameLoading, initialLoading]);

  // ─── Tabs ──────────────────────────────────────────────────────
  const onTabChange = (next: Tab) => {
    if (next === activeTab) return;
    setActiveTab(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pagerRef.current?.setPage(next === 'brands' ? 0 : 1);
  };
  const onPageSelected = (e: { nativeEvent: { position: number } }) => {
    const next: Tab = e.nativeEvent.position === 0 ? 'brands' : 'nonames';
    setActiveTab((prev) => (prev === next ? prev : next));
  };

  // ─── Pull-to-refresh ──────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshData();
    } finally {
      setRefreshing(false);
    }
  }, [refreshData]);

  // ─── Item handler ──────────────────────────────────────────────
  const onItemPress = (item: any, index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const productName = item.name || 'Produkt';
    analytics.trackProductView(
      item.id,
      item.type === 'markenprodukt' ? 'brand' : 'noname',
      productName,
      'purchase_history',
      {
        repurchase: true,
        position: index,
        originalPurchaseDate: item.purchasedAt,
      },
    );

    if (item.type === 'markenprodukt') {
      FirestoreService.prefetchComparisonData(item.id, true);
      router.push(`/product-comparison/${item.id}?type=brand` as any);
    } else {
      const stufe =
        parseInt(
          item.stufe ||
            item.originalCartData?.stufe ||
            (item as any).productData?.stufe ||
            '3',
          10,
        ) || 3;
      if (stufe <= 2) {
        FirestoreService.prefetchProductDetails(item.id);
        router.push(`/noname-detail/${item.id}` as any);
      } else {
        FirestoreService.prefetchComparisonData(item.id, false);
        router.push(`/product-comparison/${item.id}?type=noname` as any);
      }
    }
  };

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  // Erfolgsfall-Branch oben raus, damit der Render-Tree drunter
  // sauber bleibt.
  if (error && !hasLoadedOnce.current) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <View
          style={{
            flex: 1,
            paddingTop: chromeHeight,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
            gap: 12,
          }}
        >
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={48}
            color={theme.textMuted}
          />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 16,
              color: theme.text,
              textAlign: 'center',
            }}
          >
            {error}
          </Text>
          <Pressable
            onPress={() => {
              hasLoadedOnce.current = false;
              setInitialLoading(true);
              refreshData();
            }}
            style={({ pressed }) => ({
              marginTop: 8,
              paddingHorizontal: 18,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: theme.primary,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 14,
                color: '#fff',
              }}
            >
              Erneut versuchen
            </Text>
          </Pressable>
        </View>
        <DetailHeader title="Kaufhistorie" onBack={() => router.back()} />
      </View>
    );
  }

  const currentCount =
    activeTab === 'brands' ? brandPurchases.length : noNamePurchases.length;
  const totalCount =
    activeTab === 'brands' ? totalBrandCount : totalNoNameCount;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Body lebt unter dem Chrome via paddingTop. */}
      <View style={{ flex: 1, paddingTop: chromeHeight }}>
        {/* Tabs row */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 6,
          }}
        >
          <SegmentedTabs
            tabs={[
              {
                key: 'brands',
                label: `Marken (${totalBrandCount.toLocaleString('de-DE')})`,
              },
              {
                key: 'nonames',
                label: `NoNames (${totalNoNameCount.toLocaleString('de-DE')})`,
              },
            ] as const}
            value={activeTab}
            onChange={onTabChange}
          />
        </View>

        {/* Body — Crossfade zwischen Skeleton und PagerView. fillParent
            ist Pflicht, damit die FlatLists ihren flex:1 bekommen. */}
        <Crossfade
          ready={!initialLoading}
          duration={320}
          fillParent
          style={{ flex: 1 }}
          skeleton={<PurchaseHistorySkeleton />}
        >
          <PagerView
            ref={pagerRef}
            style={{ flex: 1 }}
            initialPage={0}
            onPageSelected={onPageSelected}
          >
            {/* Marken */}
            <View key="brands" style={{ flex: 1 }}>
              <PurchaseList
                items={brandPurchases}
                refreshing={refreshing}
                onRefresh={onRefresh}
                onEndReached={() => {
                  if (brandHasMore && !brandLoadingMore) {
                    loadBrandPurchases(false);
                  }
                }}
                loadingMore={brandLoadingMore}
                emptyVariant="brands"
                onItemPress={onItemPress}
              />
            </View>

            {/* NoNames */}
            <View key="nonames" style={{ flex: 1 }}>
              <PurchaseList
                items={noNamePurchases}
                refreshing={refreshing}
                onRefresh={onRefresh}
                onEndReached={() => {
                  if (noNameHasMore && !noNameLoadingMore) {
                    loadNoNamePurchases(false);
                  }
                }}
                loadingMore={noNameLoadingMore}
                emptyVariant="nonames"
                onItemPress={onItemPress}
              />
            </View>
          </PagerView>
        </Crossfade>

        {/* Footer-Bar — "X von Y Käufen · Chronologisch sortiert".
            Bewusst flach (kein Schatten, nur 1px-Border), damit sie
            sich als Statusleiste, nicht als ActionBar liest. */}
        {!initialLoading && (totalBrandCount + totalNoNameCount) > 0 ? (
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 10,
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: theme.surface,
              borderTopWidth: 1,
              borderTopColor: theme.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold,
                fontSize: 12,
                color: theme.text,
              }}
            >
              {currentCount.toLocaleString('de-DE')} von{' '}
              {totalCount.toLocaleString('de-DE')} Käufen
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 11,
                color: theme.textMuted,
              }}
            >
              Chronologisch sortiert
            </Text>
          </View>
        ) : null}
      </View>

      {/* Chrome */}
      <DetailHeader title="Kaufhistorie" onBack={() => router.back()} />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// PurchaseList — FlatList per Tab. Empty-State, Pull-to-Refresh,
// Infinite-Scroll-Pagination via onEndReached + Footer-Spinner.
// ────────────────────────────────────────────────────────────────────

function PurchaseList({
  items,
  refreshing,
  onRefresh,
  onEndReached,
  loadingMore,
  emptyVariant,
  onItemPress,
}: {
  items: any[];
  refreshing: boolean;
  onRefresh: () => void;
  onEndReached: () => void;
  loadingMore: boolean;
  emptyVariant: Tab;
  onItemPress: (item: any, index: number) => void;
}) {
  const { theme } = useTokens();

  if (items.length === 0) {
    return <PurchaseEmpty variant={emptyVariant} />;
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item, index) =>
        `${item.id}_${index}_${item.purchasedAt?.getTime?.() || 'k'}`
      }
      renderItem={({ item, index }) => (
        <PurchaseCard
          item={item}
          onPress={() => onItemPress(item, index)}
        />
      )}
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 6,
        paddingBottom: 24,
        gap: 10,
      }}
      ItemSeparatorComponent={null}
      showsVerticalScrollIndicator={false}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.primary}
        />
      }
      ListFooterComponent={
        loadingMore ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        ) : null
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────
// PurchaseCard — eine Kauf-Position. Layout:
//   [60×60 Bild]  Eyebrow (Brand / Handelsmarke)
//                 Produktname (max 2 Zeilen)
//                 Preis · Gekauft am …
// ────────────────────────────────────────────────────────────────────

function PurchaseCard({
  item,
  onPress,
}: {
  item: any;
  onPress: () => void;
}) {
  const { theme, brand, shadows } = useTokens();

  const isMarken = item.type === 'markenprodukt';
  const eyebrowText: string | null = isMarken
    ? item.hersteller?.name ?? null
    : item.handelsmarke?.bezeichnung ?? item.discounter?.name ?? null;
  const eyebrowLogo: string | null = isMarken
    ? item.hersteller?.bild ?? null
    : item.discounter?.bild ?? null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 14,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        opacity: pressed ? 0.96 : 1,
        ...shadows.sm,
      })}
    >
      {/* Produktbild — quadratisch, fallback auf Paket-Glyph. */}
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 12,
          backgroundColor: '#ffffff',
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {getProductImage(item) ? (
          <Image
            source={{ uri: getProductImage(item) ?? undefined }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
          />
        ) : (
          <MaterialCommunityIcons
            name="package-variant-closed"
            size={26}
            color={theme.textMuted}
          />
        )}
      </View>

      {/* Text-Säule */}
      <View style={{ flex: 1, minWidth: 0 }}>
        {eyebrowText ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              marginBottom: 3,
            }}
          >
            {eyebrowLogo ? (
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  backgroundColor: '#fff',
                  overflow: 'hidden',
                  borderWidth: 0.5,
                  borderColor: theme.border,
                }}
              >
                <Image
                  source={{ uri: eyebrowLogo }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                color: brand.primary,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              {eyebrowText}
            </Text>
          </View>
        ) : null}

        <Text
          numberOfLines={2}
          style={{
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 14,
            color: theme.text,
            lineHeight: 17,
            marginBottom: 4,
          }}
        >
          {item.name || 'Unbekanntes Produkt'}
        </Text>

        {/* Preis · Gekauft-Zeile */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 13,
              color: brand.primary,
            }}
          >
            {formatPrice(item.preis)}
          </Text>
          <View
            style={{
              width: 3,
              height: 3,
              borderRadius: 1.5,
              backgroundColor: theme.textMuted,
            }}
          />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
            }}
          >
            {formatPurchaseTime(item.purchasedAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────
// PurchaseEmpty — Empty-State pro Tab.
// ────────────────────────────────────────────────────────────────────

function PurchaseEmpty({ variant }: { variant: Tab }) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        alignItems: 'center',
        paddingTop: 80,
        paddingHorizontal: 32,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons
          name="cart-check"
          size={28}
          color={theme.textMuted}
        />
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 16,
          color: theme.text,
          textAlign: 'center',
        }}
      >
        {variant === 'brands' ? 'Noch keine Markenprodukte' : 'Noch keine NoNames'}
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          color: theme.textMuted,
          textAlign: 'center',
          lineHeight: 18,
        }}
      >
        {variant === 'brands'
          ? 'Markenprodukte aus deinen Einkäufen erscheinen hier — markiere sie beim Einkauf als gekauft, dann siehst du sie hier wieder.'
          : 'NoName-Produkte aus deinen Einkäufen erscheinen hier — markiere sie beim Einkauf als gekauft, dann siehst du sie hier wieder.'}
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// PurchaseHistorySkeleton — Initial-Load-Placeholder. Sechs Reihen,
// die exakt die Card-Form spiegeln (Image links, zwei Textzeilen +
// eine Preis/Datum-Zeile rechts).
// ────────────────────────────────────────────────────────────────────

function PurchaseHistorySkeleton() {
  const { theme, shadows } = useTokens();
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 6, gap: 10 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            borderRadius: 14,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            ...shadows.sm,
          }}
        >
          <Shimmer width={60} height={60} radius={12} />
          <View style={{ flex: 1, gap: 6 }}>
            <Shimmer width="40%" height={10} radius={3} />
            <Shimmer width="85%" height={13} radius={4} />
            <Shimmer width="55%" height={11} radius={3} />
          </View>
        </View>
      ))}
    </View>
  );
}
