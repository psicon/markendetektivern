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
  toggleDarkMode: () => void;
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

  // Speichere Theme-Einstellung bei Änderung
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

  const toggleDarkMode = () => {
    const newMode = isDarkMode ? 'light' : 'dark';
    setThemeMode(newMode);
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
        toggleDarkMode,
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
