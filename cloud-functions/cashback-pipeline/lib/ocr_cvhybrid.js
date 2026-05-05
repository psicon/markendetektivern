/**
 * CV-Hybrid OCR engine: Cloud Vision DOCUMENT_TEXT_DETECTION → Gemini
 * Flash text-parser. Validated as the winner in the Phase-0 standalone
 * tool (`tools/cashback-ocr-validation/cv_hybrid.py`).
 *
 * Why two stages:
 *   - Cloud Vision is *deterministic* at text extraction (same image →
 *     same OCR text). Costs $0.0015/page.
 *   - Gemini Flash on TEXT input hallucinates much less than on image
 *     input — it just structures a known string. Significantly more
 *     stable on edge cases (Pfand, Rabatt, Multipack).
 *
 * Cost at 1.5k bons/day = 45k/month:
 *   - Cloud Vision: ~$67/month
 *   - Gemini Flash text-only: ~$70/month (much smaller token count
 *     than image input)
 *   - Total: ~$140/month — comparable to direct-Gemini cost,
 *     significantly more deterministic.
 *
 * Returns the same shape as the original `extractReceipt` in ocr.js
 * so the downstream pipeline (reconcile, merchant, ledger) doesn't
 * have to branch on engine.
 */

'use strict';

const { ImageAnnotatorClient } = require('@google-cloud/vision');
const { GoogleGenAI } = require('@google/genai');
const {
  SYSTEM_PROMPT,
  buildUserPrompt,
  RESPONSE_SCHEMA,
  VERSION: PROMPT_VERSION,
} = require('./prompt_text');

const DEFAULT_MODEL = process.env.CASHBACK_OCR_MODEL || 'gemini-2.5-flash';

// ─── Cached clients (re-used across invocations on warm instances) ──

let _vision = null;
function getVisionClient() {
  if (_vision) return _vision;
  // Uses ADC — Cloud Function service account needs roles/serviceusage.serviceUsageConsumer
  // on the Vision API (default for the project's compute SA).
  _vision = new ImageAnnotatorClient();
  return _vision;
}

let _genai = null;
function getGenAIClient() {
  if (_genai) return _genai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set on Cloud Function env');
  }
  _genai = new GoogleGenAI({ apiKey });
  return _genai;
}

// ─── Cloud Vision: image → raw text ─────────────────────────────────

async function callCloudVision(imageBytes) {
  const started = Date.now();
  // DOCUMENT_TEXT_DETECTION is optimized for documents (vs sparse-text
  // TEXT_DETECTION). Returns hierarchical pages → blocks → paragraphs
  // → words → symbols, plus a flat fullTextAnnotation.text we use.
  const [result] = await getVisionClient().documentTextDetection({
    image: { content: imageBytes },
  });
  const latencyMs = Date.now() - started;

  if (result.error && result.error.message) {
    const err = new Error(`cv_vision_error: ${result.error.message}`);
    err.code = 'cv_vision_error';
    throw err;
  }

  const fullText = result.fullTextAnnotation?.text || '';
  if (!fullText.trim()) {
    const err = new Error('cv_no_text_extracted');
    err.code = 'cv_no_text';
    throw err;
  }

  return { text: fullText, latencyMs };
}

// ─── Gemini Flash: text → structured Receipt JSON ───────────────────

async function callGeminiTextParser(ocrText, model) {
  const started = Date.now();
  const response = await getGenAIClient().models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [{ text: buildUserPrompt(ocrText) }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.0,
      // Note: @google/genai doesn't always honor `seed`, but keeping
      // temperature=0 is what matters for determinism here.
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  const latencyMs = Date.now() - started;

  const raw = response.text || '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const err = new Error(`cv_hybrid_json_decode: ${e.message}`);
    err.code = 'cv_hybrid_json_decode';
    err.raw = raw;
    throw err;
  }

  const usage = response.usageMetadata || {};
  return {
    parsed,
    latencyMs,
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: usage.candidatesTokenCount ?? null,
    raw,
  };
}

// ─── Public entry point ─────────────────────────────────────────────

/**
 * Run the CV-Hybrid OCR pipeline.
 *
 * Same return signature as the original Gemini-direct `extractReceipt`
 * in ocr.js, plus a `cvLatencyMs` and `geminiLatencyMs` breakdown for
 * monitoring.
 *
 * @param {Buffer} imageBytes
 * @param {string} mimeType  (kept for API compat; CV detects format itself)
 * @param {object} [opts]
 * @param {string} [opts.model] Gemini model id
 * @returns {Promise<{
 *   parsed: object,
 *   model: string,
 *   engine: string,
 *   promptVersion: string,
 *   latencyMs: number,
 *   cvLatencyMs: number,
 *   geminiLatencyMs: number,
 *   inputTokens: number|null,
 *   outputTokens: number|null,
 *   raw: string,
 *   ocrText: string,
 * }>}
 */
async function extractReceiptCVHybrid(imageBytes, mimeType, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const startedTotal = Date.now();

  // Stage 1: deterministic text extraction
  const cv = await callCloudVision(imageBytes);

  // Stage 2: Gemini Flash structures the text
  const parser = await callGeminiTextParser(cv.text, model);

  return {
    parsed: parser.parsed,
    model,
    engine: 'cv-hybrid',
    promptVersion: PROMPT_VERSION,
    latencyMs: Date.now() - startedTotal,
    cvLatencyMs: cv.latencyMs,
    geminiLatencyMs: parser.latencyMs,
    inputTokens: parser.inputTokens,
    outputTokens: parser.outputTokens,
    raw: parser.raw,
    ocrText: cv.text,
  };
}

module.exports = { extractReceiptCVHybrid, DEFAULT_MODEL };
