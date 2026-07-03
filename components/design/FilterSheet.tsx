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
import { registerSheetOpen } from '@/lib/services/sheetPresence';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  /** Max height as a fraction of the screen (0-1). Default 0.78. */
  maxHeightRatio?: number;
  /**
   * Beim globalen sheetPresence-Zähler anmelden (Default true). Verhindert,
   * dass eine action-Umfrage ihr Modal über diesem Sheet öffnet (iOS-
   * Doppel-Modal-Freeze, 86ca8g2p9). Die Survey-EIGENE FilterSheet setzt
   * `false`, sonst zählte sie sich selbst.
   */
  registerPresence?: boolean;
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
  registerPresence = true,
}: Props) {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();

  // Mount the Modal as long as we still have an animation to play, even
  // after the parent flipped `visible` to false.
  const [mounted, setMounted] = useState(visible);

  // Globalen Sheet-Zähler pflegen, solange das Modal präsentiert ist —
  // damit eine action-Umfrage nicht ihr Modal darüber öffnet (Freeze).
  useEffect(() => {
    if (!registerPresence || !mounted) return;
    const release = registerSheetOpen();
    return release;
  }, [registerPresence, mounted]);

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
      // Android 3-Button-Nav: ohne navigationBarTranslucent endet das Modal-
      // Fenster ÜBER der System-Leiste, während der Code trotzdem
      // insets.bottom addiert → doppelter Abstand = Whitespace unten
      // (User-Report 2026-07-03). Mit translucent reicht das Fenster unter die
      // Leiste, damit die insets.bottom-Rechnung wieder stimmt.
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Backdrop — TWO layers stacked at absolute-fill:
              1. Animated.View for the visual overlay (opacity fade)
              2. Pressable on top for the tap-to-dismiss behaviour
            Both ABSOLUTE-FILL so the sheet container above isn't
            wrapped by them. THIS IS THE FIX: the previous version
            wrapped the sheet inside the Pressable and used
            `onStartShouldSetResponder={() => true}` to swallow
            touches — which also blocked the ScrollView's native
            scroll gesture. Backdrop and sheet are siblings now;
            the sheet's children (incl. ScrollView) get touches
            uninterrupted. */}
        <Animated.View
          pointerEvents="none"
          style={[
            { ...StyleAbsoluteFill, backgroundColor: theme.overlay },
            backdropStyle,
          ]}
        />
        <Pressable
          onPress={onClose}
          style={StyleAbsoluteFill}
        />

        {/* Sheet container — anchored to the bottom, taps in empty
            area pass through (`pointerEvents="box-none"` on the
            wrapper) to the backdrop Pressable below. The sheet
            itself catches its own touches. */}
        <View
          pointerEvents="box-none"
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Animated.View
            style={[
              sheetStyle,
              {
                backgroundColor: theme.surface,
                borderTopLeftRadius: 22,
                borderTopRightRadius: 22,
                paddingTop: 10,
                paddingBottom: Math.max(32, insets.bottom + 20),
                // No height/maxHeight here — sheet sizes to content.
                // The maxHeight cap lives on the ScrollView below
                // (in pixels) so RN/Yoga reliably bounds it.
              },
            ]}
          >
            {/* Pan gesture only on the chrome (drag handle + title
                row), NOT on the ScrollView. RNGH gestures vs.
                ScrollView native scroll on the same View battle for
                the touch and ScrollView always loses on iOS. */}
            <GestureDetector gesture={panGesture}>
              <View>
                <View
                  style={{
                    width: 44,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: theme.borderStrong,
                    alignSelf: 'center',
                    marginBottom: title ? 14 : 4,
                  }}
                />
                {/* Bei leerem Titel: kompakte Zeile nur mit Close-Button
                    (kein reservierter Titel-Platz → kein White-Space oben). */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: title ? 'space-between' : 'flex-end',
                    paddingHorizontal: 20,
                    marginBottom: title ? 14 : 0,
                  }}
                >
                  {title ? (
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
                  ) : null}
                  <Pressable onPress={onClose} hitSlop={8}>
                    <MaterialCommunityIcons
                      name="close"
                      size={20}
                      color={theme.textMuted}
                    />
                  </Pressable>
                </View>
              </View>
            </GestureDetector>

            {/* `maxHeight` in pixels on the ScrollView itself
                (not the parent) is the trick that makes both
                "size-to-content for short bodies" AND "scroll past
                cap for long bodies" work in one component. */}
            <ScrollView
              style={{
                maxHeight:
                  SCREEN_HEIGHT * maxHeightRatio -
                  (10 + 19 + 50 + Math.max(32, insets.bottom + 20)),
              }}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingBottom: 8,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </Animated.View>
        </View>
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
  /** T16.3: Custom-Element rechts vom Label (vor dem Radio-Circle).
   *  Wird z.B. für Lock-Icons mit Age-Badge-Overlay genutzt. */
  renderTrailing?: (key: T) => React.ReactNode;
  /** T16.4: Zeile dimmen (opacity 0.55). Visueller Hinweis dass die
   *  Option noch nicht aktiv ist (z.B. age-gated Alkohol). Tap bleibt
   *  möglich — Pressable selbst ist nicht disabled. */
  getDimmed?: (key: T) => boolean;
};

export function OptionList<T extends string>({
  value,
  options,
  onChange,
  renderLeading,
  renderTrailing,
  getDimmed,
}: OptionListProps<T>) {
  const { theme, brand } = useTokens();

  return (
    <View>
      {options.map(([k, label], i) => {
        const on = value === k;
        const last = i === options.length - 1;
        const dimmed = getDimmed?.(k) === true;
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
              // T16.4: gedimmte Zeile (locked-by-age) hat reduzierte
              // base-opacity 0.55. Press-Feedback komponiert sich
              // darauf (0.55 × 0.7).
              opacity: pressed ? (dimmed ? 0.4 : 0.7) : (dimmed ? 0.55 : 1),
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
            {renderTrailing ? renderTrailing(k) : null}
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
