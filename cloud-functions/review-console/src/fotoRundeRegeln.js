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
/** Zählen nicht in die Gesamt-Quote der Notbremse (eigene Bremse, siehe notbremse). */
const PREIS_GRUENDE = new Set(['preis_fehlt']);

/**
 * Ein Fall → Entscheidung.
 *
 * @param {object} f
 * @param {{ok:boolean, problems:string[], missing:string[]}} f.comp   completenessCheck
 * @param {{verdict:string, reason:string|null, lockUntil:number|null}} f.dup  evaluateDuplicate
 * @param {string[]} f.leer         Slots mit 0-Byte-Datei (echter Mangel)
 * @param {string[]} f.unlesbar     Slots, deren Metadaten Storage nicht lieferte (unsere Technik)
 * @param {boolean} f.wiederverwendet  Identitätsfoto stammt aus einer älteren Einreichung
 * @param {{echt:boolean, loseWare:boolean, traegtAngaben?:boolean, gleicheAnsicht:boolean, grund:string}|null} f.audit
 * @param {string|null} f.auditFehler   Fehlermeldung, wenn die Bildprüfung scheiterte
 * @param {{name?:string, ean?:string, preis?:string, alles?:string}} f.rettungFehler  Nachlesen ist an unserer Technik gescheitert
 * @param {boolean} [f.preisFehlt]  Kandidat oder Referenz der Doppel-Regel hat keinen Preis
 * @param {boolean} [f.preisVorhanden]  Preis gelesen (Namer oder nachgelesen, werte.preisOf)
 * @param {string|null} [f.preisHinweis]  Anzeichen, dass doch ein Preis im Bild ist (Lesedienst sah Preisschild/Kassenbon)
 * @param {boolean} [f.preisBildDefekt]  Preisfoto kam beim Hochladen beschädigt an (unser Fehler, nicht der Einreichung)
 * @param {string|null} [f.ortAuffaellig]  Aufnahmeort passt nicht zum Markt (Ausland, anderes Land, Simulator)
 * @param {boolean} [f.namerLaeuft]  Der Lesedienst liest die Einreichung noch nach (namerNachlesenAb)
 * @returns {{entscheidung:'freigeben'|'ablehnen'|'offen', grund:string|null, ctx:object, loseWare?:boolean}}
 */
function entscheideFall(f) {
  const comp = f.comp || { ok: true, problems: [], missing: [] };
  const dup = f.dup || { verdict: 'ok', reason: null, lockUntil: null };
  const rf = f.rettungFehler || {};

  // Unsere Technik zuerst: ohne lesbare Dateien gibt es kein Urteil.
  if ((f.unlesbar || []).length) return offen('bild_nicht_lesbar_infrastruktur');
  // Der Lesedienst versucht es nach einer Störung noch einmal — erst danach
  // stehen Name, Preis und Kassenbon-Adresse (Ortsquelle der Vergütung) fest.
  if (f.namerLaeuft) return offen('namer_laeuft_noch');

  // Fehlende oder leere Pflichtfotos — ohne Ansehen entscheidbar.
  if (comp.problems.includes('unvollstaendig')) return ablehnen('unvollstaendig', { missing: comp.missing });
  if ((f.leer || []).length) return ablehnen('unvollstaendig', { missing: f.leer });

  // Doppel-Regel (Konsolen-Regel, gleiche Datei wie dort).
  if (dup.verdict === 'locked') {
    // Fehlende Preise gelten als gleich (fail-closed). Scheiterte das Nachlesen
    // des Preises an unserer Technik, wäre die Sperre ein Urteil aus einem
    // Werkzeugfehler — dann offen lassen (Gegenprüfung 24.09.).
    if (f.preisFehlt && rf.preis === 'lesungen_uneinig') return offen('preis_unsicher', { hinweis: 'Preis unsicher gelesen' });
    if (f.preisFehlt && (rf.preis || rf.alles)) return offen('nachlesen_gescheitert', { hinweis: rf.preis || rf.alles });
    return ablehnen(dup.reason || SAME_USER, { lockUntil: dup.lockUntil });
  }
  if (dup.verdict === 'hold') return offen(PENDING_OLDER);
  if (f.wiederverwendet) return ablehnen('bilder_wiederverwendet');

  // Ab hier braucht es die Bildprüfung.
  const audit = f.audit || null;

  if (comp.problems.includes('kein_produktname')) {
    // Scheiterte das Nachlesen (Limit ODER das Speichern des Ergebnisses), ist
    // das kein Beleg für „kein Name".
    if (rf.name === 'lesungen_uneinig') return offen('lesung_unsicher', { hinweis: 'Name nur einmal gelesen' });
    if (rf.name || rf.alles) return offen('nachlesen_gescheitert', { hinweis: rf.name || rf.alles });
    return ablehnen('kein_produktname');
  }

  if (comp.problems.includes('ean_fehlt')) {
    if (!audit) return offen(f.auditFehler ? 'bild_audit_gescheitert' : 'kein_bild_audit', { hinweis: f.auditFehler || null });
    // Lose Ware wird angenommen (Entscheidung Patrick 20.09.2026): Waage-Etiketten
    // tragen keinen Produkt-Barcode, das ist kein Fehler der Einreichung.
    // Waage-Etiketten wiederholen sich zwangsläufig auf allen Fotos — „dieselbe
    // Ansicht" ist bei loser Ware kein Mangel (Vergleich 24.09., Bergkäse).
    if (audit.loseWare && audit.echt) return freigabe(f, audit, { loseWare: true });
    if (rf.ean === 'lesungen_uneinig') return offen('lesung_unsicher', { hinweis: 'Barcode unsicher gelesen' });
    if (rf.ean || rf.alles) return offen('nachlesen_gescheitert', { hinweis: rf.ean || rf.alles });
    return ablehnen('ean_fehlt');
  }

  if (!audit) {
    const defekt = /decode|image data/i.test(String(f.auditFehler || ''));
    return offen(defekt ? 'bild_defekt' : f.auditFehler ? 'bild_audit_gescheitert' : 'kein_bild_audit', { hinweis: f.auditFehler || null });
  }
  // „Immer dieselbe Ansicht" ist nur ein Mangel, wenn das Produkt Angaben trägt,
  // die dadurch fehlen. Frischware ohne Zutaten/Nährwerte (Nektarinen im Netz)
  // hat nur ihr eines Etikett — ist es fotografiert, ist der Datensatz vollständig.
  // Vor „unecht" geprüft: der genauere Grund ergibt den passenderen App-Text.
  if (audit.gleicheAnsicht && audit.traegtAngaben !== false) return ablehnen('gleiche_ansicht_mehrfach', { hinweis: audit.grund });
  if (!audit.echt) return ablehnen('fotos_unpassend', { hinweis: audit.grund });
  return freigabe(f, audit, audit.traegtAngaben === false ? { ohneAngaben: true } : {});
}

/**
 * Letzte Hürden vor jeder Freigabe.
 *  - Preis ist Pflicht (Entscheidung Patrick 26.09.2026). Bis dahin ließ die
 *    Bildprüfung ein Preisfoto ohne Preis ausdrücklich durch — eine Regel, die
 *    ich (Claude) am 24.09. aus den Handrunden übernommen hatte, obwohl Patrick
 *    am 20.09. „preis?" als Prüfpunkt genannt hatte. Gemessen: 30 von 284
 *    Freigaben der Runde hatten keinen Preis im Foto.
 *    Genügt: Preis gelesen ODER auf dem Preisfoto sichtbar (dann fehlt nur die
 *    Lesung, der Datensatz ist vollständig). Scheiterte das Nachlesen an unserer
 *    Technik oder hat die Bildprüfung den Preis nicht beurteilt → offen.
 *    Abgelehnt wird NUR ohne jedes Gegenzeichen: widerspricht eine andere Quelle
 *    der Bildprüfung (der Lesedienst sah ein Preisschild oder einen Kassenbon,
 *    oder eine Nachlesung fand einen Preis, die zweite aber nicht), bleibt der
 *    Fall für einen Menschen liegen. Eine Ablehnung ist endgültig, das Liegen-
 *    lassen kostet nur einen Blick (Gegenprüfung 26.09.).
 *  - Aufnahmeort passt nicht zum Markt → Mensch (kann harmlos sein, etwa Aldi
 *    Süd statt Hofer in Österreich; 3 von 1.973 Freigaben seit 01.09.).
 */
function freigabe(f, audit, extra = {}) {
  if (!f.preisVorhanden && !(audit && audit.preisSichtbar === true)) {
    const rf = f.rettungFehler || {};
    if (rf.preis === 'lesungen_uneinig') return offen('preis_unsicher', { hinweis: 'Nur eine von zwei Nachlesungen fand einen Preis' });
    if (rf.preis || rf.alles) return offen('nachlesen_gescheitert', { hinweis: rf.preis || rf.alles });
    if (!audit || typeof audit.preisSichtbar !== 'boolean') return offen('preis_unbeurteilt');
    if (f.preisHinweis) return offen('preis_unsicher', { hinweis: f.preisHinweis });
    // Abgeschnittene Datei aus dem Android-Upload (26.09.): ist nur der untere
    // Teil weg, sieht jede Lesung „kein Preis" — die Ursache wäre unsere.
    if (f.preisBildDefekt) return offen('bild_defekt', { hinweis: 'Preisfoto beim Hochladen beschädigt' });
    return ablehnen('preis_fehlt');
  }
  if (f.ortAuffaellig) return offen('ort_auffaellig', { hinweis: f.ortAuffaellig });
  return { entscheidung: 'freigeben', grund: null, ctx: {}, ...extra };
}

/**
 * Name aus zwei Nachlesungen (24.09.2026, Hinweis APP_ORIGINAL). Verlangt
 * wird, dass ein Name LESBAR ist — nicht, dass zwei Lesungen wortgleich sind.
 *  - beide lesen einen Namen → übernehmen (bei Abweichung die kürzere Fassung,
 *    die längere als Alternative merken),
 *  - nur eine liest einen Namen → unsicher → der Fall bleibt offen (kein Urteil),
 *  - keine liest einen Namen → kein Name (darf abgelehnt werden).
 */
function nameAusLesungen(a, b) {
  const lies = (x) => (x && x.sicher !== false ? String(x.name || '').trim() : '');
  const na = lies(a);
  const nb = lies(b);
  if (na && nb) {
    const gleich = normName(na) === normName(nb);
    const kurz = na.length <= nb.length ? na : nb;
    return { name: kurz.slice(0, 120), alternative: gleich ? null : (kurz === na ? nb : na).slice(0, 120) };
  }
  if (na || nb) return { unsicher: true };
  return {};
}

/**
 * Barcode aus zwei Nachlesungen. Hier bleibt es STRENG, weil eine falsche EAN
 * das Produkt falsch zuordnet: übernommen nur bei zweimal gleich + Prüfziffer.
 * Lesen die beiden aber Ziffern, ohne sich zu einigen, ist ein Barcode da und
 * nur schwer lesbar — dann offen statt „kein Barcode" (kein Urteil).
 */
function eanAusLesungen(a, b, pruefzifferOk) {
  const lies = (x) => (x && x.sicher !== false ? String(x.ean || '').replace(/\D/g, '') : '');
  const ea = lies(a);
  const eb = lies(b);
  if (ea && ea === eb && pruefzifferOk(ea)) return { ean: ea };
  if (ea || eb) return { unsicher: true };
  return {};
}

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

/**
 * Nachlese-Fehler eines Falls, den die Runde in ihrer Arbeitszeit nicht mehr
 * erreicht hat. Gilt für ALLE Angaben, auch den Preis: fehlte `preis`, wurde
 * eine Sperre, die nur am fehlenden Preis hängt, abgelehnt statt offen gelassen
 * — ein Werkzeugfehler als Urteil (gefunden 26.09.2026, greift ab etwa doppeltem
 * Tagesvolumen).
 */
const rettungNichtGeschafft = () => ({ name: 'zeit_abgelaufen', ean: 'zeit_abgelaufen', preis: 'zeit_abgelaufen' });

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
 *     OHNE „Preis fehlt": diese Ablehnungen gibt es erst seit 26.09., sie hätten
 *     die Quote gegenüber dem alten Schnitt dauerhaft verdoppelt und die Bremse
 *     jeden Tag ausgelöst (Gegenprüfung 26.09.). Dafür hat der Preis seine eigene
 *     Bremse C, und schnittQuote lässt diese Ablehnungen ebenfalls weg.
 *  C) Preis: mehr als `preisMaxAnteil` der geprüften Fälle „Preis fehlt".
 *
 * @param {Array<{entscheidung:string, grund:string|null, audit?:object|null}>} plan (wird verändert)
 * @param {{schnittQuote:number|null, bildMaxAnteil?:number, bildMin?:number, gesamtMin?:number, preisMaxAnteil?:number, preisMin?:number}} opts
 * @returns {{bild:boolean, gesamt:boolean, preis:boolean, text:string[]}}
 */
function notbremse(plan, { schnittQuote = null, bildMaxAnteil = 0.1, bildMin = 5, gesamtMin = 10, preisMaxAnteil = 0.3, preisMin = 8 } = {}) {
  const ergebnis = { bild: false, gesamt: false, preis: false, text: [] };
  const geprueft = plan.filter((p) => p.audit).length;
  // „Preis fehlt" beruht auf dem Urteil der Bildprüfung. Normal sind gut 10 %
  // der geprüften Fälle (gemessen 26.09.); fehlt bei deutlich mehr der Preis,
  // ist eher die Bildprüfung gestört als die Einreichungen.
  const preisAbgelehnt = plan.filter((p) => p.entscheidung === 'ablehnen' && p.grund === 'preis_fehlt');
  if (preisAbgelehnt.length >= preisMin && geprueft && preisAbgelehnt.length / geprueft > preisMaxAnteil) {
    ergebnis.preis = true;
    ergebnis.text.push(`Bei ${preisAbgelehnt.length} von ${geprueft} Einreichungen fehlte angeblich der Preis (${Math.round((100 * preisAbgelehnt.length) / geprueft)} %) — diese Ablehnungen zurückgehalten.`);
    preisAbgelehnt.forEach((p) => { p.zurueckgehaltenGrund = p.grund; p.entscheidung = 'offen'; p.grund = 'notbremse_preis'; });
  }
  const bildAbgelehnt = plan.filter((p) => p.entscheidung === 'ablehnen' && BILD_GRUENDE.has(p.grund));
  if (bildAbgelehnt.length >= bildMin && geprueft && bildAbgelehnt.length / geprueft > bildMaxAnteil) {
    ergebnis.bild = true;
    ergebnis.text.push(`Bildprüfung hielt ${bildAbgelehnt.length} von ${geprueft} Einreichungen für unpassend (${Math.round((100 * bildAbgelehnt.length) / geprueft)} %) — Ablehnungen aus der Bildprüfung zurückgehalten.`);
    bildAbgelehnt.forEach((p) => { p.zurueckgehaltenGrund = p.grund; p.entscheidung = 'offen'; p.grund = 'notbremse_bildpruefung'; });
  }
  const entschieden = plan.filter((p) => (p.entscheidung === 'freigeben' || p.entscheidung === 'ablehnen') && !PREIS_GRUENDE.has(p.grund));
  const abgelehnt = entschieden.filter((p) => p.entscheidung === 'ablehnen');
  const quote = entschieden.length ? abgelehnt.length / entschieden.length : 0;
  if (schnittQuote != null && abgelehnt.length >= gesamtMin && quote > 2 * Math.max(schnittQuote, 0.02)) {
    ergebnis.gesamt = true;
    ergebnis.text.push(`Ablehnungsquote ${Math.round(quote * 100)} % statt üblich ${Math.round(schnittQuote * 100)} % — alle Ablehnungen dieses Laufs zurückgehalten.`);
    // Wenn insgesamt etwas kippt, auch die Preis-Ablehnungen halten.
    plan.filter((p) => p.entscheidung === 'ablehnen')
      .forEach((p) => { p.zurueckgehaltenGrund = p.grund; p.entscheidung = 'offen'; p.grund = 'notbremse_quote'; });
  }
  return ergebnis;
}

module.exports = { entscheideFall, notbremse, nameAusLesungen, eanAusLesungen, rettungNichtGeschafft, BILD_GRUENDE, PREIS_GRUENDE };
