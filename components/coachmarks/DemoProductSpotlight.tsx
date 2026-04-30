// DemoProductSpotlight — der Spotlight-Schritt der Home-Tour, NEU
// gedacht: statt ein bewegliches UI-Element auf dem Home-Screen
// hervorzuheben, rendern wir eine kuratierte Demo-Karte komplett
// SELBST in einem Modal-Layer.
//
// Vorteile gegenüber dem "echten" Anchor-Spotlight:
//   • Kein Layout-Shift-Problem — Ads, dynamischer Content,
//     ScrollView-State sind komplett irrelevant. Die Karte sitzt
//     wo wir sie hinrendern, fertig.
//   • Modal blockiert automatisch Touches dahinter → kein
//     Scroll-Lock-Code nötig, kein Tap-Through-Problem.
//   • Curated Content via Remote Config: man kann das beste
//     Beispiel-Produkt ausspielen (hohe Stufe, klare Ersparnis)
//     statt zufälliger Treffer aus der Top-Liste.
//   • Multi-Step-Touren werden trivial: jeder Schritt rendert
//     seine eigene UI, kein Anchor-Hunt durch fremde Render-Bäume.
//
// Pattern matcht "Activation Through First Successful Action": der
// User TIPPT die Karte selbst (dadurch Lerneffekt + Gamification-
// Belohnung im Detail-Screen) statt nur darüber zu lesen.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProductCard } from '@/components/design/ProductCard';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import type { FirestoreDocument, Produkte } from '@/lib/types/firestore';

// Demo-Karten-Geometrie. Etwas größer als die normale "horizontal"-
// Card im Home-Scroller (168 px), damit sie als Held auf dem dunklen
// Backdrop wirkt aber nicht den Tooltip / Skip-Button verdrängt.
const CARD_WIDTH = 220;
// Halo-Padding rund um die Karte — bestimmt den Abstand zwischen
// Karten-Kante und glühendem Ring.
const HALO_PADDING = 14;
const HALO_BORDER_WIDTH = 3;

export type DemoProductSpotlightProps = {
  visible: boolean;
  /**
   * Voll-aufgelöstes Produkt aus Firestore. Die Komponente nimmt sich
   * `bildClean`, `name`, `preis`, `stufe`, plus die populierten
   * `discounter` + `handelsmarke`-Refs vom Service.
   * Wenn das Produkt fehlt (z.B. Fetch failed) sollte die Tour
   * SILENTLY abgebrochen werden statt diese Komponente leer zu
   * mounten — Zuständigkeit liegt beim Caller (HomeWalkthrough).
   */
  product: FirestoreDocument<Produkte>;
  title: string;
  body: string;
  /** Tap auf die Karte. Caller navigiert hier zum Produkt-Detail. */
  onTapProduct: () => void;
  /** "Überspringen"-Tap. Caller markiert Tour als gesehen. */
  onSkip: () => void;
};

export function DemoProductSpotlight({
  visible,
  product,
  title,
  body,
  onTapProduct,
  onSkip,
}: DemoProductSpotlightProps) {
  const { theme, shadows } = useTokens();
  const { height: SCREEN_H } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // ─── Pulse-Halo ────────────────────────────────────────────────
  //
  // Reanimated `withRepeat(_, -1, true)` = unendlich, mit reverse.
  // 1400 ms / Half-Cycle = ~2.8 s ein Atem-Rhythmus (volle Welle:
  // wachsen + schrumpfen). Eased mit `inOut` damit's organisch
  // aussieht statt linear.
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, {
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      );
    } else {
      pulse.value = 0;
    }
  }, [visible, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    // Opacity: pulst zwischen 0.35 (zart) und 0.95 (deutlich).
    opacity: 0.35 + pulse.value * 0.6,
    // Scale: ganz subtil, sonst tanzt die ganze Card optisch mit.
    transform: [{ scale: 1 + pulse.value * 0.04 }],
  }));

  // ─── Backdrop-Fade ─────────────────────────────────────────────
  const fade = useSharedValue(0);
  useEffect(() => {
    fade.value = withTiming(visible ? 1 : 0, {
      duration: 280,
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, fade]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  // ─── Tooltip-Position ──────────────────────────────────────────
  //
  // Tooltip-Card oberhalb des Demo-Produkts. Skip-Button am unteren
  // Bildschirm-Rand. Beide vertikal NICHT zwingend gepinnt — wir
  // lassen den ContentContainer per `justifyContent: 'space-between'`
  // die Verteilung übernehmen, das ist auf jedem Device
  // proportional korrekt.

  // Eyebrow-Werte aus den populierten Refs ableiten, identisch zur
  // Logik im Home-Screen. Defensiv: jedes Feld kann fehlen.
  const disc = (product as any).discounter as
    | { name?: string; bild?: string }
    | undefined;
  const hm = (product as any).handelsmarke as
    | { bezeichnung?: string; name?: string }
    | undefined;
  const handelsmarkeName = hm?.bezeichnung ?? hm?.name ?? null;
  const logoUri = disc?.bild ?? null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onSkip}
      statusBarTranslucent
    >
      {/* Backdrop — solid dark, full-screen. Modal blockt automatisch
          alles dahinter, deshalb kein extra `pointerEvents` und kein
          Scroll-Lock nötig. */}
      <Animated.View
        pointerEvents="auto"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: 'rgba(0,0,0,0.78)' },
          backdropStyle,
        ]}
      />

      {/* Content-Container — nutzt die volle Höhe, Tooltip oben,
          Karte mittig, Skip unten. SafeAreaInsets respektiert. */}
      <View
        pointerEvents="box-none"
        style={{
          flex: 1,
          paddingTop: insets.top + 24,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
          paddingHorizontal: 20,
        }}
      >
        {/* Tooltip-Card */}
        <View
          style={[
            {
              backgroundColor: theme.surface,
              borderRadius: 18,
              paddingHorizontal: 18,
              paddingVertical: 16,
              maxHeight: SCREEN_H * 0.28,
            },
            shadows.lg,
          ]}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 18,
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
              fontSize: 14,
              lineHeight: 20,
              color: theme.textMuted,
            }}
          >
            {body}
          </Text>
        </View>

        {/* Demo-Karte mit pulsierendem Halo. Karte und Halo sitzen
            in einem zentrierenden Wrapper. Halo ist ein abs.
            positionierter View hinter der Karte mit eigenen
            Dimensionen (Karte + HALO_PADDING auf jeder Seite). */}
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: CARD_WIDTH + HALO_PADDING * 2,
              height: undefined,
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {/* Halo — abs. positioniert, etwas größer als die Karte.
                Wir nutzen border statt fill damit's wie ein Glow-Ring
                aussieht statt wie ein Hintergrund-Block. */}
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: 'absolute',
                  top: -HALO_PADDING,
                  bottom: -HALO_PADDING,
                  left: -HALO_PADDING,
                  right: -HALO_PADDING,
                  // 18 px matcht die Tooltip-Card-Eckigkeit
                  // im Rest der Coachmark-Tour (siehe
                  // SpotlightOverlay.SPOTLIGHT_BORDER_RADIUS).
                  borderRadius: 18,
                  borderWidth: HALO_BORDER_WIDTH,
                  borderColor: '#fff',
                },
                haloStyle,
              ]}
            />

            {/* Echte ProductCard — gleiche Komponente wie auf Home,
                damit der visuelle Stil konsistent ist und der User
                in der App genau diese Optik wiedererkennt. */}
            <View style={{ width: CARD_WIDTH }}>
              <ProductCard
                title={(product as any).name ?? ''}
                brand={handelsmarkeName}
                eyebrowLogoUri={logoUri}
                product={product as any}
                price={(product as any).preis ?? 0}
                stufe={parseInt(String((product as any).stufe ?? '1')) || 1}
                variant="horizontal"
                width={CARD_WIDTH}
                onPress={onTapProduct}
              />
            </View>
          </View>
        </View>

        {/* Skip — neutraler, kein Pill-Button. Soll subtil sein,
            damit's nicht mit dem primären "Tippe Karte"-Gefühl
            konkurriert. */}
        <Pressable
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel="Tour überspringen"
          hitSlop={6}
          style={({ pressed }) => ({
            paddingVertical: 12,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 14,
                color: 'rgba(255,255,255,0.85)',
              }}
            >
              Überspringen
            </Text>
            <MaterialCommunityIcons
              name="close"
              size={14}
              color="rgba(255,255,255,0.85)"
            />
          </View>
        </Pressable>
      </View>
    </Modal>
  );
}
