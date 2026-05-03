// app/favorites.tsx
//
// Favoriten-Liste — neu im Design-System:
//   • DetailHeader (Back + Title + Filter-Slot mit Badge) als chrome
//   • SegmentedTabs + PagerView für Marken / NoNames
//   • FilterSheet statt FixedAndroidModal für Filter & Sortierung
//   • Theme-Tokens via useTokens (statt Colors[colorScheme])
//   • Saubere Card-Liste mit Image + Eyebrow + Name + Market + Preis
//   • Sliding Bulk-Action-Bar wenn Produkte selektiert sind
//   • Crossfade-Skeleton während des Initial-Load
//   • Tap auf Card → navigiert zur Detail-Seite (mit Prefetch); Bulk-
//     Selection läuft über die explizite Checkbox links

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DETAIL_HEADER_ROW_HEIGHT,
  DetailHeader,
} from '@/components/design/DetailHeader';
import {
  FilterSheet,
  OptionList,
} from '@/components/design/FilterSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { Crossfade, Shimmer } from '@/components/design/Skeletons';
import BatchActionLoader from '@/components/ui/BatchActionLoader';
import { TOAST_MESSAGES } from '@/constants/ToastMessages';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { FirestoreService } from '@/lib/services/firestore';
import { getProductImage } from '@/lib/utils/productImage';
import {
  showCartAddedToast,
  showFavoriteRemovedToast,
  showInfoToast,
} from '@/lib/services/ui/toast';

type Tab = 'brand' | 'noname';
type SortBy = 'name' | 'price' | 'newest';

const SORT_OPTIONS: readonly (readonly [SortBy, string])[] = [
  ['name', 'Name (A–Z)'],
  ['price', 'Preis aufsteigend'],
  ['newest', 'Zuletzt hinzugefügt'],
] as const;

// ─── Relative date helper ──────────────────────────────────────────
//
// Renders the favourite's `addedAt` timestamp as a human-friendly
// caption. Recent items use a relative phrasing, older ones fall
// back to a compact absolute date. Returns null if the input is
// missing/invalid so the caller can short-circuit rendering.
//
//   < 1 min   → "gerade eben"
//   < 1 hour  → "vor X Min."
//   today     → "heute, HH:MM"
//   yesterday → "gestern, HH:MM"
//   < 7 days  → "vor X Tagen"
//   same year → "12.04. um 14:30"
//   else      → "12.04.2025"
function formatAddedAt(input: any): string | null {
  if (!input) return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;

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

  // Today / yesterday detection — calendar-day-based, not raw 24 h.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDelta = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (dayDelta === 0) return `heute, ${hh}:${mm}`;
  if (dayDelta === 1) return `gestern, ${hh}:${mm}`;
  if (diffDay < 7) return `vor ${dayDelta} Tagen`;
  if (yyyy === now.getFullYear()) return `${dd}.${MM}. um ${hh}:${mm}`;
  return `${dd}.${MM}.${yyyy}`;
}

export default function FavoritesScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, shadows, brand } = useTokens();
  const { user, userProfile } = useAuth();

  const {
    loadFavoritesWithData,
    removeFromFavorites,
  } = useFavorites();

  // ─── State ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('brand');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [brandFavorites, setBrandFavorites] = useState<any[]>([]);
  const [noNameFavorites, setNoNameFavorites] = useState<any[]>([]);
  // Markets are tracked PER TAB so the filter sheet only shows
  // markets that exist in the currently active tab. A market that
  // appears only in NoName-favourites shouldn't show as a chip
  // when the user is on the Marken tab — it would do nothing.
  const [brandMarkets, setBrandMarkets] = useState<{ id: string; name: string }[]>([]);
  const [noNameMarkets, setNoNameMarkets] = useState<{ id: string; name: string }[]>([]);

  const [showFilter, setShowFilter] = useState(false);
  const [filters, setFilters] = useState<{
    markets: string[];
    sortBy: SortBy;
  }>({ markets: [], sortBy: 'name' });

  const [batchLoaderState, setBatchLoaderState] = useState<{
    visible: boolean;
    processedItems: number;
    totalItems: number;
    currentItem: string;
  }>({ visible: false, processedItems: 0, totalItems: 0, currentItem: '' });

  // Initial load — prevents the "no favorites" flash on first paint.
  const [initialLoading, setInitialLoading] = useState(true);
  const hasLoadedOnce = useRef(false);

  // ─── PagerView <-> SegmentedTabs sync ───────────────────────────
  const pagerRef = useRef<PagerView>(null);
  const onTabChange = (next: Tab) => {
    setActiveTab(next);
    setSelectedProducts([]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pagerRef.current?.setPage(next === 'brand' ? 0 : 1);
  };
  const onPageSelected = (e: { nativeEvent: { position: number } }) => {
    const next: Tab = e.nativeEvent.position === 0 ? 'brand' : 'noname';
    setActiveTab((prev) => (prev === next ? prev : next));
    if (activeTab !== next) setSelectedProducts([]);
  };

  // ─── Hide native stack header (we render our own DetailHeader) ──
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // ─── Initial Load ───────────────────────────────────────────────
  useEffect(() => {
    if (user?.uid && !hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      loadInitialData();
    } else if (!user?.uid) {
      // No user — nothing to load.
      setInitialLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const splitDataByTab = (data: any[]) => {
    const brandProducts = data.filter((item: any) => item.type === 'markenprodukt');
    const noNameProducts = data.filter((item: any) => item.type === 'noname');

    // Build PER-TAB market sets so the filter sheet only ever
    // shows markets that actually exist on that tab. (A market
    // present only in NoName favourites would otherwise show up
    // as a chip on the Marken tab and silently filter to zero.)
    const brandMarketsMap = new Map<string, { id: string; name: string }>();
    const noNameMarketsMap = new Map<string, { id: string; name: string }>();
    data.forEach((item: any) => {
      if (!item.discounter?.id || !item.discounter?.name) return;
      const target =
        item.type === 'markenprodukt' ? brandMarketsMap : noNameMarketsMap;
      target.set(item.discounter.id, {
        id: item.discounter.id,
        name: item.discounter.name,
      });
    });

    return {
      brandProducts,
      noNameProducts,
      brandMarkets: Array.from(brandMarketsMap.values()),
      noNameMarkets: Array.from(noNameMarketsMap.values()),
    };
  };

  const loadInitialData = async () => {
    setInitialLoading(true);
    try {
      const data = await loadFavoritesWithData();
      const split = splitDataByTab(data);
      setBrandFavorites(split.brandProducts);
      setNoNameFavorites(split.noNameProducts);
      setBrandMarkets(split.brandMarkets);
      setNoNameMarkets(split.noNameMarkets);
    } catch (e) {
      console.warn('FavoritesScreen: load failed', e);
    } finally {
      setInitialLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await loadFavoritesWithData();
      const split = splitDataByTab(data);
      setBrandFavorites(split.brandProducts);
      setNoNameFavorites(split.noNameProducts);
      setBrandMarkets(split.brandMarkets);
      setNoNameMarkets(split.noNameMarkets);
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Filter helpers ─────────────────────────────────────────────
  const applyFiltersAndSorting = (products: any[]) => {
    let filtered = products;
    if (filters.markets.length > 0) {
      filtered = filtered.filter((item: any) =>
        filters.markets.includes(item.discounter?.id),
      );
    }
    return [...filtered].sort((a, b) => {
      switch (filters.sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'price':
          return (a.preis || 0) - (b.preis || 0);
        case 'newest': {
          const da = (a as any).addedAt ? new Date((a as any).addedAt).getTime() : 0;
          const db = (b as any).addedAt ? new Date((b as any).addedAt).getTime() : 0;
          return db - da;
        }
        default:
          return 0;
      }
    });
  };

  const toggleMarketFilter = (marketId: string) => {
    setFilters((prev) => ({
      ...prev,
      markets: prev.markets.includes(marketId)
        ? prev.markets.filter((id) => id !== marketId)
        : [...prev.markets, marketId],
    }));
  };

  const clearAllFilters = () => setFilters({ markets: [], sortBy: 'name' });

  const activeFilterCount =
    filters.markets.length + (filters.sortBy !== 'name' ? 1 : 0);

  // ─── Bulk selection ─────────────────────────────────────────────
  const getCurrentFavorites = () =>
    activeTab === 'brand' ? brandFavorites : noNameFavorites;
  const getFilteredFavorites = () =>
    applyFiltersAndSorting(getCurrentFavorites());

  const handleToggleSelect = (productId: string) => {
    setSelectedProducts((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleToggleSelectAll = () => {
    const cur = getFilteredFavorites();
    if (selectedProducts.length === cur.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(cur.map((p) => p.id));
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ─── Card actions ───────────────────────────────────────────────
  const handleProductPress = (product: any) => {
    if (product.type === 'markenprodukt') {
      FirestoreService.prefetchComparisonData(product.id, true);
      safePush(`/product-comparison/${product.id}?type=brand` as any);
    } else {
      const stufe = parseInt((product as any).stufe ?? '1', 10) || 1;
      if (stufe <= 2) {
        FirestoreService.prefetchProductDetails(product.id);
        safePush(`/noname-detail/${product.id}` as any);
      } else {
        FirestoreService.prefetchComparisonData(product.id, false);
        safePush(`/product-comparison/${product.id}?type=noname` as any);
      }
    }
  };

  const handleRemoveFavorite = async (product: any) => {
    try {
      // Optimistic remove from the right list.
      if (product.type === 'markenprodukt') {
        setBrandFavorites((prev) => prev.filter((p) => p.id !== product.id));
      } else {
        setNoNameFavorites((prev) => prev.filter((p) => p.id !== product.id));
      }
      setSelectedProducts((prev) => prev.filter((id) => id !== product.id));

      await removeFromFavorites(product.id, product.type);
      showFavoriteRemovedToast(product.name || product.produktName);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('FavoritesScreen: remove failed', e);
      showInfoToast(TOAST_MESSAGES.FAVORITES.removeError, 'error');
      // On error, reload to re-sync.
      loadInitialData();
    }
  };

  const handleBulkAddToCart = async () => {
    if (!user?.uid || selectedProducts.length === 0) return;

    setIsAddingToCart(true);
    const selectedFavorites = getFilteredFavorites().filter((p) =>
      selectedProducts.includes(p.id),
    );

    setBatchLoaderState({
      visible: true,
      processedItems: 0,
      totalItems: selectedFavorites.length,
      currentItem: '',
    });

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < selectedFavorites.length; i++) {
        const product = selectedFavorites[i];
        const productName =
          product.name || product.produktName || 'Unbekanntes Produkt';
        setBatchLoaderState((prev) => ({
          ...prev,
          currentItem: productName,
          processedItems: i,
        }));

        try {
          const isBrand = product.type === 'markenprodukt';
          const priceInfo = {
            price: product.preis || product.price || 0,
            savings: product.ersparnis || product.savings || 0,
            comparedProducts: [],
          };
          await FirestoreService.addToShoppingCart(
            user.uid,
            product.id,
            productName,
            isBrand,
            'favorites',
            {
              screenName: 'favorites',
              bulkAction: true,
              batchSize: selectedFavorites.length,
            },
            priceInfo,
          );
          successCount++;
        } catch (e) {
          console.warn('FavoritesScreen: addToCart failed', product.id, e);
          errorCount++;
        }
      }

      setBatchLoaderState((prev) => ({
        ...prev,
        processedItems: selectedFavorites.length,
        currentItem: 'Abgeschlossen!',
      }));

      // Brief pause so the user sees the completion frame.
      await new Promise((r) => setTimeout(r, 500));
      setSelectedProducts([]);

      if (errorCount === 0) {
        showCartAddedToast(
          `${successCount} ${successCount === 1 ? 'Produkt' : 'Produkte'} hinzugefügt!`,
          () => safePush('/shopping-list' as any),
        );
      } else {
        showInfoToast(
          `${successCount} hinzugefügt, ${errorCount} Fehler`,
          'info',
        );
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setBatchLoaderState({
        visible: false,
        processedItems: 0,
        totalItems: 0,
        currentItem: '',
      });
      setIsAddingToCart(false);
    }
  };

  // ─── Derived counts ─────────────────────────────────────────────
  const totalSavings = getFilteredFavorites().reduce((sum, item) => {
    const s =
      typeof item.savings === 'number'
        ? item.savings
        : parseFloat(item.savings) || 0;
    return sum + s;
  }, 0);

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Body lives BEHIND the chrome. The body's first child reserves
          chromeHeight via a top spacer so SegmentedTabs land just below
          the DetailHeader regardless of safe-area inset. */}
      <View style={{ flex: 1, paddingTop: chromeHeight }}>
        {/* SegmentedTabs row — counts bake into the labels so the user
            sees how many favourites per type without a separate stat
            line. */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 6,
          }}
        >
          <SegmentedTabs
            tabs={[
              { key: 'brand', label: `Marken (${brandFavorites.length})` },
              { key: 'noname', label: `NoNames (${noNameFavorites.length})` },
            ] as const}
            value={activeTab}
            onChange={onTabChange}
          />
        </View>

        {/* Bulk action bar — slides in when at least 1 favourite is
            selected. Counts + total savings + select-all + add-to-cart
            in one row. The whole bar lives in normal flow (so the list
            below shifts down by ~56 px when active); we wrap in
            Crossfade so the appearance is a smooth fade-in, not a
            jarring layout snap. */}
        <SelectionBar
          visible={selectedProducts.length > 0 || totalSavings > 0}
          selectedCount={selectedProducts.length}
          totalCount={getFilteredFavorites().length}
          totalSavings={totalSavings}
          activeTab={activeTab}
          onAddToCart={handleBulkAddToCart}
          disabled={isAddingToCart}
        />

        {/* Body — Crossfade between skeleton list (initial load)
            and the live PagerView. `fillParent` is REQUIRED here:
            the PagerView has flex:1 and needs the wrapper to
            propagate height. Without it, both layers collapse to
            0 and the lists render empty (yes, this caught us once
            already — see the rule in CLAUDE.md). */}
        <Crossfade
          ready={!initialLoading}
          duration={320}
          fillParent
          style={{ flex: 1 }}
          skeleton={<FavoritesSkeleton />}
        >
          <PagerView
            ref={pagerRef}
            style={{ flex: 1 }}
            initialPage={0}
            onPageSelected={onPageSelected}
          >
            {/* Page 1: Marken */}
            <View key="brand" style={{ flex: 1 }}>
              <FavoritesList
                items={applyFiltersAndSorting(brandFavorites)}
                rawCount={brandFavorites.length}
                emptyVariant="brand"
                refreshing={refreshing}
                onRefresh={handleRefresh}
                selectedProducts={selectedProducts}
                onToggleSelect={handleToggleSelect}
                onPressCard={handleProductPress}
                onRemove={handleRemoveFavorite}
                favoriteMarketId={(userProfile as any)?.favoriteMarket}
              />
            </View>
            {/* Page 2: NoNames */}
            <View key="noname" style={{ flex: 1 }}>
              <FavoritesList
                items={applyFiltersAndSorting(noNameFavorites)}
                rawCount={noNameFavorites.length}
                emptyVariant="noname"
                refreshing={refreshing}
                onRefresh={handleRefresh}
                selectedProducts={selectedProducts}
                onToggleSelect={handleToggleSelect}
                onPressCard={handleProductPress}
                onRemove={handleRemoveFavorite}
                favoriteMarketId={(userProfile as any)?.favoriteMarket}
              />
            </View>
          </PagerView>
        </Crossfade>
      </View>

      {/* Chrome — DetailHeader with persistent "Alle markieren"
          toggle + filter icon (with badge). Both buttons sit
          permanently in the right slot so the user can always
          reach select-all without first having to make a single
          selection (which the floating bulk-bar approach
          required). */}
      <DetailHeader
        title="Favoriten"
        onBack={() => router.back()}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <SelectAllPill
              disabled={getFilteredFavorites().length === 0}
              allSelected={
                selectedProducts.length > 0 &&
                selectedProducts.length === getFilteredFavorites().length
              }
              someSelected={selectedProducts.length > 0}
              onPress={handleToggleSelectAll}
            />
            <Pressable
              onPress={() => setShowFilter(true)}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <MaterialCommunityIcons
                name="tune-vertical"
                size={18}
                color={theme.textMuted}
              />
              {activeFilterCount > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    paddingHorizontal: 4,
                    backgroundColor: brand.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 10,
                      color: '#fff',
                      lineHeight: 14,
                    }}
                  >
                    {activeFilterCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        }
      />

      {/* Filter / Sortierung — FilterSheet replaces FixedAndroidModal */}
      <FilterSheet
        visible={showFilter}
        title="Filter & Sortierung"
        onClose={() => setShowFilter(false)}
      >
        <FilterSheetBody
          sortBy={filters.sortBy}
          onChangeSort={(s) => setFilters((prev) => ({ ...prev, sortBy: s }))}
          markets={activeTab === 'brand' ? brandMarkets : noNameMarkets}
          selectedMarkets={filters.markets}
          onToggleMarket={toggleMarketFilter}
          onClearAll={clearAllFilters}
          activeCount={activeFilterCount}
        />
      </FilterSheet>

      {/* Batch action loader for bulk add-to-cart */}
      <BatchActionLoader
        visible={batchLoaderState.visible}
        title="Zum Einkaufszettel hinzufügen"
        subtitle="Deine Lieblingsprodukte werden hinzugefügt"
        icon="cart.badge.plus"
        gradient={['#4CAF50', '#2E7D32']}
        progress={
          batchLoaderState.totalItems > 0
            ? batchLoaderState.processedItems / batchLoaderState.totalItems
            : 0
        }
        currentItem={batchLoaderState.currentItem}
        totalItems={batchLoaderState.totalItems}
        processedItems={batchLoaderState.processedItems}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// SelectAllPill — persistent select-all toggle in the header.
// Three visual states: all selected (filled checkbox + brand bg),
// some selected (filled-with-minus + brand-tint bg), none selected
// (outline checkbox + neutral bg). When the active list is empty
// the pill is rendered disabled (greyed-out, no press handler).
// ────────────────────────────────────────────────────────────────────

function SelectAllPill({
  allSelected,
  someSelected,
  disabled,
  onPress,
}: {
  allSelected: boolean;
  someSelected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { theme, brand } = useTokens();

  const filled = allSelected;
  const partial = !allSelected && someSelected;
  const bg = filled
    ? brand.primary
    : partial
      ? brand.primary + '22'
      : theme.surfaceAlt;
  const fg = filled ? '#fff' : partial ? brand.primary : theme.textMuted;
  const iconName = filled
    ? 'checkbox-marked'
    : partial
      ? 'minus-box'
      : 'checkbox-blank-outline';

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        height: 32,
        paddingHorizontal: 10,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: bg,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <MaterialCommunityIcons name={iconName} size={16} color={fg} />
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.bold,
          fontSize: 12,
          color: fg,
          letterSpacing: 0.2,
        }}
      >
        Alle
      </Text>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────
// SelectionBar — fades in when selection is active OR when there's
// total savings to show. Uses Reanimated 3 (UI-thread) for the
// fade and the optional max-height collapse so the list below
// reflows without jank. The "Alle"-Toggle that used to live here
// has moved into the DetailHeader right slot (always visible);
// this bar now only carries the count + add-to-cart action.
// ────────────────────────────────────────────────────────────────────

function SelectionBar({
  visible,
  selectedCount,
  totalCount,
  totalSavings,
  activeTab,
  onAddToCart,
  disabled,
}: {
  visible: boolean;
  selectedCount: number;
  totalCount: number;
  totalSavings: number;
  activeTab: Tab;
  onAddToCart: () => void;
  disabled: boolean;
}) {
  const { brand: brandTokens } = useTokens();
  const t = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    t.value = withTiming(visible ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, t]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: t.value,
    maxHeight: 64 * t.value,
    transform: [{ translateY: (1 - t.value) * -8 }],
  }));

  if (totalCount === 0) return null;

  const subtitle =
    selectedCount > 0
      ? `${selectedCount} ausgewählt`
      : totalSavings > 0
        ? `Ersparnis: ${totalSavings.toFixed(2).replace('.', ',')} €`
        : 'Tippe Karten zum Auswählen';

  return (
    <Animated.View
      style={[{ marginHorizontal: 20, marginTop: 8, marginBottom: 4, overflow: 'hidden' }, animStyle]}
    >
      <LinearGradient
        colors={[brandTokens.primaryDark, brandTokens.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 13,
              color: '#fff',
            }}
          >
            {totalCount} {activeTab === 'brand' ? 'Marken' : 'NoNames'}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: 'rgba(255,255,255,0.85)',
              marginTop: 1,
            }}
          >
            {subtitle}
          </Text>
        </View>

        {selectedCount > 0 ? (
          <Pressable
            onPress={onAddToCart}
            disabled={disabled}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 99,
              backgroundColor: '#fff',
              opacity: pressed || disabled ? 0.75 : 1,
            })}
          >
            <MaterialCommunityIcons
              name="cart-plus"
              size={14}
              color={brandTokens.primaryDark}
            />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 11,
                color: brandTokens.primaryDark,
                letterSpacing: 0.2,
              }}
            >
              Liste
            </Text>
          </Pressable>
        ) : null}
      </LinearGradient>
    </Animated.View>
  );
}

// ────────────────────────────────────────────────────────────────────
// FavoritesList — one tab's body (scrollable list + empty state).
// Shared between Marken and NoNames; the only difference is the
// empty-state copy and which fields the cards prefer (Hersteller for
// Marken, Handelsmarke for NoNames).
// ────────────────────────────────────────────────────────────────────

function FavoritesList({
  items,
  rawCount,
  emptyVariant,
  refreshing,
  onRefresh,
  selectedProducts,
  onToggleSelect,
  onPressCard,
  onRemove,
  favoriteMarketId,
}: {
  items: any[];
  rawCount: number;
  emptyVariant: Tab;
  refreshing: boolean;
  onRefresh: () => void;
  selectedProducts: string[];
  onToggleSelect: (id: string) => void;
  onPressCard: (product: any) => void;
  onRemove: (product: any) => void;
  favoriteMarketId?: string;
}) {
  const { theme } = useTokens();

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 100 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
      }
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {items.length === 0 ? (
        <FavoritesEmpty rawCount={rawCount} variant={emptyVariant} />
      ) : (
        <View style={{ gap: 10 }}>
          {items.map((item) => (
            <FavoriteCard
              key={item.id}
              item={item}
              selected={selectedProducts.includes(item.id)}
              onToggleSelect={onToggleSelect}
              onPressCard={onPressCard}
              onRemove={onRemove}
              isFavoriteMarket={favoriteMarketId === item.discounter?.id}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ────────────────────────────────────────────────────────────────────
// FavoriteCard — list item.
// • 64×64 image left
// • Eyebrow (Hersteller for Marken / Handelsmarke for NoNames) +
//   product name + market info row (logo + name)
// • Price right, with savings underneath if present
// • Checkbox left for bulk selection (visible only on tap, or
//   always — currently always so the bulk affordance is discoverable)
// • Trash button right for remove
// • Tap on card → navigate to product detail
// ────────────────────────────────────────────────────────────────────

const PRODUCT_IMAGE_SIZE = 64;

function FavoriteCard({
  item,
  selected,
  onToggleSelect,
  onPressCard,
  onRemove,
  isFavoriteMarket,
}: {
  item: any;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onPressCard: (product: any) => void;
  onRemove: (product: any) => void;
  isFavoriteMarket: boolean;
}) {
  const { theme, shadows, brand } = useTokens();

  const isMarken = item.type === 'markenprodukt';
  const eyebrowLogo = isMarken ? item.hersteller?.bild : null;
  const eyebrowName = isMarken
    ? item.hersteller?.name
    : item.handelsmarke?.bezeichnung ?? item.handelsmarke?.name;

  const savings =
    typeof item.savings === 'number'
      ? item.savings
      : parseFloat(item.savings) || 0;

  // Human-readable "added X" caption — null when the data layer
  // didn't expose `addedAt` (older favourites pre-redesign), so
  // the row simply omits the right-aligned timestamp.
  const addedAtLabel = formatAddedAt(item.addedAt);

  return (
    <Pressable
      onPress={() => onPressCard(item)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 14,
        backgroundColor: selected ? brand.primary + '12' : theme.surface,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? brand.primary : theme.border,
        opacity: pressed ? 0.96 : 1,
        ...shadows.sm,
      })}
    >
      {/* Selection checkbox — explicit affordance, lives outside the
          press-to-navigate area via a separate Pressable that
          stops propagation. */}
      <Pressable
        onPress={() => onToggleSelect(item.id)}
        hitSlop={8}
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons
          name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
          size={22}
          color={selected ? brand.primary : theme.borderStrong}
        />
      </Pressable>

      {/* Product image. ImageWithShimmer is the legacy variant; here
          we use a plain Image — the surrounding Crossfade and the
          Skeleton list cover the loading state. */}
      <View
        style={{
          width: PRODUCT_IMAGE_SIZE,
          height: PRODUCT_IMAGE_SIZE,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: '#ffffff',
        }}
      >
        {getProductImage(item) ? (
          <Image
            source={{ uri: getProductImage(item) ?? undefined }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="package-variant" size={28} color={theme.textMuted} />
          </View>
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Eyebrow — small logo + brand/handelsmarke name. */}
        {eyebrowName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 }}>
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
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                color: theme.primary,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                flex: 1,
              }}
            >
              {eyebrowName}
            </Text>
          </View>
        ) : null}

        {/* Product name */}
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
          {item.name || item.produktName || 'Unbekanntes Produkt'}
        </Text>

        {/* Market info — for NoNames AND Marken (whichever has discounter). */}
        {item.discounter?.name ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              marginTop: 4,
            }}
          >
            {item.discounter?.bild ? (
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
                  source={{ uri: item.discounter.bild }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            {isFavoriteMarket ? (
              <MaterialCommunityIcons name="heart" size={10} color={brand.primary} />
            ) : null}
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
              {item.discounter.name}
              {item.discounter.land ? ` (${item.discounter.land})` : ''}
            </Text>
          </View>
        ) : null}

        {/* Price + inline savings (left) — Added-at caption (right).
            One row so card height stays constant. The addedAt
            timestamp uses a relative phrasing for recent items
            ("vor X Min." / "heute, 14:30") and a compact absolute
            date for older ones — see `formatAddedAt`. Skipped if
            the data layer didn't surface an `addedAt` field. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            marginTop: 4,
            gap: 6,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 15,
              color: theme.text,
              letterSpacing: -0.2,
            }}
          >
            {(item.preis ?? 0).toFixed(2).replace('.', ',')} €
          </Text>
          {savings > 0 ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 11,
                color: brand.primary,
              }}
            >
              −{savings.toFixed(2).replace('.', ',')} €
            </Text>
          ) : null}
          {addedAtLabel ? (
            <Text
              numberOfLines={1}
              style={{
                marginLeft: 'auto',
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 10,
                color: theme.textMuted,
              }}
            >
              {addedAtLabel}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Remove button — stop propagation so it doesn't navigate. */}
      <Pressable
        onPress={(e) => {
          e.stopPropagation();
          onRemove(item);
        }}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: radii.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.surfaceAlt,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.textMuted} />
      </Pressable>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────
// FavoritesEmpty — empty-state copy. Two variants: "no favourites
// at all" and "filters too restrictive" — the latter is rendered
// when the user has favourites but the active filters hide them.
// ────────────────────────────────────────────────────────────────────

function FavoritesEmpty({
  rawCount,
  variant,
}: {
  rawCount: number;
  variant: Tab;
}) {
  const { theme } = useTokens();
  const filteredEmpty = rawCount > 0;
  const label = variant === 'brand' ? 'Marken-Favoriten' : 'NoName-Favoriten';
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
        <MaterialCommunityIcons name="heart-outline" size={30} color={theme.textMuted} />
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
        {filteredEmpty ? `Keine ${label} für diese Filter` : `Noch keine ${label}`}
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
        {filteredEmpty
          ? 'Passe die Filter an oder setze sie zurück, um wieder Favoriten zu sehen.'
          : 'Tippe auf das Herz bei einem Produkt, um es zu deinen Favoriten hinzuzufügen.'}
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// FavoritesSkeleton — shape-matching skeleton list during the
// initial fetch. Renders 6 placeholder cards with the same
// dimensions as live FavoriteCards so the swap-in is invisible.
// ────────────────────────────────────────────────────────────────────

function FavoritesSkeleton() {
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
          <Shimmer width={22} height={22} radius={11} />
          <Shimmer width={PRODUCT_IMAGE_SIZE} height={PRODUCT_IMAGE_SIZE} radius={10} />
          <View style={{ flex: 1, gap: 6 }}>
            <Shimmer width={70} height={9} radius={3} />
            <Shimmer width="90%" height={13} radius={4} />
            <Shimmer width="55%" height={11} radius={3} />
            <Shimmer width={50} height={13} radius={4} />
          </View>
          <Shimmer width={36} height={36} radius={18} />
        </View>
      ))}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// FilterSheetBody — content rendered inside FilterSheet.
// Sortierung (radio-list via OptionList) + Märkte (chip grid).
// ────────────────────────────────────────────────────────────────────

function FilterSheetBody({
  sortBy,
  onChangeSort,
  markets,
  selectedMarkets,
  onToggleMarket,
  onClearAll,
  activeCount,
}: {
  sortBy: SortBy;
  onChangeSort: (s: SortBy) => void;
  markets: { id: string; name: string }[];
  selectedMarkets: string[];
  onToggleMarket: (id: string) => void;
  onClearAll: () => void;
  activeCount: number;
}) {
  const { theme, brand } = useTokens();

  return (
    <View style={{ paddingBottom: 8 }}>
      {/* Sortierung */}
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 13,
          color: theme.textMuted,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        Sortierung
      </Text>
      <OptionList
        value={sortBy}
        options={SORT_OPTIONS}
        onChange={onChangeSort}
      />

      {/* Märkte */}
      {markets.length > 0 ? (
        <View style={{ marginTop: 18 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 13,
              color: theme.textMuted,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Märkte ({markets.length})
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {markets.map((m) => {
              const on = selectedMarkets.includes(m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => onToggleMarket(m.id)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 99,
                    backgroundColor: on ? brand.primary : theme.surfaceAlt,
                    borderWidth: 1,
                    borderColor: on ? brand.primary : theme.border,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <MaterialCommunityIcons
                    name="storefront-outline"
                    size={14}
                    color={on ? '#fff' : theme.textMuted}
                  />
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 12,
                      color: on ? '#fff' : theme.text,
                    }}
                  >
                    {m.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Reset all */}
      {activeCount > 0 ? (
        <Pressable
          onPress={onClearAll}
          style={({ pressed }) => ({
            marginTop: 22,
            alignSelf: 'center',
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 99,
            backgroundColor: theme.surfaceAlt,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: theme.textMuted,
            }}
          >
            Alle Filter zurücksetzen
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
