'use strict';

/**
 * Wer darf einen Bon gerade anfassen? (Push-Prüfung 24.09.2026)
 *
 * Zwei Wettläufe, beide mit dem Live-Code nachgestellt:
 *
 *  1. Pub/Sub stellt DIESELBE Nachricht gelegentlich doppelt zu (seit 08.09.
 *     sechsmal, fünfmal überlappend). Beide Läufe rechnen parallel. Lief der
 *     zweite mit einer eigenen, abweichenden OCR-Lesung, setzte er den Bon auf
 *     `rejected` und stornierte die Gutschrift, NACHDEM der erste schon
 *     „Ka-ching!" geschickt hatte.
 *  2. Die Prüfkonsole entschied über einen Bon, während die Pipeline ihn noch
 *     verarbeitete, oder zwei Entscheidungen (freigeben + ablehnen) liefen
 *     gleichzeitig. Die Statusprüfung lag außerhalb jeder Transaktion; beide
 *     meldeten Erfolg, am Ende standen Push und Storno.
 *
 * Lösung: zwei Ansprüche am Bon-Dokument, beide in Transaktionen gesetzt, damit
 * sie sich gegenseitig ausschließen.
 *   `verarbeitung.e<eventId>` = Beginn eines Pipeline-Laufs. Eine zweite
 *       Zustellung DERSELBEN Nachricht, während der erste Lauf noch läuft,
 *       tut nichts. Eine andere Nachricht (Kehrlauf, Nachverarbeitung) läuft
 *       wie bisher, denn sie trägt eine neue Event-ID.
 *   `entscheidungLaeuft` = eine Entscheidung der Prüfkonsole ist unterwegs.
 * Die Pipeline startet nicht, solange eine Entscheidung läuft; die Konsole
 * entscheidet nicht, solange ein Pipeline-Lauf aktiv ist (409, gleich erneut).
 *
 * Ansprüche verfallen von selbst (LAUF_MAX_MS, ENTSCHEIDUNG_MAX_MS): stirbt ein
 * Lauf ohne Aufräumen (Zeitlimit), blockiert er höchstens bis dahin.
 *
 * `db` und `admin` werden übergeben, damit die Funktionen ohne firebase-admin
 * testbar sind.
 */

/**
 * Länger als das Zeitlimit von processCashback (540 s).
 *
 * Bis 03.10.2026 stimmte das nur auf dem Papier: Cloud Run beendet nach 540 s
 * die Anfrage, nicht den Code — hängende Gemini-Lesungen ließen Läufe 9–37 min
 * weiterrechnen und schreiben, nachdem dieser Anspruch verfallen war. Seitdem
 * hält die OCR ein Laufbudget ein (lib/ocr_robust.js, 400 s) und index.js
 * schreibt nach LAUF_ZEITGRENZE_MS (480 s) keine Entscheidung mehr. Wer eine
 * dieser Grenzen anhebt, muss diese hier mitziehen.
 */
const LAUF_MAX_MS = 10 * 60 * 1000;
/** Länger als das Zeitlimit von resolveCashbackReview (60 s). */
const ENTSCHEIDUNG_MAX_MS = 2 * 60 * 1000;

const tsMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : 0);

/** Feldname eines Laufs — mit Buchstaben-Präfix, damit er ein gültiger Pfadteil ist. */
const laufFeld = (eventId) => `e${String(eventId).replace(/[^A-Za-z0-9_-]/g, '_')}`;

/** Event-IDs der Läufe, die jetzt noch als aktiv gelten. */
function aktiveLaeufe(verarbeitung, jetzt) {
  if (!verarbeitung || typeof verarbeitung !== 'object') return [];
  return Object.entries(verarbeitung)
    .filter(([, seit]) => jetzt - tsMs(seit) < LAUF_MAX_MS)
    .map(([feld]) => feld);
}

function entscheidungAktiv(entscheidung, jetzt) {
  return Boolean(entscheidung) && jetzt - tsMs(entscheidung.seit) < ENTSCHEIDUNG_MAX_MS;
}

/**
 * Darf ein Pipeline-Lauf für diese Zustellung beginnen?
 *
 * `fortsetzung_laeuft` (03.10.2026): Eine OCR-Leiter, die sich über mehrere
 * Läufe verteilt (`ocrZwischenstand`, index.js ocrFortsetzen), darf nur EIN
 * Lauf zur Zeit fortsetzen — auch eine verspätete Zustellung oder der Kehrlauf
 * mit anderer Event-ID startet dann nicht. Sonst lesen zwei Läufe denselben
 * Bon parallel weiter und entscheiden womöglich verschieden. Der Lauf, der den
 * Zwischenstand ablegt, gibt seinen Anspruch in DERSELBEN Transaktion ab;
 * deshalb blockiert er seinen eigenen Nachfolger nicht.
 * @returns {'frei'|'doppelt'|'fortsetzung_laeuft'|'entscheidung_laeuft'}
 */
function laufUrteil(doc, eventId, jetzt) {
  const d = doc || {};
  const aktiv = aktiveLaeufe(d.verarbeitung, jetzt);
  if (eventId && aktiv.includes(laufFeld(eventId))) return 'doppelt';
  if (d.ocrZwischenstand && aktiv.length > 0) return 'fortsetzung_laeuft';
  if (entscheidungAktiv(d.entscheidungLaeuft, jetzt)) return 'entscheidung_laeuft';
  return 'frei';
}

/**
 * Darf die Prüfkonsole jetzt über diesen Bon entscheiden?
 * @returns {'frei'|'not_in_review'|'decision_in_progress'|'in_verarbeitung'}
 */
function entscheidungUrteil(doc, jetzt) {
  const d = doc || {};
  if (d.status !== 'review') return 'not_in_review';
  if (entscheidungAktiv(d.entscheidungLaeuft, jetzt)) return 'decision_in_progress';
  if (aktiveLaeufe(d.verarbeitung, jetzt).length > 0) return 'in_verarbeitung';
  return 'frei';
}

/**
 * Pipeline-Lauf anmelden. Wirft nie: ist der Anspruch nicht setzbar, läuft die
 * Verarbeitung wie vor dieser Änderung (`angemeldet: false`) — ein Firestore-
 * Aussetzer darf keinen Bon liegen lassen.
 * @returns {Promise<{urteil: string, angemeldet: boolean}>}
 */
async function laufBeginnen({ db, admin, docRef, eventId, jetzt = () => Date.now() }) {
  if (!eventId) return { urteil: 'frei', angemeldet: false };
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) return { urteil: 'frei', angemeldet: false };
      const urteil = laufUrteil(snap.data(), eventId, jetzt());
      if (urteil !== 'frei') return { urteil, angemeldet: false };
      tx.update(docRef, { [`verarbeitung.${laufFeld(eventId)}`]: admin.firestore.Timestamp.now() });
      return { urteil, angemeldet: true };
    });
  } catch (e) {
    return { urteil: 'frei', angemeldet: false, fehler: e.message };
  }
}

/** Pipeline-Lauf abmelden. Wirft nie; ein verbliebener Anspruch verfällt von selbst. */
async function laufBeenden({ admin, docRef, eventId }) {
  try {
    await docRef.update({ [`verarbeitung.${laufFeld(eventId)}`]: admin.firestore.FieldValue.delete() });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Entscheidung der Prüfkonsole anmelden — Statusprüfung und Anspruch in EINER
 * Transaktion. Wirft, wenn Firestore nicht erreichbar ist (der Aufrufer
 * antwortet dann 500; ohne Anspruch wird nicht entschieden).
 * @returns {Promise<{urteil: string, status?: string|null}>}
 */
async function entscheidungBeanspruchen({ db, admin, ref, decision, jetzt = () => Date.now() }) {
  // Kennung des Anspruchs: freigegeben wird nur der EIGENE (entscheidungFreigeben).
  const token = `${jetzt().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { urteil: 'not_found' };
    const d = snap.data() || {};
    const urteil = entscheidungUrteil(d, jetzt());
    if (urteil !== 'frei') return { urteil, status: d.status || null };
    tx.update(ref, { entscheidungLaeuft: { decision, seit: admin.firestore.Timestamp.now(), token } });
    return { urteil, token };
  });
}

/**
 * Gibt den eigenen Entscheidungs-Anspruch frei — nur, wenn er noch unserer ist.
 * Wirft nie; ein verbliebener Anspruch verfällt nach ENTSCHEIDUNG_MAX_MS.
 * @returns {Promise<boolean>} true = freigegeben (oder war schon weg)
 */
async function entscheidungFreigeben({ db, admin, ref, token }) {
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const e = snap.exists ? (snap.data() || {}).entscheidungLaeuft : null;
      if (!e) return true;
      if (e.token !== token) return false;
      tx.update(ref, { entscheidungLaeuft: admin.firestore.FieldValue.delete() });
      return true;
    });
  } catch (err) {
    return false;
  }
}

module.exports = {
  LAUF_MAX_MS,
  ENTSCHEIDUNG_MAX_MS,
  laufFeld,
  aktiveLaeufe,
  laufUrteil,
  entscheidungUrteil,
  laufBeginnen,
  laufBeenden,
  entscheidungBeanspruchen,
  entscheidungFreigeben,
};
