'use strict';

/**
 * Welcher Vertex-Standort und welche Denk-Konfiguration tatsächlich beim SDK
 * ankommen — am echten extractReceipt, nur der SDK-Client ist ersetzt.
 * Anlass: Ablösung gemini-2.5-pro (Abschaltung 20.10.2026), 01.10.2026.
 */

const erzeugt = [];
const anfragen = [];

jest.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor(opts) {
      this.opts = opts;
      erzeugt.push(opts);
      this.models = {
        generateContent: async (req) => {
          anfragen.push({ location: opts.location, req });
          return {
            text: JSON.stringify({ isReceipt: true, items: [], totalCents: 0 }),
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, thoughtsTokenCount: 1 },
          };
        },
      };
    }
  },
}));

// Texterkennung der Rückfall-Engine cv-hybrid — nur für den Kennungs-Test unten.
jest.mock('@google-cloud/vision', () => ({
  ImageAnnotatorClient: class {
    async documentTextDetection() {
      return [{ fullTextAnnotation: { text: 'REWE\nMilch 1,19\nSUMME 1,19' } }];
    }
  },
}));

const ENV_KEYS = ['GEMINI_USE_VERTEX', 'GEMINI_VERTEX_LOCATION', 'GEMINI_VERTEX_LOCATION_PRO', 'CASHBACK_OCR_THINKING_BUDGET', 'GEMINI_API_KEY'];
let gesichert;
let extractReceipt;

beforeEach(() => {
  erzeugt.length = 0;
  anfragen.length = 0;
  gesichert = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  jest.isolateModules(() => {
    ({ extractReceipt } = require('../lib/ocr'));
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (gesichert[k] === undefined) delete process.env[k];
    else process.env[k] = gesichert[k];
  }
});

const bild = Buffer.from('x');

test('Flash-Lesung ohne Angabe → global, ohne Denk-Konfiguration (Verhalten wie bisher)', async () => {
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.5-flash' });
  expect(anfragen).toHaveLength(1);
  expect(anfragen[0].location).toBe('global');
  expect(anfragen[0].req.model).toBe('gemini-3.5-flash');
  expect(anfragen[0].req.config.thinkingConfig).toBeUndefined();
  expect(anfragen[0].req.config.temperature).toBe(0.1);
});

test('Eskalation: ausdrücklicher Standort eu + thinkingLevel HIGH kommen beim SDK an', async () => {
  await extractReceipt(bild, 'image/jpeg', {
    model: 'gemini-3.5-flash',
    location: 'eu',
    thinkingConfig: { thinkingLevel: 'HIGH' },
  });
  expect(anfragen[0].location).toBe('eu');
  expect(anfragen[0].req.config.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
  expect(erzeugt[0]).toMatchObject({ vertexai: true, location: 'eu' });
});

test('getrennte Clients je Standort — eu-Eskalation verdrängt den global-Client nicht', async () => {
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.5-flash' });
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.5-flash', location: 'eu' });
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.5-flash' });
  expect(anfragen.map((a) => a.location)).toEqual(['global', 'eu', 'global']);
  expect(erzeugt.map((o) => o.location)).toEqual(['global', 'eu']);
});

test('Rückweg gemini-2.5-pro → weiterhin europe-west4', async () => {
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-2.5-pro' });
  expect(anfragen[0].location).toBe('europe-west4');
});

test('Zweitprüfung gemini-3.1-pro-preview → global', async () => {
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.1-pro-preview', thinkingConfig: { thinkingLevel: 'LOW' } });
  expect(anfragen[0].location).toBe('global');
});

test('übergebene Denkstufe schlägt den Budget-Schalter (sonst 400 bei Gemini 3)', async () => {
  process.env.CASHBACK_OCR_THINKING_BUDGET = '0';
  jest.isolateModules(() => {
    ({ extractReceipt } = require('../lib/ocr'));
  });
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.5-flash', thinkingConfig: { thinkingLevel: 'HIGH' } });
  expect(anfragen[0].req.config.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
});

// ── Kosten-Kennung (08.10.2026, lib/geminiKennung.js) ─────────────────────

test('Kennung: Vertex-Pfad schickt labels mit, ohne Angabe Stufe bon-ocr', async () => {
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.5-flash' });
  expect(anfragen[0].req.config.labels).toEqual({ funktion: 'cashback-pipeline', zweck: 'bon-ocr' });
});

test('Kennung: übergebene Stufe kommt beim SDK an (Eskalation unter eu)', async () => {
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.5-flash', location: 'eu', zweck: 'bon-ocr-eskalation' });
  expect(anfragen[0].location).toBe('eu');
  expect(anfragen[0].req.config.labels).toEqual({ funktion: 'cashback-pipeline', zweck: 'bon-ocr-eskalation' });
});

test('Kennung: AI-Studio-Pfad (GEMINI_USE_VERTEX=false) schickt KEINE labels — das SDK lehnte sie dort ab', async () => {
  process.env.GEMINI_USE_VERTEX = 'false';
  process.env.GEMINI_API_KEY = 'test-schluessel';
  jest.isolateModules(() => {
    ({ extractReceipt } = require('../lib/ocr'));
  });
  await extractReceipt(bild, 'image/jpeg', { model: 'gemini-3.5-flash', zweck: 'bon-ocr-eskalation' });
  expect(erzeugt[0]).toEqual({ apiKey: 'test-schluessel' });
  expect(anfragen[0].req.config).not.toHaveProperty('labels');
});

test('Kennung: cv-hybrid-Textparser → bon-ocr-text auf Vertex, ohne labels auf AI Studio', async () => {
  let extractReceiptCVHybrid;
  jest.isolateModules(() => {
    ({ extractReceiptCVHybrid } = require('../lib/ocr_cvhybrid'));
  });
  await extractReceiptCVHybrid(bild, 'image/jpeg', { model: 'gemini-3.5-flash' });
  expect(anfragen[0].req.config.labels).toEqual({ funktion: 'cashback-pipeline', zweck: 'bon-ocr-text' });

  anfragen.length = 0;
  process.env.GEMINI_USE_VERTEX = 'false';
  process.env.GEMINI_API_KEY = 'test-schluessel';
  jest.isolateModules(() => {
    ({ extractReceiptCVHybrid } = require('../lib/ocr_cvhybrid'));
  });
  await extractReceiptCVHybrid(bild, 'image/jpeg', { model: 'gemini-3.5-flash' });
  expect(anfragen[0].req.config).not.toHaveProperty('labels');
});
