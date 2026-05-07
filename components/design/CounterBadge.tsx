// CounterBadge — kleines Anzahl-Badge das auf Buttons als Overlay
// gelegt wird (oben rechts). Konsistenter Look überall in der App:
//   - 20×20 PERFEKT ROUND bei 1-stelligen Zahlen
//   - Bei 2-stelligen Zahlen: gleicher Look, expandiert nach links/rechts
//     mit minimalem Padding — bleibt visuell wie eine Pille
//   - Weißer BG + 2 px brand.primary-Border + brand.primary-Text
//   - Zahl PERFEKT zentriert via lineHeight + textAlignVertical
//
// Verwendet von:
//   - FloatingShoppingListButton (bottom-right Cart-FAB)
//   - ActionButton in product-comparison + noname-detail (cart-button)
//   - jeder weiteren Stelle die einen Anzahl-Counter zeigt

import React from 'react';
import { Text, View } from 'react-native';
import { Platform } from 'react-native';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  count: number;
  /** Position-Override (Default: top:-6, right:-6 — klassisch über die
   *  Button-Kante hinausragend) */
  top?: number;
  right?: number;
};

export function CounterBadge({ count, top = -6, right = -6 }: Props) {
  const { brand } = useTokens();
  if (count <= 0) return null;
  const display = count > 99 ? '99+' : String(count);
  const isSingleDigit = display.length === 1;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        right,
        // Single digit → exakte Kreis-Geometrie (20×20).
        // 2+ digit → gleiches Höhe, breitet sich nach links aus.
        width: isSingleDigit ? 20 : undefined,
        minWidth: isSingleDigit ? undefined : 22,
        height: 20,
        borderRadius: 10,
        paddingHorizontal: isSingleDigit ? 0 : 5,
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: brand.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 11,
          // lineHeight = inner-height (16 = 20 - 2*border) damit Android
          // den Text exakt vertikal zentriert.
          lineHeight: 16,
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
  );
}
