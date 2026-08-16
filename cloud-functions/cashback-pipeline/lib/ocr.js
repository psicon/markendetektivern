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

// gemini-3.5-flash: an 37 echten Bons gegen 2.5-flash gemessen — 30/37 vs
// 18/37 Reconciliation-clean, bei langen Bons (Kaufland 24-29 Artikel) droppt
// 2.5 reproduzierbar Positionen. 3.5 ist projektweit Standard (crowd-upload-
// namer, ai-product-comparison). Override via CASHBACK_OCR_MODEL.
const DEFAULT_MODEL = process.env.CASHBACK_OCR_MODEL || 'gemini-3.5-flash';

// Denk-Budget der Flash-Lesungen (Kostenanalyse 16.08.2026): Ohne gesetztes
// thinkingConfig erzeugt gemini-3.5-flash unsichtbare Denk-Token — gemessen
// 60-69 % ALLER Output-Token, abgerechnet zum Output-Preis (9 $/1M). Das
// waren ~92 % der OCR-Kosten. Der Wert kommt aus der Env, damit sich das
// Verhalten OHNE Deploy-Risiko steuern lässt:
//   nicht gesetzt → Verhalten wie bisher (Denk-Budget frei, teuer)
//   '0'           → Denken aus (wie crowd-upload-namer + receipt-matcher
//                   es projektweit längst tun)
//   'N'           → gedeckeltes Budget
// NUR nach bestandener Regressionsmessung an echten Juli-Bons setzen — die
// Konsens-Mechanik (2 übereinstimmende Lesungen, sonst Eskalation) bleibt
// unverändert die Qualitätssicherung dahinter. Gilt bewusst NICHT für die
// Pro-Eskalation (opts.model gesetzt): das starke Modell behält sein Denken
// als letzte Rettung schwerer Bons.
const THINKING_BUDGET_RAW = process.env.CASHBACK_OCR_THINKING_BUDGET;
const THINKING_BUDGET =
  THINKING_BUDGET_RAW != null && THINKING_BUDGET_RAW !== '' && Number.isFinite(Number(THINKING_BUDGET_RAW))
    ? Number(THINKING_BUDGET_RAW)
    : null;

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
      // Ohne explizites Limit greift ein niedriger Default → lange Bons
      // (viele Artikel × raw-Zeile) werden mittendrin abgeschnitten → kaputtes
      // JSON oder gedroppte Items. Gleicher Guard wie im cv-hybrid-Parser.
      maxOutputTokens: 32768,
      // Denk-Budget nur für Flash-Lesungen (s. Kommentar oben). Entscheidend
      // ist die MODELLKLASSE, nicht ob opts.model gesetzt ist — ocr_robust
      // übergibt das Modell auch für Flash-Reads immer explizit. Die
      // Pro-Eskalation ('gemini-2.5-pro') bleibt unangetastet: sie
      // unterstützt Budget 0 nicht und ist die letzte Rettung schwerer Bons.
      ...(THINKING_BUDGET != null && /flash/i.test(model)
        ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } }
        : {}),
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
    // Unsichtbare Denk-Token — bisher nirgends erfasst, dadurch war der
    // Hauptkostentreiber (60-69 % der Output-Token) monatelang unsichtbar.
    // Ab jetzt fließt der Wert in receipts/*.ocr und macht die Kosten je
    // Bon aus den eigenen Daten ablesbar (Kostenanalyse 16.08.2026).
    thoughtsTokens: usage.thoughtsTokenCount ?? null,
    raw,
  };
}

/**
 * Reconciliation: Σ items vs total, asymmetric tolerance.
 *
 * The OCR prompt explicitly excludes Pfand / Rabatt lines from the
 * items array (they're meta, not items). That means real bons routinely
 * have Σ items < total by ~0.25–3 € because of:
 *   • bottle deposits (Pfand) — typically 0.08–0.25 € per item
 *   • bag fees, ID-checked age verification fee
 *   • category-level discounts (Rabattaktionen)
 *   • rounding / cash-truncation
 *
 * Asymmetric thresholds (the key insight):
 *   - Σ < total (positive delta): up to RECON_TOLERANCE_UNDERSHOOT_CENTS
 *     allowed. This is the *normal* Pfand case.
 *   - Σ > total (negative delta): only RECON_TOLERANCE_OVERSHOOT_CENTS
 *     allowed. This is *suspicious* — usually means a Rabatt-Zeile was
 *     missed or an item got double-extracted by the LLM. Triggers
 *     escalation to DocAI.
 *
 * Returns:
 *   { ok, sumItemsCents, deltaCents, signedDeltaCents, direction }
 *
 *   - deltaCents: absolute |Σ - total|
 *   - signedDeltaCents: total - Σ (positive = items missing/Pfand, negative = items duplicated)
 *   - direction: 'undershoot' | 'overshoot' | 'match' | 'unknown'
 */
const RECON_TOLERANCE_UNDERSHOOT_CENTS = 200; // Σ < total: Pfand-tolerant
const RECON_TOLERANCE_OVERSHOOT_CENTS = 50;   // Σ > total: tight, missed-discount territory

function reconcile(parsed) {
  if (!parsed || !Array.isArray(parsed.items)) {
    return {
      ok: false,
      sumItemsCents: 0,
      deltaCents: null,
      signedDeltaCents: null,
      direction: 'unknown',
    };
  }
  const sumItemsCents = parsed.items.reduce(
    (acc, it) => acc + (Number.isFinite(it.priceCents) ? it.priceCents : 0),
    0,
  );
  const total = Number.isFinite(parsed.totalCents) ? parsed.totalCents : null;
  if (total == null) {
    return {
      ok: false,
      sumItemsCents,
      deltaCents: null,
      signedDeltaCents: null,
      direction: 'unknown',
    };
  }
  const signedDeltaCents = total - sumItemsCents;
  const deltaCents = Math.abs(signedDeltaCents);
  let direction;
  let ok;
  if (signedDeltaCents > 0) {
    direction = 'undershoot'; // Σ < total — normal Pfand case
    ok = deltaCents <= RECON_TOLERANCE_UNDERSHOOT_CENTS;
  } else if (signedDeltaCents < 0) {
    direction = 'overshoot'; // Σ > total — suspicious
    ok = deltaCents <= RECON_TOLERANCE_OVERSHOOT_CENTS;
  } else {
    direction = 'match';
    ok = true;
  }
  return { ok, sumItemsCents, deltaCents, signedDeltaCents, direction };
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
/**
 * Pfand/Leergut ist KEIN anrechenbarer Artikel (kein Produktkauf, nur
 * Flaschenpfand). 86ca0wbg7: zählt NICHT für Cashback + Item-Eligibility.
 * Erkennung: OCR-`category === 'Pfand'` ODER Name/raw enthält pfand/leergut.
 * (Reconciliation bleibt unberührt — Pfand bleibt für die Summen-Prüfung im
 *  items-Array, nur die Eligibility ändert sich.)
 */
function isPfandItem(it) {
  if (!it) return false;
  if (typeof it.category === 'string' && it.category.trim().toLowerCase() === 'pfand') return true;
  const n = String(it.name ?? it.raw ?? '').toLowerCase();
  return /pfand|leergut/.test(n);
}

function countEligibleItems(parsed) {
  if (!parsed || !Array.isArray(parsed.items)) return 0;
  return parsed.items.filter(
    (it) =>
      it &&
      typeof it.name === 'string' &&
      Number.isFinite(it.priceCents) &&
      it.priceCents > 0 &&
      !isPfandItem(it),
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

module.exports = { extractReceipt, reconcile, countEligibleItems, tierFor, isPfandItem, DEFAULT_MODEL };
