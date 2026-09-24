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
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { GoogleGenAI, Type } = require('@google/genai');
const { NAME_STEPS, STEP_LABEL, PROMPT, leseMitWiederholung, auswerten, patchFelder } = require('./src/lesung');

// Backend-Umschaltung (Incident 19.08.2026): AI-Studio-Keys haengen am
// monatlichen Spending-Cap der Rechnungskontostufe — bei Erreichen liefern
// ALLE Keys des Kontos 429. Vertex AI rechnet uebers GCP-Projekt-Billing und
// kennt das Limit nicht; gemini-3.5-flash ist unter 'global' publiziert
// (geprueft 19.08.2026). GEMINI_USE_VERTEX=false = alter Key-Pfad.
let _ai = null;
function getGenAIClient() {
  if (_ai) return _ai;
  const useVertex = String(process.env.GEMINI_USE_VERTEX ?? 'true') !== 'false';
  if (useVertex) {
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

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const REGION = 'europe-west1';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

async function downloadAsInlineData(path) {
  try {
    const [buf] = await admin.storage().bucket().file(path).download();
    if (!buf || !buf.length) return null;
    return { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } };
  } catch (e) {
    logger.warn('image download failed', { path, err: e.message });
    return null;
  }
}

exports.onCrowdUploadNameOcr = onDocumentCreated(
  {
    document: 'crowd_uploads/{id}',
    region: REGION,
    memory: '512MiB',
    // 300 s: bis zu drei Lesungen mit Pausen (src/lesung.js). Mit 120 s konnte
    // ein langsamer dritter Versuch die Funktion abbrechen — dann stünde gar
    // kein Vermerk am Dokument.
    timeoutSeconds: 300,
    secrets: [GEMINI_API_KEY],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const id = event.params.id;

    // Idempotent: only OCR once per doc.
    if (data.productNameOcrAt) return;

    const stamp = () => admin.firestore.FieldValue.serverTimestamp();
    const images = data.images || {};
    const parts = [{ text: PROMPT }];
    for (const step of NAME_STEPS) {
      const path = images[step];
      if (!path) continue;
      const part = await downloadAsInlineData(path);
      // Jedes Bild bekommt seine Beschriftung davor — sonst rät das Modell,
      // welche Ansicht es gerade sieht.
      if (part) parts.push({ text: `${STEP_LABEL[step] || step}:` }, part);
    }

    // No usable image → mark attempted (so we don't retry forever) and stop.
    if (parts.length === 1) {
      await snap.ref.set({ productNameOcr: null, productNameOcrAt: stamp() }, { merge: true });
      logger.info('no name image to ocr', { id });
      return;
    }

    let ergebnis;
    let versuche = 1;
    try {
      const gelesen = await leseMitWiederholung({ ai: getGenAIClient(), model: MODEL, parts, Type });
      versuche = gelesen.versuche;
      ergebnis = auswerten(gelesen.parsed, { hatPreisBild: Boolean(images.preis) });
    } catch (e) {
      // Auch nach Wiederholung gescheitert. „Versucht" markieren, damit der
      // Trigger nicht kreist — aber mit dem GRUND, damit ein Nachlesen die
      // Fälle findet und niemand „kein Name" für „nicht lesbar" hält (bis
      // 24.09.2026 sah ein technischer Fehler genau so aus).
      logger.error('gemini name ocr failed', { id, versuche: e.versuche, err: e.message });
      await snap.ref.set({
        productNameOcr: null,
        productNameOcrAt: stamp(),
        productNameOcrFehler: { grund: String(e.message || e).slice(0, 200), versuche: e.versuche || null, at: stamp() },
      }, { merge: true });
      return;
    }

    const patch = {
      ...patchFelder(ergebnis, { userName: data.productName }),
      productNameOcrAt: stamp(),
    };
    await snap.ref.set(patch, { merge: true });
    const { name, confidence, priceImageKind, receipt } = ergebnis;
    logger.info('name ocr done', { id, name, confidence, versuche, filled: !!patch.productName, priceImageKind, bonOrt: receipt ? `${receipt.zip || '?'} ${receipt.city || '?'}` : null });
  },
);
