import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';

interface OnboardingButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export const OnboardingButton: React.FC<OnboardingButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style
}) => {
  const isPrimary = variant === 'primary';
  const colorScheme = useColorScheme();
  const styles = createStyles(colorScheme);
  
  return (
    <TouchableOpacity
      style={[
        styles.button,
        isPrimary ? styles.primaryButton : styles.secondaryButton,
        (disabled || loading) && styles.buttonDisabled,
        style
      ]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      <Text style={[
        styles.buttonText,
        isPrimary ? styles.primaryButtonText : styles.secondaryButtonText,
        (disabled || loading) && styles.buttonTextDisabled
      ]}>
        {loading ? 'Lädt...' : title}
      </Text>
    </TouchableOpacity>
  );
};

const createStyles = (colorScheme: 'light' | 'dark') => StyleSheet.create({
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButton: {
    backgroundColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colorScheme === 'dark' ? Colors.dark.text : Colors.light.tabIconDefault,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  primaryButtonText: {
    color: 'white',
  },
  secondaryButtonText: {
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
  },
  buttonTextDisabled: {
    opacity: 0.7,
  },
});
