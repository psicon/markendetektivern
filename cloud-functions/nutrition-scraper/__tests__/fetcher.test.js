/**
 * Tests für den Ergebnisvertrag von src/fetcher.js: Abruffehler werfen
 * SeiteNichtAbrufbarError statt null (bis 04.10.2026 zählten sie wie eine
 * leere Seite und endeten als 'no-data').
 *
 * @jest-environment node
 */

'use strict';

const { fetchHtml } = require('../src/fetcher');
const { SeiteNichtAbrufbarError, FetchUnavailableError } = require('../src/fehler');

const echtesFetch = global.fetch;
let antworten;

function antwort(status, body = '', url = '') {
  const r = new Response(body, { status });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}

// Jede Probe auf eigenem Host — der Fetcher drosselt je Host (800 ms).
let n = 0;
const host = () => `https://shop${++n}.example.de/p`;

beforeEach(() => {
  antworten = [];
  global.fetch = async (url) => {
    const naechste = antworten.shift();
    if (!naechste) throw new Error(`unerwarteter Abruf ${url}`);
    return typeof naechste === 'function' ? naechste(url) : naechste;
  };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  global.fetch = echtesFetch;
});

const VOLL = `<html><body>${'Zutaten: Wasser, Hafer. '.repeat(500)}</body></html>`;

test('200 → Seite mit via: direkt', async () => {
  const url = host();
  antworten.push(antwort(200, VOLL, url));
  const r = await fetchHtml(url, { skipRobots: true });
  expect(r.via).toBe('direkt');
  expect(r.finalUrl).toBe(url);
  expect(r.html).toContain('Zutaten');
});

test.each([403, 429, 401])('HTTP %s → SeiteNichtAbrufbarError', async (status) => {
  antworten.push(antwort(status));
  await expect(fetchHtml(host(), { skipRobots: true })).rejects.toMatchObject({
    name: 'SeiteNichtAbrufbarError', status,
  });
});

test('404 → null (die Seite gibt es nicht)', async () => {
  antworten.push(antwort(404));
  await expect(fetchHtml(host(), { skipRobots: true })).resolves.toBeNull();
});

test('503 zweimal → SeiteNichtAbrufbarError (nach einem Wiederholversuch)', async () => {
  antworten.push(antwort(503), antwort(503));
  await expect(fetchHtml(host(), { skipRobots: true })).rejects.toBeInstanceOf(SeiteNichtAbrufbarError);
  expect(antworten).toHaveLength(0);
});

test('Zeitlimit zweimal → SeiteNichtAbrufbarError mit grund zeitlimit', async () => {
  const zeitlimit = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
  antworten.push(zeitlimit, zeitlimit);
  await expect(fetchHtml(host(), { skipRobots: true })).rejects.toMatchObject({ grund: 'zeitlimit' });
});

test('Apify: Konto-Fehler 402 → FetchUnavailableError, 504 → SeiteNichtAbrufbarError, Zähler', async () => {
  const verbrauch = {};
  antworten.push(antwort(402, 'payment required'));
  await expect(fetchHtml(host(), { requiresJS: true, apifyToken: 't', verbrauch })).rejects.toBeInstanceOf(FetchUnavailableError);
  antworten.push(antwort(504, 'timeout'));
  await expect(fetchHtml(host(), { requiresJS: true, apifyToken: 't', verbrauch })).rejects.toBeInstanceOf(SeiteNichtAbrufbarError);
  expect(verbrauch.apifyAbrufe).toBe(2);
});

test('Apify liefert Markdown → via: apify', async () => {
  const md = '# Haferdrink\n\nZutaten: Wasser, Hafer, Salz. EAN 4311501099278 '.repeat(5);
  antworten.push(antwort(200, JSON.stringify([{ markdown: md, crawl: { loadedUrl: 'https://www.penny.de/p/1', httpStatusCode: 200 } }])));
  const r = await fetchHtml(host(), { requiresJS: true, apifyToken: 't' });
  expect(r).toMatchObject({ via: 'apify', finalUrl: 'https://www.penny.de/p/1' });
});

test('dünne Seite: scheitert das Apify-Rendern, gilt die direkt geholte Fassung — mit Vermerk', async () => {
  const url = host();
  antworten.push(antwort(200, '<html>klein</html>', url), antwort(500, 'kaputt'));
  const r = await fetchHtml(url, { skipRobots: true, apifyToken: 't' });
  expect(r).toMatchObject({ via: 'direkt', html: '<html>klein</html>', apifyGescheitert: 'apify_500' });
});

describe('Apify: kein Ergebnis ist keine Aussage über die Seite (Prüfrunde 04.10.2026)', () => {
  const apify = (opts = {}) => fetchHtml(host(), { requiresJS: true, apifyToken: 't', ...opts });

  test('400 run-failed → SeiteNichtAbrufbarError', async () => {
    antworten.push(antwort(400, JSON.stringify({ error: { type: 'run-failed' } })));
    await expect(apify()).rejects.toMatchObject({ name: 'SeiteNichtAbrufbarError', status: 400, grund: 'apify_400' });
  });

  test('leerer Datensatz → SeiteNichtAbrufbarError apify_leer', async () => {
    antworten.push(antwort(200, '[]'));
    await expect(apify()).rejects.toMatchObject({ name: 'SeiteNichtAbrufbarError', grund: 'apify_leer' });
  });

  test('Markdown unter 100 Zeichen → apify_leer', async () => {
    antworten.push(antwort(200, JSON.stringify([{ markdown: 'Access denied', crawl: { httpStatusCode: 200 } }])));
    await expect(apify()).rejects.toMatchObject({ grund: 'apify_leer' });
  });

  test('unlesbare Antwort → apify_antwort', async () => {
    antworten.push(antwort(200, '<html>kein json</html>'));
    await expect(apify()).rejects.toMatchObject({ grund: 'apify_antwort' });
  });

  test('Zielseite 404 → null (gibt es nicht), 403 → SeiteNichtAbrufbarError', async () => {
    antworten.push(antwort(200, JSON.stringify([{ markdown: 'x'.repeat(200), crawl: { httpStatusCode: 404 } }])));
    await expect(apify()).resolves.toBeNull();
    antworten.push(antwort(200, JSON.stringify([{ markdown: 'x'.repeat(200), crawl: { httpStatusCode: 403 } }])));
    await expect(apify()).rejects.toMatchObject({ name: 'SeiteNichtAbrufbarError', status: 403 });
  });

  test('Aktor nicht gefunden (404) oder kein Token → FetchUnavailableError (betrifft jede Seite)', async () => {
    antworten.push(antwort(404, 'actor not found'));
    await expect(apify()).rejects.toBeInstanceOf(FetchUnavailableError);
    const vorher = process.env.APIFY_API_TOKEN;
    delete process.env.APIFY_API_TOKEN;
    try {
      await expect(fetchHtml(host(), { requiresJS: true })).rejects.toBeInstanceOf(FetchUnavailableError);
    } finally {
      if (vorher !== undefined) process.env.APIFY_API_TOKEN = vorher;
    }
  });
});
