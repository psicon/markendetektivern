import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
    where
} from 'firebase/firestore';
import { db } from '../firebase';

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  photoUrl?: string;
  stats: {
    points: {
      total: number;
      weekly: number;
      monthly: number;
      yearly: number;
    };
    savings: {
      total: number;
      weekly: number;
      monthly: number;
      yearly: number;
    };
  };
  rank?: number;
  percentile?: number;
  lastUpdated: Timestamp;
  weekStartDate: string;
  monthStartDate: string;
  yearStartDate: string;
}

export type LeaderboardType = 'points' | 'savings';
export type LeaderboardPeriod = 'total' | 'weekly' | 'monthly' | 'yearly';

class LeaderboardService {
  private static instance: LeaderboardService;

  static getInstance(): LeaderboardService {
    if (!LeaderboardService.instance) {
      LeaderboardService.instance = new LeaderboardService();
    }
    return LeaderboardService.instance;
  }

  /**
   * Aktualisiert User-Stats in der Leaderboard-Collection
   */
  async updateUserStats(
    userId: string, 
    pointsGained: number = 0, 
    savingsGained: number = 0
  ): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        console.warn('⚠️ User not found for leaderboard update:', userId);
        return;
      }

      const userData = userDoc.data();
      const leaderboardRef = doc(db, 'leaderboards', userId);
      const leaderboardDoc = await getDoc(leaderboardRef);

      const now = new Date();
      const weekStart = this.getWeekStart(now);
      const monthStart = this.getMonthStart(now);
      const yearStart = this.getYearStart(now);

      let currentStats: LeaderboardEntry['stats'];

      if (leaderboardDoc.exists()) {
        const existingData = leaderboardDoc.data() as LeaderboardEntry;
        currentStats = existingData.stats;

        // Reset stats if new period started
        if (existingData.weekStartDate !== weekStart) {
          currentStats.points.weekly = 0;
          currentStats.savings.weekly = 0;
        }
        if (existingData.monthStartDate !== monthStart) {
          currentStats.points.monthly = 0;
          currentStats.savings.monthly = 0;
        }
        if (existingData.yearStartDate !== yearStart) {
          currentStats.points.yearly = 0;
          currentStats.savings.yearly = 0;
        }
      } else {
        // Initialize new user stats
        currentStats = {
          points: { total: 0, weekly: 0, monthly: 0, yearly: 0 },
          savings: { total: 0, weekly: 0, monthly: 0, yearly: 0 }
        };
      }

      // Update stats with new values
      if (pointsGained > 0) {
        currentStats.points.total += pointsGained;
        currentStats.points.weekly += pointsGained;
        currentStats.points.monthly += pointsGained;
        currentStats.points.yearly += pointsGained;
      }

      if (savingsGained > 0) {
        currentStats.savings.total += savingsGained;
        currentStats.savings.weekly += savingsGained;
        currentStats.savings.monthly += savingsGained;
        currentStats.savings.yearly += savingsGained;
      }

      const leaderboardEntry: LeaderboardEntry = {
        userId,
        displayName: userData.display_name || 'Anonymer Nutzer',
        photoUrl: userData.photo_url,
        stats: currentStats,
        lastUpdated: serverTimestamp() as Timestamp,
        weekStartDate: weekStart,
        monthStartDate: monthStart,
        yearStartDate: yearStart
      };

      await setDoc(leaderboardRef, leaderboardEntry, { merge: true });
      
      console.log(`📊 Leaderboard updated: +${pointsGained} Punkte, +€${savingsGained.toFixed(2)}`);
    } catch (error) {
      console.error('❌ Error updating leaderboard stats:', error);
    }
  }

  /**
   * Holt die Leaderboard-Liste
   */
  async getLeaderboard(
    type: LeaderboardType,
    period: LeaderboardPeriod,
    limitCount: number = 50
  ): Promise<LeaderboardEntry[]> {
    try {
      const cacheKey = `leaderboard_${type}_${period}_${new Date().toISOString().split('T')[0]}`;
      
      // Try cache first
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        const cachedData = JSON.parse(cached);
        if (Date.now() - cachedData.timestamp < 5 * 60 * 1000) { // 5 minutes cache
          console.log(`📋 Using cached leaderboard: ${type}_${period}`);
          return cachedData.data;
        }
      }

      const leaderboardRef = collection(db, 'leaderboards');
      const fieldPath = `stats.${type}.${period}`;
      
      const q = query(
        leaderboardRef,
        orderBy(fieldPath, 'desc'),
        limit(limitCount)
      );

      const querySnapshot = await getDocs(q);
      const entries: LeaderboardEntry[] = [];

      querySnapshot.forEach((doc, index) => {
        const data = doc.data() as LeaderboardEntry;
        entries.push({
          ...data,
          rank: index + 1
        });
      });

      // Calculate percentiles
      const totalUsers = await this.getTotalUsersCount();
      entries.forEach(entry => {
        if (entry.rank) {
          entry.percentile = Math.round(((totalUsers - entry.rank) / totalUsers) * 100);
        }
      });

      // Cache the result
      await AsyncStorage.setItem(cacheKey, JSON.stringify({
        data: entries,
        timestamp: Date.now()
      }));

      console.log(`📋 Loaded ${entries.length} leaderboard entries for ${type}_${period}`);
      return entries;
    } catch (error) {
      console.error('❌ Error loading leaderboard:', error);
      return [];
    }
  }

  /**
   * Holt die Position eines bestimmten Users
   */
  async getUserPosition(
    userId: string,
    type: LeaderboardType,
    period: LeaderboardPeriod
  ): Promise<{ rank: number; percentile: number; entry: LeaderboardEntry } | null> {
    try {
      const userRef = doc(db, 'leaderboards', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        return null;
      }

      const userEntry = userDoc.data() as LeaderboardEntry;
      const userValue = userEntry.stats[type][period];

      // Count users with better stats
      const leaderboardRef = collection(db, 'leaderboards');
      const fieldPath = `stats.${type}.${period}`;
      
      const betterQuery = query(
        leaderboardRef,
        where(fieldPath, '>', userValue)
      );

      const betterSnapshot = await getDocs(betterQuery);
      const rank = betterSnapshot.size + 1;

      const totalUsers = await this.getTotalUsersCount();
      const percentile = Math.round(((totalUsers - rank) / totalUsers) * 100);

      return {
        rank,
        percentile,
        entry: { ...userEntry, rank, percentile }
      };
    } catch (error) {
      console.error('❌ Error getting user position:', error);
      return null;
    }
  }

  /**
   * Formatiert Percentile-Nachricht
   */
  getPercentileMessage(percentile: number, rank: number): string {
    if (rank === 1) {
      return `👑 Du bist die Nummer 1! Absolut legendär!`;
    } else if (rank === 2) {
      return `🥈 Platz 2! So nah an der Spitze!`;
    } else if (rank === 3) {
      return `🥉 Bronze! Du gehörst zur Elite!`;
    } else if (rank <= 10) {
      return `🌟 Top 10! Du spielst in der Champions League!`;
    } else if (percentile >= 95) {
      return `🔥 Besser als ${percentile}% - Du bist on fire!`;
    } else if (percentile >= 90) {
      return `💎 Besser als ${percentile}% - Absolut beeindruckend!`;
    } else if (percentile >= 75) {
      return `💪 Besser als ${percentile}% - Richtig stark!`;
    } else if (percentile >= 50) {
      return `📈 Besser als ${percentile}% - Überdurchschnittlich gut!`;
    } else if (percentile >= 25) {
      return `🚀 Besser als ${percentile}% - Der Aufstieg beginnt!`;
    } else {
      return `⭐ Besser als ${percentile}% - Jeder Held fängt klein an!`;
    }
  }

  /**
   * Helper: Wochenstart (Montag)
   */
  private getWeekStart(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0];
  }

  /**
   * Helper: Monatsstart
   */
  private getMonthStart(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Helper: Jahresstart
   */
  private getYearStart(date: Date): string {
    return date.getFullYear().toString();
  }

  /**
   * Helper: Gesamtanzahl User (für Percentile-Berechnung)
   */
  private async getTotalUsersCount(): Promise<number> {
    try {
      // Cache total count for 1 hour
      const cacheKey = 'total_users_count';
      const cached = await AsyncStorage.getItem(cacheKey);
      
      if (cached) {
        const cachedData = JSON.parse(cached);
        if (Date.now() - cachedData.timestamp < 60 * 60 * 1000) { // 1 hour
          return cachedData.count;
        }
      }

      const leaderboardRef = collection(db, 'leaderboards');
      const snapshot = await getDocs(leaderboardRef);
      const count = snapshot.size;

      await AsyncStorage.setItem(cacheKey, JSON.stringify({
        count,
        timestamp: Date.now()
      }));

      return count;
    } catch (error) {
      console.error('❌ Error getting total users count:', error);
      return 1000; // Fallback estimate
    }
  }

  /**
   * Invalidiert Cache (für Pull-to-Refresh)
   */
  async invalidateCache(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const leaderboardKeys = keys.filter(key => key.startsWith('leaderboard_'));
      await AsyncStorage.multiRemove(leaderboardKeys);
      console.log('🗑️ Leaderboard cache invalidated');
    } catch (error) {
      console.error('❌ Error invalidating cache:', error);
    }
  }
}

export default LeaderboardService.getInstance();
