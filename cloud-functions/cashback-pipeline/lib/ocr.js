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
const { geminiKennung, nutztVertex, ZWECK } = require('./geminiKennung');
const { belegBereinigen } = require('./belegart');
const { abgleichOptionen, istPunkteZahlungZeile, itemsOhnePunkteZahlung } = require('./punkteZahlung');
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
// Dafür gibt es seit 08.10.2026 den Firestore-Schalter
// `cashback_config/v1.ocrDenkstufe` (lib/geminiModelle.js denkstufeAus): die
// Robust-Leiter übergibt die Stufe dann als opts.thinkingConfig, und die hat
// hier Vorrang vor diesem Env-Schalter (Begründung: lib/ocr_robust.js).
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
  // GEMINI_USE_VERTEX=false zurueck auf den AI-Studio-Key. Dieselbe Regel
  // entscheidet, ob die Kosten-Kennung mitgeht (lib/geminiKennung.js).
  if (nutztVertex()) {
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
 * @param {string} [opts.zweck]     Kosten-Kennung der Stufe (lib/geminiKennung.js
 *                                  ZWECK); ohne Angabe 'bon-ocr'.
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
      // Kosten-Kennung je Stufe (08.10.2026) — nur auf dem Vertex-Pfad, auf
      // dem AI-Studio-Pfad würde das SDK die Anfrage ablehnen.
      ...geminiKennung(opts.zweck || ZWECK.BON_OCR),
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

  // Prompt v1.5 (04.10.2026): Belegart normalisieren und bei einer Online-
  // Bestellung die Kundenanschrift aus dem Kopf nehmen — HIER, vor jeder
  // Speicherung (Zwischenstand, Zweitprüfung, OCR-Feld am Bon). Die Fassung
  // der Lesung entscheidet, ob eingelöste Punkte in die Artikelsumme einer
  // Rechnung ohne Endbetrag zählen (v1.6: nein, lib/punkteZahlung.js; jede
  // andere Fassung: {} → wie bisher).
  parsed = belegBereinigen(parsed, abgleichOptionen(opts.promptVersion || PROMPT_VERSION));

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
// Prompt v1.5 (Coupon-Fix 05.10.2026) liest solche Zeilen in der HAUPT-Lesung
// als Items mit negativem Preis und category 'Warenkorbrabatt' — für sie gilt
// dieselbe Belegkette mit denselben Grenzen (reconcileMitRabattZeilen unten).
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

// Kennzeichen einer Rabattzeile auf den ganzen Einkauf in `items` (Prompt v1.5,
// Regel 16). v1.4 kennt die Kategorie nicht — in 3.982 gespeicherten
// v1.4-Lesungen (21.09.–04.10.2026) kam sie kein einziges Mal vor (negative
// Zeilen trugen 'Pfand', 'Rabatt', 'Discount' oder nichts). Daran hängt, dass
// v1.4-Lesungen exakt wie bisher abgeglichen werden.
const WARENKORB_RABATT_KATEGORIE = 'warenkorbrabatt';

/** Trägt die Zeile die Kategorie einer Warenkorb-Rabattzeile (egal welches Vorzeichen)? */
function istRabattKategorie(it) {
  return Boolean(it)
    && typeof it.category === 'string'
    && it.category.trim().toLowerCase().replace(/[\s_-]+/g, '') === WARENKORB_RABATT_KATEGORIE;
}

/** Rabattzeile auf den ganzen Einkauf nach Prompt v1.5: Kategorie UND negativer Preis. */
function istWarenkorbRabattZeile(it) {
  return istRabattKategorie(it) && Number.isFinite(it.priceCents) && it.priceCents < 0;
}

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

/**
 * Abgleich einer Lesung mit Rabattzeilen auf den ganzen Einkauf (Prompt v1.5,
 * Coupon-Fix 05.10.2026). Die Zeilen stehen mit negativem Preis in `items`;
 * die Summe aller Items enthält sie also schon. Weil damit eine einzige
 * erfundene Rabattzeile jede Überzahl doppelt gelesener Artikel ausgleichen
 * könnte, gelten dieselben Regeln wie für `basketDiscounts` der Zweitprüfung:
 *   • jede Rabattzeile ist als solche benannt (BASKET_DISCOUNT_LABEL, Name oder
 *     raw),
 *   • Rabatt < 25 % der Zwischensumme (ohne eigene gedruckte: der Summe der
 *     übrigen Items) und höchstens 20 € — diese Grenzen bleiben auch hier
 *     bestehen,
 *   • steht eine eigene Zwischensumme auf dem Bon (gedruckt, ≠ Endbetrag):
 *     Belegkette — Σ übrige Items = Zwischensumme und Zwischensumme − Rabatt =
 *     Endbetrag, jeweils ±2 ct,
 *   • sonst (keine oder gleich dem Endbetrag gedruckt — die Rabatte stehen
 *     dann zwischen den Artikeln): der bisherige Abgleich der Summe aller
 *     Items, wie v1.4 negative Zeilen schon immer abgleicht. Strenger als v1.4
 *     ist dort nur die Grenze.
 * Die Zeilen zählen nie als Artikel (countEligibleItems).
 */
function reconcileMitRabattZeilen(parsed, zeilen, sumItemsCents, total) {
  const rabatt = zeilen.reduce((acc, z) => acc + Math.abs(z.priceCents), 0);
  const brutto = sumItemsCents + rabatt; // Σ aller übrigen Items
  const signedDeltaCents = total - sumItemsCents;
  const deltaCents = Math.abs(signedDeltaCents);
  const subtotal = Number.isFinite(parsed.subtotalCents) && parsed.subtotalCents > 0 ? parsed.subtotalCents : null;
  const benannt = zeilen.every((z) => BASKET_DISCOUNT_LABEL.test(`${z.name ?? ''} ${z.raw ?? ''}`));
  const eigeneZwischensumme = subtotal != null && Math.abs(subtotal - total) > BASKET_DISCOUNT_TOLERANCE_CENTS;
  // Bezug der Grenze: die Zwischensumme VOR den Rabatten — ohne eigene
  // gedruckte (fehlt oder = Endbetrag) die Summe der übrigen Items.
  const basis = eigeneZwischensumme ? subtotal : brutto;
  const inGrenzen = basis > 0 && rabatt < basis * BASKET_DISCOUNT_MAX_SHARE && rabatt <= BASKET_DISCOUNT_MAX_CENTS;
  let belegt;
  if (eigeneZwischensumme) {
    belegt = Math.abs(brutto - subtotal) <= BASKET_DISCOUNT_TOLERANCE_CENTS
      && Math.abs(subtotal - rabatt - total) <= BASKET_DISCOUNT_TOLERANCE_CENTS;
  } else {
    belegt = signedDeltaCents >= 0
      ? deltaCents <= RECON_TOLERANCE_UNDERSHOOT_CENTS
      : deltaCents <= RECON_TOLERANCE_OVERSHOOT_CENTS;
  }
  const ok = benannt && inGrenzen && belegt;
  return {
    ok,
    sumItemsCents,
    deltaCents,
    signedDeltaCents,
    direction: ok ? 'basket_discount' : 'basket_discount_unbelegt',
    basketDiscountCents: rabatt,
  };
}

/**
 * @param {object} parsed  Lesung (items[], totalCents, subtotalCents …)
 * @param {object} [opts]  Abgleich-Optionen zur Fassung der Lesung
 *        (lib/punkteZahlung.js abgleichOptionen). Nur `punkteAlsZahlung: true`
 *        (Prompt v1.6) ändert etwas: negative Zeilen mit eingelösten Punkten
 *        zählen nicht zur Summe (Zahlungsmittel, Regel 17) — das Ergebnis trägt
 *        dann `punkteZahlungCents`. Ohne Angabe: Abgleich wie vor dem 08.10.2026.
 */
function reconcile(parsed, opts = {}) {
  if (!parsed || !Array.isArray(parsed.items)) {
    return {
      ok: false,
      sumItemsCents: 0,
      deltaCents: null,
      signedDeltaCents: null,
      direction: 'unknown',
    };
  }
  // Prompt v1.6 (08.10.2026): eine Punkte-Zahlungszeile wie eine Zahlungszeile
  // behandeln — aus der Summe (und aus den Rabattzeilen) nehmen und den
  // übrigen Abgleich unverändert rechnen. Ohne solche Zeile: kein Unterschied.
  if (opts && opts.punkteAlsZahlung === true) {
    const ohne = itemsOhnePunkteZahlung(parsed.items, opts);
    if (ohne.length !== parsed.items.length) {
      const punkteZahlungCents = parsed.items.reduce((acc, it) => acc + (istPunkteZahlungZeile(it) ? -it.priceCents : 0), 0);
      return { ...reconcile({ ...parsed, items: ohne }), punkteZahlungCents };
    }
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
  // Prompt v1.5: Rabattzeilen in items → eigene Prüfung (Belegkette, Grenzen).
  const rabattZeilen = parsed.items.filter(istWarenkorbRabattZeile);
  if (rabattZeilen.length) return reconcileMitRabattZeilen(parsed, rabattZeilen, sumItemsCents, total);
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

/**
 * ═══ Storno- und Rückgabezeilen beim Zählen aufrechnen (08.10.2026) ═══
 * Prompt v1.5 Regel 16 lässt Storno- und Rückgabezeilen als eigene NEGATIVE
 * Zeile stehen; der stornierte Artikel bleibt dann als positive Zeile in
 * `items`. Ohne Aufrechnung zählt er als gekaufter Artikel — an der
 * Auszahlungsschwelle (minItems 6) wird aus „ohne Prämie" eine Zahlung.
 * Gemessen: v1.5-Lesungen bon_mumv7kswsr3h16 (dm, ZEILENSTORNO) und
 * bon_muo34502ujmnpb (ALDI, zwei Artikelstorno-Zeilen gegen eine Kiwi-Zeile)
 * zählten je einen Artikel zu viel. v1.4 tut es auch, nur seltener (das
 * Modell rechnet oft selbst auf): 20 von 9.273 Live-Bons 08.09.–08.10.2026
 * zählten zu viel, einer davon wurde dadurch bezahlt (bon_muiepzbxzy5qyk,
 * „Del.Boule Rustique 0,79 / -0,79", 6 statt 5 Artikel, 8 ct).
 *
 * Regel (nur für die ZÄHLUNG; Abgleich/Summen bleiben unberührt):
 *   • Eine negative Zeile, die weder Pfand noch Warenkorb-Rabatt ist, wird
 *     gegen einen positiven Artikel GLEICHEN Namens aufgerechnet (Name ohne
 *     Storno-Wörter und Artikelnummern; gleich oder einer ist Anfang des
 *     anderen, mind. 4 Zeichen) — bevorzugt einen mit genau diesem Betrag.
 *   • Eine als Storno bezeichnete Zeile ohne Namenstreffer trifft nur einen
 *     Artikel mit GENAU diesem Betrag.
 *   • Aufgerechnet wird der Betrag: mehrere Teil-Stornos (4 × 0,49 € Kiwi
 *     gegen −0,49 und −1,47) heben einen Artikel zusammen auf; ein kleiner
 *     Nachlass mit Artikelnamen (Ferrero 2,79 / −0,21) lässt ihn stehen.
 *     Gezählt wird ein Artikel, solange ein Rest > 0 bleibt — wie ein Artikel,
 *     dessen Preis nach Regel C auf 0 fällt, schon heute nicht zählt.
 *   • Ohne Treffer bleibt alles wie bisher (eine Retoure eines früheren
 *     Einkaufs hebt keinen heute gekauften anderen Artikel auf).
 * Hinter dem Schalter `cashback_config/v1.stornoAufrechnen` (Prüfrunde
 * 08.10.2026, Befund „alle Schalter aus → jede Geldentscheidung unverändert"):
 *   • fehlt / false / ungültig → Zählung OHNE Aufrechnung, exakt wie vor dem
 *     08.10.2026 (zaehleOhneAufrechnung, Test in __tests__/stornoZaehlung.test.js).
 *   • 'shadow' → Zählung wie bisher; index.js meldet `storno-zaehlung-abweichend`,
 *     wenn die Aufrechnung eine andere Zahl ergäbe (Beobachtung ohne Wirkung).
 *   • true → Aufrechnung wirkt — für die Geldentscheidung (index.js), die
 *     Lese-Fingerabdrücke der Robust-Leiter (lib/ocr_robust.js; Feld-Gate 6w
 *     vergleicht deren Betrag) und die Zweitprüfung (lib/refereePolicy.js
 *     refereeFingerprint/plausibel). Dann für JEDE Prompt-Version (v1.4 tut es
 *     seltener, s. o.).
 * Gemessen am Bestand (nur gelesen, 9.378 Bons 08.09.–08.10.2026): bei 20 ändert
 * sich die Zahl, 2 fielen unter minItems, einer davon war bezahlt (8 ct). Die
 * Wirkung geht nur nach unten (weniger Zahlungen). Bezahlte Bons bleiben auch
 * mit Schalter unberührt (Bestandsschutz: weder Storno noch Betragskorrektur).
 */
const STORNO_WORT = /storno|stornier/i;

function artikelSchluessel(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/artikelstorno|zeilenstorno|sofortstorno|storniert|storno/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ') // Artikelnummern (ALDI/Lidl: „734384 Müller Milchreis")
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function gleicherArtikel(a, b) {
  if (!a || !b) return false;
  const [kurz, lang] = a.length <= b.length ? [a, b] : [b, a];
  return kurz.length >= 4 && lang.startsWith(kurz);
}

/**
 * Schalterwert `cashback_config/v1.stornoAufrechnen` → 'aus' | 'shadow' | 'an'.
 * Nur das boolesche `true` schaltet ein, nur der String 'shadow' beobachtet;
 * alles andere (fehlend, false, 'true', Tippfehler) ist 'aus'.
 */
function stornoModus(wert) {
  if (wert === true) return 'an';
  if (wert === 'shadow') return 'shadow';
  return 'aus';
}

/** Gesetzt, aber weder false noch ein gültiger Wert — index.js meldet das. */
function stornoWertUngueltig(wert) {
  return wert != null && wert !== false && stornoModus(wert) === 'aus';
}

/**
 * Zählung OHNE Aufrechnung — der Stand vor dem 08.10.2026, Zeichen für Zeichen
 * die frühere countEligibleItems. Gilt, solange der Schalter nicht `true` ist.
 */
function zaehleOhneAufrechnung(items) {
  return items.filter(
    (it) =>
      it &&
      typeof it.name === 'string' &&
      Number.isFinite(it.priceCents) &&
      it.priceCents > 0 &&
      !isPfandItem(it) &&
      // Rabattzeile (Prompt v1.5) ist nie ein Artikel — auch nicht, wenn das
      // Modell sie entgegen Regel 16 mit positivem Preis liefert.
      !istRabattKategorie(it),
  ).length;
}

/**
 * @param {object} parsed  Lesung (items[]).
 * @param {object} [opts]
 * @param {boolean} [opts.stornoAufrechnen]  NUR `true` rechnet Storno-/Rückgabe-
 *        zeilen auf (Schalter `stornoAufrechnen === true`, s. stornoModus).
 *        Ohne Angabe: Zählung wie vor dem 08.10.2026.
 */
function countEligibleItems(parsed, opts = {}) {
  if (!parsed || !Array.isArray(parsed.items)) return 0;
  if (!opts || opts.stornoAufrechnen !== true) return zaehleOhneAufrechnung(parsed.items);
  const artikel = [];
  const negativ = [];
  for (const it of parsed.items) {
    if (!it || typeof it.name !== 'string' || !Number.isFinite(it.priceCents)) continue;
    // Pfand ist kein Artikel; eine Rabattzeile (Prompt v1.5) auch nicht —
    // selbst wenn das Modell sie entgegen Regel 16 mit positivem Preis liefert.
    if (isPfandItem(it) || istRabattKategorie(it)) continue;
    if (it.priceCents > 0) artikel.push({ rest: it.priceCents, schluessel: artikelSchluessel(it.name) });
    else if (it.priceCents < 0) negativ.push(it);
  }
  for (const zeile of negativ) {
    const betrag = -zeile.priceCents;
    const schluessel = artikelSchluessel(zeile.name);
    const offen = artikel.filter((a) => a.rest > 0);
    const namensgleich = offen.filter((a) => gleicherArtikel(a.schluessel, schluessel));
    let ziel = namensgleich.find((a) => a.rest === betrag) || namensgleich[0] || null;
    if (!ziel && STORNO_WORT.test(`${zeile.name} ${zeile.raw || ''}`)) ziel = offen.find((a) => a.rest === betrag) || null;
    if (ziel) ziel.rest -= betrag;
  }
  return artikel.filter((a) => a.rest > 0).length;
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

module.exports = { extractReceipt, reconcile, basketDiscountCents, countEligibleItems, stornoModus, stornoWertUngueltig, tierFor, isPfandItem, istWarenkorbRabattZeile, istRabattKategorie, DEFAULT_MODEL };
