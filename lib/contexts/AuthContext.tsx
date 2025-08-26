import { createUserWithEmailAndPassword, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut, updateProfile, User } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth } from '../firebase';
import achievementService, { setProfileRefreshCallback } from '../services/achievementService';
import { isAppleAuthAvailable, signInWithApple, signOutApple } from '../services/auth/appleAuth';
import { signInWithGoogle, signOutGoogle } from '../services/auth/googleAuth';
import { createUserProfile, getUserProfile, UserProfile } from '../services/userProfile';

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
            level: 1,
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
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('🔄 AuthContext: Auth state changed:', user ? `User: ${user.uid} (anonymous: ${user.isAnonymous})` : 'No user');
      setUser(user);
      setIsAnonymous(user?.isAnonymous || false);
      
      if (user?.uid) {
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
        
        // Achievement-Checks für ALLE User (anonym + registriert)
        try {
          await achievementService.checkDailyStreak(user.uid);
          console.log('✅ Daily Streak gecheckt für User:', user.uid, '(anonymous:', user.isAnonymous, ')');
          
          await achievementService.checkAndUpdateLevel(user.uid);
          console.log('✅ Level gecheckt für User:', user.uid, '(anonymous:', user.isAnonymous, ')');
        } catch (error) {
          console.warn('⚠️ Achievement-Checks fehlgeschlagen für User:', user.uid, error);
        }
      } else {
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
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
