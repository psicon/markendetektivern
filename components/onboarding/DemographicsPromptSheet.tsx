/**
 * DemographicsPromptSheet — opt-in Bottom-Sheet das nach dem
 * Onboarding-Climax einmalig erscheint.
 *
 * Trigger (siehe app/(tabs)/index.tsx):
 *   1. Onboarding-Climax oder Climax-via-Auth setzt
 *      `pending_demographics_prompt=1` in AsyncStorage.
 *   2. Beim ersten Mount des Home-Tabs nach dem Trigger wird das
 *      Sheet einmal angezeigt — wenn User noch keine `age`/`gender`
 *      in seinem User-Doc hat UND `OnboardingService.wasCompleted()`.
 *   3. User "Speichern" → schreibt age/ageBucket/gender ans
 *      users/{uid}, setzt `demographicsCapturedAt`.
 *      User "Vielleicht später" oder Backdrop-Tap → schreibt nur
 *      `demographicsSkipped: true`, niemand fragt nochmal.
 *
 * Design: gemäß CLAUDE.md "Hero pill" + "Selectors → ScopeCard"
 * Pattern. Schreibt das gleiche Gender-Schema das Edit-Profile
 * konsumiert (siehe T6 für Vereinheitlichung).
 */

import React, { useState } from 'react';
import { Animated as RNAnimated, Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

import { FilterSheet } from '@/components/design/FilterSheet';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

const AGE_MIN = 16;
const AGE_MAX = 80;
const AGE_DEFAULT = 30;

/**
 * Gender-Optionen (gemäß T6-Spec, ClickUp 86c9zbw9e). Die ID ist
 * die Storage-Form, der Label-Name die User-facing Anzeige. Das
 * Schema wird in T6 für Onboarding+Register+Edit-Profile
 * vereinheitlicht — hier vorerst exakt wie's der Onboarding-Step 5
 * vor T2 schrieb (kompatibel mit GENDER_USERDOC_MAP-Mapping).
 */
const GENDER_OPTIONS = [
  { id: 'männlich', label: 'Männlich' },
  { id: 'weiblich', label: 'Weiblich' },
  { id: 'nonbinary', label: 'Non-binär' },
  { id: 'anderes', label: 'Anderes' },
] as const;

const GENDER_USERDOC_MAP: Record<string, string> = {
  männlich: 'Männlich',
  weiblich: 'Weiblich',
  nonbinary: 'Divers',
  anderes: 'Anderes',
};

function ageBucketFromAge(age: number): string {
  if (age <= 24) return '16-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  if (age <= 64) return '55-64';
  return '65+';
}

export interface DemographicsResult {
  age: number;
  ageBucket: string;
  gender: string; // user-doc Wert (capitalized)
  rawGenderId: string; // lowercase ID
}

type Props = {
  visible: boolean;
  /** Aufgerufen wenn User "Speichern" tappt — Caller speichert
   *  ans users/{uid} + entfernt den Trigger-Flag. */
  onSubmit: (result: DemographicsResult) => void | Promise<void>;
  /** Aufgerufen bei "Vielleicht später" ODER Backdrop-Tap.
   *  Caller speichert `demographicsSkipped: true`. */
  onSkip: () => void | Promise<void>;
};

export function DemographicsPromptSheet({ visible, onSubmit, onSkip }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [age, setAge] = useState<number>(AGE_DEFAULT);
  const [ageInteracted, setAgeInteracted] = useState(false);
  const [gender, setGender] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = ageInteracted && gender.length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onSubmit({
        age,
        ageBucket: ageBucketFromAge(age),
        gender: GENDER_USERDOC_MAP[gender] ?? gender,
        rawGenderId: gender,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FilterSheet
      visible={visible}
      title="Hilf uns dich besser zu verstehen"
      onClose={onSkip}
      maxHeightRatio={0.78}
    >
      <View style={styles.container}>
        <Text style={[styles.intro, { color: isDark ? Colors.dark.text : Colors.light.text }]}>
          Anonyme Demografie-Angaben helfen uns die App für deine Zielgruppe zu verbessern.
          Du kannst sie jederzeit in deinem Profil ändern.
        </Text>

        {/* Age section */}
        <Text style={[styles.label, { color: isDark ? Colors.dark.text : Colors.light.text }]}>
          Dein Alter
        </Text>
        <View style={styles.ageDisplayBox}>
          {ageInteracted ? (
            <Text style={styles.ageNumber}>{age}</Text>
          ) : (
            <PulsingHint />
          )}
        </View>
        <Slider
          style={styles.slider}
          minimumValue={AGE_MIN}
          maximumValue={AGE_MAX}
          step={1}
          value={age}
          onValueChange={(v) => {
            if (!ageInteracted) setAgeInteracted(true);
            setAge(Math.round(v));
          }}
          minimumTrackTintColor={Colors.light.tint}
          maximumTrackTintColor={isDark ? '#444' : '#ddd'}
          thumbTintColor={Colors.light.tint}
        />
        <View style={styles.sliderLabels}>
          <Text style={[styles.sliderLabelText, { color: isDark ? Colors.dark.text : Colors.light.text }]}>
            {AGE_MIN}
          </Text>
          <Text style={[styles.sliderLabelText, { color: isDark ? Colors.dark.text : Colors.light.text }]}>
            {AGE_MAX}+
          </Text>
        </View>

        {/* Gender section */}
        <Text style={[styles.label, styles.labelSpaced, { color: isDark ? Colors.dark.text : Colors.light.text }]}>
          Dein Geschlecht
        </Text>
        <View style={styles.genderRow}>
          {GENDER_OPTIONS.map((opt) => {
            const active = gender === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => setGender(opt.id)}
                style={[
                  styles.genderPill,
                  {
                    backgroundColor: isDark ? Colors.dark.cardBackground : '#fff',
                    borderColor: active
                      ? Colors.light.tint
                      : isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(0,0,0,0.06)',
                  },
                  active && styles.genderPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.genderPillText,
                    {
                      color: active
                        ? Colors.light.tint
                        : isDark
                          ? Colors.dark.text
                          : Colors.light.text,
                      fontFamily: active ? 'Nunito_700Bold' : 'Nunito_600SemiBold',
                    },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Actions */}
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
          style={[
            styles.primaryBtn,
            { backgroundColor: canSubmit ? Colors.light.tint : '#ccc' },
          ]}
        >
          <Text style={styles.primaryBtnText}>
            {submitting ? 'Speichern…' : 'Speichern'}
          </Text>
        </Pressable>
        <Pressable onPress={onSkip} disabled={submitting} style={styles.secondaryBtn}>
          <Text style={[styles.secondaryBtnText, { color: isDark ? Colors.dark.text : Colors.light.text }]}>
            Vielleicht später
          </Text>
        </Pressable>
      </View>
    </FilterSheet>
  );
}

/** Sanftes Opacity-Pulse für "Wähle dein Alter"-Hint solange der
 *  User den Slider nicht berührt hat. Ehemals PulsingAgeHint aus
 *  onboarding/index.tsx — wandert mit dem Step in T3 hierher. */
function PulsingHint() {
  const opacity = React.useRef(new RNAnimated.Value(0.85)).current;
  React.useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
        RNAnimated.timing(opacity, { toValue: 0.85, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <RNAnimated.View style={{ alignItems: 'center', opacity }}>
      <Text style={styles.hintLine1}>Wähle dein Alter</Text>
      <Text style={styles.hintLine2}>Tippe oder ziehe den Regler</Text>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 12,
  },
  intro: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    lineHeight: 20,
    marginBottom: 18,
    opacity: 0.85,
  },
  label: {
    fontSize: 13,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.1,
    marginBottom: 6,
  },
  labelSpaced: {
    marginTop: 14,
  },
  ageDisplayBox: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 70,
    marginTop: 6,
    marginBottom: 2,
  },
  ageNumber: {
    fontSize: 44,
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
    letterSpacing: -0.8,
    lineHeight: 54,
  },
  hintLine1: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
    letterSpacing: -0.2,
  },
  hintLine2: {
    fontSize: 11,
    fontFamily: 'Nunito_500Medium',
    opacity: 0.65,
    marginTop: 3,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginTop: -4,
    marginBottom: 4,
  },
  sliderLabelText: {
    fontSize: 11,
    fontFamily: 'Nunito_500Medium',
    opacity: 0.6,
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  genderPill: {
    flex: 1,
    minWidth: '45%',
    minHeight: 46,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderPillActive: {
    backgroundColor: 'rgba(76,175,80,0.08)',
  },
  genderPillText: {
    fontSize: 14,
  },
  primaryBtn: {
    marginTop: 22,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.2,
  },
  secondaryBtn: {
    marginTop: 10,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    opacity: 0.7,
  },
});
