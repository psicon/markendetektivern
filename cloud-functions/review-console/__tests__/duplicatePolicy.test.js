'use strict';
const { evaluateDuplicate, dataDiffers, manufacturerEqual, completenessCheck, LOCK_MS, REASON } = require('../src/duplicatePolicy');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-09-01T10:00:00Z');
const base = (over) => ({ id: 'x', userId: 'u1', ean: '4006381333931', marketId: 'm1', status: 'pending', createdAt: T0, priceCents: 199, manufacturer: 'Müller GmbH', ...over });

describe('evaluateDuplicate', () => {
  test('ohne Referenz → ok', () => {
    expect(evaluateDuplicate(base(), [])).toMatchObject({ verdict: 'ok', priorId: null });
  });

  test('gleicher Nutzer, 5 Tage nach Freigabe, gleiche Daten → Sperre (gleicher Nutzer)', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 5 * DAY });
    const r = evaluateDuplicate(base(), [prior]);
    expect(r).toMatchObject({ verdict: 'locked', reason: REASON.SAME_USER, priorId: 'p', sameUser: true, lockUntil: prior.createdAt + LOCK_MS });
  });

  test('anderer Nutzer, 5 Tage nach Freigabe, gleiche Daten → Sperre (anderer Nutzer)', () => {
    const prior = base({ id: 'p', userId: 'u2', status: 'approved', createdAt: T0 - 5 * DAY });
    expect(evaluateDuplicate(base(), [prior])).toMatchObject({ verdict: 'locked', reason: REASON.OTHER_USER, sameUser: false });
  });

  test('anderer Preis innerhalb der 30 Tage → ok, Preis als Unterschied', () => {
    const prior = base({ id: 'p', userId: 'u2', status: 'approved', createdAt: T0 - 5 * DAY, priceCents: 179 });
    expect(evaluateDuplicate(base(), [prior])).toMatchObject({ verdict: 'ok', updatedFields: ['price'], diff: { price: [179, 199] } });
  });

  test('anderer Hersteller / anderer Markt zählen als andere Daten', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 2 * DAY, manufacturer: 'Bauer AG' });
    expect(evaluateDuplicate(base(), [prior]).updatedFields).toEqual(['manufacturer']);
    const prior2 = base({ id: 'p', status: 'approved', createdAt: T0 - 2 * DAY, marketId: 'm2' });
    expect(evaluateDuplicate(base(), [prior2]).updatedFields).toEqual(['market']);
  });

  test('fehlende OCR-Werte gelten als gleich (kein Bonus für fehlende Daten)', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 2 * DAY, priceCents: null, manufacturer: null });
    expect(evaluateDuplicate(base({ priceCents: null }), [prior]).verdict).toBe('locked');
  });

  test('nach 30 Tagen ist auch dieselbe Einreichung wieder frei', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 31 * DAY });
    expect(evaluateDuplicate(base(), [prior])).toMatchObject({ verdict: 'ok', priorId: 'p' });
  });

  test('genau am 30. Tag: Grenze inklusiv', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 30 * DAY });
    expect(evaluateDuplicate(base(), [prior]).verdict).toBe('ok');
  });

  test('ältere noch offene Einreichung → hold (erst die entscheiden)', () => {
    const older = base({ id: 'o', userId: 'u2', status: 'pending', createdAt: T0 - DAY });
    expect(evaluateDuplicate(base(), [older])).toMatchObject({ verdict: 'hold', reason: REASON.PENDING_OLDER, priorId: 'o' });
  });

  test('jüngere offene Einreichung blockiert NICHT (die ältere ist dran)', () => {
    const newer = base({ id: 'n', status: 'pending', createdAt: T0 + DAY });
    expect(evaluateDuplicate(base(), [newer]).verdict).toBe('ok');
  });

  test('die jüngste freigegebene Referenz zählt, nicht die älteste', () => {
    const old = base({ id: 'a', status: 'approved', createdAt: T0 - 60 * DAY });
    const recent = base({ id: 'b', status: 'approved', createdAt: T0 - 3 * DAY });
    expect(evaluateDuplicate(base(), [old, recent])).toMatchObject({ verdict: 'locked', priorId: 'b' });
  });

  test('Bewertung nutzt den Einreich-Zeitpunkt, nicht „jetzt"', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 5 * DAY });
    // Kandidat wurde vor Monaten eingereicht — die Prüfung heute ändert nichts an der Sperre damals.
    expect(evaluateDuplicate(base({ createdAt: T0 }), [prior]).verdict).toBe('locked');
  });

  test('abgelehnte Einreichungen sind keine Referenz; Kandidat selbst wird ignoriert', () => {
    const rej = base({ id: 'r', status: 'rejected', createdAt: T0 - DAY });
    const self = base({ id: 'x', status: 'pending' });
    expect(evaluateDuplicate(base(), [rej, self]).verdict).toBe('ok');
  });

  test('Firestore-Timestamps und ISO-Strings werden gelesen', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: { toMillis: () => T0 - 5 * DAY } });
    expect(evaluateDuplicate(base({ createdAt: new Date(T0).toISOString() }), [prior]).verdict).toBe('locked');
  });
});

describe('manufacturerEqual / dataDiffers', () => {
  test('OCR-Tippfehler und Rechtsform gelten als gleich', () => {
    expect(manufacturerEqual('Müller GmbH', 'Mueller')).toBe(true);
    expect(manufacturerEqual('Dr. Oetker', 'Dr Oetkr')).toBe(true);
    expect(manufacturerEqual('Bauer', 'Zott')).toBe(false);
  });
  test('Preis aus verschachtelter OCR-Struktur', () => {
    expect(dataDiffers({ priceOcr: { priceCents: 229 } }, { priceCents: 199 }).price).toBe(true);
  });
});

describe('completenessCheck', () => {
  const STEPS = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
  test('vollständig', () => {
    const images = Object.fromEntries(STEPS.map((s) => [s, `p/${s}.jpg`]));
    expect(completenessCheck({ images, ean: '4006381333931', productName: 'X' }, STEPS)).toEqual({ ok: true, problems: [], missing: [] });
  });
  test('fehlende Fotos, kurze EAN, kein Name', () => {
    const images = { front: 'a' };
    const r = completenessCheck({ images, ean: '123', productName: '', productNameOcr: null }, STEPS);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['unvollstaendig', 'ean_fehlt', 'kein_produktname']);
    expect(r.missing).toHaveLength(6);
  });
});
