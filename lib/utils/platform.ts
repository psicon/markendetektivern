import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Detects if app is running in Expo Go
 */
export const isExpoGo = (): boolean => {
  try {
    // KORREKTE Expo Go Erkennung mit Constants
    if (Constants.appOwnership === 'expo') {
      return true; // Echtes Expo Go
    }
    
    // Check for Expo Go specific globals (zusätzliche Sicherheit)
    if ((global as any).expo || (global as any).__expo) {
      return true; // Expo Go
    }
    
    // TestFlight und Production Builds sind NICHT Expo Go
    return false;
  } catch (error) {
    console.error('Error detecting Expo Go:', error);
    return false; // Safe fallback zu Production Build
  }
};

/**
 * Detects if app is a production/development build (not Expo Go)
 */
export const isProductionBuild = (): boolean => {
  return !isExpoGo();
};

/**
 * Gets the current platform info for logging
 */
export const getPlatformInfo = () => {
  return {
    os: Platform.OS,
    version: Platform.Version,
    isExpoGo: isExpoGo(),
    isProduction: isProductionBuild(),
    isDev: __DEV__,
  };
};

/**
 * Logger helper for platform-specific debugging
 */
export const platformLog = (message: string, data?: any) => {
  const info = getPlatformInfo();
  console.log(`[${info.os.toUpperCase()}${info.isExpoGo ? '-EXPO' : '-NATIVE'}] ${message}`, data || '');
};
