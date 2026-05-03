import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

// Vertical drag from the 1×-state that dismisses the modal. Beyond this
// distance OR `DISMISS_VELOCITY` px/s downward → close.
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 850;

// Single shared timing config so opening, closing, and double-tap moves
// share a tempo. 280 ms feels snappy without losing the "this is a
// modal" hand-off.
const ENTER_TIMING = { duration: 280, easing: Easing.out(Easing.cubic) };
const EXIT_TIMING = { duration: 220, easing: Easing.in(Easing.cubic) };

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

/** Window-coordinate rect of the thumbnail the user tapped, used to
 *  drive a shared-element transition: the image animates FROM this
 *  rect TO the centred fullscreen position on open, and back again on
 *  close. Pass `null` to fall back to a plain scale-fade. */
export type SourceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  visible: boolean;
  uri: string | null | undefined;
  onClose: () => void;
  /** Source rect of the tapped thumbnail in WINDOW coordinates
   *  (use `View.measureInWindow`). When provided, opens with a
   *  hero-style fly-out from the thumb and closes by flying back. */
  sourceRect?: SourceRect | null;
};

/**
 * Fullscreen image-viewer modal with pinch-to-zoom, pan-when-zoomed,
 * double-tap-toggle, swipe-down-dismiss, and a fading dark backdrop.
 *
 * Usage:
 *   const [zoomUri, setZoomUri] = useState<string | null>(null);
 *   <Pressable onPress={() => setZoomUri(getProductImage(p, 'hq'))}>
 *     <Image source={{ uri: thumbUrl }} … />
 *   </Pressable>
 *   <ImageZoomModal
 *     visible={!!zoomUri}
 *     uri={zoomUri}
 *     onClose={() => setZoomUri(null)}
 *   />
 *
 * Always pass the HQ variant (`bildCleanHq`) as `uri` so zoomed-in
 * pixels stay sharp. The thumb itself can keep using the small WebP.
 *
 * Best-practice gestures wired up:
 *   • Pinch              — scale, anchored at gesture focal point.
 *                          Bouncy clamp at MIN/MAX_SCALE.
 *   • Pan (when zoomed)  — drag image around, clamped so the picture
 *                          can't leave the visible viewport.
 *   • Double-tap         — toggle 1× ↔ DOUBLE_TAP_SCALE around the
 *                          tap location. Resets pan offsets at 1×.
 *   • Swipe down (at 1×) — track translateY + opacity for a peel-away
 *                          dismiss; commit via distance OR velocity.
 *   • Tap on backdrop    — dismiss.
 */
export function ImageZoomModal({
  visible,
  uri,
  onClose,
  sourceRect = null,
}: Props) {
  const insets = useSafeAreaInsets();

  // Target rect = full screen. The Image inside uses
  // `resizeMode: contain` so any aspect ratio is preserved
  // automatically. Using full screen as the layout target (not a
  // fixed square) means at progress=0 the modal's container is the
  // EXACT source-rect shape (e.g. 370×240 hero, NOT a square) — no
  // visual mismatch between the on-screen thumb and the modal's
  // first-frame image.
  const targetX = 0;
  const targetY = 0;
  const targetW = SCREEN_W;
  const targetH = SCREEN_H;

  // Source-rect snapshot (captured at open time so close animations
  // always fly back to where the open started, even if the parent
  // rerenders the prop). When sourceRect is null we fall back to
  // a centred small rect so the entry is a soft scale-fade.
  const sourceXSv = useSharedValue(targetX);
  const sourceYSv = useSharedValue(targetY);
  const sourceWSv = useSharedValue(targetW);
  const sourceHSv = useSharedValue(targetH);

  // `mounted` keeps the Modal in the React tree across the close
  // animation so the user actually SEES the fade-out. Pattern matches
  // FilterSheet.
  const [mounted, setMounted] = useState(visible);

  // Open/close progress drives backdrop opacity + entry zoom.
  const progress = useSharedValue(0);

  // Live transform state.
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  // Snapshots taken at gesture begin so deltas accumulate cleanly.
  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);

  // Dismiss-by-flick state for the 1× swipe-down gesture. Tracks the
  // current vertical drag distance so we can fade the backdrop in
  // sympathy with the drag.
  const dismissY = useSharedValue(0);

  // Image-load progress: 0 = still loading (spinner visible, image
  // hidden), 1 = fully loaded (spinner faded out, image visible).
  // Driven by `<Image onLoad>` and reset on every open.
  const imageLoadedT = useSharedValue(0);

  // ─── Lifecycle: mount → animate-in, animate-out → unmount ────────
  // Open: capture entry transform from sourceRect (or fall back to a
  // small scale-fade), then animate `progress` 0 → 1.
  // Close: live gesture transforms snap back to identity so the
  // shared-element flight is straight, then `progress` 1 → 0
  // animates back to the source rect.
  useEffect(() => {
    if (visible) {
      // Capture the SOURCE rect into shared values. The container is
      // then layout-animated (left/top/width/height) from this rect
      // to the fullscreen target rect — guaranteeing pixel-perfect
      // shape match at progress=0 (no white flash, no aspect-mismatch
      // square-on-rectangle artefact that the previous transform-
      // scale entry produced for the 240 px detail hero).
      if (sourceRect) {
        sourceXSv.value = sourceRect.x;
        sourceYSv.value = sourceRect.y;
        sourceWSv.value = sourceRect.width;
        sourceHSv.value = sourceRect.height;
      } else {
        // Fallback: a centred 80 % rect → soft scale-fade entry.
        const w = SCREEN_W * 0.8;
        const h = SCREEN_H * 0.8;
        sourceXSv.value = (SCREEN_W - w) / 2;
        sourceYSv.value = (SCREEN_H - h) / 2;
        sourceWSv.value = w;
        sourceHSv.value = h;
      }
      setMounted(true);
      // Reset every live transform so the next open always starts
      // exactly at the captured entry rect.
      scale.value = 1;
      tx.value = 0;
      ty.value = 0;
      dismissY.value = 0;
      // Reset image-load progress so the spinner shows for the new
      // URI (a stale "loaded" value would skip the spinner the
      // second time around with a different URL).
      imageLoadedT.value = 0;
      progress.value = withTiming(1, ENTER_TIMING);
    } else if (mounted) {
      // Snap any live pinch-zoom / pan back to identity at gesture-
      // friendly speed so the fly-back animation is a straight line
      // from the current visual position to the thumb.
      scale.value = withTiming(1, EXIT_TIMING);
      tx.value = withTiming(0, EXIT_TIMING);
      ty.value = withTiming(0, EXIT_TIMING);
      dismissY.value = withTiming(0, EXIT_TIMING);
      progress.value = withTiming(0, EXIT_TIMING, (finished) => {
        if (finished) {
          runOnJS(setMounted)(false);
        }
      });
    }
    // sourceRect is intentionally NOT in deps — we only re-capture on
    // an actual visibility transition, not on each rect-object change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = () => {
    onClose();
  };

  // ─── Pan-bounds clamp helper (worklet) ───────────────────────────
  // When zoomed, the user shouldn't be able to drag the image off-
  // screen entirely. We clamp tx/ty so the SCALED image always covers
  // the viewport (well, at least up to the point where the zoomed
  // image is bigger than the screen).
  const clampPan = (s: number, x: number, y: number) => {
    'worklet';
    // The image is `resizeMode: 'contain'` inside a square container of
    // edge `min(SCREEN_W, SCREEN_H)`-ish — but for clamping we treat
    // the WHOLE viewport as the bounding box and let the image
    // wander up to (containerSize × (s − 1) / 2) on each axis.
    const maxX = ((SCREEN_W * (s - 1)) / 2);
    const maxY = ((SCREEN_H * (s - 1)) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  // ─── Gestures ────────────────────────────────────────────────────
  // Pinch: scale around the gesture focal point. Reanimated's
  // PinchGestureHandler reports `focalX/Y` relative to the handler;
  // we keep things simple and just multiply scale, letting pan handle
  // re-centering when the fingers lift.
  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(
        MAX_SCALE * 1.15, // small overscroll so the rubber-band feels alive
        Math.max(MIN_SCALE * 0.85, startScale.value * e.scale),
      );
    })
    .onEnd(() => {
      // Snap back into [MIN, MAX] with a soft spring, and if we land
      // at exactly 1× clear pan offsets so the image re-centres.
      const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value));
      scale.value = withSpring(target, { damping: 18, stiffness: 220 });
      if (target <= MIN_SCALE + 0.001) {
        tx.value = withSpring(0, { damping: 20, stiffness: 220 });
        ty.value = withSpring(0, { damping: 20, stiffness: 220 });
      } else {
        const c = clampPan(target, tx.value, ty.value);
        tx.value = withSpring(c.x, { damping: 22, stiffness: 240 });
        ty.value = withSpring(c.y, { damping: 22, stiffness: 240 });
      }
    });

  // Pan does double-duty:
  //   • when scale > 1   — drag the image around (clamped to bounds)
  //   • when scale === 1 — track a downward swipe-to-dismiss
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      if (scale.value > 1.01) {
        tx.value = startTx.value + e.translationX;
        ty.value = startTy.value + e.translationY;
      } else {
        // 1× state — only track downward drag for the dismiss gesture.
        // Horizontal motion is ignored so the user can't "side-pan"
        // the picture into nothing.
        dismissY.value = Math.max(0, e.translationY);
      }
    })
    .onEnd((e) => {
      if (scale.value > 1.01) {
        const c = clampPan(scale.value, tx.value, ty.value);
        tx.value = withSpring(c.x, { damping: 22, stiffness: 240 });
        ty.value = withSpring(c.y, { damping: 22, stiffness: 240 });
      } else {
        const shouldDismiss =
          dismissY.value > DISMISS_DISTANCE ||
          (e.velocityY > DISMISS_VELOCITY && dismissY.value > 24);
        if (shouldDismiss) {
          // Drop dismissY — the lifecycle effect will animate
          // `progress` 1→0, which flies the image back to the
          // source thumb via the shared-element transition. We
          // settle dismissY to 0 so it doesn't compose with the
          // fly-back transform.
          dismissY.value = withTiming(0, EXIT_TIMING);
          runOnJS(close)();
        } else {
          dismissY.value = withSpring(0, { damping: 20, stiffness: 220 });
        }
      }
    });

  // Double-tap toggles between 1× and DOUBLE_TAP_SCALE. Anchored at
  // the tap focal point so the image zooms INTO whatever the user
  // pointed at (best-practice gallery behaviour).
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(220)
    .onEnd((e) => {
      if (scale.value > 1.05) {
        scale.value = withSpring(1, { damping: 18, stiffness: 220 });
        tx.value = withSpring(0, { damping: 20, stiffness: 220 });
        ty.value = withSpring(0, { damping: 20, stiffness: 220 });
      } else {
        scale.value = withSpring(DOUBLE_TAP_SCALE, {
          damping: 18,
          stiffness: 220,
        });
        // Anchor the zoom at the tap point: shift the image so the
        // tap location ends up under the same finger after scaling.
        const cx = SCREEN_W / 2;
        const cy = SCREEN_H / 2;
        const targetTx = (cx - e.x) * (DOUBLE_TAP_SCALE - 1);
        const targetTy = (cy - e.y) * (DOUBLE_TAP_SCALE - 1);
        const c = clampPan(DOUBLE_TAP_SCALE, targetTx, targetTy);
        tx.value = withSpring(c.x, { damping: 22, stiffness: 240 });
        ty.value = withSpring(c.y, { damping: 22, stiffness: 240 });
      }
    });

  // Single tap on the backdrop (NOT on the image) closes the modal.
  // We compose Tap with Exclusivity vs the doubleTap so the single
  // tap waits for the double-tap window first.
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDelay(220)
    .onEnd(() => {
      runOnJS(close)();
    });

  // Composition order matters:
  //   • Pinch + Pan run simultaneously (you can pan WHILE pinching).
  //   • Tap gestures are exclusive: prefer double over single.
  const tapsExclusive = Gesture.Exclusive(doubleTap, singleTap);
  const composed = Gesture.Simultaneous(
    pinch,
    Gesture.Race(pan, tapsExclusive),
  );

  // ─── Animated styles ─────────────────────────────────────────────
  const backdropStyle = useAnimatedStyle(() => {
    // Backdrop opacity tracks BOTH the open/close progress AND the
    // dismiss drag — so dragging the image down also fades the
    // backdrop, creating that "peel away" feel.
    const dismissT = interpolate(
      dismissY.value,
      [0, DISMISS_DISTANCE * 1.4],
      [1, 0.2],
      Extrapolation.CLAMP,
    );
    return { opacity: progress.value * dismissT };
  });

  const imageStyle = useAnimatedStyle(() => {
    // Shared-element transition (layout-based):
    //   • progress=0 → container has source-rect dimensions exactly
    //     (left, top, width, height). The Image inside fills it with
    //     `resizeMode: contain` — matches the on-screen thumb 1:1.
    //   • progress=1 → container fills the screen. Same Image, larger
    //     bounds, same contain-fit → picture grows naturally without
    //     any stretching or aspect-mismatch.
    // Live gesture transforms (scale, tx, ty, dismissY) compose on
    // TOP of the layout — they only kick in once the user pinches
    // or pans, and stay at identity during the open/close animation.
    const left = interpolate(
      progress.value,
      [0, 1],
      [sourceXSv.value, targetX],
    );
    const top = interpolate(
      progress.value,
      [0, 1],
      [sourceYSv.value, targetY],
    );
    const width = interpolate(
      progress.value,
      [0, 1],
      [sourceWSv.value, targetW],
    );
    const height = interpolate(
      progress.value,
      [0, 1],
      [sourceHSv.value, targetH],
    );
    // Swipe-down opacity falloff for the image — softens the exit
    // when the user flicks the picture away.
    const dismissT = interpolate(
      dismissY.value,
      [0, DISMISS_DISTANCE * 1.4],
      [1, 0.6],
      Extrapolation.CLAMP,
    );
    return {
      position: 'absolute',
      left,
      top,
      width,
      height,
      // Multiply by `imageLoadedT` so the picture fades IN once it
      // finishes loading. Until then the slot is invisible — the
      // spinner overlay (rendered above this) tells the user we're
      // working on it instead of showing a blank rectangle.
      opacity: dismissT * imageLoadedT.value,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value + dismissY.value },
        { scale: scale.value },
      ],
    };
  });

  // Spinner overlay — visible while the image is loading. Faded in
  // by the open progress (so it doesn't pop with the modal) and
  // faded OUT by `imageLoadedT` (which jumps to 1 when onLoad fires).
  // Sits at screen centre, NOT inside the animated image rect, so
  // it stays in place while the rect grows around it.
  const spinnerStyle = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - imageLoadedT.value),
  }));

  // ─── Render ──────────────────────────────────────────────────────
  if (!mounted) return null;

  // (containerSize / targetW / targetH already computed up top — they
  //  feed the entry-rect maths and are reused here for layout.)

  return (
    <Modal
      visible={mounted}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={close}
    >
      <StatusBar barStyle="light-content" />
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        {/* Backdrop — full opaque black at peak, fades with progress */}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]}
        />

        {/* Gesture surface covers the whole screen so taps anywhere
            close. The image is absolutely positioned via animated
            left/top/width/height so it morphs from the source rect
            to fullscreen with NO aspect mismatch. */}
        <GestureDetector gesture={composed}>
          <Animated.View style={StyleSheet.absoluteFill}>
            <Animated.View style={imageStyle} pointerEvents="none">
              {uri ? (
                <Image
                  source={{ uri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  // Bump `imageLoadedT` from 0 → 1 so the picture
                  // fades in and the spinner overlay fades out.
                  // `onError` does the same so a broken URL doesn't
                  // strand the user on a permanent spinner.
                  onLoad={() => {
                    imageLoadedT.value = withTiming(1, {
                      duration: 200,
                      easing: Easing.out(Easing.cubic),
                    });
                  }}
                  onError={() => {
                    imageLoadedT.value = withTiming(1, { duration: 120 });
                  }}
                />
              ) : null}
            </Animated.View>
          </Animated.View>
        </GestureDetector>

        {/* Loader — centred spinner that's visible while the image
            is fetching. Sits OUTSIDE the gesture detector + the
            scaling image rect so its position + size stay constant
            while the open animation runs. Fades out the moment
            `onLoad` fires. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.spinnerWrap, spinnerStyle]}
        >
          <ActivityIndicator size="large" color="#ffffff" />
        </Animated.View>

        {/* Close button — outside GestureDetector so a tap on it
            doesn't get intercepted by the pan/zoom layer. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bild schließen"
          onPress={close}
          style={[
            styles.closeBtn,
            { top: insets.top + 8, right: 14 },
          ]}
          hitSlop={10}
        >
          <Animated.View style={[styles.closeInner, backdropStyle]}>
            <MaterialCommunityIcons name="close" size={22} color="#fff" />
          </Animated.View>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  spinnerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeInner: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
