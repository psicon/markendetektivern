'use strict';

/**
 * Mistral-Zeuge SCHARF (Patrick 10.10.2026): Phase 0 der Lese-Leiter und die
 * Vergleichsregel. Rückweg = ohne `opts.zeuge` läuft die Leiter wie bisher.
 */

const { bestaetigung, zeugeFragen } = require('../lib/mistralZeuge');

let robust;
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.isolateModules(() => { robust = require('../lib/ocr_robust'); });
});
afterEach(() => console.warn.mockRestore());

const lesung = (items, total, over = {}) => ({
  parsed: { isReceipt: true, merchant: 'REWE', bonDate: '2026-10-09', bonTime: '10:00', totalCents: total, items, ...over },
  promptVersion: 'v1.4',
  latencyMs: 1,
});
const A = [{ name: 'Milch', priceCents: 119 }, { name: 'Brot', priceCents: 249 }];
const B = [{ name: 'Milch', priceCents: 119 }, { name: 'Brat', priceCents: 249 }];

function fakeExtract(antworten) {
  const aufrufe = [];
  const fn = async (bytes, mime, opts) => {
    aufrufe.push(opts);
    const a = antworten[aufrufe.length - 1];
    if (a instanceof Error) throw a;
    if (!a) throw new Error('keine Antwort mehr vorgesehen');
    return { ...a, model: opts.model };
  };
  fn.aufrufe = aufrufe;
  return fn;
}
const enhance = async () => Buffer.from('verbessert');

describe('bestaetigung', () => {
  const p = { totalCents: 2059, bonDate: '2026-10-09', bonTime: '08:13' };
  test('Jahr zählt nicht, Uhrzeit ±2 Minuten', () => {
    expect(bestaetigung({ summe: 2059, datum: '2020-10-09', zeit: '08:15' }, p).ok).toBe(true);
    expect(bestaetigung({ summe: 2059, datum: '2026-10-09', zeit: '08:16' }, p).ok).toBe(false);
  });
  test('Summe muss exakt gleich und > 0 sein, Tag/Monat gleich', () => {
    expect(bestaetigung({ summe: 2058, datum: '2026-10-09', zeit: '08:13' }, p).ok).toBe(false);
    expect(bestaetigung({ summe: 0, datum: '2026-10-09' }, { ...p, totalCents: 0 }).ok).toBe(false);
    expect(bestaetigung({ summe: 2059, datum: '2026-10-08', zeit: '08:13' }, p).ok).toBe(false);
    expect(bestaetigung({ summe: 2059, datum: null, zeit: '08:13' }, p).ok).toBe(false);
  });
  test('falsches Jahr der Gemini-Lesung wird nie bestätigt (Vorfall 11.10.2026)', () => {
    const jetzt = Date.parse('2026-10-11T08:00:00Z');
    expect(bestaetigung({ summe: 2982, datum: '2026-10-09', zeit: '19:58' }, { totalCents: 2982, bonDate: '2020-10-09', bonTime: '19:58' }, { jetzt }).ok).toBe(false);
    expect(bestaetigung({ summe: 2982, datum: '2020-10-09', zeit: '19:58' }, { totalCents: 2982, bonDate: '2026-10-09', bonTime: '19:58' }, { jetzt }).ok).toBe(true);
    expect(bestaetigung({ summe: 2982, datum: '2025-12-30', zeit: '19:58' }, { totalCents: 2982, bonDate: '2025-12-30', bonTime: '19:58' }, { jetzt: Date.parse('2026-01-02T08:00:00Z') }).ok).toBe(true);
  });
  test('fehlende Uhrzeit auf einer Seite hält nicht auf', () => {
    expect(bestaetigung({ summe: 2059, datum: '2026-10-09', zeit: null }, p).ok).toBe(true);
  });
});

describe('zeugeFragen', () => {
  test('ohne Schlüssel / Online-Bestellung: kein Aufruf', async () => {
    const fetchImpl = jest.fn();
    expect((await zeugeFragen({ bytes: Buffer.from('x'), parsed: {}, key: '', fetchImpl })).status).toBe('kein_schluessel');
    expect((await zeugeFragen({ bytes: Buffer.from('x'), parsed: {}, key: 'k', istOnline: () => true, fetchImpl })).status).toBe('online_ausgelassen');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test('Fehler wirft nie', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    const b = await zeugeFragen({ bytes: Buffer.from('x'), parsed: {}, key: 'k', fetchImpl });
    expect(b.status).toBe('fehler');
  });
  test('Antwort wird verglichen', async () => {
    const anno = { haendler: 'REWE', datum: '2023-10-09', uhrzeit: '10:01', endsumme_cent: 368, positionen: [] };
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ model: 'mistral-ocr', document_annotation: JSON.stringify(anno) }) });
    const b = await zeugeFragen({ bytes: Buffer.from('x'), parsed: lesung(A, 368).parsed, key: 'k', fetchImpl });
    expect(b.status).toBe('ok');
    expect(b.vergleich.ok).toBe(true);
  });
});

describe('Leiter Phase 0', () => {
  test('bestätigt: EINE Lesung, Bewertung high, Methode zeuge-agreement', async () => {
    const extract = fakeExtract([lesung(A, 368)]);
    const zeuge = jest.fn(async () => ({ status: 'ok', bestaetigt: true }));
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/png', { extract, enhance, zeuge });
    expect(extract.aufrufe).toHaveLength(1);
    expect(zeuge).toHaveBeenCalledTimes(1);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'zeuge-agreement', attempts: 1 });
    expect(out.robust.zeuge).toEqual({ status: 'ok', bestaetigt: true });
  });
  test('nicht bestätigt: Leiter läuft weiter, Einigung mit der zweiten Lesung', async () => {
    const extract = fakeExtract([lesung(A, 368), lesung(A, 368)]);
    const zeuge = async () => ({ status: 'ok', bestaetigt: false, grund: 'geldfelder' });
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/png', { extract, enhance, zeuge });
    expect(extract.aufrufe).toHaveLength(2);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement', attempts: 2 });
    expect(out.robust.zeuge.grund).toBe('geldfelder');
  });
  test('Zeuge wirft: wie nicht bestätigt, kein Fehler nach außen', async () => {
    const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(A, 368)]);
    const zeuge = async () => { throw new Error('netz'); };
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/png', { extract, enhance, zeuge });
    expect(out.robust.method).toBe('flash-agreement');
    expect(out.robust.zeuge.status).toBe('fehler');
  });
  test('erste Lesung ohne Summenprobe: Zeuge wird nicht gefragt', async () => {
    const extract = fakeExtract([lesung(A, 999), lesung(A, 368), lesung(A, 368)]);
    const zeuge = jest.fn();
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/png', { extract, enhance, zeuge });
    expect(zeuge).not.toHaveBeenCalled();
    expect(out.robust.zeuge).toEqual({ status: 'nicht_gefragt', grund: 'summenprobe' });
    expect(out.robust.method).toBe('flash-agreement');
  });
  test('ohne Zeuge (Rückweg): bitgenau wie bisher — zwei Lesungen gleichzeitig, kein zeuge-Feld', async () => {
    const extract = fakeExtract([lesung(A, 368), lesung(A, 368)]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/png', { extract, enhance });
    expect(extract.aufrufe).toHaveLength(2);
    expect(out.robust.method).toBe('flash-agreement');
    expect(out.robust).not.toHaveProperty('zeuge');
  });
  test('Fortsetzung eines Zwischenstands fragt nicht erneut', async () => {
    const extract = fakeExtract([lesung(A, 368)]);
    const zeuge = jest.fn();
    const zw = {
      v: robust.ZWISCHENSTAND_VERSION, model: 'gemini-3.5-flash', eskModel: robust.ESKALATION.model, promptVersion: 'v1.4', denkstufe: null,
      maxFlash: robust.MAX_FLASH, gespeichertMs: Date.now(), laeufe: 1, flash: 1, enh: 0, esk: 0, ersatz: 0, zeitAbbrueche: 0,
      failed: [], reads: [{ stufe: 'flash', parsed: lesung(A, 368).parsed, model: 'gemini-3.5-flash', promptVersion: 'v1.4' }],
    };
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/png', { model: 'gemini-3.5-flash', extract, enhance, zeuge, zwischenstand: zw });
    expect(zeuge).not.toHaveBeenCalled();
    expect(out.robust.method).toBe('flash-agreement');
  });
});
