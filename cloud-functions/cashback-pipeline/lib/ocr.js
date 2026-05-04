/**
 * Gemini-based OCR for DACH supermarket receipts.
 *
 * Ported (functionally) from tools/cashback-ocr-validation/validate.py
 * — image bytes + system prompt → strict-JSON response.
 *
 * Reconciliation gate (Σ items vs total ± 0.05 €) is enforced by the
 * caller in process.js, not here. This module only does the LLM call.
 *
 * Auth: GEMINI_API_KEY env var is set on the Cloud Function. Pull from
 * Secret Manager in production deploys; never commit it.
 */

'use strict';

const { GoogleGenAI } = require('@google/genai');
const {
  SYSTEM_PROMPT,
  USER_PROMPT,
  RESPONSE_SCHEMA,
  VERSION: PROMPT_VERSION,
} = require('./prompt');

const DEFAULT_MODEL = process.env.CASHBACK_OCR_MODEL || 'gemini-2.5-flash';

let _client = null;
function getClient() {
  if (_client) return _client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set on Cloud Function env');
  }
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

/**
 * Run the receipt-extraction prompt on an image.
 *
 * @param {Buffer|Uint8Array} imageBytes
 * @param {string} mimeType e.g. "image/jpeg"
 * @param {object} [opts]
 * @param {string} [opts.model]
 * @returns {Promise<{
 *   parsed: object,
 *   model: string,
 *   promptVersion: string,
 *   latencyMs: number,
 *   inputTokens: number|null,
 *   outputTokens: number|null,
 *   raw: string,
 * }>}
 */
async function extractReceipt(imageBytes, mimeType, opts = {}) {
  const client = getClient();
  const model = opts.model || DEFAULT_MODEL;
  const started = Date.now();

  const base64 = Buffer.isBuffer(imageBytes)
    ? imageBytes.toString('base64')
    : Buffer.from(imageBytes).toString('base64');

  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: USER_PROMPT },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      temperature: 0.1,
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
    const err = new Error(`OCR JSON parse failed: ${e.message}`);
    err.raw = raw;
    err.code = 'ocr_json_decode';
    throw err;
  }

  const usage = response.usageMetadata || {};
  return {
    parsed,
    model,
    promptVersion: PROMPT_VERSION,
    latencyMs,
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: usage.candidatesTokenCount ?? null,
    raw,
  };
}

/**
 * Reconciliation: |Σ items - total| ≤ 0.05€.
 * Returns { ok, sumItemsCents, deltaCents }.
 */
function reconcile(parsed) {
  if (!parsed || !Array.isArray(parsed.items)) {
    return { ok: false, sumItemsCents: 0, deltaCents: null };
  }
  const sumItemsCents = parsed.items.reduce(
    (acc, it) => acc + (Number.isFinite(it.priceCents) ? it.priceCents : 0),
    0,
  );
  const total = Number.isFinite(parsed.totalCents) ? parsed.totalCents : null;
  if (total == null) {
    return { ok: false, sumItemsCents, deltaCents: null };
  }
  const deltaCents = Math.abs(total - sumItemsCents);
  return { ok: deltaCents <= 5, sumItemsCents, deltaCents };
}

/**
 * Eligibility: an item counts toward the tier when it has a positive
 * price, a non-empty name, and the merchant is on the eligible list.
 *
 * Phase 2 v1: catalog matching (productId / brandId mapping) is NOT
 * done here yet — that lands in Phase 3. For now we count all items
 * with positive price as "eligible" so the tier formula has data to
 * work with.
 */
function countEligibleItems(parsed) {
  if (!parsed || !Array.isArray(parsed.items)) return 0;
  return parsed.items.filter(
    (it) => it && typeof it.name === 'string' && Number.isFinite(it.priceCents) && it.priceCents > 0,
  ).length;
}

/**
 * Apply tier formula from the cashback config.
 */
function tierFor(eligibleItemCount, tiers) {
  const sorted = [...(tiers || [])].sort((a, b) => b.minItems - a.minItems);
  for (const t of sorted) {
    if (eligibleItemCount >= t.minItems) return t.cents;
  }
  return 0;
}

module.exports = { extractReceipt, reconcile, countEligibleItems, tierFor, DEFAULT_MODEL };
