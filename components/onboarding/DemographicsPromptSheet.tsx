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
 * Design v2 (T11.6) — Compact Demografie-Sheet wie Strava/Whoop/
 * Headspace machen es:
 *   - Inline label + value für Alter (statt großes Display)
 *   - Single-Row Gender-Pills (statt 2x2-Grid)
 *   - Tightere Section-Gaps (12px statt 18-22)
 *   - "Vielleicht später" als Text-Link unter dem CTA (statt zweite
 *     Full-Height-Button-Row)
 *   - maxHeightRatio 0.58 statt 0.78 — Sheet bleibt kompakt
 */

import React, { useState } from 'react';
import { Animated as RNAnimated, Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

import { FilterSheet } from '@/components/design/FilterSheet';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { GENDER_PILL_OPTIONS, type Gender } from '@/lib/types/gender';
import { ageBucketFromAge } from '@/lib/utils/age';

const AGE_MIN = 16;
const AGE_MAX = 80;
const AGE_DEFAULT = 30;

export interface DemographicsResult {
  age: number;
  ageBucket: string;
  gender: Gender; // Canonical Enum-Wert
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
  const textColor = isDark ? Colors.dark.text : Colors.light.text;
  const mutedColor = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';

  const [age, setAge] = useState<number>(AGE_DEFAULT);
  const [ageInteracted, setAgeInteracted] = useState(false);
  const [gender, setGender] = useState<Gender | ''>('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = ageInteracted && gender !== '';

  const handleSubmit = async () => {
    if (!canSubmit || submitting || gender === '') return;
    setSubmitting(true);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onSubmit({
        age,
        ageBucket: ageBucketFromAge(age),
        gender,
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
      maxHeightRatio={0.52}
    >
      <View style={styles.container}>
        <Text style={[styles.intro, { color: mutedColor }]}>
          Anonyme Angaben — jederzeit im Profil änderbar.
        </Text>

        {/* Age — Label + Value inline. PulsingHint solange unangetastet.
            T11.7: sectionHeader hat fixe minHeight + Text-Elemente
            haben identische lineHeight damit das Modal NICHT größer
            wird wenn der User den Slider zieht. */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.label, { color: textColor }]}>Dein Alter</Text>
          {ageInteracted ? (
            <Text style={styles.ageValue}>{age}</Text>
          ) : (
            <PulsingHintInline />
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
          maximumTrackTintColor={isDark ? '#444' : '#e2e2e2'}
          thumbTintColor={Colors.light.tint}
        />
        <View style={styles.sliderLabels}>
          <Text style={[styles.sliderLabelText, { color: mutedColor }]}>{AGE_MIN}</Text>
          <Text style={[styles.sliderLabelText, { color: mutedColor }]}>{AGE_MAX}+</Text>
        </View>

        {/* Gender — single-row pills (flex:1, gleicher Breite). */}
        <Text style={[styles.label, styles.labelSpaced, { color: textColor }]}>
          Dein Geschlecht
        </Text>
        <View style={styles.genderRow}>
          {GENDER_PILL_OPTIONS.map((opt) => {
            const active = gender === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setGender(opt.value)}
                style={[
                  styles.genderPill,
                  {
                    backgroundColor: active
                      ? Colors.light.tint
                      : isDark
                        ? Colors.dark.cardBackground
                        : '#fff',
                    borderColor: active
                      ? Colors.light.tint
                      : isDark
                        ? 'rgba(255,255,255,0.10)'
                        : 'rgba(0,0,0,0.10)',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.genderPillText,
                    {
                      color: active ? '#fff' : textColor,
                      fontFamily: active ? 'Nunito_700Bold' : 'Nunito_600SemiBold',
                    },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Primary CTA + Text-Skip. */}
        {/* T11.7: "Vielleicht später" entfernt — X-Tap und Swipe-Down
            triggern bereits onSkip (gleiches Verhalten). Reduziert
            visual noise, matched moderne Sheet-Patterns
            (Headspace/Strava/TikTok/Duolingo). */}
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
          style={[
            styles.primaryBtn,
            {
              backgroundColor: canSubmit ? Colors.light.tint : isDark ? '#333' : '#dcdcdc',
              opacity: submitting ? 0.7 : 1,
            },
          ]}
        >
          <Text style={styles.primaryBtnText}>
            {submitting ? 'Speichern…' : 'Speichern'}
          </Text>
        </Pressable>
      </View>
    </FilterSheet>
  );
}

/** Inline-Variante des PulsingHint — kompakte einzeilige Hint statt
 *  des bisherigen 70 px hohen Display-Boxes. */
function PulsingHintInline() {
  const opacity = React.useRef(new RNAnimated.Value(0.55)).current;
  React.useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
        RNAnimated.timing(opacity, { toValue: 0.55, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <RNAnimated.View style={{ opacity }}>
      <Text style={styles.hintInline}>Ziehe den Regler</Text>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
  intro: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
    lineHeight: 18,
    marginBottom: 16,
  },
  // Section-Header: Label links, Value/Hint rechts.
  // T11.7: minHeight + fixe lineHeight auf beiden Text-Varianten →
  // Row springt NICHT in der Höhe wenn der PulsingHint (13pt) durch
  // den ageValue (18pt) ersetzt wird. Damit pulsiert das Modal
  // nicht beim ersten Slider-Touch.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
    marginBottom: 2,
  },
  label: {
    fontSize: 14,
    lineHeight: 24,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.1,
  },
  labelSpaced: {
    marginTop: 14,
    marginBottom: 8,
  },
  ageValue: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
    letterSpacing: -0.3,
  },
  hintInline: {
    fontSize: 13,
    lineHeight: 24,
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.tint,
    letterSpacing: -0.1,
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
  // Single-row Gender-Pills, jeweils flex:1 für gleiche Breite.
  genderRow: {
    flexDirection: 'row',
    gap: 6,
  },
  genderPill: {
    flex: 1,
    height: 38,
    paddingHorizontal: 6,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderPillText: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
  // CTA + Skip-Link.
  primaryBtn: {
    marginTop: 18,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.2,
  },
});
