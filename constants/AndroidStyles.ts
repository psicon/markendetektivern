import { Platform, ViewStyle } from 'react-native';

/**
 * Android-specific elevation styles that avoid the ugly shadow/background issues
 * Use these instead of raw elevation values
 */
export const AndroidElevation = {
  none: Platform.select<ViewStyle>({
    ios: {},
    android: {
      elevation: 0,
    },
  }),
  
  small: Platform.select<ViewStyle>({
    ios: {},
    android: {
      elevation: 2,
      shadowColor: 'transparent',
    },
  }),
  
  medium: Platform.select<ViewStyle>({
    ios: {},
    android: {
      elevation: 4,
      shadowColor: 'transparent',
    },
  }),
  
  large: Platform.select<ViewStyle>({
    ios: {},
    android: {
      elevation: 8,
      shadowColor: 'transparent',
    },
  }),
};

/**
 * Helper to remove all elevation on Android while keeping iOS shadows
 */
export const removeAndroidElevation = (style: ViewStyle): ViewStyle => {
  if (Platform.OS === 'android') {
    const { elevation, shadowColor, shadowOffset, shadowOpacity, shadowRadius, ...rest } = style;
    return rest;
  }
  return style;
};

/**
 * Android-safe button styles that prevent the white background issue
 */
export const AndroidButtonStyles = {
  transparentBackground: Platform.select<ViewStyle>({
    ios: {},
    android: {
      backgroundColor: 'transparent',
      elevation: 0,
    },
  }),
  
  rippleContainer: Platform.select<ViewStyle>({
    ios: {},
    android: {
      overflow: 'hidden',
    },
  }),
};

