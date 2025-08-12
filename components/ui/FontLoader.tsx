import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { initializeFonts } from '@/lib/fontManager';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import React, { ReactNode, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import {
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
} from '@expo-google-fonts/nunito';

import {
    Lato_400Regular,
    Lato_500Medium,
} from '@expo-google-fonts/lato';

interface FontLoaderProps {
  children: ReactNode;
}

// Verhindere automatisches Ausblenden des Splash Screens
SplashScreen.preventAutoHideAsync();

export const FontLoader = ({ children }: FontLoaderProps) => {
  const colorScheme = useColorScheme();
  
  const [fontsLoaded, fontError] = useFonts({
    // Primary Font - Nunito (only needed weights)
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    
    // Secondary Font - Lato (only needed weights)
    Lato_400Regular,
    Lato_500Medium,
    
    // Keep SpaceMono for fallback
    SpaceMono: require('../../assets/fonts/SpaceMono-Regular.ttf'),
    
    // Custom Icon Font
    MDAppIcons: require('../../assets/fonts/md_app_icons.ttf'),
  });

  useEffect(() => {
    const hideSplash = async () => {
      if (fontsLoaded || fontError) {
        // Initialisiere globale Font-Einstellungen
        initializeFonts();
        
        // Kleine Verzögerung um sicherzustellen, dass Fonts wirklich ready sind
        setTimeout(async () => {
          await SplashScreen.hideAsync();
        }, 100);
      }
    };

    hideSplash();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    // Während Fonts laden, zeige einen minimalen Fallback
    return (
      <View style={{ 
        flex: 1, 
        justifyContent: 'center', 
        alignItems: 'center',
        backgroundColor: Colors[colorScheme ?? 'light'].background 
      }}>
        <ActivityIndicator 
          size="large" 
          color={Colors[colorScheme ?? 'light'].primary} 
        />
      </View>
    );
  }

  return <>{children}</>;
};
