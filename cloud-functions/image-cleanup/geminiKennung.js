'use strict';

/**
 * Kosten-Kennung für den Gemini-Aufruf des Bild-Freistellens (08.10.2026).
 *
 * Alle Live-Funktionen rufen Vertex unter demselben Dienstkonto auf; ohne
 * Kennung trennt die Rechnung die Codebases nicht. Vertex nimmt `labels` an der
 * Anfrage an (GenerateContentRequest.labels, laut API nur für Abrechnung).
 * NUR auf dem Vertex-Pfad: auf dem AI-Studio-Pfad (GEMINI_USE_VERTEX=false)
 * wirft das SDK (auch 1.50.1) „labels parameter is not supported in Gemini
 * API." vor dem Senden — dann scheiterte jedes Bild.
 *
 * Die Entscheidung hängt am tatsächlich erzeugten Client (`client.vertexai`,
 * öffentliche Eigenschaft von GoogleGenAI), nicht an einer zweiten Lesung der
 * Umgebung. Deshalb fasst diese Datei die Client-Fabrik nicht an: sie gilt
 * unverändert für `newGenAI` (index.js) und für `neuerGenAI` aus
 * geminiModelle.js im Zweig claude/gemini-25-rest (156c235e), der dieselbe
 * Fabrik ersetzt — beide Stände lassen sich ohne Konflikt zusammenführen.
 *
 * Gesetzt wird sie nur von den Live-Triggern (index.js → options.kennung);
 * die lokalen Skripte (backfill.js, retry-failures.js …) rufen pipeline.js
 * ohne Kennung auf und bleiben in der Rechnung getrennt.
 *
 * Format: Werte nur a-z, 0-9, _ und -, beginnend mit einem Buchstaben,
 * höchstens 63 Zeichen. Eine ungültige Kennung wird weggelassen, nie gesendet.
 */

const FUNKTION = 'image-cleanup';

const ZWECK = Object.freeze({
  BILD_FREISTELLEN: 'bild-freistellen', // Produktbild freistellen (Standard, Strategie A und B)
});

const LABEL_MUSTER = /^[a-z][a-z0-9_-]{0,62}$/;

/** Ist dieser Client ein Vertex-Client? Fehlt er oder ist unklar → nein (keine Kennung). */
function nutztVertex(client) {
  return Boolean(client && client.vertexai === true);
}

/** `{ labels }` für einen Vertex-Client, sonst `{}` — per Spread in `config`. */
function geminiKennung(zweck, client) {
  if (!nutztVertex(client)) return {};
  if (typeof zweck !== 'string' || !LABEL_MUSTER.test(zweck)) {
    console.warn('[image-cleanup] Gemini-Kennung ungültig, weggelassen:', String(zweck).slice(0, 80));
    return {};
  }
  return { labels: { funktion: FUNKTION, zweck } };
}

module.exports = { geminiKennung, nutztVertex, ZWECK, FUNKTION, LABEL_MUSTER };
