import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

export default function RegisterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signUp } = useAuth();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  const handleRegister = async () => {
    if (!formData.username || !formData.email || !formData.password) {
      Alert.alert('Fehler', 'Bitte fülle alle Pflichtfelder aus.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      Alert.alert('Fehler', 'Die Passwörter stimmen nicht überein.');
      return;
    }

    if (formData.password.length < 6) {
      Alert.alert('Fehler', 'Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }

    if (!acceptTerms) {
      Alert.alert('Fehler', 'Bitte akzeptiere die AGB und Nutzungsbestimmungen.');
      return;
    }

    setLoading(true);

    try {
      await signUp(formData.email, formData.password, formData.username);
      Alert.alert('Erfolg', 'Account erfolgreich erstellt!', [
        { text: 'OK', onPress: () => router.replace('/(tabs)') }
      ]);
    } catch (error: any) {
      console.error('Registration error:', error);
      
      let errorMessage = 'Ein Fehler ist aufgetreten.';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'Diese E-Mail-Adresse wird bereits verwendet.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Das Passwort ist zu schwach.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Die E-Mail-Adresse ist ungültig.';
      }
      
      Alert.alert('Registrierung fehlgeschlagen', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <IconSymbol name="chevron.left" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
                  <ThemedText style={styles.title}>Jetzt registrieren</ThemedText>
        <ThemedText style={styles.subtitle}>
          und herausfinden, wer dahintersteckt.
        </ThemedText>

          {/* Form */}
          <View style={styles.form}>
            {/* Username */}
            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, { 
                  borderColor: colors.border, 
                  backgroundColor: colors.cardBackground,
                  color: colors.text 
                }]}
                placeholder="Nutzername"
                placeholderTextColor={colors.icon}
                value={formData.username}
                onChangeText={(text) => setFormData(prev => ({ ...prev, username: text }))}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Email */}
            <View style={styles.inputContainer}>
              <TextInput
                style={[styles.input, { 
                  borderColor: colors.border, 
                  backgroundColor: colors.cardBackground,
                  color: colors.text 
                }]}
                placeholder="Email"
                placeholderTextColor={colors.icon}
                value={formData.email}
                onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Password */}
            <View style={styles.inputContainer}>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[styles.passwordInput, { 
                    borderColor: colors.border, 
                    backgroundColor: colors.cardBackground,
                    color: colors.text 
                  }]}
                  placeholder="Passwort"
                  placeholderTextColor={colors.icon}
                  value={formData.password}
                  onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <IconSymbol 
                    name={showPassword ? "eye.slash" : "eye"} 
                    size={20} 
                    color={colors.icon} 
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password */}
            <View style={styles.inputContainer}>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[styles.passwordInput, { 
                    borderColor: colors.border, 
                    backgroundColor: colors.cardBackground,
                    color: colors.text 
                  }]}
                  placeholder="Passwort bestätigen"
                  placeholderTextColor={colors.icon}
                  value={formData.confirmPassword}
                  onChangeText={(text) => setFormData(prev => ({ ...prev, confirmPassword: text }))}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <IconSymbol 
                    name={showConfirmPassword ? "eye.slash" : "eye"} 
                    size={20} 
                    color={colors.icon} 
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Terms Checkbox */}
            <TouchableOpacity 
              style={styles.checkboxContainer}
              onPress={() => setAcceptTerms(!acceptTerms)}
            >
              <View style={[
                styles.checkbox, 
                { borderColor: colors.border },
                acceptTerms && { backgroundColor: colors.primary }
              ]}>
                {acceptTerms && (
                  <IconSymbol name="checkmark" size={14} color="white" />
                )}
              </View>
              <ThemedText style={styles.checkboxText}>
                Ich akzeptiere AGB und Nutzungsbestimmungen
              </ThemedText>
            </TouchableOpacity>

            {/* Register Button */}
            <TouchableOpacity 
              style={[
                styles.registerButton, 
                { backgroundColor: colors.primary },
                loading && { opacity: 0.7 }
              ]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <ThemedText style={styles.registerButtonText}>Benutzer erstellen</ThemedText>
              )}
            </TouchableOpacity>

            {/* Platform-specific Social Login Options */}
            <View style={styles.socialSection}>
              <ThemedText style={styles.orText}>Oder direkt mit:</ThemedText>
              
              {Platform.OS === 'android' && (
                <TouchableOpacity style={styles.socialButton}>
                  <ThemedText style={styles.googleIcon}>G</ThemedText>
                  <ThemedText style={styles.socialButtonText}>Google</ThemedText>
                </TouchableOpacity>
              )}

              {Platform.OS === 'ios' && (
                <TouchableOpacity style={styles.socialButtonDark}>
                  <IconSymbol name="apple.logo" size={20} color="white" />
                  <ThemedText style={styles.socialButtonTextDark}>Apple Account</ThemedText>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -20, // Compensate for header padding
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.7,
    marginBottom: 40,
  },
  form: {
    gap: 20,
  },
  inputContainer: {
    // marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingRight: 50,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 18,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    flex: 1,
  },
  registerButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  registerButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  socialSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 20,
    gap: 12,
  },
  orText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.7,
    marginBottom: 4,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'white',
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  socialButtonDark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#000',
    gap: 12,
  },
  googleIcon: {
    fontSize: 20,
    fontFamily: 'Nunito_700Bold',
    color: '#4285F4',
  },
  socialButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: '#333',
  },
  socialButtonTextDark: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
});
