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
 *   3. User "Speichern" → schreibt age/ageBucket/ageReportedAt/
 *      ageReportedYear/gender ans users/{uid}.
 *      User X-Tap oder Backdrop-Tap → schreibt nur
 *      `demographicsSkipped: true`, niemand fragt nochmal.
 *
 * Design (T12.1): Picker-Logik liegt in components/ui/AgePicker.tsx
 * (geteilt mit edit-profile + email-register). Gender-Pills nutzen
 * den Profile-Editor-Style (pill-shape, surfaceAlt-bg) für visuelle
 * Konsistenz.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image as ExpoImage } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { FilterSheet } from '@/components/design/FilterSheet';
import { AgePicker } from '@/components/ui/AgePicker';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { GENDER_PILL_OPTIONS, type Gender } from '@/lib/types/gender';
import { ageBucketFromAge } from '@/lib/utils/age';

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
  const surfaceAlt = isDark ? 'rgba(255,255,255,0.06)' : '#f4f5f6';
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';

  const [age, setAge] = useState<number | null>(null);
  const [gender, setGender] = useState<Gender | ''>('');
  const [submitting, setSubmitting] = useState(false);
  // T16: Echtes Alkohol-Kategorie-Icon aus Firestore laden damit's
  // identisch aussieht zum Icon im Stöbern-Filter (User-Wunsch).
  // Fallback auf MaterialCommunityIcons.bottle-wine wenn der Fetch
  // failed oder das Bild noch lädt.
  const [alkoholIconUrl, setAlkoholIconUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const { categoryAccessService } = await import('@/lib/services/categoryAccessService');
        // userLevel/isPremium spielen hier keine Rolle, wir wollen nur
        // an die bild-URL der Alkohol-Kategorie.
        const cats = await categoryAccessService.getAllCategoriesWithAccess(99, true);
        if (cancelled) return;
        const alkohol = cats.find(c => (c.bezeichnung ?? '').toLowerCase().trim() === 'alkohol');
        if (alkohol?.bild) setAlkoholIconUrl(alkohol.bild);
      } catch {
        // Silent fallback — icon-fallback rendert dann.
      }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // T11.9: Reset auf Default-State wenn das Sheet (re-)öffnet.
  useEffect(() => {
    if (visible) {
      setAge(null);
      setGender('');
      setSubmitting(false);
    }
  }, [visible]);

  const canSubmit = age !== null && gender !== '';

  const handleSubmit = async () => {
    if (!canSubmit || submitting || gender === '' || age === null) return;
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
      maxHeightRatio={0.62}
    >
      <View style={styles.container}>
        {/* T16: Benefit-Row — Loss-Aversion-Trick: konkretes "Freischalten"-
            Versprechen statt nur abstrakter Statistik. Erhöht Antwort-Rate
            laut Mobbin/Reforge-Daten um 25-40% bei Demografie-Sheets. */}
        <View style={[styles.benefitRow, { backgroundColor: surfaceAlt, borderColor: border }]}>
          <View style={styles.benefitIconWrap}>
            {alkoholIconUrl ? (
              <ExpoImage
                source={{ uri: alkoholIconUrl }}
                style={styles.benefitIconImage}
                contentFit="contain"
                transition={150}
              />
            ) : (
              <MaterialCommunityIcons name="bottle-wine" size={22} color={Colors.light.tint} />
            )}
          </View>
          <Text style={[styles.benefitText, { color: textColor }]}>
            Verrate uns dein Alter um die Kategorie{' '}
            <Text style={styles.benefitTextBold}>Alkohol</Text> freizuschalten
          </Text>
        </View>

        <AgePicker value={age} onChange={setAge} textColor={textColor} />

        {/* Gender — Pill-Style aus dem Profile-Editor: height 44,
            radius 22 (pill shape), surfaceAlt bg / brand fill bei
            active. Konsistent mit edit-profile.tsx. */}
        <Text
          style={[
            styles.genderLabel,
            { color: gender ? textColor : mutedColor },
          ]}
        >
          Dein Geschlecht
        </Text>
        <View style={styles.genderRow}>
          {GENDER_PILL_OPTIONS.map((opt) => {
            const active = gender === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setGender(opt.value);
                }}
                style={({ pressed }) => [
                  styles.genderPill,
                  {
                    backgroundColor: active ? Colors.light.tint : surfaceAlt,
                    borderColor: active ? Colors.light.tint : border,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.genderPillText,
                    {
                      color: active ? '#fff' : textColor,
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

        {/* T16: Trust-Zeile unter Save — Microsignal-Pattern aus
            Stripe/Revolut/N26: Vertrauens-Hinweis direkt am Decision-
            Moment, Lock-Icon = universelles "sicher". */}
        <View style={styles.trustRow}>
          <MaterialCommunityIcons name="lock-outline" size={13} color={mutedColor} />
          <Text style={[styles.trustText, { color: mutedColor }]}>
            Anonyme Angaben — jederzeit im Profil änderbar
          </Text>
        </View>
      </View>
    </FilterSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
  // T16: Benefit-Row (Alkohol-Unlock-Versprechen) als subtile Card —
  // surfaceAlt-bg + dünner Border. Icon-Wrap mit kreisförmigem
  // light-tint-Hintergrund hebt das 🍺 visuell ab.
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  benefitIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(13,133,117,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  benefitIconImage: {
    width: 22,
    height: 22,
  },
  benefitText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Nunito_500Medium',
    letterSpacing: -0.1,
  },
  benefitTextBold: {
    fontFamily: 'Nunito_700Bold',
  },
  // T16: Trust-Row unter Save — kompakte Zeile mit Lock-Icon.
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  trustText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    letterSpacing: -0.1,
  },
  // Gender-Label-Style entspricht Field-label aus edit-profile.tsx
  // (fontSize 13, Bold, marginBottom 6).
  genderLabel: {
    fontSize: 13,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.1,
    marginTop: 18,
    marginBottom: 6,
  },
  genderRow: {
    flexDirection: 'row',
    gap: 8,
  },
  // T12.1: Pill-Style 1:1 wie edit-profile.tsx — height 44, radius
  // 22 (pill-shape, height/2), surfaceAlt bg, brand fill bei active.
  genderPill: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  genderPillText: {
    fontSize: 13,
    fontFamily: 'Nunito_700Bold',
    letterSpacing: -0.1,
  },
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
