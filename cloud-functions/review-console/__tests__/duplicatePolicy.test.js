'use strict';
const { evaluateDuplicate, dataDiffers, manufacturerEqual, completenessCheck, dupZumSpeichern, SAME_USER_LOCK_MS, REASON, appGrund } = require('../src/duplicatePolicy');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
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

describe('evaluateDuplicate — einmal pro Woche (Entscheidung Patrick 02.10.2026)', () => {
  test('Fenster ist genau 7 Tage (168 h)', () => {
    expect(SAME_USER_LOCK_MS).toBe(7 * DAY);
  });

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

  test('gleicher Nutzer, Doppel binnen Minuten → Wochen-Sperre mit Frist', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 10 * 1000 });
    const r = evaluateDuplicate(base(), [prior]);
    expect(r).toMatchObject({ verdict: 'locked', reason: REASON.SAME_USER_WEEK, priorId: 'p', sameUser: true });
    expect(r.lockUntil).toBe(prior.createdAt + 7 * DAY);
  });

  test('gleicher Nutzer, 25 Stunden später → JETZT gesperrt (vorher frei, Fenster war 24 h)', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - 25 * HOUR });
    expect(evaluateDuplicate(base(), [prior])).toMatchObject({ verdict: 'locked', reason: REASON.SAME_USER_WEEK });
  });

  test('gleicher Nutzer, 6 Tage 23 Stunden später → gesperrt', () => {
    const prior = base({ id: 'p', status: 'approved', createdAt: T0 - (7 * DAY - HOUR) });
    expect(evaluateDuplicate(base(), [prior]).verdict).toBe('locked');
  });

  test('gleicher Nutzer, genau 168 h später → ok (Grenze exklusiv); 8 Tage später → ok', () => {
    expect(evaluateDuplicate(base(), [base({ id: 'p', status: 'approved', createdAt: T0 - 7 * DAY })]).verdict).toBe('ok');
    const r = evaluateDuplicate(base(), [base({ id: 'p', status: 'approved', createdAt: T0 - 8 * DAY })]);
    expect(r).toMatchObject({ verdict: 'ok', priorId: 'p', sameUser: true });
  });

  test('KEINE Ausnahme mehr: anderer Preis, anderer Hersteller, anderer Markt — alles gesperrt', () => {
    const preis = base({ id: 'p', status: 'approved', createdAt: T0 - HOUR, priceCents: 179 });
    const r = evaluateDuplicate(base(), [preis]);
    expect(r).toMatchObject({ verdict: 'locked', reason: REASON.SAME_USER_WEEK, updatedFields: ['price'] });
    expect(r.diff.price).toEqual([179, 199]);
    expect(evaluateDuplicate(base(), [base({ id: 'p', status: 'approved', createdAt: T0 - HOUR, manufacturer: 'Bauer AG' })]).verdict).toBe('locked');
    expect(evaluateDuplicate(base(), [base({ id: 'p', status: 'approved', createdAt: T0 - HOUR, marketId: 'm2' })]).verdict).toBe('locked');
  });

  test('Buschbohnen 02.10.: REWE und Netto binnen 10 Minuten → die zweite ist gesperrt', () => {
    const rewe = base({ id: 'rewe', status: 'approved', createdAt: T0 - 10 * 60 * 1000, marketId: 'rewe', priceCents: 129 });
    const netto = base({ id: 'netto', marketId: 'netto', priceCents: 99 });
    expect(evaluateDuplicate(netto, [rewe])).toMatchObject({ verdict: 'locked', priorId: 'rewe', updatedFields: ['price', 'market'] });
  });

  test('fehlende OCR-Werte spielen keine Rolle mehr', () => {
    const p = base({ id: 'p', status: 'approved', createdAt: T0 - 2 * DAY, priceCents: null, manufacturer: null });
    expect(evaluateDuplicate(base({ priceCents: null }), [p]).verdict).toBe('locked');
  });

  test('eigene ältere offene Einreichung → hold (erst die entscheiden — so bleibt eine Kopie zahlbar)', () => {
    const older = base({ id: 'o', status: 'pending', createdAt: T0 - DAY });
    expect(evaluateDuplicate(base(), [older])).toMatchObject({ verdict: 'hold', reason: REASON.PENDING_OLDER, priorId: 'o' });
  });

  test('FREMDE offene Einreichung hält nichts auf', () => {
    const older = base({ id: 'o', userId: 'u2', status: 'pending', createdAt: T0 - DAY });
    expect(evaluateDuplicate(base(), [older]).verdict).toBe('ok');
  });

  test('jüngere eigene offene Einreichung blockiert NICHT (die ältere ist dran)', () => {
    const newer = base({ id: 'n', status: 'pending', createdAt: T0 + DAY });
    expect(evaluateDuplicate(base(), [newer]).verdict).toBe('ok');
  });

  test('eine JÜNGERE eigene Freigabe im Fenster sperrt ebenfalls (Backlog-Reihenfolge)', () => {
    const younger = base({ id: 'y', status: 'approved', createdAt: T0 + 3 * DAY, priceCents: 149 });
    const r = evaluateDuplicate(base(), [younger]);
    expect(r).toMatchObject({ verdict: 'locked', reason: REASON.SAME_USER_WEEK, priorId: 'y' });
    expect(r.lockUntil).toBe(younger.createdAt + SAME_USER_LOCK_MS);
  });

  test('mehrere eigene Freigaben: Frist richtet sich nach der jüngsten', () => {
    const a = base({ id: 'a', status: 'approved', createdAt: T0 - 6 * DAY });
    const b = base({ id: 'b', status: 'approved', createdAt: T0 - 2 * DAY });
    expect(evaluateDuplicate(base(), [a, b])).toMatchObject({ priorId: 'b', lockUntil: b.createdAt + 7 * DAY });
  });

  test('abgelehnte Einreichungen sind keine Referenz und verlängern nichts; Kandidat selbst wird ignoriert', () => {
    const rej = base({ id: 'r', status: 'rejected', createdAt: T0 - 60 * 1000 });
    const self = base({ id: 'x', status: 'pending' });
    expect(evaluateDuplicate(base(), [rej, self]).verdict).toBe('ok');
  });

  test('täglich dasselbe Produkt: Tag 0 frei, Tage 1–6 gesperrt, Tag 7 wieder frei', () => {
    const tag0 = base({ id: 't0', status: 'approved', createdAt: T0 });
    const gesperrt = [1, 2, 3, 4, 5, 6].map((t) => base({ id: `t${t}`, status: 'rejected', createdAt: T0 + t * DAY }));
    expect(evaluateDuplicate(base({ id: 'k3', createdAt: T0 + 3 * DAY }), [tag0, ...gesperrt]).verdict).toBe('locked');
    expect(evaluateDuplicate(base({ id: 'k7', createdAt: T0 + 7 * DAY }), [tag0, ...gesperrt]).verdict).toBe('ok');
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

describe('appGrund — Code am Dokument für die App (Entscheidung Patrick 02.10.2026)', () => {
  test('Wochen-Sperre und alter 24-h-Code erscheinen als doppelt_eingereicht', () => {
    expect(appGrund(REASON.SAME_USER_WEEK)).toBe('doppelt_eingereicht');
    expect(appGrund(REASON.SAME_USER)).toBe('doppelt_eingereicht');
  });
  test('alle anderen Codes bleiben', () => {
    for (const c of ['unvollstaendig', 'preis_fehlt', 'konto_gesperrt', 'bilder_wiederverwendet', 'doppelt_eingereicht']) expect(appGrund(c)).toBe(c);
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
