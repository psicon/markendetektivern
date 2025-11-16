import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, ModalProps, Platform, ScrollView, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface FixedAndroidModalProps extends Omit<ModalProps, 'presentationStyle'> {
  children: React.ReactNode;
  isBottomSheet?: boolean;
}

export default function FixedAndroidModal({ 
  children, 
  visible, 
  onRequestClose, 
  isBottomSheet = true, 
  ...props 
}: FixedAndroidModalProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const bottomSheetRef = useRef<BottomSheet>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Verwende Bottom Sheet für beide Plattformen
  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleKeyboardShow = (event: any) => {
      const height = event?.endCoordinates?.height ?? 0;
      setKeyboardHeight(height);
    };

    const handleKeyboardHide = () => {
      setKeyboardHeight(0);
    };

    const showListener = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideListener = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  useEffect(() => {
    if (keyboardHeight > 0) {
      requestAnimationFrame(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [keyboardHeight]);

  const handleSheetChanges = useCallback((index: number) => {
    if (index === -1 && onRequestClose) {
      // Type assertion für Modal onRequestClose
      (onRequestClose as () => void)();
    }
  }, [onRequestClose]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
      <TouchableWithoutFeedback onPress={() => (onRequestClose as () => void)()}>
        <View style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.5)' }]} />
      </TouchableWithoutFeedback>
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={isBottomSheet ? ['90%'] : ['100%']}
        onChange={handleSheetChanges}
        enablePanDownToClose
        backgroundStyle={{ backgroundColor: colors.background }}
        handleIndicatorStyle={{ backgroundColor: colors.text }}
        style={styles.bottomSheet}
        keyboardBehavior={Platform.OS === 'ios' ? 'interactive' : undefined}
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetScrollView 
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.content, 
            { paddingBottom: insets.bottom + (keyboardHeight > 0 ? keyboardHeight + 24 : 0) }
          ]}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomSheet: {
    zIndex: 999,
  },
  content: {
    flexGrow: 1,
  },
});