import React from 'react';
import { View, ViewStyle } from 'react-native';
import { stufen, type StufenLevel } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Size = 'sm' | 'md' | 'lg';

type Props = {
  stufe: StufenLevel | number;
  size?: Size;
  style?: ViewStyle;
};

const DIMENSIONS: Record<Size, { w: number; h: number; gap: number }> = {
  sm: { w: 5, h: 10, gap: 2 },
  md: { w: 6, h: 14, gap: 2 },
  lg: { w: 8, h: 18, gap: 2 },
};

/**
 * Horizontal 5-segment similarity indicator — filled up to `stufe`.
 * Matches `StufenChips` from the prototype.
 */
export function StufenChips({ stufe, size = 'md', style }: Props) {
  const { theme } = useTokens();
  const { w, h, gap } = DIMENSIONS[size];
  const active = Math.max(1, Math.min(5, stufe)) as StufenLevel;
  const color = stufen[active];

  return (
    <View style={[{ flexDirection: 'row', gap, alignItems: 'center' }, style]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View
          key={n}
          style={{
            width: w,
            height: h,
            borderRadius: 2,
            backgroundColor: n <= active ? color : theme.borderStrong,
          }}
        />
      ))}
    </View>
  );
}
