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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { CoachmarkService, TourKey } from '@/lib/services/coachmarkService';

// Mirror der AsyncStorage-Keys aus `onboardingService.ts` damit wir
// hier nicht abhängig vom Service selbst sind (zirkuläre Imports
// vermeiden, der Service hat dynamic imports).
//
// WICHTIG: User die das Onboarding via "Später"-Button auf dem
// Hero-Screen skippen, kriegen NUR `onboarding_v1_skipped` gesetzt
// — NICHT `completed`. Der Hook muss daher BEIDE Flags akzeptieren
// (entspricht `OnboardingService.hasPassedOnboarding()`-Semantik),
// sonst sehen Skip-User die Welcome-Tour nie. Das war ein Bug —
// eine Skip-Geste sollte nicht alle weiteren Tutorials blockieren.
const ONBOARDING_COMPLETED_KEY = 'onboarding_v1_completed';
const ONBOARDING_SKIPPED_KEY = 'onboarding_v1_skipped';

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
          const [seen, completed, skipped] = await Promise.all([
            CoachmarkService.getSeen(tour),
            AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY),
            AsyncStorage.getItem(ONBOARDING_SKIPPED_KEY),
          ]);
          if (cancelled || localShown) return;
          // Hard-Block: Onboarding muss durch sein (egal ob
          // abgeschlossen oder geskipped — siehe Block-Kommentar
          // bei den Konstanten oben).
          const hasPassedOnboarding =
            completed === 'true' || skipped === 'true';
          if (__DEV__) {
            console.log(
              `🎯 useCoachmark[${tour}]: seen=${seen} completed=${completed} skipped=${skipped} → hasPassedOnboarding=${hasPassedOnboarding}`,
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

  const dismiss = useCallback(() => {
    setVisible(false);
    void CoachmarkService.markSeen(tour);
  }, [tour]);

  const forceClose = useCallback(() => {
    setVisible(false);
  }, []);

  return { visible, dismiss, forceClose };
}
