// EdgeGlow — sanfter Tier-Color-Halo um den Screen.
//
// V5 (post-Feedback "WTF du machst es schlimmer"):
// Komplett zurück zu einer simplen, robusten Technik. Kein SVG mehr,
// kein MaskedView, keine Rotation, keine LinearGradients. Stattdessen:
// nutzen wir was iOS nativ super kann — radial-blur-shadow auf
// einer dünnen rounded-rect Border-Linie.
//
// Mechanik:
//   1. Eine View positioniert minimal AUSSERHALB der Screen-Edge
//      (top: -3, left/right/bottom: -3), mit dünnem Border in der
//      Tier-Color. Die Border-Linie selbst sitzt fast ganz off-screen.
//   2. Riesige shadowRadius (55-60 px) projiziert die Tier-Color
//      als weichen radial-Blur INWÄRTS ins sichtbare Display →
//      pure soft glow ohne Kanten, ohne Mask-Artefakte.
//   3. Eine zweite Layer mit aufgehelltem Sekundärton + kleinerer
//     shadowRadius dient als Inner-Highlight → 2-Farb-Effekt
//      (User-Wunsch).
//   4. Pulse-Animation auf der Container-Opacity (0.7 ↔ 1.0 sine)
//      → atmender Glow, keine Rotation (war Artefakt-Quelle).
//
// shadowRadius funktioniert nativ auf iOS. Android: elevation gibt
// nur Hard-Shadow, der Glow ist dort weniger sichtbar — akzeptiert,
// wir liefern für Android später ggf. eine andere Technik nach.
//
// pointerEvents='none' — schluckt nie Touches.

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

export function EdgeGlow({ visible, tint }: EdgeGlowProps) {
  const visibility = useSharedValue(0);
  const pulse = useSharedValue(0.7);

  useEffect(() => {
    if (visible) {
      visibility.value = withTiming(1, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.0, {
            duration: 1500,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0.65, {
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
      cancelAnimation(pulse);
    }
  }, [visible, visibility, pulse]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: visibility.value * pulse.value,
  }));

  const secondary = lighten(tint, 0.45);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        containerStyle,
        { zIndex: 9990 },
      ]}
    >
      {/* Layer 1: weiter Outer-Halo in der primären Tier-Color.
          Border 3 px sitzt knapp außerhalb der Screen-Edge (-3 px),
          ist also größtenteils off-screen. shadowRadius 60 wirft die
          Color als breiten weichen Blur INWÄRTS — das ist der Glow. */}
      <View
        style={{
          position: 'absolute',
          top: -3,
          left: -3,
          right: -3,
          bottom: -3,
          borderRadius: 56,
          borderWidth: 3,
          borderColor: rgba(tint, 0.92),
          shadowColor: tint,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 1,
          shadowRadius: 60,
        }}
      />
      {/* Layer 2: tighter Inner-Highlight im sekundären (helleren)
          Ton. Position EXAKT an der Screen-Edge (0 px Offset), dünner
          Border, kleinere shadowRadius → schärferer "Saum" gleich am
          Rand, der den 2-Farb-Effekt erzeugt. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 52,
          borderWidth: 1.5,
          borderColor: rgba(secondary, 0.85),
          shadowColor: secondary,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 24,
        }}
      />
    </Animated.View>
  );
}
