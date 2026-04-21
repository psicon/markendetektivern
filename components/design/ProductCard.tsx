import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import {
  fontFamily,
  fontWeight,
  radii,
  type StufenLevel,
} from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { MarketBadge } from './MarketBadge';
import { StufenChips } from './StufenChips';

export type ProductCardVariant = 'horizontal' | 'grid';

type Props = {
  title: string;
  /** Handelsmarke name (for NoName) or brand/manufacturer name — rendered
   *  as a green uppercase eyebrow above the title. */
  brand?: string | null;
  imageUri?: string | null;
  price: number;
  stufe: StufenLevel | number;
  /** Short discounter code for the fallback badge (e.g. 'L', 'A'). */
  marketShort?: string | null;
  /** Discounter brand color for the fallback badge. */
  marketColor?: string | null;
  /** Discounter logo URL (preferred — renders instead of the letter). */
  marketImageUri?: string | null;
  /** Pack size label — e.g. "100g", "500ml", "1kg". */
  sizeLabel?: string | null;
  /** Price per unit — e.g. "8,90€/kg". Shown next to the size label. */
  unitPriceLabel?: string | null;
  variant?: ProductCardVariant;
  onPress?: () => void;
  /** Width override (defaults: horizontal=168, grid='100%'). */
  width?: number | string;
};

function formatPrice(price: number): string {
  return `${price.toFixed(2).replace('.', ',')}€`;
}

/**
 * ProductCard — Home horizontal scroller + Stöbern grid.
 * Shows image, MarketBadge (top-left), StufenChips (bottom-right),
 * handelsmarke/brand eyebrow (green), title, price, and pack/unit info.
 * Matches the prototype `ProductCard`.
 */
export function ProductCard({
  title,
  brand,
  imageUri,
  price,
  stufe,
  marketShort,
  marketColor,
  marketImageUri,
  sizeLabel,
  unitPriceLabel,
  variant = 'horizontal',
  onPress,
  width,
}: Props) {
  const { theme, shadows } = useTokens();

  const isHorizontal = variant === 'horizontal';
  // Product image heights reduced 10 % to free vertical space for the
  // pack size + unit-price row below the title.
  const imageHeight = isHorizontal ? 135 : 162;
  const cardWidth = width ?? (isHorizontal ? 168 : '100%');

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
      <View style={{ position: 'relative', width: '100%', height: imageHeight }}>
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <View
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: imageHeight * 0.4 }}>📦</Text>
          </View>
        )}

        {marketShort || marketImageUri ? (
          <View style={{ position: 'absolute', top: 10, left: 10 }}>
            <MarketBadge
              short={marketShort ?? ''}
              color={marketColor ?? '#888888'}
              imageUri={marketImageUri ?? null}
            />
          </View>
        ) : null}

        <View style={{ position: 'absolute', bottom: 10, right: 10 }}>
          <StufenChips stufe={stufe} size={isHorizontal ? 'sm' : 'md'} />
        </View>
      </View>

      <View style={{ padding: 12, paddingBottom: 14 }}>
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
              marginBottom: 4,
            }}
          >
            {brand}
          </Text>
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
      </View>
    </Pressable>
  );
}
