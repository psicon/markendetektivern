/**
 * AiManufacturerCard — Info-Karte zur KI-Einschätzung des Herstellers.
 *
 * KEIN Score (User-Vorgabe 2026-05-29) — reine Info: Herkunft/Einordnung
 * + ggf. vorsichtige bekannte Kontroverse. Gefüttert von
 * cloud-functions/ai-product-comparison (hersteller/{id}.aiHersteller),
 * pro Hersteller einmal berechnet.
 *
 * Wird UNTER der KI-Analyse (AiComparisonScale / AiHealthScale) auf
 * noname-detail (Stufe 1/2) UND product-comparison (Stufe 3/4/5) gezeigt.
 * Skip-Verhalten wie die anderen KI-Karten: keine Daten / skipped / nur
 * Fehler → null.
 *
 * Ausklappbar EXAKT wie AiComparisonScale (ClickUp 86c9jkj6y): Header +
 * Herkunfts-Badge bleiben sichtbar (Teaser), der Summary-Text klappt via
 * ReasoningAccordion auf/zu; die ganze Card ist Tap-Target und animiert
 * ihre Höhe weich (LinearTransition, UI-Thread). `onExpand` feuert beim
 * ERSTEN Aufklappen = herkunftsorientiertes Engagement-Signal für die
 * Journey (analog zum KI-/Nährwerte-Tracking).
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useState } from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { AiHersteller } from '@/lib/types/firestore';
import { ReasoningAccordion, isReasoningLong } from './ReasoningAccordion';

// Animierte Pressable: ganze Card animiert ihre Höhe weich (beide Richtungen),
// overflow:hidden gibt den Akkordeon-Effekt — identisch zu AiComparisonScale.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  aiHersteller?: AiHersteller | null;
  /** Hersteller-Name fürs Header-Label (optional) → "Hersteller: <name>". */
  herstellerName?: string | null;
  /** Überschreibt das komplette Header-Label (z.B. "Marke: X"). */
  title?: string;
  /** Header-Icon (MaterialCommunityIcons). Default 'factory'. */
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  style?: ViewStyle;
  /** Tracking-Hook (86c9jkj6y): feuert beim ERSTEN Aufklappen des Summary-
   *  Texts = bewusstes "Herkunft genauer anschauen"-Signal. */
  onExpand?: () => void;
}

export function AiManufacturerCard({
  aiHersteller,
  herstellerName,
  title: titleOverride,
  icon = 'factory',
  style,
  onExpand,
}: Props) {
  const { theme } = useTokens();
  // Summary standardmäßig eingeklappt (wie KI-Analyse). Aufklappen = Signal.
  const [expanded, setExpanded] = useState(false);

  if (!aiHersteller) return null;
  if (aiHersteller.skipped) return null;
  const summary = (aiHersteller.summary || '').trim();
  if (!summary) return null; // nur Fehler / leer → nichts rendern

  const herkunft = (aiHersteller.herkunft || '').trim();
  const title =
    titleOverride?.trim() ||
    (herstellerName?.trim() ? `Hersteller: ${herstellerName.trim()}` : 'Hersteller');
  const accent = theme.primary ?? theme.text;
  const isLong = isReasoningLong(summary);

  return (
    <AnimatedPressable
      // Ganze Card = Tap-Target zum Auf-/Einklappen (wie AiComparisonScale).
      layout={LinearTransition.duration(220)}
      onPress={() => {
        if (isLong) {
          setExpanded((v) => {
            if (!v) onExpand?.(); // nur beim Aufklappen feuern
            return !v;
          });
        }
      }}
      disabled={!isLong}
      style={[
        {
          marginHorizontal: 20,
          marginTop: 12,
          padding: 14,
          paddingHorizontal: 16,
          borderRadius: radii.lg - 2,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: herkunft ? 8 : 10 }}>
        <MaterialCommunityIcons name={icon} size={16} color={theme.textMuted} />
        <Text
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 13,
            color: theme.text,
            letterSpacing: -0.1,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>

      {/* Herkunfts-Badge — bleibt auch eingeklappt sichtbar (Teaser, wie die
          Dot-Skala bei der KI-Analyse). */}
      {herkunft ? (
        <View
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingHorizontal: 9,
            paddingVertical: 4,
            borderRadius: radii.full,
            backgroundColor: theme.primaryContainer ?? theme.surfaceAlt ?? theme.border,
            marginBottom: 10,
          }}
        >
          <MaterialCommunityIcons name="map-marker-outline" size={12} color={accent} />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold as any,
              fontSize: 11,
              color: accent,
              letterSpacing: 0.1,
            }}
          >
            {herkunft}
          </Text>
        </View>
      ) : null}

      {/* Summary — 1 Zeile gekürzt, ganze Card klappt auf/zu. Symmetrische
          Höhen-Animation via ReasoningAccordion (geteilt mit der KI-Analyse). */}
      <ReasoningAccordion text={summary} accent={accent} expanded={expanded} />

      {/* Transparenz-Hinweis (Modell-Wissen, keine Live-News) — nur sichtbar
          wenn der Text ohnehin offen ist (aufgeklappt oder zu kurz zum Klappen). */}
      {expanded || !isLong ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 10,
            color: theme.textMuted,
            letterSpacing: 0.2,
            marginTop: 8,
          }}
        >
          KI-Einschätzung auf Basis von Modellwissen · keine tagesaktuellen Angaben
        </Text>
      ) : null}
    </AnimatedPressable>
  );
}

export default AiManufacturerCard;
