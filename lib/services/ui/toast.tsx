import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { resolveValue, Toast as RNToast, toast, ToastAnimationType, ToastPosition } from '@backpackapp-io/react-native-toast';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type ToastType = 'success' | 'error' | 'info';
type ToastVisualType = 'success' | 'error' | 'info';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const StandardToast: React.FC<{
  message: string;
  type?: ToastVisualType;
  icon?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  spinIcon?: boolean;
  toast?: RNToast;  // Toast props für width/height
}> = ({ message, type = 'success', icon = 'checkmark.circle.fill', actionLabel, onActionPress, spinIcon, toast: toastProps }) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (spinIcon) {
      rotateAnim.setValue(0);
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [spinIcon, rotateAnim]);

  const backgroundColor = type === 'success' ? colors.success : type === 'error' ? '#ff3b30' : colors.primary;
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.toastContainer, { 
      backgroundColor, 
      width:   SCREEN_WIDTH - 24,
      marginHorizontal: 12  // Gleicher Abstand links/rechts
    }]}>      
      <Animated.View style={[styles.iconContainer, spinIcon ? { transform: [{ rotate }] } : undefined]}>        
        <IconSymbol name={icon as any} size={20} color="white" />
      </Animated.View>
      <Text style={styles.toastText} numberOfLines={3}>{message}</Text>
      {actionLabel && onActionPress && (
        <TouchableOpacity style={styles.actionButton} onPress={onActionPress}>
          <Text style={styles.actionButtonText}>{actionLabel}</Text>
          <IconSymbol name="chevron.right" size={14} color="white" />
        </TouchableOpacity>
      )}
    </View>
  );
};

export function showPointsToast(message: string, points: number) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  toast(
    `+${points} Punkte • ${message}`,
    {
      position: ToastPosition.TOP,
      duration: 2500,
      animationType: 'spring' as ToastAnimationType,
      isSwipeable: true,
      disableShadow: false,
      width: SCREEN_WIDTH,
      styles: { view: { backgroundColor: 'transparent' } },
      customToast: (t: RNToast) => (
        <StandardToast
          message={resolveValue(t.message, t) as any}
          type="success"
          icon="plus.circle.fill"
          toast={t}
        />
      ),
    }
  );
}

export function showFavoriteAddedToast(productName: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  toast(`Zu Favoriten hinzugefügt: ${productName}`, {
    position: ToastPosition.TOP,
    duration: 2000,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} type="success" icon="heart.fill" toast={t} />
    ),
  });
}

export function showFavoriteRemovedToast(productName: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  toast(`Aus Favoriten entfernt: ${productName}`, {
    position: ToastPosition.TOP,
    duration: 2000,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} type="info" icon="heart.slash.fill" toast={t} />
    ),
  });
}

export function showCartAddedToast(message: string, onOpenCart?: () => void) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  const msg = (message && message.trim().length > 0) ? message : 'Produkt zum Einkaufszettel hinzugefügt!';
  toast(msg, {
    position: ToastPosition.TOP,
    duration: 4000,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast
        message={resolveValue(t.message, t) as any}
        type="success"
        icon="cart.fill"
        actionLabel="Einkaufszettel"
        onActionPress={onOpenCart}
        toast={t}
       />
    ),
  });
}

export function showInfoToast(message: string, type: ToastType = 'info') {
  const icon = type === 'success' ? 'checkmark.circle.fill' : type === 'error' ? 'xmark.circle.fill' : 'info.circle.fill';
  toast(message, {
    position: ToastPosition.TOP,
    duration: 2000,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} type={type as ToastVisualType} icon={icon} toast={t} />
    ),
  });
}

export function showPurchasedToast(message: string) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  toast(message, {
    position: ToastPosition.TOP,
    duration: 2500,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} type="success" icon="star.fill" spinIcon toast={t} />
    ),
  });
}

const styles = StyleSheet.create({
  toastContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    minHeight: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  iconContainer: {
    marginRight: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: {
    color: 'white',
    fontSize: 15,
    fontFamily: 'Nunito_600SemiBold',
    flex: 1,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginLeft: 12,
    gap: 4,
  },
  actionButtonText: {
    color: 'white',
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
});


