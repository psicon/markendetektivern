import { Platform } from 'react-native';

/**
 * Detects if app is running in Expo Go
 */
export const isExpoGo = (): boolean => {
  try {
    // Check if native modules are available (Production/Development Build)
    if (Platform.OS === 'ios') {
      const { NativeModules } = require('react-native');
      // Wenn unser natives Module verfügbar ist = Production Build
      if (NativeModules.AVFoundationBarcodeScanner) {
        return false; // Production Build
      }
    }
    
    // Check for Expo Go specific globals
    if ((global as any).expo || (global as any).__expo) {
      return true; // Expo Go
    }
    
    // Default: In Development ohne native Module = wahrscheinlich Expo Go
    return __DEV__;
  } catch (error) {
    return true; // Safe fallback zu Expo Go
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
