'use strict';

/**
 * ploc-v2 (Entscheidung Patrick, 24.09.2026): Filialadresse vom Kassenbon auf
 * dem Preisfoto ist Ortsquelle Nr. 1 — vor GPS, Ortsangabe und IP.
 */

const { bewerteLocation, PRECEDENCE, MODEL_VERSION } = require('../src/scorer');
const { bonAdresseAusDoc, bonAdresseGeaendert } = require('../src/bonAdresse');

const PLZ = { 'DE:46325': [51.84, 6.86, 'Borken', 'Nordrhein-Westfalen'], 'AT:1010': [48.21, 16.37, 'Wien', 'Wien'] };
const bon = (extra = {}) => ({ priceReceipt: { zip: '46325', city: 'Borken', street: 'Otto-Hahn-Str. 18', complete: true, ...extra } });

describe('Rangfolge', () => {
  test('Bon-Adresse steht ganz oben, Modellversion ploc-v2', () => {
    expect(PRECEDENCE[0]).toBe('receipt_address');
    expect(PRECEDENCE.indexOf('receipt_address')).toBeLessThan(PRECEDENCE.indexOf('gps_capture'));
    expect(MODEL_VERSION).toBe('ploc-v2');
  });

  test('Bon schlägt GPS und Ortsangabe', () => {
    const r = bewerteLocation({
      submittedAtMs: 0,
      receiptAddress: bonAdresseAusDoc(bon(), PLZ),
      captureGps: { lat: 51.85, lon: 6.87, accuracyM: 10, ageMinutes: 0 },
      confirmedPlace: { city: 'Köln' },
      marketLand: 'DE',
    });
    expect(r.source).toBe('receipt_address');
    expect(r.city).toBe('Borken');
    expect(r.confidence).toBe('high');
    // PLZ-Mittelpunkt (~2 km): ehrlich „Stadt", nie „Punkt"
    expect(r.granularity).toBe('city');
    expect(r.usableFor).toEqual(expect.arrayContaining(['country', 'city', 'region']));
    expect(r.usableFor).not.toContain('point');
    expect(r.usableFor).not.toContain('store');
    // GPS in 1 km Abstand bestätigt
    expect(r.agreement).toBe('corroborated');
  });

  test('GPS 300 km entfernt senkt die Sicherheit (Widerspruch sichtbar)', () => {
    const r = bewerteLocation({
      submittedAtMs: 0,
      receiptAddress: bonAdresseAusDoc(bon(), PLZ),
      captureGps: { lat: 48.14, lon: 11.58, accuracyM: 10, ageMinutes: 0 },
      marketLand: 'DE',
    });
    expect(r.source).toBe('receipt_address');
    expect(r.agreement).toBe('conflicting');
    expect(r.confidence).toBe('medium');
  });

  test('Postleitzahl nicht in der Tabelle: Ortsname bleibt, Sicherheit mittel, keine Koordinate', () => {
    const r = bewerteLocation({ submittedAtMs: 0, receiptAddress: bonAdresseAusDoc(bon({ zip: '99999', city: 'Nirgendwo' }), PLZ), marketLand: 'DE' });
    expect(r.source).toBe('receipt_address');
    expect(r.city).toBe('Nirgendwo');
    expect(r.lat).toBeNull();
    expect(r.confidence).toBe('medium');
  });

  test('ohne Bon unverändert: GPS gewinnt', () => {
    const r = bewerteLocation({ submittedAtMs: 0, captureGps: { lat: 51.85, lon: 6.87, accuracyM: 10, ageMinutes: 0 }, marketLand: 'DE' });
    expect(r.source).toBe('gps_capture');
  });
});

describe('bonAdresseAusDoc', () => {
  test('nur vollständige Adressen (PLZ und Ort) — dieselbe Schwelle wie die Vergütungsregel', () => {
    expect(bonAdresseAusDoc(bon(), PLZ)).toEqual({ zip: '46325', city: 'Borken', lat: 51.84, lon: 6.86, land: 'DE', bundesland: 'Nordrhein-Westfalen' });
    expect(bonAdresseAusDoc(bon({ complete: false }), PLZ)).toBeNull();
    expect(bonAdresseAusDoc({ priceReceipt: { city: 'Borken', complete: true } }, PLZ)).toBeNull();
    expect(bonAdresseAusDoc({}, PLZ)).toBeNull();
    expect(bonAdresseAusDoc(null, PLZ)).toBeNull();
  });

  test('vierstellige PLZ = Österreich', () => {
    expect(bonAdresseAusDoc({ priceReceipt: { zip: '1010', city: 'Wien', complete: true } }, PLZ)).toMatchObject({ land: 'AT', lat: 48.21 });
  });

  test('Änderung erkennen — und nur dann neu bewerten', () => {
    expect(bonAdresseGeaendert({}, bon())).toBe(true);
    expect(bonAdresseGeaendert(bon(), bon())).toBe(false);
    expect(bonAdresseGeaendert(bon(), { ...bon(), probableLocation: { source: 'x' } })).toBe(false);
    expect(bonAdresseGeaendert(bon(), bon({ zip: '46326' }))).toBe(true);
  });
});
