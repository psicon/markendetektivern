/**
 * Tests für src/resolver.js — Filter ohneOpenFoodFacts/nurDomains und die
 * Einordnung einer bekannten Adresse (bevorzugteUrl). Suche nur per EAN.
 *
 * @jest-environment node
 */

'use strict';

const suche = { treffer: [], anfragen: [] };
jest.mock('firebase-admin', () => require('../../cashback-pipeline/__tests__/helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('../src/serperSearch', () => ({
  searchByEan: async ({ ean }) => {
    suche.anfragen.push(ean);
    return suche.treffer.map((link) => ({ link }));
  },
}));

const { resolveCandidates, kandidatFuerUrl } = require('../src/resolver');

beforeEach(() => {
  suche.treffer = [];
  suche.anfragen = [];
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

test('ohne Filter: wie bisher, OpenFoodFacts und codecheck als Rückfall am Ende', async () => {
  suche.treffer = ['https://produkte.globus.de/p/4311501099278', 'https://www.ebay.de/itm/1'];
  const verbrauch = {};
  const k = await resolveCandidates(['4311501099278'], { serper: { apiKey: 'k' }, verbrauch });
  expect(suche.anfragen).toEqual(['4311501099278']); // Suche per EAN
  expect(verbrauch.serperSuchen).toBe(1);
  expect(k.map((x) => x.shop)).toEqual(['globus', 'openfoodfacts', 'codecheck']);
});

test('ohneOpenFoodFacts: keine openfoodfacts-Seiten, auch nicht als Rückfall', async () => {
  suche.treffer = ['https://world.openfoodfacts.org/product/4311501099278', 'https://produkte.globus.de/p/1'];
  const k = await resolveCandidates(['4311501099278'], { serper: { apiKey: 'k' }, ohneOpenFoodFacts: true });
  expect(k.map((x) => x.shop)).toEqual(['globus', 'codecheck']);
});

test('nurDomains: nur die Handelsketten, kein codecheck-Rückfall', async () => {
  suche.treffer = ['https://www.lidl.de/p/20003180', 'https://www.kaufland.de/p/2', 'https://irgendwas.de/20003180'];
  const k = await resolveCandidates(['20003180'], { serper: { apiKey: 'k' }, nurDomains: ['lidl.de', 'penny.de'] });
  expect(k.map((x) => x.url)).toEqual(['https://www.lidl.de/p/20003180']);
});

test('kandidatFuerUrl: bekannter Shop, unbekannte Domain, Sperrliste, Filter', async () => {
  await expect(kandidatFuerUrl('https://produkte.globus.de/p/1')).resolves.toMatchObject({
    shop: 'globus', source: 'bevorzugt', requiresQualityCheck: false, noPriceTrust: false,
  });
  await expect(kandidatFuerUrl('https://unbekannt.example.de/p')).resolves.toMatchObject({
    requiresQualityCheck: true, noPriceTrust: true,
  });
  await expect(kandidatFuerUrl('https://www.ebay.de/itm/1')).resolves.toBeNull();
  await expect(kandidatFuerUrl('https://de.openfoodfacts.org/produkt/1', { filter: { ohneOpenFoodFacts: true } })).resolves.toBeNull();
  await expect(kandidatFuerUrl('kaputt')).resolves.toBeNull();
});
