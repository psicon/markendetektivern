import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandCard } from '@/components/design/BrandCard';
import { FilterChip } from '@/components/design/FilterChip';
import { FilterSheet, OptionList } from '@/components/design/FilterSheet';
import { ProductCard } from '@/components/design/ProductCard';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { BannerAd } from '@/components/ads/BannerAd';
import { LockedCategoryModal } from '@/components/ui/LockedCategoryModal';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
import { FirestoreService } from '@/lib/services/firestore';
import { ExtendedMarkenproduktFilters, ExtendedNoNameFilters } from '@/lib/types/filters';
import type {
  Discounter,
  FirestoreDocument,
  Handelsmarken,
  Kategorien,
  Produkte,
} from '@/lib/types/firestore';

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

type Tab = 'eigen' | 'marken';
type SheetKey = 'markt' | 'handels' | 'kategorie' | 'stufe' | 'marke' | 'inhalt' | 'sort' | null;

const INGREDIENTS = [
  'Bio',
  'Vegan',
  'Vegetarisch',
  'Laktosefrei',
  'Glutenfrei',
  'Ohne Palmöl',
  'Ohne Zuckerzusatz',
  'Fairtrade',
] as const;

type SortKey = 'name' | 'preis';

const SHEET_TITLES: Record<Exclude<SheetKey, null>, string> = {
  markt: 'Markt',
  handels: 'Handelsmarke',
  kategorie: 'Kategorie',
  stufe: 'Stufe — mindestens',
  marke: 'Marke',
  inhalt: 'Inhaltsstoffe',
  sort: 'Sortieren',
};

// ────────────────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const { theme, brand, shadows, stufen } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string; categoryFilter?: string; markeFilter?: string }>();
  const { userProfile } = useAuth();
  const { isPremium } = useRevenueCat();
  const analytics = useAnalytics();

  // PagerView for native horizontal tab swipe
  const pagerRef = useRef<PagerView | null>(null);

  // ─── UI state ──────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('eigen');
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState<string>('all');
  const [handels, setHandels] = useState<string>('all');
  const [cat, setCat] = useState<string>('all');
  const [minStufe, setMinStufe] = useState<number>(0);
  const [brandId, setBrandId] = useState<string>('all');
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('name');
  const [sheet, setSheet] = useState<SheetKey>(null);

  // ─── Reference data (filters) ──────────────────────────────────────────
  const [discounter, setDiscounter] = useState<FirestoreDocument<Discounter>[]>([]);
  const [handelsmarken, setHandelsmarken] = useState<FirestoreDocument<Handelsmarken>[]>([]);
  const [kategorien, setKategorien] = useState<FirestoreDocument<Kategorien>[]>([]);
  const [markenList, setMarkenList] = useState<Array<{ id: string; name: string }>>([]);

  // ─── Product lists ─────────────────────────────────────────────────────
  const [nonames, setNonames] = useState<FirestoreDocument<Produkte>[]>([]);
  const [nonameLoading, setNonameLoading] = useState(true);
  const [nonameLastDoc, setNonameLastDoc] = useState<any>(null);
  const [nonameHasMore, setNonameHasMore] = useState(true);

  const [markenprodukte, setMarkenprodukte] = useState<FirestoreDocument<any>[]>([]);
  const [markenLoading, setMarkenLoading] = useState(false);
  const [markenLastDoc, setMarkenLastDoc] = useState<any>(null);
  const [markenHasMore, setMarkenHasMore] = useState(true);

  // ─── Locked category gate (Alkohol) ────────────────────────────────────
  const [lockedCategory, setLockedCategory] = useState<FirestoreDocument<Kategorien> | null>(null);

  // ─── Route param handling (from Home quick-access) ─────────────────────
  useEffect(() => {
    if (params.tab === 'nonames') setTab('eigen');
    if (params.tab === 'markenprodukte') setTab('marken');
    if (params.categoryFilter) setCat(String(params.categoryFilter));
    if (params.markeFilter) setBrandId(String(params.markeFilter));
  }, [params.tab, params.categoryFilter, params.markeFilter]);

  // ─── Load reference data once (sorted A–Z for stable filter UX) ──────
  useEffect(() => {
    const byName = (a: any, b: any) =>
      String(a.name ?? a.bezeichnung ?? '').localeCompare(
        String(b.name ?? b.bezeichnung ?? ''),
        'de',
        { sensitivity: 'base' },
      );
    (async () => {
      try {
        const userLevel = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
        const [ds, cats, ms] = await Promise.all([
          FirestoreService.getDiscounter(),
          categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium),
          FirestoreService.getMarken().catch(() => []),
        ]);
        setDiscounter([...ds].sort(byName));
        setKategorien([...cats].sort(byName));
        setMarkenList(
          (ms ?? [])
            .map((m: any) => ({ id: m.id, name: m.name ?? m.bezeichnung ?? '' }))
            .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })),
        );
      } catch (e) {
        console.warn('Explore: failed to load reference data', e);
      }
    })();
  }, [userProfile, isPremium]);

  // ─── Lazy-load Handelsmarken the first time the filter sheet opens ─────
  useEffect(() => {
    if (sheet !== 'handels' || handelsmarken.length > 0) return;
    (async () => {
      try {
        const hms = await (FirestoreService as any).getHandelsmarken?.();
        if (Array.isArray(hms)) {
          const sorted = [...hms].sort((a: any, b: any) =>
            String(a.bezeichnung ?? a.name ?? '').localeCompare(
              String(b.bezeichnung ?? b.name ?? ''),
              'de',
              { sensitivity: 'base' },
            ),
          );
          setHandelsmarken(sorted);
        }
      } catch {
        /* optional — service may not exist; ignore */
      }
    })();
  }, [sheet, handelsmarken.length]);

  // ─── Debounced filter → reload products ────────────────────────────────
  const reloadSeq = useRef(0);
  useEffect(() => {
    if (kategorien.length === 0) return; // wait for categories (needed for access gate)
    const mySeq = ++reloadSeq.current;
    const t = setTimeout(() => {
      if (reloadSeq.current !== mySeq) return;
      if (tab === 'eigen') loadNonames(true);
      else loadMarken(true);
    }, 200); // small debounce for typing
    return () => clearTimeout(t);

  }, [tab, query, market, handels, cat, minStufe, brandId, ingredients, sort, kategorien.length]);

  // ─── Category access gate ─────────────────────────────────────────────
  const onChangeCategory = useCallback(
    (k: string) => {
      if (k === 'all') {
        setCat('all');
        setSheet(null);
        return;
      }
      const selected = kategorien.find((c) => c.id === k);
      if (selected && (selected as any).isLocked) {
        setLockedCategory(selected);
        setSheet(null);
        return;
      }
      setCat(k);
      setSheet(null);
    },
    [kategorien],
  );

  // ─── Data loaders ──────────────────────────────────────────────────────
  const buildNonameFilters = useCallback((): ExtendedNoNameFilters => {
    return {
      categoryFilters: cat !== 'all' ? [cat] : [],
      discounterFilters: market !== 'all' ? [market] : [],
      stufeFilters: minStufe > 0 ? [minStufe, minStufe + 1, 5].filter((n, i, a) => a.indexOf(n) === i && n <= 5) : [],
      handelsmarkeFilters: handels !== 'all' ? [handels] : [],
      allergenFilters: {},
      nutritionFilters: {},
      searchQuery: query.trim() || undefined,
      sortBy: sort === 'preis' ? 'preis' : 'name',
    } as any;
  }, [cat, market, minStufe, handels, query, sort]);

  const buildMarkenFilters = useCallback((): ExtendedMarkenproduktFilters => {
    return {
      categoryFilters: cat !== 'all' ? [cat] : [],
      herstellerFilters: brandId !== 'all' ? [brandId] : [],
      allergenFilters: {},
      nutritionFilters: {},
      searchQuery: query.trim() || undefined,
      sortBy: sort === 'preis' ? 'preis' : 'name',
    } as any;
  }, [cat, brandId, query, sort]);

  const loadNonames = useCallback(
    async (reset: boolean) => {
      if (!reset && (nonameLoading || !nonameHasMore)) return;
      try {
        setNonameLoading(true);
        const size = reset ? 20 : 10;
        const res = await FirestoreService.getNoNameProductsPaginated(
          size,
          reset ? null : nonameLastDoc,
          buildNonameFilters() as any,
        );
        setNonames((prev) => {
          if (reset) return res.products as any;
          const existing = new Set(prev.map((p) => p.id));
          return [...prev, ...(res.products as any).filter((p: any) => !existing.has(p.id))];
        });
        setNonameLastDoc(res.lastDoc);
        setNonameHasMore(res.hasMore);
      } catch (e) {
        console.warn('Explore: loadNonames failed', e);
      } finally {
        setNonameLoading(false);
      }
    },
    [nonameLoading, nonameHasMore, nonameLastDoc, buildNonameFilters],
  );

  const loadMarken = useCallback(
    async (reset: boolean) => {
      if (!reset && (markenLoading || !markenHasMore)) return;
      try {
        setMarkenLoading(true);
        const size = reset ? 20 : 10;
        const res = await FirestoreService.getMarkenproduktePaginated(
          size,
          reset ? null : markenLastDoc,
          buildMarkenFilters() as any,
        );
        setMarkenprodukte((prev) => {
          if (reset) return res.products as any;
          const existing = new Set(prev.map((p) => p.id));
          return [...prev, ...(res.products as any).filter((p: any) => !existing.has(p.id))];
        });
        setMarkenLastDoc(res.lastDoc);
        setMarkenHasMore(res.hasMore);
      } catch (e) {
        console.warn('Explore: loadMarken failed', e);
      } finally {
        setMarkenLoading(false);
      }
    },
    [markenLoading, markenHasMore, markenLastDoc, buildMarkenFilters],
  );

  const loadMore = useCallback(() => {
    if (tab === 'eigen') loadNonames(false);
    else loadMarken(false);
  }, [tab, loadNonames, loadMarken]);

  // ─── Helpers ───────────────────────────────────────────────────────────
  const switchTab = useCallback((k: Tab) => {
    setTab(k);
    setMarket('all');
    setHandels('all');
    setMinStufe(0);
    setBrandId('all');
    // Keep PagerView in sync (user tapped a tab)
    pagerRef.current?.setPage(k === 'eigen' ? 0 : 1);
  }, []);

  // When user swipes the pager, update the tab state (but don't reset filters —
  // swipe is a navigation gesture, not a filter change).
  const onPageSelected = useCallback((e: { nativeEvent: { position: number } }) => {
    const k: Tab = e.nativeEvent.position === 0 ? 'eigen' : 'marken';
    if (k !== tab) setTab(k);
  }, [tab]);

  const resetAll = useCallback(() => {
    setMarket('all');
    setHandels('all');
    setCat('all');
    setMinStufe(0);
    setBrandId('all');
    setIngredients([]);
  }, []);

  const toggleIngredient = useCallback(
    (x: string) =>
      setIngredients((prev) => (prev.includes(x) ? prev.filter((i) => i !== x) : [...prev, x])),
    [],
  );

  const anyFilter =
    (tab === 'eigen' && (market !== 'all' || handels !== 'all' || minStufe > 0)) ||
    (tab === 'marken' && brandId !== 'all') ||
    cat !== 'all' ||
    ingredients.length > 0;

  // ─── Discounter color/short lookup (for MarketBadge on cards) ─────────
  const discounterMap = useMemo(() => {
    const m: Record<string, { color: string; short: string }> = {};
    discounter.forEach((d) => {
      const n = (d as any).name ?? '';
      m[d.id] = {
        color: (d as any).color ?? '#888888',
        short: n.length <= 2 ? n : n[0].toUpperCase(),
      };
    });
    return m;
  }, [discounter]);

  // Readable value labels for chips:
  const catLabel = useMemo(() => {
    if (cat === 'all') return null;
    const k = kategorien.find((c) => c.id === cat);
    return (k as any)?.bezeichnung ?? (k as any)?.name ?? null;
  }, [cat, kategorien]);

  const marketLabel = useMemo(() => {
    if (market === 'all') return null;
    const d = discounter.find((x) => x.id === market);
    return (d as any)?.name ?? null;
  }, [market, discounter]);

  const brandLabel = useMemo(() => {
    if (brandId === 'all') return null;
    const m = markenList.find((x) => x.id === brandId);
    return m?.name ?? null;
  }, [brandId, markenList]);

  const handelsLabel = useMemo(() => {
    if (handels === 'all') return null;
    const h = handelsmarken.find((x) => x.id === handels);
    return (h as any)?.bezeichnung ?? (h as any)?.name ?? null;
  }, [handels, handelsmarken]);

  // ─── Navigation handlers ───────────────────────────────────────────────
  const openProduct = useCallback(
    (p: FirestoreDocument<Produkte>, index: number) => {
      analytics.trackProductViewWithJourney(
        p.id,
        'noname',
        (p as any).name ?? 'NoName',
        index,
      );
      const stufeNum = parseInt((p as any).stufe) || 1;
      if (stufeNum <= 2) {
        router.push(`/noname-detail/${p.id}` as any);
      } else {
        router.push(`/product-comparison/${p.id}?type=noname` as any);
      }
    },
    [analytics],
  );

  const openBrand = useCallback(
    (m: FirestoreDocument<any>, index: number) => {
      analytics.trackProductViewWithJourney(
        m.id,
        'brand',
        (m as any).name ?? 'Marke',
        index,
      );
      router.push(`/product-comparison/${m.id}?type=markenprodukt` as any);
    },
    [analytics],
  );

  // ─── Render ────────────────────────────────────────────────────────────
  const currentList = tab === 'eigen' ? nonames : markenprodukte;
  const isLoading = tab === 'eigen' ? nonameLoading : markenLoading;
  const hasMore = tab === 'eigen' ? nonameHasMore : markenHasMore;
  const showEmpty = !isLoading && currentList.length === 0;

  // One sub-component per page — both share `query` / filter state so typing
  // in the search input on one page reflects on the other (fine because only
  // one page is visible at a time). Grid rendered as a flexbox wrap since we
  // need a ScrollView for stickyHeaderIndices support.
  const renderFilterRail = (forTab: Tab) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, gap: 6 }}
    >
      <FilterChip
        icon="swap-vertical"
        label={sort === 'preis' ? 'Preis' : 'A–Z'}
        strong={sort !== 'name'}
        onPress={() => setSheet('sort')}
      />
      <View style={{ width: 1, backgroundColor: theme.border, marginVertical: 4, marginHorizontal: 4 }} />
      {anyFilter ? (
        <FilterChip icon="filter-remove-outline" label="Zurücksetzen" muted onPress={resetAll} />
      ) : null}
      {forTab === 'eigen' ? (
        <>
          <FilterChip
            icon="storefront-outline"
            label="Markt"
            value={marketLabel}
            onPress={() => setSheet('markt')}
            onClear={market !== 'all' ? () => setMarket('all') : null}
          />
          <FilterChip
            icon="shape-outline"
            label="Kategorie"
            value={catLabel}
            onPress={() => setSheet('kategorie')}
            onClear={cat !== 'all' ? () => setCat('all') : null}
          />
          <FilterChip
            icon="star-four-points-outline"
            label="Stufe"
            value={minStufe ? `${minStufe}+` : null}
            onPress={() => setSheet('stufe')}
            onClear={minStufe ? () => setMinStufe(0) : null}
          />
          <FilterChip
            icon="leaf"
            label="Inhaltsstoffe"
            value={ingredients.length ? String(ingredients.length) : null}
            onPress={() => setSheet('inhalt')}
            onClear={ingredients.length ? () => setIngredients([]) : null}
          />
          <FilterChip
            icon="tag-outline"
            label="Handelsmarke"
            value={handelsLabel}
            onPress={() => setSheet('handels')}
            onClear={handels !== 'all' ? () => setHandels('all') : null}
          />
        </>
      ) : (
        <>
          <FilterChip
            icon="bookmark-outline"
            label="Marke"
            value={brandLabel}
            onPress={() => setSheet('marke')}
            onClear={brandId !== 'all' ? () => setBrandId('all') : null}
          />
          <FilterChip
            icon="shape-outline"
            label="Kategorie"
            value={catLabel}
            onPress={() => setSheet('kategorie')}
            onClear={cat !== 'all' ? () => setCat('all') : null}
          />
          <FilterChip
            icon="leaf"
            label="Inhaltsstoffe"
            value={ingredients.length ? String(ingredients.length) : null}
            onPress={() => setSheet('inhalt')}
            onClear={ingredients.length ? () => setIngredients([]) : null}
          />
        </>
      )}
    </ScrollView>
  );

  const renderSearchInput = (forTab: Tab) => (
    <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
      <View
        style={{
          height: 38,
          borderRadius: 11,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <MaterialCommunityIcons name="magnify" size={16} color={theme.textMuted} />
        <TextInput
          placeholder={forTab === 'eigen' ? 'Eigenmarken durchsuchen …' : 'Marken oder Hersteller …'}
          placeholderTextColor={theme.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 14,
            color: theme.text,
            paddingVertical: 0,
          }}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={6}>
            <MaterialCommunityIcons name="close-circle" size={16} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  // Fallback BlurView on Android has poor quality; fall back to a tinted
  // semi-transparent view (still gives the "glassy" feel with the bg showing).
  const StickyHeader = ({ forTab }: { forTab: Tab }) => {
    const commonStyle = { paddingBottom: 10 };
    if (Platform.OS === 'ios') {
      return (
        <BlurView
          tint={scheme === 'dark' ? 'dark' : 'light'}
          intensity={70}
          style={commonStyle}
        >
          {renderSearchInput(forTab)}
          {renderFilterRail(forTab)}
        </BlurView>
      );
    }
    return (
      <View
        style={[
          commonStyle,
          {
            backgroundColor: scheme === 'dark'
              ? 'rgba(15,18,20,0.92)'
              : 'rgba(245,247,248,0.92)',
          },
        ]}
      >
        {renderSearchInput(forTab)}
        {renderFilterRail(forTab)}
      </View>
    );
  };

  const renderGrid = (forTab: Tab) => {
    const items = forTab === 'eigen' ? nonames : markenprodukte;
    const loading = forTab === 'eigen' ? nonameLoading : markenLoading;
    const empty = !loading && items.length === 0;

    if (empty) {
      return (
        <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 54, marginBottom: 12 }}>🔍</Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 16,
              color: theme.text,
              textAlign: 'center',
            }}
          >
            Keine Treffer
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.textMuted,
              textAlign: 'center',
              marginTop: 6,
            }}
          >
            Probier weniger Filter oder einen anderen Tab.
          </Text>
        </View>
      );
    }

    return (
      <View
        style={{
          paddingHorizontal: 20,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        {items.map((item, index) => {
          if (forTab === 'eigen') {
            const p = item as FirestoreDocument<Produkte>;
            const disc = (p as any).discounter ? discounterMap[(p as any).discounter.id] : null;
            return (
              <View key={p.id} style={{ width: '48.5%' }}>
                <ProductCard
                  title={(p as any).name ?? ''}
                  brand={null}
                  imageUri={(p as any).bild ?? null}
                  price={(p as any).preis ?? 0}
                  stufe={parseInt((p as any).stufe) || 1}
                  marketShort={disc?.short ?? null}
                  marketColor={disc?.color ?? null}
                  variant="grid"
                  onPress={() => openProduct(p, index)}
                />
              </View>
            );
          }
          const m = item as FirestoreDocument<any>;
          const marke = markenList.find(
            (x) => x.id === ((m as any).hersteller?.id ?? (m as any).hersteller),
          )?.name;
          return (
            <View key={m.id} style={{ width: '48.5%' }}>
              <BrandCard
                title={(m as any).name ?? ''}
                brand={marke ?? ''}
                imageUri={(m as any).bild ?? null}
                price={(m as any).preis ?? 0}
                alternativeCount={(m as any).relatedProdukteIDs?.length ?? 0}
                onPress={() => openBrand(m, index)}
              />
            </View>
          );
        })}
      </View>
    );
  };

  const onPageScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      const distance = contentSize.height - contentOffset.y - layoutMeasurement.height;
      if (distance < 500 && hasMore && !isLoading) loadMore();
    },
    [hasMore, isLoading, loadMore],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <PagerView
        ref={pagerRef}
        style={{ flex: 1, paddingTop: insets.top }}
        initialPage={0}
        onPageSelected={onPageSelected}
      >
        {/* ─── Page 0 — Eigenmarken ─────────────────────────────────── */}
        <View key="eigen" style={{ flex: 1 }}>
          <ScrollView
            stickyHeaderIndices={[1]}
            onScroll={onPageScroll}
            scrollEventThrottle={200}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            {/* 0 — tabs (scrolls away with content) */}
            <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: theme.bg }}>
              <SegmentedTabs
                tabs={[
                  { key: 'eigen', label: 'Eigenmarken' },
                  { key: 'marken', label: 'Marken' },
                ] as const}
                value={tab}
                onChange={switchTab}
              />
            </View>
            {/* 1 — sticky glass header */}
            <StickyHeader forTab="eigen" />
            {/* 2 — banner ad */}
            {!isPremium ? (
              <View style={{ marginTop: 12 }}>
                <BannerAd onAdLoaded={() => {}} onAdFailedToLoad={() => {}} />
              </View>
            ) : null}
            {/* 3 — grid */}
            <View style={{ paddingTop: 12 }}>{renderGrid('eigen')}</View>
            {isLoading && currentList.length > 0 ? (
              <View style={{ paddingVertical: 24 }}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null}
          </ScrollView>
        </View>

        {/* ─── Page 1 — Marken ──────────────────────────────────────── */}
        <View key="marken" style={{ flex: 1 }}>
          <ScrollView
            stickyHeaderIndices={[1]}
            onScroll={onPageScroll}
            scrollEventThrottle={200}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, backgroundColor: theme.bg }}>
              <SegmentedTabs
                tabs={[
                  { key: 'eigen', label: 'Eigenmarken' },
                  { key: 'marken', label: 'Marken' },
                ] as const}
                value={tab}
                onChange={switchTab}
              />
            </View>
            <StickyHeader forTab="marken" />
            {!isPremium ? (
              <View style={{ marginTop: 12 }}>
                <BannerAd onAdLoaded={() => {}} onAdFailedToLoad={() => {}} />
              </View>
            ) : null}
            <View style={{ paddingTop: 12 }}>{renderGrid('marken')}</View>
            {isLoading && currentList.length > 0 ? (
              <View style={{ paddingVertical: 24 }}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null}
          </ScrollView>
        </View>
      </PagerView>

      {/* ─── Filter sheets ──────────────────────────────────────────── */}
      <FilterSheet
        visible={sheet === 'sort'}
        title={SHEET_TITLES.sort}
        onClose={() => setSheet(null)}
      >
        <OptionList
          value={sort}
          options={[
            ['name', 'Name (A–Z)'],
            ['preis', 'Preis (aufsteigend)'],
          ] as const}
          onChange={(v) => {
            setSort(v);
            setSheet(null);
          }}
        />
      </FilterSheet>

      <FilterSheet
        visible={sheet === 'markt'}
        title={SHEET_TITLES.markt}
        onClose={() => setSheet(null)}
      >
        <OptionList
          value={market}
          options={
            [
              ['all', 'Alle Märkte'],
              ...discounter.map((d) => [d.id, (d as any).name ?? ''] as const),
            ] as const
          }
          onChange={(v) => {
            setMarket(v);
            setSheet(null);
          }}
          renderLeading={(k) => {
            if (k === 'all')
              return (
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: theme.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="storefront-outline" size={18} color={theme.textMuted} />
                </View>
              );
            const d = discounter.find((x) => x.id === k);
            const bild = (d as any)?.bild as string | undefined;
            const discColor = (d as any)?.color ?? theme.surfaceAlt;
            return (
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: '#ffffff',
                  borderWidth: 1,
                  borderColor: theme.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {bild ? (
                  <Image
                    source={{ uri: bild }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                  />
                ) : (
                  <View
                    style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: discColor,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: '#ffffff' }}>
                      {((d as any)?.name?.[0] ?? '?').toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
            );
          }}
        />
      </FilterSheet>

      <FilterSheet
        visible={sheet === 'kategorie'}
        title={SHEET_TITLES.kategorie}
        onClose={() => setSheet(null)}
      >
        <OptionList
          value={cat}
          options={
            [
              ['all', 'Alle Kategorien'],
              ...kategorien.map(
                (c) =>
                  [
                    c.id,
                    `${(c as any).bezeichnung ?? (c as any).name ?? ''}${
                      (c as any).isLocked ? ' 🔒' : ''
                    }`,
                  ] as const,
              ),
            ] as const
          }
          onChange={(v) => onChangeCategory(v)}
          renderLeading={(k) => {
            if (k === 'all')
              return (
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: theme.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="shape-outline" size={18} color={theme.textMuted} />
                </View>
              );
            const c = kategorien.find((x) => x.id === k);
            const bild = (c as any)?.bild as string | undefined;
            return (
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: theme.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {bild ? (
                  <Image
                    source={{ uri: bild }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                ) : (
                  <MaterialCommunityIcons name="shape-outline" size={18} color={theme.textMuted} />
                )}
              </View>
            );
          }}
        />
      </FilterSheet>

      <FilterSheet
        visible={sheet === 'stufe'}
        title={SHEET_TITLES.stufe}
        onClose={() => setSheet(null)}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            color: theme.textMuted,
            marginBottom: 14,
          }}
        >
          Zeige nur Eigenmarken ab dieser Ähnlichkeitsstufe.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
          {[0, 1, 2, 3, 4, 5].map((n) => {
            const on = minStufe === n;
            const bg = on ? (n === 0 ? theme.text : stufen[n as 1 | 2 | 3 | 4 | 5]) : theme.surface;
            const fg = on ? (n === 3 ? theme.text : '#ffffff') : theme.text;
            return (
              <Pressable
                key={n}
                onPress={() => setMinStufe(n)}
                style={({ pressed }) => ({
                  flex: 1,
                  height: 52,
                  borderRadius: 12,
                  backgroundColor: bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.9 : 1,
                  ...shadows.sm,
                })}
              >
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 16, color: fg }}>
                  {n === 0 ? '—' : n}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={() => setSheet(null)}
          style={({ pressed }) => ({
            height: 48,
            borderRadius: 12,
            backgroundColor: brand.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: '#ffffff' }}>
            Anwenden
          </Text>
        </Pressable>
      </FilterSheet>

      <FilterSheet
        visible={sheet === 'marke'}
        title={SHEET_TITLES.marke}
        onClose={() => setSheet(null)}
      >
        <OptionList
          value={brandId}
          options={
            [
              ['all', 'Alle Marken'],
              ...markenList.map((m) => [m.id, m.name] as const),
            ] as const
          }
          onChange={(v) => {
            setBrandId(v);
            setSheet(null);
          }}
        />
      </FilterSheet>

      <FilterSheet
        visible={sheet === 'handels'}
        title={SHEET_TITLES.handels}
        onClose={() => setSheet(null)}
      >
        <OptionList
          value={handels}
          options={
            [
              ['all', 'Alle Handelsmarken'],
              ...handelsmarken.map(
                (h) => [h.id, (h as any).bezeichnung ?? (h as any).name ?? ''] as const,
              ),
            ] as const
          }
          onChange={(v) => {
            setHandels(v);
            setSheet(null);
          }}
          renderLeading={(k) => {
            if (k === 'all')
              return (
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: theme.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="tag-outline" size={18} color={theme.textMuted} />
                </View>
              );
            const h = handelsmarken.find((x) => x.id === k);
            const bild = (h as any)?.bild as string | undefined;
            return (
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  backgroundColor: '#ffffff',
                  borderWidth: 1,
                  borderColor: theme.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {bild ? (
                  <Image
                    source={{ uri: bild }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                  />
                ) : (
                  <MaterialCommunityIcons name="tag-outline" size={18} color={theme.textMuted} />
                )}
              </View>
            );
          }}
        />
      </FilterSheet>

      <FilterSheet
        visible={sheet === 'inhalt'}
        title={SHEET_TITLES.inhalt}
        onClose={() => setSheet(null)}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            color: theme.textMuted,
            marginBottom: 14,
          }}
        >
          Mehrfachauswahl möglich.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {INGREDIENTS.map((x) => {
            const on = ingredients.includes(x);
            return (
              <Pressable
                key={x}
                onPress={() => toggleIngredient(x)}
                style={({ pressed }) => ({
                  height: 38,
                  paddingHorizontal: 14,
                  borderRadius: 19,
                  backgroundColor: on ? brand.primary : theme.surface,
                  borderWidth: 1,
                  borderColor: on ? 'transparent' : theme.borderStrong,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                {on ? <MaterialCommunityIcons name="check" size={14} color="#ffffff" /> : null}
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.semibold,
                    fontSize: 13,
                    color: on ? '#ffffff' : theme.text,
                  }}
                >
                  {x}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={() => setIngredients([])}
            style={({ pressed }) => ({
              flex: 1,
              height: 48,
              borderRadius: 12,
              backgroundColor: theme.surface,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.9 : 1,
              ...shadows.sm,
            })}
          >
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: theme.text }}>
              Zurücksetzen
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSheet(null)}
            style={({ pressed }) => ({
              flex: 1,
              height: 48,
              borderRadius: 12,
              backgroundColor: brand.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: '#ffffff' }}>
              Anwenden
            </Text>
          </Pressable>
        </View>
      </FilterSheet>

      {/* ─── Locked category modal (Alkohol gating) ─────────────────── */}
      {lockedCategory ? (
        <LockedCategoryModal
          visible={!!lockedCategory}
          categoryId={lockedCategory.id}
          categoryName={(lockedCategory as any).bezeichnung ?? (lockedCategory as any).name ?? ''}
          categoryImage={(lockedCategory as any).bild}
          requiredLevel={(lockedCategory as any).requiredLevel ?? 3}
          currentLevel={(userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1}
          onClose={() => setLockedCategory(null)}
          onNavigateToLevels={() => {
            setLockedCategory(null);
            router.push('/achievements' as any);
          }}
          onUnlockSuccess={() => {
            setLockedCategory(null);
            // Re-fetch categories so the lock state updates after rewarded-ad unlock
            (async () => {
              const userLevel = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
              const cats = await categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium);
              setKategorien(cats);
            })();
          }}
        />
      ) : null}
    </View>
  );
}
