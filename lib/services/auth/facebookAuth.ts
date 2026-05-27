// Facebook Sign-In via Browser-OAuth-Flow (T17.13)
//
// Komplett OHNE react-native-fbsdk-next — wir bauen den OAuth-Flow
// selber mit `expo-auth-session` + `expo-web-browser`. Hintergrund:
// FBSDKCoreKit 18.0.3 auf iOS 26.1 + RN-New-Architecture wirft aus
// JEDEM Init-Aufruf (Settings.initializeSDK, Settings.set*,
// LoginManager.logOut, ApplicationDelegate.shared.application(_,
// didFinishLaunchingWithOptions:)) eine NSException die der RN-
// TurboModule-Layer als objc_exception_rethrow → SIGABRT eskaliert,
// uneinholbar von JS-try/catch. Siehe Build 1180 Crash.
//
// Lösung: SDK wird gar nicht mehr angefasst. Stattdessen:
//
// 1. Wir öffnen `https://m.facebook.com/.../dialog/oauth` in einer
//    ASWebAuthenticationSession via WebBrowser.openAuthSessionAsync.
//    Das ist Apple-natives "Sign in with Facebook"-Verhalten, kein
//    SDK nötig.
// 2. User loggt sich ein, Facebook redirected zu unserem OAuth-
//    Redirect-URI (`fb<APP_ID>://authorize`). iOS gibt die URL an
//    unsere App zurück.
// 3. Wir parsen den access_token aus der Redirect-URL.
// 4. Wir bauen `FacebookAuthProvider.credential(token)` — dieselbe
//    Firebase-Credential wie bei SDK-Login.
//
// Keine ATT-Permission nötig, kein Tracking, kein Native-FB-App-Flow.
// Der User-Experience ist ein Safari-Sheet (limited.facebook.com bzw
// m.facebook.com), genauso wie es vorher partly geklappt hat.

import {
  FacebookAuthProvider,
  FirebaseAuthTypes,
} from '@react-native-firebase/auth';
import * as WebBrowser from 'expo-web-browser';

const FB_APP_ID = '1757877148062670';
const FB_REDIRECT_URI = `fb${FB_APP_ID}://authorize`;
const FB_OAUTH_URL = `https://m.facebook.com/v18.0/dialog/oauth`;

export interface FacebookCredentialBundle {
  credential: FirebaseAuthTypes.AuthCredential;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

export const FB_SDK_UNAVAILABLE = 'auth/facebook-sdk-unavailable';

export const isFacebookAuthAvailable = async (): Promise<boolean> => true;

/**
 * Browser-based Facebook OAuth flow.
 * Returns null bei User-Cancel, sonst die Firebase-Credential.
 */
export const getFacebookCredential = async (): Promise<FacebookCredentialBundle | null> => {
  // Build OAuth URL — implicit flow (response_type=token gibt direkt
  // access_token zurück im URL-Fragment, kein Token-Exchange nötig).
  const params = new URLSearchParams({
    client_id: FB_APP_ID,
    redirect_uri: FB_REDIRECT_URI,
    scope: 'email,public_profile',
    response_type: 'token',
    auth_type: 'rerequest', // erlaubt User Permission-Updates
  });
  const authUrl = `${FB_OAUTH_URL}?${params.toString()}`;

  // ASWebAuthenticationSession via expo-web-browser. dismissButtonStyle
  // = 'cancel' damit User sauber abbrechen kann. preferEphemeralSession
  // = false damit User's existing Safari-Facebook-Cookies genutzt werden
  // (= komfortabler Login wenn man eh schon eingeloggt ist).
  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(authUrl, FB_REDIRECT_URI, {
      preferEphemeralSession: false,
      showInRecents: false,
    });
  } catch (error: any) {
    if (__DEV__) console.error('[facebookAuth] WebBrowser error:', error);
    throw new Error('Facebook-Login konnte nicht geöffnet werden.');
  }

  if (result.type !== 'success' || !result.url) {
    // User hat Sheet abgebrochen (type='cancel' oder 'dismiss').
    return null;
  }

  // Redirect-URL parsen. Facebook gibt den access_token im URL-Fragment
  // zurück: fb1757877148062670://authorize#access_token=XXX&expires_in=...
  // Falls Fehler: ...?error=access_denied&error_reason=...
  const url = result.url;
  const fragmentMatch = url.match(/#(.+)$/);
  const queryMatch = url.match(/\?(.+?)(?:#|$)/);
  const paramsStr = fragmentMatch?.[1] ?? queryMatch?.[1] ?? '';
  const responseParams = new URLSearchParams(paramsStr);

  // Error-Pfad
  if (responseParams.get('error')) {
    const errCode = responseParams.get('error');
    const errReason = responseParams.get('error_reason') || responseParams.get('error_description');
    if (__DEV__) console.warn('[facebookAuth] OAuth error:', errCode, errReason);
    // User hat Login abgelehnt im FB-Dialog = Cancel
    if (errCode === 'access_denied') return null;
    throw new Error(`Facebook-Login fehlgeschlagen: ${errReason || errCode}`);
  }

  const accessToken = responseParams.get('access_token');
  if (!accessToken) {
    if (__DEV__) console.warn('[facebookAuth] No access_token in redirect URL:', url);
    return null;
  }

  // Firebase-Credential bauen
  const credential = FacebookAuthProvider.credential(accessToken);

  // Profil-Daten via Graph-API holen (best-effort).
  let email: string | null = null;
  let displayName: string | null = null;
  let photoURL: string | null = null;
  try {
    const profileRes = await fetch(
      `https://graph.facebook.com/v18.0/me?fields=email,name,picture&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (profileRes.ok) {
      const profile = await profileRes.json();
      if (typeof profile?.email === 'string') email = profile.email;
      if (typeof profile?.name === 'string') displayName = profile.name;
      if (profile?.picture?.data?.url) photoURL = profile.picture.data.url;
    }
  } catch (graphErr: any) {
    if (__DEV__) console.warn('[facebookAuth] Graph profile fetch failed:', graphErr?.message);
    // Non-fatal — Firebase-Credential geht trotzdem.
  }

  return { credential, email, displayName, photoURL };
};

export const signOutFacebook = async (): Promise<void> => {
  // Browser-OAuth-Flow hat keinen Logout — Firebase signOut macht
  // AuthContext separat. iOS' Cookie-Store hält die Session in Safari,
  // das ist OK (= "stay signed in" beim nächsten Login-Tap).
};
