import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile, User } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { auth } from '../firebase';
import achievementService, { setProfileRefreshCallback } from '../services/achievementService';
import { isAppleAuthAvailable, signInWithApple, signOutApple } from '../services/auth/appleAuth';
import { signInWithGoogle, signOutGoogle } from '../services/auth/googleAuth';
import { getUserProfile, updateUserProfile, UserProfile } from '../services/userProfile';

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
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string, additionalData?: AdditionalProfileData) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
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

  const refreshUserProfile = useCallback(async () => {
    if (user) {
      const profile = await getUserProfile(user.uid);
      setUserProfile(profile);
      console.log('🔄 AuthContext: User profile refreshed');
    }
  }, [user]);

  useEffect(() => {
    // Registriere Profile-Refresh-Callback für Achievement-System
    setProfileRefreshCallback(refreshUserProfile);
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      
      if (user) {
        // Lade das bestehende User-Profil aus Firestore
        const profile = await getUserProfile(user.uid);
        setUserProfile(profile);
        
        // Update last login
        await updateUserProfile(user);
        
        // Check Daily Streak für Achievement-System
        try {
          await achievementService.checkDailyStreak(user.uid);
          console.log('✅ Daily Streak gecheckt beim App-Start');
          
          // Check und korrigiere Level beim App-Start
          await achievementService.checkAndUpdateLevel(user.uid);
          console.log('✅ Level-Check durchgeführt beim App-Start');
        } catch (error) {
          console.error('Fehler beim Daily Streak Check:', error);
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

  const logout = async () => {
    try {
      // Sign out from social providers if needed
      await signOutGoogle().catch(() => {}); // Ignore errors
      await signOutApple().catch(() => {}); // Ignore errors
      
      // Sign out from Firebase
      await signOut(auth);
    } catch (error) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Logout error:', error);
      }
      throw error;
    }
  };



  const value = {
    user,
    userProfile,
    loading,
    signIn,
    signUp,
    signInWithGoogle: handleSignInWithGoogle,
    signInWithApple: handleSignInWithApple,
    logout,
    isAppleAuthAvailable,
    refreshUserProfile
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
