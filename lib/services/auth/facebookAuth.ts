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
import { NativeModules, Platform } from 'react-native';

const FB_APP_ID = '1757877148062670';
const FB_REDIRECT_URI = `fb${FB_APP_ID}://authorize`;
// T17.17: www.facebook.com statt m.facebook.com — die m.-Variante
// löst auf iOS gerne Limited-Login aus (ID-Token statt access_token),
// und Firebase's FacebookAuthProvider.credential() akzeptiert nur
// Graph-API-Access-Tokens. v22.0 ist die aktuelle stabile Graph-Version.
const FB_OAUTH_URL = `https://www.facebook.com/v22.0/dialog/oauth`;

export interface FacebookCredentialBundle {
  credential: FirebaseAuthTypes.AuthCredential;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

export const FB_SDK_UNAVAILABLE = 'auth/facebook-sdk-unavailable';

// T17.18: Module-level Diagnostik damit der AuthContext den letzten
// FB-Token-State im Toast anzeigen kann (TestFlight hat kein
// console.log, also brauchen wir die Info im UI).
export const lastFbDebug: { tokenPrefix: string; tokenLen: number; graphStatus: string } = {
  tokenPrefix: '',
  tokenLen: 0,
  graphStatus: '',
};

export const isFacebookAuthAvailable = async (): Promise<boolean> => true;

/**
 * ANDROID-ONLY: nativer react-native-fbsdk-next LoginManager-Flow.
 *
 * Grund (2026-07-07, am echten Gerät per `adb logcat` bewiesen): der
 * Browser-OAuth-Flow unten bounct auf Android in den Play Store. Facebook
 * behandelt das `fb<APPID>://authorize`-Redirect auf Android als
 * Native-App-Handoff und leitet `market://details/…` statt zum Scheme —
 * `fb…://authorize` erscheint nie, die FB-App wird nicht aufgerufen.
 * Das native SDK handhabt den Custom-Tab-Redirect (`fbconnect://cct.<pkg>`)
 * korrekt und umgeht das Problem.
 *
 * iOS bleibt BEWUSST beim Browser-Flow (siehe Datei-Header): dort wirft das
 * FB-SDK bei jedem Init einen SIGABRT (FBSDKCoreKit + iOS 26 + New Arch,
 * Build 1180). Deshalb wird das SDK hier NUR auf Android geladen (lazy
 * `require` im Android-Zweig) — auf iOS fasst es nie jemand an.
 *
 * Voraussetzung: die Android-Key-Hashes des Builds müssen in der
 * FB-Console (App-Einstellungen → Android → Key-Hashes) hinterlegt sein,
 * sonst lehnt Facebook den nativen Login ab.
 */
const getFacebookCredentialAndroid = async (): Promise<FacebookCredentialBundle | null> => {
  // SDK ZUERST initialisieren — direkt über das native FBSettings-Modul,
  // BEVOR das Paket geladen wird. Grund (am Gerät bewiesen, Build 1203):
  // `require('react-native-fbsdk-next')` zieht über den index auch
  // FBAccessToken.ts rein (`const AccessToken = NativeModules.FBAccessToken`),
  // dessen nativer initialize() eine AccessTokenTracker baut und mit
  // "SDK has not been initialized" CRASHT, wenn das SDK noch nicht läuft
  // (Plugin: isAutoInitEnabled:false). NativeModules.FBSettings triggert
  // FBAccessToken NICHT → wir initialisieren darüber, DANN erst das Paket.
  const NativeSettings: any = NativeModules.FBSettings;
  try {
    NativeSettings?.setAppID(FB_APP_ID);
    NativeSettings?.initializeSDK();
  } catch (e: any) {
    if (__DEV__) console.warn('[facebookAuth][android] native initializeSDK failed:', e?.message);
  }

  // Jetzt ist das SDK hochgefahren → das Paket lädt ohne AccessToken-Crash.
  // Lazy require: NUR auf Android — auf iOS wird das SDK nie angefasst (SIGABRT).
  const { LoginManager, AccessToken } = require('react-native-fbsdk-next');

  let result: any;
  try {
    result = await LoginManager.logInWithPermissions(['public_profile', 'email']);
  } catch (error: any) {
    if (__DEV__) console.error('[facebookAuth][android] logInWithPermissions error:', error);
    throw new Error('Facebook-Login konnte nicht geöffnet werden.');
  }
  // isCancelled → User hat abgebrochen (kein Fehler)
  if (!result || result.isCancelled) {
    if (__DEV__) console.log('[facebookAuth][android] login cancelled');
    return null;
  }

  const tokenData = await AccessToken.getCurrentAccessToken();
  const accessToken = tokenData?.accessToken ? String(tokenData.accessToken) : null;
  if (!accessToken) {
    if (__DEV__) console.warn('[facebookAuth][android] no access token after login');
    return null;
  }
  lastFbDebug.tokenPrefix = accessToken.slice(0, 12);
  lastFbDebug.tokenLen = accessToken.length;
  lastFbDebug.graphStatus = 'pending';

  // Graph-Verify + Profildaten — identische Logik wie der iOS-Pfad, damit
  // beide Plattformen dieselbe FacebookCredentialBundle liefern.
  let email: string | null = null;
  let displayName: string | null = null;
  let photoURL: string | null = null;
  let graphProfileOk = false;
  try {
    const profileRes = await fetch(
      `https://graph.facebook.com/v22.0/me?fields=id,email,name,picture&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (profileRes.ok) {
      const profile = await profileRes.json();
      graphProfileOk = true;
      lastFbDebug.graphStatus = `OK id=${profile?.id ?? '?'}`;
      if (typeof profile?.email === 'string') email = profile.email;
      if (typeof profile?.name === 'string') displayName = profile.name;
      if (profile?.picture?.data?.url) photoURL = profile.picture.data.url;
    } else {
      const errBody = await profileRes.text();
      lastFbDebug.graphStatus = `${profileRes.status}: ${errBody.slice(0, 100)}`;
      if (__DEV__) console.warn('[facebookAuth][android] Graph /me failed:', profileRes.status, errBody);
    }
  } catch (graphErr: any) {
    lastFbDebug.graphStatus = `fetch err: ${graphErr?.message ?? '?'}`;
    if (__DEV__) console.warn('[facebookAuth][android] Graph fetch failed:', graphErr?.message);
  }
  if (!graphProfileOk) {
    throw new Error(
      'Facebook-Login fehlgeschlagen: Token von Facebook abgelehnt. Bitte erneut versuchen.',
    );
  }

  const credential = FacebookAuthProvider.credential(accessToken);
  return { credential, email, displayName, photoURL };
};

/**
 * Browser-based Facebook OAuth flow (iOS).
 * Returns null bei User-Cancel, sonst die Firebase-Credential.
 */
export const getFacebookCredential = async (): Promise<FacebookCredentialBundle | null> => {
  // Android → nativer SDK-Flow (Browser-OAuth bounct dort in den Play Store).
  // iOS fällt durch zum UNVERÄNDERTEN Browser-Flow darunter.
  if (Platform.OS === 'android') {
    return getFacebookCredentialAndroid();
  }
  // Build OAuth URL — implicit flow (response_type=token gibt direkt
  // access_token zurück im URL-Fragment, kein Token-Exchange nötig).
  // T17.17: `auth_type=rerequest` raus — triggert Limited Login auf iOS,
  // was einen JWT-ID-Token statt einen Graph-API-Access-Token zurückgibt.
  // Firebase's FacebookAuthProvider akzeptiert nur Access-Tokens.
  const params = new URLSearchParams({
    client_id: FB_APP_ID,
    redirect_uri: FB_REDIRECT_URI,
    scope: 'email,public_profile',
    response_type: 'token',
  });
  const authUrl = `${FB_OAUTH_URL}?${params.toString()}`;
  if (__DEV__) console.log('[facebookAuth] Opening:', authUrl);

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
    if (__DEV__) console.log('[facebookAuth] WebBrowser result:', result.type, 'no URL');
    // User hat Sheet abgebrochen (type='cancel' oder 'dismiss').
    return null;
  }

  // Redirect-URL parsen. Facebook gibt den access_token im URL-Fragment
  // zurück: fb1757877148062670://authorize#access_token=XXX&expires_in=...
  // Falls Fehler: ...?error=access_denied&error_reason=...
  const url = result.url;
  if (__DEV__) console.log('[facebookAuth] Redirect URL:', url);
  const fragmentMatch = url.match(/#(.+)$/);
  const queryMatch = url.match(/\?(.+?)(?:#|$)/);
  const paramsStr = fragmentMatch?.[1] ?? queryMatch?.[1] ?? '';
  const responseParams = new URLSearchParams(paramsStr);

  // Error-Pfad
  if (responseParams.get('error')) {
    const errCode = responseParams.get('error');
    const errReason = responseParams.get('error_reason') || responseParams.get('error_description');
    if (__DEV__) console.warn('[facebookAuth] OAuth error:', errCode, errReason);
    if (errCode === 'access_denied') return null;
    throw new Error(`Facebook-Login fehlgeschlagen: ${errReason || errCode}`);
  }

  const accessToken = responseParams.get('access_token');
  if (!accessToken) {
    if (__DEV__) console.warn('[facebookAuth] No access_token in redirect URL:', url);
    return null;
  }
  // Diagnostik für späteren AuthContext-Toast (TestFlight)
  lastFbDebug.tokenPrefix = accessToken.slice(0, 12);
  lastFbDebug.tokenLen = accessToken.length;
  lastFbDebug.graphStatus = 'pending';
  if (__DEV__) {
    console.log('[facebookAuth] Token format:',
      `${accessToken.slice(0, 20)}…(len=${accessToken.length})`);
  }

  // T17.17: Token gegen Graph-API verifizieren BEVOR wir's an Firebase
  // weitergeben. Wenn FB selbst es ablehnt, ist's eindeutig ein Token-
  // Problem (Limited Login statt Access Token, abgelaufen, etc.).
  // Wenn FB es akzeptiert aber Firebase ablehnt → Firebase-Config-Problem.
  let email: string | null = null;
  let displayName: string | null = null;
  let photoURL: string | null = null;
  let graphProfileOk = false;
  try {
    const profileRes = await fetch(
      `https://graph.facebook.com/v22.0/me?fields=id,email,name,picture&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (profileRes.ok) {
      const profile = await profileRes.json();
      graphProfileOk = true;
      lastFbDebug.graphStatus = `OK id=${profile?.id ?? '?'}`;
      if (typeof profile?.email === 'string') email = profile.email;
      if (typeof profile?.name === 'string') displayName = profile.name;
      if (profile?.picture?.data?.url) photoURL = profile.picture.data.url;
      if (__DEV__) console.log('[facebookAuth] Graph /me OK, id=', profile?.id, 'email=', email);
    } else {
      const errBody = await profileRes.text();
      lastFbDebug.graphStatus = `${profileRes.status}: ${errBody.slice(0, 100)}`;
      if (__DEV__) console.warn('[facebookAuth] Graph /me failed:', profileRes.status, errBody);
    }
  } catch (graphErr: any) {
    lastFbDebug.graphStatus = `fetch err: ${graphErr?.message ?? '?'}`;
    if (__DEV__) console.warn('[facebookAuth] Graph fetch failed:', graphErr?.message);
  }

  if (!graphProfileOk) {
    // Token wurde von FB selbst abgelehnt. Vermutung: Limited-Login
    // ID-Token statt Access-Token, oder Token ist tatsächlich abgelaufen.
    throw new Error(
      'Facebook-Login fehlgeschlagen: Token von Facebook abgelehnt. Bitte erneut versuchen.',
    );
  }

  // Firebase-Credential bauen — Token hat Graph-API verifiziert
  const credential = FacebookAuthProvider.credential(accessToken);
  return { credential, email, displayName, photoURL };
};

export const signOutFacebook = async (): Promise<void> => {
  // Browser-OAuth-Flow hat keinen Logout — Firebase signOut macht
  // AuthContext separat. iOS' Cookie-Store hält die Session in Safari,
  // das ist OK (= "stay signed in" beim nächsten Login-Tap).
};
