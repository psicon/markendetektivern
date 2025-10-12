import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import React from 'react';
import { Modal, ModalProps, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AndroidSafeModalProps extends ModalProps {
  children: React.ReactNode;
  type?: 'fullscreen' | 'bottomsheet';
}

export function AndroidSafeModal({ 
  children, 
  type = 'bottomsheet',
  ...props 
}: AndroidSafeModalProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Für iOS: Standard Modal-Verhalten
  if (Platform.OS === 'ios') {
    return (
      <Modal
        {...props}
        presentationStyle={props.presentationStyle || 'pageSheet'}
      >
        {children}
      </Modal>
    );
  }

  // Für Android: Spezielle Behandlung
  if (type === 'bottomsheet') {
    return (
      <Modal
        {...props}
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        animationType={props.animationType || 'slide'}
      >
        <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[
            styles.bottomSheetContainer,
            { 
              backgroundColor: colors.background,
              paddingBottom: insets.bottom,
              maxHeight: '90%'
            }
          ]}>
            {children}
          </View>
        </View>
      </Modal>
    );
  }

  // Fullscreen für Android
  return (
    <Modal
      {...props}
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
    >
      <View style={[
        styles.fullscreenContainer,
        { 
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom 
        }
      ]}>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bottomSheetContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
  },
  fullscreenContainer: {
    flex: 1,
  },
});