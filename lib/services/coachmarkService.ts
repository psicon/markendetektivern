// Coachmark Service — Per-Screen-Erklär-Tours, NICHT zu verwechseln
// mit dem bestehenden Onboarding-Service (`onboardingService.ts`).
//
// Klare Abgrenzung:
//   • `onboardingService` steuert den 9-Step-Daten-Erhebungs-Flow
//     der VOR der ersten App-Nutzung läuft (Land, Märkte, Budget,
//     Prioritäten). Daten landen auf `users/{uid}` und in
//     `onboardingResultsV5/{sessionId}`.
//   • `coachmarkService` (DIESER File) steuert die kleinen
//     Erklär-Overlays die WÄHREND der App-Nutzung beim ERSTEN
//     Besuch jedes Hauptscreens auftauchen ("Hier ist Stöbern, das
//     macht es"). Daten: nur ein Boolean pro Screen.
//
// Keys werden in AsyncStorage als ISO-Timestamps abgelegt — der
// Timestamp ist auch der "gesehen"-Marker (wenn Wert da, gilt als
// gesehen). Das gibt uns gratis die "wann wurde Tour zuletzt
// gesehen?"-Anzeige für den Dev-Panel ohne extra Schema.

import AsyncStorage from '@react-native-async-storage/async-storage';

// Versionsuffix damit wir später Tours inhaltlich überarbeiten und
// gezielt erneut ausspielen können (`v2` zwingt jeden User die
// Tour nochmal zu sehen, ohne alle anderen v1-States zu berühren).
export const COACHMARK_VERSION = 'v1';

// Tour-Inventar — bewusst klein gehalten:
//
//   • 'home'    — Welcome-Card + Spotlight auf erste Enttarnt-Karte.
//                 User tappt die Karte (durch Spotlight-Cutout) →
//                 navigiert zum Detail/Vergleich → Tour ist fertig.
//                 Aktiviert "Activation Through First Successful
//                 Action"-Pattern: User erlebt direkt was die App
//                 macht statt es zu lesen.
//   • 'rewards' — 3-Karten-Modal beim ersten Tap auf Belohnungen.
//                 Erklärt Punkte vs. Taler, Auszahlung, Bestenliste.
//                 Eigenes Stück weil das Konzept tiefer ist als
//                 ein Spotlight tragen kann.
//
// Keine Touren auf Stöbern / Einkaufszettel / Errungenschaften —
// die Screens sind selbsterklärend genug, und mehr Tutorials =
// mehr Wartung + niedrigere Completion-Rate (siehe NN/g-Research).
// Kontextuelle Hints inline (z.B. Swipe-Erinnerung im Cart) wären
// die Best-Practice-Ergänzung — separat von dieser Service-Schicht.
export type TourKey = 'home' | 'rewards';

export const ALL_TOUR_KEYS: TourKey[] = ['home', 'rewards'];

// Storage-Key-Präfix — Namespace ist bewusst NICHT `onboarding/*`
// damit Search/Grep für Onboarding-Code keinen Treffer hier
// fälschlich mit-anzieht.
const STORAGE_PREFIX = `coachmark/${COACHMARK_VERSION}/`;

const storageKeyFor = (tour: TourKey) => `${STORAGE_PREFIX}${tour}`;

// ─── Replay-Event-Bus ─────────────────────────────────────────────
//
// Pure JS pub/sub — kein RN-EventEmitter, keine Native Bridge. Wir
// brauchen ihn nur damit der Profil-Dev-Panel "Tour X jetzt zeigen"
// triggern kann ohne dass der User erst zum jeweiligen Screen
// navigieren muss. Der useCoachmark-Hook abonniert; sein
// Render-Cycle übernimmt die UI.

type ReplayListener = (tour: TourKey) => void;
const listeners = new Set<ReplayListener>();

function emit(tour: TourKey) {
  // Synchron feuern — Listener (useCoachmark Hook) setzt nur State,
  // also sehr cheap; kein need für queueMicrotask oder Promise.resolve.
  for (const fn of Array.from(listeners)) {
    try {
      fn(tour);
    } catch (e) {
      console.warn('Coachmark replay listener threw (non-fatal):', e);
    }
  }
}

export const CoachmarkService = {
  /**
   * War diese Tour schon gesehen? `true` wenn ein Timestamp
   * gespeichert ist, sonst `false`.
   */
  async getSeen(tour: TourKey): Promise<boolean> {
    try {
      const v = await AsyncStorage.getItem(storageKeyFor(tour));
      return !!v;
    } catch {
      // AsyncStorage-Fehler darf nicht die App blockieren — wir
      // tun so als wäre die Tour gesehen, sonst hängt der User in
      // einer Endlosschleife aus Tour-Overlays.
      return true;
    }
  },

  /**
   * Tour als gesehen markieren. Speichert den ISO-Zeitpunkt;
   * der Wert ist sowohl Marker ("gesehen") als auch Daten ("wann").
   */
  async markSeen(tour: TourKey): Promise<void> {
    try {
      await AsyncStorage.setItem(storageKeyFor(tour), new Date().toISOString());
    } catch (e) {
      console.warn('Coachmark markSeen failed (non-fatal):', e);
    }
  },

  /**
   * Liefert für jede Tour den ISO-Timestamp wann sie gesehen wurde,
   * `null` wenn noch nicht. Gedacht für den Dev-Panel im Profil.
   */
  async getAllStatus(): Promise<Record<TourKey, string | null>> {
    const out = {} as Record<TourKey, string | null>;
    try {
      const entries = await Promise.all(
        ALL_TOUR_KEYS.map(async (k) => {
          try {
            const v = await AsyncStorage.getItem(storageKeyFor(k));
            return [k, v ?? null] as const;
          } catch {
            return [k, null] as const;
          }
        }),
      );
      for (const [k, v] of entries) out[k] = v;
    } catch {
      // Fallback: alle als nicht-gesehen melden
      for (const k of ALL_TOUR_KEYS) out[k] = null;
    }
    return out;
  },

  /**
   * Eine einzelne Tour zurücksetzen — zeigt sie beim nächsten Mount
   * dieses Screens wieder.
   */
  async resetOne(tour: TourKey): Promise<void> {
    try {
      await AsyncStorage.removeItem(storageKeyFor(tour));
    } catch (e) {
      console.warn('Coachmark resetOne failed (non-fatal):', e);
    }
  },

  /**
   * Alle Coachmarks zurücksetzen. Berührt NICHT den Onboarding-
   * Service (`onboarding_v1_completed`-Flag) — die zwei sind
   * komplett getrennte States.
   */
  async resetAll(): Promise<void> {
    try {
      await AsyncStorage.multiRemove(ALL_TOUR_KEYS.map(storageKeyFor));
    } catch (e) {
      console.warn('Coachmark resetAll failed (non-fatal):', e);
    }
  },

  /**
   * Bittet den passenden Hook, die Tour SOFORT zu zeigen — auch wenn
   * sie schon gesehen wurde. Verwendet vom Profil-Dev-Panel.
   * Wenn der Hook für diese Tour aktuell nicht montiert ist
   * (User ist gerade nicht auf dem Screen) — siehe README in der
   * Hook-Datei für die Empfehlung erst zu navigieren und dann zu
   * triggern. Dieser Service-Call selbst ist immer sicher.
   */
  requestReplay(tour: TourKey): void {
    emit(tour);
  },

  /**
   * Listener-Registrierung — Hook abonniert beim Mount, deregistriert
   * beim Unmount.
   */
  onReplayRequest(listener: ReplayListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
