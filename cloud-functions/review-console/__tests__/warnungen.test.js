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
