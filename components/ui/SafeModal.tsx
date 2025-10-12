import React from 'react';
import { Modal, ModalProps, Platform, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * SafeModal - Wrapper für Modal mit automatischer Safe Area Behandlung
 * Auf iOS: pageSheet mit nativen Safe Areas
 * Auf Android: fullScreen mit manuellem paddingBottom für System-Navigation-Bar
 */

interface SafeModalProps extends ModalProps {
  children: React.ReactNode;
  containerStyle?: ViewStyle;
}

export function SafeModal({ children, containerStyle, ...modalProps }: SafeModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      {...modalProps}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
    >
      <View
        style={[
          { flex: 1 },
          Platform.OS === 'android' && { paddingBottom: insets.bottom },
          containerStyle,
        ]}
      >
        {children}
      </View>
    </Modal>
  );
}

