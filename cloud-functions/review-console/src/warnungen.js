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
 * @param {{geprueft:number, offen:number, auditFehler:number, auditVersucht:number, nichtGeschafft:number, schreibFehler?:number, aeltesteOffenTage?:number|null, fotoAbgleichGescheitert?:boolean, kontoSperrenUnlesbar?:boolean, eanHaltenNeu?:number, haltBefundNichtGespeichert?:number, eanFotoNichtGespeichert?:number}} k.runde
 * @param {{bild:boolean, gesamt:boolean, text:string[]}} k.notbremse
 * @param {{alt:string|null, neu:string}} k.regelVersion
 * @param {{scharf:boolean, bericht:object|null, abgebrochen?:boolean, laeuftNoch?:boolean, unbekannt?:boolean}} [k.bonRunde]
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
    // Ohne diese Abgleiche gibt die Runde nichts frei (Entscheidungen Patrick
    // 02.10.2026, fail-closed) — still wäre das ein Tag ohne jede Freigabe.
    if (r.kontoSperrenUnlesbar) rot('kontosperren_unlesbar', 'Die Liste gesperrter Konten (cashback_sperren) war nicht lesbar — heute wurde nichts freigegeben. Die Fälle sind morgen wieder dran.');
    if (r.fotoAbgleichGescheitert) rot('foto_abgleich_gescheitert', 'Der Abgleich der Fotos mit früheren Einreichungen ist gescheitert (Storage-Liste) — heute wurde nichts freigegeben. Die Fälle sind morgen wieder dran.');
    if (r.schreibFehler > 0) rot('schreibfehler', `${r.schreibFehler} Entscheidungen konnten nicht gespeichert werden — die Fälle sind offen geblieben und morgen wieder dran.`);
    if (r.nichtGeschafft > 0) gelb('runde_unvollstaendig', `${r.nichtGeschafft} Einreichungen hat die Runde in der Zeit nicht mehr geschafft — sie sind morgen dran.`);
    // Seit der Preis-Pflicht (26.09.) bleibt bei Zweifel mehr liegen als vorher.
    // Liegen heißt: die Person wartet auf ihr Geld — das darf nicht still wachsen.
    if (r.aeltesteOffenTage != null && r.aeltesteOffenTage >= 3) {
      gelb('fotos_warten', `${r.offen} Produktfotos warten auf deine Entscheidung, die älteste seit ${r.aeltesteOffenTage} Tagen.`);
    }
    if (r.auditVersucht >= 8 && r.auditFehler / r.auditVersucht > 0.25) {
      rot('bildpruefung_gestoert', `Die Bildprüfung ist bei ${r.auditFehler} von ${r.auditVersucht} Einreichungen gescheitert (meist Google-Limit). Diese Fälle bleiben offen.`);
    }
    // Barcode-Nummer (Prüfrunde 2, 02.10.2026): normal ~3 % der geprüften
    // Fälle. Ändert sich das Modell (wie beim thinkingBudget am 22.09.),
    // blieben sonst massenhaft Fälle still liegen — aufgefallen wäre es erst
    // nach drei Tagen über „Produktfotos warten".
    const eanNeu = Number(r.eanHaltenNeu) || 0;
    if (r.auditVersucht > 0 && eanNeu >= 8 && eanNeu / r.auditVersucht > 0.1) {
      (eanNeu / r.auditVersucht > 0.25 ? rot : gelb)('barcode_haelt_viele', `${eanNeu} von ${r.auditVersucht} geprüften Einreichungen hält die Runde wegen der Barcode-Nummer an (normal etwa 3 %) — Lesung des Modells prüfen.`);
    }
    // Ohne diese Einträge sieht die Prüfkonsole nicht, warum die Runde einen
    // Fall liegen ließ, und gibt ihn ohne Warnung frei (Prüfrunde 2).
    if (r.haltBefundNichtGespeichert > 0) {
      rot('befund_nicht_gespeichert', `Bei ${r.haltBefundNichtGespeichert} offenen Fällen konnte der Halte-Grund (gleiches Foto, Barcode-Nummer) nicht gespeichert werden — die Prüfkonsole zeigt sie als unauffällig. Vor einer Freigabe die Fälle im Bericht ansehen.`);
    }
    if (r.eanFotoNichtGespeichert > 0) {
      gelb('barcode_befund_nicht_gespeichert', `Bei ${r.eanFotoNichtGespeichert} Fällen konnte der Barcode-Befund (eanFotoOcr) nicht gespeichert werden; er steht ersatzweise am Halte-Grund der Runde.`);
    }
  }
  for (const t of (k.notbremse?.text || [])) rot('notbremse', `Notbremse: ${t}`);

  // ── Bon-Runde (07:45) ────────────────────────────────────────────────
  const br = k.bonRunde;
  if (br && !br.bericht) {
    if (br.unbekannt) gelb('bonrunde_unbekannt', 'Der Bericht der Bon-Runde von 7:45 Uhr konnte nicht gelesen werden — offene Bons in der Prüfkonsole ansehen.');
    else if (br.laeuftNoch && !br.abgebrochen) gelb('bonrunde_laeuft', 'Die Bon-Runde von 7:45 Uhr lief beim Schreiben dieses Berichts noch — ihr Ergebnis fehlt hier. Offene Bons in der Prüfkonsole ansehen.');
    else if (br.abgebrochen) {
      if (br.scharf) rot('bonrunde_abgebrochen', 'Die Bon-Runde von 7:45 Uhr ist nicht fertig geworden. Einzelne Bons können schon entschieden sein — Stand in der Prüfkonsole ansehen.');
      else gelb('bonrunde_abgebrochen', 'Der Trockenlauf der Bon-Runde von 7:45 Uhr ist nicht fertig geworden.');
    }
    else if (br.scharf) rot('bonrunde_fehlt', 'Die Bon-Runde von 7:45 Uhr ist heute nicht gelaufen — Bons in der Prüfung warten weiter.');
    else gelb('bonrunde_fehlt', 'Der Trockenlauf der Bon-Runde von 7:45 Uhr ist heute nicht gelaufen.');
  }
  const bb = br && br.bericht;
  if (bb) {
    if (bb.technikFehler > 0) rot('bonrunde_technik', `Bei ${bb.technikFehler} Bons ist die Bon-Runde an einem technischen Fehler gescheitert — sie bleiben offen und sind morgen wieder dran.`);
    const budget = (bb.budgetEnde || 0) + ((bb.offenGruende && bb.offenGruende.budget_leer) || 0);
    if (budget > 0) (bb.dryRun ? gelb : rot)('bonrunde_budget', bb.dryRun
      ? `${budget} Bons könnten nicht bezahlt werden, weil das Budget ihrer Aktion nicht reicht.`
      : `${budget} Bons konnten nicht bezahlt werden, weil das Budget ihrer Aktion leer ist.`);
    if (bb.offen >= 5) gelb('bonrunde_offen', `${bb.offen} Bons konnte die Bon-Runde nicht entscheiden — bitte in der Prüfkonsole ansehen.`);
    if (bb.tagesKollisionen > 0) gelb('bonrunde_kollision', `Bei ${bb.tagesKollisionen} Personen lagen mehr Bons desselben Tages als das Tageslimit — welcher bezahlt wurde, entschied die Reihenfolge.`);
  }

  if (k.regelVersion && k.regelVersion.alt && k.regelVersion.alt !== k.regelVersion.neu) {
    gelb('regeln_geaendert', 'Die Prüfregeln haben sich seit dem letzten Lauf geändert. Die Ergebnisse von heute bitte einmal ansehen.');
  }
  return w;
}

module.exports = { warnungen };
