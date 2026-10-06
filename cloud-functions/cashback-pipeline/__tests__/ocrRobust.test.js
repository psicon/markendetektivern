'use strict';

/**
 * Robust-OCR-Leiter: welche Aufrufe die Eskalationsstufe macht, seit sie nicht
 * mehr gemini-2.5-pro ist (Abschaltung 20.10.2026), und dass Bewertung und
 * Fingerabdrücke unverändert entstehen.
 */

const ENV_KEYS = ['CASHBACK_OCR_PRO_MODEL', 'CASHBACK_OCR_PRO_THINKING_LEVEL', 'CASHBACK_OCR_PRO_FALLBACK_THINKING_LEVEL', 'CASHBACK_OCR_PRO_LOCATION', 'CASHBACK_OCR_PRO_TIMEOUT_MS', 'CASHBACK_OCR_MAX_FLASH'];
let gesichert;
let robust;

function laden() {
  jest.isolateModules(() => {
    robust = require('../lib/ocr_robust');
  });
}

beforeEach(() => {
  // Die Leiter protokolliert jeden Fehlversuch — im Test erwartet, nur Lärm.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  gesichert = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  laden();
});

afterEach(() => {
  console.warn.mockRestore();
  for (const k of ENV_KEYS) {
    if (gesichert[k] === undefined) delete process.env[k];
    else process.env[k] = gesichert[k];
  }
});

/** Eine Lesung im Format von extractReceipt. */
const lesung = (items, total, over = {}) => ({
  parsed: { isReceipt: true, merchant: 'REWE', bonDate: '2026-09-28', bonTime: '10:00', totalCents: total, items, ...over },
  promptVersion: 'v1.4',
  latencyMs: 1,
});
const A = [{ name: 'Milch', priceCents: 119 }, { name: 'Brot', priceCents: 249 }];
const B = [{ name: 'Milch', priceCents: 119 }, { name: 'Brat', priceCents: 249 }];
const C = [{ name: 'Mlich', priceCents: 119 }, { name: 'Brot', priceCents: 249 }];
const D = [{ name: 'Milk', priceCents: 119 }, { name: 'Brod', priceCents: 249 }];

/** Fake-extract: arbeitet Antworten ab und merkt sich die Aufruf-Optionen. */
function fakeExtract(antworten) {
  const aufrufe = [];
  const fn = async (bytes, mime, opts) => {
    aufrufe.push({ mime, ...opts });
    const a = antworten[aufrufe.length - 1];
    if (a instanceof Error) throw a;
    if (!a) throw new Error('keine Antwort mehr vorgesehen');
    return { ...a, model: opts.model };
  };
  fn.aufrufe = aufrufe;
  return fn;
}
const enhance = async () => Buffer.from('verbessert');

test('Standard-Eskalation: gemini-3.5-flash, HIGH, Standort eu — auf dem verbesserten Bild', async () => {
  // 3 Flash + 2 verbesserte Lesungen uneinig, erste Eskalationslesung stimmt mit Flash-1 überein.
  const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(B.slice(0, 1).concat(D.slice(1)), 368), lesung(A, 368)]);
  const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/png', { model: 'gemini-3.5-flash', extract, enhance });
  const esk = extract.aufrufe.slice(5);
  expect(esk).toHaveLength(1);
  expect(esk[0]).toMatchObject({ model: 'gemini-3.5-flash', thinkingConfig: { thinkingLevel: 'HIGH' }, location: 'eu', mime: 'image/jpeg', timeoutMs: 150000 });
  // Primär- und verbesserte Lesungen: kein Standort, keine Denkstufe — aber
  // seit 03.10.2026 ein eigenes Zeitlimit (vorher hingen sie bis zum 300-s-
  // Limit von Node-fetch).
  for (const a of extract.aufrufe.slice(0, 5)) {
    expect(a.location).toBeUndefined();
    expect(a.thinkingConfig).toBeUndefined();
    expect(a.timeoutMs).toBe(170000);
  }
  // Einigkeit mit einer Flash-Lesung → wie bisher 'high' (gewählt wird die Flash-Lesung).
  expect(out.robust).toMatchObject({ confidence: 'high', method: 'pro-agreement', proAttempts: 1, escalationModel: 'gemini-3.5-flash' });
  expect(out.robust.reads.map((r) => r.model)).toEqual(['flash', 'flash', 'flash', 'flash-enhanced', 'flash-enhanced', 'pro']);
});

test('zwei einige Eskalationslesungen → medium (wie bisher bei 2.5-pro)', async () => {
  const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung([{ name: 'X', priceCents: 368 }], 368), lesung([{ name: 'Y', priceCents: 368 }], 368), lesung([{ name: 'Y', priceCents: 368 }], 368)]);
  const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
  expect(out.robust).toMatchObject({ confidence: 'medium', method: 'pro-agreement', proAttempts: 2 });
  expect(out.parsed.items[0].name).toBe('Y');
});

test('Eskalation scheitert (z. B. 429 in eu) → Leiter läuft weiter, Ergebnis aus den vorhandenen Lesungen', async () => {
  const quota = new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
  const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(A.slice(0, 1), 999), quota, quota]);
  const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
  expect(out.robust).toMatchObject({ confidence: 'low', method: 'reconcile-no-agreement', proAttempts: 0, failedAttempts: 2, escalationModel: null });
  expect(out.robust.escalationFallbackThinking).toBeUndefined();
});

test('Denk-Ausreißer (MAX_TOKENS) im ersten Versuch → zweiter Versuch mit Ausweich-Denkstufe LOW', async () => {
  const ausreisser = Object.assign(new Error('OCR JSON parse failed (MAX_TOKENS): Unterminated string in JSON'), { code: 'ocr_json_decode' });
  const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(C, 999), ausreisser, lesung(B, 368)]);
  const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
  const [v1, v2] = extract.aufrufe.slice(5);
  expect(v1.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
  expect(v2.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  expect(v2).toMatchObject({ model: 'gemini-3.5-flash', location: 'eu', timeoutMs: 150000 });
  expect(out.robust).toMatchObject({ confidence: 'high', method: 'pro-agreement', proAttempts: 1, failedAttempts: 1, escalationFallbackThinking: 'LOW' });
});

test('erster Eskalationsversuch gelingt → zweiter bleibt auf HIGH', async () => {
  const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(C, 999), lesung([{ name: 'X', priceCents: 368 }], 368), lesung([{ name: 'Y', priceCents: 368 }], 368)]);
  const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
  expect(extract.aufrufe.slice(5).map((a) => a.thinkingConfig)).toEqual([{ thinkingLevel: 'HIGH' }, { thinkingLevel: 'HIGH' }]);
  expect(out.robust.escalationFallbackThinking).toBeUndefined();
});

test('Rückweg per Env: CASHBACK_OCR_PRO_MODEL=gemini-2.5-pro → der alte Aufruf, nur mit dem allgemeinen Lese-Zeitlimit', async () => {
  process.env.CASHBACK_OCR_PRO_MODEL = 'gemini-2.5-pro';
  laden();
  const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(C, 999), lesung(A, 368)]);
  const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
  const esk = extract.aufrufe[5];
  // Keine Denk-Konfiguration, kein Standort (Modell-Standard europe-west4) —
  // aber ein Zeitlimit, damit auch der Rückweg das Laufbudget einhält. Der
  // Prompt wird seit dem Schalter (05.10.2026) ausdrücklich übergeben — ohne
  // Angabe v1.4, also derselbe Text wie zuvor über die Modul-Voreinstellung.
  expect(esk).toEqual({ mime: 'image/jpeg', model: 'gemini-2.5-pro', timeoutMs: 170000, ...require('../lib/prompt').promptOptionen('v1.4') });
  expect(out.robust.escalationModel).toBe('gemini-2.5-pro');
});

test('Eskalations-Deckel greift weiter vor der Eskalation (keine Eskalationsaufrufe)', async () => {
  const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(C, 368)]);
  const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance, escalationGate: async () => 'bon_too_old' });
  expect(extract.aufrufe).toHaveLength(3);
  expect(out.robust).toMatchObject({ method: 'escalation-capped:bon_too_old', proAttempts: 0, escalationModel: null });
});

test('Zeitüberschreitung der Eskalation zählt als Fehlversuch, Leiter läuft weiter', async () => {
  const zeit = Object.assign(new Error('OCR timeout after 150000 ms (gemini-3.5-flash)'), { code: 'ocr_timeout' });
  const extract = fakeExtract([lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(C, 999), zeit, lesung(B, 368)]);
  const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
  expect(out.robust).toMatchObject({ confidence: 'high', method: 'pro-agreement', proAttempts: 1, failedAttempts: 1 });
});

test('Totalausfall bleibt ein Infrastrukturfehler (wirft ocr_unavailable, kein Stub)', async () => {
  const fehler = new Error('fetch failed');
  const extract = fakeExtract(Array(7).fill(fehler));
  await expect(robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance })).rejects.toMatchObject({ code: 'ocr_unavailable' });
});
