/**
 * Die Push-Einstellung des Nutzers — an EINER Stelle (ClickUp 86cbfdq5j).
 *
 * ═══ Warum das ein eigenes Modul ist ═══
 *
 * Vorher gab es diese Einstellung dreimal, und keine der drei Stellen war
 * die Wahrheit:
 *
 *   1. `isEnabled` im PushNotificationProvider — abgeleitet allein aus der
 *      iOS-Systemberechtigung. Beim nächsten Wechsel in den Vordergrund
 *      stand der Schalter wieder auf AN, obwohl der Nutzer ihn eben erst
 *      ausgeschaltet hatte.
 *   2. `pushTokens/{token}.active` — ein Dokument, das der Server nie liest
 *      (er liest `users/{uid}/fcmTokens/*`, eine andere Sammlung aus einem
 *      anderen Push-System).
 *   3. `users/{uid}.pushNotificationsEnabled` — geschrieben, aber nirgends
 *      gelesen, und nur dann, wenn zufällig in derselben Sitzung ein
 *      Expo-Token geholt worden war.
 *
 * Das Ergebnis war ein Schalter, der nichts von dem tat, was er versprach.
 *
 * ═══ Wer hat recht: Gerät oder Server? ═══
 *
 * **Der Server.** `users/{uid}.pushNotificationsEnabled` entscheidet über
 * den Versand (cloud-functions/cashback-pipeline/lib/pushPolicy.js) und gilt
 * für das ganze Konto, nicht für ein Gerät. Die lokale Kopie existiert nur,
 * damit die Oberfläche sofort und auch ohne Netz stimmt.
 *
 * Diese Richtung ist nicht beliebig, sie schließt einen stillen Totalausfall:
 * Wer auf dem Tablet abbestellt und danach das Handy neu installiert, hätte
 * mit einer rein lokalen Wahrheit dort einen Schalter auf „Aktiv" gesehen —
 * bei einem Server, der dauerhaft nichts mehr sendet. Ein Fehler ohne
 * Fehlermeldung, den niemand je gemeldet hätte. Deshalb gleicht
 * `abgleichenMitServer()` beim Start ab.
 *
 * Die eine Ausnahme: hat der Nutzer gerade selbst umgeschaltet und ist der
 * Abgleich noch nicht durchgekommen (Funkloch), gewinnt das Gerät — sonst
 * überschriebe der alte Serverstand die frische Entscheidung.
 *
 * ═══ Systemberechtigung ≠ Wunsch des Nutzers ═══
 *
 * Zwei verschiedene Dinge, die vorher in ein einziges Boolean gepresst
 * waren. iOS sagt, ob wir DÜRFEN; diese Einstellung sagt, ob der Nutzer
 * WILL. Nachrichten gehen nur raus, wenn beides zutrifft. Wer die
 * Berechtigung in den Systemeinstellungen wieder erteilt, hat damit noch
 * nicht seine Abbestellung zurückgenommen.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc } from '@react-native-firebase/firestore';

import { db } from '@/lib/firebase';

const PREF_KEY = 'push_pref_v1';
/**
 * Merker für einen Abgleich, der den Server nie erreicht hat.
 *
 * Firestore-Schreibvorgänge lösen erst bei Server-Bestätigung auf und
 * hängen offline unbegrenzt, ohne je zu scheitern (Projektregel). Ein
 * `catch` fängt diesen Fall also NICHT. Deshalb: Merker VOR dem Schreiben
 * setzen, nach der Bestätigung löschen — und beim nächsten Start nachholen,
 * was offen blieb. Ohne das könnte jemand seine Abbestellung im Funkloch
 * vornehmen und weiter Nachrichten bekommen.
 *
 * Der Merker wird auch dann gesetzt, wenn beim Umschalten noch KEINE uid
 * feststand (Anmelde-Übergang, Boot-Race). Genau dort wäre die Entscheidung
 * sonst spurlos verschwunden: kein Schreibvorgang und nichts zum Nachholen.
 */
const PENDING_KEY = 'push_pref_pending_v1';

/** Standard ist AN — niemand hat abbestellt, bis er es tut. */
const STANDARD = true;

const alsWert = (v: string | null): boolean | null =>
  v === 'aus' ? false : v === 'an' ? true : null;
const alsText = (an: boolean): string => (an ? 'an' : 'aus');

/**
 * Die lokale Kopie merkt sich, WESSEN Entscheidung sie ist.
 *
 * Ohne diese Zuordnung wandert eine Abbestellung auf ein fremdes Konto:
 * Auf einem Familien-Gerät bestellt A ab, meldet sich ab, B meldet sich an.
 * Das Nutzerdokument von B kennt das Feld nicht — so wie bei 283.728 von
 * 283.756 Konten — also griffe die „lokale Abbestellung nachtragen"-Regel
 * und schriebe B ein `false`, das B nie gewählt hat. Dasselbe nach jedem
 * `logout()`, weil dabei eine neue anonyme Kennung entsteht, die eine
 * spätere Kontoverknüpfung behält.
 */
type Gemerkt = { uid: string | null; wert: boolean };

function lesen(roh: string | null): Gemerkt | null {
  if (!roh) return null;
  // Kurzform aus der ersten Fassung („an" / „aus", ohne Kennung).
  const kurz = alsWert(roh);
  if (kurz !== null) return { uid: null, wert: kurz };
  try {
    const o = JSON.parse(roh);
    if (typeof o?.wert === 'boolean') {
      return { uid: typeof o.uid === 'string' ? o.uid : null, wert: o.wert };
    }
  } catch {
    /* unlesbar → wie nicht vorhanden */
  }
  return null;
}

const schreiben = (g: Gemerkt) => JSON.stringify(g);

/**
 * Was gilt auf DIESEM Gerät gerade? Rein lokal, also sofort verfügbar —
 * für den ersten Bildschirmaufbau, bevor das Profil geladen ist.
 * Fehlt der Wert (nie angefasst, frische Installation), gilt AN.
 *
 * Die Zuordnung zum Konto prüft erst `abgleichenMitServer`: bis dahin ist
 * die Anzeige im ungünstigsten Fall kurz falsch, gesendet wird aber immer
 * nach dem Serverstand.
 */
export async function getPushPreference(): Promise<boolean> {
  try {
    return lesen(await AsyncStorage.getItem(PREF_KEY))?.wert ?? STANDARD;
  } catch {
    // Speicher nicht lesbar — lieber senden als stumm bleiben.
    return STANDARD;
  }
}

/**
 * Einstellung setzen: erst merken, dann lokal, dann zum Server spiegeln.
 *
 * Bewusst wird der lokale Schreibvorgang abgewartet, der entfernte NICHT:
 * die Oberfläche darf nicht am Netz hängen, aber der nächste Lesevorgang
 * muss den neuen Wert schon sehen (sonst springt der Schalter zurück —
 * dieselbe Falle wie beim Coachmark-Dismiss, siehe CLAUDE.md).
 */
export async function setPushPreference(uid: string | null, an: boolean): Promise<void> {
  // Der Merker steht VOR allem anderen und unabhängig von der uid: er ist
  // die einzige Spur, falls der Abgleich nicht durchkommt.
  try {
    await AsyncStorage.setItem(PENDING_KEY, alsText(an));
  } catch {
    /* Merker ist Absicherung, kein Muss */
  }
  try {
    await AsyncStorage.setItem(PREF_KEY, schreiben({ uid, wert: an }));
  } catch (e: any) {
    console.warn('[push-pref] lokal speichern fehlgeschlagen:', e?.message);
  }
  if (uid) void spiegelnZumServer(uid, an);
}

/** Den lokalen Stand ans Nutzerdokument schreiben. Fire-and-forget. */
async function spiegelnZumServer(uid: string, an: boolean): Promise<void> {
  try {
    await setDoc(doc(db, 'users', uid), { pushNotificationsEnabled: an }, { merge: true });
    await AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
  } catch (e: any) {
    // Offline löst das gar nicht auf, hier landen nur echte Fehler
    // (Regeln, kaputtes Dokument). Der Merker bleibt stehen und der
    // nächste Start holt es nach.
    console.warn('[push-pref] Abgleich mit dem Server fehlgeschlagen:', e?.message);
  }
}

/**
 * Gerät und Server in Deckung bringen — einmal beim Start, sobald das
 * Nutzerprofil geladen ist.
 *
 * `serverWert` kommt aus dem ohnehin geladenen Profil (`useAuth().userProfile`),
 * kostet also KEINEN zusätzlichen Firestore-Zugriff. Das ist bei 283.756
 * Konten der Unterschied zwischen „umsonst" und „ein Read pro App-Start".
 *
 * @returns der Wert, der ab jetzt gilt
 */
export async function abgleichenMitServer(
  uid: string | null,
  serverWert: unknown,
): Promise<boolean> {
  let gemerkt: Gemerkt | null = null;
  try {
    gemerkt = lesen(await AsyncStorage.getItem(PREF_KEY));
  } catch {
    /* ohne lokalen Wert weiter */
  }
  if (!uid) return gemerkt?.wert ?? STANDARD;

  // Gehört der gemerkte Wert zu einem ANDEREN Konto, ist er für dieses hier
  // keine Aussage. `uid: null` heißt „gesetzt, bevor jemand angemeldet war"
  // — das ist die eigene Entscheidung aus dem Anmelde-Übergang und zählt.
  const gehoertUns = !gemerkt || gemerkt.uid === null || gemerkt.uid === uid;
  const lokal = gehoertUns ? (gemerkt?.wert ?? STANDARD) : STANDARD;

  let offen: boolean | null = null;
  try {
    offen = alsWert(await AsyncStorage.getItem(PENDING_KEY));
  } catch {
    /* ohne Merker weiter */
  }

  // 1. Eigene Entscheidung wartet noch auf den Abgleich → sie gewinnt.
  //    Sonst überschriebe der veraltete Serverstand eine Abbestellung,
  //    die im Funkloch getroffen wurde. Auch hier nur, wenn sie zu diesem
  //    Konto gehört.
  if (offen !== null && gehoertUns) {
    console.log('[push-pref] offener Abgleich wird nachgeholt:', alsText(offen));
    void spiegelnZumServer(uid, offen);
    await merken(uid, offen);
    return offen;
  }
  if (offen !== null && !gehoertUns) {
    // Merker eines anderen Kontos — er darf hier weder wirken noch liegen
    // bleiben, sonst wandert er beim nächsten Start doch noch herüber.
    await AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
  }

  // 2. Der Server hat eine Aussage → sie gilt, kontoweit.
  if (serverWert === true || serverWert === false) {
    await merken(uid, serverWert);
    return serverWert;
  }

  // 3. Der Server weiß nichts. Steht für DIESES Konto lokal eine
  //    Abbestellung, ist sie nie angekommen — jetzt nachtragen.
  if (gehoertUns && lokal === false) {
    console.log('[push-pref] lokale Abbestellung war dem Server unbekannt — wird nachgetragen');
    void spiegelnZumServer(uid, false);
  }
  if (!gehoertUns) await merken(uid, STANDARD);
  return lokal;
}

/** Lokale Kopie auf den Stand dieses Kontos bringen. */
async function merken(uid: string, wert: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, schreiben({ uid, wert }));
  } catch {
    /* nächster Start versucht es erneut */
  }
}

/** Nur für Tests: den lokalen Stand zurücksetzen. */
export async function _resetPushPreferenceForTests(): Promise<void> {
  await AsyncStorage.removeItem(PREF_KEY).catch(() => {});
  await AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
}
