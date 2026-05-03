import React from 'react';
import { Image, Text, View, ViewStyle } from 'react-native';
import { fontFamily, fontWeight } from '@/constants/tokens';

type Props = {
  /** Two-letter (or dm) short code to display, e.g. 'L', 'A', 'dm'. */
  short: string;
  /** Discounter background color (from Firestore `discounter.color`). */
  color: string;
  /** Discounter logo URL (from Firestore `discounter.bild`). If provided,
   *  the logo is rendered on a white card instead of the letter-on-color. */
  imageUri?: string | null;
  size?: number;
  style?: ViewStyle;
};

/**
 * Rounded-square market badge overlay (e.g. top-left of ProductCard image).
 * Per DESIGN_SYSTEM.md §8: background comes from Firestore `discounter.color`,
 * never hardcoded. When `imageUri` is provided, the logo variant is shown.
 */
export function MarketBadge({ short, color, imageUri, size = 30, style }: Props) {
  const base: ViewStyle = {
    width: size,
    height: size,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  };

  if (imageUri) {
    return (
      <View
        style={[base, { backgroundColor: '#ffffff', overflow: 'hidden' }, style]}
      >
        <Image
          source={{ uri: imageUri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
        />
      </View>
    );
  }

  return (
    <View style={[base, { backgroundColor: color }, style]}>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: short.length > 1 ? 11 : 13,
          color: '#ffffff',
          letterSpacing: -0.5,
        }}
      >
        {short}
      </Text>
    </View>
  );
}
