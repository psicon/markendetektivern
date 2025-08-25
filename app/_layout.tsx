import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FontLoader } from '@/components/ui/FontLoader';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { useColorScheme } from '@/hooks/useColorScheme';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import React, { useState } from 'react';

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
        <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
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
        </NavigationThemeProvider>
      </AuthProvider>
    </FontLoader>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
