'use strict';
/**
 * Gemeinsame KI-Hilfen der Morgenrunden (Fotos + Bons).
 *
 * Google-Limits (429) sind der Normalfall, kein Ausnahmefall: am 24.09. liefen
 * 18 von 229 Bildprüfungen im ersten Durchgang hinein. Wiederholt wird mit
 * Pause; ein 400 („Bild nicht lesbar", INVALID_ARGUMENT) wird NICHT wiederholt,
 * das wird nicht besser.
 */
const schlafe = (t) => new Promise((r) => setTimeout(r, t));

async function mitWiederholung(fn, pausen = [4000, 10000, 25000]) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      const t = String(e && (e.message || e));
      const voruebergehend = /429|RESOURCE_EXHAUSTED|500|503|INTERNAL|UNAVAILABLE|deadline|ECONNRESET|fetch failed/i.test(t) && !/decode|INVALID_ARGUMENT/i.test(t);
      if (!voruebergehend || i >= pausen.length) throw e;
      await schlafe(pausen[i] + Math.floor(Math.random() * 1500));
    }
  }
}

/**
 * Kosten-Kennung je Gemini-Aufruf (08.10.2026) — EINE Stelle für beide Runden.
 *
 * Alle Live-Funktionen rufen Vertex unter demselben Dienstkonto auf; ohne
 * Kennung trennt die Rechnung weder die Codebases noch Bon-Zweitlesung,
 * Nachlesung, Barcode-Lesung und Bildprüfung. Vertex nimmt `labels` an der
 * Anfrage an (GenerateContentRequest.labels, laut API nur für Abrechnung).
 * Beide Runden bauen ihren Client fest auf Vertex, einen AI-Studio-Pfad gibt
 * es hier nicht (dort lehnte das SDK labels vor dem Senden ab). Werte nur
 * a-z, 0-9, _ und -, beginnend mit Buchstabe, höchstens 63 Zeichen.
 */
const KI_FUNKTION = 'review-console';
const KI_ZWECK = Object.freeze({
  BON_RUNDE: 'bon-runde', //                             bonRunde: Zweitlesung der Bons in Prüfung
  FOTO_RUNDE_NACHLESUNG: 'foto-runde-nachlesung', //     Morgenrunde: Name, EAN, Preis, Hersteller nachlesen
  FOTO_RUNDE_BARCODE: 'foto-runde-barcode', //           Morgenrunde: zweite Lesung des Barcode-Fotos
  FOTO_RUNDE_BILDPRUEFUNG: 'foto-runde-bildpruefung', // Morgenrunde: Bildprüfung aller Fotos
});

/** `{ labels }` für `config` (per Spread). */
function geminiKennung(zweck) {
  return { labels: { funktion: KI_FUNKTION, zweck } };
}

/** Liste parallel abarbeiten; nach `frist` wird nichts Neues begonnen (Rest wird zurückgegeben). */
async function arbeite(liste, arbeiter, gleichzeitig, frist) {
  const queue = [...liste];
  const liegen = [];
  await Promise.all(Array.from({ length: Math.min(gleichzeitig, queue.length || 1) }, async () => {
    for (;;) {
      const e = queue.shift();
      if (!e) return;
      if (frist && Date.now() > frist) { liegen.push(e); continue; }
      await arbeiter(e);
    }
  }));
  return liegen;
}

module.exports = { mitWiederholung, arbeite, schlafe, geminiKennung, KI_ZWECK, KI_FUNKTION };
