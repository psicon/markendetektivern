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

import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { doc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { db } from '@/lib/firebase';

let _registered = false;

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

async function persistToken(uid: string, token: string): Promise<void> {
  const id = tokenDocId(token);
  await setDoc(
    doc(db, `users/${uid}/fcmTokens/${id}`),
    {
      token,
      platform: Platform.OS,
      addedAt: serverTimestamp(),
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
  if (!Messaging) return () => {};

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
        return () => {};
      }
    } else if (Platform.OS === 'android') {
      // Android 13+ runtime POST_NOTIFICATIONS permission — handled by
      // requestPermission() too (no-op on older Android).
      try {
        await Messaging().requestPermission();
      } catch {}
    }

    const token = await Messaging().getToken();
    if (token) {
      await persistToken(uid, token);
      _registered = true;
    }

    // Refresh listener — fires when Apple / Google rotates the token.
    const unsubscribe = Messaging().onTokenRefresh(async (newToken: string) => {
      if (!newToken) return;
      try {
        await persistToken(uid, newToken);
      } catch (e) {
        console.warn('[fcm] persist on refresh failed:', e);
      }
    });

    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  } catch (e: any) {
    console.warn('[fcm] registerFcmTokenForUser failed:', e?.message);
    return () => {};
  }
}

export function isFcmRegistered(): boolean {
  return _registered;
}
