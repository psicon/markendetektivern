/**
 * Register Hub (T10 v5).
 *
 * Reiner Auth-Method-Picker. Keine Form, kein Scroll. Layout über
 * `flex: 1 + justifyContent: 'space-between'` so dass Logo oben,
 * Buttons in der Mitte, Cross-Link unten — device-unabhängig
 * proportional verteilt.
 *
 * User-Anweisung 2026-05-22: "Buttons immer zentriert darstellen
 * (device-unabhängig). Auch beim Einloggen darf das nicht
 * scrollbar werden wenn das device kleiner wird, aber soll auf
 * großen genauso schön aussehen."
 *
 * Email-Pfad: `Mit E-Mail registrieren`-Button navigiert zur
 * dedizierten Form-Page `/auth/email-register`.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Animated,
  Dimensions,
  ImageBackground,
  StyleSheet,
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
import { OnboardingService } from '@/lib/services/onboardingService';
import { showInfoToast } from '@/lib/services/ui/toast';

export default function RegisterScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const screenHeight = Dimensions.get('window').height;
  const isSmallDevice = screenHeight < 700;

  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];
  const [authInFlight, setAuthInFlight] = useState(false);

  const { signInWithGoogle, signInWithApple } = useAuth();

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
              // T10 v10: paddingTop identisch zu login.tsx (insets.top+56)
              // damit Logo-Icon-Y-Position über alle Auth-Pages konsistent ist.
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

          {/* T10 v11 — Responsive Layout:
              - Logo+Brand fix oben (marginTop:32 ab paddingTop) →
                gleiche Y-Position wie Login.
              - Verbleibender Raum wird via `justifyContent: 'space-evenly'`
                in contentBlock auf drei Gruppen verteilt:
                  (1) Header (Jetzt registrieren + Vorteile)
                  (2) Buttons + Trust-Hint (eine Einheit)
                  (3) Cross-Link
              - Jede Gruppe bekommt gleichen Atemraum → "schön verteilt"
                statt "alles oben" oder "alles gestaucht in der Mitte".
              - Funktioniert responsive von kleinen iPhones (SE) bis
                Pro Max ohne Scrollen weil contentBlock flex:1 ist. */}
          <View style={[styles.logoBlock, isSmallDevice && styles.logoBlockSmall]}>
            <CustomIcon
              name="iconBlack"
              size={isSmallDevice ? 44 : 56}
              color="#fff"
              style={styles.logoIcon}
            />
            <ThemedText style={styles.brandText}>MarkenDetektive</ThemedText>
          </View>

          <View style={styles.contentBlock}>
            {/* Header */}
            <View style={styles.headerBlock}>
              <ThemedText style={styles.titleText}>
                Jetzt kostenlos registrieren
              </ThemedText>
              <ThemedText style={styles.subtitleText}>
                und Vorteile genießen!
              </ThemedText>
            </View>

            {/* Buttons + Trust-Hint als zusammenhängender Block */}
            <AuthMethodButtons
              mode="register"
              onApple={handleApple}
              onGoogle={handleGoogle}
              onEmail={() => router.push('/auth/email-register' as any)}
              busy={authInFlight}
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
  // T10 v11: Logo+Brand sind ein kompakter Block am Top (gleiche
  // Y-Position wie login.tsx: paddingTop:insets.top+56 + marginTop:32).
  logoBlock: {
    alignItems: 'center',
    marginTop: 32,
    gap: 4,
  },
  logoBlockSmall: {
    marginTop: 20,
    gap: 2,
  },
  // T10 v11: contentBlock füllt den Rest des Screens (flex:1) und
  // verteilt seine drei Kinder (Header, Buttons, CrossLink) per
  // `space-evenly` — jeweils gleicher Atemraum, "schön verteilt"
  // statt "oben geklebt" oder "in der Mitte gestaucht". Responsive
  // ohne Scroll-Risiko weil die drei Gruppen kompakt sind und der
  // flex-Container den verfügbaren Raum elastisch aufteilt.
  contentBlock: {
    flex: 1,
    justifyContent: 'space-evenly',
    width: '100%',
  },
  headerBlock: {
    alignItems: 'center',
    gap: 2,
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
  },
  subtitleText: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    letterSpacing: -0.1,
  },
  crossLinkBox: {
    alignItems: 'center',
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
