'use strict';
const { evaluateDuplicate, dataDiffers, manufacturerEqual, completenessCheck, dupZumSpeichern, LOCK_MS, SAME_USER_LOCK_MS, REASON } = require('../src/duplicatePolicy');

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

  test('ANDERER Nutzer sperrt NIE — auch Minuten später nicht (Gründerentscheidung 20.09.2026)', () => {
    const prior = base({ id: 'p', userId: 'u2', status: 'approved', createdAt: T0 - 5 * 60 * 1000 });
    expect(evaluateDuplicate(base(), [prior])).toMatchObject({ verdict: 'ok', reason: null });
  });

  test('anderer Nutzer, gleiche Daten, 5 Tage vorher → ok', () => {
    const prior = base({ id: 'p', userId: 'u2', status: 'approved', createdAt: T0 - 5 * DAY });
    expect(evaluateDuplicate(base(), [prior]).verdict).toBe('ok');
  });

  test('gleicher Nutzer, versehentliches Doppel binnen Minuten, gleiche Daten → Sperre', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 10 * 1000 });
    const r = evaluateDuplicate(base(), [prior]);
    expect(r).toMatchObject({ verdict: 'locked', reason: REASON.SAME_USER, priorId: 'p', sameUser: true });
    expect(r.lockUntil).toBe(prior.createdAt + SAME_USER_LOCK_MS);
  });

  test('gleicher Nutzer, aber erst Tage später → neue Arbeit, also ok', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 5 * DAY });
    expect(evaluateDuplicate(base(), [prior]).verdict).toBe('ok');
  });

  test('gleicher Nutzer, 25 Stunden später → ok (Fenster ist 24 h)', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 25 * 60 * 60 * 1000 });
    expect(evaluateDuplicate(base(), [prior]).verdict).toBe('ok');
  });

  test('anderer Preis hebt auch das Selbst-Doppel auf', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 10 * 1000, priceCents: 179 });
    expect(evaluateDuplicate(base(), [prior])).toMatchObject({ verdict: 'ok', updatedFields: ['price'], diff: { price: [179, 199] } });
  });

  test('anderer Hersteller / anderer Markt zählen als andere Daten', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 60 * 1000, manufacturer: 'Bauer AG' });
    expect(evaluateDuplicate(base(), [prior]).updatedFields).toEqual(['manufacturer']);
    const prior2 = base({ id: 'p', status: 'approved', createdAt: T0 - 60 * 1000, marketId: 'm2' });
    expect(evaluateDuplicate(base(), [prior2]).updatedFields).toEqual(['market']);
  });

  test('fehlende OCR-Werte gelten als gleich — sperrt aber nur im 24-h-Fenster', () => {
    const kurz = base({ id: 'p', status: 'approved', createdAt: T0 - 60 * 1000, priceCents: null, manufacturer: null });
    expect(evaluateDuplicate(base({ priceCents: null }), [kurz]).verdict).toBe('locked');
    const spaeter = base({ id: 'p', status: 'approved', createdAt: T0 - 2 * DAY, priceCents: null, manufacturer: null });
    expect(evaluateDuplicate(base({ priceCents: null }), [spaeter]).verdict).toBe('ok');
  });

  test('eigene ältere offene Einreichung → hold (erst die entscheiden)', () => {
    const older = base({ id: 'o', status: 'pending', createdAt: T0 - DAY });
    expect(evaluateDuplicate(base(), [older])).toMatchObject({ verdict: 'hold', reason: REASON.PENDING_OLDER, priorId: 'o' });
  });

  test('FREMDE offene Einreichung hält nichts mehr auf', () => {
    const older = base({ id: 'o', userId: 'u2', status: 'pending', createdAt: T0 - DAY });
    expect(evaluateDuplicate(base(), [older]).verdict).toBe('ok');
  });

  test('jüngere eigene offene Einreichung blockiert NICHT (die ältere ist dran)', () => {
    const newer = base({ id: 'n', status: 'pending', createdAt: T0 + DAY });
    expect(evaluateDuplicate(base(), [newer]).verdict).toBe('ok');
  });

  test('eine JÜNGERE eigene Freigabe im 24-h-Fenster sperrt ebenfalls (Backlog-Reihenfolge)', () => {
    const younger = base({ id: 'y', status: 'approved', createdAt: T0 + 4 * 60 * 60 * 1000 });
    const r = evaluateDuplicate(base(), [younger]);
    expect(r).toMatchObject({ verdict: 'locked', reason: REASON.SAME_USER, priorId: 'y' });
    expect(r.lockUntil).toBe(younger.createdAt + SAME_USER_LOCK_MS);
  });

  test('jüngere Freigabe mit anderen Daten sperrt nicht', () => {
    const younger = base({ id: 'y', status: 'approved', createdAt: T0 + 4 * 60 * 60 * 1000, priceCents: 149 });
    expect(evaluateDuplicate(base(), [younger])).toMatchObject({ verdict: 'ok', priorId: 'y', updatedFields: ['price'] });
  });

  test('Freigabe außerhalb des Fensters bleibt Information, sperrt nicht', () => {
    const old = base({ id: 'o', status: 'approved', createdAt: T0 - 40 * DAY });
    expect(evaluateDuplicate(base(), [old])).toMatchObject({ verdict: 'ok', priorId: 'o' });
  });

  test('abgelehnte Einreichungen sind keine Referenz; Kandidat selbst wird ignoriert', () => {
    const rej = base({ id: 'r', status: 'rejected', createdAt: T0 - 60 * 1000 });
    const self = base({ id: 'x', status: 'pending' });
    expect(evaluateDuplicate(base(), [rej, self]).verdict).toBe('ok');
  });

  test('Firestore-Timestamps und ISO-Strings werden gelesen', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: { toMillis: () => T0 - 60 * 1000 } });
    expect(evaluateDuplicate(base({ createdAt: new Date(T0).toISOString() }), [prior]).verdict).toBe('locked');
  });

  test('Der reale Fall Blumhofer: eigene Erfassung 22 Tage vorher zählt wieder', () => {
    const august = base({ id: 'aug', status: 'approved', createdAt: T0 - 22 * DAY, priceCents: null, manufacturer: null });
    expect(evaluateDuplicate(base({ priceCents: null }), [august]).verdict).toBe('ok');
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

describe('dupZumSpeichern', () => {
  const T = Date.UTC(2026, 8, 25, 8, 0, 0);
  it('behält Referenz, Frist und Unterschiede — ohne fremde uid und fremde Werte', () => {
    const prior = { id: 'p', userId: 'andere', ean: '4061464833821', status: 'approved', createdAt: T - 40 * 86400000, marketId: 'm2', priceOcr: { priceCents: 199 } };
    const kand = { id: 'k', userId: 'ich', ean: '4061464833821', status: 'pending', createdAt: T, marketId: 'm1', priceOcr: { priceCents: 229 } };
    const d = evaluateDuplicate(kand, [prior]);
    expect(d.priorUserId).toBe('andere');
    const s = dupZumSpeichern(d);
    expect(s).toEqual({ verdict: 'ok', reason: null, priorId: 'p', sameUser: false, lockUntil: d.lockUntil, updatedFields: ['price', 'market'] });
    expect(JSON.stringify(s)).not.toContain('andere');
    expect(JSON.stringify(s)).not.toContain('199');
  });
  it('Kurzform der Runde ohne EAN ({verdict, reason, lockUntil}) und null', () => {
    expect(dupZumSpeichern({ verdict: 'ok', reason: null, lockUntil: null })).toEqual({ verdict: 'ok', reason: null, priorId: null, sameUser: null, lockUntil: null, updatedFields: [] });
    expect(dupZumSpeichern(null)).toBeNull();
  });
});
