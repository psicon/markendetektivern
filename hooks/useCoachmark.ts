// useCoachmark — Hook der entscheidet, ob ein per-Screen-Coachmark
// JETZT angezeigt werden soll, und an die Replay-Bridge des
// CoachmarkService anbindet.
//
// Verhaltensregeln:
//
// 1. **Nur ein Coachmark pro Screen-Mount automatisch öffnen.**
//    Beim ersten Mount wird AsyncStorage gelesen; wenn die Tour
//    noch NICHT gesehen wurde UND das bestehende Onboarding
//    abgeschlossen ist, geht `visible: true` ON.
//
// 2. **Hard-Block via Onboarding-Status.** Wenn das ältere
//    `onboarding_v1_completed`-Flag NICHT gesetzt ist (User hat das
//    Daten-Erhebungs-Onboarding noch nicht durch), zeigen wir KEINE
//    Coachmarks. Sonst spielt der User parallel zwei Tutorials.
//    Wer das Onboarding via "Später"-Button skippt, fällt auch in
//    diesen Block — ist gewollt: Skip-Quitter wollen typischerweise
//    auch keine UI-Tutorials.
//
// 3. **Replay-Channel:** der Profil-Dev-Panel kann per
//    `CoachmarkService.requestReplay('home')` einen Hook der gerade
//    montiert ist zum sofortigen Anzeigen zwingen — auch wenn die
//    Tour als gesehen markiert ist.
//
// 4. **Keine `await import('react-native')`** — alle RN-imports
//    statisch (siehe CLAUDE.md, der Trick crasht via
//    PushNotificationIOS-getter).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CoachmarkService, TourKey } from '@/lib/services/coachmarkService';

// Mirror der AsyncStorage-Keys aus `onboardingService.ts` damit wir
// hier nicht abhängig vom Service selbst sind (zirkuläre Imports
// vermeiden, der Service hat dynamic imports).
const ONBOARDING_COMPLETED_KEY = 'onboarding_v1_completed';

export type UseCoachmarkResult = {
  /** Soll das Overlay aktuell sichtbar sein? */
  visible: boolean;
  /** Schließt das Overlay UND markiert als gesehen. */
  dismiss: () => void;
  /**
   * Schließt das Overlay OHNE als gesehen zu markieren —
   * bewusst nur intern verwendet (z.B. wenn User die App pausiert).
   * Aktuell nicht exposed; wird im Profil-Dev-Panel-Replay-Path
   * relevant wenn wir entscheiden dass Replays nicht "doppelt
   * markieren" sollen.
   */
  forceClose: () => void;
};

export function useCoachmark(tour: TourKey): UseCoachmarkResult {
  const [visible, setVisible] = useState(false);
  // Verhindert doppeltes "auto-open" wenn der Effect aus irgendeinem
  // Grund neu feuert (HMR, dependencies-Änderung). Auto-Open passiert
  // genau einmal pro Mount-Lifecycle; danach geht's nur noch über
  // Replay-Events oder dismiss/forceClose.
  const autoOpenedRef = useRef(false);

  // ─── Auto-Open beim ersten Mount ─────────────────────────────────
  useEffect(() => {
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const [seen, onboardingDone] = await Promise.all([
          CoachmarkService.getSeen(tour),
          AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY),
        ]);
        if (cancelled) return;
        // Hard-Block: nur wenn Onboarding wirklich abgeschlossen ist.
        if (onboardingDone !== 'true') return;
        if (seen) return;
        // Kleiner Delay damit Screen-Render + Skeletons abklingen
        // bevor wir ein Modal drüberlegen — kein Frame-Konflikt mit
        // dem Crossfade aus den Detail-Screens.
        setTimeout(() => {
          if (!cancelled) setVisible(true);
        }, 600);
      } catch (e) {
        console.warn('useCoachmark auto-open check failed (non-fatal):', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tour]);

  // ─── Replay-Listener ─────────────────────────────────────────────
  useEffect(() => {
    const off = CoachmarkService.onReplayRequest((requested) => {
      if (requested !== tour) return;
      // Replay zwingt das Overlay auf, unabhängig vom Seen-Status.
      // Wenn es schon offen ist, bleibt es offen (kein Toggle).
      setVisible(true);
    });
    return off;
  }, [tour]);

  const dismiss = useCallback(() => {
    setVisible(false);
    // markSeen async — kein await, UX soll direkt schließen.
    void CoachmarkService.markSeen(tour);
  }, [tour]);

  const forceClose = useCallback(() => {
    setVisible(false);
  }, []);

  return { visible, dismiss, forceClose };
}
