import AsyncStorage from '@react-native-async-storage/async-storage';
import { CoachmarkService } from './coachmarkService';
import { ratingPromptService } from './ratingPrompt';
import type { RatingTrigger } from './ratingTelemetry';
import { RatingTelemetry } from './ratingTelemetry';

/**
 * firstCaseService — "Erster Fall geschlossen" → nativer Review
 * (ClickUp 86cav7gqm).
 *
 * ZWECK: den nativen In-App-Review-Dialog EINMAL anfragen, und zwar
 * genau dann, wenn der User seinen ersten echten Erfolg hatte UND der
 * Walk-Through durch ist. Beide Bedingungen sind persistent und
 * REIHENFOLGE-UNABHÄNGIG:
 *
 *   (a) Produktseite gesehen, ALLE Stufen 1-5 → `markFirstCase`
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

/**
 * Alle Schlüssel sind VERSIONS-GEBUNDEN.
 *
 * Vorher galten sie pro uid und damit für immer: `markFirstCase` schrieb
 * genau einmal, `reviewRequestedAt` blockierte danach dauerhaft. Für die
 * Bestandsbasis hieß das — eine einzige Welle, danach nie wieder. Wer den
 * Moment verpasste (Sheet offen, App im Hintergrund, OS-Drosselung), war
 * für immer raus, und die 251.747 registrierten Nutzer wären nach genau
 * einem Durchlauf verbraucht gewesen.
 *
 * Mit der Version im Schlüssel schärft sich der Auslöser bei jedem
 * Release neu. Das ist der Takt für „nach und nach": ~12 Wellen im Jahr,
 * von denen Apple ohnehin nur 3 durchlässt (max. 3 Aufforderungen pro
 * Nutzer und Jahr) und unser 14-Tage-Cooldown die Frequenz zusätzlich
 * deckelt. Wir bauen also keinen eigenen Kampagnen-Mechanismus — wir
 * hören auf, uns nach der ersten Welle selbst zu blockieren.
 *
 * Der Riegel gegen Doppel-Prompts bleibt unverändert wirksam: er sitzt in
 * `ratingPrompt` (`nativeReviewAskedVersion_global`, geräteweit + uid-frei)
 * und nutzt dieselbe Versionsquelle.
 */
function appVersion(): string {
  try {
    const Application = require('expo-application');
    return Application?.nativeApplicationVersion ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const CASE_KEY = (uid: string) => `${KEY_PREFIX}firstCaseAt_${uid}_${appVersion()}`;
const CELEBRATED_KEY = (uid: string) =>
  `${KEY_PREFIX}celebratedAt_${uid}_${appVersion()}`;
const REVIEW_KEY = (uid: string) =>
  `${KEY_PREFIX}reviewRequestedAt_${uid}_${appVersion()}`;
// Wie oft die Feier über SESSIONS hinweg erneut laufen darf, solange
// der Dialog noch nicht angefragt wurde.
//
// WARUM ES DAS BRAUCHT: `celebratedAt` ist persistent, die Sequenz-Ref
// für Phase 2 lebte aber nur in der laufenden Session. Wer die App
// zwischen Feier-Banner und den 5 Sekunden bis zum Dialog schloss
// (Anruf, Hintergrund, App-Kill), verbrannte den Erst-Fall-Pfad
// DAUERHAFT: `shouldCelebrate` lieferte für diese uid nie wieder true,
// Phase 2 startete nie mehr, und es blieb nur ein künftiges Level-Up —
// das bei Bestandsnutzern (18.064 stehen schon auf Level ≥ 3) oft gar
// nicht mehr kommt.
//
// Gedeckelt, damit ein Nutzer, bei dem der Dialog dauerhaft blockiert
// (z.B. ständig offene Sheets), nicht in jeder Sitzung dieselbe Feier
// sieht. Drei Anläufe, dann ist Schluss.
const MAX_CELEBRATIONS = 3;
const CELEBRATE_COUNT_KEY = (uid: string) =>
  `${KEY_PREFIX}celebrateCount_${uid}_${appVersion()}`;

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
   * Der „gelöste Fall": der User hat eine Produktseite vor sich — egal
   * auf welchem Weg (Walk-Through, Scan, Suche, Direktlink) und in
   * WELCHER STUFE (1 bis 5).
   *
   * Der Aha-Moment ist das SEHEN, nicht der Scan-Vorgang. Ein
   * erfolgreicher Scan navigiert ohnehin genau hierher — deshalb gibt es
   * bewusst KEINEN separaten Scan-Trigger, er wäre eine Dublette.
   *
   * Der frühere `Stufe >= 3`-Riegel ist weg (Aug 2026). Er war fachlich
   * zu eng — auch Stufe 1/2 ist der Erfolg „die App kennt mein Produkt" —
   * und praktisch der Hauptgrund, warum nur 5,9 % der Nutzer den
   * Bewertungs-Prompt überhaupt erreichten.
   *
   * Idempotent PRO APP-VERSION (siehe CASE_KEY): schreibt einmal je
   * Release und feuert dann den Bus.
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
      console.log('🔍 Fall gelöst (Produktseite, Stufe 1-5) — Trigger gearmt');
      void RatingTelemetry.log({ uid, stage: 'trigger_armed' });
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
      const [review, count, scan] = await Promise.all([
        AsyncStorage.getItem(REVIEW_KEY(uid)),
        AsyncStorage.getItem(CELEBRATE_COUNT_KEY(uid)),
        AsyncStorage.getItem(CASE_KEY(uid)),
      ]);
      // Dialog war durch → fertig, hier ist endgültig Schluss.
      if (review) return false;
      // Feier lief schon, Dialog aber nie: erneut versuchen, bis der
      // Deckel erreicht ist (siehe MAX_CELEBRATIONS). Früher stand hier
      // `if (review || celebrated) return false` — genau das machte
      // einen Session-Abbruch endgültig.
      if ((Number(count) || 0) >= MAX_CELEBRATIONS) return false;
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
      const prev = Number(await AsyncStorage.getItem(CELEBRATE_COUNT_KEY(uid))) || 0;
      await AsyncStorage.multiSet([
        [CELEBRATED_KEY(uid), String(Date.now())],
        [CELEBRATE_COUNT_KEY(uid), String(prev + 1)],
      ]);
      void RatingTelemetry.log({ uid, stage: 'celebrated' });
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
  async maybeRequestReview(
    uid?: string | null,
    trigger: RatingTrigger = 'first_case',
    level?: number,
  ): Promise<FirstCaseOutcome> {
    if (!uid) return 'no-user';
    if (inFlight) return 'busy';
    inFlight = true;
    try {
      if (await AsyncStorage.getItem(REVIEW_KEY(uid))) {
        void RatingTelemetry.log({
          uid,
          stage: 'blocked',
          reason: 'already_requested',
          trigger,
          level,
        });
        return 'already';
      }
      if (!(await AsyncStorage.getItem(CELEBRATED_KEY(uid)))) return 'no-celebration';

      // DAUERHAFTE Gates hier prüfen und als 'gated' melden — der
      // GamificationProvider stellt bei 'gated' das Nachfassen ein.
      // Ohne diese Unterscheidung liefe er bei verbrauchtem Budget an
      // JEDER Ruhe-Kante erneut an. MOMENT-Gates (Sheet offen, App im
      // Hintergrund, Tour aktiv) gehören ausdrücklich NICHT hierher:
      // die prüft requestNativeReviewNow, meldet 'unavailable' und
      // lässt den nächsten Versuch ausdrücklich zu.
      const persistent = await ratingPromptService.blockingReason(uid);
      if (persistent) {
        void RatingTelemetry.log({ uid, stage: 'blocked', reason: persistent, trigger, level });
        return 'gated';
      }

      // Erst hier wird tatsächlich gefragt. Schlägt es fehl (Sheet
      // offen, App im Hintergrund, Modul fehlt), setzen wir den Key
      // NICHT → späterer Retry bleibt möglich.
      const ok = await ratingPromptService.requestNativeReviewNow(uid, trigger, level);
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
      await AsyncStorage.multiRemove([
        CASE_KEY(uid),
        CELEBRATED_KEY(uid),
        REVIEW_KEY(uid),
        CELEBRATE_COUNT_KEY(uid),
      ]);
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
