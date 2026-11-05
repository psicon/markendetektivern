import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Location from 'expo-location';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { CaptureContext } from '@/lib/services/captureContext';
import { pruefeStandortPflicht } from '@/lib/services/standortPflicht';

/**
 * Fragt im Wizard nach dem Ort, wenn beim Einreichen kein GPS-Fix vorliegt.
 *
 * ═══ Wann dieser Schritt kommt (seit 6.0.20) ═══
 *
 * Die Standortfreigabe ist Teilnahmebedingung des Reward-Programms; ohne
 * sie zeigt der Wizard nur den Sperrhinweis (`useStandortPflicht`). Dieser
 * Schritt ist deshalb KEIN Ersatz für die Freigabe mehr, sondern nur der
 * Ausweg, wenn sie steht, das Gerät aber keinen Fix bekommt (Filiale,
 * Keller). Rangfolge des geltenden Orts: Bon-Adresse → GPS → diese
 * Ortsangabe → IP-Ortung (serverseitig).
 *
 * Wird die Freigabe zwischendurch entzogen, meldet der Schritt das über
 * `onFreigabeFehlt` — der Wizard zeigt dann wieder den Sperrhinweis statt
 * der Freitexteingabe.
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
  /**
   * Optionaler Hinweis, warum der Schritt (erneut) kommt — z.B. wenn der
   * stille GPS-Fix beim Einreichen scheiterte (Submit-Gate im Wizard).
   */
  hinweis?: string | null;
  /** Freigabe fehlt inzwischen → der Wizard übernimmt mit dem Sperrhinweis. */
  onFreigabeFehlt: () => void;
}

/** Innen kann ein frischer Fix 30–60 s dauern — so lange wartet niemand. */
const FIX_ZEITLIMIT_MS = 12000;

type Status = 'frage' | 'ermittelt' | 'gefunden' | 'eingabe';

export function LocationConfirmStep({ marketName, onConfirm, onBack, hinweis, onFreigabeFehlt }: Props) {
  const { theme } = useTokens();
  const [status, setStatus] = useState<Status>('frage');
  const [ort, setOrt] = useState('');
  const [gefunden, setGefunden] = useState<ConfirmedPlace | null>(null);

  /**
   * Zweiter GPS-Versuch mit Zeitlimit. Bleibt der Fix wieder aus, geht es
   * in die Ortseingabe — die Freigabe steht ja, nur das Signal fehlt.
   */
  const standortVerwenden = useCallback(async () => {
    setStatus('ermittelt');
    let zeitlimit: ReturnType<typeof setTimeout> | undefined;
    try {
      // Freigabe UND Ortungsdienste — auf Android lassen sich die Dienste
      // über die Schnelleinstellungen abschalten, ohne dass die App den
      // Vordergrund verlässt.
      if ((await pruefeStandortPflicht()) !== 'erfuellt') {
        setStatus('frage');
        onFreigabeFehlt();
        return;
      }

      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) => {
          zeitlimit = setTimeout(() => reject(new Error('fix_zeitlimit')), FIX_ZEITLIMIT_MS);
        }),
      ]);
      clearTimeout(zeitlimit);

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
      clearTimeout(zeitlimit);
      setStatus('eingabe');
    }
  }, [onFreigabeFehlt]);

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
          {hinweis ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <MaterialCommunityIcons name="map-marker-question-outline" size={18} color={theme.primary} style={{ marginTop: 1 }} />
              <Text style={[T.text, { flex: 1 }]}>{hinweis}</Text>
            </View>
          ) : null}
          <Haupttaste label="Standort erneut ermitteln" icon="crosshairs-gps" onPress={standortVerwenden} />
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
        </Karte>
      )}

      <Pressable onPress={onBack} style={{ alignItems: 'center', paddingVertical: 10 }}>
        <Text style={T.klein}>Zurück zur Übersicht</Text>
      </Pressable>
    </ScrollView>
  );
}
