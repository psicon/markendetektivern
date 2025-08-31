import { Platform } from 'react-native';

/**
 * Detects if app is running in Expo Go
 */
export const isExpoGo = (): boolean => {
  try {
    // Check for Expo Go specific global
    if ((global as any).expo) {
      return true;
    }
    
    // Check for Expo Go specific constants
    if ((global as any).__expo) {
      return true;
    }
    
    // Check for development mode indicators
    if (__DEV__ && (global as any).nativeCallSyncHook) {
      return true;
    }
    
    return false;
  } catch (error) {
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
