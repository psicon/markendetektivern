'use strict';

/** Jahres-Fehllesung des Bon-Datums (86cb9zuq1, erweitert 11.10.2026). */
const { plausibilizeBonDate } = require('../lib/bonDatum');

const up = new Date('2026-10-11T06:32:06Z');

test('selber Kalendertag wie der Upload: Jahr wird korrigiert (wie bisher)', () => {
  expect(plausibilizeBonDate('2020-10-11', up)).toEqual({ bonDate: '2026-10-11', corrected: { from: '2020-10-11', to: '2026-10-11', reason: 'year_misread_same_day' } });
});

test('Tag/Monat innerhalb von 7 Tagen vor dem Upload: Jahr wird korrigiert (Vorfall 11.10.2026)', () => {
  expect(plausibilizeBonDate('2020-10-09', up).bonDate).toBe('2026-10-09');
  expect(plausibilizeBonDate('2020-10-09', up).corrected.reason).toBe('year_misread_recent');
  expect(plausibilizeBonDate('2025-10-04', up).bonDate).toBe('2026-10-04');
});

test('außerhalb des Fensters oder richtiges Jahr: unverändert', () => {
  expect(plausibilizeBonDate('2026-10-09', up)).toEqual({ bonDate: '2026-10-09', corrected: null });
  expect(plausibilizeBonDate('2024-09-20', up).corrected).toBeNull();
  expect(plausibilizeBonDate('2020-10-03', up).corrected).toBeNull();
  expect(plausibilizeBonDate('2020-10-12', up).corrected).toBeNull();
});

test('über den Jahreswechsel: Vorjahr des Uploads', () => {
  expect(plausibilizeBonDate('2020-12-30', new Date('2027-01-02T10:00:00Z')).bonDate).toBe('2026-12-30');
});

test('Fenster ist einstellbar, ungültige Eingaben bleiben stehen', () => {
  expect(plausibilizeBonDate('2020-10-01', up, { maxTage: 14 }).bonDate).toBe('2026-10-01');
  expect(plausibilizeBonDate(null, up)).toEqual({ bonDate: null, corrected: null });
  expect(plausibilizeBonDate('09.10.2026', up).corrected).toBeNull();
});
