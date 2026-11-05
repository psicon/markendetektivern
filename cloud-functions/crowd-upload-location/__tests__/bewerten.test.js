'use strict';

/**
 * bewerteDokument ist die EINE Bewertung für Trigger und Backfill.
 */

const { bewerteDokument, landAusIpOrtung } = require('../src/bewerten');

const PLZ = { 'DE:46325': [51.84, 6.86, 'Borken', 'Nordrhein-Westfalen'] };
const ts = (ms) => ({ toDate: () => new Date(ms) });

describe('bewerteDokument', () => {
  test('Bon-Adresse aus dem Dokument gewinnt vor GPS, resolvedBy bleibt client', () => {
    const r = bewerteDokument({
      createdAt: ts(1000),
      marketLand: 'DE',
      capture: { gps: { lat: 51.85, lon: 6.87, accuracyM: 8, fixAt: ts(1000) } },
      priceReceipt: { zip: '46325', city: 'Borken', complete: true },
    }, {}, PLZ);
    expect(r.probableLocation.source).toBe('receipt_address');
    expect(r.resolvedBy).toBe('client');
  });

  test('Nachträge der Anlage (EXIF, IP) werden aus dem Dokument gelesen, wenn kein Zusatz kommt', () => {
    const r = bewerteDokument({
      createdAt: ts(1000),
      marketLand: 'DE',
      exifGps: { lat: 51.84, lon: 6.86, accuracyM: 30, ageMinutes: 2 },
    }, {}, PLZ);
    expect(r.probableLocation.source).toBe('exif_gps');
    expect(r.resolvedBy).toBe('server');
  });

  test('ohne irgendetwas: Marktland, kein Absturz', () => {
    const r = bewerteDokument({ marketLand: 'DE' }, undefined, PLZ, 5000);
    expect(r.probableLocation.source).toBe('market_country');
  });

  test('IP-Fallback (DACH-Mittelpunkt) begründet kein Land', () => {
    expect(landAusIpOrtung({ lat: 51.15, lon: 10.45 })).toBeNull();
    expect(landAusIpOrtung({ lat: null, lon: null })).toBeNull();
  });
});
