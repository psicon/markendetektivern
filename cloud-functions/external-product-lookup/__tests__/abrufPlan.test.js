/**
 * Entscheidungstabelle der Warteschlange (lib/abrufPlan.js).
 *
 * @jest-environment node
 */

'use strict';

const {
  DOPPEL_SPERRE_MS,
  RANG_FAKTOR,
  rangFuer,
  grundAusLage,
  letzterVersuchMs,
  planeAbruf,
  lageAusProdukt,
  openfoodAuffrischenFaellig,
} = require('../lib/abrufPlan');
const { LOESCHEN } = require('../lib/speichern');

const TAG = 24 * 60 * 60 * 1000;
// 04.10.2026 12:00 UTC = 14:00 in Berlin
const JETZT = Date.parse('2026-10-04T12:00:00Z');
const ts = (ms) => ({ toMillis: () => ms });

const lage = (over = {}) => ({
  daten: 'keine',
  reweDaten: false,
  bezahlterStandMs: null,
  triedSources: ['reweapify', 'nutritionscrape', 'scraped_products', 'openfood'],
  bestSource: null,
  erzwingen: false,
  ...over,
});

const plane = (alt, l, jetztMs = JETZT) =>
  planeAbruf({ ean: '4001234567890', alt, lage: l, jetztMs, auffrischenNachTagen: 60 });

const abgeschlossen = (over = {}) => ({
  ean: '4001234567890',
  status: 'resolved',
  hitCount: 4,
  scanTage: 2,
  letzterScanTag: '2026-07-01',
  lastSeenAt: ts(JETZT - 95 * TAG),
  firstSeenAt: ts(JETZT - 100 * TAG),
  processedAt: ts(JETZT - 90 * TAG),
  rang: rangFuer(2, JETZT - 95 * TAG),
  ...over,
});

describe('Rang', () => {
  test('rang = scanTage * 1e13 + lastSeenAt', () => {
    expect(RANG_FAKTOR).toBe(1e13);
    expect(rangFuer(3, JETZT)).toBe(3e13 + JETZT);
  });

  test('mehr Scan-Tage schlagen jüngeren Scan', () => {
    expect(rangFuer(2, JETZT - 300 * TAG)).toBeGreaterThan(rangFuer(1, JETZT));
  });

  test('bei gleichen Scan-Tagen gewinnt der jüngere Scan', () => {
    expect(rangFuer(2, JETZT)).toBeGreaterThan(rangFuer(2, JETZT - 1));
  });
});

describe('kein Eintrag', () => {
  test('keine Daten → pending/neu mit allen Feldern', () => {
    const p = plane(null, lage());
    expect(p.aktion).toBe('anlegen');
    expect(p.felder).toEqual({
      ean: '4001234567890',
      status: 'pending',
      grund: 'neu',
      firstSeenAt: new Date(JETZT),
      lastSeenAt: new Date(JETZT),
      hitCount: 1,
      scanTage: 1,
      letzterScanTag: '2026-10-04',
      rang: rangFuer(1, JETZT),
      triedSources: ['reweapify', 'nutritionscrape', 'scraped_products', 'openfood'],
      bestSource: null,
    });
  });

  test('nur OpenFoodFacts → pending/nur_openfood', () => {
    const p = plane(null, lage({ daten: 'nur_openfood', bestSource: 'openfood' }));
    expect(p.felder.grund).toBe('nur_openfood');
    expect(p.felder.bestSource).toBe('openfood');
  });

  test('gute Daten, frisch → nichts (die Warteschlange bleibt eine Warteschlange)', () => {
    expect(plane(null, lage({ daten: 'vorhanden', bezahlterStandMs: JETZT - 10 * TAG })).aktion).toBe('nichts');
  });

  test('gute Daten aus der bezahlten Suche, älter als 60 Tage → pending/auffrischen', () => {
    const p = plane(null, lage({ daten: 'vorhanden', bezahlterStandMs: JETZT - 61 * TAG }));
    expect(p.aktion).toBe('anlegen');
    expect(p.felder.grund).toBe('auffrischen');
  });

  test('gute Daten ohne bekannten Stand → nichts (weder pauschal alt noch frisch)', () => {
    expect(plane(null, lage({ daten: 'vorhanden', bezahlterStandMs: null })).aktion).toBe('nichts');
  });

  test('REWE-Daten werden nie bezahlt aufgefrischt', () => {
    expect(plane(null, lage({ daten: 'vorhanden', reweDaten: true, bezahlterStandMs: JETZT - 400 * TAG })).aktion).toBe('nichts');
  });

  test('eigene Ablage nicht lesbar (unbekannt) → nichts anlegen, keine negative Speicherung', () => {
    expect(plane(null, lage({ daten: 'unbekannt' })).aktion).toBe('nichts');
  });

  test('Admin-force: auch frische und REWE-Daten → pending/auffrischen', () => {
    expect(plane(null, lage({ daten: 'vorhanden', erzwingen: true })).felder.grund).toBe('auffrischen');
    expect(plane(null, lage({ daten: 'vorhanden', reweDaten: true, erzwingen: true })).felder.grund).toBe('auffrischen');
  });
});

describe('Zählen', () => {
  const offen = (over = {}) => ({
    ean: '1',
    status: 'pending',
    grund: 'neu',
    hitCount: 2,
    scanTage: 1,
    letzterScanTag: '2026-10-03',
    lastSeenAt: ts(JETZT - TAG),
    rang: rangFuer(1, JETZT - TAG),
    ...over,
  });

  test('neuer Kalendertag → scanTage + 1, hitCount + 1, rang neu', () => {
    const p = plane(offen(), lage());
    expect(p.aktion).toBe('aktualisieren');
    expect(p.felder.hitCount).toBe(3);
    expect(p.felder.scanTage).toBe(2);
    expect(p.felder.letzterScanTag).toBe('2026-10-04');
    expect(p.felder.lastSeenAt).toEqual(new Date(JETZT));
    expect(p.felder.rang).toBe(rangFuer(2, JETZT));
  });

  test('gleicher Kalendertag → scanTage bleibt', () => {
    const p = plane(offen({ letzterScanTag: '2026-10-04', lastSeenAt: ts(JETZT - 3 * 60 * 60 * 1000) }), lage());
    expect(p.felder.scanTage).toBeUndefined();
    expect(p.felder.hitCount).toBe(3);
    expect(p.felder.rang).toBe(rangFuer(1, JETZT));
  });

  test('Kalendertag ist Berlin, nicht UTC (23:30 UTC = 01:30 Berlin am Folgetag)', () => {
    const nacht = Date.parse('2026-10-04T23:30:00Z');
    const p = plane(offen({ letzterScanTag: '2026-10-04', lastSeenAt: ts(nacht - 60 * 60 * 1000) }), lage(), nacht);
    expect(p.felder.letzterScanTag).toBe('2026-10-05');
    expect(p.felder.scanTage).toBe(2);
  });

  test('Doppelzählungs-Sperre: Scanner + Detailseite binnen 2 Minuten zählen einmal', () => {
    const p = plane(
      offen({ lastSeenAt: ts(JETZT - 1000), letzterScanTag: '2026-10-04', rang: rangFuer(1, JETZT - 1000) }),
      lage(),
    );
    expect(p.aktion).toBe('nichts');
  });

  test('Sperre endet nach 2 Minuten', () => {
    const p = plane(offen({ lastSeenAt: ts(JETZT - DOPPEL_SPERRE_MS - 1), letzterScanTag: '2026-10-04' }), lage());
    expect(p.felder.hitCount).toBe(3);
  });

  test('Altbestand ohne scanTage/letzterScanTag/rang: aus lastSeenAt abgeleitet, rang nachgetragen', () => {
    const p = plane({ ean: '1', status: 'pending', hitCount: 7, lastSeenAt: ts(JETZT - 5 * TAG) }, lage());
    expect(p.felder.scanTage).toBe(2);
    expect(p.felder.letzterScanTag).toBe('2026-10-04');
    expect(p.felder.rang).toBe(rangFuer(2, JETZT));
  });

  test('in der Sperre wird ein fehlender rang trotzdem nachgetragen', () => {
    const p = plane({ ean: '1', status: 'pending', grund: 'neu', hitCount: 1, lastSeenAt: ts(JETZT - 1000) }, lage());
    expect(p.felder).toEqual({ rang: rangFuer(1, JETZT - 1000) });
  });

  test('nichts probiert (frischer Speicher) → triedSources bleibt stehen', () => {
    const p = plane(offen({ triedSources: ['openfood'] }), lage({ daten: 'nur_openfood', triedSources: [] }));
    expect(p.felder.triedSources).toBeUndefined();
    expect(p.felder.bestSource).toBeNull();
  });

  test('Lage unbekannt (Lesefehler) → zählen, aber bestSource/triedSources nicht überschreiben', () => {
    const p = plane(offen({ bestSource: 'openfood' }), lage({ daten: 'unbekannt' }));
    expect(p.felder.hitCount).toBe(3);
    expect(p.felder.bestSource).toBeUndefined();
    expect(p.felder.triedSources).toBeUndefined();
  });
});

describe('Status-Übergänge', () => {
  test('pending bleibt pending; Grund folgt der Lage', () => {
    const p = plane({ ean: '1', status: 'pending', grund: 'neu', lastSeenAt: ts(JETZT - TAG) }, lage({ daten: 'nur_openfood' }));
    expect(p.felder.status).toBeUndefined();
    expect(p.felder.grund).toBe('nur_openfood');
  });

  test('pending/auffrischen behält seinen Grund', () => {
    const p = plane({ ean: '1', status: 'pending', grund: 'auffrischen', lastSeenAt: ts(JETZT - TAG) }, lage({ daten: 'nur_openfood' }));
    expect(p.felder.grund).toBeUndefined();
  });

  test('Altbestand pending ohne Grund bekommt einen', () => {
    const p = plane({ ean: '1', status: 'pending', lastSeenAt: ts(JETZT - TAG) }, lage());
    expect(p.felder.grund).toBe('neu');
  });

  test('processing bleibt (nur Zähler)', () => {
    const p = plane({ ean: '1', status: 'processing', lastSeenAt: ts(JETZT - TAG) }, lage());
    expect(p.felder.status).toBeUndefined();
    expect(p.felder.grund).toBeUndefined();
    expect(p.felder.hitCount).toBe(1);
  });

  test('resolved, zuletzt vor 30 Tagen bearbeitet → bleibt', () => {
    const p = plane(abgeschlossen({ processedAt: ts(JETZT - 30 * TAG) }), lage({ daten: 'vorhanden' }));
    expect(p.felder.status).toBeUndefined();
    expect(p.uebergang).toBeNull();
  });

  test('resolved, älter als 60 Tage → pending/auffrischen, wiedergeoeffnetAm', () => {
    const p = plane(abgeschlossen(), lage({ daten: 'vorhanden' }));
    expect(p.felder.status).toBe('pending');
    expect(p.felder.grund).toBe('auffrischen');
    expect(p.felder.wiedergeoeffnetAm).toEqual(new Date(JETZT));
    expect(p.uebergang).toBe('resolved→pending/auffrischen');
  });

  test('no-data älter als 60 Tage → wieder offen', () => {
    expect(plane(abgeschlossen({ status: 'no-data' }), lage()).felder.status).toBe('pending');
  });

  test('error älter als 60 Tage → wieder offen, Fehlerzählung zurückgesetzt', () => {
    const p = plane(abgeschlossen({ status: 'error', errorCount: 5, lockAt: ts(1) }), lage());
    expect(p.felder.status).toBe('pending');
    expect(p.felder.errorCount).toBe(LOESCHEN);
    expect(p.felder.lockAt).toBe(LOESCHEN);
  });

  test('error öffnet schon nach 7 Tagen wieder (Prüfrunde 04.10.2026), Wartezeit und Fehlercode weg', () => {
    const fall = (tage) => abgeschlossen({
      status: 'error', errorCount: 5, fehlerInFolge: 5, naechsterVersuchAb: ts(JETZT + TAG), letzterFehlerCode: 'fetch_unavailable',
      processedAt: ts(JETZT - tage * TAG), lastSeenAt: ts(JETZT - tage * TAG),
    });
    expect(plane(fall(6), lage()).felder.status).toBeUndefined();
    const p = plane(fall(8), lage());
    expect(p.felder.status).toBe('pending');
    for (const f of ['errorCount', 'fehlerInFolge', 'naechsterVersuchAb', 'letzterFehlerCode']) expect(p.felder[f]).toBe(LOESCHEN);
    // resolved/no-data bleiben bei 60 Tagen
    expect(plane(abgeschlossen({ processedAt: ts(JETZT - 8 * TAG), lastSeenAt: ts(JETZT - 8 * TAG) }), lage()).felder.status).toBeUndefined();
  });

  test('error AM BARCODE (alle Shopseiten gesperrt, Prüfrunde 2) öffnet erst nach der normalen Frist', () => {
    const fall = (tage, errorGrund) => abgeschlossen({
      status: 'error', errorGrund, letzterFehlerCode: 'fetch_unavailable',
      processedAt: ts(JETZT - tage * TAG), lastSeenAt: ts(JETZT - tage * TAG),
    });
    for (const g of ['abruf_gesperrt', 'am_barcode']) {
      expect(plane(fall(8, g), lage()).felder.status).toBeUndefined();
      const p = plane(fall(61, g), lage());
      expect(p.felder.status).toBe('pending');
      expect(p.felder.errorGrund).toBe(LOESCHEN);
    }
    // Fehler jeder Art in Folge (Dienstausfall): weiter nach 7 Tagen
    expect(plane(fall(8, 'in_folge'), lage()).felder.status).toBe('pending');
  });

  test('fremder Altbestand erkannt (Prüfrunde 2) → einmal sofort offen, alter „Fund" vergessen', () => {
    const fall = abgeschlossen({ processedAt: ts(JETZT - 5 * TAG), lastSeenAt: ts(JETZT - 5 * TAG), processedSource: 'gastro-direkt.de', processedResult: 'ok' });
    const p = plane(fall, lage({ altbestandAbgelehnt: true }));
    expect(p.felder).toMatchObject({ status: 'pending', grund: 'neu', processedSource: LOESCHEN, processedResult: LOESCHEN });
    expect(p.uebergang).toMatch(/fremder Altbestand/);
    // OFF-Daten blieben → nur_openfood; REWE-Daten → kein bezahltes Auffrischen
    expect(plane(fall, lage({ daten: 'nur_openfood', altbestandAbgelehnt: true })).felder.grund).toBe('nur_openfood');
    expect(plane(fall, lage({ daten: 'vorhanden', reweDaten: true, altbestandAbgelehnt: true })).felder.status).toBeUndefined();
    // processing und manuell skipped bleiben
    expect(plane(abgeschlossen({ status: 'processing' }), lage({ altbestandAbgelehnt: true })).felder.status).toBeUndefined();
    expect(plane(abgeschlossen({ status: 'skipped' }), lage({ altbestandAbgelehnt: true })).felder.status).toBeUndefined();
    // ohne Eintrag: wie sonst neu, mit Merker
    expect(plane(null, lage({ altbestandAbgelehnt: true })).felder).toMatchObject({ status: 'pending', grund: 'neu', altbestandVerworfenAm: new Date(JETZT) });
    // nur EINMAL: mit Merker gilt wieder die normale Frist (sonst bezahlte
    // Suche bei jedem Scan, solange die fremde Rohablage liegt)
    expect(plane({ ...fall, altbestandVerworfenAm: ts(JETZT - TAG) }, lage({ altbestandAbgelehnt: true })).felder.status).toBeUndefined();
  });

  test('uebersprungen/ladencode älter als 60 Tage → wieder offen (Grund entfernt)', () => {
    const p = plane(abgeschlossen({ status: 'uebersprungen', uebersprungenGrund: 'ladencode' }), lage());
    expect(p.felder.status).toBe('pending');
    expect(p.felder.uebersprungenGrund).toBe(LOESCHEN);
  });

  test.each(['im_katalog', 'ungueltige_ean'])('uebersprungen/%s wird nie wieder geöffnet', (grund) => {
    const p = plane(abgeschlossen({ status: 'uebersprungen', uebersprungenGrund: grund, processedAt: ts(JETZT - 900 * TAG) }), lage());
    expect(p.felder.status).toBeUndefined();
    const erzwungen = plane(
      abgeschlossen({ status: 'uebersprungen', uebersprungenGrund: grund }),
      lage({ erzwingen: true }),
    );
    expect(erzwungen.felder.status).toBeUndefined();
  });

  test('REWE-Daten: abgeschlossen bleibt abgeschlossen', () => {
    const p = plane(abgeschlossen(), lage({ daten: 'vorhanden', reweDaten: true }));
    expect(p.felder.status).toBeUndefined();
  });

  test('jüngster Auffrischversuch zählt (refreshVersuchtAm)', () => {
    const p = plane(abgeschlossen({ refreshVersuchtAm: ts(JETZT - 5 * TAG) }), lage({ daten: 'vorhanden' }));
    expect(p.felder.status).toBeUndefined();
  });

  test('jüngerer bezahlter Datenstand (z. B. über den Trigger) zählt', () => {
    const p = plane(abgeschlossen(), lage({ daten: 'vorhanden', bezahlterStandMs: JETZT - 3 * TAG }));
    expect(p.felder.status).toBeUndefined();
  });

  test('ohne jeden Bearbeitungszeitpunkt gilt der Fall als fällig', () => {
    const p = plane(abgeschlossen({ processedAt: undefined }), lage());
    expect(p.felder.status).toBe('pending');
  });

  test('Admin-force öffnet sofort, auch bei REWE', () => {
    const p = plane(abgeschlossen({ processedAt: ts(JETZT - TAG) }), lage({ daten: 'vorhanden', reweDaten: true, erzwingen: true }));
    expect(p.felder.status).toBe('pending');
  });

  test('Wiederöffnen wirkt auch in der Doppelzählungs-Sperre (ohne zu zählen)', () => {
    const p = plane(abgeschlossen({ lastSeenAt: ts(JETZT - 1000), letzterScanTag: '2026-10-04' }), lage());
    expect(p.felder.status).toBe('pending');
    expect(p.felder.hitCount).toBeUndefined();
  });

  test('manuell markiertes skipped bleibt unangetastet', () => {
    const p = plane(abgeschlossen({ status: 'skipped' }), lage());
    expect(p.felder.status).toBeUndefined();
  });

  test('Altbestand ohne Status → pending', () => {
    const p = plane({ ean: '1', hitCount: 1, lastSeenAt: ts(JETZT - TAG) }, lage({ daten: 'nur_openfood' }));
    expect(p.felder.status).toBe('pending');
    expect(p.felder.grund).toBe('nur_openfood');
  });
});

describe('grundAusLage / letzterVersuchMs', () => {
  test('grundAusLage', () => {
    expect(grundAusLage(lage())).toBe('neu');
    expect(grundAusLage(lage({ daten: 'nur_openfood' }))).toBe('nur_openfood');
    expect(grundAusLage(lage({ daten: 'vorhanden' }))).toBe('auffrischen');
    expect(grundAusLage(lage({ daten: 'vorhanden', reweDaten: true }))).toBeNull();
    expect(grundAusLage(lage({ daten: 'unbekannt' }))).toBeNull();
  });

  test('letzterVersuchMs = jüngster bekannter Zeitpunkt', () => {
    expect(letzterVersuchMs({ processedAt: ts(5), refreshVersuchtAm: ts(9) }, { bezahlterStandMs: 7 })).toBe(9);
    expect(letzterVersuchMs({}, { bezahlterStandMs: null })).toBeNull();
  });
});

describe('lageAusProdukt', () => {
  test('kein Produkt → keine; mit Fremddienst-Fehler → unbekannt', () => {
    expect(lageAusProdukt(null).daten).toBe('keine');
    expect(lageAusProdukt(null, { fehler: true }).daten).toBe('unbekannt');
  });

  test('nicht anzeigbares Produkt zählt als keine Daten', () => {
    expect(lageAusProdukt({ source: 'openfood', productName: 'Unbekannt' }).daten).toBe('keine');
  });

  test('OpenFoodFacts (API oder Webseite) → nur_openfood', () => {
    expect(lageAusProdukt({ source: 'openfood', productName: 'A' }).daten).toBe('nur_openfood');
    expect(lageAusProdukt({ source: 'openfoodfacts', productName: 'A' }).daten).toBe('nur_openfood');
  });

  test('Shop-Daten → vorhanden mit bezahltem Datenstand', () => {
    const l = lageAusProdukt({
      source: 'rossmann',
      productName: 'A',
      fetchedAt: ts(123),
      fetchedAtQuelle: 'nutritionscrape',
    });
    expect(l).toMatchObject({ daten: 'vorhanden', reweDaten: false, bezahlterStandMs: 123, bestSource: 'rossmann' });
  });

  test('REWE erkannt über source oder fetchedAtQuelle', () => {
    expect(lageAusProdukt({ source: 'rewe', productName: 'A' }).reweDaten).toBe(true);
    expect(lageAusProdukt({ source: 'globus', productName: 'A', fetchedAtQuelle: 'rewe_pipeline' }).reweDaten).toBe(true);
  });

  test('bezahlter Fund auf rewe.de ist keine Pipeline → wird aufgefrischt', () => {
    const l = lageAusProdukt({ source: 'rewe', productName: 'A', fetchedAt: ts(JETZT - 100 * TAG), fetchedAtQuelle: 'nutritionscrape' });
    expect(l.reweDaten).toBe(false);
    expect(l.bezahlterStandMs).toBe(JETZT - 100 * TAG);
    expect(plane(abgeschlossen({ processedAt: ts(JETZT - 100 * TAG) }), l).felder).toMatchObject({ status: 'pending', grund: 'auffrischen' });
  });

  test('OFF-Datenstand ist kein bezahlter Stand', () => {
    expect(lageAusProdukt({ source: 'openfood', productName: 'A', fetchedAt: ts(5), fetchedAtQuelle: 'openfood_api' }).bezahlterStandMs).toBeNull();
  });
});

describe('openfoodAuffrischenFaellig', () => {
  const off = (over = {}) => ({ source: 'openfood', productName: 'A', fetchedAt: ts(JETZT - 61 * TAG), ...over });

  test('OFF-Stand älter als 60 Tage, noch kein Versuch → fällig', () => {
    expect(openfoodAuffrischenFaellig(off(), JETZT, 60)).toBe(true);
  });

  test('frischer Stand → nicht fällig', () => {
    expect(openfoodAuffrischenFaellig(off({ fetchedAt: ts(JETZT - 10 * TAG) }), JETZT, 60)).toBe(false);
  });

  test('höchstens einmal je Frist (openfoodVersuchtAm)', () => {
    expect(openfoodAuffrischenFaellig(off({ openfoodVersuchtAm: ts(JETZT - 5 * TAG) }), JETZT, 60)).toBe(false);
    expect(openfoodAuffrischenFaellig(off({ openfoodVersuchtAm: ts(JETZT - 61 * TAG) }), JETZT, 60)).toBe(true);
  });

  test('Altbestand ohne fetchedAt: cachedAt (= Abrufzeit bei reinen OFF-Dokumenten)', () => {
    expect(openfoodAuffrischenFaellig(off({ fetchedAt: undefined, cachedAt: ts(JETZT - 70 * TAG) }), JETZT, 60)).toBe(true);
    expect(openfoodAuffrischenFaellig(off({ fetchedAt: undefined, cachedAt: ts(JETZT - 7 * TAG) }), JETZT, 60)).toBe(false);
  });

  test('nur für OpenFoodFacts-Dokumente', () => {
    expect(openfoodAuffrischenFaellig(off({ source: 'rewe' }), JETZT, 60)).toBe(false);
    expect(openfoodAuffrischenFaellig(null, JETZT, 60)).toBe(false);
  });

  test('Frist kommt aus der Konfiguration', () => {
    expect(openfoodAuffrischenFaellig(off({ fetchedAt: ts(JETZT - 31 * TAG) }), JETZT, 30)).toBe(true);
  });

  test('Daten der OFF-Webseite, nie gegen die API geprüft → sofort fällig (Prüfrunde 2), danach normal', () => {
    const web = (over = {}) => ({ source: 'openfoodfacts', attr_ingredientStatement: 'X', fetchedAt: ts(JETZT - TAG), ...over });
    expect(openfoodAuffrischenFaellig(web(), JETZT, 60)).toBe(true);
    expect(openfoodAuffrischenFaellig(web({ openfoodVersuchtAm: ts(JETZT - TAG) }), JETZT, 60)).toBe(false);
    // auch unter einer Shop-Quelle, wenn eine Gruppe von der Webseite stammt
    expect(openfoodAuffrischenFaellig({ source: 'globus', attr_ingredientStatement: 'X', feldQuellen: { zutaten: 'openfoodfacts' } }, JETZT, 60)).toBe(true);
  });
});
