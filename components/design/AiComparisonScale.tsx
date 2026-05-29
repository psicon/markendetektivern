/**
 * AiComparisonScale — visualisiert das KI-Verdikt eines NoName-
 * Produkts gegenüber seinem Original-Markenprodukt.
 *
 * Schema (von `cloud-functions/ai-product-comparison`):
 *   score: 1..5     // 1 = NoName klar schlechter (rot)
 *                   // 3 = ungefähr gleichwertig (gelb)
 *                   // 5 = NoName klar besser (grün)
 *   reasoning: 1-2 Sätze auf Deutsch
 *
 * Render-Verhalten:
 *   • Wenn aiComparison fehlt ODER score nicht gesetzt → returnt null
 *     (Caller entscheidet ob Loading/Placeholder gezeigt werden soll)
 *   • Wenn skipped='no-markenprodukt' → returnt null (Stufe 1/2 hat
 *     keinen Vergleich; existing Detektiv-Check-Zeile übernimmt)
 *   • Wenn skipped='incomparable' → returnt null
 *   • Bei score → 5-Dot-Skala (rot → grün) mit highlight'tem Dot +
 *     Kurzbeschreibung darunter
 *
 * Design-Tokens-konform: padding, radii, fontWeight aus tokens.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useState } from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { AiComparison } from '@/lib/types/firestore';
import { ReasoningAccordion, isReasoningLong } from './ReasoningAccordion';

// Animierte Pressable: ganze Card animiert ihre Höhe weich (LinearTransition,
// UI-Thread) in BEIDE Richtungen, overflow:hidden gibt den Akkordeon-Effekt.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  aiComparison?: AiComparison | null;
  /** Optional. Wird in der Headline benutzt z.B. "Bewertung". */
  title?: string;
  style?: ViewStyle;
}

// 5-Tier Farb-Gradient — User-Vorgabe 2026-05-28:
// "gleichwertig" (Score 3) soll bereits grün sein. Wir lesen das so:
// ab Score 3 ist der NoName mindestens eine valide Alternative
// (kein Nachteil) → grün-Tier. Score 1+2 = ungünstig → rot/orange.
//   1 = Rot          (NoName klar schlechter)
//   2 = Orange       (etwas schlechter)
//   3 = Hellgrün     (gleichwertig — bereits OK)
//   4 = Grün         (etwas besser)
//   5 = Tiefgrün     (klar besser)
const SCALE_COLORS = ['#e53935', '#fb8c00', '#9ccc65', '#66bb6a', '#2e7d32'] as const;

export function AiComparisonScale({
  aiComparison,
  title = 'KI-Qualitäts- & Inhaltsanalyse',
  style,
}: Props) {
  const { theme } = useTokens();
  // Detailtext standardmäßig eingeklappt. Das Aufklappen ist später der
  // Tracking-Hook (ClickUp 86ca1h3fk): Aufklappen = bewusstes "genauer
  // anschauen"-Signal. Hier vorerst rein visuell, ohne Tracking.
  const [expanded, setExpanded] = useState(false);

  // Skip-Logik — Caller sieht "nichts da" und kann eigenen Fallback wählen
  if (!aiComparison) return null;
  if (aiComparison.skipped) return null;
  if (aiComparison.lastError && typeof aiComparison.score !== 'number') return null;
  const score = aiComparison.score;
  if (typeof score !== 'number' || score < 1 || score > 5) return null;

  const idx = score - 1;
  const accent = SCALE_COLORS[idx];
  const reasoning = (aiComparison.reasoning || '').trim();
  const isLong = isReasoningLong(reasoning);

  return (
    <AnimatedPressable
      // Ganze Card = Tap-Target zum Auf-/Einklappen. LinearTransition
      // animiert die Card-Höhe weich (beide Richtungen), overflow:hidden
      // gibt den Akkordeon-Effekt.
      layout={LinearTransition.duration(220)}
      onPress={() => {
        if (isLong) setExpanded((v) => !v);
      }}
      disabled={!isLong}
      style={[
        {
          marginHorizontal: 20,
          marginTop: 20,
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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <MaterialCommunityIcons name="brain" size={16} color={accent} />
        <Text
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 13,
            color: theme.text,
            letterSpacing: -0.1,
          }}
        >
          {title}
        </Text>
      </View>

      {/* 5-Dot-Skala */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          marginBottom: 10,
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n === score;
          const color = SCALE_COLORS[n - 1];
          return (
            <View
              key={n}
              style={{
                flex: 1,
                height: active ? 10 : 6,
                borderRadius: 5,
                backgroundColor: active ? color : color + '33',
              }}
            />
          );
        })}
      </View>
      {/* Ausschlag-Labels — das aktive Ende bekommt das Pill-Design
          (statt der entfernten Header-Pill). Links "Marke besser"
          (score<3), rechts "NoName besser" (score>3), Mitte
          "Gleichwertig" (score 3). */}
      {(() => {
        const worseActive = score < 3; // Marke besser
        const betterActive = score > 3; // NoName besser

        const pillStyle = {
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: radii.full,
          backgroundColor: accent + '22',
        } as const;
        const pillText = {
          fontFamily,
          fontWeight: fontWeight.bold as any,
          fontSize: 10,
          letterSpacing: 0.3,
          color: accent,
          textTransform: 'uppercase' as const,
        };
        const plainText = {
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 10,
          letterSpacing: 0.2,
          color: theme.textMuted,
          textTransform: 'uppercase' as const,
        };

        // Beide Labels IMMER sichtbar (auch bei gleichwertig → beide
        // ausgegraut). Nur die aktive Seite bekommt die farbige Pill.
        return (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            {worseActive ? (
              <View style={pillStyle}>
                <Text style={pillText}>Marke besser</Text>
              </View>
            ) : (
              <Text style={plainText}>Marke besser</Text>
            )}
            {betterActive ? (
              <View style={pillStyle}>
                <Text style={pillText}>NoName besser</Text>
              </View>
            ) : (
              <Text style={plainText}>NoName besser</Text>
            )}
          </View>
        );
      })()}

      {/* Reasoning — 1 Zeile gekürzt, ganze Card klappt auf/zu (Pressable
          oben). Symmetrische Höhen-Animation via ReasoningAccordion. */}
      <ReasoningAccordion text={reasoning} accent={accent} expanded={expanded} />
    </AnimatedPressable>
  );
}

export default AiComparisonScale;
