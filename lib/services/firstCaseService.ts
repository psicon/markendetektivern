import AsyncStorage from '@react-native-async-storage/async-storage';
import { CoachmarkService } from './coachmarkService';
import { isRatingPromptEnabled } from './ratingKillSwitch';
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

// ─── Versions-ÜBERGREIFENDE Deckel ──────────────────────────────────
//
// Die Schlüssel oben tragen bewusst die App-Version (ein Release schärft
// den Auslöser neu). Genau deshalb brauchen sie ein Gegengewicht, das
// NICHT zurückgesetzt wird: sonst bestimmt die Build-Kadenz die
// Feier-Frequenz. Dieses Repo hat 6.0.1 bis 6.0.12 in zwei Juli-Wochen
// veröffentlicht — der „drei Anläufe"-Deckel wäre faktisch „drei pro
// Release" gewesen.
//
// Zusätzlich hängt der 14-Tage-Cooldown in ratingPrompt an einem
// ERFOLGREICHEN nativen Aufruf. Scheitert Phase 2 dauerhaft an
// Moment-Gates (offenes Sheet, Umfrage, Hintergrund), wird nichts
// verbucht — und ohne einen eigenen Abstand für die FEIER liefe sie
// ungebremst weiter. Deshalb der eigene Mindestabstand hier.
const EVER_CELEBRATED_KEY = (uid: string) => `${KEY_PREFIX}everCelebrated_${uid}`;
const LAST_CELEBRATED_KEY = (uid: string) => `${KEY_PREFIX}lastCelebratedAt_${uid}`;
const CELEBRATE_MIN_GAP_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
// Höchstens so viele Feiern pro Jahr — passend zu Apples eigenem Deckel
// von 3 Aufforderungen pro Nutzer und 365 Tage. Mehr Feiern als mögliche
// Dialoge wären reine Anbahnung ohne Anlass.
const MAX_CELEBRATIONS_PER_YEAR = 3;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const FIRST_EVER_KEY = (uid: string) => `${KEY_PREFIX}firstCelebratedAt_${uid}`;

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

/**
 * Der Fall-Schlüssel hielt früher nur einen Zeitstempel als String.
 * Jetzt JSON mit der gesehenen Stufe. Altwerte (nackte Zahl) werden
 * gelesen, ohne zu werfen — Stufe 0 heißt "unbekannt" und textet dann
 * konservativ, statt eine Enttarnung zu behaupten.
 */
function readCase(raw: string): { at: number; stufe: number } {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object') {
      return { at: Number(p.at) || 0, stufe: Number(p.stufe) || 0 };
    }
  } catch {
    /* Altformat */
  }
  return { at: Number(raw) || 0, stufe: 0 };
}

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
  async markFirstCase(uid?: string | null, stufe = 0): Promise<void> {
    if (!uid) return; // Anon-Sign-In noch nicht durch → nächster Scan zieht
    try {
      const existing = await AsyncStorage.getItem(CASE_KEY(uid));
      // Schon gearmt, aber mit schwächerer Stufe? Dann die höhere
      // merken: der Banner textet danach ("Fall gelöst" nur ab Stufe 3),
      // und wer erst ein Stufe-1-Produkt und danach eine echte
      // Enttarnung ansieht, soll den stärkeren Text bekommen.
      if (existing) {
        const prev = readCase(existing);
        if (stufe > prev.stufe) {
          await AsyncStorage.setItem(
            CASE_KEY(uid),
            JSON.stringify({ at: prev.at, stufe }),
          );
        }
        return;
      }
      await AsyncStorage.setItem(
        CASE_KEY(uid),
        JSON.stringify({ at: Date.now(), stufe }),
      );
      console.log(`🔍 Fall gearmt (Produktseite, Stufe ${stufe || '?'})`);
      void RatingTelemetry.log({ uid, stage: 'trigger_armed' });
      emitArmed();
    } catch (e) {
      console.warn('FirstCase markFirstCase failed (non-fatal):', e);
    }
  },

  /**
   * Was der Provider für die Text-Auswahl braucht: die höchste gesehene
   * Stufe und ob überhaupt schon einmal gefeiert wurde.
   */
  async getCelebrationContext(
    uid: string,
  ): Promise<{ stufe: number; everCelebrated: boolean }> {
    try {
      const [raw, ever] = await Promise.all([
        AsyncStorage.getItem(CASE_KEY(uid)),
        AsyncStorage.getItem(EVER_CELEBRATED_KEY(uid)),
      ]);
      return {
        stufe: raw ? readCase(raw).stufe : 0,
        everCelebrated: (Number(ever) || 0) > 0,
      };
    } catch {
      return { stufe: 0, everCelebrated: false };
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
      const [review, count, scan, ever, lastAt] = await Promise.all([
        AsyncStorage.getItem(REVIEW_KEY(uid)),
        AsyncStorage.getItem(CELEBRATE_COUNT_KEY(uid)),
        AsyncStorage.getItem(CASE_KEY(uid)),
        AsyncStorage.getItem(EVER_CELEBRATED_KEY(uid)),
        AsyncStorage.getItem(LAST_CELEBRATED_KEY(uid)),
      ]);
      // Dialog war durch → fertig, hier ist endgültig Schluss.
      if (review) return false;
      // Feier lief schon, Dialog aber nie: erneut versuchen, bis der
      // Deckel erreicht ist (siehe MAX_CELEBRATIONS). Früher stand hier
      // `if (review || celebrated) return false` — genau das machte
      // einen Session-Abbruch endgültig.
      if ((Number(count) || 0) >= MAX_CELEBRATIONS) return false;
      if (!scan) return false;

      // Versions-übergreifende Deckel: sonst setzt jedes Release beide
      // Zähler zurück und die Build-Kadenz bestimmt die Frequenz.
      const last = Number(lastAt) || 0;
      if (last && Date.now() - last < CELEBRATE_MIN_GAP_MS) return false;
      const everCount = Number(ever) || 0;
      const firstEverAt = Number(await AsyncStorage.getItem(FIRST_EVER_KEY(uid))) || 0;
      if (
        everCount >= MAX_CELEBRATIONS_PER_YEAR &&
        firstEverAt &&
        Date.now() - firstEverAt < YEAR_MS
      ) {
        return false;
      }

      // Not-Aus: eine schiefgelaufene Welle muss sich OHNE neuen Build
      // stoppen lassen. Ohne diesen Schalter wäre der Korrektur-Build
      // selbst das Problem — er trägt eine neue Version und würde den
      // Auslöser für alle erneut schärfen.
      if (!(await isRatingPromptEnabled())) return false;
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
      const now = Date.now();
      const [prevRaw, everRaw, firstEverRaw] = await Promise.all([
        AsyncStorage.getItem(CELEBRATE_COUNT_KEY(uid)),
        AsyncStorage.getItem(EVER_CELEBRATED_KEY(uid)),
        AsyncStorage.getItem(FIRST_EVER_KEY(uid)),
      ]);
      const ever = (Number(everRaw) || 0) + 1;
      const pairs: [string, string][] = [
        [CELEBRATED_KEY(uid), String(now)],
        [CELEBRATE_COUNT_KEY(uid), String((Number(prevRaw) || 0) + 1)],
        // Versions-übergreifend — diese drei überleben jedes Release.
        [EVER_CELEBRATED_KEY(uid), String(ever)],
        [LAST_CELEBRATED_KEY(uid), String(now)],
      ];
      // Startpunkt des Jahresfensters nur beim allerersten Mal setzen.
      if (!firstEverRaw) pairs.push([FIRST_EVER_KEY(uid), String(now)]);
      await AsyncStorage.multiSet(pairs);
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
        // Auch die versions-übergreifenden Deckel — sonst wäre die
        // Sequenz nach drei Dev-Durchläufen für ein Jahr gesperrt.
        EVER_CELEBRATED_KEY(uid),
        LAST_CELEBRATED_KEY(uid),
        FIRST_EVER_KEY(uid),
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
