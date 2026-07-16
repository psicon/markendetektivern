import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInWithCustomToken } from '@react-native-firebase/auth';
import { auth } from '@/lib/firebase';
import { isEffectivelyAnonymous } from '@/lib/utils/authIdentity';
import { findLegacyAuthKey, parseLegacyAuthRecord } from '@/lib/utils/legacyAuthRecord';

/**
 * Session-Rettung 5.x→6.0 (Audit 12.07.2026).
 *
 * Das 6.0-Update (RNFirebase-Migration) verliert die Auth-Session: das alte
 * WEB-SDK persistierte sie in AsyncStorage, das native SDK liest Keychain/
 * SharedPrefs. Folge: Bestands-Gäste bekamen beim ersten 6.0-Boot eine
 * FRISCHE Anon-UID (Punkte/Ersparnis/Käufe am alten Konto verwaist),
 * Registrierte wurden ausgeloggt. Der alte Session-Eintrag inkl.
 * Refresh-Token liegt aber weiterhin im AsyncStorage.
 *
 * Ablauf: Legacy-Eintrag finden → Refresh-Token an die CF
 * `rescueLegacySession` (europe-west3) → die tauscht ihn bei securetoken ein
 * (Besitznachweis) und prägt einen Custom-Token der ALTEN UID → hier
 * signInWithCustomToken → das Gerät ist wieder sein altes Ich. Keine
 * Datenbewegung, kein Merge — die sicherste Form der Reparatur.
 *
 * Zustands-Maschine (AsyncStorage, nur dieser Service schreibt die Keys):
 *   'done'  — gerettet ODER bewusst nicht nötig (Session überlebt /
 *             User hat sich aktiv in ein Konto eingeloggt). Endzustand.
 *   'none'  — kein/korrupter Legacy-Eintrag oder Token endgültig ungültig
 *             ('gone'). Endzustand.
 *   (unset) — noch nicht versucht oder transient gescheitert → nächster
 *             Boot versucht erneut (max. MAX_ATTEMPTS).
 *
 * WICHTIG: Ein per Custom-Token geretteter GAST hat `isAnonymous === false`
 * bei leerem providerData — app-weit gilt darum isEffectivelyAnonymous()
 * als die eine Gast-Definition (siehe lib/utils/authIdentity.ts).
 */

const KEY_STATE = 'legacy_rescue_v1_state';
const KEY_ATTEMPTS = 'legacy_rescue_v1_attempts';
const MAX_ATTEMPTS = 10;

const REGION = 'europe-west3';
const PROJECT = 'markendetektive-895f7';
const CALLABLE_URL = `https://${REGION}-${PROJECT}.cloudfunctions.net/rescueLegacySession`;

let inflight: Promise<boolean> | null = null;

/**
 * Versucht die Rettung. true = Gerät wurde soeben in die alte Session
 * eingemeldet (onAuthStateChanged feuert; der Aufrufer soll KEINEN neuen
 * Anon-User mehr anlegen). false = nichts (mehr) zu tun / später erneut.
 * Wirft nie — Auth-Boot darf hieran niemals scheitern.
 */
export async function attemptLegacySessionRescue(): Promise<boolean> {
  if (inflight) return inflight;
  inflight = doAttempt().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Rettung terminal abschließen — für den EXPLIZITEN Logout (Audit 2026-07-16).
 * Ohne das konnte der Post-Logout-Anon-Login die Rettung erneut anstoßen und
 * den User still zurück ins gerade abgemeldete Konto einloggen (der 5.x-
 * Refresh-Token überlebt signOut; das Rescue-State-Key blieb unset, wenn die
 * ersten Boots nach dem Update offline waren und der User sich danach manuell
 * einloggte). Ein bewusster Logout ist eine Identitäts-Entscheidung — danach
 * darf die Rettung nie wieder feuern. Wirft nie.
 */
export async function markLegacyRescueDone(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_STATE, 'done');
  } catch {
    /* non-fatal — schlimmstenfalls bleibt das bisherige Verhalten */
  }
}

async function doAttempt(): Promise<boolean> {
  try {
    const state = await AsyncStorage.getItem(KEY_STATE);
    if (state === 'done' || state === 'none') return false;
    const attempts = Number(await AsyncStorage.getItem(KEY_ATTEMPTS)) || 0;
    if (attempts >= MAX_ATTEMPTS) return false;

    const keys = await AsyncStorage.getAllKeys();
    const legacyKey = findLegacyAuthKey(keys);
    if (!legacyKey) {
      // Echter Neu-Install (kein 5.x-Rest) — nie wieder prüfen.
      await AsyncStorage.setItem(KEY_STATE, 'none');
      return false;
    }
    const record = parseLegacyAuthRecord(await AsyncStorage.getItem(legacyKey));
    if (!record) {
      await AsyncStorage.setItem(KEY_STATE, 'none');
      return false;
    }

    const current = auth.currentUser;
    if (current && current.uid === record.uid) {
      // Session hat überlebt (oder Rettung lief bereits) — fertig.
      await AsyncStorage.setItem(KEY_STATE, 'done');
      return false;
    }
    if (current && !isEffectivelyAnonymous(current)) {
      // User hat sich seit dem Update AKTIV in ein Konto eingeloggt —
      // niemals aus einem bewusst gewählten Konto herausreißen.
      await AsyncStorage.setItem(KEY_STATE, 'done');
      return false;
    }

    await AsyncStorage.setItem(KEY_ATTEMPTS, String(attempts + 1));

    // CF aufrufen. Bewusst OHNE Auth-Pflicht (im „registrierte Session
    // verloren"-Pfad existiert kein currentUser) — der Refresh-Token IST
    // der Besitznachweis. Bearer mitschicken, wenn vorhanden (Logging).
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (current) {
      try {
        headers.Authorization = `Bearer ${await current.getIdToken()}`;
      } catch {
        // ohne Bearer weiter — CF braucht ihn nicht
      }
    }
    const res = await fetch(CALLABLE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: { refreshToken: record.refreshToken } }),
    });
    const json: any = await res.json().catch(() => ({}));
    const result = json?.result ?? json;

    if (!res.ok) {
      // onCall-Fehler: 'unavailable' u.ä. → transient, nächster Boot.
      console.warn('[legacyRescue] CF-Fehler (retry beim nächsten Boot):', res.status, json?.error?.status);
      return false;
    }
    if (result?.status === 'gone') {
      // Token endgültig wertlos (Konto weg/deaktiviert/Token revoked).
      await AsyncStorage.setItem(KEY_STATE, 'none');
      return false;
    }
    if (result?.status === 'same') {
      await AsyncStorage.setItem(KEY_STATE, 'done');
      return false;
    }
    if (result?.status !== 'ok' || !result?.customToken) {
      console.warn('[legacyRescue] Unerwartete CF-Antwort:', JSON.stringify(result).slice(0, 200));
      return false;
    }

    // Zurück in die alte Identität. onAuthStateChanged übernimmt den Rest
    // (Profil, Gamification, Journeys — alles Standard-User-Wechsel).
    // BEWUSST OHNE User-Feedback: die Reparatur ist unsichtbar-instant
    // beim Boot; ein Toast würde nur auf ein Problem hinweisen, das der
    // User nie bemerkt hat (Copy-Regel: nie Frustration erzeugen).
    await signInWithCustomToken(auth, result.customToken);
    await AsyncStorage.setItem(KEY_STATE, 'done');
    console.log('✅ [legacyRescue] Alte Session wiederhergestellt:', result.oldUid, '(registriert:', result.oldWasRegistered, ')');
    return true;
  } catch (e) {
    // Nie werfen — Boot-Pfad. Transient → nächster Boot probiert erneut.
    console.warn('[legacyRescue] Versuch fehlgeschlagen (non-fatal):', (e as any)?.message);
    return false;
  }
}
