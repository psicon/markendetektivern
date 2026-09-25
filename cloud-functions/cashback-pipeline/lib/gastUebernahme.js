'use strict';

/**
 * Gast-Einreichungen in ein BESTEHENDES Konto übernehmen — Stufe 1
 * (Umbau „erst einreichen, dann Konto", 25.09.2026, Bauanleitung Schritte 9,
 * 12, 13, 17).
 *
 * ═══ Worum es geht ═══
 *
 * Ein Gast (anonyme uid A) reicht Bons und Produktfotos ein und bekommt die
 * Gutschrift sofort auf A. Legt er ein NEUES Konto an, wird verknüpft — die
 * uid bleibt, hier passiert nichts. Meldet er sich dagegen bei einem SCHON
 * BESTEHENDEN Konto B an, entsteht eine andere uid. Dann muss der Server
 * belegen können, dass der Aufrufer A wirklich besaß: nach dem Wechsel ist A
 * nicht mehr angemeldet, und RNFirebase gibt kein Refresh-Token heraus.
 *
 * Deshalb zwei Schritte:
 *   vorbereiten  — noch als A angemeldet: die App erzeugt ein Geheimnis,
 *                  speichert es sicher und schickt NUR dessen SHA-256-Hash.
 *   einloesen    — als B angemeldet: die App schickt das Geheimnis. Der Server
 *                  prüft es gegen die gespeicherten Hashes.
 * Besitz beider Seiten ist damit nachgewiesen, ohne dass der Server das
 * Geheimnis vor dem Einlösen je sieht.
 *
 * ═══ Was Stufe 1 tut — und was nicht ═══
 *
 * Stufe 1 sichert NUR den Besitznachweis. Einlösen prüft alles (Zielkonto,
 * Ticket, Ablauf, Hash) und antwortet dann IMMER `pausiert`, ohne zu binden.
 * Auch bei `cashback_config/v1.gastUebernahmeAktiv === true`: die Umbuchung
 * (Storno bei A, Gutschrift bei B, Deckel, Budget) kommt erst mit Stufe 2.
 * Ein Binden ohne die Umbuchung ließe A gesperrt und das Geld bei A liegen.
 *
 * Einziger Schreibvorgang beim Einlösen ist der Versuchszähler des Aufrufers
 * (`gast_uebernahme_ziele/{zielUid}.versuche`) — ohne ihn gäbe es keine
 * Bremse. Job, Nutzer und Auth bleiben unberührt.
 *
 * ═══ Regeln ═══
 *
 * - Geheimnis und Hash werden NIE geloggt, auch nicht gekürzt.
 * - Hash-Vergleich per `crypto.timingSafeEqual`, über ALLE gespeicherten
 *   Hashes ohne frühes Ende.
 * - Bewusst KEINE Sperre nach Fehlversuchen pro Gast: sonst könnte jeder, der
 *   eine Gast-uid kennt (leaderboards sind lesbar), dessen Ticket blockieren.
 *   Gebremst wird je Aufrufer (20 Versuche pro Stunde). Das Geheimnis hat
 *   256 Bit; Raten ist aussichtslos.
 * - Ein Infrastrukturfehler (getUser, Konfiguration) ist nie eine Aussage über
 *   den Nutzer: 503, die App versucht es später erneut. 4xx dagegen sind
 *   endgültig — die App löscht das Ticket bei 403/404/409/410.
 * - Nie den Token-Claim `sign_in_provider` verwenden. Direkt nach
 *   `linkWithCredential` kann er noch `anonymous` tragen; maßgeblich ist
 *   `getUser().providerData`.
 *
 * `db`, `admin`, `logger`, `loadConfig` und `zeit` werden übergeben, damit das
 * Modul ohne firebase-admin testbar ist.
 */

const crypto = require('crypto');

const JOBS = 'gast_uebernahmen';
const ZIELE = 'gast_uebernahme_ziele';

/** Ein Ticket gilt 30 Tage ab Anlage des Jobs. */
const GUELTIG_MS = 30 * 24 * 60 * 60 * 1000;
/** Höchstens so viele gültige Hashes je Gast (Doppeltipp, neuer Versuch). */
const MAX_HASHES = 5;
/** Höchstens so viele Vorbereitungen je Gast und Berliner Tag. */
const MAX_VORBEREITUNGEN_PRO_TAG = 10;
/** Höchstens so viele Einlöseversuche je Aufrufer und Stunde. */
const MAX_VERSUCHE_PRO_STUNDE = 20;

const HASH_RE = /^[0-9a-f]{64}$/;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const GEHEIMNIS_MIN = 16;
const GEHEIMNIS_MAX = 512;

/**
 * Token-Fehler, die wirklich „nicht angemeldet" heißen. Alles andere (Netz,
 * Schlüsselabruf, interner Fehler) ist Infrastruktur → 503, nicht 401: die App
 * wertet 4xx als endgültig und würde sonst ein gültiges Ticket verwerfen.
 */
const TOKEN_ABGELEHNT = new Set([
  'auth/argument-error',
  'auth/invalid-argument',
  'auth/invalid-id-token',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
]);

const antwort = (http, body) => ({ http, body });
const fehler = (http, code) => ({ http, body: { code } });

const tsMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);

function berlinTag(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

/** Laufende Stunde als lesbarer Schlüssel (UTC), z. B. '2026-09-25T14'. */
function stundenSchluessel(ms) {
  return new Date(ms).toISOString().slice(0, 13);
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * Passt das Geheimnis zu einem der gespeicherten Hashes? Vergleicht jeden
 * gültigen Eintrag in konstanter Zeit und bricht nicht beim ersten Treffer ab.
 */
function hashPasst(geheimnis, ticketHashes) {
  const ist = Buffer.from(sha256Hex(geheimnis), 'hex');
  let treffer = false;
  for (const h of Array.isArray(ticketHashes) ? ticketHashes : []) {
    if (typeof h !== 'string' || !HASH_RE.test(h)) continue;
    if (crypto.timingSafeEqual(ist, Buffer.from(h, 'hex'))) treffer = true;
  }
  return treffer;
}

/** Registriert = mindestens ein Anmeldeweg und nicht gesperrt. */
function istRegistriert(au) {
  return Boolean(au) && !au.disabled && Array.isArray(au.providerData) && au.providerData.length > 0;
}

/** Gast = kein Anmeldeweg und nicht gesperrt. */
function istGast(au) {
  return Boolean(au) && !au.disabled && Array.isArray(au.providerData) && au.providerData.length === 0;
}

/**
 * Darf dieses Konto Geld empfangen bzw. Ziel einer Übernahme sein?
 * Schritt 9: requestPayout ruft das mit `emailPflicht: true` VOR jeder Buchung.
 *
 * @returns {Promise<null | {http: number, body: {code: string}}>} null = ok
 */
async function kontoPruefen(admin, uid, { emailPflicht = false } = {}) {
  let au;
  try {
    au = await admin.auth().getUser(uid);
  } catch (e) {
    // Gelöscht ist eine Aussage über das Konto; alles andere ist Infrastruktur.
    if (e && e.code === 'auth/user-not-found') return fehler(403, 'konto_erforderlich');
    return fehler(503, 'konto_pruefung_fehlgeschlagen');
  }
  if (!istRegistriert(au)) return fehler(403, 'konto_erforderlich');
  if (emailPflicht && !au.email) return fehler(403, 'email_fehlt');
  return null;
}

/**
 * Bearer-Token streng prüfen (checkRevoked): ein gesperrter Gast oder ein
 * widerrufenes Token kommen nicht durch.
 *
 * @returns {Promise<{uid: string} | {fehler: {http: number, body: {code: string}}}>}
 */
async function tokenPruefen(admin, req, logger) {
  const kopf = String((req && req.headers && req.headers.authorization) || '');
  const m = kopf.match(/^Bearer\s+(.+)$/i);
  if (!m) return { fehler: fehler(401, 'unauthenticated') };
  try {
    const decoded = await admin.auth().verifyIdToken(m[1], true);
    if (!decoded || !decoded.uid) return { fehler: fehler(401, 'unauthenticated') };
    return { uid: decoded.uid };
  } catch (e) {
    const code = (e && e.code) || '';
    if (TOKEN_ABGELEHNT.has(code)) return { fehler: fehler(401, 'unauthenticated') };
    if (logger) logger.warn('gastUebernahme: Token-Prüfung nicht erreichbar', { code, err: e && e.message });
    return { fehler: fehler(503, 'auth_nicht_erreichbar') };
  }
}

function erstelleGastUebernahme({ db, admin, logger, loadConfig, zeit = () => Date.now() }) {
  const Timestamp = admin.firestore.Timestamp;
  const jobRef = (gastUid) => db.collection(JOBS).doc(gastUid);
  const zielRef = (zielUid) => db.collection(ZIELE).doc(zielUid);

  /**
   * Schritt 12: Besitznachweis für den angemeldeten Gast hinterlegen.
   * Legt den Job an oder ergänzt ihn — auch ohne serverseitigen Bestand, weil
   * lokal wartende Aufträge der App sonst keine Zuordnung bekämen.
   */
  async function vorbereiten({ gastUid, ticketHash }) {
    if (typeof ticketHash !== 'string' || !HASH_RE.test(ticketHash)) return fehler(400, 'hash_ungueltig');

    let au;
    try {
      au = await admin.auth().getUser(gastUid);
    } catch (e) {
      if (e && e.code === 'auth/user-not-found') return fehler(403, 'kein_gast');
      return fehler(503, 'konto_pruefung_fehlgeschlagen');
    }
    if (!istGast(au)) return fehler(403, 'kein_gast');

    const jetzt = zeit();
    const tag = berlinTag(jetzt);
    const ref = jobRef(gastUid);

    const ergebnis = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const job = snap.exists ? snap.data() || {} : null;

      // Einmal gebunden, immer gebunden — ein zweites Ziel gibt es nicht.
      if (job && job.nachUid) return fehler(409, 'schon_gebunden');

      const bisher = job && job.vorbereitungen && job.vorbereitungen.tag === tag
        ? Number(job.vorbereitungen.anzahl) || 0
        : 0;
      // Derselbe Hash ist schon hinterlegt (die App verwendet ihr Geheimnis
      // bis zum Einlösen wieder): idempotent bestätigen, NICHT zählen. Sonst
      // sperrten zehn Anmeldeversuche an einem Tag einen Gast mit Guthaben
      // aus seinem eigenen Konto aus (Prüfrunde 1).
      const bekannt = job && Array.isArray(job.ticketHashes) && job.ticketHashes.includes(ticketHash);
      if (bekannt) {
        return antwort(200, { ok: true, gueltigBis: job.gueltigBis ? new Date(tsMs(job.gueltigBis)).toISOString() : null });
      }
      if (bisher >= MAX_VORBEREITUNGEN_PRO_TAG) return fehler(429, 'zu_viele_vorbereitungen');

      // Neu ist auch ein abgelaufener, nie gebundener Job: sonst bliebe
      // gueltigBis für immer in der Vergangenheit, und jedes spätere Ticket
      // dieses Gastes wäre schon beim Anlegen verfallen.
      const neu = !job || tsMs(job.gueltigBis) <= jetzt;
      const alte = neu
        ? []
        : (Array.isArray(job.ticketHashes) ? job.ticketHashes : []).filter((h) => typeof h === 'string' && HASH_RE.test(h));
      // Menge: derselbe Hash rückt ans Ende statt doppelt zu stehen; bei
      // Überlauf fliegt der älteste raus.
      const ticketHashes = alte.filter((h) => h !== ticketHash).concat(ticketHash).slice(-MAX_HASHES);

      const felder = {
        status: 'vorbereitet',
        ticketHashes,
        vorbereitungen: { tag, anzahl: bisher + 1 },
        aktualisiertAm: Timestamp.fromMillis(jetzt),
      };
      let gueltigBis = job && job.gueltigBis;
      if (neu) {
        gueltigBis = Timestamp.fromMillis(jetzt + GUELTIG_MS);
        felder.gueltigBis = gueltigBis;
        felder.angelegtAm = Timestamp.fromMillis(jetzt);
      }
      tx.set(ref, felder, { merge: true });
      return antwort(200, { ok: true, gueltigBis: new Date(tsMs(gueltigBis)).toISOString() });
    });

    if (ergebnis.http === 200) {
      logger.info('gastUebernahme: vorbereitet', { gastUid });
    } else {
      logger.info('gastUebernahme: vorbereiten abgelehnt', { gastUid, code: ergebnis.body.code });
    }
    return ergebnis;
  }

  /** Versuchszähler je Aufrufer. @returns {Promise<boolean>} true = gedrosselt */
  async function gedrosselt(zielUid) {
    const ref = zielRef(zielUid);
    const stunde = stundenSchluessel(zeit());
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const v = (snap.exists && (snap.data() || {}).versuche) || {};
      const anzahl = v.stunde === stunde ? Number(v.anzahl) || 0 : 0;
      if (anzahl >= MAX_VERSUCHE_PRO_STUNDE) return true;
      tx.set(ref, { versuche: { stunde, anzahl: anzahl + 1 } }, { merge: true });
      return false;
    });
  }

  /**
   * Schritt 13, Stufe 1: Ticket vollständig prüfen, dann `pausiert`.
   * Gebunden wird hier nie — das kommt mit Stufe 2 an der markierten Stelle.
   */
  async function einloesen({ zielUid, gastUid, geheimnis }) {
    if (typeof gastUid !== 'string' || !UID_RE.test(gastUid)) return fehler(400, 'anfrage_ungueltig');
    if (typeof geheimnis !== 'string' || geheimnis.length < GEHEIMNIS_MIN || geheimnis.length > GEHEIMNIS_MAX) {
      return fehler(400, 'anfrage_ungueltig');
    }
    if (zielUid === gastUid) return fehler(400, 'gleiches_konto');

    if (await gedrosselt(zielUid)) {
      logger.info('gastUebernahme: gedrosselt', { zielUid });
      return fehler(429, 'zu_viele_versuche');
    }

    const kontoFehler = await kontoPruefen(admin, zielUid);
    if (kontoFehler) return kontoFehler;

    const snap = await jobRef(gastUid).get();
    if (!snap.exists) return fehler(404, 'kein_ticket');
    const job = snap.data() || {};
    const jetzt = zeit();

    if (job.nachUid && job.nachUid !== zielUid) {
      logger.info('gastUebernahme: schon an anderes Konto gebunden', { gastUid, zielUid });
      return fehler(409, 'schon_gebunden');
    }
    if (!job.nachUid) {
      // Erst den Besitz prüfen, dann über den Zustand des Tickets Auskunft
      // geben — wer das Geheimnis nicht hat, erfährt nichts über Ablauf/Status.
      if (!hashPasst(geheimnis, job.ticketHashes)) {
        logger.info('gastUebernahme: Ticket passt nicht', { gastUid, zielUid });
        return fehler(403, 'ticket_ungueltig');
      }
    }

    // Solange die Übernahme nicht aktiv ist, wird NACH der Besitzprüfung
    // sofort „pausiert“ geantwortet — VOR Ablauf- und Statusprüfung. Sonst
    // verfiele ein Ticket, das noch gar nicht einlösbar ist, nach 30 Tagen;
    // die App löschte es bei 410, und Guthaben/Einreichungen des Gastes
    // wären nie mehr zuzuordnen (Prüfrunde 1, höchste Schwere).
    // STUFE 2 muss deshalb die Frist ab der AKTIVIERUNG rechnen (gueltigBis
    // beim ersten aktiven Einlösen neu setzen), nicht ab der Anlage.
    let config;
    try {
      config = await loadConfig({ strict: true });
    } catch (e) {
      logger.warn('gastUebernahme: Konfiguration nicht lesbar', { err: e && e.message });
      return fehler(503, 'konfiguration_nicht_lesbar');
    }
    if (!config || config.gastUebernahmeAktiv !== true) {
      logger.info('gastUebernahme: pausiert', { gastUid, zielUid });
      return antwort(200, { status: 'pausiert' });
    }

    if (!job.nachUid) {
      if (job.status === 'verfallen' || tsMs(job.gueltigBis) <= jetzt) return fehler(410, 'abgelaufen');
      if (job.status !== 'vorbereitet') return fehler(409, 'nicht_einloesbar');
    }
    // job.nachUid === zielUid: schon gebunden an genau diesen Aufrufer →
    // idempotent weiter (die Hashes sind nach der Bindung gelöscht).

    // ── Stufe 2 setzt hier an: getUser(gast), Zählung, Transaktion T0
    //    (Bindung, Einwilligung, Region), Sperre von A, verarbeiteJob. ──
    logger.warn('gastUebernahme: Stufe 2 fehlt', { gastUid, zielUid });
    return antwort(200, { status: 'pausiert' });
  }

  return { vorbereiten, einloesen };
}

module.exports = {
  erstelleGastUebernahme,
  kontoPruefen,
  tokenPruefen,
  // für Tests
  sha256Hex,
  hashPasst,
  istGast,
  istRegistriert,
  berlinTag,
  stundenSchluessel,
  JOBS,
  ZIELE,
  GUELTIG_MS,
  MAX_HASHES,
  MAX_VORBEREITUNGEN_PRO_TAG,
  MAX_VERSUCHE_PRO_STUNDE,
};
