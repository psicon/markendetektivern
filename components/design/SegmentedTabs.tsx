import React from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Tab<T extends string> = {
  key: T;
  label: string;
};

type Props<T extends string> = {
  tabs: readonly Tab<T>[];
  value: T;
  onChange: (key: T) => void;
  style?: ViewStyle;
};

/**
 * Pill-style segmented tabs — two or more equal-width segments with the
 * active one raised on a white pill. Matches the `Eigenmarken/Marken`
 * toggle from the prototype.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, style }: Props<T>) {
  const { theme, shadows } = useTokens();

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.surfaceAlt,
          padding: 3,
          gap: 3,
        },
        style,
      ]}
    >
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={({ pressed }) => ({
              flex: 1,
              height: 34,
              borderRadius: 17,
              backgroundColor: on ? theme.surface : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.9 : 1,
              ...(on ? shadows.sm : {}),
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 13,
                color: on ? theme.primary : theme.textMuted,
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
