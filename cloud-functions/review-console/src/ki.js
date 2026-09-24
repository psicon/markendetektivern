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

module.exports = { mitWiederholung, arbeite, schlafe };
