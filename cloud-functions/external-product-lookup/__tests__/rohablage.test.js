/**
 * nutritionscrape → Schreibweg (lib/rohablage.js).
 *
 * @jest-environment node
 */

'use strict';

const {
  quelleAusShop,
  hostAus,
  istAuslandsDomain,
  preisAusRohablage,
  abrufStempel,
  ausRohablage,
  uebernahmeNoetig,
  altbestandAbgelehnt,
  abgelehnterAltbestandIm,
  ersetzeQuelleAus,
  istOffWebseitenAltbestand,
} = require('../lib/rohablage');
const { istAnzeigbar } = require('../lib/speichern');
const { altbestand } = require('./helfer/altbestand');

const ts = (ms) => ({ toMillis: () => ms });
const JETZT = Date.parse('2026-10-04T12:00:00Z');

// Form eines echten Fundes nach dem Scraper-Umbau (Vertrag Teil 1).
const fund = (over = {}) => ({
  gtin: '4337256123456',
  productPath: null,
  scrapedAt: ts(JETZT),
  fetchedAt: ts(JETZT - 1000),
  scrapedSource: 'scraper',
  scrapedUrl: 'https://www.rossmann.de/de/p/4337256123456',
  sourceShop: 'rossmann',
  productName: 'Isana Duschgel Kokos',
  shopBildUrl: 'https://media.rossmann.de/x.jpg',
  eanBeleg: 'jsonld_gtin',
  attr_preis: 0.95,
  priceShop: 'rossmann',
  priceCurrency: 'EUR',
  priceFetchedAt: ts(JETZT - 1000),
  attr_ingredientStatement: 'Aqua, Sodium Laureth Sulfate',
  confidence: 0.9,
  schemaVersion: 4,
  ...over,
});

// Form einer Fehlversuchs-Markierung (gemessen: 1.955 Dokumente ohne Shop).
const fehlversuch = { failed: true, failCount: 3, lastFailAt: ts(JETZT - 1000) };

describe('quelleAusShop', () => {
  test('wie bisher: Gruppenname oder erstes Etikett', () => {
    expect(quelleAusShop('globus')).toBe('globus');
    expect(quelleAusShop('budni.de')).toBe('budni');
    expect(quelleAusShop('shop-apotheke.com')).toBe('shop-apotheke');
    expect(quelleAusShop('openfoodfacts')).toBe('openfoodfacts');
    expect(quelleAusShop('shop.rewe.de')).toBe('rewe');
    expect(quelleAusShop('metro.de')).toBe('metro');
  });

  test('rewe nur als eigenes Wort (nicht in anderen Namen)', () => {
    expect(quelleAusShop('brewerei.de')).toBe('brewerei');
  });

  test('leer → scraper', () => {
    expect(quelleAusShop(null)).toBe('scraper');
    expect(quelleAusShop('')).toBe('scraper');
  });
});

describe('Domains', () => {
  test('hostAus', () => {
    expect(hostAus('https://www.globus.de/p/1')).toBe('globus.de');
    expect(hostAus('budni.de')).toBe('budni.de');
    expect(hostAus(null)).toBeNull();
  });

  test('istAuslandsDomain: Länder außer DE/AT; generische Domains nicht', () => {
    for (const h of ['puravita.ch', 'zdroweslodycze.pl', '4ecoshop.co.uk', 'kdrogerie.nl', 'x.fr']) {
      expect(istAuslandsDomain(h)).toBe(true);
    }
    for (const h of ['globus.de', 'billa.at', 'shop-apotheke.com', 'lebensmittel-versand.eu', 'globus', null]) {
      expect(istAuslandsDomain(h)).toBe(false);
    }
  });
});

describe('preisAusRohablage', () => {
  test('EUR mit Shop und Stand', () => {
    expect(preisAusRohablage(fund())).toEqual({ wert: 0.95, shop: 'rossmann', standMs: JETZT - 1000 });
  });

  test('andere Währung → kein Preis', () => {
    expect(preisAusRohablage(fund({ priceCurrency: 'CHF' }))).toBeNull();
  });

  test('Altbestand ohne Währung: Länder-Domain außer DE/AT → kein Preis', () => {
    const alt = fund({ priceCurrency: undefined, fetchedAt: undefined, scrapedUrl: 'https://www.puravita.ch/p/1', sourceShop: 'puravita.ch' });
    expect(preisAusRohablage(alt)).toBeNull();
  });

  test('v4-Dokument mit Preis ohne Währung → kein Preis (Herkunft nicht zuordenbar)', () => {
    // So sähe ein Altpreis aus, der nach einem neuen Abruf eines anderen
    // Shops stehen blieb: scrapedUrl/sourceShop/fetchedAt gehören zum neuen.
    expect(preisAusRohablage(fund({ priceCurrency: undefined, priceShop: undefined, priceFetchedAt: undefined }))).toBeNull();
  });

  test('v4-Dokument: Shop und Stand nur aus priceShop/priceFetchedAt, nie vom letzten Abruf', () => {
    expect(preisAusRohablage(fund({ priceShop: undefined, priceFetchedAt: undefined }))).toEqual({ wert: 0.95, shop: null, standMs: null });
  });

  test('Altbestand ohne Währung von .de/.com → Preis, Stand aus scrapedAt', () => {
    const alt = fund({ priceCurrency: undefined, priceFetchedAt: undefined, fetchedAt: undefined, priceShop: undefined });
    expect(preisAusRohablage(alt)).toEqual({ wert: 0.95, shop: 'rossmann', standMs: JETZT });
  });

  test('OpenFoodFacts hat keine Preise', () => {
    expect(preisAusRohablage(fund({ sourceShop: 'openfoodfacts' }))).toBeNull();
  });

  test('ungültige Werte → kein Preis', () => {
    for (const p of [0, -1, NaN, '0,95', undefined]) expect(preisAusRohablage(fund({ attr_preis: p }))).toBeNull();
  });
});

describe('abrufStempel', () => {
  test('fetchedAt exakt, sonst scrapedAt als Schätzung', () => {
    expect(abrufStempel(fund())).toEqual({ ms: JETZT - 1000, geschaetzt: false });
    expect(abrufStempel(fund({ fetchedAt: undefined }))).toEqual({ ms: JETZT, geschaetzt: true });
    expect(abrufStempel(fehlversuch)).toEqual({ ms: null, geschaetzt: false });
  });
});

describe('ausRohablage', () => {
  test('Fund → Eingabe für den Schreibweg', () => {
    const neu = ausRohablage(fund(), { shopBilder: false });
    expect(neu.quelle).toBe('rossmann');
    expect(neu.daten.productName).toBe('Isana Duschgel Kokos');
    expect(neu.daten.price).toBe(0.95);
    expect(neu.daten.sourceUrl).toBe('https://www.rossmann.de/de/p/4337256123456');
    expect(neu.fetchedAtMs).toBe(JETZT - 1000);
    expect(neu.fetchedAtQuelle).toBe('nutritionscrape');
    expect(neu.fetchedAtGeschaetzt).toBe(false);
    expect(neu.priceShop).toBe('rossmann');
    expect(neu.priceFetchedAtMs).toBe(JETZT - 1000);
  });

  test('Shopbild nur mit Freigabe _meta/produktsuche.shopBilder, dann als Shopbild markiert', () => {
    expect(ausRohablage(fund(), { shopBilder: false }).daten.imageUrl).toBeUndefined();
    expect(ausRohablage(fund(), { shopBilder: false }).shopBilder).toBe(false);
    expect(ausRohablage(fund(), {}).daten.imageUrl).toBeUndefined();
    const frei = ausRohablage(fund(), { shopBilder: true });
    expect(frei.daten.imageUrl).toBe('https://media.rossmann.de/x.jpg');
    expect(frei.daten.bildVonShop).toBe(true);
    expect(frei.shopBilder).toBe(true);
  });

  test('andere Bildfelder der Rohablage werden nie übernommen', () => {
    expect(ausRohablage(fund({ image: 'https://x', shopBildUrl: undefined }), { shopBilder: true }).daten.imageUrl).toBeUndefined();
  });

  test('Fremdwährung: Preis verworfen, Rest bleibt', () => {
    const neu = ausRohablage(fund({ priceCurrency: 'PLN' }), {});
    expect(neu.daten.price).toBeUndefined();
    expect(neu.priceShop).toBeNull();
    expect(neu.daten.attr_ingredientStatement).toBe('Aqua, Sodium Laureth Sulfate');
  });

  test('Fehlversuchs-Markierung ist nicht anzeigbar', () => {
    expect(istAnzeigbar(ausRohablage(fehlversuch, {}).daten)).toBe(false);
  });

  test('Fund ohne Namen (EAN nicht belegt) bleibt ohne Namen, nie Platzhalter', () => {
    const neu = ausRohablage(fund({ productName: undefined, eanBeleg: undefined }), {});
    expect(neu.daten.productName).toBeUndefined();
  });

  test('null → null', () => {
    expect(ausRohablage(null, {})).toBeNull();
  });
});

describe('uebernahmeNoetig (Trigger)', () => {
  test('neues Dokument mit Abruf → übernehmen', () => {
    expect(uebernahmeNoetig(null, fund())).toEqual({ noetig: true, grund: 'neuer_abruf', ersetzeQuelle: null });
  });

  test('ungeprüfter Altbestand vom belegten Fund ersetzt → Quelle des Altbestands ersetzen', () => {
    const vorher = fund({ fetchedAt: undefined, sourceShop: 'violey.com', scrapedAt: ts(1) });
    const r = uebernahmeNoetig(vorher, fund());
    expect(r).toMatchObject({
      noetig: true, grund: 'neuer_abruf', ersetzeQuelle: { quelle: 'violey', sourceShop: 'violey.com' },
    });
    // Was der Altbestand geliefert hat — nur diese Werte nimmt der Schreibweg heraus.
    expect(r.ersetzeQuelle.werte).toMatchObject({ attr_ingredientStatement: 'Aqua, Sodium Laureth Sulfate', price: 0.95 });
    expect(r.ersetzeQuelle.adresse).toBe('https://www.rossmann.de/de/p/4337256123456');
  });

  test('vom Scraper widerlegt (widerlegtAm neu, kein Abruf) → übernehmen mit Ersetzen', () => {
    const vorher = fund({ fetchedAt: undefined, sourceShop: 'violey.com' });
    const nachher = { gtin: '4337256123456', widerlegtAm: ts(JETZT), widerlegtGrund: 'gtin_widerspruch' };
    expect(uebernahmeNoetig(vorher, nachher)).toMatchObject({
      noetig: true, grund: 'widerlegt', ersetzeQuelle: { quelle: 'violey', sourceShop: 'violey.com' },
    });
    // dieselbe Widerlegung noch einmal zugestellt, ohne Änderung → nichts
    expect(uebernahmeNoetig(nachher, nachher).noetig).toBe(false);
  });

  test('belegtes Dokument (v4) → nie Ersetzen', () => {
    expect(uebernahmeNoetig(fund({ fetchedAt: ts(1) }), fund()).ersetzeQuelle).toBeNull();
  });

  test('neuer Abruf (fetchedAt geändert) → übernehmen', () => {
    expect(uebernahmeNoetig(fund({ fetchedAt: ts(1) }), fund()).noetig).toBe(true);
  });

  test('nur zusammengeführt (scrapedAt springt, fetchedAt gleich) → nichts (idempotent)', () => {
    const vorher = fund({ scrapedAt: ts(JETZT - 5000) });
    expect(uebernahmeNoetig(vorher, fund())).toEqual({ noetig: false, grund: 'unveraendert' });
  });

  test('Altbestand ohne fetchedAt: scrapedAt entscheidet', () => {
    const vorher = fund({ fetchedAt: undefined, scrapedAt: ts(1) });
    const nachher = fund({ fetchedAt: undefined, scrapedAt: ts(2) });
    expect(uebernahmeNoetig(vorher, nachher).noetig).toBe(true);
  });

  test('Katalogprodukt (productPath) → nichts', () => {
    expect(uebernahmeNoetig(null, fund({ productPath: 'produkte/abc' }))).toEqual({
      noetig: false,
      grund: 'katalog_verknuepft',
    });
  });

  test('Fehlversuchs-Markierung ohne Abruf → nichts', () => {
    expect(uebernahmeNoetig(null, fehlversuch).grund).toBe('kein_abruf');
  });

  test('gelöscht → nichts', () => {
    expect(uebernahmeNoetig(fund(), null).grund).toBe('geloescht');
  });
});

// ─── Prüfrunde 2 (04.10.2026): ungeprüfter Altbestand ─────────────────

describe('ausRohablage: Altbestand ist ungeprüft', () => {
  test('Altbestand (ohne fetchedAt) trägt ungeprueft, ein belegter Fund nicht', () => {
    expect(ausRohablage(fund({ fetchedAt: undefined }), {}).ungeprueft).toBe(true);
    expect(ausRohablage(fund(), {}).ungeprueft).toBe(false);
  });

  test('mit EAN: ohne Netz als fremd erkannter Altbestand wird gar nicht übernommen', () => {
    const { ns } = altbestand('3560070417148');
    expect(ausRohablage(ns, {}, '3560070417148')).toBeNull();
    // ohne EAN (alte Aufrufer, Tests) keine Prüfung
    expect(ausRohablage(ns, {})).not.toBeNull();
  });
});

// Prüfrunde 3: Die API entscheidet über OpenFoodFacts-Daten. Übernahm die
// Abfrage Webseiten-Altbestand aus der Rohablage, legte jeder zweite Scan ein
// Dokument neu an, das der vorige gelöscht hatte (API kennt die EAN nicht).
describe('ausRohablage: Altbestand von OpenFoodFacts-Seiten wird nie übernommen', () => {
  const offAlt = {
    gtin: '4005500084136',
    scrapedSource: 'scraper',
    scrapedAt: ts(JETZT - 90 * 24 * 3600 * 1000),
    sourceShop: 'openfoodfacts',
    scrapedUrl: 'https://de.openfoodfacts.org/produkt/4005500084136/knusper',
    attr_ingredientStatement: 'Hafer, Zucker',
  };

  test.each([
    ['Adresse', offAlt],
    ['nur Shop-Name', { ...offAlt, scrapedUrl: undefined }],
    ['OpenFoodFacts als Shop mit Domain', { ...offAlt, scrapedUrl: undefined, sourceShop: 'de.openfoodfacts.org' }],
  ])('%s → null (auch ohne EAN)', (_name, d) => {
    expect(istOffWebseitenAltbestand(d)).toBe(true);
    expect(ausRohablage(d, {}, '4005500084136')).toBeNull();
    expect(ausRohablage(d, {})).toBeNull();
  });

  // Schlussprüfung 04.10.2026: der Host entscheidet zuerst. OpenBeautyFacts,
  // OpenPetFoodFacts und Open Products Facts stehen ebenfalls unter sourceShop
  // 'openfoodfacts', die kostenlose API (nur Lebensmittel) kann über sie
  // nicht entscheiden — ihre Daten werden wie Shop-Altbestand übernommen.
  test.each([
    ['OpenBeautyFacts-Adresse', { ...offAlt, gtin: '4066447870237', scrapedUrl: 'https://world.openbeautyfacts.org/product/4066447870237/balea' }],
    ['OpenPetFoodFacts-Adresse', { ...offAlt, gtin: '4066447870237', scrapedUrl: 'https://de.openpetfoodfacts.org/produkt/4066447870237/x' }],
    ['Open Products Facts-Adresse', { ...offAlt, gtin: '4066447870237', scrapedUrl: 'https://world.openproductsfacts.org/product/4066447870237/x' }],
    ['OpenBeautyFacts als Shop mit Domain', { ...offAlt, gtin: '4066447870237', scrapedUrl: undefined, sourceShop: 'world.openbeautyfacts.org' }],
  ])('%s → kein OFF-Webseiten-Altbestand, wird übernommen', (_name, d) => {
    expect(istOffWebseitenAltbestand(d)).toBe(false);
    const neu = ausRohablage(d, {}, '4066447870237');
    expect(neu).not.toBeNull();
    expect(neu.ungeprueft).toBe(true);
    expect(neu.daten.attr_ingredientStatement).toBe('Hafer, Zucker');
  });

  test('belegter Fund (fetchedAt) und Altbestand eines Shops bleiben übernehmbar', () => {
    expect(istOffWebseitenAltbestand({ ...offAlt, fetchedAt: ts(JETZT) })).toBe(false);
    expect(ausRohablage({ ...offAlt, fetchedAt: ts(JETZT) }, {}, '4005500084136')).not.toBeNull();
    const shop = { ...offAlt, sourceShop: 'globus', scrapedUrl: 'https://www.globus.de/p/4005500084136' };
    expect(istOffWebseitenAltbestand(shop)).toBe(false);
    expect(ausRohablage(shop, {}, '4005500084136')).not.toBeNull();
  });
});

describe('altbestandAbgelehnt — ohne Netz erkennbar fremd', () => {
  test.each([
    ['3560070417148', '4260237970446'], // Globus-Seite eines Fruchtaufstrichs
    ['4000980231414', '4003310013568'], // Globus-Seite eines Sekts
    ['4000540031874', '4316268436137'], // OpenFoodFacts-Seite von Laugenstangerl
    ['2009010284293', '4008391026063'], // deutschlandcard-Seite eines Müslis
  ])('%s: Quell-Adresse nennt eine andere GTIN (%s)', (ean, fremd) => {
    const { ns } = altbestand(ean);
    expect(altbestandAbgelehnt(ns, ean)).toMatchObject({ grund: 'fremde_gtin_in_adresse', gtin: fremd });
  });

  test('Adresse nennt die eigene EAN → nicht abgelehnt (globus/4000412017401)', () => {
    const { ns } = altbestand('4000412017401');
    expect(altbestandAbgelehnt(ns, '4000412017401')).toBeNull();
  });

  test('RCN-8 von einer Seite außerhalb der Ketten, die solche Codes ausgeben (gastro-direkt)', () => {
    const { ns } = altbestand('20006204');
    expect(altbestandAbgelehnt(ns, '20006204')).toMatchObject({ grund: 'haendlercode_fremder_shop' });
    // dieselbe Nummer von lidl.de bleibt
    expect(altbestandAbgelehnt({ ...ns, scrapedUrl: 'https://www.lidl.de/p/x/p100', sourceUrl: undefined }, '20006204')).toBeNull();
  });

  test('Ladencode und ungültige EAN von einem Shop → abgelehnt; von OpenFoodFacts entscheidet die API', () => {
    const shop = { scrapedSource: 'scraper', scrapedAt: ts(1), scrapedUrl: 'https://www.sweets-online.com/p/abc', attr_ingredientStatement: 'X' };
    expect(altbestandAbgelehnt(shop, '2009010284293')).toMatchObject({ grund: 'ladencode' });
    expect(altbestandAbgelehnt(shop, '4001234567890')).toMatchObject({ grund: 'ungueltige_ean' });
    const off = { ...shop, scrapedUrl: 'https://de.openfoodfacts.org/produkt/2009010284293/kartoffeln' };
    expect(altbestandAbgelehnt(off, '2009010284293')).toBeNull();
  });

  test('achtstellige Artikelnummern in Adressen zählen nicht als GTIN (nur 12–14 Stellen)', () => {
    const d = { scrapedSource: 'scraper', scrapedAt: ts(1), scrapedUrl: 'https://www.beautifulbalancedrogerie.de/product/13709938/dr-beckmann-glaskeramik-reiniger-250ml' };
    expect(altbestandAbgelehnt(d, '4008455045511')).toBeNull();
  });

  test('GTIN-14 des Kartons (gleiche Artikelnummer) ist kein fremdes Produkt', () => {
    const d = { scrapedSource: 'scraper', scrapedAt: ts(1), scrapedUrl: 'https://www.grosshandel.de/p/14000412017408/zuckerruebensirup-karton' };
    expect(altbestandAbgelehnt(d, '4000412017401')).toBeNull();
  });

  test('belegte Funde (mit fetchedAt) prüft der Scraper selbst → nie abgelehnt', () => {
    const { ns } = altbestand('3560070417148');
    expect(altbestandAbgelehnt({ ...ns, fetchedAt: ts(1) }, '3560070417148')).toBeNull();
  });
});

describe('abgelehnterAltbestandIm (external_products-Dokument)', () => {
  test('20006204: Rohablage in raw, fremder Shop → Entfernen mit den gelieferten Werten', () => {
    const { ep } = altbestand('20006204');
    const r = abgelehnterAltbestandIm(ep, '20006204');
    expect(r.grund).toBe('haendlercode_fremder_shop');
    expect(r.ersetzeQuelle).toMatchObject({ quelle: 'gastro-direkt', sourceShop: 'gastro-direkt.de' });
    expect(r.ersetzeQuelle.werte).toMatchObject({ attr_ingredientStatement: 'Alkalien, Bleichmittel auf Chlorbasis', manufacturerName: 'Winterhalter', price: 104.2 });
  });

  test('reine OFF-Rohdaten oder REWE-Rohdaten → nichts', () => {
    const { ep } = altbestand('3560070417148');
    expect(abgelehnterAltbestandIm(ep, '3560070417148')).toBeNull();
    expect(abgelehnterAltbestandIm({ raw: { scrapedSource: 'scraper', merchant_company: 'Rewe', scrapedAt: ts(1) } }, '20006204')).toBeNull();
  });
});

describe('ersetzeQuelleAus', () => {
  test('ohne Rohdaten-Feld raw, mit Shopbild', () => {
    const r = ersetzeQuelleAus(fund({ fetchedAt: undefined }));
    expect(r.werte.raw).toBeUndefined();
    expect(r.werte.imageUrl).toBe('https://media.rossmann.de/x.jpg');
    expect(ersetzeQuelleAus(null)).toBeNull();
  });
});
