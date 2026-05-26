/**
 * OnboardingSkipPill — kleines dezentes Skip-Element rechts oben
 * unter der ProgressBar.
 *
 * Eigene Row (kein position-absolute) damit kein Z-Index-Konflikt
 * mit Status-Bar / Dynamic-Island entsteht.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

interface Props {
  label: string;
  onPress: () => void;
}

export function OnboardingSkipPill({ label, onPress }: Props) {
  const colorScheme = useColorScheme();
  const styles = createStyles(colorScheme);
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.pill}
        onPress={onPress}
        activeOpacity={0.7}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Text style={styles.text}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

function createStyles(colorScheme: 'light' | 'dark' | null | undefined) {
  const isDark = colorScheme === 'dark';
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: 20,
      paddingTop: 2,
      paddingBottom: 4,
    },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 14,
      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    },
    text: {
      fontSize: 12,
      fontFamily: 'Nunito_500Medium',
      color: isDark ? Colors.dark.text : Colors.light.text,
      opacity: 0.7,
    },
  });
}
