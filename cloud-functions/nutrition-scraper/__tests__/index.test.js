/**
 * Durchstich durch die HTTP-Endpunkte (index.js) mit Attrappen für Firestore,
 * Serper, Seitenabruf und KI: Parameter, Auffrischen über die bevorzugte
 * Seite, 503 bei reinen Abruffehlern, scrapeBatch (Katalog) weiterhin mit
 * productPath und Fehlversuch-Marker.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const z = { serper: [], serperAufrufe: 0, serperFehler: null, seiten: {}, abrufe: [], ki: null };

jest.mock('firebase-functions/v2/https', () => ({ onRequest: (_opts, handler) => handler }));
jest.mock('firebase-functions/params', () => ({
  defineSecret: (name) => ({ value: () => (name === 'NUTRITION_SCRAPER_TRIGGER_KEY' ? 'schluessel' : `wert-${name}`) }),
}));
jest.mock('firebase-admin', () => {
  const fake = require('../../cashback-pipeline/__tests__/helpers/fakeAdmin').erstelleFakeAdmin();
  fake.firestore.FieldPath = { documentId: () => '__name__' };
  return fake;
});
jest.mock('../src/serperSearch', () => ({
  searchByEan: async () => {
    z.serperAufrufe += 1;
    if (z.serperFehler) throw z.serperFehler;
    return z.serper.map((link) => ({ link }));
  },
}));
jest.mock('../src/fetcher', () => {
  const { SeiteNichtAbrufbarError } = jest.requireActual('../src/fehler');
  return {
    fetchHtml: async (url) => {
      z.abrufe.push(url);
      const s = z.seiten[url];
      if (s === 403) throw new SeiteNichtAbrufbarError(url, { status: 403 });
      if (!s) return null;
      return { html: s, finalUrl: url, via: 'direkt' };
    },
  };
});
jest.mock('../src/extractor', () => ({ extractFromHtml: async (args) => z.ki(args) }));

const admin = require('firebase-admin');
const { scrapeEan, scrapeBatch } = require('../index');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.html`), 'utf8');
const GLOBUS_URL = 'https://produkte.globus.de/koerperpflege/3600524137564/elvital-shampoo-color-glanz';

function antwortAttrappe() {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}
const post = (body) => ({ method: 'POST', body: { key: 'schluessel', ...body }, query: {} });

beforeEach(() => {
  z.serper = [];
  z.serperAufrufe = 0;
  z.serperFehler = null;
  z.seiten = {};
  z.abrufe = [];
  z.ki = async () => ({
    attr_ingredientStatement: 'Aqua, Sodium Laureth Sulfate',
    attr_preis: null,
    _confidence: 0.9,
    _model: 'gemini-3.5-flash',
    _kiProduktName: null,
    _kiEinzelprodukt: true,
    _kiBildUrl: null,
  });
  admin.__fake.store.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('scrapeEan', () => {
  test('falscher Schlüssel → 401, ohne EAN → 400', async () => {
    const r1 = antwortAttrappe();
    await scrapeEan({ method: 'POST', body: { key: 'falsch', ean: '1' }, query: {} }, r1);
    expect(r1.code).toBe(401);
    const r2 = antwortAttrappe();
    await scrapeEan(post({}), r2);
    expect(r2.code).toBe(400);
  });

  test('Auffrischen über die bevorzugte Seite: keine Suche, Dokument mit Name, Preis, Zeitstempeln', async () => {
    z.seiten[GLOBUS_URL] = fixture('globus-3600524137564');
    const res = antwortAttrappe();
    await scrapeEan(post({ ean: '3600524137564', bevorzugteUrl: GLOBUS_URL, auffrischen: true, ohneOpenFoodFacts: true }), res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ result: 'ok', bevorzugteUrlGenutzt: true, successShop: 'globus' });
    expect(res.body.verbrauch).toMatchObject({ serperSuchen: 0 });
    expect(z.serperAufrufe).toBe(0);
    const doc = admin.__fake.store.get('nutritionscrape/3600524137564');
    expect(doc).toMatchObject({
      productName: 'Elvital Shampoo, Color Glanz',
      eanBeleg: 'jsonld_gtin',
      attr_preis: 3.79,
      priceShop: 'globus',
      priceCurrency: 'EUR',
      attr_ingredientStatement: 'Aqua, Sodium Laureth Sulfate',
    });
    expect(doc.fetchedAt.toMillis()).toEqual(expect.any(Number));
    expect(doc.priceFetchedAt.toMillis()).toEqual(expect.any(Number));
  });

  test('alle Kandidaten 403 → 503 fetch_unavailable, nichts geschrieben', async () => {
    z.serper = ['https://www.kaufland.de/p/1', 'https://produkte.globus.de/p/2'];
    z.seiten['https://www.kaufland.de/p/1'] = 403;
    z.seiten['https://produkte.globus.de/p/2'] = 403;
    z.seiten['https://www.codecheck.info/product.search?q=4311501099278'] = 403;
    const res = antwortAttrappe();
    await scrapeEan(post({ ean: '4311501099278', ohneOpenFoodFacts: true }), res);
    expect(res.code).toBe(503);
    expect(res.body).toMatchObject({ result: 'fetch_unavailable', abrufFehler: 3 });
    expect(z.abrufe.some((u) => u.includes('openfoodfacts'))).toBe(false);
    expect(admin.__fake.store.has('nutritionscrape/4311501099278')).toBe(false);
  });

  test('Seite eines anderen Produkts → kein KI-Aufruf, all_failed', async () => {
    let ki = 0;
    z.ki = async () => { ki += 1; return null; };
    z.serper = ['https://www.shop-apotheke.com/drogerie/19782442/x.htm'];
    z.seiten['https://www.shop-apotheke.com/drogerie/19782442/x.htm'] = fixture('shopapotheke-4069365317310');
    const res = antwortAttrappe();
    await scrapeEan(post({ ean: '4069365317310', ohneOpenFoodFacts: true }), res);
    expect(ki).toBe(0);
    expect(res.code).toBe(200);
    expect(res.body.result).toBe('all_failed');
  });

  test('nurDomains (RCN-8): nur Handelsketten werden geholt', async () => {
    z.serper = ['https://www.lidl.de/p/20003180', 'https://irgendein-shop.de/20003180'];
    const res = antwortAttrappe();
    await scrapeEan(post({ ean: '20003180', ohneOpenFoodFacts: true, nurDomains: ['lidl.de', 'penny.de'] }), res);
    expect(z.abrufe).toEqual(['https://www.lidl.de/p/20003180']);
    expect(res.body.result).toBe('all_failed');
  });
});

describe('scrapeEan — Altbestand (Prüfrunde 04.10.2026)', () => {
  const EAN = '4056489845881';
  const VIOLEY = 'https://www.violey.com/de/dennree-knusper-mix-dinkel_p_35278.html';
  const altbestand = () => ({
    gtin: EAN,
    scrapedSource: 'scraper',
    scrapedAt: 'alt',
    scrapedUrl: VIOLEY,
    sourceUrl: VIOLEY,
    sourceShop: 'violey.com',
    confidence: 0.9,
    schemaVersion: 3,
    attr_ingredientStatement: 'Dinkel, Honig',
  });

  test('Quellseite gehört zu einem anderen Produkt, nichts Neues → Daten entfernt, altdatenWiderlegt', async () => {
    admin.__fake.store.set(`nutritionscrape/${EAN}`, altbestand());
    z.seiten[VIOLEY] = fixture('violey-35278');
    const res = antwortAttrappe();
    await scrapeEan(post({ ean: EAN, bevorzugteUrl: VIOLEY, auffrischen: true, ohneOpenFoodFacts: true }), res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ result: 'all_failed', altdatenWiderlegt: true });
    const doc = admin.__fake.store.get(`nutritionscrape/${EAN}`);
    expect(doc).toMatchObject({ gtin: EAN, widerlegtGrund: 'ean_not_in_html', widerlegtUrl: VIOLEY });
    expect(doc).not.toHaveProperty('attr_ingredientStatement');
    expect(doc).not.toHaveProperty('scrapedSource');
  });

  test('Quellseite widerlegt, aber die Suche fällt aus (Serper, 503) → nichts entfernt', async () => {
    const { SearchUnavailableError } = jest.requireActual('../src/fehler');
    admin.__fake.store.set(`nutritionscrape/${EAN}`, altbestand());
    z.seiten[VIOLEY] = fixture('violey-35278');
    z.serperFehler = new SearchUnavailableError('Guthaben leer');
    const res = antwortAttrappe();
    await scrapeEan(post({ ean: EAN, bevorzugteUrl: VIOLEY, auffrischen: true, ohneOpenFoodFacts: true }), res);
    expect(res.code).toBe(503);
    expect(admin.__fake.store.get(`nutritionscrape/${EAN}`).attr_ingredientStatement).toBe('Dinkel, Honig');
  });

  test('Quellseite widerlegt, die Suche findet eine richtige Seite → Altbestand ersetzt, nicht ergänzt', async () => {
    admin.__fake.store.set(`nutritionscrape/${EAN}`, { ...altbestand(), attr_hersteller: 'dennree' });
    z.seiten[VIOLEY] = fixture('violey-35278');
    const RICHTIG = 'https://morgenmarkt.de/x-p-4056489845881';
    z.serper = [RICHTIG];
    z.seiten[RICHTIG] = `<html><head><meta property="og:type" content="product"><title>Knusper Müsli 750 g</title></head><body><h1>Knusper Müsli 750 g</h1><p>EAN: ${EAN}</p></body></html>`;
    z.ki = async () => ({ attr_ingredientStatement: 'Haferflocken', _confidence: 0.9, _model: 'm', _kiEinzelprodukt: true });
    const res = antwortAttrappe();
    await scrapeEan(post({ ean: EAN, bevorzugteUrl: VIOLEY, auffrischen: true, ohneOpenFoodFacts: true }), res);
    expect(res.body).toMatchObject({ result: 'ok', altdatenWiderlegt: true });
    const doc = admin.__fake.store.get(`nutritionscrape/${EAN}`);
    expect(doc).toMatchObject({ attr_ingredientStatement: 'Haferflocken', productName: 'Knusper Müsli 750 g', widerlegtGrund: 'ean_not_in_html' });
    expect(doc).not.toHaveProperty('attr_hersteller');
  });

  test('Kostenzeile: auftrag produktsuche, auch bei einem 500', async () => {
    const zeilen = [];
    console.log.mockImplementation((x) => zeilen.push(x));
    z.serper = [GLOBUS_URL];
    z.seiten[GLOBUS_URL] = fixture('globus-3600524137564');
    z.ki = async () => { throw new TypeError('Programmfehler'); };
    const res = antwortAttrappe();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await scrapeEan(post({ ean: '3600524137564', ohneOpenFoodFacts: true }), res);
    expect(res.code).toBe(500);
    const lauf = zeilen.filter((x) => typeof x === 'string' && x.includes('"produktsuche_lauf"')).map((x) => JSON.parse(x));
    expect(lauf).toEqual([expect.objectContaining({ ergebnis: 'fehler_500', auftrag: 'produktsuche', katalogPfad: false })]);
    expect(lauf[0].verbrauch.serperSuchen).toBe(1);
  });
});

describe('scrapeBatch (Katalog) bleibt funktionsfähig', () => {
  test('Fund wird mit productPath geschrieben', async () => {
    admin.__fake.store.set('produkte/p1', { name: 'Elvital', EANs: ['3600524137564'] });
    z.serper = [GLOBUS_URL];
    z.seiten[GLOBUS_URL] = fixture('globus-3600524137564');
    const res = antwortAttrappe();
    await scrapeBatch({ method: 'POST', body: { key: 'schluessel', collection: 'produkte', limit: 5 }, query: {} }, res);
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ scrape_ok: 1 });
    const doc = admin.__fake.store.get('nutritionscrape/3600524137564');
    expect(doc).toMatchObject({ productPath: 'produkte/p1', attr_ingredientStatement: 'Aqua, Sodium Laureth Sulfate' });
  });

  test('nur Abruffehler → kein Fehlversuch-Marker (sonst nach 3 Läufen für immer übersprungen)', async () => {
    admin.__fake.store.set('produkte/p2', { name: 'X', EANs: ['4311501099278'] });
    z.serper = ['https://www.kaufland.de/p/1'];
    z.seiten['https://www.kaufland.de/p/1'] = 403;
    z.seiten['https://de.openfoodfacts.org/produkt/4311501099278'] = 403;
    z.seiten['https://www.codecheck.info/product.search?q=4311501099278'] = 403;
    const res = antwortAttrappe();
    await scrapeBatch({ method: 'POST', body: { key: 'schluessel', collection: 'produkte', limit: 5 }, query: {} }, res);
    expect(res.body).toMatchObject({ abruf_fehler: 1, scrape_failed: 0 });
    expect(admin.__fake.store.has('nutritionscrape/4311501099278')).toBe(false);
  });

  // Prüfrunde 3: Codecheck/OpenFoodFacts hängen an jeder EAN und antworten
  // immer — ihre Antwort ist keine Aussage über das Produkt (wie scrapeEan).
  test('Shopseite gesperrt, nur Rückfall-Adressen antworten → kein Fehlversuch-Marker', async () => {
    admin.__fake.store.set('produkte/p4', { name: 'Z', EANs: ['4311501099278'] });
    z.serper = ['https://www.kaufland.de/p/1'];
    z.seiten['https://www.kaufland.de/p/1'] = 403;
    const res = antwortAttrappe();
    await scrapeBatch({ method: 'POST', body: { key: 'schluessel', collection: 'produkte', limit: 5 }, query: {} }, res);
    expect(z.abrufe.length).toBeGreaterThan(1); // Rückfall-Adressen wurden geholt
    expect(res.body).toMatchObject({ abruf_fehler: 1, scrape_failed: 0 });
    expect(admin.__fake.store.has('nutritionscrape/4311501099278')).toBe(false);
  });

  test('beantwortete Seiten ohne Daten → Fehlversuch-Marker wie bisher', async () => {
    admin.__fake.store.set('produkte/p3', { name: 'Y', EANs: ['4311501099278'] });
    z.serper = [];
    const res = antwortAttrappe();
    await scrapeBatch({ method: 'POST', body: { key: 'schluessel', collection: 'produkte', limit: 5 }, query: {} }, res);
    expect(res.body).toMatchObject({ scrape_failed: 1 });
    expect(admin.__fake.store.get('nutritionscrape/4311501099278')).toMatchObject({ _failed: true, _lastFailReason: 'all_candidates_failed' });
  });
});
