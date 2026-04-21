import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandCard } from '@/components/design/BrandCard';
import { FilterChip } from '@/components/design/FilterChip';
import { FilterSheet, OptionList } from '@/components/design/FilterSheet';
import { ProductCard } from '@/components/design/ProductCard';
import { SearchableOptionList } from '@/components/design/SearchableOptionList';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { ProductCardSkeleton } from '@/components/design/Skeletons';
import { StufenChips } from '@/components/design/StufenChips';
import { collection, getDocs } from 'firebase/firestore';

import { BannerAd } from '@/components/ads/BannerAd';
import { LockedCategoryModal } from '@/components/ui/LockedCategoryModal';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { db } from '@/lib/firebase';
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
type SheetKey = 'markt' | 'handels' | 'kategorie' | 'stufe' | 'marke' | 'sort' | null;

type SortKey = 'name' | 'preis';

const SHEET_TITLES: Record<Exclude<SheetKey, null>, string> = {
  markt: 'Markt',
  handels: 'Handelsmarke',
  kategorie: 'Kategorie',
  stufe: 'Ähnlichkeitsstufen',
  marke: 'Marke',
  sort: 'Sortieren',
};

// Country code mapping for discounter.land (German names → ISO-like 2-letter codes).
// Unknown lands fall back to the first two uppercase letters.
const LAND_TO_CODE: Record<string, string> = {
  Deutschland: 'DE',
  Österreich: 'AT',
  Schweiz: 'CH',
  Frankreich: 'FR',
  Italien: 'IT',
  Niederlande: 'NL',
  Belgien: 'BE',
  Luxemburg: 'LU',
  Polen: 'PL',
  Tschechien: 'CZ',
};
const landToCode = (land: string | undefined): string => {
  if (!land) return '??';
  return LAND_TO_CODE[land] ?? land.slice(0, 2).toUpperCase();
};

// 2-column grid math — precomputed once. 20 = horizontal padding, 12 = gap.
const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_ITEM_WIDTH = Math.floor((SCREEN_WIDTH - 20 * 2 - 12) / 2);

// Collapsible tab-bar height (12 top + 40 SegmentedTabs + 12 bottom).
const TAB_BAR_HEIGHT = 64;
// Search+filter rail height: 10 (top pad) + 38 (search) + 10 (gap) + 36 (chip row) + 10 (bottom pad).
const SEARCH_FILTER_HEIGHT = 104;

// Ähnlichkeitsstufen — label + one-line explanation used in the filter
// sheet. Labels mirror `ProductDetail` from the prototype: higher stufe
// = more similar to the brand product.
const STUFE_INFO: Record<1 | 2 | 3 | 4 | 5, { label: string; line: string }> = {
  5: { label: 'Identisch', line: 'Gleicher Hersteller, identische Rezeptur.' },
  4: { label: 'Nahezu identisch', line: 'Gleicher Hersteller, minimal abweichend.' },
  3: { label: 'Ähnlich', line: 'Gleicher Hersteller, angepasste Rezeptur.' },
  2: { label: 'Verwandt', line: 'Anderer Hersteller, vergleichbare Qualität.' },
  1: { label: 'Alternative', line: 'Alternative mit abweichender Rezeptur.' },
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

  // Reanimated shared values — per-page scroll offset so the tab-bar
  // collapse state snaps to the active page (if you scrolled down in
  // "Eigenmarken", then swipe to "Marken" at top, tabs reappear).
  const scrollYEigen = useSharedValue(0);
  const scrollYMarken = useSharedValue(0);
  const pageIndexShared = useSharedValue(0);

  // ─── UI state ──────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('eigen');
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState<string>('all');
  // Country filter inside the Markt sheet — default DE.
  const [marketCountry, setMarketCountry] = useState<string>('DE');
  const [handels, setHandels] = useState<string>('all');
  const [cat, setCat] = useState<string>('all');
  // Multi-select: empty array = all stufes, otherwise only the selected ones.
  const [stufeSelection, setStufeSelection] = useState<number[]>([]);
  const [brandId, setBrandId] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [sheet, setSheet] = useState<SheetKey>(null);

  // ─── Reference data (filters + card lookup) ───────────────────────────
  const [discounter, setDiscounter] = useState<FirestoreDocument<Discounter>[]>([]);
  const [handelsmarken, setHandelsmarken] = useState<FirestoreDocument<Handelsmarken>[]>([]);
  const [kategorien, setKategorien] = useState<FirestoreDocument<Kategorien>[]>([]);
  const [markenList, setMarkenList] = useState<Array<{ id: string; name: string }>>([]);
  // Map packungstypen doc id → `typKurz` (e.g. "g", "kg", "ml", "l", "Stk").
  const [packungstypenMap, setPackungstypenMap] = useState<Record<string, string>>({});

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
        const [ds, cats, ms, hmSnap, ptSnap] = await Promise.all([
          FirestoreService.getDiscounter(),
          categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium),
          FirestoreService.getMarken().catch(() => []),
          getDocs(collection(db, 'handelsmarken')).catch(() => null),
          getDocs(collection(db, 'packungstypen')).catch(() => null),
        ]);
        setDiscounter([...ds].sort(byName));
        setKategorien([...cats].sort(byName));
        setMarkenList(
          (ms ?? [])
            .map((m: any) => ({ id: m.id, name: m.name ?? m.bezeichnung ?? '' }))
            .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })),
        );
        if (hmSnap) {
          const hms: FirestoreDocument<Handelsmarken>[] = [];
          hmSnap.forEach((d: any) => {
            hms.push({ id: d.id, ...(d.data() as any) });
          });
          setHandelsmarken(hms.sort(byName));
        }
        if (ptSnap) {
          const ptMap: Record<string, string> = {};
          ptSnap.forEach((d: any) => {
            ptMap[d.id] = (d.data() as any).typKurz ?? (d.data() as any).typ ?? '';
          });
          setPackungstypenMap(ptMap);
        }
      } catch (e) {
        console.warn('Explore: failed to load reference data', e);
      }
    })();
  }, [userProfile, isPremium]);

  // ─── Filter-change-driven reload ───────────────────────────────────
  // First mount fires the Firestore query IMMEDIATELY (no debounce) so
  // the first batch of products can arrive in parallel with reference-
  // data loading. Subsequent changes (filter tweaks, typing in search)
  // keep the 120 ms debounce to avoid hammering the backend.
  const reloadSeq = useRef(0);
  const isFirstMount = useRef(true);
  useEffect(() => {
    const mySeq = ++reloadSeq.current;
    const delay = isFirstMount.current ? 0 : 120;
    isFirstMount.current = false;
    const fire = () => {
      if (reloadSeq.current !== mySeq) return;
      if (tab === 'eigen') loadNonames(true);
      else loadMarken(true);
    };
    if (delay === 0) {
      fire();
      return;
    }
    const t = setTimeout(fire, delay);
    return () => clearTimeout(t);
  }, [tab, query, market, handels, cat, stufeSelection, brandId, sort]);

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
      // Exact match — only the stufes the user explicitly picked. Empty = no filter.
      stufeFilters: [...stufeSelection],
      handelsmarkeFilters: handels !== 'all' ? [handels] : [],
      allergenFilters: {},
      nutritionFilters: {},
      searchQuery: query.trim() || undefined,
      sortBy: sort === 'preis' ? 'preis' : 'name',
    } as any;
  }, [cat, market, stufeSelection, handels, query, sort]);

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

  // Client-side comparator — Firestore silently disables its own orderBy
  // when complex filters are active (see firestore.ts `hasComplexFilters`),
  // so we always re-sort here to guarantee the order matches the chip.
  const productSorter = useCallback(
    (a: any, b: any) => {
      if (sort === 'preis') return (a.preis ?? 0) - (b.preis ?? 0);
      return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'de', {
        sensitivity: 'base',
      });
    },
    [sort],
  );

  // Page sizing: the first batch on a fresh reset is deliberately small
  // (6) — it matches the skeleton grid and lets Firestore round-trip
  // back 40-50 % faster. Subsequent pages jump to 12 so scrolling feels
  // dense. After the first small batch arrives we kick a background
  // prefetch of the next page, so by the time the user reaches the end
  // of row 3 the next rows are already in state.
  const FIRST_PAGE_SIZE = 6;
  const PAGE_SIZE = 12;

  const loadNonames = useCallback(
    async (reset: boolean) => {
      if (!reset && (nonameLoading || !nonameHasMore)) return;
      try {
        setNonameLoading(true);
        const size = reset ? FIRST_PAGE_SIZE : PAGE_SIZE;
        const res = await FirestoreService.getNoNameProductsPaginated(
          size,
          reset ? null : nonameLastDoc,
          buildNonameFilters() as any,
        );
        setNonames((prev) => {
          const existing = reset ? new Set<string>() : new Set(prev.map((p) => p.id));
          const incoming = (res.products as any[]).filter((p) => !existing.has(p.id));
          // Sort only on reset — on append we preserve whatever order the
          // earlier items had so their positions don't shift and the user's
          // current scroll offset stays anchored.
          if (reset) return [...incoming].sort(productSorter) as any;
          return [...prev, ...incoming] as any;
        });
        setNonameLastDoc(res.lastDoc);
        setNonameHasMore(res.hasMore);

        // After the first tiny batch lands, fire off the next page in
        // the background. The UI paints immediately with the 6 items
        // we just got; the next 12 arrive while the user is still
        // looking at row 1. No await, and we only do it on reset so
        // normal pagination continues to be user-driven.
        if (reset && res.hasMore) {
          (async () => {
            try {
              const next = await FirestoreService.getNoNameProductsPaginated(
                PAGE_SIZE,
                res.lastDoc,
                buildNonameFilters() as any,
              );
              setNonames((prev) => {
                const existing = new Set(prev.map((p: any) => p.id));
                const incoming = (next.products as any[]).filter(
                  (p) => !existing.has(p.id),
                );
                return [...prev, ...incoming] as any;
              });
              setNonameLastDoc(next.lastDoc);
              setNonameHasMore(next.hasMore);
            } catch {
              // swallow — user-triggered pagination will recover
            }
          })();
        }
      } catch (e) {
        console.warn('Explore: loadNonames failed', e);
      } finally {
        setNonameLoading(false);
      }
    },
    [nonameLoading, nonameHasMore, nonameLastDoc, buildNonameFilters, productSorter],
  );

  const loadMarken = useCallback(
    async (reset: boolean) => {
      if (!reset && (markenLoading || !markenHasMore)) return;
      try {
        setMarkenLoading(true);
        const size = reset ? FIRST_PAGE_SIZE : PAGE_SIZE;
        const res = await FirestoreService.getMarkenproduktePaginated(
          size,
          reset ? null : markenLastDoc,
          buildMarkenFilters() as any,
        );
        setMarkenprodukte((prev) => {
          const existing = reset ? new Set<string>() : new Set(prev.map((p) => p.id));
          const incoming = (res.products as any[]).filter((p) => !existing.has(p.id));
          if (reset) return [...incoming].sort(productSorter) as any;
          return [...prev, ...incoming] as any;
        });
        setMarkenLastDoc(res.lastDoc);
        setMarkenHasMore(res.hasMore);

        // Same background prefetch as for nonames.
        if (reset && res.hasMore) {
          (async () => {
            try {
              const next = await FirestoreService.getMarkenproduktePaginated(
                PAGE_SIZE,
                res.lastDoc,
                buildMarkenFilters() as any,
              );
              setMarkenprodukte((prev) => {
                const existing = new Set(prev.map((p: any) => p.id));
                const incoming = (next.products as any[]).filter(
                  (p) => !existing.has(p.id),
                );
                return [...prev, ...incoming] as any;
              });
              setMarkenLastDoc(next.lastDoc);
              setMarkenHasMore(next.hasMore);
            } catch {
              // swallow
            }
          })();
        }
      } catch (e) {
        console.warn('Explore: loadMarken failed', e);
      } finally {
        setMarkenLoading(false);
      }
    },
    [markenLoading, markenHasMore, markenLastDoc, buildMarkenFilters, productSorter],
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
    setStufeSelection([]);
    setBrandId('all');
    // Keep PagerView in sync (user tapped a tab)
    const pos = k === 'eigen' ? 0 : 1;
    pagerRef.current?.setPage(pos);
    pageIndexShared.value = pos;
  }, [pageIndexShared]);

  // When user swipes the pager, update tab state + the shared index so
  // the collapsing tab bar snaps to the new page's scroll state.
  const onPageSelected = useCallback((e: { nativeEvent: { position: number } }) => {
    const pos = e.nativeEvent.position;
    pageIndexShared.value = pos;
    const k: Tab = pos === 0 ? 'eigen' : 'marken';
    if (k !== tab) setTab(k);
  }, [tab, pageIndexShared]);

  const resetAll = useCallback(() => {
    setMarket('all');
    setHandels('all');
    setCat('all');
    setStufeSelection([]);
    setBrandId('all');
  }, []);

  const toggleStufe = useCallback((n: number) => {
    setStufeSelection((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    );
  }, []);

  const anyFilter =
    (tab === 'eigen' &&
      (market !== 'all' || handels !== 'all' || stufeSelection.length > 0)) ||
    (tab === 'marken' && brandId !== 'all') ||
    cat !== 'all';

  // Chip label: "3" when 1 selected, "3, 4" when 2-3 selected, "3 Stufen"
  // when more. Keeps the rail compact while still showing what's active.
  const stufeChipLabel = useMemo(() => {
    if (stufeSelection.length === 0) return null;
    const sorted = [...stufeSelection].sort((a, b) => b - a);
    if (sorted.length <= 3) return sorted.join(', ');
    return `${sorted.length} Stufen`;
  }, [stufeSelection]);

  // ─── Lookup maps keyed by doc id, built once per reference-data load ──
  const discounterMap = useMemo(() => {
    const m: Record<string, { color: string; short: string; bild?: string }> = {};
    discounter.forEach((d) => {
      const n = (d as any).name ?? '';
      m[d.id] = {
        color: (d as any).color ?? '#888888',
        short: n.length <= 2 ? n : n[0].toUpperCase(),
        bild: (d as any).bild,
      };
    });
    return m;
  }, [discounter]);

  const handelsmarkenMap = useMemo(() => {
    const m: Record<string, string> = {};
    handelsmarken.forEach((h) => {
      m[h.id] = (h as any).bezeichnung ?? (h as any).name ?? '';
    });
    return m;
  }, [handelsmarken]);

  const markenMap = useMemo(() => {
    const m: Record<string, string> = {};
    markenList.forEach((x) => {
      m[x.id] = x.name;
    });
    return m;
  }, [markenList]);

  // Format a German-localised pack-size label + price-per-unit helper:
  //   size=100, unit='g',   price=0.89  →  ('100g',   '8,90€/kg')
  //   size=1.5, unit='l',   price=0.55  →  ('1.5l',   '0,37€/L')
  //   size=25,  unit='Stk.',price=1.19  →  ('25 Stk.', '0,05€/Stk.')
  const formatPack = useCallback(
    (size?: number, unit?: string, price?: number) => {
      if (!size || !unit) return { sizeLabel: null as string | null, unitPriceLabel: null as string | null };
      const u = unit.toLowerCase().replace(/\.$/, ''); // strip trailing dot
      const isStk = u === 'stk' || u === 'stück';
      const sizeLabel = isStk ? `${size} ${unit}` : `${size}${unit}`;
      let unitPriceLabel: string | null = null;
      if (price && price > 0) {
        if (u === 'g') unitPriceLabel = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/kg`;
        else if (u === 'kg') unitPriceLabel = `${(price / size).toFixed(2).replace('.', ',')}€/kg`;
        else if (u === 'ml') unitPriceLabel = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/L`;
        else if (u === 'l') unitPriceLabel = `${(price / size).toFixed(2).replace('.', ',')}€/L`;
        else if (isStk) unitPriceLabel = `${(price / size).toFixed(2).replace('.', ',')}€/Stk.`;
      }
      return { sizeLabel, unitPriceLabel };
    },
    [],
  );

  // Readable value labels for chips:
  const catLabel = useMemo(() => {
    if (cat === 'all') return null;
    const k = kategorien.find((c) => c.id === cat);
    return (k as any)?.bezeichnung ?? (k as any)?.name ?? null;
  }, [cat, kategorien]);

  const marketLabel = useMemo(() => {
    if (market === 'all') return null;
    const d = discounter.find((x) => x.id === market);
    if (!d) return null;
    const name = (d as any).name ?? '';
    const code = landToCode((d as any).land);
    return `${name} (${code})`;
  }, [market, discounter]);

  // Countries present in the loaded discounter set, sorted with DE first when
  // available (default selection). Powers the Markt sheet's country tabs.
  const availableCountries = useMemo(() => {
    const codes = Array.from(
      new Set(discounter.map((d) => landToCode((d as any).land))),
    ).filter((c) => c && c !== '??');
    codes.sort((a, b) => (a === 'DE' ? -1 : b === 'DE' ? 1 : a.localeCompare(b)));
    return codes;
  }, [discounter]);

  // If the default country isn't in the loaded set, fall back to the first available.
  useEffect(() => {
    if (availableCountries.length === 0) return;
    if (!availableCountries.includes(marketCountry)) {
      setMarketCountry(availableCountries[0]);
    }
  }, [availableCountries, marketCountry]);

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
  // one page is visible at a time). Grid rendered as a flexbox wrap.
  const renderFilterRail = (forTab: Tab) => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Horizontal rails must not claim scrollsToTop — otherwise they
      // conflict with the main vertical ScrollView and iOS silently
      // disables the status-bar-tap feature for all of them.
      scrollsToTop={false}
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
            value={stufeChipLabel}
            onPress={() => setSheet('stufe')}
            onClear={stufeSelection.length > 0 ? () => setStufeSelection([]) : null}
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

  // Search + filter rail content (no wrapper — the animated absolute
  // container provides positioning/background).
  const renderSearchFilterContent = (forTab: Tab) => (
    <>
      {renderSearchInput(forTab)}
      {renderFilterRail(forTab)}
    </>
  );

  const renderGrid = (forTab: Tab) => {
    const items = forTab === 'eigen' ? nonames : markenprodukte;
    const loading = forTab === 'eigen' ? nonameLoading : markenLoading;
    const empty = !loading && items.length === 0;

    // First-load shimmer — never flash a blank screen. Six skeletons ≈ 3 rows
    // of the final grid, enough to hint at the layout on any phone.
    if (loading && items.length === 0) {
      return (
        <View
          style={{
            paddingHorizontal: 20,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={{ width: GRID_ITEM_WIDTH }}>
              <ProductCardSkeleton />
            </View>
          ))}
        </View>
      );
    }

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

    // Ad cadence: a banner is injected after every AD_EVERY items (= 10 rows
     // at 2 per row). Skipped when user is premium. Spacer View with width:'100%'
     // forces the flex-wrap row to break, keeping the grid aligned.
    const AD_EVERY = 20;
    const nodes: React.ReactNode[] = [];
    items.forEach((item, index) => {
      if (forTab === 'eigen') {
        const p = item as any;
        // `discounter` and `handelsmarke` are already populated FULL objects
        // (not refs) by the service — read their fields directly.
        const disc = p.discounter as Discounter | undefined;
        const hm = p.handelsmarke as Handelsmarken | undefined;
        const handelsmarkeName = hm?.bezeichnung ?? (hm as any)?.name ?? null;
        const packTypId = p.packTyp?.id;
        const unit = packTypId ? packungstypenMap[packTypId] : undefined;
        const { sizeLabel, unitPriceLabel } = formatPack(p.packSize, unit, p.preis);
        nodes.push(
          <View key={p.id} style={{ width: GRID_ITEM_WIDTH }}>
            <ProductCard
              title={p.name ?? ''}
              brand={handelsmarkeName ?? null}
              eyebrowLogoUri={disc?.bild ?? null}
              imageUri={p.bild ?? null}
              price={p.preis ?? 0}
              stufe={parseInt(p.stufe) || 1}
              sizeLabel={sizeLabel}
              unitPriceLabel={unitPriceLabel}
              variant="grid"
              sharedTag={`product-image-${p.id}`}
              onPress={() => openProduct(p, index)}
            />
          </View>,
        );
      } else {
        const m = item as any;
        // `hersteller` is populated full object — read .name + .bild directly.
        const marke = m.hersteller?.name ?? '';
        const brandLogoUri = m.hersteller?.bild ?? null;
        const packTypId = m.packTyp?.id;
        const unit = packTypId ? packungstypenMap[packTypId] : undefined;
        const { sizeLabel, unitPriceLabel } = formatPack(m.packSize, unit, m.preis);
        nodes.push(
          <View key={m.id} style={{ width: GRID_ITEM_WIDTH }}>
            <BrandCard
              title={m.name ?? ''}
              brand={marke}
              brandLogoUri={brandLogoUri}
              imageUri={m.bild ?? null}
              price={m.preis ?? 0}
              sizeLabel={sizeLabel}
              unitPriceLabel={unitPriceLabel}
              alternativeCount={m.relatedProdukteIDs?.length ?? 0}
              sharedTag={`product-image-${m.id}`}
              onPress={() => openBrand(m, index)}
            />
          </View>,
        );
      }
      // Insert a banner row after every AD_EVERY products. Reserve a fixed
      // 70-px slot regardless of whether the ad fills — otherwise a no-fill
      // collapses the slot to 0 and everything below jumps up during scroll.
      if (
        !isPremium &&
        (index + 1) % AD_EVERY === 0 &&
        index < items.length - 1
      ) {
        nodes.push(
          <View
            key={`ad-${index}`}
            style={{
              width: '100%',
              height: 70,
              marginTop: 4,
              marginBottom: 4,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <BannerAd onAdLoaded={() => {}} onAdFailedToLoad={() => {}} />
          </View>,
        );
      }
    });

    return (
      <View
        style={{
          paddingHorizontal: 20,
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        {nodes}
      </View>
    );
  };

  // JS-side loadMore helpers — called from the worklet via runOnJS when
  // the user reaches near the bottom of either list.
  const checkLoadMoreEigen = useCallback(() => {
    if (nonameHasMore && !nonameLoading) loadNonames(false);
  }, [nonameHasMore, nonameLoading, loadNonames]);
  const checkLoadMoreMarken = useCallback(() => {
    if (markenHasMore && !markenLoading) loadMarken(false);
  }, [markenHasMore, markenLoading, loadMarken]);

  // Animated scroll handlers drive both the per-page scroll shared value
  // (→ powers the tab-bar collapse animation on the UI thread) and the
  // infinite-scroll trigger (JS thread).
  const scrollHandlerEigen = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollYEigen.value = e.contentOffset.y;
      const dist =
        e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height;
      if (dist < 500) runOnJS(checkLoadMoreEigen)();
    },
  });
  const scrollHandlerMarken = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollYMarken.value = e.contentOffset.y;
      const dist =
        e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height;
      if (dist < 500) runOnJS(checkLoadMoreMarken)();
    },
  });

  // Collapsing tab-bar style. Reads the scroll offset of the currently
  // active page (tracked via `pageIndexShared`). Clamped so the tab-bar
  // can't translate past its own height.
  const tabsAnimStyle = useAnimatedStyle(() => {
    const active =
      pageIndexShared.value === 0 ? scrollYEigen.value : scrollYMarken.value;
    const translateY = interpolate(
      active,
      [0, TAB_BAR_HEIGHT],
      [0, -TAB_BAR_HEIGHT],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      active,
      [0, TAB_BAR_HEIGHT * 0.8],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return {
      transform: [{ translateY }],
      opacity,
    };
  });

  // Search + filter rail — absolute, translates up with scroll so it
  // slides up into the space vacated by the collapsing tabs and then
  // "pins" just below the status bar. No RN sticky-header needed — the
  // translate is driven by the same scroll shared value as the tabs, so
  // the two move in lock-step.
  const searchFilterAnimStyle = useAnimatedStyle(() => {
    const active =
      pageIndexShared.value === 0 ? scrollYEigen.value : scrollYMarken.value;
    const translateY = interpolate(
      active,
      [0, TAB_BAR_HEIGHT],
      [0, -TAB_BAR_HEIGHT],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY }] };
  });

  // iOS blur strip shrinks with scroll. Full height when tabs are
  // visible (covers status bar + tabs + search rail), clips down to
  // just status bar + search rail once tabs have collapsed.
  const blurAnimStyle = useAnimatedStyle(() => {
    const active =
      pageIndexShared.value === 0 ? scrollYEigen.value : scrollYMarken.value;
    const height = interpolate(
      active,
      [0, TAB_BAR_HEIGHT],
      [
        insets.top + TAB_BAR_HEIGHT + SEARCH_FILTER_HEIGHT,
        insets.top + SEARCH_FILTER_HEIGHT,
      ],
      Extrapolation.CLAMP,
    );
    return { height };
  });

  // Android uses a flat tinted View instead of BlurView; same shrink
  // behaviour so the chrome stays coherent across platforms.
  const androidChromeAnimStyle = useAnimatedStyle(() => {
    const active =
      pageIndexShared.value === 0 ? scrollYEigen.value : scrollYMarken.value;
    const height = interpolate(
      active,
      [0, TAB_BAR_HEIGHT],
      [
        insets.top + TAB_BAR_HEIGHT + SEARCH_FILTER_HEIGHT,
        insets.top + SEARCH_FILTER_HEIGHT,
      ],
      Extrapolation.CLAMP,
    );
    return { height };
  });

  // Hairline separator at the bottom edge of the chrome — translates
  // as the chrome shrinks so it sits flush with the visible edge.
  const chromeBorderAnimStyle = useAnimatedStyle(() => {
    const active =
      pageIndexShared.value === 0 ? scrollYEigen.value : scrollYMarken.value;
    const h = interpolate(
      active,
      [0, TAB_BAR_HEIGHT],
      [
        insets.top + TAB_BAR_HEIGHT + SEARCH_FILTER_HEIGHT,
        insets.top + SEARCH_FILTER_HEIGHT,
      ],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY: h - 1 }] };
  });

  const chromeTotalHeight = insets.top + TAB_BAR_HEIGHT + SEARCH_FILTER_HEIGHT;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        initialPage={0}
        onPageSelected={onPageSelected}
      >
        {/* ─── Page 0 — Eigenmarken ─────────────────────────────────── */}
        {/* scrollsToTop must only be true on the ACTIVE page. When both
            mounted ScrollViews claim it, iOS silently disables the
            status-bar-tap scroll-to-top for all of them (documented
            UIScrollView behaviour when multiple responders exist). */}
        <View key="eigen" style={{ flex: 1 }}>
          <Animated.ScrollView
            onScroll={scrollHandlerEigen}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            scrollsToTop={tab === 'eigen'}
            contentContainerStyle={{
              paddingTop: chromeTotalHeight,
              paddingBottom: 120,
            }}
          >
            {!isPremium ? (
              <View
                style={{
                  marginTop: 12,
                  height: 70,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <BannerAd onAdLoaded={() => {}} onAdFailedToLoad={() => {}} />
              </View>
            ) : null}
            <View style={{ paddingTop: 12 }}>{renderGrid('eigen')}</View>
            {isLoading && currentList.length > 0 ? (
              <View style={{ paddingVertical: 24 }}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null}
          </Animated.ScrollView>
        </View>

        {/* ─── Page 1 — Marken ──────────────────────────────────────── */}
        <View key="marken" style={{ flex: 1 }}>
          <Animated.ScrollView
            onScroll={scrollHandlerMarken}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            scrollsToTop={tab === 'marken'}
            contentContainerStyle={{
              paddingTop: chromeTotalHeight,
              paddingBottom: 120,
            }}
          >
            {!isPremium ? (
              <View
                style={{
                  marginTop: 12,
                  height: 70,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <BannerAd onAdLoaded={() => {}} onAdFailedToLoad={() => {}} />
              </View>
            ) : null}
            <View style={{ paddingTop: 12 }}>{renderGrid('marken')}</View>
            {isLoading && currentList.length > 0 ? (
              <View style={{ paddingVertical: 24 }}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : null}
          </Animated.ScrollView>
        </View>
      </PagerView>

      {/* ─── Top chrome (absolute, content scrolls under it) ────────
          Structure:
            • iOS: one BlurView spanning status bar + tabs + search/filter
              rail. Height animates from full to (no tabs) as user scrolls.
            • Android: tinted opaque strip with same shrink behaviour.
            • Tabs: absolute at insets.top, translate up + fade on scroll.
            • Search/filter rail: absolute at insets.top+TAB_BAR_HEIGHT,
              translates up in lock-step with tabs so it settles right
              below the status bar once tabs have collapsed.
          No RN sticky-header — both moving pieces are driven directly
          from the scroll shared value, which dodges the "sticky pins at
          viewport y=0 / under the blur" problem entirely. */}
      {Platform.OS === 'ios' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 9,
            },
            blurAnimStyle,
          ]}
        >
          <BlurView
            tint={scheme === 'dark' ? 'dark' : 'light'}
            intensity={80}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              backgroundColor: theme.bg,
              zIndex: 9,
            },
            androidChromeAnimStyle,
          ]}
        />
      )}

      {/* Search + filter rail — absolute, slides up with the tabs. */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            top: insets.top + TAB_BAR_HEIGHT,
            left: 0,
            right: 0,
            height: SEARCH_FILTER_HEIGHT,
            zIndex: 10,
          },
          searchFilterAnimStyle,
        ]}
      >
        {renderSearchFilterContent(tab)}
      </Animated.View>

      {/* Collapsible SegmentedTabs — absolute so it overlays the pager
          without pushing content; animates translateY + opacity as the
          active page scrolls. */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            top: insets.top,
            left: 0,
            right: 0,
            height: TAB_BAR_HEIGHT,
            paddingTop: 12,
            paddingBottom: 12,
            paddingHorizontal: 20,
            backgroundColor: 'transparent',
            zIndex: 11,
          },
          tabsAnimStyle,
        ]}
      >
        <SegmentedTabs
          tabs={[
            { key: 'eigen', label: 'Eigenmarken' },
            { key: 'marken', label: 'Marken' },
          ] as const}
          value={tab}
          onChange={switchTab}
        />
      </Animated.View>

      {/* Hairline separator at the very bottom of the chrome — follows
          the shrinking blur so it sits right below whatever chrome is
          currently visible. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: 1,
            backgroundColor: theme.border,
            zIndex: 12,
          },
          chromeBorderAnimStyle,
        ]}
      />

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
        {/* Country segmented control — filters the market list below */}
        {availableCountries.length > 1 ? (
          <View style={{ marginBottom: 12 }}>
            <SegmentedTabs
              tabs={availableCountries.map((c) => ({ key: c, label: c })) as any}
              value={marketCountry}
              onChange={(v) => setMarketCountry(v)}
            />
          </View>
        ) : null}
        <OptionList
          value={market}
          options={
            [
              ['all', `Alle Märkte (${marketCountry})`] as const,
              ...discounter
                .filter((d) => landToCode((d as any).land) === marketCountry)
                .map(
                  (d) =>
                    [
                      d.id,
                      `${(d as any).name ?? ''} (${landToCode((d as any).land)})`,
                    ] as const,
                ),
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
        title="Ähnlichkeitsstufen"
        onClose={() => setSheet(null)}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            lineHeight: 18,
            color: theme.textMuted,
            marginBottom: 14,
          }}
        >
          Die Skala siehst du auf jeder Produktkarte. Je mehr Segmente gefüllt
          sind, desto näher liegt das Eigenmarken-Produkt am Markenoriginal.
          Wähle aus, welche Stufen angezeigt werden sollen.
        </Text>

        <View style={{ gap: 8, marginBottom: 18 }}>
          {([5, 4, 3, 2, 1] as const).map((n) => {
            const selected = stufeSelection.includes(n);
            const info = STUFE_INFO[n];
            const tint = stufen[n];
            return (
              <Pressable
                key={n}
                onPress={() => toggleStufe(n)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: selected ? tint : theme.border,
                  backgroundColor: selected
                    ? theme.surface
                    : theme.surfaceAlt,
                  opacity: pressed ? 0.88 : 1,
                })}
              >
                {/* Same StufenChips pattern as on ProductCard — instant
                    visual connection to what users see in the grid. */}
                <View style={{ width: 48, alignItems: 'flex-start' }}>
                  <StufenChips stufe={n} size="lg" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 14,
                      color: theme.text,
                    }}
                  >
                    Stufe {n} · {info.label}
                  </Text>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.regular,
                      fontSize: 12,
                      lineHeight: 16,
                      color: theme.textMuted,
                      marginTop: 2,
                    }}
                    numberOfLines={2}
                  >
                    {info.line}
                  </Text>
                </View>
                {/* Checkbox indicator — matches OptionList styling */}
                {selected ? (
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={22}
                    color={tint}
                  />
                ) : (
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 1.5,
                      borderColor: theme.borderStrong,
                    }}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Trailing whitespace to breathe — no Anwenden button; changes
            apply on toggle and commit on swipe-down dismissal. */}
        <View style={{ height: 8 }} />
      </FilterSheet>

      <FilterSheet
        visible={sheet === 'marke'}
        title={SHEET_TITLES.marke}
        onClose={() => setSheet(null)}
      >
        <SearchableOptionList
          placeholder="Marke suchen …"
          value={brandId}
          allOption={['all', 'Alle Marken']}
          options={markenList.map((m) => [m.id, m.name] as const)}
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
        <SearchableOptionList
          placeholder="Handelsmarke suchen …"
          value={handels}
          allOption={['all', 'Alle Handelsmarken']}
          options={handelsmarken.map(
            (h) => [h.id, (h as any).bezeichnung ?? (h as any).name ?? ''] as const,
          )}
          onChange={(v) => {
            setHandels(v);
            setSheet(null);
          }}
        />
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
