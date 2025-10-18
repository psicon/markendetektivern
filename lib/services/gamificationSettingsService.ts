import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Service für Gamification-Einstellungen
 * Verwaltet ob User Level-Ups und Achievements sehen möchte
 */

const STORAGE_KEYS = {
  NOTIFICATIONS_DISABLED: '@gamification_notifications_disabled',
};

class GamificationSettingsService {
  /**
   * Prüfe ob Gamification-Benachrichtigungen deaktiviert sind
   */
  async areNotificationsDisabled(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_DISABLED);
      return value === 'true';
    } catch (error) {
      console.error('Error checking gamification notifications setting:', error);
      return false; // Default: aktiviert
    }
  }

  /**
   * Setze Gamification-Benachrichtigungen Status
   */
  async setNotificationsDisabled(disabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.NOTIFICATIONS_DISABLED,
        disabled ? 'true' : 'false'
      );
      console.log(`✅ Gamification notifications ${disabled ? 'deaktiviert' : 'aktiviert'}`);
    } catch (error) {
      console.error('Error setting gamification notifications:', error);
      throw error;
    }
  }
}

export const gamificationSettingsService = new GamificationSettingsService();

