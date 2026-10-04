/**
 * Der eine Schreibweg für external_products (lib/speichern.js).
 *
 * @jest-environment node
 */

'use strict';

const {
  LOESCHEN,
  ANZEIGENAME_OHNE_NAMEN,
  nameAusRohdaten,
  anzeigeName,
  istAnzeigbar,
  fuehreZusammen,
  fuerFirestore,
  speichereExternesProdukt,
  stempeleExternesProdukt,
  fuerAntwort,
} = require('../lib/speichern');
const { normaliseOpenFood, normaliseReweapify } = require('../lib/normalizers');

const TAG = 24 * 60 * 60 * 1000;
const JETZT = Date.parse('2026-10-04T12:00:00Z');

// Firestore-Timestamp-Ersatz: hat toMillis wie der echte.
const ts = (ms) => ({ toMillis: () => ms, _ms: ms });

const offRoh = {
  code: '20003180',
  product_name: 'Golden Puffs',
  brands: 'Crownfield',
  image_front_url: 'https://images.openfoodfacts.org/x.jpg',
  ingredients_text_de: 'Weizen, Zucker',
  nutriments: { 'energy-kcal_100g': 380, fat_100g: 2 },
  nutriscore_grade: 'D',
  allergens_tags: ['en:gluten'],
};

const neuOff = (over = {}) => ({
  quelle: 'openfood',
  daten: normaliseOpenFood(offRoh),
  fetchedAtMs: JETZT,
  fetchedAtQuelle: 'openfood_api',
  raw: offRoh,
  ...over,
});

const nsRoh = {
  gtin: '20003180',
  sourceShop: 'rossmann',
  scrapedUrl: 'https://www.rossmann.de/p/20003180',
  attr_ingredientStatement: 'Vollkornweizen, Zucker, Honig',
  nutr_Energie_val: 375,
  nutr_Energie_unit: 'kcal',
  attr_preis: 1.99,
};

const neuScrape = (over = {}) => ({
  quelle: 'rossmann',
  daten: { ...normaliseReweapify(nsRoh), imageUrl: undefined },
  fetchedAtMs: JETZT - 2 * TAG,
  fetchedAtQuelle: 'nutritionscrape',
  fetchedAtGeschaetzt: false,
  priceShop: 'rossmann',
  priceFetchedAtMs: JETZT - 2 * TAG,
  raw: nsRoh,
  ...over,
});

describe('Anlegen', () => {
  test('REWE-Pipeline: storedAt, fetchedAt null + rewe_pipeline, Preis ohne Datum', () => {
    const r = fuehreZusammen(
      null,
      {
        quelle: 'rewe',
        daten: { productName: 'Kerrygold Butter', imageUrl: 'https://rewe/x.jpg', price: 2.49 },
        fetchedAtMs: null,
        fetchedAtQuelle: 'rewe_pipeline',
        priceShop: 'rewe',
        priceFetchedAtMs: null,
        raw: { gtin: '1' },
      },
      JETZT,
    );
    expect(r.aktion).toBe('anlegen');
    expect(r.patch.storedAt).toEqual(new Date(JETZT));
    expect(r.patch.cachedAt).toEqual(new Date(JETZT));
    expect(r.patch.fetchedAt).toBeNull();
    expect(r.patch.fetchedAtQuelle).toBe('rewe_pipeline');
    expect(r.patch.fetchedAtGeschaetzt).toBeUndefined();
    expect(r.patch.source).toBe('rewe');
    expect(r.patch.price).toBe(2.49);
    expect(r.patch.priceShop).toBe('rewe');
    expect('priceFetchedAt' in r.patch).toBe(false);
    expect(r.patch.feldQuellen).toEqual({ name: 'rewe', bild: 'rewe' });
    expect(Object.values(r.patch)).not.toContain(LOESCHEN);
  });

  test('OpenFoodFacts-API: fetchedAt = Abrufzeit', () => {
    const r = fuehreZusammen(null, neuOff(), JETZT);
    expect(r.aktion).toBe('anlegen');
    expect(r.patch.fetchedAt).toEqual(new Date(JETZT));
    expect(r.patch.fetchedAtQuelle).toBe('openfood_api');
    expect(r.patch.productName).toBe('Golden Puffs');
    expect(r.patch.source).toBe('openfood');
  });

  test('nutritionscrape nur mit scrapedAt: fetchedAtGeschaetzt', () => {
    const r = fuehreZusammen(null, neuScrape({ fetchedAtGeschaetzt: true }), JETZT);
    expect(r.patch.fetchedAt).toEqual(new Date(JETZT - 2 * TAG));
    expect(r.patch.fetchedAtGeschaetzt).toBe(true);
    expect(r.patch.fetchedAtQuelle).toBe('nutritionscrape');
  });

  test('ohne Namen, aber mit Zutaten → angelegt, OHNE productName (nie Platzhalter)', () => {
    const r = fuehreZusammen(null, neuScrape(), JETZT);
    expect(r.aktion).toBe('anlegen');
    expect('productName' in r.patch).toBe(false);
    expect(r.patch.attr_ingredientStatement).toBe('Vollkornweizen, Zucker, Honig');
    expect(r.patch.price).toBe(1.99);
    expect(r.patch.priceShop).toBe('rossmann');
    expect(r.patch.priceFetchedAt).toEqual(new Date(JETZT - 2 * TAG));
  });

  test('nichts Anzeigbares (nur Preis/Marke) → nicht angelegt', () => {
    const r = fuehreZusammen(
      null,
      { quelle: 'atundo', daten: { price: 3.5, brandName: 'X', packSize: '500 g' }, fetchedAtMs: JETZT },
      JETZT,
    );
    expect(r.aktion).toBe('nichts');
    expect(r.grund).toBe('nicht_anzeigbar');
    expect(r.patch).toEqual({});
  });

  test('ein als Name geliefertes "Produkt" zählt nicht als Name', () => {
    const r = fuehreZusammen(null, { quelle: 'rewe', daten: { productName: 'Produkt' } }, JETZT);
    expect(r.aktion).toBe('nichts');
  });
});

describe('Platzhalter im Bestand', () => {
  // So sehen die 665 kaputten Dokumente aus: OFF-Name nur noch unter raw.
  const kaputt = {
    ean: '20003180',
    source: 'openfoodfacts',
    productName: 'Produkt',
    imageUrl: 'https://images.openfoodfacts.org/x.jpg',
    attr_ingredientStatement: 'Weizen, Zucker',
    raw: { product_name: 'Golden Puffs', sourceShop: 'openfoodfacts' },
    cachedAt: ts(JETZT - 100 * TAG),
    aiAssessment: { healthScore: 2 },
  };

  test('echter Name wird aus raw gerettet, auch wenn die neue Quelle keinen bringt', () => {
    const r = fuehreZusammen(kaputt, neuScrape(), JETZT);
    expect(r.aktion).toBe('aktualisieren');
    expect(r.patch.productName).toBe('Golden Puffs');
    expect(r.ansicht.feldQuellen.name).toBe('openfood');
  });

  test('raw wird erst NACH der Rettung ersetzt (Name geht nicht verloren)', () => {
    const r = fuehreZusammen(kaputt, neuScrape(), JETZT);
    expect(r.patch.raw).toBe(nsRoh);
    expect(r.ansicht.productName).toBe('Golden Puffs');
  });

  test('Platzhalter ohne Rettung bleibt stehen (Rückfall der App liest das Dokument direkt), zählt aber nicht als Name', () => {
    const ohne = { ...kaputt, raw: { sourceShop: 'atundo' } };
    const r = fuehreZusammen(ohne, neuScrape(), JETZT);
    expect(r.patch).not.toHaveProperty('productName');
    expect(r.ansicht.productName).toBe('Produkt');
    expect(r.ansicht.feldQuellen.name).toBeUndefined();
    // ein echter Name ersetzt ihn jederzeit
    const mitName = fuehreZusammen(ohne, neuScrape({ daten: { ...neuScrape().daten, productName: 'Isana Duschgel' } }), JETZT);
    expect(mitName.patch.productName).toBe('Isana Duschgel');
  });

  test('"Unbekannt" (früherer OFF-Default) wird genauso behandelt', () => {
    const r = fuehreZusammen({ ...kaputt, productName: 'Unbekannt', raw: {} }, neuScrape(), JETZT);
    expect(r.patch).not.toHaveProperty('productName');
  });

  test('neues Dokument ohne Namen bekommt den Platzhalter nie', () => {
    const r = fuehreZusammen(null, neuScrape(), JETZT);
    expect(r.patch).not.toHaveProperty('productName');
  });
});

describe('Quellenrang je Feldgruppe', () => {
  const offDoc = () => {
    const r = fuehreZusammen(null, neuOff({ fetchedAtMs: JETZT - 30 * TAG }), JETZT - 30 * TAG);
    return r.ansicht;
  };

  test('Shop (scraper) schlägt OpenFoodFacts bei Zutaten/Nährwerten; OFF-Bild und -Name bleiben', () => {
    const r = fuehreZusammen(offDoc(), neuScrape(), JETZT);
    expect(r.patch.attr_ingredientStatement).toBe('Vollkornweizen, Zucker, Honig');
    expect(r.patch.nutr_Energie_val).toBe(375);
    expect(r.ansicht.productName).toBe('Golden Puffs');
    expect(r.ansicht.imageUrl).toBe('https://images.openfoodfacts.org/x.jpg');
    expect(r.ansicht.feldQuellen).toMatchObject({
      name: 'openfood',
      bild: 'openfood',
      zutaten: 'rossmann',
      naehrwerte: 'rossmann',
    });
    // beste beteiligte Quelle
    expect(r.patch.source).toBe('rossmann');
  });

  test('Nährwert-Feld, das der Shop nicht liefert, bleibt vom OFF-Stand (leer ersetzt nie)', () => {
    const r = fuehreZusammen(offDoc(), neuScrape(), JETZT);
    expect(r.ansicht.nutr_Fett_val).toBe(2);
    expect('nutr_Fett_val' in r.patch).toBe(false);
  });

  test('OpenFoodFacts überschreibt Shop-Zutaten NICHT, füllt aber leere Gruppen (Scores)', () => {
    const shopDoc = fuehreZusammen(null, neuScrape(), JETZT - 10 * TAG).ansicht;
    const r = fuehreZusammen(shopDoc, neuOff(), JETZT);
    expect(r.ansicht.attr_ingredientStatement).toBe('Vollkornweizen, Zucker, Honig');
    expect(r.ansicht.scoreNutri).toBe('D');
    expect(r.ansicht.productName).toBe('Golden Puffs'); // Name war leer → OFF füllt
    expect(r.ansicht.source).toBe('rossmann');
    expect(r.ansicht.feldQuellen.zutaten).toBe('rossmann');
    expect(r.ansicht.feldQuellen.scores).toBe('openfood');
  });

  test('REWE schlägt alles; gleiche Quelle darf erneuern', () => {
    const shopDoc = fuehreZusammen(null, neuScrape(), JETZT - 10 * TAG).ansicht;
    const r = fuehreZusammen(
      shopDoc,
      { quelle: 'rewe', daten: { attr_ingredientStatement: 'REWE-Zutaten' }, fetchedAtMs: null, fetchedAtQuelle: 'rewe_pipeline' },
      JETZT,
    );
    expect(r.ansicht.attr_ingredientStatement).toBe('REWE-Zutaten');
    expect(r.ansicht.source).toBe('rewe');
  });

  test('Altbestand ohne feldQuellen: jede Gruppe gilt als von `source`', () => {
    const alt = { ean: '1', source: 'openfood', productName: 'A', attr_ingredientStatement: 'alt' };
    const r = fuehreZusammen(alt, neuScrape(), JETZT);
    expect(r.ansicht.attr_ingredientStatement).toBe('Vollkornweizen, Zucker, Honig');
    expect(r.ansicht.feldQuellen.name).toBe('openfood');
  });

  test('openfoodfacts-Webseite hat denselben Rang wie die API (gleich = darf erneuern)', () => {
    const alt = { ean: '1', source: 'openfoodfacts', productName: 'A', attr_ingredientStatement: 'Webseite' };
    const r = fuehreZusammen(alt, neuOff(), JETZT);
    expect(r.ansicht.attr_ingredientStatement).toBe('Weizen, Zucker');
  });
});

describe('Preis', () => {
  const basis = { ean: '1', source: 'rewe', productName: 'A' };

  test('neuerer Preis gewinnt, mit Shop und Stand', () => {
    const alt = { ...basis, price: 1.49, priceShop: 'budni', priceFetchedAt: ts(JETZT - 50 * TAG) };
    const r = fuehreZusammen(alt, neuScrape(), JETZT);
    expect(r.patch.price).toBe(1.99);
    expect(r.patch.priceShop).toBe('rossmann');
    expect(r.patch.priceFetchedAt).toEqual(new Date(JETZT - 2 * TAG));
  });

  test('älterer Preis verliert gegen einen jüngeren gespeicherten', () => {
    const alt = { ...basis, price: 1.49, priceShop: 'budni', priceFetchedAt: ts(JETZT - TAG) };
    const r = fuehreZusammen(alt, neuScrape(), JETZT);
    expect('price' in r.patch).toBe(false);
    expect(r.ansicht.price).toBe(1.49);
  });

  test('Preis ohne Datum (REWE) verliert gegen einen mit Datum', () => {
    const alt = { ...basis, price: 1.49, priceShop: 'budni', priceFetchedAt: ts(JETZT - 300 * TAG) };
    const r = fuehreZusammen(
      alt,
      { quelle: 'rewe', daten: { price: 2.29 }, priceShop: 'rewe', priceFetchedAtMs: null, fetchedAtQuelle: 'rewe_pipeline' },
      JETZT,
    );
    expect(r.ansicht.price).toBe(1.49);
  });

  test('Preis mit Datum schlägt gespeicherten ohne Datum (Altbestand)', () => {
    const r = fuehreZusammen({ ...basis, price: 2.29 }, neuScrape(), JETZT);
    expect(r.patch.price).toBe(1.99);
  });

  test('Abruf ohne Preis löscht keinen Preis', () => {
    const alt = { ...basis, price: 1.49, priceShop: 'budni', priceFetchedAt: ts(JETZT - 300 * TAG) };
    const r = fuehreZusammen(alt, neuScrape({ daten: { ...neuScrape().daten, price: undefined } }), JETZT);
    expect(r.ansicht.price).toBe(1.49);
    expect(r.ansicht.priceShop).toBe('budni');
    expect('price' in r.patch).toBe(false);
  });

  test('ungültige Preise (0, negativ, NaN) zählen nicht', () => {
    for (const p of [0, -1, NaN, '1.99']) {
      const r = fuehreZusammen({ ...basis, price: 1.49 }, neuScrape({ daten: { ...neuScrape().daten, price: p } }), JETZT);
      expect(r.ansicht.price).toBe(1.49);
    }
  });

  test('REWE-Preis ohne Datum ersetzt REWE-Preis ohne Datum (erneutes Lesen der Pipeline)', () => {
    const r = fuehreZusammen(
      { ...basis, price: 2.29, priceShop: 'rewe' },
      { quelle: 'rewe', daten: { price: 2.39 }, priceShop: 'rewe', priceFetchedAtMs: null },
      JETZT,
    );
    expect(r.patch.price).toBe(2.39);
  });
});

describe('Datenstand fetchedAt', () => {
  test('rückt nur vor, wenn der neue Abruf jünger ist und etwas beigetragen hat', () => {
    const alt = { ean: '1', source: 'rossmann', productName: 'A', fetchedAt: ts(JETZT - 10 * TAG), fetchedAtQuelle: 'nutritionscrape' };
    const r = fuehreZusammen(alt, neuScrape({ fetchedAtMs: JETZT - TAG }), JETZT);
    expect(r.patch.fetchedAt).toEqual(new Date(JETZT - TAG));
  });

  test('älterer Abruf setzt fetchedAt nicht zurück', () => {
    const alt = { ean: '1', source: 'rossmann', productName: 'A', fetchedAt: ts(JETZT - TAG), fetchedAtQuelle: 'nutritionscrape' };
    const r = fuehreZusammen(alt, neuScrape({ fetchedAtMs: JETZT - 10 * TAG }), JETZT);
    expect('fetchedAt' in r.patch).toBe(false);
  });

  test('schwächere Quelle ohne Beitrag ändert den Datenstand nicht', () => {
    const alt = {
      ean: '1',
      source: 'rewe',
      productName: 'A',
      imageUrl: 'https://x',
      attr_ingredientStatement: 'z',
      nutr_Energie_val: 1,
      fetchedAt: null,
      fetchedAtQuelle: 'rewe_pipeline',
      feldQuellen: { name: 'rewe', bild: 'rewe', zutaten: 'rewe', naehrwerte: 'rewe' },
    };
    const off = neuOff({ daten: { productName: 'B', attr_ingredientStatement: 'y' } });
    const r = fuehreZusammen(alt, off, JETZT);
    expect(r.genommen).toEqual([]);
    expect('fetchedAt' in r.patch).toBe(false);
    expect('fetchedAtQuelle' in r.patch).toBe(false);
  });

  test('exakter Stand entfernt die Schätzungs-Markierung', () => {
    const alt = { ean: '1', source: 'rossmann', productName: 'A', fetchedAt: ts(JETZT - 10 * TAG), fetchedAtGeschaetzt: true };
    const r = fuehreZusammen(alt, neuScrape({ fetchedAtMs: JETZT - TAG }), JETZT);
    expect(r.patch.fetchedAtGeschaetzt).toBe(LOESCHEN);
  });

  test('Altbestand ohne Stand, neu von der REWE-Pipeline gelesen → fetchedAt null + rewe_pipeline', () => {
    const alt = { ean: '1', source: 'rewe', productName: 'A' };
    const r = fuehreZusammen(
      alt,
      { quelle: 'rewe', daten: { productName: 'A' }, fetchedAtMs: null, fetchedAtQuelle: 'rewe_pipeline' },
      JETZT,
    );
    expect(r.patch.fetchedAt).toBeNull();
    expect(r.patch.fetchedAtQuelle).toBe('rewe_pipeline');
  });
});

describe('Aktualisieren lässt Fremdes stehen', () => {
  const alt = {
    ean: '1',
    source: 'openfood',
    productName: 'A',
    storedAt: ts(JETZT - 90 * TAG),
    cachedAt: ts(JETZT - 90 * TAG),
    aiAssessment: { healthScore: 3 },
    lastUpgradeAttemptAt: ts(JETZT - TAG),
    raw: { product_name: 'A' },
  };

  test('aiAssessment, lastUpgradeAttemptAt, storedAt nicht im Patch; cachedAt immer', () => {
    const r = fuehreZusammen(alt, neuOff({ daten: { productName: 'A' } }), JETZT);
    expect(r.aktion).toBe('aktualisieren');
    expect(r.patch.aiAssessment).toBeUndefined();
    expect(r.patch.lastUpgradeAttemptAt).toBeUndefined();
    expect(r.patch.storedAt).toBeUndefined();
    expect(r.patch.cachedAt).toEqual(new Date(JETZT));
  });

  test('raw wird als Ganzes ersetzt, nicht gemischt', () => {
    const r = fuehreZusammen(alt, neuOff(), JETZT);
    expect(r.patch.raw).toBe(offRoh);
  });

  test('raw einer schwächeren Quelle ersetzt das der besseren nicht', () => {
    const rewe = { ...alt, source: 'rewe', feldQuellen: { name: 'rewe' }, raw: { gtin: 'rewe' } };
    const r = fuehreZusammen(rewe, neuOff(), JETZT);
    expect('raw' in r.patch).toBe(false);
  });

  test('Einheit folgt ihrem Nährwert', () => {
    const a = { ean: '1', source: 'openfood', productName: 'A', nutr_Energie_val: 1500, nutr_Energie_unit: 'kJ' };
    const r = fuehreZusammen(a, neuScrape(), JETZT);
    expect(r.ansicht.nutr_Energie_val).toBe(375);
    expect(r.ansicht.nutr_Energie_unit).toBe('kcal');
  });

  test('meta-Felder werden mitgeschrieben (openfoodVersuchtAm)', () => {
    const r = fuehreZusammen(alt, neuOff({ meta: { openfoodVersuchtAm: new Date(JETZT) } }), JETZT);
    expect(r.patch.openfoodVersuchtAm).toEqual(new Date(JETZT));
  });
});

describe('Anzeige', () => {
  test('istAnzeigbar: Name, Bild, Zutaten oder Nährwerte', () => {
    expect(istAnzeigbar(null)).toBe(false);
    expect(istAnzeigbar({ productName: 'A' })).toBe(true);
    expect(istAnzeigbar({ productName: 'Produkt' })).toBe(false);
    expect(istAnzeigbar({ imageUrl: 'https://x' })).toBe(true);
    expect(istAnzeigbar({ attr_ingredientStatement: 'z' })).toBe(true);
    expect(istAnzeigbar({ nutr_Salz_val: 0 })).toBe(true);
    expect(istAnzeigbar({ price: 1, brandName: 'X', packSize: '1 l' })).toBe(false);
    expect(istAnzeigbar({ productName: 'Produkt', raw: { product_name: 'Golden Puffs' } })).toBe(true);
  });

  test('nameAusRohdaten / anzeigeName', () => {
    expect(nameAusRohdaten({ product_name: '', generic_name: 'Cornflakes' })).toBe('Cornflakes');
    expect(nameAusRohdaten(null)).toBeNull();
    expect(anzeigeName({ productName: 'Echt', raw: { product_name: 'Anders' } })).toBe('Echt');
  });

  test('fuerAntwort: raw raus, Name gerettet', () => {
    const a = fuerAntwort({ ean: '1', productName: 'Produkt', raw: { product_name: 'Golden Puffs' }, imageUrl: 'https://x' });
    expect(a.raw).toBeUndefined();
    expect(a.productName).toBe('Golden Puffs');
    expect(a.nameFehlt).toBeUndefined();
  });

  test('fuerAntwort ohne Namen: Anzeigename NUR in der Antwort, kein Zusatzfeld ohne Leser', () => {
    const doc = { ean: '1', attr_ingredientStatement: 'z' };
    const a = fuerAntwort(doc);
    expect(a.productName).toBe(ANZEIGENAME_OHNE_NAMEN);
    expect(a).not.toHaveProperty('nameFehlt');
    expect(doc.productName).toBeUndefined(); // gespeichertes Dokument unverändert
  });

  test('fuerAntwort gibt auch Altbestand ohne Anzeigbares zurück (die App läse ihn sonst direkt)', () => {
    const a = fuerAntwort({ ean: '1', source: 'openfood', productName: 'Unbekannt', price: 1 });
    expect(a.productName).toBe(ANZEIGENAME_OHNE_NAMEN);
    expect(fuerAntwort(null)).toBeNull();
  });
});

describe('Schreibschicht', () => {
  const FieldValue = { delete: () => 'DELETE' };
  const Timestamp = { fromDate: (d) => ({ ts: d.getTime() }) };

  test('fuerFirestore: Date → Timestamp, LOESCHEN → delete, Rest unverändert', () => {
    const out = fuerFirestore({ a: new Date(5), b: LOESCHEN, c: 'x', d: null }, { FieldValue, Timestamp });
    expect(out).toEqual({ a: { ts: 5 }, b: 'DELETE', c: 'x', d: null });
  });

  function fakeDb(vorhanden) {
    const aufrufe = [];
    const ref = { id: 'ean' };
    return {
      aufrufe,
      collection: (name) => ({ doc: (id) => ({ ...ref, name, id }) }),
      runTransaction: async (fn) =>
        fn({
          get: async () => ({ exists: !!vorhanden, data: () => vorhanden }),
          set: (r, d) => aufrufe.push(['set', r.name, r.id, d]),
          update: (r, d) => aufrufe.push(['update', r.name, r.id, d]),
        }),
    };
  }

  test('Anlegen per set mit ean, Antwort mit Timestamps', async () => {
    const db = fakeDb(null);
    const r = await speichereExternesProdukt({ db, FieldValue, Timestamp }, '20003180', neuOff(), JETZT);
    expect(r.aktion).toBe('anlegen');
    const [art, sammlung, id, daten] = db.aufrufe[0];
    expect([art, sammlung, id]).toEqual(['set', 'external_products', '20003180']);
    expect(daten.ean).toBe('20003180');
    expect(daten.storedAt).toEqual({ ts: JETZT });
    expect(r.ansicht.cachedAt).toEqual({ ts: JETZT });
  });

  test('Aktualisieren per update, Löschungen als FieldValue.delete()', async () => {
    const db = fakeDb({ ean: '1', source: 'openfoodfacts', bildVonShop: true, imageUrl: 'https://shop/x.jpg', raw: {}, attr_ingredientStatement: 'z' });
    await speichereExternesProdukt({ db, FieldValue, Timestamp }, '1', neuScrape({ shopBilder: false }), JETZT);
    const [art, , , daten] = db.aufrufe[0];
    expect(art).toBe('update');
    expect(daten.imageUrl).toBe('DELETE');
    expect(daten.bildVonShop).toBe('DELETE');
  });

  test('nichts Anzeigbares mehr nach dem Entfernen → delete in der Transaktion', async () => {
    const db = fakeDb({ ean: '1', source: 'violey', attr_ingredientStatement: 'Dinkel', price: 3 });
    db.runTransaction = async (fn) => fn({
      get: async () => ({ exists: true, data: () => ({ ean: '1', source: 'violey', attr_ingredientStatement: 'Dinkel', price: 3 }) }),
      set: () => { throw new Error('set unerwartet'); },
      update: () => { throw new Error('update unerwartet'); },
      delete: (r) => db.aufrufe.push(['delete', r.name, r.id]),
    });
    const r = await speichereExternesProdukt(
      { db, FieldValue, Timestamp }, '1',
      { quelle: 'scraper', daten: {}, ersetzeQuelle: { quelle: 'violey', sourceShop: 'violey.com' } },
      JETZT,
    );
    expect(r.aktion).toBe('loeschen');
    expect(r.ansicht).toBeNull();
    expect(db.aufrufe).toEqual([['delete', 'external_products', '1']]);
  });

  test('Stempel nur per update: fehlendes Dokument wird NICHT als leere Hülle angelegt', async () => {
    const aufrufe = [];
    const db = {
      collection: () => ({
        doc: (id) => ({
          update: async (d) => {
            aufrufe.push([id, d]);
            if (id === 'fehlt') throw new Error('NOT_FOUND');
          },
        }),
      }),
    };
    const fs = { db, FieldValue: { serverTimestamp: () => 'JETZT' } };
    expect(await stempeleExternesProdukt(fs, 'da', 'openfoodVersuchtAm')).toBe(true);
    expect(await stempeleExternesProdukt(fs, 'fehlt', 'lastUpgradeAttemptAt')).toBe(false);
    expect(aufrufe).toEqual([
      ['da', { openfoodVersuchtAm: 'JETZT' }],
      ['fehlt', { lastUpgradeAttemptAt: 'JETZT' }],
    ]);
    await expect(stempeleExternesProdukt(fs, 'da', 'productName')).rejects.toThrow('unbekanntes Stempelfeld');
  });

  test('nichts Anzeigbares → kein Schreibvorgang', async () => {
    const db = fakeDb(null);
    const r = await speichereExternesProdukt(
      { db, FieldValue, Timestamp },
      '1',
      { quelle: 'atundo', daten: { price: 2 }, fetchedAtMs: JETZT },
      JETZT,
    );
    expect(r.aktion).toBe('nichts');
    expect(r.ansicht).toBeNull();
    expect(db.aufrufe).toEqual([]);
  });
});

describe('Quelle ersetzen (ungeprüfter Altbestand der bezahlten Suche)', () => {
  const ersetze = { quelle: 'violey', sourceShop: 'violey.com' };
  const mitAltfund = () => ({
    ean: '1',
    source: 'violey',
    attr_ingredientStatement: 'Dinkel, Honig',
    manufacturerName: 'dennree',
    price: 3.49,
    raw: { scrapedSource: 'scraper', sourceShop: 'violey.com' },
    fetchedAt: ts(JETZT - 90 * TAG),
    fetchedAtQuelle: 'nutritionscrape',
    fetchedAtGeschaetzt: true,
    cachedAt: ts(JETZT - TAG),
  });

  test('Gruppen, Preis, Rohdaten und Datenstand der Quelle fallen vor dem neuen Fund weg', () => {
    const r = fuehreZusammen(mitAltfund(), { ...neuScrape(), ersetzeQuelle: ersetze }, JETZT);
    expect(r.aktion).toBe('aktualisieren');
    expect(r.entfernt).toEqual(expect.arrayContaining(['zutaten', 'marke', 'preis', 'raw']));
    expect(r.ansicht).toMatchObject({ attr_ingredientStatement: 'Vollkornweizen, Zucker, Honig', price: 1.99, priceShop: 'rossmann', source: 'rossmann' });
    expect(r.ansicht.manufacturerName).toBeUndefined();
    expect(r.ansicht.fetchedAtGeschaetzt).toBeUndefined();
    expect(r.ansicht.fetchedAt).toEqual(new Date(JETZT - 2 * TAG));
  });

  test('ohne neuen Inhalt und ohne anderes Anzeigbares → loeschen', () => {
    const r = fuehreZusammen(mitAltfund(), { quelle: 'scraper', daten: {}, ersetzeQuelle: ersetze }, JETZT);
    expect(r.aktion).toBe('loeschen');
    expect(r.grund).toMatch(/^nicht_mehr_anzeigbar/);
  });

  test('Gruppen anderer Quellen bleiben', () => {
    const doc = { ...mitAltfund(), productName: 'Knusper Mix', feldQuellen: { name: 'openfood', zutaten: 'violey' } };
    const r = fuehreZusammen(doc, { quelle: 'scraper', daten: {}, ersetzeQuelle: ersetze }, JETZT);
    expect(r.aktion).toBe('aktualisieren');
    expect(r.ansicht.productName).toBe('Knusper Mix');
    expect(r.ansicht.attr_ingredientStatement).toBeUndefined();
    expect(r.ansicht.source).toBe('openfood');
  });

  test('die entfernte Quelle bleibt nicht source, auch nicht bei gleichem Rang', () => {
    const doc = { ...mitAltfund(), productName: 'Knusper Mix', feldQuellen: { name: 'rossmann', zutaten: 'violey' } };
    const r = fuehreZusammen(doc, { quelle: 'scraper', daten: {}, ersetzeQuelle: ersetze }, JETZT);
    expect(r.ansicht.source).toBe('rossmann');
  });

  test('ohne ersetzeQuelle bleibt alles beim Alten (Lese-Pfad der Abfrage)', () => {
    const r = fuehreZusammen(mitAltfund(), neuScrape(), JETZT);
    expect(r.entfernt).toEqual([]);
  });
});

describe('Shopbild-Schalter', () => {
  const { shopBildEntfernen } = require('../lib/speichern');
  const mitShopbild = (extra = {}) => ({
    ean: '1', source: 'rossmann', productName: 'Isana', imageUrl: 'https://media.rossmann.de/x.jpg', bildVonShop: true,
    feldQuellen: { name: 'rossmann', bild: 'rossmann' }, cachedAt: ts(JETZT - TAG), ...extra,
  });

  test('shopBilder false entfernt ein gespeichertes Shopbild, OFF-Bilder nicht', () => {
    const r = fuehreZusammen(mitShopbild(), { ...neuOff(), shopBilder: false }, JETZT);
    // OFF füllt die frei gewordene Bildgruppe
    expect(r.ansicht.imageUrl).toBe('https://images.openfoodfacts.org/x.jpg');
    expect(r.ansicht.bildVonShop).toBeUndefined();
    expect(r.ansicht.feldQuellen.bild).toBe('openfood');
    const ohneOff = fuehreZusammen({ ...mitShopbild(), imageUrl: 'https://images.openfoodfacts.org/o.jpg', bildVonShop: undefined }, { ...neuScrape(), shopBilder: false }, JETZT);
    expect(ohneOff.ansicht.imageUrl).toBe('https://images.openfoodfacts.org/o.jpg');
  });

  test('shopBilder true lässt es stehen', () => {
    const r = fuehreZusammen(mitShopbild(), { ...neuScrape(), shopBilder: true }, JETZT);
    expect(r.ansicht.imageUrl).toBe('https://media.rossmann.de/x.jpg');
  });

  test('shopBildEntfernen: Patch für das Aufräum-Skript; nur Bild → loeschen', () => {
    expect(shopBildEntfernen(mitShopbild({ bildVonShop: undefined }), JETZT)).toBeNull();
    const r = shopBildEntfernen(mitShopbild(), JETZT);
    expect(r.aktion).toBe('aktualisieren');
    expect(r.patch.imageUrl).toBe(LOESCHEN);
    const nurBild = shopBildEntfernen(mitShopbild({ productName: undefined, feldQuellen: { bild: 'rossmann' } }), JETZT);
    expect(nurBild.aktion).toBe('loeschen');
  });
});

// ─── Prüfrunde 2 (04.10.2026) ─────────────────────────────────────────

describe('Prüfrunde 2: ungeprüfter Altbestand überschreibt nichts', () => {
  const { altbestand } = require('./helfer/altbestand');
  const { ausRohablage, ersetzeQuelleAus } = require('../lib/rohablage');

  // Ohne EAN-Argument, damit hier allein die Rang-Regel geprüft wird (die
  // Ablehnung fremder Adressen testet rohablage.test.js).
  test.each(['3560070417148', '4000980231414', '2009010284293'])(
    '%s: OFF-Dokument + Altbestand einer fremden Seite → nichts geschrieben, OFF-Zutaten bleiben',
    (ean) => {
      const { ep, ns } = altbestand(ean);
      const r = fuehreZusammen(ep, ausRohablage(ns, {}), JETZT);
      expect(r.aktion).toBe('nichts');
      expect(r.grund).toBe('ungeprueft_neben_anderer_quelle');
      expect(r.patch).toEqual({});
    },
  );

  // Prüfrunde 3: Altbestand einer OpenFoodFacts-Seite kommt gar nicht erst
  // beim Schreibweg an (lib/rohablage.js istOffWebseitenAltbestand).
  test('4000540031874: Altbestand einer OpenFoodFacts-Seite → ausRohablage liefert nichts', () => {
    const { ns } = altbestand('4000540031874');
    expect(ausRohablage(ns, {})).toBeNull();
  });

  test('ohne gespeichertes Dokument wird Altbestand weiter angelegt (er ist alles, was es gibt)', () => {
    const { ns } = altbestand('4000412017401');
    const r = fuehreZusammen(null, ausRohablage(ns, {}), JETZT);
    expect(r.aktion).toBe('anlegen');
    expect(r.ansicht.attr_ingredientStatement).toBe('Zuckerrüben');
  });

  test('derselbe Altbestand erneut (nur seine Quelle im Dokument) → zusammenführen erlaubt', () => {
    const { ns } = altbestand('4000412017401');
    const doc = fuehreZusammen(null, ausRohablage(ns, {}), JETZT - TAG).ansicht;
    const r = fuehreZusammen(doc, ausRohablage(ns, {}), JETZT);
    expect(r.aktion).toBe('aktualisieren');
  });

  test('belegter Fund (ohne ungeprueft) verbessert OFF-Daten wie bisher nach Rang', () => {
    const { ep, ns } = altbestand('3560070417148');
    const neu = { ...ausRohablage({ ...ns, fetchedAt: { toMillis: () => JETZT } }, {}) };
    expect(neu.ungeprueft).toBe(false);
    expect(fuehreZusammen(ep, neu, JETZT).aktion).toBe('aktualisieren');
  });

  describe('Herkunft alter Dokumente ohne feldQuellen (4000412017401)', () => {
    const { bisherigeQuellen } = require('../lib/speichern');
    test('was den mitkopierten OFF-Rohdaten entspricht, stammt von OpenFoodFacts', () => {
      const { ep } = altbestand('4000412017401');
      expect(bisherigeQuellen(ep)).toEqual({
        marke: 'globus', // brandName von OFF, manufacturerName vom Shop → gemischt
        bild: 'openfood',
        zutaten: 'openfood', // „Zuckerrüben" steht in beiden
        naehrwerte: 'globus',
        packung: 'globus',
        kategorie: 'openfood',
        scores: 'openfood',
        lifestyle: 'globus',
      });
    });

    test('OFF-Rohdaten eines anderen Codes zählen nicht', () => {
      const { ep } = altbestand('4000412017401');
      expect(bisherigeQuellen({ ...ep, ean: '4000000000000' }).bild).toBe('globus');
    });
  });

  test('belegter Globus-Fund ersetzt den Altbestand: OFF-Bild, Scores, Kategorie und Marke bleiben', () => {
    const { ep, ns } = altbestand('4000412017401');
    const v4 = {
      ...ns,
      fetchedAt: { toMillis: () => JETZT - 1000 },
      productName: 'Fenner Harz Zuckerrübensirup',
      eanBeleg: 'jsonld_gtin',
      priceCurrency: 'EUR',
      priceShop: 'globus',
      priceFetchedAt: { toMillis: () => JETZT - 1000 },
      attr_preis: 1.89,
    };
    const r = fuehreZusammen(ep, { ...ausRohablage(v4, {}), ersetzeQuelle: ersetzeQuelleAus(ns) }, JETZT);
    expect(r.aktion).toBe('aktualisieren');
    expect(r.ansicht).toMatchObject({
      imageUrl: ep.imageUrl,
      scoreNutri: 'D',
      category: 'Breakfasts, Spreads, de:Zuckerrübensirup',
      brandName: 'Grafschafter',
      manufacturerName: 'Fenner Harz', // vom neuen Fund wieder gesetzt
      productName: 'Fenner Harz Zuckerrübensirup',
      price: 1.89,
    });
    expect(r.ansicht.feldQuellen).toMatchObject({ bild: 'openfood', scores: 'openfood', kategorie: 'openfood', marke: 'globus' });
  });

  test('20006204: fremder Altbestand entfernt → OFF-Name, -Zutaten und -Packung zurück, Reiniger-Daten weg', () => {
    const { ep } = altbestand('20006204');
    const { abgelehnterAltbestandIm } = require('../lib/rohablage');
    const { ersetzeQuelle } = abgelehnterAltbestandIm(ep, '20006204');
    const r = fuehreZusammen(ep, { quelle: ersetzeQuelle.quelle, daten: {}, ersetzeQuelle }, JETZT);
    expect(r.aktion).toBe('aktualisieren');
    const d = r.ansicht;
    expect(d.productName).toBe('Weizenbrötchen');
    expect(d.attr_ingredientStatement).toMatch(/^6 baguette-brötchen/);
    expect(d.allergen_gluten).toBe(true);
    expect(d.manufacturerName).toBeUndefined();
    expect(d.brandName).toBe('Grafschafter, Gräfschafer');
    expect(d.packSize).toBe('1pcs');
    expect(d.price).toBeUndefined();
    expect(d.sourceUrl).toBeUndefined();
    expect(d.raw).toBeUndefined();
    expect(d.nutr_Energie_val).toBe(249); // OFF-Nährwerte waren nie vom Shop
    expect(d.nutr_Energie_unit).toBe('kcal');
    expect(d.source).toBe('openfood');
    expect(Object.values(d.feldQuellen)).not.toContain('gastro-direkt');
  });

  test('schon überschrieben, `source` zeigt den letzten Schreiber (OFF): fremde Shop-Werte werden trotzdem gefunden und entfernt', () => {
    const { ep, ns } = altbestand('3560070417148');
    const { abgelehnterAltbestandIm } = require('../lib/rohablage');
    // So sah das Dokument aus, nachdem das alte writeThrough die fremde
    // Rohablage hineingemischt und danach die OFF-API wieder `source` gesetzt hatte.
    const doc = {
      ...ep,
      attr_ingredientStatement: ns.attr_ingredientStatement,
      nutr_Energie_val: ns.nutr_Energie_val,
      nutr_Energie_unit: ns.nutr_Energie_unit,
      manufacturerName: ns.attr_hersteller,
      raw: { ...ep.raw, ...ns },
      source: 'openfood',
    };
    const { ersetzeQuelle } = abgelehnterAltbestandIm(doc, '3560070417148');
    const r = fuehreZusammen(doc, { quelle: ersetzeQuelle.quelle, daten: {}, ersetzeQuelle }, JETZT);
    expect(r.ansicht.attr_ingredientStatement).toBe(ep.attr_ingredientStatement);
    expect(r.ansicht.nutr_Energie_val).toBe(122);
    expect(r.ansicht.nutr_Energie_unit).toBe('kcal');
    expect(r.ansicht.manufacturerName).toBeUndefined();
    expect(r.ansicht.brandName).toBe(ep.brandName);
    expect(r.ansicht.source).toBe('openfood');
  });

  test('Einheit eines OFF-Nährwerts bleibt, auch wenn der Shop dieselbe Einheit schrieb', () => {
    const doc = {
      ean: '1',
      source: 'violey',
      productName: 'Knusper Mix',
      nutr_Fett_val: 2, // OFF
      nutr_Fett_unit: 'g',
      nutr_Salz_val: 0.4, // Shop
      nutr_Salz_unit: 'g',
      nutr_serving_size: 100,
      nutr_serving_unit: 'g',
      feldQuellen: { name: 'openfood', naehrwerte: 'violey' },
    };
    const ersetze = { quelle: 'violey', sourceShop: 'violey.com', werte: { nutr_Salz_val: 0.4, nutr_Salz_unit: 'g', nutr_Fett_unit: 'g', nutr_serving_size: 100, nutr_serving_unit: 'g' } };
    const r = fuehreZusammen(doc, { quelle: 'violey', daten: {}, ersetzeQuelle: ersetze }, JETZT);
    expect(r.ansicht).toMatchObject({ nutr_Fett_val: 2, nutr_Fett_unit: 'g', nutr_serving_size: 100 });
    expect(r.ansicht.nutr_Salz_val).toBeUndefined();
    expect(r.ansicht.nutr_Salz_unit).toBeUndefined();
  });
});

describe('Prüfrunde 2: Daten der OpenFoodFacts-Webseite', () => {
  const { offWebseitenQuelle } = require('../lib/speichern');
  test('offWebseitenQuelle erkennt Webseiten-Gruppen, nicht die API', () => {
    expect(offWebseitenQuelle({ source: 'openfoodfacts', attr_ingredientStatement: 'X' })).toBe('openfoodfacts');
    expect(offWebseitenQuelle({ source: 'openfood', attr_ingredientStatement: 'X' })).toBeNull();
    expect(offWebseitenQuelle({ source: 'openfood', attr_ingredientStatement: 'X', feldQuellen: { zutaten: 'openfoodfacts' } })).toBe('openfoodfacts');
    expect(offWebseitenQuelle(null)).toBeNull();
  });

  test('API kennt die EAN nicht → Webseiten-Gruppen entfernen (ersetzeQuelle ohne Werte)', () => {
    const doc = { ean: '1', source: 'openfoodfacts', attr_ingredientStatement: 'fremd', imageUrl: 'https://images.openfoodfacts.org/a.jpg', feldQuellen: { zutaten: 'openfoodfacts', bild: 'openfood' } };
    const r = fuehreZusammen(doc, { quelle: 'openfood', daten: {}, ersetzeQuelle: { quelle: 'openfoodfacts', sourceShop: 'openfoodfacts' } }, JETZT);
    expect(r.aktion).toBe('aktualisieren');
    expect(r.ansicht.attr_ingredientStatement).toBeUndefined();
    expect(r.ansicht.imageUrl).toBe('https://images.openfoodfacts.org/a.jpg');
    expect(r.ansicht.source).toBe('openfood');
  });
});
