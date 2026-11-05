'use strict';

/**
 * Haiku 5.5 als erste Lesung (Patrick 10.10.2026): Leser und Phase 0 der Leiter.
 * Rückweg = ohne `opts.ersterLeser` läuft Phase 0 wie mit dem Gemini-Zeugen.
 */

jest.mock('firebase-admin', () => ({ credential: { applicationDefault: () => ({ getAccessToken: async () => ({ access_token: 't', expires_in: 3600 }) }) } }));
const { haikuLesen, bildTyp } = require('../lib/haikuLeser');

let robust;
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.isolateModules(() => { robust = require('../lib/ocr_robust'); });
});
afterEach(() => console.warn.mockRestore());

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const A = [{ name: 'Milch', priceCents: 119 }, { name: 'Brot', priceCents: 249 }];
const lesung = (items, total, over = {}) => ({
  parsed: { isReceipt: true, merchant: 'REWE', bonDate: '2026-10-09', bonTime: '10:00', totalCents: total, items, ...over },
  promptVersion: 'v1.4', latencyMs: 1,
});
function fakeExtract(antworten) {
  const aufrufe = [];
  const fn = async (bytes, mime, opts) => { aufrufe.push(opts); const a = antworten[aufrufe.length - 1]; if (!a) throw new Error('keine Antwort'); return { ...a, model: opts.model }; };
  fn.aufrufe = aufrufe;
  return fn;
}
const enhance = async () => Buffer.from('v');

describe('bildTyp', () => {
  test('erkennt JPEG/PNG an den Bytes, nicht an der Angabe', () => {
    expect(bildTyp(JPEG)).toBe('image/jpeg');
    expect(bildTyp(PNG)).toBe('image/png');
    expect(bildTyp(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('haikuLesen', () => {
  const antwort = (obj, status = 200) => async (url, init) => {
    antwort.letzte = { url, body: JSON.parse(init.body) };
    return { ok: status === 200, status, text: async () => JSON.stringify(obj) };
  };
  test('liest JSON aus der Antwort, sendet den erkannten Bildtyp', async () => {
    const parsed = { isReceipt: true, merchant: 'REWE', bonDate: '2026-10-09', bonTime: '10:00', totalCents: 368, items: A };
    const f = antwort({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(parsed) + '\n```' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
    const r = await haikuLesen(PNG, { fetchImpl: f, token: 'x' });
    expect(r.parsed.totalCents).toBe(368);
    expect(r.model).toBe('claude-haiku-5-5');
    expect(antwort.letzte.body.messages[0].content[0].source.media_type).toBe('image/png');
    expect(antwort.letzte.url).toContain('/locations/global/publishers/anthropic/models/claude-haiku-5-5:rawPredict');
  });
  test('wirft bei unbekanntem Format, zu großem Bild, HTTP-Fehler und kaputtem JSON', async () => {
    await expect(haikuLesen(Buffer.from('%PDF'), { token: 'x' })).rejects.toMatchObject({ code: 'haiku_bildformat' });
    await expect(haikuLesen(Buffer.concat([JPEG, Buffer.alloc(5e6)]), { token: 'x' })).rejects.toMatchObject({ code: 'haiku_bildformat' });
    await expect(haikuLesen(JPEG, { token: 'x', fetchImpl: antwort({ error: 'x' }, 400) })).rejects.toMatchObject({ code: 'haiku_http' });
    await expect(haikuLesen(JPEG, { token: 'x', fetchImpl: antwort({ content: [{ type: 'text', text: '{"items": [1,' }] }) })).rejects.toMatchObject({ code: 'haiku_json' });
  });
});

describe('Leiter Phase 0 mit erstem Leser', () => {
  test('bestätigt: keine Gemini-Lesung, Methode zeuge-agreement, ersterLeser vermerkt', async () => {
    const extract = fakeExtract([]);
    const ersterLeser = async () => ({ ...lesung(A, 368), model: 'claude-haiku-5-5' });
    const zeuge = jest.fn(async () => ({ status: 'ok', bestaetigt: true }));
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser });
    expect(extract.aufrufe).toHaveLength(0);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'zeuge-agreement', attempts: 1, ersterLeser: 'claude-haiku-5-5' });
    expect(out.robust.reads[0].model).toBe('haiku');
    expect(out.model).toBe('claude-haiku-5-5');
    expect(out).not.toHaveProperty('__haiku');
  });
  test('nicht bestätigt: Haiku-Lesung verworfen, Gemini liest wie bisher zweimal gleichzeitig', async () => {
    const extract = fakeExtract([lesung(A, 368), lesung(A, 368)]);
    const ersterLeser = async () => ({ ...lesung(A, 368), model: 'claude-haiku-5-5' });
    const zeuge = async () => ({ status: 'ok', bestaetigt: false, grund: 'geldfelder' });
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser });
    expect(extract.aufrufe).toHaveLength(2);
    expect(out.robust).toMatchObject({ method: 'flash-agreement', attempts: 2 });
    expect(out.robust.reads.every((r) => r.model === 'flash')).toBe(true);
    expect(out.robust.zeuge).toMatchObject({ grund: 'geldfelder', ersterLeser: 'claude-haiku-5-5' });
  });
  test('erster Leser wirft: Gemini-Leiter wie bisher, Fehler vermerkt', async () => {
    const extract = fakeExtract([lesung(A, 368), lesung(A, 368)]);
    const zeuge = jest.fn();
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser: async () => { throw new Error('haiku_http: 503'); } });
    expect(zeuge).not.toHaveBeenCalled();
    expect(out.robust.method).toBe('flash-agreement');
    expect(out.robust.zeuge.status).toBe('erster_leser_fehler');
  });
  test('Haiku-Lesung ohne Summenprobe: Zeuge nicht gefragt, Gemini wie bisher', async () => {
    const extract = fakeExtract([lesung(A, 368), lesung(A, 368)]);
    const zeuge = jest.fn();
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser: async () => ({ ...lesung(A, 999), model: 'claude-haiku-5-5' }) });
    expect(zeuge).not.toHaveBeenCalled();
    expect(out.robust.zeuge).toMatchObject({ status: 'nicht_gefragt', grund: 'summenprobe' });
    expect(extract.aufrufe).toHaveLength(2);
  });
});

describe('2-aus-3 (Schalter zweiAusDrei)', () => {
  const haiku = (total) => async () => ({ ...lesung(A, total), model: 'claude-haiku-5-5' });
  const B = [{ name: 'Milch', priceCents: 119 }, { name: 'Brot', priceCents: 250 }];
  // Prüfung wie in index.js vereinfacht: Summe des Zeugen = Summe der Lesung.
  // Je Test neu angelegt: das cf-Projekt setzt `resetMocks: true`, eine einmal
  // angelegte Implementierung wäre vor jedem Test weg (gab still `undefined`
  // zurück — beide Bestätigungs-Tests waren dadurch seit 11.10. rot).
  let pruefen;
  beforeEach(() => { pruefen = jest.fn(async (r, erg) => ({ bestaetigt: erg.summe === r.parsed.totalCents })); });

  test('Mistral widerspricht Haiku, stimmt aber mit EINER Gemini-Lesung überein: fertig nach 1 Gemini-Lesung', async () => {
    const extract = fakeExtract([lesung(A, 368)]);
    const zeuge = jest.fn(async () => ({ status: 'ok', bestaetigt: false, grund: 'geldfelder', ergebnis: { summe: 368, datum: '2026-10-09', zeit: '10:00', markt: 'REWE' } }));
    // Haiku liest 369 (falsch, geht aber auf: Artikel 119+250)
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser: async () => ({ ...lesung(B, 369), model: 'claude-haiku-5-5' }), zweiAusDrei: true, zeugePruefen: pruefen });
    expect(extract.aufrufe).toHaveLength(1);
    expect(out.robust).toMatchObject({ method: 'zwei-aus-drei', confidence: 'high', attempts: 1 });
    expect(out.robust.zeuge.zweiAusDrei.mit).toBe('mistral');
    expect(out.model).not.toBe('claude-haiku-5-5');
  });
  test('Gemini stimmt mit Haiku überein (Mistral nicht): Gemini-Lesung gilt', async () => {
    const extract = fakeExtract([lesung(A, 368)]);
    const zeuge = jest.fn(async () => ({ status: 'ok', bestaetigt: false, grund: 'geldfelder', ergebnis: { summe: 999, datum: '2026-10-09', zeit: '10:00', markt: 'REWE' } }));
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser: haiku(368), zweiAusDrei: true, zeugePruefen: pruefen });
    expect(extract.aufrufe).toHaveLength(1);
    expect(out.robust.zeuge.zweiAusDrei.mit).toBe('haiku');
  });
  test('Haiku fällt aus: Mistral wird zur Gemini-Lesung gefragt', async () => {
    const extract = fakeExtract([lesung(A, 368)]);
    const zeuge = jest.fn(async () => ({ status: 'ok', bestaetigt: true }));
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser: async () => { throw new Error('haiku_zeitlimit: 45000 ms'); }, zweiAusDrei: true, zeugePruefen: pruefen });
    expect(zeuge).toHaveBeenCalledTimes(1);
    expect(extract.aufrufe).toHaveLength(1);
    expect(out.robust.zeuge.zweiAusDrei.mit).toBe('mistral_nachgefragt');
  });
  test('keine Einigung: Leiter läuft weiter, erste Gemini-Lesung zählt mit', async () => {
    const extract = fakeExtract([lesung(A, 368), lesung(A, 368)]);
    const zeuge = jest.fn(async () => ({ status: 'ok', bestaetigt: false, grund: 'geldfelder', ergebnis: { summe: 999 } }));
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser: haiku(777), zweiAusDrei: true, zeugePruefen: pruefen });
    expect(extract.aufrufe).toHaveLength(2);
    expect(out.robust).toMatchObject({ method: 'flash-agreement', attempts: 2 });
    expect(out.robust.zeuge.zweiAusDrei).toMatchObject({ grund: 'keine_einigung' });
  });
  test('ohne Schalter: wie bisher zwei Gemini-Lesungen gleichzeitig, Haiku-Geldfelder werden vermerkt', async () => {
    const extract = fakeExtract([lesung(A, 368), lesung(A, 368)]);
    const zeuge = async () => ({ status: 'ok', bestaetigt: false, grund: 'geldfelder', ergebnis: { summe: 999 } });
    const out = await robust.extractReceiptRobust(JPEG, 'image/jpeg', { extract, enhance, zeuge, ersterLeser: haiku(368), zeugePruefen: pruefen });
    expect(extract.aufrufe).toHaveLength(2);
    expect(pruefen).not.toHaveBeenCalled();
    expect(out.robust.zeuge.ersteLesung).toMatchObject({ summe: 368, summenprobe: true });
  });
});
