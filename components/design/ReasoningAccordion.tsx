/**
 * ReasoningAccordion — ein-/ausklappbarer KI-Begründungstext mit
 * SYMMETRISCHER Höhen-Animation (auf- UND einklappen gleich weich).
 *
 * Geteilt von AiComparisonScale + AiHealthScale, damit beide Cards
 * identisch funktionieren.
 *
 * Mechanik: Der volle Text wird IMMER gerendert (numberOfLines unbegrenzt);
 * geклappt wird über die animierte Höhe eines overflow:hidden-Containers.
 * So wird der Text in BEIDE Richtungen progressiv freigegeben/verdeckt
 * (kein hartes Verschwinden beim Einklappen). Höhe wird via onTextLayout
 * gemessen (lines × lineHeight). Reanimated-Shared-Value → UI-Thread,
 * startet sofort. Kein LayoutAnimation (project-forbidden).
 *
 * `expanded` wird vom Parent gehalten (die ganze Card ist Tap-Target).
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

const LINE_HEIGHT = 19;
const COLLAPSED_LINES = 1;

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
  const long = reasoning.length > 45;

  const [fullH, setFullH] = useState(0);
  const collapsedH = LINE_HEIGHT * COLLAPSED_LINES;
  const h = useSharedValue(collapsedH);
  const animStyle = useAnimatedStyle(() => ({ height: h.value }));

  useEffect(() => {
    h.value = withTiming(expanded ? fullH || collapsedH : collapsedH, { duration: 220 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, fullH]);

  if (!reasoning) return null;

  const textStyle = {
    fontFamily,
    fontWeight: fontWeight.medium,
    fontSize: 13,
    lineHeight: LINE_HEIGHT,
    color: theme.textSub,
  } as const;

  // Kurzer Text → kein Akkordeon, einfach rendern.
  if (!long) {
    return <Text style={textStyle}>{reasoning}</Text>;
  }

  return (
    <View>
      <Animated.View style={[{ overflow: 'hidden' }, animStyle]}>
        <Text
          onTextLayout={(e) => {
            const lines = e.nativeEvent.lines.length || 1;
            const fh = Math.max(COLLAPSED_LINES, lines) * LINE_HEIGHT;
            setFullH((prev) => (Math.abs(prev - fh) > 0.5 ? fh : prev));
          }}
          style={textStyle}
        >
          {reasoning}
        </Text>
      </Animated.View>
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
    </View>
  );
}

export default ReasoningAccordion;
