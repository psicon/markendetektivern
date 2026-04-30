// CoachmarkOverlay — generisches Slide-Overlay für die Per-Screen-
// Erklär-Tours.
//
// Designsprache (siehe CLAUDE.md "Design system rules"):
//   • BlurView (iOS) / tinted View (Android) als Backdrop, scheme-aware
//   • Card-Container mit theme.surface + soft shadow + radii.lg
//   • Hero pro Slide: Lottie ODER gradient-Icon-Circle (52-104 px)
//   • Title extraBold 22-24 px, letterSpacing -0.4
//   • Body medium 14-15 px, theme.textMuted, max 4 Zeilen
//   • Pager-Dots: 6 px, primary-active / borderStrong-inactive
//   • Pill-CTA: 56 px, radius 16, primary background, full-width
//   • "Überspringen" oben rechts: medium 13 px, theme.textMuted
//
// Animations: Reanimated 3 only (worklets, UI-thread). Entry =
// backdrop fade + card scale-up + slight Y-translate. Exit reverse.
//
// Pager: react-native-pager-view (genau wie SegmentedTabs+PagerView
// in Stöbern, Rewards, Detail-Screens) damit Wisch-Geste sich nativ
// anfühlt.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import type { Slide, SlideVisual, Tour } from '@/components/coachmarks/tours';

// ─── Lottie-Source-Resolver ───────────────────────────────────────
//
// Lottie-Files werden über `require()` geladen — der Bundler braucht
// statische Pfade, deshalb können wir nicht dynamisch eine Datei aus
// einem String-Pfad lesen. Lookup-Map einmalig: Tour-Files hinzufügen
// → Map ergänzen.
const LOTTIE_FILES: Record<string, any> = {
  rocket: require('@/assets/lottie/rocket.json'),
  search: require('@/assets/lottie/search.json'),
  savings: require('@/assets/lottie/savings.json'),
  comparison: require('@/assets/lottie/comparison.json'),
  task: require('@/assets/lottie/task.json'),
  'streak-fire': require('@/assets/lottie/streak-fire.json'),
  'points-earned': require('@/assets/lottie/points-earned.json'),
  swap: require('@/assets/lottie/swap.json'),
  gift: require('@/assets/lottie/gift.json'),
};

// ─── Visual Renderer ─────────────────────────────────────────────
function SlideVisualRenderer({ visual }: { visual: SlideVisual }) {
  const { brand } = useTokens();
  if (visual.type === 'lottie') {
    const source = LOTTIE_FILES[visual.lottie];
    if (!source) {
      // Defensiv: fehlende Lottie-Datei darf das Overlay nicht crashen.
      return null;
    }
    return (
      <View
        style={{
          width: 200,
          height: 200,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 28,
        }}
      >
        <LottieView
          source={source}
          autoPlay
          loop
          speed={0.85}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
    );
  }
  // Gradient-Icon-Variante: 96×96 Circle mit zweifarbigem Gradient,
  // gross genug um als visueller Anker zu lesen.
  return (
    <LinearGradient
      colors={visual.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: 96,
        height: 96,
        borderRadius: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 28,
      }}
    >
      <MaterialCommunityIcons name={visual.icon as any} size={44} color="#fff" />
    </LinearGradient>
  );
}

// ─── Single Slide ────────────────────────────────────────────────
function SlideContent({ slide }: { slide: Slide }) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
      }}
    >
      <SlideVisualRenderer visual={slide.visual} />
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 24,
          letterSpacing: -0.4,
          color: theme.text,
          textAlign: 'center',
          marginBottom: 12,
        }}
      >
        {slide.title}
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 15,
          lineHeight: 22,
          color: theme.textMuted,
          textAlign: 'center',
          paddingHorizontal: 8,
        }}
      >
        {slide.body}
      </Text>
    </View>
  );
}

// ─── Pager Dots ──────────────────────────────────────────────────
function PagerDots({ count, active }: { count: number; active: number }) {
  const { brand, theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        marginBottom: 18,
      }}
    >
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === active;
        return (
          <View
            key={i}
            style={{
              width: isActive ? 18 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: isActive ? brand.primary : theme.borderStrong,
            }}
          />
        );
      })}
    </View>
  );
}

// ─── Overlay ─────────────────────────────────────────────────────
export type CoachmarkOverlayProps = {
  visible: boolean;
  tour: Tour;
  onDismiss: () => void;
};

export function CoachmarkOverlay({ visible, tour, onDismiss }: CoachmarkOverlayProps) {
  const { theme, brand, shadows } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<PagerView | null>(null);
  const [page, setPage] = useState(0);

  // Reanimated entry/exit. Modal selbst toggelt mount; wir feuern
  // beim Mount eine kurze Scale+Opacity-Animation auf der Card. Bei
  // Dismiss reicht uns die Modal-Default-Animation (RN macht eine
  // Standard-Cross-Fade), wir verzichten auf custom exit-handling
  // damit wir den onDismiss nicht race-conditional machen müssen.
  const t = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      t.value = 0;
      // Kleines Easing-In: 320 ms wie der Crossfade-Standard, etwas
      // sanfter als 200 ms; "festlich" aber nicht behäbig.
      t.value = withTiming(1, { duration: 320 });
      // Pager beim Re-Open auf Slide 1 zurücksetzen (sonst landet
      // ein Replay aus dem Dev-Panel mitten im letzten Slide).
      setPage(0);
      requestAnimationFrame(() => {
        pagerRef.current?.setPage(0);
      });
    } else {
      t.value = 0;
    }
  }, [visible, t]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(t.value, [0, 1], [16, 0], Extrapolation.CLAMP) },
      { scale: interpolate(t.value, [0, 1], [0.96, 1], Extrapolation.CLAMP) },
    ],
  }));

  const isLastSlide = page === tour.slides.length - 1;

  const handleNext = useCallback(() => {
    if (isLastSlide) {
      onDismiss();
      return;
    }
    const nextPage = page + 1;
    pagerRef.current?.setPage(nextPage);
    setPage(nextPage);
  }, [isLastSlide, page, onDismiss]);

  const handleSkip = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  return (
    <Modal
      visible={visible}
      transparent
      // Wir machen unsere eigene fade-in-Animation; das System soll
      // nur beim mount/unmount "fade" benutzen, kein "slide" — das
      // würde mit unserer scale+translate-In doppelt aussehen.
      animationType="fade"
      // Hardware-Back auf Android = Skip (markiert als gesehen).
      onRequestClose={handleSkip}
      statusBarTranslucent
    >
      {/* Backdrop — BlurView auf iOS, tinted View auf Android (gleicher
          Pattern wie Stöbern-Chrome). Tappable für direkten Skip,
          damit ein User der "weg damit" will sofort raus kommt. */}
      <Animated.View
        style={[
          { ...StyleSheetAbsoluteFill },
          backdropStyle,
        ]}
      >
        {Platform.OS === 'ios' ? (
          <BlurView
            tint={scheme === 'dark' ? 'dark' : 'light'}
            intensity={50}
            style={{ flex: 1 }}
          />
        ) : (
          <View
            style={{
              flex: 1,
              backgroundColor:
                scheme === 'dark'
                  ? 'rgba(15,18,20,0.88)'
                  : 'rgba(245,247,248,0.92)',
            }}
          />
        )}
      </Animated.View>

      {/* Card — sitzt in der unteren Hälfte des Screens, lässt oben
          atmen (Statusbar + Skip-Pill), unten kommt CTA. */}
      <Animated.View
        style={[
          {
            flex: 1,
            paddingTop: insets.top + 12,
            paddingBottom: Math.max(insets.bottom, 12) + 12,
            paddingHorizontal: 16,
          },
          cardStyle,
        ]}
      >
        {/* Skip-Pill oben rechts */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            paddingHorizontal: 4,
            marginBottom: 8,
          }}
        >
          <Pressable
            onPress={handleSkip}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Tour überspringen"
            style={({ pressed }) => ({
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              opacity: pressed ? 0.8 : 1,
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
              Überspringen
            </Text>
          </Pressable>
        </View>

        {/* Card-Container */}
        <View
          style={[
            {
              flex: 1,
              backgroundColor: theme.surface,
              borderRadius: 24,
              overflow: 'hidden',
            },
            shadows.lg,
          ]}
        >
          <PagerView
            ref={pagerRef}
            style={{ flex: 1 }}
            initialPage={0}
            onPageSelected={(e) => setPage(e.nativeEvent.position)}
          >
            {tour.slides.map((slide, idx) => (
              <View key={idx} style={{ flex: 1 }}>
                <SlideContent slide={slide} />
              </View>
            ))}
          </PagerView>

          {/* Footer: Pager-Dots + Pill-CTA */}
          <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 }}>
            <PagerDots count={tour.slides.length} active={page} />
            <Pressable
              onPress={handleNext}
              accessibilityRole="button"
              accessibilityLabel={isLastSlide ? 'Tour abschließen' : 'Weiter'}
              style={({ pressed }) => ({
                height: 56,
                borderRadius: 16,
                backgroundColor: brand.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 16,
                  letterSpacing: 0.2,
                  color: '#fff',
                }}
              >
                {isLastSlide ? 'Los geht’s' : 'Weiter'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

// Hilfs-Konstante — RN's StyleSheet.absoluteFill als Spread-Quelle
// damit wir nicht extra ein StyleSheet importieren müssen.
const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};
