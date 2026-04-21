import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect } from 'react';
import {
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

const SWIPE_CLOSE_THRESHOLD = 100; // px dragged down
const SWIPE_CLOSE_VELOCITY = 500; // px/sec

/**
 * Bottom sheet used for filter pickers in Stöbern. Native-feeling swipe-
 * down-to-dismiss via react-native-gesture-handler + reanimated. No
 * "Apply" button — changes are live; dismissing commits whatever is
 * currently selected.
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

  const translateY = useSharedValue(0);

  // Reset the sheet position whenever it opens.
  useEffect(() => {
    if (visible) {
      translateY.value = 0;
    }
  }, [visible, translateY]);

  const panGesture = Gesture.Pan()
    // Only engage once the user has clearly moved vertically — lets taps
    // through, and keeps the inner ScrollView's scroll gesture intact for
    // small swipes.
    .activeOffsetY(10)
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      const shouldClose =
        translateY.value > SWIPE_CLOSE_THRESHOLD || e.velocityY > SWIPE_CLOSE_VELOCITY;
      if (shouldClose) {
        translateY.value = withTiming(600, { duration: 180 });
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* GestureHandlerRootView is required inside Modal because Modal
          creates its own native view hierarchy outside the app root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: theme.overlay,
            justifyContent: 'flex-end',
          }}
        >
          <GestureDetector gesture={panGesture}>
            <Animated.View
              // Stop backdrop press from firing when tapping inside the sheet.
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
              {/* Drag handle — chunky enough to visibly afford the swipe. */}
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
