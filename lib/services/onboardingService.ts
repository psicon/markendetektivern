import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_COMPLETED_KEY = 'onboarding_v1_completed';
const ONBOARDING_SKIPPED_KEY = 'onboarding_v1_skipped';
const ONBOARDING_PROGRESS_KEY = 'onboarding_v1_progress';

export interface OnboardingProgress {
  currentStep: number;
  completedSteps: number[];
  data: any;
}

export class OnboardingService {
  /**
   * Prüft ob Onboarding bereits abgeschlossen wurde
   */
  static async isOnboardingCompleted(): Promise<boolean> {
    try {
      const completed = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
      return completed === 'true';
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      return false;
    }
  }

  /**
   * Prüft ob Onboarding übersprungen wurde
   */
  static async isOnboardingSkipped(): Promise<boolean> {
    try {
      const skipped = await AsyncStorage.getItem(ONBOARDING_SKIPPED_KEY);
      return skipped === 'true';
    } catch (error) {
      console.error('Error checking onboarding skip status:', error);
      return false;
    }
  }

  /**
   * Prüft ob User das Onboarding hinter sich hat (completed ODER skipped)
   */
  static async hasPassedOnboarding(): Promise<boolean> {
    try {
      const [completed, skipped] = await Promise.all([
        this.isOnboardingCompleted(),
        this.isOnboardingSkipped()
      ]);
      return completed || skipped;
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      return false;
    }
  }

  /**
   * Markiert Onboarding als abgeschlossen
   */
  static async markOnboardingCompleted(): Promise<void> {
    try {
      await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true');
      // Lösche Progress da nicht mehr benötigt
      await AsyncStorage.removeItem(ONBOARDING_PROGRESS_KEY);
    } catch (error) {
      console.error('Error marking onboarding as completed:', error);
      throw error;
    }
  }

  /**
   * Speichert Onboarding Progress für Resume-Funktionalität
   */
  static async saveProgress(progress: OnboardingProgress): Promise<void> {
    try {
      await AsyncStorage.setItem(ONBOARDING_PROGRESS_KEY, JSON.stringify(progress));
    } catch (error) {
      console.error('Error saving onboarding progress:', error);
    }
  }

  /**
   * Lädt gespeicherten Onboarding Progress
   */
  static async loadProgress(): Promise<OnboardingProgress | null> {
    try {
      const progressJson = await AsyncStorage.getItem(ONBOARDING_PROGRESS_KEY);
      if (progressJson) {
        return JSON.parse(progressJson);
      }
      return null;
    } catch (error) {
      console.error('Error loading onboarding progress:', error);
      return null;
    }
  }

  /**
   * Löscht Onboarding Progress
   */
  static async clearProgress(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ONBOARDING_PROGRESS_KEY);
    } catch (error) {
      console.error('Error clearing onboarding progress:', error);
    }
  }

  /**
   * Reset Onboarding (für Testing)
   */
  static async resetOnboarding(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ONBOARDING_COMPLETED_KEY);
      await AsyncStorage.removeItem(ONBOARDING_PROGRESS_KEY);
      console.log('✅ Onboarding reset successfully');
    } catch (error) {
      console.error('Error resetting onboarding:', error);
      throw error;
    }
  }

  /**
   * Bestimmt die initiale Route basierend auf Onboarding Status
   */
  static async getInitialRoute(): Promise<string> {
    try {
      const isCompleted = await this.isOnboardingCompleted();
      
      if (isCompleted) {
        // Onboarding bereits abgeschlossen → Main App
        return '/(tabs)';
      } else {
        // Prüfe ob es einen gespeicherten Progress gibt
        const progress = await this.loadProgress();
        
        if (progress && progress.currentStep > 1) {
          // Resume Onboarding an der gespeicherten Stelle
          const stepRoutes = [
            '/onboarding/hero',
            '/onboarding/country-auth',
            '/onboarding/market-selection',
            '/onboarding/acquisition-source',
            '/onboarding/budget-slider',
            '/onboarding/priorities',
            '/onboarding/loading',
            '/onboarding/savings-chart',
            '/onboarding/paywall'
          ];
          
          const routeIndex = Math.min(progress.currentStep - 1, stepRoutes.length - 1);
          return stepRoutes[routeIndex];
        } else {
          // Neues Onboarding starten
          return '/onboarding/hero';
        }
      }
    } catch (error) {
      console.error('Error determining initial route:', error);
      // Fallback zu Main App bei Fehler
      return '/(tabs)';
    }
  }
}
