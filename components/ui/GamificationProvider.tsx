import { router } from 'expo-router';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  setAchievementUnlockHandler,
  setLevelUpHandler,
  setPointsEarnedHandler
} from '@/lib/services/achievementService';
import { CoachmarkService } from '@/lib/services/coachmarkService';
import {
  gamificationSettingsService,
  getAchievementTier,
} from '@/lib/services/gamificationSettingsService';
import { overlayManager } from '@/lib/services/overlayManager';
import { ratingPromptService } from '@/lib/services/ratingPrompt';
import { showPointsToast, showStreakToast as showStreakToastNew } from '@/lib/services/ui/toast';
import { Achievement } from '@/lib/types/achievements';
import React, { useCallback, useEffect, useState } from 'react';
import {
  AchievementUnlockBanner,
  type BannerData,
} from './AchievementUnlockBanner';
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

// ─── Banner-Data-Adapter ─────────────────────────────────────────
//
// Wandeln Achievement-/LevelUp-Daten ins generische BannerData-
// Schema um (Reanimated-friendly, mit Lottie). Reusable falls wir
// später weitere Subtle-Sources rein bringen.
//
// Lottie-Mapping spiegelt `lottieFor` aus app/achievements.tsx —
// gleiche Animation pro Action damit der visuelle Eindruck zwischen
// Detail-Page und Banner konsistent ist.
function lottieForAchievementAction(action: string | undefined): any {
  try {
    switch (action) {
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

function bannerDataFromAchievement(achievement: Achievement): BannerData {
  return {
    title: achievement.name,
    subtitle: achievement.description,
    points: achievement.points,
    lottie: lottieForAchievementAction(achievement.trigger?.action as string),
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

function bannerDataFromLevelUp(
  newLevel: number,
  oldLevel: number,
  unlockedCategory?: { id: string; name: string; imageUrl: string },
): BannerData {
  // Subtitle: bei Kategorie-Unlock ist DAS die Headline-News
  // (handlungsrelevant — User kann jetzt die Kategorie stöbern).
  // Sonst nur "Du bist jetzt auf Level X".
  const subtitle = unlockedCategory
    ? `Neue Kategorie verfügbar: ${unlockedCategory.name}`
    : `Du bist jetzt auf Level ${newLevel}`;
  return {
    title: `Level ${newLevel} erreicht`,
    subtitle,
    // Trophy-Lottie für Level-Ups, ist allgemeiner als ein
    // konkretes Action-Lottie. confetti.json würde auch passen,
    // aber 'achievement-unlock' wäre noch besser. Wir nehmen
    // 'lvlup.json' falls vorhanden, sonst confetti als Fallback.
    lottie: (() => {
      try {
        return require('@/assets/lottie/lvlup.json');
      } catch {
        return require('@/assets/lottie/confetti.json');
      }
    })(),
    tint: '#F0A030',
    onTap: () => {
      try {
        router.push('/achievements' as any);
      } catch (e) {
        console.warn('LevelUp banner nav failed (non-fatal):', e);
      }
    },
  };
}

// Level-Up Tier-Heuristik. Welche Stufen-Übergänge sind "subtle"
// (Banner) vs. "major" (Modal mit Konfetti)?
//
//   • Level 1 → 2: SUBTLE. Das ist das "ich mache zum ersten Mal
//     was, krieg automatisch Level 2"-Erlebnis. Ein Modal hier
//     wäre schon das dritte aufgeplöppte Element (Punkte-Toast +
//     evtl. Achievement-Banner + jetzt Modal) und würde den User
//     beim ersten Produkt-Tap überlasten.
//   • Level 2 → 3: SUBTLE. Auch noch warm-up phase.
//   • Level 3+: MAJOR. Echte Meilensteine, Modal lohnt sich.
//
// Wenn du das Verhalten ändern willst (z.B. Level 2 schon zu major
// machen weil du Drogerie-Unlock feiern willst): Schwelle hier
// hochziehen.
function isSubtleLevelUp(newLevel: number): boolean {
  return newLevel <= 3;
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

  // Subtle-Tier Celebrations landen im Banner statt im Modal —
  // sowohl Achievements als auch Level-Ups (Level 1→2). Banner
  // arbeitet mit generischer BannerData (siehe AchievementUnlockBanner)
  // → wir transformieren Achievement / LevelUp am Caller-Ort.
  const [bannerData, setBannerData] = useState<BannerData | null>(null);

  // Wenn ein Major-Overlay (Achievement-Modal oder Level-Up-Modal)
  // gerade läuft oder pending ist, darf KEIN subtle Banner parallel
  // erscheinen — sonst feiern wir gleichzeitig auf zwei Ebenen, was
  // genau die "Überforderung" ist die wir mit dem Tier-System lösen
  // wollten. Queue-Logik: wenn beim Banner-Show ein Major aktiv ist,
  // landet die BannerData hier; nach Major-Close drainen wir sie.
  const [pendingBannerData, setPendingBannerData] = useState<BannerData | null>(null);

  // Alte Toast-States entfernt - alles läuft über zentrale Toast-Library

  // Queue für Level-Ups (falls Achievement zuerst angezeigt wird)
  const [pendingLevelUp, setPendingLevelUp] = useState<LevelUpData | null>(null);

  // 📱 App Rating Modal State
  const [showAppRatingModal, setShowAppRatingModal] = useState(false);

  // ─── Walkthrough-Active Tracking ──────────────────────────────
  //
  // Wenn ein Walkthrough (HomeWalkthrough oder ProductDetail-
  // Walkthrough) sichtbar ist, sollen ALLE Gamification-
  // Notifications (Banner, Level-Up-Modal, Achievement-Modal,
  // Punkte-Toasts, Streak-Toasts) NICHT parallel feuern, sondern
  // queuen und nach Tour-Ende abarbeiten. Sonst gehen sie unter
  // dem Tour-Backdrop unter und der User sieht seine Belohnung
  // nicht.
  //
  // Subscribe via CoachmarkService.onActivityChange (Modul-Singleton).
  // Walkthroughs registrieren sich mit setActive(id, true/false).
  const [walkthroughActive, setWalkthroughActive] = useState(false);
  useEffect(() => {
    const off = CoachmarkService.onActivityChange((any) => {
      setWalkthroughActive(any);
    });
    return off;
  }, []);

  // Pending-Queues für Toasts. Banner und Level-Up haben schon
  // eigene Pending-States; Toasts werden bisher synchron gefeuert
  // → wir brauchen jetzt explizite Queues damit sie defered
  // werden können.
  const [pendingPointsToasts, setPendingPointsToasts] = useState<
    Array<{ points: number; message: string }>
  >([]);
  const [pendingStreakToasts, setPendingStreakToasts] = useState<
    Array<{ streakDays: number; bonusPoints?: number }>
  >([]);
  // Major-Achievement-Modal kann auch gequeued werden falls ein
  // Walkthrough aktiv ist (das volle Konfetti-Modal soll nicht
  // unter dem Tour-Backdrop verschwinden).
  const [pendingMajorAchievement, setPendingMajorAchievement] =
    useState<Achievement | null>(null);

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
      // Subtle: Banner unten, 1.5 s defered. Queue wenn beim
      // Anzeigezeitpunkt ein Major-Overlay läuft ODER ein
      // Walkthrough aktiv ist.
      const data = bannerDataFromAchievement(achievement);
      setTimeout(() => {
        // Walkthrough-Check direkt am Service-Singleton — der
        // useState-walkthroughActive ist evtl. stale wenn der
        // Setter noch nicht durch den React-Cycle ist.
        const walkthroughOn = CoachmarkService.isAnyActive();
        setLevelUpData(currentLevelUp => {
          setAchievementData(currentAch => {
            setPendingLevelUp(currentPendingLevel => {
              const majorActive =
                currentLevelUp.visible ||
                currentAch.visible ||
                currentPendingLevel !== null;
              if (majorActive || walkthroughOn) {
                console.log(
                  `🎖️ Banner queued (major=${majorActive}, walkthrough=${walkthroughOn})`,
                );
                setPendingBannerData(data);
              } else {
                setBannerData(data);
              }
              return currentPendingLevel;
            });
            return currentAch;
          });
          return currentLevelUp;
        });
      }, 1500);
      return;
    }

    // Major: bestehender Modal-Flow via overlayManager. Auch hier
    // queuen wir wenn ein Walkthrough aktiv ist — das Modal soll
    // nicht parallel zur Tour aufploppen.
    if (CoachmarkService.isAnyActive()) {
      console.log('🏆 Major Achievement queued — Walkthrough läuft');
      setPendingMajorAchievement(achievement);
      return;
    }
    overlayManager.showOverlay(() => {
      setAchievementData(() => ({
        visible: true,
        achievement: achievement,
        autoHide: false,
      }));
    });
  }, []);

  const pointsHandler = useCallback(async (points: number, action: string, message: string) => {
    if (points <= 0) return;
    const notificationsDisabled = await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Punkte Toast unterdrückt (Spielerische Inhalte deaktiviert)');
      return;
    }
    // Walkthrough-Active → queuen, drainen nach Tour-Ende.
    if (CoachmarkService.isAnyActive()) {
      console.log('🎯 Punkte-Toast queued — Walkthrough läuft');
      setPendingPointsToasts((prev) => [...prev, { points, message }]);
      return;
    }
    showPointsToast(message, points, colorScheme || 'light');
  }, [colorScheme]);

  const levelUpHandler = useCallback(async (newLevel: number, oldLevel: number, unlockedCategory?: { id: string; name: string; imageUrl: string }) => {
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

    // ─── Tier-Routing ────────────────────────────────────────
    //
    // Frühe Level (1→2, 2→3) gehen in den Banner statt ins
    // Konfetti-Modal — User soll beim ersten Produkt-Tap nicht von
    // einem vollformatigen "Du bist Level 2!"-Spektakel erschlagen
    // werden. Das Modal kommt erst ab Level 4+ wo der User
    // bewiesen hat dass er aktiv genug für eine echte Feier ist.
    if (isSubtleLevelUp(newLevel)) {
      console.log('🎯 Level-Up tier=subtle → Banner statt Modal');
      const data = bannerDataFromLevelUp(newLevel, oldLevel, unlockedCategory);
      setTimeout(() => {
        const walkthroughOn = CoachmarkService.isAnyActive();
        setLevelUpData(currentLevelUp => {
          setAchievementData(currentAch => {
            setPendingLevelUp(currentPendingLevel => {
              const majorActive =
                currentLevelUp.visible ||
                currentAch.visible ||
                currentPendingLevel !== null;
              if (majorActive || walkthroughOn) {
                setPendingBannerData(data);
              } else {
                setBannerData(data);
              }
              return currentPendingLevel;
            });
            return currentAch;
          });
          return currentLevelUp;
        });
      }, 1500);
      return;
    }

    // ─── Major: bestehender Modal-Flow ───────────────────────
    //
    // Walkthrough-Active hat Vorrang: Major-Modal queuen, nach
    // Tour-Ende drainen (siehe drain-Effects unten).
    const newLevelData = { visible: true, newLevel, oldLevel, unlockedCategory };
    if (CoachmarkService.isAnyActive()) {
      console.log('🎯 Level-Up Major queued — Walkthrough läuft');
      setPendingLevelUp(newLevelData);
      return;
    }

    overlayManager.showOverlay(() => {
      setAchievementData(currentAchievement => {
        if (currentAchievement.visible) {
          console.log('🏆 Achievement aktiv - Level-Up wird in Queue gestellt');
          setPendingLevelUp(newLevelData);
          return currentAchievement;
        } else {
          setLevelUpData(newLevelData);
          return currentAchievement;
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

  // 🎖️ Banner-Suppression beim Major-Open
  //
  // Wenn ein Major-Overlay (Achievement-Modal oder Level-Up-Modal)
  // gerade aufgeht, während ein subtle Banner schon sichtbar ist,
  // ziehen wir den Banner zurück und schieben ihn in die Pending-
  // Queue. Sonst würden beide gleichzeitig sichtbar sein (siehe
  // Bug-Screenshot).
  //
  // Edge-Case: wenn Banner gleichzeitig mit Major aufgeht (klassisch
  // bei trackAction wo beide Achievements + Level-Up unlocken),
  // kommt der Banner-Show-Effect-Timer evtl. erst nach diesem Effect.
  // Der Show-Logic im achievementHandler-Timer prüft dann selbst
  // nochmal den Major-State (siehe oben) und queued — das deckt
  // diesen Race ab.
  useEffect(() => {
    if (!bannerData) return;
    if (
      levelUpData.visible ||
      achievementData.visible ||
      pendingLevelUp !== null ||
      walkthroughActive
    ) {
      console.log('🎖️ Major/Walkthrough öffnet — aktiver Banner geht in Queue');
      setPendingBannerData(bannerData);
      setBannerData(null);
    }
  }, [
    bannerData,
    levelUpData.visible,
    achievementData.visible,
    pendingLevelUp,
    walkthroughActive,
  ]);

  // 🎖️ Banner-Drain nach Major-/Walkthrough-Close
  //
  // Wenn alle Major-Overlays geschlossen sind UND kein Walkthrough
  // läuft, zeigen wir den Pending-Banner jetzt — mit kurzer Grace-
  // Period damit Close-Animationen nicht mit dem Banner-Slide-In
  // überlappen.
  useEffect(() => {
    if (!pendingBannerData) return;
    if (
      levelUpData.visible ||
      achievementData.visible ||
      pendingLevelUp !== null ||
      walkthroughActive
    ) {
      return;
    }
    const t = setTimeout(() => {
      setBannerData(pendingBannerData);
      setPendingBannerData(null);
    }, 400);
    return () => clearTimeout(t);
  }, [
    pendingBannerData,
    levelUpData.visible,
    achievementData.visible,
    pendingLevelUp,
    walkthroughActive,
  ]);

  // 🏆 Major-Achievement-Drain nach Walkthrough-Close
  //
  // Major-Achievement-Modal wartet auch auf Walkthrough-Ende.
  // Sobald Tour weg, fired über den OverlayManager (gleiche Logik
  // wie der direkte Pfad).
  useEffect(() => {
    if (!pendingMajorAchievement) return;
    if (walkthroughActive) return;
    if (
      levelUpData.visible ||
      achievementData.visible ||
      pendingLevelUp !== null
    ) {
      return;
    }
    const t = setTimeout(() => {
      const ach = pendingMajorAchievement;
      setPendingMajorAchievement(null);
      overlayManager.showOverlay(() => {
        setAchievementData(() => ({
          visible: true,
          achievement: ach,
          autoHide: false,
        }));
      });
    }, 400);
    return () => clearTimeout(t);
  }, [
    pendingMajorAchievement,
    walkthroughActive,
    levelUpData.visible,
    achievementData.visible,
    pendingLevelUp,
  ]);

  // 🎯 Pending Level-Up-Drain bei Walkthrough-Ende
  //
  // levelUpHandler queued bei aktivem Walkthrough in pendingLevelUp.
  // Sobald Walkthrough weg + kein anderes Major aktiv → fire'n.
  // (Bestehender Achievement→LevelUp-Drain in handleAchievementClose
  //  bleibt unverändert — sequenziert weiterhin nach Achievement.)
  useEffect(() => {
    if (!pendingLevelUp) return;
    if (walkthroughActive) return;
    if (achievementData.visible || levelUpData.visible) return;
    const t = setTimeout(() => {
      setLevelUpData(pendingLevelUp);
      setPendingLevelUp(null);
    }, 400);
    return () => clearTimeout(t);
  }, [
    pendingLevelUp,
    walkthroughActive,
    achievementData.visible,
    levelUpData.visible,
  ]);

  // 🟡 Pending Punkte/Streak-Toasts-Drain bei Walkthrough-Ende
  //
  // Toasts sind brief (3-4 s) und stack-bar (zentrale Toast-Lib).
  // Sobald Tour weg → alle pending toasts sequentiell mit kurzem
  // Stagger feuern damit sie nicht alle auf einmal kommen.
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

  // 📱 Periodic check for pending rating - BUT BLOCKED DURING OVERLAYS!
  useEffect(() => {
    console.log('📱 Starting periodic rating check interval...');
    let checkCount = 0;
    
    const checkInterval = setInterval(async () => {
      // 🛡️ CRITICAL: Skip if ANY overlay is active!
      // Banner zählt auch als "active" — sonst öffnet das Rating-
      // Modal manchmal genau in den 5 s in denen der Banner sichtbar
      // ist und der User sieht beides parallel.
      if (
        levelUpData.visible ||
        achievementData.visible ||
        showAppRatingModal ||
        bannerData !== null
      ) {
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
  }, [
    levelUpData.visible,
    achievementData.visible,
    showAppRatingModal,
    bannerData,
  ]);

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
    // Walkthrough-Active → queuen.
    if (CoachmarkService.isAnyActive()) {
      console.log('🎯 Streak-Toast queued — Walkthrough läuft');
      setPendingStreakToasts((prev) => [...prev, { streakDays, bonusPoints }]);
      return;
    }
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

      {/* Subtle-Tier Banner — sowohl für Achievements als auch
          für Level-Ups (Level 1-3). Sitzt knapp über der Tab-
          Bar, auto-dismisst nach 5 s, swipe-down zum sofortigen
          Schließen, Tap aufs Body navigiert zur Errungenschaften-
          Seite. Generische BannerData (siehe AchievementUnlockBanner)
          → der Provider transformiert seine Sources am Caller-Ort. */}
      <AchievementUnlockBanner
        visible={!!bannerData}
        data={bannerData}
        onDismiss={() => setBannerData(null)}
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


