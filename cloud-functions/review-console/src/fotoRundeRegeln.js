'use strict';
/**
 * Entscheidungsregeln der Morgenrunde für Produktfotos — reine Funktionen,
 * ohne Firestore, damit jede Regel einen Test hat (__tests__/fotoRundeRegeln.test.js).
 *
 * Grundlage sind die Handrunden vom 09.–24.09.2026. Jede Regel steht mit dem
 * Vorfall, der sie gekostet hat, in WISSEN-FOTORUNDE.md.
 *
 * Seit 24.09.2026 (Entscheidung Patrick: „beides automatisch") entscheidet die
 * Runde Freigaben UND Ablehnungen selbst. Liegen bleibt nur, was an unserer
 * Technik hängt (Storage nicht lesbar, Bildprüfung gescheitert, Nachlesen
 * gescheitert) — ein Infrastrukturfehler ist nie ein Urteil über eine
 * Einreichung, weder in die eine noch in die andere Richtung.
 */

const SAME_USER = 'sperre_30_tage_gleicher_nutzer';
const PENDING_OLDER = 'doppelt_eingereicht';

/** Ablehnungen, die allein auf dem Urteil der Bildprüfung beruhen. */
const BILD_GRUENDE = new Set(['fotos_unpassend', 'gleiche_ansicht_mehrfach']);

/**
 * Ein Fall → Entscheidung.
 *
 * @param {object} f
 * @param {{ok:boolean, problems:string[], missing:string[]}} f.comp   completenessCheck
 * @param {{verdict:string, reason:string|null, lockUntil:number|null}} f.dup  evaluateDuplicate
 * @param {string[]} f.leer         Slots mit 0-Byte-Datei (echter Mangel)
 * @param {string[]} f.unlesbar     Slots, deren Metadaten Storage nicht lieferte (unsere Technik)
 * @param {boolean} f.wiederverwendet  Identitätsfoto stammt aus einer älteren Einreichung
 * @param {{echt:boolean, loseWare:boolean, gleicheAnsicht:boolean, grund:string}|null} f.audit
 * @param {string|null} f.auditFehler   Fehlermeldung, wenn die Bildprüfung scheiterte
 * @param {{name?:string, ean?:string}} f.rettungFehler  Nachlesen ist an unserer Technik gescheitert
 * @returns {{entscheidung:'freigeben'|'ablehnen'|'offen', grund:string|null, ctx:object, loseWare?:boolean}}
 */
function entscheideFall(f) {
  const comp = f.comp || { ok: true, problems: [], missing: [] };
  const dup = f.dup || { verdict: 'ok', reason: null, lockUntil: null };
  const rf = f.rettungFehler || {};

  // Unsere Technik zuerst: ohne lesbare Dateien gibt es kein Urteil.
  if ((f.unlesbar || []).length) return offen('bild_nicht_lesbar_infrastruktur');

  // Fehlende oder leere Pflichtfotos — ohne Ansehen entscheidbar.
  if (comp.problems.includes('unvollstaendig')) return ablehnen('unvollstaendig', { missing: comp.missing });
  if ((f.leer || []).length) return ablehnen('unvollstaendig', { missing: f.leer });

  // Doppel-Regel (Konsolen-Regel, gleiche Datei wie dort).
  if (dup.verdict === 'locked') return ablehnen(dup.reason || SAME_USER, { lockUntil: dup.lockUntil });
  if (dup.verdict === 'hold') return offen(PENDING_OLDER);
  if (f.wiederverwendet) return ablehnen('bilder_wiederverwendet');

  // Ab hier braucht es die Bildprüfung.
  const audit = f.audit || null;

  if (comp.problems.includes('kein_produktname')) {
    // Scheiterte das Nachlesen an einem Limit, ist das kein Beleg für „kein Name".
    if (rf.name) return offen('nachlesen_gescheitert', { hinweis: rf.name });
    return ablehnen('kein_produktname');
  }

  if (comp.problems.includes('ean_fehlt')) {
    if (!audit) return offen(f.auditFehler ? 'bild_audit_gescheitert' : 'kein_bild_audit', { hinweis: f.auditFehler || null });
    // Lose Ware wird angenommen (Entscheidung Patrick 20.09.2026): Waage-Etiketten
    // tragen keinen Produkt-Barcode, das ist kein Fehler der Einreichung.
    if (audit.loseWare && audit.echt && !audit.gleicheAnsicht) return { entscheidung: 'freigeben', grund: null, ctx: {}, loseWare: true };
    if (rf.ean) return offen('nachlesen_gescheitert', { hinweis: rf.ean });
    return ablehnen('ean_fehlt');
  }

  if (!audit) {
    const defekt = /decode|image data/i.test(String(f.auditFehler || ''));
    return offen(defekt ? 'bild_defekt' : f.auditFehler ? 'bild_audit_gescheitert' : 'kein_bild_audit', { hinweis: f.auditFehler || null });
  }
  if (audit.gleicheAnsicht) return ablehnen('gleiche_ansicht_mehrfach', { hinweis: audit.grund });
  if (!audit.echt) return ablehnen('fotos_unpassend', { hinweis: audit.grund });
  return { entscheidung: 'freigeben', grund: null, ctx: {} };
}

function ablehnen(grund, ctx = {}) { return { entscheidung: 'ablehnen', grund, ctx }; }
function offen(grund, ctx = {}) { return { entscheidung: 'offen', grund, ctx }; }

/**
 * Notbremse: kippt das Urteil in einem Lauf ungewöhnlich stark Richtung
 * „ablehnen", werden die betroffenen Ablehnungen NICHT geschrieben, sondern
 * bleiben offen — und der Bericht warnt rot. Freigaben laufen immer weiter:
 * sie sind die harmlose Richtung.
 *
 *  A) Bildprüfung: mehr als `bildMaxAnteil` der geprüften Fälle als unecht
 *     bzw. „dieselbe Ansicht" — dann liegt es eher am Modell als an den
 *     Einreichungen (Handrunden 09.–24.09.: 0–2 %).
 *  B) Gesamt: Ablehnungsquote über dem Doppelten des 30-Tage-Schnitts
 *     (mindestens `gesamtMin` Ablehnungen, damit ein kleiner Tag nicht auslöst).
 *
 * @param {Array<{entscheidung:string, grund:string|null, audit?:object|null}>} plan (wird verändert)
 * @param {{schnittQuote:number|null, bildMaxAnteil?:number, bildMin?:number, gesamtMin?:number}} opts
 * @returns {{bild:boolean, gesamt:boolean, text:string[]}}
 */
function notbremse(plan, { schnittQuote = null, bildMaxAnteil = 0.1, bildMin = 5, gesamtMin = 10 } = {}) {
  const ergebnis = { bild: false, gesamt: false, text: [] };
  const geprueft = plan.filter((p) => p.audit).length;
  const bildAbgelehnt = plan.filter((p) => p.entscheidung === 'ablehnen' && BILD_GRUENDE.has(p.grund));
  if (bildAbgelehnt.length >= bildMin && geprueft && bildAbgelehnt.length / geprueft > bildMaxAnteil) {
    ergebnis.bild = true;
    ergebnis.text.push(`Bildprüfung hielt ${bildAbgelehnt.length} von ${geprueft} Einreichungen für unpassend (${Math.round((100 * bildAbgelehnt.length) / geprueft)} %) — Ablehnungen aus der Bildprüfung zurückgehalten.`);
    bildAbgelehnt.forEach((p) => { p.zurueckgehaltenGrund = p.grund; p.entscheidung = 'offen'; p.grund = 'notbremse_bildpruefung'; });
  }
  const entschieden = plan.filter((p) => p.entscheidung === 'freigeben' || p.entscheidung === 'ablehnen');
  const abgelehnt = entschieden.filter((p) => p.entscheidung === 'ablehnen');
  const quote = entschieden.length ? abgelehnt.length / entschieden.length : 0;
  if (schnittQuote != null && abgelehnt.length >= gesamtMin && quote > 2 * Math.max(schnittQuote, 0.02)) {
    ergebnis.gesamt = true;
    ergebnis.text.push(`Ablehnungsquote ${Math.round(quote * 100)} % statt üblich ${Math.round(schnittQuote * 100)} % — alle Ablehnungen dieses Laufs zurückgehalten.`);
    abgelehnt.forEach((p) => { p.zurueckgehaltenGrund = p.grund; p.entscheidung = 'offen'; p.grund = 'notbremse_quote'; });
  }
  return ergebnis;
}

/**
 * Gebuchte Freigaben → eine Sammelnachricht pro Person. Nur tatsächlich
 * gebuchte (`rewardResult === 'credited'`) zählen; der Betrag ist der gebuchte.
 *
 * @param {Array<{id:string, uid:string, rewardResult?:string, rewardCents?:number}>} freigaben
 * @returns {Array<{uid:string, cents:number, anzahl:number, uploadIds:string[]}>}
 */
function buendelProPerson(freigaben) {
  const je = new Map();
  for (const f of freigaben) {
    if (f.rewardResult !== 'credited' || !(Number(f.rewardCents) > 0) || !f.uid) continue;
    const b = je.get(f.uid) || { uid: f.uid, cents: 0, anzahl: 0, uploadIds: [] };
    b.cents += Math.round(Number(f.rewardCents));
    b.anzahl += 1;
    if (b.uploadIds.length < 50) b.uploadIds.push(f.id);
    je.set(f.uid, b);
  }
  return [...je.values()];
}

module.exports = { entscheideFall, notbremse, buendelProPerson, BILD_GRUENDE };
