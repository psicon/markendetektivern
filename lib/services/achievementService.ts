import * as Haptics from 'expo-haptics';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    updateDoc,
    writeBatch
} from 'firebase/firestore';
import { Alert } from 'react-native';
import { db } from '../firebase';
import {
    Achievement,
    AchievementEvent,
    ActionType,
    DEFAULT_ACHIEVEMENTS,
    LEVELS,
    UserAchievementProgress,
    UserStats
} from '../types/achievements';

class AchievementService {
  private static instance: AchievementService;
  private achievements: Achievement[] = [];
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private profileRefreshCallback: (() => Promise<void>) | null = null;

  private constructor() {
    console.log('🎯 AchievementService Singleton erstellt');
  }

  static getInstance(): AchievementService {
    if (!AchievementService.instance) {
      AchievementService.instance = new AchievementService();
    }
    return AchievementService.instance;
  }

  /**
   * Initialisiert das Achievement-System und lädt alle Achievements
   */
  async initialize(): Promise<void> {
    // Return existing initialization if in progress
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    
    if (this.isInitialized) {
      return Promise.resolve();
    }

    // Create initialization promise
    this.initializationPromise = this._doInitialize();
    return this.initializationPromise;
  }
  
  private async _doInitialize(): Promise<void> {
    try {
      console.log('🔄 Initialisiere Achievement-System...');
      
      // Lade Achievements aus Firestore
      const achievementsSnapshot = await getDocs(collection(db, 'achievements'));
      
      if (achievementsSnapshot.empty) {
        console.log('📝 Keine Achievements gefunden, erstelle Standard-Achievements...');
        // Wenn keine Achievements existieren, erstelle die Standard-Achievements
        await this.createDefaultAchievements();
      } else {
        this.achievements = achievementsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Achievement));
      }

      this.isInitialized = true;
      console.log('✅ Achievement-System initialisiert mit', this.achievements.length, 'Achievements');
    } catch (error: any) {
      // Bei Permission-Fehler: Stumm behandeln und lokale Defaults verwenden
      if (error?.code === 'permission-denied') {
        console.log('🔄 User noch nicht authentifiziert, verwende lokale Achievement-Defaults');
        this.achievements = DEFAULT_ACHIEVEMENTS.map((achievement, index) => ({
          ...achievement,
          id: `local_${index}`,
          createdAt: new Date()
        }));
        this.isInitialized = true;
      } else {
        // Nur bei echten Fehlern (nicht Permission) loggen
        console.error('❌ Fehler beim Initialisieren des Achievement-Systems:', error);
        this.initializationPromise = null; // Reset on error
        throw error;
      }
    }
  }

  /**
   * Erstellt die Standard-Achievements in Firestore
   */
  private async createDefaultAchievements(): Promise<void> {
    const batch = writeBatch(db);

    for (const achievement of DEFAULT_ACHIEVEMENTS) {
      const docRef = doc(collection(db, 'achievements'));
      batch.set(docRef, {
        ...achievement,
        createdAt: serverTimestamp()
      });
    }

    await batch.commit();
    console.log('✅ Standard-Achievements erstellt');

    // Lade die erstellten Achievements
    const achievementsSnapshot = await getDocs(collection(db, 'achievements'));
    this.achievements = achievementsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Achievement));
  }

  /**
   * Trackt eine User-Aktion und aktualisiert Achievement-Progress
   */
  async trackAction(userId: string, action: ActionType, metadata?: any): Promise<void> {
    if (!userId) {
      console.warn('⚠️ trackAction called without userId');
      return;
    }
    
    // Ensure initialization
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      console.log(`📊 Tracking action: ${action} für User: ${userId}`);

      // Erstelle Event für Logging (optional für spätere Analyse)
      const event: AchievementEvent = {
        userId,
        action,
        timestamp: new Date(),
        metadata
      };

      // Finde alle relevanten Achievements für diese Action
      const relevantAchievements = this.achievements.filter(
        a => a.isActive && a.trigger.action === action
      );

      if (relevantAchievements.length === 0) {
        console.log(`Keine Achievements für Action: ${action}`);
        return;
      }

      // Hole User-Dokument
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        console.error('User nicht gefunden:', userId);
        return;
      }

      const userData = userDoc.data();
      const userAchievements = userData.achievements || {};
      const userStats = userData.stats || this.getDefaultUserStats();

      // Update User Stats basierend auf Action
      const updatedStats = await this.updateUserStats(userStats, action, metadata);

      // Batch für alle Updates
      const batch = writeBatch(db);
      let pointsEarned = 0;
      const completedAchievements: Achievement[] = [];

      // Prüfe jeden relevanten Achievement
      for (const achievement of relevantAchievements) {
        const progressKey = achievement.id;
        const currentProgress = userAchievements[progressKey] || {
          achievementId: achievement.id,
          progress: 0,
          completed: false,
          lastUpdated: new Date()
        };
        
        // Skip wenn bereits abgeschlossen
        if (currentProgress.completed && achievement.type === 'one-time') {
          continue;
        }
        
        // Berechne neuen Progress basierend auf Achievement-Typ
        let newProgress = currentProgress.progress;

        switch (achievement.type) {
          case 'one-time':
          case 'count':
            newProgress = currentProgress.progress + 1;
            break;
          case 'streak':
            // Streak wird durch updateUserStats gehandhabt
            newProgress = updatedStats.currentStreak;
            break;
          case 'milestone':
            // Milestone basiert auf Gesamtwerten
            newProgress = this.getMilestoneProgress(achievement, updatedStats);
            break;
        }

        // Prüfe ob Achievement abgeschlossen wurde
        const isCompleted = newProgress >= achievement.trigger.target;

        if (isCompleted && !currentProgress.completed) {
          // Achievement wurde gerade abgeschlossen!
          pointsEarned += achievement.points;
          completedAchievements.push(achievement);
          console.log(`🏆 Achievement unlocked: ${achievement.name} (+${achievement.points} Punkte)`);
        }

        // Update Achievement Progress
        const updatedProgress: UserAchievementProgress = {
          achievementId: achievement.id,
          progress: Math.min(newProgress, achievement.trigger.target),
          completed: isCompleted,
          lastUpdated: new Date()
        };
        
        // Nur completedAt setzen wenn vorhanden
        if (isCompleted && !currentProgress.completed) {
          updatedProgress.completedAt = new Date();
        } else if (currentProgress.completedAt) {
          updatedProgress.completedAt = currentProgress.completedAt;
        }
        
        userAchievements[progressKey] = updatedProgress;
      }

      // Update User Document
      const updates: any = {
        achievements: userAchievements,
        stats: updatedStats,
        lastActivityAt: serverTimestamp()
      };

      // Punkte aktualisieren falls verdient
      if (pointsEarned > 0) {
        updates.stats.totalPoints = (updatedStats.totalPoints || 0) + pointsEarned;
      }
      
      // Level-Update wird jetzt durch checkAndUpdateLevel nach der Action behandelt
      // (Keine doppelte Level-Up Logik hier!)

      batch.update(userRef, updates);
      await batch.commit();
      
      // Trigger UI-Benachrichtigungen für abgeschlossene Achievements
      if (completedAchievements.length > 0) {
        await this.notifyAchievementUnlock(completedAchievements);
      }

      // IMMER Level-Check nach Achievement-Action (auch ohne neue Punkte - Ersparnis kann sich ändern!)
      console.log('🎯 Triggering level check after achievement action');
      await this.checkAndUpdateLevel(userId);
      
      // Profile-Refresh triggern nach jeder Achievement-Action (nur wenn Stats sich geändert haben)  
      if (pointsEarned > 0 || Object.keys(updates.stats || {}).length > 1) {
        console.log('🔄 Triggering profile refresh after achievement action');
        if (AchievementService.onProfileRefreshNeeded) {
          await AchievementService.onProfileRefreshNeeded();
          console.log('✅ Profile refreshed via callback');
        }
      }

    } catch (error) {
      console.error('❌ Fehler beim Tracken der Action:', error);
      throw error;
    }
  }

  /**
   * Aktualisiert User Stats basierend auf Action
   */
  private async updateUserStats(stats: UserStats, action: ActionType, metadata?: any): Promise<UserStats> {
    const updatedStats = { ...stats };

    // Update Action-spezifische Counter
    switch (action) {
      case 'convert_product':
        updatedStats.conversions = (updatedStats.conversions || 0) + 1;
        break;
      case 'complete_shopping':
        updatedStats.shoppingListsCompleted = (updatedStats.shoppingListsCompleted || 0) + 1;
        break;
      case 'view_comparison':
        updatedStats.comparisonsViewed = (updatedStats.comparisonsViewed || 0) + 1;
        break;
      case 'submit_rating':
        updatedStats.ratingsSubmitted = (updatedStats.ratingsSubmitted || 0) + 1;
        break;
      case 'scan_product':
        updatedStats.productsScanned = (updatedStats.productsScanned || 0) + 1;
        break;
      case 'search_product':
        updatedStats.productsSearched = (updatedStats.productsSearched || 0) + 1;
        break;
      case 'save_product':
        updatedStats.favoritesAdded = (updatedStats.favoritesAdded || 0) + 1;
        break;
      case 'create_list':
        updatedStats.listsCreated = (updatedStats.listsCreated || 0) + 1;
        break;
      case 'daily_streak':
        // Streak wird separat gehandhabt
        break;
    }

    // Update Timestamps
    updatedStats.lastActivityAt = new Date();
    updatedStats.statsUpdatedAt = new Date();

    return updatedStats;
  }

  /**
   * Prüft und aktualisiert Level beim App-Start
   */
  async checkAndUpdateLevel(userId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) return;
      
      const userData = userDoc.data();
      const stats = userData.stats || {};
      const totalPoints = stats.totalPoints || 0;
      // Priorisiere totalSavings aus userData (wird durch updateUserStats aktualisiert)
      const totalSavings = userData.totalSavings || stats.totalSavings || 0;
      const currentLevel = stats.currentLevel || userData.level || 1;
      
      console.log(`🔍 Level-Check Daten:`, {
        totalPoints,
        totalSavings,  
        currentLevel,
        userData_totalSavings: userData.totalSavings,
        stats_totalSavings: stats.totalSavings
      });
      
      // Berechne korrektes Level
      const correctLevel = this.calculateLevel(totalPoints, totalSavings);
      
      if (correctLevel !== currentLevel) {
        console.log(`🔄 Level-Korrektur: Von Level ${currentLevel} zu Level ${correctLevel}`);
        
        // Update stats.currentLevel
        await updateDoc(userRef, {
          'stats.currentLevel': correctLevel,
          'level': correctLevel // Auch altes level Feld updaten für Kompatibilität
        });
        
        // Benachrichtigung nur wenn echter Aufstieg (nicht bei Korrekturen)
        if (correctLevel > currentLevel) {
          console.log(`🎉 ECHTER Level-Aufstieg erkannt: ${currentLevel} → ${correctLevel}`);
          await this.notifyLevelUp(correctLevel, currentLevel);
        } else {
          console.log(`🔄 Level-Korrektur ohne Benachrichtigung: ${currentLevel} → ${correctLevel}`);
        }

        // Profile-Refresh triggern nach Level-Update
        console.log('🔄 Triggering profile refresh after level update');
        if (AchievementService.onProfileRefreshNeeded) {
          await AchievementService.onProfileRefreshNeeded();
          console.log('✅ Profile refreshed after level update');
        }
      }
      
      console.log(`✅ Level-Check: Level ${correctLevel} (${totalPoints} Punkte, €${totalSavings.toFixed(2)} Ersparnis)`);
    } catch (error) {
      console.error('❌ Fehler beim Level-Check:', error);
    }
  }
  
  /**
   * Prüft und aktualisiert die tägliche Streak
   */
  async checkDailyStreak(userId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) return;

      const userData = userDoc.data();
      const stats = userData.stats || this.getDefaultUserStats();

    const now = new Date();
      const today = this.getDateString(now);
      const lastOpenedAt = stats.lastOpenedAt ? new Date(stats.lastOpenedAt.seconds * 1000) : null;
      const lastStreakCheck = stats.lastStreakCheckDate;

      // Prüfe ob heute schon gecheckt wurde
      if (lastStreakCheck === today) {
        console.log('Streak bereits heute gecheckt');
        return;
      }

      let newStreak = stats.currentStreak || 0;
      let shouldResetStreak = false;

      if (lastOpenedAt) {
        const daysSinceLastOpen = this.getDaysDifference(lastOpenedAt, now);

        if (daysSinceLastOpen === 1) {
          // Consecutive day - increase streak
          newStreak = (stats.currentStreak || 0) + 1;
          console.log(`📈 Streak erhöht auf ${newStreak} Tage`);
        } else if (daysSinceLastOpen > 1) {
          // Streak broken - reset
          shouldResetStreak = true;
          newStreak = 1;
          console.log(`💔 Streak unterbrochen nach ${stats.currentStreak} Tagen`);
        }
        // daysSinceLastOpen === 0 bedeutet gleicher Tag, keine Änderung
    } else {
        // First time opening
        newStreak = 1;
      }

      // Update Stats
      const updates: any = {
        'stats.lastOpenedAt': serverTimestamp(),
        'stats.lastStreakCheckDate': today,
        'stats.currentStreak': newStreak,
        'stats.longestStreak': Math.max(newStreak, stats.longestStreak || 0)
      };

      await updateDoc(userRef, updates);

      // Track daily_streak action für Achievements
      if (newStreak > (stats.currentStreak || 0)) {
        await this.trackAction(userId, 'daily_streak');
      }

    } catch (error) {
      console.error('❌ Fehler beim Streak-Check:', error);
    }
  }

  /**
   * Berechnet das Level basierend auf Punkten und Ersparnis
   */
  private calculateLevel(totalPoints: number, totalSavings: number): number {
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      const level = LEVELS[i];
      if (totalPoints >= level.pointsRequired && totalSavings >= level.savingsRequired) {
        return level.id;
      }
    }
    return 1;
  }

  /**
   * Holt den Progress für Milestone-Achievements
   */
  private getMilestoneProgress(achievement: Achievement, stats: UserStats): number {
    // Implementiere je nach Milestone-Typ
    switch (achievement.trigger.action) {
      case 'convert_product':
        return stats.conversions || 0;
      case 'complete_shopping':
        return stats.shoppingListsCompleted || 0;
      case 'view_comparison':
        return stats.comparisonsViewed || 0;
      case 'submit_rating':
        return stats.ratingsSubmitted || 0;
      case 'scan_product':
        return stats.productsScanned || 0;
      case 'search_product':
        return stats.productsSearched || 0;
      case 'save_product':
        return stats.favoritesAdded || 0;
      default:
        return 0;
    }
  }

  /**
   * Benachrichtigt über Level-Aufstieg
   */
  private async notifyLevelUp(newLevel: number, oldLevel: number): Promise<void> {
    const levelData = LEVELS.find(l => l.id === newLevel);
    if (!levelData) return;
    
    console.log(`🎉 Level-Up Benachrichtigung: Level ${oldLevel} → ${newLevel}`);
    
    // Trigger UI Notification (STATISCHER Callback)
    if (AchievementService.onAchievementUnlock) {
      AchievementService.onAchievementUnlock({
        type: 'level_up',
        title: `🎉 Level ${newLevel}: ${levelData.name}!`,
        message: `${levelData.description}\n${levelData.reward}`,
        level: newLevel,
        oldLevel: oldLevel
      } as any);
      console.log('✅ Level-Up Benachrichtigung gesendet');
    } else {
      console.log('⚠️ Kein Achievement-Unlock Handler registriert');
    }
  }
  
  /**
   * Benachrichtigt über freigeschaltete Achievements
   */
  private async notifyAchievementUnlock(achievements: Achievement[]): Promise<void> {
    // Haptic Feedback für Achievement Unlock
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.log('Haptics nicht verfügbar');
    }
    
    // Zeige Toast für jedes Achievement
    for (const achievement of achievements) {
      console.log(`
        🏆 ACHIEVEMENT UNLOCKED! 🏆
        ${achievement.name}
        +${achievement.points} Punkte
        ${achievement.description}
      `);
      
      // Global Toast Callback (muss von der App gesetzt werden)
      if (AchievementService.onAchievementUnlock) {
        AchievementService.onAchievementUnlock(achievement);
      } else {
        // Fallback Alert wenn kein Toast Handler registriert
        Alert.alert(
          '🏆 Achievement freigeschaltet!',
          `${achievement.name}\n+${achievement.points} Punkte\n\n${achievement.description}`,
          [{ text: 'Fantastisch!', style: 'default' }]
        );
      }
    }
  }
  
  // Static callback für UI Integration
  private static onAchievementUnlock?: (achievement: Achievement) => void;
  private static onProfileRefreshNeeded?: () => Promise<void>;
  
  /**
   * Registriert einen Callback für Achievement Unlocks
   */
  static setAchievementUnlockHandler(handler: (achievement: Achievement) => void): void {
    AchievementService.onAchievementUnlock = handler;
  }

  /**
   * Registriert einen Callback für Profile-Refresh (wird nach jeder Achievement-Action aufgerufen)
   */
  static setProfileRefreshCallback(callback: () => Promise<void>): void {
    AchievementService.onProfileRefreshNeeded = callback;
    console.log('✅ Profile-Refresh-Callback registriert');
  }

  /**
   * Hilfsfunktionen
   */
  private getDateString(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private getDaysDifference(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.floor(diffTime / oneDay);
  }

  private getDefaultUserStats(): UserStats {
    return {
      totalPoints: 0,
      currentLevel: 1,
      totalSavings: 0,
      productsSaved: 0,
      conversions: 0,
      shoppingListsCompleted: 0,
      comparisonsViewed: 0,
      ratingsSubmitted: 0,
      productsScanned: 0,
      productsSearched: 0,
      favoritesAdded: 0,
      listsCreated: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastOpenedAt: new Date(),
      lastStreakCheckDate: this.getDateString(new Date()),
      lastActivityAt: new Date(),
      statsUpdatedAt: new Date()
    };
  }

  /**
   * Holt alle Achievements für die UI
   */
  async getAllAchievements(): Promise<Achievement[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return this.achievements;
  }

  /**
   * Holt User Achievement Progress
   */
  async getUserAchievements(userId: string): Promise<{ [key: string]: UserAchievementProgress }> {
    try {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        return {};
      }

      return userDoc.data().achievements || {};
    } catch (error) {
      console.error('Fehler beim Laden der User Achievements:', error);
      return {};
    }
  }

  /**
   * Holt User Stats
   */
  async getUserStats(userId: string): Promise<UserStats> {
    try {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        return this.getDefaultUserStats();
      }

      return userDoc.data().stats || this.getDefaultUserStats();
    } catch (error) {
      console.error('Fehler beim Laden der User Stats:', error);
      return this.getDefaultUserStats();
    }
  }
}

// Export Singleton Instance
const achievementService = AchievementService.getInstance();

// Auto-initialize on import (non-blocking) - STUMM bei Permission-Errors
achievementService.initialize().catch(error => {
  // Ignoriere Permission-Errors beim App-Start (User noch nicht auth)
  if (error?.code !== 'permission-denied') {
    console.warn('⚠️ Achievement-System konnte nicht automatisch initialisiert werden:', error);
  }
});

// Named export
export { achievementService };

// Default export for compatibility
export default achievementService;

// Re-export static methods for convenience
export const setAchievementUnlockHandler = AchievementService.setAchievementUnlockHandler;
export const setProfileRefreshCallback = AchievementService.setProfileRefreshCallback;
