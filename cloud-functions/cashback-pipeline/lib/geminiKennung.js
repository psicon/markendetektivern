'use strict';

/**
 * Kosten-Kennung für jeden Gemini-Aufruf der Bon-Erkennung — EINE Stelle für
 * die Client-Fabriken in ocr.js und ocr_cvhybrid.js (08.10.2026).
 *
 * Warum: Alle Live-Funktionen rufen Vertex unter demselben Dienstkonto auf.
 * Ohne Kennung lässt sich in der Rechnung nicht trennen, welche Codebase und
 * welche Stufe (Basis-Lesung, verbessertes Bild, Eskalation, Zweitprüfung)
 * die Kosten verursacht. Vertex nimmt dafür `labels` an der Anfrage an
 * (GenerateContentRequest.labels, laut API „used for billing and reporting
 * only"); das SDK legt `config.labels` als eigenes Feld in den Anfragekörper.
 *
 * NUR auf dem Vertex-Pfad: Auf dem AI-Studio-Pfad (GEMINI_USE_VERTEX=false)
 * wirft das SDK „labels parameter is not supported in Gemini API." noch vor
 * dem Senden — mit Kennung wäre der Rückschalter für jede Lesung tot.
 *
 * Format (GCP-Labels): Schlüssel und Werte höchstens 63 Zeichen, nur a-z,
 * 0-9, _ und -, beginnend mit einem Buchstaben. Eine ungültige Kennung wird
 * weggelassen statt gesendet — sie dient nur der Abrechnung und darf keinen
 * Aufruf scheitern lassen.
 */

const FUNKTION = 'cashback-pipeline';

/** Die Stufen der Bon-Erkennung — so stehen sie in der Rechnung. */
const ZWECK = Object.freeze({
  BON_OCR: 'bon-ocr', //                       Basis-Lesungen (ocr_robust, Phase 1)
  BON_OCR_VERBESSERT: 'bon-ocr-verbessert', // Lesungen auf dem verbesserten Bild (Phase 1.5)
  BON_OCR_ESKALATION: 'bon-ocr-eskalation', // Eskalationsstufe (Phase 2)
  BON_ZWEITPRUEFUNG: 'bon-zweitpruefung', //   Zweitprüfung unsicherer Bons (ocr_referee)
  BON_OCR_TEXT: 'bon-ocr-text', //             Text-Parser der Rückfall-Engine cv-hybrid
});

const LABEL_MUSTER = /^[a-z][a-z0-9_-]{0,62}$/;

/** Läuft Gemini über Vertex? Dieselbe Regel, nach der beide Fabriken den Client bauen. */
function nutztVertex(env = process.env) {
  return String(env.GEMINI_USE_VERTEX ?? 'true') !== 'false';
}

/**
 * Teil der Anfrage-Konfiguration: `{ labels }` auf dem Vertex-Pfad, sonst `{}`
 * — wird per Spread in `config` übernommen.
 */
function geminiKennung(zweck, env = process.env) {
  if (!nutztVertex(env)) return {};
  if (typeof zweck !== 'string' || !LABEL_MUSTER.test(zweck)) {
    console.warn('gemini-kennung-ungueltig', { zweck: String(zweck).slice(0, 80) });
    return {};
  }
  return { labels: { funktion: FUNKTION, zweck } };
}

module.exports = { geminiKennung, nutztVertex, ZWECK, FUNKTION, LABEL_MUSTER };
