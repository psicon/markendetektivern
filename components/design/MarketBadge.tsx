import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import { fontFamily, fontWeight } from '@/constants/tokens';

type Props = {
  /** Two-letter (or dm) short code to display, e.g. 'L', 'A', 'dm'. */
  short: string;
  /** Discounter background color (from Firestore `discounter.color`). */
  color: string;
  size?: number;
  style?: ViewStyle;
};

/**
 * Rounded-square market badge overlay (e.g. top-left of ProductCard image).
 * Per DESIGN_SYSTEM.md §8: background comes from Firestore `discounter.color`,
 * never hardcoded.
 */
export function MarketBadge({ short, color, size = 30, style }: Props) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: 8,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.15,
          shadowOffset: { width: 0, height: 1 },
          shadowRadius: 3,
          elevation: 2,
        },
        style,
      ]}
    >
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
