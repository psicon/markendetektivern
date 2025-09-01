// WICHTIG: Google Sign-In mit nativen Modulen funktioniert nur mit Development Build
// Für Expo Go müssen wir Web-basierte Auth verwenden oder expo-auth-session


// Temporäre Lösung für Expo Go - wird später durch native Module ersetzt
const isExpoGo = () => {
  // Check if running in Expo Go
  return !!(global as any).expo;
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
    
    GoogleSignin.configure({
      webClientId: '139509881339-8r18hd499h6615f4ebos35ihbqqqvjvs.apps.googleusercontent.com',
    });
    
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    const googleCredential = GoogleAuthProvider.credential(userInfo.idToken);
    const userCredential = await signInWithCredential(auth, googleCredential);
    
    console.log('✅ Google Sign-In successful:', userCredential.user.email);
    return userCredential;
  } catch (error: any) {
    console.error('❌ Google Sign-In error:', error);
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
