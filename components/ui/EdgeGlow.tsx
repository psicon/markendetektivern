// EdgeGlow — sanfter Tier-getinted Vignette-Effekt um die 4 Screen-
// Kanten herum. Wird vom AchievementUnlockBanner mitgemounted und
// synchron ein-/ausgeblendet — celebriert Achievement/Level-Ups
// nicht nur lokal im Banner, sondern lässt den ganzen Screen kurz
// in der Tier-Color "atmen".
//
// Implementation:
//   • 4 LinearGradients (top, bottom, left, right), je vom Rand
//     ins Innere fading. Die ECKEN bekommen Doppel-Coverage (top +
//     left → starke Top-Left-Glow), was den Vignette-Eindruck
//     ergibt ohne dass wir einen echten Radial-Gradient brauchen
//     (RN/expo-linear-gradient supportet nur lineare).
//   • Bottom etwas stärker (0.38 alpha) als top (0.32) weil der
//     Banner dort sitzt und der Glow sich visuell mit ihm verbindet.
//   • Seitenstreifen schlanker (0.22 alpha, 110 px breit) damit
//     der zentrale Content noch sichtbar bleibt — wir wollen einen
//     RAHMEN-Effekt, kein Vollbild-Tint.
//
// Animation (Reanimated 3):
//   • Fade-in: 600 ms ease-out
//   • Fade-out: 400 ms ease-in
// Synchron zum Banner — wenn Banner sichtbar/unsichtbar wird, fadet
// der Glow mit.
//
// pointerEvents='none' — schluckt nie Touches.

import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface EdgeGlowProps {
  visible: boolean;
  /** Hex color string (z.B. '#0d8575' oder '#FF2D55'). */
  tint: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '').trim();
  // Robust gegen 3-stellige Shortcuts (#fff) — expand to 6.
  const expanded =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const num = parseInt(expanded, 16);
  if (Number.isNaN(num)) return `rgba(0,0,0,${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function EdgeGlow({ visible, tint }: EdgeGlowProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: visible ? 600 : 400,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });
  }, [visible, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const topColor = hexToRgba(tint, 0.32);
  const bottomColor = hexToRgba(tint, 0.38);
  const sideColor = hexToRgba(tint, 0.22);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        animatedStyle,
        { zIndex: 9990 },
      ]}
    >
      <LinearGradient
        colors={[topColor, 'transparent']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '24%',
        }}
      />
      <LinearGradient
        colors={['transparent', bottomColor]}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '32%',
        }}
      />
      <LinearGradient
        colors={[sideColor, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: 110,
        }}
      />
      <LinearGradient
        colors={['transparent', sideColor]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: 110,
        }}
      />
    </Animated.View>
  );
}
