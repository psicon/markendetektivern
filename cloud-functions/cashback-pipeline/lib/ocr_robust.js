/**
 * Robust OCR wrapper — self-consistency + cross-run agreement confidence.
 *
 * Why: a SINGLE image read is non-deterministic on degraded (creased/faded)
 * thermal bons. Under the pipeline's policy a non-reconciling read is REJECTED
 * outright — so one unlucky read unfairly costs the user their cashback; and a
 * single read that happens to reconcile via a swap/compensating error could
 * auto-pay on wrong data. Both are mitigated by reading the image several times
 * and trusting the result that INDEPENDENT runs agree on.
 *
 * Strategy (cost scales with difficulty — easy bons stop after 2 reads):
 *   1. Up to `maxFlash` flash reads; stop as soon as 2 reconciling reads
 *      produce the IDENTICAL (name#price) sequence → confidence 'high'.
 *   2. If no flash agreement, escalate to a stronger model (pro) up to 2×;
 *      agreement that includes a pro read → 'medium'.
 *   3. No agreement but at least one read reconciles → that read, 'low'.
 *   4. Nothing reconciles → first read, 'none' (the recon gate rejects it).
 *
 * Agreement is on the ORDERED (name#price) sequence, so it catches swaps and
 * compensating errors that Σ==total alone cannot. The returned shape matches
 * extractReceipt() so the downstream pipeline is unchanged; `robust` carries
 * the confidence/method/attempts for observability + an optional approval gate.
 */

'use strict';

const { extractReceipt, reconcile, DEFAULT_MODEL } = require('./ocr');

const PRO_MODEL = process.env.CASHBACK_OCR_PRO_MODEL || 'gemini-2.5-pro';
const MAX_FLASH = Number(process.env.CASHBACK_OCR_MAX_FLASH || 3);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sigOf = (items) => (items || []).map((i) => `${norm(i.name)}#${i.priceCents}`).join('|');

function reconciles(read) {
  return !!read && read.parsed && read.parsed.isReceipt !== false && reconcile(read.parsed).ok;
}

/** A (name#price) sequence shared by ≥2 reconciling reads → return one such read. */
function findAgreement(reads) {
  const counts = new Map();
  for (const r of reads) {
    if (!reconciles(r)) continue;
    const s = sigOf(r.parsed.items);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [s, c] of counts) {
    if (c > bestCount) {
      best = s;
      bestCount = c;
    }
  }
  if (bestCount >= 2) return reads.find((r) => reconciles(r) && sigOf(r.parsed.items) === best);
  return null;
}

function pack(chosen, confidence, method, reads) {
  const proAttempts = reads.filter((r) => r && r.__pro).length;
  const out = { ...chosen };
  delete out.__pro;
  out.engine = 'gemini-robust';
  out.robust = {
    confidence, // 'high' | 'medium' | 'low' | 'none'
    method, // how the result was chosen
    attempts: reads.length,
    proAttempts,
    agreement: confidence === 'high' || confidence === 'medium',
  };
  return out;
}

/**
 * @param {Buffer} imageBytes
 * @param {string} mimeType
 * @param {object} [opts] {model, proModel, maxFlash}
 * @returns extractReceipt()-shaped result + `robust` metadata.
 */
async function extractReceiptRobust(imageBytes, mimeType, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const proModel = opts.proModel || PRO_MODEL;
  const maxFlash = opts.maxFlash || MAX_FLASH;
  const reads = [];

  // Phase 1 — flash self-consistency with early stop on agreement.
  for (let i = 0; i < maxFlash; i++) {
    let r;
    try {
      r = await extractReceipt(imageBytes, mimeType, { model });
    } catch (e) {
      continue;
    }
    reads.push(r);
    const agreed = findAgreement(reads);
    if (agreed) return pack(agreed, 'high', 'flash-agreement', reads);
  }

  // Phase 2 — escalate to the stronger model; agreement incl. a pro read.
  for (let i = 0; i < 2; i++) {
    let r;
    try {
      r = await extractReceipt(imageBytes, mimeType, { model: proModel });
    } catch (e) {
      continue;
    }
    r.__pro = true;
    reads.push(r);
    const agreed = findAgreement(reads);
    if (agreed) {
      const conf = agreed.__pro ? 'medium' : 'high';
      return pack(agreed, conf, 'pro-agreement', reads);
    }
  }

  // Phase 3 — no agreement. Prefer any reconciling read (best-effort), low conf.
  const anyRec = reads.find(reconciles);
  if (anyRec) return pack(anyRec, 'low', 'reconcile-no-agreement', reads);

  // Phase 4 — nothing reconciles; hand back the first read for the recon gate.
  const first = reads[0] || { parsed: { isReceipt: false, items: [] }, model, promptVersion: null, latencyMs: 0 };
  return pack(first, 'none', 'no-reconcile', reads);
}

module.exports = { extractReceiptRobust, sigOf, PRO_MODEL };
