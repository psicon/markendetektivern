import { ThemedText } from '@/components/ThemedText';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { isExpoGo } from '@/lib/utils/platform';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    ImageBackground,
    Platform,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signIn, signInWithGoogle, signInWithApple } = useAuth();
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const isSmallDevice = screenHeight < 700;

  // Image loading state and animation
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!formData.email || !formData.password) {
      Alert.alert('Fehler', 'Bitte fülle alle Felder aus.');
      return;
    }

    setLoading(true);

    try {
      await signIn(formData.email, formData.password);
      router.replace('/(tabs)');
    } catch (error: any) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Login error:', error);
      }
      
      let errorMessage = 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.';
      let errorTitle = 'Anmeldung fehlgeschlagen';
      
      // Detaillierte Firebase Auth Error Codes
      switch (error.code) {
        case 'auth/user-not-found':
          errorTitle = 'Account nicht gefunden';
          errorMessage = 'Es wurde kein Account mit dieser E-Mail-Adresse gefunden. Bitte überprüfe deine E-Mail-Adresse oder registriere dich.';
          break;
        case 'auth/wrong-password':
          errorTitle = 'Falsches Passwort';
          errorMessage = 'Das eingegebene Passwort ist falsch. Bitte versuche es erneut oder setze dein Passwort zurück.';
          break;
        case 'auth/invalid-email':
          errorTitle = 'Ungültige E-Mail';
          errorMessage = 'Die eingegebene E-Mail-Adresse ist ungültig. Bitte überprüfe das Format.';
          break;
        case 'auth/user-disabled':
          errorTitle = 'Account deaktiviert';
          errorMessage = 'Dieser Account wurde deaktiviert. Bitte kontaktiere den Support.';
          break;
        case 'auth/too-many-requests':
          errorTitle = 'Zu viele Versuche';
          errorMessage = 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte warte einige Minuten und versuche es erneut.';
          break;
        case 'auth/network-request-failed':
          errorTitle = 'Netzwerkfehler';
          errorMessage = 'Keine Internetverbindung. Bitte überprüfe deine Verbindung und versuche es erneut.';
          break;
        case 'auth/invalid-credential':
          errorTitle = 'Anmeldedaten ungültig';
          errorMessage = 'Die E-Mail-Adresse oder das Passwort ist falsch. Bitte überprüfe deine Eingaben.';
          break;
        default:
          // Unbekannter Fehler - zeige generische Nachricht
          errorTitle = 'Anmeldung fehlgeschlagen';
          errorMessage = 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.';
          if (__DEV__) {
            errorMessage += `\n\nFehlercode: ${error.code}`;
          }
          break;
      }
      
      Alert.alert(errorTitle, errorMessage, [
        {
          text: 'OK',
          style: 'default'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      await signInWithGoogle();
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      Alert.alert('Google Anmeldung fehlgeschlagen', error.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);
      // Check if running in Expo Go
      if (isExpoGo()) {
        Alert.alert(
          'Nicht verfügbar in Expo Go',
          'Apple Sign-In funktioniert nur in der TestFlight oder App Store Version. Bitte nutze Email/Passwort für die Entwicklung.',
          [{ text: 'OK' }]
        );
        return;
      }
      await signInWithApple();
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Apple Sign-In error:', error);
      Alert.alert('Apple Anmeldung fehlgeschlagen', error.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
      {/* Static background while image loads */}
      <View style={[styles.background, { backgroundColor: colorScheme === 'dark' ? '#000000' : '#f5f5f5' }]} />
      
      {/* Animated ImageBackground */}
      <Animated.View style={[styles.imageContainer, { opacity: fadeAnim }]}>
        <ImageBackground 
          source={require('@/assets/images/table-optimized.jpg')}
          style={styles.background}
          blurRadius={2}
          onLoad={handleImageLoad}
        />
      
      {/* Dynamic gradient overlay based on theme */}
      <LinearGradient
        colors={
          colorScheme === 'dark' 
            ? ['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0.98)']
            : ['rgba(0,0,0,0.2)', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.9)']
        }
        locations={[0, 0.3, 0.7, 1]}
        style={[styles.overlay, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
      >
        {/* Back Button — design-system arrow-left in a 40×40 round
            translucent-white pill (matches the rest of the app
            while staying readable on the photo background). */}
        <TouchableOpacity
          style={styles.backButtonRound}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color="white" />
        </TouchableOpacity>

        {/* Logo */}
        <View style={[styles.logoContainer, isSmallDevice && styles.logoContainerSmall]}>
          <CustomIcon 
            name="iconBlack" 
            size={isSmallDevice ? 48 : 64} 
            color="white"
            style={styles.logoIcon}
          />
          <ThemedText style={[styles.logoText, isSmallDevice && styles.logoTextSmall]}>MarkenDetektive</ThemedText>
        </View>

        {/* Content - Everything fits on screen */}
        <View style={[styles.content, isSmallDevice && styles.contentSmall]}>
          <ThemedText style={[styles.subTitle, isSmallDevice && styles.subTitleSmall]}>Willkommen zurück!</ThemedText>
          
          <View style={styles.authButtons}>
            {/* Form Fields */}
            <View style={[styles.formContainer, isSmallDevice && styles.formContainerSmall]}>
              {/* Email Input */}
              <View style={styles.inputContainer}>
                <TextInput
                  style={[styles.input, isSmallDevice && styles.inputSmall]}
                  placeholder="E-Mail"
                  placeholderTextColor="rgba(255, 255, 255, 0.7)"
                  value={formData.email}
                  onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={[styles.passwordInput, isSmallDevice && styles.inputSmall]}
                    placeholder="Passwort"
                    placeholderTextColor="rgba(255, 255, 255, 0.7)"
                    value={formData.password}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, password: text }))}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                    blurOnSubmit={true}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <IconSymbol 
                      name={showPassword ? "eye.slash" : "eye"} 
                      size={20} 
                      color="rgba(255, 255, 255, 0.7)" 
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Forgot Password */}
              <TouchableOpacity 
                style={styles.forgotPassword}
                onPress={() => router.push('/auth/forgot-password')}
              >
                <ThemedText style={[styles.forgotPasswordText, { color: colors.primary }]}>
                  Passwort vergessen?
                </ThemedText>
              </TouchableOpacity>
            </View>

            {/* Login Button */}
            <TouchableOpacity 
              style={[styles.loginButton, { backgroundColor: colors.primary }, loading && { opacity: 0.7 }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <IconSymbol name="envelope" size={20} color="white" />
                  <ThemedText style={styles.loginButtonText}>Anmelden</ThemedText>
                </>
              )}
            </TouchableOpacity>

            <ThemedText style={styles.orText}>Oder direkt mit:</ThemedText>

            {/* Platform-specific Social Buttons */}
            {/* Google Sign-In (nur Android - iOS vorerst deaktiviert) */}
            {Platform.OS === 'android' && (
              <TouchableOpacity style={styles.socialButton} onPress={handleGoogleSignIn}>
                <View style={styles.googleIconContainer}>
                  <ThemedText style={styles.googleIcon}>G</ThemedText>
                </View>
                <ThemedText style={styles.socialButtonText}>Google</ThemedText>
              </TouchableOpacity>
            )}

            {/* Apple Sign-In (nur iOS) */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity style={[styles.socialButtonDark, isSmallDevice && styles.socialButtonSmall]} onPress={handleAppleSignIn}>
                <IconSymbol name="apple.logo" size={20} color="white" />
                <ThemedText style={styles.socialButtonTextDark}>Apple Account</ThemedText>
              </TouchableOpacity>
            )}

            <View style={styles.registerSection}>
              <ThemedText style={styles.registerText}>Noch kein Account?</ThemedText>
              <TouchableOpacity onPress={() => router.push('/auth/register')}>
                <ThemedText style={[styles.registerLink, { color: colors.primary }]}>Registrieren!</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </LinearGradient>
      </Animated.View>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imageContainer: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    paddingHorizontal: 24,
  },
  backButton: {
    position: 'absolute',
    top: 60,
    left: 0,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  backButtonWithText: {
    position: 'absolute',
    top: 60,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    zIndex: 10,
  },
  // Design-system back-button: 40×40 round, translucent-white bg.
  backButtonRound: {
    position: 'absolute',
    top: 60,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 10,
  },
  backButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: 'white',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 40,
    gap: 5,
  },
  logoIcon: {
    marginBottom: 4,
  },
  logoText: {
    fontSize: 28,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    lineHeight: 32,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subTitle: {
    fontSize: 22,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
    textAlign: 'center',
    marginBottom:16,
  },
  authButtons: {
    width: '100%',
    alignItems: 'center',
  },
  formContainer: {
    width: '100%',
    marginBottom: 20,
    gap: 16,
  },
  formContainerSmall: {
    marginBottom: 12,
    gap: 12,
  },
  inputContainer: {
    width: '100%',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,

    color: 'white',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingRight: 50,
    fontSize: 16,

    color: 'white',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
  forgotPassword: {
    alignSelf: 'flex-end',
    marginTop: 8,
    marginBottom: 16,
    paddingHorizontal: 0,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  orText: {
    fontSize: 14,

    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 16,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'white',
    marginBottom: 20,
    gap: 12,
  },
  socialButtonDark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#000',
    marginBottom: 20,
    gap: 12,
  },
  googleIconContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  googleIcon: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: '#4285F4',
    textAlign: 'center',
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
  registerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 12,
  },
  registerText: {
    fontSize: 14,

    color: 'rgba(255, 255, 255, 0.7)',
  },
  registerLink: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  logoContainerSmall: {
    marginTop: 40,
    gap: 3,
  },
  logoTextSmall: {
    fontSize: 24,
  },
  contentSmall: {
    paddingTop: 1,
  },
  subTitleSmall: { 
    display: 'none',
  },
  inputSmall: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  socialButtonSmall: {
    paddingVertical: 14,
    marginBottom: 16,
  }
});
