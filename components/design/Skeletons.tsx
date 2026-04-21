import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

// ─── Shimmer block — pulsing low-contrast bar used as the building block
//     for every skeleton in this file. Hooks into theme shimmer tokens. ───

type BlockProps = {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: ViewStyle;
};

export function Shimmer({
  width = '100%',
  height = 12,
  radius = 4,
  style,
}: BlockProps) {
  const { theme } = useTokens();
  const pulse = useSharedValue(0);

  useEffect(() => {
    // Gentle 1.1s pulse between 0.65 → 1 opacity. Using withRepeat + reverse
    // keeps it symmetric without a visible snap at each cycle boundary.
    pulse.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: 0.65 + pulse.value * 0.35,
  }));

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius: radius,
          backgroundColor: theme.shimmer1,
        },
        animStyle,
        style,
      ]}
    />
  );
}

// ─── ProductCardSkeleton — matches the new ProductCard dimensions:
//     162 px image, handelsmarke eyebrow, 2-line title, price row. ───

export function ProductCardSkeleton() {
  const { theme, shadows } = useTokens();
  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: radii.lg,
        overflow: 'hidden',
        ...shadows.sm,
      }}
    >
      <View
        style={{
          width: '100%',
          height: 162,
          backgroundColor: theme.shimmer1,
        }}
      />
      <View style={{ padding: 12, paddingBottom: 14 }}>
        <Shimmer width={72} height={10} style={{ marginBottom: 8 }} />
        <Shimmer height={12} style={{ marginBottom: 6 }} />
        <Shimmer width="70%" height={12} style={{ marginBottom: 10 }} />
        <Shimmer width={80} height={16} />
      </View>
    </View>
  );
}

// ─── ProductDetailSkeleton — matches the comparison/orphan detail layout:
//     sticky header, eyebrow, 26 px title, 240 px hero, carousel, tabs. ───

export function ProductDetailSkeleton() {
  const { theme, shadows } = useTokens();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Header mirrors the real one (spacing + back button area). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 8,
          gap: 8,
        }}
      >
        <Shimmer width={40} height={40} radius={20} />
        <Shimmer width={160} height={18} radius={6} />
      </View>

      {/* Eyebrow + title */}
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <Shimmer width={86} height={10} radius={3} style={{ marginBottom: 8 }} />
        <Shimmer width="85%" height={22} radius={6} style={{ marginBottom: 6 }} />
        <Shimmer width="55%" height={22} radius={6} />
      </View>

      {/* Hero image */}
      <View style={{ paddingHorizontal: 20 }}>
        <View
          style={{
            width: '100%',
            height: 240,
            borderRadius: 20,
            backgroundColor: theme.shimmer1,
          }}
        />
      </View>

      {/* Alternatives heading + carousel placeholder */}
      <View style={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 12 }}>
        <Shimmer width="70%" height={20} radius={6} />
      </View>
      <View style={{ paddingLeft: 20, flexDirection: 'row', gap: 12 }}>
        {[0, 1].map((i) => (
          <View
            key={i}
            style={{
              width: 280,
              backgroundColor: theme.surface,
              borderRadius: 18,
              padding: 12,
              ...shadows.sm,
            }}
          >
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Shimmer width={60} height={60} radius={10} />
              <View style={{ flex: 1, gap: 6 }}>
                <Shimmer width={90} height={10} radius={3} />
                <Shimmer width="100%" height={14} radius={4} />
                <Shimmer width="80%" height={14} radius={4} />
                <Shimmer width={90} height={10} radius={3} />
              </View>
            </View>
            <View
              style={{
                height: 1,
                backgroundColor: theme.border,
                marginVertical: 12,
              }}
            />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
              }}
            >
              <View style={{ gap: 6 }}>
                <Shimmer width={80} height={10} radius={3} />
                <Shimmer width={70} height={20} radius={4} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Shimmer width={48} height={48} radius={14} />
                <Shimmer width={48} height={48} radius={14} />
                <Shimmer width={48} height={48} radius={14} />
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Tabs */}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 24,
          height: 48,
          borderRadius: 999,
          backgroundColor: theme.surfaceAlt,
        }}
      />

      {/* Comparison panel */}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 18,
          backgroundColor: theme.surface,
          borderRadius: 14,
          padding: 16,
          gap: 10,
          ...shadows.sm,
        }}
      >
        <Shimmer height={12} />
        <Shimmer width="95%" height={12} />
        <Shimmer width="85%" height={12} />
        <Shimmer width="60%" height={12} />
      </View>
    </View>
  );
}
