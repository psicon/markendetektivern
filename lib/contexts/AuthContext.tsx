import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  FirebaseAuthTypes,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from '@react-native-firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, InteractionManager } from 'react-native';
import { PERF } from '../perfFlags';
import { auth } from '../firebase';
import achievementService, { setProfileRefreshCallback } from '../services/achievementService';
import {
  buildAppleDisplayName,
  getAppleCredential,
  isAppleAuthAvailable,
  signOutApple,
} from '../services/auth/appleAuth';
import {
  getGoogleCredential,
  signOutGoogle,
} from '../services/auth/googleAuth';
import {
  getFacebookCredential,
  signOutFacebook,
} from '../services/auth/facebookAuth';
import { createUserProfile, getUserProfile, UserProfile } from '../services/userProfile';
import { scheduleRegionGuess } from '../services/regionGuess';
import { FirestoreService } from '../services/firestore';
import { doc, setDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';

interface AdditionalProfileData {
  realName?: string;
  // T12.4: birthDate → age (Integer-Slider). Caller schickt die
  // Zahl, AuthContext speichert age + ageBucket + ageReportedAt +
  // ageReportedYear ans User-Doc.
  age?: number;
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
  signInWithFacebook: () => Promise<void>;
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
    // Phase 0 B: Deps sind string/boolean primitives statt das ganze
    // user-Object. Vorher: `[user]` → callback-identity wechselt
    // bei JEDER user-Object-Mutation → AuthContext memo invalidates
    // → komplette useAuth()-Consumer-Cascade rerendert.
    // Jetzt: nur bei tatsächlichem uid- oder anonymous-Wechsel.
    // user.uid und user.isAnonymous innerhalb des Callbacks bleiben
    // funktional unverändert (closure capturet aktuelle Werte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.isAnonymous]);

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

  // ─── Anon-Linking helpers ───────────────────────────────────────────
  //
  // Wenn der aktuelle User anonym ist und sich später mit einem
  // Provider (Apple/Google/Email) anmeldet, MÜSSEN wir
  // linkWithCredential nehmen statt signInWithCredential — sonst
  // entsteht ein neuer Account und alle Daten der anonymen Session
  // (Favoriten, Punkte, Käufe, Onboarding-Antworten) gehen verloren.
  //
  // Edge-case: Provider-Account gehört bereits einer anderen UID
  // (User hat sich z.B. früher mal angemeldet, dann Anon-Session auf
  // dem gleichen Device gestartet). Firebase wirft dann
  // `auth/credential-already-in-use`. Wir fragen den User per
  // Confirm-Dialog ob er zum bestehenden Account wechseln will
  // (Daten-Verlust akzeptiert) — falls ja, fallback auf normalen
  // signInWithCredential. Falls nein, Anmeldung abbrechen.

  /**
   * Show a destructive confirm-Dialog wenn die Anon-Daten gegen
   * einen existierenden Provider-Account getauscht würden.
   * Returns true wenn der User wechseln will, false sonst.
   */
  const confirmAccountSwitch = (): Promise<boolean> => {
    return new Promise((resolve) => {
      Alert.alert(
        'Du hast bereits ein Konto',
        'Mit diesem Konto bist du anderswo schon angemeldet. Wenn du wechselst, ' +
          'gehen die Daten der aktuellen anonymen Sitzung verloren ' +
          '(z.B. Favoriten, Punkte, Käufe, Einkaufszettel).\n\nMöchtest du wechseln?',
        [
          { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
          {
            text: 'Konto wechseln',
            style: 'destructive',
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  };

  /**
   * Zentrale Auth-Logik: bei anonymem User → linkWithCredential
   * (UID + Daten bleiben), sonst signInWithCredential (normaler
   * Login). Bei `credential-already-in-use` wird der User gefragt
   * ob er zum bestehenden Account wechseln will.
   */
  const linkOrSignIn = async (
    credential: FirebaseAuthTypes.AuthCredential,
  ): Promise<FirebaseAuthTypes.UserCredential> => {
    const currentUser = auth.currentUser;
    if (currentUser?.isAnonymous) {
      try {
        return await linkWithCredential(currentUser, credential);
      } catch (e: any) {
        if (e?.code === 'auth/credential-already-in-use') {
          const confirmed = await confirmAccountSwitch();
          if (!confirmed) {
            const err: any = new Error('Anmeldung abgebrochen');
            err.code = 'auth/cancelled';
            throw err;
          }
          // Fallback: drop anon, sign in with the existing account.
          return await signInWithCredential(auth, credential);
        }
        throw e;
      }
    }
    return await signInWithCredential(auth, credential);
  };

  const signIn = async (email: string, password: string) => {
    try {
      // Login = "I HAVE this account, log me in". Das ist NICHT
      // dasselbe wie linkWithCredential — letzteres würde einen
      // NEUEN Email-Password-Identity am bestehenden Anon-User
      // anhängen, statt zum existierenden Account zu wechseln.
      //
      // Korrektes Verhalten bei Anon-User der sich auf ein
      // existierendes Konto einloggen will: warnen dass die
      // Anon-Daten verloren gehen, dann signInWithEmailAndPassword.
      const currentUser = auth.currentUser;
      if (currentUser?.isAnonymous) {
        const confirmed = await confirmAccountSwitch();
        if (!confirmed) {
          const err: any = new Error('Anmeldung abgebrochen');
          err.code = 'auth/cancelled';
          throw err;
        }
      }
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      if (__DEV__) {
        console.error('Sign in error:', error);
      }
      throw error;
    }
  };

  const signUp = async (
    email: string,
    password: string,
    displayName: string,
    additionalData?: AdditionalProfileData,
  ) => {
    try {
      const currentUser = auth.currentUser;
      let userCredential: FirebaseAuthTypes.UserCredential;

      if (currentUser?.isAnonymous) {
        // Anon → upgrade zu Email/Password-Account, UID + Daten
        // bleiben erhalten.
        const credential = EmailAuthProvider.credential(email, password);
        try {
          userCredential = await linkWithCredential(currentUser, credential);
        } catch (e: any) {
          if (e?.code === 'auth/email-already-in-use') {
            // Email gehört schon einem anderen Account → User hat zwei
            // Optionen: bestehenden Account einloggen (Daten weg) oder
            // andere Email nehmen.
            const confirmed = await confirmAccountSwitch();
            if (!confirmed) {
              const err: any = new Error('Registrierung abgebrochen');
              err.code = 'auth/cancelled';
              throw err;
            }
            userCredential = await signInWithEmailAndPassword(auth, email, password);
          } else {
            throw e;
          }
        }
      } else {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
      }

      // DisplayName + zusätzliche Profil-Daten setzen.
      if (userCredential.user) {
        await updateProfile(userCredential.user, { displayName });

        if (additionalData) {
          const { serverTimestamp } = await import('@react-native-firebase/firestore');
          // T12.4: age + Capture-Timestamps statt birthDate.
          // ageReportedAt/ageReportedYear nur setzen wenn age tatsächlich
          // übergeben wurde — sonst bleibt das Feld leer und kann später
          // im Profile-Editor nachgepflegt werden.
          const { ageBucketFromAge } = await import('@/lib/utils/age');
          const agePatch = typeof additionalData.age === 'number'
            ? {
                age: additionalData.age,
                ageBucket: ageBucketFromAge(additionalData.age),
                ageReportedAt: serverTimestamp(),
                ageReportedYear: new Date().getFullYear(),
              }
            : {};
          await setDoc(
            doc(db, 'users', userCredential.user.uid),
            {
              display_name: displayName,
              real_name: additionalData.realName || '',
              email,
              ...agePatch,
              gender: additionalData.gender || '',
              location: additionalData.location || '',
              photo_url: '',
              // created_time NICHT überschreiben wenn der User vorher
              // anonym war — der existiert dann schon mit serverTimestamp
              // aus der Anon-Phase. Beim merge:true ohne created_time
              // bleibt der bestehende Wert erhalten.
              ...(currentUser?.isAnonymous ? {} : { created_time: serverTimestamp() }),
              lastLoginAt: serverTimestamp(),
              totalSavings: 0,
            },
            { merge: true },
          );
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Sign up error:', error);
      }
      throw error;
    }
  };

  const handleSignInWithGoogle = async () => {
    try {
      const credential = await getGoogleCredential();
      if (!credential) {
        // User hat das Google-Sheet abgebrochen. Kein Fehler.
        return;
      }
      const userCredential = await linkOrSignIn(credential);
      console.log(
        '✅ Google Sign-In:',
        userCredential.user.email,
        userCredential.additionalUserInfo?.isNewUser ? '(neu)' : '(bestehend)',
      );
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return; // User cancel = kein Fehler
      if (__DEV__) {
        console.error('Google Sign-In error:', error);
      }
      throw error;
    }
  };

  const handleSignInWithApple = async () => {
    try {
      const bundle = await getAppleCredential();
      if (!bundle) {
        // User hat die Apple-Sheet abgebrochen.
        return;
      }
      const userCredential = await linkOrSignIn(bundle.credential);

      // Apple gibt fullName + email NUR beim aller-ersten Sign-In durch.
      // Wenn das ein neuer User ist (oder das Anon-Linking gerade
      // erstellt einen "neuen" Provider-User), legen wir das
      // Firestore-Profil mit den Apple-Daten an.
      const isNewUser = userCredential.additionalUserInfo?.isNewUser;
      if (isNewUser && userCredential.user) {
        const displayName = buildAppleDisplayName(bundle.fullName);
        await createUserProfile(userCredential.user, {
          realName: displayName,
          email: bundle.email || userCredential.user.email || '',
        });
        console.log(`✅ Apple Sign-In: NEUER USER → Profil angelegt (${userCredential.user.email})`);
      } else {
        console.log('✅ Apple Sign-In: bestehender User');
      }
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      if (__DEV__) {
        console.error('Apple Sign-In error:', error);
      }
      throw error;
    }
  };

  const handleSignInWithFacebook = async () => {
    try {
      const bundle = await getFacebookCredential();
      if (!bundle) {
        // User hat das Facebook-Sheet abgebrochen.
        return;
      }
      const userCredential = await linkOrSignIn(bundle.credential);

      // Facebook liefert beim ersten Sign-In email + displayName + photoURL
      // (best-effort, je nach User-Permission). Bei neuem User legen wir
      // direkt das Firestore-Profil an — spiegelbildlich zum Apple-Pfad.
      const isNewUser = userCredential.additionalUserInfo?.isNewUser;
      if (isNewUser && userCredential.user) {
        await createUserProfile(userCredential.user, {
          realName: bundle.displayName || userCredential.user.displayName || 'Facebook User',
          email: bundle.email || userCredential.user.email || '',
        });
        console.log(`✅ Facebook Sign-In: NEUER USER → Profil angelegt (${userCredential.user.email})`);
      } else {
        console.log('✅ Facebook Sign-In: bestehender User');
      }
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return;
      if (__DEV__) {
        // T17.2: FB_SDK_UNAVAILABLE (Sim/Expo Go ohne Native-Modul)
        // ist ein erwarteter Fall — als warn loggen statt error
        // damit das rote Dev-Overlay nicht aufpoppt.
        if (error?.code === 'auth/facebook-sdk-unavailable') {
          console.warn('Facebook Sign-In skipped (SDK unavailable on this build):', error?.message);
        } else {
          console.error('Facebook Sign-In error:', error);
        }
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
      await signOutFacebook().catch(() => {}); // Ignore errors

      // 🧹 Clear the AsyncStorage auth backup BEFORE signing out.
      // This backup is meant to detect "Firebase session
      // unexpectedly lost" on app boot — it makes the app refuse
      // to auto-anonymous-login because we assume the user wants
      // their registered identity back. After an EXPLICIT logout
      // that's the wrong assumption: the user wants to be
      // logged out, anonymous mode is fine. Without this clear,
      // the next app boot sees the backup, refuses to auto-anon,
      // and traps the user on a blank screen forever.
      try {
        await AsyncStorage.removeItem('@auth_user_id_backup');
        await AsyncStorage.removeItem('@auth_user_email_backup');
        await AsyncStorage.removeItem('@auth_last_login');
      } catch (clearErr) {
        console.warn('⚠️ Could not clear auth backup on logout:', clearErr);
      }

      // Sign out from Firebase
      await signOut(auth);
      console.log('✅ Logout erfolgreich');

      // 🔁 Re-establish an anonymous session immediately. Without
      // this the tab layout sees `!user` and renders a blank
      // screen (auto-anonymous-login only fires on first mount,
      // not on a subsequent sign-out — see `hasInitialAuthState`
      // gate in the onAuthStateChanged effect). Re-signing in
      // here makes the app usable again right after logout: the
      // user is back to anonymous mode, the listener fires and
      // refreshes user/profile state across the tree.
      try {
        await signInAnonymously(auth);
        console.log('✅ Re-signed-in as anonymous after logout');
      } catch (anonErr) {
        console.warn('⚠️ Anonymous re-sign-in failed after logout:', anonErr);
        // Non-fatal: the user is still logged out, just stuck.
        // Caller (profile.tsx) navigates to home anyway, and the
        // tab layout's redirect-to-welcome guard kicks in.
      }
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

  // FCM token registration for cashback push notifications.
  // Lazy-imports the messaging module so the dev-client doesn't crash
  // when the native module hasn't been linked yet.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { registerFcmTokenForUser } = await import('@/lib/services/fcmTokenService');
        const teardown = await registerFcmTokenForUser(uid);
        if (cancelled) {
          teardown();
        } else {
          unsub = teardown;
        }
      } catch (e: any) {
        // Non-fatal — push is a nice-to-have, app works without.
        console.log('[fcm] register skipped:', e?.message);
      }
    })();
    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch {}
    };
  }, [user?.uid]);

  // Self-healing Backfill für `favoriteMarketName`.
  //
  // Bestands-User die das Onboarding VOR dem Mirror-Fix abgeschlossen
  // haben, haben nur `favoriteMarket` (die ID) gesetzt — ohne den
  // dazugehörigen Namen-String. Folge: ihre Profil-Stat-Card "Dein
  // Lieblingsmarkt" rendert nichts, weil sie direkt den Namen liest
  // (siehe profile.tsx:160).
  //
  // Dieser Effekt heilt das einmal pro betroffenem User: wenn die ID
  // da ist aber der Name fehlt, lädt er den Discounter-Doc nach und
  // schreibt das Name-Feld auf das User-Doc. Danach feuert die
  // Bedingung nie wieder (Name ist gesetzt → early return). Cost: 1
  // Read + 1 Write pro Bestands-User, einmalig in der Lebensdauer.
  //
  // Pattern parallel zum guessedCity-Backfill darüber: defer via
  // InteractionManager damit's nicht den App-Start blockiert, alles
  // in try/catch damit ein Fehler die Auth-Pipeline nicht stört.
  useEffect(() => {
    if (!user?.uid || !userProfile) return;
    const uid = user.uid;
    const favId = (userProfile as any).favoriteMarket as string | undefined;
    const favName = (userProfile as any).favoriteMarketName as string | undefined;
    // Nichts zu tun wenn keine ID oder Name schon vorhanden.
    if (!favId) return;
    if (favName && favName.length > 0) return;

    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        if (cancelled) return;
        const market = await FirestoreService.getDiscounterById(favId);
        if (cancelled) return;
        const name = (market as any)?.name as string | undefined;
        if (!name) return;
        await setDoc(
          doc(db, 'users', uid),
          { favoriteMarketName: name },
          { merge: true },
        );
        if (cancelled) return;
        // Profile neu laden, damit das Profil-Stat-Card sofort
        // den Lieblingsmarkt anzeigt — ohne App-Restart.
        await refreshUserProfile();
        console.log('✅ Lieblingsmarkt-Name nachgetragen für Bestands-User:', uid);
      } catch (e) {
        console.warn('⚠️ favoriteMarketName-Backfill fehlgeschlagen (non-fatal):', e);
      }
    });
    return () => {
      cancelled = true;
      try {
        handle.cancel?.();
      } catch {}
    };
  }, [user?.uid, userProfile, refreshUserProfile]);

  // Fix A — Mit `PERF.memoAuthValue=true`: memoized value-Object,
  // damit Consumer (alle `useAuth()`-Aufrufer = halbe App) nicht
  // bei jedem unrelated Re-Render des AuthProviders mit-rendern.
  // Ohne Memo: jeder Render erzeugt neues Object → React vergleicht
  // per ===, sieht "neu", rendert alle Consumer durch.
  // Rollback: PERF.memoAuthValue = false → fällt zurück auf
  // referenz-instabiles Object (Original-Verhalten).
  const valueMemo = useMemo(
    () => ({
      user,
      userProfile,
      loading,
      isAnonymous,
      signIn,
      signUp,
      signInWithGoogle: handleSignInWithGoogle,
      signInWithApple: handleSignInWithApple,
      signInWithFacebook: handleSignInWithFacebook,
      signInAnonymously: handleSignInAnonymously,
      logout,
      isAppleAuthAvailable,
      refreshUserProfile,
      ...__DEV__ && { resetAuthForDevelopment },
    }),
    [
      user,
      userProfile,
      loading,
      isAnonymous,
      signIn,
      signUp,
      handleSignInWithGoogle,
      handleSignInWithApple,
      handleSignInWithFacebook,
      handleSignInAnonymously,
      logout,
      refreshUserProfile,
    ],
  );
  const value = PERF.memoAuthValue
    ? valueMemo
    : {
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
        ...(__DEV__ && { resetAuthForDevelopment }),
      };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
