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

// Views that carry the product name best: front first, price tag as a
// cross-check (shop shelf labels usually print the name too). Seit 05.09.2026
// zusätzlich das Hersteller-Foto: Preis (Preisschild) und Hersteller sind die
// Vergleichsdaten der Doppel-Regel der Review-Konsole (review-console/
// src/duplicatePolicy.js) — „andere Daten" = Preis, Hersteller oder Markt.
const NAME_STEPS = ['front', 'preis', 'hersteller'];
// Beschriftung der Bilder im Prompt — ohne sie weiß das Modell nicht, WELCHES
// Bild welche Ansicht ist, und ordnet Preis/Hersteller falsch zu.
const STEP_LABEL = { front: 'Bild „Produktvorderseite"', preis: 'Bild „Preis"', hersteller: 'Bild „Herstellerangabe"' };
// Below this we keep the OCR as a suggestion but don't auto-fill the name.
const MIN_CONFIDENCE = 0.45;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    productName: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    // Preis vom Preisschild ODER vom Kassenbon in Cent (1,99 € → 199); 0 = nicht lesbar.
    priceCents: { type: Type.INTEGER },
    // Hersteller/Inverkehrbringer laut Verpackung (Firma, ohne Adresse); leer = nicht lesbar.
    manufacturer: { type: Type.STRING },
    // Was das „Preis"-Bild tatsächlich zeigt. Gemessen an 40 echten Einreichungen
    // (06.09.2026): 50 % Produktfoto ohne Preis, 30 % Preisschild, 17,5 % Kassenbon.
    priceImageKind: { type: Type.STRING },
    // Nur wenn das Preis-Bild ein KASSENBON ist: der Bon-Kopf. Damit hat die
    // Einreichung eine harte Ortsangabe (Filialadresse) — genauer als jedes
    // GPS-Raster — und der Markt lässt sich gegen die App-Auswahl prüfen.
    receiptMerchant: { type: Type.STRING },
    receiptStreet: { type: Type.STRING },
    receiptZip: { type: Type.STRING },
    receiptCity: { type: Type.STRING },
    receiptDate: { type: Type.STRING },
  },
  required: ['productName', 'confidence', 'priceCents', 'manufacturer', 'priceImageKind', 'receiptMerchant', 'receiptStreet', 'receiptZip', 'receiptCity', 'receiptDate'],
};

const PROMPT = [
  'Du siehst ein oder zwei Fotos eines Supermarkt-Produkts (Verpackungs-Vorderseite, evtl. ein Preisschild aus dem Regal).',
  'Extrahiere den PRODUKTNAMEN exakt so, wie ihn ein Kunde nennen würde: Marke + Produktbezeichnung + ggf. Sorte/Variante.',
  'Regeln:',
  '- KEINE Mengenangaben (g, ml, Stück), KEINE Preise, KEINE Werbe-Claims ("NEU", "Aktion", "%").',
  '- Marke und Bezeichnung zusammen, z.B. "Gut & Günstig Vollmilch 3,5%".',
  '- Wenn der Name nicht zuverlässig lesbar ist: leerer String und confidence 0.',
'',
  'PREIS: der Preis des Produkts in Cent als Ganzzahl (1,99 € → 199) — vom Preisschild ODER von der Bon-Zeile dieses Produkts; Grundpreise (€/kg, €/l) NICHT verwenden; nicht lesbar → 0.',
  'HERSTELLER: der Inverkehrbringer laut Verpackung als Firmenname ohne Adresse (z.B. "Molkerei Weihenstephan GmbH"); nicht lesbar → leerer String.',
  '',
  'priceImageKind — was zeigt das Bild „Preis" wirklich? Wähle immer die beste Kategorie:',
  '  "preisschild" (Regal-Etikett), "kassenbon" (Kassenzettel, auch schräg oder teilweise),',
  '  "beides", "produktfoto" (nur Verpackung, kein Preis), "sonstiges", "fehlt" (kein Preis-Bild dabei).',
  'Ist es ein KASSENBON (oder "beides"), lies aus dem Bon-KOPF: receiptMerchant (Filialname),',
  'receiptStreet (Straße + Hausnummer), receiptZip (Postleitzahl), receiptCity (Ort),',
  'receiptDate (Kaufdatum ISO YYYY-MM-DD). Nicht lesbar oder kein Bon → leerer String.',
  'Nimm die FILIALADRESSE aus dem Bon-Kopf, nicht den Firmensitz aus dem Fußbereich.',
  '',
  'Antworte als JSON gemäß Schema; confidence zwischen 0 und 1. Nichts erfinden.',
].join('\n');

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

function extractText(response) {
  let rawText = null;
  try {
    rawText = response && response.text;
  } catch {
    rawText = null;
  }
  if (!rawText) {
    const parts = response && response.candidates && response.candidates[0] &&
      response.candidates[0].content && response.candidates[0].content.parts;
    if (Array.isArray(parts)) {
      rawText = parts.map((p) => (p && p.text) || '').filter(Boolean).join('');
    }
  }
  return rawText;
}

exports.onCrowdUploadNameOcr = onDocumentCreated(
  {
    document: 'crowd_uploads/{id}',
    region: REGION,
    memory: '512MiB',
    timeoutSeconds: 120,
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

    let name = '';
    let confidence = 0;
    let priceCents = null;
    let manufacturer = null;
    let priceImageKind = null;
    let receipt = null;
    try {
      const ai = getGenAIClient();
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.1,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 512,
        },
      });
      const rawText = extractText(response);
      if (!rawText || !rawText.trim()) throw new Error('empty gemini response');
      const parsed = JSON.parse(rawText);
      name = String(parsed.productName || '').trim();
      confidence = Number(parsed.confidence) || 0;
      const pc = Number(parsed.priceCents);
      priceCents = Number.isFinite(pc) && pc > 0 && pc < 100000 ? Math.round(pc) : null;
      manufacturer = String(parsed.manufacturer || '').trim().slice(0, 120) || null;
      const KINDS = ['preisschild', 'kassenbon', 'beides', 'produktfoto', 'sonstiges', 'fehlt'];
      const kind = String(parsed.priceImageKind || '').trim().toLowerCase();
      priceImageKind = KINDS.includes(kind) ? kind : (images.preis ? 'unklar' : 'fehlt');
      if (priceImageKind === 'kassenbon' || priceImageKind === 'beides') {
        const zip = String(parsed.receiptZip || '').replace(/\D/g, '');
        const city = String(parsed.receiptCity || '').trim().slice(0, 80);
        const street = String(parsed.receiptStreet || '').trim().slice(0, 120);
        const merchantName = String(parsed.receiptMerchant || '').trim().slice(0, 80);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.receiptDate || '')) ? parsed.receiptDate : null;
        if (zip || city || street || merchantName) {
          receipt = {
            merchant: merchantName || null,
            street: street || null,
            zip: /^\d{4,5}$/.test(zip) ? zip : null,
            city: city || null,
            bonDate: date,
            source: 'preis-foto',
          };
          receipt.complete = Boolean(receipt.zip && receipt.city);
        }
      }
    } catch (e) {
      logger.error('gemini name ocr failed', { id, err: e.message });
      // Mark attempted so the trigger doesn't loop; leave suggestion null.
      await snap.ref.set({ productNameOcr: null, productNameOcrAt: stamp() }, { merge: true });
      return;
    }

    const patch = {
      productNameOcr: name || null,
      productNameOcrConfidence: confidence,
      productNameOcrAt: stamp(),
      // Vergleichsdaten der Doppel-Regel (Review-Konsole). Nur OCR-Vorschläge,
      // nie Nutzer-Eingaben überschreibend; fehlend = null (fail-closed dort).
      priceOcr: priceCents != null ? { priceCents, source: priceImageKind === 'kassenbon' || priceImageKind === 'beides' ? 'bon' : 'preisschild' } : null,
      manufacturerOcr: manufacturer ? { name: manufacturer, source: 'hersteller' } : null,
      // Was das Preis-Bild zeigt + (falls Bon) die Filialadresse. Gibt der
      // Einreichung eine harte Ortsangabe und erlaubt den Abgleich des in der
      // App gewählten Marktes gegen den Bon.
      priceImageKind,
      priceReceipt: receipt,
    };

    // User input always wins: only fill the displayed name when the user left
    // it empty AND OCR is confident enough.
    const userName = (data.productName == null ? '' : String(data.productName)).trim();
    if (!userName && name && confidence >= MIN_CONFIDENCE) {
      patch.productName = name;
    }

    await snap.ref.set(patch, { merge: true });
    logger.info('name ocr done', { id, name, confidence, filled: !!patch.productName, priceImageKind, bonOrt: receipt ? `${receipt.zip || '?'} ${receipt.city || '?'}` : null });
  },
);
