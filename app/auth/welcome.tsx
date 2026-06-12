/**
 * Welcome — Auth-Entry-Hub.
 *
 * Drei primäre Buttons (Plattform-Primary / E-Mail / Facebook) + dezenter
 * Login-Link am Boden. Apple/Google/Facebook gehen direkt durch
 * (Provider erkennt new vs returning), E-Mail routet zu /auth/register.
 *
 * Design-System: gleiche Background-Image + Gradient wie Onboarding-
 * Step-1-Hero (T7 Konsistenz).
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { fetchSignInMethodsForEmail } from '@react-native-firebase/auth';
import { markAppContentReady } from '@/lib/utils/appReady';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  ImageBackground,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthMethodButtons } from '@/components/auth/AuthMethodButtons';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { auth as firebaseAuth } from '@/lib/firebase';
import { OnboardingService } from '@/lib/services/onboardingService';
import { showInfoToast } from '@/lib/services/ui/toast';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function WelcomeScreen() {
  // Splash-Overlay ausblenden sobald dieser Screen steht (s. lib/utils/appReady).
  useEffect(() => {
    markAppContentReady();
  }, []);
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const isSmallScreen = screenHeight < 700;

  // Wenn vom Onboarding-Climax aus betreten, kein Back-Button (sonst
  // Sackgasse zurück in Step 6 — B2-Fix).
  const cameFromOnboarding = params.from === 'onboarding';

  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];
  const [authInFlight, setAuthInFlight] = useState(false);

  // T14.1: Identifier-First-Flow direkt auf Welcome (statt vorher
  // Zwischen-Hub mit "Mit E-Mail registrieren"-Button).
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const { signInWithGoogle, signInWithApple, signInWithFacebook, signInAnonymously: signInAnon } = useAuth();

  /**
   * Post-Auth Erfolgs-Handler. Onboarding-Status auf 'completed'
   * (B1-Fix) und dann ab nach /(tabs).
   */
  const completeAndGoHome = async () => {
    try {
      await OnboardingService.markCompleted();
    } catch (e) {
      console.warn('[Welcome] markCompleted failed:', e);
    }
    router.replace('/(tabs)');
  };

  const handleApple = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      const ok = await signInWithApple();
      // Abbruch = kein Login — NICHT als Erfolg werten (86ca7x9ep).
      if (!ok) return;
      await completeAndGoHome();
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      console.error('Apple Sign-In error:', error);
      showInfoToast(
        error?.message || 'Apple-Anmeldung fehlgeschlagen.',
        'error',
        colorScheme ?? 'light',
      );
    } finally {
      setAuthInFlight(false);
    }
  };

  const handleGoogle = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      const ok = await signInWithGoogle();
      // Abbruch = kein Login — NICHT als Erfolg werten (86ca7x9ep).
      if (!ok) return;
      await completeAndGoHome();
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      console.error('Google Sign-In error:', error);
      showInfoToast(
        error?.message || 'Google-Anmeldung fehlgeschlagen.',
        'error',
        colorScheme ?? 'light',
      );
    } finally {
      setAuthInFlight(false);
    }
  };

  const handleFacebook = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      const ok = await signInWithFacebook();
      // Abbruch = kein Login — NICHT als Erfolg werten (86ca7x9ep).
      if (!ok) return;
      await completeAndGoHome();
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      // T17.2: SDK-Unavailable (Sim/alter Build) → warn statt error,
      // sonst rotes Dev-Overlay für einen erwarteten Fall.
      if (error?.code === 'auth/facebook-sdk-unavailable') {
        console.warn('[Welcome] Facebook SDK unavailable:', error?.message);
      } else {
        console.error('Facebook Sign-In error:', error);
      }
      showInfoToast(
        error?.message || 'Facebook-Anmeldung fehlgeschlagen.',
        'error',
        colorScheme ?? 'light',
      );
    } finally {
      setAuthInFlight(false);
    }
  };

  // T14.1: Identifier-First Continue-Handler.
  // Validiert Email, prüft optimistisch ob die Email schon existiert,
  // routet entsprechend zu Login oder Email-Register. Identisch zu
  // register.tsx — Welcome ist jetzt der Entry-Point.
  const handleContinue = async () => {
    Keyboard.dismiss();
    const trimmed = email.trim().toLowerCase();

    if (!trimmed) {
      setEmailError('Bitte E-Mail-Adresse eingeben.');
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError('Bitte eine gültige E-Mail-Adresse eingeben.');
      return;
    }
    setEmailError(null);
    setCheckingEmail(true);

    try {
      let methods: string[] = [];
      try {
        methods = await fetchSignInMethodsForEmail(firebaseAuth, trimmed);
      } catch (e) {
        if (__DEV__) console.warn('[Welcome] fetchSignInMethods failed:', e);
      }

      if (methods.includes('password')) {
        showInfoToast(
          'Du hast schon einen Account — bitte einloggen.',
          'info',
          colorScheme ?? 'light',
        );
        router.push({ pathname: '/auth/login', params: { email: trimmed } } as any);
        return;
      }
      if (methods.includes('google.com')) {
        showInfoToast(
          'Dieser Account ist mit Google verbunden — bitte mit Google anmelden.',
          'info',
          colorScheme ?? 'light',
        );
        await handleGoogle();
        return;
      }
      if (methods.includes('apple.com')) {
        showInfoToast(
          'Dieser Account ist mit Apple verbunden — bitte mit Apple anmelden.',
          'info',
          colorScheme ?? 'light',
        );
        await handleApple();
        return;
      }
      if (methods.includes('facebook.com')) {
        showInfoToast(
          'Dieser Account ist mit Facebook verbunden — bitte mit Facebook anmelden.',
          'info',
          colorScheme ?? 'light',
        );
        await handleFacebook();
        return;
      }

      // Keine bekannte Methode → neuer Account, weiter zur Form mit
      // prefilled Email.
      router.push({
        pathname: '/auth/email-register',
        params: { email: trimmed },
      } as any);
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleGuest = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      await signInAnon();
      await completeAndGoHome();
    } catch (error: any) {
      console.error('Anonymous sign-in error:', error);
      showInfoToast(
        error?.message || 'Konnte anonyme Sitzung nicht starten.',
        'error',
        colorScheme ?? 'light',
      );
    } finally {
      setAuthInFlight(false);
    }
  };

  // Initial fade-in für Background-Image
  useEffect(() => {
    if (!imageLoaded) return;
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [imageLoaded, fadeAnim]);

  return (
    <View style={styles.container}>
      {/* Static background while image loads */}
      <View style={[styles.background, { backgroundColor: colorScheme === 'dark' ? '#000' : '#f5f5f5' }]} />

      {/* Animated background image — gleiche Asset/Gradient-Kombi wie Onboarding-Hero (T7). */}
      <Animated.View style={[styles.imageContainer, { opacity: fadeAnim }]}>
        <ImageBackground
          source={require('@/assets/images/background.jpg')}
          style={styles.background}
          onLoad={() => setImageLoaded(true)}
        />
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
              // T10 v10: identisch zu register.tsx + login.tsx + email-register.tsx
              paddingTop: insets.top + 56,
              paddingBottom: insets.bottom + (isSmallScreen ? 16 : 24),
            },
          ]}
        >
          {/* Back-Button — versteckt wenn vom Onboarding-Climax */}
          {router.canGoBack() && !cameFromOnboarding && (
            <TouchableOpacity
              style={[styles.backButton, { top: insets.top + 8 }]}
              onPress={() => router.back()}
              hitSlop={8}
            >
              <MaterialCommunityIcons name="arrow-left" size={22} color="#fff" />
            </TouchableOpacity>
          )}

          {/* Skip-X — überspringt Registrierung als Gast.
              Sichtbar IMMER (nicht nur wenn Back möglich). Macht den
              gleichen handleGuest-Flow wie "Ohne Anmeldung fortfahren"
              unten — nur als schneller Top-Right-Shortcut. */}
          <TouchableOpacity
            style={[styles.skipButton, { top: insets.top + 8 }]}
            onPress={handleGuest}
            disabled={authInFlight}
            hitSlop={8}
            accessibilityLabel="Registrierung überspringen"
          >
            <MaterialCommunityIcons name="close" size={22} color="#fff" />
          </TouchableOpacity>

          {/* Logo + Tagline — kompakter als vorher damit Auth-Buttons im Viewport */}
          <View style={[styles.logoBlock, isSmallScreen && styles.logoBlockSmall]}>
            <CustomIcon
              name="iconBlack"
              size={isSmallScreen ? 56 : 72}
              color="#fff"
              style={styles.logoIcon}
            />
            <Text style={[styles.logoText, isSmallScreen && styles.logoTextSmall]}>
              MarkenDetektive
            </Text>
            <Text style={[styles.tagline, isSmallScreen && styles.taglineSmall]}>
              Wir zeigen dir, wer dahintersteckt
            </Text>
          </View>

          {/* Auth-Methoden + Footer */}
          <View style={styles.bottomBlock}>
            <Text style={styles.bottomHeadline}>Jetzt kostenlos starten</Text>

            {/* T14.1: Identifier-First — Email-Feld + Weiter-CTA direkt
                hier (vorher Zwischen-Hub mit "Mit E-Mail registrieren"-
                Button, der nur auf /auth/register-Screen lenkte → war
                ein Klick zu viel). */}
            <View style={styles.emailInputWrapper}>
              <TextInput
                style={[styles.emailInput, emailError && styles.emailInputError]}
                placeholder="E-Mail-Adresse"
                placeholderTextColor="rgba(0,0,0,0.4)"
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  if (emailError) setEmailError(null);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={handleContinue}
                editable={!authInFlight && !checkingEmail}
              />
              {emailError && (
                <Text style={styles.errorText}>{emailError}</Text>
              )}
            </View>

            <Pressable
              onPress={handleContinue}
              disabled={authInFlight || checkingEmail}
              style={({ pressed }) => [
                styles.continueButton,
                (pressed || authInFlight || checkingEmail) && styles.continueButtonPressed,
              ]}
            >
              {checkingEmail ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.continueButtonText}>Weiter</Text>
              )}
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>oder</Text>
              <View style={styles.dividerLine} />
            </View>

            <AuthMethodButtons
              mode="register"
              onApple={handleApple}
              onGoogle={handleGoogle}
              onFacebook={handleFacebook}
              showEmailButton={false}
              showAllProviders
              busy={authInFlight || checkingEmail}
              colorScheme={colorScheme}
            />

            {/* "Schon dabei?" Link — Login-Cross-Reference */}
            <View style={styles.loginRow}>
              <Text style={styles.loginText}>Schon registriert? </Text>
              <Pressable onPress={() => router.push('/auth/login')} hitSlop={6}>
                <Text style={styles.loginLink}>Hier einloggen</Text>
              </Pressable>
            </View>

            {/* Guest-Fallback — dezent ganz unten, nur wenn vom Onboarding
                NICHT (sonst doppelt zu "Als Gast fortfahren" am Climax). */}
            {!cameFromOnboarding && (
              <Pressable onPress={handleGuest} disabled={authInFlight} style={styles.guestBtn}>
                <Text style={styles.guestText}>Ohne Anmeldung fortfahren</Text>
              </Pressable>
            )}
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  background: { ...StyleSheet.absoluteFillObject },
  imageContainer: { flex: 1 },
  overlay: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  backButton: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  skipButton: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  // T10 v9: marginTop:32 identisch zu register.tsx + login.tsx —
  // Logo-Y-Position konsistent über alle Auth-Pages.
  logoBlock: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 20,
    gap: 4,
  },
  logoBlockSmall: { marginTop: 20, marginBottom: 14, gap: 2 },
  logoIcon: { marginBottom: 2 },
  logoText: {
    fontSize: 28,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    letterSpacing: -0.4,
  },
  logoTextSmall: { fontSize: 24 },
  tagline: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    letterSpacing: -0.1,
    paddingHorizontal: 12,
  },
  taglineSmall: { fontSize: 13 },
  bottomBlock: {
    gap: 12,
  },
  bottomHeadline: {
    fontSize: 22,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 14,
  },
  loginText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.75)',
  },
  loginLink: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textDecorationLine: 'underline',
  },
  guestBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 2,
  },
  guestText: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.6)',
    textDecorationLine: 'underline',
  },
  // T14.1: Identifier-First Styles (analog zu register.tsx).
  emailInputWrapper: {
    width: '100%',
  },
  emailInput: {
    width: '100%',
    height: 52,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: '#1c1c1e',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  emailInputError: {
    borderColor: '#FF5252',
    borderWidth: 1.5,
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
    color: '#FFB4B4',
    marginTop: 6,
    marginLeft: 4,
  },
  continueButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonPressed: {
    opacity: 0.85,
  },
  continueButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    letterSpacing: -0.2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 4,
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
});
