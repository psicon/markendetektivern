/**
 * Tests für src/befund.js — Vertrauen der Quelle, Preisregeln (Euro,
 * DE/AT-Shop), Name/Bild nur mit Beleg. Seitendaten aus echten Shopseiten.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { bereiteBefund } = require('../src/befund');
const { analysiereSeite } = require('../src/seitenDaten');
const { preisLandErlaubt } = require('../src/domains');

const seite = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.html`), 'utf8');

const kiErgebnis = (extra = {}) => ({
  attr_ingredientStatement: 'Zucker, Haselnüsse',
  nutr_Energie_val: 540,
  nutr_Energie_unit: 'kcal',
  attr_preis: 2.39,
  attr_preisPackgroesse: '400 g',
  _confidence: 0.9,
  _model: 'gemini-3.5-flash',
  _kiProduktName: null,
  _kiEinzelprodukt: true,
  _kiBildUrl: null,
  ...extra,
});

const shop = { shop: 'morgenmarkt', priceOnly: false, noPriceTrust: false };

describe('Preis', () => {
  const analyse = analysiereSeite({ inhalt: seite('morgenmarkt-4311501099278'), ean: '4311501099278' });

  test('DE-Shop, Euro → Preis mit priceShop und priceCurrency', () => {
    const b = bereiteBefund({ extracted: kiErgebnis(), analyse, kandidat: shop, finalUrl: 'https://morgenmarkt.de/p' });
    expect(b).toMatchObject({ attr_preis: 2.39, attr_preisPackgroesse: '400 g', priceShop: 'morgenmarkt', priceCurrency: 'EUR' });
  });

  test('Schweizer Shop → Preis verworfen, Rest bleibt', () => {
    const b = bereiteBefund({ extracted: kiErgebnis(), analyse, kandidat: { shop: 'puravita.ch' }, finalUrl: 'https://puravita.ch/p' });
    expect(b.attr_preis).toBeUndefined();
    expect(b.attr_preisPackgroesse).toBeUndefined();
    expect(b.priceShop).toBeUndefined();
    expect(b.attr_ingredientStatement).toBe('Zucker, Haselnüsse');
  });

  test('Seite nennt eine andere Währung → Preis verworfen', () => {
    const fremd = { ...analyse, waehrung: 'CHF' };
    const b = bereiteBefund({ extracted: kiErgebnis(), analyse: fremd, kandidat: shop, finalUrl: 'https://morgenmarkt.de/p' });
    expect(b.attr_preis).toBeUndefined();
  });

  test('noPriceTrust (Datenbank/unbekannte Domain) → kein Preis — gilt jetzt auch in scrapeEan', () => {
    const b = bereiteBefund({ extracted: kiErgebnis(), analyse, kandidat: { shop: 'fddb', noPriceTrust: true }, finalUrl: 'https://fddb.info/p' });
    expect(b.attr_preis).toBeUndefined();
    expect(b.nutr_Energie_val).toBe(540);
  });

  test('priceOnly (Aggregator) → nur Preis, kein Name', () => {
    const b = bereiteBefund({
      extracted: kiErgebnis({ _kiProduktName: 'Nuss Nougat' }),
      analyse,
      kandidat: { shop: 'discounto', priceOnly: true },
      finalUrl: 'https://www.discounto.de/p',
    });
    expect(b.attr_ingredientStatement).toBeUndefined();
    expect(b.productName).toBeUndefined();
    expect(b.attr_preis).toBe(2.39);
  });

  test('KI ohne Preis → Preis aus dem JSON-LD-Angebot des belegten Produkts (globus)', () => {
    const g = analysiereSeite({ inhalt: seite('globus-3600524137564'), ean: '3600524137564' });
    const b = bereiteBefund({
      extracted: kiErgebnis({ attr_preis: null, attr_preisPackgroesse: null }),
      analyse: g,
      kandidat: { shop: 'globus' },
      finalUrl: 'https://produkte.globus.de/x',
    });
    expect(b.attr_preis).toBe(3.79);
    expect(b.priceShop).toBe('globus');
    expect(b.attr_preisPackgroesse ?? null).toBeNull(); // null schreibt der Writer nie
  });

  test('KI-Preis weicht vom JSON-LD-Angebot des belegten Produkts ab → JSON-LD gilt, KI-Packungsangaben fallen weg', () => {
    const g = analysiereSeite({ inhalt: seite('globus-3600524137564'), ean: '3600524137564' });
    const b = bereiteBefund({
      extracted: kiErgebnis({ attr_preis: 2.99, attr_preisPackgroesse: '6 Stück', attr_preisPerKg: 9.9 }),
      analyse: g,
      kandidat: { shop: 'globus' },
      finalUrl: 'https://produkte.globus.de/x',
    });
    expect(b.attr_preis).toBe(3.79);
    expect(b).not.toHaveProperty('attr_preisPackgroesse');
    expect(b).not.toHaveProperty('attr_preisPerKg');
  });

  test('passendes Produkt auf einer Seite mit mehreren, KI meldet mehrere → nur JSON-LD-Preis und Name, keine KI-Daten', () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { '@type': 'Product', name: 'Unser Kakao 500 g', gtin13: '4311501099278', offers: { price: '2.49', priceCurrency: 'EUR' } },
      { '@type': 'Product', name: 'Anderer Kakao', gtin13: '4006040000000', offers: { price: '1.29', priceCurrency: 'EUR' } },
    ])}</script><p>Kakao-Auswahl</p>`;
    const a = analysiereSeite({ inhalt: html, ean: '4311501099278' });
    const b = bereiteBefund({
      extracted: kiErgebnis({ attr_preis: 1.29, _kiEinzelprodukt: false }),
      analyse: a,
      kandidat: shop,
      finalUrl: 'https://morgenmarkt.de/kakao',
    });
    expect(b.attr_preis).toBe(2.49);
    expect(b.productName).toBe('Unser Kakao 500 g');
    expect(b).not.toHaveProperty('attr_ingredientStatement');
    expect(b).not.toHaveProperty('nutr_Energie_val');
  });

  test('Preis 0 bleibt draußen', () => {
    const b = bereiteBefund({ extracted: kiErgebnis({ attr_preis: 0 }), analyse: { ...analyse, angebot: null }, kandidat: shop, finalUrl: 'https://morgenmarkt.de/p' });
    expect(b.attr_preis).toBeUndefined();
    expect(b.attr_preisPackgroesse).toBeUndefined();
  });
});

describe('Identität im Befund', () => {
  test('nur Datenfelder und KI-Meta: fremde Schlüssel der KI-Antwort fallen weg', () => {
    const analyse = analysiereSeite({ inhalt: seite('morgenmarkt-4311501099278'), ean: '4311501099278' });
    const b = bereiteBefund({
      extracted: kiErgebnis({ productPath: 'produkte/x', sourceShop: 'rewe.de', gtin: '1', eanBeleg: 'jsonld_gtin', _irgendwas: 1 }),
      analyse,
      kandidat: shop,
      finalUrl: 'https://morgenmarkt.de/p',
    });
    for (const k of ['productPath', 'sourceShop', 'gtin', '_irgendwas']) expect(b).not.toHaveProperty(k);
    expect(b.eanBeleg).toBe('jsonld_gtin'); // aus der Belegprüfung, nicht aus der KI
  });

  test('Name/Bild/Beleg aus den Seitendaten, _ki-Felder nicht im Befund', () => {
    const analyse = analysiereSeite({ inhalt: seite('morgenmarkt-4311501099278'), ean: '4311501099278' });
    const b = bereiteBefund({
      extracted: kiErgebnis({ _kiProduktName: 'Gut & Günstig Nuss Nougat Creme 400 g' }),
      analyse,
      kandidat: shop,
      finalUrl: 'https://morgenmarkt.de/p',
    });
    expect(b.productName).toBe('Gut & Günstig Nuss Nougat Creme 400 g');
    expect(b.eanBeleg).toBe('jsonld_gtin');
    expect(b.shopBildUrl).toMatch(/^https:\/\/morgenmarkt\.de\/images\/products\//);
    expect(Object.keys(b).some((k) => k.startsWith('_ki'))).toBe(false);
    expect(b._confidence).toBe(0.9);
  });
});

describe('preisLandErlaubt', () => {
  test.each([
    ['https://produkte.globus.de/x', true],
    ['https://www.billa.at/x', true],
    ['https://www.atundo.com/shop/x', true], // kuratierte SHOPS-Liste
    ['https://www.shop-apotheke.com/x', true], // gemessene Ergänzung
    ['https://puravita.ch/x', false],
    ['https://www.houra.fr/x', false],
    ['https://4ecoshop.co.uk/x', false],
    ['https://nalda.com/x', false], // unbekannter .com-Shop
    ['https://deguo.com.tw/x', false],
    ['kaputt', false],
  ])('%s → %s', (url, erwartet) => {
    expect(preisLandErlaubt(url)).toBe(erwartet);
  });
});
