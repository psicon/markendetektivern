import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  setAchievementUnlockHandler,
  setLevelUpHandler,
  setPointsEarnedHandler
} from '@/lib/services/achievementService';
import {
  gamificationSettingsService,
  getAchievementTier,
} from '@/lib/services/gamificationSettingsService';
import { overlayManager } from '@/lib/services/overlayManager';
import { ratingPromptService } from '@/lib/services/ratingPrompt';
import { showPointsToast, showStreakToast as showStreakToastNew } from '@/lib/services/ui/toast';
import { Achievement } from '@/lib/types/achievements';
import React, { useCallback, useEffect, useState } from 'react';
import { AchievementUnlockBanner } from './AchievementUnlockBanner';
import { AchievementUnlockOverlay } from './AchievementUnlockOverlay';
import { AppRatingModal } from './AppRatingModal';
import { LevelUpOverlay } from './LevelUpOverlay';
// Alle Toasts laufen über zentrale Toast-Library

interface GamificationProviderProps {
  children: React.ReactNode;
}

interface LevelUpData {
  visible: boolean;
  newLevel: number;
  oldLevel: number;
  unlockedCategory?: {
    id: string;
    name: string;
    imageUrl: string;
  };
}

interface AchievementData {
  visible: boolean;
  achievement: Achievement | null;
  autoHide?: boolean;      // Für Achievement + Level-Up Sequencing
}

// Alte Interfaces entfernt - zentrale Toast-Library verwendet

/**
 * Zentraler Provider für alle Gamification-Overlays und Toasts
 * Registriert sich bei AchievementService Callbacks und zeigt UI-Komponenten
 */
export const GamificationProvider: React.FC<GamificationProviderProps> = ({ children }) => {
  const colorScheme = useColorScheme();
  const { user } = useAuth();
  // State für verschiedene UI-Overlays
  const [levelUpData, setLevelUpData] = useState<LevelUpData>({
    visible: false,
    newLevel: 1,
    oldLevel: 1
  });

  const [achievementData, setAchievementData] = useState<AchievementData>({
    visible: false,
    achievement: null,
    autoHide: false
  });

  // Subtle-Tier Achievements landen im Banner statt im Modal —
  // siehe getAchievementTier in gamificationSettingsService. Banner
  // ist self-dismissing nach 5 s, deshalb braucht's hier nur einen
  // simplen "currently shown" State, kein autoHide-Flag.
  const [bannerAchievement, setBannerAchievement] =
    useState<Achievement | null>(null);

  // Alte Toast-States entfernt - alles läuft über zentrale Toast-Library

  // Queue für Level-Ups (falls Achievement zuerst angezeigt wird)
  const [pendingLevelUp, setPendingLevelUp] = useState<LevelUpData | null>(null);

  // 📱 App Rating Modal State
  const [showAppRatingModal, setShowAppRatingModal] = useState(false);

  // 🎯 Stabile Callback-Funktionen mit useCallback
  //
  // Tier-Routing: subtle → Banner unten, major → Modal vollformat.
  // Subtle-Banner kriegt zudem 1.5 s Delay damit er nicht direkt
  // beim Mount eines Detail-Screens loswackelt — der User soll
  // erst die Inhalte aufnehmen können bevor Reward-Feedback kommt.
  // Track-Side bleibt unangetastet (Daten-Updates sofort) — nur
  // die Banner-DARSTELLUNG ist defered.
  const achievementHandler = useCallback(async (achievement: Achievement) => {
    console.log('🏆 Achievement Unlock UI triggered:', achievement.name);

    const notificationsDisabled =
      await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Achievement-UI unterdrückt (Spielerische Inhalte deaktiviert)');
      return;
    }

    const tier = getAchievementTier(achievement);

    if (tier === 'subtle') {
      // Subtle: Banner unten, defered. Wenn aktuell schon ein
      // Banner sichtbar ist, replacen wir ihn (neuestes
      // Achievement gewinnt — alte Banner verlöscht). Bei mehr
      // Volumen wäre eine Queue sauberer; aktuell ist die
      // Frequenz so niedrig dass das egal ist.
      setTimeout(() => {
        setBannerAchievement(achievement);
      }, 1500);
      return;
    }

    // Major: bestehender Modal-Flow via overlayManager.
    overlayManager.showOverlay(() => {
      setAchievementData(() => ({
        visible: true,
        achievement: achievement,
        autoHide: false,
      }));
    });
  }, []);

  const pointsHandler = useCallback(async (points: number, action: string, message: string) => {
    if (points > 0) {
      // Prüfe ob Benachrichtigungen deaktiviert sind
      const notificationsDisabled = await gamificationSettingsService.areNotificationsDisabled();
      if (notificationsDisabled) {
        console.log('🔕 Punkte Toast unterdrückt (Benachrichtigungen deaktiviert)');
        return;
      }
      
      // Neue Toast-Bibliothek: stapelbar, top-position, swipe dismiss, theme-aware
      showPointsToast(message, points, colorScheme || 'light');
    }
  }, [colorScheme]);

  const levelUpHandler = useCallback(async (newLevel: number, oldLevel: number, unlockedCategory?: { id: string; name: string; imageUrl: string }) => {
    console.log(`🎯 Level-Up UI triggered: ${oldLevel} → ${newLevel}`);
    if (unlockedCategory) {
      console.log(`🎁 Mit freigeschalteter Kategorie: ${unlockedCategory.name}`);
    }
    
    // Prüfe ob Benachrichtigungen deaktiviert sind
    const notificationsDisabled = await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Level-Up Overlay unterdrückt (Benachrichtigungen deaktiviert)');
      return;
    }
    
    const newLevelData = { visible: true, newLevel, oldLevel, unlockedCategory };
    
    // Verwende OverlayManager um Konflikte zu vermeiden
    overlayManager.showOverlay(() => {
      // Prüfe ob bereits ein Achievement angezeigt wird - verwende aktuellen State
      setAchievementData(currentAchievement => {
        if (currentAchievement.visible) {
          console.log('🏆 Achievement aktiv - Level-Up wird in Queue gestellt');
          setPendingLevelUp(newLevelData);
          
          // KEIN Auto-Close mehr! User muss Achievement manuell schließen
          // Level-Up wird erst nach manuellem Achievement-Close gezeigt
          
          return currentAchievement; // Unverändert, kein autoHide
        } else {
          // Kein Achievement aktiv - Level-Up direkt anzeigen
          setLevelUpData(newLevelData);
          return currentAchievement; // Unchanged
        }
      });
    });
  }, []);

  // 🔄 Callback-Registrierungsfunktion
  const registerCallbacks = useCallback(() => {
    console.log('🎮 Registriere Gamification UI-Callbacks...');
    setAchievementUnlockHandler(achievementHandler);
    setPointsEarnedHandler(pointsHandler);
    setLevelUpHandler(levelUpHandler);
  }, [achievementHandler, pointsHandler, levelUpHandler]);

  // 🔄 Einmalige Registrierung - KEIN Interval mehr!
  useEffect(() => {
    registerCallbacks();
    
    // 📱 App Rating Modal Handler registrieren (neuer Service)
    console.log('📱 Registriere App Rating Modal Handler...');
    ratingPromptService.setRatingModalHandler(setShowAppRatingModal);
    console.log('📱 App Rating Modal Handler registriert!');
    
    return () => {
      console.log('🎮 Gamification UI-Callbacks deregistriert');
      setAchievementUnlockHandler(null);
      setPointsEarnedHandler(null);
      setLevelUpHandler(null);
      ratingPromptService.setRatingModalHandler(() => {});
    };
  }, [registerCallbacks]);

  // 📱 Periodic check for pending rating - BUT BLOCKED DURING OVERLAYS!
  useEffect(() => {
    console.log('📱 Starting periodic rating check interval...');
    let checkCount = 0;
    
    const checkInterval = setInterval(async () => {
      // 🛡️ CRITICAL: Skip if ANY overlay is active!
      if (levelUpData.visible || achievementData.visible || showAppRatingModal) {
        return; // Skip silently - happens often
      }
      
      checkCount++;
      
      try {
        await ratingPromptService.checkAndShowPendingRating();
      } catch (error) {
        console.error('❌ Periodic rating check error:', error);
      }
    }, 2000); // Check every 2 seconds
    
    return () => {
      console.log('📱 Stopping periodic rating check');
      clearInterval(checkInterval);
    };
  }, [levelUpData.visible, achievementData.visible, showAppRatingModal]);

  // Handler für Overlay-Schließungen
  const handleLevelUpClose = async () => {
    const { newLevel } = levelUpData;
    setLevelUpData(prev => ({ ...prev, visible: false }));
    
    // 📱 NOW set rating flag AFTER level-up closes
    if (newLevel >= 3 && user?.uid) {
      console.log(`📱 Level-Up closed, NOW setting rating flag for level ${newLevel}`);
      try {
        await ratingPromptService.setPendingRating(user.uid, newLevel);
        console.log(`✅ Rating flag set - will be checked by periodic interval`);
      } catch (error) {
        console.error('❌ Error setting rating flag:', error);
      }
    }
  };

  const handleAchievementClose = () => {
    setAchievementData({ visible: false, achievement: null });
    
    // Prüfe ob Level-Up pending ist nach Achievement-Close
    if (pendingLevelUp) {
      setTimeout(() => {
        setLevelUpData(pendingLevelUp);
        setPendingLevelUp(null);
      }, 300); // Kurzer Übergang
    }
  };

  // Alte Toast-Handler entfernt - zentrale Library übernimmt

  // Funktion zum Anzeigen der Streak Toast (nutzt neue Toast-Library mit STREAK-Farbe)
  const showStreakToast = useCallback((streakDays: number, bonusPoints?: number) => {
    console.log(`🔥 Streak Toast triggered: ${streakDays} Tage (${bonusPoints || 0} Punkte)`);
    
    // Verwende neue Toast-Library mit konfigurierbarer STREAK-Farbe (orange), theme-aware
    showStreakToastNew(streakDays, bonusPoints, colorScheme || 'light');
  }, [colorScheme]);

  // Expose showStreakToast globally für einfachen Zugriff
  React.useEffect(() => {
    (global as any).showStreakToast = showStreakToast;
    
    return () => {
      delete (global as any).showStreakToast;
    };
  }, [showStreakToast]);

  return (
    <>
      {children}

      {/* Level-Up Overlay - Große Animation mit manueller Schließung */}
      <LevelUpOverlay
        visible={levelUpData.visible}
        newLevel={levelUpData.newLevel}
        oldLevel={levelUpData.oldLevel}
        unlockedCategory={levelUpData.unlockedCategory}
        onClose={handleLevelUpClose}
      />

      {/* Achievement Unlock Overlay - Prominente Achievement-Darstellung
          (für 'major'-Tier — savings_total ≥ 50 €, Level-Hochstufungen,
          7-Tage-Streak etc.) */}
      <AchievementUnlockOverlay
        visible={achievementData.visible}
        achievement={achievementData.achievement}
        onClose={handleAchievementClose}
        autoHide={achievementData.autoHide}
      />

      {/* Achievement Banner - dezenter Slide-In für 'subtle'-Tier
          Achievements (first_action_any, niedrigschwellige Trivial-
          Punkte). Sitzt knapp über der Tab-Bar, auto-dismisst
          nach 5 s, swipe-down/✕ zum sofortigen Schließen, Tap
          aufs Body navigiert zur Errungenschaften-Seite. */}
      <AchievementUnlockBanner
        visible={!!bannerAchievement}
        achievement={bannerAchievement}
        onDismiss={() => setBannerAchievement(null)}
      />

      {/* App Rating Modal - Nach Login/Level-Up */}
      <AppRatingModal
        visible={showAppRatingModal}
        onClose={() => setShowAppRatingModal(false)}
      />

      {/* 
        WICHTIG: Alle alten PointsToast/StreakToast Komponenten entfernt!
        Jetzt läuft alles über zentrale Toast-Library mit kategorie-spezifischen Farben:
        - showPointsToast() → GELB
        - showStreakToast() → ORANGE  
        - showCartAddedToast() → GRÜN
        - showFavoriteAddedToast() → ROSA
      */}
    </>
  );
};


