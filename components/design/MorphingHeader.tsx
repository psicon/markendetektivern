import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { DetectiveMark } from './DetectiveMark';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  scrollY: SharedValue<number>;
  insetTop: number;
  placeholder?: string;
  onPressSearch?: () => void;
  onPressScanner?: () => void;
  onPressProfile?: () => void;
};

export const MORPHING_HEADER_ROW_HEIGHT = 56;

/**
 * Scroll-driven morphing header used on Home.
 *  - scroll 0 → logo + title visible, full-width search bar below
 *  - scroll 30–85 → cross-fade into compact search pill
 *  - scroll 85+ → compact search pill visible
 *
 * The header itself is absolutely positioned and sits above scroll content.
 * The full-width search bar below lives in the scroll content and fades out
 * via the same `scrollY` (exposed via `SearchBarBelowHeader`).
 */
export function MorphingHeader({
  scrollY,
  insetTop,
  placeholder = 'Marken oder Produkte suchen…',
  onPressSearch,
  onPressScanner,
  onPressProfile,
}: Props) {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const isIOS = Platform.OS === 'ios';

  const logoStyle = useAnimatedStyle(() => {
    const t = interpolate(scrollY.value, [30, 85], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: 1 - t,
      transform: [
        { translateY: t * -6 },
        { scale: 1 - t * 0.08 },
      ],
    };
  });

  const pillStyle = useAnimatedStyle(() => {
    const t = interpolate(scrollY.value, [30, 85], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * 8 }],
    };
  });

  const shadowStyle = useAnimatedStyle(() => {
    const t = interpolate(scrollY.value, [30, 85], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: t,
    };
  });

  // Scanner button in the header rises up from the direction of the big
  // search bar (which sits below the hero and contains the primary scan
  // icon). Direction matters — coming from BELOW tells the user's eye
  // "this is the scan icon from down there, moved up". Adds a small
  // over-shoot (1.12×) right before settling so the arrival reads as
  // a deliberate pop instead of a fade.
  //   • scrollY  ≤ 30 → hidden (opacity 0, 10 px below, tiny)
  //   • scrollY  ≈ 72 → peak (scale 1.12 — the "landed" moment)
  //   • scrollY  ≥ 95 → settled at rest
  // All interpolation runs on the UI thread via Reanimated, so the pop
  // is frame-perfect on Android too.
  const scannerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [30, 72],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const translateY = interpolate(
      scrollY.value,
      [30, 85],
      [10, 0],
      Extrapolation.CLAMP,
    );
    // Three-key-frame scale: start small, overshoot at the landing
    // moment, settle at 1.
    const scale = interpolate(
      scrollY.value,
      [30, 72, 95],
      [0.6, 1.12, 1],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ translateY }, { scale }] };
  });
  // `pointerEvents` needs to toggle off when invisible so the hidden
  // button doesn't swallow taps meant for whatever is underneath.
  // Driven from the UI thread via useAnimatedReaction so we only pay
  // the JS-bridge hop when the threshold crosses, not on every frame.
  const [scannerInteractive, setScannerInteractive] = React.useState(false);
  useAnimatedReaction(
    () => scrollY.value > 50,
    (active, prev) => {
      if (active !== prev) runOnJS(setScannerInteractive)(active);
    },
  );

  // Same visual treatment as DetailHeader / Stöbern chrome: BlurView on
  // iOS so the status-bar area feels native (Dynamic Island flows into
  // the header material); tinted semi-transparent fallback on Android,
  // where expo-blur quality is poor. Both let content scroll UNDER the
  // header, which is why the outer Home ScrollView pads its top by
  // `insetTop + MORPHING_HEADER_ROW_HEIGHT`.
  const inner = (
    <>
      <View style={styles.row}>
        {/* Morphing slot: logo + title ↔ compact search pill */}
        <View style={styles.morphSlot}>
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.logoWrap, logoStyle]}
            pointerEvents="none"
          >
            <DetectiveMark size={28} color={theme.primary} />
            <Text
              numberOfLines={1}
              style={[styles.title, { color: theme.primary }]}
            >
              MarkenDetektive
            </Text>
          </Animated.View>

          <Animated.View style={[StyleSheet.absoluteFill, pillStyle]}>
            <Pressable
              onPress={onPressSearch}
              style={[
                styles.searchPill,
                { backgroundColor: theme.surfaceAlt },
              ]}
            >
              <MaterialCommunityIcons name="magnify" size={18} color={theme.textMuted} />
              <Text
                numberOfLines={1}
                style={[styles.pillText, { color: theme.textMuted }]}
              >
                {placeholder}
              </Text>
            </Pressable>
          </Animated.View>
        </View>

        <Animated.View
          style={scannerStyle}
          pointerEvents={scannerInteractive ? 'auto' : 'none'}
        >
          <Pressable
            onPress={onPressScanner}
            style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]}
          >
            <MaterialCommunityIcons name="barcode-scan" size={18} color={theme.textMuted} />
          </Pressable>
        </Animated.View>

        <Pressable
          onPress={onPressProfile}
          style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]}
        >
          <MaterialCommunityIcons name="account-outline" size={20} color={theme.textMuted} />
        </Pressable>
      </View>

      {/* Subtle shadow that appears once scrolled past the morph threshold. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.shadowLine,
          shadowStyle,
          {
            backgroundColor: theme.border,
          },
        ]}
      />
    </>
  );

  if (isIOS) {
    return (
      <BlurView
        tint={scheme === 'dark' ? 'dark' : 'light'}
        intensity={80}
        style={[styles.container, { paddingTop: insetTop }]}
      >
        {inner}
      </BlurView>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insetTop,
          backgroundColor:
            scheme === 'dark'
              ? 'rgba(15,18,20,0.92)'
              : 'rgba(245,247,248,0.92)',
        },
      ]}
    >
      {inner}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: MORPHING_HEADER_ROW_HEIGHT,
  },
  morphSlot: {
    flex: 1,
    height: 48,
    position: 'relative',
  },
  logoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontFamily,
    fontWeight: fontWeight.extraBold,
    fontSize: 20,
    letterSpacing: -0.2,
    flexShrink: 1,
    ...Platform.select({
      android: { paddingVertical: 2 },
    }),
  },
  searchPill: {
    flex: 1,
    height: 40,
    borderRadius: radii.full,
    marginVertical: 4,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pillText: {
    flex: 1,
    fontFamily,
    fontWeight: fontWeight.medium,
    fontSize: 14,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  shadowLine: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
});
