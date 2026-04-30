// SpotlightOverlay — die Maske mit dem Loch + Tooltip-Card.
//
// ─── Render-Strategie ────────────────────────────────────────────
//
// Vier dunkle Rechtecke um das Target. Die Mitte bleibt frei → das
// echte UI-Element schimmert hindurch und bleibt tappable. KEIN
// Modal, KEIN SVG-Mask:
//
//   • Modal: würde Hardware-Layer trennen, Taps gehen nicht zur
//     darunterliegenden Screen-View durch — User könnte das Card
//     unter dem Spotlight nicht tappen.
//   • SVG-Mask: smooth abgerundetes Loch wäre nice, aber bringt
//     react-native-svg als Dependency und erschwert das Tap-
//     Through. 4-Rechtecke-Approach ist visuell 95 % so gut
//     (Eckfase fällt nicht auf weil das Target meist abgerundet
//     ist) und schmerzfrei in der Logik.
//
// Wir rendern als `position: absolute`-Layer direkt im Screen-
// Render-Tree. Voraussetzung: Caller mountet uns INNERHALB des
// Screen-Roots.
//
// ─── Position ────────────────────────────────────────────────────
//
// Wenn ein `<CoachmarkScrollProvider>` über uns sitzt, läuft die
// Position über einen Reanimated-Worklet:
//
//     windowY = anchor.layoutY - scrollY.value + scrollViewOffsetY
//
// Der `useAnimatedStyle`-Worklet rechnet das auf jedem Frame neu —
// wenn der User scrollt, wandert das Spotlight smooth mit.
// Scroll-Tracking läuft auf dem UI-Thread, kein JS-Bridge-
// Roundtrip. Auto-Scroll der Tour-Engine schiebt das Spotlight
// automatisch an die richtige Stelle, ohne Timer oder Remeasure.
//
// Wenn KEIN Provider darüber sitzt (Modus B), ist der Anchor in
// absoluten Window-Coords gemessen — wir nehmen sie 1:1 als
// Position. Statisch, keine Scroll-Verfolgung.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { type AnchorRect, subscribeAnchor } from '@/hooks/useCoachmarkAnchor';
import { useCoachmarkScrollContext } from './CoachmarkScrollContext';

// Padding rund um das Target damit der dunkle Ring nicht direkt am
// Element klebt — sonst wirkt's eingequetscht.
const TARGET_PADDING = 8;
// Eck-Radius des Spotlight-Cutouts. Pseudo: wir rendern auf das
// Target eine dünne weiße Border mit border-radius — das macht den
// Eindruck eines abgerundeten Lochs auch wenn unterhalb 4 harte
// Rechtecke liegen.
const SPOTLIGHT_BORDER_RADIUS = 14;
const TOOLTIP_SIDE_MARGIN = 16;
const TOOLTIP_GAP = 14;
// Sweet-Spot für den Backdrop-Tönung — dunkel genug dass das Target
// klar hervorsticht, hell genug dass der Hintergrund noch sichtbar
// bleibt (wirkt weniger bedrohlich).
const BACKDROP_OPACITY = 0.66;

export type SpotlightOverlayProps = {
  visible: boolean;
  anchorId: string;
  title: string;
  body: string;
  // ScrollView-Window-Offset Y — wo die parent ScrollView innerhalb
  // des Window startet. Bei Headern/Chrome darüber > 0. Wir nutzen
  // das nur im Modus mit Scroll-Provider; ohne Provider ist der Wert
  // egal.
  scrollViewWindowOffsetY?: number;
  // Sekundär-Aktion: typischerweise "Überspringen". Wenn weggelassen,
  // wird kein Skip-Button gerendert.
  onSkip?: () => void;
  skipLabel?: string;
  // Primär-Aktion: optional. Bei der Demo-Spotlight-Tour LASSEN wir
  // den weg, damit der natürliche "Weiter" der Tap auf das echte UI-
  // Element ist (das durch's Cutout durchschimmert).
  onPrimary?: () => void;
  primaryLabel?: string;
};

export function SpotlightOverlay({
  visible,
  anchorId,
  title,
  body,
  scrollViewWindowOffsetY = 0,
  onSkip,
  skipLabel = 'Überspringen',
  onPrimary,
  primaryLabel,
}: SpotlightOverlayProps) {
  const { theme, brand, shadows } = useTokens();
  const { height: SCREEN_H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const ctx = useCoachmarkScrollContext();
  const [rect, setRect] = useState<AnchorRect | null>(null);

  useEffect(() => {
    if (!visible) {
      setRect(null);
      return;
    }
    const off = subscribeAnchor(anchorId, setRect);
    return off;
  }, [anchorId, visible]);

  // ─── Auto-Scroll zum Anchor falls off-screen ─────────────────
  //
  // Wenn das Anchor-Element unterhalb des aktuellen Sichtbereichs
  // liegt (z.B. NoName-Carousel auf product-comparison, der erst
  // nach 600+ px Scroll sichtbar wird), würde die Spotlight-
  // Maske ins Leere zeigen — backdrop überall, aber kein Cutout
  // sichtbar. Wir scrollen daher die parent ScrollView
  // programmatisch dahin BEVOR der scroll-lock greift.
  //
  // scrollTo() ist nicht von scrollEnabled=false betroffen
  // (das blockiert nur Gesten), also klappt's auch wenn der
  // Lock-Effect parallel läuft.
  //
  // Layout-Space-Coords required (ohne Provider gibt's keinen
  // sinnvollen Scroll-Target).
  useEffect(() => {
    if (!visible || !rect) return;
    if (rect.space !== 'layout') return;
    const sv = ctx?.scrollViewRef?.current as any;
    if (!sv?.scrollTo) return;

    const currentY = ctx?.scrollY?.value ?? 0;
    // Window-Y des Anchors bei aktuellem Scroll
    const winY = rect.y - currentY + scrollViewWindowOffsetY;
    const VIEW_TOP_BUFFER = 120; // unter Status-Bar + Chrome
    const VIEW_BOTTOM_BUFFER = 220; // über Tab-Bar + Tooltip

    const isOffscreen =
      winY < VIEW_TOP_BUFFER ||
      winY + rect.height + VIEW_BOTTOM_BUFFER > SCREEN_H;
    if (!isOffscreen) return;

    // Ziel: Anchor in obere 25 % des Viewports bringen.
    const targetScroll = Math.max(
      0,
      rect.y - SCREEN_H * 0.25,
    );
    try {
      sv.scrollTo({ y: targetScroll, animated: true });
    } catch (e) {
      console.warn('Spotlight auto-scroll failed (non-fatal):', e);
    }
  }, [visible, rect, ctx, scrollViewWindowOffsetY, SCREEN_H]);

  // ─── Scroll-Lock während Spotlight aktiv ───────────────────
  //
  // Default-Verhalten: Cutout-Bereich des Spotlights lässt Touches
  // durch zur darunterliegenden ScrollView. Bei Pan-Gestures
  // innerhalb des Cutouts kann der User damit die ScrollView
  // scrollen und das Anchor-Target wandert weg — Spotlight zeigt
  // dann ins Leere.
  //
  // Fix: solange der Spotlight sichtbar ist, sperren wir die
  // parent ScrollView via setNativeProps({scrollEnabled: false}).
  // Beim Unmount/Hide entsperrt automatisch.
  //
  // Vorgehen über CoachmarkScrollContext.scrollViewRef. Wenn kein
  // Provider darüber sitzt, machen wir nichts (Caller hat sich
  // dagegen entschieden — vermutlich kein Scroll-Konflikt zu
  // erwarten).
  useEffect(() => {
    if (!visible) return;
    const sv = ctx?.scrollViewRef?.current as any;
    if (!sv?.setNativeProps) return;
    try {
      sv.setNativeProps({ scrollEnabled: false });
    } catch (e) {
      console.warn('Spotlight scroll-lock failed (non-fatal):', e);
    }
    return () => {
      try {
        sv.setNativeProps({ scrollEnabled: true });
      } catch (e) {
        console.warn('Spotlight scroll-unlock failed (non-fatal):', e);
      }
    };
  }, [visible, ctx]);

  // ─── Fade-In für den ganzen Overlay ──────────────────────────
  const fade = useSharedValue(0);
  useEffect(() => {
    fade.value = withTiming(visible ? 1 : 0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, fade]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  // ─── Live-Bounds vom Anchor + ScrollY ──────────────────────────
  //
  // Wir halten die Anchor-Coords als SharedValues (UI-Thread-fähig)
  // und derive'n die Window-Position auf jedem Frame via
  // useDerivedValue. Wenn Scroll-Context vorhanden, fließt scrollY
  // automatisch ein — kein Timer, kein Remeasure.
  const ax = useSharedValue(0);
  const ay = useSharedValue(0);
  const aw = useSharedValue(0);
  const ah = useSharedValue(0);
  // Ob der Anchor in 'layout' (Scroll-aware) oder 'window' (statisch)
  // gemessen ist. Wenn 'window', ignorieren wir scrollY. SharedValue,
  // damit der Worklet drauf zugreifen kann ohne JS-Bridge.
  const isLayoutSpace = useSharedValue(0); // 0 = window, 1 = layout

  useEffect(() => {
    if (!rect) return;
    ax.value = rect.x;
    ay.value = rect.y;
    aw.value = rect.width;
    ah.value = rect.height;
    isLayoutSpace.value = rect.space === 'layout' ? 1 : 0;
  }, [rect, ax, ay, aw, ah, isLayoutSpace]);

  // Window-Y des Anchors. Bei layout-space: layoutY - scrollY +
  // scrollViewOffsetY. Bei window-space: einfach Y.
  const winY = useDerivedValue(() => {
    if (isLayoutSpace.value === 1 && ctx?.scrollY) {
      return ay.value - ctx.scrollY.value + scrollViewWindowOffsetY;
    }
    return ay.value;
  });
  // X gleichermaßen — bei layout-space + horizontal scroll wäre das
  // problematisch, aber unsere Targets liegen innerhalb einer
  // vertikalen ScrollView (innere horizontale Scrolls scrollen
  // nicht beim main-scroll), deshalb addieren wir nur den
  // scrollView X-Offset (= 0 für full-width).
  const winX = useDerivedValue(() => ax.value);

  // ─── Backdrop-Rechtecke ──────────────────────────────────────
  //
  // Top-Rectangle reicht von y=0 bis y=winY-padding. Wenn winY < 0
  // (Anchor offscreen oben) → Höhe 0 (kein top-Rect rendern).
  // Bottom-Rectangle ab y=winY+winH+padding bis Screen-Bottom.
  // Wenn winY+winH > screenH → bottom-Höhe ggf. 0.
  // Left/Right-Rectangles spannen NUR die Y-Höhe des Targets.
  const topRectStyle = useAnimatedStyle(() => ({
    height: Math.max(0, winY.value - TARGET_PADDING),
  }));
  const bottomRectStyle = useAnimatedStyle(() => ({
    top: winY.value + ah.value + TARGET_PADDING,
  }));
  const leftRectStyle = useAnimatedStyle(() => ({
    top: winY.value - TARGET_PADDING,
    height: ah.value + TARGET_PADDING * 2,
    width: Math.max(0, winX.value - TARGET_PADDING),
  }));
  const rightRectStyle = useAnimatedStyle(() => ({
    top: winY.value - TARGET_PADDING,
    height: ah.value + TARGET_PADDING * 2,
    left: winX.value + aw.value + TARGET_PADDING,
  }));

  // Outline um das Spotlight — dünne weiße Border + border-radius.
  // Liegt OBEN auf dem Target, ist NICHT tappable.
  const outlineStyle = useAnimatedStyle(() => ({
    left: winX.value - TARGET_PADDING,
    top: winY.value - TARGET_PADDING,
    width: aw.value + TARGET_PADDING * 2,
    height: ah.value + TARGET_PADDING * 2,
  }));

  // ─── Tooltip-Position ────────────────────────────────────────
  //
  // Berechnet aus dem AKTUELLEN rect (nicht via Worklet — der
  // Tooltip ist eine normale RN-View, weil sein Inhalt komplexer
  // ist als ein animatable layout-prop und wir wollen useState-
  // basiertes Layout-Reasoning).
  //
  // Heuristik: TargetMitte > halbe Screen-Höhe → Tooltip oben,
  // sonst unten. Plus Clamping gegen Status-Bar oben und Tab-Bar
  // unten.
  //
  // Wir derive'n das aus rect.y direkt — das ist OK weil:
  //   • Bei layout-space: rect.y ändert sich nur wenn Layout sich
  //     ändert (data-load), nicht durch Scroll. Tooltip-Position
  //     bleibt also stabil über den Tour-Verlauf.
  //   • Bei window-space: rect.y ist bereits absolute Window-Y.
  //
  // Damit ist der Tooltip ggf. NICHT exakt am Target angeklebt
  // wenn der User scrollt (Spotlight wandert, Tooltip bleibt).
  // Das ist akzeptabel — der Tooltip ist eine Erklärung, das
  // Spotlight ist der Fokus. In Praxis scrollt der User während
  // einer 1-Step-Tour eh nicht.
  const tooltipPosStyle: ViewStyle = useMemo(() => {
    if (!rect) return {};
    // Rough estimate of the spotlight's CURRENT window-y based on
    // the rect's space. For tooltip positioning we want a stable
    // "where will this likely be" — for layout-space anchors we
    // assume scrollY=0 plus scrollViewOffset, which is the post-
    // scroll target position the auto-scroll lands on.
    const estimatedWinY =
      rect.space === 'layout' ? rect.y - 0 + scrollViewWindowOffsetY : rect.y;
    const targetCenterY = estimatedWinY + rect.height / 2;
    const goAbove = targetCenterY > SCREEN_H / 2;
    if (goAbove) {
      const desiredBottom = SCREEN_H - (estimatedWinY - TARGET_PADDING) + TOOLTIP_GAP;
      const minBottom = TOOLTIP_GAP;
      const maxBottom = SCREEN_H - insets.top - 8;
      return { bottom: Math.max(minBottom, Math.min(desiredBottom, maxBottom)) };
    }
    const desiredTop =
      estimatedWinY + rect.height + TARGET_PADDING + TOOLTIP_GAP;
    const minTop = insets.top + 8;
    const maxTop = SCREEN_H - insets.bottom - 88 - 120;
    return { top: Math.max(minTop, Math.min(desiredTop, maxTop)) };
  }, [rect, SCREEN_H, insets.top, insets.bottom, scrollViewWindowOffsetY]);

  if (!visible || !rect) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFillObject, fadeStyle, { zIndex: 9999 }]}
    >
      {/* TOP — von 0 bis Target.top */}
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.backdrop,
          { top: 0, left: 0, right: 0 },
          topRectStyle,
        ]}
      />
      {/* BOTTOM — von Target.bottom bis Screen.bottom */}
      <Animated.View
        pointerEvents="auto"
        style={[
          styles.backdrop,
          { left: 0, right: 0, bottom: 0 },
          bottomRectStyle,
        ]}
      />
      {/* LEFT — Streifen links neben dem Target */}
      <Animated.View
        pointerEvents="auto"
        style={[styles.backdrop, { left: 0 }, leftRectStyle]}
      />
      {/* RIGHT — Streifen rechts neben dem Target */}
      <Animated.View
        pointerEvents="auto"
        style={[styles.backdrop, { right: 0 }, rightRectStyle]}
      />

      {/* Spotlight-Outline (dünner Glow um's Target) — pointerEvents
          off, damit Taps durchs Cutout zum echten UI gehen. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            borderRadius: SPOTLIGHT_BORDER_RADIUS,
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.55)',
          },
          outlineStyle,
        ]}
      />

      {/* Tooltip-Card — STATISCHER View, nicht animiert (Position-
          Switching von top↔bottom verträgt sich nicht mit
          useAnimatedStyle, das Reanimated nicht zuverlässig undefiniert
          machen kann; siehe Conversation-Bug-History). maxHeight als
          Sicherheitsnetz. */}
      <View
        pointerEvents="auto"
        style={[
          {
            position: 'absolute',
            left: TOOLTIP_SIDE_MARGIN,
            right: TOOLTIP_SIDE_MARGIN,
            backgroundColor: theme.surface,
            borderRadius: 18,
            paddingHorizontal: 18,
            paddingVertical: 16,
            maxHeight: SCREEN_H * 0.4,
          },
          shadows.lg,
          tooltipPosStyle,
        ]}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 17,
            letterSpacing: -0.2,
            color: theme.text,
            marginBottom: 6,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            lineHeight: 19,
            color: theme.textMuted,
          }}
        >
          {body}
        </Text>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 8,
            marginTop: 14,
          }}
        >
          {onSkip ? (
            <Pressable
              onPress={onSkip}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={skipLabel}
              style={({ pressed }) => ({
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 12,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 13,
                  color: theme.textMuted,
                }}
              >
                {skipLabel}
              </Text>
            </Pressable>
          ) : null}
          {onPrimary ? (
            <Pressable
              onPress={onPrimary}
              accessibilityRole="button"
              accessibilityLabel={primaryLabel ?? 'Weiter'}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 12,
                backgroundColor: brand.primary,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 13,
                  letterSpacing: 0.2,
                  color: '#fff',
                }}
              >
                {primaryLabel ?? 'Weiter'}
              </Text>
              <MaterialCommunityIcons
                name="arrow-right"
                size={14}
                color="#fff"
              />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    backgroundColor: `rgba(0,0,0,${BACKDROP_OPACITY})`,
  },
});
