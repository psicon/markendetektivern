import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Alert } from 'react-native';
import { db } from '../firebase';
import { isExpoGo } from '../utils/platform';

interface UserRatingData {
  loginCount: number;
  lastRatingRequest: Date | null;
  hasRatedPositively: boolean;
  hasRatedNegatively: boolean;
  lastAsked: Date | null;
}

interface FeedbackData {
  userId: string;
  feedback: string;
  timestamp: Date;
  userLevel: number;
  loginCount: number;
}

class AppRatingService {
  private static instance: AppRatingService;
  private showRatingModal: ((show: boolean) => void) | null = null;
  
  // 🎯 Pending Rating Flag - wird bei nächster User-Aktion ausgelöst
  private pendingRatingUser: string | null = null;

  static getInstance(): AppRatingService {
    if (!AppRatingService.instance) {
      AppRatingService.instance = new AppRatingService();
    }
    return AppRatingService.instance;
  }

  /**
   * Register the rating modal show function
   */
  setRatingModalHandler(handler: (show: boolean) => void) {
    this.showRatingModal = handler;
    console.log(`📱 Rating Modal Handler ${handler ? 'registered' : 'unregistered'}`);
  }

  /**
   * DEBUG: Test rating modal directly
   */
  testShowModal() {
    console.log('🧪 Testing rating modal...');
    if (this.showRatingModal) {
      this.showRatingModal(true);
      console.log('📱 Test modal triggered!');
    } else {
      console.error('❌ No modal handler for test!');
    }
  }

  /**
   * Check if pending rating should be shown (bei jeder User-Aktion)
   */
  checkPendingRating(): void {
    if (this.pendingRatingUser) {
      console.log('📱 Pending rating found - showing modal now!');
      const userId = this.pendingRatingUser;
      this.pendingRatingUser = null; // Reset flag
      
      // Show modal with delay to ensure smooth UX
      setTimeout(() => {
        if (this.showRatingModal) {
          this.showRatingModal(true);
          console.log('📱 Pending rating modal shown!');
          
          // Mark as asked now
          this.markRatingAsked(userId);
        }
      }, 500); // 500ms für smooth transition
    }
  }

  /**
   * Check if user should be prompted for app rating
   */
  async shouldPromptRating(userId: string, triggerType: 'login' | 'level'): Promise<boolean> {
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (!userDoc.exists()) {
        return false;
      }

      const userData = userDoc.data();
      const ratingData: UserRatingData = {
        loginCount: userData.stats?.loginCount || 0,
        lastRatingRequest: userData.ratings?.lastRatingRequest?.toDate() || null,
        hasRatedPositively: userData.ratings?.hasRatedPositively || false,
        hasRatedNegatively: userData.ratings?.hasRatedNegatively || false,
        lastAsked: userData.ratings?.lastAsked?.toDate() || null,
      };

      // Skip if already rated (positive or negative)
      if (ratingData.hasRatedPositively || ratingData.hasRatedNegatively) {
        console.log('📱 Rating bereits abgegeben - skip');
        return false;
      }

      // Check 2-month cooldown
      if (ratingData.lastAsked) {
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
        if (ratingData.lastAsked > twoMonthsAgo) {
          console.log('📱 Rating Cooldown aktiv - skip');
          return false;
        }
      }

      // Check trigger conditions
      const currentLevel = userData.stats?.currentLevel || 1;
      const shouldPrompt = ratingData.loginCount >= 5 || currentLevel >= 2;

      console.log(`📱 Rating Check Details:`);
      console.log(`   - loginCount: ${ratingData.loginCount} (>= 5: ${ratingData.loginCount >= 5})`);
      console.log(`   - currentLevel: ${currentLevel} (>= 2: ${currentLevel >= 2})`);
      console.log(`   - hasRatedPositively: ${ratingData.hasRatedPositively}`);
      console.log(`   - hasRatedNegatively: ${ratingData.hasRatedNegatively}`);
      console.log(`   - lastAsked: ${ratingData.lastAsked}`);
      console.log(`   - shouldPrompt: ${shouldPrompt}`);
      
      return shouldPrompt;
    } catch (error) {
      console.error('❌ Rating check error:', error);
      return false;
    }
  }

  /**
   * Increment login count for rating trigger
   */
  async incrementLoginCount(userId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const currentCount = userDoc.data().stats?.loginCount || 0;
        await updateDoc(userRef, {
          'stats.loginCount': currentCount + 1,
          'stats.lastLoginAt': serverTimestamp(),
        });

        // Check if should prompt rating after login
        const shouldPrompt = await this.shouldPromptRating(userId, 'login');
        if (shouldPrompt) {
          this.promptForRating(userId, 'login');
        }
      }
    } catch (error) {
      console.error('❌ Login count increment error:', error);
    }
  }

  /**
   * Check rating after level up
   */
  async checkRatingAfterLevelUp(userId: string, newLevel: number): Promise<void> {
    try {
      console.log(`📱 checkRatingAfterLevelUp: userId=${userId}, newLevel=${newLevel}`);
      
      if (newLevel >= 2) {
        console.log('📱 Level >= 2 - checking if should prompt...');
        const shouldPrompt = await this.shouldPromptRating(userId, 'level');
        console.log(`📱 shouldPrompt result: ${shouldPrompt}`);
        
        if (shouldPrompt) {
          console.log('📱 Setting pending rating for next user action...');
          this.pendingRatingUser = userId;
          console.log('📱 Rating will show on next user interaction!');
        } else {
          console.log('📱 Rating prompt skipped - conditions not met');
        }
      } else {
        console.log(`📱 Level ${newLevel} < 2 - no rating prompt`);
      }
    } catch (error) {
      console.error('❌ Level rating check error:', error);
    }
  }

  /**
   * Show rating modal (with delay for level triggers to avoid overlay conflicts)
   */
  private promptForRating(userId: string, triggerType: 'login' | 'level') {
    console.log(`📱 promptForRating called: userId=${userId}, type=${triggerType}`);
    console.log(`📱 Modal handler available: ${this.showRatingModal ? 'YES' : 'NO'}`);
    
    // Mark as asked
    this.markRatingAsked(userId);

    if (triggerType === 'level') {
      // Delay für Level-Trigger - warte bis Level-Up Overlay geschlossen ist
      console.log('📱 Level trigger - setting 1s delay...');
      setTimeout(() => {
        console.log('📱 1s delay complete - showing modal...');
        if (this.showRatingModal) {
          this.showRatingModal(true);
          console.log('📱 Rating modal should be visible now!');
        } else {
          console.error('❌ No modal handler available!');
        }
      }, 1000); // 1s Delay nach Level-Up
    } else {
      // Login-Trigger sofort
      console.log('📱 Login trigger - showing modal immediately...');
      if (this.showRatingModal) {
        this.showRatingModal(true);
        console.log('📱 Rating modal should be visible now!');
      } else {
        console.error('❌ No modal handler available!');
      }
    }
  }

  /**
   * Handle positive rating (thumbs up)
   */
  async handlePositiveRating(userId: string): Promise<void> {
    try {
      // Update user rating status
      await updateDoc(doc(db, 'users', userId), {
        'ratings.hasRatedPositively': true,
        'ratings.lastRatingRequest': serverTimestamp(),
      });

      console.log('👍 User rated positively');

      // Show store review prompt
      await this.requestStoreReview();
    } catch (error) {
      console.error('❌ Positive rating error:', error);
    }
  }

  /**
   * Handle negative rating (thumbs down)
   */
  async handleNegativeRating(userId: string, feedback?: string): Promise<void> {
    try {
      // Update user rating status
      await updateDoc(doc(db, 'users', userId), {
        'ratings.hasRatedNegatively': true,
        'ratings.lastRatingRequest': serverTimestamp(),
      });

      // Save feedback if provided
      if (feedback && feedback.trim().length > 0) {
        await this.saveFeedback(userId, feedback.trim());
      }

      console.log('👎 User rated negatively', feedback ? 'with feedback' : 'without feedback');
    } catch (error) {
      console.error('❌ Negative rating error:', error);
    }
  }

  /**
   * Request native store review (public method)
   */
  async requestStoreReview(): Promise<void> {
    try {
      if (isExpoGo()) {
        Alert.alert(
          'Store Review',
          'In Production würde jetzt der native Store-Bewertung Dialog öffnen',
          [{ text: 'OK' }]
        );
      } else {
        const StoreReview = require('react-native-store-review');
        StoreReview.requestReview();
      }
    } catch (error) {
      console.error('❌ Store review request error:', error);
      Alert.alert('Fehler', 'Bewertung konnte nicht geöffnet werden');
    }
  }

  /**
   * Save user feedback to Firestore
   */
  private async saveFeedback(userId: string, feedback: string): Promise<void> {
    try {
      console.log(`💾 Saving feedback for userId: ${userId}`);
      console.log(`💾 Feedback text: "${feedback}"`);
      
      const userDoc = await getDoc(doc(db, 'users', userId));
      const userData = userDoc.data();
      
      const feedbackData = {
        userId,
        feedback,
        timestamp: serverTimestamp(),
        userLevel: userData?.stats?.currentLevel || 1,
        loginCount: userData?.stats?.loginCount || 0,
        created_time: serverTimestamp(),
      };

      const feedbackDocId = `${userId}_${Date.now()}`;
      console.log(`💾 Creating feedback document: ${feedbackDocId}`);
      
      await setDoc(doc(db, 'userfeedback', feedbackDocId), feedbackData);

      console.log('✅ User feedback saved to Firestore successfully');
    } catch (error) {
      console.error('❌ Feedback save error details:', error);
      console.error('❌ Error code:', error.code);
      console.error('❌ Error message:', error.message);
      
      // Fallback: Speichere im user document wenn Collection-Zugriff fehlschlägt
      try {
        console.log('🔄 Fallback: Saving feedback in user document...');
        await updateDoc(doc(db, 'users', userId), {
          'ratings.lastFeedback': feedback,
          'ratings.lastFeedbackTimestamp': serverTimestamp(),
        });
        console.log('✅ Feedback als Fallback im User-Dokument gespeichert');
      } catch (fallbackError) {
        console.error('❌ Feedback fallback auch fehlgeschlagen:', fallbackError);
        throw new Error('Feedback konnte nicht gespeichert werden');
      }
    }
  }

  /**
   * Mark rating as asked (for cooldown)
   */
  private async markRatingAsked(userId: string): Promise<void> {
    try {
      await updateDoc(doc(db, 'users', userId), {
        'ratings.lastAsked': serverTimestamp(),
      });
    } catch (error) {
      console.error('❌ Mark rating asked error:', error);
    }
  }
}

export const appRatingService = AppRatingService.getInstance();
