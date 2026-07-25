import AsyncStorage from '@react-native-async-storage/async-storage';
import { CoachmarkService } from './coachmarkService';
import { ratingPromptService } from './ratingPrompt';

/**
 * firstCaseService — "Erster Fall geschlossen" → nativer Review
 * (ClickUp 86cav7gqm).
 *
 * ZWECK: den nativen In-App-Review-Dialog EINMAL anfragen, und zwar
 * genau dann, wenn der User seinen ersten echten Erfolg hatte UND der
 * Walk-Through durch ist. Beide Bedingungen sind persistent und
 * REIHENFOLGE-UNABHÄNGIG:
 *
 *   (a) Erstes ENTTARNTES Produkt (Stufe 3-5) gesehen → `markFirstCase`
 *       (egal ob via Walk-Through, Scan, Suche oder Direktlink)
 *   (b) Intro-Touren durch                 → `CoachmarkService.hasCompletedIntroTours()`
 *
 * ZWEI PHASEN, damit die Reihenfolge "erst Feier, dann Frage"
 * strukturell garantiert ist:
 *
 *   PHASE 1  shouldCelebrate → der Provider zeigt EINE eigene
 *            Glückwunsch-Feier (bannerDataFromFirstCase) und ruft
 *            markCelebrated. Der Banner geht durch die normale
 *            Banner-Queue, reiht sich also hinter etwaige andere
 *            Feiern ein und wird während eines Walkthroughs gequeued.
 *   PHASE 2  maybeRequestReview → verlangt eine verbuchte Feier und
 *            fragt dann den nativen Dialog an.
 *
 * WARUM NICHT AM ACHIEVEMENT-BANNER HÄNGEN: das generische
 * `first_action_any`-Achievement wird im Standard-Funnel bereits vom
 * Walkthrough-Demo-Tap verbraucht (Demo-Karte → Produktseite →
 * trackAction), also lange vor dem ersten eigenen Scan. Eine daran
 * gekoppelte Feier hätte im entscheidenden Moment gefehlt.
 *
 * WARUM DIE FEIER PFLICHT IST: ein Review-Dialog ohne vorangehenden
 * Erfolgsmoment ist genau das, wovor Apple und Google in ihren
 * Review-Guidelines warnen — und unser Budget (1×/App-Version) wäre
 * an einem beliebigen Moment verbrannt.
 *
 * WICHTIG: Alle Storage-Keys werden AUSSCHLIESSLICH hier gelesen/
 * geschrieben (Projekt-Regel: Keys nie direkt in Screens anfassen).
 */

const KEY_PREFIX = 'firstCase/v1/';
const CASE_KEY = (uid: string) => `${KEY_PREFIX}firstCaseAt_${uid}`;
const CELEBRATED_KEY = (uid: string) => `${KEY_PREFIX}celebratedAt_${uid}`;
const REVIEW_KEY = (uid: string) => `${KEY_PREFIX}reviewRequestedAt_${uid}`;

export type FirstCaseOutcome =
  | 'requested'
  | 'already'
  | 'no-user'
  | 'no-celebration'
  | 'gated'
  | 'unavailable'
  | 'busy';

// Synchroner Guard. Ein reiner Key-Check reicht NICHT: der Read ist
// async, und mehrere Ruhe-Kanten (Banner weg + Walkthrough-Ende +
// Bus-Tick) können im selben Tick re-evaluieren.
let inFlight = false;

type ArmedListener = () => void;
const armedListeners = new Set<ArmedListener>();

function emitArmed(): void {
  for (const fn of Array.from(armedListeners)) {
    try {
      fn();
    } catch (e) {
      console.warn('FirstCase armed listener threw (non-fatal):', e);
    }
  }
}

export const FirstCaseService = {
  /**
   * Der erste „gelöste Fall": das erste Mal, dass der User ein
   * ENTTARNTES Produkt (Stufe 3, 4 oder 5) vor sich hat — egal auf
   * welchem Weg: über den Walk-Through, per Scan, über die Suche oder
   * einen Direktlink.
   *
   * Bewusst NICHT mehr nur „Katalog-Treffer im Scanner" (so war es bis
   * 2026-07-25): der Aha-Moment ist, die Entsprechung zu SEHEN, nicht
   * der Scan-Vorgang. Wer über die Demo-Karte des Walk-Throughs oder
   * über die Suche dorthin kommt, hat denselben Moment.
   *
   * Stufe 1/2 zählt NICHT — dort gibt es keine Enttarnung zu zeigen.
   *
   * Idempotent — schreibt nur beim ersten Mal und feuert dann den Bus.
   * Der Emit läuft NACH dem Write (nicht `void write(); emit()`) —
   * sonst liest ein Listener, der sofort `maybeRequestReview` aufruft,
   * den Key noch als leer (bezahltes Learning, vgl.
   * `useCoachmark.dismiss` → awaitet `markSeen` vor dem visible-Flip).
   */
  async markFirstCase(uid?: string | null): Promise<void> {
    if (!uid) return; // Anon-Sign-In noch nicht durch → nächster Scan zieht
    try {
      const existing = await AsyncStorage.getItem(CASE_KEY(uid));
      if (existing) return;
      await AsyncStorage.setItem(CASE_KEY(uid), String(Date.now()));
      console.log('🔍 Erster Fall gelöst (Stufe 3+ gesehen) — Trigger gearmt');
      emitArmed();
    } catch (e) {
      console.warn('FirstCase markFirstCase failed (non-fatal):', e);
    }
  },

  /**
   * PHASE 1 — Darf jetzt gefeiert werden? Beide Bedingungen erfüllt,
   * noch nicht gefeiert, und der Review wäre auch tatsächlich möglich.
   *
   * Die Rating-Gates werden BEWUSST schon hier geprüft: eine Feier, auf
   * die keine Frage folgen kann, wäre ein sinnloser Banner — und der
   * Erst-Fall-Moment ist einmalig, wir wollen ihn nicht verbrennen,
   * während z.B. der 14-Tage-Cooldown eines Level-Up-Prompts läuft.
   */
  async shouldCelebrate(uid?: string | null): Promise<boolean> {
    if (!uid) return false;
    try {
      const [review, celebrated, scan] = await Promise.all([
        AsyncStorage.getItem(REVIEW_KEY(uid)),
        AsyncStorage.getItem(CELEBRATED_KEY(uid)),
        AsyncStorage.getItem(CASE_KEY(uid)),
      ]);
      if (review || celebrated) return false;
      if (!scan) return false;
      // Walk-Through. Abgebrochen/übersprungen zählt bewusst als
      // "durch": die Tour kommt nicht wieder, der User ist mit ihr
      // fertig. (Ein Gate auf `getSeenMode()==='completed'` wäre heute
      // ohnehin Fiktion — die Tour-Komponenten melden Skip und Fertig
      // teils identisch.)
      if (!(await CoachmarkService.hasCompletedIntroTours())) return false;
      // Rating-Hygiene (hasRated / 60-Tage-Dismiss / 1×-App-Version /
      // 14-Tage-Cooldown) liegt beim ratingPromptService — eine Quelle.
      return await ratingPromptService.canRequestNativeReview(uid);
    } catch (e) {
      console.warn('FirstCase shouldCelebrate failed (non-fatal):', e);
      return false;
    }
  },

  /**
   * Kommt die „Erster Fall"-Feier noch ODER ist sie gerade gelaufen?
   *
   * Zweck: der generische `first_action_any`-Achievement-Banner („Es
   * geht los!", +5 Punkte) sagt dasselbe wie unsere Feier, nur
   * schwächer — er wird unterdrückt, wenn unsere Feier den Moment
   * bereits trägt. Sonst sieht der User beim ersten Fall DREI Banner
   * hintereinander (Achievement + Level 2 + Feier), zusammen ~20 s.
   *
   * Bewusst auch dann `true`, wenn der Walk-Through noch läuft: sonst
   * würde der Achievement-Banner in die Queue wandern und nach der Tour
   * doch noch vor unserer Feier auftauchen. Die Punkte werden natürlich
   * trotzdem vergeben — nur der Banner entfällt.
   */
  async willCelebrate(uid?: string | null): Promise<boolean> {
    if (!uid) return false;
    try {
      if (await AsyncStorage.getItem(REVIEW_KEY(uid))) return false; // durch
      if (await AsyncStorage.getItem(CELEBRATED_KEY(uid))) return true; // lief
      if (!(await AsyncStorage.getItem(CASE_KEY(uid)))) return false;
      // Tour-Status bewusst NICHT prüfen (s.o.). Nur die Rating-Gates,
      // denn ohne sie gibt es gar keine Feier.
      return await ratingPromptService.canRequestNativeReview(uid);
    } catch {
      return false;
    }
  },

  /**
   * Feier verbucht (einmalig pro User). Wird gesetzt, sobald der Banner
   * präsentiert/eingereiht ist — bzw. auch dann, wenn der User
   * "Spielerische Inhalte" deaktiviert hat und es gar keinen Banner
   * gibt. Verhindert, dass die Feier in einer späteren Session erneut
   * aufpoppt.
   */
  async markCelebrated(uid: string): Promise<void> {
    try {
      await AsyncStorage.setItem(CELEBRATED_KEY(uid), String(Date.now()));
    } catch (e) {
      console.warn('FirstCase markCelebrated failed (non-fatal):', e);
    }
  },

  /**
   * PHASE 2 — Nach der Feier den nativen Dialog anfragen.
   *
   * Voraussetzung ist eine verbuchte Feier: der Prompt darf NIE
   * kontextfrei erscheinen (z.B. 2 s nach einem Kaltstart auf dem
   * Home-Screen) — genau davor warnen die Store-Guidelines, und unser
   * 1×-pro-App-Version-Budget wäre verbrannt.
   *
   * Jeder Abbruch verbraucht NICHTS — die nächste Ruhe-Kante versucht
   * es erneut. Das ist der entscheidende Unterschied zum alten
   * Armed-Flag, das auch dann als "verbraucht" galt, wenn die Gates
   * die Anzeige verhindert hatten.
   */
  async maybeRequestReview(uid?: string | null): Promise<FirstCaseOutcome> {
    if (!uid) return 'no-user';
    if (inFlight) return 'busy';
    inFlight = true;
    try {
      if (await AsyncStorage.getItem(REVIEW_KEY(uid))) return 'already';
      if (!(await AsyncStorage.getItem(CELEBRATED_KEY(uid)))) return 'no-celebration';
      if (!(await ratingPromptService.canRequestNativeReview(uid))) return 'gated';

      // Erst hier wird tatsächlich gefragt. Schlägt es fehl (Sheet
      // offen, App im Hintergrund, Modul fehlt), setzen wir den Key
      // NICHT → späterer Retry bleibt möglich.
      const ok = await ratingPromptService.requestNativeReviewNow(uid);
      if (!ok) return 'unavailable';

      await AsyncStorage.setItem(REVIEW_KEY(uid), String(Date.now()));
      return 'requested';
    } catch (e) {
      console.warn('FirstCase maybeRequestReview failed (non-fatal):', e);
      return 'unavailable';
    } finally {
      inFlight = false;
    }
  },

  /** Bus: feuert, wenn der Erst-Erfolg frisch verbucht wurde. */
  onArmed(listener: ArmedListener): () => void {
    armedListeners.add(listener);
    return () => {
      armedListeners.delete(listener);
    };
  },

  /** Dev-Panel: Trigger komplett zurücksetzen. */
  async reset(uid: string): Promise<void> {
    try {
      await AsyncStorage.multiRemove([CASE_KEY(uid), CELEBRATED_KEY(uid), REVIEW_KEY(uid)]);
      console.log('🧹 FirstCase-State zurückgesetzt');
    } catch (e) {
      console.warn('FirstCase reset failed (non-fatal):', e);
    }
  },

  /** Dev-Panel: aktueller Zustand, für den Status-Alert. */
  async getDebugState(uid: string): Promise<{
    scanSuccessAt: string | null;
    celebratedAt: string | null;
    reviewRequestedAt: string | null;
    introToursDone: boolean;
    ratingGatesOpen: boolean;
  }> {
    const [scan, celebrated, review] = await Promise.all([
      AsyncStorage.getItem(CASE_KEY(uid)),
      AsyncStorage.getItem(CELEBRATED_KEY(uid)),
      AsyncStorage.getItem(REVIEW_KEY(uid)),
    ]);
    const toIso = (v: string | null) =>
      v ? new Date(Number(v)).toISOString() : null;
    return {
      scanSuccessAt: toIso(scan),
      celebratedAt: toIso(celebrated),
      reviewRequestedAt: toIso(review),
      introToursDone: await CoachmarkService.hasCompletedIntroTours(),
      ratingGatesOpen: await ratingPromptService.canRequestNativeReview(uid),
    };
  },
};
