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
const { vertexStandort } = require('./geminiModelle');
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
// Eskalation und die Zweitprüfung: beide übergeben ihre Denkstufe ausdrücklich
// (opts.thinkingConfig hat Vorrang). ACHTUNG: Gemini 3 kennt `thinkingBudget`
// nicht mehr (Vertex lehnt es seit 22.09.2026 teilweise mit 400 ab) — für
// gemini-3.5-flash diesen Schalter NICHT setzen, sondern thinkingLevel nutzen.
const THINKING_BUDGET_RAW = process.env.CASHBACK_OCR_THINKING_BUDGET;
const THINKING_BUDGET =
  THINKING_BUDGET_RAW != null && THINKING_BUDGET_RAW !== '' && Number.isFinite(Number(THINKING_BUDGET_RAW))
    ? Number(THINKING_BUDGET_RAW)
    : null;

const _clients = new Map(); // Cache: Vertex-Standort bzw. 'apikey' → GoogleGenAI
function getClient(model, standort) {
  // Backend-Umschaltung (Incident 19.08.2026): AI-Studio-Keys haengen am
  // monatlichen Spending-Cap der Rechnungskontostufe. Ist der erreicht,
  // liefern ALLE Gemini-Calls 429 RESOURCE_EXHAUSTED — die OCR faellt dann
  // auf den isReceipt:false-Stub zurueck und der Nutzer sieht faelschlich
  // "kein Kassenbon". Vertex AI rechnet ueber die normale GCP-Abrechnung
  // und kennt dieses Stufenlimit nicht. Default = Vertex; per
  // GEMINI_USE_VERTEX=false zurueck auf den AI-Studio-Key.
  const useVertex = String(process.env.GEMINI_USE_VERTEX ?? 'true') !== 'false';
  if (useVertex) {
    // Standort ist MODELL-abhaengig (gemessen 01.10.2026, s. geminiModelle.js):
    // gemini-3.5-flash global/eu, gemini-3.1-pro-preview nur global,
    // gemini-2.5-pro (Rueckweg bis 20.10.) europe-west4. Ein ausdruecklich
    // uebergebener Standort (Eskalation: 'eu') hat Vorrang.
    const location = vertexStandort(model, { standort });
    if (_clients.has(location)) return _clients.get(location);
    const client = new GoogleGenAI({
      vertexai: true,
      project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'markendetektive-895f7',
      location,
    });
    _clients.set(location, client);
    return client;
  }
  if (_clients.has('apikey')) return _clients.get('apikey');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set on Cloud Function env');
  }
  const client = new GoogleGenAI({ apiKey });
  _clients.set('apikey', client);
  return client;
}

/**
 * Run the receipt-extraction prompt on an image.
 *
 * @param {Buffer|Uint8Array} imageBytes
 * @param {string} mimeType e.g. "image/jpeg"
 * @param {object} [opts]
 * @param {string} [opts.model]
 * @param {string} [opts.location]  Vertex-Standort; ohne Angabe je Modell
 *                                  (lib/geminiModelle.js → vertexStandort).
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
  const model = opts.model || DEFAULT_MODEL;
  const client = getClient(model, opts.location);
  const started = Date.now();

  const base64 = Buffer.isBuffer(imageBytes)
    ? imageBytes.toString('base64')
    : Buffer.from(imageBytes).toString('base64');

  // Zweitprüfung (lib/ocr_referee.js) nutzt denselben Aufruf mit eigenem
  // Prompt/Schema, eigener Denkstufe, Temperatur und hartem Zeitlimit. Ohne
  // diese Optionen verhält sich die Funktion wie zuvor.
  const abort = opts.timeoutMs > 0 ? new AbortController() : null;
  const request = client.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: opts.userPrompt || USER_PROMPT },
        ],
      },
    ],
    config: {
      systemInstruction: opts.systemInstruction || SYSTEM_PROMPT,
      temperature: Number.isFinite(opts.temperature) ? opts.temperature : 0.1,
      responseMimeType: 'application/json',
      responseSchema: opts.responseSchema || RESPONSE_SCHEMA,
      // Bricht die HTTP-Anfrage beim Zeitlimit tatsächlich ab (sonst liefe sie
      // weiter, würde abgerechnet und belegte Kontingent).
      ...(abort ? { abortSignal: abort.signal } : {}),
      // Ohne explizites Limit greift ein niedriger Default → lange Bons
      // (viele Artikel × raw-Zeile) werden mittendrin abgeschnitten → kaputtes
      // JSON oder gedroppte Items. Gleicher Guard wie im cv-hybrid-Parser.
      maxOutputTokens: 32768,
      // Denk-Budget nur für Flash-Lesungen (s. Kommentar oben). Entscheidend
      // ist die MODELLKLASSE, nicht ob opts.model gesetzt ist — ocr_robust
      // übergibt das Modell auch für Flash-Reads immer explizit. Eskalation
      // und Zweitprüfung übergeben ihre Denkstufe ausdrücklich — eine
      // übergebene Denk-Konfiguration hat Vorrang, die Eskalation bleibt so
      // vom Budget-Schalter unberührt, obwohl sie seit 01.10.2026 auch ein
      // Flash-Modell ist.
      ...(opts.thinkingConfig
        ? { thinkingConfig: opts.thinkingConfig }
        : THINKING_BUDGET != null && /flash/i.test(model)
          ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } }
          : {}),
    },
  });

  // Zeitlimit zusätzlich über Promise.race: das Abbruch-Signal wirkt nur
  // clientseitig, und ob es den laufenden Aufruf wirklich beendet, hängt am
  // Transport. So kehrt der Aufruf nach `timeoutMs` garantiert zurück.
  let timer = null;
  let response;
  // Verspätete Ablehnung nach einem Zeitlimit nicht unbehandelt lassen (sonst
  // unhandledRejection im Function-Prozess). Das Race abonniert separat.
  if (opts.timeoutMs > 0) request.catch(() => {});
  try {
    response = opts.timeoutMs > 0
      ? await Promise.race([
          request,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const err = new Error(`OCR timeout after ${opts.timeoutMs} ms (${model})`);
              err.code = 'ocr_timeout';
              if (abort) abort.abort();
              reject(err);
            }, opts.timeoutMs);
          }),
        ])
      : await request;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const latencyMs = Date.now() - started;
  const raw = response.text || '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // Bei MAX_TOKENS/SAFETY ist die Antwort leer oder abgeschnitten — der
    // Grund steht dann NUR hier, nicht im Rückgabewert.
    const finishReason = response.candidates?.[0]?.finishReason ?? null;
    const err = new Error(`OCR JSON parse failed${finishReason ? ` (${finishReason})` : ''}: ${e.message}`);
    err.raw = raw;
    err.code = 'ocr_json_decode';
    err.finishReason = finishReason;
    throw err;
  }

  const usage = response.usageMetadata || {};
  return {
    parsed,
    model,
    promptVersion: opts.promptVersion || PROMPT_VERSION,
    latencyMs,
    // Warum die Antwort endete (STOP, MAX_TOKENS …) — bei der Zweitprüfung
    // endet ein Denk-Überlauf sonst still als JSON-Fehler.
    finishReason: response.candidates?.[0]?.finishReason ?? null,
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

// Warenkorb-Rabatt (14.09.2026, ClickUp 86cbfvwge): 18 von 44 Ablehnungen
// wegen reconciliation_delta mit Bewertung 'none' waren RICHTIG gelesen —
// Σ Artikel entsprach exakt der gedruckten Zwischensumme, der Endbetrag lag
// nur wegen eines Rabatts auf den ganzen Einkauf darunter („5% Rabatt
// Warenkorb −3,95", „Gutschein Netto-App −2,00"). Die Überschuss-Toleranz von
// 50 ct kann das nicht abbilden. Anerkannt wird so ein Bon NUR mit Belegkette:
// die Lesung nennt die Rabattzeilen einzeln (`basketDiscounts`), Σ Artikel =
// Zwischensumme und Zwischensumme − Rabatte = Endbetrag, jeweils ±2 ct.
// Das Haupt-Schema (v1.4) kennt `basketDiscounts` nicht — der Zweig wirkt
// daher ausschließlich auf Lesungen der Zweitprüfung (lib/prompt_referee.js).
const BASKET_DISCOUNT_TOLERANCE_CENTS = 2;
// Plausibilitätsgrenzen (Review 14.09.): ohne sie besteht auch eine Lesung,
// die jeden Artikel doppelt aufführt und die Differenz als erfundenen
// „Rabatt" ausweist (5 Artikel × 2 € → 10 Artikel, Zwischensumme 20 €, Rabatt
// 10 €) — genau die Verdopplung, gegen die die 50-ct-Grenze steht. Gesehen
// wurden 2 €, 3,95 € (5 %) und 5 €; Mitarbeiter-/Coupon-Rabatte liegen
// üblich bei 10–20 %. Größere Abzüge sind eher Zahlungszeilen.
const BASKET_DISCOUNT_MAX_SHARE = 0.25;
const BASKET_DISCOUNT_MAX_CENTS = 2000;
// Eine Rabattzeile muss als solche benannt sein — ein Betrag ohne Bezeichnung
// ist kein Beleg.
const BASKET_DISCOUNT_LABEL = /rabatt|gutschein|coupon|kupon|nachlass|prozent|%|vorteil|ersparnis|abzug|aktion|discount|bonus/i;

/** Summe der benannten Warenkorb-Rabatte in Cent (unbenannte zählen nicht). */
function basketDiscountCents(parsed) {
  if (!parsed || !Array.isArray(parsed.basketDiscounts)) return 0;
  return parsed.basketDiscounts.reduce(
    (acc, d) => acc + (
      d && Number.isFinite(d.cents) && typeof d.label === 'string' && BASKET_DISCOUNT_LABEL.test(d.label)
        ? Math.abs(d.cents)
        : 0
    ),
    0,
  );
}

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
  if (!ok) {
    const rabatt = basketDiscountCents(parsed);
    const subtotal = Number.isFinite(parsed.subtotalCents) ? parsed.subtotalCents : null;
    if (
      rabatt > 0
      && subtotal != null
      && subtotal > 0
      && rabatt < subtotal * BASKET_DISCOUNT_MAX_SHARE
      && rabatt <= BASKET_DISCOUNT_MAX_CENTS
      && Math.abs(sumItemsCents - subtotal) <= BASKET_DISCOUNT_TOLERANCE_CENTS
      && Math.abs(subtotal - rabatt - total) <= BASKET_DISCOUNT_TOLERANCE_CENTS
    ) {
      return { ok: true, sumItemsCents, deltaCents, signedDeltaCents, direction: 'basket_discount', basketDiscountCents: rabatt };
    }
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

module.exports = { extractReceipt, reconcile, basketDiscountCents, countEligibleItems, tierFor, isPfandItem, DEFAULT_MODEL };
