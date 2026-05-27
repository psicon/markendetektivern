// Facebook Sign-In via react-native-fbsdk-next.
//
// Diese Datei holt nur die Firebase-Credential von Facebook — das
// eigentliche Firebase-Sign-In bzw. Anon-Linking macht der
// AuthContext (siehe linkOrSignIn dort). Spiegelbildlich zu
// appleAuth.ts und googleAuth.ts.
//
// Setup-Voraussetzungen (siehe app.json + Meta Developer Dashboard):
//   • App-ID + Client Token in app.json unter react-native-fbsdk-next.
//   • iOS + Android Platforms im Meta-Dashboard registriert.
//   • Facebook Login Produkt aktiviert (`email`, `public_profile`).
//   • Firebase Console → Auth → Facebook-Provider mit App-ID + Secret.

import {
  FacebookAuthProvider,
  FirebaseAuthTypes,
} from '@react-native-firebase/auth';

export interface FacebookCredentialBundle {
  /** Firebase-Credential, ready für linkOrSignIn. */
  credential: FirebaseAuthTypes.AuthCredential;
  /** Facebook-Profil-Daten falls verfügbar (best-effort). */
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

/**
 * Lädt das FB-SDK NUR wenn das Native-Modul registriert ist.
 *
 * Hintergrund (T17.1): `require('react-native-fbsdk-next')` führt
 * intern bei Module-Init `new NativeEventEmitter(NativeModules.X)`
 * aus. Wenn der Native-Bridge-Module nicht registriert ist (Expo Go,
 * Dev-Client ohne FB-Plugin, Quick-Patched-Bundle), ist
 * NativeModules.X === undefined → NativeEventEmitter throwt
 * "non-null argument". Der Throw passiert WÄHREND der Module-Init,
 * NICHT durchs require() das wir wrappen könnten — der bubbelt durch
 * jeden try/catch.
 *
 * Lösung: vor dem Require checken ob die Native-Bridge da ist.
 * Wenn nicht → null returnen ohne require zu touchen.
 */
function loadFbsdk(): any | null {
  try {
    // NativeModules-Lookup über react-native (statischer Import, KEIN
    // dynamic require von 'react-native' selbst — siehe CLAUDE.md
    // "Never await import('react-native')").
    const { NativeModules } = require('react-native');
    // Bekannte Native-Module-Namen des FB-SDK auf iOS + Android.
    const hasNative =
      !!NativeModules?.FBSDKAppEvents ||
      !!NativeModules?.RCTFBSDKAccessToken ||
      !!NativeModules?.RNFBSDKAppEvents ||
      !!NativeModules?.RNFBSDKLoginManager;
    if (!hasNative) {
      if (__DEV__) {
        console.warn('[facebookAuth] FB-SDK native modules not registered — falling back gracefully.');
      }
      return null;
    }
    return require('react-native-fbsdk-next');
  } catch (error: any) {
    if (__DEV__) {
      console.warn('[facebookAuth] react-native-fbsdk-next not loadable:', error?.message);
    }
    return null;
  }
}

/**
 * Check ob das Facebook-SDK auf dem aktuellen Build verfügbar ist.
 * Wird in einer Build-Variante ohne FB-Native-Modul (z.B. Expo Go,
 * alter EAS-Build) sauber false returnen, statt zu crashen.
 */
export const isFacebookAuthAvailable = async (): Promise<boolean> => {
  const fbsdk = loadFbsdk();
  return Boolean(fbsdk?.LoginManager);
};

/** Fehler-Code den der Caller (AuthContext) mit `error.code` checken
 *  kann um sauber einen "bitte Build aktualisieren"-Toast anzuzeigen
 *  statt einer kryptischen NativeEventEmitter-Meldung. */
export const FB_SDK_UNAVAILABLE = 'auth/facebook-sdk-unavailable';

/**
 * Hole eine Firebase AuthCredential + Profil-Daten von Facebook.
 *
 * Macht KEINEN Firebase-Sign-In — das macht der AuthContext.
 * Returns null bei User-Cancel.
 * Throws Error mit code=FB_SDK_UNAVAILABLE wenn das Native-Modul
 * nicht geladen ist (alter Build oder Expo Go).
 *
 * Hinweis Apple App-Tracking: das FB-SDK initialisiert sich
 * mit `advertiserIDCollectionEnabled: false` + `autoLogAppEvents:
 * false` (siehe app.json plugin config) — wir tracken NICHTS
 * automatisch. Login ist ein User-initiierter Akt.
 */
export const getFacebookCredential = async (): Promise<FacebookCredentialBundle | null> => {
  const fbsdk = loadFbsdk();
  if (!fbsdk) {
    const err: any = new Error(
      'Facebook-Login ist in diesem Build noch nicht aktiv — bitte App-Update abwarten.',
    );
    err.code = FB_SDK_UNAVAILABLE;
    throw err;
  }
  const { LoginManager, AccessToken, Profile } = fbsdk;

  if (!LoginManager) {
    const err: any = new Error(
      'Facebook-Login ist in diesem Build noch nicht aktiv — bitte App-Update abwarten.',
    );
    err.code = FB_SDK_UNAVAILABLE;
    throw err;
  }

  // Vorsichtshalber abmelden bevor wir das Sheet öffnen, damit
  // gestrandete Tokens (z.B. aus Anon-Phase) keinen alten Account
  // angeben.
  try { LoginManager.logOut(); } catch {}

  let result: any;
  try {
    result = await LoginManager.logInWithPermissions(['email', 'public_profile']);
  } catch (error: any) {
    if (error?.message?.toLowerCase().includes('cancel')) return null;
    throw error;
  }

  // User hat das Sheet aktiv abgebrochen.
  if (result?.isCancelled) return null;

  const tokenData = await AccessToken.getCurrentAccessToken();
  if (!tokenData?.accessToken) {
    throw new Error('Facebook Login failed — kein Access Token.');
  }

  const credential = FacebookAuthProvider.credential(tokenData.accessToken);

  // Profil-Daten (best-effort — kann scheitern wenn der User Email
  // oder Profile-Permissions nicht freigegeben hat).
  let email: string | null = null;
  let displayName: string | null = null;
  let photoURL: string | null = null;
  try {
    const profile = await Profile?.getCurrentProfile?.();
    if (profile) {
      displayName = profile.name ?? null;
      photoURL = profile.imageURL ?? null;
      // Email ist im Profile-Objekt nicht enthalten — kommt nur via
      // Graph-API mit dem Token. Wir machen das (optional) als
      // Sekundär-Call. Wenn der User die Email-Permission verweigert
      // hat, ist email einfach null und der AuthContext schreibt
      // eben `null` ans User-Doc (ist OK).
      try {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/me?fields=email,name&access_token=${tokenData.accessToken}`,
        );
        if (res.ok) {
          const json = await res.json();
          if (typeof json?.email === 'string') email = json.email;
          if (!displayName && typeof json?.name === 'string') displayName = json.name;
        }
      } catch {
        // Network/permission-Fehler — bleibt halt null, ist robust.
      }
    }
  } catch {
    // Profile-API ist optional. Ignorieren.
  }

  return { credential, email, displayName, photoURL };
};

/** Sign out vom Facebook-SDK. Firebase-Sign-Out macht der AuthContext.
 *  No-op wenn das Native-Modul nicht geladen ist. */
export const signOutFacebook = async (): Promise<void> => {
  const fbsdk = loadFbsdk();
  try {
    fbsdk?.LoginManager?.logOut?.();
  } catch (error: any) {
    if (__DEV__) console.log('Facebook Sign-Out (ignored):', error?.message);
  }
};
