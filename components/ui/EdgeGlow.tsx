// EdgeGlow — sanfter Tier-getinted Vignette-Effekt um die 4 Screen-
// Kanten herum. Wird vom AchievementUnlockBanner mitgemounted und
// synchron ein-/ausgeblendet — celebriert Achievement/Level-Ups
// nicht nur lokal im Banner, sondern lässt den ganzen Screen kurz
// in der Tier-Color "atmen".
//
// V2 (post-Feedback): subtiler, mit Pulsation, garantiert NICHT die
// Banner-Card überlagernd. Der bottom-Streifen ist kurz genug damit
// er weit unter der Banner-Pille endet.
//
// Implementation:
//   • 4 LinearGradients (top, bottom, left, right), je vom Rand
//     ins Innere fading. Ecken bekommen Doppel-Coverage durch das
//     Overlap von vertikalem + horizontalem Gradient → Vignette-
//     Eindruck.
//   • Alphas BEWUSST niedrig (0.18 / 0.20 / 0.12) damit der Glow
//     "atmet" statt zu schreien. Vorher 0.32-0.38 — User hat das
//     als zu prominent empfunden.
//   • Bottom-Höhe nur 16 % — endet bei ~135 px auf einem 850 px
//     Screen, deutlich unterhalb der Banner-Pille (sitzt bei
//     ~200 px from bottom).
//
// Animation (Reanimated 3):
//   • Visibility-Fade: 700 ms ease-out (in) / 500 ms ease-in (out)
//   • Pulse: kontinuierliches Atmen 0.7 → 1.0 → 0.7 mit 2400 ms
//     Cycle, sine-easing → fließendes Pulsieren typisch für Apps
//     (Snapchat-Notify, iOS-Reminders, Discord-Pings).
//   • Final opacity = visibility * pulse.
//
// pointerEvents='none' — schluckt nie Touches.

import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
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
  /** Hex color string (z.B. '#0d8575' oder '#FF2D55'). */
  tint: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '').trim();
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
  // Visibility ist ein 0→1 Faktor der Master-Opacity.
  const visibility = useSharedValue(0);
  // Pulse läuft kontinuierlich zwischen 0.70 und 1.0 — multipliziert
  // mit visibility ergibt das die finale Display-Opacity.
  const pulse = useSharedValue(0.7);

  useEffect(() => {
    if (visible) {
      // Fade-in: weich, ease-out — typisches "schwebt rein"-Feel.
      visibility.value = withTiming(1, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
      // Pulse-Loop starten — sine-ähnliche Wave durch
      // withRepeat(withSequence(...)). 1200 ms hoch, 1200 ms runter
      // = 2400 ms Cycle. Reverse: false damit jeder Step seinen
      // eigenen Easing-Curve hat (ease-in-out an beiden Enden).
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.0, {
            duration: 1200,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0.7, {
            duration: 1200,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      );
    } else {
      // Fade-out: weicher als Entry damit nicht abrupt.
      visibility.value = withTiming(0, {
        duration: 500,
        easing: Easing.in(Easing.cubic),
      });
      // Pulse-Loop sauber abbrechen sonst läuft er dauerhaft auf
      // dem UI-Thread weiter auch wenn EdgeGlow schon unsichtbar ist.
      cancelAnimation(pulse);
    }
  }, [visible, visibility, pulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: visibility.value * pulse.value,
  }));

  // Niedrige Alphas — der Glow soll atmen, nicht schreien.
  const topColor = hexToRgba(tint, 0.18);
  const bottomColor = hexToRgba(tint, 0.2);
  const sideColor = hexToRgba(tint, 0.12);

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
          height: '20%',
        }}
      />
      {/* Bottom NIEDRIGER damit garantiert unterhalb der Banner-Pille:
          16 % von 850 px ≈ 136 px. Banner-Pille sitzt bei ~200 px
          from bottom. → keine Überlappung. */}
      <LinearGradient
        colors={['transparent', bottomColor]}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '16%',
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
          width: 90,
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
          width: 90,
        }}
      />
    </Animated.View>
  );
}
