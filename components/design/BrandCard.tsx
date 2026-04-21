import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  title: string;
  brand: string;
  imageUri?: string | null;
  price: number;
  /** Best-alternative savings (€), optional — shown when known. */
  savingsEur?: number | null;
  /** Count of NoName alternatives linked to this brand product. */
  alternativeCount?: number;
  /** Pack size label — e.g. "200g", "25 Stk.". */
  sizeLabel?: string | null;
  /** Price per unit — e.g. "8,90€/kg", "0,05€/Stk.". */
  unitPriceLabel?: string | null;
  onPress?: () => void;
};

function formatEur(value: number): string {
  return `${value.toFixed(2).replace('.', ',')}€`;
}

/**
 * BrandCard — used in the "Marken" tab of Stöbern (Search). Compared to
 * ProductCard (NoName), this card leads with the brand (e.g. "Coca Cola"),
 * highlights how many alternatives exist, and shows potential savings.
 * Matches `BrandCard` in the prototype.
 */
export function BrandCard({
  title,
  brand,
  imageUri,
  price,
  savingsEur,
  alternativeCount = 0,
  sizeLabel,
  unitPriceLabel,
  onPress,
}: Props) {
  const { theme, shadows } = useTokens();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: '100%',
        backgroundColor: theme.surface,
        borderRadius: radii.lg,
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
        ...shadows.sm,
      })}
    >
      <View style={{ position: 'relative', width: '100%', height: 162 }}>
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
            <MaterialCommunityIcons name="tag-outline" size={44} color={theme.textMuted} />
          </View>
        )}
        {alternativeCount > 0 ? (
          <View
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              backgroundColor: theme.primary,
              paddingHorizontal: 9,
              paddingVertical: 4,
              borderRadius: 9,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 10,
                color: '#ffffff',
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              {alternativeCount} Alt.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ padding: 12, paddingBottom: 14 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 10,
            color: theme.textMuted,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          {brand}
        </Text>
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
          <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 16, color: theme.text }}>
            {formatEur(price)}
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
          {typeof savingsEur === 'number' && savingsEur > 0 ? (
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 12, color: theme.primary }}>
              −{formatEur(savingsEur)}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
