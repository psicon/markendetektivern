// useCoachmark — Hook der entscheidet, ob ein per-Screen-Coachmark
// JETZT angezeigt werden soll, und an die Replay-Bridge des
// CoachmarkService anbindet.
//
// ─── Verhaltensregeln ────────────────────────────────────────────
//
// 1. **Auto-open Re-Check via useFocusEffect.** Bei JEDEM Focus
//    des Screens prüft der Hook, ob die Tour aktuell gezeigt
//    werden soll. Das ist robuster als ein One-Shot-Mount-Effekt:
//    wenn der User aus dem Onboarding kommt und Home ZUM ERSTEN
//    MAL fokussiert wird, war Home evtl. vorher schon mal kurz
//    gemountet (z.B. als Default-Tab unter dem Onboarding-Stack)
//    und ein One-Shot-Effekt wäre da schon "verbrannt" worden,
//    bevor die Onboarding-Completion-Bedingung gilt.
//
//    `localShown` (session-state) verhindert, dass der Hook bei
//    jedem Tab-Wechsel die Tour neu öffnet — er feuert genau
//    EINMAL pro Mount-Lifecycle, aber ERST DANN wenn alle
//    Bedingungen erfüllt sind.
//
// 2. **Hard-Block via Onboarding-Status.** Wenn das ältere
//    `onboarding_v1_completed`-Flag NICHT gesetzt ist, zeigen wir
//    KEINE Coachmarks. Sonst spielt der User parallel zwei
//    Tutorials.
//
// 3. **Replay-Channel.** Der Profil-Dev-Panel kann per
//    `CoachmarkService.requestReplay('home')` einen Hook der
//    gerade montiert ist zum sofortigen Anzeigen zwingen — auch
//    wenn die Tour als gesehen markiert ist.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { CoachmarkService, TourKey } from '@/lib/services/coachmarkService';

// 2026-05-22: Direkter AsyncStorage-Touch entfernt — wir routen
// jetzt durch `OnboardingService.hasPassedOnboarding()` (Single
// Source of Truth, siehe CLAUDE.md Best Practices). Der Service
// liest jetzt ein Enum-Feld `onboarding_v2_status` und migriert
// alte v1-Booleans transparent.
import { OnboardingService } from '@/lib/services/onboardingService';

export type UseCoachmarkResult = {
  /** Soll das Overlay aktuell sichtbar sein? */
  visible: boolean;
  /** Schließt das Overlay UND markiert als gesehen. */
  dismiss: () => void;
  /** Schließt OHNE als gesehen zu markieren. Aktuell unused. */
  forceClose: () => void;
};

export function useCoachmark(tour: TourKey): UseCoachmarkResult {
  const [visible, setVisible] = useState(false);
  // "Local" = innerhalb dieses Mount-Lifecycle. Wenn wir die Tour
  // einmal gezeigt haben (egal ob durch Auto-Open oder Replay),
  // sperren wir Auto-Open für die Dauer dieses Mounts. Bei einem
  // Unmount/Remount-Zyklus startet das wieder bei false → wir
  // lesen erneut AsyncStorage.
  const [localShown, setLocalShown] = useState(false);

  // ─── Auto-Open mit Re-Check via Focus ────────────────────────
  //
  // useFocusEffect läuft bei jedem Screen-Focus. Wir prüfen die
  // AsyncStorage-Bedingungen erneut — falls der User in der
  // Zwischenzeit das Onboarding abgeschlossen hat (Übergang
  // null → 'true'), greift das hier.
  useFocusEffect(
    useCallback(() => {
      if (localShown) return;
      let cancelled = false;
      (async () => {
        try {
          const [seen, hasPassedOnboarding] = await Promise.all([
            CoachmarkService.getSeen(tour),
            OnboardingService.hasPassedOnboarding(),
          ]);
          if (cancelled || localShown) return;
          // Hard-Block: Onboarding muss durch sein (Climax erreicht
          // ODER bewusst geskippt — Service abstrahiert das).
          if (__DEV__) {
            console.log(
              `🎯 useCoachmark[${tour}]: seen=${seen} hasPassedOnboarding=${hasPassedOnboarding}`,
            );
          }
          if (!hasPassedOnboarding) return;
          if (seen) return;
          // Kleiner Delay damit Screen-Render + Skeletons abklingen
          // bevor wir ein Modal drüberlegen.
          setTimeout(() => {
            if (!cancelled && !localShown) {
              if (__DEV__) {
                console.log(`🎯 useCoachmark[${tour}]: opening tour`);
              }
              setVisible(true);
              setLocalShown(true);
            }
          }, 600);
        } catch (e) {
          console.warn('useCoachmark auto-open check failed (non-fatal):', e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [tour, localShown]),
  );

  // ─── Replay-Listener ─────────────────────────────────────────
  //
  // Replay zwingt das Overlay auf, unabhängig vom Seen-Status oder
  // localShown. Setzt aber localShown = true sodass Auto-Open
  // danach nicht erneut feuert (sonst doppelte Show-Animation).
  useEffect(() => {
    const off = CoachmarkService.onReplayRequest((requested) => {
      if (requested !== tour) return;
      setVisible(true);
      setLocalShown(true);
    });
    return off;
  }, [tour]);

  const dismiss = useCallback(async (mode: 'completed' | 'skipped' = 'completed') => {
    // T17.14: AWAIT markSeen damit AsyncStorage-Write fertig ist BEVOR
    // setVisible(false) den next-effect-cycle in einem Caller triggert.
    // Vorher Race: Demographics-useEffect fragte getSeen('home') sofort
    // nach visible→false, das markSeen war aber noch async pending →
    // getSeen returnte false → Sheet wurde nicht gezeigt. Jetzt:
    // Storage erst persistiert, dann visible-flip.
    try {
      await CoachmarkService.markSeen(tour, mode);
    } catch (e) {
      console.warn('Coachmark dismiss markSeen failed (non-fatal):', e);
    }
    setVisible(false);
  }, [tour]);

  const forceClose = useCallback(() => {
    setVisible(false);
  }, []);

  return { visible, dismiss, forceClose };
}
