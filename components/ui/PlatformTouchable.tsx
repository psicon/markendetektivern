import React from 'react';
import { Platform, TouchableNativeFeedback, TouchableOpacity, TouchableOpacityProps, View } from 'react-native';

interface PlatformTouchableProps extends TouchableOpacityProps {
  foreground?: boolean;
  rippleColor?: string;
  borderless?: boolean;
}

/**
 * Platform-specific touchable component that uses TouchableNativeFeedback on Android
 * and TouchableOpacity on iOS for consistent behavior across platforms.
 */
export function PlatformTouchable({ 
  children, 
  style,
  foreground = false,
  rippleColor,
  borderless = false,
  ...props 
}: PlatformTouchableProps) {
  if (Platform.OS === 'android' && Platform.Version >= 21) {
    return (
      <TouchableNativeFeedback
        {...props}
        useForeground={foreground && TouchableNativeFeedback.canUseNativeForeground()}
        background={TouchableNativeFeedback.Ripple(
          rippleColor || 'rgba(0, 0, 0, 0.1)',
          borderless
        )}
      >
        <View style={style}>
          {children}
        </View>
      </TouchableNativeFeedback>
    );
  }

  return (
    <TouchableOpacity style={style} {...props}>
      {children}
    </TouchableOpacity>
  );
}

