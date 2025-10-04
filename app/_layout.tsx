import { Toasts } from '@backpackapp-io/react-native-toast';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FontLoader } from '@/components/ui/FontLoader';
import { GamificationProvider } from '@/components/ui/GamificationProvider';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { useColorScheme } from '@/hooks/useColorScheme';
import { AnalyticsProvider } from '@/lib/contexts/AnalyticsProvider';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { RevenueCatProvider } from '@/lib/contexts/RevenueCatProvider';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { testFlightLogger } from '@/lib/utils/testflightLogger';
import React, { useEffect, useState } from 'react';

// Komponente die sowohl FontLoader als auch Navigation mit Theme verwaltet
function ThemedApp() {
  const colorScheme = useColorScheme();
  const [showSplash, setShowSplash] = useState(true);

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  return (
    <FontLoader>
      <AuthProvider>
        <RevenueCatProvider>
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
              <StatusBar style="auto" />
              
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
                gutter={10}
              />
            </NavigationThemeProvider>
            </GamificationProvider>
          </AnalyticsProvider>
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
