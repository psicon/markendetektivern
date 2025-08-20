import { Platform, StatusBar } from 'react-native';

/**
 * Android-specific UI constants and helpers
 */
export const AndroidFixes = {
  // Get Android StatusBar height
  statusBarHeight: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  
  // TabBar specific adjustments
  tabBarHeight: Platform.select({
    ios: 90,
    android: 65,
    default: 80,
  }),
  
  // ScrollView bottom padding to avoid TabBar overlap
  scrollViewBottomPadding: Platform.select({
    ios: 120,
    android: 20,
    default: 100,
  }),
  
  // Map border radius (Android has issues with rounded maps)
  mapBorderRadius: Platform.select({
    ios: 20,
    android: 0,
    default: 20,
  }),
  
  // Modal presentation style
  modalPresentationStyle: Platform.select({
    ios: 'pageSheet' as const,
    android: 'fullScreen' as const,
    default: 'fullScreen' as const,
  }),
  
  // Safe area edges
  safeAreaEdges: Platform.select({
    ios: ['top', 'bottom'] as const,
    android: ['top'] as const,
    default: ['top', 'bottom'] as const,
  }),
};
