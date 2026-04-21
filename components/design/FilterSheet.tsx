import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  /** Max height as a fraction of the screen (0-1). Default 0.78. */
  maxHeightRatio?: number;
};

const SWIPE_CLOSE_THRESHOLD = 100;
const SWIPE_CLOSE_VELOCITY = 500;
const SCREEN_HEIGHT = Dimensions.get('window').height;

/**
 * Bottom sheet with a real slide-up entry animation and backdrop fade.
 * Uses Reanimated shared values — no reliance on Modal's stock
 * animationType — and keeps the Modal mounted through the close
 * animation so the slide-out is actually visible.
 */
export function FilterSheet({
  visible,
  title,
  onClose,
  children,
  maxHeightRatio = 0.78,
}: Props) {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();

  // Mount the Modal as long as we still have an animation to play, even
  // after the parent flipped `visible` to false.
  const [mounted, setMounted] = useState(visible);

  // translateY: SCREEN_HEIGHT (off-screen below) → 0 (fully up).
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      // Give the modal a frame to mount before animating.
      requestAnimationFrame(() => {
        translateY.value = withSpring(0, {
          damping: 24,
          stiffness: 220,
          mass: 0.9,
        });
        backdropOpacity.value = withTiming(1, { duration: 220 });
      });
    } else {
      translateY.value = withTiming(SCREEN_HEIGHT, {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(
        0,
        { duration: 220 },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const shouldClose =
        translateY.value > SWIPE_CLOSE_THRESHOLD || e.velocityY > SWIPE_CLOSE_VELOCITY;
      if (shouldClose) {
        // Let the `visible` effect drive the final slide-down + fade —
        // fewer concurrent tweens = smoother finish.
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!mounted) return null;

  return (
    <Modal
      animationType="none"
      transparent
      visible={mounted}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Animated backdrop — fades in/out independently of the sheet. */}
        <Animated.View
          style={[
            {
              ...StyleAbsoluteFill,
              backgroundColor: theme.overlay,
            },
            backdropStyle,
          ]}
        />
        <Pressable
          onPress={onClose}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <GestureDetector gesture={panGesture}>
            <Animated.View
              onStartShouldSetResponder={() => true}
              style={[
                sheetStyle,
                {
                  backgroundColor: theme.surface,
                  borderTopLeftRadius: 22,
                  borderTopRightRadius: 22,
                  paddingTop: 10,
                  paddingBottom: Math.max(32, insets.bottom + 20),
                  maxHeight: `${maxHeightRatio * 100}%` as any,
                },
              ]}
            >
              {/* Drag handle */}
              <View
                style={{
                  width: 44,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: theme.borderStrong,
                  alignSelf: 'center',
                  marginBottom: 14,
                }}
              />

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 20,
                  marginBottom: 14,
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 18,
                    color: theme.text,
                  }}
                >
                  {title}
                </Text>
                <Pressable onPress={onClose} hitSlop={8}>
                  <MaterialCommunityIcons
                    name="close"
                    size={20}
                    color={theme.textMuted}
                  />
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={{ paddingHorizontal: 20 }}
                keyboardShouldPersistTaps="handled"
              >
                {children}
              </ScrollView>
            </Animated.View>
          </GestureDetector>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

// Literal `StyleSheet.absoluteFillObject` is a pain to type inline; this
// const keeps the style blocks tidy.
const StyleAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

// ─── Option list — used inside FilterSheet for radio-style pickers ─────────
type OptionListProps<T extends string> = {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  renderLeading?: (key: T) => React.ReactNode;
};

export function OptionList<T extends string>({
  value,
  options,
  onChange,
  renderLeading,
}: OptionListProps<T>) {
  const { theme, brand } = useTokens();

  return (
    <View>
      {options.map(([k, label], i) => {
        const on = value === k;
        const last = i === options.length - 1;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            style={({ pressed }) => ({
              height: 54,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 4,
              borderBottomWidth: last ? 0 : 1,
              borderBottomColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {renderLeading ? renderLeading(k) : null}
            <Text
              style={{
                flex: 1,
                fontFamily,
                fontWeight: on ? fontWeight.bold : fontWeight.medium,
                fontSize: 15,
                color: on ? brand.primary : theme.text,
              }}
              numberOfLines={1}
            >
              {label}
            </Text>
            {on ? (
              <MaterialCommunityIcons name="check-circle" size={22} color={brand.primary} />
            ) : (
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 1.5,
                  borderColor: theme.borderStrong,
                }}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
