/**
 * Register — Identifier-First Auth-Pattern (T11).
 *
 * Best-Practice-Pattern wie TheFork, Uber Eats, Linear, Notion, Stripe:
 *   1. Email-Input direkt sichtbar (kein "Mit E-Mail"-Hub-Button)
 *   2. "Weiter"-Button als Primary-CTA
 *   3. "oder"-Divider
 *   4. Apple + Google + Facebook als gleichwertige Alternativen
 *   5. Cross-Link "Schon registriert?" am Boden
 *
 * Smart-Routing in `handleContinue`:
 *   • fetchSignInMethodsForEmail() — optimistischer Upfront-Check.
 *     Wenn Methods != [] → User existiert → Toast + Route zu /auth/login
 *     mit prefilled Email (oder Social-Provider-Hint).
 *   • Fallback: navigate zu /auth/email-register mit prefilled Email.
 *     Falls Email-Enumeration-Protection in Firebase aktiv ist (Methods
 *     immer leer), fängt email-register's `auth/email-already-in-use`-
 *     Handler den Duplicate-Case auf der Submit-Seite ab.
 *
 * Layout: Branding-Block oben + Action-Block unten in der Thumb-Reach-
 * Zone, `justifyContent: 'space-between'` — selbes Pattern wie
 * welcome.tsx und Industry-Standard für Auth-Screens.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { fetchSignInMethodsForEmail } from '@react-native-firebase/auth';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  ImageBackground,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/ThemedText';
import { AuthMethodButtons } from '@/components/auth/AuthMethodButtons';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { auth as firebaseAuth } from '@/lib/firebase';
import { OnboardingService } from '@/lib/services/onboardingService';
import { showInfoToast } from '@/lib/services/ui/toast';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const isSmallDevice = screenHeight < 700;

  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];
  const [authInFlight, setAuthInFlight] = useState(false);

  // Identifier-First: ein einziges Email-Feld, Continue-Button
  const [email, setEmail] = useState(params.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  const { signInWithGoogle, signInWithApple, signInWithFacebook } = useAuth();

  // Wenn die Email per Query-Param reinkommt, einmalig übernehmen
  useEffect(() => {
    if (params.email && !email) setEmail(params.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.email]);

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const completeAndGoHome = async () => {
    try { await OnboardingService.markCompleted(); } catch {}
    router.replace('/(tabs)');
  };

  /**
   * Identifier-First Continue-Handler.
   * Validiert Email, prüft optimistisch ob die Email schon existiert,
   * routet entsprechend zu Login oder Email-Register.
   */
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
      // Optimistischer Upfront-Check. Bei aktivierter Email-Enumeration-
      // Protection liefert die API immer [] zurück — das ist OK, dann
      // fällt das Duplicate-Handling auf email-register's Submit-Catch.
      let methods: string[] = [];
      try {
        methods = await fetchSignInMethodsForEmail(firebaseAuth, trimmed);
      } catch (e) {
        if (__DEV__) console.warn('[Register] fetchSignInMethods failed:', e);
      }

      if (methods.includes('password')) {
        showInfoToast(
          'Du hast schon einen Account — bitte einloggen.',
          'info',
          colorScheme ?? 'light',
        );
        router.push({
          pathname: '/auth/login',
          params: { email: trimmed },
        } as any);
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
      // prefilled Email. Falls Enum-Protection aktiv war und Email
      // doch existiert, fängt email-register's Submit-Handler das ab.
      router.push({
        pathname: '/auth/email-register',
        params: { email: trimmed },
      } as any);
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleApple = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      await signInWithApple();
      await completeAndGoHome();
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      console.error('Apple Sign-In error:', error);
      showInfoToast(error?.message || 'Apple-Anmeldung fehlgeschlagen.', 'error', colorScheme ?? 'light');
    } finally {
      setAuthInFlight(false);
    }
  };

  const handleGoogle = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      await signInWithGoogle();
      await completeAndGoHome();
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      console.error('Google Sign-In error:', error);
      showInfoToast(error?.message || 'Google-Anmeldung fehlgeschlagen.', 'error', colorScheme ?? 'light');
    } finally {
      setAuthInFlight(false);
    }
  };

  const handleFacebook = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      await signInWithFacebook();
      await completeAndGoHome();
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      console.error('Facebook Sign-In error:', error);
      showInfoToast(error?.message || 'Facebook-Anmeldung fehlgeschlagen.', 'error', colorScheme ?? 'light');
    } finally {
      setAuthInFlight(false);
    }
  };

  const busy = authInFlight || checkingEmail;

  return (
    <View style={styles.container}>
      <View style={[styles.background, { backgroundColor: colorScheme === 'dark' ? '#000' : '#f5f5f5' }]} />
      <Animated.View style={[styles.imageContainer, { opacity: fadeAnim }]}>
        <ImageBackground
          source={require('@/assets/images/background.jpg')}
          style={styles.background}
          onLoad={handleImageLoad}
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
              paddingTop: insets.top + 56,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          {/* Back-Button */}
          {router.canGoBack() && (
            <TouchableOpacity
              style={[styles.backButton, { top: insets.top + 8 }]}
              onPress={() => router.back()}
              hitSlop={8}
            >
              <MaterialCommunityIcons name="arrow-left" size={22} color="#fff" />
            </TouchableOpacity>
          )}

          {/* Branding-Block oben: Identitäts-Einheit */}
          <View style={[styles.brandingBlock, isSmallDevice && styles.brandingBlockSmall]}>
            <CustomIcon
              name="iconBlack"
              size={isSmallDevice ? 44 : 56}
              color="#fff"
              style={styles.logoIcon}
            />
            <ThemedText style={styles.brandText}>MarkenDetektive</ThemedText>
            <ThemedText style={[styles.titleText, isSmallDevice && styles.titleTextSmall]}>
              Jetzt kostenlos registrieren
            </ThemedText>
            <ThemedText style={styles.subtitleText}>
              und Vorteile genießen!
            </ThemedText>
          </View>

          {/* Action-Block unten: Email-Input + Weiter + Divider + Socials */}
          <View style={styles.actionBlock}>
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
                editable={!busy}
              />
              {emailError && (
                <Text style={styles.errorText}>{emailError}</Text>
              )}
            </View>

            <Pressable
              onPress={handleContinue}
              disabled={busy}
              style={({ pressed }) => [
                styles.continueButton,
                (pressed || busy) && styles.continueButtonPressed,
              ]}
            >
              {checkingEmail ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.continueButtonText}>Weiter</Text>
              )}
            </Pressable>

            {/* "oder"-Divider */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>oder</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Social-Alternatives: alle 3 sichtbar (showAllProviders) */}
            <AuthMethodButtons
              mode="register"
              onApple={handleApple}
              onGoogle={handleGoogle}
              onFacebook={handleFacebook}
              showEmailButton={false}
              showAllProviders
              busy={busy}
              colorScheme={colorScheme}
            />

            {/* Cross-Link */}
            <View style={styles.crossLinkBox}>
              <View style={styles.crossLinkRow}>
                <ThemedText style={styles.crossLinkText}>Schon registriert? </ThemedText>
                <TouchableOpacity onPress={() => router.replace('/auth/login')} hitSlop={8}>
                  <ThemedText style={styles.crossLinkLink}>Hier einloggen</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
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
  // Branding-Block: Logo + Brand + Headline + Subtitle als Identitäts-
  // Einheit am Top. Items visuell verbunden via gap.
  brandingBlock: {
    alignItems: 'center',
    marginTop: 32,
    gap: 4,
  },
  brandingBlockSmall: {
    marginTop: 20,
    gap: 2,
  },
  // Action-Block: alle interaktiven Elemente in der Thumb-Reach-Zone.
  actionBlock: {
    width: '100%',
    gap: 12,
    paddingBottom: 4,
  },
  logoIcon: {
    marginBottom: 2,
  },
  brandText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: -0.1,
  },
  // T10 v5 — Title-Clipping-Fix: großer lineHeight + paddingVertical
  // damit der ascender (oben) und descender (unten) immer Platz haben.
  titleText: {
    fontSize: 26,
    lineHeight: 38,
    paddingVertical: 4,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.2,
    marginTop: 8,
  },
  titleTextSmall: {
    fontSize: 22,
    lineHeight: 32,
    marginTop: 4,
  },
  subtitleText: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  // Email-Input: solid weißer Hintergrund für Kontrast auf dunklem
  // Photo-Background (User-Spec: "Felder besser lesbar machen").
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
    backgroundColor: Colors.light.tint, // Brand-Grün
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
  crossLinkBox: {
    alignItems: 'center',
    marginTop: 8,
  },
  crossLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crossLinkText: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.85)',
  },
  crossLinkLink: {
    fontSize: 15,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textDecorationLine: 'underline',
  },
});
