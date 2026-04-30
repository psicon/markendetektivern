import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, ViewStyle, LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

// ─── Crossfade — pairs a skeleton with the live content. Both
//     layers occupy the same slot; opacity is driven by a SINGLE
//     shared value `t` that transitions 0 → 1 when `ready` flips
//     true. Skeleton opacity = 1 - t, content opacity = t — the
//     two layers sum to 1 at every frame, so perceived brightness
//     is constant (no "muddy double-image" or "blank gap" frame
//     during the transition).
//
//     For "no pop": the skeleton placeholder elements must match
//     the live content's SHAPE (same hero height, same chip pill
//     dimensions and position, same price-pill rounded rectangle).
//     When the content is shape-equivalent to the skeleton, the
//     crossfade reads as "details fill in", not "thing morphs".
//
//     Optional `delay` lets you stagger sections (e.g. hero 0 ms,
//     bottom 150 ms). Keep delays SMALL (≤200 ms); larger delays
//     make sequential reveals look like separate pops. ───

type CrossfadeProps = {
  ready: boolean;
  /** Delay (ms) before the fade starts after `ready` flips true. */
  delay?: number;
  /** Total duration in ms. Default 320. */
  duration?: number;
  /** Skeleton placeholder rendered while not ready. */
  skeleton: React.ReactNode;
  /** Live content. */
  children: React.ReactNode;
  /** Optional wrapper style — applied to BOTH layers. */
  style?: ViewStyle;
  /**
   * When true, BOTH layers fill the parent (absoluteFill) so a
   * `flex: 1` content (PagerView, ScrollView, FlatList, …) can
   * actually claim its space. Use when the parent has explicit
   * dimensions and the children need them propagated.
   *
   * Default false: content sits in normal flow and determines
   * the wrapper's height (correct for inline crossfades and
   * fixed-height blocks like the 240 px hero card).
   */
  fillParent?: boolean;
};

export function Crossfade({
  ready,
  delay = 0,
  duration = 320,
  skeleton,
  children,
  style,
  fillParent = false,
}: CrossfadeProps) {
  const t = useSharedValue(0); // 0 = skeleton visible, 1 = content visible

  // Once the fade-in completes we UNMOUNT the skeleton entirely. It's
  // been at opacity 0 for a while at that point, so visually nothing
  // changes — but every Shimmer inside it stops its `withRepeat` loop,
  // which frees the UI thread to drive scroll animations smoothly. Without
  // this, dozens of Shimmer worklets keep computing `interpolate` +
  // writing transforms to invisible LinearGradients on every frame, which
  // is the root of the scroll jank on detail pages.
  //
  // If `ready` flips back to false (e.g. data refresh), we remount the
  // skeleton and restart the fade.
  const [skeletonMounted, setSkeletonMounted] = useState(true);

  useEffect(() => {
    if (ready) {
      t.value = withDelay(
        delay,
        withTiming(
          1,
          { duration, easing: Easing.out(Easing.cubic) },
          (finished) => {
            // `finished` is false if the animation got interrupted
            // (ready went back to false mid-fade). Only unmount when
            // the fade actually completed.
            if (finished) {
              runOnJS(setSkeletonMounted)(false);
            }
          },
        ),
      );
    } else {
      t.value = 0;
      setSkeletonMounted(true);
    }
  }, [ready, delay, duration, t]);

  const skeletonStyle = useAnimatedStyle(() => ({ opacity: 1 - t.value }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: t.value }));

  // fill-parent mode: both content and skeleton are absolutely
  //   positioned to the wrapper's dimensions (which the parent
  //   provides via flex/height). PagerView, ScrollView, etc. with
  //   flex:1 then claim the wrapper's space correctly.
  // flow mode (default): content sits in flow → its intrinsic
  //   height drives the wrapper height; skeleton overlays
  //   absolutely matching that height. Used for inline swaps and
  //   fixed-height blocks.
  if (fillParent) {
    return (
      <View style={style}>
        <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
          {children}
        </Animated.View>
        {skeletonMounted ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, skeletonStyle]}
          >
            {skeleton}
          </Animated.View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={style}>
      <Animated.View style={contentStyle}>{children}</Animated.View>
      {skeletonMounted ? (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
            skeletonStyle,
          ]}
        >
          {skeleton}
        </Animated.View>
      ) : null}
    </View>
  );
}

// ─── FadeIn — simpler variant for sections that have no skeleton
//     placeholder (just empty space until data, then fade in).
//     Used as a top-to-bottom stagger primitive on screens that
//     have all the data after a single fetch. ───

type FadeInProps = {
  visible: boolean;
  /** Delay (ms) after `visible` flips true before the fade starts. */
  delay?: number;
  /** Duration in ms. Default 280. */
  duration?: number;
  children: React.ReactNode;
  style?: ViewStyle;
};

export function FadeIn({
  visible,
  delay = 0,
  duration = 280,
  children,
  style,
}: FadeInProps) {
  const o = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      o.value = withDelay(
        delay,
        withTiming(1, { duration, easing: Easing.out(Easing.cubic) }),
      );
    } else {
      o.value = 0;
    }
  }, [visible, delay, duration, o]);
  const animStyle = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[animStyle, style]}>{children}</Animated.View>;
}

// ─── Shimmer — Instagram/Facebook-style skeleton block.
//
//     A flat neutral-gray base with a brighter highlight gradient
//     that sweeps from left-edge → right-edge over 1.5 s, then
//     loops. The classic "chrome reflection on metal" look you see
//     on Instagram Stories, Facebook feed, LinkedIn cards.
//
//     Implementation: the outer View is the base color (theme.
//     shimmer1). An absolutely-positioned LinearGradient overlay
//     spans 2× the parent width and translates from -width/2 to
//     +width/2 — that way the highlight starts off-screen left,
//     sweeps fully across, and exits off-screen right. The
//     gradient is transparent → light → transparent, so it adds
//     a soft moving sheen without obscuring the base.
//
//     Width is measured via `onLayout` because we need the actual
//     pixel width to drive the translateX (percentages don't work
//     on Android transform with Reanimated). ───

type BlockProps = {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: ViewStyle;
};

const SHIMMER_DURATION_MS = 1500;
// Pause between sweeps so the eye gets a beat to rest — feels less
// like a strobe and more like Instagram's gentle pulse.
const SHIMMER_PAUSE_MS = 600;

export function Shimmer({
  width = '100%',
  height = 12,
  radius = 4,
  style,
}: BlockProps) {
  const { theme } = useTokens();
  const t = useSharedValue(0);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  useEffect(() => {
    // 0 → 1 over SHIMMER_DURATION_MS, then hold at 1 for
    // SHIMMER_PAUSE_MS, then snap back to 0 and repeat.
    t.value = withRepeat(
      withTiming(1, {
        duration: SHIMMER_DURATION_MS + SHIMMER_PAUSE_MS,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
  }, [t]);

  // Sweep range: highlight starts off-screen on the left and
  // exits off-screen on the right. Total travel = 2× width.
  // The sweep is mapped to t ∈ [0, sweepFraction]; values
  // beyond that (in the pause) clamp the highlight out of view.
  const sweepFraction =
    SHIMMER_DURATION_MS / (SHIMMER_DURATION_MS + SHIMMER_PAUSE_MS);

  const sweepStyle = useAnimatedStyle(() => {
    if (measuredWidth === 0) return { opacity: 0 };
    const progress = interpolate(
      t.value,
      [0, sweepFraction, 1],
      [0, 1, 1],
      Extrapolation.CLAMP,
    );
    const translateX = -measuredWidth + progress * (2 * measuredWidth);
    return {
      transform: [{ translateX }],
      opacity: 1,
    };
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w !== measuredWidth) setMeasuredWidth(w);
  };

  return (
    <View
      onLayout={onLayout}
      style={[
        {
          width: width as any,
          height,
          borderRadius: radius,
          backgroundColor: theme.shimmer1,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {measuredWidth > 0 ? (
        <AnimatedLinearGradient
          // Three stops: transparent on the left and right edges,
          // brighter in the middle. `theme.shimmer2` is the
          // existing slightly-lighter token that pairs with
          // `theme.shimmer1` for these placeholders.
          colors={[
            'rgba(255,255,255,0)',
            theme.shimmer2,
            'rgba(255,255,255,0)',
          ]}
          locations={[0.1, 0.5, 0.9]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: measuredWidth,
            },
            sweepStyle,
          ]}
        />
      ) : null}
    </View>
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

// ─── AchievementsSkeleton — matches the Errungenschaften screen body:
//     a 144 px hero card, then two "Section" rows (header + horizontal
//     row of 168×184 cards). Renders INSIDE the existing ScrollView so
//     the DetailHeader chrome stays put — caller is responsible for
//     padding-top equal to `insets.top + DETAIL_HEADER_ROW_HEIGHT`. ───

export function AchievementsSkeleton() {
  const { theme, shadows } = useTokens();

  // Card dims kept in sync with LEVEL_CARD_W/H + ACH_CARD_W/H in
  // app/achievements.tsx (168×184). Hero height matches HERO_HEIGHT.
  const CARD_W = 168;
  const CARD_H = 184;

  const renderRow = (key: string) => (
    <View key={key}>
      {/* Section header (title + subtitle pill). */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingHorizontal: 20,
          marginBottom: 10,
        }}
      >
        <Shimmer width={140} height={20} radius={6} />
        <Shimmer width={60} height={12} radius={4} />
      </View>
      {/* Horizontal card row — non-scrollable in the skeleton; we just
          want the visual rhythm of "row of cards bleeding off-screen
          right" so the user sees what's coming. */}
      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: 20,
          gap: 10,
        }}
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              width: CARD_W,
              height: CARD_H,
              borderRadius: 14,
              padding: 14,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              ...shadows.sm,
            }}
          >
            {/* Top: icon circle + small pill */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <Shimmer width={44} height={44} radius={22} />
              <Shimmer width={48} height={18} radius={6} />
            </View>
            {/* LV / category eyebrow */}
            <Shimmer width={32} height={10} radius={3} style={{ marginBottom: 6 }} />
            {/* Title */}
            <Shimmer width="80%" height={14} radius={4} style={{ marginBottom: 8 }} />
            {/* Description (3 short lines) */}
            <Shimmer width="100%" height={10} radius={3} style={{ marginBottom: 4 }} />
            <Shimmer width="92%" height={10} radius={3} style={{ marginBottom: 4 }} />
            <Shimmer width="60%" height={10} radius={3} />
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View>
      {/* Hero card placeholder — same height as the live LinearGradient
          hero so the page doesn't jump after data loads. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <View
          style={{
            height: 144,
            borderRadius: 18,
            backgroundColor: theme.shimmer1,
          }}
        />
      </View>

      <View style={{ height: 22 }} />
      {renderRow('levels')}
      <View style={{ height: 22 }} />
      {renderRow('achievements')}
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
