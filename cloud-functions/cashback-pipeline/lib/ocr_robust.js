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

const { extractReceipt, reconcile, countEligibleItems, DEFAULT_MODEL } = require('./ocr');
const { enhanceForOcr } = require('./imageEnhance');

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

/**
 * Fingerabdruck EINER Lesung über die prämienrelevanten Größen (86cbet2w1).
 *
 * Bis hierher wurden alle nicht gewählten Lesungen in pack() verworfen — die
 * einzige Aussage über die Stabilität der Erkennung war damit die SEQUENZ-
 * Übereinstimmung (name#priceCents über ALLE Positionen). Bei 30 bis 70
 * Positionen kippt die schon eine abweichend gelesene Artikelbezeichnung,
 * obwohl an Markt, Datum, Endsumme und Betrag nichts wackelt.
 *
 * Bewusst ROHWERTE statt eines fertigen Urteils: so bleibt der Vergleich am
 * Dokument nachvollziehbar und auf dem Cache-/Wiederholungspfad neu
 * berechenbar, ohne das Bild noch einmal zu lesen.
 */
function readFingerprint(r) {
  const p = (r && r.parsed) || {};
  return {
    isReceipt: p.isReceipt !== false,
    merchant: p.merchant == null ? null : String(p.merchant).slice(0, 120),
    bonCountry: p.bonCountry == null ? null : String(p.bonCountry).slice(0, 8),
    bonDate: typeof p.bonDate === 'string' ? p.bonDate.slice(0, 10) : null,
    bonTime: typeof p.bonTime === 'string' ? p.bonTime.slice(0, 5) : null,
    totalCents: Number.isFinite(p.totalCents) ? p.totalCents : null,
    itemCount: Array.isArray(p.items) ? p.items.length : 0,
    eligibleItems: countEligibleItems(p),
    reconOk: reconciles(r),
    model: r && r.__pro ? 'pro' : r && r.__enh ? 'flash-enhanced' : 'flash',
  };
}

function pack(chosen, confidence, method, reads, failedAttempts = 0) {
  const proAttempts = reads.filter((r) => r && r.__pro).length;
  const usedEnhanced = reads.some((r) => r && r.__enh);
  const out = { ...chosen };
  delete out.__pro;
  delete out.__enh;
  out.engine = 'gemini-robust';
  out.robust = {
    confidence, // 'high' | 'medium' | 'low' | 'none'
    method, // how the result was chosen
    attempts: reads.length,
    failedAttempts, // geworfene (nicht gezählte) Lese-Versuche — Observability
    proAttempts,
    enhanced: usedEnhanced,
    agreement: confidence === 'high' || confidence === 'medium',
    // Alle Lesungen als Fingerabdruck — Grundlage der feldweisen Prüfung im
    // Freigabe-Gate. Kostet keinen zusätzlichen Modell-Aufruf.
    reads: reads.map(readFingerprint),
  };
  return out;
}

/**
 * @param {Buffer} imageBytes
 * @param {string} mimeType
 * @param {object} [opts] {model, proModel, maxFlash, escalationGate}
 *   escalationGate: optionale async Funktion (reads) => string|null.
 *   Eskalations-Deckel (Kosten, 86cb-Nachtrag 19.08.2026): Liefert sie einen
 *   Grund (z.B. 'bon_too_old'), wird die TEURE Leiter (Enhance-Lesungen +
 *   Pro-Modell) übersprungen und das beste vorhandene Ergebnis zurückgegeben —
 *   der Bon scheitert ohnehin an einem Policy-Gate, jede weitere Lesung wäre
 *   verschwendet. Die eigentliche Ablehnung trifft weiterhin NUR der
 *   Gate-Block in index.js (gleiche Resolver/Berechnungen, kein Drift).
 *   Gate-Fehler führen NIE zum Kappen (fail-open zu voller Qualität).
 * @returns extractReceipt()-shaped result + `robust` metadata.
 */
async function extractReceiptRobust(imageBytes, mimeType, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const proModel = opts.proModel || PRO_MODEL;
  const maxFlash = opts.maxFlash || MAX_FLASH;
  const reads = [];
  // Incident 19.08.2026: geworfene Versuche wurden hier still verschluckt.
  // Bei Totalausfall (z.B. 429 Spending-Cap) blieb `reads` leer → Phase 4
  // lieferte den isReceipt:false-Stub → Nutzer sah fälschlich „kein
  // Kassenbon". Jetzt: jeden Fehlversuch loggen + sammeln; bleibt ALLES
  // leer, ist das ein Infrastrukturfehler → werfen (Retry/Review), nie Stub.
  const failed = [];
  const noteFailure = (phase, e) => {
    failed.push(`${phase}: ${String(e && e.message ? e.message : e).slice(0, 160)}`);
    console.warn('ocr-attempt-failed', { phase, err: String(e && e.message ? e.message : e).slice(0, 300) });
  };

  // Phase 1 — flash self-consistency with early stop on agreement.
  for (let i = 0; i < maxFlash; i++) {
    let r;
    try {
      r = await extractReceipt(imageBytes, mimeType, { model });
    } catch (e) {
      noteFailure(`flash-${i + 1}`, e);
      continue;
    }
    reads.push(r);
    const agreed = findAgreement(reads);
    if (agreed) return pack(agreed, 'high', 'flash-agreement', reads, failed.length);
  }

  // Eskalations-Deckel: Vor der teuren Leiter (Enhance + Pro) prüfen, ob der
  // Bon laut ≥2 unabhängigen Basis-Lesungen ohnehin an einem Policy-Gate
  // scheitern wird. Wenn ja: bestes vorhandenes Ergebnis zurückgeben, Leiter
  // sparen. Confidence bleibt ehrlich (low/none) — sollte der Bon wider
  // Erwarten alle Gates passieren, hält das Review-Gate ihn (nie Auto-Payout).
  const checkCap = async () => {
    if (typeof opts.escalationGate !== 'function') return null;
    try {
      return await opts.escalationGate(reads);
    } catch (e) {
      console.warn('escalation-gate-failed', { err: String(e && e.message ? e.message : e).slice(0, 200) });
      return null; // fail-open: volle Qualität
    }
  };
  const capReason = await checkCap();
  if (capReason) {
    const best = reads.find(reconciles) || reads[0];
    if (best) {
      const out = pack(best, reconciles(best) ? 'low' : 'none', `escalation-capped:${capReason}`, reads, failed.length);
      out.robust.cappedReason = capReason;
      return out;
    }
  }

  // Phase 1.5 — no agreement on the ORIGINAL → enhance the image (upscale +
  // sharpen + contrast) and read it again. Image quality, not reasoning, is
  // the bottleneck on creased bons. Best-effort: fall back to original bytes.
  let enhanced = null;
  try {
    enhanced = await enhanceForOcr(imageBytes);
  } catch (e) {
    enhanced = null;
  }
  const escImg = enhanced || imageBytes;
  if (enhanced) {
    for (let i = 0; i < 2; i++) {
      let r;
      try {
        r = await extractReceipt(escImg, 'image/jpeg', { model });
      } catch (e) {
        noteFailure(`enhanced-${i + 1}`, e);
        continue;
      }
      r.__enh = true;
      reads.push(r);
      const agreed = findAgreement(reads);
      if (agreed) return pack(agreed, 'high', 'enhanced-agreement', reads, failed.length);
    }
  }

  // Eskalations-Deckel, zweiter Check-Punkt: die Enhance-Lesungen können das
  // Policy-Signal erhärtet haben; die Pro-Phase ist die teuerste Stufe.
  const capReason2 = await checkCap();
  if (capReason2) {
    const best = reads.find(reconciles) || reads[0];
    if (best) {
      const out = pack(best, reconciles(best) ? 'low' : 'none', `escalation-capped:${capReason2}`, reads, failed.length);
      out.robust.cappedReason = capReason2;
      return out;
    }
  }

  // Phase 2 — escalate to the stronger model on the (enhanced) image;
  // agreement incl. a pro read.
  for (let i = 0; i < 2; i++) {
    let r;
    try {
      r = await extractReceipt(escImg, enhanced ? 'image/jpeg' : mimeType, { model: proModel });
    } catch (e) {
      noteFailure(`pro-${i + 1}`, e);
      continue;
    }
    r.__pro = true;
    reads.push(r);
    const agreed = findAgreement(reads);
    if (agreed) {
      const conf = agreed.__pro ? 'medium' : 'high';
      return pack(agreed, conf, 'pro-agreement', reads, failed.length);
    }
  }

  // Infrastruktur-Gate (Incident 19.08.2026): KEIN einziger Versuch hat eine
  // Antwort geliefert → das Bild wurde nie angesehen. Das ist ein Backend-
  // Ausfall (429/Netz/Auth), NIEMALS eine Aussage über den Bon. Werfen statt
  // Stub → index.js behandelt es als transient (Retry, danach 'review').
  if (reads.length === 0) {
    const err = new Error(`ocr_unavailable: all ${failed.length} read attempts failed — last: ${failed[failed.length - 1] || 'n/a'}`);
    err.code = 'ocr_unavailable';
    throw err;
  }

  // Phase 3 — no agreement. Prefer any reconciling read (best-effort), low conf.
  const anyRec = reads.find(reconciles);
  if (anyRec) return pack(anyRec, 'low', 'reconcile-no-agreement', reads, failed.length);

  // Phase 4 — nothing reconciles; hand back the first read for the recon gate.
  // `reads` ist hier garantiert nicht leer (Infrastruktur-Gate oben) — der
  // Stub-Fallback bleibt nur als Form-Sicherheit erhalten.
  const first = reads[0] || { parsed: { isReceipt: false, items: [] }, model, promptVersion: null, latencyMs: 0 };
  return pack(first, 'none', 'no-reconcile', reads, failed.length);
}

module.exports = { extractReceiptRobust, sigOf, PRO_MODEL };
