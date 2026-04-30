// ProductDetailWalkthrough — Tour für die Produktdetail-Screens
// (noname-detail UND product-comparison).
//
// Phasen:
//   1. **welcome** — kompaktes Modal: "Produktdetails — was du hier
//      machen kannst". Erklärt knapp das Konzept (Stufen,
//      Hersteller, Preise) und kündigt die drei Spotlights an.
//   2. **cart** — Spotlight auf den Einkaufsliste-Button. Tooltip:
//      "Tippe um zur Einkaufsliste hinzuzufügen — wir tracken
//      automatisch wieviel du sparst."
//   3. **favorite** — Spotlight auf den Herz-Button. Tooltip:
//      "Tippe um als Lieblingsprodukt zu speichern."
//   4. **rating** — Spotlight auf den Stern-Button. Tooltip: "Tippe
//      um zu bewerten oder Bewertungen anderer zu sehen."
//   5. **done** — Caller dismisst.
//
// Anchor-IDs (in den Detail-Screens an die ActionButtons gehängt):
//   • product.cart
//   • product.favorite
//   • product.rating
//
// Beide Detail-Screens (noname-detail/[id].tsx + product-
// comparison/[id].tsx) müssen die gleichen Anchor-IDs setzen
// damit dieselbe Tour egal-welcher-Screen funktioniert.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import LottieView from 'lottie-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { SpotlightOverlay } from './SpotlightOverlay';

// Anchor-IDs — exportiert sodass die Detail-Screens sie EXAKT
// gleich verwenden (single source of truth).
export const PRODUCT_DETAIL_ANCHOR_CART = 'product.cart';
export const PRODUCT_DETAIL_ANCHOR_FAVORITE = 'product.favorite';
export const PRODUCT_DETAIL_ANCHOR_RATING = 'product.rating';
// Context-Spotlight (5. Phase) — pointet auf etwas screen-
// spezifisches: auf product-comparison ist's der NoName-Carousel,
// auf noname-detail ist's der Stufe-Indicator-Bereich.
export const PRODUCT_DETAIL_ANCHOR_CONTEXT = 'product.context';

type Phase = 'welcome' | 'cart' | 'favorite' | 'rating' | 'context';

const PHASES_ORDER: Phase[] = [
  'welcome',
  'cart',
  'favorite',
  'rating',
  'context',
];

export type ProductDetailScreenType = 'noname' | 'comparison';

export type ProductDetailWalkthroughProps = {
  visible: boolean;
  onDismiss: () => void;
  /**
   * Welcher Detail-Screen mountet die Tour. Beeinflusst die letzte
   * 'context'-Phase: auf 'comparison' erklären wir den NoName-
   * Carousel + Stufen 3-5; auf 'noname' erklären wir was Stufen 1-2
   * bedeuten und dass es bei höheren Stufen Markenvergleiche gibt.
   */
  screenType: ProductDetailScreenType;
};

const COMPARISON_LOTTIE = require('@/assets/lottie/comparison.json');

export function ProductDetailWalkthrough({
  visible,
  onDismiss,
  screenType,
}: ProductDetailWalkthroughProps) {
  const [phase, setPhase] = useState<Phase>('welcome');

  // Beim erneuten Sichtbarwerden zurück auf die Welcome-Phase —
  // sonst landet ein Replay aus dem Dev-Panel mitten in der Tour.
  useEffect(() => {
    if (visible) setPhase('welcome');
  }, [visible]);

  const advance = useCallback(() => {
    const idx = PHASES_ORDER.indexOf(phase);
    if (idx < 0 || idx >= PHASES_ORDER.length - 1) {
      // Letzte Phase oder unbekannt → tour beenden
      onDismiss();
      return;
    }
    setPhase(PHASES_ORDER[idx + 1]);
  }, [phase, onDismiss]);

  if (!visible) return null;

  if (phase === 'welcome') {
    return <WelcomeCard onStart={advance} onSkip={onDismiss} />;
  }

  // Spotlight-Phasen — gleicher Tooltip-Style, nur unterschiedlicher
  // Anchor + Text. Step-Counter (X/4) im primaryLabel macht klar
  // wieviel noch kommt.
  const stepIndex = PHASES_ORDER.indexOf(phase); // 1, 2, 3, 4
  const totalSteps = PHASES_ORDER.length - 1; // = 4 (welcome zählt nicht)
  const isLastStep = stepIndex === totalSteps;

  if (phase === 'cart') {
    return (
      <SpotlightOverlay
        visible
        anchorId={PRODUCT_DETAIL_ANCHOR_CART}
        title="Einkaufsliste"
        body="Tippe hier um das Produkt zur Einkaufsliste hinzuzufügen. Wir tracken automatisch wie viel du beim Wechsel sparst."
        onSkip={onDismiss}
        skipLabel="Tour beenden"
        onPrimary={advance}
        primaryLabel={`Weiter (${stepIndex}/${totalSteps})`}
      />
    );
  }

  if (phase === 'favorite') {
    return (
      <SpotlightOverlay
        visible
        anchorId={PRODUCT_DETAIL_ANCHOR_FAVORITE}
        title="Favorisieren"
        body="Tippe um das Produkt als Lieblingsprodukt zu speichern. Du findest deine Favoriten unter Lieblingsprodukte im Profil."
        onSkip={onDismiss}
        skipLabel="Tour beenden"
        onPrimary={advance}
        primaryLabel={`Weiter (${stepIndex}/${totalSteps})`}
      />
    );
  }

  if (phase === 'rating') {
    return (
      <SpotlightOverlay
        visible
        anchorId={PRODUCT_DETAIL_ANCHOR_RATING}
        title="Bewertung"
        body="Tippe um das Produkt zu bewerten oder zu sehen was andere Detektive davon halten."
        onSkip={onDismiss}
        skipLabel="Tour beenden"
        onPrimary={advance}
        primaryLabel={`Weiter (${stepIndex}/${totalSteps})`}
      />
    );
  }

  // phase === 'context' — letzte Phase, screen-spezifisch.
  //
  // Auf product-comparison: spotlight auf den NoName-Carousel,
  // erklärt dass das die Alternativen sind und wie die
  // Stufen 3-5 zu lesen sind. Erwähnt kurz die niedrigeren Stufen
  // damit der User das Gesamtbild kriegt.
  //
  // Auf noname-detail: spotlight auf den Stufen-Indicator,
  // erklärt dass dieses NoName-Produkt von einem Hersteller kommt
  // der auch Markenprodukte macht (Stufe 2) oder reiner NoName
  // ist (Stufe 1). Erwähnt, dass es bei höheren Stufen direkte
  // Vergleiche zu Markenprodukten gibt.
  if (screenType === 'comparison') {
    return (
      <SpotlightOverlay
        visible
        anchorId={PRODUCT_DETAIL_ANCHOR_CONTEXT}
        title="NoName-Alternativen"
        body="Hier siehst du die NoName-Produkte, die zu diesem Markenprodukt passen — vom selben Hersteller produziert. Stufe 5 = identisch, 4 = sehr ähnlich, 3 = vergleichbar. Stufen 1-2 (reine NoName-Hersteller ohne Marken-Original) findest du beim Stöbern."
        onSkip={onDismiss}
        skipLabel="Tour beenden"
        onPrimary={onDismiss}
        primaryLabel={isLastStep ? 'Fertig' : `Weiter (${stepIndex}/${totalSteps})`}
      />
    );
  }

  // screenType === 'noname'
  return (
    <SpotlightOverlay
      visible
      anchorId={PRODUCT_DETAIL_ANCHOR_CONTEXT}
      title="Ähnlichkeitsstufe"
      body="Stufen 1 und 2 stehen für reine NoName-Hersteller bzw. Hersteller, die nebenbei auch Markenprodukte produzieren — ohne direkten Marken-Vergleich. Bei Stufen 3-5 findest du das passende Markenprodukt + günstigere Alternativen."
      onSkip={onDismiss}
      skipLabel="Tour beenden"
      onPrimary={onDismiss}
      primaryLabel="Fertig"
    />
  );
}

// ─── Welcome-Card ────────────────────────────────────────────────
//
// Drei Bullet-Hinweise — kompakt. CTA "Tour starten" führt in die
// Spotlight-Sequenz. Skip = Tour ganz vorbei.

function WelcomeCard({
  onStart,
  onSkip,
}: {
  onStart: () => void;
  onSkip: () => void;
}) {
  const { theme, brand, shadows } = useTokens();
  const insets = useSafeAreaInsets();

  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, {
      duration: 320,
      easing: Easing.out(Easing.cubic),
    });
  }, [t]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: t.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: t.value,
    transform: [
      { translateY: (1 - t.value) * 12 },
      { scale: 0.96 + t.value * 0.04 },
    ],
  }));

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onSkip}
      statusBarTranslucent
    >
      <Animated.View
        pointerEvents="auto"
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: 'rgba(0,0,0,0.78)' },
          backdropStyle,
        ]}
      />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 16,
          paddingBottom: Math.max(insets.bottom, 16) + 16,
          paddingHorizontal: 20,
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={[
            {
              backgroundColor: theme.surface,
              borderRadius: 24,
              paddingHorizontal: 22,
              paddingTop: 22,
              paddingBottom: 18,
            },
            shadows.lg,
            cardStyle,
          ]}
        >
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <LottieView
              source={COMPARISON_LOTTIE}
              autoPlay
              loop
              speed={0.85}
              style={{ width: 120, height: 120 }}
            />
          </View>

          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 22,
              letterSpacing: -0.4,
              color: theme.text,
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            Produktdetails verstehen
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 14,
              lineHeight: 21,
              color: theme.textMuted,
              textAlign: 'center',
              marginBottom: 18,
              paddingHorizontal: 4,
            }}
          >
            Hier siehst du alles was du über das Produkt wissen musst.
            Ich zeig dir kurz die drei wichtigsten Aktionen.
          </Text>

          <View style={{ gap: 10, marginBottom: 18 }}>
            <BulletRow
              icon="cart-plus"
              tint={brand.primary}
              text="Zur Einkaufsliste hinzufügen — wir tracken deine Ersparnis automatisch."
            />
            <BulletRow
              icon="heart-outline"
              tint="#E91E63"
              text="Als Lieblingsprodukt speichern für schnellen Wiederzugriff."
            />
            <BulletRow
              icon="star-outline"
              tint="#FF9800"
              text="Bewerten oder Bewertungen anderer Detektive anschauen."
            />
          </View>

          <Pressable
            onPress={onStart}
            accessibilityRole="button"
            accessibilityLabel="Tour starten"
            style={({ pressed }) => ({
              height: 52,
              borderRadius: 14,
              backgroundColor: brand.primary,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              opacity: pressed ? 0.9 : 1,
              marginBottom: 8,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 15,
                letterSpacing: 0.2,
                color: '#fff',
              }}
            >
              Tour starten
            </Text>
            <MaterialCommunityIcons
              name="arrow-right"
              size={16}
              color="#fff"
            />
          </Pressable>
          <Pressable
            onPress={onSkip}
            accessibilityRole="button"
            accessibilityLabel="Tour überspringen"
            hitSlop={6}
            style={({ pressed }) => ({
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
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
              Später
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

function BulletRow({
  icon,
  tint,
  text,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  tint: string;
  text: string;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: tint + '22',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        <MaterialCommunityIcons name={icon} size={17} color={tint} />
      </View>
      <Text
        style={{
          flex: 1,
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          lineHeight: 19,
          color: theme.text,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
