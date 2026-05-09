import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  background: string;
  /** If true, icon + label render in white (use for tinted backgrounds). */
  dark?: boolean;
  onPress?: () => void;
  /** Optionaler Live-Counter — wird als kleines Badge am Icon-Top-
   *  Right angezeigt. Stilistisch konsistent mit dem CounterBadge auf
   *  dem FloatingShoppingListButton, aber kleiner (16×16) damit es
   *  zur Größe des 22 px Schnellzugriff-Icons passt und nicht
   *  schreit. Bei `count <= 0` wird gar nichts gerendert. */
  count?: number;
};

/**
 * Schnellzugriff card on Home. Fixed 112×90.
 * Matches prototype's `Schnellzugriff` items.
 *
 * Wrapped in React.memo so the card doesn't re-render when the
 * Home screen re-renders for unrelated reasons (e.g. scroll
 * shared-value changes). The 5 cards on Home are otherwise
 * re-created on every parent render — small alone, but adds up
 * during scroll.
 */
function QuickAccessCardImpl({ icon, label, background, dark, onPress, count }: Props) {
  const { theme, brand } = useTokens();
  const fg = dark ? '#ffffff' : theme.text;
  const showBadge = typeof count === 'number' && count > 0;
  const display =
    showBadge && (count as number) > 99 ? '99+' : String(count ?? '');
  // Wenn die Card-BG dunkel ist (dark === true), passt das klassische
  // weiß-mit-grünem-Border-Badge nicht — der grüne Border verschwindet
  // im farbigen BG. Stattdessen: weißes Badge mit weißem Border (= ohne
  // sichtbaren Border, "ausgestanzt"-Look) + brand.primary Text.

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
      {/* Icon + optionales Counter-Badge — relative-positioned wrapper
          damit das Badge sich am Icon und nicht an der ganzen Card
          ausrichtet. */}
      <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
        <MaterialCommunityIcons name={icon} size={22} color={fg} />
        {showBadge ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              // klebt halb über die rechte obere Icon-Kante hinaus
              top: -6,
              right: -10,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              paddingHorizontal: display.length > 1 ? 4 : 0,
              backgroundColor: '#ffffff',
              borderWidth: 1.5,
              borderColor: dark ? '#ffffff' : brand.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 9,
                // lineHeight = innere Höhe (16 - 2*1.5 ≈ 13) damit
                // Android den Text exakt vertikal zentriert.
                lineHeight: 13,
                color: brand.primary,
                textAlign: 'center',
                ...(Platform.OS === 'android'
                  ? { textAlignVertical: 'center' as const, includeFontPadding: false as any }
                  : {}),
              }}
            >
              {display}
            </Text>
          </View>
        ) : null}
      </View>
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

export const QuickAccessCard = React.memo(QuickAccessCardImpl);
