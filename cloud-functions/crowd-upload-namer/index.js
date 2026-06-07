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

admin.initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const REGION = 'europe-west1';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

// Views that carry the product name best: front first, price tag as a
// cross-check (shop shelf labels usually print the name too).
const NAME_STEPS = ['front', 'preis'];
// Below this we keep the OCR as a suggestion but don't auto-fill the name.
const MIN_CONFIDENCE = 0.45;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    productName: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
  },
  required: ['productName', 'confidence'],
};

const PROMPT = [
  'Du siehst ein oder zwei Fotos eines Supermarkt-Produkts (Verpackungs-Vorderseite, evtl. ein Preisschild aus dem Regal).',
  'Extrahiere den PRODUKTNAMEN exakt so, wie ihn ein Kunde nennen würde: Marke + Produktbezeichnung + ggf. Sorte/Variante.',
  'Regeln:',
  '- KEINE Mengenangaben (g, ml, Stück), KEINE Preise, KEINE Werbe-Claims ("NEU", "Aktion", "%").',
  '- Marke und Bezeichnung zusammen, z.B. "Gut & Günstig Vollmilch 3,5%".',
  '- Wenn der Name nicht zuverlässig lesbar ist: leerer String und confidence 0.',
  'Antworte als JSON {productName, confidence} mit confidence zwischen 0 und 1.',
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
      if (part) parts.push(part);
    }

    // No usable image → mark attempted (so we don't retry forever) and stop.
    if (parts.length === 1) {
      await snap.ref.set({ productNameOcr: null, productNameOcrAt: stamp() }, { merge: true });
      logger.info('no name image to ocr', { id });
      return;
    }

    let name = '';
    let confidence = 0;
    try {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.1,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 256,
        },
      });
      const rawText = extractText(response);
      if (!rawText || !rawText.trim()) throw new Error('empty gemini response');
      const parsed = JSON.parse(rawText);
      name = String(parsed.productName || '').trim();
      confidence = Number(parsed.confidence) || 0;
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
    };

    // User input always wins: only fill the displayed name when the user left
    // it empty AND OCR is confident enough.
    const userName = (data.productName == null ? '' : String(data.productName)).trim();
    if (!userName && name && confidence >= MIN_CONFIDENCE) {
      patch.productName = name;
    }

    await snap.ref.set(patch, { merge: true });
    logger.info('name ocr done', { id, name, confidence, filled: !!patch.productName });
  },
);
