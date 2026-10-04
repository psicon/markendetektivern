/**
 * Katalog-Prüfung (lib/katalog.js) und Konfiguration (lib/konfiguration.js).
 *
 * @jest-environment node
 */

'use strict';

const { eanVarianten, abfrageWerte, istImKatalog, EINZELFELDER, LISTENFELDER } = require('../lib/katalog');
const { STANDARD, mitStandard, ladeKonfiguration, shopBildSchalter, _zuruecksetzen } = require('../lib/konfiguration');

describe('eanVarianten', () => {
  test('EAN-13 → auch 14-stellig mit führender Null', () => {
    expect(eanVarianten('4001234567890').sort()).toEqual(['04001234567890', '4001234567890']);
  });

  test('UPC-A (12) → 12, 13, 14 Stellen', () => {
    expect(eanVarianten('012345678905').sort()).toEqual(['00012345678905', '0012345678905', '012345678905', '12345678905'].sort());
  });

  test('EAN-8 → alle Längen 8–14', () => {
    const v = eanVarianten('20003180');
    expect(v).toContain('20003180');
    expect(v).toContain('0000020003180');
    expect(v).toContain('00000020003180');
    expect(v).toHaveLength(7);
  });

  test('Nicht-Ziffern werden entfernt; leer → []', () => {
    expect(eanVarianten(' 4001234-567890 ')).toContain('4001234567890');
    expect(eanVarianten('')).toEqual([]);
    expect(eanVarianten(null)).toEqual([]);
  });

  test('abfrageWerte: Schreibweisen + Zahl, höchstens 30', () => {
    const w = abfrageWerte('20003180');
    expect(w).toContain(20003180);
    expect(w.length).toBeLessThanOrEqual(30);
  });
});

describe('istImKatalog', () => {
  function fakeDb(treffer = {}) {
    const abfragen = [];
    return {
      abfragen,
      collection: (sammlung) => ({
        where: (feld, op, werte) => ({
          limit: () => ({
            select: () => ({
              get: async () => {
                abfragen.push({ sammlung, feld, op, werte });
                if (treffer.fehler) throw new Error('unavailable');
                return { empty: !(treffer[`${sammlung}.${feld}`]) };
              },
            }),
          }),
        }),
      }),
    };
  }

  test('prüft alle Felder in beiden Sammlungen mit passenden Operatoren', async () => {
    const db = fakeDb();
    expect(await istImKatalog(db, '4001234567890')).toBe(false);
    expect(db.abfragen).toHaveLength(2 * (EINZELFELDER.length + LISTENFELDER.length));
    expect(db.abfragen.filter((a) => a.feld === 'EANs')[0].op).toBe('array-contains-any');
    expect(db.abfragen.filter((a) => a.feld === 'gtin')[0].op).toBe('in');
    expect(db.abfragen.map((a) => a.feld)).toEqual(expect.arrayContaining(['moreInformation.EAN', 'eans', 'GTIN']));
  });

  test('Treffer in irgendeinem Feld → true', async () => {
    expect(await istImKatalog(fakeDb({ 'markenProdukte.eans': true }), '4001234567890')).toBe(true);
  });

  test('Lesefehler wird geworfen, nie als „nicht im Katalog" gewertet', async () => {
    await expect(istImKatalog(fakeDb({ fehler: true }), '4001234567890')).rejects.toThrow('unavailable');
  });

  test('ohne Ziffern keine Abfrage', async () => {
    const db = fakeDb();
    expect(await istImKatalog(db, '')).toBe(false);
    expect(db.abfragen).toHaveLength(0);
  });
});

describe('Konfiguration', () => {
  test('Standardwerte laut Vertrag', () => {
    expect(STANDARD).toEqual({
      aktiv: true,
      proLauf: 1,
      tagesDeckel: 120,
      auffrischenNachTagen: 60,
      serperMindestGuthaben: 1000,
      shopBilder: false,
    });
    expect(mitStandard(null)).toEqual(STANDARD);
  });

  test('gültige Werte werden übernommen, ungültige ersetzt — wie normalisiereKonfig im Prozessor', () => {
    const k = mitStandard({ auffrischenNachTagen: 30, tagesDeckel: 0, proLauf: -2, aktiv: 'ja', shopBilder: 'true' });
    expect(k.auffrischenNachTagen).toBe(30);
    expect(k.tagesDeckel).toBe(0);
    expect(k.proLauf).toBe(0); // ungültig → Halt (wie der Prozessor), nie der höhere Standard
    // Ein gesetzter Schalter, der nicht genau true ist, hält an (Prozessor: ebenso).
    expect(k.aktiv).toBe(false);
    expect(k.shopBilder).toBeNull(); // ungültig = unbekannt: weder frei noch aus
    expect(mitStandard({ shopBilder: true }).shopBilder).toBe(true);
    expect(mitStandard({ proLauf: 0 }).proLauf).toBe(0); // 0 = Pause, gültig
  });

  test('auffrischenNachTagen: nur ganze Tage ≥ 1, gekappt bei 3650', () => {
    expect(mitStandard({ auffrischenNachTagen: 0.5 }).auffrischenNachTagen).toBe(60);
    expect(mitStandard({ auffrischenNachTagen: 0 }).auffrischenNachTagen).toBe(60);
    expect(mitStandard({ auffrischenNachTagen: '30' }).auffrischenNachTagen).toBe(30); // Ziffern-Text (Console)
    expect(mitStandard({ auffrischenNachTagen: 'dreißig' }).auffrischenNachTagen).toBe(60);
    expect(mitStandard({ serperMindestGuthaben: 'x' }).serperMindestGuthaben).toBe(1_000_000);
    expect(mitStandard({ auffrischenNachTagen: 99999 }).auffrischenNachTagen).toBe(3650);
    expect(mitStandard({ tagesDeckel: 1e9 }).tagesDeckel).toBe(5000);
  });

  test('ladeKonfiguration: liest, speichert 5 Minuten zwischen; Lesefehler → Schalter und Frist unbekannt', async () => {
    _zuruecksetzen();
    let lesungen = 0;
    const db = { doc: () => ({ get: async () => { lesungen += 1; return { exists: true, data: () => ({ auffrischenNachTagen: 45 }) }; } }) };
    expect((await ladeKonfiguration(db, 0)).auffrischenNachTagen).toBe(45);
    expect((await ladeKonfiguration(db, 60_000)).auffrischenNachTagen).toBe(45);
    expect(lesungen).toBe(1);
    await ladeKonfiguration(db, 6 * 60_000);
    expect(lesungen).toBe(2);

    _zuruecksetzen();
    const warnungen = [];
    const kaputt = { doc: () => ({ get: async () => { throw new Error('weg'); } }) };
    // Schlussprüfung 04.10.2026: ein Lesefehler ist kein „aus" — shopBilder
    // false hätte gespeicherte Shopbilder gelöscht, die Frist 60 bei einer
    // längeren eingestellten Frist Fälle in die bezahlte Suche geschickt.
    expect(await ladeKonfiguration(kaputt, 0, (e) => warnungen.push(e.message))).toEqual({
      ...STANDARD,
      shopBilder: null,
      auffrischenNachTagen: null,
    });
    expect(warnungen).toEqual(['weg']);
    // nicht zwischengespeichert: der nächste Aufruf liest wieder
    expect((await ladeKonfiguration(db, 1000)).auffrischenNachTagen).toBe(45);
    _zuruecksetzen();
  });

  test('shopBildSchalter: dreiwertig, nie „unbekannt" → „aus"', () => {
    expect(shopBildSchalter({ shopBilder: true })).toBe(true);
    expect(shopBildSchalter({ shopBilder: false })).toBe(false);
    expect(shopBildSchalter({ shopBilder: null })).toBeUndefined();
    expect(shopBildSchalter({})).toBeUndefined();
    expect(shopBildSchalter(null)).toBeUndefined();
    expect(shopBildSchalter({ shopBilder: 'true' })).toBeUndefined();
  });
});
