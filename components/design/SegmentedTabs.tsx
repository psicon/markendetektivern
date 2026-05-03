import React, { useEffect, useState } from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Tab<T extends string> = {
  key: T;
  label: string;
};

type Props<T extends string> = {
  tabs: readonly Tab<T>[];
  value: T;
  onChange: (key: T) => void;
  style?: ViewStyle;
};

const CONTAINER_PADDING = 3;
const SEGMENT_GAP = 3;
const HEIGHT = 40;
const SEGMENT_HEIGHT = 34;

/**
 * Pill-style segmented tabs with a single absolute "active" pill that
 * slides between segments via a Reanimated spring. The text labels
 * stay in their static columns and only swap colour on activation —
 * this gives the expected iOS feel where the active background glides
 * underneath the labels rather than each segment toggling its own
 * background instantly.
 *
 * All animation runs on the UI thread (useSharedValue +
 * useAnimatedStyle), so it stays smooth on Android too.
 */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  style,
}: Props<T>) {
  const { theme, shadows } = useTokens();

  // We need the rendered container width to compute segment width
  // (and thereby translateX for the indicator). Captured via onLayout
  // — until we have it, the indicator stays hidden.
  const [containerW, setContainerW] = useState(0);
  const segmentW =
    containerW > 0
      ? (containerW - CONTAINER_PADDING * 2 - SEGMENT_GAP * (tabs.length - 1)) /
        tabs.length
      : 0;

  const activeIdx = Math.max(
    0,
    tabs.findIndex((t) => t.key === value),
  );
  const offsetX = useSharedValue(0);

  useEffect(() => {
    if (segmentW <= 0) return;
    const target = activeIdx * (segmentW + SEGMENT_GAP);
    offsetX.value = withSpring(target, {
      damping: 22,
      stiffness: 220,
      mass: 0.7,
    });
  }, [activeIdx, segmentW, offsetX]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }],
  }));

  return (
    <View
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      style={[
        {
          flexDirection: 'row',
          height: HEIGHT,
          borderRadius: HEIGHT / 2,
          backgroundColor: theme.surfaceAlt,
          padding: CONTAINER_PADDING,
          gap: SEGMENT_GAP,
        },
        style,
      ]}
    >
      {/* Sliding active-pill indicator. Sits absolute behind the
          labels so the labels themselves don't have to move. */}
      {segmentW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: CONTAINER_PADDING,
              left: CONTAINER_PADDING,
              width: segmentW,
              height: SEGMENT_HEIGHT,
              borderRadius: SEGMENT_HEIGHT / 2,
              backgroundColor: theme.surface,
              ...shadows.sm,
            },
            indicatorStyle,
          ]}
        />
      ) : null}

      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={({ pressed }) => ({
              flex: 1,
              height: SEGMENT_HEIGHT,
              borderRadius: SEGMENT_HEIGHT / 2,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 13,
                color: on ? theme.primary : theme.textMuted,
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
