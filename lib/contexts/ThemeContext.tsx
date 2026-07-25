import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

type ColorScheme = 'light' | 'dark';
type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextType {
  colorScheme: ColorScheme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  isDarkMode: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = '@markendetektive_theme_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useSystemColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [isLoading, setIsLoading] = useState(true);

  // Berechne das aktuelle ColorScheme basierend auf ThemeMode
  const colorScheme: ColorScheme = 
    themeMode === 'system' 
      ? (systemColorScheme ?? 'light')
      : themeMode;

  const isDarkMode = colorScheme === 'dark';

  // Lade gespeicherte Theme-Einstellung beim Start
  useEffect(() => {
    loadThemeMode();
  }, []);

  // Speichere Theme-Einstellung bei Änderung.
  //
  // WICHTIG (nicht "wegoptimieren"): Die Persistenz hängt bewusst HIER
  // und nicht in `setThemeMode` — dadurch wird JEDE Änderung des Modus
  // gespeichert, egal über welchen Weg sie kam, und der Setter bleibt
  // ein reiner State-Setter. Das `isLoading`-Gate verhindert, dass der
  // Default 'system' den gespeicherten Wert überschreibt, bevor
  // `loadThemeMode` durch ist.
  useEffect(() => {
    if (!isLoading) {
      saveThemeMode(themeMode);
    }
  }, [themeMode, isLoading]);

  // Setze colorScheme global für Toast-System
  useEffect(() => {
    (global as any).__colorScheme = colorScheme;
  }, [colorScheme]);

  const loadThemeMode = async () => {
    try {
      const savedThemeMode = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      if (savedThemeMode && ['system', 'light', 'dark'].includes(savedThemeMode)) {
        setThemeModeState(savedThemeMode as ThemeMode);
      }
    } catch (error) {
      console.error('Error loading theme mode:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveThemeMode = async (mode: ThemeMode) => {
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
      console.log(`✅ Theme mode saved: ${mode}`);
    } catch (error) {
      console.error('Error saving theme mode:', error);
    }
  };

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
  };

  // Zeige nichts während des Ladens, um Flackern zu vermeiden
  if (isLoading) {
    return null;
  }

  return (
    <ThemeContext.Provider
      value={{
        colorScheme,
        themeMode,
        setThemeMode,
        isDarkMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Backward compatibility - behält die gleiche API wie der alte useColorScheme Hook
export function useColorScheme() {
  const { colorScheme } = useTheme();
  return colorScheme;
}
