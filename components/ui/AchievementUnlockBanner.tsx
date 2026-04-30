// AchievementUnlockBanner — kompakter Slide-In-Banner für die
// "subtle"-Tier Celebrations (Achievements UND niedrigschwellige
// Level-Ups, siehe getAchievementTier in gamificationSettingsService
// und die Routing-Logik im GamificationProvider).
//
// ─── Visuelle Sprache ────────────────────────────────────────────
//
//   • Slidet von unten ein, sitzt knapp oberhalb der Tab-Bar
//   • Surface mit soft Shadow + tiefem accent-stripe LINKS
//     (4 px solid in der Tier-Farbe) → unverkennbar als
//     "celebration", auch auf hellem Untergrund
//   • Icon-Circle 44 px mit MaterialCommunityIcon (NICHT Lottie —
//     Lottie an 48 px renderten zu detailarm und wurden auf weiß
//     manchmal kaum sichtbar; ein satter MDI-Icon liest sich
//     immer)
//   • Title (extraBold 14) + Subtitle (medium 12, 2 Zeilen)
//   • Optionale Punkte-Pill rechts ("+5 Pkt" in primary tint)
//   • KEIN ✕-Button — auto-dismiss nach 5 s, swipe-down dismissed,
//     tap auf den Body navigiert (siehe onTap-Prop). Drei Wege
//     reichen, ein viertes Element nimmt visuelle Ruhe weg.
//   • Auto-dismiss-Timer pausiert während Pan-Geste damit der User
//     den Banner mit Geste verzögern kann
//
// ─── Datenmodell ─────────────────────────────────────────────────
//
// Banner ist GENERISCH — er kennt keine Achievement-Datei oder
// Level-Up-Datei direkt. Caller (GamificationProvider) baut eine
// `BannerData` aus seinen Sources zusammen. Das macht den Banner
// für künftige Use-Cases reusable (Streak-Banner, Cashback-Erinnerung
// etc.) ohne Schema-Änderungen.
//
// Mechanik: Reanimated 3 Worklets (UI-thread, kein JS-Bridge-Toll),
// `withSpring` Entry, `withTiming` Exit, Pan-Geste via
// react-native-gesture-handler.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useCallback, useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

// Tab-Bar-Höhe inkl. safe-area. iOS 90 px ist Standard, Android
// 62 + bottom inset. Banner sitzt 12 px drüber.
const TAB_BAR_HEIGHT_IOS = 90;
const TAB_BAR_HEIGHT_ANDROID_BASE = 62;
const HIDDEN_OFFSET = 200;
const AUTO_DISMISS_MS = 5000;

export type BannerData = {
  /** Headline. extraBold, 14 px. */
  title: string;
  /** Sub-Zeile. medium, 12 px, 2 Zeilen max. */
  subtitle: string;
  /** Optionale Punkte für die Pill rechts. Wenn 0/undefined → keine Pill. */
  points?: number;
  /** MDI-Glyph. Beispiele: 'rocket-launch-outline', 'fire',
   *  'trophy-outline', 'cash-multiple', 'medal-outline'. */
  icon: string;
  /** Tier-Farbe — bestimmt den linken Stripe und den Icon-Circle-
   *  Hintergrund. Empfehlung: Achievement.color, Level-Color, oder
   *  brand.primary als Fallback. */
  tint: string;
  /** Optional: Tap aufs Body (z.B. Navigation zur Errungenschaften-
   *  Seite). Wenn weggelassen, ist der Banner nur dismissable. */
  onTap?: () => void;
};

export type AchievementUnlockBannerProps = {
  visible: boolean;
  data: BannerData | null;
  onDismiss: () => void;
};

export function AchievementUnlockBanner({
  visible,
  data,
  onDismiss,
}: AchievementUnlockBannerProps) {
  const { theme, brand, shadows } = useTokens();
  const insets = useSafeAreaInsets();

  const translateY = useSharedValue(HIDDEN_OFFSET);
  const opacity = useSharedValue(0);

  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateOut = useCallback(() => {
    translateY.value = withTiming(HIDDEN_OFFSET, {
      duration: 280,
      easing: Easing.in(Easing.cubic),
    });
    opacity.value = withTiming(
      0,
      { duration: 220, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) {
          runOnJS(onDismiss)();
        }
      },
    );
  }, [translateY, opacity, onDismiss]);

  useEffect(() => {
    if (visible) {
      translateY.value = HIDDEN_OFFSET;
      opacity.value = 0;
      translateY.value = withSpring(0, {
        damping: 20,
        stiffness: 180,
        mass: 0.7,
      });
      opacity.value = withTiming(1, { duration: 220 });
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => {
        animateOut();
      }, AUTO_DISMISS_MS);
    } else {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    }
    return () => {
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [visible, translateY, opacity, animateOut]);

  // Pan-Down zum Dismissen. Threshold 50 px ODER >500 px/s Velocity.
  const panGesture = Gesture.Pan()
    .activeOffsetY([5, 9999])
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const shouldDismiss = e.translationY > 50 || e.velocityY > 500;
      if (shouldDismiss) {
        runOnJS(animateOut)();
      } else {
        translateY.value = withSpring(0, {
          damping: 20,
          stiffness: 200,
        });
      }
    });

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const handleTapBody = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (data?.onTap) {
      // onTap-Caller dismissed im Regelfall mit (siehe Provider-
      // Implementation). Falls nicht: animateOut als Sicherheit.
      data.onTap();
      animateOut();
    } else {
      // Kein Tap-Handler → Tap = Dismiss.
      animateOut();
    }
  }, [data, animateOut]);

  if (!data) return null;

  const tabBarH =
    Platform.OS === 'ios'
      ? TAB_BAR_HEIGHT_IOS
      : TAB_BAR_HEIGHT_ANDROID_BASE + Math.max(0, insets.bottom);
  const bottomOffset = tabBarH + 12;

  return (
    <GestureHandlerRootView
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFillObject, { zIndex: 9998 }]}
    >
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: bottomOffset,
          },
          containerStyle,
        ]}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View>
            <Pressable
              onPress={handleTapBody}
              accessibilityRole="button"
              accessibilityLabel={data.title}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: theme.surface,
                borderRadius: 18,
                // Linker Accent-Stripe wird per leftStripe-Inset
                // realisiert (siehe absolute-View unten). Padding-
                // left muss daher größer sein um nicht überlappt
                // zu werden.
                paddingLeft: 18,
                paddingRight: 14,
                paddingVertical: 12,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.92 : 1,
                overflow: 'hidden',
                ...(shadows.lg as object),
              })}
            >
              {/* Linker Accent-Stripe — solid in der Tier-Farbe.
                  Macht den Banner unverkennbar als Celebration und
                  hebt ihn von gewöhnlichen Toasts ab. */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 4,
                  backgroundColor: data.tint,
                }}
              />

              {/* Icon-Circle — 44×44, satte Tönung in der Tier-
                  Farbe. MaterialCommunityIcon (kein Lottie) damit
                  der Glyph auch an dieser Größe klar liest. */}
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  backgroundColor: data.tint + '26',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons
                  // `as any` weil der Caller den Glyph-Namen als
                  // generischen string liefert; MDI prüft zur
                  // Render-Zeit selbst.
                  name={data.icon as any}
                  size={22}
                  color={data.tint}
                />
              </View>

              {/* Text-Spalte */}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 14,
                    letterSpacing: -0.1,
                    color: theme.text,
                  }}
                >
                  {data.title}
                </Text>
                <Text
                  numberOfLines={2}
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 12,
                    lineHeight: 16,
                    color: theme.textMuted,
                    marginTop: 1,
                  }}
                >
                  {data.subtitle}
                </Text>
              </View>

              {/* Punkte-Pill — nur wenn data.points > 0. */}
              {data.points && data.points > 0 ? (
                <View
                  style={{
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                    borderRadius: 10,
                    backgroundColor: brand.primary + '18',
                  }}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 11,
                      letterSpacing: 0.2,
                      color: brand.primary,
                    }}
                  >
                    +{data.points} Pkt
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </GestureHandlerRootView>
  );
}
