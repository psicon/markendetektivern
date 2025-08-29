import {
  setAchievementUnlockHandler,
  setLevelUpHandler,
  setPointsEarnedHandler
} from '@/lib/services/achievementService';
import { Achievement } from '@/lib/types/achievements';
import React, { useCallback, useEffect, useState } from 'react';
import { AchievementUnlockOverlay } from './AchievementUnlockOverlay';
import { LevelUpOverlay } from './LevelUpOverlay';
import { PointsToast } from './PointsToast';
// StreakToast entfernt - nutze PointsToast mit type='streak'

interface GamificationProviderProps {
  children: React.ReactNode;
}

interface LevelUpData {
  visible: boolean;
  newLevel: number;
  oldLevel: number;
}

interface AchievementData {
  visible: boolean;
  achievement: Achievement | null;
  autoHide?: boolean;      // Für Achievement + Level-Up Sequencing
}

interface PointsToastData {
  visible: boolean;
  points: number;
  action: string;
  message: string;
}

// StreakToast wird jetzt über PointsToast mit type='streak' abgewickelt

/**
 * Zentraler Provider für alle Gamification-Overlays und Toasts
 * Registriert sich bei AchievementService Callbacks und zeigt UI-Komponenten
 */
export const GamificationProvider: React.FC<GamificationProviderProps> = ({ children }) => {
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

  const [pointsToastData, setPointsToastData] = useState<PointsToastData>({
    visible: false,
    points: 0,
    action: '',
    message: ''
  });

  // Verwende PointsToast für Streak (type='streak' ist bereits eingebaut!)
  const [streakToastData, setStreakToastData] = useState<PointsToastData>({
    visible: false,
    points: 0,
    action: 'streak',
    message: ''
  });

  // Queue für Level-Ups (falls Achievement zuerst angezeigt wird)
  const [pendingLevelUp, setPendingLevelUp] = useState<LevelUpData | null>(null);

  // 🎯 Stabile Callback-Funktionen mit useCallback
  const achievementHandler = useCallback((achievement: Achievement) => {
    console.log('🏆 Achievement Unlock UI triggered:', achievement.name);
    
    // Verwende aktuellen State über Setter-Function
    setAchievementData(prev => {
      setPendingLevelUp(currentPending => {
        const hasLevelUpPending = currentPending !== null;
        
        // Wenn Level-Up geplant: Achievement automatisch nach 3 Sekunden schließen
        if (hasLevelUpPending) {
          console.log('🎯 Achievement wird automatisch geschlossen - Level-Up folgt');
          setTimeout(() => {
            setAchievementData({ visible: false, achievement: null, autoHide: false });
            
            // Triggere Level-Up nach Achievement
            setTimeout(() => {
              setPendingLevelUp(pending => {
                if (pending) {
                  setLevelUpData(pending);
                  return null;
                }
                return pending;
              });
            }, 300); // Kurzer Übergang
          }, 3000);
        }
        
        return currentPending; // Unchanged
      });
      
      return {
        visible: true,
        achievement: achievement,
        autoHide: false  // Wird später per setTimeout gesetzt wenn nötig
      };
    });
  }, []);

  const pointsHandler = useCallback((points: number, action: string, message: string) => {
    console.log(`💰 Points Toast triggered: +${points} für ${action}`);
    
    // Toast für ALLE Punkte-Vergaben anzeigen (auch 1-4 Punkte)
    if (points > 0) {
      setPointsToastData({
        visible: true,
        points,
        action,
        message
      });
      
      // Auto-hide nach 2.5 Sekunden (etwas kürzer für häufigere Toasts)
      setTimeout(() => {
        setPointsToastData(prev => ({ ...prev, visible: false }));
      }, 2500);
    }
  }, []);

  const levelUpHandler = useCallback((newLevel: number, oldLevel: number) => {
    console.log(`🎯 Level-Up UI triggered: ${oldLevel} → ${newLevel}`);
    
    const newLevelData = { visible: true, newLevel, oldLevel };
    
    // Prüfe ob bereits ein Achievement angezeigt wird - verwende aktuellen State
    setAchievementData(currentAchievement => {
      if (currentAchievement.visible) {
        console.log('🏆 Achievement aktiv - Level-Up wird in Queue gestellt');
        setPendingLevelUp(newLevelData);
        
        // Achievement automatisch schließen nach 3 Sekunden
        setTimeout(() => {
          setAchievementData({ visible: false, achievement: null, autoHide: false });
          
          // Level-Up anzeigen nach Achievement
          setTimeout(() => {
            setLevelUpData(newLevelData);
            setPendingLevelUp(null);
          }, 300);
        }, 3000);
        
        // Achievement auf Auto-Hide setzen
        return { ...currentAchievement, autoHide: true };
      } else {
        // Kein Achievement aktiv - Level-Up direkt anzeigen
        setLevelUpData(newLevelData);
        return currentAchievement; // Unchanged
      }
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
    
    return () => {
      console.log('🎮 Gamification UI-Callbacks deregistriert');
      setAchievementUnlockHandler(null);
      setPointsEarnedHandler(null);
      setLevelUpHandler(null);
    };
  }, [registerCallbacks]);



  // Handler für Overlay-Schließungen
  const handleLevelUpClose = () => {
    setLevelUpData(prev => ({ ...prev, visible: false }));
  };

  const handleAchievementClose = () => {
    setAchievementData({ visible: false, achievement: null });
  };

  const handlePointsToastHide = () => {
    setPointsToastData(prev => ({ ...prev, visible: false }));
  };

  // Funktion zum Anzeigen der Streak Toast (nutzt PointsToast mit type='streak')
  const showStreakToast = useCallback((streakDays: number, bonusPoints?: number) => {
    console.log(`🔥 Streak Toast triggered: ${streakDays} Tage (${bonusPoints || 0} Punkte)`);
    
    // Zeige Punkte nur wenn > 0 (bei wiederholtem Öffnen am selben Tag keine Punkte)
    const showPoints = bonusPoints && bonusPoints > 0;
    
    setStreakToastData({
      visible: true,
      points: showPoints ? bonusPoints : 0,
      action: 'streak',
      message: showPoints 
        ? `${streakDays} ${streakDays === 1 ? 'Tag' : 'Tage'} Streak! +${bonusPoints} Punkte`
        : `${streakDays} ${streakDays === 1 ? 'Tag' : 'Tage'} Streak!`
    });
  }, []);

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
        onClose={handleLevelUpClose}
      />

      {/* Achievement Unlock Overlay - Prominente Achievement-Darstellung */}
      <AchievementUnlockOverlay
        visible={achievementData.visible}
        achievement={achievementData.achievement}
        onClose={handleAchievementClose}
        autoHide={achievementData.autoHide}
      />

      {/* Points Toast - Subtile Punkte-Benachrichtigung */}
      <PointsToast
        visible={pointsToastData.visible}
        points={pointsToastData.points}
        message={pointsToastData.message}
        onHide={handlePointsToastHide}
        type="points"
      />

      {/* Streak Toast - nutze PointsToast mit type='streak' */}
      <PointsToast
        visible={streakToastData.visible}
        points={streakToastData.points}
        message={streakToastData.message}
        type="streak"
        onHide={() => setStreakToastData({ visible: false, points: 0, action: '', message: '' })}
      />
    </>
  );
};


