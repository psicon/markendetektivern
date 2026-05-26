/**
 * OnboardingProgressBar — schmaler horizontaler Balken + "X von N"-Label.
 *
 * Wird in den Steps 2-5 (Märkte, Budget, Prios, Loading) gerendert.
 * Step 1 (Hero) + Step 6 (Climax) zeigen ihn bewusst nicht (Hero
 * hat kein Progress, Climax hat Confetti).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

interface Props {
  /** 1-basierter aktueller Step. */
  currentStep: number;
  /** Anzahl der "echten" Frage-Steps. Aktuell 4 bei Variante B. */
  denominator: number;
}

export function OnboardingProgressBar({ currentStep, denominator }: Props) {
  const colorScheme = useColorScheme();
  const styles = createStyles(colorScheme);
  const value = Math.min(currentStep - 1, denominator);
  const pct = Math.min(((currentStep - 1) / denominator) * 100, 100);

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.progressText}>
        {value} von {denominator}
      </Text>
    </View>
  );
}

function createStyles(colorScheme: 'light' | 'dark' | null | undefined) {
  const isDark = colorScheme === 'dark';
  return StyleSheet.create({
    progressContainer: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 4,
    },
    progressBar: {
      height: 6,
      borderRadius: 3,
      backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: Colors.light.tint,
      borderRadius: 3,
    },
    progressText: {
      marginTop: 6,
      fontSize: 11,
      fontFamily: 'Nunito_500Medium',
      color: isDark ? Colors.dark.text : Colors.light.text,
      opacity: 0.55,
      textAlign: 'right',
    },
  });
}
