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
        crashlytics().setAttribute('app_version', '5.0.2');
        
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
  useEffect(() => {
    // Aktiviere TestFlight Logger
    testFlightLogger.enable();
    console.log('🚀 App gestartet - TestFlight Logger aktiviert');
    
    // ⚠️ iOS CRASH FIX: Alles was wir in 5.0.2 hinzugefügt haben auf iOS skip/verzögern
    // Navigation muss ZUERST vollständig initialisiert werden
    
    if (Platform.OS === 'ios') {
      // iOS: ALLES verzögern - erst nach Navigation vollständig initialisiert
      // WICHTIG: Navigation muss ZUERST vollständig fertig sein
      setTimeout(() => {
        // App Lifecycle Service (NEU in 5.0.2)
        // Registriert nur einen Event Listener - sollte Navigation nicht stören wenn verzögert
        try {
          appLifecycleService.initialize();
        } catch (error) {
          console.error('❌ iOS AppLifecycle init error:', error);
          // Nicht kritisch - App kann ohne laufen
        }
        
        // AdMob Initialisierung (wurde geändert in 5.0.2)
        // Zusätzlich verzögern um sicherzugehen
        setTimeout(() => {
          adMobService.initialize().then(() => {
            console.log('📱 iOS AdMob initialisiert');
            interstitialAdService.initialize();
          }).catch(error => {
            console.error('❌ iOS AdMob init error:', error);
          });
        }, 1000);
      }, 3000); // 3 Sekunden warten bis Navigation bereit ist
    } else {
      // Android: Wie vorher (funktioniert)
      appLifecycleService.initialize();
      
      // Android: Consent + AdMob wie bisher
      setTimeout(() => {
        const initializeAdsWithConsent = async () => {
          try {
            const { consentService } = await import('@/lib/services/consentService');
            const { InteractionManager } = await import('react-native');
            await new Promise<void>(resolve => InteractionManager.runAfterInteractions(() => resolve()));
            
            await consentService.initialize();
            
            setTimeout(async () => {
              await adMobService.initialize();
              console.log('📱 Android AdMob mit Delay initialisiert');
              interstitialAdService.initialize();
            }, 2000);
          } catch (error) {
            console.error('❌ Ads initialization error:', error);
          }
        };
        
        initializeAdsWithConsent();
      }, 2000);
    }
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
