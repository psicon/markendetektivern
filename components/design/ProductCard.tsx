import React from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import {
  fontFamily,
  fontWeight,
  radii,
  type StufenLevel,
} from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { getProductImage } from '@/lib/utils/productImage';
import { Shimmer } from './Skeletons';
import { StufenChips } from './StufenChips';

export type ProductCardVariant = 'horizontal' | 'grid';

type Props = {
  title: string;
  /** Handelsmarke name (for NoName) or brand/manufacturer name — rendered
   *  as a green uppercase eyebrow above the title. */
  brand?: string | null;
  /** Hersteller-Name (aus dem populated `hersteller_new`-Join). Wird
   *  unter dem Produktnamen als zweite Zeile gerendert wenn gesetzt.
   *  Auf NoName-Karten in Stöbern-Grids hilft das dem User sofort
   *  zu erkennen wer den NoName tatsächlich produziert. */
  hersteller?: string | null;
  /** Tiny logo shown left of the eyebrow text. For NoName this is the
   *  discounter logo (Firestore `discounter.bild`); for brand products
   *  it's the manufacturer/brand logo (`hersteller.bild`). */
  eyebrowLogoUri?: string | null;
  /**
   * If true, the eyebrow row renders shimmer placeholders for the
   * logo + brand text. Use this when the product itself has loaded
   * but the discounter / handelsmarke joins haven't resolved yet —
   * keeps the layout stable so the swap-in is invisible. The Home
   * tab uses this to render product cards the moment products
   * arrive while the per-product handelsmarke + global discounter
   * map fill in shortly after.
   */
  eyebrowLoading?: boolean;
  /**
   * Either pass `product` (preferred — the card calls
   * `getProductImage()` internally so the cleaned-WebP variant is used
   * automatically when available) OR pass an explicit `imageUri` to
   * override (e.g. loading placeholder, custom thumbnail). If both
   * are provided, `imageUri` wins.
   */
  product?: { bildClean?: string | null; bild?: string | null } | null;
  imageUri?: string | null;
  price: number;
  /**
   * Stufen-Chips erscheinen unten rechts auf dem Bild. Optional —
   * für Markenprodukte (das "Original") nicht relevant, da kann der
   * Caller `null`/`undefined` durchreichen und die Pill bleibt aus.
   */
  stufe?: StufenLevel | number | null;
  /** Pack size label — e.g. "100g", "500ml", "1kg", "25 Stk.". */
  sizeLabel?: string | null;
  /** Price per unit — e.g. "8,90€/kg", "0,05€/Stk.". */
  unitPriceLabel?: string | null;
  variant?: ProductCardVariant;
  onPress?: () => void;
  /** Width override (defaults: horizontal=168, grid='100%'). */
  width?: number | string;
  /**
   * Optionale Overlay-Slots — der Top-Rated-Card-Wrapper auf Home
   * nutzt sie, um Rank-Badge oben links und Rating-Pill unten links
   * über das Bild zu legen, ohne ProductCard intern zu verändern.
   */
  imageOverlayTopLeft?: React.ReactNode;
  imageOverlayBottomLeft?: React.ReactNode;
  /**
   * Optionaler Footer unter Preis/Größe — z.B. Rating-Zeile +
   * Kommentar-Vorschau auf der Home-Top-Rated-Liste.
   */
  footer?: React.ReactNode;
};

function formatPrice(price: number): string {
  return `${price.toFixed(2).replace('.', ',')}€`;
}

/**
 * ProductCard — Home horizontal scroller + Stöbern grid.
 * Shows image, StufenChips (on a translucent pill for readability on any
 * image), small brand/handelsmarke logo inline with the eyebrow, title,
 * price and pack/unit info.
 *
 * Wrapped in React.memo below so that typing in the Stöbern search or
 * scrolling doesn't trigger a re-render of every tile — only cards
 * whose props actually changed repaint.
 */
function ProductCardImpl({
  title,
  brand,
  hersteller,
  eyebrowLogoUri,
  eyebrowLoading,
  product,
  imageUri,
  price,
  stufe,
  sizeLabel,
  unitPriceLabel,
  variant = 'horizontal',
  onPress,
  width,
  imageOverlayTopLeft,
  imageOverlayBottomLeft,
  footer,
}: Props) {
  const { theme, shadows } = useTokens();

  const isHorizontal = variant === 'horizontal';
  const imageHeight = isHorizontal ? 135 : 162;
  const cardWidth = width ?? (isHorizontal ? 168 : '100%');

  // Resolve image source: explicit `imageUri` (legacy / override) wins,
  // otherwise we ask the helper which gracefully prefers `bildClean`
  // and falls back to `bild`. Centralising the resolution here means
  // call sites can just pass `product={p}` without remembering the
  // helper.
  const resolvedImageUri = imageUri ?? getProductImage(product);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: cardWidth,
        backgroundColor: theme.surface,
        borderRadius: radii.lg,
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
        ...shadows.sm,
      })}
    >
      <View
        style={{
          position: 'relative',
          width: '100%',
          height: imageHeight,
          // theme.surface = pure white im Light Mode, dunkel im Dark
          // Mode. Liegt hinter dem freigestellten Produktfoto.
          backgroundColor: theme.surface,
        }}
      >
        {resolvedImageUri ? (
          // Plain RN-Image (KEIN Reanimated-Wrapper hier!) — wir
          // hatten kurzzeitig ein FadingImage mit useSharedValue +
          // useAnimatedStyle pro Karte. Bei 20-40 mounted Karten in 3
          // PagerView-Pages = 60-120 Worklets, kombiniert mit Scroll-
          // Handler-Worklets + Chrome-Collapse-Animations + Shadows
          // = spürbares Scroll-Stocking. RNs `fadeDuration`-Prop
          // macht den Soft-Fade auf Android nativ (kein JS/Worklet),
          // iOS dekodiert Bilder so schnell dass kein expliziter
          // Fade nötig ist.
          <Image
            source={{ uri: resolvedImageUri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
            fadeDuration={200}
          />
        ) : (
          <View
            style={{
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: imageHeight * 0.4 }}>📦</Text>
          </View>
        )}

        {/* Stufen chips on a translucent white pill so they stay legible no
            matter what the product image behind looks like. Subtle shadow
            instead of blur for consistent cross-platform rendering.
            Wird übersprungen wenn `stufe` undefined/null/0 ist (z.B.
            für Markenprodukte, die das Original sind). */}
        {stufe != null && stufe !== 0 ? (
          <View
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              paddingHorizontal: 6,
              paddingVertical: 4,
              borderRadius: 7,
              backgroundColor: 'rgba(255,255,255,0.72)',
              ...Platform.select({
                ios: {
                  shadowColor: '#000',
                  shadowOpacity: 0.12,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 1 },
                },
                android: { elevation: 2 },
              }),
            }}
          >
            <StufenChips stufe={stufe as any} size={isHorizontal ? 'sm' : 'md'} />
          </View>
        ) : null}

        {/* Optionale Overlay-Slots — wird vom Top-Rated-Card-Wrapper
            für Rank-Badge (top-left) und Rating-Pill (bottom-left)
            genutzt. ProductCard selbst gibt nur die Andockpunkte. */}
        {imageOverlayTopLeft ? (
          <View style={{ position: 'absolute', top: 10, left: 10 }}>
            {imageOverlayTopLeft}
          </View>
        ) : null}
        {imageOverlayBottomLeft ? (
          <View style={{ position: 'absolute', bottom: 10, left: 10 }}>
            {imageOverlayBottomLeft}
          </View>
        ) : null}
      </View>

      <View style={{ padding: 12, paddingBottom: 14 }}>
        {/* Eyebrow row — three states:
            1. Loading (eyebrowLoading=true and no data): shimmer
               placeholders for the 16 px logo + brand text. Card
               can render with image + price + stufe immediately
               while the discounter map / handelsmarken lookups
               finish in the background. The shimmer mass + spacing
               match the live row exactly so the swap-in is silent.
            2. Loaded (any of brand / logo present): normal eyebrow.
            3. Truly absent (loading done, no joins): row hidden,
               4 px shaved off the card top — kept for backward
               compat with callers that don't pass eyebrowLoading. */}
        {eyebrowLoading && !brand && !eyebrowLogoUri ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
            }}
          >
            <Shimmer width={16} height={16} radius={3} />
            <Shimmer width={70} height={10} radius={3} />
          </View>
        ) : brand || eyebrowLogoUri ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
            }}
          >
            {eyebrowLogoUri ? (
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 3,
                  // Brand-Logos sind als SVG/PNG für hellen Hintergrund
                  // designed — bleibt pure white in beiden Modi (kleine
                  // 16-px-Kachel, sticht nicht stark aus).
                  backgroundColor: '#ffffff',
                  overflow: 'hidden',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: Platform.OS === 'ios' ? 0 : 0.5,
                  borderColor: theme.border,
                }}
              >
                <Image
                  source={{ uri: eyebrowLogoUri }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            {brand ? (
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.bold,
                  fontSize: 10,
                  color: theme.primary,
                  letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  flexShrink: 1,
                }}
              >
                {brand}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Text
          numberOfLines={2}
          style={{
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 15,
            lineHeight: 19,
            color: theme.text,
            minHeight: 38,
          }}
        >
          {title}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            marginTop: 6,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 16,
              color: theme.text,
            }}
          >
            {formatPrice(price)}
          </Text>
          {sizeLabel || unitPriceLabel ? (
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 11,
                color: theme.textMuted,
                flexShrink: 1,
              }}
            >
              {sizeLabel ?? ''}
              {sizeLabel && unitPriceLabel ? ' ' : ''}
              {unitPriceLabel ? `(${unitPriceLabel})` : ''}
            </Text>
          ) : null}
        </View>

        {/* Hersteller-Pill am unteren Card-Ende — kompakte Chip mit
            surfaceAlt-bg und kleiner Caps-Schrift, zeigt den
            tatsächlichen `hersteller_new.name`. Bei Top-Rated-Cards
            (kein hersteller-Prop durchgereicht) entfällt die Pill. */}
        {hersteller ? (
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: theme.surfaceAlt,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              marginTop: 8,
              maxWidth: '100%',
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold,
                fontSize: 10,
                color: theme.textSub,
                letterSpacing: 0.3,
              }}
            >
              {hersteller}
            </Text>
          </View>
        ) : null}

        {/* Optionaler Footer — z.B. Rating + Kommentar-Vorschau bei
            der Top-Rated-Liste auf Home. */}
        {footer ?? null}
      </View>
    </Pressable>
  );
}

export const ProductCard = React.memo(ProductCardImpl);
