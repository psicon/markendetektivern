import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  background: string;
  /** If true, icon + label render in white (use for tinted backgrounds). */
  dark?: boolean;
  onPress?: () => void;
};

/**
 * Schnellzugriff card on Home. Fixed 112×90.
 * Matches prototype's `Schnellzugriff` items.
 */
export function QuickAccessCard({ icon, label, background, dark, onPress }: Props) {
  const { theme } = useTokens();
  const fg = dark ? '#ffffff' : theme.text;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 112,
        height: 90,
        flexShrink: 0,
        borderRadius: radii.lg - 2,
        backgroundColor: background,
        padding: 12,
        justifyContent: 'space-between',
        opacity: pressed ? 0.88 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon} size={22} color={fg} />
      <Text
        numberOfLines={2}
        style={{
          fontFamily,
          fontWeight: fontWeight.semibold,
          fontSize: 12,
          lineHeight: 15,
          color: fg,
          textAlign: 'left',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
