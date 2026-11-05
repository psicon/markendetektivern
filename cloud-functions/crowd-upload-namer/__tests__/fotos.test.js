'use strict';

/**
 * Auswahl der Fotos und Rückfall bei Dekodierfehlern (src/fotos.js).
 * Vorbild ist der Fall vom 25.09.2026: Hersteller-Foto bei 1 MiB
 * abgeschnitten, Gemini antwortete 400 „Failed to decode image data".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { waehleFotos, defekteFotos, leseEinreichung } = require('../src/fotos');

const OK = { ok: true, groesse: 1000, mimeType: 'image/jpeg' };
const KAPUTT = { ok: false, groesse: 1048576, grund: 'jpeg_ohne_bildende', mimeType: 'image/jpeg' };

// Minimal gültige Dateien für die Strukturprüfung.
const JPEG_GUT = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x01, 0x01, 0x12, 0x34, 0xff, 0xd9]);
const JPEG_ABGESCHNITTEN = JPEG_GUT.subarray(0, 10);
const PNG_GUT = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 0]), Buffer.from('IEND', 'latin1'), Buffer.alloc(4),
]);
const ANTWORT = { productName: 'Milsani Gouda', confidence: 0.9, priceCents: 199, manufacturer: 'DMK', priceImageKind: 'preisschild' };
const DEKODIER_400 = () => Object.assign(new Error('{"error":{"code":400,"message":"Failed to decode image data.","status":"INVALID_ARGUMENT"}}'), { status: 400, versuche: 1 });

const BILDER = { front: 'p/front.jpg', preis: 'p/preis.jpg', hersteller: 'p/hersteller.jpg', rueckseite: 'p/rueckseite.jpg', zutaten: 'p/zutaten.jpg' };

/** Storage-Attrappe: Pfad → Buffer | null (fehlt) | Error (Ladefehler). Merkt sich geladene Pfade. */
function speicher(dateien) {
  const geladen = [];
  return {
    geladen,
    ladeBild: async (pfad) => {
      geladen.push(pfad);
      const d = dateien[pfad];
      if (d instanceof Error) throw d;
      return d === undefined ? JPEG_GUT : d;
    },
  };
}

/** Gemini-Attrappe: Antworten der Reihe nach; merkt sich die gesendeten Slots und Optionen. */
function gemini(antworten) {
  const aufrufe = [];
  return {
    aufrufe,
    lese: async (parts, opts = {}) => {
      const slots = parts.filter((p) => p.text && p.text.startsWith('Bild')).map((p) => p.text);
      const mime = parts.filter((p) => p.inlineData).map((p) => p.inlineData.mimeType);
      aufrufe.push({ slots, mime, opts });
      const a = antworten[Math.min(aufrufe.length - 1, antworten.length - 1)];
      if (a instanceof Error) throw a;
      return { parsed: a, versuche: 1 };
    },
  };
}

test('Auswahl: alles in Ordnung → front, preis, hersteller; keine Rückseite', () => {
  assert.deepEqual(waehleFotos({ front: OK, preis: OK, hersteller: OK }), { senden: ['front', 'preis', 'hersteller'], ersatzNoetig: false });
});

test('Auswahl: hersteller defekt → weglassen, Rückseite als Ersatz', () => {
  const p = { front: OK, preis: OK, hersteller: KAPUTT };
  assert.deepEqual(waehleFotos(p), { senden: ['front', 'preis'], ersatzNoetig: true });
  assert.deepEqual(waehleFotos({ ...p, rueckseite: OK }).senden, ['front', 'preis', 'rueckseite']);
  assert.deepEqual(waehleFotos({ ...p, rueckseite: KAPUTT }).senden, ['front', 'preis']);
});

test('Auswahl: nur preis defekt → kein Ersatz (die Rückseite zeigt keinen Preis)', () => {
  assert.deepEqual(waehleFotos({ front: OK, preis: KAPUTT, hersteller: OK, rueckseite: OK }), { senden: ['front', 'hersteller'], ersatzNoetig: false });
});

test('Auswahl: fehlender Slot ist kein Defekt', () => {
  assert.deepEqual(waehleFotos({ front: OK, hersteller: null }), { senden: ['front'], ersatzNoetig: false });
  assert.deepEqual(defekteFotos({ front: OK, hersteller: null, preis: KAPUTT }), [{ slot: 'preis', groesse: 1048576, grund: 'jpeg_ohne_bildende' }]);
});

test('alles gesund → ein Aufruf mit front/preis/hersteller; die übrigen Fotos nur geprüft', async () => {
  const s = speicher({});
  const g = gemini([ANTWORT]);
  const r = await leseEinreichung({ images: BILDER, ladeBild: s.ladeBild, lese: g.lese });
  assert.equal(r.art, 'gelesen');
  assert.deepEqual(r.gesendet, ['front', 'preis', 'hersteller']);
  assert.deepEqual(r.defekt, []);
  assert.deepEqual(r.ungeprueft, []);
  assert.equal(g.aufrufe.length, 1);
  assert.equal(g.aufrufe[0].slots.length, 3);
  // Namer-Fotos zuerst, danach die übrigen (nach dem Aufruf).
  assert.deepEqual(s.geladen, ['p/front.jpg', 'p/preis.jpg', 'p/hersteller.jpg', 'p/rueckseite.jpg', 'p/zutaten.jpg']);
});

test('abgeschnittenes EAN- oder Rückseiten-Foto wird vermerkt, aber nie an Gemini geschickt', async () => {
  const images = { ...BILDER, ean: 'p/ean.jpg' };
  const s = speicher({ 'p/ean.jpg': JPEG_ABGESCHNITTEN, 'p/rueckseite.jpg': Buffer.alloc(0) });
  const g = gemini([ANTWORT]);
  const r = await leseEinreichung({ images, ladeBild: s.ladeBild, lese: g.lese });
  assert.equal(r.art, 'gelesen');
  assert.deepEqual(r.gesendet, ['front', 'preis', 'hersteller']);
  assert.deepEqual(r.defekt, [
    { slot: 'rueckseite', groesse: 0, grund: 'leer' },
    { slot: 'ean', groesse: 10, grund: 'jpeg_ohne_bildende' },
  ]);
});

test('übrige Fotos: Ladefehler oder fehlende Datei stören die Lesung nicht', async () => {
  const s = speicher({ 'p/zutaten.jpg': new Error('socket hang up'), 'p/rueckseite.jpg': null });
  const g = gemini([ANTWORT]);
  const r = await leseEinreichung({ images: BILDER, ladeBild: s.ladeBild, lese: g.lese });
  assert.equal(r.art, 'gelesen');
  assert.deepEqual(r.ungeprueft, ['zutaten']);
  assert.deepEqual(r.defekt, []);
});

test('keine Namer-Fotos → trotzdem alle übrigen geprüft', async () => {
  const r = await leseEinreichung({ images: { zutaten: 'z', ean: 'e' }, ladeBild: speicher({ e: JPEG_ABGESCHNITTEN }).ladeBild, lese: gemini([ANTWORT]).lese });
  assert.equal(r.art, 'ohne_bild');
  assert.deepEqual(r.defekt.map((d) => d.slot), ['ean']);
});

test('PNG (von der App als image/jpeg hochgeladen) geht als image/png an Gemini', async () => {
  const s = speicher({ 'p/preis.jpg': PNG_GUT });
  const g = gemini([ANTWORT]);
  await leseEinreichung({ images: BILDER, ladeBild: s.ladeBild, lese: g.lese });
  assert.deepEqual(g.aufrufe[0].mime, ['image/jpeg', 'image/png', 'image/jpeg']);
});

test('abgeschnittenes Hersteller-Foto → weggelassen, Rückseite statt dessen, Defekt vermerkt', async () => {
  const s = speicher({ 'p/hersteller.jpg': JPEG_ABGESCHNITTEN });
  const g = gemini([ANTWORT]);
  const r = await leseEinreichung({ images: BILDER, ladeBild: s.ladeBild, lese: g.lese });
  assert.equal(r.art, 'gelesen');
  assert.deepEqual(r.gesendet, ['front', 'preis', 'rueckseite']);
  assert.deepEqual(r.defekt, [{ slot: 'hersteller', groesse: 10, grund: 'jpeg_ohne_bildende' }]);
  assert.equal(g.aufrufe.length, 1);
  assert.deepEqual(g.aufrufe[0].slots, ['Bild „Produktvorderseite":', 'Bild „Preis":', 'Bild „Rückseite":']);
});

test('alle Namer-Fotos defekt und keine Rückseite → kein Aufruf, bilder_defekt', async () => {
  const s = speicher({ 'p/front.jpg': JPEG_ABGESCHNITTEN, 'p/preis.jpg': JPEG_ABGESCHNITTEN, 'p/hersteller.jpg': Buffer.alloc(0) });
  const g = gemini([ANTWORT]);
  const r = await leseEinreichung({ images: { front: 'p/front.jpg', preis: 'p/preis.jpg', hersteller: 'p/hersteller.jpg' }, ladeBild: s.ladeBild, lese: g.lese });
  assert.equal(r.art, 'bilder_defekt');
  assert.equal(r.defekt.length, 3);
  assert.equal(g.aufrufe.length, 0);
});

test('keine Namer-Fotos → ohne_bild; Fotos weg (404) → bilder_fehlen; beides ohne Aufruf', async () => {
  const g = gemini([ANTWORT]);
  const ohne = await leseEinreichung({ images: { zutaten: 'x' }, ladeBild: speicher({}).ladeBild, lese: g.lese });
  assert.equal(ohne.art, 'ohne_bild');
  const weg = await leseEinreichung({ images: { front: 'a', preis: 'b' }, ladeBild: speicher({ a: null, b: null }).ladeBild, lese: g.lese });
  assert.equal(weg.art, 'bilder_fehlen');
  assert.equal(g.aufrufe.length, 0);
});

test('Ladefehler → vorübergehender Fehler (Nachlauf), kein Aufruf mit halben Fotos, keine weiteren Downloads', async () => {
  const g = gemini([ANTWORT]);
  const s = speicher({ 'p/preis.jpg': new Error('socket hang up') });
  const r = await leseEinreichung({ images: BILDER, ladeBild: s.ladeBild, lese: g.lese });
  assert.equal(r.art, 'fehler');
  assert.equal(r.fehler.voruebergehend, true);
  assert.match(r.fehler.message, /bild_download_fehlgeschlagen \(preis\)/);
  assert.equal(g.aufrufe.length, 0);
  assert.deepEqual(s.geladen, ['p/front.jpg', 'p/preis.jpg']);
});

test('Dekodierfehler trotz Prüfung → ohne hersteller erneut (Rückseite als Ersatz), Schuldiger vermerkt', async () => {
  const g = gemini([DEKODIER_400(), ANTWORT]);
  const r = await leseEinreichung({ images: BILDER, ladeBild: speicher({}).ladeBild, lese: g.lese });
  assert.equal(r.art, 'gelesen');
  assert.equal(g.aufrufe.length, 2);
  assert.deepEqual(g.aufrufe[1].opts, { versuche: 1 });
  assert.deepEqual(r.gesendet, ['front', 'preis', 'rueckseite']);
  assert.deepEqual(r.defekt.map((d) => [d.slot, d.grund]), [['hersteller', 'nicht_dekodierbar']]);
  assert.equal(r.versuche, 2);
});

test('Dekodierfehler, Schuldiger ist preis → zweiter Rückfall ohne preis (mit hersteller)', async () => {
  const g = gemini([DEKODIER_400(), DEKODIER_400(), ANTWORT]);
  const r = await leseEinreichung({ images: { front: 'f', preis: 'p', hersteller: 'h' }, ladeBild: speicher({}).ladeBild, lese: g.lese });
  assert.equal(r.art, 'gelesen');
  assert.deepEqual(g.aufrufe.map((a) => a.slots.length), [3, 2, 2]);
  assert.deepEqual(r.gesendet, ['front', 'hersteller']);
  assert.deepEqual(r.defekt.map((d) => d.slot), ['preis']);
});

test('Dekodierfehler bleibt → höchstens 2 Zusatzaufrufe, endgültig (kein Nachlauf)', async () => {
  const g = gemini([DEKODIER_400()]);
  const r = await leseEinreichung({ images: BILDER, ladeBild: speicher({}).ladeBild, lese: g.lese });
  assert.equal(r.art, 'fehler');
  assert.equal(g.aufrufe.length, 3);
  assert.equal(r.fehler.voruebergehend, false);
  assert.match(r.fehler.message, /^bild_nicht_dekodierbar/);
});

test('Dekodierfehler bei nur einem Foto → kein Rückfall möglich, endgültig', async () => {
  const g = gemini([DEKODIER_400()]);
  const r = await leseEinreichung({ images: { front: 'f' }, ladeBild: speicher({}).ladeBild, lese: g.lese });
  assert.equal(r.art, 'fehler');
  assert.equal(g.aufrufe.length, 1);
  assert.equal(r.fehler.voruebergehend, false);
});

test('im Rückfall ein 429 → vorübergehender Fehler, kein Defekt vermerkt', async () => {
  const g = gemini([DEKODIER_400(), Object.assign(new Error('Resource exhausted'), { status: 429 })]);
  const r = await leseEinreichung({ images: BILDER, ladeBild: speicher({}).ladeBild, lese: g.lese });
  assert.equal(r.art, 'fehler');
  assert.equal(r.fehler.status, 429);
  assert.deepEqual(r.defekt, []);
});

test('gewöhnlicher Fehler (429 nach allen Versuchen) → kein Rückfall', async () => {
  const g = gemini([Object.assign(new Error('Resource exhausted'), { status: 429, versuche: 3 })]);
  const r = await leseEinreichung({ images: BILDER, ladeBild: speicher({}).ladeBild, lese: g.lese });
  assert.equal(r.art, 'fehler');
  assert.equal(g.aufrufe.length, 1);
  assert.equal(r.versuche, 3);
});
