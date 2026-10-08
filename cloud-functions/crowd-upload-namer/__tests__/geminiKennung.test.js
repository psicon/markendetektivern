'use strict';

/**
 * Kosten-Kennung (08.10.2026, src/geminiKennung.js): labels nur auf dem
 * Vertex-Pfad — auf dem AI-Studio-Pfad lehnte das SDK sie vor dem Senden ab.
 * Läuft mit dem eingebauten Test-Runner: `npm test` (node --test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { geminiKennung, nutztVertex, ZWECK, FUNKTION, LABEL_MUSTER } = require('../src/geminiKennung');

test('Vertex (Standard, Variable fehlt) → labels mit Codebase und Zweck', () => {
  assert.deepEqual(geminiKennung(ZWECK.FOTO_NAME, {}), { labels: { funktion: 'crowd-upload-namer', zweck: 'foto-name' } });
  assert.equal(nutztVertex({}), true);
});

test('AI-Studio-Pfad (GEMINI_USE_VERTEX=false) → keine Kennung', () => {
  assert.deepEqual(geminiKennung(ZWECK.FOTO_NAME, { GEMINI_USE_VERTEX: 'false' }), {});
  assert.equal(nutztVertex({ GEMINI_USE_VERTEX: 'false' }), false);
});

test('Format eingehalten; ungültige Kennung wird weggelassen statt gesendet', () => {
  for (const w of [FUNKTION, ...Object.values(ZWECK)]) assert.match(w, LABEL_MUSTER);
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (const z of ['Foto Name', '9foto', undefined, 'x'.repeat(64)]) assert.deepEqual(geminiKennung(z, {}), {});
  } finally {
    console.warn = warn;
  }
});
