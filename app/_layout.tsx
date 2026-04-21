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
          const waitForOnboardingAndInit = async () => {
            const { OnboardingService } = await import('@/lib/services/onboardingService');
            const { consentService } = await import('@/lib/services/consentService');
            
            while (!cancelled) {
              const hasPassedOnboarding = await OnboardingService.hasPassedOnboarding();
              if (hasPassedOnboarding) {
                console.log('✅ Onboarding abgeschlossen - initialisiere Consent & Ads');
                await consentService.initialize();
                
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
              
              console.log('⏳ Onboarding nicht abgeschlossen - warte mit Consent/Ads...');
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
