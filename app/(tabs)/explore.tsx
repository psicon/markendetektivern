import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { Crossfade, ProductCardSkeleton } from '@/components/design/Skeletons';
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
import {
  AlgoliaService,
  type AlgoliaSearchResult,
} from '@/lib/services/algolia';
import { ExtendedMarkenproduktFilters, ExtendedNoNameFilters } from '@/lib/types/filters';
import { getProductImage } from '@/lib/utils/productImage';
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

type Tab = 'alle' | 'eigen' | 'marken';

// PagerView page indices mirror the visual order in SegmentedTabs
// (Alle → Eigenmarken → Marken). Swiping LEFT goes to a smaller
// index (= visually left tab), swiping RIGHT goes to a larger index
// (= visually right tab). Eigenmarken sits at index 1 — the default
// landing page when Stöbern opens fresh.
const TAB_AT_PAGE: Record<number, Tab> = {
  0: 'alle',
  1: 'eigen',
  2: 'marken',
};
const PAGE_AT_TAB: Record<Tab, number> = {
  alle: 0,
  eigen: 1,
  marken: 2,
};
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

// Load-More-Footer: zwei Skelett-Karten in derselben Grid-Form wie die
// echten Karten oben dran. Ersetzt den vorherigen ActivityIndicator-
// Spinner — der war ein visueller Bruch mitten in der Karten-Liste
// ("Bilder, Bilder, Spinner, Bilder"). Skelett-Karten lesen sich als
// "die nächste Reihe wird gerade geladen", sind also ein nahtloser
// Übergang. Sobald die echten Karten reinkommen, ersetzt der Render
// diese Skelette.
function LoadMoreSkeletonRow({ itemWidth }: { itemWidth: number }) {
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 24,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      {[0, 1].map((i) => (
        <View key={i} style={{ width: itemWidth }}>
          <ProductCardSkeleton />
        </View>
      ))}
    </View>
  );
}

// Collapsible tab-bar height (12 top + 40 SegmentedTabs + 12 bottom).
const TAB_BAR_HEIGHT = 64;
// Search+filter rail height: 10 (top pad) + 38 (search) + 10 (gap) + 36 (chip row) + 10 (bottom pad).
const SEARCH_FILTER_HEIGHT = 104;

// Ähnlichkeitsstufen — Titel + Kurzbeschreibung für den Filter-Row.
// Die volle, mehrzeilige Erklärung lebt in
// `components/ui/SimilarityStagesModal.tsx` (Profil → Ähnlichkeits-
// stufen). Hier in Stöbern brauchen wir kompakte Einzeiler, damit die
// Filter-Liste (5 Reihen) auf einen Blick scanbar bleibt und nicht in
// einen halben Bildschirm Lauftext kippt. Wortlaut und Reihenfolge
// sind aber inhaltlich kongruent zum Modal — wenn die Modal-
// Beschreibung sich substantiell ändert, hier mitziehen.
const STUFE_INFO: Record<1 | 2 | 3 | 4 | 5, { label: string; line: string }> = {
  5: {
    label: 'Identisch',
    line: 'Gleicher Hersteller, praktisch identische Rezeptur.',
  },
  4: {
    label: 'Sehr ähnlich',
    line: 'Gleicher Hersteller, minimale Rezeptur-Unterschiede.',
  },
  3: {
    label: 'Vergleichbar',
    line: 'Gleicher Hersteller, andere Zutaten oder Nährwerte.',
  },
  2: {
    label: 'Markenhersteller',
    line: 'Liefert auch Marken — aber kein vergleichbares Produkt.',
  },
  1: {
    label: 'NoName-Hersteller',
    line: 'Produziert ausschließlich Handelsmarken.',
  },
};

// ────────────────────────────────────────────────────────────────────────
// Module-level cache for the "defaults" view of Stöbern (no filters, no
// search, default sort). When the user lands on Stöbern a second time
// in the same session, we seed state from this cache so the products
// render instantly; the reload effect then refreshes in the
// background. Cache stores only the first page (what the user sees
// first), to keep memory bounded and state re-hydration cheap.
type CachedPage = { items: any[]; lastDoc: any; hasMore: boolean };
let cachedEigen: CachedPage | null = null;
let cachedMarken: CachedPage | null = null;

export default function ExploreScreen() {
  const { theme, brand, shadows, stufen } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    tab?: string;
    categoryFilter?: string;
    markeFilter?: string;
    query?: string;
  }>();
  // Initial-Query aus den Route-Params. Wenn von Home aus mit
  // `?query=...&tab=alle` aufgerufen, ist das DER Wert mit dem
  // Stöbern beim Mount sofort starten soll — kein "erst Browse-Mode
  // Flash dann Search-Mode Switch", sondern direkt im Search-Mode.
  const initialQuery =
    typeof params.query === 'string' && params.query.trim().length > 0
      ? params.query.trim()
      : '';
  const hasInitialQuery = initialQuery.length > 0;
  const { userProfile } = useAuth();
  const { isPremium } = useRevenueCat();
  const analytics = useAnalytics();

  // PagerView for native horizontal tab swipe
  const pagerRef = useRef<PagerView | null>(null);
  // Ref to the search TextInput so the active-search chip's tap can
  // refocus the input (lets the user immediately tweak their query
  // instead of clearing-then-retyping).
  const searchInputRef = useRef<TextInput | null>(null);

  // Reanimated shared values — per-page scroll offset so the tab-bar
  // collapse state snaps to the active page (if you scrolled down in
  // "Eigenmarken", then swipe to "Marken" at top, tabs reappear).
  const scrollYEigen = useSharedValue(0);
  const scrollYMarken = useSharedValue(0);
  // Shared value for the merged "Alle"-tab scroll position. Drives
  // the chrome-collapse animation when the user is on the Alle page,
  // same as the per-collection ones above.
  const scrollYAlle = useSharedValue(0);
  const pageIndexShared = useSharedValue(0);

  // ─── UI state ──────────────────────────────────────────────────────────
  //
  // Initial-Tab + Initial-Query werden LAZY aus den Route-Params
  // gelesen (nicht via useEffect später nachgeschoben). Damit:
  //   • erste Render-Frame zeigt schon die Alle-Tab als aktiv (kein
  //     Tab-Swipe-Animation von Eigenmarken auf Alle)
  //   • PagerView's initialPage matcht den Tab-State (kein Mount-
  //     Sprung)
  //   • search-mode UI (Active-Query-Chip, Search-Mode Render) ist
  //     ab Frame 1 da — kein Flash von Browse-Mode-Inhalten
  const [tab, setTab] = useState<Tab>(() => {
    if (hasInitialQuery) return 'alle';
    if (params.tab === 'alle') return 'alle';
    if (params.tab === 'markenprodukte') return 'marken';
    return 'eigen';
  });
  const [query, setQuery] = useState(initialQuery);
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
  // Initial state is hydrated from the module-level cache: if the user
  // already visited Stöbern in this session, they see the cards
  // immediately on re-entry instead of a fresh skeleton pass. The
  // reload effect still fires and replaces the data with a fresh
  // response in the background.
  const [nonames, setNonames] = useState<FirestoreDocument<Produkte>[]>(
    () => (cachedEigen?.items as any) ?? [],
  );
  const [nonameLoading, setNonameLoading] = useState(!cachedEigen);
  const [nonameLastDoc, setNonameLastDoc] = useState<any>(cachedEigen?.lastDoc ?? null);
  const [nonameHasMore, setNonameHasMore] = useState(cachedEigen?.hasMore ?? true);

  const [markenprodukte, setMarkenprodukte] = useState<FirestoreDocument<any>[]>(
    () => (cachedMarken?.items as any) ?? [],
  );
  // Start in loading state (unless we have a cache to seed from) so
  // the Marken tab shows the skeleton grid instead of the "Keine
  // Treffer" lupe flash while its first query is in flight.
  const [markenLoading, setMarkenLoading] = useState(!cachedMarken);
  const [markenLastDoc, setMarkenLastDoc] = useState<any>(cachedMarken?.lastDoc ?? null);
  const [markenHasMore, setMarkenHasMore] = useState(cachedMarken?.hasMore ?? true);

  // ─── In-place Algolia search state ─────────────────────────────────────
  // Stöbern owns the canonical search experience — when the user
  // submits a query, we fire ONE Algolia call and overlay its hits
  // on top of the browse list (per tab). Browse state stays
  // untouched so clearing the search snaps back instantly.
  //
  // Costs: one `AlgoliaService.searchAll` call per submit (cached
  // 24 h via the module-scope LRU in `algolia.ts`), plus 30
  // Firestore reads to enrich hits with `bildClean*` + `packTypInfo`
  // (which the Algolia index doesn't carry). The enrichment uses
  // `getProductWithDetails` / `getMarkenProduktWithDetails` which
  // already memoise + dedupe inflight, so subsequent renders /
  // tab-switches reuse the cached resolutions.
  // searchActiveQuery wird ebenfalls lazy aus den Params gesetzt —
  // damit der erste Frame schon im Search-Modus ist (Active-Query-
  // Chip im Filter-Rail sichtbar, Render-Pfad wählt searchHits...
  // statt browse).
  const [searchActiveQuery, setSearchActiveQuery] = useState<string | null>(
    hasInitialQuery ? initialQuery : null,
  );
  const [searchHitsEigen, setSearchHitsEigen] = useState<AlgoliaSearchResult[]>([]);
  const [searchHitsMarken, setSearchHitsMarken] = useState<AlgoliaSearchResult[]>([]);
  const [searchTotalEigen, setSearchTotalEigen] = useState(0);
  const [searchTotalMarken, setSearchTotalMarken] = useState(0);
  // searchLoading initial true wenn wir mit Query mounten — der
  // erste Frame zeigt dann sofort den Skeleton-Grid (statt eines
  // Browse-Mode "Keine Treffer"-Flashes oder leeren Frames).
  const [searchLoading, setSearchLoading] = useState(hasInitialQuery);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  // Algolia pages already fetched per index, used to derive the
  // next page number on infinite-scroll. Reset on every fresh
  // submit. Each index paginates independently.
  const [searchPageEigen, setSearchPageEigen] = useState(0);
  const [searchPageMarken, setSearchPageMarken] = useState(0);
  // Algolia queryIDs — opaque tokens that bind a click event to its
  // originating search. Required by `AlgoliaService.trackClickAfterSearch`
  // for Insights / Learning-to-Rank. Updated on each search submit
  // AND on each pagination call (each Algolia request returns its own
  // queryID; for tracking we use the one from the page that produced
  // the clicked hit, but in practice using the most-recent works fine
  // because Insights groups by user+query+session anyway).
  const [searchQueryIdEigen, setSearchQueryIdEigen] = useState<string | undefined>(undefined);
  const [searchQueryIdMarken, setSearchQueryIdMarken] = useState<string | undefined>(undefined);

  // ─── Locked category gate (Alkohol) ────────────────────────────────────
  const [lockedCategory, setLockedCategory] = useState<FirestoreDocument<Kategorien> | null>(null);

  // ─── Route param handling (from Home quick-access) ─────────────────────
  useEffect(() => {
    // Initial-Tab + Initial-Query sind bereits im useState-Initializer
    // gesetzt (siehe oben) — wir müssen hier KEINE goTo-RAF mehr feuern,
    // PagerView mountet schon auf der richtigen Page und der State ist
    // synchron. Was DIESER Effect noch macht:
    //
    //   • Wenn Stöbern bereits gemounted ist und der User über eine
    //     externe Quelle (z.B. History) erneut mit anderem Param
    //     reinkommt, sollten Tab + Query updaten. Daher der Tab-
    //     Sync via setPage hier (re-mount-fall).
    //   • runSearch ausführen — der eigentliche Algolia-Call. Auf
    //     dem Initial-Mount mit Pre-Fetch (Home → searchAll fired
    //     fire-and-forget) hängt sich runSearch via inflight-cache
    //     an die laufende Promise statt einen zweiten Roundtrip zu
    //     schicken.
    //
    // Tab-Mapping nur wenn Param explizit anders als der schon
    // gesetzte Tab.
    let nextTab: Tab | null = null;
    if (params.tab === 'nonames') nextTab = 'eigen';
    else if (params.tab === 'markenprodukte') nextTab = 'marken';
    else if (params.tab === 'alle') nextTab = 'alle';
    if (typeof params.query === 'string' && params.query.trim()) nextTab = 'alle';

    if (nextTab && nextTab !== tab) {
      setTab(nextTab);
      const targetPage = PAGE_AT_TAB[nextTab];
      requestAnimationFrame(() => {
        pagerRef.current?.setPage(targetPage);
      });
    }

    if (typeof params.query === 'string' && params.query.trim()) {
      const q = params.query.trim();
      if (q !== query) setQuery(q);
      void runSearch(q);
    }
    if (params.categoryFilter) setCat(String(params.categoryFilter));
    if (params.markeFilter) setBrandId(String(params.markeFilter));
    // `runSearch` + `tab` + `query` intentionally NOT in deps — wir
    // wollen exakt einmal pro Route-Param-Änderung feuern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tab, params.categoryFilter, params.markeFilter, params.query]);

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
        // Mount-Time: nur die schlanken Reference-Daten, die für die
        // Produkt-Cards selbst nötig sind (Discounter-Logos, Pack-
        // typen-Label, Kategorie-Chip). Die TEUERSTE Reference-Query
        // (`getMarken()` ~ 968 Docs) wird nicht mehr hier gefeuert,
        // sondern erst wenn der User das Marken-Filter-Sheet öffnet
        // — siehe lazy-load useEffect direkt unter diesem.
        // Spart bei ~30k DAU × 2 Cold Starts × 968 Reads ≈ 1,7 Mrd
        // Reads/Monat → ~1.000 €/Monat bei 100k MAU.
        const [ds, cats, hmSnap, ptSnap] = await Promise.all([
          FirestoreService.getDiscounter(),
          categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium),
          getDocs(collection(db, 'handelsmarken')).catch(() => null),
          getDocs(collection(db, 'packungstypen')).catch(() => null),
        ]);
        setDiscounter([...ds].sort(byName));
        setKategorien([...cats].sort(byName));
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

  // Marken-Liste lazy laden — erst wenn der User den Marken-Filter
  // aufmacht, NICHT beim Mount. Die Liste hat ~968 Einträge und ist
  // die teuerste einzelne Read-Operation der App. Service-seitig
  // 30-Min Session-Cache → zweites Sheet-Open kostet 0 Reads.
  // markenListLoaded merkt sich, ob wir's schon geladen haben in
  // dieser useEffect-Lebenszeit.
  const markenListLoaded = useRef(false);
  useEffect(() => {
    if (sheet !== 'marke') return;
    if (markenListLoaded.current) return;
    markenListLoaded.current = true;
    const byName = (a: any, b: any) =>
      String(a.name ?? a.bezeichnung ?? '').localeCompare(
        String(b.name ?? b.bezeichnung ?? ''),
        'de',
        { sensitivity: 'base' },
      );
    (async () => {
      try {
        const ms = await FirestoreService.getMarken();
        setMarkenList(
          (ms ?? [])
            .map((m: any) => ({ id: m.id, name: m.name ?? m.bezeichnung ?? '' }))
            .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })),
        );
      } catch (e) {
        console.warn('Explore: failed to load Marken-Liste lazy', e);
      }
    })();
    // byName ist stable, kein dep nötig — eslint-disable-next-line
  }, [sheet]);

  // ─── Filter-change-driven reload ───────────────────────────────────
  // First mount fires BOTH lists in parallel (no debounce) so the
  // Marken tab has data ready by the time the user swipes over — no
  // more lupe flash. Subsequent filter / search changes fire only
  // the active tab's query, with a 120 ms debounce so typing in the
  // search field doesn't hammer the backend.
  const reloadSeq = useRef(0);
  const isFirstMount = useRef(true);
  useEffect(() => {
    const mySeq = ++reloadSeq.current;
    const wasFirst = isFirstMount.current;
    const delay = wasFirst ? 0 : 120;
    isFirstMount.current = false;
    const fire = () => {
      if (reloadSeq.current !== mySeq) return;
      if (wasFirst) {
        // Warm both tabs' first pages concurrently.
        if (!cachedEigen) loadNonames(true);
        if (!cachedMarken) loadMarken(true);
      } else if (tab === 'alle') {
        // 'Alle' merges both lists — refresh both.
        loadNonames(true);
        loadMarken(true);
      } else if (tab === 'eigen') {
        loadNonames(true);
      } else {
        loadMarken(true);
      }
    };
    if (delay === 0) {
      fire();
      return;
    }
    const t = setTimeout(fire, delay);
    return () => clearTimeout(t);
    // `query` intentionally NOT in the deps — Stöbern's search input is
    // a launcher into `/search-results` on submit, NOT an on-the-fly
    // Firestore filter. Putting it back in here would re-read the
    // collection on every keystroke for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, market, handels, cat, stufeSelection, brandId, sort]);

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
  // `searchQuery` intentionally NOT included — Stöbern is browse-only.
  // Real text search runs on `/search-results` (Algolia, designed for
  // it). Firestore can't do full-text search natively and prefix-match
  // alone produces confusing partial results, so the field exists in
  // the chrome only as a launcher to the search page (see
  // `submitSearch`).
  const buildNonameFilters = useCallback((): ExtendedNoNameFilters => {
    return {
      categoryFilters: cat !== 'all' ? [cat] : [],
      discounterFilters: market !== 'all' ? [market] : [],
      // Exact match — only the stufes the user explicitly picked. Empty = no filter.
      stufeFilters: [...stufeSelection],
      handelsmarkeFilters: handels !== 'all' ? [handels] : [],
      allergenFilters: {},
      nutritionFilters: {},
      sortBy: sort === 'preis' ? 'preis' : 'name',
    } as any;
  }, [cat, market, stufeSelection, handels, sort]);

  const buildMarkenFilters = useCallback((): ExtendedMarkenproduktFilters => {
    return {
      categoryFilters: cat !== 'all' ? [cat] : [],
      herstellerFilters: brandId !== 'all' ? [brandId] : [],
      allergenFilters: {},
      nutritionFilters: {},
      sortBy: sort === 'preis' ? 'preis' : 'name',
    } as any;
  }, [cat, brandId, sort]);

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

  // "Are we viewing the unfiltered default list?" — only THEN is it
  // safe to seed the module-level cache with what we see, because any
  // other Stöbern visit with those same defaults will see the same
  // results. Typing in the search or applying a filter would produce
  // a different slice that shouldn't be cached as the landing state.
  const isDefaultFilters = useCallback(
    () =>
      !query.trim() &&
      market === 'all' &&
      handels === 'all' &&
      cat === 'all' &&
      stufeSelection.length === 0 &&
      brandId === 'all' &&
      sort === 'name',
    [query, market, handels, cat, stufeSelection, brandId, sort],
  );

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
          const next = reset
            ? ([...incoming].sort(productSorter) as any)
            : ([...prev, ...incoming] as any);
          // Seed the module-level cache so a later Stöbern remount
          // lands on this state instantly. Only do it for default
          // filters (see isDefaultFilters comment).
          if (reset && isDefaultFilters()) {
            cachedEigen = { items: next, lastDoc: res.lastDoc, hasMore: res.hasMore };
          }
          return next;
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
          const next = reset
            ? ([...incoming].sort(productSorter) as any)
            : ([...prev, ...incoming] as any);
          if (reset && isDefaultFilters()) {
            cachedMarken = { items: next, lastDoc: res.lastDoc, hasMore: res.hasMore };
          }
          return next;
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
    // 'alle' tab pulls from BOTH collections, so we trigger both
    // pagination loaders. Each side is no-op if its list is already
    // exhausted (`!hasMore`) so the duplicate call is free.
    if (tab === 'alle') {
      loadNonames(false);
      loadMarken(false);
      return;
    }
    if (tab === 'eigen') loadNonames(false);
    else loadMarken(false);
  }, [tab, loadNonames, loadMarken]);

  // Map a Tab key to the analytics source-screen name used by
  // `trackTabSwitched`. Centralised so the three call sites stay in
  // sync as we add tabs.
  const analyticsSource = (k: Tab): string =>
    k === 'eigen'
      ? 'explore_nonames'
      : k === 'marken'
        ? 'explore_markenprodukte'
        : 'explore_alle';

  // ─── Helpers ───────────────────────────────────────────────────────────
  const switchTab = useCallback((k: Tab) => {
    // 📊 Analytics — tab-switched event (matches OLD behaviour). Only
    // fires when the user actually changes tabs, not on initial mount.
    if (analytics?.trackTabSwitched && k !== tab) {
      analytics.trackTabSwitched(
        analyticsSource(tab),
        analyticsSource(k),
      );
    }
    setTab(k);
    setMarket('all');
    setHandels('all');
    setStufeSelection([]);
    setBrandId('all');
    // Keep PagerView in sync (user tapped a tab). PAGE_AT_TAB
    // returns 0 for eigen, 1 for marken, 2 for alle — the same
    // physical order pages were declared in the JSX below.
    const pos = PAGE_AT_TAB[k];
    pagerRef.current?.setPage(pos);
    pageIndexShared.value = pos;
  }, [pageIndexShared, analytics, tab]);

  // When user swipes the pager, update tab state + the shared index so
  // the collapsing tab bar snaps to the new page's scroll state.
  const onPageSelected = useCallback((e: { nativeEvent: { position: number } }) => {
    const pos = e.nativeEvent.position;
    pageIndexShared.value = pos;
    const k: Tab = TAB_AT_PAGE[pos] ?? 'eigen';
    if (k !== tab) setTab(k);
  }, [tab, pageIndexShared]);

  const resetAll = useCallback(() => {
    // 📊 Analytics — fire BEFORE state resets, so the change-detection
    // useEffect below doesn't double-track each cleared filter.
    if (analytics?.trackFilterCleared) {
      analytics.trackFilterCleared();
    }
    setMarket('all');
    setHandels('all');
    setCat('all');
    setStufeSelection([]);
    setBrandId('all');
  }, [analytics]);

  // 📊 Analytics — change-detection: when any filter state flips,
  // emit a `trackFilterChanged` event tagged with the source-tab.
  // The OLD code peppered ~14 trackFilterChanged calls across each
  // filter-handler; we centralise here for maintenance simplicity.
  // The ref skips the very first render (avoids "added" events on
  // mount when state is initialised to defaults).
  const lastFiltersRef = useRef<{ market: string; handels: string; cat: string; brandId: string; stufe: number[]; tab: Tab } | null>(null);
  useEffect(() => {
    const cur = { market, handels, cat, brandId, stufe: stufeSelection, tab };
    const prev = lastFiltersRef.current;
    lastFiltersRef.current = cur;
    if (!prev || !analytics?.trackFilterChanged) return;

    const source = tab === 'eigen' ? 'explore_nonames' : 'explore_markenprodukte';
    if (prev.tab !== tab) return; // tab change handled by switchTab; skip filter tracking on cross-tab transitions

    if (prev.market !== market) {
      analytics.trackFilterChanged(
        'market',
        market === 'all' ? 'cleared' : market,
        market === 'all' ? 'removed' : 'added',
        source,
      );
    }
    if (prev.handels !== handels) {
      analytics.trackFilterChanged(
        'handelsmarke',
        handels === 'all' ? 'cleared' : handels,
        handels === 'all' ? 'removed' : 'added',
        source,
      );
    }
    if (prev.cat !== cat) {
      analytics.trackFilterChanged(
        'category',
        cat === 'all' ? 'cleared' : cat,
        cat === 'all' ? 'removed' : 'added',
        source,
      );
    }
    if (prev.brandId !== brandId) {
      analytics.trackFilterChanged(
        'market', // matches OLD: hersteller was tracked as 'market'
        brandId === 'all' ? 'cleared' : brandId,
        brandId === 'all' ? 'removed' : 'added',
        source,
      );
    }
    // Stufe is an array — emit one event per added/removed value
    const prevSet = new Set(prev.stufe);
    const curSet = new Set(stufeSelection);
    for (const s of curSet) {
      if (!prevSet.has(s)) {
        analytics.trackFilterChanged('price', `stufe_${s}`, 'added', source);
      }
    }
    for (const s of prevSet) {
      if (!curSet.has(s)) {
        analytics.trackFilterChanged('price', `stufe_${s}`, 'removed', source);
      }
    }
  }, [market, handels, cat, brandId, stufeSelection, tab, analytics]);

  const toggleStufe = useCallback((n: number) => {
    setStufeSelection((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    );
  }, []);

  // 'alle' tab only exposes the Kategorie chip in the rail, so any
  // filter for it is just `cat !== 'all'`. Per-collection-only
  // filters (Markt, Stufe, Handelsmarke, Marke) STILL count for the
  // tabs that show them, so the Reset chip appears as expected.
  const anyFilter =
    (tab === 'alle' && cat !== 'all') ||
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
      // Algolia Insights — fire-and-forget click event. Only when
      // we're actually in search mode (not browse), because Insights
      // expects events tied to a queryID. Position is 1-indexed.
      if (searchActiveQuery && searchQueryIdEigen) {
        AlgoliaService.trackClickAfterSearch({
          index: 'produkte',
          queryID: searchQueryIdEigen,
          userToken: userProfile?.uid ?? null,
          objectID: p.id,
          position: index + 1,
        });
      }
      const stufeNum = parseInt((p as any).stufe) || 1;
      // Pre-warm the destination screen's data cache the moment
      // the tap fires, BEFORE the router push. The Firestore
      // round-trip overlaps with the navigation animation, so the
      // destination often gets a synchronous cache hit on its first
      // render — no skeleton phase, no fade-in pop.
      if (stufeNum <= 2) {
        FirestoreService.prefetchProductDetails(p.id);
        router.push(`/noname-detail/${p.id}` as any);
      } else {
        FirestoreService.prefetchComparisonData(p.id, false);
        router.push(`/product-comparison/${p.id}?type=noname` as any);
      }
    },
    [analytics, searchActiveQuery, searchQueryIdEigen, userProfile?.uid],
  );

  const openBrand = useCallback(
    (m: FirestoreDocument<any>, index: number) => {
      analytics.trackProductViewWithJourney(
        m.id,
        'brand',
        (m as any).name ?? 'Marke',
        index,
      );
      if (searchActiveQuery && searchQueryIdMarken) {
        AlgoliaService.trackClickAfterSearch({
          index: 'markenProdukte',
          queryID: searchQueryIdMarken,
          userToken: userProfile?.uid ?? null,
          objectID: m.id,
          position: index + 1,
        });
      }
      FirestoreService.prefetchComparisonData(m.id, true);
      router.push(`/product-comparison/${m.id}?type=markenprodukt` as any);
    },
    [analytics, searchActiveQuery, searchQueryIdMarken, userProfile?.uid],
  );

  // ─── Render ────────────────────────────────────────────────────────────
  // `currentList` etc. are used by the per-collection page footers
  // (eigen / marken). The Alle page handles its own footer inline
  // via `nonameLoading || markenLoading`, so these defaults below
  // serve only as the eigen/marken-side picks.
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
      {/* Active-search chip — leftmost when present so it's the
          first thing the user sees and the X to bail back to browse
          mode is always within thumb reach. Same FilterChip block as
          everything else so the visual pattern stays consistent. */}
      {searchActiveQuery ? (
        <FilterChip
          icon="magnify"
          label="Suche"
          value={`"${searchActiveQuery}"`}
          onPress={() => searchInputRef.current?.focus()}
          onClear={clearSearch}
        />
      ) : null}
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
      {forTab === 'alle' ? (
        // 'Alle' tab — only filters that work across BOTH collections.
        // Markt / Stufe / Handelsmarke are NoName-only, Marke is
        // Marken-only — those would silently filter half the list to
        // empty and confuse the user. Category applies to both.
        <FilterChip
          icon="shape-outline"
          label="Kategorie"
          value={catLabel}
          onPress={() => setSheet('kategorie')}
          onClear={cat !== 'all' ? () => setCat('all') : null}
        />
      ) : forTab === 'eigen' ? (
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

  // ─── In-place search ────────────────────────────────────────────
  //
  // On submit, fire Algolia (one call, cached 24 h) and enrich each
  // hit with the Firestore-side bildClean / packTypInfo so the
  // ProductCard / BrandCard rendering matches browse mode 1:1.
  //
  // The enriched results live in `searchHitsEigen / searchHitsMarken`
  // — separate from the browse `nonames / markenprodukte` arrays so
  // clearing the search snaps the grid back to the cached browse
  // state without a re-fetch.
  const enrichWithFirestore = useCallback(
    async (
      hit: AlgoliaSearchResult,
      isNoName: boolean,
    ): Promise<AlgoliaSearchResult> => {
      try {
        const fs: any = isNoName
          ? await FirestoreService.getProductWithDetails(hit.objectID)
          : await FirestoreService.getMarkenProduktWithDetails(hit.objectID);
        // Always normalise the Algolia hit to LOOK LIKE a Firestore doc
        // (i.e. the same `id` field downstream code reads). Without this,
        // `openProduct(p)` would dereference `p.id` and get undefined,
        // which then crashes navigation with "NoName product not found".
        if (!fs) return { ...hit, id: hit.objectID } as any;
        const merged: any = { ...hit, id: hit.objectID };
        if (fs.bildClean) merged.bildClean = fs.bildClean;
        if (fs.bildCleanPng) merged.bildCleanPng = fs.bildCleanPng;
        if (fs.bildCleanHq) merged.bildCleanHq = fs.bildCleanHq;
        if (fs.packTypInfo) merged.packTypInfo = fs.packTypInfo;
        if (fs.packSize != null) merged.packSize = fs.packSize;
        if (fs.packTyp) merged.packTyp = fs.packTyp;
        if (!isNoName && fs.hersteller && typeof fs.hersteller === 'object') {
          merged.hersteller = fs.hersteller;
        }
        if (
          isNoName &&
          fs.handelsmarke &&
          typeof fs.handelsmarke === 'object'
        ) {
          merged.handelsmarke = fs.handelsmarke;
        }
        if (
          isNoName &&
          fs.discounter &&
          typeof fs.discounter === 'object'
        ) {
          merged.discounter = fs.discounter;
        }
        return merged;
      } catch {
        return hit;
      }
    },
    [],
  );

  // Run an Algolia search + Firestore-enrich + populate state.
  // Pulled out as a standalone so callers can pass a query directly
  // (route-param auto-submit) without waiting for `query` state to
  // settle on a specific render.
  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setSearchActiveQuery(trimmed);
      setSearchLoading(true);
      if (analytics?.trackCustomEvent) {
        analytics.trackCustomEvent('search_submitted', {
          screen_name: 'explore',
          search_query: trimmed,
          active_tab: tab,
        });
      }
      try {
        // 40 hits per page = 20 per Algolia index (the SDK splits the
        // request between produkte + markenProdukte). Generous enough
        // that most search sessions fit on the first page; small
        // enough to keep the initial enrichment round-trip under
        // ~200 ms even on a cold cache.
        const res = await AlgoliaService.searchAll(trimmed, 0, 40);
        const [eigen, marken] = await Promise.all([
          Promise.all(
            res.noNameResults.hits.map((h) => enrichWithFirestore(h, true)),
          ),
          Promise.all(
            res.markenproduktResults.hits.map((h) =>
              enrichWithFirestore(h, false),
            ),
          ),
        ]);
        setSearchHitsEigen(eigen);
        setSearchHitsMarken(marken);
        setSearchTotalEigen(res.noNameResults.nbHits);
        setSearchTotalMarken(res.markenproduktResults.nbHits);
        // Reset pagination cursors — first page is freshly loaded.
        setSearchPageEigen(0);
        setSearchPageMarken(0);
        // Stash queryIDs for Insights click-tracking on the next tap.
        setSearchQueryIdEigen(res.queryIdEigen);
        setSearchQueryIdMarken(res.queryIdMarken);
      } catch (e) {
        console.warn('Stöbern in-place search failed', e);
        setSearchHitsEigen([]);
        setSearchHitsMarken([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [tab, analytics, enrichWithFirestore],
  );

  // Infinite-scroll loader for search mode. Per-side independent
  // pagination — each Algolia index has its own `nbHits`. Skips
  // when the side has already returned every hit (`hits.length >=
  // nbHits`). Same enrichment pattern as the initial load.
  const loadMoreSearch = useCallback(async () => {
    // Hard guard: never call Algolia without a real, non-empty query.
    if (
      typeof searchActiveQuery !== 'string' ||
      searchActiveQuery.length === 0 ||
      searchLoadingMore
    ) {
      return;
    }

    const eigenDone = searchHitsEigen.length >= searchTotalEigen;
    const markenDone = searchHitsMarken.length >= searchTotalMarken;
    if (eigenDone && markenDone) return;

    setSearchLoadingMore(true);
    try {
      // Fetch next pages in parallel — each side may or may not
      // contribute, depending on whether it still has hits. Each
      // task carries the queryID from its response so we can update
      // tracking state to the most-recent search context.
      type TaskResult = {
        kind: 'eigen' | 'marken';
        hits: AlgoliaSearchResult[];
        queryID?: string;
      };
      const tasks: Promise<TaskResult>[] = [];
      if (!eigenDone) {
        const nextPage = searchPageEigen + 1;
        tasks.push(
          AlgoliaService.searchAll(searchActiveQuery, nextPage, 40).then(
            async (r) => ({
              kind: 'eigen',
              hits: await Promise.all(
                r.noNameResults.hits.map((h) => enrichWithFirestore(h, true)),
              ),
              queryID: r.queryIdEigen,
            }),
          ),
        );
        setSearchPageEigen(nextPage);
      }
      if (!markenDone) {
        const nextPage = searchPageMarken + 1;
        tasks.push(
          AlgoliaService.searchAll(searchActiveQuery, nextPage, 40).then(
            async (r) => ({
              kind: 'marken',
              hits: await Promise.all(
                r.markenproduktResults.hits.map((h) =>
                  enrichWithFirestore(h, false),
                ),
              ),
              queryID: r.queryIdMarken,
            }),
          ),
        );
        setSearchPageMarken(nextPage);
      }
      const results = await Promise.all(tasks);
      for (const r of results) {
        if (r.kind === 'eigen' && r.hits.length > 0) {
          setSearchHitsEigen((prev) => {
            const seen = new Set(prev.map((h) => h.objectID));
            const fresh = r.hits.filter((h) => !seen.has(h.objectID));
            return [...prev, ...fresh];
          });
          if (r.queryID) setSearchQueryIdEigen(r.queryID);
        } else if (r.kind === 'marken' && r.hits.length > 0) {
          setSearchHitsMarken((prev) => {
            const seen = new Set(prev.map((h) => h.objectID));
            const fresh = r.hits.filter((h) => !seen.has(h.objectID));
            return [...prev, ...fresh];
          });
          if (r.queryID) setSearchQueryIdMarken(r.queryID);
        }
      }
    } catch (e) {
      console.warn('Stöbern search pagination failed', e);
    } finally {
      setSearchLoadingMore(false);
    }
  }, [
    searchActiveQuery,
    searchLoadingMore,
    searchHitsEigen.length,
    searchHitsMarken.length,
    searchTotalEigen,
    searchTotalMarken,
    searchPageEigen,
    searchPageMarken,
    enrichWithFirestore,
  ]);

  const submitSearch = useCallback(() => {
    void runSearch(query);
  }, [query, runSearch]);

  const clearSearch = useCallback(() => {
    setSearchActiveQuery(null);
    setSearchHitsEigen([]);
    setSearchHitsMarken([]);
    setSearchTotalEigen(0);
    setSearchTotalMarken(0);
    setSearchPageEigen(0);
    setSearchPageMarken(0);
    setSearchQueryIdEigen(undefined);
    setSearchQueryIdMarken(undefined);
    setQuery('');
  }, []);

  const renderSearchInput = (forTab: Tab) => (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <View
        style={{
          flex: 1,
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
          ref={searchInputRef}
          placeholder={
            forTab === 'eigen'
              ? 'Eigenmarken durchsuchen …'
              : forTab === 'marken'
                ? 'Marken oder Hersteller …'
                : 'Alle Produkte durchsuchen …'
          }
          placeholderTextColor={theme.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
          onSubmitEditing={submitSearch}
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
      {/* Submit pill — visually NEUTRAL (matches the inactive
          FilterChip surface treatment): theme.surface BG + 1-px
          theme.border, primary-tinted magnify icon when there's
          a query, muted icon when empty. Same 38×38 / radius-11
          geometry as the input so they align. Identical block
          appears on every search input in the app — see CLAUDE.md
          "Search input → ONE shared style". */}
      <Pressable
        onPress={submitSearch}
        disabled={query.trim().length === 0}
        accessibilityRole="button"
        accessibilityLabel="Suche starten"
        style={({ pressed }) => ({
          height: 38,
          width: 38,
          borderRadius: 11,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <MaterialCommunityIcons
          name="magnify"
          size={18}
          color={
            query.trim().length === 0 ? theme.textMuted : brand.primary
          }
        />
      </Pressable>
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

  // Memoised merge of the two collections for the 'Alle' tab.
  // Sorts by name (case-insensitive, German collation) so Eigenmarken
  // and Marken interleave naturally instead of clumping. Each entry
  // is tagged with `__kind` so renderGrid can dispatch the correct
  // card variant (ProductCard vs BrandCard) without changing the
  // existing branch logic for the per-collection tabs.
  const alleItems = useMemo<Array<any>>(() => {
    const tagged: any[] = [
      ...nonames.map((p) => ({ ...(p as any), __kind: 'eigen' as const })),
      ...markenprodukte.map((p) => ({ ...(p as any), __kind: 'marken' as const })),
    ];
    tagged.sort((a, b) =>
      String(a.name ?? '').localeCompare(String(b.name ?? ''), 'de', {
        sensitivity: 'base',
      }),
    );
    return tagged;
  }, [nonames, markenprodukte]);

  // ─── Search-side filter projection ─────────────────────────────
  //
  // Filter chips need to act on Algolia hits the same way they do on
  // browse-mode Firestore lists. We do this client-side: fetch the
  // raw hits once, then memoise a "displayed" view that applies the
  // currently-active chips. This way changing a chip is instant
  // (no Algolia round-trip) and the chip rail's "Zurücksetzen" snaps
  // back without re-querying.
  //
  // Helpers below extract the canonical id/value out of fields that
  // can come back as either a string (Algolia ref-path) or a
  // populated object (post-`enrichWithFirestore`).
  const getRefId = (ref: any): string | null => {
    if (!ref) return null;
    if (typeof ref === 'string') return ref.includes('/') ? ref.split('/').pop() ?? null : ref;
    if (ref.id) return String(ref.id);
    if (ref.objectID) return String(ref.objectID);
    return null;
  };

  const filteredSearchEigen = useMemo<AlgoliaSearchResult[]>(() => {
    let items: any[] = searchHitsEigen as any;
    if (cat !== 'all') {
      items = items.filter((p) => getRefId(p.kategorie) === cat);
    }
    if (market !== 'all') {
      items = items.filter((p) => getRefId(p.discounter) === market);
    }
    if (handels !== 'all') {
      items = items.filter((p) => getRefId(p.handelsmarke) === handels);
    }
    if (stufeSelection.length > 0) {
      items = items.filter((p) => {
        const s = parseInt(String(p.stufe || '0')) || 0;
        return stufeSelection.includes(s);
      });
    }
    return items;
  }, [searchHitsEigen, cat, market, handels, stufeSelection]);

  const filteredSearchMarken = useMemo<AlgoliaSearchResult[]>(() => {
    let items: any[] = searchHitsMarken as any;
    if (cat !== 'all') {
      items = items.filter((p) => getRefId(p.kategorie) === cat);
    }
    if (brandId !== 'all') {
      items = items.filter(
        (p) => getRefId(p.hersteller) === brandId || getRefId(p.marke) === brandId,
      );
    }
    return items;
  }, [searchHitsMarken, cat, brandId]);

  // Same merge as alleItems (browse) but for filtered search hits.
  const alleSearchItems = useMemo<Array<any>>(() => {
    const tagged: any[] = [
      ...filteredSearchEigen.map((p) => ({ ...(p as any), __kind: 'eigen' as const })),
      ...filteredSearchMarken.map((p) => ({ ...(p as any), __kind: 'marken' as const })),
    ];
    // Preserve Algolia's relevance-ranked order WITHIN each kind, but
    // interleave by alternating eigen/marken so both types are
    // visible in the first viewport rather than all-eigen-first.
    return tagged.sort((a, b) => {
      const aIdx =
        a.__kind === 'eigen'
          ? filteredSearchEigen.findIndex((x) => x.objectID === a.objectID)
          : filteredSearchMarken.findIndex((x) => x.objectID === a.objectID);
      const bIdx =
        b.__kind === 'eigen'
          ? filteredSearchEigen.findIndex((x) => x.objectID === b.objectID)
          : filteredSearchMarken.findIndex((x) => x.objectID === b.objectID);
      const aRank = aIdx * 2 + (a.__kind === 'eigen' ? 0 : 1);
      const bRank = bIdx * 2 + (b.__kind === 'eigen' ? 0 : 1);
      return aRank - bRank;
    });
  }, [filteredSearchEigen, filteredSearchMarken]);

  const renderGrid = (forTab: Tab) => {
    // Search mode overlays browse mode: when a search is active, the
    // grid sources its items from the Algolia hits instead of the
    // Firestore browse list. The two states never blend — switching
    // away with `clearSearch` simply re-points the picker.
    const inSearch = !!searchActiveQuery;
    const items = inSearch
      ? forTab === 'alle'
        ? alleSearchItems
        : forTab === 'eigen'
          ? filteredSearchEigen
          : filteredSearchMarken
      : forTab === 'alle'
        ? alleItems
        : forTab === 'eigen'
          ? nonames
          : markenprodukte;
    const loading = inSearch
      ? searchLoading
      : forTab === 'alle'
        ? nonameLoading || markenLoading
        : forTab === 'eigen'
          ? nonameLoading
          : markenLoading;
    const empty = !loading && items.length === 0;

    // Skeleton-Grid: 6 Karten, identische Paddings + Spacing wie der
    // echte Grid → Crossfade zwischen ihnen liest sich als "Karten
    // füllen sich auf", kein Pop. Wird sowohl beim Initial-Load
    // (loading=true, items=[]) als unter-Layer verwendet, als auch
    // mid-fade während items reinkommen.
    const skeletonGrid = (
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

    // First-load: kein Inhalt da → Skeleton solo (kein Crossfade
    // nötig, da nichts zum Drüberblenden).
    if (loading && items.length === 0) {
      return skeletonGrid;
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
      // For the 'Alle' tab each item carries a `__kind` tag set by
      // the merger above. For the per-collection tabs, the branch
      // is the tab itself. This keeps the existing eigen/marken
      // render code paths untouched.
      const kind: 'eigen' | 'marken' =
        forTab === 'alle' ? (item as any).__kind : forTab;
      if (kind === 'eigen') {
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
              product={p}
              price={p.preis ?? 0}
              stufe={parseInt(p.stufe) || 1}
              sizeLabel={sizeLabel}
              unitPriceLabel={unitPriceLabel}
              variant="grid"
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
              product={m}
              price={m.preis ?? 0}
              sizeLabel={sizeLabel}
              unitPriceLabel={unitPriceLabel}
              alternativeCount={m.relatedProdukteIDs?.length ?? 0}
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

    // Crossfade-Wrap: wenn wir im Such-Modus sind und gerade Karten
    // bekommen haben (häufigster Pop-Fall: Home → Stöbern Initial-
    // Search), liegen Skeleton + Karten kurz übereinander und cross-
    // faden über 320 ms. Nach Abschluss unmountet das Skeleton.
    // Browse-Modus + spätere Search-Updates rendern den Grid direkt
    // (ohne Crossfade-Wrap), damit Pagination-Updates kein Flash
    // verursachen.
    const cardsGrid = (
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

    if (inSearch) {
      // ready = "wir haben Inhalt zum Anzeigen". Sobald die ersten
      // Karten reinkommen, läuft die Crossfade einmal. Bei späteren
      // Re-Searches (loading=true, items=[old]) bleibt ready=true,
      // damit das Skeleton NICHT rückwärts über die alten Ergebnisse
      // gelegt wird (das wäre ein "Loading-Pop" auf dem Re-Submit).
      return (
        <Crossfade ready={items.length > 0} skeleton={skeletonGrid}>
          {cardsGrid}
        </Crossfade>
      );
    }

    return cardsGrid;
  };

  // JS-side loadMore helpers — called from the worklet via runOnJS when
  // the user reaches near the bottom of either list.
  //
  // STRICT search-mode check: only delegate to Algolia when there's
  // actually a non-empty trimmed query active. Without this guard a
  // state leak (e.g. clearSearch races, route-param edge cases) could
  // route browse-mode scrolling through Algolia and burn searches.
  const inSearchMode =
    typeof searchActiveQuery === 'string' && searchActiveQuery.length > 0;

  const checkLoadMoreEigen = useCallback(() => {
    if (inSearchMode) {
      void loadMoreSearch();
      return;
    }
    if (nonameHasMore && !nonameLoading) loadNonames(false);
  }, [inSearchMode, loadMoreSearch, nonameHasMore, nonameLoading, loadNonames]);
  const checkLoadMoreMarken = useCallback(() => {
    if (inSearchMode) {
      void loadMoreSearch();
      return;
    }
    if (markenHasMore && !markenLoading) loadMarken(false);
  }, [inSearchMode, loadMoreSearch, markenHasMore, markenLoading, loadMarken]);
  // 'Alle' tab pulls from BOTH collections in browse mode — fire
  // pagination on whichever side still has pages left.
  const checkLoadMoreAlle = useCallback(() => {
    if (inSearchMode) {
      void loadMoreSearch();
      return;
    }
    if (nonameHasMore && !nonameLoading) loadNonames(false);
    if (markenHasMore && !markenLoading) loadMarken(false);
  }, [inSearchMode, loadMoreSearch, nonameHasMore, nonameLoading, markenHasMore, markenLoading, loadNonames, loadMarken]);

  // Animated scroll handlers driven both die per-page scrollYxxx
  // (→ powert die Tab-Bar-Collapse-Animation auf dem UI-Thread) und
  // den Infinite-Scroll-Trigger (JS-Thread via runOnJS).
  //
  // Wichtige Optimierung: die runOnJS-Brücke wird nur GETRIGGERED wenn
  // der User die "Bottom-Zone" (dist < 1200) NEU betritt. Vorher
  // feuerte sie auf JEDEM Scroll-Frame innerhalb der Zone (~60×/s)
  // → unnötiger JS-Bridge-Druck → spürbar als "hakelige" Scroll-
  // Performance, besonders auf Android. Die `loadingZoneXxx`-Flags
  // sind UI-Thread-SharedValues und werden zurückgesetzt sobald der
  // User wieder über die 1200-px-Schwelle nach oben scrollt — damit
  // bleibt der nächste Page-Load triggerbar.
  const loadingZoneEigen = useSharedValue(false);
  const loadingZoneMarken = useSharedValue(false);
  const loadingZoneAlle = useSharedValue(false);

  const scrollHandlerEigen = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollYEigen.value = e.contentOffset.y;
      const dist =
        e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height;
      // Threshold von 1200 → 2200 px hochgezogen — damit feuert der
      // Page-Load AB ZWEI volle Bildschirmhöhen vom Boden, statt erst
      // wenn der User ihn schon fast erreicht hat. Vorher wurde der
      // Spinner-Footer kurz sichtbar bevor neue Items rein-faden;
      // jetzt sind die neuen Items meist schon da bevor der User die
      // bestehenden zu Ende scrollt.
      const nearBottom = dist < 2200;
      if (nearBottom && !loadingZoneEigen.value) {
        loadingZoneEigen.value = true;
        runOnJS(checkLoadMoreEigen)();
      } else if (!nearBottom && loadingZoneEigen.value) {
        loadingZoneEigen.value = false;
      }
    },
  });
  const scrollHandlerMarken = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollYMarken.value = e.contentOffset.y;
      const dist =
        e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height;
      // Threshold von 1200 → 2200 px hochgezogen — damit feuert der
      // Page-Load AB ZWEI volle Bildschirmhöhen vom Boden, statt erst
      // wenn der User ihn schon fast erreicht hat. Vorher wurde der
      // Spinner-Footer kurz sichtbar bevor neue Items rein-faden;
      // jetzt sind die neuen Items meist schon da bevor der User die
      // bestehenden zu Ende scrollt.
      const nearBottom = dist < 2200;
      if (nearBottom && !loadingZoneMarken.value) {
        loadingZoneMarken.value = true;
        runOnJS(checkLoadMoreMarken)();
      } else if (!nearBottom && loadingZoneMarken.value) {
        loadingZoneMarken.value = false;
      }
    },
  });
  const scrollHandlerAlle = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollYAlle.value = e.contentOffset.y;
      const dist =
        e.contentSize.height - e.contentOffset.y - e.layoutMeasurement.height;
      // Threshold von 1200 → 2200 px hochgezogen — damit feuert der
      // Page-Load AB ZWEI volle Bildschirmhöhen vom Boden, statt erst
      // wenn der User ihn schon fast erreicht hat. Vorher wurde der
      // Spinner-Footer kurz sichtbar bevor neue Items rein-faden;
      // jetzt sind die neuen Items meist schon da bevor der User die
      // bestehenden zu Ende scrollt.
      const nearBottom = dist < 2200;
      if (nearBottom && !loadingZoneAlle.value) {
        loadingZoneAlle.value = true;
        runOnJS(checkLoadMoreAlle)();
      } else if (!nearBottom && loadingZoneAlle.value) {
        loadingZoneAlle.value = false;
      }
    },
  });

  // Wenn neue Items reingeflowt sind (= contentSize wächst), reset
  // wir die Zone-Flags damit der nächste Page-Load triggerbar ist
  // ohne dass der User aus der Zone rausscrollen muss. Greift auch
  // wenn nonameLoading/markenLoading von true → false flippt.
  useEffect(() => {
    loadingZoneEigen.value = false;
    loadingZoneAlle.value = false;
  }, [nonames.length, nonameLoading, loadingZoneEigen, loadingZoneAlle]);
  useEffect(() => {
    loadingZoneMarken.value = false;
    loadingZoneAlle.value = false;
  }, [markenprodukte.length, markenLoading, loadingZoneMarken, loadingZoneAlle]);
  useEffect(() => {
    // Such-Modus: derselbe Pattern für die zusammengeführten Hits.
    loadingZoneEigen.value = false;
    loadingZoneMarken.value = false;
    loadingZoneAlle.value = false;
  }, [
    searchHitsEigen.length,
    searchHitsMarken.length,
    searchLoadingMore,
    loadingZoneEigen,
    loadingZoneMarken,
    loadingZoneAlle,
  ]);

  // Collapsing tab-bar style. Reads the scroll offset of the currently
  // active page (tracked via `pageIndexShared`). Clamped so the tab-bar
  // can't translate past its own height.
  const tabsAnimStyle = useAnimatedStyle(() => {
    const active =
      pageIndexShared.value === 0 ? scrollYAlle.value : pageIndexShared.value === 1 ? scrollYEigen.value : scrollYMarken.value;
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
      pageIndexShared.value === 0 ? scrollYAlle.value : pageIndexShared.value === 1 ? scrollYEigen.value : scrollYMarken.value;
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
      pageIndexShared.value === 0 ? scrollYAlle.value : pageIndexShared.value === 1 ? scrollYEigen.value : scrollYMarken.value;
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
      pageIndexShared.value === 0 ? scrollYAlle.value : pageIndexShared.value === 1 ? scrollYEigen.value : scrollYMarken.value;
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
      pageIndexShared.value === 0 ? scrollYAlle.value : pageIndexShared.value === 1 ? scrollYEigen.value : scrollYMarken.value;
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
        // Initial-Page matcht den initial-Tab (siehe useState
        // oben). Bei Aufruf via Suche von Home (?query=...) ist
        // tab='alle', PagerView mountet direkt auf Page 0 — kein
        // Tab-Swipe-Animation von Eigenmarken auf Alle nach Mount.
        initialPage={PAGE_AT_TAB[tab]}
        onPageSelected={onPageSelected}
      >
        {/* ─── Page 0 — Alle (merged eigen + marken) ──────────────────
            Visual leftmost tab; PagerView page index 0 so swiping
            from Eigenmarken (page 1) to the LEFT lands here, matching
            the SegmentedTabs visual order. */}
        <View key="alle" style={{ flex: 1 }}>
          <Animated.ScrollView
            onScroll={scrollHandlerAlle}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            // removeClippedSubviews ENTFERNT — bekannt-problematisch
            // bei ScrollViews mit Reanimated-Childs / Image-Childs:
            // bei jedem Off-/On-Screen-Wechsel werden native Views
            // de-/re-attached → spürbares Scroll-Stocking. Mit
            // <100 Karten in einem memoized-React-Tree ist der
            // Memory-Vorteil minimal, aber der Scroll-Smoothness-
            // Verlust ist signifikant.
            overScrollMode="auto"
            scrollsToTop={tab === 'alle'}
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
            <View style={{ paddingTop: 12 }}>{renderGrid('alle')}</View>
            {((nonameLoading || markenLoading || searchLoadingMore) &&
              (nonames.length > 0 ||
                markenprodukte.length > 0 ||
                searchHitsEigen.length > 0 ||
                searchHitsMarken.length > 0)) ? (
              <LoadMoreSkeletonRow itemWidth={GRID_ITEM_WIDTH} />
            ) : null}
          </Animated.ScrollView>
        </View>

        {/* ─── Page 1 — Eigenmarken ─────────────────────────────────── */}
        {/* scrollsToTop must only be true on the ACTIVE page. When both
            mounted ScrollViews claim it, iOS silently disables the
            status-bar-tap scroll-to-top for all of them (documented
            UIScrollView behaviour when multiple responders exist). */}
        <View key="eigen" style={{ flex: 1 }}>
          <Animated.ScrollView
            onScroll={scrollHandlerEigen}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            // Detach off-screen tiles from the native view hierarchy
            // while scrolling. For a flex-wrap grid with 20+ cards on
            // screen, this keeps frame pacing smooth on older devices.
            removeClippedSubviews
            // iOS-native overscroll "pull" — adds the subtle rubber
            // band that the system uses, costs nothing on Android.
            overScrollMode="auto"
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
            {((nonameLoading || (searchActiveQuery && searchLoadingMore)) &&
              (nonames.length > 0 || searchHitsEigen.length > 0)) ? (
              <LoadMoreSkeletonRow itemWidth={GRID_ITEM_WIDTH} />
            ) : null}
          </Animated.ScrollView>
        </View>

        {/* ─── Page 2 — Marken ──────────────────────────────────────── */}
        <View key="marken" style={{ flex: 1 }}>
          <Animated.ScrollView
            onScroll={scrollHandlerMarken}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            // removeClippedSubviews ENTFERNT — bekannt-problematisch
            // bei ScrollViews mit Reanimated-Childs / Image-Childs:
            // bei jedem Off-/On-Screen-Wechsel werden native Views
            // de-/re-attached → spürbares Scroll-Stocking. Mit
            // <100 Karten in einem memoized-React-Tree ist der
            // Memory-Vorteil minimal, aber der Scroll-Smoothness-
            // Verlust ist signifikant.
            overScrollMode="auto"
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
            {((markenLoading || (searchActiveQuery && searchLoadingMore)) &&
              (markenprodukte.length > 0 || searchHitsMarken.length > 0)) ? (
              <LoadMoreSkeletonRow itemWidth={GRID_ITEM_WIDTH} />
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
          // Visual order: Alle on the left (default landing place
          // when discovery is the goal), Eigenmarken in the middle,
          // Marken on the right. This is decoupled from the
          // PagerView's physical page order — see the comment on
          // PAGE_AT_TAB / TAB_AT_PAGE for the mapping.
          //
          // Labels include result counts when a search is active —
          // mirrors the legacy /search-results behaviour and gives
          // the user instant feedback on where their hits live.
          // Browse mode keeps the labels bare to avoid a noisy
          // tab bar with arbitrary "all-products" totals.
          // Tab-Labels: keine Counts mehr, auch nicht bei aktiver
          // Suche. User-Feedback "bei suchergebnissen keine anzahl
          // im tab anzeigen" — die Counts wirkten unruhig + lenkten
          // vom eigentlichen Such-Result-Grid ab.
          tabs={
            [
              { key: 'alle', label: 'Alle' },
              { key: 'eigen', label: 'Eigenmarken' },
              { key: 'marken', label: 'Marken' },
            ] as const
          }
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

      {/* ─── Filter sheets ────────────────────────────────────────────
          Rendered conditionally — only the open sheet's JSX subtree is
          actually built. Before this gate, all 6 sheets constructed
          their children (OptionLists, SegmentedTabs, StufenChips rows,
          SearchableOptionLists …) on every Stöbern render, which was
          a chunk of the first-mount cost. */}
      {sheet === 'sort' ? (
      <FilterSheet
        visible
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
      ) : null}

      {sheet === 'markt' ? (
      <FilterSheet
        visible
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
      ) : null}

      {sheet === 'kategorie' ? (
      <FilterSheet
        visible
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
      ) : null}

      {sheet === 'stufe' ? (
      <FilterSheet
        visible
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
      ) : null}

      {sheet === 'marke' ? (
      <FilterSheet
        visible
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
      ) : null}

      {sheet === 'handels' ? (
      <FilterSheet
        visible
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
      ) : null}


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
