'use strict';
/**
 * Fester Strichcode-Leser (src/strichcode.js) — Pflicht-Zeuge der
 * Barcode-Korrektur (Prüfrunde 06.10.2026). Mit dem ECHTEN Leser (WASM) auf
 * erzeugten Strichcodes: die Ausgabeform je Format ist das, worauf
 * werte.strichcodeUrteil vergleicht (UPC-A/UPC-E als 13-stellige GTIN).
 * Kein Netz: die WASM-Datei muss aus dem Paket kommen, nie vom CDN.
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { liesBild, bildPruefen, nummernAus, mitZeit, LESER, LESE_OPTIONEN, MAX_PIXEL, BILD_FORMATE } = require('../src/strichcode');

let schreiber;
const echtesFetch = global.fetch;

beforeAll(async () => {
  // Jeder Netzzugriff (CDN) wäre ein Fehler.
  global.fetch = () => { throw new Error('kein Netz im Test'); };
  schreiber = require('zxing-wasm/writer');
  await schreiber.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm')) }, fireImmediately: true });
}, 30000);
afterAll(() => { global.fetch = echtesFetch; });

/** Strichcode als PNG (Buffer). */
async function png(text, format) {
  const r = await schreiber.writeBarcode(text, { format, scale: 3 });
  if (r.error) throw new Error(r.error);
  return Buffer.from(await r.image.arrayBuffer());
}

describe('nummernAus (rein)', () => {
  it('nur gültige Treffer der vier Formate, mit Prüfziffer, je GTIN einmal', () => {
    expect(nummernAus([
      { isValid: true, format: 'EAN-13', text: '4061464833821' },
      { isValid: true, format: 'UPC-A', text: '0036000291452' },
      { isValid: true, format: 'EAN-13', text: '0036000291452' }, // dieselbe GTIN
      { isValid: true, format: 'EAN-13', text: '4061464833828' }, // Prüfziffer falsch
      { isValid: true, format: 'QRCode', text: '4000417025005' }, // falsches Format
      { isValid: false, format: 'EAN-8', text: '96385074' },
    ])).toEqual({ gelesen: ['4061464833821', '0036000291452'] });
    expect(nummernAus([])).toEqual({ gelesen: [] });
  });
  it('nicht dekodierbares Bild (Ergebnis mit `error`) → Fehler, kein „nichts gelesen"', () => {
    expect(nummernAus([{ isValid: false, format: 'None', text: '', error: 'Failed to load image from memory' }])).toEqual({ fehler: 'bild: Failed to load image from memory' });
    expect(nummernAus(null)).toEqual({ fehler: 'keine_antwort' });
  });
  it('Formatnamen MIT Bindestrich (gemessen: „EAN13" liefert stumm nichts), Version fest', () => {
    expect(LESE_OPTIONEN.formats).toEqual(['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E']);
    expect(LESER).toBe('zxing-wasm 2.2.4');
    // exakt gepinnt (package.json) und so installiert — die Ausgabe hängt an der Version
    expect(require('../package.json').dependencies['zxing-wasm']).toBe('2.2.4');
    const paket = path.join(path.dirname(require.resolve('zxing-wasm/reader')), '..', '..', '..', 'package.json');
    expect(JSON.parse(fs.readFileSync(paket, 'utf8'))).toMatchObject({ name: 'zxing-wasm', version: '2.2.4' });
  });
  it('mitZeit: Zeitgrenze → Fehler zeit_abgelaufen', async () => {
    await expect(mitZeit(new Promise(() => {}), 10)).rejects.toThrow('zeit_abgelaufen');
    await expect(mitZeit(Promise.resolve(7), 1000)).resolves.toBe(7);
  });
});

describe('liesBild (echter Leser, WASM aus dem Paket)', () => {
  it('EAN-13, EAN-8, UPC-A und UPC-E — UPC als 13-stellige GTIN', async () => {
    expect(await liesBild(await png('4061464833821', 'EAN-13'))).toEqual({ gelesen: ['4061464833821'] });
    expect(await liesBild(await png('96385074', 'EAN-8'))).toEqual({ gelesen: ['96385074'] });
    expect(await liesBild(await png('036000291452', 'UPC-A'))).toEqual({ gelesen: ['0036000291452'] });
    expect(await liesBild(await png('01234565', 'UPC-E'))).toEqual({ gelesen: ['0012345000065'] });
  }, 30000);

  it('JPEG (wie die Fotos der App) wird gelesen', async () => {
    const jpeg = await sharp(await png('4000417025005', 'EAN-13')).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    expect(jpeg[0]).toBe(0xff);
    expect(await liesBild(jpeg)).toEqual({ gelesen: ['4000417025005'] });
  }, 30000);

  it('keine Striche → leer (kein Fehler); kaputte oder leere Datei → Fehler; wirft nie', async () => {
    const weiss = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    expect(await liesBild(weiss)).toEqual({ gelesen: [] });
    // Kein Bildkopf lesbar → Fehler schon vor dem Leser (bildPruefen).
    expect(await liesBild(Buffer.from([1, 2, 3, 4, 5]))).toMatchObject({ fehler: expect.stringMatching(/^bildkopf: /) });
    expect(await liesBild(Buffer.alloc(0))).toEqual({ fehler: 'leere_datei' });
    expect(await liesBild(null)).toEqual({ fehler: 'leere_datei' });
  }, 30000);
});

/**
 * Obergrenze der Bildgröße (Prüfrunde 1 zur Barcode-Korrektur, 06.10.2026):
 * eine weiße Fläche mit 324 MP passt in 4,9 MB (unter die Upload-Grenze von
 * 8 MB) und trieb den Leser über 900 MB — zusammen mit der Runde über 1 GiB,
 * Cloud Run beendet die Instanz in Schritt 4c, jeden Morgen erneut.
 */
describe('bildPruefen / liesBild: zu große Bilder werden nie dekodiert', () => {
  /** JPEG mit gefälschten Abmessungen im Kopf (SOF0/SOF2) — der Inhalt bleibt klein. */
  const jpegMitKopf = (buf, breite, hoehe) => {
    const b = Buffer.from(buf);
    for (let i = 2; i + 9 < b.length; i++) {
      if (b[i] === 0xff && (b[i + 1] === 0xc0 || b[i + 1] === 0xc2)) {
        b.writeUInt16BE(hoehe, i + 5);
        b.writeUInt16BE(breite, i + 7);
        return b;
      }
    }
    throw new Error('kein SOF gefunden');
  };
  /** PNG mit gefälschten Abmessungen im IHDR (CRC neu berechnet, sonst wäre schon der Kopf kaputt). */
  const pngMitKopf = (buf, breite, hoehe) => {
    const b = Buffer.from(buf);
    expect(b.toString('latin1', 12, 16)).toBe('IHDR');
    b.writeUInt32BE(breite, 16);
    b.writeUInt32BE(hoehe, 20);
    b.writeUInt32BE(zlib.crc32(b.subarray(12, 29)), 29);
    return b;
  };
  const zlib = require('zlib');

  it('Grenze 64 MP, nur JPEG und PNG', () => {
    expect(MAX_PIXEL).toBe(64 * 1000 * 1000);
    expect(BILD_FORMATE).toEqual(['jpeg', 'png']);
  });

  it('JPEG mit 20000 × 20000 im Kopf → Fehler bild_zu_gross, entschieden allein aus dem Kopf', async () => {
    // Ein echtes Bild dieser Größe (4,1 MB) trieb den Leser auf 1.114 MB (gemessen
    // 06.10.2026). Hier nur der Kopf gefälscht: ohne die Prüfung käme „bild: …"
    // vom Leser zurück, mit ihr `bild_zu_gross` — der Leser sieht die Datei nie.
    const klein = await sharp(await png('4061464833821', 'EAN-13')).flatten({ background: '#ffffff' }).jpeg().toBuffer();
    const gross = jpegMitKopf(klein, 20000, 20000);
    expect((await sharp(gross, { limitInputPixels: false }).metadata())).toMatchObject({ width: 20000, height: 20000 });
    expect(await liesBild(gross)).toEqual({ fehler: 'bild_zu_gross: 20000x20000' });
    // knapp über der Grenze (8001 × 8000) ebenso, genau an der Grenze nicht
    expect(await bildPruefen(jpegMitKopf(klein, 8001, 8000))).toEqual({ fehler: 'bild_zu_gross: 8001x8000' });
    expect(await bildPruefen(jpegMitKopf(klein, 8000, 8000))).toBeNull();
  }, 30000);

  it('PNG mit 18000 × 18000 im Kopf → Fehler (PNG komprimiert eine Fläche genauso gut)', async () => {
    const gross = pngMitKopf(await png('4061464833821', 'EAN-13'), 18000, 18000);
    expect(await liesBild(gross)).toEqual({ fehler: 'bild_zu_gross: 18000x18000' });
  }, 30000);

  it('echtes Bild über einer (im Test kleinen) Grenze wird nicht gelesen, darunter schon', async () => {
    const jpeg = await sharp(await png('4000417025005', 'EAN-13')).flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    const { width, height } = await sharp(jpeg).metadata();
    expect(await liesBild(jpeg, { maxPixel: width * height - 1 })).toEqual({ fehler: `bild_zu_gross: ${width}x${height}` });
    expect(await liesBild(jpeg, { maxPixel: width * height })).toEqual({ gelesen: ['4000417025005'] });
  }, 30000);

  it('andere Formate (WebP, TIFF) → Fehler bildformat, nie an den Leser', async () => {
    const quelle = await png('4000417025005', 'EAN-13');
    expect(await liesBild(await sharp(quelle).webp().toBuffer())).toEqual({ fehler: 'bildformat: webp' });
    expect(await liesBild(await sharp(quelle).tiff().toBuffer())).toEqual({ fehler: 'bildformat: tiff' });
  }, 30000);
});
