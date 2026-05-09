// components/design/FloatingShoppingListButton.tsx
//
// Schwebender "Einkaufszettel"-Schnellzugriff. Erscheint unten rechts
// und navigiert zu /shopping-list. Optisch übernommen von der alten
// Homepage (rounded square, primary green, gefüllter Cart-Glyph), aber
// in das neue Design-System getunt:
//   • brand.primary BG mit `shadows.lg`
//   • 56×56 (square, identisch zur raised Stöbern-Tab-Mitte —
//     gleiche Höhe, gleiche Breite, gleiche Icon-Größe 30, sodass
//     beide Buttons als visuelles Paar wahrgenommen werden)
//   • borderRadius 18 (radii.xl — match Cart-FAB-Sizing-Rule:
//     prominent Container → 18, siehe CLAUDE.md "Border radii")
//   • MaterialCommunityIcons "cart" Size 30 (entspricht dem alten
//     cart.fill, gleiche visuelle Größe wie Stöbern's iconBlack-30)
//   • Light-Haptic beim Drücken
//   • Pressed-State: nur die BG-Farbe wird dunkler (brand.primaryDark)
//     + minimaler Scale-Down — KEIN Opacity-Tween auf dem ganzen Button,
//     sonst wird das Icon mit-durchsichtig und sieht ausgegraut aus.
//   • Counter-Pill oben rechts: Live-Anzahl der "noch zu kaufenden"
//     Einträge (`gekauft == false`) im Einkaufszettel des aktuellen
//     Users. Asynchron geladen via Firestore onSnapshot — bei keinem
//     User oder leerem Wagen wird die Pill ausgeblendet, der Render
//     der Hauptkomponente wartet NIE auf das Listener-Resultat.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { safePush } from '@/lib/utils/safeNav';
import React from 'react';
import { Pressable, View } from 'react-native';

import { CounterBadge } from '@/components/design/CounterBadge';
import { Shimmer } from '@/components/design/Skeletons';
import { useTokens } from '@/hooks/useTokens';
import { useShoppingCartCount } from '@/lib/hooks/useShoppingCartCount';

type Props = {
  /** Pixels from the bottom edge of the screen. Default 100 (tab-page). */
  bottomOffset?: number;
  /** Pixels from the right edge. Default 20. */
  rightOffset?: number;
};

export function FloatingShoppingListButton({
  bottomOffset = 100,
  rightOffset = 20,
}: Props) {
  const { brand: brandTokens, shadows } = useTokens();

  // Live-Counter via shared hook — siehe lib/hooks/useShoppingCartCount.
  // Während des initialen Loads zeigen wir einen Shimmer-Skeleton in
  // derselben Pill-Form, damit die Pill nicht später blinkend
  // reinpoppt.
  const { count, loading } = useShoppingCartCount();

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    safePush('/shopping-list');
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={
        count > 0
          ? `Einkaufszettel öffnen, ${count} ${count === 1 ? 'Eintrag' : 'Einträge'}`
          : 'Einkaufszettel öffnen'
      }
      style={({ pressed }) => ({
        position: 'absolute',
        bottom: bottomOffset,
        right: rightOffset,
        width: 56,
        height: 56,
        borderRadius: 18,
        // Nur die Farbe ändert sich beim Drücken — Icon und Counter
        // bleiben volle Opacity (sieht sauberer aus als ein
        // durchsichtiger Button).
        backgroundColor: pressed ? brandTokens.primaryDark : brandTokens.primary,
        alignItems: 'center',
        justifyContent: 'center',
        // Sehr dezenter Press-Down-Tap, keine Größenänderung am Icon.
        transform: [{ scale: pressed ? 0.97 : 1 }],
        ...shadows.lg,
      })}
    >
      <MaterialCommunityIcons name="cart" size={30} color="#fff" />

      {/* Counter-Pill oben rechts.
          - Während des initialen Loads: Shimmer-Skeleton in derselben
            Pill-Form (24×20, weißer BG, primary-grüner Border) — der
            User sieht "hier kommt gleich was", ohne dass die Pill
            später blinkend reinpoppt.
          - Nach Snapshot: Zahl (1–99 oder "99+"). Bei count === 0
            wird gar nichts gerendert — leere Liste = blanker FAB.
          Negative Top/Right damit Pill/Skeleton ein Stück über die
          FAB-Kante hinausragen (klassischer Badge-Look). */}
      {loading ? (
        <View
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: brandTokens.primary,
            backgroundColor: '#fff',
            overflow: 'hidden',
          }}
        >
          <Shimmer width="100%" height={16} radius={8} />
        </View>
      ) : (
        <CounterBadge count={count} />
      )}
    </Pressable>
  );
}
