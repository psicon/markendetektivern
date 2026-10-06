/**
 * Tests für src/zusammenfuehren.js — feldweises Zusammenführen in
 * nutritionscrape (ersetzt das frühere `set(…, { merge: false })`).
 *
 * @jest-environment node
 */

'use strict';

const { fuehreZusammen, widerlegeAltbestand, istUnbelegterAltbestand, ergaenzeBefund, istLeer } = require('../src/zusammenfuehren');

const JETZT = 'JETZT';

function neuDoc(extra = {}) {
  return {
    gtin: '4311501099278',
    productPath: null,
    scrapedSource: 'scraper',
    scrapedUrl: 'https://produkte.globus.de/p/1',
    sourceShop: 'globus',
    sourceUrl: 'https://produkte.globus.de/p/1',
    confidence: 0.9,
    model: 'gemini-3.5-flash',
    tokensIn: 2000,
    tokensOut: 400,
    schemaVersion: 4,
    ...extra,
  };
}

/** Belegtes Dokument (v4, mit fetchedAt) — hier gilt das feldweise
 *  Zusammenführen. */
function altDoc(extra = {}) {
  return {
    gtin: '4311501099278',
    productPath: 'produkte/abc',
    scrapedSource: 'scraper',
    scrapedAt: 'FRUEHER',
    fetchedAt: 'FRUEHER',
    scrapedUrl: 'https://de.openfoodfacts.org/produkt/4311501099278',
    sourceShop: 'openfoodfacts',
    sourceUrl: 'https://de.openfoodfacts.org/produkt/4311501099278',
    confidence: 0.8,
    model: 'claude-haiku-4-5',
    schemaVersion: 4,
    attr_ingredientStatement: 'Zucker, Haselnüsse 13 %',
    nutr_Energie_val: 540,
    nutr_Energie_unit: 'kcal',
    nutr_Fett_val: 31,
    nutr_Fett_unit: 'g',
    ...extra,
  };
}

/** Altbestand vor v4: kein fetchedAt, kein priceShop/-Currency/-FetchedAt —
 *  so liegen alle Dokumente vor dem 04.10.2026 in nutritionscrape. */
function altbestand(extra = {}) {
  const d = altDoc({ schemaVersion: 3, ...extra });
  delete d.fetchedAt;
  return d;
}

describe('neues Dokument', () => {
  test('alles setzen, fetchedAt/scrapedAt jetzt, kein productPath:null', () => {
    const p = fuehreZusammen(null, neuDoc({ attr_hersteller: 'Globus', productName: 'Nuss Nougat', eanBeleg: 'jsonld_gtin' }), { jetzt: JETZT });
    expect(p.modus).toBe('neu');
    expect(p.erfolgFuerTelemetrie).toBe(true);
    expect(p.setzen).toMatchObject({
      gtin: '4311501099278',
      attr_hersteller: 'Globus',
      productName: 'Nuss Nougat',
      eanBeleg: 'jsonld_gtin',
      fetchedAt: JETZT,
      scrapedAt: JETZT,
    });
    expect('productPath' in p.setzen).toBe(false);
    expect(p.loeschen).toEqual([]);
  });

  test('Fehlversuch-Marker aus scrapeBatch zählt nicht als Daten; _failed wird gelöscht', () => {
    const marker = { gtin: '4311501099278', _failed: true, _failCount: 2 };
    const p = fuehreZusammen(marker, neuDoc({ attr_ingredientStatement: 'Wasser' }), { jetzt: JETZT });
    expect(p.modus).toBe('neu');
    expect(p.setzen.attr_ingredientStatement).toBe('Wasser');
    expect(p.loeschen).toContain('_failed');
  });
});

describe('vorhandenes Dokument — stabile Felder', () => {
  test('höhere Sicherheit: neue Werte gewinnen, fehlende neue Werte löschen NICHTS', () => {
    const neu = neuDoc({ confidence: 0.95, nutr_Energie_val: 545, nutr_Energie_unit: 'kcal' });
    const p = fuehreZusammen(altDoc(), neu, { jetzt: JETZT });
    expect(p.modus).toBe('ueberschreiben');
    expect(p.setzen.nutr_Energie_val).toBe(545);
    expect(p.setzen).not.toHaveProperty('attr_ingredientStatement');
    expect(p.setzen).not.toHaveProperty('nutr_Fett_val');
    expect(p.loeschen).toEqual([]);
    // productPath bleibt (früher wurde er bei Überschreiben null)
    expect(p.setzen).not.toHaveProperty('productPath');
  });

  test('leerer neuer Wert ersetzt nie einen vorhandenen', () => {
    const neu = neuDoc({ confidence: 0.99, attr_ingredientStatement: '  ', attr_allergene: [] });
    const p = fuehreZusammen(altDoc({ attr_allergene: ['MILCH'] }), neu, { jetzt: JETZT });
    expect(p.setzen).not.toHaveProperty('attr_ingredientStatement');
    expect(p.setzen).not.toHaveProperty('attr_allergene');
  });

  test('false ist ein Wert, kein leeres Feld', () => {
    const p = fuehreZusammen(altDoc({ attr_isVegan: true }), neuDoc({ confidence: 0.95, attr_isVegan: false }), { jetzt: JETZT });
    expect(p.setzen.attr_isVegan).toBe(false);
  });

  test('niedrigere Sicherheit: nur Lücken füllen', () => {
    const neu = neuDoc({ confidence: 0.6, attr_ingredientStatement: 'Anders', attr_hersteller: 'Neu GmbH' });
    const p = fuehreZusammen(altDoc(), neu, { jetzt: JETZT });
    expect(p.modus).toBe('ergaenzen');
    expect(p.erfolgFuerTelemetrie).toBe(false);
    expect(p.setzen).not.toHaveProperty('attr_ingredientStatement');
    expect(p.setzen.attr_hersteller).toBe('Neu GmbH');
    // Herkunft bleibt die der sichereren Lesung
    expect(p.setzen).not.toHaveProperty('sourceShop');
    expect(p.setzen).not.toHaveProperty('confidence');
  });

  test('gleiche Sicherheit, Shop statt OpenFoodFacts: Überschreiben inkl. Herkunft', () => {
    const p = fuehreZusammen(altDoc(), neuDoc({ confidence: 0.8 }), { jetzt: JETZT });
    expect(p.modus).toBe('ueberschreiben');
    expect(p.erfolgFuerTelemetrie).toBe(true);
    expect(p.setzen.sourceShop).toBe('globus');
  });

  test('nichts Neues → nur fetchedAt, scrapedAt bleibt', () => {
    const alt = altDoc({ confidence: 0.9, sourceShop: 'globus', scrapedUrl: 'https://produkte.globus.de/p/1', sourceUrl: 'https://produkte.globus.de/p/1', model: 'gemini-3.5-flash', tokensIn: 2000, tokensOut: 400, schemaVersion: 4 });
    const p = fuehreZusammen(alt, neuDoc({ attr_ingredientStatement: 'Zucker, Haselnüsse 13 %' }), { jetzt: JETZT });
    expect(p.modus).toBe('nur_abrufdatum');
    expect(p.setzen).toEqual({ fetchedAt: JETZT });
  });

  test('productPath wird ergänzt, wenn er fehlte, aber nie überschrieben', () => {
    const ohne = fuehreZusammen(altDoc({ productPath: null }), neuDoc({ productPath: 'markenProdukte/x' }), { jetzt: JETZT });
    expect(ohne.setzen.productPath).toBe('markenProdukte/x');
    const mit = fuehreZusammen(altDoc(), neuDoc({ confidence: 0.99, productPath: 'markenProdukte/x' }), { jetzt: JETZT });
    expect(mit.setzen).not.toHaveProperty('productPath');
  });
});

describe('Name mit Beleg', () => {
  test('seitentext ersetzt nie jsonld_gtin', () => {
    const alt = altDoc({ productName: 'Elvital Shampoo', eanBeleg: 'jsonld_gtin' });
    const p = fuehreZusammen(alt, neuDoc({ confidence: 0.99, productName: 'Anderer Name', eanBeleg: 'seitentext' }), { jetzt: JETZT });
    expect(p.setzen).not.toHaveProperty('productName');
  });
  test('stärkerer Beleg ersetzt schwächeren, auch bei niedrigerer Sicherheit', () => {
    const alt = altDoc({ productName: 'Shampoo 300ml', eanBeleg: 'seitentext' });
    const p = fuehreZusammen(alt, neuDoc({ confidence: 0.5, productName: 'Elvital Shampoo 300 ml', eanBeleg: 'jsonld_gtin' }), { jetzt: JETZT });
    expect(p.setzen.productName).toBe('Elvital Shampoo 300 ml');
    expect(p.setzen.eanBeleg).toBe('jsonld_gtin');
  });
  test('Name wird ergänzt, wenn keiner da war', () => {
    const p = fuehreZusammen(altDoc(), neuDoc({ confidence: 0.5, productName: 'Nuss Nougat', eanBeleg: 'seitentext' }), { jetzt: JETZT });
    expect(p.setzen.productName).toBe('Nuss Nougat');
  });
});

describe('Preisblock', () => {
  const altMitPreis = () => altDoc({
    confidence: 0.95,
    attr_preis: 2.29,
    attr_preisPackgroesse: '400 g',
    attr_preisPerKg: 5.73,
    priceShop: 'globus',
    priceCurrency: 'EUR',
  });

  test('Fund ohne Preis lässt den alten Preis stehen', () => {
    const p = fuehreZusammen(altMitPreis(), neuDoc({ confidence: 0.99 }), { jetzt: JETZT });
    expect(p.setzen).not.toHaveProperty('attr_preis');
    expect(p.setzen).not.toHaveProperty('priceFetchedAt');
    expect(p.loeschen).toEqual([]);
  });

  test('ohne auffrischen: neuer Preis mit niedrigerer Sicherheit bleibt draußen', () => {
    const p = fuehreZusammen(altMitPreis(), neuDoc({ confidence: 0.7, attr_preis: 2.49, priceShop: 'atundo', priceCurrency: 'EUR' }), { jetzt: JETZT });
    expect(p.setzen).not.toHaveProperty('attr_preis');
  });

  test('auffrischen: neuer Preis gilt immer, alte Begleitangaben werden entfernt', () => {
    const p = fuehreZusammen(
      altMitPreis(),
      neuDoc({ confidence: 0.7, attr_preis: 2.49, priceShop: 'atundo', priceCurrency: 'EUR' }),
      { auffrischen: true, jetzt: JETZT },
    );
    expect(p.setzen).toMatchObject({ attr_preis: 2.49, priceShop: 'atundo', priceFetchedAt: JETZT, scrapedAt: JETZT });
    expect(p.loeschen).toEqual(expect.arrayContaining(['attr_preisPackgroesse', 'attr_preisPerKg']));
    // stabile Felder folgen weiter der Sicherheitsregel
    expect(p.modus).toBe('ergaenzen');
  });

  test('bestätigter gleicher Preis: priceFetchedAt neu, scrapedAt bleibt', () => {
    const alt = altMitPreis();
    const neu = neuDoc({
      confidence: 0.95, attr_preis: 2.29, attr_preisPackgroesse: '400 g', attr_preisPerKg: 5.73,
      priceShop: 'globus', priceCurrency: 'EUR',
      sourceShop: alt.sourceShop, scrapedUrl: alt.scrapedUrl, sourceUrl: alt.sourceUrl, model: alt.model,
      tokensIn: undefined, tokensOut: undefined, schemaVersion: 3,
    });
    const p = fuehreZusammen(alt, neu, { auffrischen: true, jetzt: JETZT });
    expect(p.setzen.priceFetchedAt).toBe(JETZT);
    expect(p.setzen).not.toHaveProperty('scrapedAt');
  });

  test('erster Preis wird übernommen, auch bei niedrigerer Sicherheit', () => {
    const p = fuehreZusammen(altDoc({ confidence: 0.95 }), neuDoc({ confidence: 0.6, attr_preis: 1.99, priceShop: 'globus', priceCurrency: 'EUR' }), { jetzt: JETZT });
    expect(p.setzen.attr_preis).toBe(1.99);
    expect(p.setzen.priceFetchedAt).toBe(JETZT);
  });
});

describe('unbelegter Altbestand (vor v4) wird ersetzt, nicht ergänzt', () => {
  test('erkannt nur mit Daten und ohne fetchedAt', () => {
    expect(istUnbelegterAltbestand(altbestand())).toBe(true);
    expect(istUnbelegterAltbestand(altDoc())).toBe(false);
    expect(istUnbelegterAltbestand({ gtin: '1', _failed: true })).toBe(false);
    expect(istUnbelegterAltbestand(null)).toBe(false);
  });

  test('belegter Fund ersetzt alles; was er nicht liefert, wird gelöscht — productPath bleibt', () => {
    const alt = altbestand({ attr_hersteller: 'Falsch GmbH', _failed: true, _failCount: 1 });
    const neu = neuDoc({ confidence: 0.6, attr_ingredientStatement: 'Wasser, Hafer', productName: 'Haferdrink', eanBeleg: 'jsonld_gtin' });
    const p = fuehreZusammen(alt, neu, { jetzt: JETZT });
    expect(p.modus).toBe('ersetzen');
    expect(p.erfolgFuerTelemetrie).toBe(true);
    expect(p.setzen).toMatchObject({ attr_ingredientStatement: 'Wasser, Hafer', productName: 'Haferdrink', sourceShop: 'globus', fetchedAt: JETZT, scrapedAt: JETZT });
    expect(p.loeschen).toEqual(expect.arrayContaining(['nutr_Energie_val', 'nutr_Energie_unit', 'nutr_Fett_val', 'attr_hersteller', '_failed']));
    expect(p.loeschen).not.toContain('productPath');
    expect(p.loeschen).not.toContain('gtin');
    expect(p.setzen).not.toHaveProperty('productPath');
  });

  test('Altpreis aus dem Ausland (zdroweslodycze.pl) verschwindet, wenn der neue Fund keinen Preis hat', () => {
    // Prüfrunde 04.10.2026: feldweise hätte der .pl-Preis Shop und Datum des
    // neuen rossmann.de-Abrufs bekommen und als frischer Euro-Preis gegolten.
    const alt = altbestand({
      attr_preis: 24.69,
      attr_preisPackgroesse: '1 kg',
      scrapedUrl: 'https://zdroweslodycze.pl/p/4250107657959',
      sourceUrl: 'https://zdroweslodycze.pl/p/4250107657959',
      sourceShop: 'zdroweslodycze.pl',
    });
    const p = fuehreZusammen(alt, neuDoc({ confidence: 0.95, sourceShop: 'rossmann', attr_ingredientStatement: 'Kakao' }), { jetzt: JETZT });
    expect(p.loeschen).toEqual(expect.arrayContaining(['attr_preis', 'attr_preisPackgroesse']));
    expect(p.setzen).not.toHaveProperty('attr_preis');
    expect(p.setzen).not.toHaveProperty('priceShop');
  });

  test('ersetzt auch bei gleicher/niedrigerer Sicherheit (kein „nur Lücken füllen“ mehr)', () => {
    const p = fuehreZusammen(altbestand({ confidence: 0.99 }), neuDoc({ confidence: 0.6, attr_hersteller: 'X' }), { jetzt: JETZT });
    expect(p.modus).toBe('ersetzen');
    expect(p.loeschen).toContain('attr_ingredientStatement');
  });
});

describe('widerlegeAltbestand', () => {
  const VIOLEY = 'https://www.violey.com/de/dennree-knusper-mix-dinkel_p_35278.html';
  const falsch = () => altbestand({ productPath: null, scrapedUrl: VIOLEY, sourceUrl: VIOLEY, sourceShop: 'violey' });

  test('Quellseite verworfen → Daten weg, Vermerk gesetzt, gtin/productPath bleiben', () => {
    const r = widerlegeAltbestand({ ...falsch(), _failed: true }, { url: VIOLEY, grund: 'ean_not_in_html', jetzt: JETZT });
    expect(r.setzen).toEqual({ widerlegtAm: JETZT, widerlegtGrund: 'ean_not_in_html', widerlegtUrl: VIOLEY });
    expect(r.loeschen).toEqual(expect.arrayContaining(['attr_ingredientStatement', 'nutr_Energie_val', 'scrapedSource', 'scrapedAt', 'sourceShop', 'sourceUrl', 'scrapedUrl']));
    expect(r.loeschen).not.toEqual(expect.arrayContaining(['gtin']));
    expect(r.loeschen).not.toContain('productPath');
    expect(r.loeschen).not.toContain('_failed');
  });

  test('andere Adresse → nichts (die verworfene Seite ist nicht die Quelle der Daten)', () => {
    expect(widerlegeAltbestand(falsch(), { url: 'https://andere.de/p', grund: 'ean_not_in_html', jetzt: JETZT })).toBeNull();
  });

  test('belegtes Dokument (v4) wird nie widerlegt — die Seite kann sich seitdem geändert haben', () => {
    const v4 = altDoc({ scrapedUrl: VIOLEY, sourceUrl: VIOLEY });
    expect(widerlegeAltbestand(v4, { url: VIOLEY, grund: 'ean_not_in_html', jetzt: JETZT })).toBeNull();
  });

  test('nach der Widerlegung zählt das Dokument nicht mehr als Daten; ein späterer Fund legt neu an', () => {
    const nachher = { gtin: '4311501099278', widerlegtAm: 'X', widerlegtGrund: 'gtin_widerspruch', widerlegtUrl: VIOLEY };
    expect(istUnbelegterAltbestand(nachher)).toBe(false);
    const p = fuehreZusammen(nachher, neuDoc({ attr_ingredientStatement: 'Dinkel' }), { jetzt: JETZT });
    expect(p.modus).toBe('neu');
    expect(p.loeschen).toEqual([]);
  });
});

describe('ergaenzeBefund (scrapeBatch sammelt über Seiten)', () => {
  test('erster Fund bestimmt, spätere füllen Lücken', () => {
    const a = { attr_ingredientStatement: 'A', _confidence: 0.9 };
    const b = { attr_ingredientStatement: 'B', nutr_Fett_val: 3, _confidence: 0.99 };
    expect(ergaenzeBefund(ergaenzeBefund(null, a), b)).toEqual({ attr_ingredientStatement: 'A', nutr_Fett_val: 3, _confidence: 0.9 });
  });
  test('Preis wandert als Block', () => {
    const a = { attr_preis: 1.99, priceShop: 'globus', priceCurrency: 'EUR' };
    const b = { attr_preis: 2.49, attr_preisPackgroesse: '500 g', priceShop: 'atundo', priceCurrency: 'EUR' };
    const m = ergaenzeBefund(ergaenzeBefund(null, a), b);
    expect(m).toEqual({ attr_preis: 1.99, priceShop: 'globus', priceCurrency: 'EUR' });
    const ohnePreis = ergaenzeBefund({ attr_ingredientStatement: 'A' }, b);
    expect(ohnePreis).toMatchObject({ attr_preis: 2.49, attr_preisPackgroesse: '500 g', priceShop: 'atundo' });
  });
  test('Name kommt mit seinem Beleg', () => {
    const m = ergaenzeBefund({ attr_ingredientStatement: 'A' }, { productName: 'X', eanBeleg: 'seitentext' });
    expect(m).toMatchObject({ productName: 'X', eanBeleg: 'seitentext' });
  });
});

test('istLeer', () => {
  expect([null, undefined, '', '  ', [], NaN].every(istLeer)).toBe(true);
  expect([0, false, 'x', ['a']].some(istLeer)).toBe(false);
});
