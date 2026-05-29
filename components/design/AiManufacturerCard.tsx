/**
 * AiManufacturerCard — Info-Karte zur KI-Einschätzung des Herstellers.
 *
 * KEIN Score (User-Vorgabe 2026-05-29) — reine Info: Herkunft/Einordnung
 * + ggf. vorsichtige bekannte Kontroverse. Gefüttert von
 * cloud-functions/ai-product-comparison (hersteller/{id}.aiHersteller),
 * pro Hersteller einmal berechnet.
 *
 * Wird UNTER der KI-Analyse (AiComparisonScale / AiHealthScale) auf
 * noname-detail + product-comparison gezeigt. Skip-Verhalten wie die
 * anderen KI-Karten: keine Daten / skipped / nur Fehler → null.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Text, View, ViewStyle } from 'react-native';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { AiHersteller } from '@/lib/types/firestore';

interface Props {
  aiHersteller?: AiHersteller | null;
  /** Hersteller-Name fürs Header-Label (optional). */
  herstellerName?: string | null;
  style?: ViewStyle;
}

export function AiManufacturerCard({ aiHersteller, herstellerName, style }: Props) {
  const { theme } = useTokens();

  if (!aiHersteller) return null;
  if (aiHersteller.skipped) return null;
  const summary = (aiHersteller.summary || '').trim();
  if (!summary) return null; // nur Fehler / leer → nichts rendern

  const herkunft = (aiHersteller.herkunft || '').trim();
  const title = herstellerName?.trim() ? `Hersteller: ${herstellerName.trim()}` : 'Hersteller';

  return (
    <View
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
        },
        style,
      ]}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: herkunft ? 8 : 10 }}>
        <MaterialCommunityIcons name="factory" size={16} color={theme.textMuted} />
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

      {/* Herkunfts-Badge */}
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
          <MaterialCommunityIcons name="map-marker-outline" size={12} color={theme.primary ?? theme.text} />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold as any,
              fontSize: 11,
              color: theme.primary ?? theme.text,
              letterSpacing: 0.1,
            }}
          >
            {herkunft}
          </Text>
        </View>
      ) : null}

      {/* Summary */}
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          lineHeight: 19,
          color: theme.textSub,
        }}
      >
        {summary}
      </Text>

      {/* Transparenz-Hinweis (Modell-Wissen, keine Live-News) */}
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
    </View>
  );
}

export default AiManufacturerCard;
