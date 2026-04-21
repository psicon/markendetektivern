import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { DetectiveMark } from './DetectiveMark';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
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

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insetTop,
          backgroundColor: theme.bg,
        },
      ]}
    >
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

        <Pressable
          onPress={onPressScanner}
          style={[styles.iconButton, { backgroundColor: theme.surfaceAlt }]}
        >
          <MaterialCommunityIcons name="barcode-scan" size={18} color={theme.textMuted} />
        </Pressable>

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
