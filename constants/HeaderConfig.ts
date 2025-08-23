import { Colors } from '@/constants/Colors';

/**
 * Standard Header-Konfiguration für alle App-Seiten
 * Basiert auf dem Design der Suchergebnisse-Seite
 */
export const getStandardHeaderOptions = (colorScheme: 'light' | 'dark' | null, title: string) => {
  const colors = Colors[colorScheme ?? 'light'];
  
  return {
    title,
    headerStyle: {
      backgroundColor: colors.primary,
    },
    headerTintColor: 'white',
    headerTitleStyle: {
      fontFamily: 'Nunito_600SemiBold',
      fontSize: 18,
      color: 'white',
    },
    headerBackTitle: 'Zurück',
    headerBackTitleStyle: {
      fontFamily: 'Nunito_400Regular',
      color: 'white',
    },
    animation: 'slide_from_right' as const,
  };
};

/**
 * Standard Header-Konfiguration für Stack.Screen Komponenten
 */
export const getStackScreenHeaderOptions = (colorScheme: 'light' | 'dark' | null, title: string) => ({
  ...getStandardHeaderOptions(colorScheme, title),
});

/**
 * Standard Header-Konfiguration für navigation.setOptions()
 */
export const getNavigationHeaderOptions = (colorScheme: 'light' | 'dark' | null, title: string) => ({
  ...getStandardHeaderOptions(colorScheme, title),
  // Entferne alle Custom-Eigenschaften, die den Standard-Look überschreiben
  headerBackVisible: true,
  headerShadowVisible: true,
  headerTransparent: false,
  headerBlurEffect: undefined,
  headerLargeTitle: false,
  headerSearchBarOptions: undefined,
  headerBackTitleVisible: true,
  gestureEnabled: true,
});
