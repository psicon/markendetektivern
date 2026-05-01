import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
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
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PagerView from 'react-native-pager-view';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { FlyToCart, type FlyToCartHandle } from '@/components/design/FlyToCart';
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
import { useTokens } from '@/hooks/useTokens';
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
  const { toggleFavorite } = useFavorites();

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
  // SegmentedTabs + PagerView combo for tabs (project rule).
  const tabPagerRef = useRef<PagerView | null>(null);
  // Hero image container ref + FlyToCart imperative handle. The
  // hero ref is measured at "add-to-cart" time (measureInWindow),
  // its rect feeds into FlyToCart.fly() which clones the image and
  // animates it into the floating shopping-list button bottom-right.
  const heroRef = useRef<View | null>(null);
  const flyRef = useRef<FlyToCartHandle | null>(null);
  const [tabHeights, setTabHeights] = useState<{
    ingredients?: number;
    nutrition?: number;
  }>({});
  const onTabChange = (next: Tab) => {
    setTab(next);
    tabPagerRef.current?.setPage(next === 'ingredients' ? 0 : 1);
  };
  const onTabPagerSelected = (e: { nativeEvent: { position: number } }) => {
    const next: Tab = e.nativeEvent.position === 0 ? 'ingredients' : 'nutrition';
    setTab((prev) => (prev === next ? prev : next));
  };
  const [isFav, setIsFav] = useState(false);
  const [inCart, setInCart] = useState(false);
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
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
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
  // `inCart` immer mit `false`, auch wenn das Produkt schon im
  // Einkaufszettel liegt — der Toggle-Button zeigt dann den falschen
  // Zustand und ein erneuter Tap würde das Produkt ein zweites Mal
  // hinzufügen. Re-runs bei id- und uid-Wechsel.
  useEffect(() => {
    let alive = true;
    if (!user?.uid || !id) {
      setInCart(false);
      return;
    }
    FirestoreService.isInShoppingCart(user.uid, String(id), false)
      .then((res) => {
        if (alive) setInCart(!!res);
      })
      .catch(() => {
        if (alive) setInCart(false);
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
  const onFavPress = async () => {
    if (!p) return;
    setIsFav((v) => !v);
    try {
      const now = await toggleFavorite(p.id, 'noname', p);
      if (now) showFavoriteAddedToast(p.name ?? 'Produkt');
      else showFavoriteRemovedToast(p.name ?? 'Produkt');
    } catch {
      setIsFav((v) => !v);
    }
  };
  const onCartPress = async () => {
    if (!p) return;
    if (!user?.uid) {
      showInfoToast('Bitte anmelden');
      return;
    }
    if (inCart) {
      // Optimistisches UI-Update: Button springt sofort auf
      // "nicht im Wagen", danach Firestore-Delete im Hintergrund.
      // Bei Fehler revert.
      setInCart(false);
      try {
        await FirestoreService.removeFromShoppingCartByProductId(
          user.uid,
          p.id,
          false,
        );
        // Leading 🗑️ overrides extractEmoji's default ✅ fallback —
        // a green check on a "removed" toast read like confirmation
        // that it had been ADDED, not removed.
        showInfoToast('🗑️ Aus Einkaufsliste entfernt');
      } catch {
        setInCart(true);
        showInfoToast('Fehler — bitte erneut versuchen');
      }
      return;
    }
    setInCart(true);

    // Fire the fly-to-cart animation in parallel with the Firestore
    // call. measureInWindow gives us the hero's screen rect; FlyToCart
    // clones it and animates the clone into the floating cart button.
    // The clone is `pointerEvents="none"` so taps still hit the page.
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
      // No toast on single-add — the FlyToCart animation + the
      // cart-icon state flip already make the action self-evident.
    } catch {
      setInCart(false);
      showInfoToast('Fehler — bitte erneut versuchen');
    }
  };
  const onRatingsPress = async () => {
    if (!p) return;
    setRatingsOpen(true);
    setRatingsLoading(true);
    setRatings([]);
    try {
      const data = await FirestoreService.getProductRatingsWithUserInfo(p.id, true);
      setRatings(data as any);
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
              backgroundColor: '#ffffff',
              height: 240,
            }}
          >
            {getProductImage(p, 'png') ? (
              <Image
                source={{ uri: getProductImage(p, 'png') ?? undefined }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
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
                    onPress={onFavPress}
                  />
                </View>
                <View
                  ref={cartAnchor.ref}
                  onLayout={cartAnchor.onLayout}
                  collapsable={false}
                >
                  <ActionButton
                    icon={inCart ? 'cart-check' : 'cart-plus'}
                    iconColor={inCart ? '#fff' : theme.text}
                    bg={inCart ? brand.primary : undefined}
                    onPress={onCartPress}
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
                    onPress={onRatingsPress}
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

            {/* Tabs: Inhaltsstoffe / Nährwerte. Bei Non-Food-
                Kategorien (Drogerie, Haushalt, Kosmetik, Tier, …)
                ergeben Zutaten + Nährwerte keinen Sinn — Tabs +
                PagerView werden komplett ausgeblendet. */}
            {p && !hideFoodTabs ? (
              <>
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
                <PagerView
                  ref={tabPagerRef}
                  style={{
                    height: Math.max(
                      tabHeights.ingredients ?? 0,
                      tabHeights.nutrition ?? 0,
                      220,
                    ),
                  }}
                  initialPage={0}
                  onPageSelected={onTabPagerSelected}
                >
                  <View
                    key="ingredients"
                    onLayout={(e) => {
                      const h = e?.nativeEvent?.layout?.height;
                      if (typeof h !== 'number') return;
                      setTabHeights((prev) =>
                        prev.ingredients === h ? prev : { ...prev, ingredients: h },
                      );
                    }}
                  >
                    <SingleInfoCard
                      tab="ingredients"
                      product={p}
                      theme={theme}
                      shadows={shadows}
                    />
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
                    <SingleInfoCard
                      tab="nutrition"
                      product={p}
                      theme={theme}
                      shadows={shadows}
                    />
                  </View>
                </PagerView>
              </>
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
            router.push(`/product-comparison/${altId}?type=noname` as any);
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
            } catch {
              /* non-fatal */
            }
          }}
        />
      ) : null}

      {/* Schwebender Einkaufszettel-FAB. Detail-Seiten haben keine
          Tab-Bar darunter, also nur safe-area-bottom + 20 px. */}
      <FloatingShoppingListButton bottomOffset={insets.bottom + 20} />

      {/* Fly-to-cart overlay — clones the hero image and animates it
          into the floating cart button. Mounted last so it sits on
          top of the FAB visually. */}
      <FlyToCart ref={flyRef} />

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
            fontSize: 12,
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

function SingleInfoCard({
  tab,
  product,
  theme,
  shadows,
}: {
  tab: Tab;
  product: any;
  theme: ReturnType<typeof useTokens>['theme'];
  shadows: ReturnType<typeof useTokens>['shadows'];
}) {
  if (tab === 'ingredients') {
    const zutaten = String(product.zutaten ?? product.moreInformation?.zutaten ?? '').trim();
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

  // Nutrition tab
  const n = product.naehrwerte ?? product.moreInformation ?? {};
  const rows: Array<[string, string]> = [];
  const pushRow = (label: string, value: any, suffix = '') => {
    if (value == null || value === '') return;
    rows.push([label, typeof value === 'number' ? `${value}${suffix}` : String(value)]);
  };
  pushRow('Energie', n.brennwertKcal ?? n.energie, ' kcal');
  pushRow('Fett', n.fett, ' g');
  pushRow('davon gesättigt', n.gesaettigteFettsaeuren ?? n.gesaettigt, ' g');
  pushRow('Kohlenhydrate', n.kohlenhydrate, ' g');
  pushRow('davon Zucker', n.zucker, ' g');
  pushRow('Eiweiß', n.eiweiss ?? n.eiweis, ' g');
  pushRow('Salz', n.salz, ' g');

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
      <View style={{ paddingVertical: 8 }}>
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
      </View>
    </View>
  );
}
