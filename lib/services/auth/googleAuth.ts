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
import { Platform } from 'react-native';

let isGoogleSignInConfigured = false;

/**
 * Configure Google Sign-In (should be called early in app lifecycle).
 * Idempotent — kann mehrfach aufgerufen werden, läuft nur einmal durch.
 */
export const configureGoogleSignIn = async () => {
  try {
    if (isGoogleSignInConfigured) return;

    // T17.4: KEIN `NativeModules.RNGoogleSignin`-Check mehr.
    // Mit newArchEnabled:true (TurboModules) ist das Symbol nicht
    // garantiert über `NativeModules.X` erreichbar — es kann
    // `undefined` sein obwohl das Module korrekt registriert ist.
    // Resultat in Build 1172: early-return → configure() lief NIE →
    // GIDSignIn.sharedInstance.configuration nil → NSException beim
    // ersten signIn-Call → SIGABRT. Stattdessen: blind den require
    // versuchen, durch try/catch abgesichert. Wenn das Module wirklich
    // fehlt (Expo Go, alter Build), schlägt erst das require fehl.
    const { GoogleSignin } = require('@react-native-google-signin/google-signin');

    // T17.2: Platform-spezifische Configuration — auf iOS ist
    // `androidClientId` kein valider Parameter. Auf iOS 26+ ist das
    // mit dem neuen Architecture Bridge nicht nur eine Warning,
    // sondern eine ungefangene Obj-C-Exception → SIGABRT beim App-
    // Start (siehe Build 1171 Crashes, beide TestFlight-Geräte).
    // Splitten wir explizit: jede Plattform bekommt nur die Keys
    // die sie versteht.
    const config: any = {
      webClientId: '139509881339-8r18hd499h6615f4ebos35ihbqqqvjvs.apps.googleusercontent.com',
      offlineAccess: true,
      forceCodeForRefreshToken: true,
      scopes: ['profile', 'email'],
    };
    if (Platform.OS === 'ios') {
      // 2026-05-27: alter Client `8m7rjqtur27a...` wurde von Google
      // automatisch gelöscht (6 Monate Inaktivität). Neuer Client
      // für Bundle `de.markendetektive` + App-Store-ID 6471081082.
      config.iosClientId = '139509881339-u77orq1k10s7lqui7vvq615smqskq70b.apps.googleusercontent.com';
    } else if (Platform.OS === 'android') {
      // KEIN androidClientId — `@react-native-google-signin` kennt den
      // Parameter nicht ("not a valid configuration parameter") und liest den
      // Android-OAuth-Client automatisch aus google-services.json. Für den
      // ID-Token zählt nur `webClientId` (oben) + die in Firebase registrierte
      // SHA-1 des Signing-Keys. forceAccountSelection bleibt (gültig).
      config.forceAccountSelection = true;
    }

    // T17.3: zusätzlicher inner try/catch um die native configure-Call.
    // Falls die Native-Bridge eine Obj-C-Exception wirft (z.B. wegen
    // einer zukünftigen Library-Version die andere Keys erwartet),
    // crashed nicht die ganze App.
    try {
      GoogleSignin.configure(config);
      isGoogleSignInConfigured = true;
      console.log('✅ Google Sign-In configured');
    } catch (innerError: any) {
      console.error('❌ Google Sign-In configure() threw:', innerError?.message ?? innerError);
      // Nicht re-throwen — GoogleSignIn ist nur ein optionaler Login.
    }
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
export interface GoogleCredentialBundle {
  credential: FirebaseAuthTypes.AuthCredential;
  /** Anzeigename aus dem Google-Konto (z.B. 'Patrick Sieber'). */
  displayName: string | null;
  email: string | null;
  photoUrl: string | null;
}

export const getGoogleCredential = async (): Promise<GoogleCredentialBundle | null> => {
  // T17.4: KEIN NativeModules-Check mehr (siehe configureGoogleSignIn-
  // Kommentar). Wir versuchen es einfach — falls Native-Modul fehlt
  // (Expo Go, alter Build), schlägt das require fehl und der äußere
  // try/catch im AuthContext fängt's auf.
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');

  // T17.4: Defensiv konfigurieren falls die initial-configure aus
  // _layout.tsx aus irgendeinem Grund nicht durchgelaufen ist. Wenn
  // schon konfiguriert, no-op (idempotent).
  await configureGoogleSignIn();

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

  // v13+/v15: Cancel WIRFT nicht mehr, sondern liefert
  // { type: 'cancelled', data: null } — ohne diesen Check rumpelte
  // der Abbruch in den idToken-Fehlerpfad und erzeugte die
  // irrefuehrende Meldung 'Keine Benutzerdaten erhalten' (86ca7x9ep).
  if (response?.type === 'cancelled') {
    return null;
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

  // Profildaten mitliefern (86ca7x9ep-Follow-up: 'es steht immer
  // Detektiv') — beim LINKEN eines Anon-Users uebernimmt Firebase
  // displayName/photoURL NICHT vom Provider, also muss der
  // AuthContext sie selbst ins Firestore-Profil schreiben.
  const gUser = userInfo?.user ?? {};
  return {
    credential: GoogleAuthProvider.credential(idToken),
    displayName: gUser.name || [gUser.givenName, gUser.familyName].filter(Boolean).join(' ') || null,
    email: gUser.email || null,
    photoUrl: gUser.photo || null,
  };
};

/**
 * Sign out from Google (native side only — Firebase signOut macht der
 * AuthContext separat).
 */
export const signOutGoogle = async () => {
  try {
    // T17.4: KEIN NativeModules-Check (TurboModules unreliable). Falls
    // das Modul wirklich fehlt (Expo Go), schlägt das require fehl und
    // landet im catch.
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
    // T17.4: KEIN NativeModules-Check (TurboModules unreliable).
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
    // T17.4: KEIN NativeModules-Check (TurboModules unreliable).
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
