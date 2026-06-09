import { Colors } from '@/constants/Colors';
import { initializeFonts } from '@/lib/fontManager';
import { onAppContentReady } from '@/lib/utils/appReady';
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
    if ((fontsLoaded || fontError) && imagesPreloaded) {
      // Globale Font-Einstellungen initialisieren.
      initializeFonts();

      // WICHTIG: Die native Splash NICHT hier (kurz nach Font-Load) ausblenden.
      // Die gruene Splash-Overlay (SplashScreen.tsx) ruft hideAsync selbst auf,
      // sobald SIE gerendert ist — erst dann ist der Uebergang native->Overlay
      // nahtlos gruen. Wuerde FontLoader frueher ausblenden, klaffte zwischen
      // native-Splash-weg und Overlay-da eine schwarze Luecke (Provider-Mount).
      // Native Splash ausblenden, sobald der erste echte Screen bereit ist
      // (markAppContentReady). Auf Android (keine React-Overlay) haelt die
      // native Splash so nahtlos bis zur App durch — kein Whitescreen. Auf iOS
      // blendet die Custom-Overlay i.d.R. frueher selbst aus (hideAsync ist
      // idempotent). + 5s-Sicherheits-Fallback, falls das Signal mal ausbleibt.
      const unsub = onAppContentReady(() => {
        // Erst nach 2 Animation-Frames ausblenden → der erste echte Screen ist
        // dann garantiert GEPAINTET (markAppContentReady feuert im useEffect,
        // also nach Commit aber vor Paint). So kein 1-Frame-Schwarz beim Handoff.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            SplashScreen.hideAsync().catch(() => {});
          }),
        );
      });
      const fallback = setTimeout(() => {
        SplashScreen.hideAsync().catch(() => {});
      }, 5000);
      return () => {
        unsub();
        clearTimeout(fallback);
      };
    }
  }, [fontsLoaded, fontError, imagesPreloaded]);

  if ((!fontsLoaded && !fontError) || !imagesPreloaded) {
    // Während Assets laden, zeige einen minimalen Fallback
    return (
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        // Grün statt weiß: matcht den nativen Splash (#0d8575) + app/index →
        // kein weißer Blitz im Boot-Pfad (native → FontLoader → index → app).
        backgroundColor: Colors.light.primary
      }}>
        <ActivityIndicator
          size="large"
          color="#ffffff"
        />
      </View>
    );
  }

  return <>{children}</>;
};
