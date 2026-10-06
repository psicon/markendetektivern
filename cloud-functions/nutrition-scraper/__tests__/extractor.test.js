/**
 * Tests für src/extractor.js — Kosten-Logzeile je KI-Antwort, Zähler,
 * Identitätsfelder als _ki*, Fehlervertrag. Gemini ist eine Attrappe.
 *
 * @jest-environment node
 */

'use strict';

// Attrappe ohne jest.fn — die cf-Konfiguration setzt Mocks vor jedem Test zurück.
const gemini = { antworten: [], anfragen: [] };
jest.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = {
        generateContent: async (anfrage) => {
          gemini.anfragen.push(anfrage);
          const a = gemini.antworten.shift();
          if (a instanceof Error) throw a;
          return a;
        },
      };
    }
  },
}));

const { extractFromHtml } = require('../src/extractor');
const { ExtractUnavailableError } = require('../src/fehler');

const SEITE = `<html><body><h1>Nuss Nougat Creme</h1><p>${'Zutaten: Zucker, Haselnüsse 13 %, Kakao. '.repeat(10)}</p></body></html>`;
const usage = { promptTokenCount: 2400, candidatesTokenCount: 500, thoughtsTokenCount: 30 };

function antwort(obj, extra = {}) {
  return { text: JSON.stringify(obj), usageMetadata: usage, candidates: [{ finishReason: 'STOP' }], ...extra };
}

let logs;
beforeEach(() => {
  gemini.antworten = [];
  gemini.anfragen = [];
  logs = [];
  jest.spyOn(console, 'log').mockImplementation((z) => logs.push(z));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

const kostenZeilen = () => logs.filter((z) => typeof z === 'string' && z.includes('produktsuche_kosten')).map((z) => JSON.parse(z));

test('gelesen: Logzeile, Zähler, Identitätsfelder nur als _ki*', async () => {
  gemini.antworten.push(antwort({
    attr_ingredientStatement: 'Zucker, Haselnüsse',
    confidence: 0.9,
    produktName: 'Gut & Günstig Nuss Nougat Creme 400 g',
    einzelprodukt: true,
    produktBildUrl: null,
  }));
  const verbrauch = {};
  const r = await extractFromHtml({ html: SEITE, ean: '4311501099278', rohName: 'Nuss Nougat Creme - Shop', verbrauch });
  expect(r.attr_ingredientStatement).toBe('Zucker, Haselnüsse');
  expect(r._kiProduktName).toBe('Gut & Günstig Nuss Nougat Creme 400 g');
  expect(r._kiEinzelprodukt).toBe(true);
  expect(r).not.toHaveProperty('produktName');
  expect(r).not.toHaveProperty('einzelprodukt');
  expect(r._confidence).toBe(0.9);
  expect(kostenZeilen()).toEqual([expect.objectContaining({
    evt: 'produktsuche_kosten', ean: '4311501099278', modell: 'gemini-3.5-flash',
    tokensEin: 2400, tokensAus: 500, tokensDenken: 30, ergebnis: 'gelesen', versuch: 1,
  })]);
  expect(verbrauch).toEqual({ kiAufrufe: 1, tokensEin: 2400, tokensAus: 500, tokensDenken: 30 });
});

test('keine Produktseite (Sicherheit < 0,5) → null, trotzdem geloggt', async () => {
  gemini.antworten.push(antwort({ confidence: 0 }));
  await expect(extractFromHtml({ html: SEITE, ean: '1' })).resolves.toBeNull();
  expect(kostenZeilen()[0]).toMatchObject({ ergebnis: 'keine_produktseite', tokensEin: 2400 });
});

test('Seite ohne verwertbare Felder → Objekt (Verwertbarkeit entscheidet der Aufrufer)', async () => {
  gemini.antworten.push(antwort({ confidence: 0.8, produktName: 'Domol Colorwaschmittel' }));
  const r = await extractFromHtml({ html: SEITE, ean: '1' });
  expect(r._kiProduktName).toBe('Domol Colorwaschmittel');
});

test('inhaltliche Ablehnung → null, geloggt als blockiert', async () => {
  gemini.antworten.push({ text: '', usageMetadata: usage, candidates: [{ finishReason: 'SAFETY' }] });
  await expect(extractFromHtml({ html: SEITE, ean: '1' })).resolves.toBeNull();
  expect(kostenZeilen()[0]).toMatchObject({ ergebnis: 'blockiert', tokensEin: 2400 });
});

test('zu wenig Inhalt → kein Aufruf, keine Logzeile', async () => {
  await expect(extractFromHtml({ html: '<p>kurz</p>', ean: '1' })).resolves.toBeNull();
  expect(kostenZeilen()).toEqual([]);
});

test('drei Fehlversuche → ExtractUnavailableError, jede Antwort geloggt (auch kaputtes JSON)', async () => {
  jest.useFakeTimers();
  try {
    gemini.antworten.push(
      Object.assign(new Error('429 RESOURCE_EXHAUSTED'), { status: 429 }),
      { text: '{"kaputt', usageMetadata: usage, candidates: [{ finishReason: 'MAX_TOKENS' }] },
      Object.assign(new Error('503'), { status: 503 }),
    );
    const verbrauch = {};
    const p = extractFromHtml({ html: SEITE, ean: '1', verbrauch });
    const erwartung = expect(p).rejects.toBeInstanceOf(ExtractUnavailableError);
    await jest.advanceTimersByTimeAsync(20_000);
    await erwartung;
    expect(kostenZeilen().map((z) => z.ergebnis)).toEqual(['fehler', 'json_fehler', 'fehler']);
    expect(kostenZeilen()[1].tokensEin).toBe(2400); // kaputte Antwort hat Token gekostet
    expect(verbrauch.kiAufrufe).toBe(3);
    expect(verbrauch.tokensEin).toBe(2400);
  } finally {
    jest.useRealTimers();
  }
});

test('Rohname und erwarteter Name gehen als Hinweise an die KI', async () => {
  gemini.antworten.push(antwort({ confidence: 0.9, attr_hersteller: 'X' }));
  await extractFromHtml({ html: SEITE, ean: '1', rohName: 'Elvital Shampoo', productName: 'Erwartet' });
  const text = gemini.anfragen[0].contents[0].parts[0].text;
  expect(text).toContain('[Erwarteter Produkt-Name: "Erwartet"]');
  expect(text).toContain('[Rohname aus den Seitendaten: "Elvital Shampoo"]');
  expect(gemini.anfragen[0].config.systemInstruction).toContain('produktName');
});

test('nur die Datenfelder des Prompts: fremde Schlüssel und Objekte fallen weg (Prüfrunde 04.10.2026)', async () => {
  gemini.antworten.push(antwort({
    confidence: 0.9,
    attr_ingredientStatement: 'Wasser',
    attr_allergene: ['MILCH'],
    nutr_Energie_val: 40,
    attr_marke: 'erfunden',
    productName: 'Injiziert',
    sourceShop: 'rewe.de',
    productPath: 'produkte/x',
    shopBildUrl: 'https://boese.example/b.jpg',
    eanBeleg: 'jsonld_gtin',
    attr_hersteller: { name: 'Objekt statt Text' },
  }));
  const r = await extractFromHtml({ html: SEITE, ean: '1', auftrag: 'produktsuche' });
  expect(Object.keys(r).filter((k) => !k.startsWith('_')).sort()).toEqual(['attr_allergene', 'attr_ingredientStatement', 'nutr_Energie_val']);
  expect(kostenZeilen()[0]).toMatchObject({ auftrag: 'produktsuche' });
});
