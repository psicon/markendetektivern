'use strict';

/**
 * Kosten-Kennung für den Gemini-Aufruf des Namers — EINE Stelle, die auch die
 * Client-Fabrik in index.js nutzt (08.10.2026).
 *
 * Alle Live-Funktionen rufen Vertex unter demselben Dienstkonto auf; ohne
 * Kennung trennt die Rechnung die Codebases nicht. Vertex nimmt `labels` an der
 * Anfrage an (GenerateContentRequest.labels, laut API nur für Abrechnung).
 * NUR auf dem Vertex-Pfad: auf dem AI-Studio-Pfad (GEMINI_USE_VERTEX=false)
 * wirft das SDK „labels parameter is not supported in Gemini API." vor dem
 * Senden — leseMitWiederholung hielte das für einen dauerhaften Fehler, und
 * jede Einreichung bekäme einen Fehlervermerk.
 *
 * Format: Werte nur a-z, 0-9, _ und -, beginnend mit einem Buchstaben,
 * höchstens 63 Zeichen. Eine ungültige Kennung wird weggelassen, nie gesendet.
 */

const FUNKTION = 'crowd-upload-namer';

const ZWECK = Object.freeze({
  FOTO_NAME: 'foto-name', // Produktname, Preis, Hersteller aus den Fotos (Erstlauf und Nachlauf)
});

const LABEL_MUSTER = /^[a-z][a-z0-9_-]{0,62}$/;

/** Läuft Gemini über Vertex? Dieselbe Regel, nach der index.js den Client baut. */
function nutztVertex(env = process.env) {
  return String(env.GEMINI_USE_VERTEX ?? 'true') !== 'false';
}

/** `{ labels }` auf dem Vertex-Pfad, sonst `{}` — per Spread in `config`. */
function geminiKennung(zweck, env = process.env) {
  if (!nutztVertex(env)) return {};
  if (typeof zweck !== 'string' || !LABEL_MUSTER.test(zweck)) {
    console.warn('gemini-kennung-ungueltig', String(zweck).slice(0, 80));
    return {};
  }
  return { labels: { funktion: FUNKTION, zweck } };
}

module.exports = { geminiKennung, nutztVertex, ZWECK, FUNKTION, LABEL_MUSTER };
