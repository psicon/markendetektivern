'use strict';

/**
 * crowd-upload-namer
 *
 * When a user submits a product-photo dataset (crowd_uploads/{id}), this
 * trigger OCRs the product name from the FRONT photo (and the price-tag photo
 * as a cross-check) via Gemini Vision and writes it back to the doc.
 *
 * Design (agreed with product owner):
 *  - The name input in the wizard stays OPTIONAL. The user never waits for OCR.
 *  - OCR runs server-side AFTER the images are uploaded — so it works even for
 *    submissions captured offline (the background upload queue lands the images
 *    later; this trigger fires when the doc is created on submit).
 *  - USER INPUT ALWAYS WINS: the OCR result is stored separately as
 *    `productNameOcr` (a suggestion, always written). `productName` is only
 *    auto-filled when the user left it empty AND OCR is confident enough.
 *  - The scanned EAN is a stronger future signal (catalog/nutrition-scraper
 *    resolve the exact product) — deferred to a later phase.
 *
 * Mirrors the Gemini setup of cloud-functions/ai-product-comparison
 * (@google/genai, gemini-3.5-flash, GEMINI_API_KEY secret, europe-west1).
 *
 * Seit 26.09.2026: defekte (abgeschnittene) Fotos werden vorab erkannt und
 * weggelassen (src/bild.js, src/fotos.js), und vorübergehend gescheiterte
 * Lesungen holt der Nachlauf `namerNachlauf` in dieselben Felder nach
 * (src/ablauf.js) — statt erst die Morgenrunde am nächsten Tag.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { GoogleGenAI, Type } = require('@google/genai');
const { leseMitWiederholung } = require('./src/lesung');
const { geminiKennung, nutztVertex, ZWECK } = require('./src/geminiKennung');
const { leseEinreichung } = require('./src/fotos');
const { erstlaufBeginnen, erstlaufAbschliessen, nachlauf } = require('./src/ablauf');

// Backend-Umschaltung (Incident 19.08.2026): AI-Studio-Keys haengen am
// monatlichen Spending-Cap der Rechnungskontostufe — bei Erreichen liefern
// ALLE Keys des Kontos 429. Vertex AI rechnet uebers GCP-Projekt-Billing und
// kennt das Limit nicht; gemini-3.5-flash ist unter 'global' publiziert
// (geprueft 19.08.2026). GEMINI_USE_VERTEX=false = alter Key-Pfad. Dieselbe
// Regel entscheidet, ob die Kosten-Kennung mitgeht (src/geminiKennung.js).
let _ai = null;
function getGenAIClient() {
  if (_ai) return _ai;
  if (nutztVertex()) {
    _ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'markendetektive-895f7',
      location: process.env.GEMINI_VERTEX_LOCATION || 'global',
    });
    return _ai;
  }
  _ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
  return _ai;
}

admin.initializeApp();
const db = admin.firestore();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const REGION = 'europe-west1';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const WERTE = {
  stamp: () => admin.firestore.FieldValue.serverTimestamp(),
  ts: (ms) => admin.firestore.Timestamp.fromMillis(ms),
  loeschen: () => admin.firestore.FieldValue.delete(),
};

/** Foto aus Storage; null, wenn es die Datei nicht gibt. Andere Fehler werfen (→ später nachlesen). */
async function ladeBild(pfad) {
  try {
    const [buf] = await admin.storage().bucket().file(pfad).download();
    return buf;
  } catch (e) {
    if (e && (e.code === 404 || /No such object/i.test(String(e.message)))) return null;
    throw e;
  }
}

/** Dieselbe Lesung für Erstlauf und Nachlauf (src/fotos.js). */
function lesen(daten, { beobachter = null, id = null } = {}) {
  return leseEinreichung({
    images: daten.images || {},
    ladeBild,
    id,
    logger,
    lese: (parts, opts = {}) => leseMitWiederholung({ ai: getGenAIClient(), model: MODEL, parts, Type, beobachter, kennung: geminiKennung(ZWECK.FOTO_NAME), ...opts }),
  });
}

exports.onCrowdUploadNameOcr = onDocumentCreated(
  {
    document: 'crowd_uploads/{id}',
    region: REGION,
    memory: '512MiB',
    // Ungünstigster Fall rund 4 min: Wiederholungen bis ~130 s (src/lesung.js)
    // plus 2 Dekodier-Rückfälle à höchstens 60 s (src/fotos.js), dazu das
    // Prüfen der übrigen Fotos (Downloads in der Region, Sekunden). Endet der
    // Lauf ohne Schreiben, übernimmt der Nachlauf (Sicherheitsnetz in src/ablauf.js).
    timeoutSeconds: 300,
    secrets: [GEMINI_API_KEY],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const id = event.params.id;

    const anspruch = await erstlaufBeginnen({ db, ref: snap.ref, eventId: event.id, jetzt: Date.now(), werte: WERTE });
    if (anspruch.ohneSperre) logger.warn('namer: Sperre nicht setzbar, lese ohne', { id, err: anspruch.fehler });
    if (anspruch.urteil !== 'frei') {
      const sperre = anspruch.sperre || null;
      logger.info('namer: nichts zu tun', { id, urteil: anspruch.urteil, gleicheZustellung: Boolean(sperre && sperre.eventId === event.id) });
      return;
    }
    const daten = anspruch.daten || snap.data() || {};

    const ausgang = await lesen(daten, { id });
    const r = await erstlaufAbschliessen({ db, ref: snap.ref, lauf: anspruch.lauf, ausgang, jetzt: Date.now(), werte: WERTE });
    if (r.status !== 'geschrieben') {
      // Dokument gelöscht, oder ein anderer Lauf hat den Fall inzwischen: nichts überschreiben.
      logger.warn('namer: Ergebnis verworfen', { id, status: r.status, ausgang: ausgang.art });
      return;
    }
    const { felder, ergebnis } = r;

    if (ergebnis) {
      const { name, confidence, priceImageKind, receipt } = ergebnis;
      logger.info('name ocr done', {
        id, name, confidence, versuche: ausgang.versuche, filled: Boolean(felder.productName), priceImageKind,
        bonOrt: receipt ? `${receipt.zip || '?'} ${receipt.city || '?'}` : null,
        gesendet: ausgang.gesendet, defekt: ausgang.defekt.map((d) => d.slot), ungeprueft: ausgang.ungeprueft,
      });
    } else if (ausgang.art === 'ohne_bild') {
      logger.info('no name image to ocr', { id });
    } else {
      // „Versucht" mit GRUND — damit niemand „kein Name" für „nicht lesbar"
      // hält (bis 24.09.2026 sah ein technischer Fehler genau so aus).
      logger.error('gemini name ocr failed', {
        id, ausgang: ausgang.art, versuche: ausgang.versuche, defekt: ausgang.defekt.map((d) => d.slot),
        nachlauf: Boolean(felder.namerNachlesenVersuch), err: ausgang.fehler ? ausgang.fehler.message : ausgang.art,
      });
    }
  },
);

/**
 * Nachlauf für vorübergehend gescheiterte Lesungen (src/ablauf.js). Alle
 * 15 Minuten: die Ortsprüfung der Vergütung läuft einmalig bei der Freigabe
 * und braucht priceReceipt bis dahin. maxInstances 1 + concurrency 1: nie
 * zwei Durchgänge parallel (Gen2 nähme sonst mehrere Anfragen in dieselbe
 * Instanz). retryCount 0: der nächste Takt ist die Wiederholung.
 */
exports.namerNachlauf = onSchedule(
  {
    region: REGION,
    schedule: '*/15 * * * *',
    timeZone: 'Europe/Berlin',
    retryCount: 0,
    timeoutSeconds: 540,
    memory: '1GiB',
    maxInstances: 1,
    concurrency: 1,
    secrets: [GEMINI_API_KEY],
  },
  async () => {
    const bericht = await nachlauf({ db, werte: WERTE, lesen, logger });
    if (bericht.gefunden) logger.info('namer-nachlauf: Durchgang', bericht);
  },
);
