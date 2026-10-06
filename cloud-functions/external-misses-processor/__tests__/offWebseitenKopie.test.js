/**
 * Die Regel „ungeprüfter Altbestand einer OpenFoodFacts-Seite" steht zweimal
 * (Codebases teilen keinen Code):
 *   external-product-lookup/lib/rohablage.js     istOffWebseitenAltbestand
 *   external-misses-processor/src/regeln.js      istOffWebseitenAltbestand
 * Weichen sie ab, übernimmt die Abfrage Daten, die der Prozessor nicht als
 * früheren Fund zählt (oder umgekehrt) — der Fall bliebe still 'resolved'
 * oder würde unnötig bezahlt gesucht. Dieser Test hält sie gleich.
 *
 * @jest-environment node
 */

'use strict';

const prozessor = require('../src/regeln');
const abfrage = require('../../external-product-lookup/lib/rohablage');

const ADRESSEN = [
  undefined,
  null,
  '',
  '   ',
  42,
  'kein url',
  'https://de.openfoodfacts.org/produkt/4000540031874/x',
  'https://world.openfoodfacts.org/product/4000540031874',
  'http://openfoodfacts.org/product/4000540031874',
  'de.openfoodfacts.org/produkt/4000540031874',
  'https://WWW.OpenFoodFacts.org/product/1',
  'https://world.openbeautyfacts.org/product/4066447870237/balea',
  'https://de.openpetfoodfacts.org/produkt/1/x',
  'https://world.openproductsfacts.org/product/1/x',
  'https://openfoodfacts.org.example.com/x',
  'https://www.globus.de/p/4005500084136',
  'https://shop.rewe.de/p/x/1',
  'https://www.rossmann.de/p/4337256123456',
  'ftp://de.openfoodfacts.org/x',
];
const SHOPS = [
  undefined,
  null,
  '',
  'openfoodfacts',
  ' OpenFoodFacts ',
  'openbeautyfacts',
  'de.openfoodfacts.org',
  'world.openbeautyfacts.org',
  'openfood-shop.de',
  'globus',
  'rewe',
  'shop.rewe.de',
  'metro',
  'rossmann',
  'scraper',
  123,
  ['openfoodfacts'],
];
const ZEITEN = [
  { scrapedSource: 'scraper', scrapedAt: 1 },
  { scrapedSource: 'scraper' },
  { scrapedAt: 1 },
  { scrapedSource: 'scraper', scrapedAt: 1, fetchedAt: 2 },
  { gtin: '1' }, // reiner Fehlversuch-Marker
];

describe('istOffWebseitenAltbestand: Abfrage und Prozessor entscheiden gleich', () => {
  test('über alle Kombinationen aus Adresse, sourceUrl, Shop und Zeitstempeln', () => {
    const abweichungen = [];
    let faelle = 0;
    for (const zeit of ZEITEN) {
      for (const scrapedUrl of ADRESSEN) {
        for (const sourceUrl of [undefined, 'https://de.openfoodfacts.org/produkt/1/x', 'https://world.openbeautyfacts.org/product/1/x']) {
          for (const sourceShop of SHOPS) {
            const d = { ...zeit, scrapedUrl, sourceUrl, sourceShop };
            faelle += 1;
            const a = abfrage.istOffWebseitenAltbestand(d);
            const p = prozessor.istOffWebseitenAltbestand(d);
            if (a !== p) abweichungen.push({ d, abfrage: a, prozessor: p });
          }
        }
      }
    }
    expect(faelle).toBeGreaterThan(1000);
    expect(abweichungen).toEqual([]);
  });

  test('Ankerfälle (Schlussprüfung 04.10.2026)', () => {
    const alt = { scrapedSource: 'scraper', scrapedAt: 1, sourceShop: 'openfoodfacts' };
    for (const regel of [abfrage.istOffWebseitenAltbestand, prozessor.istOffWebseitenAltbestand]) {
      expect(regel({ ...alt, scrapedUrl: 'https://de.openfoodfacts.org/produkt/1/x' })).toBe(true);
      expect(regel(alt)).toBe(true); // ohne Adresse: der Shop-Name
      // Bekannter Host, aber nicht openfoodfacts.org → nein, trotz sourceShop
      expect(regel({ ...alt, scrapedUrl: 'https://world.openbeautyfacts.org/product/4066447870237/balea' })).toBe(false);
      expect(regel({ ...alt, scrapedUrl: 'https://www.globus.de/p/1' })).toBe(false);
      expect(regel({ ...alt, scrapedUrl: 'https://de.openfoodfacts.org/produkt/1/x', fetchedAt: 2 })).toBe(false);
    }
  });
});
