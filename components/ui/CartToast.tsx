import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Easing,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    View
} from 'react-native';

interface CartToastProps {
  visible: boolean;
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  position?: 'top' | 'bottom';
  onHide?: () => void;
}

export const CartToast: React.FC<CartToastProps> = ({
  visible,
  message,
  type = 'success',
  duration = 3000,
  position = 'bottom',
  onHide
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  // Toast animation
  const toastAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Trigger haptic feedback
      if (type === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (type === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      // Show toast with slide animation
      Animated.spring(toastAnimation, {
        toValue: 1,
        useNativeDriver: true,
        speed: 12,
        bounciness: 8,
      }).start();

      // Hide toast after duration
      const timer = setTimeout(() => {
        Animated.timing(toastAnimation, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start(() => {
          onHide?.();
        });
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible, type, onHide, duration]);

  const getBackgroundColor = () => {
    switch (type) {
      case 'success':
        return colors.success;
      case 'error':
        return '#ff3b30';
      case 'info':
      default:
        return colors.primary;
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return 'checkmark.circle.fill';
      case 'error':
        return 'xmark.circle.fill';
      case 'info':
      default:
        return 'info.circle.fill';
    }
  };

  const toastTranslateY = toastAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: position === 'top' ? [-100, 0] : [100, 0],
  });

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.toastWrapper,
        position === 'top' ? { top: 10 } : { bottom: 100 },
        {
          transform: [{ translateY: toastTranslateY }],
          opacity: toastAnimation,
        },
      ]}
      pointerEvents="none"
    >
      <SafeAreaView>
        <View style={[styles.toastContainer, { backgroundColor: getBackgroundColor() }]}>
          <IconSymbol name={getIcon()} size={20} color="white" />
          <Text style={styles.toastText} numberOfLines={2}>{message}</Text>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  toastWrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 999999,
    elevation: 999,
  },
  toastContainer: {
    marginHorizontal: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  toastText: {
    color: 'white',
    fontSize: 15,
    fontFamily: 'Nunito_600SemiBold',
    flex: 1,
    lineHeight: 20,
  },
});