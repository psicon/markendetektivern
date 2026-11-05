'use strict';

/**
 * Konfiguration `_meta/produktsuche` (src/konfig.js): Standardwerte,
 * Prüfung, Grenzen, Kalendertag Europe/Berlin.
 */

const {
  STANDARD, GRENZEN, normalisiereKonfig, berlinTag, tagPfad, KONFIG_PFAD,
} = require('../src/konfig');

describe('normalisiereKonfig', () => {
  it('ohne Dokument gelten die Standardwerte des Vertrags', () => {
    expect(normalisiereKonfig(undefined)).toEqual({
      konfig: {
        aktiv: true, proLauf: 1, tagesDeckel: 120, auffrischenNachTagen: 60, serperMindestGuthaben: 1000, shopBilder: false, ungueltig: [],
      },
      warnungen: [],
    });
    expect(normalisiereKonfig(null).konfig).toEqual({ ...STANDARD, ungueltig: [] });
  });

  it('übernimmt gültige Werte', () => {
    const { konfig, warnungen } = normalisiereKonfig({
      aktiv: true, proLauf: 10, tagesDeckel: 1500, auffrischenNachTagen: 30, serperMindestGuthaben: 500, shopBilder: true,
    });
    expect(konfig).toEqual({
      aktiv: true, proLauf: 10, tagesDeckel: 1500, auffrischenNachTagen: 30, serperMindestGuthaben: 500, shopBilder: true, ungueltig: [],
    });
    expect(warnungen).toEqual([]);
  });

  it('aktiv: alles außer true hält an, sobald das Feld gesetzt ist; kein Wahrheitswert ist ungültig', () => {
    expect(normalisiereKonfig({ aktiv: false }).konfig).toMatchObject({ aktiv: false, ungueltig: [] });
    const { konfig, warnungen } = normalisiereKonfig({ aktiv: 'true' });
    expect(konfig.aktiv).toBe(false);
    expect(konfig.ungueltig).toEqual(['aktiv']);
    expect(warnungen[0]).toMatch(/aktiv/);
    expect(normalisiereKonfig({ aktiv: null }).konfig.aktiv).toBe(false);
  });

  // Prüfrunde 2: Die Firebase-Console legt neue Felder als Text an.
  it('Ziffern als Text gelten als Zahl — Senken und Anhalten wirken', () => {
    const { konfig, warnungen } = normalisiereKonfig({ proLauf: '0', tagesDeckel: '20', serperMindestGuthaben: ' 5000 ', auffrischenNachTagen: '30' });
    expect(konfig).toMatchObject({ proLauf: 0, tagesDeckel: 20, serperMindestGuthaben: 5000, auffrischenNachTagen: 30, ungueltig: [] });
    expect(warnungen).toEqual([]);
    expect(normalisiereKonfig({ tagesDeckel: '9000' }).konfig.tagesDeckel).toBe(GRENZEN.tagesDeckel);
  });

  it('ungültige Geld-Grenzen halten an (nie still der höhere Standard) — mit Warnung', () => {
    const { konfig, warnungen } = normalisiereKonfig({
      proLauf: -1, tagesDeckel: 'zwanzig', auffrischenNachTagen: 0, serperMindestGuthaben: 1.5,
    });
    expect(konfig.proLauf).toBe(0);
    expect(konfig.tagesDeckel).toBe(0);
    expect(konfig.serperMindestGuthaben).toBe(GRENZEN.serperMindestGuthaben);
    // steuert kein Geld direkt → Standard, kein Halt
    expect(konfig.auffrischenNachTagen).toBe(STANDARD.auffrischenNachTagen);
    expect(konfig.ungueltig).toEqual(['proLauf', 'tagesDeckel', 'serperMindestGuthaben']);
    expect(warnungen).toHaveLength(4);
    expect(normalisiereKonfig({ tagesDeckel: null }).konfig.ungueltig).toEqual(['tagesDeckel']);
  });

  it('proLauf 0 und tagesDeckel 0 sind erlaubt (Pause ohne aktiv anzufassen)', () => {
    const { konfig } = normalisiereKonfig({ proLauf: 0, tagesDeckel: 0 });
    expect(konfig.proLauf).toBe(0);
    expect(konfig.tagesDeckel).toBe(0);
  });

  it('Werte über der Grenze werden gekappt und gemeldet (Tippfehler am Geldweg)', () => {
    const { konfig, warnungen } = normalisiereKonfig({ tagesDeckel: 15000, proLauf: 100 });
    expect(konfig.tagesDeckel).toBe(GRENZEN.tagesDeckel);
    expect(konfig.proLauf).toBe(GRENZEN.proLauf);
    expect(warnungen.join(' ')).toMatch(/gekappt/);
  });

  it('shopBilder nur als Wahrheitswert', () => {
    expect(normalisiereKonfig({ shopBilder: 'ja' }).konfig.shopBilder).toBe(false);
  });
});

describe('berlinTag', () => {
  it('Sommerzeit: 22:30 UTC ist in Berlin schon der nächste Tag', () => {
    expect(berlinTag(Date.UTC(2026, 9, 4, 22, 30))).toBe('2026-10-05');
    expect(berlinTag(Date.UTC(2026, 9, 4, 21, 59))).toBe('2026-10-04');
  });
  it('Winterzeit: 23:30 UTC ist in Berlin der nächste Tag', () => {
    expect(berlinTag(Date.UTC(2026, 11, 31, 23, 30))).toBe('2027-01-01');
    expect(berlinTag(Date.UTC(2026, 11, 31, 22, 59))).toBe('2026-12-31');
  });
});

describe('Pfade', () => {
  it('Konfiguration und Tageszähler sind gültige Dokumentpfade (gerade Teilezahl)', () => {
    expect(KONFIG_PFAD.split('/')).toHaveLength(2);
    expect(tagPfad('2026-10-04')).toBe('_meta/produktsuche_tage/tage/2026-10-04');
    expect(tagPfad('2026-10-04').split('/')).toHaveLength(4);
  });
});
