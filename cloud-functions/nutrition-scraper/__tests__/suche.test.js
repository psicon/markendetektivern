/**
 * Tests für src/suche.js — Ablauf von scrapeEan ohne Netz (Abhängigkeiten
 * als Attrappen): bevorzugte Seite, Suche, Fehlerzählung, Entscheidung.
 *
 * @jest-environment node
 */

'use strict';

const { sucheEan } = require('../src/suche');
const { ExtractUnavailableError, SearchUnavailableError, FetchUnavailableError } = require('../src/fehler');

const k = (url, shop = new URL(url).host) => ({ url, shop, requiresJS: false });

/** Attrappen: `seiten` ordnet jeder URL ein Ergebnis von leseKandidat zu
 *  (Objekt oder Error zum Werfen). */
function deps({ seiten = {}, suche = [], sucheFehler = null, bevorzugt = (url) => k(url) } = {}) {
  const aufrufe = { gelesen: [], suche: [] };
  return {
    aufrufe,
    deps: {
      leseKandidat: async ({ kandidat }) => {
        aufrufe.gelesen.push(kandidat.url);
        const r = seiten[kandidat.url] ?? { status: 'keineSeite' };
        if (r instanceof Error) throw r;
        return r;
      },
      resolveCandidates: async (eans, opts) => {
        aufrufe.suche.push({ eans, opts });
        if (sucheFehler) throw sucheFehler;
        return suche;
      },
      kandidatFuerUrl: async (url, { filter }) => (filter?.ohneOpenFoodFacts && /openfoodfacts/.test(url) ? null : bevorzugt(url)),
    },
  };
}

const TREFFER = { status: 'treffer', befund: { attr_ingredientStatement: 'Wasser' }, finalUrl: 'https://a.de/p' };

beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

test('bevorzugte Seite trifft → keine Serper-Suche', async () => {
  const d = deps({ seiten: { 'https://a.de/p': TREFFER } });
  const s = await sucheEan({ ean: '1', bevorzugteUrl: 'https://a.de/p', deps: d.deps });
  expect(s.treffer.kandidat.url).toBe('https://a.de/p');
  expect(s.ueberBevorzugteUrl).toBe(true);
  expect(d.aufrufe.suche).toHaveLength(0);
});

test('bevorzugte Seite ohne Daten → volle Suche, ohne dieselbe Seite doppelt', async () => {
  const d = deps({
    seiten: { 'https://a.de/p': { status: 'keineDaten', grund: 'ki_null' }, 'https://b.de/p': TREFFER },
    suche: [k('https://a.de/p'), k('https://b.de/p')],
  });
  const s = await sucheEan({ ean: '1', bevorzugteUrl: 'https://a.de/p', filter: { ohneOpenFoodFacts: true }, deps: d.deps });
  expect(d.aufrufe.gelesen).toEqual(['https://a.de/p', 'https://b.de/p']);
  expect(s.ueberBevorzugteUrl).toBe(false);
  expect(s.kandidaten).toBe(2);
  expect(d.aufrufe.suche[0].opts).toMatchObject({ ohneOpenFoodFacts: true, nurDomains: null });
});

test('bevorzugte OpenFoodFacts-Seite wird bei ohneOpenFoodFacts übersprungen', async () => {
  const d = deps({ suche: [] });
  const s = await sucheEan({
    ean: '1', bevorzugteUrl: 'https://de.openfoodfacts.org/produkt/1', filter: { ohneOpenFoodFacts: true }, deps: d.deps,
  });
  expect(d.aufrufe.gelesen).toEqual([]);
  expect(s.ergebnis).toEqual({ http: 200, result: 'no_urls' });
});

test('nurDomains wird an die Suche weitergegeben', async () => {
  const d = deps({ suche: [] });
  await sucheEan({ ean: '20003180', filter: { nurDomains: ['lidl.de'] }, deps: d.deps });
  expect(d.aufrufe.suche[0].opts.nurDomains).toEqual(['lidl.de']);
});

test('alle Kandidaten nur Abruffehler → 503 fetch_unavailable (nie no-data)', async () => {
  const abruf = { status: 'abrufFehler', httpStatus: 403, grund: 'http' };
  const d = deps({ seiten: { 'https://a.de/p': abruf, 'https://b.de/p': abruf }, suche: [k('https://a.de/p'), k('https://b.de/p')] });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(s.treffer).toBeNull();
  expect(s.abrufFehler).toBe(2);
  expect(s.ergebnis.http).toBe(503);
  expect(s.ergebnis.result).toBe(new FetchUnavailableError('x').code);
});

test('Abruffehler + eine beantwortete Seite → all_failed', async () => {
  const d = deps({
    seiten: { 'https://a.de/p': { status: 'abrufFehler', httpStatus: 429 }, 'https://b.de/p': { status: 'verworfen', grund: 'ean_not_in_html' } },
    suche: [k('https://a.de/p'), k('https://b.de/p')],
  });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(s.ergebnis).toEqual({ http: 200, result: 'all_failed' });
});

test('Kaufland-403 bricht die Suche nicht ab, der nächste Shop trifft', async () => {
  const d = deps({
    seiten: {
      'https://www.kaufland.de/1': { status: 'abrufFehler', httpStatus: 403 },
      'https://www.kaufland.de/2': { status: 'abrufFehler', httpStatus: 403 },
      'https://b.de/p': TREFFER,
    },
    suche: [k('https://www.kaufland.de/1'), k('https://www.kaufland.de/2'), k('https://b.de/p')],
  });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(s.treffer.kandidat.url).toBe('https://b.de/p');
});

// Prüfrunde 2: Jede weitere Seite bräuchte die KI. Bei hängender KI kostet
// ein Kandidat ~151 s (3 × 45 s + Pausen) — ein zweiter riss den Abbruch des
// Prozessors nach 240 s, und der Fehler landete am Barcode.
test('KI-Ausfall → sofort Abbruch, kein weiterer Kandidat, 503 extract_unavailable', async () => {
  const fehler = new ExtractUnavailableError('weg');
  const d = deps({
    seiten: { 'https://a.de/p': fehler, 'https://b.de/p': TREFFER },
    suche: [k('https://a.de/p'), k('https://b.de/p')],
  });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(d.aufrufe.gelesen).toEqual(['https://a.de/p']);
  expect(s.ergebnis).toEqual({ http: 503, result: 'extract_unavailable' });
});

test('KI-Ausfall auf der bevorzugten Seite → auch keine Serper-Suche mehr', async () => {
  const d = deps({ seiten: { 'https://a.de/p': new ExtractUnavailableError('weg') }, suche: [k('https://b.de/p')] });
  const s = await sucheEan({ ean: '1', bevorzugteUrl: 'https://a.de/p', deps: d.deps });
  expect(d.aufrufe.suche).toHaveLength(0);
  expect(s.ergebnis.result).toBe('extract_unavailable');
});

test('Apify-Konto zweimal in Folge → Abbruch, 503 fetch_unavailable', async () => {
  const fehler = new FetchUnavailableError('Apify 402');
  const d = deps({
    seiten: { 'https://a.de/p': fehler, 'https://b.de/p': fehler, 'https://c.de/p': TREFFER },
    suche: [k('https://a.de/p'), k('https://b.de/p'), k('https://c.de/p')],
  });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(d.aufrufe.gelesen).toEqual(['https://a.de/p', 'https://b.de/p']);
  expect(s.ergebnis).toEqual({ http: 503, result: 'fetch_unavailable' });
});

test('Apify-Konto, dann eine gelesene Seite, dann wieder → kein Abbruch (nicht in Folge)', async () => {
  const fehler = new FetchUnavailableError('Apify 402');
  const d = deps({
    seiten: {
      'https://a.de/p': fehler,
      'https://b.de/p': { status: 'keineDaten', grund: 'ki_null' },
      'https://c.de/p': fehler,
      'https://d.de/p': TREFFER,
    },
    suche: ['a', 'b', 'c', 'd'].map((x) => k(`https://${x}.de/p`)),
  });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(s.treffer.kandidat.url).toBe('https://d.de/p');
});

// Prüfrunde 2: resolveCandidates hängt für JEDE EAN die Codecheck-Suchseite
// an (source 'fallback'). Codecheck antwortet immer mit 200 — die Seite
// zählte als „beantwortet“, und gesperrte Shopseiten endeten als no-data.
describe('Rückfall-Adressen (Codecheck) sind kein Beleg', () => {
  const abruf = { status: 'abrufFehler', httpStatus: 403, grund: 'http' };
  const codecheck = { url: 'https://www.codecheck.info/product.search?q=4070757215046', shop: 'codecheck', source: 'fallback' };
  const serper = (url) => ({ ...k(url), source: 'serper' });

  test('alle Serper-Treffer gesperrt, Codecheck ohne EAN → 503 fetch_unavailable (nie no-data)', async () => {
    const d = deps({
      seiten: {
        'https://www.saturn.de/p/1': abruf,
        'https://www.skroutz.de/p/2': abruf,
        [codecheck.url]: { status: 'verworfen', grund: 'ean_not_in_html' },
      },
      suche: [serper('https://www.saturn.de/p/1'), serper('https://www.skroutz.de/p/2'), codecheck],
    });
    const s = await sucheEan({ ean: '4070757215046', deps: d.deps });
    expect(d.aufrufe.gelesen).toHaveLength(3);
    expect(s.ergebnis).toMatchObject({ http: 503, result: 'fetch_unavailable' });
  });

  test('ein Serper-Treffer antwortet (ohne EAN) → all_failed (inhaltliche Aussage)', async () => {
    const d = deps({
      seiten: {
        'https://www.saturn.de/p/1': abruf,
        'https://b.de/p': { status: 'verworfen', grund: 'ean_not_in_html' },
        [codecheck.url]: { status: 'verworfen', grund: 'ean_not_in_html' },
      },
      suche: [serper('https://www.saturn.de/p/1'), serper('https://b.de/p'), codecheck],
    });
    expect((await sucheEan({ ean: '4070757215046', deps: d.deps })).ergebnis).toEqual({ http: 200, result: 'all_failed' });
  });

  test('Codecheck trifft trotz gesperrter Shops → Treffer', async () => {
    const d = deps({
      seiten: { 'https://www.saturn.de/p/1': abruf, [codecheck.url]: { ...TREFFER, finalUrl: codecheck.url } },
      suche: [serper('https://www.saturn.de/p/1'), codecheck],
    });
    const s = await sucheEan({ ean: '4070757215046', deps: d.deps });
    expect(s.treffer.kandidat.shop).toBe('codecheck');
  });

  test('keine Serper-Treffer, nur Rückfall: beantwortet → all_failed; gesperrt → 503', async () => {
    const nurAntwort = deps({ seiten: { [codecheck.url]: { status: 'verworfen', grund: 'ean_not_in_html' } }, suche: [codecheck] });
    expect((await sucheEan({ ean: '4070757215046', deps: nurAntwort.deps })).ergebnis).toEqual({ http: 200, result: 'all_failed' });
    const gesperrt = deps({ seiten: { [codecheck.url]: abruf }, suche: [codecheck] });
    expect((await sucheEan({ ean: '4070757215046', deps: gesperrt.deps })).ergebnis).toMatchObject({ http: 503, result: 'fetch_unavailable' });
  });

  test('bevorzugte Seite gesperrt, Serper-Treffer gesperrt, Codecheck antwortet → 503', async () => {
    const d = deps({
      seiten: { 'https://violey.com/p': abruf, 'https://www.saturn.de/p/1': abruf, [codecheck.url]: { status: 'keineSeite' } },
      suche: [serper('https://www.saturn.de/p/1'), codecheck],
      bevorzugt: (url) => ({ ...k(url), source: 'bevorzugt' }),
    });
    const s = await sucheEan({ ean: '4070757215046', bevorzugteUrl: 'https://violey.com/p', deps: d.deps });
    expect(s.ergebnis).toMatchObject({ http: 503, result: 'fetch_unavailable' });
  });
});

test('Suche fällt aus (Serper) → Fehler geht nach oben (scrapeEan antwortet 503)', async () => {
  const d = deps({ sucheFehler: new SearchUnavailableError('Guthaben leer') });
  await expect(sucheEan({ ean: '1', deps: d.deps })).rejects.toBeInstanceOf(SearchUnavailableError);
});

test('Frist abgelaufen → keine neuen Kandidaten, 503 zeitlimit', async () => {
  let t = 0;
  const d = deps({ seiten: {}, suche: [k('https://a.de/p'), k('https://b.de/p')] });
  const leseOriginal = d.deps.leseKandidat;
  d.deps.leseKandidat = async (args) => {
    t += 200_000;
    return leseOriginal(args);
  };
  const s = await sucheEan({ ean: '1', deps: d.deps, jetzt: () => t });
  expect(d.aufrufe.gelesen).toEqual(['https://a.de/p']);
  expect(s.ergebnis).toEqual({ http: 503, result: 'zeitlimit' });
});

test('ein unerwarteter Fehler wird nicht verschluckt', async () => {
  const d = deps({ seiten: { 'https://a.de/p': new TypeError('Programmfehler') }, suche: [k('https://a.de/p')] });
  await expect(sucheEan({ ean: '1', deps: d.deps })).rejects.toBeInstanceOf(TypeError);
});

test('Treffer nur mit Namen beendet die Suche nicht; sein Name ergänzt den besseren Treffer', async () => {
  const nurName = { status: 'treffer', befund: { productName: 'Elvital Shampoo', eanBeleg: 'jsonld_gtin' }, finalUrl: 'https://a.de/p' };
  const d = deps({ seiten: { 'https://a.de/p': nurName, 'https://b.de/p': TREFFER }, suche: [k('https://a.de/p'), k('https://b.de/p')] });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(s.treffer.kandidat.url).toBe('https://b.de/p');
  expect(s.treffer.befund).toEqual({ attr_ingredientStatement: 'Wasser', productName: 'Elvital Shampoo', eanBeleg: 'jsonld_gtin' });
});

test('nichts Besseres gefunden → der Treffer mit Namen ist das Ergebnis', async () => {
  const nurName = { status: 'treffer', befund: { productName: 'Domol Colorwaschmittel', eanBeleg: 'seitentext' }, finalUrl: 'https://a.de/p' };
  const d = deps({ seiten: { 'https://a.de/p': nurName }, suche: [k('https://a.de/p'), k('https://b.de/p')] });
  const s = await sucheEan({ ean: '1', bevorzugteUrl: 'https://a.de/p', deps: d.deps });
  expect(s.treffer.befund.productName).toBe('Domol Colorwaschmittel');
  expect(s.ueberBevorzugteUrl).toBe(true);
  expect(s.ergebnis).toBeNull();
});

test('nur Name gefunden, aber KI fiel unterwegs aus → 503, kein halber Abschluss', async () => {
  const nurName = { status: 'treffer', befund: { productName: 'X', eanBeleg: 'seitentext' }, finalUrl: 'https://a.de/p' };
  const d = deps({
    seiten: { 'https://a.de/p': nurName, 'https://b.de/p': new ExtractUnavailableError('weg') },
    suche: [k('https://a.de/p'), k('https://b.de/p')],
  });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(s.treffer).toBeNull();
  expect(s.ergebnis).toEqual({ http: 503, result: 'extract_unavailable' });
});

// ─── Prüfrunde 04.10.2026 ─────────────────────────────────────────

test('Treffer nur mit Preis/Hersteller beendet die Suche nicht; der spätere Treffer mit Zutaten gewinnt und übernimmt den Preis', async () => {
  const nurPreis = { status: 'treffer', befund: { attr_hersteller: 'Clac GmbH', attr_preis: 1.99, priceShop: 'clac', priceCurrency: 'EUR' }, finalUrl: 'https://clac.de/p' };
  const voll = { status: 'treffer', befund: { attr_ingredientStatement: 'Wasser', productName: 'Haferdrink', eanBeleg: 'jsonld_gtin' }, finalUrl: 'https://b.de/p' };
  const d = deps({ seiten: { 'https://clac.de/p': nurPreis, 'https://b.de/p': voll }, suche: [k('https://clac.de/p'), k('https://b.de/p')] });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(d.aufrufe.gelesen).toEqual(['https://clac.de/p', 'https://b.de/p']);
  expect(s.treffer.kandidat.url).toBe('https://b.de/p');
  expect(s.treffer.befund).toMatchObject({ attr_ingredientStatement: 'Wasser', attr_hersteller: 'Clac GmbH', attr_preis: 1.99 });
});

test('Name mit Preis ist ein voller Treffer (die App kann ihn zeigen) → Ende der Suche', async () => {
  const namePreis = { status: 'treffer', befund: { productName: 'Batterien AA', eanBeleg: 'jsonld_gtin', attr_preis: 4.99 }, finalUrl: 'https://a.de/p' };
  const d = deps({ seiten: { 'https://a.de/p': namePreis, 'https://b.de/p': TREFFER }, suche: [k('https://a.de/p'), k('https://b.de/p')] });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(d.aufrufe.gelesen).toEqual(['https://a.de/p']);
  expect(s.treffer.befund.productName).toBe('Batterien AA');
});

test('mehrere Teilfunde ohne vollen Treffer → zusammengeführt als Ergebnis', async () => {
  const nurPreis = { status: 'treffer', befund: { attr_preis: 1.99, priceShop: 'clac', priceCurrency: 'EUR' }, finalUrl: 'https://a.de/p' };
  const nurName = { status: 'treffer', befund: { productName: 'Domol', eanBeleg: 'seitentext' }, finalUrl: 'https://b.de/p' };
  const d = deps({ seiten: { 'https://a.de/p': nurPreis, 'https://b.de/p': nurName }, suche: [k('https://a.de/p'), k('https://b.de/p')] });
  const s = await sucheEan({ ean: '1', deps: d.deps });
  expect(s.treffer.kandidat.url).toBe('https://a.de/p');
  expect(s.treffer.befund).toMatchObject({ attr_preis: 1.99, productName: 'Domol', eanBeleg: 'seitentext' });
  expect(s.ergebnis).toBeNull();
});

test.each(['gtin_widerspruch', 'ean_not_in_html', 'mehrere_produkte'])('bevorzugte Seite verworfen (%s) → gemeldet', async (grund) => {
  const d = deps({ seiten: { 'https://violey.com/p': { status: 'verworfen', grund } }, suche: [] });
  const s = await sucheEan({ ean: '1', bevorzugteUrl: 'https://violey.com/p', deps: d.deps });
  expect(s.bevorzugteUrlWiderlegt).toEqual({ url: 'https://violey.com/p', grund });
  expect(s.ergebnis).toEqual({ http: 200, result: 'all_failed' });
});

test('bevorzugte Seite: Abruffehler, 404 oder „KI liest nichts“ sind kein Widerspruch', async () => {
  for (const r of [{ status: 'abrufFehler', httpStatus: 403 }, { status: 'keineSeite' }, { status: 'keineDaten', grund: 'ki_null' }, { status: 'verworfen', grund: 'quality_check' }]) {
    const d = deps({ seiten: { 'https://a.de/p': r }, suche: [] });
    const s = await sucheEan({ ean: '1', bevorzugteUrl: 'https://a.de/p', deps: d.deps });
    expect(s.bevorzugteUrlWiderlegt).toBeNull();
  }
});

test('ein verworfener Kandidat der normalen Suche ist kein Widerspruch der Quellseite', async () => {
  const d = deps({ seiten: { 'https://b.de/p': { status: 'verworfen', grund: 'gtin_widerspruch' } }, suche: [k('https://b.de/p')] });
  const s = await sucheEan({ ean: '1', bevorzugteUrl: 'https://a.de/p', deps: d.deps });
  expect(s.bevorzugteUrlWiderlegt).toBeNull();
});

test('auftrag geht an jede Seite (Kosten-Logzeile)', async () => {
  const gesehen = [];
  const d = deps({ seiten: { 'https://a.de/p': TREFFER }, suche: [k('https://a.de/p')] });
  const lese = d.deps.leseKandidat;
  d.deps.leseKandidat = async (args) => { gesehen.push(args.auftrag); return lese(args); };
  await sucheEan({ ean: '1', deps: d.deps, auftrag: 'produktsuche' });
  expect(gesehen).toEqual(['produktsuche']);
});
