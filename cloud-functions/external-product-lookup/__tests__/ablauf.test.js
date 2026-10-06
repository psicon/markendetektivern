/**
 * Ablauf-Tests für index.js: Abfrage (resolveExternalProduct) und Trigger
 * (onNutritionScrapeFuerExterne) gegen einen Firestore-Ersatz im Speicher
 * (helfer/fakeFirestore.js) und ein nachgebautes OpenFoodFacts.
 *
 * @jest-environment node
 */

'use strict';

const TAG = 24 * 60 * 60 * 1000;
const JETZT = Date.parse('2026-10-04T12:00:00Z');

jest.mock('firebase-functions', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));
jest.mock('firebase-functions/v2/https', () => ({ onRequest: (_opts, h) => h }));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (_opts, h) => h }));
jest.mock('firebase-admin', () => {
  const { FakeDb, FakeTimestamp, FieldValue } = require('./helfer/fakeFirestore');
  const db = new FakeDb(() => Date.now());
  const firestore = () => db;
  firestore.FieldValue = FieldValue;
  firestore.Timestamp = FakeTimestamp;
  return {
    apps: [],
    initializeApp: () => {},
    firestore,
    auth: () => ({
      verifyIdToken: async (t) => {
        if (t === 'nutzer') return { uid: 'u1' };
        if (t === 'admin') return { uid: 'a1', admin: true };
        throw new Error('ungültig');
      },
    }),
    __db: db,
  };
});

const admin = require('firebase-admin');
const { FakeTimestamp } = require('./helfer/fakeFirestore');
const { _zuruecksetzen } = require('../lib/konfiguration');
const { resolveExternalProduct, onNutritionScrapeFuerExterne } = require('../index');

const db = admin.__db;
const ts = (ms) => new FakeTimestamp(ms);

// ─── OpenFoodFacts-Nachbau ───────────────────────────────────────────
let offAntworten; // ean → { status, body } | 'zeitlimit'
let offAufrufe;
function offAntwort(ean, status, product) {
  offAntworten[ean] = { status, body: product ? { status: 1, product } : { status: 0 } };
}

beforeEach(() => {
  db.daten.clear();
  db.schreibvorgaenge.length = 0;
  _zuruecksetzen();
  offAntworten = {};
  offAufrufe = [];
  jest.useFakeTimers({ now: JETZT, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  global.fetch = jest.fn(async (url) => {
    const ean = /product\/(\d+)\.json/.exec(url)[1];
    offAufrufe.push(ean);
    const a = offAntworten[ean] || { status: 404, body: { status: 0 } };
    if (a === 'zeitlimit') {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    }
    return { status: a.status, ok: a.status < 400, json: async () => a.body };
  });
});

afterEach(() => {
  jest.useRealTimers();
});

async function rufe(ean, { token = 'nutzer', force } = {}) {
  const res = {
    code: null,
    body: null,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  await resolveExternalProduct(
    { headers: { authorization: `Bearer ${token}` }, body: force === undefined ? { ean } : { ean, force }, query: {} },
    res,
  );
  return res;
}

const ext = (ean) => db.lies(`external_products/${ean}`);
const miss = (ean) => db.lies(`external_lookup_misses/${ean}`);

const OFF_GOLDEN = {
  product_name: 'Golden Puffs',
  brands: 'Crownfield',
  image_front_url: 'https://images.openfoodfacts.org/golden.jpg',
  ingredients_text_de: 'Weizen, Zucker',
  nutriments: { 'energy-kcal_100g': 380 },
};

describe('Abfrage: Barcode ohne Daten', () => {
  test('OpenFoodFacts 404 → product null, Warteschlange pending/neu, KEIN external_products-Dokument', async () => {
    const res = await rufe('4001234567890');
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ product: null });
    expect(ext('4001234567890')).toBeUndefined();
    const m = miss('4001234567890');
    expect(m).toMatchObject({ status: 'pending', grund: 'neu', hitCount: 1, scanTage: 1, letzterScanTag: '2026-10-04' });
    expect(m.rang).toBe(1e13 + JETZT);
  });

  // Prüfrunde 2: Ein OpenFoodFacts-Ausfall ist keine Aussage über das Produkt
  // (nichts in external_products) — der Barcode kommt trotzdem in die
  // Warteschlange: der Prozessor sucht ohnehin ohne OpenFoodFacts, und ohne
  // Eintrag nähme die Suche während eines OFF-Ausfalls nichts Neues an.
  test('OpenFoodFacts 429 → nichts negativ gespeichert, Pause gesetzt, Suche eingeplant; Antwortformat wie bisher', async () => {
    offAntworten['4001234567890'] = { status: 429, body: {} };
    const res = await rufe('4001234567890');
    expect(res.body).toEqual({ product: null });
    expect(ext('4001234567890')).toBeUndefined();
    expect(miss('4001234567890')).toMatchObject({ status: 'pending', grund: 'neu' });
    expect(db.lies('_meta/openFoodRateLimit').rateLimitUntilMs).toBeGreaterThan(JETZT);
  });

  test('während der Pause wird OpenFoodFacts gar nicht gefragt — und auch das ist kein „nicht vorhanden"', async () => {
    db.lege('_meta/openFoodRateLimit', { rateLimitUntilMs: JETZT + 10_000 });
    const res = await rufe('4001234567890');
    expect(offAufrufe).toEqual([]);
    expect(res.body).toEqual({ product: null });
    expect(ext('4001234567890')).toBeUndefined();
    expect(miss('4001234567890')).toMatchObject({ status: 'pending', grund: 'neu' });
  });

  test.each([
    ['Zeitlimit', 'zeitlimit'],
    ['503', { status: 503, body: {} }],
    ['403 (gesperrt)', { status: 403, body: {} }],
  ])('%s gilt ebenso als nicht erreichbar', async (_name, antwort) => {
    offAntworten['111'] = antwort;
    expect((await rufe('111')).body).toEqual({ product: null });
    expect(ext('111')).toBeUndefined();
    expect(miss('111')).toMatchObject({ status: 'pending', grund: 'neu' });
  });

  test('eigene Ablage nicht lesbar → „nichts gefunden" ist keine Aussage: kein Eintrag in der Warteschlange', async () => {
    const original = db.collection;
    db.collection = function (name) {
      const q = original.call(this, name);
      if (name !== 'reweapify') return q;
      return { where: () => ({ limit: () => ({ get: async () => { throw new Error('UNAVAILABLE'); } }) }) };
    };
    try {
      expect((await rufe('4001234567890')).body).toEqual({ product: null });
      expect(miss('4001234567890')).toBeUndefined();
    } finally {
      db.collection = original;
    }
  });

  test('ungültige Anfragen', async () => {
    expect((await rufe('abc')).code).toBe(400);
    expect((await rufe('4001234567890', { token: 'falsch' })).code).toBe(401);
  });
});

describe('Abfrage: OpenFoodFacts-Treffer', () => {
  test('wird mit storedAt/fetchedAt gespeichert; Warteschlange nur_openfood; Antwortformat wie bisher', async () => {
    offAntwort('20003180', 200, OFF_GOLDEN);
    const res = await rufe('20003180');
    expect(Object.keys(res.body).sort()).toEqual(['fromCache', 'product', 'refreshed']);
    expect(res.body.product.productName).toBe('Golden Puffs');
    expect(res.body.product.raw).toBeUndefined();
    expect(res.body.fromCache).toBe(false);

    const d = ext('20003180');
    expect(d.storedAt.toMillis()).toBe(JETZT);
    expect(d.fetchedAt.toMillis()).toBe(JETZT);
    expect(d.fetchedAtQuelle).toBe('openfood_api');
    expect(d.cachedAt.toMillis()).toBe(JETZT);
    expect(d.source).toBe('openfood');
    expect(miss('20003180')).toMatchObject({ status: 'pending', grund: 'nur_openfood', bestSource: 'openfood' });
  });

  test('Scanner + Detailseite binnen Sekunden zählen einmal', async () => {
    offAntwort('20003180', 200, OFF_GOLDEN);
    await rufe('20003180');
    jest.setSystemTime(JETZT + 1500);
    const zweiter = await rufe('20003180');
    expect(zweiter.body.fromCache).toBe(true);
    expect(miss('20003180').hitCount).toBe(1);
  });
});

describe('Abfrage: Altbestand', () => {
  test('„Produkt"-Dokument: Antwort mit gerettetem Namen; beim Aufwerten wird der Name gespeichert', async () => {
    db.lege('external_products/20003180', {
      ean: '20003180',
      source: 'openfoodfacts',
      productName: 'Produkt',
      imageUrl: 'https://images.openfoodfacts.org/golden.jpg',
      raw: { product_name: 'Golden Puffs', sourceShop: 'openfoodfacts' },
      cachedAt: ts(JETZT - 10 * TAG),
      aiAssessment: { healthScore: 2 },
    });
    db.lege('nutritionscrape/20003180', {
      gtin: '20003180',
      sourceShop: 'lidl.de',
      scrapedUrl: 'https://www.lidl.de/p/20003180',
      fetchedAt: ts(JETZT - TAG),
      scrapedAt: ts(JETZT - TAG),
      attr_ingredientStatement: 'Vollkornweizen 60 %, Zucker',
      attr_preis: 1.29,
      priceCurrency: 'EUR',
      priceShop: 'lidl.de',
      priceFetchedAt: ts(JETZT - TAG),
    });
    const res = await rufe('20003180');
    expect(res.body.product.productName).toBe('Golden Puffs');
    const d = ext('20003180');
    expect(d.productName).toBe('Golden Puffs');
    expect(d.attr_ingredientStatement).toBe('Vollkornweizen 60 %, Zucker');
    expect(d.price).toBe(1.29);
    expect(d.priceShop).toBe('lidl.de');
    expect(d.aiAssessment).toEqual({ healthScore: 2 });
    expect(d.storedAt).toBeUndefined(); // Altbestand: storedAt trägt die Nachpflege nach
    expect(d.lastUpgradeAttemptAt.toMillis()).toBe(JETZT);
  });

  test('Dokument ohne Namen (nur Zutaten): Anzeigename nur in der Antwort', async () => {
    db.lege('external_products/555', {
      ean: '555',
      source: 'rossmann',
      attr_ingredientStatement: 'Aqua',
      cachedAt: ts(JETZT - TAG),
    });
    const res = await rufe('555');
    expect(res.body.product.productName).toBe('Produkt');
    expect(res.body.product).not.toHaveProperty('nameFehlt');
    expect(ext('555').productName).toBeUndefined();
  });

  test('OpenFoodFacts-Daten älter als 60 Tage → kostenlos neu geholt, höchstens einmal je Frist', async () => {
    db.lege('external_products/20003180', {
      ean: '20003180',
      source: 'openfood',
      productName: 'Golden Puffs alt',
      fetchedAt: ts(JETZT - 70 * TAG),
      fetchedAtQuelle: 'openfood_api',
      cachedAt: ts(JETZT - 70 * TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG), // Aufwertung im Cooldown
    });
    offAntwort('20003180', 200, OFF_GOLDEN);
    const res = await rufe('20003180');
    expect(offAufrufe).toEqual(['20003180']);
    expect(res.body.refreshed).toBe(true);
    const d = ext('20003180');
    expect(d.productName).toBe('Golden Puffs');
    expect(d.fetchedAt.toMillis()).toBe(JETZT);
    expect(d.openfoodVersuchtAm.toMillis()).toBe(JETZT);

    jest.setSystemTime(JETZT + 5 * TAG);
    await rufe('20003180');
    expect(offAufrufe).toEqual(['20003180']);
  });

  test('OFF-Auffrischung: Produkt dort verschwunden → alte Daten bleiben, Versuch vermerkt', async () => {
    db.lege('external_products/20003180', {
      ean: '20003180',
      source: 'openfood',
      productName: 'Golden Puffs',
      fetchedAt: ts(JETZT - 70 * TAG),
      cachedAt: ts(JETZT - 70 * TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
    });
    const res = await rufe('20003180');
    expect(res.body.product.productName).toBe('Golden Puffs');
    expect(ext('20003180').productName).toBe('Golden Puffs');
    expect(ext('20003180').openfoodVersuchtAm.toMillis()).toBe(JETZT);
  });
});

describe('Abfrage: ungeprüfter Altbestand (Prüfrunde 2)', () => {
  const { altbestand } = require('./helfer/altbestand');

  test.each(['3560070417148', '4000980231414', '4000540031874', '2009010284293'])(
    '%s: Scan nach dem Cooldown überschreibt die OFF-Zutaten nicht mit der fremden Rohablage',
    async (ean) => {
      const { ep, ns } = altbestand(ean, ts);
      db.lege(`external_products/${ean}`, { ...ep, lastUpgradeAttemptAt: ts(JETZT - 30 * TAG) });
      db.lege(`nutritionscrape/${ean}`, ns);
      const vorher = ext(ean);
      const res = await rufe(ean);
      expect(res.body.product.attr_ingredientStatement).toBe(vorher.attr_ingredientStatement);
      expect(res.body.product.nutr_Energie_val).toBe(vorher.nutr_Energie_val);
      expect(ext(ean).attr_ingredientStatement).toBe(vorher.attr_ingredientStatement);
      expect(ext(ean).source).toBe('openfood');
    },
  );

  test('20006204: fremder Altbestand im Dokument wird beim Scan entfernt — OFF-Daten zurück', async () => {
    const { ep } = altbestand('20006204', ts);
    db.lege('external_products/20006204', ep);
    db.lege('external_lookup_misses/20006204', {
      ean: '20006204', status: 'resolved', processedSource: 'gastro-direkt.de', processedResult: 'ok',
      processedAt: ts(JETZT - 5 * TAG), lastSeenAt: ts(JETZT - 5 * TAG), hitCount: 4,
    });
    const res = await rufe('20006204');
    // Der frühere „Fund" war fremd → sofort wieder offen, ohne ihn.
    expect(miss('20006204')).toMatchObject({ status: 'pending', grund: 'nur_openfood' });
    expect(miss('20006204').processedSource).toBeUndefined();
    expect(res.body.product.productName).toBe('Weizenbrötchen');
    expect(res.body.product.attr_ingredientStatement).toMatch(/^6 baguette-brötchen/);
    const d = ext('20006204');
    expect(d.attr_ingredientStatement).toMatch(/^6 baguette-brötchen/);
    expect(d.manufacturerName).toBeUndefined();
    expect(d.price).toBeUndefined();
    expect(d.raw).toBeUndefined();
    expect(d.source).toBe('openfood');
    // Der nächste Scan schreibt nichts mehr daran (raw ist weg).
    const schreib = db.schreibvorgaenge.length;
    jest.setSystemTime(JETZT + 10 * 60 * 1000);
    await rufe('20006204');
    expect(db.schreibvorgaenge.slice(schreib).filter(([, pfad]) => pfad === 'external_products/20006204')).toEqual([]);
  });

  test('Daten der OFF-Webseite: API kennt die EAN nicht → entfernt (nichts bleibt → Dokument weg)', async () => {
    db.lege('external_products/4000540031874', {
      ean: '4000540031874',
      source: 'openfoodfacts',
      attr_ingredientStatement: 'Weizenmehl, Wasser, Hefe',
      cachedAt: ts(JETZT - TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
      raw: { scrapedSource: 'scraper', sourceShop: 'openfoodfacts', scrapedAt: ts(JETZT - 90 * TAG), scrapedUrl: 'https://de.openfoodfacts.org/produkt/4000540031874/x' },
    });
    const res = await rufe('4000540031874');
    expect(offAufrufe).toEqual(['4000540031874']);
    expect(res.body).toEqual({ product: null });
    expect(ext('4000540031874')).toBeUndefined();
  });

  test('Daten der OFF-Webseite: API kennt die EAN nicht → Webseiten-Zutaten weg, OFF-Bild bleibt; Antwort zeigt schon die bereinigte Fassung', async () => {
    db.lege('external_products/4000540031874', {
      ean: '4000540031874',
      source: 'openfoodfacts',
      productName: 'Schoko Hafer-Müsli',
      imageUrl: 'https://images.openfoodfacts.org/m.jpg',
      attr_ingredientStatement: 'Weizenmehl, Wasser, Hefe',
      feldQuellen: { name: 'openfood', bild: 'openfood', zutaten: 'openfoodfacts' },
      cachedAt: ts(JETZT - TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
    });
    const res = await rufe('4000540031874');
    expect(res.body.product.attr_ingredientStatement).toBeUndefined();
    expect(res.body.product.imageUrl).toBe('https://images.openfoodfacts.org/m.jpg');
    expect(ext('4000540031874').attr_ingredientStatement).toBeUndefined();
    expect(ext('4000540031874').openfoodVersuchtAm.toMillis()).toBe(JETZT);
  });

  // Prüfrunde 3: Bis dahin legte der nächste Scan das gelöschte Dokument aus
  // nutritionscrape neu an — im Wechsel gelöscht und angelegt, jede Neuanlage
  // weckte die KI-Bewertung (onExternalProductCreateForAssessment).
  test('Daten der OFF-Webseite, API kennt die EAN nicht: einmal gelöscht, danach kein Neuanlegen; Fall einmal neu geöffnet', async () => {
    const ean = '4005500084136';
    const rohablage = {
      gtin: ean,
      scrapedSource: 'scraper',
      sourceShop: 'openfoodfacts',
      scrapedAt: ts(JETZT - 90 * TAG),
      scrapedUrl: `https://de.openfoodfacts.org/produkt/${ean}/knusper`,
      attr_ingredientStatement: 'Hafer, Zucker',
    };
    db.lege(`nutritionscrape/${ean}`, rohablage);
    db.lege(`external_products/${ean}`, {
      ean,
      source: 'openfoodfacts',
      attr_ingredientStatement: 'Hafer, Zucker',
      cachedAt: ts(JETZT - 90 * TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
      raw: rohablage,
    });
    db.lege(`external_lookup_misses/${ean}`, {
      ean, status: 'resolved', processedSource: 'openfoodfacts', processedResult: 'ok',
      processedAt: ts(JETZT - 90 * TAG), lastSeenAt: ts(JETZT - 5 * TAG), hitCount: 3,
    });

    const zustaende = [];
    for (let i = 0; i < 5; i += 1) {
      jest.setSystemTime(JETZT + i * 10 * 60 * 1000);
      const res = await rufe(ean);
      zustaende.push([res.body.product, ext(ean)]);
    }
    expect(zustaende.every(([antwort, dok]) => antwort === null && dok === undefined)).toBe(true);
    const anExt = db.schreibvorgaenge.filter(([, pfad]) => pfad === `external_products/${ean}`).map(([art]) => art);
    expect(anExt).toEqual(['delete']); // kein set/merge = keine Neuanlage, keine KI-Bewertung
    // Der frühere „Fund" war widerlegt → einmal neu offen, ohne ihn.
    const m = miss(ean);
    expect(m).toMatchObject({ status: 'pending', grund: 'neu' });
    expect(m.processedSource).toBeUndefined();
    expect(m.altbestandVerworfenAm.toMillis()).toBe(JETZT);
  });

  test('OFF-Webseiten-Altbestand nur in der Rohablage: API kennt die EAN → API-Daten; kennt sie nicht → nichts angelegt', async () => {
    const ean = '4005500084136';
    db.lege(`nutritionscrape/${ean}`, {
      gtin: ean,
      scrapedSource: 'scraper',
      sourceShop: 'openfoodfacts',
      scrapedAt: ts(JETZT - 90 * TAG),
      scrapedUrl: `https://de.openfoodfacts.org/produkt/${ean}/knusper`,
      attr_ingredientStatement: 'Webseite',
    });
    expect((await rufe(ean)).body).toEqual({ product: null });
    expect(ext(ean)).toBeUndefined();
    expect(miss(ean)).toMatchObject({ status: 'pending', grund: 'neu' });

    db.daten.delete(`external_lookup_misses/${ean}`);
    offAntwort(ean, 200, OFF_GOLDEN);
    jest.setSystemTime(JETZT + 10 * 60 * 1000);
    await rufe(ean);
    expect(ext(ean)).toMatchObject({ attr_ingredientStatement: 'Weizen, Zucker', source: 'openfood' });
  });

  test('Daten der OFF-Webseite: API kennt die EAN → API-Daten gewinnen, einmal geprüft', async () => {
    db.lege('external_products/20003180', {
      ean: '20003180',
      source: 'openfoodfacts',
      productName: 'Golden Puffs',
      attr_ingredientStatement: 'Webseite',
      cachedAt: ts(JETZT - TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
    });
    offAntwort('20003180', 200, OFF_GOLDEN);
    await rufe('20003180');
    expect(ext('20003180')).toMatchObject({ attr_ingredientStatement: 'Weizen, Zucker', source: 'openfood' });
    expect(ext('20003180').openfoodVersuchtAm.toMillis()).toBe(JETZT);
    jest.setSystemTime(JETZT + TAG);
    await rufe('20003180');
    expect(offAufrufe).toEqual(['20003180']);
  });
});

describe('Warteschlange: „kommt wieder hoch"', () => {
  test('abgeschlossener Fall, Datenstand älter als 60 Tage → wieder offen zum Auffrischen', async () => {
    db.lege('external_products/777', {
      ean: '777',
      source: 'rossmann',
      productName: 'Isana Duschgel',
      fetchedAt: ts(JETZT - 80 * TAG),
      fetchedAtQuelle: 'nutritionscrape',
      cachedAt: ts(JETZT - TAG),
    });
    db.lege('external_lookup_misses/777', {
      ean: '777',
      status: 'resolved',
      hitCount: 3,
      lastSeenAt: ts(JETZT - 80 * TAG),
      processedAt: ts(JETZT - 80 * TAG),
    });
    await rufe('777');
    expect(miss('777')).toMatchObject({ status: 'pending', grund: 'auffrischen', hitCount: 4, scanTage: 2 });
    expect(miss('777').wiedergeoeffnetAm.toMillis()).toBe(JETZT);
  });

  test('bezahlt gefundene rewe.de-Daten (nutritionscrape) sind keine Pipeline-Daten → werden aufgefrischt', async () => {
    db.lege('external_products/889', {
      ean: '889',
      source: 'rewe',
      productName: 'Ja! Haferdrink',
      fetchedAt: ts(JETZT - 100 * TAG),
      fetchedAtQuelle: 'nutritionscrape',
      cachedAt: ts(JETZT - TAG),
    });
    db.lege('external_lookup_misses/889', {
      ean: '889',
      status: 'resolved',
      lastSeenAt: ts(JETZT - 100 * TAG),
      processedAt: ts(JETZT - 100 * TAG),
    });
    await rufe('889');
    expect(miss('889')).toMatchObject({ status: 'pending', grund: 'auffrischen' });
  });

  test('REWE-Produkt wird nicht bezahlt aufgefrischt', async () => {
    db.lege('external_products/888', {
      ean: '888',
      source: 'rewe',
      productName: 'Kerrygold',
      fetchedAt: null,
      fetchedAtQuelle: 'rewe_pipeline',
      cachedAt: ts(JETZT - TAG),
    });
    db.lege('external_lookup_misses/888', {
      ean: '888',
      status: 'resolved',
      lastSeenAt: ts(JETZT - 200 * TAG),
      processedAt: ts(JETZT - 200 * TAG),
    });
    await rufe('888');
    expect(miss('888').status).toBe('resolved');
  });
});

describe('force', () => {
  const bestand = () =>
    db.lege('external_products/999', {
      ean: '999',
      source: 'rewe',
      productName: 'Kerrygold',
      cachedAt: ts(JETZT - TAG),
      aiAssessment: { healthScore: 4 },
    });

  test('Nicht-Admin: wird ignoriert, nichts gelöscht, keine Neuberechnung', async () => {
    bestand();
    const res = await rufe('999', { force: true });
    expect(res.body.product.productName).toBe('Kerrygold');
    expect(ext('999').aiAssessment).toEqual({ healthScore: 4 });
    expect(db.schreibvorgaenge.filter(([a]) => a === 'delete')).toEqual([]);
    expect(miss('999')).toBeUndefined();
  });

  test('Admin: löscht NIE, rechnet neu und plant eine Auffrischung ein', async () => {
    bestand();
    const res = await rufe('999', { token: 'admin', force: '1' });
    expect(res.body.product.productName).toBe('Kerrygold');
    expect(ext('999').aiAssessment).toEqual({ healthScore: 4 });
    expect(db.schreibvorgaenge.filter(([a]) => a === 'delete')).toEqual([]);
    expect(miss('999')).toMatchObject({ status: 'pending', grund: 'auffrischen' });
  });
});

describe('Trigger onNutritionScrapeFuerExterne', () => {
  const fund = (over = {}) => ({
    gtin: '4337256123456',
    productPath: null,
    sourceShop: 'rossmann',
    scrapedUrl: 'https://www.rossmann.de/p/4337256123456',
    productName: 'Isana Duschgel Kokos',
    shopBildUrl: 'https://media.rossmann.de/x.jpg',
    eanBeleg: 'jsonld_gtin',
    attr_preis: 0.95,
    priceCurrency: 'EUR',
    priceShop: 'rossmann',
    priceFetchedAt: ts(JETZT - 1000),
    fetchedAt: ts(JETZT - 1000),
    scrapedAt: ts(JETZT - 1000),
    attr_ingredientStatement: 'Aqua',
    ...over,
  });
  const ereignis = (vorher, nachher, ean = '4337256123456') => ({
    params: { ean },
    time: new Date(JETZT).toISOString(),
    data: {
      before: { exists: !!vorher, data: () => vorher },
      after: { exists: !!nachher, data: () => nachher },
    },
  });

  test('neuer Fund → sofort in external_products (ohne Shopbild, mit Preis-Herkunft)', async () => {
    await onNutritionScrapeFuerExterne(ereignis(null, fund()));
    const d = ext('4337256123456');
    expect(d).toMatchObject({
      ean: '4337256123456',
      productName: 'Isana Duschgel Kokos',
      source: 'rossmann',
      price: 0.95,
      priceShop: 'rossmann',
      fetchedAtQuelle: 'nutritionscrape',
    });
    expect(d.imageUrl).toBeUndefined();
    expect(d.storedAt.toMillis()).toBe(JETZT);
    expect(d.fetchedAt.toMillis()).toBe(JETZT - 1000);
    expect(d.cachedAt.toMillis()).toBe(JETZT);
  });

  test('Shopbild nur mit Freigabe in _meta/produktsuche', async () => {
    db.lege('_meta/produktsuche', { shopBilder: true });
    await onNutritionScrapeFuerExterne(ereignis(null, fund()));
    expect(ext('4337256123456').imageUrl).toBe('https://media.rossmann.de/x.jpg');
  });

  test.each([
    ['EANs (14-stellig)', 'produkte/p1', { EANs: ['04337256123456'] }],
    ['eans', 'markenProdukte/m1', { eans: ['4337256123456'] }],
    ['gtin als Zahl', 'produkte/p2', { gtin: 4337256123456 }],
    ['moreInformation.EAN', 'markenProdukte/m2', { moreInformation: { EAN: '4337256123456' } }],
  ])('steht im Katalog (%s) → nicht übernommen', async (_name, pfad, daten) => {
    db.lege(pfad, daten);
    await onNutritionScrapeFuerExterne(ereignis(null, fund()));
    expect(ext('4337256123456')).toBeUndefined();
  });

  test('mit productPath (Katalog-Backfill) → nicht übernommen', async () => {
    await onNutritionScrapeFuerExterne(ereignis(null, fund({ productPath: 'produkte/abc' })));
    expect(ext('4337256123456')).toBeUndefined();
  });

  test('nur zusammengeführt (fetchedAt unverändert) → nichts', async () => {
    await onNutritionScrapeFuerExterne(ereignis(fund({ scrapedAt: ts(1) }), fund()));
    expect(ext('4337256123456')).toBeUndefined();
  });

  test('Fund verbessert vorhandenes OFF-Dokument feldweise; Name/Bild bleiben', async () => {
    db.lege('external_products/4337256123456', {
      ean: '4337256123456',
      source: 'openfood',
      productName: 'Isana Duschgel',
      imageUrl: 'https://images.openfoodfacts.org/i.jpg',
      cachedAt: ts(JETZT - 5 * TAG),
      storedAt: ts(JETZT - 5 * TAG),
    });
    await onNutritionScrapeFuerExterne(ereignis(null, fund({ productName: undefined })));
    const d = ext('4337256123456');
    expect(d.productName).toBe('Isana Duschgel');
    expect(d.imageUrl).toBe('https://images.openfoodfacts.org/i.jpg');
    expect(d.attr_ingredientStatement).toBe('Aqua');
    expect(d.source).toBe('rossmann');
    expect(d.storedAt.toMillis()).toBe(JETZT - 5 * TAG);
  });

  test('Shopbild abgeschaltet → beim nächsten Schreiben entfernt (Schalter wirkt rückwirkend)', async () => {
    db.lege('_meta/produktsuche', { shopBilder: true });
    await onNutritionScrapeFuerExterne(ereignis(null, fund()));
    expect(ext('4337256123456')).toMatchObject({ imageUrl: 'https://media.rossmann.de/x.jpg', bildVonShop: true });
    db.lege('_meta/produktsuche', { shopBilder: false });
    _zuruecksetzen();
    jest.setSystemTime(JETZT + 10 * 60 * 1000);
    await onNutritionScrapeFuerExterne(ereignis(fund(), fund({ fetchedAt: ts(JETZT + 5000) })));
    const d = ext('4337256123456');
    expect(d.imageUrl).toBeUndefined();
    expect(d.bildVonShop).toBeUndefined();
    expect(d.feldQuellen.bild).toBeUndefined();
    expect(d.productName).toBe('Isana Duschgel Kokos');
  });

  describe('ungeprüfter Altbestand (vor dem 04.10.2026 ohne EAN-Beleg)', () => {
    const VIOLEY = 'https://www.violey.com/de/dennree-knusper-mix-dinkel_p_35278.html';
    const altbestand = {
      gtin: '4056489845881',
      scrapedSource: 'scraper',
      scrapedAt: ts(JETZT - 90 * TAG),
      scrapedUrl: VIOLEY,
      sourceUrl: VIOLEY,
      sourceShop: 'violey.com',
      attr_ingredientStatement: 'Dinkel, Honig',
      attr_hersteller: 'dennree',
      attr_preis: 3.49,
    };
    // So legte die Abfrage den Altfund bisher an (alter Schreibweg).
    const externAusAltfund = () => db.lege('external_products/4056489845881', {
      ean: '4056489845881',
      source: 'violey',
      attr_ingredientStatement: 'Dinkel, Honig',
      manufacturerName: 'dennree',
      price: 3.49,
      raw: altbestand,
      fetchedAt: ts(JETZT - 90 * TAG),
      fetchedAtQuelle: 'nutritionscrape',
      fetchedAtGeschaetzt: true,
      cachedAt: ts(JETZT - 30 * TAG),
      aiAssessment: { healthScore: 3 },
    });

    test('von der eigenen Quellseite widerlegt, nichts Neues → external_products-Dokument gelöscht', async () => {
      externAusAltfund();
      const nachher = { gtin: '4056489845881', widerlegtAm: ts(JETZT), widerlegtGrund: 'ean_not_in_html', widerlegtUrl: VIOLEY };
      await onNutritionScrapeFuerExterne(ereignis(altbestand, nachher, '4056489845881'));
      expect(ext('4056489845881')).toBeUndefined();
      expect(db.schreibvorgaenge).toContainEqual(['delete', 'external_products/4056489845881']);
    });

    test('widerlegt, aber OpenFoodFacts lieferte Teile → nur die Altfund-Gruppen fallen weg', async () => {
      externAusAltfund();
      db.lege('external_products/4056489845881', {
        ...ext('4056489845881'),
        productName: 'Knusper Mix',
        imageUrl: 'https://images.openfoodfacts.org/k.jpg',
        feldQuellen: { name: 'openfood', bild: 'openfood', zutaten: 'violey', marke: 'violey' },
      });
      const nachher = { gtin: '4056489845881', widerlegtAm: ts(JETZT), widerlegtGrund: 'gtin_widerspruch', widerlegtUrl: VIOLEY };
      await onNutritionScrapeFuerExterne(ereignis(altbestand, nachher, '4056489845881'));
      const d = ext('4056489845881');
      expect(d).toMatchObject({ productName: 'Knusper Mix', imageUrl: 'https://images.openfoodfacts.org/k.jpg', source: 'openfood' });
      for (const k of ['attr_ingredientStatement', 'manufacturerName', 'price', 'raw', 'fetchedAt', 'fetchedAtQuelle']) {
        expect(d).not.toHaveProperty(k);
      }
      expect(d.feldQuellen).toEqual({ name: 'openfood', bild: 'openfood' });
      expect(d.aiAssessment).toEqual({ healthScore: 3 });
    });

    test('vom belegten Fund ersetzt → alte Zutaten/Hersteller weg, nicht neben dem neuen Namen', async () => {
      externAusAltfund();
      const nachher = {
        gtin: '4056489845881',
        scrapedSource: 'scraper',
        sourceShop: 'morgenmarkt',
        scrapedUrl: 'https://morgenmarkt.de/x',
        productName: 'Knusper Müsli 750 g',
        eanBeleg: 'seitentext',
        fetchedAt: ts(JETZT - 1000),
        scrapedAt: ts(JETZT - 1000),
      };
      await onNutritionScrapeFuerExterne(ereignis(altbestand, nachher, '4056489845881'));
      const d = ext('4056489845881');
      expect(d).toMatchObject({ productName: 'Knusper Müsli 750 g', source: 'morgenmarkt', fetchedAtQuelle: 'nutritionscrape' });
      expect(d.fetchedAt.toMillis()).toBe(JETZT - 1000);
      for (const k of ['attr_ingredientStatement', 'manufacturerName', 'price', 'fetchedAtGeschaetzt']) expect(d).not.toHaveProperty(k);
    });
  });

  test('Lesefehler im Katalog → wirft (Eventarc wiederholt), legt nichts an', async () => {
    const original = db.collection.bind(db);
    db.collection = (name) => {
      if (name === 'produkte') throw new Error('unavailable');
      return original(name);
    };
    try {
      await expect(onNutritionScrapeFuerExterne(ereignis(null, fund()))).rejects.toThrow('unavailable');
      expect(ext('4337256123456')).toBeUndefined();
    } finally {
      db.collection = original;
    }
  });
});

// Schlussprüfung 04.10.2026 (Blocker): Ein Lesefehler von _meta/produktsuche
// fiel auf die Standardwerte zurück, also shopBilder:false — jeder
// Schreibvorgang derselben Anfrage entfernte dann gespeicherte Shopbilder,
// und ein nur über sein Bild anzeigbares Dokument wurde gelöscht. Jetzt ist
// der Schalter nach einem Lesefehler unbekannt: nichts übernehmen, nichts
// entfernen. Dasselbe für die Frist auffrischenNachTagen.
describe('Konfiguration nicht lesbar (Lesefehler ≠ Standardwert)', () => {
  const EAN = '4337256123456';
  const SHOPBILD = 'https://media.rossmann.de/x.jpg';

  /** Lässt db.doc('_meta/produktsuche').get() scheitern; gibt das Rückgängig zurück. */
  function konfigNichtLesbar() {
    const original = Object.getPrototypeOf(db).doc;
    db.doc = function (pfad) {
      const ref = original.call(this, pfad);
      if (pfad === '_meta/produktsuche') ref.get = async () => { throw new Error('UNAVAILABLE'); };
      return ref;
    };
    return () => { delete db.doc; };
  }

  const rohFund = (over = {}) => ({
    gtin: EAN,
    productPath: null,
    sourceShop: 'rossmann',
    scrapedUrl: `https://www.rossmann.de/p/${EAN}`,
    productName: 'Isana Duschgel Kokos',
    shopBildUrl: SHOPBILD,
    eanBeleg: 'jsonld_gtin',
    attr_preis: 0.95,
    priceCurrency: 'EUR',
    priceShop: 'rossmann',
    priceFetchedAt: ts(JETZT - 1000),
    fetchedAt: ts(JETZT - 1000),
    scrapedAt: ts(JETZT - 1000),
    attr_ingredientStatement: 'Aqua',
    ...over,
  });
  const ereignis = (vorher, nachher) => ({
    params: { ean: EAN },
    time: new Date(JETZT).toISOString(),
    data: {
      before: { exists: !!vorher, data: () => vorher },
      after: { exists: !!nachher, data: () => nachher },
    },
  });
  const loeschungen = () => db.schreibvorgaenge.filter(([art, pfad]) => art === 'delete' && pfad === `external_products/${EAN}`);

  test('Scan schreibt (Kopien älter als 4 Wochen neu gelesen): gespeichertes Shopbild bleibt', async () => {
    db.lege(`external_products/${EAN}`, {
      ean: EAN,
      source: 'rossmann',
      productName: 'Isana Duschgel Kokos',
      imageUrl: SHOPBILD,
      bildVonShop: true,
      feldQuellen: { name: 'rossmann', bild: 'rossmann' },
      fetchedAt: ts(JETZT - 40 * TAG),
      fetchedAtQuelle: 'nutritionscrape',
      cachedAt: ts(JETZT - 40 * TAG),
      storedAt: ts(JETZT - 40 * TAG),
    });
    db.lege(`nutritionscrape/${EAN}`, rohFund());
    const zurueck = konfigNichtLesbar();
    try {
      const res = await rufe(EAN);
      expect(res.body.product.imageUrl).toBe(SHOPBILD);
    } finally {
      zurueck();
    }
    const d = ext(EAN);
    expect(d.cachedAt.toMillis()).toBe(JETZT); // geschrieben wurde wirklich
    expect(d.attr_ingredientStatement).toBe('Aqua');
    expect(d).toMatchObject({ imageUrl: SHOPBILD, bildVonShop: true });
    expect(d.feldQuellen.bild).toBe('rossmann');
    expect(loeschungen()).toEqual([]);
  });

  test('Scan bei unbekanntem Schalter übernimmt auch kein NEUES Shopbild', async () => {
    db.lege(`nutritionscrape/${EAN}`, rohFund());
    const zurueck = konfigNichtLesbar();
    try {
      const res = await rufe(EAN);
      expect(res.body.product.productName).toBe('Isana Duschgel Kokos');
    } finally {
      zurueck();
    }
    expect(ext(EAN).imageUrl).toBeUndefined();
    expect(ext(EAN).bildVonShop).toBeUndefined();
  });

  test('Trigger: neuer Abruf bei Lesefehler → Shopbild bleibt', async () => {
    db.lege('_meta/produktsuche', { shopBilder: true });
    await onNutritionScrapeFuerExterne(ereignis(null, rohFund()));
    expect(ext(EAN)).toMatchObject({ imageUrl: SHOPBILD, bildVonShop: true });

    _zuruecksetzen();
    jest.setSystemTime(JETZT + 10 * 60 * 1000);
    const zurueck = konfigNichtLesbar();
    try {
      await onNutritionScrapeFuerExterne(ereignis(rohFund(), rohFund({ fetchedAt: ts(JETZT + 5000), attr_ingredientStatement: 'Aqua, Glycerin' })));
    } finally {
      zurueck();
    }
    const d = ext(EAN);
    expect(d.attr_ingredientStatement).toBe('Aqua, Glycerin'); // geschrieben
    expect(d).toMatchObject({ imageUrl: SHOPBILD, bildVonShop: true });
    expect(loeschungen()).toEqual([]);
  });

  test('Trigger: Dokument nur über sein Shopbild anzeigbar → bei Lesefehler NICHT gelöscht', async () => {
    db.lege(`external_products/${EAN}`, {
      ean: EAN,
      source: 'rossmann',
      imageUrl: SHOPBILD,
      bildVonShop: true,
      feldQuellen: { bild: 'rossmann' },
      fetchedAt: ts(JETZT - 5 * TAG),
      fetchedAtQuelle: 'nutritionscrape',
      cachedAt: ts(JETZT - 5 * TAG),
      storedAt: ts(JETZT - 5 * TAG),
      aiAssessment: { healthScore: 3 },
    });
    // Neuer Abruf liefert nur einen Preis (allein nicht anzeigbar).
    const nurPreis = rohFund({ productName: undefined, attr_ingredientStatement: undefined, eanBeleg: 'jsonld_gtin' });
    const zurueck = konfigNichtLesbar();
    try {
      await onNutritionScrapeFuerExterne(ereignis(rohFund({ fetchedAt: ts(JETZT - 5 * TAG) }), nurPreis));
    } finally {
      zurueck();
    }
    expect(loeschungen()).toEqual([]);
    expect(ext(EAN)).toMatchObject({ imageUrl: SHOPBILD, bildVonShop: true, price: 0.95, aiAssessment: { healthScore: 3 } });
  });

  test('Gegenprobe: lesbar und ausdrücklich false → Shopbild weg, nur-Bild-Dokument gelöscht', async () => {
    db.lege('_meta/produktsuche', { shopBilder: false });
    db.lege(`external_products/${EAN}`, {
      ean: EAN,
      source: 'rossmann',
      imageUrl: SHOPBILD,
      bildVonShop: true,
      feldQuellen: { bild: 'rossmann' },
      cachedAt: ts(JETZT - 5 * TAG),
    });
    const nurPreis = rohFund({ productName: undefined, attr_ingredientStatement: undefined });
    await onNutritionScrapeFuerExterne(ereignis(rohFund({ fetchedAt: ts(JETZT - 5 * TAG) }), nurPreis));
    expect(loeschungen()).toEqual([['delete', `external_products/${EAN}`]]);
  });

  test('Frist unbekannt: abgeschlossener Fall älter als 60 Tage wird NICHT wegen seines Alters neu geöffnet', async () => {
    db.lege('external_products/777', {
      ean: '777',
      source: 'rossmann',
      productName: 'Isana Duschgel',
      fetchedAt: ts(JETZT - 80 * TAG),
      fetchedAtQuelle: 'nutritionscrape',
      cachedAt: ts(JETZT - TAG),
    });
    db.lege('external_lookup_misses/777', {
      ean: '777', status: 'resolved', hitCount: 3,
      lastSeenAt: ts(JETZT - 80 * TAG), processedAt: ts(JETZT - 80 * TAG),
    });
    const zurueck = konfigNichtLesbar();
    try {
      await rufe('777');
    } finally {
      zurueck();
    }
    expect(miss('777')).toMatchObject({ status: 'resolved', hitCount: 4 });
    expect(miss('777').wiedergeoeffnetAm).toBeUndefined();
  });

  test('Frist unbekannt: OFF-Daten älter als 60 Tage werden nicht aufgefrischt; neuer Barcode kommt trotzdem in die Warteschlange', async () => {
    db.lege('external_products/20003180', {
      ean: '20003180',
      source: 'openfood',
      productName: 'Golden Puffs alt',
      fetchedAt: ts(JETZT - 70 * TAG),
      fetchedAtQuelle: 'openfood_api',
      cachedAt: ts(JETZT - 70 * TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
    });
    offAntwort('20003180', 200, OFF_GOLDEN);
    const zurueck = konfigNichtLesbar();
    try {
      await rufe('20003180');
      expect(offAufrufe).toEqual([]);
      expect(ext('20003180').productName).toBe('Golden Puffs alt');
      await rufe('4001234567890');
    } finally {
      zurueck();
    }
    expect(miss('4001234567890')).toMatchObject({ status: 'pending', grund: 'neu' });
  });
});

// Schlussprüfung 04.10.2026: OpenFoodFacts antwortet für Produkte aus
// OpenBeautyFacts & Co. mit HTTP 404 und „product found with a different
// product type". Das galt als „gibt es nicht": echte Daten (Balea Bodylotion,
// Dontodent …) wurden versteckt und der Fall für die bezahlte Suche geöffnet.
describe('OpenFoodFacts: „anderer Produkttyp" ist kein „nicht vorhanden"', () => {
  const EAN = '4066447870237';
  const OBF_URL = `https://world.openbeautyfacts.org/product/${EAN}/balea-bodylotion`;
  const obfRohablage = {
    gtin: EAN,
    scrapedSource: 'scraper',
    sourceShop: 'openfoodfacts', // so stehen OBF-Funde im Altbestand
    scrapedAt: ts(JETZT - 90 * TAG),
    scrapedUrl: OBF_URL,
    productName: 'Balea Bodylotion Soft',
    attr_ingredientStatement: 'Aqua, Glycerin, Paraffinum Liquidum',
  };
  const anderTyp = () => {
    offAntworten[EAN] = { status: 404, body: { status: 0, status_verbose: 'product found with a different product type: beauty' } };
  };
  const loeschungen = () => db.schreibvorgaenge.filter(([art, pfad]) => art === 'delete' && pfad === `external_products/${EAN}`);

  test('OBF-Rohablage + API-404 „different product type": Daten sichtbar, nichts gelöscht, Fall nicht wieder geöffnet', async () => {
    anderTyp();
    db.lege(`nutritionscrape/${EAN}`, obfRohablage);
    db.lege(`external_lookup_misses/${EAN}`, {
      ean: EAN, status: 'resolved', processedSource: 'openfoodfacts', processedResult: 'ok',
      processedAt: ts(JETZT - 5 * TAG), lastSeenAt: ts(JETZT - 5 * TAG), hitCount: 11,
    });

    for (let i = 0; i < 4; i += 1) {
      jest.setSystemTime(JETZT + i * 10 * 60 * 1000);
      const res = await rufe(EAN);
      expect(res.body.product.productName).toBe('Balea Bodylotion Soft');
      expect(res.body.product.attr_ingredientStatement).toMatch(/^Aqua/);
    }
    expect(loeschungen()).toEqual([]);
    expect(ext(EAN)).toMatchObject({ productName: 'Balea Bodylotion Soft' });
    // Die kostenlose Prüfung lief, entschied nichts und wird vermerkt (höchstens einmal je Frist).
    expect(offAufrufe).toEqual([EAN]);
    expect(ext(EAN).openfoodVersuchtAm).toBeDefined();
    const m = miss(EAN);
    expect(m.status).toBe('resolved');
    expect(m.processedSource).toBe('openfoodfacts');
    expect(m.altbestandVerworfenAm).toBeUndefined();
    expect(m.wiedergeoeffnetAm).toBeUndefined();
  });

  test('Daten einer OFF-Seite, Produkt inzwischen in OpenBeautyFacts: API-404 „different product type" entfernt nichts', async () => {
    anderTyp();
    db.lege(`external_products/${EAN}`, {
      ean: EAN,
      source: 'openfoodfacts',
      productName: 'Balea Bodylotion Soft',
      attr_ingredientStatement: 'Aqua, Glycerin, Paraffinum Liquidum',
      cachedAt: ts(JETZT - TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
      raw: { ...obfRohablage, scrapedUrl: `https://de.openfoodfacts.org/produkt/${EAN}/balea` },
    });
    const res = await rufe(EAN);
    expect(offAufrufe).toEqual([EAN]); // OFF-Webseite → einmal gegen die API geprüft
    expect(res.body.product.attr_ingredientStatement).toMatch(/^Aqua/);
    expect(ext(EAN).attr_ingredientStatement).toMatch(/^Aqua/);
    expect(ext(EAN).openfoodVersuchtAm.toMillis()).toBe(JETZT);
    expect(loeschungen()).toEqual([]);
    // Nicht als fremder Altbestand verworfen (das wäre grund 'neu' mit
    // altbestandVerworfenAm); eingeplant wie jedes Dokument mit Daten nur aus
    // der OpenFoodFacts-Gruppe.
    expect(miss(EAN)).toMatchObject({ status: 'pending', grund: 'nur_openfood' });
    expect(miss(EAN).altbestandVerworfenAm).toBeUndefined();
    // Versuch vermerkt → der nächste Scan fragt nicht wieder.
    jest.setSystemTime(JETZT + TAG);
    await rufe(EAN);
    expect(offAufrufe).toEqual([EAN]);
  });

  test('OBF-Daten im Dokument: kein sofortiger Webseiten-Abgleich; nach der Frist geprüft, „anderer Produkttyp" ändert nichts', async () => {
    anderTyp();
    db.lege(`external_products/${EAN}`, {
      ean: EAN,
      source: 'openfoodfacts',
      productName: 'Balea Bodylotion Soft',
      attr_ingredientStatement: 'Aqua, Glycerin, Paraffinum Liquidum',
      fetchedAt: ts(JETZT - 90 * TAG),
      fetchedAtQuelle: 'nutritionscrape',
      fetchedAtGeschaetzt: true,
      cachedAt: ts(JETZT - TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
      raw: obfRohablage,
    });
    await rufe(EAN);
    expect(offAufrufe).toEqual([EAN]); // Frist (Stand 90 Tage) — nicht der Webseiten-Abgleich
    expect(ext(EAN).attr_ingredientStatement).toMatch(/^Aqua/);
    expect(ext(EAN).openfoodVersuchtAm.toMillis()).toBe(JETZT);
    expect(loeschungen()).toEqual([]);
  });

  test('Gegenprobe: echte OFF-Webseite, API 404 ohne Hinweis → wie bisher entfernt', async () => {
    db.lege(`external_products/${EAN}`, {
      ean: EAN,
      source: 'openfoodfacts',
      attr_ingredientStatement: 'Weizenmehl',
      cachedAt: ts(JETZT - TAG),
      lastUpgradeAttemptAt: ts(JETZT - TAG),
      raw: { ...obfRohablage, scrapedUrl: `https://de.openfoodfacts.org/produkt/${EAN}/x` },
    });
    expect((await rufe(EAN)).body).toEqual({ product: null });
    expect(loeschungen()).toEqual([['delete', `external_products/${EAN}`]]);
  });
});

// Schlussprüfung 04.10.2026 (Härtung): ein nicht-textueller Hersteller aus
// der KI des Scrapers ließ die Detailseite aller Alt-Versionen abstürzen
// (`manufacturerName.trim()`). Der Trigger übernimmt jeden Fund sofort.
describe('Textfelder: nur Text erreicht external_products und die App', () => {
  const EAN = '4337256123456';
  const ereignis = (vorher, nachher) => ({
    params: { ean: EAN },
    time: new Date(JETZT).toISOString(),
    data: {
      before: { exists: !!vorher, data: () => vorher },
      after: { exists: !!nachher, data: () => nachher },
    },
  });
  const fund = (over = {}) => ({
    gtin: EAN,
    productPath: null,
    sourceShop: 'rossmann',
    scrapedUrl: `https://www.rossmann.de/p/${EAN}`,
    productName: 'Isana Duschgel Kokos',
    eanBeleg: 'jsonld_gtin',
    fetchedAt: ts(JETZT - 1000),
    scrapedAt: ts(JETZT - 1000),
    attr_ingredientStatement: 'Aqua',
    ...over,
  });

  test.each([
    ['Liste', ['Rossmann', 'Dirk Rossmann GmbH']],
    ['Zahl', 42],
    ['true', true],
  ])('Trigger: attr_hersteller als %s → kein manufacturerName, Rest gespeichert', async (_name, wert) => {
    await onNutritionScrapeFuerExterne(ereignis(null, fund({ attr_hersteller: wert })));
    const d = ext(EAN);
    expect(d).toMatchObject({ productName: 'Isana Duschgel Kokos', attr_ingredientStatement: 'Aqua' });
    expect(d).not.toHaveProperty('manufacturerName');
    const res = await rufe(EAN);
    expect(res.body.product).not.toHaveProperty('manufacturerName');
  });

  test('gespeicherter falscher Typ: Antwort ohne ihn, beim nächsten Schreiben entfernt', async () => {
    db.lege(`external_products/${EAN}`, {
      ean: EAN,
      source: 'rossmann',
      productName: 'Isana Duschgel Kokos',
      manufacturerName: ['Rossmann'],
      brandName: 7,
      packSize: 250,
      cachedAt: ts(JETZT - TAG),
      storedAt: ts(JETZT - TAG),
    });
    const res = await rufe(EAN);
    expect(res.body.product).not.toHaveProperty('manufacturerName');
    expect(res.body.product).not.toHaveProperty('brandName');
    expect(res.body.product.packSize).toBe(250);

    await onNutritionScrapeFuerExterne(ereignis(null, fund({ attr_hersteller: 'Dirk Rossmann GmbH ' })));
    expect(ext(EAN)).toMatchObject({ manufacturerName: 'Dirk Rossmann GmbH', packSize: 250 });
    expect(ext(EAN)).not.toHaveProperty('brandName');
  });
});

// Folge der Host-Regel: OBF-Daten im Dokument sind keine OFF-Webseiten-Daten.
// Ein schlichtes 404 (ohne Typ-Hinweis) darf sie nicht entfernen — sonst legte
// der nächste Scan sie aus nutritionscrape neu an (Schleife aus Prüfrunde 3,
// jede Neuanlage mit KI-Bewertung).
describe('OpenBeautyFacts-Daten: auch ein schlichtes 404 löscht nichts (keine Schleife)', () => {
  const EAN = '4069365468968';
  const obfRohablage = {
    gtin: EAN,
    scrapedSource: 'scraper',
    sourceShop: 'openfoodfacts',
    scrapedAt: ts(JETZT - 90 * TAG),
    scrapedUrl: `https://world.openbeautyfacts.org/product/${EAN}/dontodent`,
    productName: 'Dontodent Zahncreme',
    attr_ingredientStatement: 'Aqua, Sorbitol',
  };

  test('fünf Scans: Dokument einmal angelegt, nie gelöscht, OFF höchstens einmal je Frist gefragt', async () => {
    db.lege(`nutritionscrape/${EAN}`, obfRohablage);
    for (let i = 0; i < 5; i += 1) {
      jest.setSystemTime(JETZT + i * 10 * 60 * 1000);
      const res = await rufe(EAN);
      expect(res.body.product.productName).toBe('Dontodent Zahncreme');
    }
    const anExt = db.schreibvorgaenge.filter(([, pfad]) => pfad === `external_products/${EAN}`).map(([art]) => art);
    expect(anExt).not.toContain('delete');
    expect(anExt.filter((a) => a === 'set')).toHaveLength(1); // genau eine Neuanlage
    expect(offAufrufe.length).toBeLessThanOrEqual(1);
    expect(miss(EAN).altbestandVerworfenAm).toBeUndefined();
  });
});
