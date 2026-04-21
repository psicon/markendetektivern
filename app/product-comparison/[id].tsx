import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { RatingsSheet, type Rating, type SubmittedRating } from '@/components/design/RatingsSheet';
import { ProductDetailSkeleton } from '@/components/design/Skeletons';
import { StufenChips } from '@/components/design/StufenChips';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { FirestoreService } from '@/lib/services/firestore';
import {
  showCartAddedToast,
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

function savings(brand: { preis?: number } | undefined, nn: { preis?: number } | undefined) {
  if (!brand?.preis || !nn?.preis) return { eur: 0, pct: 0 };
  const eur = Math.max(0, brand.preis - nn.preis);
  const pct = Math.round((eur / brand.preis) * 100);
  return { eur, pct };
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

  const isMarkenProdukt = type === 'markenprodukt';

  // ─── Data ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mainProduct, setMainProduct] = useState<MarkenProduktWithDetails | null>(null);
  const [nonames, setNonames] = useState<ProductWithDetails[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await FirestoreService.getProductComparisonData(
          String(id),
          isMarkenProdukt,
        );
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
        setPickedId(
          !data.clickedWasNoName ? (sorted[0]?.id ?? null) : data.clickedProductId,
        );
      } catch (e) {
        console.warn('ProductComparison: load failed', e);
        setError('Fehler beim Laden');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isMarkenProdukt]);

  const picked = useMemo(
    () => nonames.find((p) => p.id === pickedId) ?? nonames[0] ?? null,
    [nonames, pickedId],
  );

  // Fetch 5 other brand products from the same category once the main
  // product is known, so "Gute Alternativen" at the bottom isn't empty.
  useEffect(() => {
    if (!mainProduct) return;
    const catId =
      (mainProduct as any).kategorie?.id ??
      ((mainProduct as any).kategorie && typeof (mainProduct as any).kategorie === 'object'
        ? undefined
        : (mainProduct as any).kategorie);
    (async () => {
      try {
        const res = await FirestoreService.getMarkenproduktePaginated(
          10,
          null,
          (catId ? { categoryFilters: [catId] } : {}) as any,
        );
        const list = (res.products ?? [])
          .filter((p: any) => p.id !== mainProduct.id)
          .slice(0, 5);
        setAlternatives(list);
      } catch (e) {
        console.warn('ProductComparison: alternatives load failed', e);
      }
    })();
  }, [mainProduct]);

  // ─── UI state ─────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('ingredients');
  const [carouselIdx, setCarouselIdx] = useState(0);
  const carouselRef = useRef<ScrollView | null>(null);
  const [favMap, setFavMap] = useState<Record<string, boolean>>({});
  const [cartMap, setCartMap] = useState<Record<string, boolean>>({});
  const [ratingsSheet, setRatingsSheet] = useState<{
    productId: string;
    productName: string;
    isMarke: boolean;
  } | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  // Bottom "Gute Alternativen" — other brand products from the same category.
  const [alternatives, setAlternatives] = useState<any[]>([]);

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
  const TITLE_FONT_SIZE = 26;
  const TITLE_NAV_SIZE = 17;
  const TITLE_SCALE = TITLE_NAV_SIZE / TITLE_FONT_SIZE; // ≈ 0.654
  // Eyebrow has been removed — title sits directly under the blur
  // chrome at paddingTop: 16 of its wrapper.
  const HERO_TOP_IN_CONTENT = 16;
  const HERO_SCREEN_Y = insets.top + DETAIL_HEADER_ROW_HEIGHT + HERO_TOP_IN_CONTENT;
  const NAV_SCREEN_Y = insets.top + (DETAIL_HEADER_ROW_HEIGHT - 24) / 2; // centred in nav row
  const DOCK_DISTANCE = HERO_SCREEN_Y - NAV_SCREEN_Y;
  const NAV_LEFT_OFFSET = 36; // hero padding 20 → nav after back btn (56)

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

  // ─── Loading / Error ──────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <ProductDetailSkeleton />
      </View>
    );
  }

  if (error || !mainProduct) {
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
  const brandName =
    (mainProduct.hersteller as any)?.herstellername
    ?? (mainProduct.hersteller as any)?.name
    ?? '';
  const brandLogoUri = (mainProduct.hersteller as any)?.bild as string | undefined;

  const brandPackInfo = formatPack(
    (mainProduct as any).packSize,
    (mainProduct as any).packTypInfo?.typKurz ?? (mainProduct as any).packTypInfo?.typ,
    (mainProduct as any).preis,
  );

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
    setCartMap((prev) => ({ ...prev, [productId]: !already }));
    try {
      if (already) {
        showInfoToast('Aus Einkaufsliste entfernt');
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
        showCartAddedToast(
          productData?.name ?? 'Produkt',
          () => router.push('/shopping-list' as any),
        );
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
        onBack={() => router.back()}
      />

      {/* ─── Morphing product title ─────────────────────────────────
          Single Animated.View containing the brand logo + product name.
          At the top of the scroll it sits in the hero position at 26 px;
          as the user scrolls it translates up with the content and
          simultaneously shrinks + slides right. Once it reaches the nav
          bar height (scroll = DOCK_DISTANCE) it pins there at 17 px,
          sitting exactly where the nav title would normally live —
          giving the iOS "large title docks into the nav bar" feel.
          zIndex 11 keeps it above the blur chrome once docked. */}
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
            // top-left origin means scale shrinks toward the anchor
            // point (the start of the text), not toward the centre.
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
        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: TITLE_FONT_SIZE,
            lineHeight: 30,
            color: theme.text,
            letterSpacing: -0.3,
          }}
        >
          {mainProduct.name}
        </Text>
      </Animated.View>

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: insets.top + DETAIL_HEADER_ROW_HEIGHT,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >

        {/* Title lives outside the ScrollView as the morph element —
            see morphTitleStyle. We reserve a 32 px placeholder so the
            surrounding layout doesn't shift. The "Das Original"
            eyebrow was dropped: the Hersteller pill on the hero image
            and the brand logo in the morph title already tell the
            user this is the brand product. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 }}>
          <View style={{ height: 32 }} />
        </View>

        {/* ─── Hero image with overlays ──────────────────────────── */}
        <View style={{ paddingHorizontal: 20 }}>
          <View
            style={{
              position: 'relative',
              borderRadius: 20,
              overflow: 'hidden',
              backgroundColor: theme.surfaceAlt,
              height: 240,
            }}
          >
            {mainProduct.bild ? (
              <Image
                source={{ uri: mainProduct.bild }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="package-variant" size={64} color={theme.textMuted} />
              </View>
            )}

            {/* Hersteller pill — top-left. No brand logo inside: the
                morph title directly above the hero already shows it,
                and repeating it here looks redundant. Only the
                Hersteller name remains. */}
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
                  numberOfLines={1}
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 13,
                    color: '#fff',
                    letterSpacing: -0.1,
                  }}
                >
                  {brandName}
                </Text>
              </View>
            ) : null}

            {/* Price + size — bottom-left */}
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
                {formatEur((mainProduct as any).preis)}
              </Text>
            </View>

            {/* Action cluster — bottom-right */}
            <View style={{ position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 8 }}>
              <ActionButton
                icon={favMap[mainProduct.id] ? 'heart' : 'heart-outline'}
                iconColor={favMap[mainProduct.id] ? '#e53935' : theme.text}
                onPress={() => onToggleFav(mainProduct.id, 'markenprodukt', mainProduct)}
              />
              <ActionButton
                icon={cartMap[mainProduct.id] ? 'cart-check' : 'cart-plus'}
                iconColor={cartMap[mainProduct.id] ? '#fff' : theme.text}
                bg={cartMap[mainProduct.id] ? brand.primary : undefined}
                onPress={() => onToggleCart(mainProduct.id, 'markenprodukt', mainProduct)}
              />
              <ActionButton
                icon="star"
                iconColor="#f5b301"
                subLabel={
                  (mainProduct as any).averageRatingOverall
                    ? ((mainProduct as any).averageRatingOverall as number).toFixed(1)
                    : undefined
                }
                onPress={() => onOpenRatings(mainProduct.id, mainProduct.name ?? 'Produkt', true)}
              />
            </View>
          </View>
        </View>

        {/* ─── Alternativen vom gleichen Hersteller ──────────────── */}
        {nonames.length > 0 ? (
          <>
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
                const nnStufe = parseStufe((nn as any).stufe);
                const nnStufeColor = stufen[nnStufe];
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
                    {/* Discount flag — top-right corner */}
                    {sv.pct > 0 ? (
                      <View
                        style={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          backgroundColor: '#e53935',
                          paddingVertical: 7,
                          paddingHorizontal: 12,
                          borderTopRightRadius: 16,
                          borderBottomLeftRadius: 14,
                          zIndex: 2,
                          shadowColor: '#e53935',
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
                            fontSize: 13,
                            color: '#fff',
                            letterSpacing: -0.1,
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
                        style={{
                          width: 76,
                          height: 76,
                          borderRadius: 10,
                          overflow: 'hidden',
                          backgroundColor: theme.surfaceAlt,
                        }}
                      >
                        {(nn as any).bild ? (
                          <Image
                            source={{ uri: (nn as any).bild }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
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
                      {/* Info column. Layout stack, top → bottom:
                            1) Handelsmarke eyebrow (market logo + name)
                            2) Product name (max 2 lines)
                            3) Pack size · Grundpreis (single line)
                            4) StufenChips (5-segment bar — same
                               component as the Stöbern grid, so the
                               similarity indicator is visually
                               identical across screens)
                          The "IDENTISCH"/"VERWANDT" all-caps eyebrow is
                          gone: the card border colour and the chips
                          below carry that information more quietly, and
                          the full label still shows up once in the
                          Detektiv-Check row below the carousel. */}
                      <View
                        style={{
                          flex: 1,
                          minWidth: 0,
                          paddingRight: sv.pct > 0 ? 50 : 0,
                          justifyContent: 'space-between',
                        }}
                      >
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
                        <Text
                          numberOfLines={2}
                          style={{
                            fontFamily,
                            fontWeight: fontWeight.bold,
                            fontSize: 15,
                            lineHeight: 18,
                            color: theme.text,
                            marginTop: 3,
                          }}
                        >
                          {(nn as any).name}
                        </Text>
                        {nnPackParts ? (
                          <Text
                            numberOfLines={1}
                            style={{
                              fontFamily,
                              fontWeight: fontWeight.medium,
                              fontSize: 11,
                              color: theme.textMuted,
                              marginTop: 3,
                            }}
                          >
                            {nnPackParts.unitPrice
                              ? `${nnPackParts.sizeLabel} · ${nnPackParts.unitPrice}`
                              : nnPackParts.sizeLabel}
                          </Text>
                        ) : null}
                        <View style={{ marginTop: 5 }}>
                          <StufenChips stufe={nnStufe} size="sm" />
                        </View>
                      </View>
                    </View>

                    <View style={{ height: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />

                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: 14,
                        paddingTop: 12,
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
                  </Pressable>
                );
              })}
            </ScrollView>

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
                rather than as a global footer. */}
            {picked ? (
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
                <View style={{ alignItems: 'center', marginTop: 1 }}>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 18,
                      color: stufen[pickedStufe],
                      lineHeight: 18,
                    }}
                  >
                    S{pickedStufe}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 2, marginTop: 4 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <View
                        key={n}
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: 3,
                          backgroundColor: n <= pickedStufe ? stufen[pickedStufe] : theme.borderStrong,
                        }}
                      />
                    ))}
                  </View>
                </View>
                {/* Shortened — the long descriptive sentence
                    (`pickedInfo.line`) was dropped. The Stufe label +
                    Hersteller name carry the essential message; users
                    who need the full explanation still get it on the
                    Stöbern filter sheet. Kept concise so this row
                    doesn't add to the visual noise on this page. */}
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
                  </Text>
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
          </>
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
                fontSize: 12,
                lineHeight: 17,
                color: theme.textSub,
              }}
            >
              Noch keine Eigenmarken-Alternative in unserer Datenbank. Scann den
              Kassenbon bei deinem nächsten Einkauf — du hilfst, die Lücke zu
              füllen.
            </Text>
          </View>
        )}

        {/* ─── Tabs: Inhaltsstoffe / Nährwerte ───────────────────── */}
        <View
          style={{
            marginHorizontal: 20,
            marginTop: 24,
            padding: 4,
            borderRadius: 999,
            backgroundColor: theme.surfaceAlt,
            flexDirection: 'row',
            gap: 4,
          }}
        >
          {(
            [
              ['ingredients', 'Inhaltsstoffe'],
              ['nutrition', 'Nährwerte'],
            ] as const
          ).map(([k, label]) => {
            const on = tab === k;
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                style={({ pressed }) => ({
                  flex: 1,
                  height: 40,
                  borderRadius: 999,
                  backgroundColor: on ? theme.surface : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.92 : 1,
                  ...(on ? shadows.sm : {}),
                })}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.bold,
                    fontSize: 13,
                    color: on ? theme.text : theme.textMuted,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ─── Comparison content ────────────────────────────────── */}
        {tab === 'ingredients' ? (
          <IngredientsMatch brandProduct={mainProduct} noname={picked} theme={theme} />
        ) : (
          <NutritionTable
            brandProduct={mainProduct}
            noname={picked}
            theme={theme}
            primary={brand.primary}
          />
        )}

        {/* ─── Gute Alternativen ──────────────────────────────────── */}
        {alternatives.length > 0 ? (
          <View style={{ marginTop: 28 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                paddingHorizontal: 20,
                marginBottom: 14,
              }}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 20,
                  color: theme.text,
                  letterSpacing: -0.2,
                }}
              >
                Gute Alternativen
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollsToTop={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 14, paddingBottom: 4 }}
            >
              {alternatives.map((ap: any) => (
                <Pressable
                  key={ap.id}
                  onPress={() =>
                    router.push(
                      `/product-comparison/${ap.id}?type=markenprodukt` as any,
                    )
                  }
                  style={({ pressed }) => ({
                    width: 140,
                    backgroundColor: theme.surface,
                    borderRadius: 14,
                    overflow: 'hidden',
                    opacity: pressed ? 0.92 : 1,
                    ...shadows.sm,
                  })}
                >
                  <View
                    style={{
                      width: '100%',
                      height: 110,
                      backgroundColor: theme.surfaceAlt,
                    }}
                  >
                    {ap.bild ? (
                      <Image
                        source={{ uri: ap.bild }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                        <MaterialCommunityIcons
                          name="package-variant"
                          size={30}
                          color={theme.textMuted}
                        />
                      </View>
                    )}
                  </View>
                  <View style={{ padding: 10, paddingBottom: 12 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.semibold,
                        fontSize: 13,
                        lineHeight: 16,
                        color: theme.text,
                        minHeight: 32,
                      }}
                    >
                      {ap.name ?? ''}
                    </Text>
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.bold,
                        fontSize: 13,
                        color: theme.text,
                        marginTop: 4,
                      }}
                    >
                      {formatEur(ap.preis)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

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
          // Refresh the list so the new review shows up.
          try {
            const refreshed = await FirestoreService.getProductRatingsWithUserInfo(
              ratingsSheet.productId,
              !ratingsSheet.isMarke,
            );
            setRatings(refreshed as any);
          } catch {
            /* non-fatal */
          }
        }}
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
