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

export type RewardArt = 'bon' | 'bon_review' | 'foto' | 'umfrage';

// Kurz und mit dem Nutzen (User-Vorgabe 25.09.2026: „zu verbal", nicht
// „gehört zur Teilnahme"). Kein vorgeschobener Grund: bei Bons und Umfragen
// wird der Gerätestandort gar nicht gespeichert — also nichts behaupten.
const WOFUER: Record<RewardArt, string> = {
  bon: 'Einmal erlauben – dann geht’s direkt zum Scanner und du sammelst Belohnungen.',
  bon_review: 'Einmal erlauben – dein Foto bleibt erhalten und geht danach direkt raus.',
  foto: 'Einmal erlauben – so landen deine Fotos beim richtigen Markt und du sammelst Belohnungen.',
  umfrage: 'Einmal erlauben – dann geht’s direkt mit der Umfrage weiter.',
};

const TEXTE: Record<Exclude<StandortPflicht, 'erfuellt'>, { titel: string; taste: string; icon: string }> = {
  fragen: { titel: 'Noch ein kurzer Schritt', taste: 'Weiter', icon: 'map-marker-radius-outline' },
  einstellungen: { titel: 'Standort in den Einstellungen erlauben', taste: 'Einstellungen öffnen', icon: 'cog-outline' },
  dienste_aus: { titel: 'Ortung einschalten', taste: 'Ortung einschalten', icon: 'crosshairs-gps' },
};

function wegBeschreibung(stand: Exclude<StandortPflicht, 'erfuellt'>): string | null {
  if (stand === 'einstellungen') {
    return Platform.OS === 'ios' ? 'Standort → „Beim Verwenden der App“' : 'Berechtigungen → Standort → Zulassen';
  }
  if (stand === 'dienste_aus' && Platform.OS === 'ios') {
    return 'Datenschutz → Ortungsdienste';
  }
  return null;
}

/** iOS kann die Ortungsdienste nicht direkt öffnen — die Taste sagt, was passiert. */
function tastenText(stand: Exclude<StandortPflicht, 'erfuellt'>): string {
  if (stand === 'dienste_aus' && Platform.OS === 'ios') return 'Einstellungen öffnen';
  return TEXTE[stand].taste;
}

/**
 * Vor dem SYSTEMDIALOG (Stand „fragen") heißt die Taste neutral „Weiter" und
 * es gibt keinen eigenen Ausstieg — App Review lehnt Vorab-Hinweise ab, die
 * das Ablehnen vorwegnehmen (5.1.1(iv), „Continue"/„Next" statt „Allow"/
 * „Later"). Verlassen geht weiter über das X im Kopf bzw. im Sheet; die
 * Wahl selbst trifft der Nutzer im Systemdialog.
 */
const VOR_SYSTEMDIALOG: Exclude<StandortPflicht, 'erfuellt'> = 'fragen';

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
            {tastenText(stand)}
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
        Nur für deine Einreichungen – nie im Hintergrund.
      </Text>

      {stand === VOR_SYSTEMDIALOG ? null : (
        <Pressable onPress={onZurueck} hitSlop={10} style={{ paddingVertical: 6 }}>
          <Text style={{ fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 14, color: theme.textSub }}>
            {zurueckLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
