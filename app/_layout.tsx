// ─── Side-effect import: patcht Text.render & TextInput.render auf
// Android damit `{ fontFamily: 'Nunito', fontWeight: X }` zu der
// expliziten Nunito_XXX Family resolvt wird (Android wendet weight
// nicht auf custom fonts an → ohne Patch fallen ~440 Callsites auf
// System-Default). Muss VOR jedem Text-Render geladen sein, daher
// erste Zeile. Siehe lib/utils/androidTextFontPatch.ts.
import '@/lib/utils/androidTextFontPatch';
import { Toasts } from '@backpackapp-io/react-native-toast';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import Constants from 'expo-constants';
import * as NavigationBar from 'expo-navigation-bar';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FontLoader } from '@/components/ui/FontLoader';
import { GamificationProvider } from '@/components/ui/GamificationProvider';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { AnalyticsProvider } from '@/lib/contexts/AnalyticsProvider';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { PushNotificationProvider } from '@/lib/contexts/PushNotificationProvider';
import { RevenueCatProvider } from '@/lib/contexts/RevenueCatProvider';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { adMobService } from '@/lib/services/adMobService';
import appLifecycleService from '@/lib/services/appLifecycleService';
import { configureGoogleSignIn } from '@/lib/services/auth/googleAuth';
import { interstitialAdService } from '@/lib/services/interstitialAdService';
import { rewardedAdService } from '@/lib/services/rewardedAdService';
import { testFlightLogger } from '@/lib/utils/testflightLogger';
import React, { useEffect, useState } from 'react';

// Komponente die sowohl FontLoader als auch Navigation mit Theme verwaltet
function ThemedApp() {
  const colorScheme = useColorScheme();
  // Android: Nur nativen Splash verwenden, iOS: Custom Splash
  const [showSplash, setShowSplash] = useState(Platform.OS === 'ios');

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  // Android NavigationBar fix
  useEffect(() => {
    if (Platform.OS === 'android') {
      const colors = Colors[colorScheme ?? 'light'];
      NavigationBar.setBackgroundColorAsync(colors.background);
      NavigationBar.setButtonStyleAsync(colorScheme === 'dark' ? 'light' : 'dark');
      NavigationBar.setVisibilityAsync('visible');
      NavigationBar.setBehaviorAsync('inset-swipe');
    }
  }, [colorScheme]);

  // Configure Google Sign-In early
  useEffect(() => {
    configureGoogleSignIn().catch(error => {
      console.log('Google Sign-In configuration error:', error);
    });
  }, []);

  // Fix Q — Pre-warm Firestore connection + reference data at app boot.
  //
  // Problem: Stöbern feuert beim ersten Aufruf 6+ Firestore-Queries
  // gleichzeitig. Auf Android Web SDK muss die ERSTE dieser Queries den
  // WebChannel-Handshake aufbauen (~2-3 s cold), die anderen warten
  // serialisiert auf die gleiche Connection bis sie verfügbar wird.
  // Plus jede Query selbst ist 500-1000 ms auf Web SDK Android.
  //
  // Mit Pre-Warm: 4 Reference-Queries (discounter, handelsmarken,
  // packungstypen, kategorien) feuern am App-Boot via
  // runAfterInteractions — deferred genug damit sie nicht den App-
  // Start blocken, früh genug damit sie meist schon durch sind wenn
  // User auf Stöbern tippt (typisch 5-10 s nach Boot).
  // Resultate werden im FirestoreService-Cache (5 min TTL) abgelegt
  // → Stöbern's reference-data-useEffect findet Cache-Hits und
  // skippt die Roundtrips.
  // Zusätzlich: WebChannel-Connection ist warm, Stöbern's
  // Product-Queries hängen nicht mehr am Handshake.
  // Erwartete Einsparung: 3-5 s auf erstem Stöbern-Aufruf.
  useEffect(() => {
    let cancelled = false;
    const handle = require('react-native').InteractionManager.runAfterInteractions(async () => {
      if (cancelled) return;
      try {
        // Service-level Imports (lazy damit Bundle-Mount nicht blockt)
        const { FirestoreService } = await import('@/lib/services/firestore');
        const { db } = await import('@/lib/firebase');
        const { collection, getDocs } = await import('@react-native-firebase/firestore');
        // Alle 3 öffentlich-lesbaren Reference-Collections parallel.
        // Errors werden geschluckt — Stöbern's eigener Fetch erholt sich.
        // `getDiscounter` hat Service-Level-Cache → Stöbern's Aufruf
        // wird Cache-Hit. handelsmarken/packungstypen werden im
        // Firestore-SDK-Memory-Cache landen → Re-Query in Stöbern
        // ist immerhin wesentlich schneller.
        await Promise.all([
          FirestoreService.getDiscounter().catch(() => null),
          getDocs(collection(db, 'handelsmarken')).catch(() => null),
          getDocs(collection(db, 'packungstypen')).catch(() => null),
        ]);
        if (!cancelled) {
          console.log('🔥 Stöbern Reference-Data prewarmed');
        }
      } catch {
        // swallow — Stöbern eigene Logik handelt Recovery
      }
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, []);

  // Initialize Firebase Crashlytics
  useEffect(() => {
    const initCrashlytics = async () => {
      try {
        // Skip in Expo Go or development
        if (__DEV__ || Constants.appOwnership === 'expo') {
          console.log('⏭️ Crashlytics skipped (Development/Expo Go)');
          return;
        }
        
        const crashlytics = require('@react-native-firebase/crashlytics').default;
        
        // Enable Crashlytics collection
        await crashlytics().setCrashlyticsCollectionEnabled(true);
        
        // Set custom attributes
        crashlytics().setAttribute('platform', Platform.OS);
        crashlytics().setAttribute('app_version', '5.0.4');
        
        console.log('✅ Firebase Crashlytics initialized');
      } catch (error) {
        console.log('⚠️ Crashlytics not available:', error);
      }
    };
    
    initCrashlytics();
  }, []);

  return (
    <FontLoader>
      <AuthProvider>
        <RevenueCatProvider>
          <PushNotificationProvider>
            <AnalyticsProvider>
              <GamificationProvider>
              <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <Stack>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="auth/welcome" options={{ headerShown: false }} />
                <Stack.Screen name="auth/login" options={{ headerShown: false }} />
                <Stack.Screen name="auth/register" options={{ headerShown: false }} />
                {/* Detail screens render their own sticky header — suppress
                    the default Stack header statically here so it never
                    flashes on mount. */}
                <Stack.Screen name="product-comparison/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="noname-detail/[id]" options={{ headerShown: false }} />
                <Stack.Screen
                  name="barcode-scanner"
                  options={{
                    headerShown: false,
                    animation: 'slide_from_right',
                    gestureEnabled: true
                  }}
                />
                <Stack.Screen
                  name="cashback/consent"
                  options={{ headerShown: false, animation: 'slide_from_bottom', gestureEnabled: true }}
                />
                <Stack.Screen
                  name="cashback/capture"
                  options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true }}
                />
                <Stack.Screen
                  name="cashback/review"
                  options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true }}
                />
                <Stack.Screen
                  name="cashback/history"
                  options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true }}
                />
                <Stack.Screen
                  name="cashback/pending/[id]"
                  options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true }}
                />
                <Stack.Screen name="+not-found" />
              </Stack>
              <StatusBar 
                style={colorScheme === 'dark' ? 'light' : 'dark'} 
                translucent={false}
                backgroundColor={Colors[colorScheme ?? 'light'].background}
              />
              
              {/* Splash Screen Overlay */}
              {showSplash && (
                <SplashScreen onAnimationComplete={handleSplashComplete} />
              )}

              {/* Global Toast Host - transparenter Wrapper, damit nur unser Custom-Toast sichtbar ist */}
              <Toasts 
                defaultStyle={{
                  view: { backgroundColor: 'transparent', padding: 0, margin: 0, shadowOpacity: 0, elevation: 0 },
                  pressable: { backgroundColor: 'transparent' },
                  indicator: { marginRight: 0 },
                }}
              />
            </NavigationThemeProvider>
              </GamificationProvider>
            </AnalyticsProvider>
          </PushNotificationProvider>
        </RevenueCatProvider>
      </AuthProvider>
    </FontLoader>
  );
}

export default function RootLayout() {
  const adsInitializedRef = React.useRef(false);
  
  useEffect(() => {
    // Aktiviere TestFlight Logger
    testFlightLogger.enable();
    console.log('🚀 App gestartet - TestFlight Logger aktiviert');
    
    // App Lifecycle Service initialisieren
    appLifecycleService.initialize();
    
    // AdMob SOFORT initialisieren - keine Verzögerungen mehr!
    // KRITISCH: Jede Sekunde Verzögerung = verlorene Einnahmen
    let cancelled = false;

    const initializeAdsWithConsent = async () => {
      if (adsInitializedRef.current) {
        return;
      }

      try {
        if (Platform.OS === 'ios') {
          // iOS: SOFORT initialisieren für maximale Einnahmen
          await adMobService.initialize();
          console.log('✅ iOS AdMob sofort initialisiert');
          interstitialAdService.initialize();
          rewardedAdService.initialize();
          adsInitializedRef.current = true;
        } else {
          // Android: AdMob NACH Onboarding initialisieren. Consent wird
          // jetzt ZENTRAL in app/index.tsx vor dem Routing erledigt
          // (nicht mehr hier — vermeidet den Z-Order-Bug 'banner liegt
          // hinter/über erstem onboarding'). Hier nur noch AdMob-Setup
          // gated auf Onboarding-Completion.
          const waitForOnboardingAndInit = async () => {
            const { OnboardingService } = await import('@/lib/services/onboardingService');

            while (!cancelled) {
              const hasPassedOnboarding = await OnboardingService.hasPassedOnboarding();
              if (hasPassedOnboarding) {
                console.log('✅ Onboarding abgeschlossen - initialisiere AdMob');

                // Android braucht etwas Delay wegen dem Crash
                setTimeout(async () => {
                  if (adsInitializedRef.current || cancelled) return;
                  await adMobService.initialize();
                  console.log('✅ Android AdMob initialisiert');
                  interstitialAdService.initialize();
                  rewardedAdService.initialize();
                  adsInitializedRef.current = true;
                }, 2000);
                return;
              }

              console.log('⏳ Onboarding nicht abgeschlossen - warte mit AdMob…');
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          };

          waitForOnboardingAndInit();
        }
      } catch (error) {
        console.error('❌ Ads initialization error:', error);
      }
    };
    
    initializeAdsWithConsent();
    
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <ThemeProvider>
            <ThemedApp />
          </ThemeProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
