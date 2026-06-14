/**
 * Unit-Tests für die external-product-lookup-Cascade-Normalizer.
 *
 * Reine Pure-Function-Tests (kein firebase-admin, keine Seiteneffekte) gegen
 * cloud-functions/external-product-lookup/lib/normalizers.js. Jede Assertion
 * spiegelt das tatsächliche Verhalten des Quellcodes — bei Code-Änderungen die
 * Tests nachziehen.
 *
 * @jest-environment node
 */

'use strict';

const {
  EXTERNAL_CACHE_MAX_AGE_MS,
  SOURCE_PRIORITY,
  UPGRADE_THRESHOLD_INDEX,
  sourcePriority,
  normaliseEan,
  isExternalCacheStale,
  parseLeadingNumber,
  normaliseScraped,
  normaliseOpenFood,
  normaliseReweapify,
} = require('../lib/normalizers');

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

describe('Konstanten', () => {
  test('EXTERNAL_CACHE_MAX_AGE_MS = 4 Wochen in ms', () => {
    expect(EXTERNAL_CACHE_MAX_AGE_MS).toBe(4 * 7 * 24 * 60 * 60 * 1000);
    expect(EXTERNAL_CACHE_MAX_AGE_MS).toBe(2419200000);
  });

  test('SOURCE_PRIORITY ist die erwartete geordnete Liste', () => {
    expect(SOURCE_PRIORITY).toEqual([
      'rewe',
      'globus',
      'metro',
      'scraper',
      'openfood',
    ]);
  });

  test('UPGRADE_THRESHOLD_INDEX zeigt auf den openfood-Index (4)', () => {
    expect(UPGRADE_THRESHOLD_INDEX).toBe(4);
    expect(UPGRADE_THRESHOLD_INDEX).toBe(SOURCE_PRIORITY.indexOf('openfood'));
  });
});

// ---------------------------------------------------------------------------
// sourcePriority
// ---------------------------------------------------------------------------

describe('sourcePriority', () => {
  test('bekannte Sources → ihr Listen-Index (rewe=0 … openfood=4)', () => {
    expect(sourcePriority('rewe')).toBe(0);
    expect(sourcePriority('globus')).toBe(1);
    expect(sourcePriority('metro')).toBe(2);
    expect(sourcePriority('scraper')).toBe(3);
    expect(sourcePriority('openfood')).toBe(4);
  });

  test('jeder Eintrag aus SOURCE_PRIORITY mappt auf seinen Index', () => {
    SOURCE_PRIORITY.forEach((src, idx) => {
      expect(sourcePriority(src)).toBe(idx);
    });
  });

  test('unbekannte Source → 99', () => {
    expect(sourcePriority('unknown')).toBe(99);
    expect(sourcePriority('REWE')).toBe(99); // case-sensitiv, kein Match
    expect(sourcePriority('')).toBe(99);
  });

  test('null/undefined → 99 (kein Match)', () => {
    expect(sourcePriority(undefined)).toBe(99);
    expect(sourcePriority(null)).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// normaliseEan
// ---------------------------------------------------------------------------

describe('normaliseEan', () => {
  test('entfernt alle Nicht-Ziffern-Zeichen', () => {
    expect(normaliseEan('4-0/6 0800')).toBe('4060800');
  });

  test('lässt eine reine Ziffern-EAN unverändert', () => {
    expect(normaliseEan('4060800')).toBe('4060800');
    expect(normaliseEan('4006381333634')).toBe('4006381333634');
  });

  test('entfernt führende/abschließende Whitespaces (via trim + \\D-Strip)', () => {
    expect(normaliseEan('  4060800  ')).toBe('4060800');
  });

  test('akzeptiert eine numerische Eingabe (String-Cast)', () => {
    expect(normaliseEan(4060800)).toBe('4060800');
  });

  test('null → leerer String', () => {
    expect(normaliseEan(null)).toBe('');
  });

  test('undefined → leerer String', () => {
    expect(normaliseEan(undefined)).toBe('');
  });

  test('leerer String → leerer String', () => {
    expect(normaliseEan('')).toBe('');
  });

  test('String ganz ohne Ziffern → leerer String', () => {
    expect(normaliseEan('abc-/ ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isExternalCacheStale
// ---------------------------------------------------------------------------

describe('isExternalCacheStale', () => {
  test('null cachedAt → stale (true)', () => {
    expect(isExternalCacheStale(null)).toBe(true);
  });

  test('undefined cachedAt → stale (true)', () => {
    expect(isExternalCacheStale(undefined)).toBe(true);
  });

  test('frischer Timestamp (toMillis() = jetzt) → NICHT stale (false)', () => {
    const now = Date.now();
    const ts = { toMillis: () => now };
    expect(isExternalCacheStale(ts)).toBe(false);
  });

  test('Timestamp knapp innerhalb der Max-Age → NICHT stale (false)', () => {
    // 1 Tag jünger als die 4-Wochen-Grenze → noch frisch.
    const ts = {
      toMillis: () =>
        Date.now() - EXTERNAL_CACHE_MAX_AGE_MS + 24 * 60 * 60 * 1000,
    };
    expect(isExternalCacheStale(ts)).toBe(false);
  });

  test('alter Timestamp (älter als 4 Wochen) → stale (true)', () => {
    // 1 Tag älter als die Grenze → stale.
    const ts = {
      toMillis: () =>
        Date.now() - EXTERNAL_CACHE_MAX_AGE_MS - 24 * 60 * 60 * 1000,
    };
    expect(isExternalCacheStale(ts)).toBe(true);
  });

  test('truthy Objekt OHNE toMillis → ts=0 → stale (true)', () => {
    // Kein toMillis → ts fällt auf 0 → Date.now() - 0 > MAX_AGE → true.
    expect(isExternalCacheStale({})).toBe(true);
  });

  test('Epoch-Timestamp (toMillis()=0) → stale (true)', () => {
    const ts = { toMillis: () => 0 };
    expect(isExternalCacheStale(ts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseLeadingNumber
// ---------------------------------------------------------------------------

describe('parseLeadingNumber', () => {
  test('"12,5 g" → 12.5 (Komma→Punkt)', () => {
    expect(parseLeadingNumber('12,5 g')).toBe(12.5);
  });

  test('"130g" → 130', () => {
    expect(parseLeadingNumber('130g')).toBe(130);
  });

  test('führender Integer mit Einheit → Integer', () => {
    expect(parseLeadingNumber('250 kcal')).toBe(250);
  });

  test('führendes negatives Vorzeichen wird übernommen', () => {
    expect(parseLeadingNumber('-3,5 g')).toBe(-3.5);
    expect(parseLeadingNumber('-7')).toBe(-7);
  });

  test('Punkt-Dezimalschreibweise funktioniert ebenfalls', () => {
    expect(parseLeadingNumber('0.4 g')).toBe(0.4);
  });

  test('reine Zahl als String → Zahl', () => {
    expect(parseLeadingNumber('100')).toBe(100);
  });

  test('führende Whitespaces werden getrimmt', () => {
    expect(parseLeadingNumber('   42,0 kJ')).toBe(42);
  });

  test('nur erste Komma-Ersetzung greift (replace ohne /g) — danach Match bis Komma', () => {
    // String.replace(',', '.') ersetzt NUR das erste Komma. "1,2,3" → "1.2,3",
    // der Regex /-?\d+(\.\d+)?/ matcht "1.2" → 1.2.
    expect(parseLeadingNumber('1,2,3')).toBe(1.2);
  });

  test('String OHNE Zahl → undefined', () => {
    expect(parseLeadingNumber('keine zahl')).toBeUndefined();
    expect(parseLeadingNumber('g')).toBeUndefined();
  });

  test('leerer String → undefined (falsy-Guard)', () => {
    expect(parseLeadingNumber('')).toBeUndefined();
  });

  test('null/undefined → undefined', () => {
    expect(parseLeadingNumber(null)).toBeUndefined();
    expect(parseLeadingNumber(undefined)).toBeUndefined();
  });

  test('Nicht-String (number/object/array) → undefined (typeof-Guard)', () => {
    expect(parseLeadingNumber(12.5)).toBeUndefined();
    expect(parseLeadingNumber(0)).toBeUndefined();
    expect(parseLeadingNumber({})).toBeUndefined();
    expect(parseLeadingNumber(['12'])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normaliseOpenFood
// ---------------------------------------------------------------------------

describe('normaliseOpenFood', () => {
  test('voll ausgefülltes OpenFood-Objekt → vollständige Normalisierung', () => {
    const p = {
      product_name: 'Bio Vollmilch',
      generic_name: 'Milch',
      brands: 'Marke X',
      image_front_url: 'https://img/front.jpg',
      image_url: 'https://img/other.jpg',
      quantity: '1 L',
      categories: 'Milchprodukte',
      ingredients_text_de: 'Vollmilch, pasteurisiert',
      ingredients_text: 'Whole milk',
      nutriments: {
        'energy-kcal_100g': 64,
        fat_100g: 3.6,
        'saturated-fat_100g': 2.3,
        carbohydrates_100g: 4.8,
        sugars_100g: 4.8,
        fiber_100g: 0,
        proteins_100g: 3.4,
        salt_100g: 0.1,
      },
      allergens_tags: ['en:milk', 'de:milch', 'en:gluten'],
      nutriscore_grade: 'b',
      ecoscore_grade: 'a',
      nova_group: 1,
    };
    const r = normaliseOpenFood(p);

    expect(r.productName).toBe('Bio Vollmilch');
    expect(r.brandName).toBe('Marke X');
    expect(r.imageUrl).toBe('https://img/front.jpg'); // front bevorzugt
    expect(r.packSize).toBe('1 L');
    expect(r.category).toBe('Milchprodukte');
    expect(r.attr_ingredientStatement).toBe('Vollmilch, pasteurisiert'); // _de bevorzugt

    expect(r.nutr_Energie_val).toBe(64);
    expect(r.nutr_Energie_unit).toBe('kcal');
    expect(r.nutr_Fett_val).toBe(3.6);
    expect(r.nutr_Fett_unit).toBe('g');
    expect(r.nutr_FettdavongesttigteFettsuren_val).toBe(2.3);
    expect(r.nutr_FettdavongesttigteFettsuren_unit).toBe('g');
    expect(r.nutr_Kohlenhydrate_val).toBe(4.8);
    expect(r.nutr_Kohlenhydrate_unit).toBe('g');
    expect(r.nutr_KohlenhydratedavonZucker_val).toBe(4.8);
    expect(r.nutr_KohlenhydratedavonZucker_unit).toBe('g');
    expect(r.nutr_Ballaststoffe_val).toBe(0); // 0 ist eine number → bleibt 0
    expect(r.nutr_Ballaststoffe_unit).toBe('g');
    expect(r.nutr_Eiwei_val).toBe(3.4);
    expect(r.nutr_Eiwei_unit).toBe('g');
    expect(r.nutr_Salz_val).toBe(0.1);
    expect(r.nutr_Salz_unit).toBe('g');
    expect(r.nutr_serving_size).toBe(100);
    expect(r.nutr_serving_unit).toBe('g');

    expect(r.allergen_gluten).toBe(true);
    expect(r.allergen_milk).toBe(true);
    expect(r.allergen_egg).toBe(false);
    expect(r.allergen_nuts).toBe(false);
    expect(r.allergen_soy).toBe(false);

    expect(r.scoreNutri).toBe('b');
    expect(r.scoreEco).toBe('a');
    expect(r.scoreNova).toBe('1'); // String(nova_group)
    expect(r.raw).toBe(p);
  });

  test('product_name fehlt → generic_name greift', () => {
    const r = normaliseOpenFood({ generic_name: 'Joghurt' });
    expect(r.productName).toBe('Joghurt');
  });

  test('product_name und generic_name fehlen → "Unbekannt"', () => {
    const r = normaliseOpenFood({});
    expect(r.productName).toBe('Unbekannt');
  });

  test('sparses Objekt → alle nutr_*_val undefined, units bleiben gesetzt', () => {
    const r = normaliseOpenFood({});

    expect(r.nutr_Energie_val).toBeUndefined();
    expect(r.nutr_Energie_unit).toBe('kcal');
    expect(r.nutr_Fett_val).toBeUndefined();
    expect(r.nutr_Fett_unit).toBe('g');
    expect(r.nutr_FettdavongesttigteFettsuren_val).toBeUndefined();
    expect(r.nutr_Kohlenhydrate_val).toBeUndefined();
    expect(r.nutr_KohlenhydratedavonZucker_val).toBeUndefined();
    expect(r.nutr_Ballaststoffe_val).toBeUndefined();
    expect(r.nutr_Eiwei_val).toBeUndefined();
    expect(r.nutr_Salz_val).toBeUndefined();

    // serving size konstant 100/g
    expect(r.nutr_serving_size).toBe(100);
    expect(r.nutr_serving_unit).toBe('g');

    // keine allergens_tags → has() liefert immer false
    expect(r.allergen_gluten).toBe(false);
    expect(r.allergen_milk).toBe(false);
    expect(r.allergen_egg).toBe(false);
    expect(r.allergen_nuts).toBe(false);
    expect(r.allergen_soy).toBe(false);

    expect(r.scoreNutri).toBeUndefined();
    expect(r.scoreEco).toBeUndefined();
    expect(r.scoreNova).toBeUndefined();
  });

  test('nutriment-Werte vom falschen Typ (String) → undefined (number-Guard)', () => {
    const r = normaliseOpenFood({
      nutriments: { 'energy-kcal_100g': '64', fat_100g: null },
    });
    expect(r.nutr_Energie_val).toBeUndefined();
    expect(r.nutr_Fett_val).toBeUndefined();
  });

  test('image_front_url fehlt → Fallback auf image_url', () => {
    const r = normaliseOpenFood({ image_url: 'https://img/url.jpg' });
    expect(r.imageUrl).toBe('https://img/url.jpg');
  });

  test('ingredients_text_de fehlt → Fallback auf ingredients_text', () => {
    const r = normaliseOpenFood({ ingredients_text: 'Sugar, milk' });
    expect(r.attr_ingredientStatement).toBe('Sugar, milk');
  });

  test('Allergen-Detection: Substring + case-insensitiv (en:/de: Tags)', () => {
    const r = normaliseOpenFood({
      allergens_tags: [
        'en:GLUTEN',
        'de:Soja',
        'en:tree-nuts',
        'en:eggs',
      ],
    });
    expect(r.allergen_gluten).toBe(true); // 'gluten' in 'en:gluten' (lowercased)
    expect(r.allergen_soy).toBe(true); // 'soja'
    expect(r.allergen_nuts).toBe(true); // 'nut' in 'tree-nuts'
    expect(r.allergen_egg).toBe(true); // 'egg' in 'eggs'
    expect(r.allergen_milk).toBe(false);
  });

  test('allergen_milk via deutsches "milch"-Tag', () => {
    const r = normaliseOpenFood({ allergens_tags: ['de:milch'] });
    expect(r.allergen_milk).toBe(true);
  });

  test('scoreNova nur gesetzt wenn nova_group eine number ist', () => {
    expect(normaliseOpenFood({ nova_group: 4 }).scoreNova).toBe('4');
    expect(normaliseOpenFood({ nova_group: '4' }).scoreNova).toBeUndefined();
    expect(normaliseOpenFood({}).scoreNova).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normaliseReweapify
// ---------------------------------------------------------------------------

describe('normaliseReweapify', () => {
  test('voll ausgefülltes reweapify-Objekt → kanonische Felder', () => {
    const data = {
      productName: 'Kerrygold Butter',
      image: 'https://rewe/img.jpg',
      price_current: 2.49,
      price_regular: 2.99,
      price_grammage: '250g (1 kg = 9,96 €)',
      attr_BrandId: 'Kerrygold',
      attr_ContactName: 'Ornua Deutschland GmbH',
      url: 'https://shop.rewe.de/p/kerrygold',
      productCategory: 'Butter',
      attr_ingredientStatement: 'Rahm, Salz',
      nutr_Energie_val: 740,
      nutr_Energie_unit: 'kcal',
      nutr_Fett_val: 82,
      nutr_Fett_unit: 'g',
      nutr_FettdavongesttigteFettsuren_val: 52,
      nutr_FettdavongesttigteFettsuren_unit: 'g',
      nutr_Kohlenhydrate_val: 0.7,
      nutr_Kohlenhydrate_unit: 'g',
      nutr_KohlenhydratedavonZucker_val: 0.7,
      nutr_KohlenhydratedavonZucker_unit: 'g',
      nutr_Ballaststoffe_val: 0,
      nutr_Ballaststoffe_unit: 'g',
      nutr_Eiwei_val: 0.7,
      nutr_Eiwei_unit: 'g',
      nutr_Salz_val: 1.2,
      nutr_Salz_unit: 'g',
      nutr_serving_size: 100,
      nutr_serving_unit: 'g',
      attr_nutri_score: 'd',
      attr_eco_score: 'c',
      attr_isVegan: false,
      attr_isVegetarisch: true,
    };
    const r = normaliseReweapify(data);

    expect(r.productName).toBe('Kerrygold Butter');
    expect(r.brandName).toBe('Kerrygold');
    expect(r.manufacturerName).toBe('Ornua Deutschland GmbH');
    expect(r.imageUrl).toBe('https://rewe/img.jpg');
    expect(r.price).toBe(2.49); // price_current vor price_regular
    expect(r.packSize).toBe('250g'); // grammage vor der Klammer
    expect(r.category).toBe('Butter');
    expect(r.sourceUrl).toBe('https://shop.rewe.de/p/kerrygold');
    expect(r.attr_ingredientStatement).toBe('Rahm, Salz');

    expect(r.nutr_Energie_val).toBe(740);
    expect(r.nutr_Energie_unit).toBe('kcal');
    expect(r.nutr_Fett_val).toBe(82);
    expect(r.nutr_FettdavongesttigteFettsuren_val).toBe(52);
    expect(r.nutr_Kohlenhydrate_val).toBe(0.7);
    expect(r.nutr_KohlenhydratedavonZucker_val).toBe(0.7);
    expect(r.nutr_Ballaststoffe_val).toBe(0);
    expect(r.nutr_Eiwei_val).toBe(0.7);
    expect(r.nutr_Salz_val).toBe(1.2);
    expect(r.nutr_serving_size).toBe(100);
    expect(r.nutr_serving_unit).toBe('g');

    expect(r.scoreNutri).toBe('d');
    expect(r.scoreEco).toBe('c');
    expect(r.isVegan).toBe(false);
    expect(r.isVegetarian).toBe(true);
    expect(r.raw).toBe(data);
  });

  test('productName-Fallback-Kette: attr_productName → title → "Produkt"', () => {
    expect(normaliseReweapify({ attr_productName: 'A' }).productName).toBe('A');
    expect(normaliseReweapify({ title: 'B' }).productName).toBe('B');
    expect(normaliseReweapify({}).productName).toBe('Produkt');
  });

  test('brandName-Fallback-Kette (attr_BrandId → brandKey → brandName → attr_brand → attr_marke)', () => {
    expect(normaliseReweapify({ attr_BrandId: 'X' }).brandName).toBe('X');
    expect(normaliseReweapify({ brandKey: 'Y' }).brandName).toBe('Y');
    expect(normaliseReweapify({ brandName: 'Z' }).brandName).toBe('Z');
    expect(normaliseReweapify({ attr_brand: 'M' }).brandName).toBe('M');
    expect(normaliseReweapify({ attr_marke: 'N' }).brandName).toBe('N');
    expect(normaliseReweapify({}).brandName).toBeUndefined();
  });

  test('manufacturerName-Fallback (attr_ContactName → attr_hersteller → producer)', () => {
    expect(
      normaliseReweapify({ attr_hersteller: 'H' }).manufacturerName
    ).toBe('H');
    expect(normaliseReweapify({ producer: 'P' }).manufacturerName).toBe('P');
    expect(normaliseReweapify({}).manufacturerName).toBeUndefined();
  });

  test('price-Fallback-Kette: price_regular → attr_preis → price → undefined', () => {
    expect(normaliseReweapify({ price_regular: 1.99 }).price).toBe(1.99);
    expect(normaliseReweapify({ attr_preis: 3.49 }).price).toBe(3.49);
    expect(normaliseReweapify({ price: 0.89 }).price).toBe(0.89);
    expect(normaliseReweapify({}).price).toBeUndefined();
  });

  test('price ignoriert Nicht-Number-Werte (typeof-Guard)', () => {
    // price_current ist ein String → fällt durch; price_regular number → greift.
    const r = normaliseReweapify({ price_current: '2.49', price_regular: 2.99 });
    expect(r.price).toBe(2.99);
  });

  test('packSize: price_grammage ohne Klammer → getrimmt', () => {
    expect(normaliseReweapify({ price_grammage: '130g' }).packSize).toBe('130g');
  });

  test('packSize: price_grammage mit Klammer → Teil vor "(" getrimmt', () => {
    expect(
      normaliseReweapify({ price_grammage: '130g (1 kg = 23 €)' }).packSize
    ).toBe('130g');
  });

  test('packSize-Fallback: attr_packageSize (number) + attr_packageUnit', () => {
    const r = normaliseReweapify({
      attr_packageSize: 500,
      attr_packageUnit: 'ml',
    });
    expect(r.packSize).toBe('500 ml');
  });

  test('packSize-Fallback: attr_preisPackgroesse (string)', () => {
    const r = normaliseReweapify({ attr_preisPackgroesse: '6 x 0,33 l' });
    expect(r.packSize).toBe('6 x 0,33 l');
  });

  test('packSize-Fallback: itemSize wenn nichts anderes greift', () => {
    expect(normaliseReweapify({ itemSize: '1 kg' }).packSize).toBe('1 kg');
    expect(normaliseReweapify({}).packSize).toBeUndefined();
  });

  test('image-Fallback-Kette: images[0] → productImageUrl → attr_image', () => {
    expect(
      normaliseReweapify({ images: ['https://a.jpg', 'https://b.jpg'] }).imageUrl
    ).toBe('https://a.jpg');
    expect(
      normaliseReweapify({ productImageUrl: 'https://c.jpg' }).imageUrl
    ).toBe('https://c.jpg');
    expect(normaliseReweapify({ attr_image: 'https://d.jpg' }).imageUrl).toBe(
      'https://d.jpg'
    );
    expect(normaliseReweapify({}).imageUrl).toBeUndefined();
  });

  test('image: leerer image-String fällt durch auf images[0]', () => {
    const r = normaliseReweapify({ image: '', images: ['https://x.jpg'] });
    expect(r.imageUrl).toBe('https://x.jpg');
  });

  test('sourceUrl-Fallback: scrapedUrl bevorzugt vor url', () => {
    expect(
      normaliseReweapify({ scrapedUrl: 'https://s', url: 'https://u' }).sourceUrl
    ).toBe('https://s');
    expect(normaliseReweapify({ url: 'https://u' }).sourceUrl).toBe('https://u');
    expect(normaliseReweapify({}).sourceUrl).toBeUndefined();
  });

  test('category-Fallback: attr_category → productGroupId (nur wenn string)', () => {
    expect(normaliseReweapify({ attr_category: 'Käse' }).category).toBe('Käse');
    expect(
      normaliseReweapify({ productGroupId: 'GRP-1' }).category
    ).toBe('GRP-1');
    // productGroupId number → kein string-Guard → undefined
    expect(normaliseReweapify({ productGroupId: 42 }).category).toBeUndefined();
  });

  test('nutr_*_val: Nicht-Number-Eingaben → undefined (number-Guard)', () => {
    const r = normaliseReweapify({
      nutr_Energie_val: '740',
      nutr_Fett_val: null,
      nutr_Salz_val: undefined,
    });
    expect(r.nutr_Energie_val).toBeUndefined();
    expect(r.nutr_Fett_val).toBeUndefined();
    expect(r.nutr_Salz_val).toBeUndefined();
  });

  test('nutr_serving_size / _unit: Defaults (100 / "g") wenn nicht gesetzt', () => {
    const r = normaliseReweapify({});
    expect(r.nutr_serving_size).toBe(100);
    expect(r.nutr_serving_unit).toBe('g');
  });

  test('nutr_serving_size: vorhandener Wert übersteuert Default', () => {
    const r = normaliseReweapify({ nutr_serving_size: 30, nutr_serving_unit: 'ml' });
    expect(r.nutr_serving_size).toBe(30);
    expect(r.nutr_serving_unit).toBe('ml');
  });

  test('leeres Objekt → vollständig defaultet, kein Throw', () => {
    const r = normaliseReweapify({});
    expect(r.productName).toBe('Produkt');
    expect(r.imageUrl).toBeUndefined();
    expect(r.price).toBeUndefined();
    expect(r.packSize).toBeUndefined();
    expect(r.nutr_serving_size).toBe(100);
    expect(r.raw).toEqual({});
  });

  test('undefined/null data → kein Throw (optional chaining), Defaults greifen', () => {
    const r = normaliseReweapify(undefined);
    expect(r.productName).toBe('Produkt');
    expect(r.price).toBeUndefined();
    expect(r.nutr_serving_size).toBe(100);
    expect(r.nutr_serving_unit).toBe('g');
    expect(r.raw).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normaliseScraped
// ---------------------------------------------------------------------------

describe('normaliseScraped', () => {
  test('voll ausgefülltes ScrapedProduct → vollständige Normalisierung', () => {
    const p = {
      productName: 'No-Name Cola',
      brandName: 'Eigenmarke',
      producer: 'Abfüller GmbH',
      master_manufacturer_id: 'mm-123',
      herstellerId: 'h-999',
      thumbnails: ['https://thumb/0.jpg', 'https://thumb/1.jpg'],
      images: ['https://img/0.jpg'],
      price: 0.39,
      itemSize: '1,5 L',
      productCategory: 'Softdrinks',
      productDescription: 'Erfrischend',
      ingredients: 'Wasser, Zucker, Kohlensäure',
      allergens_gluten: false,
      allergens_milk: false,
      allergens_egg: false,
      allergens_nuts: false,
      allergens_soy: false,
      isVegan: true,
      isVegetarian: true,
      isGlutenFree: true,
      isLactoseFree: true,
      nutrition_caloriesKcal: '42 kcal',
      nutrition_totalFat: '0 g',
      nutrition_saturatedFat: '0 g',
      nutrition_totalCarbohydrates: '10,6 g',
      nutrition_sugar: '10,6 g',
      nutrition_protein: '0 g',
      nutrition_salt: '0,01 g',
      nutrition_servingSize: '100 ml',
    };
    const r = normaliseScraped(p);

    expect(r.productName).toBe('No-Name Cola');
    expect(r.brandName).toBe('Eigenmarke');
    expect(r.manufacturerName).toBe('Abfüller GmbH');
    expect(r.manufacturerRef).toBe('mm-123'); // master_manufacturer_id bevorzugt
    expect(r.imageUrl).toBe('https://thumb/0.jpg'); // thumbnails[0] bevorzugt
    expect(r.price).toBe(0.39);
    expect(r.packSize).toBe('1,5 L');
    expect(r.category).toBe('Softdrinks');
    expect(r.productDescription).toBe('Erfrischend');
    expect(r.attr_ingredientStatement).toBe('Wasser, Zucker, Kohlensäure');

    expect(r.allergen_gluten).toBe(false);
    expect(r.allergen_milk).toBe(false);
    expect(r.allergen_egg).toBe(false);
    expect(r.allergen_nuts).toBe(false);
    expect(r.allergen_soy).toBe(false);
    expect(r.isVegan).toBe(true);
    expect(r.isVegetarian).toBe(true);
    expect(r.isGlutenFree).toBe(true);
    expect(r.isLactoseFree).toBe(true);

    // String-Nutrition → parseLeadingNumber-Float, Units hardcoded
    expect(r.nutr_Energie_val).toBe(42);
    expect(r.nutr_Energie_unit).toBe('kcal');
    expect(r.nutr_Fett_val).toBe(0);
    expect(r.nutr_Fett_unit).toBe('g');
    expect(r.nutr_FettdavongesttigteFettsuren_val).toBe(0);
    expect(r.nutr_FettdavongesttigteFettsuren_unit).toBe('g');
    expect(r.nutr_Kohlenhydrate_val).toBe(10.6);
    expect(r.nutr_Kohlenhydrate_unit).toBe('g');
    expect(r.nutr_KohlenhydratedavonZucker_val).toBe(10.6);
    expect(r.nutr_KohlenhydratedavonZucker_unit).toBe('g');
    expect(r.nutr_Eiwei_val).toBe(0);
    expect(r.nutr_Eiwei_unit).toBe('g');
    expect(r.nutr_Salz_val).toBe(0.01);
    expect(r.nutr_Salz_unit).toBe('g');
    expect(r.nutr_serving_size).toBe(100); // "100 ml" → 100
    expect(r.nutr_serving_unit).toBe('g'); // hardcoded

    expect(r.raw).toBe(p);
  });

  test('image: thumbnails leer → images[0]', () => {
    const r = normaliseScraped({ thumbnails: [], images: ['https://i.jpg'] });
    expect(r.imageUrl).toBe('https://i.jpg');
  });

  test('image: weder thumbnails noch images → undefined', () => {
    expect(normaliseScraped({}).imageUrl).toBeUndefined();
    expect(
      normaliseScraped({ thumbnails: [], images: [] }).imageUrl
    ).toBeUndefined();
  });

  test('manufacturerRef-Fallback: herstellerId wenn master_manufacturer_id fehlt', () => {
    expect(
      normaliseScraped({ herstellerId: 'h-1' }).manufacturerRef
    ).toBe('h-1');
    expect(normaliseScraped({}).manufacturerRef).toBeUndefined();
  });

  test('price: Nicht-Number → undefined (typeof-Guard)', () => {
    expect(normaliseScraped({ price: '0.39' }).price).toBeUndefined();
    expect(normaliseScraped({ price: null }).price).toBeUndefined();
    expect(normaliseScraped({}).price).toBeUndefined();
    expect(normaliseScraped({ price: 0 }).price).toBe(0); // 0 ist number → bleibt
  });

  test('String-Nutrition-Felder: parseLeadingNumber greift ("12,5 g" → 12.5)', () => {
    const r = normaliseScraped({
      nutrition_totalFat: '12,5 g',
      nutrition_protein: '7.2 g',
    });
    expect(r.nutr_Fett_val).toBe(12.5);
    expect(r.nutr_Eiwei_val).toBe(7.2);
  });

  test('fehlende Nutrition-Strings → val undefined, units trotzdem gesetzt', () => {
    const r = normaliseScraped({});
    expect(r.nutr_Energie_val).toBeUndefined();
    expect(r.nutr_Energie_unit).toBe('kcal');
    expect(r.nutr_Fett_val).toBeUndefined();
    expect(r.nutr_Fett_unit).toBe('g');
    expect(r.nutr_FettdavongesttigteFettsuren_val).toBeUndefined();
    expect(r.nutr_Kohlenhydrate_val).toBeUndefined();
    expect(r.nutr_KohlenhydratedavonZucker_val).toBeUndefined();
    expect(r.nutr_Eiwei_val).toBeUndefined();
    expect(r.nutr_Salz_val).toBeUndefined();
  });

  test('nutr_serving_size fällt auf 100 zurück wenn servingSize fehlt/unparsbar', () => {
    expect(normaliseScraped({}).nutr_serving_size).toBe(100);
    expect(
      normaliseScraped({ nutrition_servingSize: 'keine zahl' }).nutr_serving_size
    ).toBe(100);
  });

  test('nutr_serving_size: parsbarer String übersteuert den 100-Default', () => {
    expect(
      normaliseScraped({ nutrition_servingSize: '30 g' }).nutr_serving_size
    ).toBe(30);
  });

  test('nutr_serving_unit ist immer "g" (hardcoded)', () => {
    expect(normaliseScraped({}).nutr_serving_unit).toBe('g');
    expect(
      normaliseScraped({ nutrition_servingSize: '100 ml' }).nutr_serving_unit
    ).toBe('g');
  });
});
