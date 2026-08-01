import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, setDoc, updateDoc } from '@react-native-firebase/firestore';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { db } from '../firebase';
import { CoachmarkService } from './coachmarkService';
import type { RatingBlockReason, RatingTrigger } from './ratingTelemetry';
import { RatingTelemetry } from './ratingTelemetry';
import { isAnySheetOpen, isSurveyVisible } from './sheetPresence';

const RATING_FLAG_KEY = 'pendingRatingPrompt';
// X/'Später' = sanfter Cooldown statt Sofort-Wiederholung beim
// naechsten Trigger (Rating-Funnel-Redesign 2026-06-12).
const DISMISSED_AT_KEY = (uid: string) => `ratingDismissedAt_${uid}`;
const DISMISS_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000; // 60 Tage
// Native-Request-Budget: iOS drosselt selbst auf 3×/365 Tage, Play hat
// ein undokumentiertes Quota — unsere Gates sorgen, dass die wenigen
// Chancen auf echte Happy Moments fallen statt verpuffen.
const NATIVE_ASKED_AT_KEY = (uid: string) => `nativeReviewAskedAt_${uid}`;
const NATIVE_ASKED_VERSION_KEY = (uid: string) => `nativeReviewAskedVersion_${uid}`;
// Zusätzlich UID-FREI: das 1×-pro-App-Version-Budget ist inhaltlich
// geräte-, nicht account-gebunden. Ohne diesen Riegel könnte ein
// Logout + neuer Anonymous-Sign-In (frische uid) im selben Build einen
// zweiten Dialog auslösen — die Coachmark-Keys sind nämlich NICHT
// uid-scoped, das Gate stünde also sofort wieder offen.
const NATIVE_ASKED_VERSION_GLOBAL_KEY = 'nativeReviewAskedVersion_global';
const NATIVE_ASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 Tage

// `hasRated_<uid>` ist KEINE Lebenssperre mehr (Aug 2026).
//
// Der Schlüssel bedeutet „hat unser altes Modal beantwortet" — NICHT
// „hat im Store bewertet". Der positive Zweig führte lediglich auf einen
// Store-Deeplink, den der Nutzer erneut antippen und im Store auch noch
// abschließen musste; die meisten taten das nie. Trotzdem sperrte der
// Schlüssel beide Auto-Pfade für immer. Betroffen: 4.782 Nutzer — also
// ausgerechnet die aktivsten, die man am ehesten fragen will.
//
// Neue Lesart, nach Antworttyp getrennt:
//   positiv  → zufriedener Nutzer, den wir erneut fragen dürfen. Kurze
//              Schamfrist, damit es nicht unmittelbar hintereinander kommt.
//   negativ  → hat uns gesagt, dass etwas nicht passt. Lange Ruhe; ihn in
//              den Store zu schicken wäre gegen sein Interesse und gegen
//              unseres.
// Gemessen wird ab dem Zeitstempel der Antwort. Altbestand ohne Stempel
// wird beim ersten Lesen auf „jetzt" migriert (siehe readRatedState) —
// dadurch laufen Altfälle gestaffelt aus statt alle auf einmal.
const RATED_POSITIVE_BLOCK_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const RATED_NEGATIVE_BLOCK_MS = 180 * 24 * 60 * 60 * 1000; // 180 Tage

// Synchroner Guard gegen Doppel-Anfragen aus konkurrierenden Kanten.
let nativeRequestInFlight = false;

interface RatingFlag {
  userId: string;
  triggerLevel: number;
  timestamp: number;
  reason?: 'level_up' | 'first_scan_success';
}

class RatingPromptService {
  private static instance: RatingPromptService;
  private showRatingModal: ((show: boolean) => void) | null = null;

  static getInstance(): RatingPromptService {
    if (!RatingPromptService.instance) {
      RatingPromptService.instance = new RatingPromptService();
    }
    return RatingPromptService.instance;
  }

  /**
   * Register the rating modal show function
   */
  setRatingModalHandler(handler: (show: boolean) => void) {
    this.showRatingModal = handler;
    console.log(`📱 Rating Modal Handler ${handler ? 'registered' : 'unregistered'}`);
  }

  /** Dev-Tool (Profil → Debug): Modal sofort anzeigen, ohne Flags/
   *  Level-Gate — zum Testen von Copy/Design-Iterationen. */
  debugShowNow(): boolean {
    if (!this.showRatingModal) {
      console.warn('📱 Rating Modal Handler nicht registriert');
      return false;
    }
    this.showRatingModal(true);
    return true;
  }

  /**
   * Set pending rating flag after level up
   */
  async setPendingRating(userId: string, newLevel: number): Promise<void> {
    try {
      if (newLevel >= 3) { // Level 3+ Trigger
        const flag: RatingFlag = {
          userId,
          triggerLevel: newLevel,
          timestamp: Date.now(),
          reason: 'level_up',
        };

        await AsyncStorage.setItem(RATING_FLAG_KEY, JSON.stringify(flag));
        console.log(`📱 Rating flag set for level ${newLevel} - will show on next navigation`);
      }
    } catch (error) {
      console.error('❌ Error setting rating flag:', error);
    }
  }

  /**
   * Check and show pending rating (call on navigation)
   *
   * NUR noch der LEVEL-UP-Pfad (`setPendingRating`). Der Erst-Erfolgs-
   * Pfad läuft über `firstCaseService` und schreibt dieses Flag NICHT —
   * so gibt es keine zwei Pfade auf dasselbe Ereignis.
   *
   * Auto-Pfad = DIREKT der native In-App-Review-Dialog
   * (SKStoreReviewController / Play In-App-Review), bewusst OHNE
   * Sentiment-Vorfrage: Fragen vor der Review-Karte sind auf Android
   * per In-App-Review-Guideline verboten und selektive Aufforderung ist
   * in DE UWG-riskant. Steuerung läuft ausschließlich übers Timing
   * (Happy Moments) + Gates (1×/App-Version, 14-Tage-Cooldown).
   */
  async checkAndShowPendingRating(): Promise<void> {
    try {
      const flagData = await AsyncStorage.getItem(RATING_FLAG_KEY);

      if (!flagData) {
        return; // Keine pending rating - kein Log nötig (läuft alle 2 Sek)
      }

      // Sheet offen ODER Walkthrough läuft? Flag LIEGEN LASSEN — der
      // nächste Poll versucht es erneut (kein System-Dialog über einem
      // präsentierten Sheet oder mitten in einer Tour).
      if (isAnySheetOpen() || isSurveyVisible()) return;
      if (CoachmarkService.isAnyActive()) return;

      const flag: RatingFlag = JSON.parse(flagData);
      console.log(`📱 Found pending rating flag (${flag.reason ?? `level ${flag.triggerLevel}`})`);

      // Endgültige Absagen (bereits bewertet / Cooldown / Budget) → Flag
      // verbrauchen, es würde sonst bei jedem Poll neu geprüft.
      if (!(await this.canRequestNativeReview(flag.userId))) {
        await AsyncStorage.removeItem(RATING_FLAG_KEY);
        console.log('📱 Rating conditions no longer met - skipping');
        return;
      }

      // Flag NICHT vorab löschen: `requestNativeReviewNow` kann am
      // Moment-Kontext scheitern (Sheet öffnet in den 500 ms, App geht
      // in den Hintergrund). Früher war das Flag dann weg und der
      // Level-Up-Prompt bis zum nächsten Level ≥3 verloren.
      // Doppel-Prompts verhindert `nativeRequestInFlight` + der
      // Budget-Recheck in requestNativeReviewNow.
      setTimeout(() => {
        void this.requestNativeReviewNow(flag.userId).then((ok) => {
          if (ok) void AsyncStorage.removeItem(RATING_FLAG_KEY);
        });
      }, 500);
    } catch (error) {
      console.error('❌ Error checking pending rating:', error);
    }
  }

  /**
   * Darf jetzt grundsätzlich nach einer Bewertung gefragt werden?
   * (hasRated / 60-Tage-Dismiss / 1×-App-Version / 14-Tage-Cooldown)
   * Prüft NICHT den Moment-Kontext — dafür `requestNativeReviewNow`.
   */
  async canRequestNativeReview(userId: string): Promise<boolean> {
    return (await this.blockingReason(userId)) === null;
  }

  /**
   * Fragt den nativen Dialog an, wenn der MOMENT passt, und verbucht
   * das Budget ERST DANACH.
   *
   * Reihenfolge ist wichtig: früher wurde vor dem Aufruf verbucht —
   * ein blockierter Versuch (Modul fehlt / App im Hintergrund / Sheet
   * offen) hat dann das 1×-pro-App-Version-Budget verbrannt, ohne dass
   * je ein Dialog erschien.
   *
   * EHRLICHE GRENZE: `true` heißt "wir haben gefragt und es hat nicht
   * geworfen" — NICHT, dass iOS/Play die Karte wirklich gezeigt hat.
   * Beide APIs sind fire-and-forget ohne Rückkanal; ein OS-seitiges
   * Drosseln bleibt für uns unsichtbar.
   */
  async requestNativeReviewNow(
    userId: string,
    trigger?: RatingTrigger,
    level?: number,
  ): Promise<boolean> {
    if (nativeRequestInFlight) return false;
    // Kein System-Dialog über einem präsentierten Sheet/Modal.
    if (isAnySheetOpen() || isSurveyVisible()) {
      void RatingTelemetry.log({ uid: userId, stage: 'blocked', reason: 'sheet_open', trigger, level });
      return false;
    }
    if (CoachmarkService.isAnyActive()) {
      void RatingTelemetry.log({ uid: userId, stage: 'blocked', reason: 'intro_tours_open', trigger, level });
      return false;
    }
    // Im Hintergrund würde der Dialog verpuffen (Android: kein
    // currentActivity → nur ein Log.w) und das Budget kosten.
    if (AppState.currentState !== 'active') {
      void RatingTelemetry.log({ uid: userId, stage: 'blocked', reason: 'app_background', trigger, level });
      return false;
    }
    // Budget hier NOCHMAL prüfen (nicht nur beim Aufrufer): sonst können
    // zwei zeitlich versetzte Einstiegspfade — Erst-Fall-Sequenz und
    // Level-Up-Poll mit seinen 500 ms Verzögerung — beide durchkommen
    // und zwei Dialoge hintereinander anfragen (Play-Quota verbrannt).
    const blocked = await this.blockingReason(userId);
    if (blocked) {
      void RatingTelemetry.log({ uid: userId, stage: 'blocked', reason: blocked, trigger, level });
      return false;
    }

    nativeRequestInFlight = true;
    try {
      const ok = await this.requestNativeReview();
      if (ok) {
        await this.recordNativeRequest(userId);
        // EHRLICHE GRENZE (siehe Doc oben): 'requested' heißt „wir haben
        // gefragt", NICHT „das OS hat die Karte gezeigt". Die Auswertung
        // muss diesen Unterschied kennen, sonst liest sie hier eine
        // Anzeige-Rate, die es technisch gar nicht geben kann.
        void RatingTelemetry.log({ uid: userId, stage: 'requested', trigger, level });
      }
      return ok;
    } finally {
      nativeRequestInFlight = false;
    }
  }

  /** Lazy require: `expo-application` erst beim Aufruf anfassen. */
  private appVersion(): string {
    try {
      const Application = require('expo-application');
      return Application?.nativeApplicationVersion ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async recordNativeRequest(userId: string): Promise<void> {
    try {
      const version = this.appVersion();
      await AsyncStorage.multiSet([
        [NATIVE_ASKED_AT_KEY(userId), String(Date.now())],
        [NATIVE_ASKED_VERSION_KEY(userId), version],
        [NATIVE_ASKED_VERSION_GLOBAL_KEY, version],
      ]);
    } catch (error) {
      console.error('❌ Error recording native review request:', error);
    }
  }

  /**
   * Nativer In-App-Review-Dialog (iOS: SKStoreReviewController,
   * Android: Play-Core-ReviewManager). KEIN Store-Fallback im
   * Auto-Pfad — wenn das OS den Dialog drosselt/verweigert, passiert
   * bewusst still nichts (den User unaufgefordert in den Store zu
   * werfen wäre schlechter als kein Prompt).
   * Lazy require: hält den Service test-/import-sicher (Native-Modul
   * wird erst beim Aufruf angefasst); nur `react-native` selbst muss
   * statisch importiert werden.
   */
  private async requestNativeReview(): Promise<boolean> {
    try {
      const { requestReview } = require('react-native-store-review');
      await requestReview();
      console.log('⭐ Native In-App-Review angefragt');
      return true;
    } catch (error) {
      console.warn('⚠️ Native In-App-Review nicht verfügbar:', error);
      return false;
    }
  }

  /**
   * Liest `hasRated_<uid>` und migriert Altbestand.
   *
   * Historie: früher stand dort nur der nackte Typ ('positive' /
   * 'negative') ohne Datum, weshalb sich daraus keine Frist berechnen
   * ließ und der Wert als Lebenssperre wirkte. Neu ist JSON mit
   * Zeitstempel. Ein Altwert ohne Stempel wird beim ersten Lesen mit
   * `Date.now()` versehen — bewusst NICHT rückdatiert: wir wissen das
   * echte Datum nicht, und ein zu früh geöffnetes Gate wäre schlimmer
   * als ein paar Wochen Verzögerung.
   */
  private async readRatedState(
    userId: string,
  ): Promise<{ type: 'positive' | 'negative'; at: number } | null> {
    const raw = await AsyncStorage.getItem(`hasRated_${userId}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.type) {
        return { type: parsed.type, at: Number(parsed.at) || 0 };
      }
    } catch {
      /* Altformat — fällt unten durch */
    }
    const type: 'positive' | 'negative' = raw === 'negative' ? 'negative' : 'positive';
    const migrated = { type, at: Date.now() };
    await AsyncStorage.setItem(`hasRated_${userId}`, JSON.stringify(migrated));
    console.log(`📱 hasRated migriert (${type}) — Frist läuft ab jetzt`);
    return migrated;
  }

  /**
   * Welches Gate blockiert gerade? `null` = keins.
   *
   * Gibt bewusst den GRUND zurück statt nur true/false: ohne ihn ließ
   * sich nicht unterscheiden, ob ein Nutzer am Budget, an einer alten
   * Antwort oder an einem Cooldown hängt — und damit auch nicht, welche
   * Stellschraube überhaupt etwas bringt.
   */
  async blockingReason(userId: string): Promise<RatingBlockReason | null> {
    try {
      const rated = await this.readRatedState(userId);
      if (rated) {
        const window =
          rated.type === 'negative' ? RATED_NEGATIVE_BLOCK_MS : RATED_POSITIVE_BLOCK_MS;
        if (Date.now() - rated.at < window) return 'already_rated';
      }
      // 60-Tage-Cooldown nach X/'Später' — nicht beim naechsten
      // Level-Up sofort wieder nerven.
      const dismissedAt = await AsyncStorage.getItem(DISMISSED_AT_KEY(userId));
      if (dismissedAt) {
        const age = Date.now() - Number(dismissedAt);
        if (Number.isFinite(age) && age < DISMISS_COOLDOWN_MS) return 'dismiss_cooldown';
      }

      const version = this.appVersion();
      // Geräteweit (uid-frei) — überlebt einen uid-Wechsel.
      const askedGlobal = await AsyncStorage.getItem(NATIVE_ASKED_VERSION_GLOBAL_KEY);
      if (askedGlobal && askedGlobal === version) return 'version_budget';
      const askedVersion = await AsyncStorage.getItem(NATIVE_ASKED_VERSION_KEY(userId));
      if (askedVersion && askedVersion === version) return 'version_budget';
      const askedAt = await AsyncStorage.getItem(NATIVE_ASKED_AT_KEY(userId));
      if (askedAt) {
        const age = Date.now() - Number(askedAt);
        if (Number.isFinite(age) && age < NATIVE_ASK_COOLDOWN_MS) return 'ask_cooldown';
      }
      return null;
    } catch (error) {
      console.log('❌ Error checking rating status:', error);
      return null; // im Zweifel erlauben — das OS drosselt selbst
    }
  }

  /** X / 'Später': Cooldown setzen (60 Tage). */
  async markDismissed(userId: string): Promise<void> {
    try {
      await AsyncStorage.setItem(DISMISSED_AT_KEY(userId), String(Date.now()));
      console.log('📱 Rating dismissed — 60-Tage-Cooldown gesetzt');
    } catch (error) {
      console.error('❌ Error marking rating dismissed:', error);
    }
  }

  /**
   * Save rating to Firestore immediately
   */
  async saveRatingToFirestore(userId: string, type: 'positive' | 'negative', level?: number): Promise<string | undefined> {
    try {
      const ratingData = {
        userId,
        rating: type,
        triggerLevel: level || null,
        timestamp: serverTimestamp(),
        feedbackText: null, // Will be updated later if negative rating
        updatedAt: serverTimestamp()
      };

      // Save to userfeedback collection
      const docId = `${userId}_${Date.now()}`;
      const ratingDoc = doc(db, 'userfeedback', docId);
      await setDoc(ratingDoc, ratingData);
      
      console.log(`✅ Rating ${type} saved to Firestore for user ${userId} (level: ${level}, doc: ${docId})`);
      return docId; // Return document ID for potential feedback update
    } catch (error) {
      console.error('❌ Error saving rating to Firestore:', error);
      // Don't throw - app should continue working even if Firestore fails
    }
  }

  /**
   * Mark as rated (prevent future prompts) + save to Firestore
   */
  async markAsRated(userId: string, type: 'positive' | 'negative', level?: number): Promise<string | undefined> {
    try {
      // Mit Zeitstempel, damit sich daraus eine Frist rechnen lässt —
      // das nackte Typ-Feld von früher war der Grund, warum der Wert
      // faktisch als Lebenssperre wirkte (siehe RATED_*_BLOCK_MS oben).
      await AsyncStorage.setItem(
        `hasRated_${userId}`,
        JSON.stringify({ type, at: Date.now() }),
      );
      console.log(`📱 User marked as rated: ${type}`);
      
      // Save to Firestore immediately
      const docId = await this.saveRatingToFirestore(userId, type, level);
      
      return docId;
    } catch (error) {
      console.error('❌ Error marking as rated:', error);
    }
  }

  /**
   * Manueller "App bewerten"-Pfad (Profil-Menü / Modal-Store-Step):
   * hier bewusst der Store-DEEP-LINK statt der In-App-Review-API —
   * Apple: "Avoid requesting a review as the result of a user action"
   * (dafür ist ?action=write-review der dokumentierte Weg), und bei
   * Google kann das Quota verbraucht sein (Dialog erschiene still nicht).
   */
  async openStoreForManualReview(): Promise<void> {
    try {
      const storeUrl = Platform.OS === 'ios'
        ? 'https://apps.apple.com/de/app/id6471081082?action=write-review'
        : 'https://play.google.com/store/apps/details?id=de.markendetektive';
      console.log('🔗 Öffne Store-URL für Bewertung:', storeUrl);
      await Linking.openURL(storeUrl);
    } catch (error) {
      console.error('❌ Store review error:', error);
      Alert.alert('Fehler', 'Store konnte nicht geöffnet werden');
    }
  }

  /**
   * Save feedback to existing Firestore rating document
   */
  async saveFeedback(
    userId: string,
    feedback: string,
    ratingDocId?: string,
    categories?: string[],
  ): Promise<void> {
    try {
      console.log(`💾 Saving feedback to Firestore: ${feedback} [${(categories ?? []).join(',')}]`);
      
      if (ratingDocId) {
        // Update existing rating document with feedback
        const ratingDoc = doc(db, 'userfeedback', ratingDocId);
        await updateDoc(ratingDoc, {
          feedbackText: feedback || null,
          feedbackCategories: categories ?? [],
          feedbackTimestamp: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        console.log(`✅ Feedback added to existing rating doc: ${ratingDocId}`);
      } else {
        // Fallback: Create new feedback-only document
        const docId = `${userId}_feedback_${Date.now()}`;
        const feedbackDoc = doc(db, 'userfeedback', docId);
        await setDoc(feedbackDoc, {
          userId,
          rating: 'negative', // Feedback only comes from negative ratings
          triggerLevel: null,
          timestamp: serverTimestamp(),
          feedbackText: feedback || null,
          feedbackCategories: categories ?? [],
          feedbackTimestamp: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        console.log(`✅ Standalone feedback document created: ${docId}`);
      }
      
      // Also save locally as backup
      await AsyncStorage.setItem(`feedback_${userId}_${Date.now()}`, feedback);
      
    } catch (error) {
      console.error('❌ Feedback save error:', error);
      // Fallback to local storage only
      await AsyncStorage.setItem(`feedback_${userId}_${Date.now()}`, feedback);
      throw error;
    }
  }

  /**
   * Clear all rating data (for testing)
   *
   * MUSS alle Gate-Keys mitnehmen — sonst ist der Auto-Pfad nach EINEM
   * Testlauf bis zum nächsten Version-Bump tot und mit Bordmitteln
   * nicht zurücksetzbar (das 1×-pro-App-Version-Budget greift).
   */
  async clearRatingData(userId: string): Promise<void> {
    try {
      await AsyncStorage.multiRemove([
        RATING_FLAG_KEY,
        `hasRated_${userId}`,
        DISMISSED_AT_KEY(userId),
        NATIVE_ASKED_AT_KEY(userId),
        NATIVE_ASKED_VERSION_KEY(userId),
        NATIVE_ASKED_VERSION_GLOBAL_KEY,
      ]);
      // Ohne die Telemetrie-Riegel liefe der Trichter im Test zwar
      // erneut durch, würde aber nichts mehr melden (1 Ereignis je
      // Stufe und App-Version) — der Dev-Durchlauf wäre blind.
      await RatingTelemetry.resetGuards(userId);
      console.log('🧹 Rating data cleared');
    } catch (error) {
      console.error('❌ Error clearing rating data:', error);
    }
  }
}

export const ratingPromptService = RatingPromptService.getInstance();
