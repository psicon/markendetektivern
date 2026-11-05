'use strict';

/**
 * Gemeinsamer Gemini-Client für assessor/comparator/manufacturer.
 *
 * Backend-Umschaltung (Incident 19.08.2026): AI-Studio-Keys haengen am
 * monatlichen Spending-Cap der Rechnungskontostufe — bei Erreichen liefern
 * ALLE Keys des Kontos 429 RESOURCE_EXHAUSTED. Vertex AI rechnet uebers
 * GCP-Projekt-Billing und kennt dieses Stufenlimit nicht. Das genutzte
 * Modell (gemini-3.5-flash) ist unter Location 'global' publiziert
 * (geprueft 19.08.2026). GEMINI_USE_VERTEX=false = alter AI-Studio-Pfad
 * ueber den uebergebenen apiKey.
 *
 * Kosten-Kennung (08.10.2026): Alle Live-Funktionen rufen Vertex unter
 * demselben Dienstkonto auf — ohne Kennung trennt die Rechnung weder die
 * Codebases noch Vergleich/Bewertung/Hersteller. `geminiKennung(zweck)`
 * liefert `{ labels }` fuer `config` (GenerateContentRequest.labels, laut API
 * nur fuer Abrechnung). NUR auf dem Vertex-Pfad: auf dem AI-Studio-Pfad wirft
 * das SDK „labels parameter is not supported in Gemini API." vor dem Senden.
 * Format: Werte nur a-z, 0-9, _ und -, beginnend mit Buchstabe, hoechstens
 * 63 Zeichen; eine ungueltige Kennung wird weggelassen, nie gesendet.
 */

const { GoogleGenAI } = require('@google/genai');

const FUNKTION = 'ai-product-comparison';

/** Die Zwecke dieser Codebase — so stehen sie in der Rechnung. */
const ZWECK = Object.freeze({
  PRODUKT_VERGLEICH: 'produkt-vergleich', //       comparator: NoName vs. Marke
  PRODUKT_BEWERTUNG: 'produkt-bewertung', //       assessor: Standalone-Bewertung (produkte)
  EXTERN_BEWERTUNG: 'extern-bewertung', //         assessor: externe Produkte (external_products)
  HERSTELLER_BEWERTUNG: 'hersteller-bewertung', // manufacturer: hersteller + hersteller_new
});

const LABEL_MUSTER = /^[a-z][a-z0-9_-]{0,62}$/;

/** Laeuft Gemini ueber Vertex? Dieselbe Regel, nach der getGenAIClient baut. */
function nutztVertex(env = process.env) {
  return String(env.GEMINI_USE_VERTEX ?? 'true') !== 'false';
}

/** `{ labels }` auf dem Vertex-Pfad, sonst `{}` — per Spread in `config`. */
function geminiKennung(zweck, env = process.env) {
  if (!nutztVertex(env)) return {};
  if (typeof zweck !== 'string' || !LABEL_MUSTER.test(zweck)) {
    console.warn('[gemini-kennung] ungueltig, weggelassen:', String(zweck).slice(0, 80));
    return {};
  }
  return { labels: { funktion: FUNKTION, zweck } };
}

let _client = null;
function getGenAIClient(apiKey) {
  if (_client) return _client;
  if (nutztVertex()) {
    _client = new GoogleGenAI({
      vertexai: true,
      project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'markendetektive-895f7',
      location: process.env.GEMINI_VERTEX_LOCATION || 'global',
    });
    return _client;
  }
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

module.exports = { getGenAIClient, geminiKennung, nutztVertex, ZWECK, FUNKTION, LABEL_MUSTER };
