// components/design/FlyToCart.tsx
//
// Renders one or more concurrent "product image flies into the
// shopping-cart button" animations. Used on detail screens
// (noname-detail, product-comparison) to give cart-add a satisfying,
// tactile feedback even on rapid +/− Pill-Burst.
//
// API
// ──────
//   const flyRef = useRef<FlyToCartHandle>(null);
//
//   <FlyToCart ref={flyRef} />
//
//   // beim "+" Tap:
//   flyRef.current?.fly({
//     sourceX, sourceY, sourceW, sourceH,    // measureInWindow rect
//     imageUri,                              // hero image to clone
//   });
//
// Multiple aufeinanderfolgende fly()-Calls erzeugen mehrere
// gleichzeitig fliegende Klone. Cap bei MAX_CONCURRENT (default 3) —
// neue Aufrufe danach werden bis ein Slot frei wird ignoriert (verhindert
// visuelle Überflutung bei hyper-rapid Taps).

import * as Haptics from 'expo-haptics';
import React, {
  forwardRef,
  useEffect,
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
  /** Pixels added/subtracted from the default anchor. */
  targetXOffset?: number;
  targetYOffset?: number;
  /** Total flight duration in ms (translation). Default 700. */
  duration?: number;
  /** Final scale for the cloned image. Default 0.15 (≈ icon size). */
  endScale?: number;
};

const LARGE_SOURCE_THRESHOLD = 150;
const MAX_CONCURRENT = 3;
const USE_ARC_PATH = true;

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const DEFAULT_TARGET_X = SCREEN_W - 48;

type Flight = {
  id: number;
  sourceX: number;
  sourceY: number;
  sourceW: number;
  sourceH: number;
  imageUri?: string | null;
};

export const FlyToCart = forwardRef<FlyToCartHandle, Props>(function FlyToCart(
  { targetX, targetY, targetXOffset = 0, targetYOffset = 0, duration = 700, endScale = 0.15 },
  ref,
) {
  const insets = useSafeAreaInsets();
  const resolvedTargetX = (targetX ?? DEFAULT_TARGET_X) + targetXOffset;
  const resolvedTargetY = (targetY ?? SCREEN_H - insets.bottom - 48) + targetYOffset;

  const [flights, setFlights] = useState<Flight[]>([]);
  const flightIdSeq = useRef(0);

  const removeFlight = (id: number) => {
    setFlights((prev) => prev.filter((f) => f.id !== id));
  };

  useImperativeHandle(
    ref,
    () => ({
      fly: ({ sourceX, sourceY, sourceW, sourceH, imageUri }) => {
        // Cap auf MAX_CONCURRENT — bei zu vielen parallelen Flights
        // verlieren wir den visuellen Effekt + UI-Thread-Stress.
        // Lieber den "ältesten" droppen + neuen starten (oder neue
        // ignorieren — wir nehmen drop-old für besseres Feedback).
        setFlights((prev) => {
          const next = prev.length >= MAX_CONCURRENT ? prev.slice(1) : prev;
          return [
            ...next,
            {
              id: ++flightIdSeq.current,
              sourceX,
              sourceY,
              sourceW,
              sourceH,
              imageUri,
            },
          ];
        });

        // Tactile "release" — fires the moment the user taps.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      },
    }),
    [],
  );

  return (
    <>
      {flights.map((f) => (
        <FlightInstance
          key={f.id}
          flight={f}
          targetX={resolvedTargetX}
          targetY={resolvedTargetY}
          duration={duration}
          endScale={endScale}
          onComplete={() => removeFlight(f.id)}
        />
      ))}
    </>
  );
});

// ─── FlightInstance ────────────────────────────────────────────────
// Eine einzelne fliegende Bild-Kopie. Hat eigene Reanimated shared
// values + Animated.View, läuft unabhängig von Geschwister-Flights.

type FlightInstanceProps = {
  flight: Flight;
  targetX: number;
  targetY: number;
  duration: number;
  endScale: number;
  onComplete: () => void;
};

function FlightInstance({
  flight,
  targetX,
  targetY,
  duration,
  endScale,
  onComplete,
}: FlightInstanceProps) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const liftAmount = useSharedValue(0);
  const arcProgress = useSharedValue(0);

  const flightStartedRef = useRef(false);
  const onLoadFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fireSuccessHaptic = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
  };

  const startFlight = () => {
    if (flightStartedRef.current) return;
    flightStartedRef.current = true;
    if (onLoadFallbackRef.current) {
      clearTimeout(onLoadFallbackRef.current);
      onLoadFallbackRef.current = null;
    }

    // Compute deltas to land the clone's CENTER on the target.
    const dx = targetX - (flight.sourceX + flight.sourceW / 2);
    const dy = targetY - (flight.sourceY + flight.sourceH / 2);

    const isLarge = Math.max(flight.sourceW, flight.sourceH) > LARGE_SOURCE_THRESHOLD;
    const scaleDur = isLarge ? Math.round(duration * 0.55) : duration;
    const scaleEase = isLarge ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic);
    const fadeEase = isLarge ? Easing.in(Easing.quad) : Easing.in(Easing.cubic);
    const swoop = Easing.bezier(0.55, 0.08, 0.4, 0.97);

    const dist = Math.hypot(dx, dy);
    const arcLift = USE_ARC_PATH ? Math.min(180, Math.max(40, dist * 0.18)) : 0;

    tx.value = withTiming(dx, { duration, easing: swoop });
    ty.value = withTiming(dy, { duration, easing: swoop });

    if (USE_ARC_PATH) {
      liftAmount.value = arcLift;
      arcProgress.value = withTiming(1, { duration, easing: Easing.linear });
    }

    scale.value = withTiming(scaleDur === 0 ? 1 : endScale, {
      duration: scaleDur || 1,
      easing: scaleEase,
    });
    opacity.value = withTiming(0, { duration, easing: fadeEase }, (done) => {
      if (done) {
        runOnJS(fireSuccessHaptic)();
        runOnJS(onComplete)();
      }
    });
  };

  // Fallback-Timer falls onLoad nicht feuert
  useEffect(() => {
    onLoadFallbackRef.current = setTimeout(() => {
      startFlight();
    }, 200);
    return () => {
      if (onLoadFallbackRef.current) {
        clearTimeout(onLoadFallbackRef.current);
        onLoadFallbackRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cloneStyle = useAnimatedStyle(() => {
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

  if (!flight.imageUri) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: flight.sourceX,
          top: flight.sourceY,
          width: flight.sourceW,
          height: flight.sourceH,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: 'transparent',
          zIndex: 999,
          elevation: Platform.OS === 'android' ? 24 : undefined,
        },
        cloneStyle,
      ]}
    >
      <Image
        source={{ uri: flight.imageUri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="contain"
        onLoad={startFlight}
        onError={startFlight}
      />
    </Animated.View>
  );
}
