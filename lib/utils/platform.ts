import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Detects if app is running in Expo Go
 */
export const isExpoGo = (): boolean => {
  try {
    // NUR Expo Go hat appOwnership === 'expo'
    // TestFlight/Production haben 'standalone' oder undefined
    return Constants.appOwnership === 'expo';
  } catch (error) {
    console.error('Error detecting Expo Go:', error);
    return false;
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
