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
      // Pop-In: bouncy spring mit overshoot, leicht von unten nach oben
      opacity.value = withTiming(1, { duration: 140 });
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
      // Pop-Out: spiegelbildlich zur Pop-In-Animation. Spring statt
      // linearer Timing damit es gleich verspielt wirkt — kleines
      // Schrumpfen + nach unten gleiten + ausblenden.
      opacity.value = withTiming(0, { duration: 200 });
      scale.value = withSpring(0.5, {
        damping: 12,
        stiffness: 240,
        mass: 0.6,
      });
      translateY.value = withSpring(8, {
        damping: 14,
        stiffness: 260,
        mass: 0.6,
      });
    }
  }, [visible, opacity, scale, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  // Hinweis: bewusst KEIN early-return mehr. Pill bleibt gemountet
  // damit die exit-Animation sauber durchläuft. pointerEvents='none'
  // (s. unten) verhindert Touch-Interaktion wenn nicht visible.

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
          backgroundColor: pressed
            ? anzahl <= 1
              ? '#fee2e2'
              : theme.surfaceAlt
            : 'transparent',
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
          minWidth: 24,
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
