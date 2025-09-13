import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import achievementService from '../services/achievementService';
import { Achievement, ActionType, UserAchievementProgress, UserStats } from '../types/achievements';

/**
 * Hook für Achievement-System Integration
 */
export function useAchievements() {
  const { user } = useAuth();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [userProgress, setUserProgress] = useState<{ [key: string]: UserAchievementProgress }>({});
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lade Achievements und User Progress beim Mount
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    loadAchievements();
  }, [user]);

  // Lade alle Achievements und User Progress
  const loadAchievements = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      // Achievement Service sollte bereits durch AuthContext initialisiert sein
      // Falls nicht, initialisiere es hier
      if (!achievementService.isInitialized) {
        await achievementService.initialize();
      }

      // Lade alle Achievements
      const allAchievements = await achievementService.getAllAchievements();
      setAchievements(allAchievements);

      // Lade User Progress
      const progress = await achievementService.getUserAchievements(user.uid);
      setUserProgress(progress);

      // Lade User Stats
      const stats = await achievementService.getUserStats(user.uid);
      setUserStats(stats);

      console.log('✅ Achievements geladen:', allAchievements.length);
    } catch (err) {
      console.error('❌ Fehler beim Laden der Achievements:', err);
      setError('Fehler beim Laden der Achievements');
    } finally {
      setLoading(false);
    }
  };

  // Track eine Action
  const trackAction = useCallback(async (action: ActionType, metadata?: any) => {
    if (!user) {
      console.warn('Keine User-Session für Action-Tracking');
      return;
    }

    try {
      await achievementService.trackAction(user.uid, action, metadata);
      
      // Reload Progress nach Action
      const progress = await achievementService.getUserAchievements(user.uid);
      setUserProgress(progress);
      
      const stats = await achievementService.getUserStats(user.uid);
      setUserStats(stats);
      
      console.log(`✅ Action getrackt: ${action}`);
    } catch (err) {
      console.error(`❌ Fehler beim Tracken der Action ${action}:`, err);
    }
  }, [user]);

  // Prüfe tägliche Streak
  const checkDailyStreak = useCallback(async () => {
    if (!user) return;

    try {
      await achievementService.checkDailyStreak(user.uid);
      
      // Reload Stats nach Streak-Check
      const stats = await achievementService.getUserStats(user.uid);
      setUserStats(stats);
      
      console.log('✅ Daily Streak gecheckt');
    } catch (err) {
      console.error('❌ Fehler beim Streak-Check:', err);
    }
  }, [user]);

  // Berechne Achievement-Fortschritt mit User Progress
  const getAchievementWithProgress = useCallback((achievement: Achievement) => {
    const progress = userProgress[achievement.id];
    
    if (!progress) {
      return {
        ...achievement,
        progress: 0,
        maxProgress: achievement.trigger.target,
        isCompleted: false,
        completedAt: undefined
      };
    }

    return {
      ...achievement,
      progress: progress.progress,
      maxProgress: achievement.trigger.target,
      isCompleted: progress.completed,
      completedAt: progress.completedAt
    };
  }, [userProgress]);

  // Berechne Gesamt-Punkte aus abgeschlossenen Achievements
  const getTotalPoints = useCallback(() => {
    return userStats?.totalPoints || 0;
  }, [userStats]);

  // Berechne aktuelles Level
  const getCurrentLevel = useCallback(() => {
    return userStats?.currentLevel || 1;
  }, [userStats]);

  // Hole aktuelle Streak
  const getCurrentStreak = useCallback(() => {
    return userStats?.currentStreak || 0;
  }, [userStats]);

  // Hole längste Streak
  const getLongestStreak = useCallback(() => {
    return userStats?.longestStreak || 0;
  }, [userStats]);

  return {
    // Data
    achievements,
    userProgress,
    userStats,
    loading,
    error,

    // Actions
    trackAction,
    checkDailyStreak,
    loadAchievements,

    // Computed
    getAchievementWithProgress,
    getTotalPoints,
    getCurrentLevel,
    getCurrentStreak,
    getLongestStreak,
  };
}

/**
 * Convenience Hook für einzelne Actions
 */
export function useTrackAction() {
  const { trackAction } = useAchievements();
  return trackAction;
}
