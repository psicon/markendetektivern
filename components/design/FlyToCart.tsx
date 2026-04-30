// components/design/FlyToCart.tsx
//
// Renders a one-shot "product image flies into the shopping-cart button"
// animation overlay. Used on detail screens (noname-detail,
// product-comparison) to give cart-add a satisfying, tactile feedback.
//
// API
// ──────
//   const flyRef = useRef<FlyToCartHandle>(null);
//
//   <FlyToCart ref={flyRef} />
//
//   // when "add to cart" pressed:
//   flyRef.current?.fly({
//     sourceX, sourceY, sourceW, sourceH,    // measureInWindow rect
//     imageUri,                              // hero image to clone
//   });
//
// Target defaults to the bottom-right area where the
// FloatingShoppingListButton sits (right: 20, bottom: insets.bottom + 20,
// 56×56). Override via `targetX` / `targetY` if the host renders
// the cart button elsewhere.
//
// The clone uses Reanimated 3 worklets — translate + scale + opacity all
// driven on the UI thread. Two haptic pulses fire: a medium impact at
// trigger time (the "release" feel) and a Success notification when the
// clone lands (the "got it" feel). `pointerEvents="none"` so the clone
// never intercepts taps from underlying UI.

import * as Haptics from 'expo-haptics';
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Dimensions, Image, Platform } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type FlyToCartHandle = {
  fly: (params: {
    sourceX: number;
    sourceY: number;
    sourceW: number;
    sourceH: number;
    imageUri?: string | null;
  }) => void;
};

type Props = {
  /** Center X (screen coords) of the cart button. Default: anchored to
   *  the bottom-right of the screen where FloatingShoppingListButton sits. */
  targetX?: number;
  /** Center Y. */
  targetY?: number;
  /** Pixels added/subtracted from the default anchor. Use to nudge if
   *  the host renders the cart button in a non-standard spot. */
  targetXOffset?: number;
  targetYOffset?: number;
  /** Total flight duration in ms (translation). Default 700. */
  duration?: number;
  /** Final scale for the cloned image. Default 0.15 (≈ icon size). */
  endScale?: number;
  /**
   * Override the scale-collapse duration. By default the component
   * picks a value based on the source size:
   *  • large source (max dim > 150 px, e.g. 240 px detail hero):
   *    shrinks fast — ~45% of `duration` with `Easing.out`. Without
   *    this a hero-sized image reads as "huge thing drifting toward
   *    cart" instead of "image flies INTO the cart".
   *  • small source (max dim ≤ 150 px, e.g. alt thumbnails):
   *    shrinks late — full `duration` with `Easing.in`. The size
   *    delta is small enough that an early collapse feels jumpy.
   * Pass an explicit value here to force a specific duration.
   */
  scaleDuration?: number;
};

const LARGE_SOURCE_THRESHOLD = 150;

// ─── Feature flag: arc trajectory ──────────────────────────────────
// `true`  → clone follows a parabolic arc (curves UP then back down,
//            like other shopping apps where the item "throws" itself
//            into the cart). The arc is computed as a sine lift added
//            on top of the existing straight-line tx/ty animation.
// `false` → original straight-line trajectory (slow-start swoop only,
//            no vertical lift).
//
// Flip this single constant to roll back. Everything below is no-op
// when the flag is `false`: `liftSv` stays at 0, `arcProgress` stays
// at 0, and the rendered path collapses back to the straight line
// 1:1 — same easing, same duration, same scale curve.
const USE_ARC_PATH = true;

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

// Floating cart button defaults: right: 20, size 56×56, bottom +20 above
// the safe-area bottom inset. Centered → 48 px from right edge.
const DEFAULT_TARGET_X = SCREEN_W - 48;

export const FlyToCart = forwardRef<FlyToCartHandle, Props>(function FlyToCart(
  {
    targetX,
    targetY,
    targetXOffset = 0,
    targetYOffset = 0,
    duration = 700,
    endScale = 0.15,
    scaleDuration,
  },
  ref,
) {
  const insets = useSafeAreaInsets();
  const resolvedTargetX = (targetX ?? DEFAULT_TARGET_X) + targetXOffset;
  const resolvedTargetY =
    (targetY ?? SCREEN_H - insets.bottom - 48) + targetYOffset;

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  // Arc path: extra vertical lift composed onto `ty`. `liftAmount` is
  // the peak (in px, positive = up); `arcProgress` runs 0→1 in sync
  // with the main flight and the lift is `liftAmount × sin(π × p)`,
  // peaking at midway, returning to zero at start + finish so source
  // and target positions stay exact. Both stay 0 when USE_ARC_PATH
  // is `false` → fully no-op rollback.
  const liftAmount = useSharedValue(0);
  const arcProgress = useSharedValue(0);

  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<{
    sourceX: number;
    sourceY: number;
    sourceW: number;
    sourceH: number;
    imageUri?: string | null;
  } | null>(null);

  // Pending-flight params: computed in fly() but the actual
  // withTiming() calls fire from the Image's onLoad handler. Doing
  // it that way guarantees the clone Image has actually rendered
  // its pixels before the animation starts — no "transparent box
  // shrinks before the picture appears" cold-start.
  const pendingRef = useRef<{
    dx: number;
    dy: number;
    swoop: ReturnType<typeof Easing.bezier>;
    scaleDur: number;
    scaleEase: ReturnType<typeof Easing.cubic>;
    fadeEase: ReturnType<typeof Easing.cubic>;
    arcLift: number;
  } | null>(null);

  // Backup timer in case onLoad never fires (rare, but possible
  // on some Android image-loader paths or when the URL fails). 200 ms
  // is just past the typical mount-to-paint cycle and well below any
  // user-perceivable delay if onLoad does fire normally.
  const onLoadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flightStartedRef = useRef<boolean>(false);

  const fireSuccessHaptic = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  };

  // Single entry point that consumes `pendingRef` and kicks off
  // every withTiming call. Idempotent — guarded by
  // `flightStartedRef` so the onLoad fire AND the fallback timeout
  // can both call it safely; only the first wins.
  const startFlight = () => {
    if (flightStartedRef.current) return;
    const p = pendingRef.current;
    if (!p) return;
    flightStartedRef.current = true;
    if (onLoadFallbackRef.current) {
      clearTimeout(onLoadFallbackRef.current);
      onLoadFallbackRef.current = null;
    }

    tx.value = withTiming(p.dx, { duration, easing: p.swoop });
    ty.value = withTiming(p.dy, { duration, easing: p.swoop });

    // ─── Arc lift ────────────────────────────────────────────
    if (USE_ARC_PATH) {
      liftAmount.value = p.arcLift;
      arcProgress.value = withTiming(1, {
        duration,
        easing: Easing.linear,
      });
    }

    scale.value = withTiming(p.scaleDur === 0 ? 1 : endScale, {
      duration: p.scaleDur || 1,
      easing: p.scaleEase,
    });
    opacity.value = withTiming(
      0,
      { duration, easing: p.fadeEase },
      (done) => {
        if (done) {
          runOnJS(setVisible)(false);
          runOnJS(fireSuccessHaptic)();
        }
      },
    );
  };

  useImperativeHandle(
    ref,
    () => ({
      fly: ({ sourceX, sourceY, sourceW, sourceH, imageUri }) => {
        // Reset shared values + flags BEFORE mounting so the
        // first frame renders at the source position, full size,
        // full opacity. The animations themselves DO NOT start
        // here — they start from the Image's `onLoad` (or the
        // 200 ms fallback timer) once the clone has actually
        // rendered its pixels. That removes every "transparent /
        // white box shrinks before the picture appears" cold-
        // start flash, regardless of which thumb size the user
        // tapped.
        tx.value = 0;
        ty.value = 0;
        scale.value = 1;
        opacity.value = 1;
        liftAmount.value = 0;
        arcProgress.value = 0;
        flightStartedRef.current = false;

        // Compute deltas to land the clone's CENTER on the target.
        const dx = resolvedTargetX - (sourceX + sourceW / 2);
        const dy = resolvedTargetY - (sourceY + sourceH / 2);

        // ─── Size-aware curves ──────────────────────────────────
        // Translation always uses a swooping ease (slow start →
        // fast finish) so the clone "throws itself" toward the
        // cart over the full duration.
        //
        // Scale + opacity behaviour depends on how big the source
        // image is relative to the cart icon:
        //  • LARGE source (e.g. 240 px detail hero) — collapses
        //    early with `Easing.out` over a SHORTER duration so
        //    the clone snaps down to icon size in the first ~half
        //    of the flight, then travels the rest already small.
        //    Without this the hero reads as a giant image
        //    drifting around the screen.
        //  • SMALL source (e.g. 76 px alt thumbnail) — collapses
        //    late with `Easing.in` over the FULL duration. The
        //    size delta is small enough that an early shrink
        //    feels jumpy; a late tuck-in mirrors the cart-icon
        //    "absorbing" the thumbnail.
        const isLarge =
          Math.max(sourceW, sourceH) > LARGE_SOURCE_THRESHOLD;
        const scaleDur = scaleDuration ?? (isLarge
          ? Math.round(duration * 0.55)
          : duration);
        const scaleEase = isLarge ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic);
        const fadeEase = isLarge ? Easing.in(Easing.quad) : Easing.in(Easing.cubic);
        const swoop = Easing.bezier(0.55, 0.08, 0.4, 0.97);

        // Arc lift — 18 % of flight distance, clamped.
        const dist = Math.hypot(dx, dy);
        const arcLift = USE_ARC_PATH
          ? Math.min(180, Math.max(40, dist * 0.18))
          : 0;

        // Stash everything for `startFlight` to consume from
        // either the Image onLoad or the fallback timer.
        pendingRef.current = {
          dx,
          dy,
          swoop,
          scaleDur,
          scaleEase,
          fadeEase,
          arcLift,
        };

        setConfig({ sourceX, sourceY, sourceW, sourceH, imageUri });
        setVisible(true);

        // Tactile "release" — fires the moment the user taps.
        // Independent of when the visual flight starts so the
        // touch always feels acknowledged immediately.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

        // Backup: if onLoad doesn't fire within 200 ms (cached
        // images on some RN versions skip the event, or the URL
        // failed entirely), kick off the flight anyway so the
        // clone never sits frozen at the source.
        if (onLoadFallbackRef.current) {
          clearTimeout(onLoadFallbackRef.current);
        }
        onLoadFallbackRef.current = setTimeout(() => {
          startFlight();
        }, 200);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      resolvedTargetX,
      resolvedTargetY,
      duration,
      scaleDuration,
      endScale,
    ],
  );

  const cloneStyle = useAnimatedStyle(() => {
    // Sine envelope: 0 at start, peak (= liftAmount) at midway,
    // back to 0 at finish. Subtract from `ty` because screen-space
    // up is negative. When USE_ARC_PATH is off, both `liftAmount`
    // and `arcProgress` stay at 0 → lift = 0 → straight line.
    const lift = liftAmount.value * Math.sin(Math.PI * arcProgress.value);
    return {
      opacity: opacity.value,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value - lift },
        { scale: scale.value },
      ],
    };
  });

  if (!visible || !config?.imageUri) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: config.sourceX,
          top: config.sourceY,
          width: config.sourceW,
          height: config.sourceH,
          borderRadius: 16,
          overflow: 'hidden',
          // NO backgroundColor on the clone. The Image inside is a
          // FRESH instance and needs ~1-2 frames to render even if
          // the URL is in cache. Any solid BG (we used to set white
          // here for v6 opaque-white WebPs) shows for those frames
          // as a coloured rectangle that — combined with the running
          // scale animation — reads as "white frame shrinking before
          // the picture appears". Transparent BG instead lets the
          // underlying on-screen image (still rendered at the source
          // position) bleed through during the cold-start frames →
          // user perceives the picture continuously, then sees just
          // the picture flying to the cart.
          //
          // Now that the v8 backfill writes truly transparent WebPs,
          // there's no letterbox stripe to mask either, so removing
          // the white BG has zero visual cost.
          backgroundColor: 'transparent',
          // Above any chrome/floating buttons so the clone visually
          // "lands on top of" the cart button before fading.
          zIndex: 999,
          elevation: Platform.OS === 'android' ? 24 : undefined,
        },
        cloneStyle,
      ]}
    >
      {/* `contain` keeps the FULL product visible during the flight
          — even when the on-screen Image was rendered with `cover`
          (which crops the top/bottom or sides to fill the rect).
          This is what makes the hero animation feel as good as the
          small-thumb one: the user sees the entire packaging
          shrink into the cart, not the cropped slice. */}
      <Image
        source={{ uri: config.imageUri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
        // Critical: the flight only starts AFTER the clone's
        // pixels are on screen. This eliminates the cold-start
        // flash where the animation would otherwise begin while
        // the Image is still loading and the user sees an empty
        // box shrinking instead of the picture flying.
        onLoad={startFlight}
        onError={startFlight}
      />
    </Animated.View>
  );
});
