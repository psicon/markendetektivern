// EdgeGlow.android.tsx — Android-Variante OHNE Skia / MaskedView.
//
// Skia + MaskedView haben TurboModules die in Android's GL-Lifecycle
// hooken und Surface-Stops auslösen (siehe logcat
// `EGLConsumer is not attached to an OpenGL ES context`). Wir bauen
// den Glow stattdessen mit pure `expo-linear-gradient` — ein einziger
// Native-Module-Pfad der robust ist.
//
// Kompromiss: kein rotierender Color-Sweep wie auf iOS, dafür aber
// ein sauberes pulsierendes 2-Farb-Gradient-Glow am unteren
// Bildschirmrand. Tier-Color prominent, Sekundär-Tint als kurzer
// Akzent.
//
// Tech:
//   • 2 LinearGradients stacked: bottom-edge (full Tier-Color) +
//     side-corners (Tier-Color zu transparent)
//   • Reanimated-3 fade-in / fade-out + breath-pulse
//   • pointerEvents='none' überall

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

function lighten(hex: string, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    r + (255 - r) * ratio,
    g + (255 - g) * ratio,
    b + (255 - b) * ratio,
  );
}

function darken(hex: string, ratio: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio));
}

export function EdgeGlow({ visible, tint, secondaryTint }: EdgeGlowProps) {
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
          withTiming(0.7, {
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

  // Im Light-Mode minimal abdunkeln damit der Glow sichtbar ist gegen
  // den weißen Bg.
  const primary = isLight ? darken(tint, 0.18) : tint;
  const rawSecondary = secondaryTint ?? lighten(tint, 0.55);
  const secondary = isLight ? darken(rawSecondary, 0.12) : rawSecondary;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        containerStyle,
        { zIndex: 9990 },
      ]}
    >
      {/* Bottom-Edge — primary tint, fadet nach oben weg.
          Hauptglow-Quelle, ~22 % der Screen-Höhe. */}
      <LinearGradient
        colors={['transparent', rgba(primary, 0.45)]}
        locations={[0, 1]}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '22%',
        }}
      />
      {/* Bottom-Left Corner — secondary tint Diagonal-Glow.
          Erzeugt asymmetrische 2-Farb-Akzentuierung. */}
      <LinearGradient
        colors={['transparent', rgba(secondary, 0.35)]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '60%',
          height: '20%',
        }}
      />
      {/* Bottom-Right Corner — primary tint Diagonal-Glow.
          Spiegelt den Sekundär-Glow auf der gegenüberliegenden Seite. */}
      <LinearGradient
        colors={['transparent', rgba(primary, 0.35)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '60%',
          height: '20%',
        }}
      />
    </Animated.View>
  );
}
