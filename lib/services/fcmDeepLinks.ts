/**
 * Deep-Link-Routing für FCM-Push-Taps (ClickUp 86cb7gfc9).
 *
 * Pushes werden von @react-native-firebase/messaging zugestellt (RNFB
 * swizzled den AppDelegate) — expo-notifications' Response-Listener und
 * getLastNotificationResponseAsync() sehen FCM-Taps deshalb NIE. Das
 * gesamte Routing (resolveDeepLink/navigateToDeepLink) existierte schon,
 * hing aber nur an expo-notifications → jeder Push-Tap landete auf Home.
 * Hier die RNFB-eigenen Kanäle:
 *   • onNotificationOpenedApp — App war im Hintergrund, User tippt.
 *   • getInitialNotification  — App war beendet (Cold Start durch Tap).
 *
 * Aufrufer: PushNotificationProvider (Mount-Effect, nach 500 ms — gleicher
 * "Root-Navigator steht"-Puffer wie der expo-Cold-Start-Pfad daneben).
 */

import { doc, serverTimestamp, setDoc } from '@react-native-firebase/firestore';

import { auth, db } from '@/lib/firebase';
import { getMessagingModule } from './fcmTokenService';
import { extractDeepLink, navigateToDeepLink } from './pushDeepLinks';

let wired = false;

/**
 * Push-Open protokollieren (86cb22c0m): schreibt users/{uid}/push_events/
 * {pushId} — Doc-ID = pushId macht Doppel-Taps idempotent (Rules erlauben
 * nur create). Serverseitig joinbar gegen push_log/{pushId} (Send-Log) und
 * receipts/crowd_uploads (Konversion). Fire-and-forget, darf nie das
 * Routing blockieren.
 */
function recordPushOpen(data: any): void {
  try {
    const pushId = typeof data?.pushId === 'string' && data.pushId ? data.pushId : null;
    if (!pushId) return; // Alt-Pushes ohne pushId — nichts zu tracken
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    void setDoc(doc(db, `users/${uid}/push_events/${pushId}`), {
      pushId,
      kind: typeof data?.kind === 'string' ? data.kind : null,
      deepLink: typeof data?.deepLink === 'string' ? data.deepLink : null,
      openedAt: serverTimestamp(),
    }).catch(() => {});
  } catch {
    /* Tracking ist best-effort */
  }
}

/**
 * Registriert Tap-Handler + holt die Cold-Start-Notification nach.
 * Idempotent (Doppel-Mount-Schutz); Rückgabe = Cleanup, das auch das
 * wired-Flag zurücksetzt, damit ein echter Remount neu verdrahten kann.
 */
export async function wireFcmNotificationTaps(): Promise<() => void> {
  if (wired) return () => {};
  const Messaging = await getMessagingModule();
  if (!Messaging) return () => {};
  wired = true;

  // Hintergrund-Tap → Navigator steht bereits, direkt routen.
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = Messaging().onNotificationOpenedApp((remoteMessage: any) => {
      recordPushOpen(remoteMessage?.data);
      const link = extractDeepLink(remoteMessage?.data);
      if (link) navigateToDeepLink(link);
    });
  } catch (e: any) {
    console.warn('[fcm] onNotificationOpenedApp wiring failed:', e?.message);
  }

  // Cold Start: die Notification abholen, deren Tap die App geöffnet hat.
  try {
    const initial = await Messaging().getInitialNotification();
    if (initial?.data) recordPushOpen(initial.data);
    const link = extractDeepLink(initial?.data);
    if (link) navigateToDeepLink(link);
  } catch (e: any) {
    console.warn('[fcm] getInitialNotification failed:', e?.message);
  }

  return () => {
    wired = false;
    if (typeof unsubscribe === 'function') unsubscribe();
  };
}
