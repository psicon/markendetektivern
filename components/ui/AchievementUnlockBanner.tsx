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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
import { EdgeGlow } from './EdgeGlow';

const TAB_BAR_HEIGHT_IOS = 90;
const TAB_BAR_HEIGHT_ANDROID_BASE = 62;
const HIDDEN_OFFSET = 200;
// 6 s — 1 s kürzer als vorher (war 7 s). User-Feedback v6.4.
const AUTO_DISMISS_MS = 6000;
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
  /** Optionaler Sekundär-Tint für den EdgeGlow. Wenn gesetzt, wird
   *  diese Farbe als zweite Color-Welle im Halo verwendet (z.B. die
   *  Color des VORHERIGEN Levels für ein satisfying "Übergang"-
   *  Gefühl). Wenn nicht gesetzt: EdgeGlow nutzt eine aufgehellte
   *  Variante des primary-Tints als Shimmer-Akzent. */
  secondaryTint?: string;
  /** Wenn true, wird der vollständige EdgeGlow (Skia-Halo um den
   *  Screen) zusätzlich zum Banner angezeigt. Default false.
   *  Pattern: NUR Level-Ups bekommen den vollen Glow — Achievements
   *  laufen mit Banner + Haptik (subtiler), damit der Effekt für
   *  die seltenen Major-Events reserviert bleibt und nicht durch
   *  Inflation abstumpft. */
  withGlow?: boolean;
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
  const onDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // T17.23: isExiting steuert den EdgeGlow-Fade-Out. Sobald exit-Phase
  // beginnt → EdgeGlow visible=false → seine eigene 900ms Easing.out
  // Fade-Animation läuft. Banner-Card selbst exitet schneller (~280ms),
  // dann bleibt der Component noch ~720ms gemounted damit der Glow
  // alleine ausfadet bevor onDismiss → Unmount kommt. Sonst popt der
  // Glow weg weil der Component beim Unmount sofort verschwindet.
  const [isExiting, setIsExiting] = useState(false);

  const animateOut = useCallback(() => {
    setIsExiting(true);
    translateY.value = withTiming(HIDDEN_OFFSET, {
      duration: 280,
      easing: Easing.in(Easing.cubic),
    });
    opacity.value = withTiming(0, {
      duration: 220,
      easing: Easing.in(Easing.cubic),
    });
    // onDismiss verzögert auf 950ms — EdgeGlow's interne Fade-Out
    // Duration ist 900ms (siehe EdgeGlow.tsx Zeile 167). 50ms Buffer
    // damit der letzte Frame des Glows sicher gerendert wird bevor
    // der Component unmounted.
    if (onDismissTimer.current) clearTimeout(onDismissTimer.current);
    onDismissTimer.current = setTimeout(() => {
      onDismiss();
    }, 950);
  }, [translateY, opacity, onDismiss]);

  // Haptic-Feedback wird VOR dem Spring-Entry ausgelöst — der
  // taktile Impuls korreliert dann zeitlich mit dem visuellen
  // Auftauchen. Sequenz für stärkeren "Achievement-Punch":
  //   1. Heavy-Impact sofort (= satter Bass-Schlag)
  //   2. Success-Notification ~120 ms später (= bestätigender Triller)
  // Das fühlt sich deutlich celebratorischer an als ein einzelnes
  // soft notify, ohne aufdringlich zu sein.
  const triggerHaptic = useCallback(() => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => {
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          // schluck — Haptic-Bonus, kein Pflichtfeature.
        }
      }, 120);
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
      if (onDismissTimer.current) {
        clearTimeout(onDismissTimer.current);
        onDismissTimer.current = null;
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
  // User-Feedback v6.5: "card weiter runter". Banner sitzt jetzt
  // tiefer und greift in den Tab-Bar-Bereich rein (oben am Pill,
  // ~15-20 px Overlap). Wirkt wie eine Notification die direkt auf
  // der Tab-Pille andockt.
  const bottomOffset = tabBarH - 16;

  // Gradient-Stops: links sat-getintet (~28% opacity), rechts
  // theme.surface (= weiß). Der Übergang läuft horizontal über
  // ~60% der Breite damit die rechte Pille noch lesbar bleibt.
  const gradientLeft = data.tint + '40'; // 25% Opacity
  const gradientMid = data.tint + '14'; // 8% Opacity
  const gradientRight = theme.surface;

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFillObject, { zIndex: 9998 }]}
    >
      {/* Tier-getinted Edge-Glow rund um den Screen — fadet synchron
          mit dem Banner ein/aus. zIndex 9990 < Banner 9998, damit der
          Banner-Card über dem Glow sitzt.
          NUR rendern wenn data.withGlow === true (typisch Level-Ups).
          Achievements bekommen kein Glow → vermeidet Inflation. */}
      {data.withGlow ? (
        <EdgeGlow
          // T17.23: !isExiting damit EdgeGlow seine eigene 900ms Fade-Out
          // Animation noch laufen kann bevor der Banner unmounted.
          visible={visible && !isExiting}
          tint={data.tint}
          secondaryTint={data.secondaryTint}
        />
      ) : null}

      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            // v6.5: zurück zu Side-Margins (Card-Look). 12 px je
            // Seite damit der Banner als schwebende Card wirkt,
            // nicht als Edge-to-Edge Toast-Bar.
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
                // v6.5: zurück zu Rounded-Card. 18 = radii.xl, matcht
                // die Tab-Pille + Cart-FAB.
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
              {/* Gradient-Backdrop füllt die ganze Karte. Border
                  entfernt (User-Wunsch v6.4) — keine Linie mehr um
                  den Banner. */}
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
                }}
              >
                {/* (Linker Accent-Stripe entfernt — User-Feedback: die
                    vertikale Linie wirkte hart/abrupt, der Tier-Tint
                    läuft eh schon über den Gradient. Kein Bedarf für
                    eine zusätzliche Solid-Kante.) */}

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
    </View>
  );
}
