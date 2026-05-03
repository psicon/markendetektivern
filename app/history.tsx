// app/history.tsx
//
// Such- & Scanverlauf — neu im Design-System:
//   • DetailHeader (Back + Title)
//   • SegmentedTabs + PagerView für Suchverlauf / Scanverlauf
//   • Crossfade(fillParent) Skeleton während Initial-Load
//   • Theme-Tokens via useTokens
//   • Card-Liste mit relativem Zeitstempel rechts
//   • Tap auf Scan-Card → product-comparison MIT Prefetch
//   • Tap auf Such-Card → search-results
//   • "Verlauf löschen" Button per Tab am Top der Liste

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
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
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { FirestoreService } from '@/lib/services/firestore';
import scanHistoryService, {
  ScanHistoryItem,
} from '@/lib/services/scanHistoryService';
import {
  searchHistoryService,
  SearchHistoryItem,
} from '@/lib/services/searchHistoryService';

type Tab = 'search' | 'scan';

// ─── Relative timestamp helper ─────────────────────────────────────
//
// Identical scheme to the favourites screen so timestamps look the
// same across the app:
//   gerade eben / vor X Min. / heute, HH:MM / gestern, HH:MM /
//   vor X Tagen / DD.MM. um HH:MM / DD.MM.YYYY
function formatRelativeTime(input: any): string {
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

  if (diffMin < 1) return 'gerade eben';
  if (diffHr < 1) return `vor ${diffMin} Min.`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (dayDelta === 0) return `heute, ${hh}:${mm}`;
  if (dayDelta === 1) return `gestern, ${hh}:${mm}`;
  if (diffDay < 7) return `vor ${dayDelta} Tagen`;
  if (yyyy === now.getFullYear()) return `${dd}.${MM}. um ${hh}:${mm}`;
  return `${dd}.${MM}.${yyyy}`;
}

// ────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows } = useTokens();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('search');
  const pagerRef = useRef<PagerView>(null);

  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnce = useRef(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // ─── Data loaders ──────────────────────────────────────────────
  const loadSearchHistory = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const searches = await searchHistoryService.getRecentSearches(user.uid, 50);
      setSearchHistory(searches);
    } catch (e) {
      console.warn('History: load search failed', e);
    }
  }, [user?.uid]);

  const loadScanHistory = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const scans = await scanHistoryService.getRecentScans(user.uid, 50);
      setScanHistory(scans);
    } catch (e) {
      console.warn('History: load scan failed', e);
    }
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!hasLoadedOnce.current) {
          hasLoadedOnce.current = true;
        }
        await Promise.all([loadSearchHistory(), loadScanHistory()]);
        if (alive) setInitialLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, [loadSearchHistory, loadScanHistory]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadSearchHistory(), loadScanHistory()]);
    setRefreshing(false);
  }, [loadSearchHistory, loadScanHistory]);

  // ─── Tabs ──────────────────────────────────────────────────────
  const onTabChange = (next: Tab) => {
    setActiveTab(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pagerRef.current?.setPage(next === 'search' ? 0 : 1);
  };
  const onPageSelected = (e: { nativeEvent: { position: number } }) => {
    const next: Tab = e.nativeEvent.position === 0 ? 'search' : 'scan';
    setActiveTab((prev) => (prev === next ? prev : next));
  };

  // ─── Clear actions ─────────────────────────────────────────────
  const clearSearchHistory = () => {
    if (!user?.uid || searchHistory.length === 0) return;
    Alert.alert(
      'Suchverlauf löschen?',
      'Alle gespeicherten Suchbegriffe werden entfernt. Diese Aktion kann nicht rückgängig gemacht werden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            try {
              await searchHistoryService.markAllAsDeleted(user.uid);
              setSearchHistory([]);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) {
              console.warn('History: clear search failed', e);
            }
          },
        },
      ],
    );
  };

  const clearScanHistory = () => {
    if (!user?.uid || scanHistory.length === 0) return;
    Alert.alert(
      'Scanverlauf löschen?',
      'Alle gespeicherten Scans werden entfernt. Diese Aktion kann nicht rückgängig gemacht werden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            try {
              await scanHistoryService.markAllAsDeleted(user.uid);
              setScanHistory([]);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (e) {
              console.warn('History: clear scan failed', e);
            }
          },
        },
      ],
    );
  };

  // ─── Item handlers ─────────────────────────────────────────────
  const onSearchPress = (item: SearchHistoryItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Search is now in-place inside Stöbern (see explore.tsx). The
    // `query` param triggers an auto-submit + lands on the Alle
    // tab with merged Eigenmarken + Marken hits.
    safePush(
      `/(tabs)/explore?query=${encodeURIComponent(item.searchTerm)}&tab=alle` as any,
    );
  };

  const onScanPress = (item: ScanHistoryItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.productType === 'noname') {
      FirestoreService.prefetchComparisonData(item.productId, false);
      safePush(`/product-comparison/${item.productId}?type=noname` as any);
    } else {
      FirestoreService.prefetchComparisonData(item.productId, true);
      safePush(`/product-comparison/${item.productId}?type=brand` as any);
    }
  };

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Body lives below the chrome via paddingTop on the wrapper. */}
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
              { key: 'search', label: `Suchverlauf (${searchHistory.length})` },
              { key: 'scan', label: `Scanverlauf (${scanHistory.length})` },
            ] as const}
            value={activeTab}
            onChange={onTabChange}
          />
        </View>

        {/* Body — Crossfade between skeleton list and live PagerView.
            `fillParent` is required so the PagerView claims height. */}
        <Crossfade
          ready={!initialLoading}
          duration={320}
          fillParent
          style={{ flex: 1 }}
          skeleton={<HistorySkeleton variant={activeTab} />}
        >
          <PagerView
            ref={pagerRef}
            style={{ flex: 1 }}
            initialPage={0}
            onPageSelected={onPageSelected}
          >
            {/* Page 1 — Suchverlauf */}
            <View key="search" style={{ flex: 1 }}>
              <HistoryList
                items={searchHistory}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                emptyVariant="search"
                onClearAll={clearSearchHistory}
                clearLabel="Suchverlauf löschen"
                isActive={activeTab === 'search'}
                renderItem={(item) => (
                  <SearchCard
                    key={(item as SearchHistoryItem).id || (item as SearchHistoryItem).searchTerm}
                    item={item as SearchHistoryItem}
                    onPress={() => onSearchPress(item as SearchHistoryItem)}
                  />
                )}
              />
            </View>

            {/* Page 2 — Scanverlauf */}
            <View key="scan" style={{ flex: 1 }}>
              <HistoryList
                items={scanHistory}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                emptyVariant="scan"
                onClearAll={clearScanHistory}
                clearLabel="Scanverlauf löschen"
                isActive={activeTab === 'scan'}
                renderItem={(item) => (
                  <ScanCard
                    key={(item as ScanHistoryItem).id}
                    item={item as ScanHistoryItem}
                    onPress={() => onScanPress(item as ScanHistoryItem)}
                  />
                )}
              />
            </View>
          </PagerView>
        </Crossfade>
      </View>

      {/* Chrome */}
      <DetailHeader
        title="Such- & Scanverlauf"
        onBack={() => router.back()}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// HistoryList — shared body for both tabs. Empty state, optional
// "delete all" button at the top, ScrollView with cards.
// ────────────────────────────────────────────────────────────────────

function HistoryList({
  items,
  refreshing,
  onRefresh,
  emptyVariant,
  onClearAll,
  clearLabel,
  renderItem,
  isActive,
}: {
  items: any[];
  refreshing: boolean;
  onRefresh: () => void;
  emptyVariant: Tab;
  onClearAll: () => void;
  clearLabel: string;
  renderItem: (item: any) => React.ReactNode;
  isActive: boolean;
}) {
  const { theme, shadows } = useTokens();
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 100 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
      }
      showsVerticalScrollIndicator={false}
      // iOS: nur die aktive PagerView-Page claimt status-bar-tap.
      // Wenn beide Pages scrollsToTop=true (Default!) hätten, würde
      // iOS das Feature für beide deaktivieren.
      scrollsToTop={isActive}
    >
      {items.length === 0 ? (
        <HistoryEmpty variant={emptyVariant} />
      ) : (
        <View style={{ gap: 10 }}>
          {/* Outline-style "delete all" button — pill, dest colour. */}
          <Pressable
            onPress={onClearAll}
            style={({ pressed }) => ({
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: radii.full,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              marginBottom: 4,
              opacity: pressed ? 0.7 : 1,
              ...shadows.sm,
            })}
          >
            <MaterialCommunityIcons
              name="trash-can-outline"
              size={14}
              color="#e53935"
            />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 12,
                color: '#e53935',
              }}
            >
              {clearLabel}
            </Text>
          </Pressable>

          {items.map((item) => renderItem(item))}
        </View>
      )}
    </ScrollView>
  );
}

// ────────────────────────────────────────────────────────────────────
// SearchCard — single search-history item.
// ────────────────────────────────────────────────────────────────────

function SearchCard({
  item,
  onPress,
}: {
  item: SearchHistoryItem;
  onPress: () => void;
}) {
  const { theme, brand, shadows } = useTokens();
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
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: brand.primary + '15',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <MaterialCommunityIcons name="magnify" size={20} color={brand.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 15,
            color: theme.text,
            letterSpacing: -0.2,
          }}
        >
          {item.searchTerm}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            color: theme.textMuted,
            marginTop: 2,
          }}
        >
          {item.resultCount != null
            ? `${item.resultCount} Ergebnisse`
            : 'Suchbegriff'}
        </Text>
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 11,
          color: theme.textMuted,
        }}
      >
        {formatRelativeTime((item as any).timestamp)}
      </Text>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────
// ScanCard — single scan-history item.
// ────────────────────────────────────────────────────────────────────

function ScanCard({
  item,
  onPress,
}: {
  item: ScanHistoryItem;
  onPress: () => void;
}) {
  const { theme, shadows } = useTokens();
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
      {/* Product image — square thumbnail with package fallback */}
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 10,
          backgroundColor: theme.surfaceAlt,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {(item as any).productImage ? (
          <Image
            source={{ uri: (item as any).productImage }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <MaterialCommunityIcons
            name="barcode"
            size={24}
            color={theme.textMuted}
          />
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        {(item as any).brandName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            {(item as any).brandImage ? (
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
                  source={{ uri: (item as any).brandImage }}
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
                color: theme.primary,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              {(item as any).brandName}
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
          }}
        >
          {(item as any).productName ?? 'Unbekanntes Produkt'}
        </Text>
      </View>

      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 11,
          color: theme.textMuted,
        }}
      >
        {formatRelativeTime((item as any).timestamp)}
      </Text>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────
// HistoryEmpty — empty state per tab.
// ────────────────────────────────────────────────────────────────────

function HistoryEmpty({ variant }: { variant: Tab }) {
  const { theme } = useTokens();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 80, paddingHorizontal: 32, gap: 12 }}>
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
          name={variant === 'search' ? 'magnify' : 'barcode-scan'}
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
        {variant === 'search' ? 'Noch keine Suchen' : 'Noch keine Scans'}
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
        {variant === 'search'
          ? 'Deine Suchbegriffe werden hier angezeigt — tippe auf einen Eintrag, um die Suche erneut zu starten.'
          : 'Deine gescannten Produkte werden hier gesammelt — tippe auf einen Eintrag, um zur Detailseite zurückzukehren.'}
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// HistorySkeleton — initial-load placeholder. Six rows that mirror
// the live card shape (icon/image left, two text lines, timestamp
// right). Variant differentiates only the leading shape (round
// search icon vs. square scan thumbnail).
// ────────────────────────────────────────────────────────────────────

function HistorySkeleton({ variant }: { variant: Tab }) {
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
          {variant === 'search' ? (
            <Shimmer width={40} height={40} radius={20} />
          ) : (
            <Shimmer width={56} height={56} radius={10} />
          )}
          <View style={{ flex: 1, gap: 6 }}>
            <Shimmer width="80%" height={13} radius={4} />
            <Shimmer width="50%" height={11} radius={3} />
          </View>
          <Shimmer width={50} height={11} radius={3} />
        </View>
      ))}
    </View>
  );
}
