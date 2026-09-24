'use strict';

/**
 * Lesung der Produktfotos (Vorfall 22.–24.09.2026: 400 „Thinking budget is not
 * supported" bei einem Teil der Anfragen, jeder Fehler endete als „kein Name").
 * Läuft mit dem eingebauten Test-Runner: `npm test` (node --test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  geminiKonfig,
  istVoruebergehend,
  istDenkEinstellungAbgelehnt,
  leseMitWiederholung,
  auswerten,
  patchFelder,
  MIN_CONFIDENCE,
} = require('../src/lesung');

const Type = { OBJECT: 'OBJECT', STRING: 'STRING', NUMBER: 'NUMBER', INTEGER: 'INTEGER' };
const ANTWORT = { productName: "King's Crown Tomatenmark", confidence: 0.95, priceCents: 69, manufacturer: 'Attianese Vertriebs GmbH', priceImageKind: 'preisschild', receiptMerchant: '', receiptStreet: '', receiptZip: '', receiptCity: '', receiptDate: '' };

/** Nachgebautes Gemini: spielt eine Liste von Ergebnissen ab und merkt sich die Konfigurationen. */
function fakeAi(abfolge) {
  const aufrufe = [];
  return {
    aufrufe,
    models: {
      async generateContent(req) {
        aufrufe.push(req.config);
        const next = abfolge[Math.min(aufrufe.length - 1, abfolge.length - 1)];
        if (next instanceof Error) throw next;
        return { text: typeof next === 'string' ? next : JSON.stringify(next) };
      },
    },
  };
}
const fehler = (message, status) => Object.assign(new Error(message), status ? { status } : {});
const pausen = [];
const schlafen = async (ms) => { pausen.push(ms); };

test('Konfiguration: thinkingLevel LOW, kein thinkingBudget, genug Ausgabe-Token', () => {
  const k = geminiKonfig(Type);
  assert.deepEqual(k.thinkingConfig, { thinkingLevel: 'LOW' });
  assert.equal(JSON.stringify(k).includes('thinkingBudget'), false);
  assert.equal(k.maxOutputTokens, 4096);
  assert.equal(k.httpOptions.timeout, 60000); // hängende Anfrage bricht ab statt die Funktion zu blockieren
  assert.equal('thinkingConfig' in geminiKonfig(Type, { ohneDenken: true }), false);
});

test('erster Versuch klappt → ein Aufruf', async () => {
  const ai = fakeAi([ANTWORT]);
  const r = await leseMitWiederholung({ ai, model: 'm', parts: [], Type, schlafen });
  assert.equal(r.versuche, 1);
  assert.equal(r.parsed.productName, ANTWORT.productName);
  assert.equal(ai.aufrufe.length, 1);
});

test('429 und Netzfehler werden wiederholt, mit Pausen', async () => {
  pausen.length = 0;
  const ai = fakeAi([fehler('Resource exhausted', 429), fehler('fetch failed'), ANTWORT]);
  const r = await leseMitWiederholung({ ai, model: 'm', parts: [], Type, schlafen });
  assert.equal(r.versuche, 3);
  assert.deepEqual(pausen, [3000, 10000]);
});

test('abgeschnittenes JSON und leere Antwort gelten als vorübergehend', async () => {
  const ai = fakeAi(['{"productName": "Kin', '', ANTWORT]);
  const r = await leseMitWiederholung({ ai, model: 'm', parts: [], Type, schlafen });
  assert.equal(r.versuche, 3);
});

test('Denk-Einstellung abgelehnt → nächster Versuch ohne thinkingConfig, ohne Pause', async () => {
  pausen.length = 0;
  const e = fehler('{"error":{"code":400,"message":"Thinking budget is not supported for this model.","status":"INVALID_ARGUMENT"}}');
  const ai = fakeAi([e, ANTWORT]);
  const r = await leseMitWiederholung({ ai, model: 'm', parts: [], Type, schlafen });
  assert.equal(r.versuche, 2);
  assert.ok(ai.aufrufe[0].thinkingConfig);
  assert.equal('thinkingConfig' in ai.aufrufe[1], false);
  assert.deepEqual(pausen, []);
});

test('inhaltlicher 400 (Bild ungültig) → kein zweiter Versuch', async () => {
  const ai = fakeAi([fehler('{"error":{"code":400,"message":"Provided image is not valid.","status":"INVALID_ARGUMENT"}}')]);
  await assert.rejects(leseMitWiederholung({ ai, model: 'm', parts: [], Type, schlafen }), (e) => e.versuche === 1);
  assert.equal(ai.aufrufe.length, 1);
});

test('dauerhaft überlastet → nach 4 Versuchen Fehler mit versuche=4', async () => {
  pausen.length = 0;
  const ai = fakeAi([fehler('Resource exhausted', 429)]);
  await assert.rejects(leseMitWiederholung({ ai, model: 'm', parts: [], Type, schlafen }), (e) => e.versuche === 4);
  assert.equal(ai.aufrufe.length, 4);
  assert.deepEqual(pausen, [3000, 10000, 20000]);
});

test('Nicht-Error-Wurf bricht den strikten Modus nicht', async () => {
  const ai = { models: { async generateContent() { throw 'kaputt'; } } }; // eslint-disable-line no-throw-literal
  await assert.rejects(leseMitWiederholung({ ai, model: 'm', parts: [], Type, schlafen }), (e) => e instanceof Error && e.versuche === 1);
});

test('Klassifikation', () => {
  assert.equal(istVoruebergehend(fehler('x', 503)), true);
  assert.equal(istVoruebergehend(fehler('Provided image is not valid.', 400)), false);
  assert.equal(istVoruebergehend(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' })), true);
  assert.equal(istDenkEinstellungAbgelehnt(fehler('{"code":400,"message":"Thinking budget is not supported"}')), true);
  assert.equal(istDenkEinstellungAbgelehnt(fehler('Resource exhausted', 429)), false);
});

test('Auswertung: Preisgrenzen, Hersteller, Bon-Kopf', () => {
  assert.equal(auswerten({ ...ANTWORT, priceCents: 0 }, { hatPreisBild: true }).priceCents, null);
  assert.equal(auswerten({ ...ANTWORT, priceCents: 250000 }, { hatPreisBild: true }).priceCents, null);
  assert.equal(auswerten({ ...ANTWORT, priceImageKind: 'quatsch' }, { hatPreisBild: false }).priceImageKind, 'fehlt');
  const bon = auswerten({ ...ANTWORT, priceImageKind: 'kassenbon', receiptZip: '40472', receiptCity: 'Düsseldorf', receiptDate: '2026-09-24' }, { hatPreisBild: true });
  assert.deepEqual(bon.receipt, { merchant: null, street: null, zip: '40472', city: 'Düsseldorf', bonDate: '2026-09-24', source: 'preis-foto', complete: true });
});

test('Nutzereingabe gewinnt; Name nur bei ausreichender Sicherheit', () => {
  const e = auswerten(ANTWORT, { hatPreisBild: true });
  assert.equal(patchFelder(e, { userName: 'Mein Name' }).productName, undefined);
  assert.equal(patchFelder(e, { userName: '' }).productName, ANTWORT.productName);
  assert.equal(patchFelder({ ...e, confidence: MIN_CONFIDENCE - 0.01 }, { userName: null }).productName, undefined);
  const p = patchFelder(e, { userName: null });
  assert.deepEqual(p.priceOcr, { priceCents: 69, source: 'preisschild' });
  assert.deepEqual(p.manufacturerOcr, { name: 'Attianese Vertriebs GmbH', source: 'hersteller' });
});
