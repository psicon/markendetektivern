'use strict';
const { evaluateDuplicate, dataDiffers, manufacturerEqual, completenessCheck, LOCK_MS, REASON } = require('../src/duplicatePolicy');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-09-01T10:00:00Z');
// Vergleichswerte kommen NUR aus den server-geschriebenen OCR-Feldern
// (crowd-upload-namer) — Top-Level wäre client-schreibbar.
const base = (over = {}) => {
  const { priceCents = 199, manufacturer = 'Müller GmbH', ...rest } = over;
  return {
    id: 'x', userId: 'u1', ean: '4006381333931', marketId: 'm1', status: 'pending', createdAt: T0,
    priceOcr: priceCents == null ? null : { priceCents, source: 'preis' },
    manufacturerOcr: manufacturer == null ? null : { name: manufacturer, source: 'hersteller' },
    ...rest,
  };
};

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

  test('identische Wiederholung bleibt gesperrt, auch wenn dazwischen eine Preisänderung freigegeben wurde', () => {
    // Eigener Upload vom 1., zwischenzeitlich fremde Freigabe mit anderem Preis am 3.
    const mine = base({ id: 'a', status: 'approved', createdAt: T0 - 10 * DAY });
    const other = base({ id: 'b', userId: 'u2', status: 'approved', createdAt: T0 - 3 * DAY, priceCents: 249 });
    const r = evaluateDuplicate(base(), [mine, other]);
    expect(r.verdict).toBe('locked');
    expect(r.priorId).toBe('a'); // die sperrende Referenz, nicht die jüngste
    expect(r.reason).toBe(REASON.SAME_USER);
  });

  test('eine JÜNGERE Freigabe im Fenster sperrt ebenfalls (Backlog-Reihenfolge)', () => {
    const younger = base({ id: 'y', userId: 'u2', status: 'approved', createdAt: T0 + 4 * DAY });
    const r = evaluateDuplicate(base(), [younger]);
    expect(r).toMatchObject({ verdict: 'locked', reason: REASON.OTHER_USER, priorId: 'y' });
    expect(r.lockUntil).toBe(younger.createdAt + LOCK_MS);
  });

  test('jüngere Freigabe mit anderen Daten sperrt nicht', () => {
    const younger = base({ id: 'y', userId: 'u2', status: 'approved', createdAt: T0 + 4 * DAY, priceCents: 149 });
    expect(evaluateDuplicate(base(), [younger])).toMatchObject({ verdict: 'ok', priorId: 'y', updatedFields: ['price'] });
  });

  test('Freigabe außerhalb des Fensters bleibt Information, sperrt nicht', () => {
    const old = base({ id: 'o', status: 'approved', createdAt: T0 - 40 * DAY });
    expect(evaluateDuplicate(base(), [old])).toMatchObject({ verdict: 'ok', priorId: 'o' });
  });

  test('die jüngste freigegebene Referenz zählt, nicht die älteste', () => {
    const old = base({ id: 'a', status: 'approved', createdAt: T0 - 60 * DAY });
    const recent = base({ id: 'b', status: 'approved', createdAt: T0 - 3 * DAY });
    expect(evaluateDuplicate(base(), [old, recent])).toMatchObject({ verdict: 'locked', priorId: 'b' });
    expect(evaluateDuplicate(base(), [old])).toMatchObject({ verdict: 'ok', priorId: 'a' });
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
  test('Preis kommt aus priceOcr; ein client-gesetztes Top-Level-Feld zählt NICHT', () => {
    expect(dataDiffers({ priceOcr: { priceCents: 229 } }, { priceOcr: { priceCents: 199 } }).price).toBe(true);
    // Angreifer setzt priceCents/manufacturer selbst → keine „anderen Daten"
    expect(dataDiffers({ priceCents: 999, manufacturer: 'Fake AG' }, { priceOcr: { priceCents: 199 }, manufacturerOcr: { name: 'Müller GmbH' } }).any).toBe(false);
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
