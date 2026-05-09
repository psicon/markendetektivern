// EdgeGlow — Siri-style fließender Edge-Glow in der Tier-Color.
// Wird vom AchievementUnlockBanner mitgemounted und synchron ein-
// und ausgeblendet.
//
// V3 (post-Feedback): "wie siris modern glow effekt".
//
// Technik:
//   • MaskedView mit einer Edge-Frame-Mask (4 LinearGradients an
//     den Kanten, transparent in der Mitte) — definiert WO der
//     Glow sichtbar ist (= nur am Rand).
//   • Hinter der Mask: ein langsam rotierender LinearGradient mit
//     einem soften Tint-Bar (transparent → tint → transparent).
//     Die Bar wandert beim Rotieren um den Screen → Tint-Color
//     "fließt" sichtbar von Ecke zu Ecke.
//   • Breath-Pulse zusätzlich auf der Container-Opacity damit der
//     Glow nicht starr läuft sondern atmet.
//
// Animationen (alle Reanimated 3, UI-Thread):
//   • Rotation: 360° in 8 s linear, endlos
//   • Breath: 0.85 ↔ 1.0 in 2.8 s sine-ease, endlos
//   • Visibility-Fade: 700 ms in / 500 ms out
//
// pointerEvents='none' überall.

import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
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

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

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
  const visibility = useSharedValue(0);
  const rotation = useSharedValue(0);
  const breath = useSharedValue(0.85);

  useEffect(() => {
    if (visible) {
      visibility.value = withTiming(1, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
      // Endlos rotieren — 8 s pro Umdrehung. Linear damit die
      // Bewegung gleichmäßig fließt, kein Beat.
      rotation.value = withRepeat(
        withTiming(360, { duration: 8000, easing: Easing.linear }),
        -1,
        false,
      );
      // Atem-Pulse zusätzlich auf der Container-Opacity.
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

  // Tint mit verschiedenen Alphas — die "Bar" hat ihre Mitte als
  // hellsten Punkt, fadet zu beiden Seiten weg. Peak bei 0.45 damit
  // der Glow präsent aber nicht erschlagend wirkt.
  const fadeStops: [string, string, string, string, string] = [
    hexToRgba(tint, 0),
    hexToRgba(tint, 0.25),
    hexToRgba(tint, 0.45),
    hexToRgba(tint, 0.25),
    hexToRgba(tint, 0),
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
      <MaskedView
        style={{ flex: 1 }}
        maskElement={
          // Edge-Frame-Mask: schwarz an den Kanten, transparent in
          // der Mitte. Schwarz = sichtbar nach Mask-Anwendung,
          // transparent = unsichtbar. Bottom etwas kleiner damit
          // der Glow weit unter der Banner-Pille endet.
          <View style={{ flex: 1, backgroundColor: 'transparent' }}>
            <LinearGradient
              colors={['black', 'transparent']}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '22%',
              }}
            />
            <LinearGradient
              colors={['transparent', 'black']}
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '16%',
              }}
            />
            <LinearGradient
              colors={['black', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: 100,
              }}
            />
            <LinearGradient
              colors={['transparent', 'black']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                right: 0,
                width: 100,
              }}
            />
          </View>
        }
      >
        {/* Rotierender Gradient-Wrapper. Die View ist deutlich
            GRÖSSER als der Screen damit beim Rotieren keine Ecken
            sichtbar werden. */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: -SCREEN_W * 0.5,
              right: -SCREEN_W * 0.5,
              top: -SCREEN_H * 0.5,
              bottom: -SCREEN_H * 0.5,
            },
            rotatingStyle,
          ]}
        >
          <LinearGradient
            colors={fadeStops}
            locations={[0, 0.3, 0.5, 0.7, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </MaskedView>
    </Animated.View>
  );
}
