import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, setDoc, updateDoc } from '@react-native-firebase/firestore';
import { Alert, Linking, Platform } from 'react-native';
import { db } from '../firebase';
import { isAnySheetOpen } from './sheetPresence';

const RATING_FLAG_KEY = 'pendingRatingPrompt';
// X/'Später' = sanfter Cooldown statt Sofort-Wiederholung beim
// naechsten Trigger (Rating-Funnel-Redesign 2026-06-12).
const DISMISSED_AT_KEY = (uid: string) => `ratingDismissedAt_${uid}`;
const DISMISS_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000; // 60 Tage
// Erst-Erfolgs-Trigger (2026-07): einmalig pro User beim ersten
// Katalog-Treffer im Scanner scharf geschaltet.
const FIRST_SCAN_ARMED_KEY = (uid: string) => `ratingFirstScanArmed_${uid}`;
// Native-Request-Budget: iOS drosselt selbst auf 3×/365 Tage, Play hat
// ein undokumentiertes Quota — unsere Gates sorgen, dass die wenigen
// Chancen auf echte Happy Moments fallen statt verpuffen.
const NATIVE_ASKED_AT_KEY = (uid: string) => `nativeReviewAskedAt_${uid}`;
const NATIVE_ASKED_VERSION_KEY = (uid: string) => `nativeReviewAskedVersion_${uid}`;
const NATIVE_ASK_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 Tage

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
   * Erst-Erfolgs-Trigger: beim ersten erfolgreichen Katalog-Treffer im
   * Scanner (NoName- oder Marken-Match, NICHT der External-Fallback)
   * einmalig den Rating-Prompt scharf schalten. Der 10-s-Poll im
   * GamificationProvider löst ihn ein, sobald kein Banner/Sheet den
   * Moment stört — der User hat sein Ergebnis dann schon gesehen.
   */
  async armFirstScanSuccess(userId?: string | null): Promise<void> {
    try {
      if (!userId) return;
      // Einmalig pro User — der Key wird IMMER gesetzt, auch wenn die
      // Gates unten das Flag verhindern ("erster Erfolg" zählt nur einmal).
      const armed = await AsyncStorage.getItem(FIRST_SCAN_ARMED_KEY(userId));
      if (armed) return;
      await AsyncStorage.setItem(FIRST_SCAN_ARMED_KEY(userId), String(Date.now()));

      if (!(await this.shouldShowRating(userId))) return;
      const flag: RatingFlag = {
        userId,
        triggerLevel: 0,
        timestamp: Date.now(),
        reason: 'first_scan_success',
      };
      await AsyncStorage.setItem(RATING_FLAG_KEY, JSON.stringify(flag));
      console.log('📱 Rating flag set (first scan success)');
    } catch (error) {
      console.error('❌ Error arming first-scan rating:', error);
    }
  }

  /**
   * Check and show pending rating (call on navigation)
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

      // Sheet offen? Flag LIEGEN LASSEN — der nächste Poll versucht es
      // erneut (kein System-Dialog über einem präsentierten Sheet,
      // siehe Zwei-Modal-Regel/sheetPresence).
      if (isAnySheetOpen()) return;

      const flag: RatingFlag = JSON.parse(flagData);
      console.log(`📱 Found pending rating flag (${flag.reason ?? `level ${flag.triggerLevel}`})`);

      // Remove flag first (avoid multiple prompts)
      await AsyncStorage.removeItem(RATING_FLAG_KEY);

      // User hat inzwischen geantwortet / Cooldowns aktiv?
      if (!(await this.shouldShowRating(flag.userId))) {
        console.log('📱 Rating conditions no longer met - skipping');
        return;
      }
      if (!(await this.nativeRequestAllowed(flag.userId))) {
        console.log('📱 Native-Request-Budget verbraucht (Version/14d) - skipping');
        return;
      }

      // Konservativ VOR dem Anzeigen verbuchen — nie doppelt feuern.
      await this.recordNativeRequest(flag.userId);
      setTimeout(() => {
        void this.requestNativeReview();
      }, 500);
    } catch (error) {
      console.error('❌ Error checking pending rating:', error);
    }
  }

  /** Gate fürs native Review: max 1×/App-Version UND ≥14 Tage Abstand. */
  private async nativeRequestAllowed(userId: string): Promise<boolean> {
    try {
      const Application = require('expo-application');
      const version: string = Application?.nativeApplicationVersion ?? 'unknown';
      const askedVersion = await AsyncStorage.getItem(NATIVE_ASKED_VERSION_KEY(userId));
      if (askedVersion && askedVersion === version) return false;
      const askedAt = await AsyncStorage.getItem(NATIVE_ASKED_AT_KEY(userId));
      if (askedAt) {
        const age = Date.now() - Number(askedAt);
        if (Number.isFinite(age) && age < NATIVE_ASK_COOLDOWN_MS) return false;
      }
      return true;
    } catch {
      return true; // im Zweifel erlauben — OS drosselt selbst
    }
  }

  private async recordNativeRequest(userId: string): Promise<void> {
    try {
      const Application = require('expo-application');
      const version: string = Application?.nativeApplicationVersion ?? 'unknown';
      await AsyncStorage.setItem(NATIVE_ASKED_AT_KEY(userId), String(Date.now()));
      await AsyncStorage.setItem(NATIVE_ASKED_VERSION_KEY(userId), version);
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
   * Simple check if should show rating (without complex conditions)
   */
  private async shouldShowRating(userId: string): Promise<boolean> {
    try {
      // Nie wieder nach einer Antwort (positiv wie negativ).
      const hasRated = await AsyncStorage.getItem(`hasRated_${userId}`);
      if (hasRated) return false;
      // 60-Tage-Cooldown nach X/'Später' — nicht beim naechsten
      // Level-Up sofort wieder nerven.
      const dismissedAt = await AsyncStorage.getItem(DISMISSED_AT_KEY(userId));
      if (dismissedAt) {
        const age = Date.now() - Number(dismissedAt);
        if (Number.isFinite(age) && age < DISMISS_COOLDOWN_MS) return false;
      }
      return true;
    } catch (error) {
      console.log('❌ Error checking rating status:', error);
      return true; // Default to show
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
      // Save locally to prevent future prompts
      await AsyncStorage.setItem(`hasRated_${userId}`, type);
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
   */
  async clearRatingData(userId: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(RATING_FLAG_KEY);
      await AsyncStorage.removeItem(`hasRated_${userId}`);
      console.log('🧹 Rating data cleared');
    } catch (error) {
      console.error('❌ Error clearing rating data:', error);
    }
  }
}

export const ratingPromptService = RatingPromptService.getInstance();
