import React from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

interface KeyboardAwareWrapperProps {
  children: React.ReactNode;
  offset?: number;
}

export const KeyboardAwareWrapper: React.FC<KeyboardAwareWrapperProps> = ({ 
  children, 
  offset = 0 
}) => {
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={offset}
    >
      {children}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});





