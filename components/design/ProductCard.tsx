import React from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import {
  fontFamily,
  fontWeight,
  radii,
  type StufenLevel,
} from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { StufenChips } from './StufenChips';

export type ProductCardVariant = 'horizontal' | 'grid';

type Props = {
  title: string;
  /** Handelsmarke name (for NoName) or brand/manufacturer name — rendered
   *  as a green uppercase eyebrow above the title. */
  brand?: string | null;
  /** Tiny logo shown left of the eyebrow text. For NoName this is the
   *  discounter logo (Firestore `discounter.bild`); for brand products
   *  it's the manufacturer/brand logo (`hersteller.bild`). */
  eyebrowLogoUri?: string | null;
  imageUri?: string | null;
  price: number;
  stufe: StufenLevel | number;
  /** Pack size label — e.g. "100g", "500ml", "1kg", "25 Stk.". */
  sizeLabel?: string | null;
  /** Price per unit — e.g. "8,90€/kg", "0,05€/Stk.". */
  unitPriceLabel?: string | null;
  variant?: ProductCardVariant;
  onPress?: () => void;
  /** Width override (defaults: horizontal=168, grid='100%'). */
  width?: number | string;
  /** Shared-element tag. When set (and the destination screen renders
   *  an Animated.Image with the same tag), Reanimated will morph the
   *  product image from card → hero on push and back on pop. Convention:
   *  `product-image-<id>`. */
  sharedTag?: string;
};

function formatPrice(price: number): string {
  return `${price.toFixed(2).replace('.', ',')}€`;
}

/**
 * ProductCard — Home horizontal scroller + Stöbern grid.
 * Shows image, StufenChips (on a translucent pill for readability on any
 * image), small brand/handelsmarke logo inline with the eyebrow, title,
 * price and pack/unit info.
 */
export function ProductCard({
  title,
  brand,
  eyebrowLogoUri,
  imageUri,
  price,
  stufe,
  sizeLabel,
  unitPriceLabel,
  variant = 'horizontal',
  onPress,
  width,
  sharedTag,
}: Props) {
  const { theme, shadows } = useTokens();

  const isHorizontal = variant === 'horizontal';
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
          // Animated.View with the tag, regular Image inside. Applying
          // sharedTransitionTag directly to Animated.Image is flaky —
          // the measured frame isn't always the image's natural size,
          // so the morph can silently no-op. Wrapping keeps the
          // measurement deterministic.
          <Animated.View
            style={{ width: '100%', height: '100%' }}
            sharedTransitionTag={sharedTag}
          >
            <Image
              source={{ uri: imageUri }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          </Animated.View>
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

        {/* Stufen chips on a translucent white pill so they stay legible no
            matter what the product image behind looks like. Subtle shadow
            instead of blur for consistent cross-platform rendering. */}
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
          <StufenChips stufe={stufe} size={isHorizontal ? 'sm' : 'md'} />
        </View>
      </View>

      <View style={{ padding: 12, paddingBottom: 14 }}>
        {brand || eyebrowLogoUri ? (
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
      </View>
    </Pressable>
  );
}
