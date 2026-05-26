import { ThemedText } from '@/components/ThemedText';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { OnboardingService } from '@/lib/services/onboardingService';
import { showInfoToast } from '@/lib/services/ui/toast';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Animated, Dimensions, ImageBackground, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function WelcomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const isSmallScreen = screenHeight < 700; // iPhone SE, etc.

  // Wenn welcome.tsx vom Onboarding-Climax aus betreten wird
  // (router.replace mit `?from=onboarding`), darf der Back-Button
  // den User nicht zurück in Step 6 schießen — das wäre eine
  // Sackgasse weil der State da schon persisted ist (B2). Wir
  // verstecken Back in dem Fall; der einzige Exit ist eine
  // Auth-Wahl oder "Als Gast fortfahren".
  const cameFromOnboarding = params.from === 'onboarding';

  // States
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];
  const [authInFlight, setAuthInFlight] = useState(false);

  const { signInWithGoogle, signInWithApple, signInAnonymously: signInAnon } = useAuth();

  /**
   * Erfolgs-Handler nach jeder Auth-Wahl. Setzt zwei Dinge BEVOR
   * navigiert wird:
   * 1. OnboardingService.markCompleted() — Onboarding-Status auf
   *    'completed' damit Re-Start nicht erneut /onboarding routet
   *    (Fix B1). Idempotent: wenn schon completed (Climax-Guest-
   *    Path hat's vorher gesetzt), no-op.
   * 2. router.replace('/(tabs)') — kein push, damit Welcome aus
   *    dem Stack raus ist.
   */
  const completeAndGoHome = async () => {
    try {
      await OnboardingService.markCompleted();
    } catch (e) {
      // Non-fatal — User-Doc-Mirror (Firestore) ist die echte
      // Auth-Quelle. AsyncStorage-Flag ist nur die Boot-Optimierung.
      console.warn('[Welcome] markCompleted failed:', e);
    }
    router.replace('/(tabs)');
  };

  const handleContinueAsGuest = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      await signInAnon();
      await completeAndGoHome();
    } catch (error: any) {
      console.error('Anonymous sign-in error:', error);
      showInfoToast(
        error?.message || 'Konnte anonyme Sitzung nicht starten. Bitte versuche es erneut.',
        'error',
        colorScheme ?? 'light',
      );
    } finally {
      setAuthInFlight(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (authInFlight) return;
    setAuthInFlight(true);
    try {
      await signInWithGoogle();
      await completeAndGoHome();
    } catch (error: any) {
      // User-Cancel des Confirm-Dialogs (anon→bereits-existierender
      // Provider-Account, 'auth/cancelled' aus AuthContext) → kein
      // Fehler-Toast, Welcome-Screen bleibt einfach stehen.
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

  const handleAppleSignIn = async () => {
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

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500, // 500ms smooth fade in
      useNativeDriver: true,
    }).start();
  };



  return (
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
      {/* Dynamic gradient overlay based on theme */}
      {/* T7: Gleicher Gradient wie Onboarding-Step-1-Hero. Auth ist
          die Verlängerung des Funnels — derselbe Visual-Sprache. */}
      <LinearGradient
        colors={[
          'rgba(0, 0, 0, 0.1)',
          'rgba(0, 0, 0, 0.3)',
          'rgba(0, 0, 0, 0.9)',
        ]}
        locations={[0, 0.7, 1]}
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + (isSmallScreen ? 10 : 20),
            paddingBottom: insets.bottom + (isSmallScreen ? 10 : 20)
          }
        ]}
      >
        {/* Back Button — design-system arrow-left in a 40×40 round
            translucent-white pill (auth screens have a coloured
            background, so neutral theme.text wouldn't read).
            Versteckt wenn vom Onboarding-Climax aus betreten — sonst
            wäre's eine Sackgasse zurück zu Step 6 (B2-Fix). */}
        {router.canGoBack() && !cameFromOnboarding && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color="white" />
          </TouchableOpacity>
        )}

        {/* Logo */}
        <View style={[styles.logoContainer, isSmallScreen && styles.logoContainerSmall]}>
          <CustomIcon 
            name="iconBlack" 
            size={isSmallScreen ? 60 : 80} 
            color="white"
            style={styles.logoIcon}
          />
          <ThemedText style={[styles.logoText, isSmallScreen && styles.logoTextSmall]}>MarkenDetektive</ThemedText>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <ThemedText style={[styles.subTitle, isSmallScreen && styles.subTitleSmall]}>Wir zeigen dir,{'\n'}wer dahinter steckt!</ThemedText>
          
          <View style={styles.authButtons}>
            <ThemedText style={[styles.subtitle, isSmallScreen && styles.subtitleSmall]}>Jetzt kostenlos registrieren:</ThemedText>
            
            <TouchableOpacity 
              style={[
                styles.emailButton, 
                { backgroundColor: colors.primary },
                isSmallScreen && styles.emailButtonSmall
              ]}
              onPress={() => router.push('/auth/register')}
            >
              <IconSymbol name="envelope" size={20} color="white" />
              <ThemedText style={styles.emailButtonText}>E-Mail</ThemedText>
            </TouchableOpacity>

            <ThemedText style={styles.orText}>Oder direkt mit:</ThemedText>

            {/* Google Sign-In (nur Android - iOS vorerst deaktiviert) */}
            {Platform.OS === 'android' && (
              <TouchableOpacity 
                style={[styles.socialButton, isSmallScreen && styles.socialButtonSmall]} 
                onPress={handleGoogleSignIn}
              >
                <View style={styles.googleIconContainer}>
                  <ThemedText style={styles.googleIcon}>G</ThemedText>
                </View>
                <ThemedText style={styles.socialButtonText}>Google</ThemedText>
              </TouchableOpacity>
            )}

            {/* Apple Sign-In (nur iOS) */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity 
                style={[styles.socialButtonDark, isSmallScreen && styles.socialButtonDarkSmall]} 
                onPress={handleAppleSignIn}
              >
                <IconSymbol name="apple.logo" size={20} color="white" />
                <ThemedText style={styles.socialButtonTextDark}>Apple Account</ThemedText>
              </TouchableOpacity>
            )}

            {/* Login Button */}
            <TouchableOpacity
              style={[
                styles.secondaryButton,
                { marginTop: -1 },
                isSmallScreen && styles.secondaryButtonSmall
              ]}
              onPress={() => router.push('/auth/login')}
            >
              <IconSymbol name="person.circle" size={18} color="rgba(255,255,255,0.9)" />
              <ThemedText style={styles.secondaryButtonText}>Bereits angemeldet: Login</ThemedText>
            </TouchableOpacity>

            {/* Continue as guest — recovery path for users bounced
                here by the tabs-layout escape-hatch (e.g. registered
                session expired). */}
            <TouchableOpacity
              onPress={handleContinueAsGuest}
              style={{ paddingVertical: 12, alignItems: 'center', marginTop: 4 }}
            >
              <ThemedText
                style={{
                  fontSize: 14,
                  fontFamily: 'Nunito_500Medium',
                  color: 'rgba(255,255,255,0.75)',
                  textDecorationLine: 'underline',
                }}
              >
                Ohne Anmeldung fortfahren
              </ThemedText>
            </TouchableOpacity>

            <ThemedText style={styles.termsText}>
              Ich akzeptiere: <ThemedText style={[styles.termsLink, { color: colors.primary }]}>AGB + Datenschutz</ThemedText>
            </ThemedText>
          </View>
        </View>
      </LinearGradient>
      </Animated.View>
    </View>
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
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 10,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 80,
    gap: 10,
  },
  logoContainerSmall: {
    marginTop: 40,
    gap: 6,
  },
  logoIcon: {
    marginBottom: 4,
  },
  logoText: {
    fontSize: 32,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    lineHeight: 36,
  },
  logoTextSmall: {
    fontSize: 26,
    lineHeight: 30,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 60,
    lineHeight: 38,
  },
  subTitle: {
    fontSize: 22,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
   },
  subTitleSmall: {
    fontSize: 18,
    marginBottom: 5,
  },
  authButtons: {
    width: '100%',
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitleSmall: {
    fontSize: 12,
    marginBottom: 12,
  },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 24,
    gap: 12,
  },
  emailButtonSmall: {
    paddingVertical: 12,
    marginBottom: 16,
    gap: 8,
  },
  emailButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  orText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 12,
    textAlign: 'center',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    gap: 8,
  },
  secondaryButtonSmall: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 6,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.9)',
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'white',
    marginBottom: 12,
    gap: 12,
  },
  socialButtonSmall: {
    paddingVertical: 12,
    marginBottom: 8,
    gap: 8,
  },
  socialButtonDark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#000',
    marginBottom: 32,
    gap: 12,
  },
  socialButtonDarkSmall: {
    paddingVertical: 12,
    marginBottom: 20,
    gap: 8,
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

  termsText: {
    fontSize: 12,
    marginTop: 10,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
  },
  termsLink: {
    fontFamily: 'Nunito_600SemiBold',
  },

});
