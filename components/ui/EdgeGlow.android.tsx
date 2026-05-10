// EdgeGlow.android.tsx — Android-Variante OHNE Skia / MaskedView.
//
// V2: Glow um ALLE 4 Bildschirmkanten (vorher nur Bottom). 4 Edge-
// Gradients (top/bottom/left/right) + 4 Corner-Diagonalen die die
// L-Transitions zwischen den Edges weichzeichnen.
//
// Kein rotierender Sweep, kein Skia, kein MaskedView — nur
// expo-linear-gradient-Stacks. Robust auf Android, kein
// GL-Lifecycle-Hook, kein Surface-Stop-Risiko.

import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface EdgeGlowProps {
  visible: boolean;
  tint: string;
  secondaryTint?: string;
}

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

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const t = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}

function darken(hex: string, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio));
}

// Wie weit der Glow von jeder Kante nach innen reicht (in % der
// jeweiligen Achse). Niedrige Werte = enger Glow direkt an der Kante.
const EDGE_DEPTH_PCT = 12;
// Alpha am stärksten — am Display-Rand. Fadet zu transparent
// nach innen.
const EDGE_ALPHA = 0.32;

export function EdgeGlow({ visible, tint }: EdgeGlowProps) {
  const colorScheme = useColorScheme();
  const isLight = colorScheme !== 'dark';

  const visibility = useSharedValue(0);
  const breath = useSharedValue(0.85);

  useEffect(() => {
    if (visible) {
      visibility.value = withTiming(1, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
      breath.value = withRepeat(
        withSequence(
          withTiming(1.0, {
            duration: 1500,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0.75, {
            duration: 1500,
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
      cancelAnimation(breath);
    }
  }, [visible, visibility, breath]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: visibility.value * breath.value,
  }));

  // Light-Mode: Tier-Color leicht abdunkeln damit Glow gegen weißen Bg
  // sichtbar ist.
  const c = isLight ? darken(tint, 0.18) : tint;
  const edgeStrong = rgba(c, EDGE_ALPHA);
  const edgeFade = rgba(c, 0);

  // Strip-Stärke: 12% von Width für left/right, 12% von Height für
  // top/bottom. Auf einem 1080×2400-Display: ~130 px breite Side-
  // Streifen, ~290 px hohe Top/Bottom-Streifen.
  const sidePct = `${EDGE_DEPTH_PCT}%`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        containerStyle,
        { zIndex: 9990 },
      ]}
    >
      {/* TOP edge — tint oben → transparent unten */}
      <LinearGradient
        colors={[edgeStrong, edgeFade]}
        locations={[0, 1]}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: sidePct,
        }}
      />
      {/* BOTTOM edge — transparent oben → tint unten */}
      <LinearGradient
        colors={[edgeFade, edgeStrong]}
        locations={[0, 1]}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: sidePct,
        }}
      />
      {/* LEFT edge — tint links → transparent rechts */}
      <LinearGradient
        colors={[edgeStrong, edgeFade]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: sidePct,
        }}
      />
      {/* RIGHT edge — transparent links → tint rechts */}
      <LinearGradient
        colors={[edgeFade, edgeStrong]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: sidePct,
        }}
      />
      {/* Die 4 Edges erzeugen an den Ecken eine L-förmige Aufdoppelung
          (Top + Side overlappen). Damit das nicht hart wirkt, blenden
          wir 4 Diagonal-Gradients an den Ecken ein die VON außen nach
          innen fadet — sie weichen die L-Kante visuell auf.
          Alpha hier doppelt so hoch (0.55) damit die Diagonale
          dominanter ist als das Add der zwei senkrechten Edges. */}
      <LinearGradient
        colors={[rgba(c, 0.55), edgeFade]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '40%',
          height: '20%',
        }}
      />
      <LinearGradient
        colors={[rgba(c, 0.55), edgeFade]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '40%',
          height: '20%',
        }}
      />
      <LinearGradient
        colors={[edgeFade, rgba(c, 0.55)]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '40%',
          height: '20%',
        }}
      />
      <LinearGradient
        colors={[edgeFade, rgba(c, 0.55)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '40%',
          height: '20%',
        }}
      />
    </Animated.View>
  );
}
