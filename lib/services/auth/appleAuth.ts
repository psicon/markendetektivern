import { Platform } from 'react-native';

// WICHTIG: Apple Sign-In funktioniert nur mit Development Build
// Für Expo Go müssen wir temporär deaktivieren


/**
 * Check if Apple Sign-In is available
 * HINWEIS: Für Expo Go ist diese Funktion temporär deaktiviert
 */
export const isAppleAuthAvailable = async (): Promise<boolean> => {
  try {
    if (Platform.OS !== 'ios') {
      console.log('📱 Apple Auth: Nur iOS unterstützt');
      return false;
    }

    // Check if native module is available
    const { NativeModules } = require('react-native');
    if (!NativeModules.RNAppleAuthentication) {
      console.log('📱 Apple Auth Module nicht verfügbar (Expo Go oder nicht konfiguriert)');
      return false;
    }

    const { appleAuth } = require('@invertase/react-native-apple-authentication');
    const isSupported = await appleAuth.isSupported();
    console.log(`🍎 Apple Auth Support Status: ${isSupported}`);
    return isSupported;
  } catch (error: any) {
    console.log('📱 Apple Auth Fehler:', error.message);
    return false;
  }
};

/**
 * Sign in with Apple
 * HINWEIS: Für Expo Go ist diese Funktion temporär deaktiviert
 */
export const signInWithApple = async () => {
  try {
    if (Platform.OS !== 'ios') {
      throw new Error('Apple Sign-In ist nur auf iOS verfügbar');
    }

    // Check if native module is available
    const { NativeModules } = require('react-native');
    if (!NativeModules.RNAppleAuthentication) {
      throw new Error('Apple Sign-In ist nur in Production Builds verfügbar. Bitte Email/Password Login verwenden.');
    }

    const { appleAuth } = require('@invertase/react-native-apple-authentication');
    const { OAuthProvider, signInWithCredential } = require('firebase/auth');
    const { auth } = require('../../firebase');
    
    const appleAuthRequestResponse = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [
        appleAuth.Scope.EMAIL,
        appleAuth.Scope.FULL_NAME,
      ],
    });

    const { identityToken, nonce } = appleAuthRequestResponse;
    
    if (!identityToken) {
      throw new Error('Apple Sign-In failed - no identity token');
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: identityToken,
      rawNonce: nonce,
    });

    const userCredential = await signInWithCredential(auth, credential);
    console.log('✅ Apple Sign-In successful:', userCredential.user.email);
    return userCredential;
  } catch (error: any) {
    console.error('❌ Apple Sign-In error:', error);
    throw error;
  }
};

/**
 * Sign out from Apple (clears credentials)
 * Note: Apple doesn't have a traditional sign-out, this just clears local state
 */
export const signOutApple = async () => {
  // Apple doesn't provide a sign-out method
  // The user remains signed in with their Apple ID
  // We just sign out from Firebase
  console.log('✅ Apple Sign-Out (Firebase only)');
};

/**
 * Get credential state for Apple Sign-In
 */
export const getAppleCredentialState = async (user: string) => {
  // Temporär deaktiviert für Expo Go
  return 'unknown';
};

/**
 * Listen to Apple credential revoked events
 */
export const onAppleCredentialRevoked = (callback: () => void) => {
  // Temporär deaktiviert für Expo Go
  return () => {};
};

// Export AppleButton component for UI (temporär deaktiviert)
// export { AppleButton } from '@invertase/react-native-apple-authentication';
