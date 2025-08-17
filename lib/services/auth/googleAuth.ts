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
  // Temporär deaktiviert für Expo Go
  throw new Error('Google Sign-In ist nur mit Development Build verfügbar. Bitte Email/Password Login verwenden.');
  
  // TODO: Nach Development Build aktivieren:
  // try {
  //   const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  //   
  //   GoogleSignin.configure({
  //     webClientId: '139509881339-8r18hd499h6615f4ebos35ihbqqqvjvs.apps.googleusercontent.com',
  //   });
  //   
  //   await GoogleSignin.hasPlayServices();
  //   const userInfo = await GoogleSignin.signIn();
  //   const googleCredential = GoogleAuthProvider.credential(userInfo.idToken);
  //   const userCredential = await signInWithCredential(auth, googleCredential);
  //   
  //   console.log('✅ Google Sign-In successful:', userCredential.user.email);
  //   return userCredential;
  // } catch (error: any) {
  //   console.error('❌ Google Sign-In error:', error);
  //   throw error;
  // }
};

/**
 * Sign out from Google
 */
export const signOutGoogle = async () => {
  // Temporär deaktiviert für Expo Go
  console.log('Google Sign-Out skipped (Expo Go)');
};

/**
 * Check if user is signed in with Google
 */
export const isGoogleSignedIn = async (): Promise<boolean> => {
  // Temporär deaktiviert für Expo Go
  return false;
};

/**
 * Get current Google user
 */
export const getCurrentGoogleUser = async () => {
  // Temporär deaktiviert für Expo Go
  return null;
};
