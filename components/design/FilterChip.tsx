import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  /** When set, renders as "label: value". Also marks the chip as active. */
  value?: string | null;
  /** When set, shows a divider + close button to clear the value. */
  onClear?: (() => void) | null;
  onPress?: () => void;
  /** Force the active (primary-filled) style even without a value. */
  strong?: boolean;
  /** Render as a neutral "ghost" chip, e.g. the reset action. */
  muted?: boolean;
};

/**
 * Filter chip used in Stöbern filter rail. Three visual modes:
 *  - default: white card pill with chevron
 *  - active (value set OR strong): primary-filled
 *  - muted: subdued (reset button)
 * Matches `FilterChip` in the prototype.
 */
export function FilterChip({ icon, label, value, onClear, onPress, strong, muted }: Props) {
  const { theme, brand } = useTokens();
  const active = !!value || strong;

  const bg = muted ? theme.border : active ? brand.primary : theme.surface;
  const fg = muted ? theme.textMuted : active ? '#ffffff' : theme.text;
  const iconColor = muted ? theme.textMuted : active ? '#ffffff' : brand.primary;
  const borderColor = active || muted ? 'transparent' : theme.borderStrong;

  return (
    <View
      style={{
        flexDirection: 'row',
        height: 30,
        borderRadius: 15,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          paddingLeft: 10,
          paddingRight: onClear ? 6 : 11,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {icon ? <MaterialCommunityIcons name={icon} size={14} color={iconColor} /> : null}
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 12,
            color: fg,
          }}
          numberOfLines={1}
        >
          {label}
          {value ? <Text style={{ opacity: 0.7 }}>: </Text> : null}
          {value ? <Text style={{ fontWeight: fontWeight.extraBold }}>{value}</Text> : null}
        </Text>
        {!onClear && !muted ? (
          <MaterialCommunityIcons name="chevron-down" size={12} color={iconColor} style={{ marginLeft: 1 }} />
        ) : null}
      </Pressable>
      {onClear ? (
        <Pressable
          onPress={onClear}
          style={{
            paddingHorizontal: 8,
            alignItems: 'center',
            justifyContent: 'center',
            borderLeftWidth: 1,
            borderLeftColor: 'rgba(255,255,255,0.25)',
          }}
        >
          <MaterialCommunityIcons name="close" size={12} color="#ffffff" />
        </Pressable>
      ) : null}
    </View>
  );
}
