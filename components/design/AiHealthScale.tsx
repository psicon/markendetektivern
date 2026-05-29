/**
 * AiHealthScale — visualisiert die Standalone-KI-Bewertung eines
 * Produkts ohne Markenprodukt-Vergleich.
 *
 * Anders als AiComparisonScale (NoName↔Marken-Vergleich) zeigt diese
 * Komponente eine KATEGORIE-RELATIVE Einschätzung:
 *   healthScore 1 = unter Durchschnitt der Produkt-Kategorie
 *   healthScore 5 = sehr gute Wahl in der Kategorie
 *
 * Use-Case: Stufe 1/2 (NoNames ohne MP-Link) UND verknüpfte Produkte,
 * die mangels Daten nicht vergleichbar sind (Marke ohne Nährwerte/Zutaten).
 *
 * UI gespiegelt zu AiComparisonScale: kein Header-Pill (kein Titel-Umbruch),
 * aktive Skalen-Seite als Pill, Detailtext auf 1 Zeile gekürzt + ganze Card
 * als Tap-Target zum weich animierten Auf-/Einklappen.
 *
 * Skip-Verhalten identisch zu AiComparisonScale: keine Daten → null.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useState } from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { AiAssessment } from '@/lib/types/firestore';
import { ReasoningAccordion, isReasoningLong } from './ReasoningAccordion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props {
  aiAssessment?: AiAssessment | null;
  /** Optional. Default 'KI-Qualitäts- & Inhaltsanalyse'. */
  title?: string;
  style?: ViewStyle;
}

// Identische Palette wie AiComparisonScale — Score 3 bereits grün.
const SCALE_COLORS = ['#e53935', '#fb8c00', '#9ccc65', '#66bb6a', '#2e7d32'] as const;

export function AiHealthScale({
  aiAssessment,
  title = 'KI-Qualitäts- & Inhaltsanalyse',
  style,
}: Props) {
  const { theme } = useTokens();
  const [expanded, setExpanded] = useState(false);

  if (!aiAssessment) return null;
  if (aiAssessment.skipped) return null;
  if (aiAssessment.lastError && typeof aiAssessment.healthScore !== 'number') return null;
  const score = aiAssessment.healthScore;
  if (typeof score !== 'number' || score < 1 || score > 5) return null;

  const idx = score - 1;
  const accent = SCALE_COLORS[idx];
  const reasoning = (aiAssessment.reasoning || '').trim();
  const isLong = isReasoningLong(reasoning);
  const category = aiAssessment.category;

  const worseActive = score < 3; // unter Durchschnitt
  const betterActive = score > 3; // sehr gute Wahl

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

  return (
    <AnimatedPressable
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
      {/* Header — ohne Pill (kein Titel-Umbruch) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
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
      </View>

      {/* 5-Dot-Skala */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
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

      {/* Ausschlag-Labels — aktive Seite als Pill, sonst ausgegraut.
          Bei Durchschnitt (Score 3) zusätzlich mittig eine Pill. */}
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
            <Text style={pillText}>unter Durchschnitt</Text>
          </View>
        ) : (
          <Text style={plainText}>unter Durchschnitt</Text>
        )}
        {!worseActive && !betterActive ? (
          <View style={pillStyle}>
            <Text style={pillText}>Durchschnitt</Text>
          </View>
        ) : null}
        {betterActive ? (
          <View style={pillStyle}>
            <Text style={pillText}>sehr gute Wahl</Text>
          </View>
        ) : (
          <Text style={plainText}>sehr gute Wahl</Text>
        )}
      </View>

      {/* Reasoning — 1 Zeile gekürzt, ganze Card klappt auf/zu. */}
      <ReasoningAccordion text={reasoning} accent={accent} expanded={expanded} />
    </AnimatedPressable>
  );
}

export default AiHealthScale;
