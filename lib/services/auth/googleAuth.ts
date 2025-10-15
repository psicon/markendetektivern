// WICHTIG: Google Sign-In mit nativen Modulen funktioniert nur mit Development Build
// Für Expo Go müssen wir Web-basierte Auth verwenden oder expo-auth-session

import { Platform } from 'react-native';

// Temporäre Lösung für Expo Go - wird später durch native Module ersetzt
const isExpoGo = () => {
  // Check if running in Expo Go
  return !!(global as any).expo;
};

let isGoogleSignInConfigured = false;

/**
 * Configure Google Sign-In (should be called early in app lifecycle)
 */
export const configureGoogleSignIn = async () => {
  try {
    if (isGoogleSignInConfigured) {
      return; // Already configured
    }

    const { NativeModules } = require('react-native');
    if (!NativeModules.RNGoogleSignin) {
      console.log('Google Sign-In native module not available');
      return;
    }

    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    
    GoogleSignin.configure({
      // WICHTIG: Web Client ID für ID Token!
      webClientId: '139509881339-8r18hd499h6615f4ebos35ihbqqqvjvs.apps.googleusercontent.com',
      // Android OAuth 2.0 Client
      androidClientId: '139509881339-h8ief6hmf22i77k4bcb6h4psilqna86v.apps.googleusercontent.com',
      iosClientId: '139509881339-8m7rjqtur27arme7utiuptqmjbllofbu.apps.googleusercontent.com',
      offlineAccess: true,
      forceCodeForRefreshToken: true,
      scopes: ['profile', 'email'],
      // Android-spezifische Optionen
      ...(Platform.OS === 'android' && {
        hostedDomain: '',
        forceAccountSelection: true,
      })
    });
    
    isGoogleSignInConfigured = true;
    console.log('✅ Google Sign-In configured successfully');
  } catch (error) {
    console.error('❌ Google Sign-In configuration error:', error);
  }
};

/**
 * Sign in with Google
 * HINWEIS: Für Expo Go ist diese Funktion temporär deaktiviert
 * Für Production Build mit nativen Modulen aktivieren
 */
export const signInWithGoogle = async () => {
  try {
    // Check if native module is available
    const { NativeModules } = require('react-native');
    if (!NativeModules.RNGoogleSignin) {
      throw new Error('Google Sign-In ist nur in Production Builds verfügbar. Bitte Email/Password Login verwenden.');
    }

    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    const { GoogleAuthProvider, signInWithCredential } = require('firebase/auth');
    const { auth } = require('../../firebase');
    
    // Ensure configuration
    if (!isGoogleSignInConfigured) {
      await configureGoogleSignIn();
    }
    
    // Check Play Services on Android
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    
    // Android: Stelle sicher, dass Account-Auswahl angezeigt wird
    if (Platform.OS === 'android') {
      try {
        await GoogleSignin.signOut(); // Logout vorher um Account-Auswahl zu erzwingen
      } catch (e) {
        // Ignore - user might not be signed in
      }
    }
    
    const response = await GoogleSignin.signIn();
    
    // WICHTIG: Die Response-Struktur kann variieren!
    const userInfo = response.data || response;
    
    console.log('🔍 Google Sign-In Response:', {
      hasResponse: !!response,
      responseType: response?.type,
      hasData: !!response?.data,
      hasUserInfo: !!userInfo,
      hasIdToken: !!userInfo?.idToken,
      hasUser: !!userInfo?.user,
      userEmail: userInfo?.user?.email,
      userId: userInfo?.user?.id,
      serverAuthCode: !!userInfo?.serverAuthCode,
      scopes: userInfo?.scopes,
      rawResponse: JSON.stringify(response)
    });
    
    // WICHTIG: Bei Android kann idToken manchmal in serverAuthCode sein
    let idToken = userInfo.idToken || userInfo?.idToken;
    
    if (!idToken && userInfo.serverAuthCode) {
      console.log('⚠️ Trying serverAuthCode as fallback for idToken');
      idToken = userInfo.serverAuthCode;
    }
    
    if (!idToken) {
      // Detaillierte Fehleranalyse
      console.error('❌ No ID token in response. Full userInfo:', {
        user: userInfo?.user,
        idToken: userInfo?.idToken,
        serverAuthCode: userInfo?.serverAuthCode,
        scopes: userInfo?.scopes,
        fullObject: userInfo
      });
      
      // Prüfe ob wir überhaupt einen User haben
      if (!userInfo?.user?.email) {
        throw new Error('Google Sign-In fehlgeschlagen: Keine Benutzerdaten erhalten. Bitte stelle sicher, dass du einen Google Account ausgewählt hast.');
      }
      
      throw new Error('Google Sign-In Konfigurationsfehler: Kein ID Token erhalten. Bitte kontaktiere den Support.');
    }
    
    const googleCredential = GoogleAuthProvider.credential(idToken);
    const userCredential = await signInWithCredential(auth, googleCredential);
    
    console.log('✅ Google Sign-In successful:', userCredential.user.email);
    return userCredential;
  } catch (error: any) {
    console.error('❌ Google Sign-In error:', error);
    
    // Better error messages for common issues
    if (error.code === 'SIGN_IN_CANCELLED') {
      throw new Error('Anmeldung abgebrochen');
    } else if (error.code === 'IN_PROGRESS') {
      throw new Error('Anmeldung läuft bereits');
    } else if (error.code === 'PLAY_SERVICES_NOT_AVAILABLE') {
      throw new Error('Google Play Services nicht verfügbar');
    }
    
    throw error;
  }
};

/**
 * Sign out from Google
 */
export const signOutGoogle = async () => {
  try {
    const { NativeModules } = require('react-native');
    if (!NativeModules.RNGoogleSignin) {
      console.log('📱 Google Sign-Out skipped (Expo Go)');
      return;
    }

    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
    console.log('✅ Google Sign-Out successful');
  } catch (error) {
    console.error('❌ Google Sign-Out error:', error);
  }
};

/**
 * Check if user is signed in with Google
 */
export const isGoogleSignedIn = async (): Promise<boolean> => {
  try {
    const { NativeModules } = require('react-native');
    if (!NativeModules.RNGoogleSignin) {
      return false; // Not available in Expo Go
    }

    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    return await GoogleSignin.isSignedIn();
  } catch (error) {
    console.error('❌ Google Sign-In check error:', error);
    return false;
  }
};

/**
 * Get current Google user
 */
export const getCurrentGoogleUser = async () => {
  try {
    const { NativeModules } = require('react-native');
    if (!NativeModules.RNGoogleSignin) {
      return null; // Not available in Expo Go
    }

    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    return await GoogleSignin.getCurrentUser();
  } catch (error) {
    console.error('❌ Get Google user error:', error);
    return null;
  }
};
