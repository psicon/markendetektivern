import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Colors } from '@/constants/Colors';
import { OnboardingService } from '@/lib/services/onboardingService';
import { consentService } from '@/lib/services/consentService';

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
        const status = await consentService.initialize();
        if (Platform.OS === 'android' && status === 'REQUIRED') {
          console.log('🔒 Consent REQUIRED — zeige UMP-Form vor Routing');
          await consentService.showConsentFormIfRequired();
        }
      } catch (e) {
        console.warn('⚠️ Consent-Init/Show fehlgeschlagen, fahre fort:', e);
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
      <View style={styles.content}>
        <Text style={styles.loadingText}>MarkenDetektive</Text>
        <Text style={styles.subtext}>Wir zeigen dir, wer dahinter steckt!</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginBottom: 8,
  },
  subtext: {
    fontSize: 10,
    color: Colors.light.text,
    opacity: 0.6,
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
