import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import React, { useCallback, useEffect, useRef } from 'react';
import { ModalProps, Platform, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';
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

  // Verwende Bottom Sheet für beide Plattformen
  useEffect(() => {
    if (visible) {
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
    }
  }, [visible]);

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
        keyboardBehavior={Platform.OS === 'ios' ? 'interactive' : 'height'}
        android_keyboardInputMode="adjustResize"
      >
        <BottomSheetScrollView 
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom }]}
          showsVerticalScrollIndicator={true}
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