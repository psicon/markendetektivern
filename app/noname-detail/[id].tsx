import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { usePressLock } from '@/lib/hooks/usePressLock';
import { FadingImage } from '@/components/design/FadingImage';
import { CounterBadge } from '@/components/design/CounterBadge';
import { FlyToCart, type FlyToCartHandle } from '@/components/design/FlyToCart';
import { QuantityPill } from '@/components/design/QuantityPill';
import { MorphingCartButton } from '@/components/design/MorphingCartButton';
import { FloatingShoppingListButton } from '@/components/design/FloatingShoppingListButton';
import { getProductImage } from '@/lib/utils/productImage';
import { RatingsSheet, type Rating, type SubmittedRating } from '@/components/design/RatingsSheet';
import {
  EnttarnteAlternativesList,
  type EnttarnteAlternative,
} from '@/components/design/EnttarnteAlternativesList';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { StufenChips } from '@/components/design/StufenChips';
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
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useCoachmark } from '@/hooks/useCoachmark';
import { useCoachmarkAnchor } from '@/hooks/useCoachmarkAnchor';
import { useOpenFoodFallback } from '@/hooks/useOpenFoodFallback';
import { useTokens } from '@/hooks/useTokens';
import {
  extractEans,
  extractIngredients,
  extractNaehrwerte,
  hasIngredients,
  hasNaehrwerte,
  mergeNaehrwerte,
  type NaehrwerteShape,
} from '@/lib/utils/productNutrition';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useFavorites } from '@/lib/hooks/useFavorites';
import achievementService from '@/lib/services/achievementService';
import { FirestoreService } from '@/lib/services/firestore';
import { isNonFoodCategory } from '@/lib/utils/categoryClassification';
import {
  showFavoriteAddedToast,
  showFavoriteRemovedToast,
  showInfoToast,
  showRetryableErrorToast,
} from '@/lib/services/ui/toast';
import type { ProductWithDetails } from '@/lib/types/firestore';

// ────────────────────────────────────────────────────────────────────────

type Tab = 'ingredients' | 'nutrition';

// Stufen-Texte für die "Detektiv-Check"-Zeile auf Stufe-1/2-
// Detail-Seiten. Wortlaut deckungsgleich zum Stöbern-Filter
// (`app/(tabs)/explore.tsx` STUFE_INFO) und zum
// `SimilarityStagesModal`, damit der User in jedem Kontext denselben
// Satz liest. Wenn der Wortlaut sich ändert, dort mitziehen.
const STUFE_INFO: Record<1 | 2, { label: string; line: string }> = {
  2: {
    label: 'Markenhersteller',
    line: 'Liefert auch Marken — aber kein vergleichbares Produkt.',
  },
  1: {
    label: 'NoName-Hersteller',
    line: 'Produziert ausschließlich Handelsmarken.',
  },
};

const parseStufe = (s: any): 1 | 2 | 3 | 4 | 5 => {
  const n = parseInt(String(s)) || 1;
  return Math.min(5, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5;
};

const formatEur = (v?: number | null) =>
  v == null ? '—' : `${v.toFixed(2).replace('.', ',')}€`;

function formatPack(size?: number, unit?: string, price?: number): string | null {
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
  return unitPrice ? `${sizeLabel} · ${unitPrice}` : sizeLabel;
}

// ────────────────────────────────────────────────────────────────────────
// Screen — Orphan NoName (no brand product linked) per prototype
// `ProductDetailOrphan`. Stufe 1 & 2 land here because they don't have a
// meaningful comparison target.
// ────────────────────────────────────────────────────────────────────────

export default function NoNameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows } = useTokens();
  const { user } = useAuth();
  const { toggleFavorite, isFavorite } = useFavorites();

  // ─── Coachmark Walkthrough ───────────────────────────────────
  // Tour 'product-detail' fires beim ersten Aufruf einer Detail-
  // Seite. Anchors sitzen unten auf den drei ActionButtons in der
  // Hero-Bottom-Right-Cluster. ScrollView-Ref braucht's für den
  // Scroll-Lock während Spotlights aktiv sind (siehe SpotlightOverlay).
  const detailCoachmark = useCoachmark('product-detail');
  const heroAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_HERO);
  const cartAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_CART);
  const favAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_FAVORITE);
  const ratingAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_RATING);
  // Auf noname-detail zeigt der Context-Anchor auf die Detektiv-
  // Check-Zeile (Stufe + Erklärungstext) — der zeigt die Stufe
  // visuell und bietet sich als "Hier wird's konzeptionell
  // erklärt"-Anker an.
  const contextAnchor = useCoachmarkAnchor(PRODUCT_DETAIL_ANCHOR_CONTEXT);
  const detailScrollRef = useRef<ScrollView>(null);

  // ─── Data state ──────────────────────────────────────────────────
  // One fetch, one state slot. We deliberately wait for the FULL
  // joined product before flipping `ready` — multiple staggered
  // pops felt janky. The reveal is then orchestrated visually:
  // top section crossfades in immediately, bottom section
  // crossfades in 150 ms later via `Crossfade(delay=…)`. The
  // DetailHeader chrome renders on the first frame regardless.
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductWithDetails | null>(null);
  const ready = !!product;

  const [tab, setTab] = useState<Tab>('ingredients');
  // SegmentedTabs nur — KEIN PagerView. Embedded-Tabs in einer
  // parent-ScrollView dürfen den vertikalen Scroll nicht abfangen
  // (siehe CLAUDE.md → "Tab switches" Ausnahme-Regel).
  // Hero image container ref + FlyToCart imperative handle. The
  // hero ref is measured at "add-to-cart" time (measureInWindow),
  // its rect feeds into FlyToCart.fly() which clones the image and
  // animates it into the floating shopping-list button bottom-right.
  const heroRef = useRef<View | null>(null);
  const flyRef = useRef<FlyToCartHandle | null>(null);
  const onTabChange = (next: Tab) => {
    collapseCartPill();
    setTab(next);
  };
  const [isFav, setIsFav] = useState(false);
  // Sync isFav mit echtem Server-Status sobald die productId bekannt
  // ist. Vorher: useState(false) initial → Heart blieb leer auch wenn
  // das Produkt schon gefavt war → Tap zeigte "Toggled" (gefüllt)
  // mit Toast "Entfernt" → User-Verwirrung.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await isFavorite(id, 'noname');
        if (!cancelled) setIsFav(status);
      } catch {
        // swallow — heart bleibt im default-state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isFavorite]);
  const [inCart, setInCart] = useState(false);
  // NEU (2026-05-07): Cart-Anzahl + Pill-Anchor (Position des Cart-Buttons)
  const [cartAnzahl, setCartAnzahl] = useState(0);
  // Tracking ob die MorphingCartButton-Pill grade expanded ist
  // (für zIndex/elevation auf dem Wrapper-View damit der + sichtbar
  // bleibt über dem star-ActionButton).
  const [cartPillExpanded, setCartPillExpanded] = useState(false);
  const [pillAnchor, setPillAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const pillOpen = pillAnchor !== null;
  const setPillOpen = (open: boolean) => {
    if (!open) setPillAnchor(null);
  };
  const cartButtonAnchorRef = useRef<View | null>(null);
  // Auto-Close-Timer + smoother exit (Pill bleibt mounted für Animation)
  const [pillVisible, setPillVisible] = useState(false);
  const pillAutoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pillUnmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closePill = useCallback(() => {
    setPillVisible(false);
    if (pillUnmountTimer.current) clearTimeout(pillUnmountTimer.current);
    pillUnmountTimer.current = setTimeout(() => setPillAnchor(null), 320);
  }, []);
  const armPillAutoClose = useCallback(() => {
    if (pillAutoCloseTimer.current) clearTimeout(pillAutoCloseTimer.current);
    pillAutoCloseTimer.current = setTimeout(closePill, 4000);
  }, [closePill]);
  useEffect(() => {
    if (pillOpen) {
      if (pillUnmountTimer.current) clearTimeout(pillUnmountTimer.current);
      setPillVisible(true);
      armPillAutoClose();
    }
    return () => {
      if (pillAutoCloseTimer.current) clearTimeout(pillAutoCloseTimer.current);
    };
  }, [pillOpen, armPillAutoClose]);

  // ─── Cart-Status bei Focus refreshen (Back-Navigation aus Einkaufszettel) ───
  const refreshCartState = useCallback(async () => {
    if (!user?.uid || !id) return;
    try {
      const items = await FirestoreService.getShoppingCartItems(user.uid);
      let total = 0;
      for (const it of items as any[]) {
        const pid = it?.handelsmarkenProdukt?.id;
        if (pid === String(id)) total += (it.anzahl ?? 1) as number;
      }
      setCartAnzahl(total);
      setInCart(total > 0);
    } catch (err) {
      console.warn('[cart] refresh noname-detail failed:', err);
    }
  }, [user?.uid, id]);
  // Focus-Reload (zurück aus Einkaufszettel)
  useFocusEffect(
    useCallback(() => {
      refreshCartState();
    }, [refreshCartState]),
  );
  // Plus initial load wenn id/user wechselt
  useEffect(() => {
    refreshCartState();
  }, [refreshCartState]);
  const [ratingsOpen, setRatingsOpen] = useState(false);
  // Connected Brands des Herstellers — separat geladen, weil das
  // Aggregat im Cloud-Function-Job (`connected-brands-aggregator`)
  // ein anderes Refresh-Intervall hat als das Produkt selbst.
  const [connectedBrands, setConnectedBrands] = useState<
    Array<{
      id: string;
      name: string;
      bild: string | null;
      source: 'direct' | 'via-markenprodukt';
    }>
  >([]);
  // "Weitere enttarnte Produkte" am Seitenende — andere NoName-
  // Produkte aus derselben Kategorie, gefiltert auf Stufe 3/4/5
  // (= solche, die einen echten Markenprodukt-Vergleich verlinkt
  // haben). Bei Stufe 1/2 ist das die wichtigste Discovery-Brücke,
  // weil das aktuelle Produkt selber keinen Vergleich anbieten kann.
  const [alternatives, setAlternatives] = useState<EnttarnteAlternative[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);

  const scrollY = useSharedValue(0);
  // Collapse-Signal-Counter für die MorphingCartButton-Pill: jeder
  // Increment kollabiert die expanded Pill (z.B. bei Scroll, bei Tap
  // auf heart oder star). Verwendet einen Counter statt boolean
  // damit auch bei zwei aufeinanderfolgenden Scrolls die Pill jedes-
  // mal closed wird (boolean toggle würde zwischen true/false
  // wechseln statt forced collapse).
  const [pillCollapseSignal, setPillCollapseSignal] = useState(0);
  const collapseCartPill = useCallback(() => {
    setPillCollapseSignal((n) => n + 1);
  }, []);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
    onBeginDrag: () => {
      // Pill schließen wenn User anfängt zu scrollen.
      runOnJS(collapseCartPill)();
    },
  });

  // ─── Native "large title" morph ────────────────────────────────────
  // Hero title sized 22 px (down from 26) and line-height 26 so the
  // header block reads proportional to the rest of the page. Docked
  // size stays at 17 px (iOS nav-title standard). NAV_SCREEN_Y now
  // accounts for the scaled line-height, so the glyph centres on the
  // nav row vertically instead of sitting a few px above centre.
  const TITLE_FONT_SIZE = 22;
  const TITLE_LINE_HEIGHT = 26;
  const TITLE_NAV_SIZE = 17;
  const TITLE_SCALE = TITLE_NAV_SIZE / TITLE_FONT_SIZE;
  const TITLE_NAV_LINE_HEIGHT = TITLE_LINE_HEIGHT * TITLE_SCALE;
  // paddingTop (10) + placeholder marginTop (2) = 12 of empty space
  // above the title before it starts.
  const HERO_TOP_IN_CONTENT = 12;
  const HERO_SCREEN_Y = insets.top + DETAIL_HEADER_ROW_HEIGHT + HERO_TOP_IN_CONTENT;
  const NAV_SCREEN_Y =
    insets.top + (DETAIL_HEADER_ROW_HEIGHT - TITLE_NAV_LINE_HEIGHT) / 2;
  const DOCK_DISTANCE = HERO_SCREEN_Y - NAV_SCREEN_Y;
  const NAV_LEFT_OFFSET = 36;

  // Reveal-fade — opacity sharedValue driven by `ready`. Combined
  // with the dock-transform inside one worklet so the morph title
  // fades in at the SAME 320 ms tempo as the hero Crossfade below.
  const morphFade = useSharedValue(0);
  useEffect(() => {
    morphFade.value = withTiming(product ? 1 : 0, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [product, morphFade]);

  const morphTitleStyle = useAnimatedStyle(() => {
    const s = scrollY.value;
    const t = interpolate(s, [0, DOCK_DISTANCE], [0, 1], Extrapolation.CLAMP);
    const translateY = -Math.min(s, DOCK_DISTANCE);
    const translateX = t * NAV_LEFT_OFFSET;
    const scale = 1 - t * (1 - TITLE_SCALE);
    return {
      transform: [{ translateY }, { translateX }, { scale }],
      opacity: morphFade.value,
    };
  });

  useEffect(() => {
    let alive = true;
    setError(null);
    setProduct(null);
    (async () => {
      try {
        const data = await FirestoreService.getProductWithDetails(String(id));
        if (!alive) return;
        if (!data) {
          setError('Produkt nicht gefunden');
          return;
        }
        setProduct(data);

        // 🎯 Gamification: track `view_comparison` once the
        // product loads. This action also triggers the
        // `first_action_any` achievement on the user's first
        // visit. Fire-and-forget — must not block the screen.
        if (user?.uid) {
          achievementService
            .trackAction(user.uid, 'view_comparison', {
              productId: String(id),
              productType: 'noname',
            })
            .catch((err) => {
              console.warn('view_comparison trackAction failed', err);
            });
        }
      } catch (e) {
        if (!alive) return;
        console.warn('NoNameDetail: load failed', e);
        setError('Fehler beim Laden');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Initial-Load des Cart-Status. Ohne diesen useEffect startet
  // Initial-Load des Cart-Status — wird ersetzt durch
  // refreshCartState() in useFocusEffect + useEffect weiter unten.
  // Dieses useEffect bleibt für den Fall dass user/id geändert wurden
  // aber Screen schon gemountet war (= refreshCartState wird über
  // dessen useCallback-deps neu erstellt).
  useEffect(() => {
    let alive = true;
    if (!user?.uid || !id) {
      setInCart(false);
      setCartAnzahl(0);
      return;
    }
    // Det-ID-Doc lesen — analog zur neuen Cart-Schema-v2.
    FirestoreService.getShoppingCartItems(user.uid)
      .then((items) => {
        if (!alive) return;
        let total = 0;
        for (const it of items as any[]) {
          const pid = it?.handelsmarkenProdukt?.id;
          if (pid === String(id)) {
            total += (it.anzahl ?? 1) as number;
          }
        }
        setCartAnzahl(total);
        setInCart(total > 0);
      })
      .catch(() => {
        if (alive) {
          setInCart(false);
          setCartAnzahl(0);
        }
      });
    return () => {
      alive = false;
    };
  }, [id, user?.uid]);

  // Connected Brands separat laden, sobald wir die Hersteller-ID
  // vom Produkt haben. Bewusst ENTKOPPELT vom Product-Cache, damit
  // ein zwischenzeitlich gelaufener Aggregator-Job direkt sichtbar
  // wird (siehe Kommentar in firestore.ts → getProductWithDetails).
  // Service-seitig: 30 Min Cache pro Hersteller-ID, 45 s Empty-Cache
  // → der nächste App-Tap auf dasselbe Produkt nach Aggregator-Run
  // findet die Brands.
  const herstellerIdForFetch = (product as any)?.herstellerId ?? null;
  useEffect(() => {
    let alive = true;
    if (!herstellerIdForFetch) {
      setConnectedBrands([]);
      return;
    }
    FirestoreService.getConnectedBrandsForHersteller(herstellerIdForFetch)
      .then((brands) => {
        if (alive) setConnectedBrands(brands ?? []);
      })
      .catch(() => {
        if (alive) setConnectedBrands([]);
      });
    return () => {
      alive = false;
    };
  }, [herstellerIdForFetch]);

  // "Weitere enttarnte Produkte" — Kategorie-Pool wird gegen den
  // Namen des aktuellen Produkts gerankt. Toastbrot zeigt zuerst
  // andere Toastbrote, dann andere Brote, dann Rest-Kategorie.
  // ID kommt vom expliziten `kategorieId`-Field das wir in
  // `getProductWithDetails` an die Daten anhängen — die populierte
  // `kategorie` enthält nur den Inhalt (bezeichnung/bild), keine ID.
  const categoryIdForAlternatives: string | null =
    (product as any)?.kategorieId ??
    (product?.kategorie as any)?.id ??
    null;
  useEffect(() => {
    let alive = true;
    if (!product?.id) {
      setAlternatives([]);
      return;
    }
    // Deferred via InteractionManager — der Page-Load (Hero, Tabs,
    // Stufen-Card) hat Vorrang. Die "Weitere enttarnte Produkte"-
    // Section sitzt am unteren Ende und ist nicht-blockierend, also
    // dürfen wir warten bis Animations + Gestures durch sind.
    const handle = InteractionManager.runAfterInteractions(() => {
      if (!alive) return;
      FirestoreService.getEnttarnteAlternatives(
        {
          excludeProductId: product.id,
          kategorieId: categoryIdForAlternatives,
          productName: (product as any)?.name ?? null,
          handelsmarkeName:
            (product as any)?.handelsmarke?.bezeichnung ??
            (product as any)?.handelsmarke?.name ??
            null,
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
  }, [product?.id, categoryIdForAlternatives]);

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
          onPress={() => router.back()}
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
  // `p` is null until the full joined product lands; the page
  // chrome and skeleton sections render meanwhile. All derived
  // values use optional chaining so the first paint with `p === null`
  // doesn't crash; the live values fade in via `Crossfade` once
  // `ready` flips true.
  const p = product as any;
  const stufe = p ? parseStufe(p.stufe) : 1;
  // Marken des Herstellers — kommt vom Service als zusätzliches Feld
  // `herstellerBrands` mitgeladen (siehe getProductWithDetails).
  // Bei Stufe 2 zeigen wir die als kleine Pills, damit der User
  // sieht "der Hersteller dieses NoNames produziert auch X, Y, Z".
  // Defensive: leer-Array wenn kein Hersteller / keine Marken.
  // Connected-Brands kommen aus dem `connectedBrands`-State weiter
  // oben (separat geladen via `useEffect` + `getConnectedBrandsFor
  // Hersteller`). Hier nur die Stufen-Info-Vorbereitung.
  // Only stufes 1-2 have an orphan-specific one-liner; higher stufes
  // fall back to a generic line because they shouldn't really land here.
  const stufeInfo =
    stufe in STUFE_INFO
      ? STUFE_INFO[stufe as 1 | 2]
      : { label: 'Eigenmarke', line: 'Zu diesem Produkt ist aktuell kein Markenoriginal hinterlegt.' };

  const disc = p?.discounter as
    | { name?: string; color?: string; bild?: string; land?: string }
    | undefined;
  const hm = p?.handelsmarke as
    | { bezeichnung?: string; name?: string; bild?: string }
    | undefined;
  const handelsmarkeName = hm?.bezeichnung ?? hm?.name ?? null;
  const herstellerName =
    p?.hersteller?.name ?? p?.hersteller?.herstellername ?? null;
  const categoryName = p?.kategorie?.bezeichnung ?? p?.kategorie?.name ?? null;
  // Non-Food (Drogerie, Haushalt, Kosmetik, Tier, …): hier sind
  // weder Inhaltsstoffe (im Sinne von Zutaten) noch Nährwerte
  // sinnvoll — Tabs werden komplett ausgeblendet.
  const hideFoodTabs = isNonFoodCategory(categoryName);

  // ─── OpenFoodFacts Fallback (ClickUp 86c9qg2y2 für Stufe 1/2) ──
  // Wenn Firestore die zutaten/naehrwerte nicht hat, holen wir die
  // per EAN von OpenFoodFacts. extractEans probiert alle bekannten
  // EAN-Felder (EAN, EANs[], gtin, …) in Reihenfolge, der Service
  // checkt sequentiell, 1. Treffer wins.
  const productEans = extractEans(p);
  const productHasZutaten = hasIngredients(p);
  const productHasNaehrwerte = hasNaehrwerte(p);
  const openFoodFallback = useOpenFoodFallback({
    // Nutzen das brand-Slot — semantisch egal, wir haben nur EIN
    // Produkt auf diesem Screen. Der noname-Slot bleibt null.
    brand: p
      ? {
          eans: productEans,
          hasZutaten: productHasZutaten,
          hasNaehrwerte: productHasNaehrwerte,
        }
      : null,
    noname: null,
  });
  // showTabsSection: nur rendern wenn IRGENDETWAS für Zutaten ODER
  // Nährwerte vorhanden ist (Firestore ODER OpenFood). Während
  // OpenFood lädt, NICHT optimistic zeigen — sonst pop-Bug wie in
  // Stufe-3/4/5 vorher.
  const hasAnyZutatenForP =
    productHasZutaten || Boolean(openFoodFallback.brand?.zutaten);
  const hasAnyNaehrwerteForP =
    productHasNaehrwerte || Boolean(openFoodFallback.brand?.naehrwerte);
  const hasAnyDataForP = hasAnyZutatenForP || hasAnyNaehrwerteForP;
  // Container sichtbar während OpenFood lädt (zeigt Shimmer drin)
  // ODER wenn Daten da sind. Final no-data → Container faded smooth
  // weg via Reanimated FadeOut.
  const showFoodTabsSection = openFoodFallback.loading || hasAnyDataForP;
  // Per-Tab Visibility (User-Wunsch 2026-05-17): Tab-Pill nur zeigen
  // wenn dessen Daten existieren. Wenn nur Naehrwerte gefunden →
  // SegmentedTabs ausblenden, Naehrwerte-Inhalt direkt zeigen.
  // Wenn nur Inhaltsstoffe → analog.
  const showBothTabs = hasAnyZutatenForP && hasAnyNaehrwerteForP;

  // Auto-switch: wenn der gerade aktive Tab leer ist aber der andere
  // Daten hat → automatisch auf den nicht-leeren wechseln.
  useEffect(() => {
    if (tab === 'ingredients' && !hasAnyZutatenForP && hasAnyNaehrwerteForP) {
      setTab('nutrition');
    } else if (tab === 'nutrition' && !hasAnyNaehrwerteForP && hasAnyZutatenForP) {
      setTab('ingredients');
    }
  }, [tab, hasAnyZutatenForP, hasAnyNaehrwerteForP]);

  // Dev-Diag (Babel transform-remove-console entfernt das im Release).
  if (p) {
    console.log('[NoName-Detail Gates]', {
      productName: (p as any)?.name ?? '(unbenannt)',
      productEans,
      productHasZutaten,
      productHasNaehrwerte,
      openFoodLoading: openFoodFallback.loading,
      openFoodHit: Boolean(openFoodFallback.brand),
      showFoodTabsSection,
    });
  }

  const packInfo = p
    ? formatPack(
        p.packSize,
        p.packTypInfo?.typKurz ?? p.packTypInfo?.typ,
        p.preis,
      )
    : null;

  const rating = (p?.averageRatingOverall as number | undefined)?.toFixed(1);

  // ─── Handlers ─────────────────────────────────────────────────────────
  // All handlers bail early if the basic product hasn't landed yet;
  // the action buttons render disabled-skeleton circles in that
  // state so this should never actually fire, but we guard anyway.
  const onFavPress = usePressLock(async () => {
    if (!p) return;
    // Optimistic toggle — UI flippt sofort.
    const optimisticNext = !isFav;
    setIsFav(optimisticNext);
    try {
      const now = await toggleFavorite(p.id, 'noname', p);
      // Server-Truth sync: falls das initiale isFav state stale war
      // (z.B. der User hat das Produkt auf einer anderen Page entfavt
      // und kommt dann hier rein), korrigieren wir hier.
      setIsFav(now);
      if (now) showFavoriteAddedToast(p.name ?? 'Produkt');
      else showFavoriteRemovedToast(p.name ?? 'Produkt');
    } catch (e) {
      // Bei Fehler: optimistisches Toggle revert + Retry-Toast.
      console.error('Favorite toggle failed:', e);
      setIsFav(!optimisticNext);
      showRetryableErrorToast(
        optimisticNext
          ? 'Favorit konnte nicht gespeichert werden.'
          : 'Favorit konnte nicht entfernt werden.',
        () => onFavPress(),
      );
    }
  });
  // NEU (2026-05-07): Cart-Tap-Logik:
  //   - Wenn schon im Cart (anzahl > 0): nur Pill öffnen, kein +1
  //   - Wenn nicht im Cart (anzahl = 0): +1 + Pill öffnen + FlyToCart
  const onCartPress = usePressLock(async () => {
    if (!p) return;
    if (!user?.uid) {
      showInfoToast('Bitte anmelden');
      return;
    }
    const prev = cartAnzahl;

    // Pill am Button positionieren (egal ob Add oder nur Open)
    const openPillAtButton = () => {
      if (cartButtonAnchorRef.current && (cartButtonAnchorRef.current as any).measureInWindow) {
        (cartButtonAnchorRef.current as any).measureInWindow(
          (x: number, y: number, w: number, h: number) => {
            setPillAnchor({ x, y, w, h });
          },
        );
      } else {
        setPillAnchor({ x: 0, y: 0, w: 0, h: 0 });
      }
    };

    // Schon im Cart → nur Pill öffnen
    if (prev > 0) {
      openPillAtButton();
      return;
    }

    // Erstes Mal: ADD
    const next = prev + 1;
    setCartAnzahl(next);
    setInCart(true);
    openPillAtButton();

    // FlyToCart-Animation immer beim initialem Add (prev === 0)
    const flyImageUri = getProductImage(p);
    if (heroRef.current && flyImageUri) {
      heroRef.current.measureInWindow((x, y, w, h) => {
        flyRef.current?.fly({
          sourceX: x,
          sourceY: y,
          sourceW: w,
          sourceH: h,
          imageUri: flyImageUri,
        });
      });
    }

    try {
      await FirestoreService.addToShoppingCart(
        user.uid,
        p.id,
        p.name ?? 'Produkt',
        false,
        'comparison',
        { screenName: 'noname-detail' },
        { price: p.preis ?? 0, savings: 0 },
      );
    } catch (e) {
      console.error('Cart add failed:', e);
      setCartAnzahl(prev);
      setInCart(prev > 0);
      showRetryableErrorToast(
        'Konnte nicht zum Einkaufszettel hinzufügen.',
        () => onCartPress(),
      );
    }
  });

  const onIncrementFromPill = async () => {
    if (!p || !user?.uid) return;
    const prev = cartAnzahl;
    setCartAnzahl(prev + 1);

    // FlyToCart-Animation auch beim Increment via Pill
    const flyImageUri = getProductImage(p);
    if (heroRef.current && flyImageUri) {
      heroRef.current.measureInWindow((x, y, w, h) => {
        flyRef.current?.fly({
          sourceX: x,
          sourceY: y,
          sourceW: w,
          sourceH: h,
          imageUri: flyImageUri,
        });
      });
    }

    try {
      await FirestoreService.addToShoppingCart(
        user.uid,
        p.id,
        p.name ?? 'Produkt',
        false,
        'comparison',
        { screenName: 'noname-detail' },
        { price: p.preis ?? 0, savings: 0 },
      );
    } catch (e) {
      console.error('Cart increment failed:', e);
      setCartAnzahl(prev);
      showRetryableErrorToast(
        'Anzahl konnte nicht aktualisiert werden.',
        () => {
          void onIncrementFromPill();
        },
      );
    }
  };

  const onDecrementFromPill = async () => {
    if (!p || !user?.uid || cartAnzahl <= 0) return;
    const prev = cartAnzahl;
    const next = prev - 1;
    setCartAnzahl(next);
    if (next === 0) {
      setInCart(false);
      closePill(); // mit Exit-Animation
    }
    try {
      await FirestoreService.decrementCartQuantity(
        user.uid,
        p.id,
        false,
        prev,
        next === 0
          ? {
              productId: p.id,
              productName: p.name ?? 'Produkt',
              productType: 'noname',
            }
          : undefined,
      );
      if (next === 0) showInfoToast('🗑️ Aus Einkaufsliste entfernt', 'ERROR');
    } catch (e) {
      console.error('Cart decrement failed:', e);
      setCartAnzahl(prev);
      setInCart(prev > 0);
      showRetryableErrorToast(
        'Anzahl konnte nicht aktualisiert werden.',
        () => {
          void onDecrementFromPill();
        },
      );
    }
  };
  const [existingRating, setExistingRating] = useState<Rating | null>(null);
  const onRatingsPress = async () => {
    if (!p) return;
    setRatingsOpen(true);
    setRatingsLoading(true);
    setRatings([]);
    setExistingRating(null);
    try {
      // Parallel: alle Ratings für die Liste-View + die ggf.
      // existierende Rating dieses Users für den Submit-Prefill.
      const [data, mine] = await Promise.all([
        FirestoreService.getProductRatingsWithUserInfo(p.id, true),
        user?.uid
          ? FirestoreService.getUserRatingForProduct(user.uid, p.id, true)
          : Promise.resolve(null),
      ]);
      setRatings(data as any);
      setExistingRating((mine ?? null) as Rating | null);
    } catch (e) {
      console.warn('NoNameDetail: ratings load failed', e);
    } finally {
      setRatingsLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* swapAt = DOCK_DISTANCE so the "Produktdetails" fade-out finishes
          before the morph title docks (otherwise they overlap in the nav
          bar for a brief window around the dock moment). */}
      <DetailHeader
        title="Produktdetails"
        scrollY={scrollY}
        swapAt={DOCK_DISTANCE}
        onBack={() => router.back()}
      />

      {/* Morph title — opacity is driven by morphTitleStyle's
          `opacity` field (combined with the dock transform in the
          same worklet) so the reveal is a smooth fade-in instead
          of a sudden mount. Always mounted; the text reads
          empty before data arrives but is invisible at opacity 0. */}
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
        {(disc?.bild ?? (hm as any)?.bild) ? (
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
              source={{ uri: disc?.bild ?? (hm as any)?.bild }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          </View>
        ) : null}
        {/* Dynamische Title-Größe: kurze Titel rendern in voller
            22-px-Größe, lange Titel schrumpfen automatisch bis zur
            Mindestskala (0.65 ≈ 14 px) statt mit "..." abgeschnitten
            zu werden. `adjustsFontSizeToFit` macht das nativ in RN.
            Der Scale-Transform aus `morphTitleStyle` schichtet sich
            sauber drauf — bei langen Titeln ist der gedockte Stand
            entsprechend kleiner, aber immer lesbar. */}
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
          {handelsmarkeName ? `${handelsmarkeName} ` : ''}
          {p?.name ?? ''}
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
        {/* Coachmark-Anchor 'product.hero' wrappt Title-Slot UND
            Hero zusammen — Spotlight-Phase 1 hebt damit das gesamte
            "Was wird hier gezeigt?"-Block hervor (DAS ORIGINAL /
            DAS NoName + Produktname + Hero-Karte). User-Feedback:
            "erweitere den Fokus auch auf den Produktnamen und 'Das
            Original'". */}
        <View
          ref={heroAnchor.ref}
          onLayout={heroAnchor.onLayout}
          collapsable={false}
        >
        {/* Title slot — 28 px reserves vertical space so the morph
            title (rendered absolutely above) lands at HERO_SCREEN_Y
            before the rest of the content below. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
          <View style={{ height: 28, marginTop: 2 }} />
        </View>

        {/* ─── Hero — TOP wave (Crossfade, delay 0)
            Skeleton SHAPES match the live hero exactly: same
            240 px container, same Hersteller chip pill at
            top-left, same price pill at bottom-left, same 3
            action buttons at bottom-right. With matching shapes
            the crossfade reads as "details fill in", not "thing
            morphs". Duration 320 ms, single shared value
            (skeleton 1→0 + content 0→1 sum to opacity 1 every
            frame → constant brightness, no muddy mid-frame). */}
        <Crossfade
          ready={ready}
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
              {/* Image skeleton — fills the entire hero slot */}
              <Shimmer width="100%" height={240} radius={0} />

              {/* Hersteller chip placeholder — neutral grey pill at
                  the SAME position + dimensions as the real chip
                  (top-left, padded 6/12, radius 99). No brand
                  colour during loading; just a calm grey shape so
                  the page reads as "loading", not "promotional". */}
              <Shimmer
                width={140}
                height={26}
                radius={99}
                style={{ position: 'absolute', left: 12, top: 12 }}
              />

              {/* Price pill placeholder — single Shimmer at the same
                  outer dimensions + position as the real white
                  price pill (rounded rect, ~96 × 56). */}
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
              (Title + Hero), siehe weiter oben. */}
          <View
            ref={heroRef}
            collapsable={false}
            style={{
              position: 'relative',
              borderRadius: 20,
              overflow: 'hidden',
              // theme.surface = pure white im Light Mode, dunkel im
              // Dark Mode. Damit ist der Bereich hinter dem
              // freigestellten Produktfoto themen-konsistent.
              backgroundColor: theme.surface,
              height: 240,
            }}
          >
            {getProductImage(p, 'png') ? (
              <FadingImage
                source={{ uri: getProductImage(p, 'png') ?? undefined }}
                resizeMode="contain"
                placeholderColor={theme.surface}
              />
            ) : ready ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="package-variant" size={64} color={theme.textMuted} />
              </View>
            ) : null}

            {/* Hersteller chip — top-left */}
            {herstellerName ? (
              <View
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 12,
                  backgroundColor: brand.primaryDark,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 99,
                  maxWidth: '80%',
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
                  {herstellerName}
                </Text>
              </View>
            ) : null}

            {/* Price pill bottom-left */}
            {p ? (
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
                {packInfo ? (
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.medium,
                      fontSize: 11,
                      color: '#5c6769',
                    }}
                  >
                    {packInfo}
                  </Text>
                ) : null}
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 22,
                    color: '#191c1d',
                    letterSpacing: -0.4,
                    marginTop: packInfo ? 4 : 0,
                  }}
                >
                  {formatEur(p?.preis)}
                </Text>
              </View>
            ) : null}

            {/* Action cluster bottom-right.
                Jeder Button ist in ein <View> mit
                useCoachmarkAnchor-Ref/onLayout gewickelt damit der
                ProductDetailWalkthrough-Spotlight den jeweiligen
                Button targeten kann. Die Wrapper-Views sind
                visuell unsichtbar (kein Padding/Margin), nur
                measureInWindow + onLayout machen ihren Job. */}
            {p ? (
              <View style={{ position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 8 }}>
                <View
                  ref={favAnchor.ref}
                  onLayout={favAnchor.onLayout}
                  collapsable={false}
                >
                  <ActionButton
                    icon={isFav ? 'heart' : 'heart-outline'}
                    iconColor={isFav ? '#e53935' : theme.text}
                    onPress={() => {
                      collapseCartPill();
                      onFavPress();
                    }}
                  />
                </View>
                <View
                  ref={(el) => {
                    cartAnchor.ref.current = el as any;
                    cartButtonAnchorRef.current = el;
                  }}
                  onLayout={cartAnchor.onLayout}
                  collapsable={false}
                  // zIndex/elevation hochziehen wenn Cart-Pill
                  // expanded ist — sonst überlagert der star-
                  // ActionButton (siblingschwester rechts) das +.
                  style={{
                    zIndex: cartPillExpanded ? 100 : 1,
                    elevation: cartPillExpanded ? 24 : 2,
                  }}
                >
                  <MorphingCartButton
                    anzahl={cartAnzahl}
                    onAddToCart={onCartPress}
                    onIncrement={onIncrementFromPill}
                    onDecrement={onDecrementFromPill}
                    onExpansionChange={setCartPillExpanded}
                    collapseSignal={pillCollapseSignal}
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
                    subLabel={rating}
                    onPress={() => {
                      collapseCartPill();
                      onRatingsPress();
                    }}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </Crossfade>
        </View>{/* /heroAnchor wrapper (Title + Hero) */}

        {/* ─── BOTTOM wave (Crossfade, delay 150 ms)
            Skeleton mirrors the bottom layout exactly: same info-
            card surface + radius + padding + divider, same tabs
            pill + body card, same stufe-row surfaceAlt with
            S-letter / dots / text positions. Shape-equivalence
            across the crossfade keeps the transition smooth. The
            150 ms delay creates a clear "top first, then bottom"
            cascade — small enough that the two reveals overlap
            (so it reads as one wave, not two pops). */}
        <Crossfade
          ready={ready}
          delay={150}
          duration={320}
          skeleton={
            <View>
              {/* Info card skeleton — same surface + radius + padding +
                  shadow + divider as the live card. Shimmer occupies
                  the value column at the same height. */}
              <View
                style={{
                  marginHorizontal: 20,
                  marginTop: 24,
                  backgroundColor: theme.surface,
                  borderRadius: 16,
                  padding: 16,
                  ...shadows.sm,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.border,
                  }}
                >
                  <Shimmer width={70} height={13} radius={4} />
                  <Shimmer width={140} height={13} radius={4} />
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 12,
                  }}
                >
                  <Shimmer width={70} height={13} radius={4} />
                  <Shimmer width={120} height={13} radius={4} />
                </View>
              </View>

              {/* Tabs skeleton — same SegmentedTabs height (44 px,
                  radius 999) and body card (surface, radius 14,
                  padding 16, shadows.sm). */}
              <View style={{ marginHorizontal: 20, marginTop: 20 }}>
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
                  {/* Two equal-width tab placeholders */}
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

              {/* Stufe-row skeleton — same surfaceAlt rounded
                  container, S-letter slot on the left, text lines
                  on the right. */}
              <View
                style={{
                  marginHorizontal: 20,
                  marginTop: 20,
                  padding: 14,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  backgroundColor: theme.surfaceAlt,
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <View style={{ alignItems: 'center', gap: 4 }}>
                  <Shimmer width={26} height={20} radius={4} />
                  <Shimmer width={36} height={6} radius={3} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Shimmer width="90%" height={12} radius={4} />
                  <Shimmer width="75%" height={12} radius={4} />
                  <Shimmer width="50%" height={12} radius={4} />
                </View>
              </View>
            </View>
          }
        >
          <View>
            {/* Info card */}
            <View
              style={{
                marginHorizontal: 20,
                marginTop: 24,
                backgroundColor: theme.surface,
                borderRadius: 16,
                padding: 16,
                ...shadows.sm,
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  paddingBottom: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                  gap: 12,
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 13,
                    color: theme.textMuted,
                    paddingTop: 1,
                  }}
                >
                  Hersteller
                </Text>
                {/* flex:1 + textAlign right + numberOfLines weg —
                    lange Hersteller-Namen wie "Naabtaler Milchwerke
                    GmbH & Co." dürfen umbrechen statt mit "..." aus-
                    geblendet zu werden. */}
                <Text
                  style={{
                    flex: 1,
                    fontFamily,
                    fontWeight: fontWeight.bold,
                    fontSize: 13,
                    lineHeight: 18,
                    color: theme.text,
                    textAlign: 'right',
                  }}
                >
                  {herstellerName ?? '—'}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 12,
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 13,
                    color: theme.textMuted,
                    paddingTop: 1,
                  }}
                >
                  Kategorie
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontFamily,
                    fontWeight: fontWeight.bold,
                    fontSize: 13,
                    lineHeight: 18,
                    color: theme.text,
                    textAlign: 'right',
                  }}
                >
                  {categoryName ?? '—'}
                </Text>
              </View>
            </View>

            {/* Bekannte Marken des Herstellers — nur bei Stufe 2
                relevant. Definition Stufe 2: "Markenhersteller ohne
                vergleichbares Produkt" → der Hersteller produziert
                auch für bekannte Marken, nur nicht direkt eines, das
                sich mit diesem NoName-Produkt vergleichen lässt. Das
                ist genau der Punkt, an dem dieser Block sichtbar
                wird: er zeigt dem User, welche Marken sonst aus
                derselben Produktion stammen, damit der Bezug zur
                "Markenhersteller"-Aussage greifbar ist.
                Stufe 1 (reiner NoName-Hersteller) hat per Definition
                keine Marken. */}
            {/* Verbundene Marken — gleicher Card-Stil wie die
                Hersteller/Kategorie-Card oberhalb (theme.surface,
                shadows.sm, 14 px Padding). Label-Stil identisch zu
                "Hersteller"/"Kategorie": medium 13 px in textMuted,
                regular case. Darunter wrappen die Marken-Chips. */}
            {p && stufe === 2 && connectedBrands.length > 0 ? (
              <View
                style={{
                  marginHorizontal: 20,
                  marginTop: 12,
                  padding: 14,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  backgroundColor: theme.surface,
                  ...shadows.sm,
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 13,
                    color: theme.textMuted,
                    marginBottom: 10,
                  }}
                >
                  Mit dem Hersteller in Verbindung stehende{' '}
                  {connectedBrands.length === 1 ? 'Marke' : 'Marken'}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  {connectedBrands.map((b) => {
                    const label = b.name || '—';
                    const logoUri = b.bild ?? null;
                    const initial = (label || '?').trim().charAt(0).toUpperCase();
                    return (
                      <View
                        key={b.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          paddingLeft: 4,
                          paddingRight: 12,
                          paddingVertical: 4,
                          borderRadius: 999,
                          backgroundColor: theme.surfaceAlt,
                          borderWidth: 1,
                          borderColor: theme.border,
                        }}
                      >
                        {logoUri ? (
                          <View
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              backgroundColor: '#fff',
                              overflow: 'hidden',
                              borderWidth: 0.5,
                              borderColor: theme.border,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Image
                              source={{ uri: logoUri }}
                              style={{ width: '90%', height: '90%' }}
                              resizeMode="contain"
                            />
                          </View>
                        ) : (
                          <View
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              backgroundColor: brand.primary + '22',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Text
                              style={{
                                fontFamily,
                                fontWeight: fontWeight.extraBold,
                                fontSize: 11,
                                color: brand.primary,
                                includeFontPadding: false as any,
                              }}
                            >
                              {initial}
                            </Text>
                          </View>
                        )}
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily,
                            fontWeight: fontWeight.bold,
                            fontSize: 13,
                            color: theme.text,
                          }}
                        >
                          {label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Detektiv-Check-Zeile — ÜBER den Inhaltstabellen, exakt
                wie auf der Stufe-3/4/5-Seite (product-comparison). Statt
                der alten "S1 + Punkte"-Custom-Anzeige wird hier die
                gleiche `StufenChips`-Komponente verwendet, die auch
                auf den ProductCards und in Stöbern erscheint — eine
                visuelle Sprache für Stufen app-weit.

                Coachmark-Anchor 'product.context' liegt auf dieser
                Zeile — die letzte Spotlight-Phase der ProductDetail-
                Tour erklärt hier die Stufen 1-2 und referenziert
                die höheren Stufen. */}
            {p ? (
              <View
                ref={contextAnchor.ref}
                onLayout={contextAnchor.onLayout}
                collapsable={false}
                style={{
                  marginHorizontal: 20,
                  marginTop: 20,
                  padding: 14,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  backgroundColor: theme.surfaceAlt,
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <View style={{ marginTop: 3 }}>
                  <StufenChips stufe={stufe} size="md" />
                </View>
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
                    Stufe {stufe} — {stufeInfo.label}.
                  </Text>{' '}
                  {stufeInfo.line} Kein direktes Markenprodukt zum Vergleich
                  hinterlegt.
                </Text>
              </View>
            ) : null}

            {/* Tabs: Inhaltsstoffe / Nährwerte.
                Visible nur wenn:
                  • Produkt existiert
                  • Kategorie ist food-relevant (Drogerie/Haushalt
                    etc. → keine Tabs)
                  • IRGENDETWAS (Firestore ODER OpenFood) hat Daten
                    zu zeigen
                ConditionalRender statt PagerView (siehe Stufe-3/4/5
                Comparison-Screen + CLAUDE.md Ausnahme-Regel).
                Vertical-Scroll bleibt erhalten. */}
            {p && !hideFoodTabs && showFoodTabsSection ? (
              <Animated.View
                entering={FadeIn.duration(280)}
                exiting={FadeOut.duration(280)}
              >
                {/* SegmentedTabs nur wenn beide Tabs Daten haben.
                    Bei single-tab → direkt Inhalt zeigen, kein
                    SegmentedTabs (Single-Segment-Pill ist ugly). */}
                {showBothTabs ? (
                  <View style={{ marginHorizontal: 20, marginTop: 20 }}>
                    <SegmentedTabs
                      tabs={[
                        { key: 'ingredients', label: 'Inhaltsstoffe' },
                        { key: 'nutrition', label: 'Nährwerte' },
                      ] as const}
                      value={tab}
                      onChange={onTabChange}
                    />
                  </View>
                ) : null}
                <View>
                  <SingleInfoCard
                    tab={tab}
                    product={p}
                    theme={theme}
                    shadows={shadows}
                    fallbackZutaten={openFoodFallback.brand?.zutaten}
                    fallbackNaehrwerte={openFoodFallback.brand?.naehrwerte}
                    fallbackLoading={openFoodFallback.loading}
                  />
                </View>
              </Animated.View>
            ) : null}

            {/* (Detektiv-Check-Zeile sitzt oberhalb der Tabs, siehe
                weiter oben — sie hatte früher hier am Ende der Page
                geklebt, wandert jetzt in den Kontext der Inhalts-
                tabellen damit der User die Einordnung sofort sieht
                bevor er Inhaltsstoffe/Nährwerte liest.) */}
          </View>
        </Crossfade>

        {/* Weitere enttarnte Produkte — vertikale Liste, Stufe 3/4/5
            aus derselben Kategorie. Tap führt direkt zur jeweiligen
            product-comparison-Seite (alle hier sind Stufe 3+, haben
            also ein Markenprodukt zum Vergleich verlinkt). */}
        <EnttarnteAlternativesList
          items={alternatives}
          onItemPress={(altId) => {
            FirestoreService.prefetchComparisonData(altId, false);
            safePush(`/product-comparison/${altId}?type=noname`);
          }}
        />

        <View style={{ height: 24 }} />
      </Animated.ScrollView>

      {/* RatingsSheet only mounts once the basic product is in
          state — its action button (and therefore the way to open
          it) only mounts at the same gate, so this is consistent. */}
      {p ? (
        <RatingsSheet
          visible={ratingsOpen}
          onClose={() => setRatingsOpen(false)}
          productName={p.name ?? 'Produkt'}
          ratings={ratings}
          loading={ratingsLoading}
          showSimilarity={false}
          existingRating={existingRating}
          onSubmit={async (r: SubmittedRating) => {
            if (!user?.uid) {
              showInfoToast('Bitte anmelden');
              throw new Error('not-authenticated');
            }
            const now = new Date();
            await FirestoreService.addProductRating({
              userID: user.uid,
              productID: p.id,
              brandProductID: null,
              ratingOverall: r.ratingOverall,
              ratingPriceValue: r.ratingPriceValue ?? null,
              ratingTasteFunction: r.ratingTasteFunction ?? null,
              ratingContent: r.ratingContent ?? null,
              ratingSimilarity: r.ratingSimilarity ?? null,
              comment: r.comment ?? null,
              ratedate: now,
              updatedate: now,
            });

            // 🎯 Gamification: track `submit_rating` after the
            // rating is persisted. Fire-and-forget.
            achievementService
              .trackAction(user.uid, 'submit_rating', {
                productId: p.id,
                productName: p.name,
                productType: 'noname',
                rating: r.ratingOverall,
                commentLength: (r.comment || '').length,
              })
              .catch((err) => {
                console.warn('submit_rating trackAction failed', err);
              });

            try {
              const refreshed =
                await FirestoreService.getProductRatingsWithUserInfo(p.id, true);
              setRatings(refreshed as any);

              // Eigene Bewertung aktualisieren damit beim nächsten
              // Sheet-Open der Submit-View mit den neuen Werten
              // vorbefüllt wird.
              setExistingRating({
                id: (existingRating as any)?.id,
                userID: user.uid,
                ratingOverall: r.ratingOverall,
                ratingPriceValue: r.ratingPriceValue ?? undefined,
                ratingTasteFunction: r.ratingTasteFunction ?? undefined,
                ratingSimilarity: r.ratingSimilarity ?? undefined,
                ratingContent: r.ratingContent ?? undefined,
                comment: r.comment ?? undefined,
              } as any);

              // Optimistic local average so der ⭐-ActionButton-
              // SubLabel sofort die neue Bewertung reflektiert.
              // Vorher nur die `ratings`-Liste im Sheet aktualisiert
              // — der Sublabel zog aber aus
              // `product.averageRatingOverall`, das clientseitig
              // stale blieb bis das Cloud-Function-Aggregat lief +
              // das Produkt neu geladen wurde. User hat die
              // Regression gemerkt: "die bewertungsanzeige
              // aktualisiert sich nicht, das ging in der alten
              // version noch".
              const overalls = (refreshed as Rating[])
                .map((r) => r.ratingOverall)
                .filter((v): v is number => typeof v === 'number');
              const avg =
                overalls.length > 0
                  ? overalls.reduce((a, b) => a + b, 0) / overalls.length
                  : undefined;
              setProduct((prev) =>
                prev ? ({ ...prev, averageRatingOverall: avg } as any) : prev,
              );
            } catch {
              /* non-fatal */
            }
          }}
        />
      ) : null}

      {/* Schwebender Einkaufszettel-FAB. Detail-Seiten haben keine
          Tab-Bar darunter, also nur safe-area-bottom + 8 px (vorher
          +20 → wirkte zu hoch, jetzt klebt der FAB tighter an der
          Home-Indicator-Bar). */}
      <FloatingShoppingListButton bottomOffset={insets.bottom + 8} />

      {/* Fly-to-cart overlay — clones the hero image and animates it
          into the floating cart button. Mounted last so it sits on
          top of the FAB visually. */}
      <FlyToCart ref={flyRef} />

      {/* (Floating QuantityPill entfernt — MorphingCartButton hat
          jetzt die Pill-Funktionalität in-place am Cart-Button selbst.) */}

      {/* ProductDetail-Walkthrough — Welcome-Card + Spotlights.
          CoachmarkScrollProvider gibt der SpotlightOverlay-Engine
          den ScrollView-Ref → solange ein Spotlight sichtbar ist,
          ist Scroll gesperrt (Anchor wandert sonst weg).

          scrollY ist hier nicht aktiv genutzt — wir geben einen
          dummy SharedValue rein, weil das Provider-Schema es
          verlangt. Die Spotlights für die Detail-Buttons brauchen
          kein scroll-tracking weil die Buttons sowieso fixed im
          oberen Hero sitzen und beim Spotlight-Mount eh am
          richtigen Y stehen (Scroll ist gleich gesperrt). */}
      <CoachmarkScrollProvider
        scrollY={scrollY}
        scrollViewRef={detailScrollRef}
      >
        <ProductDetailWalkthrough
          visible={detailCoachmark.visible}
          onDismiss={detailCoachmark.dismiss}
          screenType="noname"
        />
      </CoachmarkScrollProvider>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────

type ActionButtonProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconColor: string;
  bg?: string;
  subLabel?: string;
  onPress?: () => void;
  /** NEU (2026-05-07): Anzahl-Badge oben rechts (zb für Cart-Button). */
  badge?: number;
};

function ActionButton({ icon, iconColor, bg, subLabel, onPress, badge }: ActionButtonProps) {
  const { theme, brand } = useTokens();
  const filled = !!bg;
  return (
    <View style={{ position: 'relative' }}>
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
      {badge !== undefined && badge > 0 ? <CounterBadge count={badge} /> : null}
    </View>
  );
}

function SingleInfoCard({
  tab,
  product,
  theme,
  shadows,
  fallbackZutaten,
  fallbackNaehrwerte,
  fallbackLoading,
}: {
  tab: Tab;
  product: any;
  theme: ReturnType<typeof useTokens>['theme'];
  shadows: ReturnType<typeof useTokens>['shadows'];
  /** Optional OpenFood-Fallback. Wird verwendet wenn Firestore
   *  keine eigenen Daten hat. */
  fallbackZutaten?: string;
  fallbackNaehrwerte?: NaehrwerteShape;
  /** Während OpenFood lädt und noch nichts da ist → Shimmer-Skeleton. */
  fallbackLoading?: boolean;
}) {
  if (tab === 'ingredients') {
    // Priorität: neues nutr_*-Schema → legacy zutaten/moreInformation
    // → OpenFood. extractIngredients kapselt die Source-Reihenfolge.
    const zutatenFromProduct = extractIngredients(product);
    const zutaten = zutatenFromProduct || fallbackZutaten || '';
    // Quelle = OpenFoodFacts:
    //   • Firestore-Daten kommen aber ingredientsSource === 'openfood', ODER
    //   • Firestore leer → runtime-Fallback (per Definition OpenFood)
    const fromOpenFood = zutatenFromProduct
      ? product?.ingredientsSource === 'openfood'
      : Boolean(fallbackZutaten);

    // Shimmer während Loading + noch nichts da.
    if (fallbackLoading && !zutaten) {
      return (
        <View style={{ marginHorizontal: 20, marginTop: 18 }}>
          <View
            style={{
              backgroundColor: theme.surface,
              borderRadius: 14,
              padding: 16,
              ...shadows.sm,
            }}
          >
            <Shimmer height={11} radius={3} style={{ marginBottom: 6 }} />
            <Shimmer height={11} radius={3} style={{ marginBottom: 6 }} />
            <Shimmer height={11} radius={3} style={{ marginBottom: 6 }} />
            <Shimmer width="70%" height={11} radius={3} />
          </View>
        </View>
      );
    }
    return (
      <View style={{ marginHorizontal: 20, marginTop: 18 }}>
        {zutaten ? (
          <View
            style={{
              backgroundColor: theme.surface,
              borderRadius: 14,
              padding: 16,
              ...shadows.sm,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.regular,
                fontSize: 13,
                lineHeight: 19,
                color: theme.text,
              }}
            >
              {zutaten}
            </Text>
            {fromOpenFood ? <OpenFoodSourceTag theme={theme} /> : null}
          </View>
        ) : (
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
        )}
      </View>
    );
  }

  // Nutrition tab — neues nutr_*-Schema bevorzugt, legacy als
  // Fallback, OpenFood als letzte Stufe (per-Feld-Merge).
  const productNaehrwerte = extractNaehrwerte(product);
  const { merged: n, usedFallback } = mergeNaehrwerte(
    productNaehrwerte,
    fallbackNaehrwerte ?? null,
  );
  // Quelle = OpenFoodFacts wenn Firestore-Daten source='openfood'
  // oder runtime-Fallback ergänzte fehlende Werte.
  const nutritionFromOpenFood =
    product?.nutritionSource === 'openfood' || usedFallback;
  const rows: Array<[string, string]> = [];
  const pushRow = (label: string, value: any, suffix = '') => {
    if (value == null || value === '') return;
    rows.push([label, typeof value === 'number' ? `${value}${suffix}` : String(value)]);
  };
  pushRow('Energie', n.brennwertKcal, ' kcal');
  pushRow('Fett', n.fett, ' g');
  pushRow('davon gesättigt', n.gesaettigteFettsaeuren, ' g');
  pushRow('Kohlenhydrate', n.kohlenhydrate, ' g');
  pushRow('davon Zucker', n.zucker, ' g');
  pushRow('Ballaststoffe', n.ballaststoffe, ' g');
  pushRow('Eiweiß', n.eiweiss, ' g');
  pushRow('Salz', n.salz, ' g');

  // Shimmer-Skeleton während Loading + noch keine Daten.
  if (fallbackLoading && rows.length === 0) {
    return (
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 18,
          backgroundColor: theme.surface,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: 4,
          ...shadows.sm,
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 10,
              borderBottomWidth: i < 7 ? 1 : 0,
              borderBottomColor: theme.border,
            }}
          >
            <Shimmer width={110} height={11} radius={3} />
            <Shimmer width={56} height={11} radius={3} />
          </View>
        ))}
      </View>
    );
  }

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
        paddingVertical: 4,
        ...shadows.sm,
      }}
    >
      {rows.map(([label, value], i) => (
        <View
          key={label}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 10,
            borderBottomWidth: i < rows.length - 1 ? 1 : 0,
            borderBottomColor: theme.border,
          }}
        >
          <Text
            style={{
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
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: theme.text,
            }}
          >
            {value}
          </Text>
        </View>
      ))}
      <View
        style={{
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
          }}
        >
          Angaben pro 100 g
        </Text>
        {nutritionFromOpenFood ? <OpenFoodSourceTag theme={theme} /> : null}
      </View>
    </View>
  );
}

/** Caption "Quelle: OpenFoodFacts" — nur sichtbar wenn die
 *  gerenderten Werte tatsächlich aus OpenFood kommen (source-Tag
 *  am Produkt ODER runtime-Fallback). Bei rewe/manual/scraper →
 *  keine Caption nötig. */
function OpenFoodSourceTag({
  theme,
}: {
  theme: ReturnType<typeof useTokens>['theme'];
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 8,
      }}
    >
      <MaterialCommunityIcons name="web" size={11} color={theme.textMuted} />
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 10,
          color: theme.textMuted,
          letterSpacing: 0.2,
        }}
      >
        Quelle: OpenFoodFacts
      </Text>
    </View>
  );
}
