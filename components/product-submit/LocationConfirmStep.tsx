import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Location from 'expo-location';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { CaptureContext } from '@/lib/services/captureContext';

/**
 * Fragt im Wizard, WO die Einreichung entsteht — direkt nach der Marktwahl.
 *
 * ═══ Warum genau hier ═══
 *
 * Der Wizard hat mit „In welchem Markt bist du?" bereits einen
 * verpflichtenden ersten Schritt VOR dem ersten Foto. Dieser Schritt
 * vervollständigt ihn: bisher wurde nur die KETTE erfasst, nicht der ORT.
 * Damit entsteht keine neue Hürde, sondern die Antwort auf eine Frage, die
 * die App ohnehin schon stellt.
 *
 * Die Reihenfolge ist der Kern: Eine Pflicht NACH sieben Fotos wäre die
 * schlechteste denkbare Stelle — dort ginge fertige Arbeit verloren und
 * der Ärger träfe genau die Leute, die den Aufwand schon betrieben haben.
 * Vor dem ersten Foto kostet dieselbe Pflicht niemanden etwas.
 *
 * ═══ Der iOS-Dialog wird geschützt ═══
 *
 * Der System-Dialog erscheint EINMAL im Leben der App; ein „Nein" ist
 * danach nur noch über die Einstellungen umkehrbar. Deshalb erklärt dieser
 * Schritt zuerst in der App, wofür gefragt wird, und löst den Dialog erst
 * aus, wenn jemand hier zustimmt. So wird der eine Versuch nur bei Leuten
 * verbraucht, die ohnehin einverstanden sind.
 *
 * ═══ Zwei gleichwertige Wege ═══
 *
 * Die Ortseingabe ist der vollwertige zweite Weg, nicht ein Trostpreis:
 * Sie braucht keine Berechtigung, erreicht damit auch alle, die GPS
 * ablehnen, und liefert eine Angabe auf Stadtebene. Wie sicher das ist,
 * entscheidet nicht dieser Screen, sondern die serverseitige Bewertung.
 *
 * ═══ Ton ═══
 *
 * Kein Satz benennt einen Mangel („ohne Standort keine…"). Projektregel:
 * nie Frustration erzeugen — immer der Nutzen und der nächste Schritt.
 */

export type ConfirmedPlace = NonNullable<CaptureContext['confirmedPlace']>;

interface Props {
  marketName: string;
  onConfirm: (place: ConfirmedPlace) => void;
  onBack: () => void;
}

type Status = 'frage' | 'ermittelt' | 'gefunden' | 'eingabe';

export function LocationConfirmStep({ marketName, onConfirm, onBack }: Props) {
  const { theme } = useTokens();
  const [status, setStatus] = useState<Status>('frage');
  const [ort, setOrt] = useState('');
  const [gefunden, setGefunden] = useState<ConfirmedPlace | null>(null);
  const [dauerhaftAbgelehnt, setDauerhaftAbgelehnt] = useState(false);

  /**
   * Löst den System-Dialog aus — und NUR hier. Ein Ablehnen ist kein
   * Fehlerfall: der Schritt wechselt dann in die Ortseingabe, damit
   * niemand in einer Sackgasse steht.
   */
  const standortVerwenden = useCallback(async () => {
    setStatus('ermittelt');
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (!p.granted) {
        setDauerhaftAbgelehnt(!p.canAskAgain);
        setStatus('eingabe');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // Ortsnamen nachschlagen, damit der Nutzer BESTÄTIGEN kann, was wir
      // ermittelt haben. Eine rohe Koordinate kann niemand prüfen — und
      // ohne Prüfmöglichkeit ist es keine Bestätigung.
      let city: string | null = null;
      let bundesland: string | null = null;
      let land: string | null = null;
      try {
        const [treffer] = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        city = treffer?.city ?? treffer?.subregion ?? null;
        bundesland = treffer?.region ?? null;
        land = treffer?.isoCountryCode ?? null;
      } catch {
        // Ohne Ortsnamen bleibt die Koordinate trotzdem gültig — sie ist
        // sogar das genauere Signal. Nur die Anzeige wird gröber.
      }

      setGefunden({
        city,
        bundesland,
        land,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracyM: pos.coords.accuracy ?? null,
      });
      setStatus('gefunden');
    } catch {
      setStatus('eingabe');
    }
  }, []);

  const T = {
    titel: { fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.bold as any, fontSize: 20, color: theme.text, letterSpacing: -0.2 },
    text: { fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.medium as any, fontSize: 14, color: theme.textSub, lineHeight: 20 },
    klein: { fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.medium as any, fontSize: 12, color: theme.textMuted },
  };

  const Karte = ({ children }: { children: React.ReactNode }) => (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 16,
        gap: 12,
      }}>
      {children}
    </View>
  );

  const Haupttaste = ({ label, icon, onPress }: { label: string; icon: any; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 50,
        borderRadius: radii.md,
        backgroundColor: theme.primary,
        opacity: pressed ? 0.85 : 1,
      })}>
      <MaterialCommunityIcons name={icon} size={19} color="#fff" />
      <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 }}>
        {label}
      </Text>
    </Pressable>
  );

  const Nebentaste = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        height: 46,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.surface,
        opacity: pressed ? 0.85 : 1,
      })}>
      <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 6 }}>
        <Text style={T.titel}>Wo bist du gerade?</Text>
        <Text style={T.text}>
          Damit deine Aufnahmen dem richtigen Markt zugeordnet werden — so sehen andere
          Detektive, wo es ein Produkt wirklich gibt.
        </Text>
      </View>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: radii.md,
          backgroundColor: theme.surfaceAlt,
        }}>
        <MaterialCommunityIcons name="storefront-outline" size={17} color={theme.textMuted} />
        <Text style={[T.klein, { color: theme.textSub }]} numberOfLines={1}>
          {marketName}
        </Text>
      </View>

      {status === 'frage' && (
        <Karte>
          <Haupttaste label="Meinen Standort verwenden" icon="crosshairs-gps" onPress={standortVerwenden} />
          <Nebentaste label="Ort eintippen" onPress={() => setStatus('eingabe')} />
          <Text style={T.klein}>
            Der Standort wird nur zu dieser Einreichung gespeichert — nicht im Hintergrund
            verfolgt.
          </Text>
        </Karte>
      )}

      {status === 'ermittelt' && (
        <Karte>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
            <ActivityIndicator color={theme.primary} />
            <Text style={T.text}>Standort wird ermittelt …</Text>
          </View>
        </Karte>
      )}

      {status === 'gefunden' && gefunden && (
        <Karte>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MaterialCommunityIcons name="map-marker-check" size={22} color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...T.titel, fontSize: 16 }}>{gefunden.city ?? 'Standort erfasst'}</Text>
              {gefunden.bundesland ? <Text style={T.klein}>{gefunden.bundesland}</Text> : null}
            </View>
          </View>
          <Haupttaste label="Passt, weiter" icon="check" onPress={() => onConfirm(gefunden)} />
          <Nebentaste label="Anderen Ort eintippen" onPress={() => setStatus('eingabe')} />
        </Karte>
      )}

      {status === 'eingabe' && (
        <Karte>
          <Text style={T.text}>In welchem Ort bist du?</Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              height: 38,
              borderRadius: 11,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              paddingHorizontal: 12,
            }}>
            <MaterialCommunityIcons name="map-marker-outline" size={16} color={theme.textMuted} />
            <TextInput
              value={ort}
              onChangeText={setOrt}
              placeholder="z. B. Ludwigsburg"
              placeholderTextColor={theme.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => ort.trim() && onConfirm({ city: ort.trim() })}
              style={{
                flex: 1,
                fontFamily: fontFamilyVariants.body,
                fontWeight: fontWeight.medium as any,
                fontSize: 14,
                color: theme.text,
              }}
            />
          </View>
          <Haupttaste
            label="Weiter"
            icon="arrow-right"
            onPress={() => ort.trim() && onConfirm({ city: ort.trim() })}
          />
          {/* Genau EINE Zeile zu den Einstellungen — auf iOS zeigt das System
              den Dialog nach einer Ablehnung nicht mehr an, ein erneuter
              Aufruf liefe ins Leere und wirkte wie ein Defekt. */}
          {dauerhaftAbgelehnt ? (
            <Pressable onPress={() => Linking.openSettings()}>
              <Text style={[T.klein, { color: theme.primary }]}>
                {Platform.OS === 'ios' ? 'Standort in den Einstellungen erlauben' : 'Standortfreigabe in den Einstellungen'}
              </Text>
            </Pressable>
          ) : null}
        </Karte>
      )}

      <Pressable onPress={onBack} style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Text style={T.klein}>Markt ändern</Text>
      </Pressable>
    </ScrollView>
  );
}
