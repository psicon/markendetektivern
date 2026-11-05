'use strict';

/**
 * Strukturprüfung der Fotos (src/bild.js). Synthetische Dateien, nachgebaut
 * nach den echten Fällen vom 25.09.2026: abgeschnitten bei genau 1 MiB,
 * Samsung-Anhang hinter dem Bildende, PNG unter image/jpeg.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { bildPruefen } = require('../src/bild');

const MiB = 1024 * 1024;

function segment(marker, nutzdaten) {
  const kopf = Buffer.alloc(4);
  kopf[0] = 0xff;
  kopf[1] = marker;
  kopf.writeUInt16BE(nutzdaten.length + 2, 2);
  return Buffer.concat([kopf, nutzdaten]);
}

/** Scan-Daten wie ein Encoder sie schreibt: jedes FF als FF00, dazwischen RST-Marker. */
function scanDaten(laenge, startwert = 7) {
  const out = [];
  let x = startwert;
  for (let i = 0; out.length < laenge; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    const b = (x >>> 16) & 0xff;
    out.push(b);
    if (b === 0xff) out.push(0x00);
    if (i > 0 && i % 50000 === 0) out.push(0xff, 0xd0 + ((i / 50000) % 8));
  }
  return Buffer.from(out);
}

/**
 * Vollständiges JPEG: SOI, APP1 mit eingebettetem Vorschaubild (enthält
 * selbst FFD8…FFD9 — darf NICHT als Bildende gelten), DQT, SOF0, DHT, SOS,
 * Scan-Daten, EOI.
 */
function jpeg({ scanLaenge = 1.3 * MiB, vorschau = true } = {}) {
  const vorschauBild = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x03, 0x01, 0xff, 0xd9]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), vorschau ? vorschauBild : Buffer.alloc(0), Buffer.alloc(200, 0x11)]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe1, exif),
    segment(0xdb, Buffer.alloc(65, 0x02)),
    segment(0xc0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    segment(0xc4, Buffer.alloc(30, 0x01)),
    segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    scanDaten(Math.floor(scanLaenge)),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function pngChunk(typ, daten) {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  return Buffer.concat([laenge, Buffer.from(typ, 'latin1'), daten, Buffer.alloc(4, 0xab)]);
}

function png({ idatLaenge = 1.2 * MiB } = {}) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.alloc(13, 1)),
    pngChunk('IDAT', scanDaten(Math.floor(idatLaenge), 3)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('vollständiges JPEG → ok, image/jpeg', () => {
  const r = bildPruefen(jpeg());
  assert.equal(r.typ, 'jpeg');
  assert.equal(r.ok, true);
  assert.equal(r.grund, null);
  assert.equal(r.mimeType, 'image/jpeg');
});

test('JPEG bei genau 1 MiB abgeschnitten → defekt, mit Größe und 2^n-Hinweis', () => {
  const r = bildPruefen(jpeg().subarray(0, MiB));
  assert.equal(r.ok, false);
  assert.equal(r.grund, 'jpeg_ohne_bildende');
  assert.equal(r.groesse, MiB);
  assert.equal(r.zweierPotenz, true);
});

test('abgeschnitten bei 512 KiB, mit Vorschaubild (FFD9 im EXIF-Teil) → trotzdem defekt', () => {
  const r = bildPruefen(jpeg({ vorschau: true }).subarray(0, 512 * 1024));
  assert.equal(r.ok, false);
  assert.equal(r.grund, 'jpeg_ohne_bildende');
});

test('abgeschnitten an beliebiger Stelle (kein 2^n) → defekt; die Größe entscheidet nicht', () => {
  const r = bildPruefen(jpeg().subarray(0, 777777));
  assert.equal(r.ok, false);
  assert.equal(r.zweierPotenz, false);
});

test('JPEG mit Samsung-Anhang hinter dem Bildende (endet NICHT auf FFD9) → ok', () => {
  const anhang = Buffer.concat([Buffer.from('SEFH', 'latin1'), Buffer.alloc(492 * 1024, 0x5a), Buffer.from('SEFT', 'latin1')]);
  const buf = Buffer.concat([jpeg(), anhang]);
  assert.notEqual(buf.subarray(-2).toString('hex'), 'ffd9');
  assert.equal(bildPruefen(buf).ok, true);
});

test('JPEG mit zweitem Bild hinter dem ersten (MPF) → ok', () => {
  assert.equal(bildPruefen(Buffer.concat([jpeg({ scanLaenge: 5000 }), jpeg({ scanLaenge: 3000 }).subarray(0, 1000)])).ok, true);
});

test('Füllbytes und Fremdbytes vor Markern werden wie von libjpeg toleriert', () => {
  const j = jpeg({ scanLaenge: 4000 });
  // Nach SOI zwei Füllbytes FF und drei Fremdbytes vor APP1 einschieben.
  const buf = Buffer.concat([j.subarray(0, 2), Buffer.from([0x00, 0x12, 0x34, 0xff, 0xff]), j.subarray(2)]);
  assert.equal(bildPruefen(buf).ok, true);
});

test('JPEG, das schon im Kopf abreißt (vor dem Scan) → defekt', () => {
  const r = bildPruefen(jpeg().subarray(0, 120));
  assert.equal(r.ok, false);
  assert.equal(r.grund, 'jpeg_abgeschnitten_vor_scan');
});

test('JPEG mit Bildende vor dem Scan → defekt', () => {
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xdb, Buffer.alloc(65, 2)), Buffer.from([0xff, 0xd9])]);
  assert.equal(bildPruefen(buf).grund, 'jpeg_ende_vor_scan');
});

test('PNG vollständig → ok, image/png (die App lädt PNG als image/jpeg hoch)', () => {
  const r = bildPruefen(png());
  assert.equal(r.typ, 'png');
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, 'image/png');
});

test('PNG mit Daten hinter IEND → ok', () => {
  assert.equal(bildPruefen(Buffer.concat([png({ idatLaenge: 1000 }), Buffer.alloc(50, 7)])).ok, true);
});

test('PNG bei 1 MiB abgeschnitten → defekt', () => {
  const r = bildPruefen(png().subarray(0, MiB));
  assert.equal(r.ok, false);
  assert.equal(r.grund, 'png_abgeschnitten');
  assert.equal(r.mimeType, 'image/png');
});

test('PNG genau an einer Chunk-Grenze ohne IEND abgeschnitten → defekt', () => {
  const p = png({ idatLaenge: 1000 });
  assert.equal(bildPruefen(p.subarray(0, p.length - 12)).grund, 'png_ohne_iend');
});

test('unbekannter Typ (z. B. HEIC) → durchlassen, bisheriger Typ image/jpeg', () => {
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(100)]);
  const r = bildPruefen(heic);
  assert.equal(r.typ, 'unbekannt');
  assert.equal(r.ok, true);
  assert.equal(r.mimeType, 'image/jpeg');
});

test('leere Datei → defekt', () => {
  assert.deepEqual(
    { ok: bildPruefen(Buffer.alloc(0)).ok, grund: bildPruefen(Buffer.alloc(0)).grund },
    { ok: false, grund: 'leer' },
  );
});
