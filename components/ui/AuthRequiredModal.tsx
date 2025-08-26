import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
// import { BlurView } from 'expo-blur'; // Temporär deaktiviert
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React from 'react';
import {
    Modal,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

interface AuthRequiredModalProps {
  visible: boolean;
  onClose: () => void;
  feature?: string;
  message?: string;
}

export const AuthRequiredModal: React.FC<AuthRequiredModalProps> = ({
  visible,
  onClose,
  feature = 'diese Funktion',
  message = 'Um diese Funktion zu nutzen, musst du dich mit einem Account anmelden.'
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const handleLogin = () => {
    onClose();
    router.push('/auth/login');
  };

  const handleRegister = () => {
    onClose();
    router.push('/auth/register?from=app');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* <BlurView 
          intensity={80} 
          tint={colorScheme === 'dark' ? 'dark' : 'light'}
          style={StyleSheet.absoluteFillObject}
        /> */}
        
        <View style={[styles.modal, { backgroundColor: colors.background }]}>
          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: colors.primary + '20' }]}>
            <IconSymbol name="lock.fill" size={32} color={colors.primary} />
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: colors.text }]}>
            Anmeldung erforderlich
          </Text>

          {/* Message */}
          <Text style={[styles.message, { color: colors.gray }]}>
            {message}
          </Text>

          {/* Feature Badge */}
          {feature && (
            <View style={[styles.featureBadge, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.featureText, { color: colors.primary }]}>
                🔐 {feature}
              </Text>
            </View>
          )}

          {/* Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity 
              style={styles.primaryButtonContainer}
              onPress={handleRegister}
            >
              <LinearGradient
                colors={[colors.primary, colors.primaryDark || colors.primary]}
                style={styles.primaryButton}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.primaryButtonText}>Kostenlos registrieren</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.secondaryButton, { borderColor: colors.border }]}
              onPress={handleLogin}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
                Anmelden
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.laterButton}
              onPress={onClose}
            >
              <Text style={[styles.laterButtonText, { color: colors.gray }]}>
                Später
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modal: {
    margin: 20,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    width: '90%',
    maxWidth: 360,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  featureBadge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 24,
  },
  featureText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButtonContainer: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  primaryButton: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  secondaryButton: {
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  laterButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  laterButtonText: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
  },
});
