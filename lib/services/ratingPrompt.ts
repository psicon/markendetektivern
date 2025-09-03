import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Alert } from 'react-native';
import { db } from '../firebase';
import { isExpoGo } from '../utils/platform';

const RATING_FLAG_KEY = 'pendingRatingPrompt';

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
      // Simple check: If not rated yet
      const hasRated = await AsyncStorage.getItem(`hasRated_${userId}`);
      return !hasRated;
    } catch (error) {
      console.log('❌ Error checking rating status:', error);
      return true; // Default to show
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
      if (isExpoGo()) {
        Alert.alert(
          'Store Review',
          'In Production würde jetzt der App Store öffnen',
          [{ text: 'OK' }]
        );
      } else {
        const StoreReview = require('react-native-store-review');
        StoreReview.requestReview();
      }
    } catch (error) {
      console.error('❌ Store review error:', error);
      Alert.alert('Fehler', 'Bewertung konnte nicht geöffnet werden');
    }
  }

  /**
   * Save feedback to existing Firestore rating document
   */
  async saveFeedback(userId: string, feedback: string, ratingDocId?: string): Promise<void> {
    try {
      console.log(`💾 Saving feedback to Firestore: ${feedback}`);
      
      if (ratingDocId) {
        // Update existing rating document with feedback
        const ratingDoc = doc(db, 'userfeedback', ratingDocId);
        await updateDoc(ratingDoc, {
          feedbackText: feedback,
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
          feedbackText: feedback,
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
