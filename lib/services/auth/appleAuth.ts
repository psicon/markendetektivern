// WICHTIG: Apple Sign-In funktioniert nur mit Development Build
// Für Expo Go müssen wir temporär deaktivieren


/**
 * Check if Apple Sign-In is available
 * HINWEIS: Für Expo Go ist diese Funktion temporär deaktiviert
 */
export const isAppleAuthAvailable = async (): Promise<boolean> => {
  // Temporär deaktiviert für Expo Go
  return false;
  
  // TODO: Nach Development Build aktivieren:
  // if (Platform.OS !== 'ios') {
  //   return false;
  // }
  // const { appleAuth } = require('@invertase/react-native-apple-authentication');
  // return await appleAuth.isSupported();
};

/**
 * Sign in with Apple
 * HINWEIS: Für Expo Go ist diese Funktion temporär deaktiviert
 */
export const signInWithApple = async () => {
  // Temporär deaktiviert für Expo Go
  throw new Error('Apple Sign-In ist nur mit Development Build verfügbar. Bitte Email/Password Login verwenden.');
  
  // TODO: Nach Development Build aktivieren:
  // try {
  //   const { appleAuth } = require('@invertase/react-native-apple-authentication');
  //   
  //   const appleAuthRequestResponse = await appleAuth.performRequest({
  //     requestedOperation: appleAuth.Operation.LOGIN,
  //     requestedScopes: [
  //       appleAuth.Scope.EMAIL,
  //       appleAuth.Scope.FULL_NAME,
  //     ],
  //   });

  //   // Rest des Codes nach Development Build...
  // } catch (error: any) {
  //   console.error('❌ Apple Sign-In error:', error);
  //   throw error;
  // }
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
