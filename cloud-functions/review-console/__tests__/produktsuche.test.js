'use strict';
/**
 * Zeile „Produktsuche" im Tagesbericht (src/produktsuche.js): Zusammenfassung
 * der Tageszähler und Laden ohne Absturz. Die Warnungen dazu prüft
 * __tests__/warnungen.test.js, die Verdrahtung in der Morgenrunde
 * __tests__/taeglicheRunde.test.js.
 */
const { produktsucheLage, ladeProduktsuche, konfigAus, tagesZahlen, TAGE_SAMMLUNG, KONFIG_PFAD } = require('../src/produktsuche');

const JETZT = Date.UTC(2026, 9, 5, 6, 0, 0); // 05.10.2026 08:00 Berlin
const tag = (over) => ({ bearbeitet: 120, gefunden: 58, keineDaten: 50, fehler: 2, uebersprungen: 10, serperRest: 9000, angehalten: null, kostenSchaetzungUsd: 1.92, ...over });

describe('konfigAus — wie normalisiereKonfig im Prozessor', () => {
  it('fehlendes Dokument → Standardwerte', () => {
    expect(konfigAus(null)).toEqual({ aktiv: true, proLauf: 1, tagesDeckel: 120, serperMindestGuthaben: 1000, ungueltig: [] });
  });
  it('aktiv hält an, sobald gesetzt und nicht true (auch Tippfehler)', () => {
    expect(konfigAus({ aktiv: false }).aktiv).toBe(false);
    expect(konfigAus({ aktiv: 'ja' }).aktiv).toBe(false);
    expect(konfigAus({ aktiv: true }).aktiv).toBe(true);
  });
  // Prüfrunde 2: Die Firebase-Console legt neue Felder als Text an — ein
  // bewusstes Senken darf nicht still am höheren Standard scheitern.
  it('Ziffern als Text gelten als Zahl; 0 bleibt 0 (bewusst pausiert)', () => {
    expect(konfigAus({ proLauf: '0', tagesDeckel: '20', serperMindestGuthaben: '500' })).toEqual({ aktiv: true, proLauf: 0, tagesDeckel: 20, serperMindestGuthaben: 500, ungueltig: [] });
    expect(konfigAus({ proLauf: 0 }).proLauf).toBe(0);
  });
  it('ungültige Werte → Halte-Werte und als ungültig gemeldet (wie der Prozessor)', () => {
    expect(konfigAus({ proLauf: -1, tagesDeckel: 2.5, serperMindestGuthaben: 'viel', aktiv: 'ja' })).toEqual({
      aktiv: false, proLauf: 0, tagesDeckel: 0, serperMindestGuthaben: 1_000_000, ungueltig: ['aktiv', 'proLauf', 'tagesDeckel', 'serperMindestGuthaben'],
    });
  });
  it('über der Obergrenze → gekappt wie im Prozessor', () => {
    expect(konfigAus({ tagesDeckel: 9000, proLauf: 50 })).toMatchObject({ tagesDeckel: 5000, proLauf: 20 });
  });
});

describe('tagesZahlen', () => {
  it('kein Zähler → null; fehlende Felder → 0, Guthaben/Kosten → null', () => {
    expect(tagesZahlen(null)).toBeNull();
    expect(tagesZahlen({ gefunden: 3 })).toEqual({ bearbeitet: 0, gefunden: 3, keineDaten: 0, fehler: 0, uebersprungen: 0, serperRest: null, angehalten: null, kostenSchaetzungUsd: null, kandidatenKnapp: 0 });
  });
});

describe('produktsucheLage', () => {
  it('ruhiger Tag → Vortag als Zeile, Guthaben vom neuesten Lauf', () => {
    const l = produktsucheLage({ jetzt: JETZT, gesternRoh: tag(), heuteRoh: tag({ bearbeitet: 40, serperRest: 8900 }), konfigRoh: null, wartend: 18000 });
    expect(l).toMatchObject({ tag: '2026-10-04', serperRest: 8900, angehalten: null, aktiv: true, pausiert: false, wartend: 18000, unlesbar: false });
    expect(l.gestern.bearbeitet).toBe(120);
    expect(l.zeile).toBe('Produktsuche gestern: 120 bearbeitet, 58 gefunden, 50 ohne Daten, 10 übersprungen, 2 Fehler · ≈ 1,92 $ · Serper-Rest 8.900');
  });

  it('heute noch kein Lauf → Guthaben und Anhalte-Grund vom Vortag', () => {
    const l = produktsucheLage({ jetzt: JETZT, gesternRoh: tag({ serperRest: 950, angehalten: 'serper_guthaben' }), heuteRoh: null, konfigRoh: {} });
    expect(l).toMatchObject({ serperRest: 950, angehalten: 'serper_guthaben' });
    expect(l.zeile).toContain('angehalten: Serper-Guthaben unter der Mindestgrenze');
  });

  it('heutiger Lauf ohne Kontoabfrage erbt das Guthaben, aber nicht den alten Anhalte-Grund', () => {
    const l = produktsucheLage({ jetzt: JETZT, gesternRoh: tag({ serperRest: 950, angehalten: 'serper_guthaben' }), heuteRoh: { bearbeitet: 3 }, konfigRoh: {} });
    expect(l).toMatchObject({ serperRest: 950, angehalten: null });
  });

  it('nicht gelaufen und ausgeschaltet → beides in der Zeile', () => {
    const l = produktsucheLage({ jetzt: JETZT, gesternRoh: null, heuteRoh: null, konfigRoh: { aktiv: false } });
    expect(l.zeile).toBe('Produktsuche gestern: ausgeschaltet · keine Zahlen (nicht gelaufen)');
    expect(l.aktiv).toBe(false);
  });

  it('proLauf oder tagesDeckel 0 → pausiert', () => {
    expect(produktsucheLage({ jetzt: JETZT, gesternRoh: null, heuteRoh: null, konfigRoh: { tagesDeckel: 0 } }).pausiert).toBe(true);
  });

  it('Vortag über die Zeitumstellung (Ende Sommerzeit 25.10.) bleibt der Kalendertag davor', () => {
    const l = produktsucheLage({ jetzt: Date.UTC(2026, 9, 26, 7, 0, 0), gesternRoh: null, heuteRoh: null, konfigRoh: null });
    expect(l.tag).toBe('2026-10-25');
  });
});

describe('ladeProduktsuche', () => {
  function fakeDb(dokumente, { wartend = 0, fehler = null } = {}) {
    const gelesen = [];
    return {
      gelesen,
      doc: (pfad) => ({ get: async () => {
        gelesen.push(pfad);
        if (fehler) throw fehler;
        const d = dokumente[pfad];
        return { exists: d !== undefined, data: () => d };
      } }),
      collection: (name) => ({ where: (f, op, v) => ({ count: () => ({ get: async () => {
        gelesen.push(`${name}?${f}${op}${v}`);
        return { data: () => ({ count: wartend }) };
      } }) }) }),
    };
  }

  it('liest Vortag, heute, Schalter und die wartenden Barcodes', async () => {
    const db = fakeDb({ [`${TAGE_SAMMLUNG}/2026-10-04`]: tag(), [KONFIG_PFAD]: { serperMindestGuthaben: 2000 } }, { wartend: 17 });
    const l = await ladeProduktsuche(db, JETZT);
    expect(db.gelesen.sort()).toEqual([
      '_meta/produktsuche',
      '_meta/produktsuche_tage/tage/2026-10-04',
      '_meta/produktsuche_tage/tage/2026-10-05',
      'external_lookup_misses?status==pending',
    ]);
    expect(l).toMatchObject({ wartend: 17, serperMindestGuthaben: 2000, heute: null, unlesbar: false });
  });

  it('Lesefehler → unlesbar, wirft nicht, meldet im Log', async () => {
    const warn = [];
    const l = await ladeProduktsuche(fakeDb({}, { fehler: new Error('UNAVAILABLE') }), JETZT, { warn: (...a) => warn.push(a) });
    expect(l).toEqual({ unlesbar: true, zeile: 'Produktsuche: Zahlen nicht lesbar' });
    expect(warn).toHaveLength(1);
  });
});

describe('zustand (Klartext fürs Dashboard)', () => {
  const z = (konfigRoh, gesternRoh = null) => produktsucheLage({ jetzt: JETZT, gesternRoh, heuteRoh: null, konfigRoh }).zustand;
  it('läuft / ausgeschaltet / pausiert / angehalten — Tagesdeckel zählt als läuft', () => {
    expect(z(null)).toBe('läuft');
    expect(z({ aktiv: false })).toBe('ausgeschaltet');
    expect(z({ proLauf: 0 })).toBe('pausiert (proLauf oder tagesDeckel 0)');
    expect(z(null, tag({ angehalten: 'serper_guthaben' }))).toBe('angehalten: Serper-Guthaben unter der Mindestgrenze');
    expect(z(null, tag({ angehalten: 'neuer_grund' }))).toBe('angehalten: neuer_grund');
    expect(z(null, tag({ angehalten: 'tagesdeckel' }))).toBe('läuft');
  });
});
