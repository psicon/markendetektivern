/**
 * Tests für src/anfrage.js — Parameter von scrapeEan, Kandidatenfilter,
 * Ergebnisentscheidung ohne Treffer.
 *
 * @jest-environment node
 */

'use strict';

const {
  leseScrapeParameter,
  kandidatErlaubt,
  normalisiereDomain,
  entscheideErgebnis,
} = require('../src/anfrage');

describe('leseScrapeParameter', () => {
  test('ohne EAN → Fehler', () => {
    expect(leseScrapeParameter({}).fehler).toBe('Missing ean param');
    expect(leseScrapeParameter(null).fehler).toBe('Missing ean param');
  });

  test('alte Aufrufer (nur ean/productName/productPath) bleiben gleich', () => {
    const p = leseScrapeParameter({ ean: '4311501099278', productName: 'X', productPath: '' });
    expect(p).toMatchObject({
      ean: '4311501099278',
      productName: 'X',
      productPath: null, // fireScraperForEan schickt ''
      ohneOpenFoodFacts: false,
      nurDomains: null,
      bevorzugteUrl: null,
      auffrischen: false,
    });
  });

  test('JSON-Body vom Prozessor', () => {
    const p = leseScrapeParameter({
      ean: 20003180,
      ohneOpenFoodFacts: true,
      auffrischen: true,
      nurDomains: ['https://www.lidl.de/', 'penny.de', 'kaputt'],
      bevorzugteUrl: 'https://produkte.globus.de/p/1',
    });
    expect(p.ean).toBe('20003180');
    expect(p.ohneOpenFoodFacts).toBe(true);
    expect(p.auffrischen).toBe(true);
    expect(p.nurDomains).toEqual(['lidl.de', 'penny.de']);
    expect(p.bevorzugteUrl).toBe('https://produkte.globus.de/p/1');
  });

  test('Query-String-Schreibweise', () => {
    const p = leseScrapeParameter({ ean: '1', ohneOpenFoodFacts: '1', auffrischen: 'false', nurDomains: 'lidl.de,penny.de' });
    expect(p.ohneOpenFoodFacts).toBe(true);
    expect(p.auffrischen).toBe(false);
    expect(p.nurDomains).toEqual(['lidl.de', 'penny.de']);
  });

  test('nurDomains ohne gültige Domain → Fehler statt „alle Domains“', () => {
    expect(leseScrapeParameter({ ean: '1', nurDomains: ['', 'x'] }).fehler).toMatch(/nurDomains/);
  });

  test('kaputte bevorzugteUrl → Hinweis, volle Suche', () => {
    const p = leseScrapeParameter({ ean: '1', bevorzugteUrl: 'javascript:alert(1)' });
    expect(p.fehler).toBeUndefined();
    expect(p.bevorzugteUrl).toBeNull();
    expect(p.hinweise).toHaveLength(1);
  });
});

describe('kandidatErlaubt', () => {
  test('ohneOpenFoodFacts trifft alle openfoodfacts-Subdomains, nicht openbeautyfacts', () => {
    const f = { ohneOpenFoodFacts: true };
    expect(kandidatErlaubt('https://de.openfoodfacts.org/produkt/1', f)).toBe(false);
    expect(kandidatErlaubt('https://world.openfoodfacts.org/product/1', f)).toBe(false);
    expect(kandidatErlaubt('https://de.openbeautyfacts.org/produkt/1', f)).toBe(true);
    expect(kandidatErlaubt('https://de.openfoodfacts.org/produkt/1', {})).toBe(true);
  });

  test('nurDomains: Domain und Subdomains, sonst nichts', () => {
    const f = { nurDomains: ['lidl.de', 'aldi-sued.de'] };
    expect(kandidatErlaubt('https://www.lidl.de/p/1', f)).toBe(true);
    expect(kandidatErlaubt('https://shop.aldi-sued.de/p', f)).toBe(true);
    expect(kandidatErlaubt('https://www.notlidl.de/p', f)).toBe(false);
    expect(kandidatErlaubt('https://www.codecheck.info/product.search?q=1', f)).toBe(false);
  });

  test('ungültige Adresse', () => {
    expect(kandidatErlaubt('keine url', {})).toBe(false);
  });

  test('normalisiereDomain', () => {
    expect(normalisiereDomain(' HTTPS://WWW.Lidl.de/foo ')).toBe('lidl.de');
    expect(normalisiereDomain('localhost')).toBeNull();
  });
});

describe('entscheideErgebnis', () => {
  test('KI-Ausfall → 503 mit Code', () => {
    expect(entscheideErgebnis({ kandidaten: 3, infraFehler: 1, letzterFehlerCode: 'extract_unavailable' }))
      .toEqual({ http: 503, result: 'extract_unavailable' });
  });
  test('Frist abgelaufen → 503 zeitlimit', () => {
    expect(entscheideErgebnis({ kandidaten: 3, zeitlimit: true })).toEqual({ http: 503, result: 'zeitlimit' });
  });
  test('keine Kandidaten → no_urls', () => {
    expect(entscheideErgebnis({ kandidaten: 0 })).toEqual({ http: 200, result: 'no_urls' });
  });
  test('nur Abruffehler → 503 fetch_unavailable, nie all_failed', () => {
    const e = entscheideErgebnis({ kandidaten: 4, abrufFehler: 4, beantwortet: 0 });
    expect(e.http).toBe(503);
    expect(e.result).toBe('fetch_unavailable');
  });
  test('mindestens eine Seite beantwortet → all_failed', () => {
    expect(entscheideErgebnis({ kandidaten: 4, abrufFehler: 3, beantwortet: 1 })).toEqual({ http: 200, result: 'all_failed' });
  });
  // Prüfrunde 2: nur die belegten Kandidaten (Serper, bevorzugte Seite) zählen,
  // wenn es welche gab — die Codecheck-Rückfallseite antwortet für jede EAN.
  test('alle belegten Kandidaten gesperrt, nur die Rückfallseite antwortete → 503', () => {
    const e = entscheideErgebnis({ kandidaten: 3, abrufFehler: 2, beantwortet: 1, belegteKandidaten: 2, belegteAbrufFehler: 2, belegteBeantwortet: 0 });
    expect(e).toMatchObject({ http: 503, result: 'fetch_unavailable' });
  });
  test('ein belegter Kandidat antwortete → all_failed', () => {
    expect(entscheideErgebnis({ kandidaten: 3, abrufFehler: 1, beantwortet: 2, belegteKandidaten: 2, belegteAbrufFehler: 1, belegteBeantwortet: 1 }))
      .toEqual({ http: 200, result: 'all_failed' });
  });
  test('ohne belegte Kandidaten gilt die Regel über alle', () => {
    expect(entscheideErgebnis({ kandidaten: 1, beantwortet: 1, belegteKandidaten: 0 })).toEqual({ http: 200, result: 'all_failed' });
    expect(entscheideErgebnis({ kandidaten: 1, abrufFehler: 1, belegteKandidaten: 0 })).toMatchObject({ http: 503 });
  });
});
