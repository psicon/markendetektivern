import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut, updateProfile, User } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth } from '../firebase';
import achievementService, { setProfileRefreshCallback } from '../services/achievementService';
import { isAppleAuthAvailable, signInWithApple, signOutApple } from '../services/auth/appleAuth';
import { signInWithGoogle, signOutGoogle } from '../services/auth/googleAuth';
import { createUserProfile, getUserProfile, UserProfile } from '../services/userProfile';
import { scheduleRegionGuess } from '../services/regionGuess';

interface AdditionalProfileData {
  realName?: string;
  birthDate?: Date | null;
  gender?: string;
  location?: string;
  favoriteMarket?: string; // Discounter ID
  favoriteMarketName?: string; // Marktname für schnelle Anzeige
}

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  isAnonymous: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string, additionalData?: AdditionalProfileData) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInAnonymously: () => Promise<void>;
  logout: () => Promise<void>;
  isAppleAuthAvailable: () => Promise<boolean>;
  refreshUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Hilfsfunktion für Streak Toast bei App-Start
const checkStreakOnAppStart = async (userId: string) => {
  try {
    // Hole aktuelle User-Stats
    const userStats = await achievementService.getUserStats(userId);
    const currentStreak = userStats?.currentStreak || 0;
    const lastStreakCheck = userStats?.lastStreakCheckDate;
    
    // Prüfe ob heute schon gecheckt wurde (dann keine Punkte anzeigen)
    const today = new Date().toISOString().split('T')[0];
    const isFirstOpenToday = lastStreakCheck !== today;
    
    // Zeige Toast nur wenn Streak >= 2 Tage (erste Tag ist noch nicht interessant)
    if (currentStreak >= 2) {
      // Berechne Bonus-Punkte (aber zeige nur an wenn heute der erste Check ist)
      const bonusPoints = isFirstOpenToday ? Math.max(0, currentStreak - 1) : 0;
      
      console.log(`🔥 Zeige Streak Toast für ${currentStreak} Tage (${bonusPoints} Punkte)`);
      
      // Prüfe ob global showStreakToast verfügbar ist (von GamificationProvider)
      if (typeof (global as any).showStreakToast === 'function') {
        (global as any).showStreakToast(currentStreak, bonusPoints);
      } else {
        console.log('⚠️ showStreakToast nicht verfügbar - GamificationProvider noch nicht ready');
        // Retry nach 2 Sekunden falls GamificationProvider noch lädt
        setTimeout(() => {
          if (typeof (global as any).showStreakToast === 'function') {
            (global as any).showStreakToast(currentStreak, bonusPoints);
          }
        }, 2000);
      }
    } else {
      console.log(`⏭️ Kein Streak Toast - nur ${currentStreak} Tage`);
    }
  } catch (error) {
    console.error('❌ Fehler beim Streak Toast Check:', error);
  }
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);

  const refreshUserProfile = useCallback(async () => {
    if (user?.uid) {
      try {
        // Versuche Profile zu laden (auch für anonyme User)
        let profile = await getUserProfile(user.uid);
        
        // Falls kein Profil existiert, erstelle eins für anonyme User
        if (!profile && user.isAnonymous) {
          const basicProfile = {
            uid: user.uid,
            email: 'anonymous@markendetektive.app',
            display_name: 'Anonymer Nutzer',
            created_time: new Date(),
            totalSavings: 0,
            // LEVEL WIRD NICHT HIER GESETZT - kommt aus stats
            xp: 0,
            productsSaved: 0,
            ratingsGiven: 0,
            streakDays: 0,
            isPremium: false
          };
          profile = basicProfile;
          console.log('📝 Anonymes Profil erstellt für:', user.uid);
        }
        
        // Lade Achievement-Stats
        const stats = await achievementService.getUserStats(user.uid);
        const enrichedProfile = {
          ...profile,
          stats: stats
        };
        
        setUserProfile(enrichedProfile);
        console.log('🔄 AuthContext: User profile + stats refreshed (anonymous:', user.isAnonymous, ')');
      } catch (error) {
        console.warn('⚠️ Profil konnte nicht geladen werden:', error);
        setUserProfile(null);
      }
    }
  }, [user]);

  useEffect(() => {
    // Registriere Profile-Refresh-Callback für Achievement-System
    setProfileRefreshCallback(refreshUserProfile);
    
    let anonymousSignInTimeout: NodeJS.Timeout | null = null;
    let isMounted = true;
    let hasInitialAuthState = false;
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Verhindere State Updates wenn Component unmounted ist
      if (!isMounted) {
        console.log('⏭️ Auth state change ignored (component unmounted)');
        return;
      }
      
      console.log('🔄 AuthContext: Auth state changed:', user ? `User: ${user.uid} (anonymous: ${user.isAnonymous})` : 'No user');
      setUser(user);
      setIsAnonymous(user?.isAnonymous || false);
      
      // 🔐 BACKUP: Speichere User-ID zusätzlich (falls AsyncStorage teilweise gelöscht wird)
      if (user?.uid) {
        try {
          await AsyncStorage.setItem('@auth_user_id_backup', user.uid);
          await AsyncStorage.setItem('@auth_user_email_backup', user.email || 'anonymous');
          await AsyncStorage.setItem('@auth_last_login', Date.now().toString());
        } catch (error) {
          console.warn('⚠️ Could not backup user session:', error);
        }
      }
      
        // Set user ID in Crashlytics (nur in Production Builds)
        if (!__DEV__ && Constants.appOwnership !== 'expo') {
          try {
            const crashlytics = require('@react-native-firebase/crashlytics').default;
            if (user?.uid) {
              await crashlytics().setUserId(user.uid);
              crashlytics().setAttribute('is_anonymous', user.isAnonymous ? 'true' : 'false');
            }
          } catch (error) {
            console.log('⚠️ Crashlytics not available:', error);
          }
        }
      
      if (user?.uid) {
        // User gefunden - lösche Timeout falls noch aktiv
        if (anonymousSignInTimeout) {
          clearTimeout(anonymousSignInTimeout);
          anonymousSignInTimeout = null;
          console.log('✅ Timeout gecancelt - User gefunden');
        }
        hasInitialAuthState = true;
        
        // 🔄 EINMALIGE GAMIFICATION INITIALISIERUNG nach Authentifizierung
        console.log('🚀 Starte Gamification-Initialisierung nach Authentifizierung...');
        try {
          // Reset Achievement Service nur bei User-Wechsel
          achievementService.resetForNewAuth(user.uid);
          
          // Neu-Initialisierung mit authentifiziertem User
          await achievementService.initialize();
          console.log('✅ Gamification-System erfolgreich nach Auth reinitialisiert');
        } catch (error) {
          console.error('❌ Gamification-Reload nach Auth fehlgeschlagen:', error);
          // Trotzdem weitermachen - App soll funktionieren
        }

        // Stelle sicher, dass User-Profil existiert (auch für anonyme User)
        try {
          await createUserProfile(user);
          console.log('✅ User-Profil erfolgreich erstellt/aktualisiert für:', user.uid);
        } catch (error: any) {
          if (error?.code === 'permission-denied') {
            console.error('🔥 FIREBASE RULES PROBLEM: Anonyme User können kein Profil erstellen!');
            console.error('➡️ Firebase Rules müssen aktualisiert werden (siehe firebase-rules-anonymous.json)');
          } else {
            console.error('❌ Fehler beim Erstellen des User-Profils:', error);
          }
          // Trotzdem weitermachen - User kann die App nutzen
        }
        await refreshUserProfile();
        
        // 📱 App Rating temporär deaktiviert - verursacht App-Freeze  
        try {
          console.log('📱 App Rating Login-Tracking DEAKTIVIERT (Freeze-Fix)');
          // await appRatingService.incrementLoginCount(user.uid);
        } catch (error) {
          console.error('❌ App Rating Login-Tracking Fehler:', error);
        }
        
        // Achievement-Checks für ALLE User (anonym + registriert)
        try {
          await achievementService.checkDailyStreak(user.uid);
          console.log('✅ Daily Streak gecheckt für User:', user.uid, '(anonymous:', user.isAnonymous, ')');
          
          await achievementService.checkAndUpdateLevel(user.uid);
          console.log('✅ Level gecheckt für User:', user.uid, '(anonymous:', user.isAnonymous, ')');
          
          // 🔥 Zeige Streak Toast falls aktiv (nach kurzer Verzögerung für bessere UX)
          setTimeout(() => checkStreakOnAppStart(user.uid), 1500);
        } catch (error) {
          console.warn('⚠️ Achievement-Checks fehlgeschlagen für User:', user.uid, error);
        }
        
        setLoading(false);
      } else {
        // WICHTIG: Warte 1 Sekunde bevor neue anonyme Session erstellt wird
        // Firebase braucht Zeit um persistierte Session aus AsyncStorage zu laden
        // Nur beim ERSTEN Call mit user=null, nicht bei jedem weiteren
        if (!hasInitialAuthState && !anonymousSignInTimeout) {
          console.log('⏳ Warte auf Firebase Session-Wiederherstellung (1 Sekunde)...');
          
          anonymousSignInTimeout = setTimeout(async () => {
            // Prüfe ob Component noch mounted ist
            if (!isMounted) {
              console.log('⏭️ Timeout ignored (component unmounted)');
              return;
            }
            
            // Prüfe nochmal ob inzwischen User geladen wurde
            const currentUser = auth.currentUser;
            if (!currentUser) {
              // Prüfe ob es einen Backup gibt (deutet auf verlorene Session hin)
              try {
                const backupUserId = await AsyncStorage.getItem('@auth_user_id_backup');
                const backupEmail = await AsyncStorage.getItem('@auth_user_email_backup');
                
                if (backupUserId && backupEmail && backupEmail !== 'anonymous') {
                  // User hatte eine registrierte Session - nicht überschreiben!
                  console.warn('⚠️ Registrierte Session verloren - bitte User neu anmelden lassen');
                  console.warn('   Backup User ID:', backupUserId);
                  if (isMounted) {
                    setUserProfile(null);
                    setLoading(false);
                  }
                  return;
                }
              } catch (error) {
                console.warn('⚠️ Konnte Backup nicht prüfen:', error);
              }
              
              console.log('👤 Kein User nach Wartezeit gefunden - starte anonyme Anmeldung...');
              try {
                await signInAnonymously(auth);
                console.log('✅ Neue anonyme Anmeldung erfolgreich');
                // onAuthStateChanged wird automatisch getriggert
              } catch (error) {
                console.error('❌ Anonyme Anmeldung fehlgeschlagen:', error);
                if (isMounted) {
                  setLoading(false);
                }
              }
            } else {
              console.log('✅ Firebase Session wurde während Wartezeit wiederhergestellt');
              if (isMounted) {
                setLoading(false);
              }
            }
            
            anonymousSignInTimeout = null;
          }, 1000);
        } else if (hasInitialAuthState) {
          // User war vorher da, aber jetzt nicht mehr (z.B. Logout)
          setUserProfile(null);
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      if (anonymousSignInTimeout) {
        clearTimeout(anonymousSignInTimeout);
        anonymousSignInTimeout = null;
      }
      unsubscribe();
    };
  }, [refreshUserProfile]);

  const signIn = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Sign in error:', error);
      }
      throw error;
    }
  };

  const signUp = async (email: string, password: string, displayName: string, additionalData?: AdditionalProfileData) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // Update display name in Firebase Auth
      if (userCredential.user) {
        await updateProfile(userCredential.user, {
          displayName: displayName
        });

        // Save additional profile data to Firestore
        if (additionalData) {
          const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
          const { db } = await import('../firebase');
          
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            display_name: displayName,
            real_name: additionalData.realName || '',
            email: email,
            birthDate: additionalData.birthDate || null,
            gender: additionalData.gender || '',
            location: additionalData.location || '',
            photo_url: '',
            created_time: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
            totalSavings: 0,
          }, { merge: true });
        }
      }
    } catch (error) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Sign up error:', error);
      }
      throw error;
    }
  };

  const handleSignInWithGoogle = async () => {
    try {
      await signInWithGoogle();
      // User will be automatically set via onAuthStateChanged
    } catch (error) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Google Sign-In error:', error);
      }
      throw error;
    }
  };

  const handleSignInWithApple = async () => {
    try {
      await signInWithApple();
      // User will be automatically set via onAuthStateChanged
    } catch (error) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Apple Sign-In error:', error);
      }
      throw error;
    }
  };

  const handleSignInAnonymously = async () => {
    try {
      const result = await signInAnonymously(auth);
      console.log('🔒 Anonymer Login erfolgreich:', result.user.uid);
      // User wird automatisch via onAuthStateChanged gesetzt
    } catch (error) {
      if (__DEV__) {
        console.error('Anonymous Sign-In error:', error);
      }
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Sign out from social providers if needed
      await signOutGoogle().catch(() => {}); // Ignore errors
      await signOutApple().catch(() => {}); // Ignore errors
      
      // Sign out from Firebase
      await signOut(auth);
      console.log('✅ Logout erfolgreich');
    } catch (error) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Logout error:', error);
      }
      throw error;
    }
  };

  // Development Helper: Complete Auth Reset
  const resetAuthForDevelopment = async () => {
    if (__DEV__) {
      try {
        console.log('🧹 DEV: Resetting auth completely...');
        
        // Clear Firebase Auth
        await signOut(auth);
        
        // Clear AsyncStorage
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.clear();
        
        console.log('✅ DEV: Auth reset complete');
      } catch (error) {
        console.error('❌ DEV: Reset auth error:', error);
      }
    }
  };



  // Lazy-fill of guessedCity / guessedBundesland from journey history
  // — runs once per user when both fields are still empty. Sits as
  // a separate effect on (uid, profile-region) so it doesn't fire
  // until the profile load has resolved. The actual work is
  // deferred via InteractionManager so it never blocks the main
  // render.
  useEffect(() => {
    if (!user?.uid || !userProfile) return;
    if (userProfile.city || userProfile.guessedCity) return;
    const handle = scheduleRegionGuess(
      user.uid,
      { city: userProfile.city, guessedCity: userProfile.guessedCity },
      () => refreshUserProfile(),
    );
    return () => {
      try {
        handle.cancel?.();
      } catch {}
    };
  }, [user?.uid, userProfile?.city, userProfile?.guessedCity, refreshUserProfile]);

  const value = {
    user,
    userProfile,
    loading,
    isAnonymous,
    signIn,
    signUp,
    signInWithGoogle: handleSignInWithGoogle,
    signInWithApple: handleSignInWithApple,
    signInAnonymously: handleSignInAnonymously,
    logout,
    isAppleAuthAvailable,
    refreshUserProfile,
    ...__DEV__ && { resetAuthForDevelopment }
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
