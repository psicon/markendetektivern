// components/design/FloatingShoppingListButton.tsx
//
// Schwebender "Einkaufszettel"-Schnellzugriff. Erscheint unten rechts
// und navigiert zu /shopping-list. Optisch übernommen von der alten
// Homepage (rounded square, primary green, gefüllter Cart-Glyph), aber
// in das neue Design-System getunt:
//   • brand.primary BG mit `shadows.lg`
//   • 56×56, borderRadius 16
//   • MaterialCommunityIcons "cart" (entspricht dem alten cart.fill)
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
import { router } from 'expo-router';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Shimmer } from '@/components/design/Skeletons';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/contexts/AuthContext';

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
  const { user } = useAuth();

  // Live-Counter — onSnapshot über die `einkaufswagen`-Subcollection
  // des Users, gefiltert auf `gekauft == false`. Listener bleibt aktiv
  // solange die Komponente gemounted ist; löst sich beim User-Wechsel
  // (uid in Dependency) und beim Unmount sauber wieder.
  //
  // `loading` steuert zusätzlich, ob die Counter-Pill als Shimmer-
  // Skeleton angezeigt wird (initial Render, vor erstem Snapshot)
  // oder mit der echten Zahl. Sobald der erste Snapshot da ist, gilt
  // loading=false dauerhaft. Bei User-Wechsel resetten wir wieder auf
  // loading=true, damit die nächste Liste auch wieder mit Shimmer
  // anfängt statt mit dem letzten Stand.
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  useEffect(() => {
    if (!user?.uid) {
      setCount(0);
      // Ohne User gibt es nichts zu laden — Skeleton aus, Pill bleibt
      // ohnehin versteckt (count === 0).
      setLoading(false);
      return;
    }
    setLoading(true);
    const userRef = doc(db, 'users', user.uid);
    const q = query(
      collection(userRef, 'einkaufswagen'),
      where('gekauft', '==', false),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setCount(snap.size);
        setLoading(false);
      },
      (err) => {
        // Fehler still wegloggen — Counter ist Komfort, der FAB
        // funktioniert auch ohne. Loading auf false damit das
        // Skeleton nicht ewig flimmert.
        console.warn('FloatingShoppingListButton: snapshot error', err);
        setLoading(false);
      },
    );
    return () => {
      unsub();
    };
  }, [user?.uid]);

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/shopping-list' as any);
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
        borderRadius: 16,
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
      <MaterialCommunityIcons name="cart" size={24} color="#fff" />

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
            width: 24,
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
      ) : count > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 6,
            borderRadius: 10,
            backgroundColor: '#fff',
            borderWidth: 2,
            borderColor: brandTokens.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 11,
              lineHeight: 13,
              color: brandTokens.primary,
              textAlign: 'center',
              includeFontPadding: false as any,
            }}
          >
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
