// CoachmarkScrollContext — gibt der Coachmark-Spotlight-Engine
// Zugriff auf den Scroll-State und die ScrollView ihres Parent-
// Screens. Damit kann das Spotlight die Position seines Targets
// MATHEMATISCH herleiten statt sie via Timer + Remeasure abzu-
// stochern.
//
// Konzept:
//
//   • Jeder Anchor wird relativ zum ScrollView-Content gemessen
//     (`measureLayout` mit ScrollView als parent). Diese Position
//     ist STABIL — sie ändert sich nicht wenn der User scrollt.
//
//   • Der Spotlight subscribed zum `scrollY` SharedValue. Position
//     im Window-Space wird auf jedem Frame berechnet:
//
//       windowY = anchor.layoutY - scrollY.value + scrollViewWindowOffsetY
//
//   • Wenn der User scrollt während die Tour läuft, wandert das
//     Spotlight smooth mit (Reanimated UI-Thread, keine JS-Bridge-
//     Roundtrips). Wenn die Tour-Engine selbst auto-scrollt, das
//     Gleiche — kein Stale-Rect, kein Flackern, keine Timer.
//
//   • Cross-Device: kein hardcoded Pixel-Offset, keine geratenen
//     Animations-Dauern. Funktioniert auf jedem Screen-Format
//     gleich, weil die Math's auf relativen Größen arbeitet.
//
// Wenn ein Screen den Provider NICHT setzt, fallen Anchor + Spotlight
// auf das ältere `measureInWindow`-Pattern zurück (1× messen, kein
// Live-Tracking). Das ist OK für statische Layouts wo kein Scroll
// involviert ist.

import React, { createContext, useContext, useMemo } from 'react';
import type { ScrollView } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

export type CoachmarkScrollContextValue = {
  /** SharedValue des aktuellen vertical scroll-offset der parent ScrollView. */
  scrollY: SharedValue<number>;
  /** Ref auf die ScrollView selbst — wird für `measureLayout` gebraucht. */
  scrollViewRef: React.RefObject<ScrollView | null>;
};

const CoachmarkScrollContextInstance = createContext<CoachmarkScrollContextValue | null>(
  null,
);

export type CoachmarkScrollProviderProps = {
  scrollY: SharedValue<number>;
  scrollViewRef: React.RefObject<ScrollView | null>;
  children: React.ReactNode;
};

export function CoachmarkScrollProvider({
  scrollY,
  scrollViewRef,
  children,
}: CoachmarkScrollProviderProps) {
  // Stabile Identität für den Context-Value — vermeidet unnötige
  // Re-Renders aller Consumer wenn der Provider re-rendert ohne
  // dass scrollY oder scrollViewRef sich geändert haben.
  const value = useMemo<CoachmarkScrollContextValue>(
    () => ({ scrollY, scrollViewRef }),
    [scrollY, scrollViewRef],
  );
  return (
    <CoachmarkScrollContextInstance.Provider value={value}>
      {children}
    </CoachmarkScrollContextInstance.Provider>
  );
}

/**
 * Liefert den aktuellen Scroll-Context, oder `null` wenn kein
 * Provider darüber sitzt. Hooks die das `null` korrekt behandeln
 * können fallen dann auf measureInWindow zurück.
 */
export function useCoachmarkScrollContext(): CoachmarkScrollContextValue | null {
  return useContext(CoachmarkScrollContextInstance);
}
