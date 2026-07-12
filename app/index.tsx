import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors } from '@/constants/Colors';
import { OnboardingService } from '@/lib/services/onboardingService';
import { consentService } from '@/lib/services/consentService';

// Statischer require → Metro bündelt das Asset beim ersten JS-Eval (kein Race).
const SPLASH_ICON = require('../assets/images/splash-icon.png');

/**
 * App Entry Point - Bestimmt initiale Route basierend auf Onboarding Status
 */
export default function IndexScreen() {
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    determineInitialRoute();
  }, []);

  const determineInitialRoute = async () => {
    try {
      console.log('🚀 App starting…');

      // ─── Step 1: Consent FIRST (Android only) ────────────────────
      // Google-UMP-Consent-Banner muss laut Datenschutz-Anforderung
      // als ALLERERSTES kommen — vor Onboarding, vor Routing. Auf
      // iOS ist UMP NOT_REQUIRED, der initialize-Call ist da ein
      // No-Op und routet sofort weiter.
      //
      // Vorher lief Consent verteilt in 3 Stellen (waitForOnboarding
      // AndInit, (tabs)/index.tsx useFocusEffect, interstitial
      // AdService.initialize) — daraus entstand der bekannte
      // Z-Order-Bug 'banner liegt hinter/über erstem onboarding'
      // weil der UMP-Form async getriggert wurde während die
      // Onboarding-View schon gerendert war. Jetzt: linear in der
      // Boot-Sequenz, vor jedem Routing.
      try {
        // Audit 12.07.2026: initialize() macht beim Erstlauf einen
        // Netz-Call (AdsConsent.requestInfoUpdate) OHNE eigenes Timeout —
        // hing der, saß der User für immer auf dem Splash. Timeboxen:
        // nach Ablauf weiter booten, der Safety-Net-Pfad in
        // (tabs)/index.tsx bietet den Consent später erneut an.
        const withTimeout = <T,>(p: Promise<T>, ms: number, tag: string): Promise<T> =>
          new Promise<T>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`${tag}-timeout`)), ms);
            p.then(
              (v) => { clearTimeout(t); resolve(v); },
              (err) => { clearTimeout(t); reject(err); },
            );
          });
        const status = await withTimeout(consentService.initialize(), 6000, 'consent-init');
        if (Platform.OS === 'android' && status === 'REQUIRED') {
          console.log('🔒 Consent REQUIRED — zeige UMP-Form vor Routing');
          // Form-Laden ebenfalls timeboxen (großzügig): läuft das Race ab,
          // während das Form schon SICHTBAR ist, bleibt der native Dialog
          // schlicht über der App liegen — kein Abriss für den User.
          await withTimeout(consentService.showConsentFormIfRequired(), 20000, 'consent-form');
        }
      } catch (e) {
        console.warn('⚠️ Consent-Init/Show fehlgeschlagen/timeout, fahre fort:', e);
        // Non-fatal: User soll nicht in der App stecken bleiben weil
        // Google's SDK Probleme hat. Status wird ggf. später per
        // Safety-Net-Pfad nochmal angeboten (s. (tabs)/index.tsx).
      }

      // ─── Step 2: Onboarding-Routing ──────────────────────────────
      const hasPassedOnboarding = await OnboardingService.hasPassedOnboarding();
      console.log('📍 Onboarding passed:', hasPassedOnboarding);

      if (hasPassedOnboarding) {
        router.replace('/(tabs)');
      } else {
        router.replace('/onboarding');
      }

    } catch (error: any) {
      console.error('❌ Error determining initial route:', error);
      
      // Fehler-Details für TestFlight sammeln
      const errorDetails = {
        message: error?.message || 'Unknown error',
        stack: error?.stack || 'No stack trace',
        code: error?.code || 'No error code',
        name: error?.name || 'Unknown error type',
        timestamp: new Date().toISOString()
      };
      
      console.error('📱 TestFlight Error Details:', errorDetails);
      
      // Fehler anzeigen statt nur zu loggen
      setError(JSON.stringify(errorDetails, null, 2));
      
      // NICHT automatisch zur App navigieren - zeige Fehler an
    }
  };

  // Fehler-Anzeige für TestFlight
  if (error) {
    return (
      <View style={styles.container}>
        <ScrollView style={styles.errorContainer} contentContainerStyle={styles.errorContent}>
          <Text style={styles.errorTitle}>🚨 TestFlight Fehler</Text>
          <Text style={styles.errorSubtitle}>Bitte diesen Fehler dem Entwickler melden:</Text>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
          <TouchableOpacity style={styles.retryButton} onPress={() => {
            setError(null);
            determineInitialRoute();
          }}>
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Branded Boot-Screen: grüner Gradient + Logo + Nunito — matcht den
          nativen Splash (#0d8575) statt des vorherigen weißen System-Font-
          Screens ohne Logo. Fonts sind hier bereits geladen (FontLoader gate),
          daher explizite Nunito-Varianten (rendern iOS + Android korrekt). */}
      <LinearGradient
        colors={[Colors.light.primary, Colors.light.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.content}>
        <Image
          source={SPLASH_ICON}
          style={styles.logo}
          resizeMode="contain"
          fadeDuration={0}
        />
        <Text style={styles.loadingText}>MarkenDetektive</Text>
        <Text style={styles.subtext}>Wir zeigen dir, wer dahinter steckt!</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.primary, // grüner Fallback hinter dem Gradient
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 72,
    height: 72,
    marginBottom: 20,
  },
  loadingText: {
    fontSize: 26,
    fontFamily: 'Nunito_700Bold',
    color: '#ffffff',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtext: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    padding: 20,
  },
  errorContent: {
    paddingTop: 100,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ff3b30',
    marginBottom: 10,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontSize: 16,
    color: Colors.light.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#333',
  },
  retryButton: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
  },
  retryText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
