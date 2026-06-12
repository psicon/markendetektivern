import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, setDoc, updateDoc } from '@react-native-firebase/firestore';
import { Alert } from 'react-native';
import { db } from '../firebase';

const RATING_FLAG_KEY = 'pendingRatingPrompt';
// X/'Später' = sanfter Cooldown statt Sofort-Wiederholung beim
// naechsten Trigger (Rating-Funnel-Redesign 2026-06-12).
const DISMISSED_AT_KEY = (uid: string) => `ratingDismissedAt_${uid}`;
const DISMISS_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000; // 60 Tage

interface RatingFlag {
  userId: string;
  triggerLevel: number;
  timestamp: number;
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
   */
  async checkAndShowPendingRating(): Promise<void> {
    try {
      const flagData = await AsyncStorage.getItem(RATING_FLAG_KEY);
      
      if (!flagData) {
        return; // Keine pending rating - kein Log nötig (läuft alle 2 Sek)
      }

      const flag: RatingFlag = JSON.parse(flagData);
      console.log(`📱 Found pending rating flag for level ${flag.triggerLevel}`);

      // Remove flag first (avoid multiple prompts)
      await AsyncStorage.removeItem(RATING_FLAG_KEY);
      console.log('📱 Rating flag removed from storage');

      // Check if should still prompt (user might have rated in the meantime)
      if (await this.shouldShowRating(flag.userId)) {
        console.log('📱 Rating conditions met - will show modal');
        console.log(`📱 showRatingModal handler available: ${!!this.showRatingModal}`);
        
        // Small delay for smooth UX
        setTimeout(() => {
          if (this.showRatingModal) {
            console.log('🚀 Triggering rating modal NOW!');
            this.showRatingModal(true);
          } else {
            console.error('❌ No showRatingModal handler registered!');
          }
        }, 500);
      } else {
        console.log('📱 Rating conditions no longer met - skipping');
      }
    } catch (error) {
      console.error('❌ Error checking pending rating:', error);
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
   * Request native store review (simplified)
   */
  async requestStoreReview(): Promise<void> {
    try {
      const { Platform, Linking } = require('react-native');
      const StoreReview = require('react-native-store-review');
      
      let nativePromptShown = false;
      
      if (StoreReview?.isAvailable && StoreReview.isAvailable()) {
        try {
          console.log('⭐ Versuche native In-App-Review anzuzeigen...');
          const result = await StoreReview.requestReview();
          // requestReview gibt auf iOS nichts zurück, auf Android bool
          nativePromptShown = result !== false;
          console.log('⭐ Native In-App-Review Ergebnis:', result);
        } catch (error) {
          console.warn('⚠️ Native In-App-Review fehlgeschlagen, fallback zum Store:', error);
        }
      } else {
        console.log('⚠️ Native In-App-Review nicht verfügbar – wechsle direkt zum Store');
      }
      
      if (!nativePromptShown) {
        // Öffne Store Fallback
        const storeUrl = Platform.OS === 'ios' 
          ? 'https://apps.apple.com/de/app/markendetektive-clever-sparen/id6471081082'
          : 'https://play.google.com/store/apps/details?id=de.markendetektive';
        
        console.log('🔗 Öffne Store-URL für Bewertung:', storeUrl);
        await Linking.openURL(storeUrl);
      }
      
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
