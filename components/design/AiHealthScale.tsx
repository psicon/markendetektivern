/**
 * AiHealthScale — visualisiert die Standalone-KI-Bewertung eines
 * Produkts ohne Markenprodukt-Vergleich.
 *
 * Anders als AiComparisonScale (NoName↔Marken-Vergleich) zeigt diese
 * Komponente eine KATEGORIE-RELATIVE Einschätzung:
 *   healthScore 1 = unter Durchschnitt der Produkt-Kategorie
 *   healthScore 5 = sehr gute Wahl in der Kategorie
 *
 * Use-Case: noname-detail Stufe 1/2 (NoNames ohne MP-Link).
 *
 * Skip-Verhalten identisch zu AiComparisonScale: keine Daten → null.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Text, View, ViewStyle } from 'react-native';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { AiAssessment } from '@/lib/types/firestore';

interface Props {
  aiAssessment?: AiAssessment | null;
  /** Optional. Default 'KI-Qualitäts- & Inhaltsanalyse'. */
  title?: string;
  style?: ViewStyle;
}

// Identische Palette wie AiComparisonScale — Score 3 bereits grün.
const SCALE_COLORS = ['#e53935', '#fb8c00', '#9ccc65', '#66bb6a', '#2e7d32'] as const;
const SCALE_LABELS = [
  'unter Durchschnitt',
  'leicht unterdurchschnittlich',
  'durchschnittlich',
  'überdurchschnittlich',
  'sehr gute Wahl',
] as const;

export function AiHealthScale({
  aiAssessment,
  title = 'KI-Qualitäts- & Inhaltsanalyse',
  style,
}: Props) {
  const { theme } = useTokens();

  if (!aiAssessment) return null;
  if (aiAssessment.skipped) return null;
  if (aiAssessment.lastError && typeof aiAssessment.healthScore !== 'number') return null;
  const score = aiAssessment.healthScore;
  if (typeof score !== 'number' || score < 1 || score > 5) return null;

  const idx = score - 1;
  const accent = SCALE_COLORS[idx];
  const label = SCALE_LABELS[idx];
  const reasoning = (aiAssessment.reasoning || '').trim();
  const category = aiAssessment.category;

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
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 13,
              color: theme.text,
              letterSpacing: -0.1,
            }}
          >
            {title}
          </Text>
          {category ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 10,
                color: theme.textMuted,
                letterSpacing: 0.2,
                marginTop: 1,
              }}
            >
              im Vergleich zur Kategorie {category}
            </Text>
          ) : null}
        </View>
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
            fontWeight: fontWeight.medium,
            fontSize: 10,
            color: theme.textMuted,
            letterSpacing: 0.2,
            textTransform: 'uppercase',
          }}
        >
          unter Durchschnitt
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 10,
            color: theme.textMuted,
            letterSpacing: 0.2,
            textTransform: 'uppercase',
          }}
        >
          sehr gute Wahl
        </Text>
      </View>

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

export default AiHealthScale;
