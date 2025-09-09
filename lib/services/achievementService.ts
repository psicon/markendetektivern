import { TOAST_MESSAGES } from '@/constants/ToastMessages';
import * as Haptics from 'expo-haptics';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch
} from 'firebase/firestore';
import { Alert } from 'react-native';
import { db } from '../firebase';
import {
    Achievement,
    AchievementEvent,
    ActionType,
    GameActionsConfig,
    Level,
    PointsLedgerEntry,
    StreakConfig,
    UserAchievementProgress,
    UserStats
} from '../types/achievements';
import { categoryAccessService } from './categoryAccessService';
import leaderboardService from './leaderboardService';
import { showDailyCapToast, showDedupeWindowToast, showOneTimeRestrictionToast, showWeeklyCapToast } from './ui/antiAbuseToast';

class AchievementService {
  private static instance: AchievementService;
  private achievements: Achievement[] = [];
  private levels: Level[] = [];
  private gameActions: GameActionsConfig | null = null;
  private streakConfig: StreakConfig | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private profileRefreshCallback: (() => Promise<void>) | null = null;
  private lastConfigLoad: number = 0;
  private configCacheDuration = 5 * 60 * 1000; // 5 Minuten Cache

  // Static Callbacks für UI-Integration
  static onAchievementUnlock: ((achievement: Achievement) => void) | null = null;
  static onPointsEarned: ((points: number, action: string, message: string) => void) | null = null;
  static onLevelUp: ((newLevel: number, oldLevel: number, unlockedCategory?: { id: string; name: string; imageUrl: string }) => void) | null = null;
  static onProfileRefreshNeeded: (() => Promise<void>) | null = null;

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
   * Vollständiger Reset für neue Authentifizierung
   * Löst Permission-Probleme beim ersten App-Start
   */
  resetForNewAuth(): void {
    console.log('🔄 RESET: Kompletter Gamification-Reset für neue Auth...');
    
    // Reset aller Caches und States
    this.isInitialized = false;
    this.initializationPromise = null;
    this.achievements = [];
    this.levels = [];
    this.gameActions = null;
    this.streakConfig = null;
    this.lastConfigLoad = 0;
    
    console.log('✅ RESET: Alle Caches und States zurückgesetzt');
  }

  // Static Methods für Callback-Registrierung
  static setAchievementUnlockHandler(handler: ((achievement: Achievement) => void) | null): void {
    AchievementService.onAchievementUnlock = handler;
    console.log('🔗 Achievement Unlock Handler registriert:', handler ? 'JA' : 'NEIN');
  }

  static setPointsEarnedHandler(handler: ((points: number, action: string, message: string) => void) | null): void {
    AchievementService.onPointsEarned = handler;
    console.log('🔗 Points Earned Handler registriert:', handler ? 'JA' : 'NEIN');
  }

  static setLevelUpHandler(handler: ((newLevel: number, oldLevel: number, unlockedCategory?: { id: string; name: string; imageUrl: string }) => void) | null): void {
    AchievementService.onLevelUp = handler;
    console.log('🔗 Level Up Handler registriert:', handler ? 'JA' : 'NEIN');
  }

  static setProfileRefreshCallback(handler: (() => Promise<void>) | null): void {
    AchievementService.onProfileRefreshNeeded = handler;
    console.log('🔗 Profile Refresh Callback registriert:', handler ? 'JA' : 'NEIN');
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
      
      // Lade alle Gamification-Daten aus Firestore
      await this.loadGameConfig();
      
      // Lade Achievements aus Firestore
      const achievementsSnapshot = await getDocs(collection(db, 'achievements'));
      
      if (!achievementsSnapshot.empty) {
        this.achievements = achievementsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as Achievement));
      }

      this.isInitialized = true;
      console.log('✅ Achievement-System initialisiert mit', this.achievements.length, 'Achievements');
    } catch (error: any) {
      // Behandle Permission-Errors graceful (User nicht authentifiziert)
      if (error?.code === 'permission-denied') {
        console.log('⚠️ Achievement-System: Warte auf User-Authentifizierung');
        this.initializationPromise = null; // Reset für späteren Versuch
        return; // Kein Fehler werfen
      }
      
      console.error('❌ Fehler beim Initialisieren des Achievement-Systems:', error);
      this.initializationPromise = null; // Reset on error
      throw error;
    }
  }

  /**
   * Lädt die komplette Gamification-Konfiguration aus Firestore
   * Mit Caching für Performance
   */
  async loadGameConfig(): Promise<void> {
    const now = Date.now();
    
    // Cache prüfen
    if (this.lastConfigLoad && (now - this.lastConfigLoad < this.configCacheDuration)) {
      console.log('📦 Verwende gecachte Gamification-Config');
      return;
    }

    try {
      console.log('🔄 Lade Gamification-Config aus Firestore...');
      console.log('📍 Pfade: levels=gamification/levels/items, actions=gamification/actions, streaks=gamification/streaks');
      
      // Parallel laden für bessere Performance (ohne config subcollection!)
      const [levelsSnapshot, actionsDoc, streaksDoc] = await Promise.all([
        getDocs(collection(db, 'gamification', 'levels', 'items')),
        getDoc(doc(db, 'gamification', 'actions')),
        getDoc(doc(db, 'gamification', 'streaks'))
      ]);

      console.log('📊 Firestore Response:', {
        levelsCount: levelsSnapshot.size,
        actionsExists: actionsDoc.exists(),
        streaksExists: streaksDoc.exists()
      });

      // Levels verarbeiten
      if (!levelsSnapshot.empty) {
        this.levels = levelsSnapshot.docs.map(doc => ({
          ...doc.data(),
          id: parseInt(doc.id)
        } as Level)).sort((a, b) => a.id - b.id);
        console.log(`✅ ${this.levels.length} Levels geladen`);
        
        // Firestore level data - reduced logging
      } else {
        throw new Error('Keine Levels in Firestore gefunden!');
      }

      // Actions verarbeiten
      if (actionsDoc.exists()) {
        const data = actionsDoc.data();
        this.gameActions = data as GameActionsConfig;
        console.log('✅ Game Actions geladen');
      } else {
        throw new Error('Keine Actions-Config in Firestore gefunden!');
      }

      // Streaks verarbeiten
      if (streaksDoc.exists()) {
        this.streakConfig = streaksDoc.data() as StreakConfig;
        console.log('✅ Streak-Config geladen');
      } else {
        throw new Error('Keine Streak-Config in Firestore gefunden!');
      }

      this.lastConfigLoad = now;
      
      // Erweitere Level-Rewards mit Kategorie-Namen
      await this.enhanceLevelRewardsWithCategories();
    } catch (error: any) {
      // Detaillierte Error-Analyse
      console.error('❌ Fehler beim Laden der Gamification-Config:', error);
      console.error('🔍 Error Details:', {
        code: error?.code,
        message: error?.message,
        isPermissionDenied: error?.code === 'permission-denied',
        isNetworkError: error?.message?.includes('network') || error?.code === 'unavailable'
      });

      // Behandle Permission-Errors graceful (User nicht authentifiziert)
      if (error?.code === 'permission-denied') {
        console.warn('⚠️ Gamification-Config: Permission denied - User noch nicht authentifiziert');
        return; // Kein Fehler werfen
      }
      
      // Network/Firestore temporäre Errors
      if (error?.code === 'unavailable' || error?.message?.includes('network')) {
        console.warn('⚠️ Gamification-Config: Network/Firestore temporär nicht verfügbar');
        return; // Kein Fehler werfen, später erneut versuchen
      }
      
      console.error('❌ Kritischer Gamification-Config Fehler');
      throw error;
    }
  }

  /**
   * Erweitert Level-Rewards mit dynamischen Kategorie-Namen
   */
  private async enhanceLevelRewardsWithCategories(): Promise<void> {
    try {
      // Für jedes Level prüfen ob eine Kategorie freigeschaltet wird
      for (const level of this.levels) {
        const unlockedCategory = await categoryAccessService.getCategoryUnlockedAtLevel(level.id);
        
        if (unlockedCategory) {
          // Erweitere den Reward-Text mit dem Kategorie-Namen
          level.reward = `${unlockedCategory.bezeichnung} freigeschaltet`;
          
          // Speichere zusätzliche Infos im Level-Objekt (für LevelUpOverlay)
          (level as any).unlockedCategory = {
            id: unlockedCategory.id,
            name: unlockedCategory.bezeichnung,
            imageUrl: unlockedCategory.bild
          };
          
          console.log(`📦 Level ${level.id} schaltet "${unlockedCategory.bezeichnung}" frei`);
        }
      }
    } catch (error) {
      console.error('❌ Fehler beim Erweitern der Level-Rewards:', error);
      // Nicht kritisch - verwende Standard-Rewards
    }
  }

  /**
   * Gibt alle Levels zurück (mit automatischem Loading)
   */
  async getAllLevels(): Promise<Level[]> {
    if (!this.isInitialized) {
      try {
        await this.initialize();
      } catch (error) {
        // Falls Initialisierung fehlschlägt, leeres Array zurückgeben
        console.log('⚠️ getAllLevels: Initialisierung fehlgeschlagen, verwende leeres Array');
        return [];
      }
    }
    
    return this.levels;
  }

  /**
   * Gibt alle Levels SYNC zurück (kann leer sein wenn nicht geladen)
   */
  getAllLevelsSync(): Level[] {
    return this.levels;
  }

  /**
   * Gibt die Game Actions Config zurück
   */
  getGameActions(): GameActionsConfig | null {
    return this.gameActions;
  }

  /**
   * Findet das Level basierend auf Punkten und Ersparnis (für User-Kommentare)
   */
  getLevelForPoints(totalPoints: number, totalSavings: number = 0): Level | null {
    if (!this.levels || this.levels.length === 0) return null;
    
    // Sortiere Levels nach pointsRequired (höchste zuerst) um das korrekte Level zu finden
    const sortedLevels = [...this.levels].sort((a, b) => b.pointsRequired - a.pointsRequired);
    
    for (const level of sortedLevels) {
      // User muss BEIDE Anforderungen erfüllen: Punkte UND Ersparnis
      if (totalPoints >= level.pointsRequired && totalSavings >= level.savingsRequired) {
        return level;
      }
    }
    
    // Fallback: Kleinstes Level
    return this.levels.sort((a, b) => a.pointsRequired - b.pointsRequired)[0] || null;
  }

  /**
   * Gibt die Streak Config zurück
   */
  getStreakConfig(): StreakConfig | null {
    return this.streakConfig;
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
      console.log('🔄 Achievement Service nicht initialisiert - starte Initialisierung...');
      await this.initialize();
    }

    try {
      console.log(`📊 Tracking action: ${action} für User: ${userId}`);

      // 🥇 CHECK FIRST ACTION: Wenn es scan_product, search_product oder view_comparison ist
      if (['scan_product', 'search_product', 'view_comparison'].includes(action)) {
        await this.checkAndTrackFirstAction(userId, action, metadata);
      }

      // 🎮 TRACK GAME ACTION POINTS (vor Achievements)
      await this.trackGameActionPoints(userId, action, metadata);

      // Erstelle Event für Logging (optional für spätere Analyse)
      const event: AchievementEvent = {
        userId,
        action,
        timestamp: new Date(),
        metadata
      };

      // Finde alle relevanten Achievements für diese Action
      // SPECIAL CASE: first_action_any wird bei scan_product, search_product oder view_comparison getriggert
      const isFirstActionTrigger = ['scan_product', 'search_product', 'view_comparison'].includes(action);
      
      const relevantAchievements = this.achievements.filter(a => {
        if (!a.isActive) return false;
        
        // Normale Achievements
        if (a.trigger.action === action) return true;
        
        // Special: first_action_any Achievement bei ersten Aktionen
        // Aber NUR wenn noch keine erste Aktion getrackt wurde!
        if (a.trigger.action === 'first_action_any' && isFirstActionTrigger) {
          // Wird später im Code gecheckt ob schon completed
          console.log('🎯 first_action_any Achievement gefunden für:', action);
          return true;
        }
        
        return false;
      });

      if (relevantAchievements.length === 0) {
        console.log(`Keine Achievements für Action: ${action}`);
        return;
      }

      // Hole User-Dokument
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);

      let userData: any;
      let userAchievements: any = {};
      let userStats: UserStats;

      if (!userDoc.exists()) {
        console.log('📝 User-Dokument existiert noch nicht für:', userId, '- wird jetzt erstellt');
        // Create default user document
        const { setDoc } = await import('firebase/firestore');
        const defaultStats = this.getDefaultUserStats();
        await setDoc(userRef, {
          stats: defaultStats,
          achievements: {},
          totalSavings: 0,  // Für Kompatibilität
          lastActivityAt: serverTimestamp(),
          createdAt: serverTimestamp()
        });
        userData = { stats: defaultStats, achievements: {} };
        userStats = defaultStats;
      } else {
        userData = userDoc.data();
        userAchievements = userData.achievements || {};
        userStats = userData.stats || this.getDefaultUserStats();
      }

      // Update User Stats basierend auf Action
      const updatedStats = await this.updateUserStats(userStats, action, metadata);

      // Batch für alle Updates
      const batch = writeBatch(db);
      let pointsEarned = 0;
      const completedAchievements: Achievement[] = [];

      // Prüfe jeden relevanten Achievement
      for (const achievement of relevantAchievements) {
        // Keine Special Cases mehr - alle Achievements durch normale Schleife
        
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
        updates.stats.pointsTotal = (updatedStats.pointsTotal || 0) + pointsEarned;
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
      
      // 🔄 ZENTRALER Profile-Refresh am Ende (verhindert Duplikate)
      if (AchievementService.onProfileRefreshNeeded) {
        await AchievementService.onProfileRefreshNeeded();
        console.log('✅ Profile refreshed at end of trackAction');
      }

      // 📱 App Rating temporär deaktiviert - verursacht Freeze
      // appRatingService.checkPendingRating();

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
      // WARTEN bis Gamification-System vollständig geladen ist
      if (!this.isInitialized || !this.levels || this.levels.length === 0) {
        console.log('⏳ Warte auf vollständige Initialisierung des Gamification-Systems...');
        await this.initialize();
        
        // Falls immer noch nicht geladen (Permission-Error etc.), abbrechen
        if (!this.levels || this.levels.length === 0) {
          console.warn('❌ Gamification-System konnte nicht geladen werden - Level-Check übersprungen');
          return;
        }
      }
      
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.log('📝 User existiert noch nicht - Level-Check übersprungen');
        return;
      }
      
      const userData = userDoc.data();
      const stats = userData.stats || {};
      const totalPoints = stats.pointsTotal || stats.totalPoints || 0;
      // Priorisiere totalSavings aus userData (wird durch updateUserStats aktualisiert)
      const totalSavings = userData.totalSavings || stats.savingsTotal || stats.totalSavings || 0;
      const currentLevel = stats.currentLevel || userData.level || 1;
      
      // Level-Check Debug - reduced logging
      
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
          
          // 🚀 SOFORT Level-Up UI triggern - OHNE auf DB-Updates zu warten!
          this.notifyLevelUp(correctLevel, currentLevel, userId);
          
          // Profile-Refresh wird zentral in trackAction gemacht
        } else {
          console.log(`🔄 Level-Korrektur ohne Benachrichtigung: ${currentLevel} → ${correctLevel}`);
          
          // Profile-Refresh nur bei Korrektur
          if (AchievementService.onProfileRefreshNeeded) {
            await AchievementService.onProfileRefreshNeeded();
          }
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

      // Track daily_streak action für Achievements und vergebe Punkte
      if (newStreak > (stats.currentStreak || 0)) {
        // Vergebe Streak-Bonus-Punkte: ab Tag 2 gibt's Punkte (Tag 2 = 1 Punkt, Tag 3 = 2 Punkte, etc.)
        const bonusPoints = Math.max(0, newStreak - 1);
        
        if (bonusPoints > 0) {
          // Füge Punkte zum Ledger hinzu
          const ledgerEntry: PointsLedgerEntry = {
            action: 'daily_streak',
            points: bonusPoints,
            timestamp: serverTimestamp() as any,
            metadata: {
              streakDay: newStreak
            }
          };
          
          await addDoc(collection(db, 'users', userId, 'ledger'), ledgerEntry);
          
          // Update User Points
          const currentPoints = stats.pointsTotal || 0;
          await updateDoc(userRef, {
            'stats.pointsTotal': currentPoints + bonusPoints
          });
          
          // Trigger Points Toast
          if (AchievementService.onPointsEarned) {
            AchievementService.onPointsEarned(
              bonusPoints, 
              'daily_streak',
              `Tag ${newStreak} Streak!`
            );
          }
          
          console.log(`🔥 Streak-Bonus: +${bonusPoints} Punkte für Tag ${newStreak}`);
        }
        
        // Tracke die Action trotzdem für Achievements (ohne zusätzliche Punkte)
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
    // Sicherstellen dass Levels geladen sind
    if (!this.levels || this.levels.length === 0) {
      console.warn('⚠️ calculateLevel: Levels noch nicht geladen - kann Level nicht berechnen');
      console.warn('⚠️ Das sollte nicht passieren, da checkAndUpdateLevel warten sollte');
      return 1;
    }
    
    // Sortiere Levels nach pointsRequired (höchste zuerst) um das korrekte Level zu finden
    const sortedLevels = [...this.levels].sort((a, b) => b.pointsRequired - a.pointsRequired);
    
    for (const level of sortedLevels) {
      // User muss BEIDE Anforderungen erfüllen: Punkte UND Ersparnis
      if (totalPoints >= level.pointsRequired && totalSavings >= level.savingsRequired) {
        console.log(`✅ Level ${level.id} erreicht mit ${totalPoints} Punkten und ${totalSavings}€ Ersparnis`);
        return level.id;
      }
    }
    
    console.log(`📊 Kein höheres Level erreicht - bleibe bei Level 1 (${totalPoints} Punkte, ${totalSavings}€)`);
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
  private async notifyLevelUp(newLevel: number, oldLevel: number, userId: string): Promise<void> {
    console.log(`🎉 Level-Up Benachrichtigung: Level ${oldLevel} → ${newLevel}`);
    
    // Prüfe ob eine Kategorie freigeschaltet wurde
    let unlockedCategory: { id: string; name: string; imageUrl: string } | undefined;
    
    const levelInfo = this.levels.find(l => l.id === newLevel);
    if (levelInfo && (levelInfo as any).unlockedCategory) {
      unlockedCategory = (levelInfo as any).unlockedCategory;
      console.log(`🎁 Kategorie "${unlockedCategory.name}" wird freigeschaltet!`);
    }
    
    // Trigger Level-Up UI (EIGENER Callback)
    if (AchievementService.onLevelUp) {
      AchievementService.onLevelUp(newLevel, oldLevel, unlockedCategory);
      console.log('✅ Level-Up UI getriggert');
    } else {
      console.log('⚠️ Kein Level-Up Handler registriert');
    }

    // 📱 App Rating: Flag wird SPÄTER gesetzt (nach Level-Up Close)
    if (newLevel >= 3) {
      console.log(`📱 Level ${newLevel} reached - rating will be triggered AFTER overlay closes`);
      // Die Flag wird erst vom GamificationProvider gesetzt wenn das Overlay zu ist
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
      
      // Global Achievement Unlock Callback mit Lottie-Animation
      if (AchievementService.onAchievementUnlock) {
        console.log(`🎬 Achievement mit Lottie: ${achievement.lottieAnimation || 'keine Animation'}`);
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
      pointsTotal: 0,
      currentLevel: 1,
      savingsTotal: 0,
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
      lastStreakActiveDayDate: this.getDateString(new Date()),
      streakTier: 1,
      freezeTokens: 0,
      lastActivityAt: new Date(),
      statsUpdatedAt: new Date(),
      // Backwards compatibility
      totalPoints: 0,
      totalSavings: 0
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
   * Vergibt Punkte für Game Actions basierend auf der Config
   */
  private async trackGameActionPoints(userId: string, action: ActionType, metadata?: any): Promise<void> {
    try {
      // Lade Game Actions Config falls noch nicht geladen
      if (!this.gameActions) {
        await this.loadGameConfig();
      }

      if (!this.gameActions || !this.gameActions[action]) {
        console.log(`Keine Game Action Config für: ${action}`);
        return;
      }

      const actionConfig = this.gameActions[action];
      const points = actionConfig.points || 0;
      
      if (points === 0) {
        console.log(`Action ${action} gibt keine Punkte`);
        return;
      }

      // Anti-Abuse Checks
      const now = new Date();
      const ledgerRef = collection(db, 'users', userId, 'ledger');
      
      // 1. Check One-Time Actions
      if (actionConfig.antiAbuse?.oneTime) {
        const existingQuery = query(
          ledgerRef,
          where('action', '==', action),
          limit(1)
        );
        const existingDocs = await getDocs(existingQuery);
        if (!existingDocs.empty) {
          console.log(`⚠️ One-time action ${action} bereits ausgeführt`);
          await showOneTimeRestrictionToast(action);
          return;
        }
      }

      // 2. Check Dedupe Window
      if (actionConfig.antiAbuse?.dedupeWindowSec) {
        const dedupeTime = new Date(now.getTime() - actionConfig.antiAbuse.dedupeWindowSec * 1000);
        const dedupeQuery = query(
          ledgerRef,
          where('action', '==', action),
          where('timestamp', '>', dedupeTime),
          limit(1)
        );
        const dedupeDocs = await getDocs(dedupeQuery);
        if (!dedupeDocs.empty) {
          console.log(`⚠️ Action ${action} zu schnell wiederholt (Dedupe Window)`);
          const lastDoc = dedupeDocs.docs[0];
          const lastTimestamp = lastDoc.data().timestamp.toDate();
          const remainingSeconds = Math.ceil((lastTimestamp.getTime() + actionConfig.antiAbuse.dedupeWindowSec * 1000 - now.getTime()) / 1000);
          if (remainingSeconds > 0) {
            await showDedupeWindowToast(action, remainingSeconds);
          }
          return;
        }
      }

      // 3. Check Daily Cap
      if (actionConfig.antiAbuse?.dailyCap) {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const dailyQuery = query(
          ledgerRef,
          where('action', '==', action),
          where('timestamp', '>=', startOfDay)
        );
        const dailyDocs = await getDocs(dailyQuery);
        if (dailyDocs.size >= actionConfig.antiAbuse.dailyCap) {
          console.log(`⚠️ Daily cap erreicht für ${action} (${actionConfig.antiAbuse.dailyCap})`);
          await showDailyCapToast(action);
          return;
        }
      }

      // 4. Check Weekly Cap
      if (actionConfig.antiAbuse?.weeklyCap) {
        const startOfWeek = new Date(now);
        const dayOfWeek = startOfWeek.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startOfWeek.setDate(startOfWeek.getDate() - daysToMonday);
        startOfWeek.setHours(0, 0, 0, 0);
        
        const weeklyQuery = query(
          ledgerRef,
          where('action', '==', action),
          where('timestamp', '>=', startOfWeek)
        );
        const weeklyDocs = await getDocs(weeklyQuery);
        if (weeklyDocs.size >= actionConfig.antiAbuse.weeklyCap) {
          console.log(`⚠️ Weekly cap erreicht für ${action} (${actionConfig.antiAbuse.weeklyCap})`);
          await showWeeklyCapToast(action);
          return;
        }
      }

      // 5. Check Min Text Length (für Ratings)
      if (actionConfig.antiAbuse?.minTextLength && metadata?.commentLength) {
        if (metadata.commentLength < actionConfig.antiAbuse.minTextLength) {
          console.log(`⚠️ Text zu kurz für ${action} (min: ${actionConfig.antiAbuse.minTextLength})`);
          return;
        }
      }

      // Erstelle Ledger-Eintrag
      const ledgerEntry: PointsLedgerEntry = {
        action: action,
        points: points,
        timestamp: serverTimestamp() as any,
        ...(metadata !== undefined && { metadata })  // Nur wenn nicht undefined
      };

      await addDoc(ledgerRef, ledgerEntry);

      // Update User Stats
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      const currentStats = userDoc.exists() 
        ? (userDoc.data().stats || this.getDefaultUserStats())
        : this.getDefaultUserStats();
        
      const updatedStats = {
        ...currentStats,
        pointsTotal: (currentStats.pointsTotal || 0) + points,
        lastActivityAt: serverTimestamp()
      };
      
      // Update oder Create User Document
      if (userDoc.exists()) {
        await updateDoc(userRef, {
          stats: updatedStats,
          lastActivityAt: serverTimestamp()
        });
      } else {
        // Create new user document mit Default Stats
        const { setDoc } = await import('firebase/firestore');
        await setDoc(userRef, {
          stats: updatedStats,
          achievements: {},
          totalSavings: 0,  // Für Kompatibilität
          lastActivityAt: serverTimestamp(),
          createdAt: serverTimestamp()
        });
        console.log('📝 Neues User-Dokument erstellt für:', userId);
      }
      
      console.log(`💰 ${points} Punkte für ${action} vergeben`);
      
      // 📊 Update Leaderboard with points
      await leaderboardService.updateUserStats(userId, points, 0);
      
      // Trigger Points Toast notification
      if (AchievementService.onPointsEarned) {
        AchievementService.onPointsEarned(
          points,
          action,
          TOAST_MESSAGES.POINTS[action] || action
        );
      }
      
      // WICHTIG: Level-Check NACH Achievement-Triggering 
      // (wird in trackAction aufgerufen, nicht hier)
    } catch (error) {
      console.error(`Error tracking game action points for ${action}:`, error);
    }
  }

  /**
   * Prüft und trackt first_action_any wenn es die erste Aktion des Users ist
   */
  private async checkAndTrackFirstAction(userId: string, action: ActionType, metadata?: any): Promise<void> {
    try {
      // Hole User-Dokument
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        // Neuer User - definitiv erste Aktion
        console.log('🥇 Neue erste Aktion für neuen User');
        await this.trackFirstActionInternal(userId, action, metadata);
        return;
      }

      const userData = userDoc.data();
      const ledgerRef = collection(db, 'users', userId, 'ledger');
      
      // Prüfe ob first_action_any schon getrackt wurde
      const firstActionQuery = query(
        ledgerRef,
        where('action', '==', 'first_action_any'),
        limit(1)
      );
      
      const firstActionSnapshot = await getDocs(firstActionQuery);
      
      if (firstActionSnapshot.empty) {
        console.log('🥇 Erste Aktion des Users detektiert!');
        await this.trackFirstActionInternal(userId, action, metadata);
      }
    } catch (error) {
      console.error('Error checking first action:', error);
    }
  }

  /**
   * Trackt die first_action_any intern
   */
  private async trackFirstActionInternal(userId: string, triggerAction: ActionType, metadata?: any): Promise<void> {
    try {
      // Lade Game Actions Config falls noch nicht geladen
      if (!this.gameActions) {
        await this.loadGameConfig();
      }

      if (!this.gameActions?.first_action_any) {
        console.log('first_action_any nicht in Game Config gefunden');
        return;
      }

      const firstActionConfig = this.gameActions.first_action_any;
      const points = firstActionConfig.points || 10;

      // Erstelle Ledger-Eintrag für first_action_any
      const ledgerEntry: PointsLedgerEntry = {
        action: 'first_action_any',
        points: points,
        timestamp: serverTimestamp() as any,
        metadata: {
          triggerAction,
          ...metadata
        }
      };

      const ledgerRef = collection(db, 'users', userId, 'ledger');
      await addDoc(ledgerRef, ledgerEntry);

      // Update User Stats
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (userDoc.exists()) {
        const currentStats = userDoc.data().stats || this.getDefaultUserStats();
        const updatedStats = {
          ...currentStats,
          pointsTotal: (currentStats.pointsTotal || 0) + points,
          lastActivityAt: serverTimestamp()
        };
        
        await updateDoc(userRef, {
          stats: updatedStats,
          lastActivityAt: serverTimestamp()
        });
      }

      console.log(`🥇 First action tracked! +${points} Punkte für erste Aktion (${triggerAction})`);

      // 🚫 Achievement wird NICHT mehr hier getriggert!
      // Das first_action_any Achievement wird durch die normale Achievement-Schleife 
      // in trackAction gefunden und dort korrekt abgehandelt
    } catch (error) {
      console.error('Error tracking first_action_any:', error);
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
        console.log('📊 Erstelle Default Stats für User:', userId);
        return this.getDefaultUserStats();
      }

      return userDoc.data().stats || this.getDefaultUserStats();
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        console.log('📊 Stats nicht zugänglich, verwende Defaults für User:', userId);
      } else {
        console.warn('⚠️ Fehler beim Laden der User Stats für', userId, ':', error);
      }
      return this.getDefaultUserStats();
    }
  }
}

// Export Singleton Instance
const achievementService = AchievementService.getInstance();

// KEINE AUTO-INITIALISIERUNG - System wird nur bei authentifizierten Users geladen
// Dies verhindert Permission-Errors beim App-Start

// Named export
export { achievementService };

// Default export for compatibility
export default achievementService;

// Re-export static methods for convenience
export const setAchievementUnlockHandler = AchievementService.setAchievementUnlockHandler;
export const setPointsEarnedHandler = AchievementService.setPointsEarnedHandler;
export const setLevelUpHandler = AchievementService.setLevelUpHandler;
export const setProfileRefreshCallback = AchievementService.setProfileRefreshCallback;
