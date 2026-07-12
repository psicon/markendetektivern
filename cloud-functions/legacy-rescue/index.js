/**
 * rescueLegacySession — Callable Cloud Function (Session-Rettung 5.x→6.0).
 *
 * Hintergrund (Befund 12.07.2026): Die 5.x-App (Firebase WEB-SDK) hielt die
 * Auth-Session in AsyncStorage, die 6.0-App (RNFirebase, nativ) liest den
 * Keychain/SharedPrefs — die Stores sind getrennt. Beim Update verliert das
 * Gerät seine Identität; der Boot legt einen FRISCHEN Anon-User an. Punkte/
 * Ersparnis/Käufe/Guthaben hängen an der alten UID und sind für den User weg.
 *
 * Rettung: Der alte Web-SDK-Eintrag (`firebase:authUser:…`) liegt weiterhin
 * im AsyncStorage und enthält den REFRESH-TOKEN der alten Session. Der Client
 * schickt ihn hierher; wir tauschen ihn bei securetoken.googleapis.com ein —
 * ein gültiger Tausch ist der kryptografische BESITZNACHWEIS der alten
 * Identität (der Token wurde von Firebase nur an dieses Gerät ausgegeben).
 * Dann prägen wir einen Custom-Token für die ALTE UID; der Client meldet sich
 * damit wieder als sein altes Ich an. Keinerlei Daten werden bewegt — Geld,
 * Historie, Gamification bleiben unangetastet an ihrer UID.
 *
 * Sicherheit: Kein Privilegien-Gewinn — wer den Refresh-Token besitzt, kann
 * ohnehin direkt bei securetoken ID-Tokens für diese UID beziehen. Die CF
 * verlangt bewusst KEINE Authentifizierung: im „registrierte Session
 * verloren"-Pfad existiert noch gar kein aktueller User (AuthContext legt
 * dort absichtlich keinen Anon an).
 *
 * Rückgaben (status): 'ok' (+customToken) · 'same' (Session hat überlebt) ·
 * 'gone' (Token ungültig/User gelöscht/deaktiviert — Client soll aufgeben).
 * Transiente Fehler → HttpsError('unavailable') — Client versucht es beim
 * nächsten Boot erneut.
 *
 * Beobachtbarkeit: legacy_rescues/{oldUid} (server-only, kein Rules-Eintrag
 * nötig — Whitelist-Rules verweigern Clients per Default).
 *
 * Region: europe-west3 (v2, wie shared-lists).
 * Deploy: `firebase deploy --only functions:legacy-rescue` (Node 22,
 * vorher npm install im Ordner — Learning aus shared-lists).
 */

const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west3';

// Der Web-API-Key der 5.x-App (letzter Web-SDK-Stand von lib/firebase.ts,
// Commit 039d1cf~1 — validiert 12.07.2026). Public per Design — er
// identifiziert nur das Projekt beim Token-Tausch. Refresh-Tokens sind
// PROJEKT-gebunden, nicht key-gebunden; sollte der Key je rotiert werden,
// hier einfach einen anderen gültigen Projekt-Key eintragen.
const LEGACY_WEB_API_KEY = 'AIzaSyCVQ-Y71TNexRKSWrVtu1HTP9uk_dSfUP0';

// securetoken-Fehlercodes, bei denen der Token endgültig wertlos ist —
// der Client soll dann nicht weiter versuchen.
const PERMANENT_TOKEN_ERRORS = [
  'TOKEN_EXPIRED',
  'INVALID_REFRESH_TOKEN',
  'USER_DISABLED',
  'USER_NOT_FOUND',
  'MISSING_REFRESH_TOKEN',
  'INVALID_GRANT_TYPE',
];

exports.rescueLegacySession = onCall({ region: REGION }, async (request) => {
  const refreshToken = String((request.data && request.data.refreshToken) || '').trim();
  if (!refreshToken || refreshToken.length > 2048) {
    throw new HttpsError('invalid-argument', 'Kein gültiger Token übergeben.');
  }

  // 1) Besitznachweis: Refresh-Token bei securetoken einlösen.
  let exchange;
  try {
    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${LEGACY_WEB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      },
    );
    exchange = await res.json();
    if (!res.ok) {
      const code = String(
        (exchange && exchange.error && exchange.error.message) || '',
      );
      if (PERMANENT_TOKEN_ERRORS.some((p) => code.includes(p))) {
        logger.info('rescueLegacySession: Token endgültig ungültig', { code });
        return { status: 'gone' };
      }
      logger.warn('rescueLegacySession: securetoken-Fehler (transient?)', { code });
      throw new HttpsError('unavailable', 'Token-Prüfung derzeit nicht möglich.');
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    logger.warn('rescueLegacySession: securetoken nicht erreichbar', { msg: e.message });
    throw new HttpsError('unavailable', 'Token-Prüfung derzeit nicht möglich.');
  }

  // Die alte UID kommt AUS dem Tausch-Ergebnis — nie aus Client-Angaben.
  const oldUid = String(exchange.user_id || '');
  if (!oldUid) {
    logger.error('rescueLegacySession: Tausch ohne user_id', { keys: Object.keys(exchange || {}) });
    throw new HttpsError('internal', 'Unerwartete Antwort der Token-Prüfung.');
  }

  const callerUid = (request.auth && request.auth.uid) || null;
  if (callerUid === oldUid) {
    return { status: 'same', oldUid };
  }

  // 2) Altes Konto muss existieren + aktiv sein.
  let oldUser;
  try {
    oldUser = await admin.auth().getUser(oldUid);
  } catch (e) {
    logger.info('rescueLegacySession: altes Konto weg', { oldUid, code: e.code });
    return { status: 'gone' };
  }
  if (oldUser.disabled) {
    return { status: 'gone' };
  }

  // 3) Custom-Token für die alte UID prägen.
  const customToken = await admin.auth().createCustomToken(oldUid);
  const oldWasRegistered = (oldUser.providerData || []).length > 0;

  // 4) Mapping loggen (für Monitoring + evtl. spätere Zusammenführung der
  //    Zwischen-Identität). merge:true — Wiederholung ist idempotent.
  try {
    await db.doc(`legacy_rescues/${oldUid}`).set(
      {
        oldUid,
        interimUid: callerUid,
        oldWasRegistered,
        rescuedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    // Logging darf die Rettung nie verhindern.
    logger.warn('rescueLegacySession: Mapping-Log fehlgeschlagen', { msg: e.message });
  }

  logger.info('rescueLegacySession: OK', { oldUid, interimUid: callerUid, oldWasRegistered });
  return { status: 'ok', customToken, oldUid, oldWasRegistered };
});
