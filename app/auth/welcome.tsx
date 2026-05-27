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
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Animated,
  Dimensions,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthMethodButtons } from '@/components/auth/AuthMethodButtons';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { OnboardingService } from '@/lib/services/onboardingService';
import { showInfoToast } from '@/lib/services/ui/toast';

export default function WelcomeScreen() {
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
      await signInWithApple();
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
      await signInWithGoogle();
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
      await signInWithFacebook();
      await completeAndGoHome();
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      console.error('Facebook Sign-In error:', error);
      showInfoToast(
        error?.message || 'Facebook-Anmeldung fehlgeschlagen.',
        'error',
        colorScheme ?? 'light',
      );
    } finally {
      setAuthInFlight(false);
    }
  };

  const handleEmail = () => {
    // Email-Pfad geht zu Register-Form. Von dort gibt's wieder einen
    // Link "Schon dabei? Einloggen" wenn der User merkt dass er
    // doch schon ein Konto hat.
    router.push({ pathname: '/auth/register', params: { from: 'welcome' } } as any);
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

            <AuthMethodButtons
              mode="register"
              onApple={handleApple}
              onGoogle={handleGoogle}
              onFacebook={handleFacebook}
              onEmail={handleEmail}
              busy={authInFlight}
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
});
