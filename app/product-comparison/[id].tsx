import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  InteractionManager,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PagerView from 'react-native-pager-view';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import {
  EnttarnteAlternativesList,
  type EnttarnteAlternative,
} from '@/components/design/EnttarnteAlternativesList';
import { FadingImage } from '@/components/design/FadingImage';
import { FlyToCart, type FlyToCartHandle } from '@/components/design/FlyToCart';
import { FloatingShoppingListButton } from '@/components/design/FloatingShoppingListButton';
import { ImageZoomModal, type SourceRect } from '@/components/design/ImageZoomModal';
import { getProductImage } from '@/lib/utils/productImage';
import { calculateSavings } from '@/lib/utils/savings';
import { RatingsSheet, type Rating, type SubmittedRating } from '@/components/design/RatingsSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { CoachmarkScrollProvider } from '@/components/coachmarks/CoachmarkScrollContext';
import {
  PRODUCT_DETAIL_ANCHOR_CART,
  PRODUCT_DETAIL_ANCHOR_CONTEXT,
  PRODUCT_DETAIL_ANCHOR_FAVORITE,
  PRODUCT_DETAIL_ANCHOR_HERO,
  PRODUCT_DETAIL_ANCHOR_RATING,
  ProductDetailWalkthrough,
} from '@/components/coachmarks/ProductDetailWalkthrough';
import { Crossfade, Shimmer } from '@/components/design/Skeletons';
import { StufenChips } from '@/components/design/StufenChips';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useCoachmark } from '@/hooks/useCoachmark';
import { useCoachmarkAnchor } from '@/hooks/useCoachmarkAnchor';
import { useTokens } from '@/hooks/useTokens';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useFavorites } from '@/lib/hooks/useFavorites';
import achievementService from '@/lib/services/achievementService';
import { FirestoreService } from '@/lib/services/firestore';
import { isNonFoodCategory } from '@/lib/utils/categoryClassification';
import {
  showFavoriteAddedToast,
  showFavoriteRemovedToast,
  showInfoToast,
} from '@/lib/services/ui/toast';
import type {
  MarkenProduktWithDetails,
  ProductWithDetails,
} from '@/lib/types/firestore';

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

type Tab = 'ingredients' | 'nutrition';

const SCREEN_WIDTH = Dimensions.get('window').width;
// Prototype fixes each NN card at 280 px; when there's only a single card we
// let it fill the available width (minus the page's 20 px horizontal padding).
const NN_CARD_WIDTH = 280;
const NN_CARD_WIDTH_SINGLE = SCREEN_WIDTH - 40;
const NN_CARD_GAP = 12;

// Feature-Flag: Stufe-Indikator INSIDE jeder Alt-Card statt als
// globale Detektiv-Check-Row unter dem Carousel. true = neues
// Verhalten (Stufe in jeder Card + globale Row ausgeblendet),
// false = Original-Verhalten (nur globale Row unter dem Carousel).
// Auf false setzen rollbackt das Feature komplett ohne Code-Diff.
const STUFE_IN_CARD = true;

// Labels + one-liners for each similarity level (matches prototype).
const STUFE_INFO: Record<1 | 2 | 3 | 4 | 5, { label: string; line: string }> = {
  5: { label: 'Identisch', line: 'Wird am selben Band mit identischer Rezeptur produziert.' },
  4: { label: 'Nahezu identisch', line: 'Gleicher Hersteller, minimal abweichende Rezeptur.' },
  3: { label: 'Ähnlich', line: 'Gleicher Hersteller, angepasste Rezeptur — sehr ähnlich im Geschmack.' },
  2: { label: 'Verwandt', line: 'Anderer Hersteller, aber vergleichbare Qualität & Zutaten.' },
  1: { label: 'Alternative', line: 'Günstige Alternative mit abweichender Rezeptur.' },
};

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const formatEur = (v?: number | null) =>
  v == null ? '—' : `${v.toFixed(2).replace('.', ',')}€`;

const parseStufe = (s: any): 1 | 2 | 3 | 4 | 5 => {
  const n = parseInt(String(s)) || 1;
  return Math.min(5, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5;
};

/** e.g. (100, 'g', 0.89) → '100g · 8,90€/kg' */
function formatPack(size?: number, unit?: string, price?: number): string | null {
  const parts = formatPackParts(size, unit, price);
  if (!parts) return null;
  return parts.unitPrice ? `${parts.sizeLabel} · ${parts.unitPrice}` : parts.sizeLabel;
}

// Same data as formatPack but returned in structured form so the two
// pieces can be rendered on separate lines when horizontal space is
// tight (e.g. the NoName carousel cards where the action cluster on
// the right leaves only ~80 px for the price column).
function formatPackParts(
  size?: number,
  unit?: string,
  price?: number,
): { sizeLabel: string; unitPrice: string | null } | null {
  if (!size || !unit) return null;
  const u = unit.toLowerCase().replace(/\.$/, '');
  const isStk = u === 'stk' || u === 'stück';
  const sizeLabel = isStk ? `${size} ${unit}` : `${size}${unit}`;
  let unitPrice: string | null = null;
  if (price && price > 0) {
    if (u === 'g') unitPrice = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/kg`;
    else if (u === 'kg') unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/kg`;
    else if (u === 'ml') unitPrice = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/L`;
    else if (u === 'l') unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/L`;
    else if (isStk) unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/Stk.`;
  }
  return { sizeLabel, unitPrice };
}

// Savings-Berechnung nutzt jetzt den shared util
// `lib/utils/savings.ts` (Drei-Stufen-Resolver: precomputed
// Firestore-Felder → per-pack-unit-Vergleich → absolute Preise).
// Vorher war die Funktion hier eine simple Absolutpreis-Subtraktion,
// die bei unterschiedlichen Pack-Größen (z.B. Brand 150g/0,79€ vs
// NoName 400g/1,19€) irreführende "+51% Markup"-Badges produzierte
// obwohl per Kg der NoName 44 % günstiger war. Markups (negative
// Ersparnis) werden vom Util auf 0 geclamped — wir zeigen nur
// echte Savings, keine roten +%-Banner mehr.
function savings(
  brand: { preis?: number; packSize?: number } | undefined,
  nn:
    | {
        preis?: number;
        packSize?: number;
        ersparnis?: number;
        ersparnisProz?: number;
      }
    | undefined,
) {
  return calculateSavings(brand, nn);
}

// ────────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────────

export default function ProductComparisonScreen() {
  const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows, stufen } = useTokens();
  const { user } = useAuth();
  const { toggleFavorite } = useFavorites();
  const analytics = useAnalytics();

  // ─── Coachmark Walkthrough ───────────────────────────────────
  // Tour 'product-detail' — gemeinsam mit noname-detail. Anchors
  // sitzen unten an den drei Hero-Cluster ActionButtons des
  // MARKENPRODUKTS (oben), NICHT an den NoName-Card-Buttons im
  // Carousel — hätten wir doppelte Anchor-IDs, würde der Spotlight
  // auf den jeweils zuletzt-gemounteten zeigen. ScrollView-Ref
  // braucht's für den Scroll-Lock während Spotlights aktiv sind.
  const detailCoachmark = useCoachmark('product-detail');
  const heroAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_HERO);
  const cartAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_CART);
  const favAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_FAVORITE);
  const ratingAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_RATING);
  // Auf product-comparison zeigt Context auf den NoName-Carousel.
  const contextAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_CONTEXT);
  const detailScrollRef = useRef<ScrollView>(null);

  // Different callers across the app push either `?type=markenprodukt`
  // (home, explore, comparison-alternatives) or `?type=brand` (search-
  // results, history, purchase-history, favorites, barcode-scanner).
  // Both refer to the same thing — accept both so navigation from
  // any entry point works.
  const isMarkenProdukt = type === 'markenprodukt' || type === 'brand';

  // ─── Data state ──────────────────────────────────────────────────
  // Two readiness flags drive the on-screen reveal:
  //   • `mainReady`    — brand product fully resolved → hero block
  //                      crossfades in (Crossfade, delay 0).
  //   • `nonamesReady` — related no-name products query landed →
  //                      carousel block crossfades in (Crossfade,
  //                      delay 0; the stagger comes from the natural
  //                      data delta since the related-products query
  //                      starts AFTER the brand product resolves on
  //                      the Firestore side).
  // No `onBasic` callback any more — staggered partial reveals
  // felt like multiple little pops; one clean crossfade per
  // section is much smoother.
  const [error, setError] = useState<string | null>(null);
  const [mainProduct, setMainProduct] = useState<MarkenProduktWithDetails | null>(null);
  const [nonames, setNonames] = useState<ProductWithDetails[]>([]);
  const [nonamesReady, setNonamesReady] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const mainReady = !!mainProduct;

  useEffect(() => {
    let alive = true;
    setError(null);
    setMainProduct(null);
    setNonames([]);
    setNonamesReady(false);
    setPickedId(null);

    (async () => {
      try {
        const data = await FirestoreService.getProductComparisonData(
          String(id),
          isMarkenProdukt,
        );
        if (!alive) return;
        if (!data) {
          setError('Produkt nicht gefunden');
          return;
        }
        setMainProduct(data.mainProduct);
        const sorted = [...(data.relatedNoNameProducts ?? [])].sort((a, b) => {
          const sa = parseStufe((a as any).stufe);
          const sb = parseStufe((b as any).stufe);
          if (sa !== sb) return sb - sa;
          return ((a as any).preis ?? 0) - ((b as any).preis ?? 0);
        });
        setNonames(sorted);
        setNonamesReady(true);
        setPickedId(
          !data.clickedWasNoName ? (sorted[0]?.id ?? null) : data.clickedProductId,
        );

        // 📊 Analytics — comparison view (matches old behaviour from
        // app/product-comparison/[id].tsx in main branch). Fires once
        // per comparison-data-load with the main product ID and the
        // list of related NoName products being compared against.
        if (analytics?.trackProductComparison && data.mainProduct?.id) {
          const compared = sorted.map((p: any) => ({
            productId: p.id,
            productName: p.name || p.produktName || 'NoName Produkt',
            productType: 'noname' as const,
            price: p.preis || 0,
            savings: p.ersparnis || 0,
          }));
          analytics.trackProductComparison(
            data.mainProduct.id,
            (data.mainProduct as any).name || (data.mainProduct as any).produktName || 'Produkt',
            isMarkenProdukt ? 'brand' : 'noname',
            compared,
          );
        }

        // Cart-Status für die geladenen Produkte (Hauptmarke + alle
        // verwandten NoNames) initialisieren. Ohne diesen Schritt
        // startet `cartMap` leer und der Toggle-Button zeigt für ein
        // bereits im Wagen liegendes Produkt fälschlich "hinzufügen".
        // Eine einzelne Query lädt alle offenen Cart-Items des Users
        // — billiger als N parallele isInShoppingCart-Calls.
        if (user?.uid && alive) {
          try {
            const items = await FirestoreService.getShoppingCartItems(user.uid);
            if (!alive) return;
            const inCartIds = new Set<string>();
            for (const it of items as any[]) {
              const pid = it?.markenProdukt?.id || it?.handelsmarkenProdukt?.id;
              if (pid) inCartIds.add(pid);
            }
            const next: Record<string, boolean> = {};
            if (data.mainProduct?.id && inCartIds.has(data.mainProduct.id)) {
              next[data.mainProduct.id] = true;
            }
            for (const nn of sorted) {
              if (nn.id && inCartIds.has(nn.id)) next[nn.id] = true;
            }
            // Funktional setzen, damit User-getriggerte Toggles, die
            // zwischen den Awaits passiert sind, nicht überschrieben
            // werden.
            setCartMap((prev) => ({ ...prev, ...next }));
          } catch {
            /* non-fatal — cartMap bleibt im aktuellen Stand */
          }
        }

        // 🎯 Gamification: track `view_comparison` once data is in
        // hand. This action also fires the `first_action_any`
        // achievement on the user's first visit. Fire-and-forget —
        // failures must not block the screen from rendering.
        if (user?.uid) {
          achievementService
            .trackAction(user.uid, 'view_comparison', {
              productId: String(id),
              productType: type ?? (isMarkenProdukt ? 'markenprodukt' : 'noname'),
            })
            .catch((err) => {
              console.warn('view_comparison trackAction failed', err);
            });
        }
      } catch (e) {
        if (!alive) return;
        console.warn('ProductComparison: load failed', e);
        setError('Fehler beim Laden');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, isMarkenProdukt, type, user?.uid]);

  const picked = useMemo(
    () => nonames.find((p) => p.id === pickedId) ?? nonames[0] ?? null,
    [nonames, pickedId],
  );

  // "Weitere enttarnte Produkte" — gleiche Logik wie auf
  // noname-detail. Ranking nach Name-Ähnlichkeit zum AKTUELL
  // gepickten NoName (das ist die Bezugs-Identität der Page,
  // nicht das Markenprodukt). Ausschluss ist das gepickte NoName
  // selbst — sonst würde es in der eigenen "Weitere"-Liste landen.
  useEffect(() => {
    let alive = true;
    if (!mainProduct) return;
    const excludeId = picked?.id ?? mainProduct.id;
    // ID kommt vorrangig vom expliziten `kategorieId`-Feld das wir
    // in `getMarkenProduktWithDetails` an die Daten anhängen — die
    // populierte `kategorie` enthält nicht zuverlässig eine ID.
    const kategorieId =
      (mainProduct as any).kategorieId ??
      (mainProduct as any).kategorie?.id ??
      (typeof (mainProduct as any).kategorie === 'string'
        ? (mainProduct as any).kategorie
        : null);
    const refName: string | null =
      (picked as any)?.name ?? (mainProduct as any)?.name ?? null;
    const refHandelsmarke: string | null =
      (picked as any)?.handelsmarke?.bezeichnung ??
      (picked as any)?.handelsmarke?.name ??
      null;
    // Deferred via InteractionManager — der Page-Load + Carousel-
    // Animations haben Vorrang vor der unten am Ende sitzenden
    // "Weitere enttarnte Produkte"-Liste.
    const handle = InteractionManager.runAfterInteractions(() => {
      if (!alive) return;
      FirestoreService.getEnttarnteAlternatives(
        {
          excludeProductId: excludeId,
          kategorieId,
          productName: refName,
          handelsmarkeName: refHandelsmarke,
        },
        5,
      )
        .then((items) => {
          if (alive) setAlternatives(items ?? []);
        })
        .catch(() => {
          if (alive) setAlternatives([]);
        });
    });
    return () => {
      alive = false;
      handle.cancel?.();
    };
  }, [mainProduct, picked]);

  // ─── UI state ─────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('ingredients');
  // Inline-tabs follow the project rule: SegmentedTabs (animated pill)
  // visually + PagerView for the swipe-and-native-page-animation
  // mechanic. Because the section sits INSIDE the page's main
  // ScrollView, PagerView needs an explicit height; we measure each
  // tab's content via onLayout and use the larger of the two.
  const tabPagerRef = useRef<PagerView | null>(null);
  const [tabHeights, setTabHeights] = useState<{ ingredients?: number; nutrition?: number }>({});
  const onTabChange = (next: Tab) => {
    setTab(next);
    tabPagerRef.current?.setPage(next === 'ingredients' ? 0 : 1);
  };
  const onTabPagerSelected = (e: { nativeEvent: { position: number } }) => {
    const next: Tab = e.nativeEvent.position === 0 ? 'ingredients' : 'nutrition';
    setTab((prev) => (prev === next ? prev : next));
  };
  const [carouselIdx, setCarouselIdx] = useState(0);
  const carouselRef = useRef<ScrollView | null>(null);
  // FlyToCart wiring — one ref to drive the overlay, plus a Map of
  // product-image refs keyed by productId. We measure the relevant
  // image at "add to cart" time and pass its rect into the overlay.
  const flyRef = useRef<FlyToCartHandle | null>(null);
  const productImageRefs = useRef<Map<string, View | null>>(new Map());
  const setProductImageRef = (productId: string, ref: View | null) => {
    if (ref) productImageRefs.current.set(productId, ref);
    else productImageRefs.current.delete(productId);
  };
  const [favMap, setFavMap] = useState<Record<string, boolean>>({});
  const [cartMap, setCartMap] = useState<Record<string, boolean>>({});
  const [ratingsSheet, setRatingsSheet] = useState<{
    productId: string;
    productName: string;
    isMarke: boolean;
  } | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);

  // ─── Image zoom (Stufe 3/4/5: tap any product photo → fullscreen zoom)
  // Variant choice:
  //   • `bildClean`    (≤512 px WebP, ~10-20 KB)  → on-screen thumb
  //   • `bildCleanPng` (≤1024 px PNG, ~80-150 KB) → zoom view
  //   • `bildCleanHq`  (≤1600 px PNG, ~150-300 KB) → unused (too slow)
  // Using the MID 1024 px PNG for zoom keeps pinch-zoom acceptably
  // sharp through ~3× while loading ~5× faster than the HQ variant.
  // The modal also shows a spinner while the PNG is fetching, so
  // the user gets immediate feedback on tap even if the network is
  // slow.
  //
  // For the open animation: we measure the tapped thumb's window-
  // coordinate rect via `View.measureInWindow` and pass it to the
  // modal as `sourceRect`. The modal then performs a shared-element
  // transition — the picture's bounding rect interpolates from
  // the thumb's exact dimensions to fullscreen, so the morph is
  // pixel-clean (no white flash, no aspect mismatch).
  const [zoomUri, setZoomUri] = useState<string | null>(null);
  const [zoomRect, setZoomRect] = useState<SourceRect | null>(null);
  const openZoom = (
    p:
      | {
          id?: string;
          bildClean?: string | null;
          bildCleanPng?: string | null;
        }
      | undefined
      | null,
  ) => {
    if (!p?.id) return;
    // Prefer the mid PNG variant; fall back to WebP if the product
    // hasn't been re-processed yet (e.g. an older doc still on
    // pre-v8 fields where bildCleanPng might be missing).
    const url = getProductImage(p as any, 'png') ?? getProductImage(p as any);
    if (!url) return;
    const ref = productImageRefs.current.get(p.id);
    if (ref) {
      // measureInWindow → absolute screen coords incl. translucent
      // status-bar offset, which is what the modal needs.
      ref.measureInWindow((x, y, width, height) => {
        setZoomRect({ x, y, width, height });
        setZoomUri(url);
      });
    } else {
      // No measured rect — modal falls back to a soft scale-fade.
      setZoomRect(null);
      setZoomUri(url);
    }
  };
  const closeZoom = () => {
    setZoomUri(null);
    // `zoomRect` is intentionally NOT cleared here — the modal
    // animates 1→0 over ~220 ms and reads zoomRect for the fly-back.
    // Clearing it now would snap the close to a generic fade. The
    // next `openZoom` overwrites it with the next thumb's rect.
  };
  // Bottom "Gute Alternativen" — other brand products from the same category.
  const [alternatives, setAlternatives] = useState<EnttarnteAlternative[]>([]);

  // Scroll tracking — drives the large-title → nav-title fade in the
  // DetailHeader. Everything reads `scrollY.value` from the UI thread,
  // so the animation stays on the native side on both iOS and Android.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // ─── Native "large title" morph ────────────────────────────────────
  // The hero title (brand logo + product name) doesn't get swapped —
  // it IS the nav title. It scrolls naturally with the content until
  // it reaches the nav bar, then docks there: translates to the right
  // of the back button, scales from 26 px → 17 px, and pins.
  // All interpolation runs on the UI thread, so the motion is
  // frame-perfect on iOS and Android. `transformOrigin: 'top left'`
  // keeps scale anchored to the text's top-left so it doesn't drift
  // visually as it shrinks.
  // Hero title sizing — dialled down from 26 → 22 so the hero block no
  // longer feels oversized relative to the rest of the page typography
  // (pack info at 11, prices at 22, Detektiv-Check text at 13). The
  // docked size stays at 17 (iOS nav-title standard), which yields a
  // slightly larger scale factor than before.
  const TITLE_FONT_SIZE = 22;
  const TITLE_LINE_HEIGHT = 26;
  const TITLE_NAV_SIZE = 17;
  const TITLE_SCALE = TITLE_NAV_SIZE / TITLE_FONT_SIZE; // ≈ 0.773
  const TITLE_NAV_LINE_HEIGHT = TITLE_LINE_HEIGHT * TITLE_SCALE; // ≈ 20
  // Restored "Das Original" eyebrow (11 px uppercase) above the hero
  // title — adds 16 px + a 2 px gap + the wrapper's paddingTop of 10.
  const HERO_TOP_IN_CONTENT = 10 + 16 + 2;
  const HERO_SCREEN_Y = insets.top + DETAIL_HEADER_ROW_HEIGHT + HERO_TOP_IN_CONTENT;
  // Vertically centre the docked title in the nav row by subtracting
  // the scaled line-height, not a fixed 24 px. Without this the glyph
  // sits a couple of pixels above the back-button's vertical centre.
  const NAV_SCREEN_Y =
    insets.top + (DETAIL_HEADER_ROW_HEIGHT - TITLE_NAV_LINE_HEIGHT) / 2;
  const DOCK_DISTANCE = HERO_SCREEN_Y - NAV_SCREEN_Y;
  const NAV_LEFT_OFFSET = 36; // hero padding 20 → nav after back btn (56)

  // Reveal-fade — combined with the dock-transform inside the
  // morphTitleStyle worklet so the title fades in at the SAME
  // 320 ms tempo as the hero Crossfade below.
  const morphFade = useSharedValue(0);
  useEffect(() => {
    morphFade.value = withTiming(mainProduct ? 1 : 0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [mainProduct, morphFade]);

  const morphTitleStyle = useAnimatedStyle(() => {
    const s = scrollY.value;
    const t = interpolate(s, [0, DOCK_DISTANCE], [0, 1], Extrapolation.CLAMP);
    // Natural scroll would already move the title up by `s`; we want
    // it to stop at NAV_SCREEN_Y. `translateY = -min(s, DOCK)` means:
    //   • s ≤ DOCK → translate with scroll (visually still = no transform)
    //   • s ≥ DOCK → translate capped → pinned at nav height.
    const translateY = -Math.min(s, DOCK_DISTANCE);
    const translateX = t * NAV_LEFT_OFFSET;
    const scale = 1 - t * (1 - TITLE_SCALE);
    return {
      transform: [{ translateY }, { translateX }, { scale }],
      opacity: morphFade.value,
    };
  });

  const effectiveCardWidth =
    nonames.length <= 1 ? NN_CARD_WIDTH_SINGLE : NN_CARD_WIDTH;
  const snapStep = effectiveCardWidth + NN_CARD_GAP;

  // Scroll carousel to the clicked product on initial load. Re-runs when
  // pickedId changes from outside (e.g. user tapped a different card).
  useEffect(() => {
    if (nonames.length === 0) return;
    const target = nonames.findIndex((p) => p.id === pickedId);
    if (target < 0) return;
    if (target !== carouselIdx) setCarouselIdx(target);
    // Defer to next tick so the ScrollView has laid out.
    requestAnimationFrame(() => {
      carouselRef.current?.scrollTo({
        x: target * snapStep,
        animated: false,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonames.length, pickedId]);

  // Carousel settle handler — runs ONCE when the snap animation
  // finishes, not on every scroll frame. The previous per-frame
  // onScroll handler was the source of the "hakelig" feel: every one
  // of the 60 fps scroll events bridged to JS to read contentOffset.x
  // and potentially fire setState, which is enough to drop frames on
  // Android and low-power iPhones. Switching to onMomentumScrollEnd
  // keeps the scroll itself entirely on the native thread; we only
  // reach into React state once the user has landed on a card.
  const onCarouselMomentumEnd = (e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / snapStep);
    if (i !== carouselIdx && i >= 0 && i < nonames.length) {
      setCarouselIdx(i);
      setPickedId(nonames[i]?.id ?? null);
    }
  };

  // ─── Error branch ─────────────────────────────────────────────────
  // We deliberately do NOT short-circuit the render on `loading` —
  // the rest of the body renders chrome + skeletons until each
  // stage of data lands (heroReady / detailsReady / nonamesReady).
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={theme.textMuted} />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 16,
            color: theme.text,
            marginTop: 12,
            textAlign: 'center',
          }}
        >
          {error ?? 'Produkt nicht verfügbar'}
        </Text>
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => ({
            marginTop: 20,
            height: 44,
            paddingHorizontal: 22,
            borderRadius: radii.full,
            backgroundColor: brand.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: '#fff' }}>
            Zurück
          </Text>
        </Pressable>
      </View>
    );
  }

  // ─── Derived data ─────────────────────────────────────────────────────
  // `mp` is null until the brand product fully resolves; the page
  // chrome and skeleton sections render meanwhile. Live values
  // fade in via `Crossfade` once `mainReady` flips true.
  const mp = mainProduct;
  const brandName =
    (mp?.hersteller as any)?.herstellername
    ?? (mp?.hersteller as any)?.name
    ?? '';
  const brandLogoUri = (mp?.hersteller as any)?.bild as string | undefined;

  const brandPackInfo = mp
    ? formatPack(
        (mp as any).packSize,
        (mp as any).packTypInfo?.typKurz ?? (mp as any).packTypInfo?.typ,
        (mp as any).preis,
      )
    : null;

  const pickedStufe = picked ? parseStufe((picked as any).stufe) : 1;
  const pickedInfo = STUFE_INFO[pickedStufe];

  // ─── Handlers ─────────────────────────────────────────────────────────
  const onToggleFav = async (
    productId: string,
    productType: 'markenprodukt' | 'noname',
    productData: any,
  ) => {
    setFavMap((prev) => ({ ...prev, [productId]: !prev[productId] }));
    try {
      const now = await toggleFavorite(productId, productType, productData);
      if (now) showFavoriteAddedToast(productData?.name ?? 'Produkt');
      else showFavoriteRemovedToast(productData?.name ?? 'Produkt');
    } catch {
      setFavMap((prev) => ({ ...prev, [productId]: !prev[productId] }));
    }
  };

  const onToggleCart = async (
    productId: string,
    productType: 'markenprodukt' | 'noname',
    productData: any,
  ) => {
    if (!user?.uid) {
      showInfoToast('Bitte anmelden');
      return;
    }
    const already = !!cartMap[productId];
    // Optimistisches Toggle der UI, danach Firestore-Sync. Bei Fehler
    // revert.
    setCartMap((prev) => ({ ...prev, [productId]: !already }));

    // Fly-to-cart animation only on the ADD path. Measure the
    // product's image rect (main hero or alt thumbnail) and clone
    // it into the floating cart button. Runs in parallel with the
    // Firestore call.
    // 📊 Analytics — comparison-end with a chosen product (the one
    // the user adds to cart). Only fires on the ADD path; remove
    // doesn't count as resolution. Note: `productId` here is the
    // PICKED product (could be the main brand or any NoName alt),
    // mp.id is the comparison's main product (the entry point).
    if (!already && analytics?.trackComparisonEnd && mp?.id) {
      analytics.trackComparisonEnd(
        mp.id,
        productId, // the product the user actually added to cart
        undefined, // no abandonment — comparison was resolved
      );
    }

    const flyImageUri = getProductImage(productData);
    if (!already && flyImageUri) {
      const imgRef = productImageRefs.current.get(productId);
      if (imgRef) {
        imgRef.measureInWindow((x, y, w, h) => {
          flyRef.current?.fly({
            sourceX: x,
            sourceY: y,
            sourceW: w,
            sourceH: h,
            imageUri: flyImageUri,
          });
        });
      }
    }

    try {
      if (already) {
        // Tatsächlich aus Firestore entfernen — vorher hat der
        // Toggle-Off-Path nur den lokalen State geflippt und beim
        // nächsten Page-Reload tauchte der Eintrag wieder auf.
        await FirestoreService.removeFromShoppingCartByProductId(
          user.uid,
          productId,
          productType === 'markenprodukt',
        );
        // Leading 🗑️ overrides extractEmoji's default ✅ fallback —
        // a green check on a "removed" toast read as confirmation that
        // it had been ADDED, not removed.
        showInfoToast('🗑️ Aus Einkaufsliste entfernt');
      } else {
        await FirestoreService.addToShoppingCart(
          user.uid,
          productId,
          productData?.name ?? 'Produkt',
          productType === 'markenprodukt',
          'comparison',
          { screenName: 'product-comparison' },
          {
            price: productData?.preis ?? 0,
            savings: 0,
          },
        );
        // No toast on single-add — the FlyToCart animation + the
        // cart-icon state flip already make the action self-evident.
        // Toast stays for the favorites BULK action where there's
        // no fly-to-cart hand-off.
      }
    } catch (e) {
      setCartMap((prev) => ({ ...prev, [productId]: already }));
      showInfoToast('Fehler — bitte erneut versuchen');
    }
  };

  const onOpenRatings = async (
    productId: string,
    productName: string,
    isMarke: boolean,
  ) => {
    setRatingsSheet({ productId, productName, isMarke });
    setRatingsLoading(true);
    setRatings([]);
    try {
      const data = await FirestoreService.getProductRatingsWithUserInfo(
        productId,
        !isMarke,
      );
      setRatings(data as any);
    } catch (e) {
      console.warn('ProductComparison: ratings load failed', e);
    } finally {
      setRatingsLoading(false);
    }
  };

  // 📊 Analytics — track comparison-end when the user navigates AWAY
  // from this screen without explicitly resolving the comparison
  // (i.e. without tapping cart-add). Mirrors the OLD behaviour where
  // a comparison-end event was fired on app-close / screen-leave so
  // we can measure abandonment vs. resolution rates in the funnel.
  const handleBack = () => {
    if (analytics?.trackComparisonEnd && mp?.id) {
      analytics.trackComparisonEnd(
        mp.id,
        undefined, // no product picked → abandoned
        'app_closed',
      );
    }
    router.back();
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* BlurView nav bar — back button + "Produktdetails" label that
          fades out as the morph title docks in. We DON'T pass
          scrolledTitle anymore: the product name is a single element
          that physically moves from the hero into the nav bar (see
          `morphTitleStyle` below) — not a second Text that fades in. */}
      {/* swapAt is set to DOCK_DISTANCE so the "Produktdetails" fade-out
          range [swapAt-40, swapAt-10] completes BEFORE the morph title
          reaches the nav bar — otherwise the two briefly stack on top
          of each other right around the dock moment. */}
      <DetailHeader
        title="Produktdetails"
        scrollY={scrollY}
        swapAt={DOCK_DISTANCE}
        onBack={handleBack}
      />

      {/* Morph title — opacity-fades in via morphTitleStyle's
          combined transform+opacity worklet, in lockstep with the
          hero crossfade below. Always mounted so the absolute
          positioning maths stays consistent. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: HERO_SCREEN_Y,
            left: 20,
            right: 20,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            zIndex: 11,
            transformOrigin: 'top left',
          },
          morphTitleStyle,
        ]}
      >
        {brandLogoUri ? (
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              backgroundColor: '#ffffff',
              borderWidth: 0.5,
              borderColor: theme.border,
              overflow: 'hidden',
            }}
          >
            <Image
              source={{ uri: brandLogoUri }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          </View>
        ) : null}
        {/* Dynamische Title-Größe: kurze Titel rendern in voller
            22-px-Größe, lange Titel schrumpfen automatisch bis zur
            Mindestskala (0.65 ≈ 14 px) statt mit "..." abgeschnitten
            zu werden. Native `adjustsFontSizeToFit` von RN. */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.65}
          allowFontScaling={false}
          style={{
            flexShrink: 1,
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: TITLE_FONT_SIZE,
            lineHeight: TITLE_LINE_HEIGHT,
            color: theme.text,
            letterSpacing: -0.3,
          }}
        >
          {mp?.name ?? ''}
        </Text>
      </Animated.View>

      <Animated.ScrollView
        ref={detailScrollRef}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + DETAIL_HEADER_ROW_HEIGHT,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >

        {/* Coachmark-Anchor 'product.hero' wrappt Title-Row UND
            Hero zusammen — Spotlight-Phase 1 hebt damit den ganzen
            "Das Original + Produktname + Hero"-Block hervor. */}
        <View
          ref={heroAnchor.ref}
          onLayout={heroAnchor.onLayout}
          collapsable={false}
        >
        {/* Title row: "Das Original" eyebrow + 28 px slot reserved
            for the morph title (rendered absolutely above). */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.semibold,
              fontSize: 11,
              color: theme.textMuted,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            Das Original
          </Text>
          <View style={{ height: 28, marginTop: 2 }} />
        </View>

        {/* ─── Hero — TOP wave (Crossfade, gated on `mainReady`)
            Skeleton mirrors the live hero exactly: same 240 px
            container, same Hersteller pill at top-left, same
            price pill at bottom-left, same 3 action buttons at
            bottom-right. Shape-equivalence keeps the crossfade
            smooth — looks like "details fill in", not "thing
            morphs". */}
        <Crossfade
          ready={mainReady}
          delay={0}
          duration={320}
          style={{ paddingHorizontal: 20 }}
          skeleton={
            <View
              style={{
                position: 'relative',
                borderRadius: 20,
                overflow: 'hidden',
                backgroundColor: theme.surfaceAlt,
                height: 240,
              }}
            >
              <Shimmer width="100%" height={240} radius={0} />

              {/* Hersteller pill placeholder — neutral grey pill at
                  the same position + dimensions as the real
                  chip. No brand colour during loading. */}
              <Shimmer
                width={140}
                height={26}
                radius={99}
                style={{ position: 'absolute', left: 12, top: 12 }}
              />

              {/* Price pill placeholder — single Shimmer at the same
                  outer dimensions + position as the real price pill. */}
              <Shimmer
                width={96}
                height={56}
                radius={14}
                style={{ position: 'absolute', left: 12, bottom: 12 }}
              />

              {/* Action cluster placeholder — three 48×48 rounded
                  squares matching the live ActionButtons. */}
              <View
                style={{
                  position: 'absolute',
                  right: 12,
                  bottom: 12,
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                {[0, 1, 2].map((i) => (
                  <Shimmer key={i} width={48} height={48} radius={14} />
                ))}
              </View>
            </View>
          }
        >
          {/* Hero-Image-Container — innerer Hero (240 px). Der
              Coachmark-heroAnchor liegt auf dem ÄUSSEREN Wrapper
              (Title-Row + Hero), siehe weiter oben. */}
          <View
            ref={(r) => mp && setProductImageRef(mp.id, r as any)}
            collapsable={false}
            style={{
              position: 'relative',
              borderRadius: 20,
              overflow: 'hidden',
              // theme.surface (siehe noname-detail).
              backgroundColor: theme.surface,
              height: 240,
            }}
          >
            {getProductImage(mp as any, 'png') ? (
              <Pressable
                onPress={() => openZoom(mp)}
                accessibilityRole="imagebutton"
                accessibilityLabel="Bild vergrößern"
                style={{ width: '100%', height: '100%' }}
              >
                <FadingImage
                  source={{ uri: getProductImage(mp as any, 'png') ?? undefined }}
                  resizeMode="contain"
                  placeholderColor={theme.surface}
                />
              </Pressable>
            ) : mainReady ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="package-variant" size={64} color={theme.textMuted} />
              </View>
            ) : null}

            {brandName ? (
              <View
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 12,
                  backgroundColor: brand.primaryDark,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 99,
                  maxWidth: SCREEN_WIDTH - 64,
                  shadowColor: '#000',
                  shadowOpacity: 0.22,
                  shadowOffset: { width: 0, height: 2 },
                  shadowRadius: 6,
                  elevation: 3,
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 13,
                    lineHeight: 16,
                    color: '#fff',
                    letterSpacing: -0.1,
                  }}
                >
                  {brandName}
                </Text>
              </View>
            ) : null}

            {mp ? (
              <View
                style={{
                  position: 'absolute',
                  left: 12,
                  bottom: 12,
                  backgroundColor: 'rgba(255,255,255,0.95)',
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 14,
                  shadowColor: '#000',
                  shadowOpacity: 0.12,
                  shadowOffset: { width: 0, height: 2 },
                  shadowRadius: 8,
                  elevation: 3,
                }}
              >
                {brandPackInfo ? (
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.medium,
                      fontSize: 11,
                      color: '#5c6769',
                    }}
                  >
                    {brandPackInfo}
                  </Text>
                ) : null}
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 22,
                    color: '#191c1d',
                    letterSpacing: -0.4,
                    marginTop: brandPackInfo ? 4 : 0,
                  }}
                >
                  {formatEur((mp as any).preis)}
                </Text>
              </View>
            ) : null}

            {mp ? (
              <View style={{ position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 8 }}>
                <View
                  ref={favAnchor.ref}
                  onLayout={favAnchor.onLayout}
                  collapsable={false}
                >
                  <ActionButton
                    icon={favMap[mp.id] ? 'heart' : 'heart-outline'}
                    iconColor={favMap[mp.id] ? '#e53935' : theme.text}
                    onPress={() => onToggleFav(mp.id, 'markenprodukt', mp)}
                  />
                </View>
                <View
                  ref={cartAnchor.ref}
                  onLayout={cartAnchor.onLayout}
                  collapsable={false}
                >
                  <ActionButton
                    icon={cartMap[mp.id] ? 'cart-check' : 'cart-plus'}
                    iconColor={cartMap[mp.id] ? '#fff' : theme.text}
                    bg={cartMap[mp.id] ? brand.primary : undefined}
                    onPress={() => onToggleCart(mp.id, 'markenprodukt', mp)}
                  />
                </View>
                <View
                  ref={ratingAnchor.ref}
                  onLayout={ratingAnchor.onLayout}
                  collapsable={false}
                >
                  <ActionButton
                    icon="star"
                    iconColor="#f5b301"
                    subLabel={
                      (mp as any).averageRatingOverall
                        ? ((mp as any).averageRatingOverall as number).toFixed(1)
                        : undefined
                    }
                    onPress={() => onOpenRatings(mp.id, mp.name ?? 'Produkt', true)}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </Crossfade>
        </View>{/* /heroAnchor wrapper (Title-Row + Hero) */}

        {/* ─── BOTTOM wave (Crossfade, gated on `nonamesReady`)
            Skeleton mirrors the bottom layout: section header
            placeholder + 2 alternativen-card shapes + tabs pill
            + body card. Renders once the related-products query
            lands (≈ 200-400 ms after mainReady). The natural
            Firestore round-trip delta creates the visible "top
            first, bottom second" cascade with no artificial
            delay needed. */}
        <Crossfade
          ready={nonamesReady}
          delay={0}
          duration={320}
          skeleton={
            <View>
              {/* Section header placeholder */}
              <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
                <Shimmer width="70%" height={20} radius={6} />
              </View>
              {/* Two alternativen-card placeholders matching the
                  live carousel card shape (NN_CARD_WIDTH × variable
                  height). */}
              <View
                style={{
                  flexDirection: 'row',
                  paddingHorizontal: 20,
                  paddingTop: 12,
                  gap: NN_CARD_GAP,
                }}
              >
                {[0, 1].map((i) => (
                  <View
                    key={i}
                    style={{
                      width: NN_CARD_WIDTH,
                      backgroundColor: theme.surface,
                      borderRadius: 18,
                      padding: 12,
                      ...shadows.md,
                    }}
                  >
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Shimmer width={76} height={76} radius={10} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <Shimmer width={90} height={11} radius={3} />
                        <Shimmer width="100%" height={14} radius={4} />
                        <Shimmer width="80%" height={14} radius={4} />
                      </View>
                    </View>
                    <View
                      style={{
                        height: 1,
                        backgroundColor: theme.border,
                        marginVertical: 12,
                      }}
                    />
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'flex-end',
                        justifyContent: 'space-between',
                      }}
                    >
                      <View style={{ gap: 6 }}>
                        <Shimmer width={80} height={10} radius={3} />
                        <Shimmer width={70} height={20} radius={4} />
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Shimmer width={48} height={48} radius={14} />
                        <Shimmer width={48} height={48} radius={14} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
              {/* Tabs skeleton — same SegmentedTabs height + body card
                  shape as the live tabs section. */}
              <View style={{ marginHorizontal: 20, marginTop: 24 }}>
                <View
                  style={{
                    height: 44,
                    borderRadius: 999,
                    backgroundColor: theme.surfaceAlt,
                    marginBottom: 16,
                    flexDirection: 'row',
                    padding: 4,
                    gap: 4,
                  }}
                >
                  <View style={{ flex: 1, borderRadius: 999, backgroundColor: theme.surface }} />
                  <View style={{ flex: 1, borderRadius: 999 }} />
                </View>
                <View
                  style={{
                    backgroundColor: theme.surface,
                    borderRadius: 14,
                    padding: 16,
                    gap: 8,
                    ...shadows.sm,
                  }}
                >
                  <Shimmer height={12} radius={4} />
                  <Shimmer width="92%" height={12} radius={4} />
                  <Shimmer width="78%" height={12} radius={4} />
                  <Shimmer width="55%" height={12} radius={4} />
                </View>
              </View>
            </View>
          }
        >
          <View>
        {nonames.length > 0 ? (
          // Coachmark-Anchor 'product.context' wrappt die ganze
          // Alternativen-Section: Section-Header + Carousel + Dots
          // + Detektiv-Check-Stufe-Zeile. User-Feedback: "erweitere
          // den fokus auch auf die stufe des produktes".
          <View
            ref={contextAnchor.ref}
            onLayout={contextAnchor.onLayout}
            collapsable={false}
          >
            <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 20,
                  lineHeight: 24,
                  color: theme.text,
                  letterSpacing: -0.2,
                }}
              >
                Alternativen vom gleichen Hersteller
              </Text>
            </View>

            <View style={{ position: 'relative' }}>
            <ScrollView
              ref={carouselRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollsToTop={false}
              snapToInterval={snapStep}
              decelerationRate="fast"
              scrollEnabled={nonames.length > 1}
              contentContainerStyle={{
                paddingHorizontal: 20,
                gap: NN_CARD_GAP,
                paddingTop: 12,
                paddingBottom: 4,
              }}
              onMomentumScrollEnd={onCarouselMomentumEnd}
              // decelerationRate="fast" (already set) lands the snap
              // quickly; no per-frame scroll event needed.
            >
              {nonames.map((nn, i) => {
                const isActive = i === carouselIdx;
                const sv = savings(mainProduct as any, nn as any);
                const nnHm = (nn as any).handelsmarke as
                  | { bezeichnung?: string; name?: string; bild?: string }
                  | undefined;
                const nnDisc = (nn as any).discounter as
                  | { name?: string; color?: string; bild?: string }
                  | undefined;
                const hmName = nnHm?.bezeichnung ?? nnHm?.name ?? null;
                // Handelsmarken rarely carry a logo in our DB — prefer the
                // (always-populated) discounter logo first and fall back to
                // any handelsmarke logo that does exist.
                const hmLogo = nnDisc?.bild ?? nnHm?.bild ?? null;
                const nnPackParts = formatPackParts(
                  (nn as any).packSize,
                  (nn as any).packTypInfo?.typKurz ?? (nn as any).packTypInfo?.typ,
                  (nn as any).preis,
                );
                return (
                  <Pressable
                    key={nn.id}
                    onPress={() => {
                      setPickedId(nn.id);
                      carouselRef.current?.scrollTo({
                        x: i * snapStep,
                        animated: true,
                      });
                    }}
                    style={({ pressed }) => ({
                      width: effectiveCardWidth,
                      backgroundColor: theme.surface,
                      borderRadius: 18,
                      borderWidth: 2,
                      borderColor: isActive ? brand.primary : 'transparent',
                      overflow: 'hidden',
                      opacity: pressed ? 0.94 : 1,
                      ...shadows.md,
                    })}
                  >
                    {/* Savings-Badge — top-right corner. Wird nur
                        gezeigt wenn echte Ersparnis > 0 vorliegt
                        (calculateSavings returned 0 wenn NoName
                        per-Unit teurer wäre — Markups blenden wir
                        aus, sauberere UX). */}
                    {sv.pct > 0 ? (
                      <View
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          backgroundColor: brand.primary,
                          paddingVertical: 7,
                          paddingHorizontal: 12,
                          borderTopRightRadius: 16,
                          borderBottomLeftRadius: 14,
                          zIndex: 2,
                          shadowColor: brand.primary,
                          shadowOpacity: 0.35,
                          shadowOffset: { width: 0, height: 4 },
                          shadowRadius: 10,
                          elevation: 3,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily,
                            fontWeight: fontWeight.extraBold,
                            fontSize: 11,
                            color: '#fff',
                            letterSpacing: 0.2,
                          }}
                        >
                          −{sv.pct}%
                        </Text>
                      </View>
                    ) : null}

                    <View style={{ flexDirection: 'row', padding: 12, gap: 12, alignItems: 'stretch' }}>
                      {/* Thumb — 76×76 so its height roughly matches the
                          info block (eyebrow + 2-line name + pack row +
                          StufenChips). Slightly bigger than the old
                          60×60 reads as a more substantial product tile
                          next to the text, which was the point of the
                          "passt zur höhe"-request. */}
                      <View
                        ref={(r) => setProductImageRef(nn.id, r as any)}
                        collapsable={false}
                        style={{
                          width: 76,
                          height: 76,
                          borderRadius: 10,
                          overflow: 'hidden',
                          // theme.surface — pure white im Light Mode,
                          // dunkel im Dark Mode.
                          backgroundColor: theme.surface,
                        }}
                      >
                        {getProductImage(nn as any) ? (
                          <Pressable
                            onPress={(e) => {
                              // Inner Pressable wins over the card-
                              // level "set picked" tap → opens zoom
                              // for THIS NoName's HQ image.
                              e.stopPropagation?.();
                              openZoom(nn as any);
                            }}
                            accessibilityRole="imagebutton"
                            accessibilityLabel="Bild vergrößern"
                            style={{ width: '100%', height: '100%' }}
                          >
                            <FadingImage
                              source={{ uri: getProductImage(nn as any) ?? undefined }}
                              resizeMode="contain"
                              placeholderColor={theme.surface}
                            />
                          </Pressable>
                        ) : (
                          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                            <MaterialCommunityIcons
                              name="package-variant-closed"
                              size={28}
                              color={theme.textMuted}
                            />
                          </View>
                        )}
                      </View>
                      {/* Info column — deliberately lean:
                            1) Handelsmarke eyebrow (market logo + name)
                            2) Product name (up to 3 lines since there's
                               nothing else below to compete for space)
                          Stufe display moved to the Detektiv-Check row
                          below the carousel. Pack + Grundpreis moved
                          down to the price area so they stay visually
                          tied to the price itself. */}
                      <View
                        style={{
                          flex: 1,
                          minWidth: 0,
                          paddingRight: sv.pct > 0 ? 50 : 0,
                        }}
                      >
                        {/* Handelsmarke eyebrow — ALWAYS pinned to the
                            top of the info column so the market-logo +
                            Eigenmarke name stay in the same position
                            across every card, regardless of how long
                            the product name below is. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          {hmLogo ? (
                            <View
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: 4,
                                backgroundColor: '#fff',
                                overflow: 'hidden',
                                borderWidth: 0.5,
                                borderColor: theme.border,
                              }}
                            >
                              <Image
                                source={{ uri: hmLogo }}
                                style={{ width: '100%', height: '100%' }}
                                resizeMode="contain"
                              />
                            </View>
                          ) : (
                            <View
                              style={{
                                width: 16,
                                height: 16,
                                borderRadius: 4,
                                backgroundColor: nnDisc?.color ?? theme.surfaceAlt,
                              }}
                            />
                          )}
                          <Text
                            numberOfLines={1}
                            style={{
                              flex: 1,
                              fontFamily,
                              fontWeight: fontWeight.bold,
                              fontSize: 11,
                              color: theme.primary,
                              letterSpacing: 0.3,
                              textTransform: 'uppercase',
                            }}
                          >
                            {hmName ?? 'Eigenmarke'}
                          </Text>
                        </View>
                        {/* Produktname sitzt direkt unter dem Eyebrow
                            (flex-start, NICHT mehr center). Vorher ließ
                            justifyContent:'center' einen 1-zeiligen
                            Namen mittig in der freien Höhe schweben →
                            unschöner Whitespace zwischen Handelsmarke
                            und Titel. Mit flex-start dockt der Titel
                            sauber an, mehrzeilige Namen wachsen einfach
                            nach unten. */}
                        <View style={{ flex: 1, justifyContent: 'flex-start', marginTop: 6 }}>
                          <Text
                            numberOfLines={3}
                            style={{
                              fontFamily,
                              fontWeight: fontWeight.bold,
                              fontSize: 14,
                              lineHeight: 18,
                              color: theme.text,
                            }}
                          >
                            {(nn as any).name}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />

                    {/* Pack info lives directly above the price at full
                        card width — the "Grundpreis gehört zum Preis"
                        principle, but on its own line so it doesn't
                        fight the action cluster for horizontal space.
                        Size · Grundpreis as one row, comma-separated.
                        Font deliberately matches the Markenprodukt's
                        pack line byte-for-byte (11 px medium, brand
                        grey #5c6769) so the two screens feel like
                        they're speaking the same typographic language
                        when the user compares prices across them. */}
                    {nnPackParts ? (
                      <Text
                        numberOfLines={1}
                        style={{
                          fontFamily,
                          fontWeight: fontWeight.medium,
                          fontSize: 11,
                          color: '#5c6769',
                          paddingHorizontal: 14,
                          // Vorher 10 — User-Feedback: "abstand zwischen
                          // packpreis und preis ist bei den unteren
                          // cards größer als bei der oberen". Hero-Pill
                          // hat compactes paddingVertical:8 + marginTop:4.
                          // Hier 6 above pack + 0 zwischen pack/price-Row
                          // bringt die visuelle Dichte in Einklang.
                          paddingTop: 6,
                        }}
                      >
                        {nnPackParts.unitPrice
                          ? `${nnPackParts.sizeLabel} · ${nnPackParts.unitPrice}`
                          : nnPackParts.sizeLabel}
                      </Text>
                    ) : null}

                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 14,
                        // 2 → 0 wenn Pack-Text drüber, sodass der Gap
                        // pack→price minimal ist (matched die Hero-
                        // Pill-Compactness).
                        paddingTop: nnPackParts ? 0 : 12,
                        gap: 10,
                      }}
                    >
                      <Text
                        style={{
                          flex: 1,
                          fontFamily,
                          fontWeight: fontWeight.extraBold,
                          fontSize: 22,
                          color: brand.primary,
                          letterSpacing: -0.3,
                        }}
                      >
                        {formatEur((nn as any).preis)}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <ActionButton
                          icon={favMap[nn.id] ? 'heart' : 'heart-outline'}
                          iconColor={favMap[nn.id] ? '#e53935' : theme.text}
                          onPress={() => onToggleFav(nn.id, 'noname', nn)}
                        />
                        <ActionButton
                          icon={cartMap[nn.id] ? 'cart-check' : 'cart-plus'}
                          iconColor={cartMap[nn.id] ? '#fff' : theme.text}
                          bg={cartMap[nn.id] ? brand.primary : undefined}
                          onPress={() => onToggleCart(nn.id, 'noname', nn)}
                        />
                        <ActionButton
                          icon="star"
                          iconColor="#f5b301"
                          subLabel={
                            (nn as any).averageRatingOverall
                              ? ((nn as any).averageRatingOverall as number).toFixed(1)
                              : undefined
                          }
                          onPress={() => onOpenRatings(nn.id, (nn as any).name ?? 'Produkt', false)}
                        />
                      </View>
                    </View>

                    {/* Per-Card-Stufe-Row — gated by STUFE_IN_CARD am
                        Modul-Top. Wenn aktiviert, zeigt jede Alt-Card
                        ihre eigene Stufe + One-Line-Label. Die globale
                        Detektiv-Check-Row unter dem Carousel wird dann
                        ausgeblendet (siehe `!STUFE_IN_CARD && picked`
                        weiter unten). */}
                    {STUFE_IN_CARD ? (() => {
                      const nnStufe = parseStufe((nn as any).stufe);
                      const nnInfo = STUFE_INFO[nnStufe];
                      return (
                        <View>
                          <View
                            style={{
                              height: 1,
                              backgroundColor: theme.border,
                              marginHorizontal: 14,
                            }}
                          />
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'flex-start',
                              gap: 8,
                              paddingHorizontal: 14,
                              paddingVertical: 10,
                            }}
                          >
                            <View style={{ marginTop: 2 }}>
                              <StufenChips stufe={nnStufe} size="sm" />
                            </View>
                            {/* Bold-Label + graue Description in einem
                                Text-Composite — analog zur ehemaligen
                                globalen Detektiv-Check-Row, jetzt nur
                                kompakter (fontSize 11 statt 13) damit
                                die Card-Höhe nicht ausartet. */}
                            <Text
                              style={{
                                flex: 1,
                                fontFamily,
                                fontWeight: fontWeight.medium,
                                fontSize: 11,
                                lineHeight: 15,
                                color: theme.textSub,
                              }}
                            >
                              <Text
                                style={{
                                  fontWeight: fontWeight.bold,
                                  color: theme.text,
                                }}
                              >
                                Stufe {nnStufe} — {nnInfo.label}.
                              </Text>{' '}
                              {nnInfo.line}
                            </Text>
                          </View>
                        </View>
                      );
                    })() : null}
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Left-edge fade + chevron — mirror of the right-edge
                affordance. Shown whenever there's a card to the LEFT
                of the current index, so the user can see (and tap)
                their way back through the carousel. */}
            {nonames.length > 1 && carouselIdx > 0 ? (
              <>
                <LinearGradient
                  pointerEvents="none"
                  colors={[
                    theme.bg,
                    (theme.bg as string).endsWith(')')
                      ? theme.bg
                      : `${theme.bg}00`,
                  ]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 4,
                    width: 48,
                  }}
                />
                <Pressable
                  onPress={() => {
                    const prev = Math.max(carouselIdx - 1, 0);
                    carouselRef.current?.scrollTo({
                      x: prev * snapStep,
                      animated: true,
                    });
                  }}
                  style={({ pressed }) => ({
                    position: 'absolute',
                    top: '50%',
                    left: 10,
                    marginTop: -18,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.85 : 1,
                    shadowColor: '#000',
                    shadowOpacity: 0.15,
                    shadowOffset: { width: 0, height: 4 },
                    shadowRadius: 12,
                    elevation: 4,
                  })}
                  hitSlop={4}
                >
                  <MaterialCommunityIcons name="chevron-left" size={22} color={theme.text} />
                </Pressable>
              </>
            ) : null}

            {/* Right-edge fade + chevron — only when there are more cards
                to the right of the current index (matches prototype). */}
            {nonames.length > 1 && carouselIdx < nonames.length - 1 ? (
              <>
                <LinearGradient
                  pointerEvents="none"
                  colors={[
                    (theme.bg as string).endsWith(')')
                      ? theme.bg
                      : `${theme.bg}00`,
                    theme.bg,
                  ]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 4,
                    width: 48,
                  }}
                />
                <Pressable
                  onPress={() => {
                    const next = Math.min(carouselIdx + 1, nonames.length - 1);
                    carouselRef.current?.scrollTo({
                      x: next * snapStep,
                      animated: true,
                    });
                  }}
                  style={({ pressed }) => ({
                    position: 'absolute',
                    top: '50%',
                    right: 10,
                    marginTop: -18,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: theme.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.85 : 1,
                    shadowColor: '#000',
                    shadowOpacity: 0.15,
                    shadowOffset: { width: 0, height: 4 },
                    shadowRadius: 12,
                    elevation: 4,
                  })}
                  hitSlop={4}
                >
                  <MaterialCommunityIcons name="chevron-right" size={22} color={theme.text} />
                </Pressable>
              </>
            ) : null}
            </View>

            {/* Dot indicator */}
            {nonames.length > 1 ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                  marginTop: 10,
                }}
              >
                {nonames.map((_, i) => {
                  const active = i === carouselIdx;
                  return (
                    <View
                      key={i}
                      style={{
                        width: active ? 18 : 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: active ? brand.primary : theme.borderStrong,
                      }}
                    />
                  );
                })}
              </View>
            ) : null}

            {/* Detektiv-Check row — directly below the active NoName card so
                the stufe explanation reads as context for the carousel pick
                rather than as a global footer.
                Bei aktivem STUFE_IN_CARD-Flag (Modul-Top) wird diese
                globale Row ausgeblendet, weil dann jede Alt-Card ihre
                eigene Stufe inline trägt. */}
            {!STUFE_IN_CARD && picked ? (
              <View
                style={{
                  marginHorizontal: 20,
                  marginTop: 16,
                  padding: 14,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  backgroundColor: theme.surfaceAlt,
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                {/* StufenChips (same component as the Stöbern grid) so
                    the similarity indicator lives in EXACTLY one place
                    per screen — the Detektiv-Check row — and looks the
                    same everywhere it appears. */}
                <View style={{ marginTop: 3 }}>
                  <StufenChips stufe={pickedStufe} size="md" />
                </View>
                {/* Short stufe info: label bold + one-line explanation
                    from STUFE_INFO, plus Hersteller. This is the single
                    place on the detail page where the user sees what
                    the stufe actually MEANS, so the short sentence is
                    genuinely useful here — unlike on the cards where
                    the colour + bars already carry the info. */}
                <Text
                  style={{
                    flex: 1,
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 13,
                    lineHeight: 18,
                    color: theme.textSub,
                  }}
                >
                  <Text style={{ fontWeight: fontWeight.bold, color: theme.text }}>
                    Stufe {pickedStufe} — {pickedInfo.label}.
                  </Text>{' '}
                  {pickedInfo.line}
                  {(picked as any)?.hersteller?.name ? (
                    <>
                      {' '}
                      Hersteller:{' '}
                      <Text style={{ fontWeight: fontWeight.bold, color: theme.text }}>
                        {(picked as any).hersteller.name}
                      </Text>
                      .
                    </>
                  ) : null}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View
            style={{
              margin: 20,
              padding: 16,
              borderRadius: 14,
              backgroundColor: theme.surfaceAlt,
              flexDirection: 'row',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <MaterialCommunityIcons name="information-outline" size={22} color={theme.textMuted} />
            <Text
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                lineHeight: 18,
                color: theme.textSub,
              }}
            >
              Noch keine Eigenmarken-Alternative in unserer Datenbank. Scann den
              Kassenbon bei deinem nächsten Einkauf — du hilfst, die Lücke zu
              füllen.
            </Text>
          </View>
        )}

        {/* ─── Tabs: Inhaltsstoffe / Nährwerte ─────────────────────
            Inside the same bottom Crossfade — the tabs reveal in
            the same wave as the carousel above so the eye sees one
            top→bottom fade-in. Only mounted when `mp` is non-null
            (IngredientsMatch / NutritionTable both require a non-
            null brandProduct).
            Bei Non-Food-Kategorien (Drogerie, Haushalt, Kosmetik,
            Tier, …) macht weder "Inhaltsstoffe" (= Zutaten) noch
            "Nährwerte" Sinn → Tabs werden ausgeblendet. */}
        {mp && !isNonFoodCategory(
          (mp as any)?.kategorie?.bezeichnung ?? (mp as any)?.kategorie?.name ?? null,
        ) ? (
          <>
            <View style={{ marginHorizontal: 20, marginTop: 24 }}>
              <SegmentedTabs
                tabs={[
                  { key: 'ingredients', label: 'Inhaltsstoffe' },
                  { key: 'nutrition', label: 'Nährwerte' },
                ] as const}
                value={tab}
                onChange={onTabChange}
              />
            </View>

            {/* PagerView height = the larger of the two pages' measured
                heights. Falls back to a minHeight while we wait for the
                first onLayout, so the screen doesn't jump from 0 → real
                on first paint. */}
            <PagerView
              ref={tabPagerRef}
              style={{
                height: Math.max(
                  tabHeights.ingredients ?? 0,
                  tabHeights.nutrition ?? 0,
                  280,
                ),
              }}
              initialPage={0}
              onPageSelected={onTabPagerSelected}
            >
              <View
                key="ingredients"
                onLayout={(e) => {
                  // PagerView on the new architecture occasionally fires
                  // onLayout with a null nativeEvent.layout while it
                  // recycles pages — guard so we don't crash on
                  // `null.height`.
                  const h = e?.nativeEvent?.layout?.height;
                  if (typeof h !== 'number') return;
                  setTabHeights((prev) =>
                    prev.ingredients === h ? prev : { ...prev, ingredients: h },
                  );
                }}
              >
                <IngredientsMatch brandProduct={mp} noname={picked} theme={theme} />
              </View>
              <View
                key="nutrition"
                onLayout={(e) => {
                  const h = e?.nativeEvent?.layout?.height;
                  if (typeof h !== 'number') return;
                  setTabHeights((prev) =>
                    prev.nutrition === h ? prev : { ...prev, nutrition: h },
                  );
                }}
              >
                <NutritionTable
                  brandProduct={mp}
                  noname={picked}
                  theme={theme}
                  primary={brand.primary}
                />
              </View>
            </PagerView>
          </>
        ) : null}
          </View>
        </Crossfade>

        {/* ─── Weitere enttarnte Produkte ──────────────────────────
            Vertikale Liste, identisch zur Section auf der
            noname-detail-Seite (Stufe 1/2). Zeigt andere NoName-
            Produkte derselben Kategorie mit Stufe 3/4/5 — also
            solche, die einen echten Markenprodukt-Vergleich
            verlinkt haben. Tap führt direkt zum Vergleichs-Pfad,
            mit `replace` damit der Back-Stack flach bleibt
            (Fan-Out-Exploration, kein Drill-Down). */}
        <EnttarnteAlternativesList
          items={alternatives}
          onItemPress={(altId) => {
            FirestoreService.prefetchComparisonData(altId, false);
            router.replace(
              `/product-comparison/${altId}?type=noname` as any,
            );
          }}
        />

        <View style={{ height: 24 }} />
      </Animated.ScrollView>

      {/* Ratings sheet — opened from any star ActionButton. Shared for both
          the main brand product and the currently picked NoName via the
          ratingsSheet state carrying {productId, productName, isMarke}. */}
      <RatingsSheet
        visible={!!ratingsSheet}
        onClose={() => setRatingsSheet(null)}
        productName={ratingsSheet?.productName ?? ''}
        ratings={ratings}
        loading={ratingsLoading}
        showSimilarity={!ratingsSheet?.isMarke}
        onSubmit={async (r: SubmittedRating) => {
          if (!user?.uid || !ratingsSheet) {
            showInfoToast('Bitte anmelden');
            throw new Error('not-authenticated');
          }
          const now = new Date();
          await FirestoreService.addProductRating({
            userID: user.uid,
            productID: ratingsSheet.isMarke ? null : ratingsSheet.productId,
            brandProductID: ratingsSheet.isMarke ? ratingsSheet.productId : null,
            ratingOverall: r.ratingOverall,
            ratingPriceValue: r.ratingPriceValue ?? null,
            ratingTasteFunction: r.ratingTasteFunction ?? null,
            ratingContent: r.ratingContent ?? null,
            ratingSimilarity: r.ratingSimilarity ?? null,
            comment: r.comment ?? null,
            ratedate: now,
            updatedate: now,
          });

          // 🎯 Gamification: track `submit_rating` after the rating
          // is persisted. Fire-and-forget — failures must not
          // affect the rating UX.
          achievementService
            .trackAction(user.uid, 'submit_rating', {
              productId: ratingsSheet.productId,
              productName: ratingsSheet.productName,
              productType: ratingsSheet.isMarke ? 'markenprodukt' : 'noname',
              rating: r.ratingOverall,
              commentLength: (r.comment || '').length,
            })
            .catch((err) => {
              console.warn('submit_rating trackAction failed', err);
            });

          // Refresh the list so the new review shows up.
          try {
            const refreshed = await FirestoreService.getProductRatingsWithUserInfo(
              ratingsSheet.productId,
              !ratingsSheet.isMarke,
            );
            setRatings(refreshed as any);

            // Optimistic local average — patcht das passende
            // Produkt-State-Objekt damit der ⭐-ActionButton-SubLabel
            // sofort die neue Bewertung reflektiert. Vorher zog der
            // SubLabel aus dem Firestore-aggregierten Feld
            // `averageRatingOverall`, das clientseitig stale blieb
            // bis Cloud-Function-Aggregat lief + Reload. User-
            // Regression: "die bewertungsanzeige aktualisiert sich
            // nicht, das ging in der alten version noch".
            const overalls = (refreshed as Rating[])
              .map((r) => r.ratingOverall)
              .filter((v): v is number => typeof v === 'number');
            const avg =
              overalls.length > 0
                ? overalls.reduce((a, b) => a + b, 0) / overalls.length
                : undefined;
            if (ratingsSheet.isMarke) {
              setMainProduct((prev) =>
                prev
                  ? ({ ...prev, averageRatingOverall: avg } as any)
                  : prev,
              );
            } else {
              setNonames((prev) =>
                prev.map((n) =>
                  n.id === ratingsSheet.productId
                    ? ({ ...n, averageRatingOverall: avg } as any)
                    : n,
                ),
              );
            }
          } catch {
            /* non-fatal */
          }
        }}
      />

      {/* Schwebender Einkaufszettel-FAB. Detail-Seite ohne Tab-Bar
          → nur safe-area-bottom + 20 px Atemraum. */}
      <FloatingShoppingListButton bottomOffset={insets.bottom + 20} />

      {/* Fly-to-cart overlay — clones the tapped product image and
          animates it into the floating cart button. Mounted last so
          it sits visually on top of the FAB at landing time. */}
      <FlyToCart ref={flyRef} />

      {/* ProductDetail-Walkthrough — Welcome-Card + Spotlights.
          Gleiche Tour-Key 'product-detail' wie noname-detail.
          CoachmarkScrollProvider gibt der Spotlight-Engine den
          ScrollView-Ref → Scroll wird gesperrt während Spotlight
          aktiv ist. */}
      <CoachmarkScrollProvider
        scrollY={scrollY}
        scrollViewRef={detailScrollRef}
      >
        <ProductDetailWalkthrough
          visible={detailCoachmark.visible}
          onDismiss={detailCoachmark.dismiss}
          screenType="comparison"
        />
      </CoachmarkScrollProvider>

      {/* Fullscreen image zoom (pinch / pan / double-tap / swipe-down).
          Highest in the tree → sits above the FAB and any sheets.
          Shared-element transition flies the image from the tapped
          thumbnail to centre and back. */}
      <ImageZoomModal
        visible={!!zoomUri}
        uri={zoomUri}
        sourceRect={zoomRect}
        onClose={closeZoom}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

type ActionButtonProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconColor: string;
  /** Override the default white background (e.g. filled primary for the
   *  "on cart" state). Border is dropped automatically when `bg` is set. */
  bg?: string;
  subLabel?: string;
  onPress?: () => void;
};

function ActionButton({ icon, iconColor, bg, subLabel, onPress }: ActionButtonProps) {
  const { theme } = useTokens();
  const filled = !!bg;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 14,
        backgroundColor: bg ?? theme.surface,
        borderWidth: filled ? 0 : 1,
        borderColor: theme.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.88 : 1,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 6,
        elevation: 2,
      })}
    >
      <MaterialCommunityIcons name={icon} size={subLabel ? 14 : 22} color={iconColor} />
      {subLabel ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 11,
            lineHeight: 13,
            color: filled ? '#fff' : theme.text,
            marginTop: 2,
          }}
        >
          {subLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

function IngredientsMatch({
  brandProduct,
  noname,
  theme,
}: {
  brandProduct: MarkenProduktWithDetails;
  noname: ProductWithDetails | null;
  theme: ReturnType<typeof useTokens>['theme'];
}) {
  const brandIngredients = String(
    (brandProduct as any).zutaten ?? (brandProduct as any).moreInformation?.zutaten ?? '',
  ).trim();
  const nonameIngredients = String(
    (noname as any)?.zutaten ?? (noname as any)?.moreInformation?.zutaten ?? '',
  ).trim();

  return (
    <View style={{ marginHorizontal: 20, marginTop: 18 }}>
      {brandIngredients ? (
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: 14,
            padding: 16,
            marginBottom: nonameIngredients ? 12 : 0,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 11,
              color: theme.textMuted,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Original
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.regular,
              fontSize: 13,
              lineHeight: 19,
              color: theme.text,
            }}
          >
            {brandIngredients}
          </Text>
        </View>
      ) : null}
      {nonameIngredients ? (
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: 14,
            padding: 16,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 11,
              color: theme.textMuted,
              letterSpacing: 1,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Eigenmarke
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.regular,
              fontSize: 13,
              lineHeight: 19,
              color: theme.text,
            }}
          >
            {nonameIngredients}
          </Text>
        </View>
      ) : null}
      {!brandIngredients && !nonameIngredients ? (
        <View
          style={{
            backgroundColor: theme.surfaceAlt,
            borderRadius: 14,
            padding: 18,
            alignItems: 'center',
          }}
        >
          <MaterialCommunityIcons name="food-off-outline" size={28} color={theme.textMuted} />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.textMuted,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            Für dieses Produkt sind noch keine Zutaten hinterlegt.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function NutritionTable({
  brandProduct,
  noname,
  theme,
  primary,
}: {
  brandProduct: MarkenProduktWithDetails;
  noname: ProductWithDetails | null;
  theme: ReturnType<typeof useTokens>['theme'];
  primary: string;
}) {
  const rows: Array<[string, string, string]> = [];
  const brandN =
    (brandProduct as any).naehrwerte ?? (brandProduct as any).moreInformation ?? {};
  const nonameN =
    (noname as any)?.naehrwerte ?? (noname as any)?.moreInformation ?? {};

  const pushRow = (label: string, a: any, b: any, suffix = '') => {
    const av = a == null || a === '' ? null : a;
    const bv = b == null || b === '' ? null : b;
    if (av == null && bv == null) return;
    const fmt = (v: any) =>
      v == null ? '—' : typeof v === 'number' ? `${v}${suffix}` : String(v);
    rows.push([label, fmt(av), fmt(bv)]);
  };

  pushRow('Energie', brandN.brennwertKcal ?? brandN.energie, nonameN.brennwertKcal ?? nonameN.energie, ' kcal');
  pushRow('Fett', brandN.fett, nonameN.fett, ' g');
  pushRow('davon gesättigt', brandN.gesaettigteFettsaeuren ?? brandN.gesaettigt, nonameN.gesaettigteFettsaeuren ?? nonameN.gesaettigt, ' g');
  pushRow('Kohlenhydrate', brandN.kohlenhydrate, nonameN.kohlenhydrate, ' g');
  pushRow('davon Zucker', brandN.zucker, nonameN.zucker, ' g');
  pushRow('Eiweiß', brandN.eiweiss ?? brandN.eiweis, nonameN.eiweiss ?? nonameN.eiweis, ' g');
  pushRow('Salz', brandN.salz, nonameN.salz, ' g');

  if (rows.length === 0) {
    return (
      <View style={{ marginHorizontal: 20, marginTop: 18 }}>
        <View
          style={{
            backgroundColor: theme.surfaceAlt,
            borderRadius: 14,
            padding: 18,
            alignItems: 'center',
          }}
        >
          <MaterialCommunityIcons name="nutrition" size={28} color={theme.textMuted} />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.textMuted,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            Keine Nährwertangaben verfügbar.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 18,
        backgroundColor: theme.surface,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 6,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 11,
            color: theme.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          pro 100g
        </Text>
        <Text
          style={{
            width: 80,
            textAlign: 'right',
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 11,
            color: theme.text,
          }}
        >
          Original
        </Text>
        <Text
          style={{
            width: 80,
            textAlign: 'right',
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 11,
            color: primary,
            marginLeft: 6,
          }}
        >
          Eigenmarke
        </Text>
      </View>
      {rows.map(([label, a, b], i) => (
        <View
          key={label}
          style={{
            flexDirection: 'row',
            paddingVertical: 10,
            borderBottomWidth: i < rows.length - 1 ? 1 : 0,
            borderBottomColor: theme.border,
          }}
        >
          <Text
            style={{
              flex: 1,
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.text,
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              width: 80,
              textAlign: 'right',
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: theme.text,
            }}
          >
            {a}
          </Text>
          <Text
            style={{
              width: 80,
              textAlign: 'right',
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: primary,
              marginLeft: 6,
            }}
          >
            {b}
          </Text>
        </View>
      ))}
    </View>
  );
}
