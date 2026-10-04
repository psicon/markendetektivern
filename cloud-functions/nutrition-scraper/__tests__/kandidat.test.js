/**
 * Tests für src/kandidat.js — der gemeinsame Weg einer Seite: Abruf,
 * EAN-Beleg VOR der KI, Befund. Seitenabruf und KI sind Attrappen, die
 * Seiten echte Ausschnitte (fixtures/QUELLE.md).
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const zustand = { fetch: null, ki: null, kiAufrufe: 0 };
jest.mock('firebase-admin', () => require('../../cashback-pipeline/__tests__/helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('../src/fetcher', () => ({ fetchHtml: (...a) => zustand.fetch(...a) }));
jest.mock('../src/extractor', () => ({
  extractFromHtml: (...a) => {
    zustand.kiAufrufe += 1;
    return zustand.ki(...a);
  },
}));

const admin = require('firebase-admin');
const { leseKandidat } = require('../src/kandidat');
const { SeiteNichtAbrufbarError, ExtractUnavailableError } = require('../src/fehler');

const seite = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.html`), 'utf8');
const db = admin.firestore();

beforeEach(() => {
  zustand.kiAufrufe = 0;
  zustand.ki = async () => null;
  admin.__fake.store.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

const globus = { url: 'https://produkte.globus.de/x/3600524137564/elvital', shop: 'globus', requiresJS: false };

test('403 → abrufFehler, kein KI-Aufruf', async () => {
  zustand.fetch = async (url) => { throw new SeiteNichtAbrufbarError(url, { status: 403 }); };
  await expect(leseKandidat({ kandidat: globus, ean: '3600524137564', db })).resolves.toEqual({
    status: 'abrufFehler', httpStatus: 403, grund: 'http',
  });
  expect(zustand.kiAufrufe).toBe(0);
});

test('404/robots → keineSeite', async () => {
  zustand.fetch = async () => null;
  await expect(leseKandidat({ kandidat: globus, ean: '3600524137564', db })).resolves.toEqual({ status: 'keineSeite' });
});

test('shop-apotheke: gtin13 eines anderen Produkts → verworfen ohne KI, Telemetrie', async () => {
  zustand.fetch = async (url) => ({ html: seite('shopapotheke-4069365317310'), finalUrl: url, via: 'direkt' });
  const r = await leseKandidat({
    kandidat: { url: 'https://www.shop-apotheke.com/drogerie/19782442/x.htm', shop: 'shop-apotheke.com' },
    ean: '4069365317310',
    db,
  });
  expect(r).toEqual({ status: 'verworfen', grund: 'gtin_widerspruch' });
  expect(zustand.kiAufrufe).toBe(0);
  await new Promise((z) => setImmediate(z));
  expect(admin.__fake.store.get('nutritionscrape_telemetry/shop-apotheke_com')).toMatchObject({ lastFailReason: 'gtin_widerspruch' });
});

test('codecheck-Suchseite → verworfen (ean_not_in_html) ohne KI — früher bezahlter Aufruf', async () => {
  zustand.fetch = async (url) => ({ html: seite('codecheck-suche-4316268640695'), finalUrl: url, via: 'direkt' });
  const r = await leseKandidat({
    kandidat: { url: 'https://www.codecheck.info/product.search?q=4316268640695', shop: 'codecheck', noPriceTrust: true },
    ean: '4316268640695',
    db,
  });
  expect(r).toEqual({ status: 'verworfen', grund: 'ean_not_in_html' });
  expect(zustand.kiAufrufe).toBe(0);
});

test('globus: Treffer mit belegtem Namen, Bild und Preis aus JSON-LD', async () => {
  zustand.fetch = async (url) => ({ html: seite('globus-3600524137564'), finalUrl: url, via: 'direkt' });
  let kiArgs = null;
  zustand.ki = async (args) => {
    kiArgs = args;
    return {
      attr_hersteller: "L'Oréal",
      attr_preis: null,
      _confidence: 0.9,
      _model: 'gemini-3.5-flash',
      _kiProduktName: null,
      _kiEinzelprodukt: true,
      _kiBildUrl: null,
    };
  };
  const r = await leseKandidat({ kandidat: globus, ean: '3600524137564', productName: 'Shampoo', db });
  expect(kiArgs).toMatchObject({ ean: '3600524137564', rohName: 'Elvital Shampoo, Color Glanz', productName: 'Shampoo' });
  expect(r.status).toBe('treffer');
  expect(r.befund).toMatchObject({
    productName: 'Elvital Shampoo, Color Glanz',
    eanBeleg: 'jsonld_gtin',
    attr_preis: 3.79,
    priceShop: 'globus',
    priceCurrency: 'EUR',
  });
});

test('KI sagt „keine Produktseite“ → keineDaten ki_null', async () => {
  zustand.fetch = async (url) => ({ html: seite('globus-3600524137564'), finalUrl: url, via: 'direkt' });
  zustand.ki = async () => null;
  await expect(leseKandidat({ kandidat: globus, ean: '3600524137564', db })).resolves.toEqual({ status: 'keineDaten', grund: 'ki_null' });
});

test('nur EAN in Skriptdaten → verworfen ohne KI (kein Beleg für den Inhalt)', async () => {
  const html = '<html><body><script>window.p={"ean":"4311501099278"}</script></body></html>';
  zustand.fetch = async (url) => ({ html, finalUrl: url, via: 'direkt' });
  const r = await leseKandidat({ kandidat: { url: 'https://shop.de/p', shop: 'shop.de' }, ean: '4311501099278', db });
  expect(r).toEqual({ status: 'verworfen', grund: 'ean_not_in_html' });
  expect(zustand.kiAufrufe).toBe(0);
});

test('atundo-Seite für die fremde Keyword-EAN 4311501480939 → verworfen ohne KI', async () => {
  zustand.fetch = async (url) => ({ html: seite('atundo-4311501421840'), finalUrl: url, via: 'direkt' });
  zustand.ki = async () => ({ attr_ingredientStatement: 'Mais, Erdnüsse', attr_preis: 1.19, _confidence: 0.9, _kiEinzelprodukt: true });
  const r = await leseKandidat({
    kandidat: { url: 'https://www.atundo.com/shop/GutGuenstig-Erdnuss-Flips', shop: 'atundo' },
    ean: '4311501480939',
    db,
  });
  expect(r).toEqual({ status: 'verworfen', grund: 'ean_not_in_html' });
  expect(zustand.kiAufrufe).toBe(0);
});

test('Listenseite mit mehreren Produkten → verworfen ohne KI', async () => {
  const html = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'Product', name: 'Kakao A' }, { '@type': 'Product', name: 'Kakao B' },
  ])}</script><li>Kakao B — EAN 4311501099278 — 1,29 €</li>`;
  zustand.fetch = async (url) => ({ html, finalUrl: url, via: 'direkt' });
  const r = await leseKandidat({ kandidat: { url: 'https://shop.de/liste', shop: 'shop.de' }, ean: '4311501099278', db });
  expect(r).toEqual({ status: 'verworfen', grund: 'mehrere_produkte' });
  expect(zustand.kiAufrufe).toBe(0);
});

test('Seite ohne Strukturdaten, KI meldet mehrere Produkte → keineDaten mehrere_produkte', async () => {
  zustand.fetch = async (url) => ({ html: seite('freshstore-4305615633428'), finalUrl: url, via: 'direkt' });
  zustand.ki = async () => ({ attr_ingredientStatement: 'Aqua', attr_preis: 3.95, _confidence: 0.8, _kiEinzelprodukt: false });
  const r = await leseKandidat({ kandidat: { url: 'https://fresh-store.eu/de/p', shop: 'fresh-store' }, ean: '4305615633428', db });
  expect(r).toEqual({ status: 'keineDaten', grund: 'mehrere_produkte' });
});

test('Apify-Rendern der dünnen Seite scheiterte, Seite ohne EAN → Abruffehler, keine Telemetrie', async () => {
  zustand.fetch = async (url) => ({ html: '<html>Bitte warten …</html>', finalUrl: url, via: 'direkt', apifyGescheitert: 'apify_leer' });
  const r = await leseKandidat({ kandidat: { url: 'https://shop.de/p', shop: 'shop.de' }, ean: '4311501099278', db });
  expect(r).toEqual({ status: 'abrufFehler', httpStatus: null, grund: 'apify_leer' });
  await new Promise((z) => setImmediate(z));
  expect(admin.__fake.store.get('nutritionscrape_telemetry/shop_de')).toBeUndefined();
});

test('Apify scheiterte, aber die direkt geholte Seite belegt die EAN → normal weiter', async () => {
  zustand.fetch = async (url) => ({ html: seite('globus-3600524137564'), finalUrl: url, via: 'direkt', apifyGescheitert: 'apify_504' });
  zustand.ki = async () => ({ attr_hersteller: "L'Oréal", _confidence: 0.9, _kiEinzelprodukt: true });
  const r = await leseKandidat({ kandidat: globus, ean: '3600524137564', db });
  expect(r.status).toBe('treffer');
});

test('KI-Antwort mit fremden Feldern: nur Datenfelder landen im Befund', async () => {
  zustand.fetch = async (url) => ({ html: seite('freshstore-4305615633428'), finalUrl: url, via: 'direkt' });
  // So sähe eine Antwort aus, die der Extractor NICHT gefiltert hätte.
  zustand.ki = async () => ({
    attr_ingredientStatement: 'Aqua, Glycerin',
    productName: 'Injizierter Name',
    shopBildUrl: 'https://boese.example/bild.jpg',
    sourceShop: 'rewe.de',
    productPath: 'produkte/x',
    eanBeleg: 'jsonld_gtin',
    _confidence: 0.9,
    _kiEinzelprodukt: false,
  });
  const r = await leseKandidat({ kandidat: { url: 'https://fresh-store.eu/de/p', shop: 'fresh-store' }, ean: '4305615633428', db });
  // KI meldet mehrere Produkte (ohne Strukturdaten) → gar kein Inhalt
  expect(r.status).toBe('keineDaten');
  zustand.ki = async () => ({
    attr_ingredientStatement: 'Aqua, Glycerin',
    productName: 'Injizierter Name',
    sourceShop: 'rewe.de',
    productPath: 'produkte/x',
    _confidence: 0.9,
    _kiEinzelprodukt: null,
  });
  const r2 = await leseKandidat({ kandidat: { url: 'https://fresh-store.eu/de/p', shop: 'fresh-store' }, ean: '4305615633428', db });
  expect(r2.status).toBe('treffer');
  expect(r2.befund.attr_ingredientStatement).toBe('Aqua, Glycerin');
  expect(r2.befund.productName).not.toBe('Injizierter Name');
  for (const k of ['sourceShop', 'productPath']) expect(r2.befund).not.toHaveProperty(k);
  // das Bild stammt aus den Seitendaten (og:image), nicht aus der KI-Antwort
  expect(r2.befund.shopBildUrl).toMatch(/^https:\/\/www\.fresh-store\.eu\//);
});

test('unbekannte Domain: Qualitätsprüfung vor der KI', async () => {
  zustand.fetch = async (url) => ({ html: '<p>kurz 4311501099278</p>', finalUrl: url, via: 'direkt' });
  const r = await leseKandidat({
    kandidat: { url: 'https://unbekannt.example.com/p', shop: 'unbekannt.example.com', requiresQualityCheck: true, noPriceTrust: true },
    ean: '4311501099278',
    db,
  });
  expect(r).toEqual({ status: 'verworfen', grund: 'quality_check' });
});

test('KI-Ausfall wird weitergeworfen (scrapeEan → 503)', async () => {
  zustand.fetch = async (url) => ({ html: seite('globus-3600524137564'), finalUrl: url, via: 'direkt' });
  zustand.ki = async () => { throw new ExtractUnavailableError('weg'); };
  await expect(leseKandidat({ kandidat: globus, ean: '3600524137564', db })).rejects.toBeInstanceOf(ExtractUnavailableError);
});
