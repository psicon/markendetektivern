/**
 * Kosten-Kennung der Gemini-Aufrufe (08.10.2026, src/genaiClient.js):
 * welche `labels` bei den drei Aufrufstellen ankommen — und dass der
 * AI-Studio-Pfad (GEMINI_USE_VERTEX=false) keine schickt (das SDK lehnte sie
 * dort vor dem Senden ab). Gemini ist eine Attrappe, es geht nichts ins Netz.
 *
 * @jest-environment node
 */

'use strict';

// Attrappe ohne jest.fn — die cf-Konfiguration setzt Mocks vor jedem Test zurück.
const gemini = { erzeugt: [], anfragen: [] };
jest.mock('@google/genai', () => ({
  // Schema-Typen: jeder Name steht für sich (OBJECT → 'OBJECT').
  Type: new Proxy({}, { get: (_, k) => String(k) }),
  GoogleGenAI: class {
    constructor(opts) {
      gemini.erzeugt.push(opts);
      this.models = {
        generateContent: async (anfrage) => {
          gemini.anfragen.push(anfrage);
          return {
            text: JSON.stringify({
              ingredientVerdict: 'equal', ingredientStrength: 'slight', reasoning: 'Beide sind gleichwertig.',
              healthScore: 3, herkunft: 'Deutschland', summary: 'Ein deutscher Hersteller.',
            }),
          };
        },
      };
    }
  },
}));

const ENV_KEYS = ['GEMINI_USE_VERTEX', 'GEMINI_VERTEX_LOCATION'];
let gesichert;
let m;

function laden() {
  jest.isolateModules(() => {
    m = {
      client: require('../src/genaiClient'),
      comparator: require('../src/comparator'),
      assessor: require('../src/assessor'),
      manufacturer: require('../src/manufacturer'),
    };
  });
}

beforeEach(() => {
  gemini.erzeugt = [];
  gemini.anfragen = [];
  gesichert = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  laden();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (gesichert[k] === undefined) delete process.env[k];
    else process.env[k] = gesichert[k];
  }
});

/** Alle drei Aufrufstellen einmal; nur die Anfrage interessiert, nicht die Auswertung. */
async function alleAufrufe() {
  const snap = m.assessor.snapshotFromDoc({ name: 'Nuss-Nougat-Creme', zutaten: 'Zucker, Haselnüsse, Kakao' });
  const vergleich = { noname: m.comparator.snapshotFromDoc({ name: 'A', zutaten: 'Zucker, Haselnüsse' }), original: m.comparator.snapshotFromDoc({ name: 'B', zutaten: 'Zucker, Haselnüsse' }) };
  const hersteller = m.manufacturer.snapshotFromHersteller({ name: 'Beispiel GmbH' });
  await m.comparator.callGemini({ apiKey: 'k', snapshot: vergleich }).catch(() => {});
  await m.assessor.callGeminiAssessment({ apiKey: 'k', snapshot: snap, category: 'Aufstriche' }).catch(() => {});
  await m.assessor.callGeminiAssessment({ apiKey: 'k', snapshot: snap, category: 'Aufstriche', zweck: m.client.ZWECK.EXTERN_BEWERTUNG }).catch(() => {});
  await m.manufacturer.callGeminiManufacturer({ apiKey: 'k', snapshot: hersteller }).catch(() => {});
}

test('Vertex-Pfad (Standard): jede Aufrufstelle schickt Codebase und Zweck mit', async () => {
  await alleAufrufe();
  expect(gemini.erzeugt).toEqual([{ vertexai: true, project: expect.any(String), location: 'global' }]);
  expect(gemini.anfragen.map((a) => a.config.labels)).toEqual([
    { funktion: 'ai-product-comparison', zweck: 'produkt-vergleich' },
    { funktion: 'ai-product-comparison', zweck: 'produkt-bewertung' },
    { funktion: 'ai-product-comparison', zweck: 'extern-bewertung' },
    { funktion: 'ai-product-comparison', zweck: 'hersteller-bewertung' },
  ]);
  // Sonst unverändert.
  for (const a of gemini.anfragen) expect(a.config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
});

test('AI-Studio-Pfad (GEMINI_USE_VERTEX=false): keine labels', async () => {
  process.env.GEMINI_USE_VERTEX = 'false';
  laden();
  await alleAufrufe();
  expect(gemini.erzeugt).toEqual([{ apiKey: 'k' }]);
  expect(gemini.anfragen).toHaveLength(4);
  for (const a of gemini.anfragen) expect(a.config).not.toHaveProperty('labels');
});

test('alle Zwecke halten das Label-Format ein; ungültige Kennung wird weggelassen', () => {
  const { ZWECK, FUNKTION, LABEL_MUSTER, geminiKennung } = m.client;
  for (const w of [FUNKTION, ...Object.values(ZWECK)]) expect(w).toMatch(LABEL_MUSTER);
  expect(geminiKennung('Produkt Vergleich', {})).toEqual({});
  expect(geminiKennung(undefined, {})).toEqual({});
  expect(geminiKennung(ZWECK.PRODUKT_VERGLEICH, { GEMINI_USE_VERTEX: 'false' })).toEqual({});
});
