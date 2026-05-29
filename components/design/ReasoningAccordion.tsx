/**
 * ReasoningAccordion — ein-/ausklappbarer KI-Begründungstext.
 *
 * Rein präsentational: rendert den Text (1 Zeile gekürzt wenn eingeklappt)
 * + einen "Mehr/Weniger anzeigen"-Hinweis. Die WEICHE Höhen-Animation macht
 * die umschließende Card via Reanimated `LinearTransition` + overflow:hidden
 * (zuverlässiges Card-Reflow in beide Richtungen). `expanded` hält der
 * Parent (die ganze Card ist Tap-Target).
 *
 * Geteilt von AiComparisonScale + AiHealthScale, damit beide identisch sind.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Text, View } from 'react-native';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

/** Heuristik: lohnt sich ein Ausklappen überhaupt? */
export function isReasoningLong(text?: string | null): boolean {
  return (text || '').trim().length > 45;
}

interface Props {
  text: string;
  /** Akzentfarbe für den "Mehr/Weniger anzeigen"-Hinweis. */
  accent: string;
  /** Vom Parent gehalten (ganze Card ist Tap-Target). */
  expanded: boolean;
}

export function ReasoningAccordion({ text, accent, expanded }: Props) {
  const { theme } = useTokens();
  const reasoning = (text || '').trim();
  if (!reasoning) return null;
  const long = reasoning.length > 45;

  return (
    <View>
      <Text
        numberOfLines={!long || expanded ? undefined : 1}
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          lineHeight: 19,
          color: theme.textSub,
        }}
      >
        {reasoning}
      </Text>
      {long ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8 }}>
          <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 12, color: accent }}>
            {expanded ? 'Weniger anzeigen' : 'Mehr anzeigen'}
          </Text>
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={accent}
          />
        </View>
      ) : null}
    </View>
  );
}

export default ReasoningAccordion;
