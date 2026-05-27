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
 * Check ob das Facebook-SDK auf dem aktuellen Build verfügbar ist.
 * Wird in einer Build-Variante ohne FB-Native-Modul (z.B. Expo Go,
 * alter EAS-Build) sauber false returnen, statt zu crashen.
 */
export const isFacebookAuthAvailable = async (): Promise<boolean> => {
  try {
    const fbsdk = require('react-native-fbsdk-next');
    return Boolean(fbsdk?.LoginManager);
  } catch (error: any) {
    console.log('📱 Facebook Auth check error:', error?.message);
    return false;
  }
};

/**
 * Hole eine Firebase AuthCredential + Profil-Daten von Facebook.
 *
 * Macht KEINEN Firebase-Sign-In — das macht der AuthContext.
 * Returns null bei User-Cancel.
 *
 * Hinweis Apple App-Tracking: das FB-SDK initialisiert sich
 * mit `advertiserIDCollectionEnabled: false` + `autoLogAppEvents:
 * false` (siehe app.json plugin config) — wir tracken NICHTS
 * automatisch. Login ist ein User-initiierter Akt.
 */
export const getFacebookCredential = async (): Promise<FacebookCredentialBundle | null> => {
  const fbsdk = require('react-native-fbsdk-next');
  const { LoginManager, AccessToken, Profile } = fbsdk;

  if (!LoginManager) {
    throw new Error('Facebook SDK not available — needs EAS-Build with react-native-fbsdk-next.');
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

/** Sign out vom Facebook-SDK. Firebase-Sign-Out macht der AuthContext. */
export const signOutFacebook = async (): Promise<void> => {
  try {
    const { LoginManager } = require('react-native-fbsdk-next');
    LoginManager?.logOut?.();
  } catch (error: any) {
    console.log('Facebook Sign-Out (ignored):', error?.message);
  }
};
