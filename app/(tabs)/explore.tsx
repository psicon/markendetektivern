import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { safePush } from '@/lib/utils/safeNav';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  InteractionManager,
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
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LegendList, type LegendListRef } from '@legendapp/list';

// Animated wrapper around LegendList — same pattern Animated.ScrollView
// uses internally — so the existing useAnimatedScrollHandler workers
// (chrome collapse, banner gating) keep firing on the UI thread.
//
// HINWEIS: Mit PERF.useScrollOffset=true wird statt dieser Wrapper
// die plain LegendList verwendet (siehe `ListComp` weiter unten).
// Der Animated-Wrapper bleibt für den Rollback-Pfad erhalten.
const AnimatedLegendList = Animated.createAnimatedComponent(LegendList) as any;

import { BrandCard } from '@/components/design/BrandCard';
import { FilterChip } from '@/components/design/FilterChip';
import { FilterSheet, OptionList } from '@/components/design/FilterSheet';
import { ProductCard } from '@/components/design/ProductCard';
import { SearchableOptionList } from '@/components/design/SearchableOptionList';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { Crossfade, ProductCardSkeleton } from '@/components/design/Skeletons';
import { getStufeCopy, loadStufeCopy } from '@/lib/utils/stufeCopy';
import { StufenChips } from '@/components/design/StufenChips';
import { collection, getDocs } from '@react-native-firebase/firestore';

import { BannerAd } from '@/components/ads/BannerAd';
import { LockedCategoryModal } from '@/components/ui/LockedCategoryModal';
import { DemographicsPromptSheet, type DemographicsResult } from '@/components/onboarding/DemographicsPromptSheet';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usePreferenceProfile, dominantDimension } from '@/hooks/usePreferenceProfile';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { db } from '@/lib/firebase';
import { PERF } from '@/lib/perfFlags';
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
type SheetKey = 'markt' | 'handels' | 'kategorie' | 'stufe' | 'marke' | 'sort' | 'inhalt' | null;

// ─── Slice C: Inhalt & Qualität — Filter (additiv, default-AUS) ──────────
// Client-seitige Post-Filter auf die BROWSE-Listen (Firestore-Produkte haben
// nutr_*/attr_*/aiComparison zuverlässig; Algolia-Such-Hits NICHT → im
// Suchmodus werden diese Filter NICHT angewendet). Default-AUS = Pass-Through,
// d.h. bestehendes Stöbern-Verhalten bleibt unverändert.
type KiQualityFilter = 'off' | 'equiv' | 'better';
interface ContentFilters {
  ki: KiQualityFilter;
  lowSugar: boolean;
  lowFat: boolean;
  lowSalt: boolean;
  highProtein: boolean;
  allergens: string[]; // normalisierte Codes, "frei von"
  bio: boolean;
  vegan: boolean;
  vegetarian: boolean;
}
const EMPTY_CONTENT_FILTERS: ContentFilters = {
  ki: 'off',
  lowSugar: false,
  lowFat: false,
  lowSalt: false,
  highProtein: false,
  allergens: [],
  bio: false,
  vegan: false,
  vegetarian: false,
};
// EU-Nährwertclaim-Schwellen pro 100 g (Solids) — defensive Defaults.
const NUTRI_THRESHOLDS = { lowSugar: 5, lowFat: 3, lowSalt: 0.3, highProtein: 10 } as const;
// Allergen-Auswahl + Normalisierung (DB-Codes sind inkonsistent: EI vs EIER).
const ALLERGEN_OPTIONS: { code: string; label: string; icon: string; aliases: string[] }[] = [
  { code: 'GLUTEN', label: 'Gluten', icon: 'barley', aliases: ['GLUTEN', 'WEIZEN', 'GERSTE', 'ROGGEN', 'DINKEL'] },
  { code: 'MILCH', label: 'Milch / Laktose', icon: 'cup', aliases: ['MILCH', 'LAKTOSE', 'MILK'] },
  { code: 'EI', label: 'Ei', icon: 'egg', aliases: ['EI', 'EIER', 'EGG'] },
  { code: 'SOJA', label: 'Soja', icon: 'soy-sauce', aliases: ['SOJA', 'SOY'] },
  { code: 'NUESSE', label: 'Nüsse', icon: 'peanut-outline', aliases: ['SCHALENFRUECHTE', 'NUSS', 'NUESSE', 'HASELNUSS', 'MANDEL', 'WALNUSS'] },
  { code: 'ERDNUSS', label: 'Erdnuss', icon: 'peanut', aliases: ['ERDNUSS', 'PEANUT'] },
  { code: 'SELLERIE', label: 'Sellerie', icon: 'sprout', aliases: ['SELLERIE'] },
  { code: 'SENF', label: 'Senf', icon: 'shaker-outline', aliases: ['SENF'] },
  { code: 'SESAM', label: 'Sesam', icon: 'grain', aliases: ['SESAM'] },
  { code: 'FISCH', label: 'Fisch', icon: 'fish', aliases: ['FISCH', 'FISH'] },
];
function normalizeAllergenToken(raw: string): string | null {
  const up = String(raw || '').toUpperCase().trim();
  if (!up) return null;
  for (const opt of ALLERGEN_OPTIONS) {
    if (opt.aliases.some((a) => up.includes(a))) return opt.code;
  }
  return up;
}

type SortKey = 'name' | 'preis';

const SHEET_TITLES: Record<Exclude<SheetKey, null>, string> = {
  markt: 'Markt',
  handels: 'Handelsmarke',
  kategorie: 'Kategorie',
  stufe: 'Ähnlichkeitsstufen',
  marke: 'Marke',
  sort: 'Sortieren',
  inhalt: 'Inhalt & Qualität',
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

// ────────────────────────────────────────────────────────────────────────
// JS-Thread-Saturation-Fixes (2026-05)
// ────────────────────────────────────────────────────────────────────────
// Symptom: nach Besuch von Stöbern war die App träge — Tap-Handler
// (z.B. "zu Favoriten hinzufügen" auf Detail-Pages) stauten sich auf
// und feuerten dann gleichzeitig in einem Burst. Ursache: mehrere
// fire-and-forget Background-Operationen die nicht canceln, wenn
// der User wegnavigiert (Stöbern selbst bleibt mounted, da Tab —
// also läuft alles weiter). Zentrale Schalter; einzeln auf `false`
// setzen rollbacked den jeweiligen Fix sofort, ohne Code-Änderungen.
const PERF_FIXES = {
  // Fix #1: Background-Prefetch der nächsten Page hinter
  // `runAfterInteractions` + Sequence-Check stellen, damit er den
  // JS-Thread nicht während User-Interaktion auslastet und stale
  // Resultate nach Filter-Wechsel verworfen werden.
  // Auswirkung: erste Page (6 Items) erscheint sofort. Items 7–18
  // landen lautlos, sobald der JS-Thread idle ist. Wenn User
  // schon weggetappt hat, läuft die Pagination zwar zu Ende, aber
  // setState rotiert die UI nicht mehr.
  deferBackgroundPrefetch: true,
  // Fix #2: Image.prefetch-Loop debouncen — heute feuert der
  // useEffect bei jedem der mehreren Pagination-Updates erneut.
  // Mit Debounce: nur 1× pro 250 ms gesammelt. ProductCard hat
  // bereits Shimmer-bis-geladen, also ist der globale Prefetch
  // Optimization-on-top — Debounce ändert sichtbar nichts.
  debounceImagePrefetch: true,
  // Fix M: Focus-Pause — wenn Stöbern blurred (User auf andere
  // Tab/Page) und 30 s nicht zurück → render-data wird auf [] gesetzt.
  // Effekt: alle Card-Components unmounten + ihre Bilder werden vom
  // expo-image-Cache evicted → Memory-Pressure auf Android weg.
  // Stöbern-Tab in Expo-Router unmountet NIE, deshalb bleibt
  // ohne Fix M die ganze Card-Tree (3 LegendLists × 30+ Cards × Bilder)
  // permanent im Speicher. Wenn User innerhalb 30 s zurückkommt,
  // kein Pause → instant.
  // Beim Pause: Underlying-State (`nonames`, `markenprodukte` etc.)
  // bleibt unverändert. Beim Resume: dataAlle/Eigen/Marken kriegt
  // wieder die echten Items → LegendLists rendern sofort, weil
  // expo-image disk-Cache die meisten Bilder ohne neuen Download
  // wiederherstellt.
  //
  // OBSOLET — abgelöst durch `freezeOnBlur: true` in
  // (tabs)/_layout.tsx. Die offizielle React-Navigation-API friert
  // den gesamten Tab-Subtree sofort beim Blur ein (kein 30-s-Timer
  // nötig, kein Re-Mount-Cost, Scroll-Position bleibt erhalten).
  // Flag bleibt `false` — die Empty-Array-Logik darunter wird nicht
  // mehr greifen, weil React Navigation den Subtree früher einfriert.
  pauseStoebernOnBlur: false,

  // Fix #3: Algolia-Search + Firestore-Enrichment per
  // AbortController canceln, sobald a) eine neue Suche kommt
  // oder b) Stöbern unmounted. Vorher liefen 40 enrichWithFirestore-
  // Calls noch zu Ende, auch wenn der User längst weiter ist.
  abortStaleSearch: true,
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

// ─── Chrome-Hairline Feature-Flag ───────────────────────────────────
// Kontrolliert die 1-px-Trennlinie am unteren Rand des fixierten
// Headers (unter Filter + Sortieren-Chips). User-Test ohne Linie.
// Zurück auf `true` flippen → Linie erscheint wieder unverändert.
const SHOW_CHROME_HAIRLINE = false;

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
//
// W4 — Cache lebt jetzt im SHARED Service-Modul `stoebernCache.ts`,
// damit Home (und andere Pages) den Cache via `prewarmStoebern()`
// vorladen können. Bei Stöbern-Mount: lesen aus shared cache, falls
// gefüllt → instant render statt 13 s warten.
import {
  getCachedEigen,
  getCachedMarken,
  setCachedEigen,
  setCachedMarken,
} from '@/lib/services/stoebernCache';

export default function ExploreScreen() {
  const { theme, brand, shadows, stufen } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  // iOS-Status-Bar-Tap-Fix: scrollsToTop nur wenn dieser Tab UND
  // die jeweilige Sub-Page (alle/eigen/marken) aktiv ist.
  const isFocused = useIsFocused();

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
  const { user, userProfile } = useAuth();
  const { isPremium } = useRevenueCat();
  const analytics = useAnalytics();
  // Slice D: Präferenz-Profil (read-once) → sanfter Default-Bias (s. u.).
  const prefProfile = usePreferenceProfile();
  const userTouchedSortRef = useRef(false);
  const sortBiasAppliedRef = useRef(false);

  // T16: Age-Lookup für Alkohol-Kategorie-Gating. Aus userProfile
  // mit Legacy-Fallback auf birthDate (alte User-Docs vor T12).
  // Re-computed on profile change.
  const userAge = useMemo<number | null>(() => {
    const p = (userProfile ?? null) as any;
    if (!p) return null;
    if (typeof p.age === 'number') {
      // Optional Hochrechnung wenn reportedYear da — sonst direkter Wert.
      if (typeof p.ageReportedYear === 'number') {
        const { currentAgeFromReported } = require('@/lib/utils/age');
        return currentAgeFromReported(p.age, p.ageReportedYear);
      }
      return p.age;
    }
    if (p.birthDate?.toDate) {
      const { ageFromBirthDate } = require('@/lib/utils/age');
      return ageFromBirthDate(p.birthDate.toDate());
    }
    return null;
  }, [userProfile]);

  // PagerView for native horizontal tab swipe
  const pagerRef = useRef<PagerView | null>(null);
  // Ref to the search TextInput so the active-search chip's tap can
  // refocus the input (lets the user immediately tweak their query
  // instead of clearing-then-retyping).
  const searchInputRef = useRef<TextInput | null>(null);
  // Per-Page-ScrollView-Refs für tap-on-tab Scroll-to-Top. iOS
  // status-bar-tap (`scrollsToTop` Prop) handled das system-seitig,
  // aber wir wollen ZUSÄTZLICH dass ein Re-Tap auf das Stöbern-Icon
  // im Tab-Bar die aktive Page zum Anfang scrollt. Wird via
  // `navigation.addListener('tabPress')` weiter unten gewired.
  const alleScrollRef = useRef<LegendListRef | null>(null);
  const eigenScrollRef = useRef<LegendListRef | null>(null);
  const markenScrollRef = useRef<LegendListRef | null>(null);

  // Fix F — `useAnimatedRef` versions: wenn PERF.useScrollOffset aktiv
  // ist, werden DIESE Refs statt der `LegendListRef`-Refs oben an die
  // (plain, nicht-Animated) LegendList gehängt. `useScrollViewOffset`
  // liest die Scroll-Position direkt vom native UIScrollView ohne
  // Animated-Wrapper-Klasse → iOS-Status-Bar-Tap funktioniert wieder.
  // useAnimatedRef gibt einen Ref der ALLE LegendListRef-Methoden
  // weiterleitet (scrollToOffset etc.), also bleibt die imperative
  // Scroll-API erhalten — getestet via die scroll-to-0-on-data-arrival
  // useEffects und das tab-press-Listener weiter unten.
  const animatedRefAlle = useAnimatedRef<any>();
  const animatedRefEigen = useAnimatedRef<any>();
  const animatedRefMarken = useAnimatedRef<any>();

  // Reanimated shared values — per-page scroll offset so the tab-bar
  // collapse state snaps to the active page (if you scrolled down in
  // "Eigenmarken", then swipe to "Marken" at top, tabs reappear).
  //
  // Fix F: wenn PERF.useScrollOffset aktiv → useScrollViewOffset
  // liefert die Shared Value direkt vom native UIScrollView (kein
  // manueller scrollHandler nötig). Sonst → useSharedValue + manueller
  // useAnimatedScrollHandler (alter Pfad).
  const scrollYEigenOffset = useScrollViewOffset(animatedRefEigen);
  const scrollYMarkenOffset = useScrollViewOffset(animatedRefMarken);
  const scrollYAlleOffset = useScrollViewOffset(animatedRefAlle);
  const scrollYEigenLegacy = useSharedValue(0);
  const scrollYMarkenLegacy = useSharedValue(0);
  const scrollYAlleLegacy = useSharedValue(0);
  // Auswahl-Logik:
  //   • Fix G (plain ScrollView) AKTIV: useScrollViewOffset funktioniert
  //     nicht mit plain ScrollView → Legacy-SharedValue (gefüllt aus
  //     JS-onScroll) ist die einzige Quelle.
  //   • Fix F AKTIV, Fix G AUS: Reanimated-tracked Path,
  //     useScrollViewOffset liefert UI-Thread-Wert.
  //   • Beide AUS: useAnimatedScrollHandler füllt Legacy-SharedValue.
  const scrollYEigen = PERF.legendListPlainScrollView
    ? scrollYEigenLegacy
    : PERF.useScrollOffset
      ? scrollYEigenOffset
      : scrollYEigenLegacy;
  const scrollYMarken = PERF.legendListPlainScrollView
    ? scrollYMarkenLegacy
    : PERF.useScrollOffset
      ? scrollYMarkenOffset
      : scrollYMarkenLegacy;
  // Shared value for the merged "Alle"-tab scroll position. Drives
  // the chrome-collapse animation when the user is on the Alle page,
  // same as the per-collection ones above.
  const scrollYAlle = PERF.legendListPlainScrollView
    ? scrollYAlleLegacy
    : PERF.useScrollOffset
      ? scrollYAlleOffset
      : scrollYAlleLegacy;
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
  // Slice C: Inhalt & Qualität — additiv, default-AUS (Pass-Through).
  const [contentFilters, setContentFilters] = useState<ContentFilters>(EMPTY_CONTENT_FILTERS);
  const contentFiltersActive = useMemo(
    () =>
      contentFilters.ki !== 'off' ||
      contentFilters.lowSugar ||
      contentFilters.lowFat ||
      contentFilters.lowSalt ||
      contentFilters.highProtein ||
      contentFilters.allergens.length > 0 ||
      contentFilters.bio ||
      contentFilters.vegan ||
      contentFilters.vegetarian,
    [contentFilters],
  );
  const contentActiveCount = useMemo(() => {
    const cf = contentFilters;
    let n = 0;
    if (cf.ki !== 'off') n++;
    if (cf.lowSugar) n++;
    if (cf.lowFat) n++;
    if (cf.lowSalt) n++;
    if (cf.highProtein) n++;
    n += cf.allergens.length;
    if (cf.bio) n++;
    if (cf.vegan) n++;
    if (cf.vegetarian) n++;
    return n;
  }, [contentFilters]);

  // Slice D: sanfter Default-Bias. Wenn das Profil klar preis-dominant ist
  // (genug Confidence) UND der User den Sort in dieser Session noch NICHT
  // angefasst hat, wird der Default-Sort von 'name' auf 'preis' gekippt.
  // Reine REIHENFOLGE — keine Inhalte werden ausgeblendet (kein Risiko für
  // die Liste); jederzeit vom User überschreibbar; feuert genau EINMAL.
  useEffect(() => {
    if (sortBiasAppliedRef.current || userTouchedSortRef.current) return;
    if (sort !== 'name') return;
    const dom = dominantDimension(prefProfile);
    if (dom && dom.dim === 'price' && dom.value >= 0.3 && dom.confidence >= 0.3) {
      sortBiasAppliedRef.current = true;
      setSort('preis');
    }
  }, [prefProfile, sort]);

  const [sheet, setSheet] = useState<SheetKey>(null);
  // Marken-Info-Sheet — getriggered vom (i)-Icon auf einer BrandCard.
  // null = zu, Object = sichtbar mit den jeweiligen Daten.
  const [infoSheet, setInfoSheet] = useState<{ title: string; body: string } | null>(null);

  // Lazy-Mount für BannerAd. User-Feedback (mehrfach): "die ads
  // machen das scrollen sehr unperformant. stell das hinten an.
  // usability und performance ist top 1!"
  //
  // Verschärfte Strategie:
  //   1) Banner mounten erst NACH dem ersten erfolgreichen Daten-
  //      Load (nonames ODER markenprodukte haben Items oder Search-
  //      Hits sind da). Das stellt sicher dass Banner-Init nicht
  //      mit dem Initial-Firebase-Roundtrip konkurriert.
  //   2) ZUSÄTZLICH 2000 ms Buffer NACH dem Daten-Load — gibt der
  //      First-Render-Pipeline Zeit zu settlen bevor wir die
  //      AdMob-SDK-Init und native AdView-Spawn-Workload starten.
  //   3) Pro Tab-Page nur EIN Banner (siehe showBannerOn) statt
  //      drei parallel mounted.
  // Premium-User sehen weiterhin keine Ads (early-return).
  const [adsReady, setAdsReady] = useState(false);
  // Ad-Gating-useEffect ist UNTEN nach den State-Deklarationen
  // platziert — sonst trifft die `nonames.length`-Lesung in den
  // Temporal-Dead-Zone der noch nicht deklarierten useState-Hooks
  // (App crasht in Production-Builds mit
  // "Cannot read property 'length' of undefined" beim Stöbern-Mount).
  // Siehe weiter unten nach `searchHitsMarken`-Init.
  // BannerAd mounts on ALL three pages once ads are ready — no
  // `tab === forTab` gate. Otherwise the ad would unmount/remount
  // every tab switch (visible flicker, fresh AdMob fetch each time).
  // PagerView keeps all pages in memory; only one is visible. Cost:
  // 3 simultaneous ad slots instead of 1, but no remount jank.
  const mountBanner = () => !isPremium && adsReady;

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
    () => (getCachedEigen()?.items as any) ?? [],
  );
  const [nonameLoading, setNonameLoading] = useState(!getCachedEigen());
  const [nonameLastDoc, _setNonameLastDoc] = useState<any>(getCachedEigen()?.lastDoc ?? null);
  const setNonameLastDoc = useCallback((v: any) => {
    nonameLastDocRef.current = v;
    _setNonameLastDoc(v);
  }, []);
  const [nonameHasMore, _setNonameHasMore] = useState(getCachedEigen()?.hasMore ?? true);
  const setNonameHasMore = useCallback((v: boolean) => {
    nonameHasMoreRef.current = v;
    _setNonameHasMore(v);
  }, []);

  const [markenprodukte, setMarkenprodukte] = useState<FirestoreDocument<any>[]>(
    () => (getCachedMarken()?.items as any) ?? [],
  );
  // Start in loading state (unless we have a cache to seed from) so
  // the Marken tab shows the skeleton grid instead of the "Keine
  // Treffer" lupe flash while its first query is in flight.
  const [markenLoading, setMarkenLoading] = useState(!getCachedMarken());
  const [markenLastDoc, _setMarkenLastDoc] = useState<any>(getCachedMarken()?.lastDoc ?? null);
  const setMarkenLastDoc = useCallback((v: any) => {
    markenLastDocRef.current = v;
    _setMarkenLastDoc(v);
  }, []);
  const [markenHasMore, _setMarkenHasMore] = useState(getCachedMarken()?.hasMore ?? true);
  const setMarkenHasMore = useCallback((v: boolean) => {
    markenHasMoreRef.current = v;
    _setMarkenHasMore(v);
  }, []);

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

  // Ad-Gating: BannerAd mountet erst NACH dem ersten Daten-Load
  // (irgendeine der vier Listen hat Items) PLUS 2 s Buffer. Steht
  // bewusst HIER hinter den State-Deklarationen, sonst Temporal-
  // Dead-Zone-Crash beim Stöbern-Mount in Production-Builds.
  // Premium-User sehen weiterhin keine Ads (early-return).
  useEffect(() => {
    if (isPremium) return;
    const dataReady =
      nonames.length > 0 ||
      markenprodukte.length > 0 ||
      searchHitsEigen.length > 0 ||
      searchHitsMarken.length > 0;
    if (!dataReady) return;
    const t = setTimeout(() => setAdsReady(true), 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isPremium,
    nonames.length,
    markenprodukte.length,
    searchHitsEigen.length,
    searchHitsMarken.length,
  ]);
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
  // T16: Separates Sheet für Age-Gate (Alkohol-Kategorie braucht
  // angegebenes Alter). Greift NUR für die Alkohol-Kategorie und
  // führt zum DemographicsPromptSheet.
  const [showAgeGateSheet, setShowAgeGateSheet] = useState(false);

  // ─── Tab-Re-Press Scroll-to-Top ──────────────────────────────────────
  // Re-Tap auf das Stöbern-Icon im Tab-Bar scrollt die aktive Page zum
  // Anfang. Mirror-Behavior zu iOS-Status-Bar-Tap (`scrollsToTop`-Prop)
  // und macht das Pattern auch auf Android verfügbar wo es kein
  // System-Pendant gibt. `tabPress` feuert auch beim Erst-Tap auf den
  // Tab — mit `navigation.isFocused()` filtern wir auf den Re-Tap-Fall.
  useEffect(() => {
    const unsub = (navigation as any).addListener?.('tabPress', () => {
      if (!(navigation as any).isFocused?.()) return;
      const ref: any = PERF.useScrollOffset
        ? (tab === 'alle' ? animatedRefAlle : tab === 'eigen' ? animatedRefEigen : animatedRefMarken)
        : (tab === 'alle' ? alleScrollRef : tab === 'eigen' ? eigenScrollRef : markenScrollRef);
      ref.current?.scrollToOffset?.({ offset: 0, animated: true });
    });
    return unsub;
  }, [navigation, tab]);

  // ─── Fix M — Focus-Pause ─────────────────────────────────────────────
  // Stöbern-Tab unmountet in Expo Router NIE → 3 LegendLists × 30+ Cards
  // × 12 Bilder bleiben permanent im RAM. Auf Android trigger das
  // app-weite GC-Pausen die ALLE anderen Pages langsam machen.
  // Mit Fix M: 30 s nach blur (User auf andere Tab/Detail-Page) wird
  // die Card-Tree auf [] gerendert → expo-image evicted Cache → RAM
  // frei. Beim Resume (Tab/Page wird wieder fokussiert) steht der
  // underlying State noch (nonames, markenprodukte) → LegendLists
  // re-rendern instant aus Memory + disk-Image-Cache.
  // Wenn User schnell zurück (innerhalb 30 s, typisch nach Detail-View),
  // KEIN Pause — Timer wird gecanceld.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!PERF_FIXES.pauseStoebernOnBlur) return;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const onBlur = () => {
      // 30 s Karenz — typische "tap product → look → back"-Flows
      // brauchen 5-15 s. Bei kürzeren Latenz-Flows mit Detail-View
      // bleibt Stöbern aktiv, kein Re-Mount-Cost.
      blurTimer = setTimeout(() => setPaused(true), 30000);
    };
    const onFocus = () => {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      setPaused(false);
    };
    const unsubBlur = (navigation as any).addListener?.('blur', onBlur);
    const unsubFocus = (navigation as any).addListener?.('focus', onFocus);
    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      unsubBlur?.();
      unsubFocus?.();
    };
  }, [navigation]);

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

  // ─── Stufe-Copy aus Remote Config nachladen
  // `loadStufeCopy()` ist idempotent (Modul-Cache + inflight dedup).
  // In InteractionManager.runAfterInteractions gewrapped damit der
  // RC-Fetch (Network-Roundtrip!) nicht mit dem Initial-Firestore-
  // Roundtrip um die HTTP/2-Connection auf Android konkurriert.
  const [, setLoadTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      void loadStufeCopy().then(() => {
        if (!cancelled) setLoadTick((n) => n + 1);
      });
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, []);

  // ─── Load reference data once (sorted A–Z for stable filter UX) ──────
  useEffect(() => {
    const byName = (a: any, b: any) =>
      String(a.name ?? a.bezeichnung ?? '').localeCompare(
        String(b.name ?? b.bezeichnung ?? ''),
        'de',
        { sensitivity: 'base' },
      );
    // runAfterInteractions: Reference-Data-Fetch erst NACH dem ersten
    // Render-Frame starten. Die Filter-Chips zeigen Default-State
    // ("Alle Märkte", "Alle Kategorien") bis die echten Listen da
    // sind — visuell unauffällig, aber freier UI-Thread für den
    // First-Paint von Skeleton + Chrome.
    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        const userLevel = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
        // Mount-Time: NUR die schlanken Reference-Daten die für
        // Produkt-Cards essentiell sind (Discounter-Logos via per-
        // Produkt ref + Packungstypen für unit-Label).
        //
        // Phase 0 C+D: kategorien (~21 docs) und handelsmarken (~1160
        // docs!) sind aus dem Critical-Path RAUSGEZOGEN — die werden
        // erst geladen wenn das jeweilige Filter-Sheet geöffnet wird
        // (siehe lazy-Effekte weiter unten). Card-Rendering braucht
        // sie nicht: Brand-Eyebrow-Text kommt aus per-Produkt
        // `p.handelsmarke` (gefüllt via getDocumentsBatch in firestore.ts,
        // Fix K).
        // Bei Lazy: 1 große + 1 kleine Query weniger auf Mount = ~1.2 s
        // schneller First-Paint auf Android.
        // Rollback: PERF.lazyHandelsmarken / lazyKategorien = false.
        const queries: Promise<any>[] = [
          FirestoreService.getDiscounter(),
          getDocs(collection(db, 'packungstypen')).catch(() => null),
        ];
        if (!PERF.lazyKategorien) {
          queries.push(categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium, userAge));
        }
        if (!PERF.lazyHandelsmarken) {
          queries.push(getDocs(collection(db, 'handelsmarken')).catch(() => null));
        }
        const results = await Promise.all(queries);
        const [ds, ptSnap, ...rest] = results;
        const cats = !PERF.lazyKategorien ? rest.shift() : undefined;
        const hmSnap = !PERF.lazyHandelsmarken ? rest.shift() : undefined;

        setDiscounter([...(ds ?? [])].sort(byName));
        if (cats) {
          setKategorien([...cats].sort(byName));
        }
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
    });
    return () => handle.cancel();
    // CRITICAL: deps müssen STABILE Primitives sein, nicht das ganze
    // userProfile-Object. Vorher: `[userProfile, isPremium]` →
    // jeder trackAction (Favorit/Wagen/etc) triggerte refreshUserProfile
    // → setUserProfile mit neuem Object → useEffect re-fired → 4
    // Firestore-Queries (inkl. 1160 handelsmarken) à ~1.2 s. Bei
    // mehreren Taps = mehrere Sekunden Hintergrund-Arbeit auf JS-Thread.
    // Jetzt: nur die WERTE die DIE Queries beeinflussen — userLevel
    // (für categoryAccessService) + isPremium. Wenn der User auf Stöbern
    // ist und seine Daten sich ändern OHNE dass Level/Premium-Status
    // wechselt, kein Reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    (userProfile as any)?.stats?.currentLevel,
    userProfile?.level,
    isPremium,
  ]);

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

  // Phase 0 C — Kategorien lazy: erst laden wenn Kategorie-Filter
  // geöffnet. Spart 1 Firestore-Query auf Stöbern-Mount.
  // Card-Rendering braucht kategorien NICHT (Cards zeigen keine
  // Kategorie-Chips inline; nur das Filter-Chip oben braucht's
  // für seinen Label, aber das initial 'Alle Kategorien' rendert
  // ohne kategorien-Liste).
  const kategorienLoaded = useRef(false);
  useEffect(() => {
    if (!PERF.lazyKategorien) return;
    if (sheet !== 'kategorie') return;
    if (kategorienLoaded.current) return;
    kategorienLoaded.current = true;
    const byNameLocal = (a: any, b: any) =>
      String(a.name ?? a.bezeichnung ?? '').localeCompare(
        String(b.name ?? b.bezeichnung ?? ''),
        'de',
        { sensitivity: 'base' },
      );
    (async () => {
      try {
        const userLevel = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
        const cats = await categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium, userAge);
        setKategorien([...cats].sort(byNameLocal));
      } catch (e) {
        console.warn('Explore: failed to load kategorien lazy', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  // Phase 0 D — Handelsmarken lazy: erst laden wenn Handelsmarke-
  // Filter geöffnet. Größte Reference-Query (~1160 docs, ~1.2 s
  // auf Android Web SDK). Card-Rendering braucht das Bulk-Array
  // NICHT — Cards bekommen ihren Brand-Eyebrow-Text aus
  // p.handelsmarke (per-Produkt-Resolution via getDocumentsBatch).
  const handelsmarkenLoaded = useRef(false);
  useEffect(() => {
    if (!PERF.lazyHandelsmarken) return;
    if (sheet !== 'handels') return;
    if (handelsmarkenLoaded.current) return;
    handelsmarkenLoaded.current = true;
    const byNameLocal = (a: any, b: any) =>
      String(a.name ?? a.bezeichnung ?? '').localeCompare(
        String(b.name ?? b.bezeichnung ?? ''),
        'de',
        { sensitivity: 'base' },
      );
    (async () => {
      try {
        const hmSnap = await getDocs(collection(db, 'handelsmarken'));
        const hms: FirestoreDocument<Handelsmarken>[] = [];
        hmSnap.forEach((d: any) => {
          hms.push({ id: d.id, ...(d.data() as any) });
        });
        setHandelsmarken(hms.sort(byNameLocal));
      } catch (e) {
        console.warn('Explore: failed to load handelsmarken lazy', e);
      }
    })();
  }, [sheet]);

  // ─── Filter-change-driven reload ───────────────────────────────────
  // First mount fires BOTH lists in parallel (no debounce) so the
  // Marken tab has data ready by the time the user swipes over — no
  // more lupe flash. Subsequent filter / search changes fire only
  // the active tab's query, with a 120 ms debounce so typing in the
  // search field doesn't hammer the backend.
  const reloadSeq = useRef(0);
  // Synchroner Inflight-Guard + hasMore-Mirror für Pagination.
  // Refs werden bei jedem render auf aktuelle state-werte synced
  // (siehe useEffect drunter). onScroll-Handler und checkLoadMore
  // lesen die Refs, nicht React-state — damit klappt das auch
  // wenn Closures stale sind (z.B. onScroll mit [] deps).
  const nonameInflightRef = useRef(false);
  const markenInflightRef = useRef(false);
  const nonameHasMoreRef = useRef(true);
  const markenHasMoreRef = useRef(true);
  // Cursor-Refs — KRITISCH für korrekte Pagination. Die JS-Scroll-
  // Handler (`onScrollJsEigen`/`onScrollJsMarken`/`onScrollJsAlle`)
  // sind mit [] deps memoisiert (damit sie auf JEDEM Frame ohne
  // Re-Subscribe feuern können). Würden `loadNonames`/`loadMarken`
  // ihren cursor aus React-State lesen, wäre dieser bei jedem Call
  // der INITIAL-Wert (null) → es würde ewig page 1 fetchen, items
  // werden als duplicates gefiltert, Liste wächst nie. Refs sind
  // synchron + always-current → Pagination funktioniert.
  const nonameLastDocRef = useRef<any>(getCachedEigen()?.lastDoc ?? null);
  const markenLastDocRef = useRef<any>(getCachedMarken()?.lastDoc ?? null);
  const isFirstMount = useRef(true);

  // Search-Sequence-Counter — analog zu reloadSeq, aber für die
  // Algolia-Such-Pipeline. Jeder runSearch / loadMoreSearch Aufruf
  // memoiert den Counter-Wert beim Start; nach dem await wird vor
  // setState verglichen. Liegt eine neuere Suche an oder wurde
  // Stöbern unmounted, droppen die alten Resultate. Gated auf
  // `PERF_FIXES.abortStaleSearch`.
  const searchSeq = useRef(0);
  // Bump beim Unmount damit alle in-flight Such-Promises ihren
  // setState-Tail droppen statt eine umgemountete Component zu
  // berühren. (Stöbern ist ein Tab — unmount feuert nur beim
  // Logout / Stack-Reset, aber dann ist der Effekt sauber.)
  useEffect(() => {
    return () => {
      if (PERF_FIXES.abortStaleSearch) searchSeq.current++;
    };
  }, []);
  useEffect(() => {
    const mySeq = ++reloadSeq.current;
    const wasFirst = isFirstMount.current;
    const delay = wasFirst ? 0 : 120;
    isFirstMount.current = false;
    const fire = () => {
      if (reloadSeq.current !== mySeq) return;
      if (wasFirst) {
        // Warm both tabs' first pages concurrently.
        if (!getCachedEigen()) loadNonames(true);
        if (!getCachedMarken()) loadMarken(true);
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
      // Erst-Mount: Skeleton + Chrome zuerst rendern (UI-Thread frei),
      // DANACH die Firestore-Queries feuern. Vorher liefen Reference-
      // Data-Fetch + 2× Product-Page-Fetch + StufeCopy-RC-Fetch +
      // AdMob-Init alle gleichzeitig auf der Mount-Frame — auf Android
      // mit Firebase-Web-SDK saturierte das die HTTP/2-Verbindung und
      // blockte den First-Paint bis zu 10 s. Mit
      // runAfterInteractions: First-Paint sofort (Skeleton sichtbar),
      // Daten-Fetches starten 1 Frame später ohne Render zu blocken.
      const handle = InteractionManager.runAfterInteractions(() => {
        if (reloadSeq.current === mySeq) fire();
      });
      return () => handle.cancel();
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
        // T16: Age-Lock (Alkohol) → Demografie-Sheet anbieten statt
        // LockedCategoryModal (Level/Ad/Paywall). Beim Tap auf Alkohol
        // ist es nicht ein "Du brauchst Level X"-Problem sondern ein
        // "Wir müssen dein Alter wissen"-Problem.
        if ((selected as any).isLockedByAge) {
          setShowAgeGateSheet(true);
          setSheet(null);
          return;
        }
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

  // Hinweis: KEIN Algolia-Server-Side-Filtering. Algolia v5 errort
  // hart auf Filtern für nicht-facet-konfigurierte Attribute → Catch
  // returnt empty hits → "Keine Treffer" obwohl welche existieren.
  // Wir filtern stattdessen client-seitig nach Enrichment — siehe
  // filteredSearchEigen / filteredSearchMarken weiter unten. Algolia
  // wird IMMER unfiltered abgefragt, Cache-Hit-Rate bleibt maximal.
  //
  // Falls die Filter mal restriktiv sind und die Algolia-Page-Size
  // nur wenige Matches enthält: User scrollt → loadMoreSearch fetched
  // die nächste Algolia-Page (ebenfalls unfiltered) → client-Filter
  // pickt weitere Matches raus.

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
      // Synchroner Inflight-Guard via ref. Verhindert dass mehrere
      // gleichzeitige scroll-trigger (onEndReached + ggf. anderes)
      // alle dieselbe pagination feuern bevor State updated.
      // React-state `nonameLoading` ist innerhalb eines Ticks stale,
      // ref ist synchron + immediate.
      //
      // ALLE pagination-state reads via ref (.current) — die JS-Scroll-
      // Handler sind mit [] deps memoisiert und würden sonst die
      // INITIAL-React-state-werte aus dem closure lesen → ewig page 1.
      if (!reset && (nonameInflightRef.current || !nonameHasMoreRef.current)) {
        return;
      }
      if (!reset) nonameInflightRef.current = true;
      // Seq-Snapshot beim Start. Wenn der User mid-flight die Filter
      // ändert (oder den Tab wechselt), bumped reloadSeq → unsere
      // alte Response gehört nicht mehr in den State. Drop sie statt
      // OLD-Filter-Items an die NEUE-Filter-Liste anzuhängen.
      // Fix für ClickUp 86c9pfa13 Bug-Teil 2 ('beim Weiterscrollen
      // wird Filter ignoriert'): in-flight loadMore mit altem Filter
      // wurde appended NACH dem reset mit neuem Filter → mixed Liste.
      const startSeq = reloadSeq.current;
      try {
        setNonameLoading(true);
        const size = reset ? FIRST_PAGE_SIZE : PAGE_SIZE;
        const res = await FirestoreService.getNoNameProductsPaginated(
          size,
          reset ? null : nonameLastDocRef.current,
          buildNonameFilters() as any,
        );
        if (reloadSeq.current !== startSeq) {
          // Filter haben sich während des Fetches geändert → Response
          // ist stale, droppen.
          return;
        }
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
            setCachedEigen({ items: next, lastDoc: res.lastDoc, hasMore: res.hasMore });
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
        //
        // Mit `PERF_FIXES.deferBackgroundPrefetch`: in
        // `runAfterInteractions` gewrappt + `reloadSeq`-Snapshot
        // gemerkt → Prefetch läuft nur wenn JS-Thread idle ist
        // und droppt sein Resultat falls Filter inzwischen
        // wechselten oder User ein anderes Verhalten triggerte.
        if (reset && res.hasMore) {
          const fireBgPrefetch = async () => {
            const mySeq = reloadSeq.current;
            try {
              const next = await FirestoreService.getNoNameProductsPaginated(
                PAGE_SIZE,
                res.lastDoc,
                buildNonameFilters() as any,
              );
              if (PERF_FIXES.deferBackgroundPrefetch && reloadSeq.current !== mySeq) {
                return; // stale — Filter changed, drop result
              }
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
          };
          if (PERF_FIXES.deferBackgroundPrefetch) {
            InteractionManager.runAfterInteractions(() => {
              void fireBgPrefetch();
            });
          } else {
            void fireBgPrefetch();
          }
        }
      } catch (e) {
        console.warn('Explore: loadNonames failed', e);
      } finally {
        setNonameLoading(false);
        nonameInflightRef.current = false;
      }
    },
    // Refs (nonameLastDocRef/nonameHasMoreRef) liefern die aktuellen
    // Werte — daher KEINE state-deps, sonst hätten wir wieder das
    // closure-staleness-Problem in den JS-Scroll-Handlern.
    [buildNonameFilters, productSorter],
  );

  const loadMarken = useCallback(
    async (reset: boolean) => {
      if (!reset && (markenInflightRef.current || !markenHasMoreRef.current)) {
        return;
      }
      if (!reset) markenInflightRef.current = true;
      // Seq-Snapshot — siehe loadNonames für die Begründung.
      // Drop stale Responses wenn der Filter mid-flight wechselt.
      const startSeq = reloadSeq.current;
      try {
        setMarkenLoading(true);
        const size = reset ? FIRST_PAGE_SIZE : PAGE_SIZE;
        const res = await FirestoreService.getMarkenproduktePaginated(
          size,
          reset ? null : markenLastDocRef.current,
          buildMarkenFilters() as any,
        );
        if (reloadSeq.current !== startSeq) {
          return;
        }
        setMarkenprodukte((prev) => {
          const existing = reset ? new Set<string>() : new Set(prev.map((p) => p.id));
          const incoming = (res.products as any[]).filter((p) => !existing.has(p.id));
          const next = reset
            ? ([...incoming].sort(productSorter) as any)
            : ([...prev, ...incoming] as any);
          if (reset && isDefaultFilters()) {
            setCachedMarken({ items: next, lastDoc: res.lastDoc, hasMore: res.hasMore });
          }
          return next;
        });
        setMarkenLastDoc(res.lastDoc);
        setMarkenHasMore(res.hasMore);

        // Same background prefetch as for nonames — siehe dort für
        // den `PERF_FIXES.deferBackgroundPrefetch` Mechanismus.
        if (reset && res.hasMore) {
          const fireBgPrefetch = async () => {
            const mySeq = reloadSeq.current;
            try {
              const next = await FirestoreService.getMarkenproduktePaginated(
                PAGE_SIZE,
                res.lastDoc,
                buildMarkenFilters() as any,
              );
              if (PERF_FIXES.deferBackgroundPrefetch && reloadSeq.current !== mySeq) {
                return; // stale
              }
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
          };
          if (PERF_FIXES.deferBackgroundPrefetch) {
            InteractionManager.runAfterInteractions(() => {
              void fireBgPrefetch();
            });
          } else {
            void fireBgPrefetch();
          }
        }
      } catch (e) {
        console.warn('Explore: loadMarken failed', e);
      } finally {
        setMarkenLoading(false);
        markenInflightRef.current = false;
      }
    },
    // Refs liefern aktuelle Werte — keine state-deps, sonst stale-
    // closure in den JS-Scroll-Handlern.
    [buildMarkenFilters, productSorter],
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
    // Filter werden NICHT mehr beim Tab-Wechsel zurückgesetzt
    // (User-Bug-Report: 'beim tabwechsel werden filter verloren').
    // Filter sind ohnehin tab-spezifisch (market/handels nur Eigen,
    // brandId nur Marken) und werden in den jeweiligen List-Filtern
    // ignoriert wenn nicht relevant — Speichern über Tabs hinweg ist
    // gewünscht. Konsistent mit dem Swipe-Pfad onPageSelected, der
    // Filter eh nie resettete.
    // Reset destination list's scroll BEFORE PagerView animates the
    // swap — page isn't visible yet, so the scroll is invisible (no
    // popping). This is the right surface for "tap a tab → top",
    // since onPageSelected fires AFTER a swipe is done and the
    // destination is already on-screen.
    const destRef: any = PERF.useScrollOffset
      ? (k === 'alle' ? animatedRefAlle : k === 'eigen' ? animatedRefEigen : animatedRefMarken)
      : (k === 'alle' ? alleScrollRef : k === 'eigen' ? eigenScrollRef : markenScrollRef);
    destRef.current?.scrollToOffset?.({ offset: 0, animated: false });
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
    if (k !== tab) {
      setTab(k);
      // Same scroll-to-top semantic as switchTab: when we land on a
      // new tab via swipe, snap the destination to offset 0 so the
      // first card row isn't clipped behind the chrome. animated:
      // false → instant snap, no visible scroll animation.
      const destRef: any = PERF.useScrollOffset
        ? (k === 'alle' ? animatedRefAlle : k === 'eigen' ? animatedRefEigen : animatedRefMarken)
        : (k === 'alle' ? alleScrollRef : k === 'eigen' ? eigenScrollRef : markenScrollRef);
      destRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    }
  }, [tab, pageIndexShared]);

  // (See `dataAlle/Eigen/Marken` first-load scroll-to-top effects
  // BELOW these state declarations — they need the memoised data
  // arrays to exist first. Refs declared up here so the effects
  // can read prev-length on each render.)
  const prevAlleLen = useRef(0);
  const prevEigenLen = useRef(0);
  const prevMarkenLen = useRef(0);

  const resetAll = useCallback(() => {
    // 📊 Analytics — fire BEFORE state resets, so the change-detection
    // useEffect below doesn't double-track each cleared filter.
    if (analytics?.trackFilterCleared) {
      analytics.trackFilterCleared();
    }
    // Filter zurück auf Defaults
    setMarket('all');
    setHandels('all');
    setCat('all');
    setStufeSelection([]);
    setBrandId('all');
    setContentFilters(EMPTY_CONTENT_FILTERS);
    // Search auch beenden → Browse-Mode auf Firestore. Algolia ist
    // explizit nur für die SUCHE da, sobald 'Zurücksetzen' gedrückt
    // wird soll der User auf der unfiltered Firestore-Liste landen
    // (User-Wunsch nach Round 4 finalize).
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

  // Slice C: content-filter change tracking — same analytics pipeline as the
  // other filters (contentSignals → health/sustainability/contentQuality axes).
  const lastContentRef = useRef<ContentFilters | null>(null);
  useEffect(() => {
    const prev = lastContentRef.current;
    const cf = contentFilters;
    lastContentRef.current = cf;
    if (!prev || !analytics?.trackFilterChanged) return;
    const source =
      tab === 'eigen' ? 'explore_nonames' : tab === 'marken' ? 'explore_markenprodukte' : 'explore_alle';
    if (prev.ki !== cf.ki) {
      analytics.trackFilterChanged('quality', cf.ki === 'off' ? 'cleared' : `ki_${cf.ki}`, cf.ki === 'off' ? 'removed' : 'added', source);
    }
    const toggles: [keyof ContentFilters, 'nutrition' | 'bio' | 'vegan' | 'vegetarian', string][] = [
      ['lowSugar', 'nutrition', 'lowSugar'],
      ['lowFat', 'nutrition', 'lowFat'],
      ['lowSalt', 'nutrition', 'lowSalt'],
      ['highProtein', 'nutrition', 'highProtein'],
      ['bio', 'bio', 'bio'],
      ['vegan', 'vegan', 'vegan'],
      ['vegetarian', 'vegetarian', 'vegetarian'],
    ];
    for (const [k, ftype, value] of toggles) {
      if (prev[k] !== cf[k]) {
        analytics.trackFilterChanged(ftype, value, cf[k] ? 'added' : 'removed', source);
      }
    }
    const prevA = new Set(prev.allergens);
    const curA = new Set(cf.allergens);
    for (const a of curA) if (!prevA.has(a)) analytics.trackFilterChanged('allergen', a, 'added', source);
    for (const a of prevA) if (!curA.has(a)) analytics.trackFilterChanged('allergen', a, 'removed', source);
  }, [contentFilters, analytics, tab]);

  // ─── Journey-Spiegelung der aktiven Filter ─────────────────────────────
  // KRITISCH für Slice B/D + B2B: der Profil-Producer + Aggregator lesen
  // journey.activeFilters — NICHT die GA4-Events. Ohne diese Spiegelung wären
  // ALLE Filter-Signale (Markt/Kategorie/Stufe/Nährwerte/Allergene/Bio/KI)
  // im Profil tot. Wir schreiben den VOLLEN aktiven Filtersatz (updateFilters
  // ersetzt activeFilters komplett) immer wenn sich etwas ändert.
  const buildJourneyActiveFilters = useCallback(() => {
    const af: any = { sortBy: sort === 'preis' ? 'price' : 'name' };
    if (market !== 'all') af.markets = [{ id: market, name: market }];
    if (cat !== 'all') af.categories = [{ id: cat, name: cat }];
    if (handels !== 'all') af.handelsmarke = handels;
    if (brandId !== 'all') af.brandId = brandId;
    if (stufeSelection.length) af.stufe = [...stufeSelection];
    const nutrition: any[] = [];
    if (contentFilters.lowSugar) nutrition.push({ key: 'lowSugar', name: 'Wenig Zucker', range: { max: NUTRI_THRESHOLDS.lowSugar } });
    if (contentFilters.lowFat) nutrition.push({ key: 'lowFat', name: 'Wenig Fett', range: { max: NUTRI_THRESHOLDS.lowFat } });
    if (contentFilters.lowSalt) nutrition.push({ key: 'lowSalt', name: 'Wenig Salz', range: { max: NUTRI_THRESHOLDS.lowSalt } });
    if (contentFilters.highProtein) nutrition.push({ key: 'highProtein', name: 'Proteinreich', range: { min: NUTRI_THRESHOLDS.highProtein } });
    if (nutrition.length) af.nutrition = nutrition;
    if (contentFilters.allergens.length) af.allergens = contentFilters.allergens.map((c) => ({ key: c, name: c }));
    if (contentFilters.bio || contentFilters.vegan || contentFilters.vegetarian) {
      af.labels = { bio: contentFilters.bio, vegan: contentFilters.vegan, vegetarian: contentFilters.vegetarian };
    }
    if (contentFilters.ki !== 'off') af.kiQuality = contentFilters.ki;
    return af;
  }, [market, cat, handels, brandId, sort, stufeSelection, contentFilters]);

  useEffect(() => {
    const hasAny =
      market !== 'all' ||
      cat !== 'all' ||
      handels !== 'all' ||
      brandId !== 'all' ||
      stufeSelection.length > 0 ||
      contentFiltersActive ||
      sort !== 'name';
    if (!hasAny) return; // kein no-op-Spam ohne aktiven Filter / ohne Journey
    try {
      analytics?.updateJourneyFilters?.(buildJourneyActiveFilters());
    } catch {
      /* fire-and-forget */
    }
  }, [buildJourneyActiveFilters, analytics, market, cat, handels, brandId, stufeSelection, contentFiltersActive, sort]);

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
    cat !== 'all' ||
    contentFiltersActive;

  // Chip label: "3" when 1 selected, "3, 4" when 2-3 selected, "3 Stufen"
  // when more. Keeps the rail compact while still showing what's active.
  const stufeChipLabel = useMemo(() => {
    if (stufeSelection.length === 0) return null;
    const sorted = [...stufeSelection].sort((a, b) => b - a);
    if (sorted.length <= 3) return sorted.join(', ');
    return `${sorted.length} Stufen`;
  }, [stufeSelection]);

  // ─── Image prefetch — warm the cache for the first batch of cards ───
  // Whenever a product list (browse or search) gets new items, fire
  // off `Image.prefetch()` for the first PREFETCH_BATCH URIs so they
  // arrive in memory before the user actually scrolls down to them.
  // Uses expo-image's prefetch (memory-disk cache) which respects the
  // ProductCard's cachePolicy. No-ops on duplicates internally.
  //
  // Mit `PERF_FIXES.debounceImagePrefetch`: 250 ms Debounce —
  // sammelt mehrere Pagination-Bursts (initial 6 → nächste 12
  // → loadMore 12) in EINEN Prefetch-Call zusammen, statt 3×
  // hintereinander den JS-Thread mit Bilddekodierung zu sättigen.
  useEffect(() => {
    const PREFETCH_BATCH = 12;
    const fire = () => {
      const uris = new Set<string>();
      const collect = (arr: any[]) => {
        for (let i = 0; i < Math.min(PREFETCH_BATCH, arr.length); i++) {
          const url = getProductImage(arr[i]);
          if (url) uris.add(url);
        }
      };
      collect(nonames);
      collect(markenprodukte);
      collect(searchHitsEigen);
      collect(searchHitsMarken);
      if (uris.size === 0) return;
      // Fire-and-forget — failures land in expo-image's internal logs,
      // we don't want to surface them to the user.
      import('expo-image').then(({ Image: EI }) => {
        EI.prefetch(Array.from(uris)).catch(() => {});
      });
    };
    if (PERF_FIXES.debounceImagePrefetch) {
      const t = setTimeout(fire, 250);
      return () => clearTimeout(t);
    }
    fire();
  }, [nonames, markenprodukte, searchHitsEigen, searchHitsMarken]);

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
        safePush(`/noname-detail/${p.id}` as any);
      } else {
        FirestoreService.prefetchComparisonData(p.id, false);
        safePush(`/product-comparison/${p.id}?type=noname` as any);
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
      safePush(`/product-comparison/${m.id}?type=markenprodukt` as any);
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
      {/* Slice C: Inhalt & Qualität — NACH Kategorie, auf allen Tabs. */}
      <FilterChip
        icon="nutrition"
        label="Inhalt"
        value={contentActiveCount > 0 ? String(contentActiveCount) : null}
        strong={contentActiveCount > 0}
        onPress={() => setSheet('inhalt')}
        onClear={contentActiveCount > 0 ? () => setContentFilters(EMPTY_CONTENT_FILTERS) : null}
      />
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
      // IDs aus dem RAW Algolia-Hit extrahieren BEVOR irgendwas
      // anderes passieren kann (auch bei Firestore-Fehler unten
      // sind die _*Id-Felder dann mindestens da). Algolia speichert
      // diese Refs als Path-Strings wie 'discounter/abc123' und
      // 'kategorien/xyz' — extractIdFromAlgoliaRef nimmt das letzte
      // Segment.
      const baseRaw: any = hit as any;
      const enrichedBase: any = {
        ...hit,
        id: hit.objectID,
        _kategorieId: extractIdFromAlgoliaRef(baseRaw.kategorie),
        ...(isNoName
          ? {
              _discounterId: extractIdFromAlgoliaRef(baseRaw.discounter),
              _handelsmarkeId: extractIdFromAlgoliaRef(baseRaw.handelsmarke),
            }
          : {
              // 'hersteller' auf markenProdukten zeigt aufs hersteller-
              // Doc (= MARKE). Wir nennen die ID _markeId für Klarheit.
              _markeId: extractIdFromAlgoliaRef(baseRaw.hersteller),
            }),
      };

      try {
        const fs: any = isNoName
          ? await FirestoreService.getProductWithDetails(hit.objectID)
          : await FirestoreService.getMarkenProduktWithDetails(hit.objectID);
        if (!fs) return enrichedBase;
        const merged: any = enrichedBase;
        if (fs.bildClean) merged.bildClean = fs.bildClean;
        if (fs.bildCleanPng) merged.bildCleanPng = fs.bildCleanPng;
        if (fs.bildCleanHq) merged.bildCleanHq = fs.bildCleanHq;
        if (fs.packTypInfo) merged.packTypInfo = fs.packTypInfo;
        if (fs.packSize != null) merged.packSize = fs.packSize;
        if (fs.packTyp) merged.packTyp = fs.packTyp;
        if (fs.kategorie && typeof fs.kategorie === 'object') {
          merged.kategorie = fs.kategorie;
        }
        if (!isNoName && fs.hersteller && typeof fs.hersteller === 'object') {
          merged.hersteller = fs.hersteller;
        }
        if (!isNoName && fs.marke && typeof fs.marke === 'object') {
          merged.marke = fs.marke;
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
        // Firestore-Fail → wir haben enrichedBase mit allen IDs
        // + display-Basics (objectID, name, bild) aus dem Algolia-
        // Hit. Reicht für Filter + Liste-Render. Display-Enrichment
        // (bildClean, packTyp etc.) fehlt halt.
        return enrichedBase;
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
      const mySeq = ++searchSeq.current;
      const isStale = () =>
        PERF_FIXES.abortStaleSearch && searchSeq.current !== mySeq;
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
        if (isStale()) return;
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
        if (isStale()) return;
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
        if (isStale()) return;
        console.warn('Stöbern in-place search failed', e);
        setSearchHitsEigen([]);
        setSearchHitsMarken([]);
      } finally {
        if (!isStale()) setSearchLoading(false);
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

    // Pagination soll an die AKTUELLE Suche gebunden sein —
    // Counter NICHT inkrementieren, nur snapshotten. Wenn jetzt
    // eine neue Suche kommt (runSearch ++) wird unser
    // Pagination-Resultat gedroppt.
    const mySeq = searchSeq.current;
    const isStale = () =>
      PERF_FIXES.abortStaleSearch && searchSeq.current !== mySeq;

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
      if (isStale()) return;
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
      if (isStale()) return;
      console.warn('Stöbern search pagination failed', e);
    } finally {
      if (!isStale()) setSearchLoadingMore(false);
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

  // Bei Filter-Change im Search-Mode brauchen wir KEINEN Algolia-
  // Re-Run mehr — die client-side filteredSearchEigen/Marken
  // reagieren auf die State-Änderung und re-filtern die schon
  // geholten Hits direkt im Render. Kein neuer Algolia-Call =
  // schneller + günstiger.

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
    // Algolia/Firestore-Indexer-Quirks: Refs landen je nach Sync-
    // Tooling als Path-String ('discounter/abc'), Object mit
    // .path / ._path String, oder Object mit ._path.segments-Array.
    // Wir extrahieren immer das letzte Segment = die Doc-ID.
    if (typeof ref._path === 'string') {
      const parts = ref._path.split('/');
      return parts[parts.length - 1] || null;
    }
    if (typeof ref.path === 'string') {
      const parts = ref.path.split('/');
      return parts[parts.length - 1] || null;
    }
    if (ref._path && Array.isArray(ref._path.segments)) {
      const segs = ref._path.segments;
      return segs[segs.length - 1] || null;
    }
    return null;
  };

  // Wenn String wie 'discounter/abc' → letztes Segment nehmen.
  const extractIdFromAlgoliaRef = (ref: any): string | null => {
    if (typeof ref === 'string' && ref.includes('/')) {
      const parts = ref.split('/');
      return parts[parts.length - 1] || null;
    }
    return getRefId(ref);
  };

  const filteredSearchEigen = useMemo<AlgoliaSearchResult[]>(() => {
    let items: any[] = searchHitsEigen as any;
    if (cat !== 'all') {
      // Primary: _kategorieId (aus Algolia-Raw extrahiert).
      // Fallback: getRefId(p.kategorie) (für Hits die vor diesem
      // Fix gecached wurden ODER falls _kategorieId null ist).
      items = items.filter(
        (p) => p._kategorieId === cat || getRefId(p.kategorie) === cat,
      );
    }
    if (market !== 'all') {
      items = items.filter(
        (p) => p._discounterId === market || getRefId(p.discounter) === market,
      );
    }
    if (handels !== 'all') {
      items = items.filter(
        (p) => p._handelsmarkeId === handels || getRefId(p.handelsmarke) === handels,
      );
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
      items = items.filter(
        (p) => p._kategorieId === cat || getRefId(p.kategorie) === cat,
      );
    }
    if (brandId !== 'all') {
      // _markeId aus Algolia-Raw 'hersteller' (zeigt auf 'hersteller'-
      // Coll = MARKE). brandId ist auch eine hersteller-Coll-Doc-ID.
      // Fallback: getRefId(p.marke) für Hits mit Firestore-resolved
      // Marke-Doc (das eine .id hat).
      items = items.filter(
        (p) =>
          p._markeId === brandId ||
          getRefId(p.marke) === brandId ||
          getRefId(p.hersteller) === brandId,
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

  // ─── Single-item renderer for LegendList. Pure JSX builder; lives
  // outside renderGrid so LegendList can recycle item views without
  // touching the heavy renderGrid code path (which is still used
  // for the skeleton + empty states). The forTab is closed-over by
  // the caller via a tiny wrapper below. ──────────────────────────
  const renderListCard = useCallback(
    (item: any, index: number, forTab: Tab) => {
      const kind: 'eigen' | 'marken' =
        forTab === 'alle' ? (item as any).__kind : forTab;
      if (kind === 'eigen') {
        const p = item as any;
        const disc = p.discounter as Discounter | undefined;
        const hm = p.handelsmarke as Handelsmarken | undefined;
        const handelsmarkeName = hm?.bezeichnung ?? (hm as any)?.name ?? null;
        const packTypId = p.packTyp?.id;
        const unit = packTypId ? packungstypenMap[packTypId] : undefined;
        const { sizeLabel, unitPriceLabel } = formatPack(p.packSize, unit, p.preis);
        return (
          <View style={{ paddingHorizontal: 6, paddingBottom: 12, height: 290 }}>
            <ProductCard
              title={p.name ?? ''}
              brand={handelsmarkeName ?? null}
              hersteller={(p as any).hersteller?.herstellername ?? (p as any).hersteller?.name ?? null}
              eyebrowLogoUri={disc?.bild ?? null}
              product={p}
              price={p.preis ?? 0}
              stufe={parseInt(p.stufe) || 1}
              sizeLabel={sizeLabel}
              unitPriceLabel={unitPriceLabel}
              variant="grid"
              height={278}
              onPress={() => openProduct(p, index)}
            />
          </View>
        );
      }
      const m = item as any;
      // Brand-Eyebrow priorisiert das `marke`-Doc (User-Sicht: "die
      // Marke") über `hersteller_new` (legaler Hersteller). Wenn marke
      // leer ist, fallback auf hersteller. Damit fehlt der Markenname
      // nie auf der Card.
      const marke =
        m.marke?.name ?? m.hersteller?.name ?? m.hersteller?.herstellername ?? '';
      const brandLogoUri = m.marke?.bild ?? m.hersteller?.bild ?? null;
      const packTypId = m.packTyp?.id;
      const unit = packTypId ? packungstypenMap[packTypId] : undefined;
      const { sizeLabel, unitPriceLabel } = formatPack(m.packSize, unit, m.preis);
      return (
        <View style={{ paddingHorizontal: 6, paddingBottom: 12, height: 290 }}>
          <BrandCard
            title={m.name ?? ''}
            brand={marke}
            brandLogoUri={brandLogoUri}
            product={m}
            price={m.preis ?? 0}
            sizeLabel={sizeLabel}
            unitPriceLabel={unitPriceLabel}
            alternativeCount={m.relatedProdukteIDs?.length ?? 0}
            height={278}
            onPress={() => openBrand(m, index)}
          />
        </View>
      );
    },
    [packungstypenMap, openProduct, openBrand],
  );

  // ─── Items per tab — factored out so the LegendList path can reuse
  // it without going through the full renderGrid (which still lives
  // below, used as the loading/empty skeleton + crossfade host). ──
  const itemsForTab = useCallback(
    (forTab: Tab) => {
      const inSearch = !!searchActiveQuery;
      return inSearch
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
    },
    [
      searchActiveQuery,
      alleSearchItems,
      filteredSearchEigen,
      filteredSearchMarken,
      alleItems,
      nonames,
      markenprodukte,
    ],
  );

  // Stable per-tab data refs — LegendList re-evaluates layout when
  // `data` prop changes by reference, which on tab-switch caused the
  // visible jump. useMemo keeps the reference stable across renders
  // until the underlying source array actually changes.
  //
  // Fix M — wenn `paused` (siehe oben), liefern die Memos `[]` statt
  // der echten Items. LegendList rendert dann nur ListEmptyComponent
  // (oder gar nichts wenn empty), die ProductCard-Components werden
  // unmounted, expo-image evicted die Bilder aus dem Memory-Cache.
  // Underlying-State (nonames, markenprodukte etc.) bleibt unverändert
  // → bei resume rehydraten die Memos sofort.
  const EMPTY_ARR: any[] = useMemo(() => [], []);

  // T16: Alkohol-Kategorie-ID + Age-Lock-Status. Wenn der User noch
  // kein Alter angegeben hat, filtern wir Alkohol-Produkte aus ALLEN
  // Listen — auch aus den Suchergebnissen (User-Wunsch: "suche nicht
  // auf alkohol möglich wenn gating aktiv").
  const alkoholCategoryId = useMemo<string | null>(() => {
    const cat = kategorien.find(
      (c) => ((c as any).bezeichnung ?? '').toLowerCase().trim() === 'alkohol',
    );
    return cat?.id ?? null;
  }, [kategorien]);
  const alkoholAgeLocked = useMemo(
    () => typeof userAge !== 'number' || userAge < 16,
    [userAge],
  );
  const filterAlkohol = useCallback(
    (items: any[]): any[] => {
      if (!alkoholAgeLocked || !alkoholCategoryId) return items;
      return items.filter((item) => {
        // Verschiedene Pfade unter denen die Kategorie-ID stecken kann:
        //  • Algolia-enriched hits → _kategorieId (string)
        //  • Firestore-products    → kategorie (object mit id) oder kategorie (DocumentReference)
        const directId = (item as any)._kategorieId;
        if (typeof directId === 'string') return directId !== alkoholCategoryId;
        const nestedId = (item as any).kategorie?.id;
        if (typeof nestedId === 'string') return nestedId !== alkoholCategoryId;
        const refPath = (item as any).kategorie?.path;
        if (typeof refPath === 'string') return !refPath.endsWith(`/${alkoholCategoryId}`);
        return true;
      });
    },
    [alkoholAgeLocked, alkoholCategoryId],
  );

  // ─── Slice C: Inhalt-&-Qualität Post-Filter (client-seitig, default-AUS).
  // Wird NUR im Browse-Modus angewendet (Firestore-Produkte haben die Felder;
  // Algolia-Such-Hits nicht). Default-AUS → Pass-Through → bestehendes
  // Verhalten unverändert. "Unbekannt ≠ ja": fehlt das Feld, wird das Produkt
  // bei einem aktiven Filter ausgeschlossen (bei Allergenen sicherheitsrelevant).
  // (contentFiltersActive ist oben bei der State-Deklaration definiert.)

  // Client-seitiger Kategorie-Guard für die BROWSE-Listen. Der Server-Query
  // filtert bereits nach Kategorie (where kategorie==ref); dies ist ein
  // Sicherheitsnetz, falls eine veraltete/gemischte Liste durchrutscht
  // (Symptom: "Kategorie gewählt, aber beim Scrollen kommen andere"). Spiegelt
  // exakt den bestehenden Such-Pfad (filteredSearchEigen). No-op wenn cat='all'
  // oder die Liste bereits sauber ist; unbekannte kategorie-Form → durchlassen.
  const filterByCategory = useCallback(
    (items: any[]): any[] => {
      if (cat === 'all') return items;
      return items.filter((p: any) => {
        const directId = p?._kategorieId ?? p?.kategorie?.id;
        if (typeof directId === 'string') return directId === cat;
        const segs = p?.kategorie?._path?.segments;
        const path = p?.kategorie?.path ?? (Array.isArray(segs) ? segs.join('/') : null);
        if (typeof path === 'string') return path.endsWith(`/${cat}`);
        return true; // unbekannte Form → nicht ausblenden (keine False-Empty)
      });
    },
    [cat],
  );
  const filterContent = useCallback(
    (items: any[], forTab: Tab): any[] => {
      if (!contentFiltersActive) return items;
      const cf = contentFilters;
      const num = (v: any): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;
      return items.filter((p: any) => {
        // KI-Qualität (nur sinnvoll für NoName; im Marken-Tab no-op).
        if (cf.ki !== 'off' && forTab !== 'marken') {
          const score = num(p?.aiComparison?.score);
          if (score == null) return false; // kein Verdikt → raus
          if (cf.ki === 'equiv' && score < 3) return false;
          if (cf.ki === 'better' && score < 4) return false;
        }
        // Nährwerte (pro 100 g) — fehlt der Wert → raus.
        if (cf.lowSugar) {
          const v = num(p?.nutr_KohlenhydratedavonZucker_val);
          if (v == null || v > NUTRI_THRESHOLDS.lowSugar) return false;
        }
        if (cf.lowFat) {
          const v = num(p?.nutr_Fett_val);
          if (v == null || v > NUTRI_THRESHOLDS.lowFat) return false;
        }
        if (cf.lowSalt) {
          const v = num(p?.nutr_Salz_val);
          if (v == null || v > NUTRI_THRESHOLDS.lowSalt) return false;
        }
        if (cf.highProtein) {
          const v = num(p?.nutr_Eiwei_val);
          if (v == null || v < NUTRI_THRESHOLDS.highProtein) return false;
        }
        // Allergene "frei von" — SICHERHEIT: unbekannt (kein Feld) → raus.
        if (cf.allergens.length > 0) {
          const tokens = [
            ...(Array.isArray(p?.attr_allergene) ? p.attr_allergene : []),
            ...(Array.isArray(p?.attr_spuren) ? p.attr_spuren : []),
          ];
          if (!Array.isArray(p?.attr_allergene)) return false; // keine Allergen-Daten → nicht als "frei von" zeigen
          const present = new Set(
            tokens.map((t: any) => normalizeAllergenToken(String(t))).filter(Boolean) as string[],
          );
          if (cf.allergens.some((code) => present.has(code))) return false;
        }
        // Bio / Vegan / Vegetarisch — nur bestätigte (true).
        if (cf.bio && p?.attr_isBio !== true) return false;
        if (cf.vegan && p?.attr_isVegan !== true) return false;
        if (cf.vegetarian && p?.attr_isVegetarisch !== true) return false;
        return true;
      });
    },
    [contentFilters, contentFiltersActive],
  );

  // Slice C: content filters apply in BROWSE mode only (Algolia search hits
  // lack nutr_*/attr_*/aiComparison). Default-AUS → filterContent is a
  // pass-through, so browse behaviour is byte-identical when no filter is set.
  const dataAlle = useMemo(() => {
    if (paused) return EMPTY_ARR;
    const base = filterAlkohol(itemsForTab('alle'));
    return searchActiveQuery ? base : filterContent(filterByCategory(base), 'alle');
  }, [itemsForTab, paused, EMPTY_ARR, filterAlkohol, filterByCategory, filterContent, searchActiveQuery]);
  const dataEigen = useMemo(() => {
    if (paused) return EMPTY_ARR;
    const base = filterAlkohol(itemsForTab('eigen'));
    return searchActiveQuery ? base : filterContent(filterByCategory(base), 'eigen');
  }, [itemsForTab, paused, EMPTY_ARR, filterAlkohol, filterByCategory, filterContent, searchActiveQuery]);
  const dataMarken = useMemo(() => {
    if (paused) return EMPTY_ARR;
    const base = filterAlkohol(itemsForTab('marken'));
    return searchActiveQuery ? base : filterContent(filterByCategory(base), 'marken');
  }, [itemsForTab, paused, EMPTY_ARR, filterAlkohol, filterByCategory, filterContent, searchActiveQuery]);

  // ─── Auto-Fill bei aktiven (client-seitigen) Filtern ───────────────────
  // Content-/Kategorie-Filter laufen client-seitig: eine Server-Seite (12)
  // ergibt dann oft nur wenige SICHTBARE Treffer → die Liste wächst kaum →
  // onEndReached re-armt nicht (FlatList/LegendList-Verhalten) → Items
  // "ploppen" erst beim Hoch-/Runterscrollen nach. Hier laden wir
  // proaktiv weitere Seiten, bis genug sichtbare Items da sind ODER keine
  // Seite mehr kommt. NUR bei aktiven Filtern + Browse-Modus — der Default-
  // Scroll (unfiltered) bleibt unverändert. nonames/markenprodukte-Länge in
  // den Deps, damit auch eine Seite mit 0 sichtbaren Treffern den nächsten
  // Load auslöst (sonst Endlos-Hänger bei dünnen Treffer-Seiten).
  const FILL_TARGET = 16;
  useEffect(() => {
    if (searchActiveQuery) return;
    if (!(contentFiltersActive || cat !== 'all')) return;
    const wantEigen = tab === 'eigen' || tab === 'alle';
    const wantMarken = tab === 'marken' || tab === 'alle';
    const visible = tab === 'eigen' ? dataEigen.length : tab === 'marken' ? dataMarken.length : dataAlle.length;
    if (visible >= FILL_TARGET) return;
    if (wantEigen && nonameHasMoreRef.current && !nonameInflightRef.current) loadNonames(false);
    if (wantMarken && markenHasMoreRef.current && !markenInflightRef.current) loadMarken(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    contentFiltersActive,
    cat,
    searchActiveQuery,
    dataAlle.length,
    dataEigen.length,
    dataMarken.length,
    nonames.length,
    markenprodukte.length,
    loadNonames,
    loadMarken,
  ]);

  // First-load scroll-to-top per tab: when data goes from empty to
  // populated (e.g. user opened Stöbern + switched tabs BEFORE the
  // Firestore fetch landed), snap that tab's list to 0. Without
  // this, the prior scrollToOffset(0) ran while ListEmptyComponent
  // was on screen — once real cards mount the layout shifts and
  // the list ends up mid-row. We only act on the 0 → >0 transition.
  // Imperative scroll-to-top: bei PERF.useScrollOffset=true wird
  // der animatedRef benutzt (sonst bleibt der List-Ref leer), sonst
  // der klassische LegendListRef. Beide haben `scrollToOffset`.
  useEffect(() => {
    if (prevAlleLen.current === 0 && dataAlle.length > 0) {
      const ref: any = PERF.useScrollOffset ? animatedRefAlle : alleScrollRef;
      ref.current?.scrollToOffset?.({ offset: 0, animated: false });
    }
    prevAlleLen.current = dataAlle.length;
  }, [dataAlle.length, animatedRefAlle]);
  useEffect(() => {
    if (prevEigenLen.current === 0 && dataEigen.length > 0) {
      const ref: any = PERF.useScrollOffset ? animatedRefEigen : eigenScrollRef;
      ref.current?.scrollToOffset?.({ offset: 0, animated: false });
    }
    prevEigenLen.current = dataEigen.length;
  }, [dataEigen.length, animatedRefEigen]);
  useEffect(() => {
    if (prevMarkenLen.current === 0 && dataMarken.length > 0) {
      const ref: any = PERF.useScrollOffset ? animatedRefMarken : markenScrollRef;
      ref.current?.scrollToOffset?.({ offset: 0, animated: false });
    }
    prevMarkenLen.current = dataMarken.length;
  }, [dataMarken.length, animatedRefMarken]);

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
              hersteller={(p as any).hersteller?.herstellername ?? (p as any).hersteller?.name ?? null}
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
        // Diagnose-Log einmalig pro Session: zeigt welche Felder
        // marke + hersteller jeweils haben, plus die infos-Werte.
        // User-Bug-History: "info-icon zeigt falsche Daten" — mit
        // dem Log lässt sich sofort sehen ob marke vs hersteller
        // korrekt gesplittet sind und wo `infos` lebt.
        if (__DEV__ && (m.marke || m.hersteller) && !(globalThis as any).__loggedMarkeHersteller) {
          (globalThis as any).__loggedMarkeHersteller = true;
          // eslint-disable-next-line no-console
          console.log(
            '🔍 Markenprodukt resolved:',
            '\n  marke fields:',
            m.marke ? Object.keys(m.marke) : '(null)',
            '\n  marke.infos:',
            JSON.stringify(m.marke?.infos ?? '(missing)'),
            '\n  hersteller fields:',
            m.hersteller ? Object.keys(m.hersteller) : '(null)',
            '\n  hersteller.herstellername:',
            JSON.stringify(m.hersteller?.herstellername ?? '(missing)'),
          );
        }
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
              infos={(m as any).marke?.infos ?? null}
              onInfoPress={() => {
                // `infos` liegt auf dem MARKE-Doc (= hersteller-
                // Collection in der DB, "MARKEN" in User-Terminologie),
                // NICHT auf dem hersteller_new-Doc.
                const markeDoc = (m as any).marke;
                const raw = markeDoc?.infos ?? (m as any).infos;
                const infosText =
                  typeof raw === 'string' && raw.trim().length > 0
                    ? raw.trim()
                    : null;
                // Fallback: Marke-Adresse falls `infos` leer ist.
                const fallbackLines = [
                  markeDoc?.adresse ? String(markeDoc.adresse) : null,
                  [markeDoc?.plz, markeDoc?.stadt].filter(Boolean).join(' ') || null,
                  markeDoc?.land ? String(markeDoc.land) : null,
                ].filter(Boolean) as string[];
                const body =
                  infosText ??
                  (fallbackLines.length > 0
                    ? fallbackLines.join('\n')
                    : 'Zu dieser Marke sind aktuell keine Zusatz-Informationen hinterlegt.');
                setInfoSheet({
                  title: markeDoc?.name || marke || m.name || 'Info',
                  body,
                });
              }}
            />
          </View>,
        );
      }
      // Inline-Grid-Ad-Row deaktiviert. User-Feedback: "die ads
      // machen das scrollen sehr unperformant". Ein zweiter
      // BannerAd alle 20 Produkte spawnt zusätzliche native AdView-
      // Container die jedes Scroll-Frame neu vermessen werden.
      // Top-Banner pro Tab (siehe showBannerOn) reicht für AdMob-
      // Revenue, ohne den Scroll zu strangulieren.
      // Wenn Inline-Ads später wieder rein sollen: hier den
      // gestrichenen Push-Block reaktivieren — der adsReady-Gate
      // ist bereits weiter oben in renderGrid bekannt.
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

  // Pagination-Trigger lesen Refs (synchron, nie stale) statt
  // React-State. Damit funktioniert das auch wenn die enthaltene
  // onScroll-Closure stale ist (typischer fall mit [] deps).
  // `loadNonames(false)` selbst hat ebenfalls einen Inflight-Ref-Guard
  // → simultane Trigger werden gededuplciert, der erste fetcht,
  // weitere returnen sofort.
  const checkLoadMoreEigen = useCallback(() => {
    if (inSearchMode) {
      void loadMoreSearch();
      return;
    }
    if (nonameHasMoreRef.current && !nonameInflightRef.current) loadNonames(false);
  }, [inSearchMode, loadMoreSearch, loadNonames]);
  const checkLoadMoreMarken = useCallback(() => {
    if (inSearchMode) {
      void loadMoreSearch();
      return;
    }
    if (markenHasMoreRef.current && !markenInflightRef.current) loadMarken(false);
  }, [inSearchMode, loadMoreSearch, loadMarken]);
  const checkLoadMoreAlle = useCallback(() => {
    if (inSearchMode) {
      void loadMoreSearch();
      return;
    }
    if (nonameHasMoreRef.current && !nonameInflightRef.current) loadNonames(false);
    if (markenHasMoreRef.current && !markenInflightRef.current) loadMarken(false);
  }, [inSearchMode, loadMoreSearch, loadNonames, loadMarken]);

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

  // Animated scroll handler: NUR Scroll-Y-Tracking für Chrome-Animation,
  // KEIN Pagination-Trigger mehr. Pagination kommt ausschließlich von
  // LegendList's `onEndReached` (siehe JSX). Vorher: doppelter Trigger
  // (Worklet + onEndReached) = Race-Condition mit 3 simultanen
  // loadNonames-Calls auf gleichem stale-state-lastDoc.
  const scrollHandlerEigen = useAnimatedScrollHandler({
    onScroll: (e) => {
      if (!PERF.useScrollOffset) {
        scrollYEigen.value = e.contentOffset.y;
      }
    },
  });
  const scrollHandlerMarken = useAnimatedScrollHandler({
    onScroll: (e) => {
      if (!PERF.useScrollOffset) {
        scrollYMarken.value = e.contentOffset.y;
      }
    },
  });
  const scrollHandlerAlle = useAnimatedScrollHandler({
    onScroll: (e) => {
      if (!PERF.useScrollOffset) {
        scrollYAlle.value = e.contentOffset.y;
      }
    },
  });

  // Fix F — Plain JS onScroll callbacks für die neuen, nicht-Animated
  // LegendLists. Übernehmen NUR die Load-More-Trigger-Logik
  // (Decision lief eh schon auf JS-Thread via `runOnJS`). Die
  // Scroll-Position selbst kommt jetzt direkt aus useScrollViewOffset
  // (UI-Thread, keine Bridge-Round-Trip nötig).
  const onScrollJsAlle = useCallback(
    (e: any) => {
      const ne = e?.nativeEvent;
      if (!ne) return;
      if (PERF.legendListPlainScrollView) {
        scrollYAlleLegacy.value = ne.contentOffset.y;
      }
      // Custom Pagination-Trigger: feuert wenn within 4 viewport
      // heights vom Ende. Synchroner Inflight-Guard + Reset-on-finish
      // (in loadNonames/loadMarken finally) sorgt dafür dass neue
      // Pages kontinuierlich nachgeladen werden während User scrollt.
      // LegendList's onEndReached ist nicht zuverlässig (feuert oft
      // nicht nach erster Daten-Update) — daher eigene Trigger-Logik.
      const dist =
        ne.contentSize.height - ne.contentOffset.y - ne.layoutMeasurement.height;
      const viewport = ne.layoutMeasurement.height || 800;
      if (dist < viewport * 4) {
        checkLoadMoreAlle();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const onScrollJsEigen = useCallback(
    (e: any) => {
      const ne = e?.nativeEvent;
      if (!ne) return;
      if (PERF.legendListPlainScrollView) {
        scrollYEigenLegacy.value = ne.contentOffset.y;
      }
      const dist =
        ne.contentSize.height - ne.contentOffset.y - ne.layoutMeasurement.height;
      const viewport = ne.layoutMeasurement.height || 800;
      if (dist < viewport * 4) {
        checkLoadMoreEigen();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const onScrollJsMarken = useCallback(
    (e: any) => {
      const ne = e?.nativeEvent;
      if (!ne) return;
      if (PERF.legendListPlainScrollView) {
        scrollYMarkenLegacy.value = ne.contentOffset.y;
      }
      const dist =
        ne.contentSize.height - ne.contentOffset.y - ne.layoutMeasurement.height;
      const viewport = ne.layoutMeasurement.height || 800;
      if (dist < viewport * 4) {
        checkLoadMoreMarken();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  // Fix F — Component + Ref + onScroll werden anhand des Flags
  // ausgewählt. Bei PERF.useScrollOffset=true: plain LegendList +
  // useAnimatedRef + JS-onScroll (Load-More-Trigger), Scroll-Position
  // kommt automatisch via useScrollViewOffset auf UI-Thread an.
  // Sonst: AnimatedLegendList + useRef + useAnimatedScrollHandler
  // (alter Pfad).
  const ListComp: any = PERF.useScrollOffset ? LegendList : AnimatedLegendList;
  const refAlle = PERF.useScrollOffset ? animatedRefAlle : alleScrollRef;
  const refEigen = PERF.useScrollOffset ? animatedRefEigen : eigenScrollRef;
  const refMarken = PERF.useScrollOffset ? animatedRefMarken : markenScrollRef;
  const onScrollAlleProp = PERF.useScrollOffset ? onScrollJsAlle : scrollHandlerAlle;
  const onScrollEigenProp = PERF.useScrollOffset ? onScrollJsEigen : scrollHandlerEigen;
  const onScrollMarkenProp = PERF.useScrollOffset ? onScrollJsMarken : scrollHandlerMarken;

  // Fix G — Wenn aktiv, gibt LegendList intern eine plain
  // `<ScrollView>` zum Rendern, statt seines default
  // `react-native.Animated.ScrollView`. Damit erkennt iOS das
  // native UIScrollView wieder und Status-Bar-Tap funktioniert.
  // `renderScrollComponent` ist eine offizielle LegendList-Prop.
  const plainScrollComponent = useCallback(
    (scrollProps: any) => <ScrollView {...scrollProps} />,
    [],
  );
  const renderScrollComponentProp = PERF.legendListPlainScrollView
    ? plainScrollComponent
    : undefined;

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
        // Lazy-Mount der nicht-sichtbaren Pages. Ohne diesen Prop
        // mountet PagerView ALLE 3 Pages (= 3 LegendLists × ~6 Cards =
        // 18 parallele Card-Mounts) beim allerersten Stöbern-Tap.
        // Mit `offscreenPageLimit={1}` werden nur die aktive Page +
        // direkte Nachbar-Page gemountet — initial nur die aktive
        // (es gibt keine Nachbar-Pages bevor man swipet). Trade-off:
        // beim ersten Swipe zur entfernten Page (z.B. Alle → Marken
        // wenn auf Eigenmarken gestartet) muss die Page mounten —
        // ~50-100 ms zusätzliche Latenz beim Swipe. Akzeptabel weil
        // die Daten bereits geladen sind (loadNonames + loadMarken
        // feuern beide auf Mount, siehe `wasFirst`-Branch in
        // reloadSeq-useEffect).
        offscreenPageLimit={1}
      >
        {/* ─── Page 0 — Alle (merged eigen + marken) ──────────────────
            Visual leftmost tab; PagerView page index 0 so swiping
            from Eigenmarken (page 1) to the LEFT lands here, matching
            the SegmentedTabs visual order. */}
        <View key="alle" style={{ flex: 1 }}>
          <ListComp
            ref={refAlle}
            data={dataAlle}
            keyExtractor={(item: any, index: number) =>
              String(item?.id ?? item?.objectID ?? index)
            }
            renderItem={({ item, index }: any) =>
              renderListCard(item, index, 'alle')
            }
            numColumns={2}
            estimatedItemSize={290}
            onScroll={onScrollAlleProp}
            renderScrollComponent={renderScrollComponentProp}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            overScrollMode="auto"
            scrollsToTop={isFocused && tab === 'alle'}
            onEndReached={checkLoadMoreAlle}
            onEndReachedThreshold={2.5}
            contentContainerStyle={{
              paddingTop: chromeTotalHeight + 12,
              paddingBottom: 120,
              paddingHorizontal: 14,
            }}
            ListHeaderComponent={
              mountBanner() ? (
                <View
                  style={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    marginBottom: 12,
                    marginHorizontal: -14,
                  }}
                >
                  <BannerAd onAdLoaded={() => {}} onAdFailedToLoad={() => {}} />
                </View>
              ) : null
            }
            ListFooterComponent={
              ((nonameLoading || markenLoading || searchLoadingMore) &&
                (nonames.length > 0 ||
                  markenprodukte.length > 0 ||
                  searchHitsEigen.length > 0 ||
                  searchHitsMarken.length > 0)) ? (
                <View style={{ marginHorizontal: -14 }}>
                  <LoadMoreSkeletonRow itemWidth={GRID_ITEM_WIDTH} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={{ marginHorizontal: -14 }}>
                {renderGrid('alle')}
              </View>
            }
          />
        </View>

        {/* ─── Page 1 — Eigenmarken ─────────────────────────────────── */}
        {/* scrollsToTop must only be true on the ACTIVE page. When both
            mounted ScrollViews claim it, iOS silently disables the
            status-bar-tap scroll-to-top for all of them (documented
            UIScrollView behaviour when multiple responders exist). */}
        <View key="eigen" style={{ flex: 1 }}>
          <ListComp
            ref={refEigen}
            data={dataEigen}
            keyExtractor={(item: any, index: number) =>
              String(item?.id ?? item?.objectID ?? index)
            }
            renderItem={({ item, index }: any) =>
              renderListCard(item, index, 'eigen')
            }
            numColumns={2}
            estimatedItemSize={290}
            onScroll={onScrollEigenProp}
            renderScrollComponent={renderScrollComponentProp}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            overScrollMode="auto"
            scrollsToTop={isFocused && tab === 'eigen'}
            onEndReached={checkLoadMoreEigen}
            onEndReachedThreshold={2.5}
            contentContainerStyle={{
              paddingTop: chromeTotalHeight + 12,
              paddingBottom: 120,
              paddingHorizontal: 14,
            }}
            ListHeaderComponent={
              mountBanner() ? (
                <View
                  style={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    marginBottom: 12,
                    marginHorizontal: -14,
                  }}
                >
                  <BannerAd onAdLoaded={() => {}} onAdFailedToLoad={() => {}} />
                </View>
              ) : null
            }
            ListFooterComponent={
              ((nonameLoading || (searchActiveQuery && searchLoadingMore)) &&
                (nonames.length > 0 || searchHitsEigen.length > 0)) ? (
                <View style={{ marginHorizontal: -14 }}>
                  <LoadMoreSkeletonRow itemWidth={GRID_ITEM_WIDTH} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={{ marginHorizontal: -14 }}>
                {renderGrid('eigen')}
              </View>
            }
          />
        </View>

        {/* ─── Page 2 — Marken ──────────────────────────────────────── */}
        <View key="marken" style={{ flex: 1 }}>
          <ListComp
            ref={refMarken}
            data={dataMarken}
            keyExtractor={(item: any, index: number) =>
              String(item?.id ?? item?.objectID ?? index)
            }
            renderItem={({ item, index }: any) =>
              renderListCard(item, index, 'marken')
            }
            numColumns={2}
            estimatedItemSize={290}
            onScroll={onScrollMarkenProp}
            renderScrollComponent={renderScrollComponentProp}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            overScrollMode="auto"
            scrollsToTop={isFocused && tab === 'marken'}
            onEndReached={checkLoadMoreMarken}
            onEndReachedThreshold={2.5}
            contentContainerStyle={{
              paddingTop: chromeTotalHeight + 12,
              paddingBottom: 120,
              paddingHorizontal: 14,
            }}
            ListHeaderComponent={
              mountBanner() ? (
                <View
                  style={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    marginBottom: 12,
                    marginHorizontal: -14,
                  }}
                >
                  <BannerAd onAdLoaded={() => {}} onAdFailedToLoad={() => {}} />
                </View>
              ) : null
            }
            ListFooterComponent={
              ((markenLoading || (searchActiveQuery && searchLoadingMore)) &&
                (markenprodukte.length > 0 || searchHitsMarken.length > 0)) ? (
                <View style={{ marginHorizontal: -14 }}>
                  <LoadMoreSkeletonRow itemWidth={GRID_ITEM_WIDTH} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={{ marginHorizontal: -14 }}>
                {renderGrid('marken')}
              </View>
            }
          />
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
              // 92 % opake getintete View — Content schimmert mit
              // 8 % Alpha durch, gleicher "fast-blurred" Look wie
              // MorphingHeader auf Home (Konsistenz auf Android).
              backgroundColor:
                scheme === 'dark'
                  ? 'rgba(15,18,20,0.92)'
                  : 'rgba(245,247,248,0.92)',
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
          currently visible.
          Toggle via SHOW_CHROME_HAIRLINE-Flag oben am Modul. */}
      {SHOW_CHROME_HAIRLINE ? (
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
      ) : null}

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
            userTouchedSortRef.current = true; // Slice D: User-Wahl gewinnt immer
            setSort(v);
            setSheet(null);
          }}
        />
      </FilterSheet>
      ) : null}

      {sheet === 'inhalt' ? (
      <FilterSheet visible title={SHEET_TITLES.inhalt} onClose={() => setSheet(null)}>
        <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
          {/* KI-Qualität (Single-Select) — NICHT im Marken-Tab (Marken haben
              keinen KI-Vergleich → dort weder sichtbar noch wirksam). */}
          {tab !== 'marken' ? (
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, marginBottom: 6 }}>
                <MaterialCommunityIcons name="robot-happy-outline" size={15} color={theme.textMuted} />
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: theme.textMuted }}>KI-QUALITÄT</Text>
              </View>
              {([
                ['off', 'Aus', 'minus-circle-outline', theme.textMuted as string],
                ['equiv', 'Gleichwertig oder besser', 'scale-balance', '#66bb6a'],
                ['better', 'Sogar besser als die Marke', 'trophy-outline', '#2e7d32'],
              ] as const).map(([v, label, icon, accent]) => {
                const sel = contentFilters.ki === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setContentFilters((c) => ({ ...c, ki: v }))}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}
                  >
                    <MaterialCommunityIcons name={icon as any} size={20} color={accent} />
                    <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 15, color: theme.text, flex: 1 }}>{label}</Text>
                    <MaterialCommunityIcons
                      name={sel ? 'radiobox-marked' : 'radiobox-blank'}
                      size={22}
                      color={sel ? accent : theme.textMuted}
                    />
                  </Pressable>
                );
              })}
              <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, marginBottom: 8 }}>
                Bewertet Eigenmarken gegen die Marke.
              </Text>
            </View>
          ) : null}

          {/* Eigenschaften (Nährwerte) + Label (Bio/Vegan/Veg) — Multi-Toggle */}
          {([
            {
              section: 'EIGENSCHAFTEN',
              rows: [
                ['lowSugar', 'Wenig Zucker', 'cube-outline'],
                ['lowFat', 'Wenig Fett', 'oil'],
                ['lowSalt', 'Wenig Salz', 'shaker-outline'],
                ['highProtein', 'Proteinreich', 'dumbbell'],
              ],
            },
            {
              section: 'LABEL',
              rows: [
                ['bio', 'Bio', 'sprout'],
                ['vegan', 'Vegan', 'leaf'],
                ['vegetarian', 'Vegetarisch', 'carrot'],
              ],
            },
          ] as const).map(({ section, rows }) => (
            <View key={section}>
              <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: theme.textMuted, marginTop: 14, marginBottom: 2 }}>
                {section}
              </Text>
              {rows.map(([k, label, icon]) => {
                const on = (contentFilters as any)[k] === true;
                const accent = (theme as any).primary ?? '#0d8575';
                return (
                  <Pressable
                    key={k}
                    onPress={() => setContentFilters((c) => ({ ...c, [k]: !(c as any)[k] }))}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}
                  >
                    <MaterialCommunityIcons name={icon as any} size={20} color={on ? accent : theme.textMuted} />
                    <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 15, color: theme.text, flex: 1 }}>{label}</Text>
                    <MaterialCommunityIcons
                      name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={on ? accent : theme.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
          ))}

          {/* Frei von (Allergene, Multi-Select) */}
          <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: theme.textMuted, marginTop: 14, marginBottom: 2 }}>
            FREI VON
          </Text>
          {ALLERGEN_OPTIONS.map((opt) => {
            const on = contentFilters.allergens.includes(opt.code);
            const accent = (theme as any).primary ?? '#0d8575';
            return (
              <Pressable
                key={opt.code}
                onPress={() =>
                  setContentFilters((c) => ({
                    ...c,
                    allergens: on ? c.allergens.filter((x) => x !== opt.code) : [...c.allergens, opt.code],
                  }))
                }
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}
              >
                <MaterialCommunityIcons name={opt.icon as any} size={20} color={on ? accent : theme.textMuted} />
                <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 15, color: theme.text, flex: 1 }}>{opt.label}</Text>
                <MaterialCommunityIcons
                  name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={22}
                  color={on ? accent : theme.textMuted}
                />
              </Pressable>
            );
          })}
          <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, marginTop: 8, marginBottom: 4 }}>
            Sicherheit: Produkte ohne hinterlegte Allergen-Daten werden bei „Frei von" ausgeblendet.
          </Text>
        </ScrollView>
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
                (c) => {
                  const base = (c as any).bezeichnung ?? (c as any).name ?? '';
                  // T16.3: Lock-Indicator als renderTrailing-Icon mit
                  // Age-Badge-Overlay (siehe unten), nicht mehr als
                  // Emoji im Label. Damit ist die Schwelle (16) NICHT
                  // im Text verraten — User kann nicht gezielt lügen.
                  return [c.id, base] as const;
                },
              ),
            ] as const
          }
          onChange={(v) => onChangeCategory(v)}
          getDimmed={(k) => {
            // T16.4: Alkohol bei Age-Lock gedimmt darstellen → User
            // sieht sofort dass die Zeile inaktiv ist (Lock-Icon
            // allein war zu subtil).
            const c = kategorien.find((x) => x.id === k);
            return !!c && !!(c as any).isLockedByAge;
          }}
          renderTrailing={(k) => {
            // T16.3: Lock-Icon mit Age-Badge-Overlay (kleines Person-
            // Icon rechts oben am Schloss). Vermittelt visuell "Alter
            // ist relevant" ohne den Schwellenwert preiszugeben.
            const c = kategorien.find((x) => x.id === k);
            if (!c || !(c as any).isLockedByAge) return null;
            return (
              <View style={{ width: 22, height: 22, marginRight: 6 }}>
                <MaterialCommunityIcons name="lock" size={20} color={theme.textMuted} />
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -5,
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: theme.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="account" size={11} color={theme.textMuted} />
                </View>
              </View>
            );
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
            // Stufe-Copy aus dem zentralen stufeCopy-Modul (Remote
            // Config + Hardcoded-Fallback). Modul-lokales STUFE_INFO
            // weiter unten ist nicht mehr aktiv.
            const info = getStufeCopy(n);
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


      {/* T16: Age-Gate-Sheet — feuert wenn User auf gesperrte Alkohol-
          Kategorie tappt. Zeigt das DemographicsPromptSheet → User
          gibt Alter (+ Geschlecht) an → Save schreibt ans User-Doc →
          Kategorie wird automatisch freigeschaltet + selektiert. */}
      <DemographicsPromptSheet
        visible={showAgeGateSheet}
        onSubmit={async (result: DemographicsResult) => {
          setShowAgeGateSheet(false);
          if (!user?.uid) return;
          try {
            const { setDoc, doc, serverTimestamp } = await import('@react-native-firebase/firestore');
            const { db: dbRef } = await import('@/lib/firebase');
            await setDoc(
              doc(dbRef, 'users', user.uid),
              {
                age: result.age,
                ageBucket: result.ageBucket,
                ageReportedAt: serverTimestamp(),
                ageReportedYear: new Date().getFullYear(),
                gender: result.gender,
                demographicsCapturedAt: serverTimestamp(),
              },
              { merge: true },
            );
            // Cache resetten + neu laden mit dem frischen Age — Alkohol
            // wird jetzt nicht mehr als locked gemeldet.
            categoryAccessService.clearCache();
            const userLevel = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
            const cats = await categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium, result.age);
            setKategorien(cats);
            // Direkt Alkohol-Kategorie selektieren (wir wissen ja warum
            // der User das Sheet überhaupt geöffnet hat).
            const alkohol = cats.find(c => (c.bezeichnung ?? '').toLowerCase().trim() === 'alkohol');
            if (alkohol) setCat(alkohol.id);
          } catch (err) {
            console.warn('[Explore] age-gate save failed:', err);
          }
        }}
        onSkip={() => setShowAgeGateSheet(false)}
      />

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
            safePush('/achievements' as any);
          }}
          onUnlockSuccess={() => {
            setLockedCategory(null);
            // Re-fetch categories so the lock state updates after rewarded-ad unlock
            (async () => {
              const userLevel = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
              const cats = await categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium, userAge);
              setKategorien(cats);
            })();
          }}
        />
      ) : null}

      {/* Marken-Info-Sheet — getriggered vom (i)-Icon auf einer
          BrandCard. Zeigt den Hersteller/Discounter-Infos-Text in
          einem scrollbaren Body. */}
      <FilterSheet
        visible={!!infoSheet}
        title={infoSheet?.title ?? ''}
        onClose={() => setInfoSheet(null)}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.regular,
            fontSize: 14,
            lineHeight: 21,
            color: theme.text,
            paddingBottom: 8,
          }}
        >
          {infoSheet?.body ?? ''}
        </Text>
      </FilterSheet>
    </View>
  );
}
