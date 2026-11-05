'use strict';

/**
 * Kosten-Kennung der Gemini-Aufrufe (08.10.2026, lib/geminiKennung.js).
 *
 * Teil 1: der Helfer selbst. Teil 2: der Vertrag mit dem ECHTEN SDK dieser
 * Codebase (@google/genai aus node_modules, kein Mock) — die Anfrage wird am
 * fetch abgefangen, es geht nichts ins Netz. Er belegt beide Richtungen, auf
 * denen die Regel „nur auf dem Vertex-Pfad" beruht.
 */

const { geminiKennung, nutztVertex, ZWECK, FUNKTION, LABEL_MUSTER } = require('../lib/geminiKennung');

describe('geminiKennung', () => {
  test('Vertex (Standard, Variable fehlt) → labels mit Codebase und Stufe', () => {
    expect(geminiKennung(ZWECK.BON_OCR, {})).toEqual({ labels: { funktion: 'cashback-pipeline', zweck: 'bon-ocr' } });
    expect(nutztVertex({})).toBe(true);
    expect(nutztVertex({ GEMINI_USE_VERTEX: 'true' })).toBe(true);
  });

  test('AI-Studio-Pfad (GEMINI_USE_VERTEX=false) → keine Kennung', () => {
    expect(geminiKennung(ZWECK.BON_OCR, { GEMINI_USE_VERTEX: 'false' })).toEqual({});
    expect(nutztVertex({ GEMINI_USE_VERTEX: 'false' })).toBe(false);
  });

  test('alle Stufen und der Codebase-Name halten das Label-Format ein', () => {
    expect(Object.values(ZWECK)).toEqual(['bon-ocr', 'bon-ocr-verbessert', 'bon-ocr-eskalation', 'bon-zweitpruefung', 'bon-ocr-text']);
    for (const w of [FUNKTION, ...Object.values(ZWECK)]) expect(w).toMatch(LABEL_MUSTER);
  });

  test('ungültige Kennung wird weggelassen statt gesendet (sie darf keinen Aufruf scheitern lassen)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (const z of ['Bon-OCR', '1bon', 'bon ocr', 'bön', '', undefined, 'x'.repeat(64)]) {
      expect(geminiKennung(z, {})).toEqual({});
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('Vertrag mit dem echten SDK (ohne Netz)', () => {
  const { GoogleGenAI } = require('@google/genai');
  const echtesFetch = globalThis.fetch;
  let mitschnitt;

  beforeEach(() => {
    mitschnitt = [];
    globalThis.fetch = async (url, init) => {
      mitschnitt.push({ url: String(url), body: init && typeof init.body === 'string' ? JSON.parse(init.body) : null });
      const antwort = { candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] };
      return new Response(JSON.stringify(antwort), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
  afterEach(() => {
    globalThis.fetch = echtesFetch;
  });

  const scheinAuth = { getRequestHeaders: async () => new Headers({ Authorization: 'Bearer schein' }) };

  test('Vertex: labels stehen als eigenes Feld im Anfragekörper, nicht in generationConfig', async () => {
    const ai = new GoogleGenAI({ vertexai: true, project: 'schein-projekt', location: 'global', googleAuthOptions: { authClient: scheinAuth } });
    await ai.models.generateContent({ model: 'gemini-3.5-flash', contents: 'x', config: { temperature: 0.1, ...geminiKennung(ZWECK.BON_ZWEITPRUEFUNG, {}) } });
    expect(mitschnitt).toHaveLength(1);
    expect(mitschnitt[0].url).toMatch(/aiplatform\.googleapis\.com\/.*:generateContent/);
    expect(mitschnitt[0].body.labels).toEqual({ funktion: 'cashback-pipeline', zweck: 'bon-zweitpruefung' });
    expect(mitschnitt[0].body.generationConfig.labels).toBeUndefined();
  });

  test('AI Studio: mit labels wirft das SDK vor dem Senden — mit dem Helfer geht die Anfrage normal raus', async () => {
    const ai = new GoogleGenAI({ apiKey: 'schein-schluessel' });
    await expect(ai.models.generateContent({ model: 'gemini-3.5-flash', contents: 'x', config: { labels: { funktion: 'x', zweck: 'y' } } }))
      .rejects.toThrow(/labels parameter is not supported/);
    expect(mitschnitt).toHaveLength(0);

    await ai.models.generateContent({ model: 'gemini-3.5-flash', contents: 'x', config: { temperature: 0.1, ...geminiKennung(ZWECK.BON_OCR, { GEMINI_USE_VERTEX: 'false' }) } });
    expect(mitschnitt).toHaveLength(1);
    expect(mitschnitt[0].url).toMatch(/generativelanguage\.googleapis\.com/);
    expect(mitschnitt[0].body).not.toHaveProperty('labels');
  });
});
