import { Image as ExpoImage } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { Poll, PollAnswer } from '@/lib/types/survey';

/**
 * SurveyRunner — führt den User durch die Fragen einer Umfrage
 * (ClickUp 86ca8fbpz). Single-/Multiple-Choice als Pillen, Text als
 * Eingabefeld, optionales Bild pro Frage. Progress oben, Pflichtfragen
 * gaten den Weiter-Button. Lebt im SurveySheet (FilterSheet).
 *
 * Liefert beim Abschluss alle Antworten an `onComplete`. Eigene Frage-
 * Reihenfolge folgt `order` (stabil sortiert).
 */
export function SurveyRunner({
  poll,
  onComplete,
}: {
  poll: Poll;
  onComplete: (answers: PollAnswer[]) => void;
}) {
  const { theme, brand } = useTokens();

  const questions = useMemo(
    () => [...(poll.questions ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [poll.questions],
  );

  const [idx, setIdx] = useState(0);
  // answers[questionId] = string (text/single) | string[] (multiple)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const q = questions[idx];
  const total = questions.length;
  const isLast = idx === total - 1;

  if (!q) return null;

  const current = answers[q.id];
  const answered =
    q.questionType === 'multiple_choice'
      ? Array.isArray(current) && current.length > 0
      : typeof current === 'string' && current.trim().length > 0;
  const canAdvance = !q.required || answered;

  const setSingle = (option: string) =>
    setAnswers((prev) => ({ ...prev, [q.id]: option }));

  const toggleMulti = (option: string) =>
    setAnswers((prev) => {
      const arr = Array.isArray(prev[q.id]) ? [...(prev[q.id] as string[])] : [];
      const i = arr.indexOf(option);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(option);
      return { ...prev, [q.id]: arr };
    });

  const setText = (txt: string) => setAnswers((prev) => ({ ...prev, [q.id]: txt }));

  const finish = () => {
    const out: PollAnswer[] = questions.map((qq) => {
      const v = answers[qq.id];
      return {
        questionId: qq.id,
        questionType: qq.questionType,
        answer:
          qq.questionType === 'multiple_choice'
            ? Array.isArray(v)
              ? v
              : []
            : typeof v === 'string'
              ? v
              : '',
      };
    });
    onComplete(out);
  };

  const next = () => {
    if (!canAdvance) return;
    if (isLast) finish();
    else setIdx((i) => i + 1);
  };

  const back = () => setIdx((i) => Math.max(0, i - 1));

  return (
    <View style={{ paddingBottom: 8 }}>
      {/* Progress */}
      <View style={{ marginBottom: 14 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 12,
            color: theme.textMuted,
            marginBottom: 6,
          }}
        >
          Frage {idx + 1} von {total}
        </Text>
        <View
          style={{
            height: 5,
            borderRadius: 3,
            backgroundColor: theme.surfaceAlt,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 5,
              borderRadius: 3,
              width: `${((idx + 1) / total) * 100}%`,
              backgroundColor: brand.primary,
            }}
          />
        </View>
      </View>

      {/* Optionales Bild */}
      {q.imageUrl ? (
        <ExpoImage
          source={{ uri: q.imageUrl }}
          style={{
            width: '100%',
            height: 160,
            borderRadius: radii.lg,
            marginBottom: 14,
            backgroundColor: theme.surfaceAlt,
          }}
          contentFit="cover"
          transition={200}
        />
      ) : null}

      {/* Fragetext */}
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 18,
          letterSpacing: -0.2,
          color: theme.text,
          marginBottom: 14,
        }}
      >
        {q.questionText}
      </Text>

      {/* Antwort-Eingabe */}
      <ScrollView
        style={{ maxHeight: 320 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {q.questionType === 'text' ? (
          <TextInput
            value={typeof current === 'string' ? current : ''}
            onChangeText={setText}
            placeholder="Deine Antwort …"
            placeholderTextColor={theme.textMuted}
            multiline
            style={{
              minHeight: 96,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              paddingHorizontal: 14,
              paddingVertical: 12,
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 15,
              color: theme.text,
              textAlignVertical: 'top',
            }}
          />
        ) : (
          (q.options ?? []).map((opt) => {
            const selected =
              q.questionType === 'multiple_choice'
                ? Array.isArray(current) && current.includes(opt)
                : current === opt;
            return (
              <Pressable
                key={opt}
                onPress={() =>
                  q.questionType === 'multiple_choice' ? toggleMulti(opt) : setSingle(opt)
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 14,
                  // Höhere Tap-Fläche (~Button-Höhe) → weniger Fehltipps.
                  minHeight: 52,
                  paddingVertical: 12,
                  borderRadius: radii.md,
                  marginBottom: 8,
                  borderWidth: selected ? 1.5 : 1,
                  borderColor: selected ? brand.primary : theme.border,
                  backgroundColor: selected ? theme.primaryContainer ?? theme.surfaceAlt : theme.surface,
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: q.questionType === 'multiple_choice' ? 5 : 10,
                    borderWidth: 2,
                    borderColor: selected ? brand.primary : theme.borderStrong ?? theme.border,
                    backgroundColor: selected ? brand.primary : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {selected ? (
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>
                  ) : null}
                </View>
                <Text
                  style={{
                    flex: 1,
                    fontFamily,
                    fontWeight: selected ? fontWeight.bold : fontWeight.medium,
                    fontSize: 15,
                    color: theme.text,
                  }}
                >
                  {opt}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Navigation */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        {idx > 0 ? (
          <Pressable
            onPress={back}
            style={({ pressed }) => ({
              height: 50,
              paddingHorizontal: 22,
              borderRadius: radii.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.surfaceAlt,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 15, color: theme.textSub }}>
              Zurück
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={next}
          disabled={!canAdvance}
          style={({ pressed }) => ({
            flex: 1,
            height: 50,
            borderRadius: radii.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canAdvance ? brand.primary : theme.borderStrong ?? theme.border,
            opacity: pressed && canAdvance ? 0.9 : 1,
          })}
        >
          <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: '#fff' }}>
            {isLast ? 'Absenden' : 'Weiter'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
