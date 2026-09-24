import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';

import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { StandortPflicht } from '@/lib/services/standortPflicht';

/**
 * Sperrhinweis der Standortpflicht (siehe `lib/services/standortPflicht.ts`).
 *
 * Bewusst KEIN eigenes Modal: der Hinweis ersetzt den Inhalt des Screens
 * bzw. des bereits offenen Sheets. Ein zweites Modal über einem Sheet
 * deadlockt iOS (siehe `sheetPresence.ts`).
 *
 * Ton nach Projektregel: der Nutzen und der nächste Schritt, kein Mangel.
 */

export type RewardArt = 'bon' | 'foto' | 'umfrage';

const WOFUER: Record<RewardArt, string> = {
  bon: 'Die Standortfreigabe gehört zur Teilnahme am Belohnungsprogramm. Bei Bons zählt vor allem die Filialadresse vom Bon — danach geht es direkt zum Scanner.',
  foto: 'Die Standortfreigabe gehört zur Teilnahme am Belohnungsprogramm — so landen deine Fotos bei dem Markt, in dem du gerade stehst.',
  umfrage: 'Die Standortfreigabe gehört zur Teilnahme am Belohnungsprogramm — danach geht es direkt mit der Umfrage weiter.',
};

const TEXTE: Record<Exclude<StandortPflicht, 'erfuellt'>, { titel: string; taste: string; icon: string }> = {
  fragen: { titel: 'Standort freigeben', taste: 'Standort freigeben', icon: 'map-marker-radius-outline' },
  einstellungen: { titel: 'Standort in den Einstellungen freigeben', taste: 'Einstellungen öffnen', icon: 'cog-outline' },
  dienste_aus: { titel: 'Ortungsdienste einschalten', taste: 'Ortungsdienste einschalten', icon: 'crosshairs-gps' },
};

function wegBeschreibung(stand: Exclude<StandortPflicht, 'erfuellt'>): string | null {
  if (stand === 'einstellungen') {
    return Platform.OS === 'ios'
      ? 'Dort unter „Standort" „Beim Verwenden der App" wählen.'
      : 'Dort unter „Berechtigungen" den Standort erlauben.';
  }
  if (stand === 'dienste_aus' && Platform.OS === 'ios') {
    return 'Einstellungen → Datenschutz & Sicherheit → Ortungsdienste.';
  }
  return null;
}

interface Props {
  stand: Exclude<StandortPflicht, 'erfuellt'>;
  art: RewardArt;
  laeuft: boolean;
  onErfuellen: () => void;
  onZurueck: () => void;
  zurueckLabel?: string;
}

export function StandortPflichtHinweis({ stand, art, laeuft, onErfuellen, onZurueck, zurueckLabel = 'Zurück' }: Props) {
  const { theme } = useTokens();
  const t = TEXTE[stand];
  const weg = wegBeschreibung(stand);

  return (
    <View style={{ paddingHorizontal: 24, paddingVertical: 20, gap: 18, alignItems: 'center' }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.primaryContainer,
        }}>
        <MaterialCommunityIcons name={t.icon as any} size={32} color={theme.primary} />
      </View>

      <View style={{ gap: 8, alignItems: 'center' }}>
        <Text
          style={{
            fontFamily: fontFamilyVariants.heading,
            fontWeight: fontWeight.bold as any,
            fontSize: 20,
            letterSpacing: -0.2,
            color: theme.text,
            textAlign: 'center',
          }}>
          {t.titel}
        </Text>
        <Text
          style={{
            fontFamily: fontFamilyVariants.body,
            fontWeight: fontWeight.medium as any,
            fontSize: 14,
            lineHeight: 20,
            color: theme.textSub,
            textAlign: 'center',
            maxWidth: 340,
          }}>
          {WOFUER[art]}
        </Text>
        {weg ? (
          <Text
            style={{
              fontFamily: fontFamilyVariants.body,
              fontWeight: fontWeight.medium as any,
              fontSize: 12,
              lineHeight: 17,
              color: theme.textMuted,
              textAlign: 'center',
              maxWidth: 320,
            }}>
            {weg}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={onErfuellen}
        disabled={laeuft}
        accessibilityRole="button"
        style={({ pressed }) => ({
          alignSelf: 'stretch',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 50,
          borderRadius: radii.md,
          backgroundColor: theme.primary,
          opacity: pressed || laeuft ? 0.85 : 1,
        })}>
        {laeuft ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 }}>
            {t.taste}
          </Text>
        )}
      </Pressable>

      <Text
        style={{
          fontFamily: fontFamilyVariants.body,
          fontWeight: fontWeight.medium as any,
          fontSize: 12,
          lineHeight: 17,
          color: theme.textMuted,
          textAlign: 'center',
        }}>
        Der Standort wird nur zu deinen Einreichungen gespeichert — nicht im Hintergrund verfolgt.
      </Text>

      <Pressable onPress={onZurueck} hitSlop={10} style={{ paddingVertical: 6 }}>
        <Text style={{ fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 14, color: theme.textSub }}>
          {zurueckLabel}
        </Text>
      </Pressable>
    </View>
  );
}
