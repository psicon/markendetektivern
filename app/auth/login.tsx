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
    Platform,
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
      // T17.2: FB-SDK-Unavailable (Sim) als warn, nicht error.
      if (error?.code === 'auth/facebook-sdk-unavailable') {
        console.warn('[Login] Facebook SDK unavailable:', error?.message);
      } else {
        console.error('Facebook Sign-In error:', error);
      }
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
      {/* T14.8: Identisch zu register.tsx — kräftigerer schwarzer
          Gradient bis ans Bottom für konsistente Lesbarkeit der
          Cross-Link/DSGVO-Texte. */}
      <LinearGradient
        colors={[
          'rgba(0, 0, 0, 0.15)',
          'rgba(0, 0, 0, 0.45)',
          'rgba(0, 0, 0, 0.92)',
        ]}
        locations={[0, 0.5, 1]}
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + 56,
            paddingBottom: insets.bottom + 16,
          },
        ]}
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

        {/* T14.7: ScrollView raus — echtes responsives Layout via
            compact-Mode auf kleinen Devices. Alle Heights/Margins
            schrumpfen proportional damit der Content auf jeder
            Bildschirmgröße ohne Scroll passt. */}
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
  // T14.7: Two-Block-Layout — Branding oben, Action unten via
  // justifyContent:'space-between'. Identisch zu welcome.tsx und
  // register.tsx → konsistentes Verhalten auf allen Screens.
  // Auf großen iPhones entsteht natürlicher Atemraum dazwischen,
  // auf kleinen schrumpft der Gap ohne dass Content abgeschnitten
  // wird (Branding hat marginTop fix, Action floatet unten).
  overlay: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  // T14.7: ScrollView-Styles entfernt — Login ist jetzt nativ
  // responsiv via compact-Mode + straffe Margins/Heights statt
  // Scrolling als Workaround.
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
  // T14.7: Branding-Block oben — Logo + Brand + Title als Einheit.
  // Identisch zu register.tsx und welcome.tsx. Margin nur oben (Top),
  // unten frei damit space-between im overlay den Rest verteilt.
  logoBlock: {
    alignItems: 'center',
    marginTop: 32,
    gap: 4,
  },
  logoBlockSmall: {
    marginTop: 20,
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
  // T14.7: content ohne flex:1 damit es seine natürliche Höhe nimmt
  // und der Eltern-Container (overlay mit justifyContent:'space-between')
  // den Block ans untere Ende der verbleibenden Höhe schiebt.
  content: {
    width: '100%',
    alignItems: 'center',
  },
  // T14.7: Subtitle in normaler Größe — auf isSmallDevice via
  // subTitleSmall kleiner. Identische Größen wie register.tsx.
  subTitle: {
    fontSize: 26,
    lineHeight: 38,
    paddingVertical: 4,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.2,
    marginTop: 6,
  },
  authButtons: {
    width: '100%',
    alignItems: 'center',
  },
  // T14.7: Form-Container straffer — marginBottom 20→8, gap 16→10.
  formContainer: {
    width: '100%',
    marginBottom: 8,
    gap: 10,
  },
  formContainerSmall: {
    marginBottom: 6,
    gap: 8,
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
    paddingVertical: 12,
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
    paddingVertical: 12,
    paddingRight: 50,
    fontSize: 16,
    color: '#1c1c1e',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  // T14.7: Divider straffer — marginTop 18→10, marginBottom 16→8.
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 8,
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
  // T14.7: Forgot-Password straffer — marginTop 8→4, marginBottom 14→6.
  forgotPasswordCentered: {
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: 6,
    paddingVertical: 4,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: 'rgba(255, 255, 255, 0.8)',
  },
  // T14.7: Login-Button kompakter — paddingVertical 16→14, marginBottom 16→0.
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
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
  // T14.7: Register-Section deutlich straffer — marginTop 22→10, paddingTop 14→6.
  registerSection: {
    marginTop: 10,
    paddingTop: 6,
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
    fontSize: 22,
    lineHeight: 32,
    marginTop: 4,
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
