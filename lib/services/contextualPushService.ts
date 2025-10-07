import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushNotificationService } from './pushNotificationService';

/**
 * Contextual Push Notification Service
 * Fragt Push Permissions zur richtigen Zeit und im richtigen Kontext
 */
class ContextualPushService {
  private static instance: ContextualPushService;
  
  private constructor() {}
  
  static getInstance(): ContextualPushService {
    if (!ContextualPushService.instance) {
      ContextualPushService.instance = new ContextualPushService();
    }
    return ContextualPushService.instance;
  }

  /**
   * Prüft ob Push Permission bereits angefragt wurde
   */
  private async hasAskedForPermission(): Promise<boolean> {
    try {
      const asked = await AsyncStorage.getItem('push_permission_asked');
      return asked === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Markiert Push Permission als angefragt
   */
  private async markPermissionAsked(): Promise<void> {
    try {
      await AsyncStorage.setItem('push_permission_asked', 'true');
    } catch (error) {
      console.error('Error marking permission as asked:', error);
    }
  }

  /**
   * CONTEXTUAL: Nach erstem Achievement
   * "Lass dich über neue Achievements benachrichtigen!"
   */
  async promptAfterFirstAchievement(userId: string): Promise<void> {
    if (await this.hasAskedForPermission()) return;

    // Hier würde ein schöner Modal/Alert kommen
    console.log('🏆 Contextual Push: Nach erstem Achievement');
    
    // Für jetzt: Automatisch aktivieren
    await pushNotificationService.initialize(userId);
    await this.markPermissionAsked();
  }

  /**
   * CONTEXTUAL: Nach 3 Tagen App-Nutzung
   * "Bleib auf dem Laufenden über neue NoName-Entdeckungen!"
   */
  async promptAfterEngagement(userId: string): Promise<void> {
    if (await this.hasAskedForPermission()) return;

    const firstLaunch = await AsyncStorage.getItem('first_app_launch');
    if (!firstLaunch) return;

    const daysSinceFirstLaunch = (Date.now() - parseInt(firstLaunch)) / (1000 * 60 * 60 * 24);
    
    if (daysSinceFirstLaunch >= 3) {
      console.log('📱 Contextual Push: Nach 3 Tagen Engagement');
      
      // Hier würde ein schöner Modal/Alert kommen
      await pushNotificationService.initialize(userId);
      await this.markPermissionAsked();
    }
  }

  /**
   * CONTEXTUAL: Bei erstem großen Sparbetrag
   * "Lass dich über Preisalarme benachrichtigen!"
   */
  async promptAfterBigSavings(userId: string, totalSavings: number): Promise<void> {
    if (await this.hasAskedForPermission()) return;
    
    if (totalSavings >= 50) { // Ab 50€ Ersparnis
      console.log('💰 Contextual Push: Nach großen Ersparnissen');
      
      // Hier würde ein schöner Modal/Alert kommen
      await pushNotificationService.initialize(userId);
      await this.markPermissionAsked();
    }
  }

  /**
   * ONBOARDING: Als Teil des Onboarding-Flows
   * Elegante Integration ohne separaten Toggle
   */
  async promptDuringOnboarding(userId: string): Promise<void> {
    console.log('🎯 Contextual Push: Während Onboarding');
    
    // Hier würde es Teil des Onboarding-Flows sein
    await pushNotificationService.initialize(userId);
    await this.markPermissionAsked();
  }

  /**
   * Initialisiert First Launch Tracking
   */
  async initializeFirstLaunchTracking(): Promise<void> {
    try {
      const firstLaunch = await AsyncStorage.getItem('first_app_launch');
      if (!firstLaunch) {
        await AsyncStorage.setItem('first_app_launch', Date.now().toString());
      }
    } catch (error) {
      console.error('Error initializing first launch tracking:', error);
    }
  }
}

export const contextualPushService = ContextualPushService.getInstance();
