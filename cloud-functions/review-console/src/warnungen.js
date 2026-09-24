'use strict';
/**
 * Warnungen des Tagesberichts — reine Funktion, getestet in
 * __tests__/warnungen.test.js. Jede Warnung steht für einen Ausfall, der
 * schon einmal passiert ist und damals niemandem auffiel:
 *
 *  • Aktion läuft aus ohne Nachfolger — 01.09.2026: zwei Tage lang 119 Bons
 *    ohne Prämie, 33 Foto-Uploads ohne Aktion.
 *  • Zweitprüfung eingeschaltet, aber nicht gelaufen — 23.09.2026: ein
 *    Ausrollen von einem Zweig ohne diesen Code nahm sie still wieder raus.
 *  • Bons hängen in der Prüfung / ohne Aktion — der Stau vom 02.09. (163 Bons
 *    seit Juli).
 *  • Morgenrunde nicht fertig geworden / Bildprüfung scheitert reihenweise.
 *
 * Stufen: 'rot' = heute handeln, 'gelb' = im Blick behalten.
 */

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object} k
 * @param {number} k.jetzt                      ms
 * @param {Array<{id:string, kind:string, active:boolean, startAt:number, endAt:number, budgetRemainingCents?:number, budgetTotalCents?:number}>} k.aktionen
 * @param {{eingeschaltet:boolean, laeufeLetzte48h:number}} k.zweitpruefung
 * @param {{inPruefung:number, aeltesteTage:number|null, letzte24h:{gesamt:number, ohneAktion:number}}} k.bons
 * @param {{geprueft:number, offen:number, auditFehler:number, auditVersucht:number, nichtGeschafft:number}} k.runde
 * @param {{bild:boolean, gesamt:boolean, text:string[]}} k.notbremse
 * @param {{alt:string|null, neu:string}} k.regelVersion
 * @returns {Array<{stufe:'rot'|'gelb', code:string, text:string}>}
 */
function warnungen(k) {
  const w = [];
  const rot = (code, text) => w.push({ stufe: 'rot', code, text });
  const gelb = (code, text) => w.push({ stufe: 'gelb', code, text });

  // ── Aktionen ──────────────────────────────────────────────────────────
  const aktionen = k.aktionen || [];
  const laufend = aktionen.filter((a) => a.active && a.startAt <= k.jetzt && k.jetzt <= a.endAt);
  for (const kind of ['receipt', 'product_photos']) {
    const name = kind === 'receipt' ? 'Bons' : 'Produktfotos';
    const jetztAktiv = laufend.filter((a) => a.kind === kind);
    if (!jetztAktiv.length) {
      rot(`aktion_fehlt_${kind}`, `Für ${name} läuft gerade KEINE Aktion — neue Einreichungen bekommen nichts.`);
      continue;
    }
    // Endet die späteste laufende Aktion bald, und beginnt danach keine neue?
    const spaetestesEnde = Math.max(...jetztAktiv.map((a) => a.endAt));
    const tage = Math.ceil((spaetestesEnde - k.jetzt) / TAG_MS);
    const nachfolger = aktionen.some((a) => a.kind === kind && a.active && a.startAt <= spaetestesEnde + 60_000 && a.endAt > spaetestesEnde);
    if (!nachfolger && tage <= 7) {
      (tage <= 2 ? rot : gelb)(`aktion_endet_${kind}`, `Die ${name}-Aktion endet in ${tage} ${tage === 1 ? 'Tag' : 'Tagen'} und es gibt keinen Nachfolger.`);
    }
    for (const a of jetztAktiv) {
      const total = Number(a.budgetTotalCents) || 0;
      const rest = Number(a.budgetRemainingCents);
      if (!total || !Number.isFinite(rest)) continue;
      if (rest <= 0) rot(`budget_leer_${a.id}`, `Budget von „${a.id}" ist aufgebraucht — dort wird nichts mehr gebucht.`);
      else if (rest / total < 0.1) gelb(`budget_knapp_${a.id}`, `Budget von „${a.id}" ist fast leer (${Math.round((100 * rest) / total)} % übrig).`);
    }
  }

  // ── Zweitprüfung unsicherer Bons ─────────────────────────────────────
  if (k.zweitpruefung && k.zweitpruefung.eingeschaltet && k.zweitpruefung.laeufeLetzte48h === 0) {
    rot('zweitpruefung_still', 'Die Zweitprüfung für unsichere Bons ist eingeschaltet, ist aber seit zwei Tagen nicht gelaufen. Vermutlich wurde die Bon-Verarbeitung von einem Stand ohne diesen Code ausgerollt.');
  }

  // ── Bons ─────────────────────────────────────────────────────────────
  const b = k.bons;
  if (b) {
    if (b.aeltesteTage != null && b.aeltesteTage >= 3) gelb('bons_warten', `${b.inPruefung} Bons warten auf eine Entscheidung, der älteste seit ${b.aeltesteTage} Tagen.`);
    const n = b.letzte24h?.gesamt || 0;
    const ohne = b.letzte24h?.ohneAktion || 0;
    if (n >= 20 && ohne / n > 0.05) rot('bons_ohne_aktion', `${ohne} von ${n} Bons der letzten 24 Stunden liefen ohne Aktion — Aktion ausgelaufen oder falsch eingestellt?`);
  }

  // ── Die Runde selbst ─────────────────────────────────────────────────
  const r = k.runde;
  if (r) {
    if (r.nichtGeschafft > 0) gelb('runde_unvollstaendig', `${r.nichtGeschafft} Einreichungen hat die Runde in der Zeit nicht mehr geschafft — sie sind morgen dran.`);
    if (r.auditVersucht >= 8 && r.auditFehler / r.auditVersucht > 0.25) {
      rot('bildpruefung_gestoert', `Die Bildprüfung ist bei ${r.auditFehler} von ${r.auditVersucht} Einreichungen gescheitert (meist Google-Limit). Diese Fälle bleiben offen.`);
    }
  }
  for (const t of (k.notbremse?.text || [])) rot('notbremse', `Notbremse: ${t}`);

  if (k.regelVersion && k.regelVersion.alt && k.regelVersion.alt !== k.regelVersion.neu) {
    gelb('regeln_geaendert', 'Die Prüfregeln haben sich seit dem letzten Lauf geändert. Die Ergebnisse von heute bitte einmal ansehen.');
  }
  return w;
}

module.exports = { warnungen };
