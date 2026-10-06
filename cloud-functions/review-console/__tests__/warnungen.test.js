'use strict';
const { warnungen } = require('../src/warnungen');

const TAG = 24 * 60 * 60 * 1000;
const JETZT = Date.parse('2026-09-28T06:00:00Z');
const aktion = (over) => ({ id: 'x', kind: 'receipt', active: true, startAt: JETZT - 20 * TAG, endAt: JETZT + 20 * TAG, budgetRemainingCents: 5000, budgetTotalCents: 10000, ...over });
const basis = (over = {}) => ({
  jetzt: JETZT,
  aktionen: [aktion({ id: 'bon' }), aktion({ id: 'foto', kind: 'product_photos' })],
  zweitpruefung: { eingeschaltet: true, laeufeLetzte48h: 7 },
  bons: { inPruefung: 2, aeltesteTage: 0, letzte24h: { gesamt: 200, ohneAktion: 1 } },
  runde: { geprueft: 50, offen: 1, auditFehler: 0, auditVersucht: 49, nichtGeschafft: 0 },
  notbremse: { bild: false, gesamt: false, text: [] },
  regelVersion: { alt: 'abc', neu: 'abc' },
  ...over,
});
const codes = (w) => w.map((x) => `${x.stufe}:${x.code}`);

describe('warnungen', () => {
  it('ruhiger Tag → keine Warnung', () => {
    expect(warnungen(basis())).toEqual([]);
  });

  it('Aktion endet in 2 Tagen ohne Nachfolger → rot (Vorfall 01.09.)', () => {
    const w = warnungen(basis({ aktionen: [aktion({ id: 'bon', endAt: JETZT + 2 * TAG - 1000 }), aktion({ id: 'foto', kind: 'product_photos' })] }));
    expect(codes(w)).toContain('rot:aktion_endet_receipt');
  });

  it('Nachfolger angelegt → keine Warnung', () => {
    const ende = JETZT + 2 * TAG;
    const w = warnungen(basis({ aktionen: [aktion({ id: 'bon', endAt: ende }), aktion({ id: 'okt', startAt: ende, endAt: ende + 30 * TAG }), aktion({ id: 'foto', kind: 'product_photos' })] }));
    expect(codes(w).filter((c) => c.includes('aktion'))).toEqual([]);
  });

  it('gar keine laufende Foto-Aktion → rot', () => {
    expect(codes(warnungen(basis({ aktionen: [aktion({ id: 'bon' })] })))).toContain('rot:aktion_fehlt_product_photos');
  });

  it('Zweitprüfung an, aber 48 h still → rot (Vorfall 23.09.)', () => {
    expect(codes(warnungen(basis({ zweitpruefung: { eingeschaltet: true, laeufeLetzte48h: 0 } })))).toContain('rot:zweitpruefung_still');
  });

  it('Zweitprüfung aus → keine Warnung, auch ohne Läufe', () => {
    expect(warnungen(basis({ zweitpruefung: { eingeschaltet: false, laeufeLetzte48h: 0 } }))).toEqual([]);
  });

  it('viele Bons ohne Aktion → rot', () => {
    expect(codes(warnungen(basis({ bons: { inPruefung: 0, aeltesteTage: null, letzte24h: { gesamt: 150, ohneAktion: 60 } } })))).toContain('rot:bons_ohne_aktion');
  });

  it('Budget leer → rot, fast leer → gelb', () => {
    const w = warnungen(basis({ aktionen: [aktion({ id: 'bon', budgetRemainingCents: 0 }), aktion({ id: 'foto', kind: 'product_photos', budgetRemainingCents: 500 })] }));
    expect(codes(w)).toEqual(expect.arrayContaining(['rot:budget_leer_bon', 'gelb:budget_knapp_foto']));
  });

  it('Bildprüfung scheitert reihenweise → rot', () => {
    expect(codes(warnungen(basis({ runde: { geprueft: 60, offen: 20, auditFehler: 20, auditVersucht: 60, nichtGeschafft: 0 } })))).toContain('rot:bildpruefung_gestoert');
  });

  it('Notbremse und geänderte Regeln erscheinen', () => {
    const w = warnungen(basis({ notbremse: { bild: true, gesamt: false, text: ['x'] }, regelVersion: { alt: 'a', neu: 'b' } }));
    expect(codes(w)).toEqual(expect.arrayContaining(['rot:notbremse', 'gelb:regeln_geaendert']));
  });
});

describe('Produktfotos warten', () => {
  it('ältester offener Fall seit 3 Tagen → gelb', () => {
    const w = warnungen(basis({ runde: { geprueft: 50, offen: 12, auditFehler: 0, auditVersucht: 49, nichtGeschafft: 0, aeltesteOffenTage: 3 } }));
    expect(codes(w)).toEqual(['gelb:fotos_warten']);
    expect(w[0].text).toMatch(/12 Produktfotos.*3 Tagen/);
  });
  it('seit 2 Tagen → noch keine Warnung', () => {
    expect(warnungen(basis({ runde: { geprueft: 50, offen: 12, auditFehler: 0, auditVersucht: 49, nichtGeschafft: 0, aeltesteOffenTage: 2 } }))).toEqual([]);
  });
});

describe('Schreibfehler', () => {
  it('nicht gespeicherte Entscheidungen → rot', () => {
    expect(codes(warnungen(basis({ runde: { geprueft: 50, offen: 2, auditFehler: 0, auditVersucht: 48, nichtGeschafft: 0, schreibFehler: 2 } })))).toContain('rot:schreibfehler');
  });
});

describe('Abgleiche, ohne die nichts freigegeben wird (Entscheidungen Patrick 02.10.2026)', () => {
  const runde = (over) => ({ ...basis().runde, ...over });
  it('Sperrliste nicht lesbar → rot', () => {
    expect(codes(warnungen(basis({ runde: runde({ kontoSperrenUnlesbar: true }) })))).toContain('rot:kontosperren_unlesbar');
  });
  it('Foto-Abgleich gescheitert → rot', () => {
    expect(codes(warnungen(basis({ runde: runde({ fotoAbgleichGescheitert: true }) })))).toContain('rot:foto_abgleich_gescheitert');
  });
  it('beides in Ordnung → nichts', () => {
    expect(warnungen(basis({ runde: runde({ kontoSperrenUnlesbar: false, fotoAbgleichGescheitert: false }) }))).toEqual([]);
  });
});

describe('Bon-Runde', () => {
  it('scharf, aber kein Bericht von heute → rot', () => {
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: null } })))).toContain('rot:bonrunde_fehlt');
  });
  it('Trockenlauf ohne Bericht → gelb (sonst fällt ein Absturz in der Beobachtungsphase nicht auf)', () => {
    expect(codes(warnungen(basis({ bonRunde: { scharf: false, bericht: null } })))).toEqual(['gelb:bonrunde_fehlt']);
  });
  it('angefangen, aber nicht fertig → rot, eigener Text', () => {
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: null, abgebrochen: true } })))).toEqual(['rot:bonrunde_abgebrochen']);
  });
  it('viele offene → gelb', () => {
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: { offen: 6 } } })))).toContain('gelb:bonrunde_offen');
  });
  it('Bon-Bericht nicht lesbar → nur gelb, geht vor „läuft"/„abgebrochen"', () => {
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: null, unbekannt: true } })))).toEqual(['gelb:bonrunde_unbekannt']);
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: null, unbekannt: true, abgebrochen: true } })))).toEqual(['gelb:bonrunde_unbekannt']);
  });
  it('technischer Fehler → rot, schon ab einem Bon', () => {
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: { offen: 1, technikFehler: 1 } } })))).toContain('rot:bonrunde_technik');
  });
  it('Budget leer (vorab erkannt oder vom Server gemeldet) → rot', () => {
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: { offen: 1, offenGruende: { budget_leer: 1 } } } })))).toContain('rot:bonrunde_budget');
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: { offen: 0, budgetEnde: 1 } } })))).toContain('rot:bonrunde_budget');
  });
  it('mehrere Bons desselben Tages → gelb', () => {
    expect(codes(warnungen(basis({ bonRunde: { scharf: true, bericht: { offen: 0, tagesKollisionen: 1 } } })))).toContain('gelb:bonrunde_kollision');
  });
  it('sauberer Lauf → nichts', () => {
    expect(warnungen(basis({ bonRunde: { scharf: true, bericht: { offen: 2, technikFehler: 0, budgetEnde: 0, tagesKollisionen: 0, offenGruende: { datum_widerspricht: 2 } } } }))).toEqual([]);
  });
});

describe('Barcode-Nummer und Halte-Gründe (Prüfrunde 2, 02.10.2026)', () => {
  const runde = (over) => ({ ...basis().runde, ...over });
  it('normal (~3 %) → nichts; über 10 % (mind. 8) → gelb; über 25 % → rot', () => {
    expect(warnungen(basis({ runde: runde({ auditVersucht: 270, eanHaltenNeu: 8 }) }))).toEqual([]);
    expect(codes(warnungen(basis({ runde: runde({ auditVersucht: 60, eanHaltenNeu: 8 }) })))).toEqual(['gelb:barcode_haelt_viele']);
    expect(codes(warnungen(basis({ runde: runde({ auditVersucht: 30, eanHaltenNeu: 8 }) })))).toEqual(['rot:barcode_haelt_viele']);
    expect(warnungen(basis({ runde: runde({ auditVersucht: 20, eanHaltenNeu: 7 }) }))).toEqual([]); // kleiner Tag
  });
  it('Halte-Grund für die Konsole nicht gespeichert → rot; nur der Barcode-Befund → gelb (steht ersatzweise am Halte-Grund)', () => {
    expect(codes(warnungen(basis({ runde: runde({ haltBefundNichtGespeichert: 1 }) })))).toEqual(['rot:befund_nicht_gespeichert']);
    expect(codes(warnungen(basis({ runde: runde({ eanFotoNichtGespeichert: 2 }) })))).toEqual(['gelb:barcode_befund_nicht_gespeichert']);
  });
});

describe('Bildschirmfoto als Preisbeleg (04.10.2026)', () => {
  const runde = (over) => ({ ...basis().runde, ...over });
  it('Bildprüfung beantwortet die Preisquelle nicht mehr (> 25 %, mind. 8 befragt) → gelb', () => {
    expect(warnungen(basis({ runde: runde({ preisQuelleBefragt: 100, preisQuelleOhneAntwort: 2 }) }))).toEqual([]);
    expect(codes(warnungen(basis({ runde: runde({ preisQuelleBefragt: 40, preisQuelleOhneAntwort: 11 }) })))).toEqual(['gelb:preisquelle_ohne_antwort']);
    expect(warnungen(basis({ runde: runde({ preisQuelleBefragt: 6, preisQuelleOhneAntwort: 6 }) }))).toEqual([]); // kleiner Tag
    expect(warnungen(basis({ runde: runde({ preisQuelleBefragt: 0 }) }))).toEqual([]); // Schalter aus
  });
  it('viele Fälle wegen unsicherer Preisquelle angehalten (≥ 5 und > 5 %) → gelb', () => {
    expect(warnungen(basis({ runde: runde({ auditVersucht: 120, preisBildschirmHalten: 2 }) }))).toEqual([]);
    expect(codes(warnungen(basis({ runde: runde({ auditVersucht: 80, preisBildschirmHalten: 5 }) })))).toEqual(['gelb:preisquelle_haelt_viele']);
    expect(warnungen(basis({ runde: runde({ auditVersucht: 120, preisBildschirmHalten: 5 }) }))).toEqual([]);
  });
  it('„Bildschirm", obwohl der Lesedienst einen Kassenbon sah (gemessen nie) → gelb ab 2', () => {
    expect(warnungen(basis({ runde: runde({ preisBildschirmTrotzBon: 1 }) }))).toEqual([]);
    expect(codes(warnungen(basis({ runde: runde({ preisBildschirmTrotzBon: 2 }) })))).toEqual(['gelb:preisquelle_bon_als_bildschirm']);
  });
  it('Kopf des Preisfotos nicht abrufbar (Storage) → gelb ab 3', () => {
    expect(warnungen(basis({ runde: runde({ preisKopfNichtAbrufbar: 2 }) }))).toEqual([]);
    expect(codes(warnungen(basis({ runde: runde({ preisKopfNichtAbrufbar: 3 }) })))).toEqual(['gelb:preisfoto_kopf_nicht_abrufbar']);
  });
  // Prüfrunde 3 (04.10.2026): scharf hält ein fehlender Kopf jede Freigabe aus
  // dem Laden an — bei einer Storage-Störung ein Tag ohne Freigaben.
  it('Kopf nicht abrufbar, scharf, > 25 % der befragten (mind. 8) → rot; Beobachtung oder wenige → gelb', () => {
    const k = (over) => codes(warnungen(basis({ runde: runde(over) })));
    expect(k({ preisBildschirmScharf: true, preisQuelleBefragt: 120, preisKopfNichtAbrufbar: 120 })).toEqual(['rot:preisfoto_kopf_nicht_abrufbar']);
    expect(k({ preisBildschirmScharf: true, preisQuelleBefragt: 40, preisKopfNichtAbrufbar: 11 })).toEqual(['rot:preisfoto_kopf_nicht_abrufbar']);
    expect(k({ preisBildschirmScharf: true, preisQuelleBefragt: 40, preisKopfNichtAbrufbar: 10 })).toEqual(['gelb:preisfoto_kopf_nicht_abrufbar']);
    expect(k({ preisBildschirmScharf: true, preisQuelleBefragt: 6, preisKopfNichtAbrufbar: 6 })).toEqual(['gelb:preisfoto_kopf_nicht_abrufbar']); // kleiner Tag
    expect(k({ preisBildschirmScharf: false, preisQuelleBefragt: 120, preisKopfNichtAbrufbar: 120 })).toEqual(['gelb:preisfoto_kopf_nicht_abrufbar']);
    expect(k({ preisBildschirmScharf: true, preisQuelleBefragt: 120, preisKopfNichtAbrufbar: 2 })).toEqual([]);
    const text = warnungen(basis({ runde: runde({ preisBildschirmScharf: true, preisQuelleBefragt: 120, preisKopfNichtAbrufbar: 120 }) }))[0].text;
    expect(text).toMatch(/120 von 120 .*kaum Freigaben/);
  });
  it('Notbremse der Regel erscheint rot wie jede Notbremse', () => {
    expect(codes(warnungen(basis({ notbremse: { bild: false, gesamt: false, bildschirm: true, text: ['Bei 6 von 60 …'] } })))).toEqual(['rot:notbremse']);
  });
  // Nachprüfung 06.10.2026: hält die Bremse nur dank Fällen eines Vortags
  // (bzw. wurden solche Fälle doch abgelehnt), meldet sie gelb, nicht rot.
  it('… gelbe Einträge der Notbremse erscheinen gelb mit ihrem Code', () => {
    const w = warnungen(basis({ notbremse: { bild: false, gesamt: false, bildschirm: true, text: [], gelb: [
      { code: 'notbremse_vortage_bildschirm', text: '4 Bildschirm-Ablehnungen … liegen seit …' },
      { code: 'notbremse_vortage_abgelehnt_bildschirm', text: '3 … heute abgelehnt' },
    ] } }));
    expect(codes(w)).toEqual(['gelb:notbremse_vortage_bildschirm', 'gelb:notbremse_vortage_abgelehnt_bildschirm']);
    expect(w[0].text).toBe('Notbremse: 4 Bildschirm-Ablehnungen … liegen seit …');
    // ältere Aufrufer ohne `gelb` bleiben unverändert
    expect(warnungen(basis({ notbremse: { bild: false, gesamt: false, text: [] } }))).toEqual([]);
  });
  // Prüfrunde 2 (04.10.2026)
  it('„Kassenbon", der Lesedienst las das Foto und sah keinen (gemessen nie) → gelb ab 2', () => {
    expect(warnungen(basis({ runde: runde({ preisBildschirmBonWiderspruch: 1 }) }))).toEqual([]);
    expect(codes(warnungen(basis({ runde: runde({ preisBildschirmBonWiderspruch: 2 }) })))).toEqual(['gelb:preisquelle_bon_widerspruch']);
  });
  // Nachprüfung 06.10.2026: „bleiben liegen" nur, wenn die Fälle wirklich liegen (scharfe Regel)
  it('… der Text sagt, ob die Fälle liegen (scharf) oder in der Beobachtung bezahlt werden', () => {
    const text = (liegt) => warnungen(basis({ runde: runde({ preisBildschirmBonWiderspruch: 3, preisBildschirmBonWiderspruchLiegt: liegt }) }))[0].text;
    expect(text(3)).toMatch(/die Fälle bleiben liegen/);
    expect(text(0)).toMatch(/in der Beobachtung hält die Runde sie nicht an/);
    expect(text(0)).not.toMatch(/bleiben liegen/);
    expect(text(1)).toMatch(/1 davon bleibt liegen, die übrigen hält die Runde in der Beobachtung nicht an/);
  });
  it('unbekannter Schalterwert ("true" als Text) → gelb, nennt den Wert', () => {
    expect(warnungen(basis({ runde: runde({ preisBildschirmSchalterUnbekannt: null }) }))).toEqual([]);
    const w = warnungen(basis({ runde: runde({ preisBildschirmSchalterUnbekannt: '"true" (Text)' }) }));
    expect(codes(w)).toEqual(['gelb:preisbildschirm_schalter_unbekannt']);
    expect(w[0].text).toMatch(/"true" \(Text\).*Beobachtung.*boolean/);
  });
});

describe('Preisbeleg „Kassenbon" (Entscheidung Claude im Auftrag Patricks, 04.10.2026)', () => {
  const runde = (over) => ({ ...basis().runde, ...over });
  it('viele Fälle wegen unsicheren Preisbelegs angehalten (≥ 5 und > 5 %) → gelb; normal 4–8 pro Woche', () => {
    expect(warnungen(basis({ runde: runde({ auditVersucht: 120, preisBelegHalten: 2 }) }))).toEqual([]);
    expect(codes(warnungen(basis({ runde: runde({ auditVersucht: 80, preisBelegHalten: 5 }) })))).toEqual(['gelb:preisbeleg_haelt_viele']);
    expect(warnungen(basis({ runde: runde({ auditVersucht: 120, preisBelegHalten: 5 }) }))).toEqual([]);
  });
  it('Merkmal-Frage bei „Kassenbon" ohne Antwort (> 25 %, mind. 8) → gelb', () => {
    expect(warnungen(basis({ runde: runde({ preisBelegKassenbon: 40, preisBelegOhneAntwort: 10 }) }))).toEqual([]);
    const w = warnungen(basis({ runde: runde({ preisBelegKassenbon: 40, preisBelegOhneAntwort: 11 }) }));
    expect(codes(w)).toEqual(['gelb:preisbeleg_ohne_antwort']);
    expect(w[0].text).toMatch(/11 von 40/);
    expect(warnungen(basis({ runde: runde({ preisBelegKassenbon: 6, preisBelegOhneAntwort: 6 }) }))).toEqual([]); // kleiner Tag
  });
  it('Liste unserer Märkte nicht lesbar → gelb', () => {
    expect(warnungen(basis({ runde: runde({ preisBelegMaerkteUnlesbar: false }) }))).toEqual([]);
    expect(codes(warnungen(basis({ runde: runde({ preisBelegMaerkteUnlesbar: true }) })))).toEqual(['gelb:preisbeleg_maerkte_unlesbar']);
  });
});

describe('Produktsuche (unbekannte Barcodes)', () => {
  const { produktsucheLage } = require('../src/produktsuche');
  const zaehler = (over) => ({ bearbeitet: 120, gefunden: 58, keineDaten: 50, fehler: 2, uebersprungen: 10, serperRest: 9000, ...over });
  const lage = ({ gestern = zaehler(), heute = null, konfig = null, wartend = 18000 } = {}) => produktsucheLage({ jetzt: JETZT, gesternRoh: gestern, heuteRoh: heute, konfigRoh: konfig, wartend });
  const mit = (p) => codes(warnungen(basis({ produktsuche: p })));

  it('normaler Tag → keine Warnung', () => {
    expect(mit(lage())).toEqual([]);
  });

  it('nicht lesbar → gelb, sonst nichts', () => {
    expect(mit({ unlesbar: true })).toEqual(['gelb:produktsuche_unbekannt']);
  });

  it('wegen Serper-Guthaben angehalten → rot mit Guthaben und Grenze', () => {
    const w = warnungen(basis({ produktsuche: lage({ gestern: zaehler({ serperRest: 980, angehalten: 'serper_guthaben' }) }) }));
    expect(codes(w)).toEqual(['rot:produktsuche_angehalten']);
    expect(w[0].text).toMatch(/980.*Grenze 1\.000/);
  });

  it('Tagesdeckel erreicht ist Normalbetrieb → keine Warnung', () => {
    expect(mit(lage({ gestern: zaehler({ angehalten: 'tagesdeckel' }) }))).toEqual([]);
  });

  it('Guthaben unter dem Dreifachen der Grenze → gelb vorab', () => {
    expect(mit(lage({ gestern: zaehler({ serperRest: 2999 }) }))).toEqual(['gelb:serper_knapp']);
    expect(mit(lage({ gestern: zaehler({ serperRest: 3000 }) }))).toEqual([]);
  });

  it('ausgeschaltet → keine Guthaben-Warnung', () => {
    expect(mit(lage({ gestern: zaehler({ serperRest: 1500 }), konfig: { aktiv: false } }))).toEqual([]);
  });

  it('viele Fremddienst-Fehler → gelb, mehr als die Hälfte → rot', () => {
    expect(mit(lage({ gestern: zaehler({ gefunden: 40, keineDaten: 40, fehler: 30 }) }))).toEqual(['gelb:produktsuche_fehler']);
    expect(mit(lage({ gestern: zaehler({ gefunden: 10, keineDaten: 10, fehler: 30 }) }))).toEqual(['rot:produktsuche_fehler']);
    // wenige Fehler absolut → keine Warnung, auch bei hoher Quote
    expect(mit(lage({ gestern: zaehler({ gefunden: 3, keineDaten: 3, fehler: 4 }) }))).toEqual([]);
  });

  it('nur „ohne Daten", kein Treffer → rot (Handschrift des Vorfalls vom August)', () => {
    expect(mit(lage({ gestern: zaehler({ gefunden: 0, keineDaten: 25, fehler: 0 }) }))).toEqual(['rot:produktsuche_findet_nichts']);
    expect(mit(lage({ gestern: zaehler({ gefunden: 0, keineDaten: 19, fehler: 0 }) }))).toEqual([]);
  });

  it('Stau oben in der Reihenfolge ab sechs Läufen → gelb', () => {
    expect(mit(lage({ gestern: zaehler({ kandidatenKnapp: 6 }) }))).toEqual(['gelb:produktsuche_stau']);
    expect(mit(lage({ gestern: zaehler({ kandidatenKnapp: 5 }) }))).toEqual([]);
  });

  it('eingeschaltet, Barcodes warten, aber weder gestern noch heute ein Lauf → rot', () => {
    expect(mit(lage({ gestern: null }))).toEqual(['rot:produktsuche_still']);
    // heute läuft er schon wieder (z. B. erster Tag nach dem Ausrollen) → keine Warnung
    expect(mit(lage({ gestern: null, heute: { bearbeitet: 2 } }))).toEqual([]);
    // nichts wartet, bewusst pausiert oder ausgeschaltet → keine Warnung
    expect(mit(lage({ gestern: null, wartend: 0 }))).toEqual([]);
    expect(mit(lage({ gestern: null, konfig: { proLauf: 0 } }))).toEqual([]);
    expect(mit(lage({ gestern: null, konfig: { aktiv: false } }))).toEqual([]);
  });
});

describe('Produktsuche — Halte-Codes des Prozessors', () => {
  const { produktsucheLage } = require('../src/produktsuche');
  const lage = (angehalten, konfig = null) => produktsucheLage({ jetzt: JETZT, gesternRoh: { bearbeitet: 50, gefunden: 25, keineDaten: 25, serperRest: 9000, angehalten }, heuteRoh: null, konfigRoh: konfig, wartend: 100 });
  const mit = (p) => warnungen(basis({ produktsuche: p }));

  it('Serper-Guthaben nicht abrufbar → rot, eigener Text', () => {
    const w = mit(lage('serper_guthaben_unbekannt'));
    expect(codes(w)).toEqual(['rot:produktsuche_angehalten']);
    expect(w[0].text).toMatch(/nicht abfragen/);
  });

  it('bewusst ausgeschaltet („aus") → keine Warnung', () => {
    expect(mit(lage('aus', { aktiv: false }))).toEqual([]);
  });

  it('Pause nach Dienstausfall → rot, eigener Text; Zeile im Bericht lesbar', () => {
    const p = lage('dienst_ausfall');
    const w = mit(p);
    expect(codes(w)).toEqual(['rot:produktsuche_angehalten']);
    expect(w[0].text).toMatch(/pausiert/);
    expect(p.zeile).toContain('Dienst ausgefallen');
  });

  it('ungültiger Wert in _meta/produktsuche → rot mit dem Feld, sofort (ohne Lauf des Prozessors)', () => {
    const p = lage(null, { tagesDeckel: 'zwanzig' });
    const w = mit(p);
    expect(codes(w)).toEqual(['rot:produktsuche_angehalten']);
    expect(w[0].text).toMatch(/ungültiger Wert \(tagesDeckel\)/);
    expect(p.zustand).toMatch(/^angehalten: ungültiger Wert/);
    // Ziffern als Text sind gültig → keine Warnung
    expect(mit(lage(null, { tagesDeckel: '20' }))).toEqual([]);
  });

  it('unbekannter Code → rot mit dem Code', () => {
    const w = mit(lage('irgendwas_neues'));
    expect(codes(w)).toEqual(['rot:produktsuche_angehalten']);
    expect(w[0].text).toContain('irgendwas_neues');
  });
});
