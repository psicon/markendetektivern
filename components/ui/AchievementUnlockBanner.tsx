// AchievementUnlockBanner — Slide-In-Banner für die "subtle"-Tier
// Celebrations (Achievements UND niedrigschwellige Level-Ups).
//
// ─── Visuelle Sprache (v2) ──────────────────────────────────────
//
//   • Slidet von unten ein, sitzt knapp oberhalb der Tab-Bar
//   • LinearGradient-Hintergrund: tinted-color auf der linken
//     Seite, fading zu theme.surface rechts → Banner pop'ed
//     deutlich auf weißem Untergrund, nicht mehr "unsichtbar"
//   • 4 px Accent-Stripe LINKS in tier-color als zusätzliche
//     Identifikation als Celebration
//   • Lottie 64×64 LINKS — sichtbar, animiert, festlich
//   • Title (extraBold 15) + Subtitle (medium 12, 2 Zeilen)
//   • Optionale Punkte-Pill rechts ("+5 Pkt")
//   • Auto-dismiss nach 5 s, swipe-down dismissed, tap → onTap
//   • HAPTIC FEEDBACK beim Erscheinen — Success-Notification
//     unterstreicht das Reward-Gefühl ohne aufdringlich zu sein
//
// Banner ist GENERISCH — kennt keine Achievement-Datei direkt.
// Caller (GamificationProvider) baut BannerData zusammen.

import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
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

const TAB_BAR_HEIGHT_IOS = 90;
const TAB_BAR_HEIGHT_ANDROID_BASE = 62;
const HIDDEN_OFFSET = 200;
// Erhöht von 5 → 7 s. User-Feedback: 5 s sind zu knapp um die
// Lottie zu würdigen + den Text zu lesen + zu entscheiden ob man
// zur Errungenschaften-Seite tippen will.
const AUTO_DISMISS_MS = 7000;
const BANNER_HEIGHT = 96;
const LOTTIE_SIZE = 72;

export type BannerData = {
  /** Headline. extraBold, 15 px. */
  title: string;
  /** Sub-Zeile. medium, 12 px, 2 Zeilen max. */
  subtitle: string;
  /** Optionale Punkte für die Pill rechts. */
  points?: number;
  /** Lottie-Source via require(). Wird vom Caller (Provider)
   *  gepickt — siehe lottieForAchievementAction in
   *  GamificationProvider. NICHT ein Pfad-String, sondern das
   *  bereits erforderte Modul. */
  lottie: any;
  /** Tier-Farbe — bestimmt Stripe + Gradient-Tönung. */
  tint: string;
  /** Optional: Tap aufs Body. */
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
  // Subtle scale-Pop beim Entry — verstärkt "celebration"-Feel.
  const scale = useSharedValue(0.92);

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

  // Haptic-Feedback wird VOR dem Spring-Entry ausgelöst — der
  // taktile Impuls korreliert dann zeitlich mit dem visuellen
  // Auftauchen.
  const triggerHaptic = useCallback(() => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Haptic API nicht verfügbar (z.B. Web-Build, älteres Android) →
      // schluck stillschweigend, ist eh nur ein Bonus.
    }
  }, []);

  useEffect(() => {
    if (visible) {
      translateY.value = HIDDEN_OFFSET;
      opacity.value = 0;
      scale.value = 0.92;
      // Haptik sofort beim Mount feuern, ParallelEntry mit Spring.
      triggerHaptic();
      translateY.value = withSpring(0, {
        damping: 18,
        stiffness: 180,
        mass: 0.7,
      });
      opacity.value = withTiming(1, { duration: 220 });
      scale.value = withSpring(1, {
        damping: 14,
        stiffness: 150,
        mass: 0.6,
      });
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
  }, [visible, translateY, opacity, scale, triggerHaptic, animateOut]);

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
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const handleTapBody = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (data?.onTap) {
      data.onTap();
      animateOut();
    } else {
      animateOut();
    }
  }, [data, animateOut]);

  if (!data) return null;

  const tabBarH =
    Platform.OS === 'ios'
      ? TAB_BAR_HEIGHT_IOS
      : TAB_BAR_HEIGHT_ANDROID_BASE + Math.max(0, insets.bottom);
  const bottomOffset = tabBarH + 12;

  // Gradient-Stops: links sat-getintet (~28% opacity), rechts
  // theme.surface (= weiß). Der Übergang läuft horizontal über
  // ~60% der Breite damit die rechte Pille noch lesbar bleibt.
  const gradientLeft = data.tint + '40'; // 25% Opacity
  const gradientMid = data.tint + '14'; // 8% Opacity
  const gradientRight = theme.surface;

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
                opacity: pressed ? 0.94 : 1,
                borderRadius: 18,
                overflow: 'hidden',
                // SOLID surface BACKDROP — sonst durchsichtig auf dem
                // Screen-Inhalt (siehe User-Bug-Screenshot wo
                // "Inhaltsstoffe/Nährwerte"-Tabs durchschimmerten).
                // Der LinearGradient drüber arbeitet mit semi-
                // transparenten Stops, braucht also einen opaken
                // Untergrund.
                backgroundColor: theme.surface,
                ...(shadows.lg as object),
              })}
            >
              {/* Gradient-Backdrop füllt die ganze Karte */}
              <LinearGradient
                colors={[gradientLeft, gradientMid, gradientRight]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingLeft: 16,
                  paddingRight: 14,
                  paddingVertical: 12,
                  minHeight: BANNER_HEIGHT,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 18,
                }}
              >
                {/* Linker Accent-Stripe — solid in der Tier-Farbe.
                    Macht den Banner unverkennbar als Celebration. */}
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

                {/* Lottie-Slot — 72×72, ohne Background-Circle damit
                    die Animation freier wirkt. Tönung kommt vom
                    Gradient drunter. */}
                <View
                  style={{
                    width: LOTTIE_SIZE,
                    height: LOTTIE_SIZE,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <LottieView
                    source={data.lottie}
                    autoPlay
                    loop
                    speed={0.85}
                    style={{ width: LOTTIE_SIZE, height: LOTTIE_SIZE }}
                  />
                </View>

                {/* Text-Spalte */}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 15,
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
                      marginTop: 2,
                    }}
                  >
                    {data.subtitle}
                  </Text>
                </View>

                {/* Punkte-Pill rechts — nur wenn data.points > 0 */}
                {data.points && data.points > 0 ? (
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 12,
                      backgroundColor: brand.primary,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.extraBold,
                        fontSize: 12,
                        letterSpacing: 0.2,
                        color: '#fff',
                      }}
                    >
                      +{data.points}
                    </Text>
                  </View>
                ) : null}
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </GestureHandlerRootView>
  );
}
