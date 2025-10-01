interface OnboardingResult {
  userId: string;
  sessionId: string;
  status: 'completed' | 'abandoned' | 'in_progress';
  
  // Timing (Firestore Timestamps)
  startTime: any; // Firestore Timestamp
  lastUpdateTime: any; // Firestore Timestamp  
  completedAt?: any; // Firestore Timestamp
  totalDurationMs?: number;
  
  // Progress
  currentStep: number;
  completedSteps: number[];
  abandonedAtStep?: number;
  abandonReason?: 'user_skip' | 'app_closed' | 'later_button';
  
  // Data (wird schrittweise gefüllt)
  country?: 'DE' | 'AT' | 'CH';
  authChoice?: 'anonymous' | 'register' | 'login';
  favoriteMarket?: any;
  acquisitionSource?: string;
  acquisitionOther?: string;
  weeklyBudgetEur?: number;
  priorities?: string[];
  prioritiesOther?: string;
  estimatedSavingsPercent?: number;
  estimatedSavingsEurWeek?: number;
  
  // Analytics
  version: string;
  platform: string;
}

export class OnboardingTrackingService {
  public static sessionId: string = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  private static currentResult: OnboardingResult | null = null;

  /**
   * Initialisiere Onboarding Session
   */
  static async initializeSession(userId?: string) {
    const { serverTimestamp } = await import('firebase/firestore');
    
    this.currentResult = {
      userId: userId || 'anonymous',
      sessionId: this.sessionId,
      status: 'in_progress',
      startTime: serverTimestamp(),
      lastUpdateTime: serverTimestamp(),
      currentStep: 1,
      completedSteps: [],
      version: 'v1',
      platform: 'mobile'
    };
    
    // Speichere initial in Firestore
    await this.saveCurrentResult();
  }

  /**
   * Update Step Progress
   */
  static async updateStep(stepNumber: number, stepData?: any, userId?: string) {
    if (!this.currentResult) {
      await this.initializeSession(userId);
    }
    
    if (this.currentResult) {
      const { serverTimestamp } = await import('firebase/firestore');
      
      this.currentResult.currentStep = stepNumber;
      this.currentResult.lastUpdateTime = serverTimestamp();
      
      if (!this.currentResult.completedSteps.includes(stepNumber - 1) && stepNumber > 1) {
        this.currentResult.completedSteps.push(stepNumber - 1);
      }
      
      // Merge step data
      if (stepData) {
        Object.assign(this.currentResult, stepData);
      }
      
      // Speichere Update
      await this.saveCurrentResult();
    }
  }

  /**
   * Track Skip/Abandon
   */
  static async trackSkip(currentStep: number, reason: 'user_skip' | 'later_button' | 'app_closed', userId?: string) {
    if (!this.currentResult) {
      await this.initializeSession(userId);
    }
    
    if (this.currentResult) {
      const { serverTimestamp } = await import('firebase/firestore');
      
      this.currentResult.status = 'abandoned';
      this.currentResult.abandonedAtStep = currentStep;
      this.currentResult.abandonReason = reason;
      this.currentResult.completedAt = serverTimestamp();
      
      // Berechne Duration (nur wenn startTime ein Timestamp ist)
      const startTimeMs = this.currentResult.startTime?.toMillis ? this.currentResult.startTime.toMillis() : Date.now();
      this.currentResult.totalDurationMs = Date.now() - startTimeMs;
      
      await this.saveCurrentResult();
      console.log('📊 Onboarding abandoned at step:', currentStep, 'reason:', reason);
    }
  }

  /**
   * Track Completion
   */
  static async trackCompletion(finalData: any, userId?: string) {
    if (!this.currentResult) {
      await this.initializeSession(userId);
    }
    
    if (this.currentResult) {
      const { serverTimestamp } = await import('firebase/firestore');
      
      this.currentResult.status = 'completed';
      this.currentResult.completedAt = serverTimestamp();
      this.currentResult.completedSteps.push(9); // Final step
      
      // Berechne Duration (nur wenn startTime ein Timestamp ist)
      const startTimeMs = this.currentResult.startTime?.toMillis ? this.currentResult.startTime.toMillis() : Date.now();
      this.currentResult.totalDurationMs = Date.now() - startTimeMs;
      
      // Merge final data
      Object.assign(this.currentResult, finalData);
      
      await this.saveCurrentResult();
      console.log('📊 Onboarding completed successfully');
    }
  }

  /**
   * Speichere aktuellen Zustand in Firestore
   */
  private static async saveCurrentResult() {
    if (!this.currentResult) return;
    
    try {
      const { setDoc, doc } = await import('firebase/firestore');
      const { db } = await import('@/lib/firebase');
      
      // Verwende sessionId als Document ID für Updates
      await setDoc(doc(db, 'onboardingResultsV5', this.sessionId), this.currentResult);
      
      console.log('📊 Onboarding result updated:', this.currentResult.status, 'Step:', this.currentResult.currentStep);
      
    } catch (error) {
      console.error('❌ Error saving onboarding result:', error);
    }
  }

  /**
   * Reset Session
   */
  static resetSession() {
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.currentResult = null;
  }
}
