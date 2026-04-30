// HomeWalkthrough — die Onboarding-Tour für den Home-Screen.
//
// Zwei Phasen:
//   1. **Welcome** — eine Karte mit Lottie + Titel + drei Bullet-
//      Hinweisen + zwei CTAs ("Tour starten", "Später").
//   2. **Spotlight** — kuratierte Demo-Produkt-Karte in einem
//      Modal-Layer. User tappt diese Karte → navigiert zum
//      Detail/Vergleich → gamification feuert ihre Toasts → Tour
//      ist offiziell abgeschlossen.
//
// Die Spotlight-Phase läuft NICHT mehr über Anchor-Hunt im
// Home-Render-Tree — wir rendern die Demo-Karte komplett selbst
// (siehe DemoProductSpotlight.tsx für die Architektur-Begründung).
// Vorteile:
//   • Keine Layout-Shifts durch Ads / dynamischen Content
//   • Modal blockiert automatisch alles dahinter (kein Scroll-Lock)
//   • Curated Demo-Produkt via Remote Config möglich
//   • Multi-Step-Touren werden trivial wenn wir später mehr Schritte
//     brauchen (Einkaufsliste, Filter, …) — jeder Schritt rendert
//     eigene UI, kein Anchor-Setup erforderlich
//
// Pattern: "Activation Through First Successful Action" — der User
// erlebt die App-Funktion (NoName-Vergleich) sofort an einem echten
// Beispiel statt sie aus Slides zu lesen.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { router } from 'expo-router';
import LottieView from 'lottie-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { FirestoreService } from '@/lib/services/firestore';
import { remoteConfigService } from '@/lib/services/remoteConfigService';
import type { FirestoreDocument, Produkte } from '@/lib/types/firestore';
import { DemoProductSpotlight } from './DemoProductSpotlight';

// Bleibt exportiert weil andere Stellen evtl. noch darauf verweisen
// (Anchor-Pattern für künftige Multi-Step-Touren). Aktuell
// verwendet der Walkthrough das Anchor-System NICHT mehr.
export const HOME_DEMO_ANCHOR_ID = 'home.demoProduct';

type Phase = 'welcome' | 'spotlight';

export type HomeWalkthroughProps = {
  visible: boolean;
  onDismiss: () => void;
};

const ROCKET_LOTTIE = require('@/assets/lottie/rocket.json');

// ─── Demo-Produkt-Resolver ──────────────────────────────────────
//
// Drei-Stufen-Fallback:
//   1. Remote Config Key `coachmark_home_demo_product_id` — wenn
//      gesetzt, nehmen wir die ID. Erlaubt es dem Team, die
//      "beste" Demo (hohe Stufe + krasser Preisunterschied) ohne
//      App-Update zu kuratieren.
//   2. Wenn RC leer / fehlt: erste objectID aus
//      `getTopEnttarnteProdukteRandomized` (10 Pool, 1 Sample) —
//      irgendein Top-Treffer ist immer noch besser als gar nichts.
//   3. Wenn auch das fehlschlägt: `null` zurückgeben → Caller
//      dismisst die Tour silent.
async function resolveDemoProductId(): Promise<string | null> {
  try {
    const fromRC = await remoteConfigService.getValue(
      'coachmark_home_demo_product_id',
    );
    if (typeof fromRC === 'string' && fromRC.trim().length > 0) {
      return fromRC.trim();
    }
  } catch (e) {
    console.warn('Coachmark: Remote Config read failed (non-fatal):', e);
  }
  try {
    const top = await FirestoreService.getTopEnttarnteProdukteRandomized(10, 1);
    if (top && top.length > 0) {
      return (top[0] as any).id ?? null;
    }
  } catch (e) {
    console.warn('Coachmark: Top-Enttarnt fallback failed (non-fatal):', e);
  }
  return null;
}

export function HomeWalkthrough({
  visible,
  onDismiss,
}: HomeWalkthroughProps) {
  const [phase, setPhase] = useState<Phase>('welcome');
  // Demo-Produkt — wird parallel zum Welcome-Render gefetched
  // damit die Spotlight-Phase ohne Loading-Lücke bereitsteht.
  // Wenn das Fetchen fehlschlägt, dismissen wir die Tour silent.
  const [demoProduct, setDemoProduct] =
    useState<FirestoreDocument<Produkte> | null>(null);
  const [demoFetchFailed, setDemoFetchFailed] = useState(false);

  // ─── Demo-Produkt fetchen ───────────────────────────────────
  useEffect(() => {
    if (!visible) {
      setDemoProduct(null);
      setDemoFetchFailed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const productId = await resolveDemoProductId();
        if (cancelled) return;
        if (!productId) {
          setDemoFetchFailed(true);
          return;
        }
        const product = await FirestoreService.getProductWithDetails(productId);
        if (cancelled) return;
        if (!product) {
          setDemoFetchFailed(true);
          return;
        }
        setDemoProduct(product as any);
      } catch (e) {
        if (!cancelled) {
          console.warn('Coachmark demo product fetch failed:', e);
          setDemoFetchFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Beim erneuten Sichtbarwerden (z.B. via Replay aus Dev-Panel)
  // immer auf der Welcome-Phase starten — sonst landet ein Replay
  // mitten im Spotlight ohne Kontext.
  useEffect(() => {
    if (visible) setPhase('welcome');
  }, [visible]);

  // Wenn der Fetch gescheitert ist UND wir gerade die Spotlight-
  // Phase betreten würden → Tour silent dismissen. Welcome-Phase
  // selbst ist unkritisch (zeigt nur Karten-Erklärung), also lassen
  // wir die laufen — der User kann sie skippen oder durchklicken
  // und kriegt im fail-Fall eben nur die Welcome-Karte.
  useEffect(() => {
    if (phase === 'spotlight' && demoFetchFailed) {
      onDismiss();
    }
  }, [phase, demoFetchFailed, onDismiss]);

  // ─── Auto-Dismiss bei Navigation weg vom Home ────────────────
  // Wenn User in der Spotlight-Phase die Demo-Karte tippt, fährt
  // navigation zum Detail-Screen, Home blurred. Wir nutzen den
  // Blur als "Tour erfolgreich beendet"-Signal.
  const visibleRef = useRef(visible);
  const phaseRef = useRef(phase);
  visibleRef.current = visible;
  phaseRef.current = phase;
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (visibleRef.current && phaseRef.current === 'spotlight') {
          onDismiss();
        }
      };
    }, [onDismiss]),
  );

  const startSpotlight = useCallback(() => {
    setPhase('spotlight');
  }, []);

  const handleTapDemoProduct = useCallback(() => {
    if (!demoProduct) {
      onDismiss();
      return;
    }
    // Navigation analog zur Logic in Home.handleProductPress:
    // niedrige Stufe (1-2) → noname-detail, höher → product-comparison.
    const stufeNum = parseInt(String((demoProduct as any).stufe ?? '1')) || 1;
    // Prefetch + push. Dismiss passiert automatisch via useFocusEffect
    // wenn der Screen blurred (siehe oben).
    if (stufeNum <= 2) {
      FirestoreService.prefetchProductDetails(demoProduct.id);
      router.push(`/noname-detail/${demoProduct.id}` as any);
    } else {
      FirestoreService.prefetchComparisonData(demoProduct.id, false);
      router.push(`/product-comparison/${demoProduct.id}?type=noname` as any);
    }
  }, [demoProduct, onDismiss]);

  if (!visible) return null;

  if (phase === 'welcome') {
    return <WelcomeCard onStart={startSpotlight} onSkip={onDismiss} />;
  }

  // Spotlight-Phase — wenn der Fetch noch läuft zeigen wir nichts
  // (Welcome ist bereits weg, Modal kommt sobald demoProduct da
  // ist). Falls der Fetch fehlschlägt, dismisst der Effect oben
  // die ganze Tour. In Praxis ist der Fetch beim Tap aufs
  // "Tour starten" meist schon durch (parallel zum Welcome-Render
  // gestartet → ~200-400 ms Round-Trip).
  if (!demoProduct) return null;

  return (
    <DemoProductSpotlight
      visible
      product={demoProduct}
      title="Tippe diese Karte"
      body="Du siehst gleich, wie nah die NoName-Alternative am Original ist — und wie viel du beim Wechsel sparst."
      onTapProduct={handleTapDemoProduct}
      onSkip={onDismiss}
    />
  );
}

// ─── Welcome-Card ────────────────────────────────────────────────
//
// Eine Karte, drei Bullet-Hinweise, zwei CTAs. Bewusst kein Pager
// — der Reizpunkt ist Rasch-zur-Aktion, nicht Lese-Lust.
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
              source={ROCKET_LOTTIE}
              autoPlay
              loop
              speed={0.85}
              style={{ width: 140, height: 140 }}
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
            Willkommen, Detektiv
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
            Markendetektive findet günstigere NoName-Alternativen zu deinen
            Lieblingsmarken.
          </Text>

          <View style={{ gap: 10, marginBottom: 18 }}>
            <BulletRow
              icon="medal-outline"
              tint={brand.primary}
              text="Stufen 1–5 zeigen, wie nah die Alternative am Original ist."
            />
            <BulletRow
              icon="alert-circle-outline"
              tint="#FF9800"
              text="Nicht jedes Markenprodukt hat eine NoName-Alternative — wir sagen dir welche."
            />
            <BulletRow
              icon="cash-multiple"
              tint="#4CAF50"
              text="Sparen lohnt sich doppelt: Punkte sammeln und echtes Cashback verdienen."
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
