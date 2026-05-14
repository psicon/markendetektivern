// EdgeGlow — Siri-style fließender Halo um den Screen.
//
// V6 (Skia-basiert, finale Lösung):
// Wir hatten in V1-V5 alle RN-Primitives durchprobiert — LinearGradient-
// Stacks, MaskedView, SVG-Strokes, shadowRadius — und JEDE hat
// charakteristische Artefakte produziert (Kanten, Banding, oder
// platform-incompatibility).
//
// @shopify/react-native-skia ist die richtige Antwort:
//   • Echte BlurMask (Gauss-Blur) auf beliebigen Shapes
//   • Animierte Gradients (LinearGradient/RadialGradient mit
//     Reanimated-Sharedvalues integriert)
//   • Cross-Platform identisch (iOS + Android)
//   • GPU-beschleunigt
//
// Effekt:
//   1. Eine RoundedRect, knapp ausserhalb der Screen-Kante (so dass
//      die Stroke-Outline mostly off-screen sitzt).
//   2. Stroke-Style mit dickem Stroke-Width (~30 px).
//   3. LinearGradient mit 4 Stops (primary → secondary → primary →
//      secondary) — fließende 2-Farb-Welle entlang der Stroke.
//   4. BlurMask 'normal' mit blur-Radius 25 → der Stroke wird zu
//      einem weichen radialen Halo. KEINE Kanten, KEINE Bänder.
//   5. Gradient-Direction rotiert kontinuierlich (8 s/360°) →
//      die Color-Welle wandert um den Screen.
//   6. Atem-Pulse auf der Container-Opacity (0.7 ↔ 1.0 sine).
//
// pointerEvents='none' — schluckt nie Touches.

import {
  BlurMask,
  Canvas,
  LinearGradient,
  RoundedRect,
  vec,
} from '@shopify/react-native-skia';
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, useColorScheme } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface EdgeGlowProps {
  visible: boolean;
  /** Hex color string (z.B. '#0d8575' oder '#FF2D55'). */
  tint: string;
  /** Optionaler zweiter Hex-Color für die Shimmer-Welle. Wenn nicht
   *  gesetzt, wird automatisch eine aufgehellte Variante der primary
   *  generiert. Bei Level-Ups: die Color des VORHERIGEN Levels. */
  secondaryTint?: string;
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
  const t = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}

/** Mix tint with white at given ratio. */
function lighten(hex: string, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * ratio,
    g + (255 - g) * ratio,
    b + (255 - b) * ratio,
  );
}

/** Mix tint with black at given ratio (0 = pure tint, 1 = black). */
function darken(hex: string, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio));
}

// Wieviel die RoundedRect AUSSERHALB des Screens beginnt — so wird
// die Mitte des Strokes ausserhalb des Screens projiziert, nur die
// inner-side des verblurten Strokes ist im sichtbaren Bereich → pure
// Halo, keine sichtbare Border-Linie.
//
// User-Wunsch v6.3: "secondary stärker sichtbar machen, animation
// stärker (schöner umlauf - fließen)". Rotation deutlich schneller
// + Gradient-Pattern verteilt secondary auf 2 Bands statt 1 Peak →
// User sieht ständig Bewegung von beiden Farben.
const OUTSET = 14;
const STROKE_WIDTH = 38;
const BLUR_RADIUS = 18;
const CORNER_R = 58;
const ROTATION_MS = 4500; // war 8000 — fast doppelt so schnell

export function EdgeGlow({ visible, tint, secondaryTint }: EdgeGlowProps) {
  // Light-Mode Adjustment: viele Tier-Colors (gold, hellgrün, etc.)
  // verschwinden auf weißem Hintergrund. Dunkeln im Light-Mode primary
  // + secondary leicht ab → Glow bleibt sichtbar gegen weißen
  // Screen-Bg, ohne im Dark-Mode zu düster zu wirken.
  const colorScheme = useColorScheme();
  const isLight = colorScheme !== 'dark';

  const visibility = useSharedValue(0);
  const angle = useSharedValue(0);
  const breath = useSharedValue(0.85);

  useEffect(() => {
    if (visible) {
      visibility.value = withTiming(1, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
      // Endlos-Rotation des Gradient-Directions → Color-Welle wandert.
      angle.value = withRepeat(
        withTiming(Math.PI * 2, {
          duration: ROTATION_MS,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
      breath.value = withRepeat(
        withSequence(
          withTiming(1.0, {
            duration: 1500,
            easing: Easing.inOut(Easing.sin),
          }),
          // 0.82 statt 0.7 als Minimum — der Glow bleibt im Tal des
          // Atem-Pulses kräftiger sichtbar, weniger "verschwindend".
          withTiming(0.82, {
            duration: 1500,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      );
    } else {
      // Sanftes Ausblenden — Easing.OUT (statt .in) damit der Glow
      // gleichmäßig dimmt statt 80 % lang hell zu bleiben und dann
      // schlagartig zu verschwinden. Plus längere Duration (900 ms
      // statt 500) und kein hartes cancelAnimation auf den breath/
      // angle: die laufen einfach weiter und werden via visibility=0
      // unsichtbar — die nächste useEffect-Iteration räumt sie auf.
      visibility.value = withTiming(0, {
        duration: 900,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [visible, visibility, angle, breath]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: visibility.value * breath.value,
  }));

  // Skia-kompatible derived-values — start- und end-Punkt des Linear-
  // Gradients rotieren um den Screen-Center, so dass die Color-Welle
  // entlang der Stroke wandert. Skia nutzt useDerivedValue für SkValue-
  // Animations.
  const cx = SCREEN_W / 2;
  const cy = SCREEN_H / 2;
  const radius = Math.max(SCREEN_W, SCREEN_H);

  const start = useDerivedValue(() => {
    return vec(
      cx + Math.cos(angle.value) * radius,
      cy + Math.sin(angle.value) * radius,
    );
  });
  const end = useDerivedValue(() => {
    return vec(
      cx - Math.cos(angle.value) * radius,
      cy - Math.sin(angle.value) * radius,
    );
  });

  // 2-Farb-Gradient: primary (Tier-Color, prominent) + secondary
  // (lightened, 45 % weiß-Anteil — gleiche Farbfamilie, genug
  // Kontrast). Stops in alternierender Reihenfolge → 2 sichtbare
  // bright bands die beim Rotieren wandern.
  // Im Light-Mode beide Farben minimal abdunkeln, damit der Glow
  // gegen den weißen Screen-Bg sichtbar bleibt. Dark-Mode lassen
  // wir unverändert (helle Farben strahlen dort schon stark).
  const primary = isLight ? darken(tint, 0.18) : tint;
  // Sekundärton: explizite secondaryTint Prop wenn gesetzt (z.B.
  // Color des vorherigen Levels), sonst aufgehellte primary als
  // Fallback. Bei einer expliziten secondaryTint ist der Kontrast
  // viel höher — chromatischer Color-Shift statt Helligkeits-Shift.
  const rawSecondary = secondaryTint ?? lighten(tint, 0.55);
  const secondary = isLight ? darken(rawSecondary, 0.12) : rawSecondary;

  // Gradient-Stops mit ZWEI Sekundär-Bands statt einem Peak:
  //   primary @ 0%, secondary @ 25%, primary @ 50%, secondary @ 75%,
  //   primary @ 100%. Beim Rotieren laufen 2 Sekundär-Wellen um den
  //   Halo → Sekundärton ist permanent sichtbar (nicht nur als kurzer
  //   Blitz). Primary bleibt trotzdem dominant weil sie 3 Stops hält.
  const colors = [primary, secondary, primary, secondary, primary];
  const positions = [0, 0.25, 0.5, 0.75, 1];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        containerStyle,
        { zIndex: 9990 },
      ]}
    >
      <Canvas style={{ flex: 1 }}>
        <RoundedRect
          x={-OUTSET}
          y={-OUTSET}
          width={SCREEN_W + OUTSET * 2}
          height={SCREEN_H + OUTSET * 2}
          r={CORNER_R}
          style="stroke"
          strokeWidth={STROKE_WIDTH}
        >
          <LinearGradient
            start={start}
            end={end}
            colors={colors}
            positions={positions}
          />
          {/* BlurMask 'normal' verblurt die Stroke-Outline radial.
              Ergebnis: weicher Halo statt scharfe Kontur. */}
          <BlurMask blur={BLUR_RADIUS} style="normal" />
        </RoundedRect>
      </Canvas>
    </Animated.View>
  );
}
