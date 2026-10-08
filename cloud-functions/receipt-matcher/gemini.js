/**
 * receipt-matcher — EINE Stelle für den Gemini-Client dieser Codebase:
 * Client-Fabrik, Kosten-Kennungen (labels) und hartes Zeitlimit.
 *
 * Vorher hatten index.js und matcher.js je eine eigene Fabrik. Beide nutzen
 * jetzt diese hier, damit Backend-Wahl, Kennungen und Zeitlimit nicht
 * auseinanderlaufen.
 */

'use strict';

const { GoogleGenAI } = require('@google/genai');

// ─── Kosten-Kennungen ────────────────────────────────────────────────
// Konvention (für alle Codebases gleich): labels = { funktion, zweck }.
// Vertex verlangt Werte aus [a-z0-9_-], beginnend mit einem Buchstaben,
// höchstens 63 Zeichen. Geprüft wird beim Laden des Moduls: ein falscher
// Wert soll den Deploy scheitern lassen, nicht jeden einzelnen Aufruf.
const LABEL_RE = /^[a-z][a-z0-9_-]{0,62}$/;
const FUNKTION = 'receipt-matcher';
const ZWECK = Object.freeze({
  ZUORDNUNG: 'bon-artikel-zuordnung', // Gemini-Pick einer Bon-Zeile
});

function labelsFuer(zweck) {
  const labels = { funktion: FUNKTION, zweck };
  for (const [k, v] of Object.entries(labels)) {
    if (!LABEL_RE.test(k) || !LABEL_RE.test(String(v))) {
      throw new Error(`Ungültige Kosten-Kennung ${k}=${v}`);
    }
  }
  return Object.freeze(labels);
}

const KOSTEN_LABELS = Object.freeze(
  Object.fromEntries(Object.values(ZWECK).map((z) => [z, labelsFuer(z)])),
);

// ─── Client-Fabrik ───────────────────────────────────────────────────
let _ai = null;
let _vertex = null;

function ai() {
  if (_ai) return _ai;
  // Backend-Umschaltung (Incident 19.08.2026): AI-Studio-Keys haengen am
  // monatlichen Spending-Cap der Rechnungskontostufe — bei Erreichen liefern
  // ALLE Keys des Kontos 429. Vertex AI rechnet uebers GCP-Projekt-Billing
  // und kennt das Limit nicht. Beide hier genutzten Modelle sind unter
  // 'global' publiziert (gemini-3.5-flash, gemini-embedding-001 — Embeddings
  // byte-identisch zu AI Studio, Kosinus 1.0000 gegen Bestandsvektoren
  // verifiziert 19.08.2026). GEMINI_USE_VERTEX=false = alter Key-Pfad.
  const useVertex = String(process.env.GEMINI_USE_VERTEX ?? 'true') !== 'false';
  if (useVertex) {
    _ai = new GoogleGenAI({
      vertexai: true,
      project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'markendetektive-895f7',
      location: process.env.GEMINI_VERTEX_LOCATION || 'global',
    });
    _vertex = true;
    return _ai;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  _ai = new GoogleGenAI({ apiKey });
  _vertex = false;
  return _ai;
}

/**
 * Hängt die Kosten-Kennungen an eine generateContent-Konfiguration — NUR auf
 * dem Vertex-Pfad. Die Gemini-API (AI Studio) kennt `labels` nicht, das SDK
 * wirft dort vor dem Senden („labels parameter is not supported in Gemini
 * API."). Die Entscheidung hängt am tatsächlich erzeugten Client, nicht an
 * einer zweiten Lesung der Umgebung.
 *
 * Einbettungen bekommen keine Kennungen: das SDK (1.52.0,
 * embedContentConfigToVertex) gibt `labels` dort nicht weiter.
 */
function mitKostenLabels(config, zweck) {
  const labels = KOSTEN_LABELS[zweck];
  if (!labels) throw new Error(`Unbekannter Zweck für Kosten-Kennung: ${zweck}`);
  ai();
  return _vertex ? { ...config, labels } : config;
}

// ─── Zeitlimit ───────────────────────────────────────────────────────
// Das SDK setzt ohne eigene Angabe weder Zeitlimit noch Wiederholung; ein
// hängender Aufruf wartet bis zum 300-s-Limit von Node-fetch. Die Funktion
// selbst endet aber nach 120 s (Ursache der Abbrüche ab 01.10.2026).
//
// Zwei Ebenen, Muster wie cashback-pipeline/lib/ocr.js:
//  • `abortSignal` + `httpOptions.timeout` in der Konfiguration: beendet die
//    HTTP-Anfrage; das SDK schickt mit `timeout` den Kopf X-Server-Timeout
//    mit (Vertex soll dann serverseitig aufhören — ob es das tut, ist nicht
//    gemessen). Der SDK-eigene Zeitgeber läuft eine Sekunde länger, damit
//    unser Zeitgeber zuerst feuert und der Fehlercode eindeutig ist.
//  • Promise.race mit eigenem Zeitgeber: kehrt garantiert zurück, auch wenn
//    der Abbruch am Transport nicht greift.
const SDK_PUFFER_MS = 1000;

function zeitlimitConfig(signal, ms) {
  return { abortSignal: signal, httpOptions: { timeout: Math.max(1, Math.ceil(ms)) + SDK_PUFFER_MS } };
}

/**
 * Führt `starte(signal)` mit hartem Zeitlimit aus. Bei Ablauf: abort() und
 * Ablehnung mit `err.code = code`. Ein Abbruch durch den Client ist laut
 * SDK-Doku kein Abbruch beim Dienst — bereits erzeugte Token können
 * abgerechnet werden.
 */
async function mitZeitlimit(starte, ms, code) {
  const abort = new AbortController();
  const anfrage = Promise.resolve().then(() => starte(abort.signal));
  // Die verspätete Ablehnung nach dem Abbruch nicht unbehandelt lassen
  // (sonst unhandledRejection im Function-Prozess). Das Race abonniert separat.
  anfrage.catch(() => {});
  let timer = null;
  try {
    return await Promise.race([
      anfrage,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${code} nach ${Math.round(ms)} ms`);
          err.code = code;
          abort.abort();
          reject(err);
        }, Math.max(0, ms));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { ai, mitKostenLabels, mitZeitlimit, zeitlimitConfig, ZWECK, KOSTEN_LABELS, LABEL_RE, FUNKTION };
