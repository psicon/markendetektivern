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
import { FacebookLinkSheet } from '@/components/auth/FacebookLinkSheet';
import { SurveyProvider } from '@/components/survey/SurveyProvider';
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
  // iOS: animierte Custom-Overlay (SplashScreen.tsx). Android: KEINE React-
  // Overlay — die native Splash (OS-gemalt, kein React-Paint-Lag) bleibt
  // stattdessen bis der erste echte Screen bereit ist (markAppContentReady),
  // siehe FontLoader. Grund: die React-Overlay paintet auf Android verzoegert
  // (LinearGradient+Image+Animationen) → zwischen native-Splash-weg und
  // Overlay-da klaffte eine schwarze Luecke. Die gehaltene native Splash
  // (gruen + Icon) ist garantiert nahtlos bis zur App.
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

  // Pre-warm der leichten Reference-Collections am App-Boot.
  //
  // Historie: Dieser Trick stammt aus der Web-SDK-Zeit, wo die ERSTE
  // Stöbern-Query den WebChannel-Handshake (~2-3 s cold) aufbauen musste.
  // Nach der Native-RNFirebase-Migration (gRPC, kein WebChannel) ist die
  // Connection-Warmup-Begründung obsolet.
  //
  // D1 (Stufe 1): Der Prewarm der `handelsmarken`-Collection (~1.160 Docs)
  // ist ENTFERNT — er lief bei JEDEM App-Start, unabhängig davon ob der
  // User Stöbern überhaupt öffnet (größter einzelner Firestore-Kostenhebel
  // + langsamerer Android-Start). Stöbern lädt handelsmarken bei Bedarf über
  // seinen eigenen Reference-Data-Effect (SDK-Memory-Cache greift dort).
  // Der leichte Warmup von discounter (Service-Cache, 5 min TTL) +
  // packungstypen (klein) bleibt, ebenso der einmalige Negative-Cache-Purge.
  useEffect(() => {
    let cancelled = false;
    const handle = require('react-native').InteractionManager.runAfterInteractions(async () => {
      if (cancelled) return;
      try {
        // Service-level Imports (lazy damit Bundle-Mount nicht blockt)
        const { FirestoreService } = await import('@/lib/services/firestore');
        const { db } = await import('@/lib/firebase');
        const { collection, getDocs } = await import('@react-native-firebase/firestore');
        // Leichte Reference-Collections parallel. Errors werden geschluckt —
        // Stöbern's eigener Fetch erholt sich. `getDiscounter` hat Service-
        // Cache → Stöbern's Aufruf wird Cache-Hit; packungstypen ist klein.
        // handelsmarken (~1.160 Docs) wird bewusst NICHT mehr geladen (D1).
        await Promise.all([
          FirestoreService.getDiscounter().catch(() => null),
          getDocs(collection(db, 'packungstypen')).catch(() => null),
        ]);
        // One-shot: alte 429-polluted Negative-Cache-Einträge
        // bereinigen. Idempotent (löscht nur was wirklich negativ
        // cached ist, lässt positive Treffer in Ruhe).
        const { default: OpenFoodService } = await import('@/lib/services/openfood');
        OpenFoodService.purgeNegativeCacheOnce().catch(() => null);
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
        // Dynamisch statt Hardcode — der alte Literal ('5.0.4') hinkte drei
        // Releases hinterher und hätte bei jedem Versions-Bump manuell
        // nachgezogen werden müssen.
        crashlytics().setAttribute(
          'app_version',
          Constants.expoConfig?.version ?? 'unknown',
        );
        
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
              <SurveyProvider>
              <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <Stack>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="onboarding" options={{ headerShown: false }} />
                {/* gestureEnabled:false — die Tab-Gruppe ist die Wurzel der
                    App; ein Swipe-back von Home würde aus dem Tab-Navigator
                    heraus poppen und die Auth-/Onboarding-Nav-Gates auslösen
                    (router.replace nach /auth/welcome etc.). Es gibt kein
                    sinnvolles Ziel hinter den Tabs → Geste aus (86ca8gbkh). */}
                <Stack.Screen name="(tabs)" options={{ headerShown: false, gestureEnabled: false }} />
                <Stack.Screen name="auth/welcome" options={{ headerShown: false }} />
                <Stack.Screen name="auth/login" options={{ headerShown: false }} />
                <Stack.Screen name="auth/register" options={{ headerShown: false }} />
                {/* Detail screens render their own sticky header — suppress
                    the default Stack header statically here so it never
                    flashes on mount. */}
                <Stack.Screen name="product/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="product-comparison/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="noname-detail/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="external-product/[ean]" options={{ headerShown: false }} />
                <Stack.Screen name="surveys" options={{ headerShown: false }} />
                <Stack.Screen name="join-scan" options={{ headerShown: false, animation: 'slide_from_bottom' }} />
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
                  // gestureEnabled:false — capture wird via router.replace
                  // von consent betreten; Swipe-Back würde wie bei review
                  // inkonsistent landen (statt zum Scanner zur falschen
                  // Tab/Splash). Abbruch nur über das X (→ rewards). 2026-06.
                  options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }}
                />
                <Stack.Screen
                  name="cashback/review"
                  // gestureEnabled:false — review ist eine In-Progress-Stufe.
                  // Vorige Screens wurden via router.replace ersetzt, daher
                  // würde Swipe-Back inkonsistent zur rewards-Tab springen
                  // statt zur Kamera. Exit nur über X (→ rewards) oder
                  // "Nochmal" (→ capture). 2026-05-28.
                  options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: false }}
                />
                <Stack.Screen
                  name="cashback/history"
                  options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true }}
                />
                <Stack.Screen
                  name="cashback/pending/[id]"
                  // gestureEnabled bleibt true: pending dient zwei Zwecken —
                  // (1) frisch abgeschickter Bon (review→replace → Swipe-Back
                  //     landet sicher auf rewards, kein Stale-review dahinter)
                  // (2) Detail-View eines existierenden Bons (history→push →
                  //     Swipe-Back→history ist erwünscht).
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

              {/* ClickUp 86cacp92p (1.19): globales Facebook↔E-Mail/Passwort-
                  Link-Sheet. Erscheint nur, wenn ein FB-Login auf ein
                  bestehendes E-Mail/Passwort-Konto trifft. */}
              <FacebookLinkSheet />
            </NavigationThemeProvider>
              </SurveyProvider>
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
    // Root-Hintergrund GRÜN (#0d8575) = Markenfarbe des nativen Splash + der
    // Overlay. Falls beim Boot zwischen Overlay-Dismiss und erstem App-Frame
    // eine Lücke entsteht, scheint dann GRÜN durch (vorher schwarzer nativer
    // Window-Hintergrund bzw. weiss) → durchgängig grüner Boot wie auf iOS.
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0d8575' }}>
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
