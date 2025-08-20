import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { initializeFonts } from '@/lib/fontManager';
import { preloadImages } from '@/lib/utils/imagePreloader';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import React, { ReactNode, useEffect, useState } from 'react';
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
  const [imagesPreloaded, setImagesPreloaded] = useState(false);
  
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

  // Preload images immediately
  useEffect(() => {
    const loadImages = async () => {
      try {
        await preloadImages();
        setImagesPreloaded(true);
      } catch (error) {
        console.log('Image preloading failed, continuing anyway:', error);
        setImagesPreloaded(true); // Continue even if preloading fails
      }
    };
    
    loadImages();
  }, []);

  useEffect(() => {
    const hideSplash = async () => {
      // Wait for both fonts and images to be ready
      if ((fontsLoaded || fontError) && imagesPreloaded) {
        // Initialisiere globale Font-Einstellungen
        initializeFonts();
        
        // Kleine Verzögerung um sicherzustellen, dass alles ready ist
        setTimeout(async () => {
          await SplashScreen.hideAsync();
        }, 100);
      }
    };

    hideSplash();
  }, [fontsLoaded, fontError, imagesPreloaded]);

  if ((!fontsLoaded && !fontError) || !imagesPreloaded) {
    // Während Assets laden, zeige einen minimalen Fallback
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
