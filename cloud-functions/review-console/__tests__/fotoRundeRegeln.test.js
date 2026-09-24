'use strict';
/**
 * Regeln der Morgenrunde. Jeder Fall hier ist einer, der in den Handrunden
 * 09.–24.09.2026 vorkam und dort von Hand entschieden werden musste.
 */
const { entscheideFall, notbremse } = require('../src/fotoRundeRegeln');

const ok = { ok: true, problems: [], missing: [] };
const echt = { echt: true, loseWare: false, gleicheAnsicht: false, grund: '' };
const fall = (over = {}) => ({ comp: ok, dup: { verdict: 'ok', reason: null, lockUntil: null }, leer: [], unlesbar: [], wiederverwendet: false, audit: echt, auditFehler: null, rettungFehler: {}, ...over });

describe('entscheideFall', () => {
  it('alles sauber → freigeben', () => {
    expect(entscheideFall(fall()).entscheidung).toBe('freigeben');
  });

  it('Storage nicht lesbar → offen, NIE ablehnen (unsere Technik)', () => {
    const e = entscheideFall(fall({ unlesbar: ['front'], comp: { ok: false, problems: ['unvollstaendig'], missing: ['front'] } }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'bild_nicht_lesbar_infrastruktur' });
  });

  it('fehlende Pflichtfotos → ablehnen unvollstaendig mit Liste', () => {
    const e = entscheideFall(fall({ comp: { ok: false, problems: ['unvollstaendig'], missing: ['preis'] } }));
    expect(e).toMatchObject({ entscheidung: 'ablehnen', grund: 'unvollstaendig', ctx: { missing: ['preis'] } });
  });

  it('leere Datei (0 Byte) → ablehnen unvollstaendig', () => {
    expect(entscheideFall(fall({ leer: ['zutaten'] }))).toMatchObject({ entscheidung: 'ablehnen', grund: 'unvollstaendig' });
  });

  it('eigenes Doppel binnen 24 h → ablehnen mit Sperrfrist', () => {
    const e = entscheideFall(fall({ dup: { verdict: 'locked', reason: 'sperre_30_tage_gleicher_nutzer', lockUntil: 123 } }));
    expect(e).toMatchObject({ entscheidung: 'ablehnen', grund: 'sperre_30_tage_gleicher_nutzer', ctx: { lockUntil: 123 } });
  });

  it('ältere eigene Einreichung noch offen → offen', () => {
    expect(entscheideFall(fall({ dup: { verdict: 'hold', reason: 'doppelt_eingereicht' } })).entscheidung).toBe('offen');
  });

  it('Bild aus früherer Einreichung → ablehnen', () => {
    expect(entscheideFall(fall({ wiederverwendet: true })).grund).toBe('bilder_wiederverwendet');
  });

  it('kein Name nach Nachlesen → ablehnen; Nachlesen am Limit gescheitert → offen', () => {
    const comp = { ok: false, problems: ['kein_produktname'], missing: [] };
    expect(entscheideFall(fall({ comp })).grund).toBe('kein_produktname');
    expect(entscheideFall(fall({ comp, rettungFehler: { name: '429' } })).entscheidung).toBe('offen');
  });

  it('lose Ware ohne Barcode wird ANGENOMMEN (Entscheidung 20.09.)', () => {
    const comp = { ok: false, problems: ['ean_fehlt'], missing: [] };
    const e = entscheideFall(fall({ comp, audit: { ...echt, loseWare: true } }));
    expect(e).toMatchObject({ entscheidung: 'freigeben', loseWare: true });
  });

  it('verpackte Ware ohne Barcode → ablehnen ean_fehlt; ohne Bildprüfung → offen', () => {
    const comp = { ok: false, problems: ['ean_fehlt'], missing: [] };
    expect(entscheideFall(fall({ comp })).grund).toBe('ean_fehlt');
    expect(entscheideFall(fall({ comp, audit: null, auditFehler: '429' })).entscheidung).toBe('offen');
    expect(entscheideFall(fall({ comp, rettungFehler: { ean: '500' } })).entscheidung).toBe('offen');
  });

  it('Bildprüfung gescheitert → offen, NIE freigeben', () => {
    const e = entscheideFall(fall({ audit: null, auditFehler: 'RESOURCE_EXHAUSTED' }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'bild_audit_gescheitert' });
  });

  it('abgeschnittene Datei (Bild nicht lesbar) → offen als bild_defekt', () => {
    const e = entscheideFall(fall({ audit: null, auditFehler: 'Failed to decode image data' }));
    expect(e).toMatchObject({ entscheidung: 'offen', grund: 'bild_defekt' });
  });

  it('fünfmal dieselbe Ansicht → ablehnen gleiche_ansicht_mehrfach (Quark 24.09.)', () => {
    expect(entscheideFall(fall({ audit: { ...echt, gleicheAnsicht: true } })).grund).toBe('gleiche_ansicht_mehrfach');
  });

  it('unecht → ablehnen fotos_unpassend', () => {
    expect(entscheideFall(fall({ audit: { ...echt, echt: false, grund: 'Bildschirmfoto' } })).grund).toBe('fotos_unpassend');
  });
});

describe('notbremse', () => {
  const plan = (freigaben, bildAbgelehnt, sonstAbgelehnt = 0) => [
    ...Array.from({ length: freigaben }, () => ({ entscheidung: 'freigeben', grund: null, audit: echt })),
    ...Array.from({ length: bildAbgelehnt }, () => ({ entscheidung: 'ablehnen', grund: 'fotos_unpassend', audit: { ...echt, echt: false } })),
    ...Array.from({ length: sonstAbgelehnt }, () => ({ entscheidung: 'ablehnen', grund: 'unvollstaendig', audit: null })),
  ];

  it('normaler Tag (2 von 231 unpassend, wie am 24.09.) → keine Bremse', () => {
    const p = plan(229, 2);
    const b = notbremse(p, { schnittQuote: 0.05 });
    expect(b).toMatchObject({ bild: false, gesamt: false });
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(2);
  });

  it('Bildprüfung kippt (15 von 60) → deren Ablehnungen bleiben offen, Freigaben laufen', () => {
    const p = plan(45, 15);
    const b = notbremse(p, { schnittQuote: null });
    expect(b.bild).toBe(true);
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(0);
    expect(p.filter((x) => x.entscheidung === 'freigeben')).toHaveLength(45);
    expect(p.find((x) => x.grund === 'notbremse_bildpruefung').zurueckgehaltenGrund).toBe('fotos_unpassend');
  });

  it('Gesamtquote über dem Doppelten des Schnitts → alle Ablehnungen zurückgehalten', () => {
    const p = plan(40, 0, 20);
    const b = notbremse(p, { schnittQuote: 0.1 });
    expect(b.gesamt).toBe(true);
    expect(p.filter((x) => x.entscheidung === 'ablehnen')).toHaveLength(0);
  });

  it('wenige Ablehnungen lösen nie aus', () => {
    const p = plan(3, 0, 4);
    expect(notbremse(p, { schnittQuote: 0.01 }).gesamt).toBe(false);
  });
});

describe('Nachlese-Fehler sind kein Urteil (Gegenprüfung 24.09.)', () => {
  it('Speichern der Nachlesung gescheitert → kein Name führt NICHT zur Ablehnung', () => {
    const comp = { ok: false, problems: ['kein_produktname'], missing: [] };
    expect(entscheideFall(fall({ comp, rettungFehler: { alles: 'UNAVAILABLE' } })).entscheidung).toBe('offen');
  });
  it('dasselbe für den Barcode', () => {
    const comp = { ok: false, problems: ['ean_fehlt'], missing: [] };
    expect(entscheideFall(fall({ comp, rettungFehler: { alles: 'DEADLINE_EXCEEDED' } })).entscheidung).toBe('offen');
  });
  it('Sperre hängt am fehlenden Preis und das Preis-Nachlesen scheiterte → offen', () => {
    const dup = { verdict: 'locked', reason: 'sperre_30_tage_gleicher_nutzer', lockUntil: 1 };
    expect(entscheideFall(fall({ dup, preisFehlt: true, rettungFehler: { preis: '429' } })).entscheidung).toBe('offen');
    expect(entscheideFall(fall({ dup, preisFehlt: true })).entscheidung).toBe('ablehnen');
    expect(entscheideFall(fall({ dup, preisFehlt: false, rettungFehler: { preis: '429' } })).entscheidung).toBe('ablehnen');
  });
});
