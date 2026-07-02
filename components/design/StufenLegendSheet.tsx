import React from 'react';
import { Text, View } from 'react-native';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { getStufeCopy, type StufeTier } from '@/lib/utils/stufeCopy';
import { FilterSheet } from './FilterSheet';
import { StufenChips } from './StufenChips';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Optional: hebt die Zeile der aktuellen Produkt-Stufe hervor. */
  highlight?: number | null;
};

// Von "am ähnlichsten" (5) nach unten — die stärkste Kaufaussage zuerst.
const ORDER: StufeTier[] = [5, 4, 3, 2, 1];

/**
 * StufenLegendSheet — erklärt die 5 Ähnlichkeits-Stufen (das Kernkonzept:
 * "wie nah ist der No-Name am Markenoriginal?"). Wird von den Produktkarten
 * (Balken-Tap) und den Detail-Screens (Detektiv-Check-Zeile) geöffnet.
 *
 * Texte kommen aus `stufeCopy` (Remote-Config + Fallback) — dieselbe Quelle
 * wie die Detektiv-Check-Zeile, damit die Legende nie von der Anzeige driftet.
 */
export function StufenLegendSheet({ visible, onClose, highlight }: Props) {
  const { theme } = useTokens();

  return (
    <FilterSheet visible={visible} title="Was bedeuten die Stufen?" onClose={onClose}>
      <View style={{ paddingBottom: 8 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            lineHeight: 18,
            color: theme.textSub,
            marginBottom: 12,
          }}
        >
          Die Stufe zeigt, wie nah ein No-Name-Produkt am Markenoriginal ist — je
          mehr Balken gefüllt sind, desto ähnlicher.
        </Text>

        {ORDER.map((tier, i) => {
          const copy = getStufeCopy(tier);
          const active = highlight === tier;
          return (
            <View
              key={tier}
              style={{
                flexDirection: 'row',
                gap: 12,
                alignItems: 'flex-start',
                paddingVertical: 11,
                paddingHorizontal: active ? 10 : 0,
                marginHorizontal: active ? -10 : 0,
                borderRadius: active ? 12 : 0,
                backgroundColor: active ? theme.primaryContainer : 'transparent',
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.border,
              }}
            >
              <View style={{ marginTop: 3 }}>
                <StufenChips stufe={tier} size="md" />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 14,
                    color: theme.text,
                    marginBottom: 2,
                    letterSpacing: -0.1,
                  }}
                >
                  Stufe {tier} — {copy.label}
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 12,
                    lineHeight: 17,
                    color: theme.textSub,
                  }}
                >
                  {copy.line}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </FilterSheet>
  );
}

export default StufenLegendSheet;
