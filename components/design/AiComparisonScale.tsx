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
import React from 'react';
import { Text, View, ViewStyle } from 'react-native';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { AiComparison } from '@/lib/types/firestore';

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
const SCALE_LABELS = [
  'klar schlechter',
  'etwas schlechter',
  'gleichwertig',
  'etwas besser',
  'klar besser',
] as const;

export function AiComparisonScale({
  aiComparison,
  title = 'KI-Qualitäts- & Inhaltsanalyse',
  style,
}: Props) {
  const { theme } = useTokens();

  // Skip-Logik — Caller sieht "nichts da" und kann eigenen Fallback wählen
  if (!aiComparison) return null;
  if (aiComparison.skipped) return null;
  if (aiComparison.lastError && typeof aiComparison.score !== 'number') return null;
  const score = aiComparison.score;
  if (typeof score !== 'number' || score < 1 || score > 5) return null;

  const idx = score - 1;
  const accent = SCALE_COLORS[idx];
  const label = SCALE_LABELS[idx];
  const reasoning = (aiComparison.reasoning || '').trim();

  return (
    <View
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
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: radii.full,
            backgroundColor: accent + '22',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold as any,
              fontSize: 10,
              letterSpacing: 0.3,
              color: accent,
              textTransform: 'uppercase',
            }}
          >
            {label}
          </Text>
        </View>
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
      {/* Labels rot…grün — die Ausschlagrichtung wird hervorgehoben:
          score < 3 → "schlechter" fett+farbig, score > 3 → "besser". */}
      {(() => {
        const worseActive = score < 3;
        const betterActive = score > 3;
        return (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: (worseActive ? fontWeight.extraBold : fontWeight.medium) as any,
                fontSize: 10,
                color: worseActive ? accent : theme.textMuted,
                letterSpacing: 0.2,
                textTransform: 'uppercase',
              }}
            >
              NoName schlechter
            </Text>
            <Text
              style={{
                fontFamily,
                fontWeight: (betterActive ? fontWeight.extraBold : fontWeight.medium) as any,
                fontSize: 10,
                color: betterActive ? accent : theme.textMuted,
                letterSpacing: 0.2,
                textTransform: 'uppercase',
              }}
            >
              NoName besser
            </Text>
          </View>
        );
      })()}

      {/* Reasoning */}
      {reasoning ? (
        <Text
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
      ) : null}
    </View>
  );
}

export default AiComparisonScale;
