/**
 * Tests für src/writer.js gegen eine Firestore-Attrappe: Transaktion,
 * feldweises Zusammenführen, nie mehr `merge: false`.
 *
 * @jest-environment node
 */

'use strict';

// Firestore-Attrappe aus den Tests der cashback-pipeline — nur Testcode, im
// Laufzeitcode teilen die Codebases nichts.
jest.mock('firebase-admin', () => require('../../cashback-pipeline/__tests__/helpers/fakeAdmin').erstelleFakeAdmin());

const admin = require('firebase-admin');
const { writeScrapeResult, SCHEMA_VERSION } = require('../src/writer');

const EAN = '4311501099278';
const PFAD = `nutritionscrape/${EAN}`;
const store = () => admin.__fake.store;

beforeEach(() => {
  store().clear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

const befund = (extra = {}) => ({
  attr_ingredientStatement: 'Zucker, Haselnüsse 13 %',
  _confidence: 0.9,
  _model: 'gemini-3.5-flash',
  _tokensIn: 2400,
  _tokensOut: 500,
  ...extra,
});

test('neues Dokument: Felder, fetchedAt, Telemetrie', async () => {
  const r = await writeScrapeResult({
    ean: EAN,
    extracted: befund({ productName: 'Nuss Nougat Creme', eanBeleg: 'jsonld_gtin', attr_preis: 2.39, priceShop: 'morgenmarkt', priceCurrency: 'EUR' }),
    sourceUrl: 'https://morgenmarkt.de/p',
    sourceShop: 'morgenmarkt',
  });
  expect(r.result).toBe('written');
  const doc = store().get(PFAD);
  expect(doc).toMatchObject({
    gtin: EAN,
    scrapedSource: 'scraper',
    sourceShop: 'morgenmarkt',
    productName: 'Nuss Nougat Creme',
    eanBeleg: 'jsonld_gtin',
    attr_preis: 2.39,
    priceShop: 'morgenmarkt',
    priceCurrency: 'EUR',
    schemaVersion: SCHEMA_VERSION,
  });
  expect(doc.fetchedAt.toMillis()).toEqual(expect.any(Number));
  expect(doc.priceFetchedAt.toMillis()).toEqual(expect.any(Number));
  expect(doc.scrapedAt.toMillis()).toEqual(expect.any(Number));
  expect(doc).not.toHaveProperty('productPath');
  expect(store().get('nutritionscrape_telemetry/morgenmarkt')).toMatchObject({ successCount: 1 });
});

test('höhere Sicherheit löscht keine Felder mehr und behält productPath', async () => {
  store().set(PFAD, {
    gtin: EAN,
    productPath: 'produkte/abc',
    scrapedSource: 'scraper',
    scrapedAt: 'alt',
    fetchedAt: 'alt',
    sourceShop: 'openfoodfacts',
    confidence: 0.7,
    attr_ingredientStatement: 'Zucker, Haselnüsse 13 %',
    nutr_Fett_val: 31,
    nutr_Fett_unit: 'g',
  });
  await writeScrapeResult({
    ean: EAN,
    extracted: befund({ _confidence: 0.95, attr_ingredientStatement: null, attr_hersteller: 'Globus' }),
    sourceUrl: 'https://produkte.globus.de/p',
    sourceShop: 'globus',
  });
  const doc = store().get(PFAD);
  expect(doc.productPath).toBe('produkte/abc');
  expect(doc.nutr_Fett_val).toBe(31);
  expect(doc.attr_ingredientStatement).toBe('Zucker, Haselnüsse 13 %');
  expect(doc.attr_hersteller).toBe('Globus');
  expect(doc.sourceShop).toBe('globus');
});

test('Fehlversuch-Marker wird bei Erfolg aufgehoben', async () => {
  store().set(PFAD, { gtin: EAN, _failed: true, _failCount: 2 });
  await writeScrapeResult({ ean: EAN, extracted: befund(), sourceUrl: 'https://produkte.globus.de/p', sourceShop: 'globus' });
  const doc = store().get(PFAD);
  expect(doc).not.toHaveProperty('_failed');
  expect(doc._failCount).toBe(2);
});

test('auffrischen: neuer Preis trotz niedrigerer Sicherheit, alte Begleitangaben weg', async () => {
  store().set(PFAD, {
    gtin: EAN,
    scrapedSource: 'scraper',
    scrapedAt: 'alt',
    fetchedAt: 'alt',
    sourceShop: 'globus',
    confidence: 0.95,
    attr_preis: 2.29,
    attr_preisPerKg: 5.73,
    priceShop: 'globus',
  });
  await writeScrapeResult({
    ean: EAN,
    extracted: befund({ _confidence: 0.6, attr_preis: 2.49, priceShop: 'atundo', priceCurrency: 'EUR' }),
    sourceUrl: 'https://www.atundo.com/shop/p',
    sourceShop: 'atundo',
    auffrischen: true,
  });
  const doc = store().get(PFAD);
  expect(doc).toMatchObject({ attr_preis: 2.49, priceShop: 'atundo', sourceShop: 'globus' });
  expect(doc).not.toHaveProperty('attr_preisPerKg');
  expect(doc.priceFetchedAt.toMillis()).toEqual(expect.any(Number));
});

test('nichts Neues: nur fetchedAt, scrapedAt bleibt', async () => {
  store().set(PFAD, {
    gtin: EAN,
    scrapedSource: 'scraper',
    scrapedAt: 'alt',
    fetchedAt: 'alt',
    scrapedUrl: 'https://produkte.globus.de/p',
    sourceUrl: 'https://produkte.globus.de/p',
    sourceShop: 'globus',
    confidence: 0.9,
    model: 'gemini-3.5-flash',
    tokensIn: 2400,
    tokensOut: 500,
    schemaVersion: SCHEMA_VERSION,
    attr_ingredientStatement: 'Zucker, Haselnüsse 13 %',
  });
  const r = await writeScrapeResult({ ean: EAN, extracted: befund(), sourceUrl: 'https://produkte.globus.de/p', sourceShop: 'globus' });
  expect(r.result).toBe('skip_no_new_fields');
  const doc = store().get(PFAD);
  expect(doc.scrapedAt).toBe('alt');
  expect(doc.fetchedAt.toMillis()).toEqual(expect.any(Number));
});

// ─── Prüfrunde 04.10.2026 ─────────────────────────────────────────

const VIOLEY = 'https://www.violey.com/de/dennree-knusper-mix-dinkel_p_35278.html';
const altbestand = (extra = {}) => ({
  gtin: EAN,
  scrapedSource: 'scraper',
  scrapedAt: 'alt',
  scrapedUrl: VIOLEY,
  sourceUrl: VIOLEY,
  sourceShop: 'violey',
  confidence: 0.9,
  schemaVersion: 3,
  attr_ingredientStatement: 'Dinkel, Honig',
  attr_preis: 3.49,
  ...extra,
});

test('Befund kann feste Felder nicht setzen (Herkunft, Pfad, gtin, Zeitstempel)', async () => {
  await writeScrapeResult({
    ean: EAN,
    extracted: befund({ sourceShop: 'rewe.de', productPath: 'produkte/fremd', gtin: '999', sourceUrl: 'https://rewe.de/x', fetchedAt: 'gefälscht' }),
    sourceUrl: 'https://www.fresh-store.eu/p',
    sourceShop: 'fresh-store',
  });
  const doc = store().get(PFAD);
  expect(doc).toMatchObject({ gtin: EAN, sourceShop: 'fresh-store', sourceUrl: 'https://www.fresh-store.eu/p' });
  expect(doc).not.toHaveProperty('productPath');
  expect(doc.fetchedAt.toMillis()).toEqual(expect.any(Number));
});

test('Altbestand vor v4: der belegte Fund ersetzt ihn, productPath bleibt', async () => {
  store().set(PFAD, altbestand({ productPath: 'produkte/abc' }));
  const r = await writeScrapeResult({
    ean: EAN,
    extracted: befund({ _confidence: 0.6, attr_ingredientStatement: 'Wasser, Hafer' }),
    sourceUrl: 'https://produkte.globus.de/p',
    sourceShop: 'globus',
  });
  expect(r).toMatchObject({ result: 'written', mode: 'ersetzen', altdatenWiderlegt: false });
  const doc = store().get(PFAD);
  expect(doc).toMatchObject({ productPath: 'produkte/abc', attr_ingredientStatement: 'Wasser, Hafer', sourceShop: 'globus', schemaVersion: SCHEMA_VERSION });
  expect(doc).not.toHaveProperty('attr_preis');
});

test('Widerlegung ohne neuen Fund: Altbestand-Daten weg, Vermerk da', async () => {
  store().set(PFAD, altbestand());
  const r = await writeScrapeResult({ ean: EAN, extracted: null, widerlegung: { url: VIOLEY, grund: 'ean_not_in_html' } });
  expect(r).toEqual({ result: 'widerlegt', altdatenWiderlegt: true });
  const doc = store().get(PFAD);
  expect(doc).toMatchObject({ gtin: EAN, widerlegtGrund: 'ean_not_in_html', widerlegtUrl: VIOLEY });
  expect(doc.widerlegtAm.toMillis()).toEqual(expect.any(Number));
  for (const k of ['attr_ingredientStatement', 'attr_preis', 'scrapedSource', 'scrapedAt', 'sourceUrl', 'sourceShop', 'confidence']) {
    expect(doc).not.toHaveProperty(k);
  }
});

test('Widerlegung trifft belegte Daten (v4) nie', async () => {
  store().set(PFAD, altbestand({ fetchedAt: 'v4', schemaVersion: 4 }));
  const r = await writeScrapeResult({ ean: EAN, extracted: null, widerlegung: { url: VIOLEY, grund: 'ean_not_in_html' } });
  expect(r).toEqual({ result: 'skip_empty', altdatenWiderlegt: false });
  expect(store().get(PFAD).attr_ingredientStatement).toBe('Dinkel, Honig');
});

test('Widerlegung mit neuem Fund: ersetzt und vermerkt', async () => {
  store().set(PFAD, altbestand());
  const r = await writeScrapeResult({
    ean: EAN,
    extracted: befund({ attr_ingredientStatement: 'Haselnüsse' }),
    sourceUrl: 'https://morgenmarkt.de/p',
    sourceShop: 'morgenmarkt',
    widerlegung: { url: VIOLEY, grund: 'gtin_widerspruch' },
  });
  expect(r).toMatchObject({ mode: 'ersetzen', altdatenWiderlegt: true });
  const doc = store().get(PFAD);
  expect(doc).toMatchObject({ attr_ingredientStatement: 'Haselnüsse', sourceShop: 'morgenmarkt', widerlegtGrund: 'gtin_widerspruch' });
  expect(doc).not.toHaveProperty('attr_preis');
});
