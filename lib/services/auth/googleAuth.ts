// Google Sign-In via @react-native-google-signin/google-signin (native module).
//
// Diese Datei holt nur die Credentials von Google's nativem Sign-In —
// das eigentliche Firebase-Sign-In bzw. Anon-Linking macht der
// AuthContext (siehe linkOrSignIn dort). Sauber getrennt:
//   • Service:  "get me a Firebase AuthCredential from Google"
//   • Context:  "decide ob link oder sign-in"

import auth, {
  FirebaseAuthTypes,
  GoogleAuthProvider,
} from '@react-native-firebase/auth';
import { NativeModules, Platform } from 'react-native';

let isGoogleSignInConfigured = false;

/**
 * Configure Google Sign-In (should be called early in app lifecycle).
 * Idempotent — kann mehrfach aufgerufen werden, läuft nur einmal durch.
 */
export const configureGoogleSignIn = async () => {
  try {
    if (isGoogleSignInConfigured) return;
    if (!NativeModules.RNGoogleSignin) {
      console.log('Google Sign-In native module not available');
      return;
    }

    const { GoogleSignin } = require('@react-native-google-signin/google-signin');

    GoogleSignin.configure({
      // WICHTIG: Web Client ID für ID Token — nicht Plattform-spezifische ID hier!
      webClientId: '139509881339-8r18hd499h6615f4ebos35ihbqqqvjvs.apps.googleusercontent.com',
      androidClientId: '139509881339-h8ief6hmf22i77k4bcb6h4psilqna86v.apps.googleusercontent.com',
      iosClientId: '139509881339-8m7rjqtur27arme7utiuptqmjbllofbu.apps.googleusercontent.com',
      offlineAccess: true,
      forceCodeForRefreshToken: true,
      scopes: ['profile', 'email'],
      ...(Platform.OS === 'android' && {
        hostedDomain: '',
        forceAccountSelection: true,
      }),
    });

    isGoogleSignInConfigured = true;
    console.log('✅ Google Sign-In configured');
  } catch (error) {
    console.error('❌ Google Sign-In configuration error:', error);
  }
};

/**
 * Hole eine Firebase AuthCredential von Google (via native Sign-In).
 *
 * Ruft die native Google-Sign-In-Sheet auf, parst den idToken aus dem
 * Response und baut die Firebase-Credential. Macht KEINEN
 * Firebase-Sign-In — das macht der AuthContext basierend auf
 * Anon-State.
 *
 * Returns:
 *   - AuthCredential bei Success
 *   - null wenn User die Sheet abgebrochen hat
 *
 * Wirft:
 *   - Error wenn native Module fehlt (Expo Go) oder Konfig kaputt
 *   - Error wenn idToken nicht erhalten wurde (Konfig-Mismatch)
 */
export const getGoogleCredential = async (): Promise<FirebaseAuthTypes.AuthCredential | null> => {
  if (!NativeModules.RNGoogleSignin) {
    throw new Error(
      'Google Sign-In ist nur in Production Builds verfügbar. Bitte Email/Password Login verwenden.',
    );
  }

  const { GoogleSignin } = require('@react-native-google-signin/google-signin');

  if (!isGoogleSignInConfigured) {
    await configureGoogleSignIn();
  }

  // Play Services Check auf Android.
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Logout vorher um Account-Auswahl zu erzwingen — sonst nimmt Android
    // beim 2. Sign-In stillschweigend den letzten Account.
    try {
      await GoogleSignin.signOut();
    } catch {
      // not signed in → ok
    }
  }

  let response: any;
  try {
    response = await GoogleSignin.signIn();
  } catch (error: any) {
    if (error?.code === 'SIGN_IN_CANCELLED') {
      return null; // User-Cancel = kein Fehler, sondern null
    }
    if (error?.code === 'IN_PROGRESS') {
      throw new Error('Anmeldung läuft bereits');
    }
    if (error?.code === 'PLAY_SERVICES_NOT_AVAILABLE') {
      throw new Error('Google Play Services nicht verfügbar');
    }
    throw error;
  }

  // Response-Struktur kann zwischen Versionen variieren.
  const userInfo = response?.data || response;
  let idToken: string | undefined = userInfo?.idToken;

  // Android-Quirk: idToken landet manchmal in serverAuthCode.
  if (!idToken && userInfo?.serverAuthCode) {
    console.warn('⚠️ Google: nutze serverAuthCode als idToken-Fallback');
    idToken = userInfo.serverAuthCode;
  }

  if (!idToken) {
    console.error('❌ No idToken in Google Sign-In response:', {
      user: userInfo?.user,
      hasServerAuthCode: !!userInfo?.serverAuthCode,
      scopes: userInfo?.scopes,
    });
    if (!userInfo?.user?.email) {
      throw new Error(
        'Google Sign-In fehlgeschlagen: Keine Benutzerdaten erhalten. Bitte stelle sicher, dass du einen Google Account ausgewählt hast.',
      );
    }
    throw new Error(
      'Google Sign-In Konfigurationsfehler: Kein ID Token erhalten. Bitte kontaktiere den Support.',
    );
  }

  return GoogleAuthProvider.credential(idToken);
};

/**
 * Sign out from Google (native side only — Firebase signOut macht der
 * AuthContext separat).
 */
export const signOutGoogle = async () => {
  try {
    if (!NativeModules.RNGoogleSignin) {
      console.log('📱 Google Sign-Out skipped (Expo Go)');
      return;
    }
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
    console.log('✅ Google native sign-out');
  } catch (error) {
    console.error('❌ Google Sign-Out error:', error);
  }
};

/**
 * Check if user is signed in with Google (native module's view, not Firebase's).
 */
export const isGoogleSignedIn = async (): Promise<boolean> => {
  try {
    if (!NativeModules.RNGoogleSignin) return false;
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    return await GoogleSignin.isSignedIn();
  } catch (error) {
    console.error('❌ Google Sign-In check error:', error);
    return false;
  }
};

/**
 * Get current Google user (native module's view).
 */
export const getCurrentGoogleUser = async () => {
  try {
    if (!NativeModules.RNGoogleSignin) return null;
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');
    return await GoogleSignin.getCurrentUser();
  } catch (error) {
    console.error('❌ Get Google user error:', error);
    return null;
  }
};

// AuthContext-Verbrauchs-Pfad ist getGoogleCredential + linkOrSignIn dort.
// Wir behalten KEIN obsoleted signInWithGoogle hier — der AuthContext
// macht sign-in jetzt zentral.
