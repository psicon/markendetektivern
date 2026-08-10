/**
 * FCM token registration for cashback push notifications.
 *
 * Lifecycle:
 *   - On user sign-in (anonymous OR full account):
 *       1. Request notification permission (iOS only — Android grants
 *          implicitly until API 33+)
 *       2. Get the FCM token via @react-native-firebase/messaging
 *       3. Write it to /users/{uid}/fcmTokens/{tokenHash} so the
 *          Cloud Function can later send pushes
 *   - On token refresh: write the new token, leave old ones (CF prunes
 *     stale tokens when sendEachForMulticast reports them invalid)
 *   - On sign-out: tokens stay (multi-device support); CF will only
 *     send to tokens currently registered against the receiving uid
 *
 * The native module is loaded LAZILY so screens / app boot don't crash
 * when @react-native-firebase/messaging hasn't been linked into the
 * dev-client yet (rebuild via `npx expo run:ios --device`).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { doc, getDoc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { db } from '@/lib/firebase';

let _registered = false;

/**
 * Warum die Registrierung endete — und zwar SERVERSEITIG sichtbar.
 *
 * Vorher konnte `registerFcmTokenForUser` an vier Stellen aufgeben, und
 * alle vier hinterliessen denselben Zustand in der Datenbank: nichts.
 * Ein Gerat ohne Token war damit ununterscheidbar von einem Gerat mit
 * abgelehnter Berechtigung, mit fehlendem nativen Modul oder mit einem
 * fehlgeschlagenen `getToken()`. Die Information existierte nur kurz in
 * der Geratekonsole. Jede Push-Storung endete deshalb in derselben
 * Sackgasse (Handover 10.08.2026).
 *
 *   ok                → Token geschrieben
 *   no_module         → natives Messaging-Modul nicht verlinkt
 *   permission_denied → iOS-Berechtigung nicht AUTHORIZED/PROVISIONAL
 *   token_failed      → getToken() warf (typisch: kein APNs-Token da)
 *   write_failed      → persistToken() warf (Rules, offline)
 */
export type FcmState =
  | 'ok'
  | 'no_module'
  | 'permission_denied'
  | 'token_failed'
  | 'write_failed';

const STATE_KEY = (uid: string) => `fcm/v1/state_${uid}`;
// Sitzungs-Riegel zusatzlich zum persistenten: offline lost der
// Firestore-Write nie auf, der persistente Riegel bliebe leer, und jeder
// weitere Aufruf legte einen weiteren Write in die Mutation-Queue.
// Gleiches Muster wie in ratingTelemetry.ts.
const writtenThisSession = new Set<string>();

function appVersion(): string {
  try {
    const Application = require('expo-application');
    return Application?.nativeApplicationVersion ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Zustand festhalten — NUR bei Anderung, ein Write pro Ubergang.
 * Bewusst fire-and-forget aufrufen: Firestore-Promises losen erst bei
 * Server-Ack auf und hangen offline unbegrenzt (Projekt-Regel).
 */
async function recordState(uid: string, state: FcmState, reason?: string): Promise<void> {
  const sig = `${state}|${reason ?? ''}|${appVersion()}`;
  const key = STATE_KEY(uid);
  try {
    if (writtenThisSession.has(key + sig)) return;
    if ((await AsyncStorage.getItem(key)) === sig) return; // unverandert
    writtenThisSession.add(key + sig);

    await setDoc(
      doc(db, 'users', uid),
      {
        fcmStatus: {
          state,
          reason: reason ?? null,
          platform: Platform.OS,
          appVersion: appVersion(),
          at: serverTimestamp(),
        },
      },
      { merge: true },
    );
    // Riegel ERST nach erfolgreichem Write — sonst galte ein offline
    // gescheiterter Write dauerhaft als gesendet und der Zustand fehlte.
    await AsyncStorage.setItem(key, sig);
  } catch (e: any) {
    // Diagnostik darf die Registrierung NIE beeinflussen.
    console.warn('[fcm] recordState failed (non-fatal):', e?.message);
  }
}

/**
 * Probe whether the Firebase Messaging native module is linked into
 * the dev-client. Avoids the import-time crash + LogBox red banner
 * when the dev-client hasn't been rebuilt with @react-native-firebase
 * /messaging yet.
 */
function isMessagingLinked(): boolean {
  try {
    // RNFB modules register under the `RNFBMessagingModule` name on
    // the bridge (different across versions; we probe both).
    const nm: any = NativeModules as any;
    if (nm?.RNFBMessagingModule) return true;
    if (nm?.RNFBMessaging) return true;
    const tm: any = TurboModuleRegistry as any;
    if (typeof tm?.get === 'function') {
      if (tm.get('RNFBMessagingModule')) return true;
      if (tm.get('RNFBMessaging')) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function getMessagingModule(): Promise<any | null> {
  if (!isMessagingLinked()) {
    console.log('[fcm] native module not linked — skipping push registration');
    return null;
  }
  try {
    const mod: any = await import('@react-native-firebase/messaging');
    return mod?.default ?? mod;
  } catch (e: any) {
    console.warn('[fcm] messaging import failed:', e?.message);
    return null;
  }
}

function tokenDocId(token: string): string {
  // FCM tokens are huge (160 chars). Use a stable short hash so the
  // doc-id stays sane in Firestore. djb2 hash, lowercased base16.
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  return `t_${(h >>> 0).toString(16)}_${token.slice(-8)}`;
}

/** Exportiert, damit die addedAt-Regel direkt testbar ist (siehe
 *  __tests__/fcmTokenState.test.ts). Sonst modulintern. */
export async function persistToken(uid: string, token: string): Promise<void> {
  const id = tokenDocId(token);
  const ref = doc(db, `users/${uid}/fcmTokens/${id}`);

  // `addedAt` NUR beim Anlegen setzen. Vorher schrieb dieselbe
  // merge-Operation beide Zeitstempel bei JEDEM App-Start, wodurch
  // `addedAt` immer eine Kopie von `lastSeenAt` war — die Frage „seit
  // wann kennt uns dieses Gerat?" liess sich nicht mehr beantworten.
  // Aufgefallen ist es, weil in einer Stichprobe alle 77 iOS-Tokens ein
  // `addedAt` im August trugen, was nach einer Massen-Neuregistrierung
  // aussah und keine war (Handover 10.08.2026).
  //
  // Kostet einen Read pro App-Start und Gerat — bewusst in Kauf
  // genommen: ohne ihn gibt es kein „set if absent" fur ein Einzelfeld,
  // und ein geratelokaler Marker ginge bei Neuinstallation verloren.
  let exists = false;
  try {
    exists = (await getDoc(ref)).exists();
  } catch {
    // Read fehlgeschlagen (offline) → wie „neu" behandeln. Ein zu neues
    // addedAt ist der kleinere Schaden gegenuber gar keinem Token.
  }

  await setDoc(
    ref,
    {
      token,
      platform: Platform.OS,
      ...(exists ? {} : { addedAt: serverTimestamp() }),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Wire up FCM token registration for the given user. Idempotent —
 * safe to call multiple times (e.g. on every AuthContext mount).
 *
 * Returns a teardown function that unbinds the onTokenRefresh listener.
 */
export async function registerFcmTokenForUser(uid: string): Promise<() => void> {
  const Messaging = await getMessagingModule();
  if (!Messaging) {
    void recordState(uid, 'no_module');
    return () => {};
  }

  try {
    if (Platform.OS === 'ios') {
      const authStatus = await Messaging().requestPermission({
        alert: true,
        badge: true,
        sound: true,
      });
      const enabled =
        authStatus === Messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === Messaging.AuthorizationStatus.PROVISIONAL;
      if (!enabled) {
        console.log('[fcm] iOS permission denied');
        // Den konkreten AuthorizationStatus mitschreiben: DENIED und
        // NOT_DETERMINED sehen im Ergebnis gleich aus, unterscheiden
        // sich aber fachlich (bewusst abgelehnt vs. Dialog nie
        // beantwortet) — und nur ersteres ist endgultig.
        void recordState(uid, 'permission_denied', `authStatus=${authStatus}`);
        return () => {};
      }
    } else if (Platform.OS === 'android') {
      // Android 13+ runtime POST_NOTIFICATIONS permission — handled by
      // requestPermission() too (no-op on older Android).
      try {
        await Messaging().requestPermission();
      } catch {}
    }

    // getToken() und persistToken() getrennt fangen: beide landeten
    // vorher im selben aussereren catch und waren danach nicht mehr
    // auseinanderzuhalten — dabei ist der Unterschied entscheidend
    // (kein APNs-Token = transient und retrybar, Rules/offline = nicht).
    let token: string | null = null;
    try {
      token = await Messaging().getToken();
    } catch (e: any) {
      console.warn('[fcm] getToken failed:', e?.message);
      void recordState(uid, 'token_failed', String(e?.message ?? e).slice(0, 200));
      return () => {};
    }

    if (token) {
      try {
        await persistToken(uid, token);
      } catch (e: any) {
        console.warn('[fcm] persistToken failed:', e?.message);
        void recordState(uid, 'write_failed', String(e?.message ?? e).slice(0, 200));
        return () => {};
      }
      _registered = true;
      void recordState(uid, 'ok');
    } else {
      // getToken() lieferte leer, ohne zu werfen — auf iOS moglich,
      // wenn der APNs-Token beim Aufruf noch nicht vorliegt.
      void recordState(uid, 'token_failed', 'empty_token');
    }

    // Refresh listener — fires when Apple / Google rotates the token.
    // Wichtig fur den leeren-Token-Fall oben: dort kehren wir NICHT
    // zuruck, der Listener fangt den Token also nach, sobald APNs ihn
    // liefert. Ein geworfenes getToken() steigt dagegen vorher aus —
    // das ist der bekannte fehlende Retry (Handover Punkt 4), bewusst
    // noch nicht angefasst, bis die Telemetrie zeigt, ob der Fall
    // uberhaupt eintritt.
    const unsubscribe = Messaging().onTokenRefresh(async (newToken: string) => {
      if (!newToken) return;
      try {
        await persistToken(uid, newToken);
        void recordState(uid, 'ok', 'via_refresh');
      } catch (e: any) {
        console.warn('[fcm] persist on refresh failed:', e);
        void recordState(uid, 'write_failed', `refresh: ${String(e?.message ?? e).slice(0, 180)}`);
      }
    });

    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  } catch (e: any) {
    // Alles, was oberhalb noch werfen kann — im Wesentlichen
    // requestPermission(). Vorher endete das hier stumm.
    console.warn('[fcm] registerFcmTokenForUser failed:', e?.message);
    void recordState(uid, 'token_failed', `outer: ${String(e?.message ?? e).slice(0, 180)}`);
    return () => {};
  }
}

export function isFcmRegistered(): boolean {
  return _registered;
}
