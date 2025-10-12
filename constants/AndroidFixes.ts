import React from 'react';
import { Platform, TouchableOpacity, ViewStyle } from 'react-native';

// Zentrale Android-Fixes für alle UI-Probleme
export const androidFixes = {
  // Modal-Fixes für Bottom Sheets
  modalWrapper: Platform.select({
    ios: {},
    android: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
    }
  }) as ViewStyle,

  modalContent: Platform.select({
    ios: {},
    android: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: 'white',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '90%',
    }
  }) as ViewStyle,

  // Schatten-Fixes
  noShadow: Platform.select({
    ios: {},
    android: {
      elevation: 0,
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
    }
  }) as ViewStyle,

  cardShadow: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    },
    android: {
      elevation: 3,
      backgroundColor: 'white', // WICHTIG: Solide Farbe für elevation
    }
  }) as ViewStyle,

  // Button-Fixes
  buttonBase: Platform.select({
    ios: {},
    android: {
      overflow: 'visible', // Kein Clipping
      backgroundColor: 'white', // Solide Farbe
    }
  }) as ViewStyle,

  // Scanner-Fixes
  scannerFullscreen: Platform.select({
    ios: {
      flex: 1,
    },
    android: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }
  }) as ViewStyle,

  // Icon-Container ohne Schatten-Probleme
  iconContainer: Platform.select({
    ios: {},
    android: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    }
  }) as ViewStyle,
};

// Helper für Modal-Wrapper
export const wrapModalForAndroid = (content: React.ReactNode, onClose: () => void) => {
  if (Platform.OS === 'ios') return content;
  
  return (
    <TouchableOpacity 
      activeOpacity={1} 
      style={androidFixes.modalWrapper}
      onPress={onClose}
    >
      <TouchableOpacity activeOpacity={1} style={androidFixes.modalContent}>
        {content}
      </TouchableOpacity>
    </TouchableOpacity>
  );
};