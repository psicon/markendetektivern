import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * ratingTelemetry — macht den Bewertungs-Trichter serverseitig sichtbar.
 *
 * WARUM ES DAS GIBT: Bis August 2026 schrieb der gesamte native
 * Review-Pfad AUSSCHLIESSLICH in den AsyncStorage des Geräts
 * (`ratingPrompt.recordNativeRequest`). Es gab weder ein Analytics-
 * Ereignis noch einen Firestore-Write. Auf die Frage „kommt der Dialog
 * überhaupt raus?" konnte niemand antworten — auch nicht mit „nein",
 * denn wir hätten 0 und 500 Anfragen pro Woche nicht unterscheiden
 * können. Jede Entscheidung am Prompt war bis dahin geraten.
 *
 * WARUM FIRESTORE UND NICHT GA4: Im GA4-BigQuery-Export sind 554
 * Ereignisnamen per Filter ausgeschlossen (u.a. `first_open`,
 * `session_start`, `screen_view`). Ein neues GA4-Ereignis müsste erst
 * gegen diese Liste geprüft werden und wäre bis dahin unsichtbar.
 * Firestore ist der Pfad, der nachweislich ankommt.
 *
 * KOSTEN-DESIGN: Geschrieben wird NUR bei Zustands-ÜBERGÄNGEN, nie bei
 * jeder Auswertung (die Gates werden im Poll-Takt geprüft). Zusätzlich
 * dedupliziert ein AsyncStorage-Riegel pro (Stufe, Grund, App-Version):
 * ein Nutzer erzeugt damit eine Handvoll Dokumente pro Release, nicht
 * pro Sitzung. Die Doc-ID ist deterministisch, ein durchgerutschtes
 * Duplikat überschreibt sich also selbst statt sich zu vervielfachen.
 *
 * DATENSPARSAMKEIT: Gespeichert werden Stufe, Grund, Plattform,
 * App-Version, Trigger-Art und die uid — kein Inhalt, kein Produkt,
 * kein Text. Die uid ist nötig, um den Trichter überhaupt als Trichter
 * auswerten zu können (wie viele der Ausgelösten wurden geblockt), und
 * fällt unter dieselbe Owner-Regel wie `poll_responses`.
 */

const COLLECTION = 'ratingFunnelEvents';
const SENT_KEY = (uid: string, id: string) => `ratingTelemetry/v1/${uid}/${id}`;

/** Wo im Trichter der Nutzer gerade steht. */
export type RatingFunnelStage =
  /** Erst-Fall verbucht — der Nutzer hat ein enttarntes Produkt gesehen. */
  | 'trigger_armed'
  /** Die Feier läuft (Banner präsentiert oder bewusst unterdrückt). */
  | 'celebrated'
  /** Ein Gate hat den Dialog verhindert — `reason` sagt welches. */
  | 'blocked'
  /** `requestReview()` wurde tatsächlich aufgerufen. */
  | 'requested';

/**
 * Warum der Dialog nicht kam. WICHTIG: `requested` heißt NICHT, dass
 * das Betriebssystem die Karte gezeigt hat — beide Plattformen sind
 * fire-and-forget ohne Rückkanal. Mehr als „wir haben gefragt" ist
 * technisch nicht feststellbar, und genau diese Grenze soll die
 * Auswertung später nicht verwischen.
 */
export type RatingBlockReason =
  | 'already_rated'
  | 'dismiss_cooldown'
  | 'version_budget'
  | 'ask_cooldown'
  | 'intro_tours_open'
  | 'sheet_open'
  | 'app_background'
  | 'already_requested';

export type RatingTrigger = 'first_case' | 'veteran_case' | 'level_up';

interface LogInput {
  uid?: string | null;
  stage: RatingFunnelStage;
  reason?: RatingBlockReason;
  trigger?: RatingTrigger;
  /** Level des Nutzers, falls bekannt — trennt Neu- von Bestandsnutzern. */
  level?: number;
}

function appVersion(): string {
  try {
    const Application = require('expo-application');
    return Application?.nativeApplicationVersion ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const RatingTelemetry = {
  /**
   * Einen Trichter-Übergang verbuchen. IMMER fire-and-forget aufrufen
   * (`void RatingTelemetry.log(...)`) — der Write darf NIE awaited
   * werden: Firestore-Promises lösen erst bei Server-Ack auf und hängen
   * offline unbegrenzt. Im Bewertungs-Pfad läuft parallel ein
   * 5-Sekunden-Timer bis zum Dialog; ein await hier würde ihn im
   * Flugmodus zuverlässig zerstören.
   */
  async log({ uid, stage, reason, trigger, level }: LogInput): Promise<void> {
    if (!uid) return;
    try {
      const version = appVersion();
      // Ein Ereignis je (Stufe, Grund, Version). Der Grund gehört in den
      // Schlüssel, sonst verschluckt der erste Blocker alle weiteren und
      // wir sähen nur je einen Grund pro Nutzer statt der echten Kette.
      const id = `${version}_${stage}${reason ? `_${reason}` : ''}`;
      const guard = SENT_KEY(uid, id);
      if (await AsyncStorage.getItem(guard)) return;

      // Lazy require statt statischem Import: hält den Service import-
      // sicher, damit JEDER Konsument (firstCaseService, ratingPrompt …)
      // in Tests läuft, ohne dass dessen Suite Firestore mocken muss.
      // Gleiches Muster wie `requestNativeReview` in ratingPrompt.ts.
      // `react-native` selbst bleibt statisch importiert (Projekt-Regel:
      // dynamische react-native-Imports crashen über metroImportAll).
      const { doc, serverTimestamp, setDoc } = require('@react-native-firebase/firestore');
      const { db } = require('../firebase');

      await setDoc(doc(db, COLLECTION, `${uid}_${id}`), {
        userId: uid,
        stage,
        reason: reason ?? null,
        trigger: trigger ?? null,
        level: typeof level === 'number' ? level : null,
        platform: Platform.OS,
        appVersion: version,
        timestamp: serverTimestamp(),
      });

      // Riegel ERST nach erfolgreichem Write setzen — sonst wäre ein
      // fehlgeschlagener Write (offline) für immer als „gesendet"
      // markiert und die Stufe fehlte dauerhaft in der Auswertung.
      await AsyncStorage.setItem(guard, '1');
    } catch (e) {
      // Telemetrie darf den Bewertungs-Pfad NIEMALS beeinflussen.
      console.warn('RatingTelemetry.log failed (non-fatal):', e);
    }
  },

  /** Dev-Panel: Riegel für die aktuelle Version lösen, damit sich der
   *  Trichter im Test wiederholt durchspielen lässt. */
  async resetGuards(uid: string): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const mine = keys.filter((k) => k.startsWith(`ratingTelemetry/v1/${uid}/`));
      if (mine.length) await AsyncStorage.multiRemove(mine);
    } catch (e) {
      console.warn('RatingTelemetry.resetGuards failed (non-fatal):', e);
    }
  },
};
