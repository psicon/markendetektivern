// EdgeGlow — Siri-style fließender Multi-Color-Halo um den Screen.
// Wird vom AchievementUnlockBanner mitgemounted und synchron ein-
// und ausgeblendet.
//
// V4 (post-Feedback "super hässlich mit kante usw"):
// Komplett neu gebaut mit react-native-svg statt LinearGradient-Mask.
// Apple's Siri-Halo ist ein WEICHER ROUNDED-BORDER mit Multi-Color-
// Gradient. Wir replizieren das mit STACKED SVG-Rects:
//
//   • Drei (oder mehr) konzentrische rounded Rects, alle mit dem
//     gleichen Multi-Color-Gradient als Stroke.
//   • Outer Rect: dickster Stroke, niedrigste Opacity → weiter
//     diffuser "Aura"-Schein.
//   • Inner Rects: dünner, höhere Opacity → schärferer Kern-Glow.
//   • Stack erzeugt einen Soft-Blur-Eindruck OHNE echten Gauss-
//     Filter (der in RN-SVG nicht überall zuverlässig läuft).
//   • Gradient-Stops rotieren kontinuierlich (animierte x1/x2/y1/y2)
//     → Tier-Color "fließt" um den Screen wie bei Siri.
//
// Color-Pairing:
//   • Primary = data.tint (Level/Achievement-Color, prominent).
//   • Secondary = aufgehellter Mix der Primary mit Weiß
//     (~30-40 % weiß-Anteil) → genug Kontrast, aber gleiche Farbfamilie.
//   Beide werden im Gradient als Stops gemixt.
//
// Animationen (Reanimated 3, UI-Thread):
//   • Visibility-Fade: 700 ms in / 500 ms out
//   • Gradient-Sweep: rotate-Angle 0 → 360 in 8 s linear, endlos.
//     Implementiert als animierte Rotation auf einem Wrapper-View
//     (SVG kennt keine direkte Animated-Gradient-Stops in
//     react-native-svg ohne Reanimated-Adapter).
//   • Breath-Pulse: opacity 0.85 ↔ 1.0 in 2.8 s sine, endlos.
//
// pointerEvents='none' überall.

import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

interface EdgeGlowProps {
  visible: boolean;
  /** Hex color string (z.B. '#0d8575' oder '#FF2D55'). */
  tint: string;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '').trim();
  const expanded =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const num = parseInt(expanded, 16);
  if (Number.isNaN(num)) return { r: 0, g: 0, b: 0 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const t = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}

/** Mix tint with white at given ratio (0 = pure tint, 1 = white). */
function lighten(hex: string, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * ratio,
    g + (255 - g) * ratio,
    b + (255 - b) * ratio,
  );
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);
void AnimatedRect; // currently we animate the wrapper, keep ref for future svg-prop animations

export function EdgeGlow({ visible, tint }: EdgeGlowProps) {
  const visibility = useSharedValue(0);
  const rotation = useSharedValue(0);
  const breath = useSharedValue(0.85);

  useEffect(() => {
    if (visible) {
      visibility.value = withTiming(1, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
      rotation.value = withRepeat(
        withTiming(360, { duration: 8000, easing: Easing.linear }),
        -1,
        false,
      );
      breath.value = withRepeat(
        withSequence(
          withTiming(1.0, {
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0.85, {
            duration: 1400,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      );
    } else {
      visibility.value = withTiming(0, {
        duration: 500,
        easing: Easing.in(Easing.cubic),
      });
      cancelAnimation(rotation);
      cancelAnimation(breath);
    }
  }, [visible, visibility, rotation, breath]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: visibility.value * breath.value,
  }));

  const rotatingStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // Color-Stops: tint als prominente Farbe, lightened als
  // Sekundärton mit Kontrast aber im gleichen Farbfamilie. Der
  // Gradient läuft tint → light → tint → light → tint damit beim
  // Rotieren mehrere "bright bands" sichtbar sind.
  const stops = useMemo(() => {
    const primary = tint;
    const secondary = lighten(tint, 0.45);
    return [
      { offset: '0%', color: primary, opacity: '0.95' },
      { offset: '25%', color: secondary, opacity: '0.85' },
      { offset: '50%', color: primary, opacity: '0.95' },
      { offset: '75%', color: secondary, opacity: '0.85' },
      { offset: '100%', color: primary, opacity: '0.95' },
    ];
  }, [tint]);

  // SVG-Frame-Größe: 30 px überall ÜBER den Screen hinaus damit
  // der Stroke die Display-Edge erreicht ohne dass der Inner-Border
  // Lücken hat. Wir geben dem SVG-Wrapper diese Größe und
  // positionieren ihn entsprechend.
  const overflow = 30;
  const svgW = SCREEN_W + overflow * 2;
  const svgH = SCREEN_H + overflow * 2;
  const cornerRadius = 64;

  // Stacked Rects — jede Layer hat eine eigene Stroke-Width + Opacity-
  // Dämpfung. Outer = breit + low opacity (Aura), Inner = schmal +
  // höhere Opacity (Kern).
  const layers = [
    { strokeWidth: 64, opacity: 0.18 },
    { strokeWidth: 40, opacity: 0.32 },
    { strokeWidth: 22, opacity: 0.55 },
    { strokeWidth: 8, opacity: 0.85 },
  ];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        containerStyle,
        { zIndex: 9990 },
      ]}
    >
      {/* Wrapper rotiert — dadurch sieht der Gradient-Stroke aus als
          würde die Color-Bar um den Screen fließen. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: -overflow,
            top: -overflow,
            width: svgW,
            height: svgH,
          },
          rotatingStyle,
        ]}
      >
        <Svg width={svgW} height={svgH}>
          <Defs>
            <LinearGradient id="edgeGlowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              {stops.map((s) => (
                <Stop
                  key={s.offset}
                  offset={s.offset}
                  stopColor={s.color}
                  stopOpacity={s.opacity}
                />
              ))}
            </LinearGradient>
          </Defs>
          {layers.map((layer, idx) => (
            <Rect
              key={idx}
              x={layer.strokeWidth / 2}
              y={layer.strokeWidth / 2}
              width={svgW - layer.strokeWidth}
              height={svgH - layer.strokeWidth}
              rx={cornerRadius}
              ry={cornerRadius}
              fill="none"
              stroke="url(#edgeGlowGrad)"
              strokeWidth={layer.strokeWidth}
              strokeOpacity={layer.opacity}
            />
          ))}
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

