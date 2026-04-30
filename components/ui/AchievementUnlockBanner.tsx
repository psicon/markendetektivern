// AchievementUnlockBanner — kompakter Slide-In-Banner für die
// "subtle"-Tier Achievements (siehe getAchievementTier in
// gamificationSettingsService).
//
// Visuelle Sprache:
//   • Slidet von unten ein, sitzt knapp oberhalb der Tab-Bar
//   • White Surface mit soft Shadow, rounded corners (radii.lg)
//   • Linker Slot: Lottie 48 px in tinted Circle (~achievement
//     difficulty color als Tönung)
//   • Mittlerer Slot: Title (extraBold 14) + Subtitle (medium 12)
//   • Rechter Slot: Punkte-Pill ("+10 Pkt") + ✕-Close-Icon
//   • Auto-dismiss nach 5 s
//   • Pan-down dismissed auch
//   • Tap auf Body navigiert zur Errungenschaften-Seite
//
// Mechanik:
//   • Reanimated 3 worklets (UI-thread, kein JS-Bridge-Toll)
//   • Entry: spring (damping 20, stiffness 180) auf translateY+opacity
//   • Exit: timing 280 ms zurückslidung+fade
//   • Auto-dismiss-Timer wird beim Pan abgebrochen damit der User
//     den Banner mit Geste verzögern kann
//
// Wir mounten den Banner global (in GamificationProvider) und
// schalten via `visible`-Prop. Der Provider managed die Queue
// (max 1 Banner gleichzeitig — bei mehr Achievements wird
// gemerged auf "X Errungenschaften").

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
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
import type { Achievement } from '@/lib/types/achievements';

// Lottie-Mapping. Bewusst dupliziert von app/achievements.tsx
// (`lottieFor`) — wenn Achievement-Action neu hinzukommt, hier
// und dort ergänzen. Eine zentrale Util wäre sauberer, aber das
// käme als eigener Refactor — Banner soll erstmal funktional und
// in Wartung knapp bleiben.
function lottieFor(a: Achievement) {
  try {
    switch (a.trigger?.action) {
      case 'first_action_any':
        return require('@/assets/lottie/rocket.json');
      case 'daily_streak':
        return a.trigger.target >= 7
          ? require('@/assets/lottie/streak-fire.json')
          : require('@/assets/lottie/streak-bonus.json');
      case 'view_comparison':
        return require('@/assets/lottie/comparison.json');
      case 'complete_shopping':
        return require('@/assets/lottie/task.json');
      case 'search_product':
        return require('@/assets/lottie/search.json');
      case 'submit_rating':
        return require('@/assets/lottie/ratingsthumbsup.json');
      case 'create_list':
        return require('@/assets/lottie/task.json');
      case 'convert_product':
        return require('@/assets/lottie/swap.json');
      case 'share_app':
        return require('@/assets/lottie/review.json');
      case 'submit_product':
        return require('@/assets/lottie/favorites.json');
      case 'save_product':
        return require('@/assets/lottie/favorites2.json');
      case 'savings_total':
        return require('@/assets/lottie/savings.json');
      default:
        return require('@/assets/lottie/confetti.json');
    }
  } catch {
    return require('@/assets/lottie/confetti.json');
  }
}

// Tab-Bar-Höhe inkl. safe-area. iOS 90 px ist Standard, Android
// rechnen wir 62 + bottom inset. In Praxis schwankt das je
// Device — der Banner muss da drüber sitzen.
const TAB_BAR_HEIGHT_IOS = 90;
const TAB_BAR_HEIGHT_ANDROID_BASE = 62;
// Wie weit der Banner nach unten geslidet wird im Hidden-Zustand
// (= außerhalb des Bildschirms). Großzügig um Schatten + safe
// area mitzunehmen.
const HIDDEN_OFFSET = 200;
const AUTO_DISMISS_MS = 5000;

export type AchievementUnlockBannerProps = {
  visible: boolean;
  achievement: Achievement | null;
  onDismiss: () => void;
};

export function AchievementUnlockBanner({
  visible,
  achievement,
  onDismiss,
}: AchievementUnlockBannerProps) {
  const { theme, brand, shadows } = useTokens();
  const insets = useSafeAreaInsets();

  // Translation in Y-Richtung. 0 = sichtbar an Soll-Position, +N
  // = nach unten verschoben. Beim Mount springt er von HIDDEN_OFFSET
  // auf 0 (Spring-Entry).
  const translateY = useSharedValue(HIDDEN_OFFSET);
  const opacity = useSharedValue(0);

  // ─── Show / Hide-Lifecycle ────────────────────────────────────
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
          // onDismiss vom UI-Thread sicher in den JS-Thread
          // schubsen. Caller (Provider) räumt den Achievement-State.
          runOnJS(onDismiss)();
        }
      },
    );
  }, [translateY, opacity, onDismiss]);

  useEffect(() => {
    if (visible) {
      // Spring-Entry: kommt smooth nach oben.
      translateY.value = HIDDEN_OFFSET;
      opacity.value = 0;
      translateY.value = withSpring(0, {
        damping: 20,
        stiffness: 180,
        mass: 0.7,
      });
      opacity.value = withTiming(1, { duration: 220 });
      // Auto-dismiss
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

  // ─── Pan-Down Geste ───────────────────────────────────────────
  //
  // Pan abwärts > 50 px ODER >500 px/s velocity → dismiss. Pan
  // aufwärts ist gesperrt (Banner ist eh schon ganz unten — er
  // soll nicht hochkriechen).
  const panGesture = Gesture.Pan()
    .activeOffsetY([5, 9999])
    .onUpdate((e) => {
      // Nur nach unten ziehen erlaubt; nach oben wird auf 0 geclampt
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const shouldDismiss =
        e.translationY > 50 || e.velocityY > 500;
      if (shouldDismiss) {
        runOnJS(animateOut)();
      } else {
        // Snap-back
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
    // Banner-Tap navigiert zur Errungenschaften-Page. Wir dismissen
    // den Banner, der Caller (Provider) räumt seinen State.
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    onDismiss();
    // Defer router.push minimal damit das Dismiss-State-Update
    // fertig ist bevor die Navigation startet — vermeidet Render-
    // Konflikte zwischen Banner-Unmount und neuem Screen-Mount.
    setTimeout(() => {
      try {
        router.push('/achievements' as any);
      } catch (e) {
        console.warn('Achievement banner nav failed (non-fatal):', e);
      }
    }, 50);
  }, [onDismiss]);

  const handleTapClose = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    animateOut();
  }, [animateOut]);

  if (!achievement) return null;

  // Tab-Bar-Höhe inkl. safe-area-Bottom. Banner sitzt 12 px über der
  // Tab-Bar.
  const tabBarH =
    Platform.OS === 'ios'
      ? TAB_BAR_HEIGHT_IOS
      : TAB_BAR_HEIGHT_ANDROID_BASE + Math.max(0, insets.bottom);
  const bottomOffset = tabBarH + 12;

  return (
    <GestureHandlerRootView
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFillObject,
        { zIndex: 9998 },
      ]}
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
              accessibilityLabel={`Errungenschaft freigeschaltet: ${achievement.name}`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: theme.surface,
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.92 : 1,
                ...(shadows.lg as object),
              })}
            >
              {/* Lottie in Tinted Circle */}
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  backgroundColor:
                    (achievement.color ?? brand.primary) + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                <LottieView
                  source={lottieFor(achievement)}
                  autoPlay
                  loop
                  speed={0.85}
                  style={{ width: 56, height: 56 }}
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
                  {achievement.name}
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
                  {achievement.description}
                </Text>
              </View>

              {/* Punkte-Pill + Close */}
              <View
                style={{
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                {achievement.points > 0 ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 3,
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
                      +{achievement.points} Pkt
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={handleTapClose}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Banner schließen"
                  style={({ pressed }) => ({
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={14}
                    color={theme.textMuted}
                  />
                </Pressable>
              </View>
            </Pressable>
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </GestureHandlerRootView>
  );
}
