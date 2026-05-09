import { router } from 'expo-router';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  achievementService,
  setAchievementUnlockHandler,
  setLevelUpHandler,
  setPointsEarnedHandler,
} from '@/lib/services/achievementService';
import { CoachmarkService } from '@/lib/services/coachmarkService';
import { gamificationSettingsService } from '@/lib/services/gamificationSettingsService';
import { ratingPromptService } from '@/lib/services/ratingPrompt';
import { RATING_POLL_INTERVAL_MS } from '@/lib/perfFlags';
import { showPointsToast, showStreakToast as showStreakToastNew } from '@/lib/services/ui/toast';
import { Achievement } from '@/lib/types/achievements';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  AchievementUnlockBanner,
  type BannerData,
} from './AchievementUnlockBanner';
import { AppRatingModal } from './AppRatingModal';

// ─── Banner-Data-Builder ─────────────────────────────────────────
//
// Wandeln Achievement-/LevelUp-Daten ins generische BannerData-
// Schema um (Reanimated-friendly, mit Lottie). Werden vom Provider
// intern für Auto-Trigger benutzt UND von Catalog-Pages (achievements.tsx)
// exportiert für Preview-Taps via useGamification().showBanner(...).
//
// Lottie-Mapping spiegelt `lottieFor` aus app/achievements.tsx —
// gleiche Animation pro Action damit der visuelle Eindruck zwischen
// Detail-Page und Banner konsistent ist.
//
// Reihenfolge der Auflösung:
//   1. Per-Achievement-ID-Override (für Spezialfälle wo die Action
//      generisch ist aber das Achievement eine eigene Identität
//      braucht — z.B. "Treu bleiben" ist daily_streak aber soll
//      die Loyalty-Heart-Lottie zeigen, nicht streak-fire).
//   2. Per-Action-Mapping als Fallback.
function lottieForAchievement(achievement: Achievement): any {
  try {
    // Per-ID-Overrides — nur wo die Action-basierte Logik nicht
    // passt. Erweitern wenn weitere Achievements eigene Lottie
    // brauchen.
    switch (achievement.id) {
      case 'UcO5xJgps0kUIg8V32li': // "Treu bleiben" — 30-Tage-Streak,
        // Heart-Theme statt streak-fire (semantisch Loyalty, nicht
        // Combustion).
        return require('@/assets/lottie/favorites2.json');
    }

    switch (achievement.trigger?.action) {
      case 'first_action_any':
        return require('@/assets/lottie/rocket.json');
      case 'daily_streak':
        return require('@/assets/lottie/streak-fire.json');
      case 'view_comparison':
        return require('@/assets/lottie/comparison.json');
      case 'complete_shopping':
        return require('@/assets/lottie/task.json');
      case 'search_product':
        return require('@/assets/lottie/search.json');
      case 'submit_rating':
        return require('@/assets/lottie/ratingsthumbsup.json');
      case 'create_list':
        return require('@/assets/lottie/task.json');
      case 'convert_product':
        return require('@/assets/lottie/swap.json');
      case 'share_app':
        return require('@/assets/lottie/review.json');
      case 'submit_product':
        return require('@/assets/lottie/favorites.json');
      case 'save_product':
        return require('@/assets/lottie/favorites2.json');
      case 'savings_total':
        return require('@/assets/lottie/savings.json');
      default:
        return require('@/assets/lottie/confetti.json');
    }
  } catch {
    return require('@/assets/lottie/confetti.json');
  }
}

export function bannerDataFromAchievement(achievement: Achievement): BannerData {
  return {
    title: achievement.name,
    subtitle: achievement.description,
    points: achievement.points,
    lottie: lottieForAchievement(achievement),
    // Tier-Farbe: bevorzugt achievement.color (Firestore-konfiguriert),
    // sonst gold als Fallback ("Erfolg/Belohnung"-Konnotation).
    tint: (achievement.color as string) || '#F0A030',
    onTap: () => {
      try {
        router.push('/achievements' as any);
      } catch (e) {
        console.warn('Achievement banner nav failed (non-fatal):', e);
      }
    },
  };
}

export function bannerDataFromLevelUp(
  newLevel: number,
  oldLevel: number,
  unlockedCategory?: { id: string; name: string; imageUrl: string },
): BannerData {
  void oldLevel;

  // Level-Daten aus dem Catalog ziehen — Color, Name, Description.
  // Sync-Variante damit die Banner-Daten ohne await gebaut werden
  // können (Catalog ist nach App-Start schon geladen). Fallback
  // wenn Catalog noch leer (race-condition beim ersten Banner direkt
  // nach Cold-Start).
  const allLevels = achievementService.getAllLevelsSync();
  const levelInfo = allLevels.find((l) => l.id === newLevel);
  const tint = levelInfo?.color || '#F0A030';
  const levelName = levelInfo?.name;
  const levelDescription = levelInfo?.description;

  // Sekundär-Tint für den EdgeGlow: Color des VORHERIGEN Levels.
  // Effekt: der Halo zeigt sichtbar BEIDE Farben — die alte (vom
  // letzten Level, das man gerade verlassen hat) und die neue (vom
  // erreichten Level). Visueller "Übergang" der das Level-Up unter-
  // streicht. Fallback wenn kein vorheriges Level (z.B. Level 1):
  // undefined → EdgeGlow nutzt aufgehellte primary als Shimmer.
  const prevLevelInfo = allLevels.find((l) => l.id === newLevel - 1);
  const secondaryTint = prevLevelInfo?.color;

  // Title: "Level X erreicht – Levelname" wenn Name vorhanden,
  // sonst nur "Level X erreicht" (Catalog noch nicht geladen).
  // Em-Dash (–, U+2013) zwischen Level-Number und Name — bessere
  // Typografie als Bindestrich.
  const title = levelName
    ? `Level ${newLevel} erreicht – ${levelName}`
    : `Level ${newLevel} erreicht`;

  // Subtitle:
  //   1. Kategorie-Unlock (höchste Priorität — handlungsrelevant)
  //   2. Level-Description aus dem Catalog
  //   3. Fallback "Du bist jetzt auf Level X"
  const subtitle = unlockedCategory
    ? `Neue Kategorie verfügbar: ${unlockedCategory.name}`
    : levelDescription || `Du bist jetzt auf Level ${newLevel}`;

  return {
    title,
    subtitle,
    lottie: (() => {
      try {
        return require('@/assets/lottie/lvlup.json');
      } catch {
        return require('@/assets/lottie/confetti.json');
      }
    })(),
    tint,
    secondaryTint,
    // Level-Up = das große Spektakel: Banner + Haptik + EdgeGlow.
    withGlow: true,
    onTap: () => {
      try {
        router.push('/achievements' as any);
      } catch (e) {
        console.warn('LevelUp banner nav failed (non-fatal):', e);
      }
    },
  };
}

// ─── GamificationContext ─────────────────────────────────────────
//
// Ermöglicht Catalog-Pages (achievements.tsx) den Banner für
// Preview-Taps zu zeigen. Die Auto-Trigger laufen weiterhin über
// die achievementService-Callbacks (registriert im Provider unten).
interface GamificationContextValue {
  /** Manuell einen Banner anzeigen — z.B. Catalog-Preview-Tap. */
  showBanner: (data: BannerData) => void;
}

const GamificationContext = createContext<GamificationContextValue | null>(null);

export function useGamification(): GamificationContextValue {
  const ctx = useContext(GamificationContext);
  if (!ctx) {
    throw new Error('useGamification must be used within GamificationProvider');
  }
  return ctx;
}

interface GamificationProviderProps {
  children: React.ReactNode;
}

/**
 * Zentraler Provider für alle Gamification-Banner und Toasts.
 *
 * Architektur (post-Tier-Cleanup):
 *   • ALLE Achievement-Unlocks und Level-Ups gehen durch den
 *     AchievementUnlockBanner — kein Konfetti-Modal mehr für "major"-
 *     Events. Visuell konsistent.
 *   • Punkte- und Streak-Toasts laufen über die zentrale
 *     Toast-Library (lib/services/ui/toast.tsx).
 *   • Walkthrough-Active: Banner und Toasts werden gequeued und nach
 *     Tour-Ende drainiert, sonst gehen sie unter dem Backdrop unter.
 */
export const GamificationProvider: React.FC<GamificationProviderProps> = ({ children }) => {
  const colorScheme = useColorScheme();
  const { user } = useAuth();
  void user;

  // Banner-State + Pending-Queue (für Walkthrough-Konflikt).
  const [bannerData, setBannerData] = useState<BannerData | null>(null);
  const [pendingBannerData, setPendingBannerData] = useState<BannerData | null>(null);

  // 📱 App Rating Modal State
  const [showAppRatingModal, setShowAppRatingModal] = useState(false);

  // Pending-Queues für Toasts (Walkthrough-Active → drainen nach Ende).
  const [pendingPointsToasts, setPendingPointsToasts] = useState<
    Array<{ points: number; message: string }>
  >([]);
  const [pendingStreakToasts, setPendingStreakToasts] = useState<
    Array<{ streakDays: number; bonusPoints?: number }>
  >([]);

  // ─── Walkthrough-Active Tracking ──────────────────────────────
  //
  // Wenn ein Walkthrough sichtbar ist, sollen ALLE Gamification-
  // Notifications (Banner, Toasts) NICHT parallel feuern, sondern
  // queuen und nach Tour-Ende abarbeiten. Sonst gehen sie unter dem
  // Tour-Backdrop unter.
  const [walkthroughActive, setWalkthroughActive] = useState(false);
  useEffect(() => {
    const off = CoachmarkService.onActivityChange((any) => {
      setWalkthroughActive(any);
    });
    return off;
  }, []);

  // ─── Auto-Trigger-Handler ────────────────────────────────────
  //
  // Achievement-Unlock und Level-Up routen IMMER zum Banner.
  // 1.5 s Defer damit Detail-Mounts nicht direkt von einer
  // Reward-Animation überlagert werden — der User soll erst Inhalte
  // aufnehmen können bevor Feedback kommt.

  const achievementHandler = useCallback(async (achievement: Achievement) => {
    console.log('🏆 Achievement Unlock UI triggered:', achievement.name);

    const notificationsDisabled =
      await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Achievement-UI unterdrückt (Spielerische Inhalte deaktiviert)');
      return;
    }

    const data = bannerDataFromAchievement(achievement);
    setTimeout(() => {
      const walkthroughOn = CoachmarkService.isAnyActive();
      if (walkthroughOn) {
        console.log('🎖️ Banner queued (Walkthrough läuft)');
        setPendingBannerData(data);
      } else {
        setBannerData(data);
      }
    }, 1500);
  }, []);

  const pointsHandler = useCallback(async (points: number, action: string, message: string) => {
    if (points <= 0) return;
    void action;
    const notificationsDisabled = await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Punkte Toast unterdrückt (Spielerische Inhalte deaktiviert)');
      return;
    }
    if (CoachmarkService.isAnyActive()) {
      console.log('🎯 Punkte-Toast queued — Walkthrough läuft');
      setPendingPointsToasts((prev) => [...prev, { points, message }]);
      return;
    }
    showPointsToast(message, points, colorScheme || 'light');
  }, [colorScheme]);

  const levelUpHandler = useCallback(async (
    newLevel: number,
    oldLevel: number,
    unlockedCategory?: { id: string; name: string; imageUrl: string },
  ) => {
    console.log(`🎯 Level-Up UI triggered: ${oldLevel} → ${newLevel}`);
    if (unlockedCategory) {
      console.log(`🎁 Mit freigeschalteter Kategorie: ${unlockedCategory.name}`);
    }

    const notificationsDisabled =
      await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Level-Up UI unterdrückt (Spielerische Inhalte deaktiviert)');
      return;
    }

    const data = bannerDataFromLevelUp(newLevel, oldLevel, unlockedCategory);
    setTimeout(() => {
      const walkthroughOn = CoachmarkService.isAnyActive();
      if (walkthroughOn) {
        setPendingBannerData(data);
      } else {
        setBannerData(data);
      }
    }, 1500);

    // Rating-Trigger nach Level-Up: ab Level 3 setzen wir den
    // Pending-Rating-Flag, sodass der periodische Check (siehe
    // unten) das App-Rating-Modal nach dem Banner-Schließen anbietet.
    if (newLevel >= 3 && user?.uid) {
      try {
        await ratingPromptService.setPendingRating(user.uid, newLevel);
      } catch (error) {
        console.error('❌ Error setting rating flag:', error);
      }
    }
  }, [user?.uid]);

  // 🔄 Callback-Registrierung beim Mount
  useEffect(() => {
    setAchievementUnlockHandler(achievementHandler);
    setPointsEarnedHandler(pointsHandler);
    setLevelUpHandler(levelUpHandler);
    ratingPromptService.setRatingModalHandler(setShowAppRatingModal);
    return () => {
      setAchievementUnlockHandler(null);
      setPointsEarnedHandler(null);
      setLevelUpHandler(null);
      ratingPromptService.setRatingModalHandler(() => {});
    };
  }, [achievementHandler, pointsHandler, levelUpHandler]);

  // 🎖️ Banner-Suppression beim Walkthrough-Open: ziehe einen
  // sichtbaren Banner zurück und queue ihn.
  useEffect(() => {
    if (!bannerData) return;
    if (walkthroughActive) {
      console.log('🎖️ Walkthrough öffnet — aktiver Banner geht in Queue');
      setPendingBannerData(bannerData);
      setBannerData(null);
    }
  }, [bannerData, walkthroughActive]);

  // 🎖️ Banner-Drain nach Walkthrough-Close.
  useEffect(() => {
    if (!pendingBannerData) return;
    if (walkthroughActive) return;
    const t = setTimeout(() => {
      setBannerData(pendingBannerData);
      setPendingBannerData(null);
    }, 400);
    return () => clearTimeout(t);
  }, [pendingBannerData, walkthroughActive]);

  // 🟡 Pending Punkte/Streak-Toasts-Drain bei Walkthrough-Ende.
  useEffect(() => {
    if (walkthroughActive) return;
    if (pendingPointsToasts.length === 0) return;
    const queue = pendingPointsToasts;
    setPendingPointsToasts([]);
    queue.forEach((t, idx) => {
      setTimeout(() => {
        showPointsToast(t.message, t.points, colorScheme || 'light');
      }, 300 + idx * 200);
    });
  }, [walkthroughActive, pendingPointsToasts, colorScheme]);

  useEffect(() => {
    if (walkthroughActive) return;
    if (pendingStreakToasts.length === 0) return;
    const queue = pendingStreakToasts;
    setPendingStreakToasts([]);
    queue.forEach((t, idx) => {
      setTimeout(() => {
        showStreakToastNew(t.streakDays, t.bonusPoints, colorScheme || 'light');
      }, 600 + idx * 200);
    });
  }, [walkthroughActive, pendingStreakToasts, colorScheme]);

  // 📱 Periodic check for pending rating — pause während Banner
  // sichtbar ist, sonst öffnet das Rating-Modal genau in den 7 s
  // in denen der Banner up ist.
  useEffect(() => {
    let checkCount = 0;
    const checkInterval = setInterval(async () => {
      if (showAppRatingModal || bannerData !== null) {
        return;
      }
      checkCount++;
      try {
        await ratingPromptService.checkAndShowPendingRating();
      } catch (error) {
        console.error('❌ Periodic rating check error:', error);
      }
    }, RATING_POLL_INTERVAL_MS);
    return () => {
      clearInterval(checkInterval);
    };
  }, [showAppRatingModal, bannerData]);

  // ─── Public Streak-Toast (ggf. via global) ──────────────────
  //
  // Funktion zum manuellen Anzeigen der Streak Toast (z.B. von
  // achievementService oder direkt aus Pages). Geht durch dieselbe
  // Walkthrough-Queue-Logik.
  const showStreakToast = useCallback((streakDays: number, bonusPoints?: number) => {
    console.log(`🔥 Streak Toast triggered: ${streakDays} Tage (${bonusPoints || 0} Punkte)`);
    if (CoachmarkService.isAnyActive()) {
      console.log('🎯 Streak-Toast queued — Walkthrough läuft');
      setPendingStreakToasts((prev) => [...prev, { streakDays, bonusPoints }]);
      return;
    }
    showStreakToastNew(streakDays, bonusPoints, colorScheme || 'light');
  }, [colorScheme]);

  // Expose showStreakToast globally für einfachen Zugriff von Services.
  useEffect(() => {
    (global as any).showStreakToast = showStreakToast;
    return () => {
      delete (global as any).showStreakToast;
    };
  }, [showStreakToast]);

  // ─── Public showBanner für Catalog-Previews ──────────────────
  //
  // Wird über useGamification() konsumiert. Zeigt direkt einen
  // Banner ohne 1.5 s Defer (User hat ja gerade aktiv getapped),
  // respektiert aber die Walkthrough-Queue.
  const showBanner = useCallback((data: BannerData) => {
    if (CoachmarkService.isAnyActive()) {
      setPendingBannerData(data);
    } else {
      setBannerData(data);
    }
  }, []);

  return (
    <GamificationContext.Provider value={{ showBanner }}>
      {children}

      {/* Einheitlicher Celebration-Banner — sowohl für Achievement-
          Unlocks als auch Level-Ups. Sitzt knapp über der Tab-Bar,
          auto-dismisst nach 7 s, swipe-down zum sofortigen Schließen,
          Tap aufs Body navigiert zur Errungenschaften-Seite. */}
      <AchievementUnlockBanner
        visible={!!bannerData}
        data={bannerData}
        onDismiss={() => setBannerData(null)}
      />

      {/* App Rating Modal — Nach Level-Up via ratingPromptService. */}
      <AppRatingModal
        visible={showAppRatingModal}
        onClose={() => setShowAppRatingModal(false)}
      />
    </GamificationContext.Provider>
  );
};
