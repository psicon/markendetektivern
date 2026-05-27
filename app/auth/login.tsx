import { ThemedText } from '@/components/ThemedText';
import { AuthMethodButtons } from '@/components/auth/AuthMethodButtons';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { OnboardingService } from '@/lib/services/onboardingService';
import {
  showInfoToast,
  showRetryableErrorToast,
} from '@/lib/services/ui/toast';
import { isExpoGo } from '@/lib/utils/platform';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    ImageBackground,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signIn, signInWithGoogle, signInWithApple, signInWithFacebook } = useAuth();
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const isSmallDevice = screenHeight < 700;

  // Image loading state and animation
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  // T10 v3: Email-Form ist initial collapsed. User tippt "Mit E-Mail
  // anmelden" → Form klappt auf. Andere Buttons triggern direkt.
  const [showEmailForm, setShowEmailForm] = useState(false);

  // T11.3: Identifier-First-Flow gibt die Email per Query-Param rein
  // (vom Register-Screen, falls Email schon existiert).
  const prefilledEmail =
    typeof params.email === 'string' ? params.email : '';

  const [formData, setFormData] = useState({
    email: prefilledEmail,
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async () => {
    if (!formData.email || !formData.password) {
      showInfoToast('Bitte fülle alle Felder aus.', 'error', colorScheme ?? 'light');
      return;
    }

    setLoading(true);

    try {
      await signIn(formData.email, formData.password);
      // T5: Onboarding-Status committen damit Re-Start-Bug B1
      // weg ist (idempotent — no-op wenn schon completed).
      try { await OnboardingService.markCompleted(); } catch {}
      router.replace('/(tabs)');
    } catch (error: any) {
      // Anon-User hat den 'Konto wechseln'-Confirm abgebrochen —
      // kein Fehler, einfach Form offen lassen.
      if (error?.code === 'auth/cancelled') {
        return;
      }

      if (__DEV__) {
        console.error('Login error:', error);
      }

      // Network-Fail → retry-toast (User kann sofort erneut tappen,
      // statt Alert wegklicken + Submit-Button erneut treffen).
      // Andere Fehler → info-toast (kein Retry sinnvoll, User muss
      // Eingaben anpassen). Das ist die UX-Item-U2-Logik:
      // Retry für transient errors, Info für deterministische Errors.
      const isTransient = error.code === 'auth/network-request-failed';
      let errorMessage =
        'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.';

      switch (error.code) {
        case 'auth/user-not-found':
          errorMessage =
            'Account nicht gefunden. Bitte überprüfe deine E-Mail oder registriere dich.';
          break;
        case 'auth/wrong-password':
          errorMessage =
            'Falsches Passwort. Bitte erneut versuchen oder Passwort zurücksetzen.';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Ungültige E-Mail-Adresse.';
          break;
        case 'auth/user-disabled':
          errorMessage = 'Account deaktiviert. Bitte Support kontaktieren.';
          break;
        case 'auth/too-many-requests':
          errorMessage =
            'Zu viele Versuche. Bitte einige Minuten warten und erneut probieren.';
          break;
        case 'auth/network-request-failed':
          errorMessage =
            'Keine Internetverbindung. Bitte Verbindung prüfen.';
          break;
        case 'auth/invalid-credential':
          errorMessage =
            'E-Mail oder Passwort ist falsch. Bitte Eingaben prüfen.';
          break;
      }

      if (isTransient) {
        showRetryableErrorToast(errorMessage, () => {
          void handleLogin();
        }, { colorScheme: colorScheme ?? 'light' });
      } else {
        showInfoToast(errorMessage, 'error', colorScheme ?? 'light');
      }
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
      // T5: Onboarding-Status committen damit Re-Start-Bug B1
      // weg ist (idempotent — no-op wenn schon completed).
      try { await OnboardingService.markCompleted(); } catch {}
      router.replace('/(tabs)');
    } catch (error: any) {
      // User-Cancel (Sheet abgebrochen ODER Confirm-Dialog
      // 'Konto wechseln' verneint) → kein Toast, Login-Screen
      // bleibt sichtbar.
      if (error?.code === 'auth/cancelled') return;
      console.error('Google Sign-In error:', error);
      showRetryableErrorToast(
        `Google-Anmeldung fehlgeschlagen: ${error.message || 'Bitte erneut versuchen.'}`,
        () => {
          void handleGoogleSignIn();
        },
        { colorScheme: colorScheme ?? 'light' },
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);
      // Check if running in Expo Go
      if (isExpoGo()) {
        // Dev-Hinweis bleibt als Alert, weil's eine User-Anweisung
        // ist die explizit gelesen werden soll (Build-Type-Switch).
        Alert.alert(
          'Nicht verfügbar in Expo Go',
          'Apple Sign-In funktioniert nur in der TestFlight oder App Store Version. Bitte nutze Email/Passwort für die Entwicklung.',
          [{ text: 'OK' }]
        );
        return;
      }
      await signInWithApple();
      // T5: Onboarding-Status committen damit Re-Start-Bug B1
      // weg ist (idempotent — no-op wenn schon completed).
      try { await OnboardingService.markCompleted(); } catch {}
      router.replace('/(tabs)');
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      console.error('Apple Sign-In error:', error);
      showRetryableErrorToast(
        `Apple-Anmeldung fehlgeschlagen: ${error.message || 'Bitte erneut versuchen.'}`,
        () => {
          void handleAppleSignIn();
        },
        { colorScheme: colorScheme ?? 'light' },
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFacebookSignIn = async () => {
    try {
      setLoading(true);
      await signInWithFacebook();
      try { await OnboardingService.markCompleted(); } catch {}
      router.replace('/(tabs)');
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      console.error('Facebook Sign-In error:', error);
      showRetryableErrorToast(
        `Facebook-Anmeldung fehlgeschlagen: ${error.message || 'Bitte erneut versuchen.'}`,
        () => {
          void handleFacebookSignIn();
        },
        { colorScheme: colorScheme ?? 'light' },
      );
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
          source={require("@/assets/images/background.jpg")}
          style={styles.background}
          
          onLoad={handleImageLoad}
        />
      
      {/* T7: Gleicher Gradient wie Onboarding-Step-1-Hero. */}
      <LinearGradient
        colors={[
          'rgba(0, 0, 0, 0.1)',
          'rgba(0, 0, 0, 0.3)',
          'rgba(0, 0, 0, 0.9)',
        ]}
        locations={[0, 0.7, 1]}
        style={[styles.overlay, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 20 }]}
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

        {/* T14.6: Login-Content jetzt scrollbar damit auf kleineren
            Devices (oder bei großen Schriftgrößen) der Cross-Link
            ganz unten erreichbar bleibt. Auf großen Devices entsteht
            kein Scroll weil contentContainerStyle.flexGrow:1 dafür
            sorgt dass der Container mindestens die Viewport-Höhe
            ausfüllt — passt der Inhalt rein, kein Scroll. */}
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
        <View style={[styles.logoBlock, isSmallDevice && styles.logoBlockSmall]}>
          <CustomIcon
            name="iconBlack"
            size={isSmallDevice ? 44 : 56}
            color="white"
            style={styles.logoIcon}
          />
          <ThemedText style={[styles.logoText, isSmallDevice && styles.logoTextSmall]}>
            MarkenDetektive
          </ThemedText>
          <ThemedText style={[styles.subTitle, isSmallDevice && styles.subTitleSmall]}>
            Willkommen zurück!
          </ThemedText>
        </View>

        <View style={[styles.content, isSmallDevice && styles.contentSmall]}>
          <View style={styles.authButtons}>
            {/* Login-Form ist PRIMÄR — keine Email-Toggle nötig weil der
                User schon im Login-Screen ist. */}
            <View style={[styles.formContainer, isSmallDevice && styles.formContainerSmall]}>
              <View style={styles.inputContainer}>
                <TextInput
                  style={[styles.input, isSmallDevice && styles.inputSmall]}
                  placeholder="E-Mail"
                  placeholderTextColor="rgba(0,0,0,0.4)"
                  value={formData.email}
                  onChangeText={(text) => setFormData(prev => ({ ...prev, email: text }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.inputContainer}>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={[styles.passwordInput, isSmallDevice && styles.inputSmall]}
                    placeholder="Passwort"
                    placeholderTextColor="rgba(0,0,0,0.4)"
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
                      color="rgba(0,0,0,0.5)"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Passwort vergessen — zentriert (User-Spec) */}
              <TouchableOpacity
                style={styles.forgotPasswordCentered}
                onPress={() => router.push('/auth/forgot-password')}
              >
                <ThemedText style={styles.forgotPasswordTextWhite}>
                  Passwort vergessen?
                </ThemedText>
              </TouchableOpacity>
            </View>

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

            {/* Quick-Login Alternative — Apple/Facebook (KEIN Email-Button,
                Form ist eh sichtbar). Trust-Hint nur einmal hier. */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>oder schnell mit</Text>
              <View style={styles.dividerLine} />
            </View>
            <AuthMethodButtons
              mode="login"
              onApple={handleAppleSignIn}
              onGoogle={handleGoogleSignIn}
              onFacebook={handleFacebookSignIn}
              showEmailButton={false}
              showAllProviders
              busy={loading}
              colorScheme={colorScheme}
            />

            {/* Footer Cross-Link — nur einmal, prominent. */}
            <View style={styles.registerSection}>
              <View style={styles.registerDividerLine} />
              <View style={styles.registerRow}>
                <ThemedText style={styles.registerText}>Noch kein Account? </ThemedText>
                <TouchableOpacity onPress={() => router.replace('/auth/register')} hitSlop={6}>
                  <ThemedText style={styles.registerLinkBold}>Kostenlos starten</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
  // T14.6: KeyboardAvoidingView + ScrollView damit der Content auf
  // kleineren Devices oder größeren Schriftgrößen scrollen kann.
  // flexGrow:1 sorgt dafür dass die ScrollView mindestens die
  // Viewport-Höhe einnimmt — auf großen Devices = kein Scroll nötig.
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
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
  // T10 v8: gleiche Top-Position wie register.tsx — Logo wandert
  // nicht beim Page-Wechsel.
  logoBlock: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 20,
    gap: 4,
  },
  logoBlockSmall: {
    marginTop: 20,
    marginBottom: 14,
    gap: 2,
  },
  logoIcon: {
    marginBottom: 2,
  },
  logoText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  content: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  // T10 v5: Title-Clip-Fix — großer lineHeight + paddingVertical.
  subTitle: {
    fontSize: 28,
    lineHeight: 40,
    paddingVertical: 4,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.1,
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
  // T10: solid weiße Inputs für Kontrast auf Foto-Background
  input: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: '#1c1c1e',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingRight: 50,
    fontSize: 16,
    color: '#1c1c1e',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  // T10: divider + register-Cross-Link Styles
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  dividerText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.2,
  },
  forgotPasswordTextWhite: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: '#fff',
    opacity: 0.9,
  },
  registerDividerLine: {
    width: 60,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 14,
  },
  registerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  registerLinkBold: {
    fontSize: 15,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textDecorationLine: 'underline',
  },
  // T10 v2: prominenter Cross-Link DIREKT nach Title (kein Scrolling
  // nötig). Plus Duplikat unten via .registerSection.
  topLoginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 20,
    gap: 6,
  },
  topLoginText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.85)',
  },
  topLoginLink: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textDecorationLine: 'underline',
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
  // T10 v4: zentriert statt rechts-aligned (User-Spec).
  forgotPasswordCentered: {
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 14,
    paddingVertical: 4,
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
    marginTop: 22,
    paddingTop: 14,
    alignItems: 'center',
  },
  registerText: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255, 255, 255, 0.85)',
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
    fontSize: 14,
  },
  contentSmall: {
    paddingTop: 0,
  },
  subTitleSmall: {
    fontSize: 24,
    lineHeight: 34,
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
