// QuantityPill — schwebender [−  N  +] Steuerpill für Cart-Quantity.
//
// Wird nach einem Cart-Add auf der Produktseite eingeblendet, zeigt die
// aktuelle anzahl + Plus/Minus zum schnellen Anpassen. Schließt sich
// automatisch bei Tap außerhalb / nach Inaktivitäts-Timeout.
//
// Design: kompakte Pill mit weißem Hintergrund + soft shadow, analog
// FilterChip-Look. Buttons sind 32×32, Zahl in der Mitte 38 px breit.
// Reanimated 3 Spring-Pop-Animation beim Mount.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect } from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

interface QuantityPillProps {
  visible: boolean;
  anzahl: number;
  onIncrement: () => void;
  onDecrement: () => void;
  /** Optional Style-Override für Position (absolute placement) */
  style?: ViewStyle;
}

export function QuantityPill({
  visible,
  anzahl,
  onIncrement,
  onDecrement,
  style,
}: QuantityPillProps) {
  const { theme, brand, shadows } = useTokens();
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);
  const translateY = useSharedValue(8);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 140 });
      // Bouncy spring mit Overshoot — Pop-Effect: 0.5 → 1.08 → 1
      scale.value = withSpring(1, {
        damping: 9,
        stiffness: 280,
        mass: 0.6,
        overshootClamping: false,
      });
      translateY.value = withSpring(0, {
        damping: 12,
        stiffness: 300,
        mass: 0.6,
      });
    } else {
      opacity.value = withTiming(0, { duration: 120 });
      scale.value = withTiming(0.8, { duration: 120 });
      translateY.value = withTiming(4, { duration: 120 });
    }
  }, [visible, opacity, scale, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  if (!visible && opacity.value === 0) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.surface,
          borderRadius: 22,
          height: 44,
          paddingHorizontal: 4,
          gap: 2,
          borderWidth: 1,
          borderColor: theme.border,
          ...shadows.md,
        },
        animatedStyle,
        style,
      ]}
    >
      <Pressable
        onPress={onDecrement}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? theme.surfaceAlt : 'transparent',
        })}
      >
        <MaterialCommunityIcons
          name={anzahl <= 1 ? 'trash-can-outline' : 'minus'}
          size={18}
          color={anzahl <= 1 ? '#dc2626' : theme.text}
        />
      </Pressable>

      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 16,
          color: theme.text,
          minWidth: 28,
          textAlign: 'center',
          letterSpacing: -0.2,
        }}
      >
        {anzahl}
      </Text>

      <Pressable
        onPress={onIncrement}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? brand.primaryContainer ?? theme.surfaceAlt : brand.primary,
        })}
      >
        <MaterialCommunityIcons name="plus" size={18} color="#fff" />
      </Pressable>
    </Animated.View>
  );
}

/**
 * Backdrop für QuantityPill. Liegt fullscreen über der Page mit
 * `pointerEvents='auto'` damit Taps außerhalb der Pill gefangen
 * werden + die Pill schließen. Pill selbst hat höheren z-index.
 */
export function QuantityPillBackdrop({
  visible,
  onDismiss,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {visible && (
        <Pressable
          onPress={onDismiss}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      )}
      {children}
    </View>
  );
}
