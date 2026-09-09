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
 *   permission_denied → iOS-Berechtigung ausdrücklich abgelehnt
 *   permission_not_determined → nie gefragt (oder Dialog steht noch aus)
 *   token_failed      → getToken() warf (typisch: kein APNs-Token da)
 *   write_failed      → persistToken() warf (Rules, offline)
 */
export type FcmState =
  | 'ok'
  | 'no_module'
  /** Der Nutzer hat den System-Dialog ausdrücklich abgelehnt (iOS: endgültig). */
  | 'permission_denied'
  /**
   * Es wurde nie gefragt — entweder weil der Dialog noch aussteht oder weil
   * wir bewusst nur provisorisch registrieren.
   *
   * Bis zum 09.09.2026 fielen beide Fälle unter `permission_denied`, und die
   * Unterscheidung steckte nur im Freitext `reason`. Das hat prompt zu einer
   * Fehldeutung geführt: In React Native Firebase ist `DENIED = 0` und
   * `NOT_DETERMINED = -1` — wer das verwechselt, liest 10.665 Ablehnungen als
   * „nie gefragt" und baut die falsche Abhilfe.
   */
  | 'permission_not_determined'
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
export function isMessagingLinked(): boolean {
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

export async function getMessagingModule(): Promise<any | null> {
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
 * Token registrieren — ABER NUR, wenn die Erlaubnis schon vorliegt.
 *
 * Fragt selbst nichts und holt ohne Erlaubnis auch keinen Token (§ 25
 * TDDDG, siehe unten). Für Rückkehrer, die längst zugestimmt haben, ist das
 * der Weg, auf dem sich ein erneuerter Token einträgt. Für alle anderen ist
 * es ein Nichtstuer — bis der Nutzer im erklärenden Sheet zustimmt und
 * `harteBerechtigungAnfragen` übernimmt.
 *
 * Idempotent, gefahrlos bei jedem Mount aufrufbar.
 * Rückgabe: Aufräumfunktion für den onTokenRefresh-Hörer.
 */
export async function registerFcmTokenForUser(uid: string): Promise<() => void> {
  const Messaging = await getMessagingModule();
  if (!Messaging) {
    void recordState(uid, 'no_module');
    return () => {};
  }

  try {
    // ═══ HIER WIRD NICHT GEFRAGT — und ohne Erlaubnis auch nichts geholt ═══
    //
    // Zwei Gründe, und der zweite wiegt schwerer als der erste.
    //
    // 1. Der Dialog ist eine Ressource, die man einmal ausgibt. Bis zum
    //    09.09.2026 gab die App sie beim allerersten Öffnen aus, anonym,
    //    ohne Zusammenhang: von 33.841 iOS-Konten haben 10.665 abgelehnt.
    //    Auf iOS ist das endgültig.
    //
    // 2. Das Abholen des Geräte-Tokens ist selbst schon ein Zugriff auf das
    //    Endgerät und braucht eine Einwilligung (§ 25 TDDDG). Die
    //    veröffentlichte Datenschutzerklärung nennt dafür ausdrücklich die
    //    Zustimmung des Nutzers als Rechtsgrundlage. Ein Token, den wir
    //    holen, bevor jemand ein Wort gelesen hat, ist von dieser Erklärung
    //    nicht gedeckt — egal wie nützlich er wäre.
    //
    // Diese Funktion registriert deshalb NUR, wenn die Erlaubnis bereits
    // vorliegt: bei Rückkehrern, deren Token sich erneuern muss. Gefragt
    // wird ausschließlich über `harteBerechtigungAnfragen`, und die ruft
    // der Provider erst, nachdem der Nutzer im erklärenden Sheet
    // ausdrücklich zugestimmt hat.
    let erlaubt = false;
    try {
      const authStatus = await Messaging().hasPermission();
      erlaubt =
        authStatus === Messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === Messaging.AuthorizationStatus.PROVISIONAL;
      if (!erlaubt) {
        void recordState(
          uid,
          authStatus === Messaging.AuthorizationStatus.DENIED
            ? 'permission_denied'
            : 'permission_not_determined',
          `beim_start authStatus=${authStatus}`,
        );
        return () => {};
      }
    } catch (e: any) {
      // Nicht lesbar heißt nicht erlaubt. Fail-closed ist hier richtig: ein
      // Fehler darf nicht dazu führen, dass wir ohne Erlaubnis registrieren.
      console.warn('[fcm] Berechtigungsstand nicht lesbar:', e?.message);
      void recordState(uid, 'permission_not_determined', `lesefehler: ${String(e?.message ?? e).slice(0, 120)}`);
      return () => {};
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

/**
 * Die HARTE Berechtigung anfragen — der eine System-Dialog.
 *
 * Der EINZIGE Weg, auf dem diese App je nach Erlaubnis fragt — und damit
 * auch der einzige, auf dem je ein Token entsteht.
 *
 * Nur aufrufen, nachdem der Nutzer im erklärenden Sheet ausdrücklich Ja
 * gesagt hat (`PrePermissionSheet`). Dieses Ja IST die Einwilligung im
 * Sinne der Datenschutzerklärung; der System-Dialog danach regelt nur noch,
 * wie laut zugestellt wird. Danach ist die Gelegenheit verbraucht:
 * lehnt er hier ab, lässt iOS den Dialog nie wieder zu, und nur der Weg über
 * die Systemeinstellungen bleibt.
 *
 * Nach dem Ja wird der Token geholt und gespeichert — vorher nie.
 *
 * @returns true, wenn danach die volle Erlaubnis vorliegt.
 */
export async function harteBerechtigungAnfragen(uid: string): Promise<boolean> {
  const Messaging = await getMessagingModule();
  if (!Messaging) {
    void recordState(uid, 'no_module');
    return false;
  }
  try {
    // Android: über expo-notifications, weil RNFB dort nicht fragt (siehe
    // oben). iOS: über RNFB, weil dort auch die provisorische Stufe hängt.
    if (Platform.OS === 'android') {
      const Notifications = require('expo-notifications');
      const { status } = await Notifications.requestPermissionsAsync();
      const erteilt = status === 'granted';
      if (!erteilt) {
        void recordState(
          uid,
          status === 'denied' ? 'permission_denied' : 'permission_not_determined',
          `android nach_sheet status=${status}`,
        );
        return false;
      }
      try {
        const token = await Messaging().getToken();
        if (token) await persistToken(uid, token);
        void recordState(uid, 'ok', 'android nach_sheet');
      } catch (e: any) {
        void recordState(uid, 'token_failed', `android nach_sheet: ${String(e?.message ?? e).slice(0, 140)}`);
      }
      return true;
    }

    const authStatus = await Messaging().requestPermission({
      alert: true,
      badge: true,
      sound: true,
    });
    const voll = authStatus === Messaging.AuthorizationStatus.AUTHORIZED;
    if (!voll) {
      void recordState(
        uid,
        authStatus === Messaging.AuthorizationStatus.DENIED
          ? 'permission_denied'
          : 'permission_not_determined',
        `nach_sheet authStatus=${authStatus}`,
      );
      return false;
    }
    try {
      const token = await Messaging().getToken();
      if (token) await persistToken(uid, token);
      void recordState(uid, 'ok', 'nach_sheet');
    } catch (e: any) {
      void recordState(uid, 'token_failed', `nach_sheet: ${String(e?.message ?? e).slice(0, 160)}`);
    }
    return true;
  } catch (e: any) {
    console.warn('[fcm] harte Anfrage fehlgeschlagen:', e?.message);
    void recordState(uid, 'token_failed', `sheet_outer: ${String(e?.message ?? e).slice(0, 160)}`);
    return false;
  }
}

export function isFcmRegistered(): boolean {
  return _registered;
}
