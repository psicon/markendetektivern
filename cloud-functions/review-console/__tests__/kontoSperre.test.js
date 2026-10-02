'use strict';
/**
 * Gesperrte Konten (Entscheidung Patrick 02.10.2026). Dieselbe Semantik für
 * Morgenrunde und Prüfkonsole: nur `gesperrt === true` sperrt, `false` hebt
 * auf, alles Unklare und jeder Lesefehler heißt „unbekannt" — keine Freigabe,
 * aber auch keine Ablehnung.
 */
jest.mock('firebase-functions/logger', () => ({ warn: () => {}, info: () => {}, error: () => {} }));
const { sperreAusDaten, kontoSperreVon, ladeSperren, SPERREN } = require('../src/kontoSperre');

describe('sperreAusDaten', () => {
  it('kein Dokument → nicht gesperrt', () => {
    expect(sperreAusDaten(undefined)).toBeNull();
    expect(sperreAusDaten(null)).toBeNull();
  });
  it('gesperrt: true → gesperrt; false → aufgehoben', () => {
    expect(sperreAusDaten({ gesperrt: true, grund: 'x', quelle: 'Entscheidung Patrick 02.10.2026' })).toBe('gesperrt');
    expect(sperreAusDaten({ gesperrt: false })).toBeNull();
  });
  it('unklarer Eintrag (Feld fehlt, Text statt Boolean) → unbekannt', () => {
    expect(sperreAusDaten({})).toBe('unbekannt');
    expect(sperreAusDaten({ gesperrt: 'ja' })).toBe('unbekannt');
  });
});

describe('kontoSperreVon', () => {
  const liste = new Map([['a', { gesperrt: true }], ['b', { gesperrt: false }]]);
  it('liest aus der geladenen Liste', () => {
    expect(kontoSperreVon(liste, 'a')).toBe('gesperrt');
    expect(kontoSperreVon(liste, 'b')).toBeNull();
    expect(kontoSperreVon(liste, 'c')).toBeNull();
  });
  it('Liste nicht lesbar → unbekannt für jeden; ohne uid → nicht gesperrt', () => {
    expect(kontoSperreVon(null, 'c')).toBe('unbekannt');
    expect(kontoSperreVon(liste, null)).toBeNull();
  });
});

describe('ladeSperren', () => {
  it('liest die Collection cashback_sperren als Map', async () => {
    const db = { collection: (n) => ({ get: async () => { expect(n).toBe(SPERREN); return { docs: [{ id: 'a', data: () => ({ gesperrt: true }) }] }; } }) };
    expect(await ladeSperren(db)).toEqual(new Map([['a', { gesperrt: true }]]));
  });
  it('Lesefehler → null (der Aufrufer gibt dann nichts frei)', async () => {
    const db = { collection: () => ({ get: async () => { throw new Error('UNAVAILABLE'); } }) };
    expect(await ladeSperren(db)).toBeNull();
  });
});
