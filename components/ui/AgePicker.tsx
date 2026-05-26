/**
 * AgePicker — wiederverwendbarer Inline-Slider zur Alter-Eingabe.
 *
 * Wird genutzt in:
 *   - DemographicsPromptSheet (post-Climax)
 *   - edit-profile.tsx (Profil-Editor)
 *   - auth/email-register.tsx (Registrierungs-Form)
 *
 * Single Source of Truth fürs Alters-Picker-UX in der App. Vermeidet
 * Drift zwischen Sheet- und Form-Varianten.
 *
 * Verhalten:
 *   - `value === null` → noch nicht gesetzt. Slider startet bei
 *     AGE_DEFAULT (30), Label-Row ist invisible (opacity 0), Hint
 *     pulsiert prominent.
 *   - `value !== null` → gesetzt. Label-Row faded ein (220ms),
 *     Hint pulsiert subtil weiter (Modal-Höhe bleibt stabil über
 *     den Lifecycle).
 *
 * Haptik: Light-Selection auf jedem Step-Change.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

export const AGE_MIN = 16;
export const AGE_MAX = 80;
export const AGE_DEFAULT = 30;

type Props = {
  /** Aktueller Alters-Wert; null wenn noch nicht ausgewählt. */
  value: number | null;
  /** Callback bei jedem Slider-Step. Liefert die neue Zahl. */
  onChange: (age: number) => void;
  /** Override für die Brand-Color (default: Colors.light.tint). */
  tintColor?: string;
  /** Text-Farbe für "Dein Alter"-Label. Default folgt theme. */
  textColor?: string;
  /** Compact-Modus für Form-Felder (edit-profile, settings).
   *  Nur Wert + Slider + Min/Max — kein pulsierender Hint, keine
   *  Animationen, kein "Dein Alter:"-Prefix (Field-Label übernimmt
   *  das schon). Default false (Hero-Modus fürs Demografie-Sheet). */
  compact?: boolean;
};

export function AgePicker({
  value,
  onChange,
  tintColor,
  textColor,
  compact = false,
}: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const tint = tintColor ?? Colors.light.tint;
  const labelText = textColor ?? (isDark ? Colors.dark.text : Colors.light.text);
  const mutedColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';

  const isSet = value !== null;
  const displayValue = value ?? AGE_DEFAULT;

  // Animierte Opacity für die "Dein Alter: X"-Row (Hero-Mode).
  // In Compact-Mode nicht genutzt (Form-Feld braucht keine Animation).
  const labelOpacity = useRef(new Animated.Value(isSet ? 1 : 0)).current;
  useEffect(() => {
    if (compact) return;
    Animated.timing(labelOpacity, {
      toValue: isSet ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [isSet, labelOpacity, compact]);

  const slider = (
    <Slider
      style={styles.slider}
      minimumValue={AGE_MIN}
      maximumValue={AGE_MAX}
      step={1}
      value={displayValue}
      onValueChange={(v) => {
        const rounded = Math.round(v);
        if (rounded !== displayValue) {
          Haptics.selectionAsync().catch(() => {});
        }
        onChange(rounded);
      }}
      minimumTrackTintColor={tint}
      maximumTrackTintColor={isDark ? '#444' : '#e2e2e2'}
      thumbTintColor={tint}
    />
  );

  const sliderLabels = (
    <View style={styles.sliderLabels}>
      <Text style={[styles.sliderLabelText, { color: mutedColor }]}>{AGE_MIN}</Text>
      <Text style={[styles.sliderLabelText, { color: mutedColor }]}>{AGE_MAX}+</Text>
    </View>
  );

  // T12.5/T12.6 Compact-Mode für Form-Felder: möglichst leise, fügt
  // sich in den Form-Flow ein statt als "neues Design" rauszustechen.
  // Aufbau: Slider mit Value-Badge inline rechts auf Höhe der Min/
  // Max-Labels — keine eigene Header-Row über dem Slider.
  if (compact) {
    return (
      <View style={styles.compactWrap}>
        {slider}
        <View style={styles.compactRow}>
          <Text style={[styles.sliderLabelText, { color: mutedColor }]}>{AGE_MIN}</Text>
          <Text
            style={[
              styles.valueCompact,
              { color: isSet ? tint : mutedColor },
            ]}
            allowFontScaling={false}
          >
            {isSet ? (displayValue >= AGE_MAX ? `${AGE_MAX}+` : displayValue) : '—'}
          </Text>
          <Text style={[styles.sliderLabelText, { color: mutedColor }]}>{AGE_MAX}+</Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <SliderHintAbove color={tint} active={!isSet} />
      <Animated.View style={[styles.sectionHeader, { opacity: labelOpacity }]}>
        <Text style={[styles.label, { color: labelText }]} allowFontScaling={false}>
          Dein Alter
          <Text style={[styles.ageValue, { color: tint }]}>
            : {displayValue >= AGE_MAX ? `${AGE_MAX}+` : displayValue}
          </Text>
        </Text>
      </Animated.View>
      {slider}
      {sliderLabels}
    </View>
  );
}

/** Pulsierende "Ziehe den Regler"-Hint ÜBER dem Label-Row.
 *  Wird IMMER gerendert (Modal-Höhe stabil). Pulse-Intensität
 *  reagiert auf active — stark vor Interaktion, subtil danach. */
function SliderHintAbove({ color, active }: { color: string; active: boolean }) {
  const opacity = useRef(new Animated.Value(0.95)).current;
  useEffect(() => {
    if (active) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.7, duration: 1200, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(opacity, { toValue: 0.4, duration: 400, useNativeDriver: true }).start();
  }, [active, opacity]);
  return (
    <Animated.View style={{ opacity, alignSelf: 'center', marginBottom: 4 }}>
      <Text style={[styles.sliderHintAbove, { color }]}>Ziehe den Regler</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    marginBottom: 4,
  },
  label: {
    fontSize: 16,
    lineHeight: 28,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.2,
  },
  ageValue: {
    fontSize: 20,
    lineHeight: 28,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.4,
  },
  sliderHintAbove: {
    fontSize: 17,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.2,
  },
  slider: {
    width: '100%',
    height: 32,
    marginTop: 2,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: -2,
  },
  sliderLabelText: {
    fontSize: 11,
    fontFamily: 'Nunito_500Medium',
  },
  // T12.6: Compact-Mode — Slider erst, dann Min / Value / Max in
  // einer Zeile darunter. Value sitzt zentriert zwischen Min und Max,
  // selbe Höhe wie die Labels — wirkt wie ein normaler Slider mit
  // Wert-Anzeige statt einer "neuen Card".
  compactWrap: {
    width: '100%',
  },
  compactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    marginTop: -2,
  },
  valueCompact: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.1,
  },
});
