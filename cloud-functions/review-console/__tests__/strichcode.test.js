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
const { liesBild, bildPruefen, dekodierBytes, nummernAus, mitZeit, LESER, LESE_OPTIONEN, MAX_PIXEL, MAX_DEKODIER_BYTES, BILD_FORMATE } = require('../src/strichcode');

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
      { isValid: true, format: 'QRCode', text: '4000417025005' }, // falsches Format
    ])).toEqual({ gelesen: ['4061464833821', '0036000291452'] });
    expect(nummernAus([
      { isValid: true, format: 'EAN-13', text: '4061464833828' }, // Prüfziffer falsch
      { isValid: false, format: 'EAN-8', text: '96385074' },
    ])).toEqual({ gelesen: [] });
    expect(nummernAus([])).toEqual({ gelesen: [] });
  });
  it('Treffergrenze erreicht (`maxNumberOfSymbols`) → `voll`: weitere Codes, auch die gespeicherte Nummer, können fehlen', () => {
    expect(LESE_OPTIONEN.maxNumberOfSymbols).toBe(4);
    const t = (text, format = 'EAN-13') => ({ isValid: true, format, text });
    // dieselbe GTIN viermal (etwa mehrere gleiche Etiketten) — zählt als voll, gelesen bleibt eine Nummer
    expect(nummernAus([t('4061464833821'), t('4061464833821'), t('4061464833821'), t('4061464833821')])).toEqual({ gelesen: ['4061464833821'], voll: true });
    expect(nummernAus([t('4061464833821'), t('4061464833821'), t('4061464833821')])).toEqual({ gelesen: ['4061464833821'] });
    // QR-Codes zählen nicht mit (anderes Format, nicht gesucht)
    expect(nummernAus([t('4061464833821'), t('4061464833821'), t('4061464833821'), t('x', 'QRCode')])).toEqual({ gelesen: ['4061464833821'] });
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

/**
 * Speicher hängt an der KODIERUNG, nicht an der Pixelzahl (Prüfrunde 2 zur
 * Barcode-Korrektur, 06.10.2026): ein progressives CMYK-JPEG mit 64 MP trieb
 * den Leser auf 952 MB, ein PNG mit 16 Bit RGBA interlaced auf 1,4 GB — beide
 * unter 8 MB groß und unter der Pixelgrenze.
 */
describe('bildPruefen / dekodierBytes: Dekodier-Speicher aus dem Dateikopf geschätzt', () => {
  const zlib = require('zlib');
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
  const pngMitKopf = (buf, breite, hoehe) => {
    const b = Buffer.from(buf);
    b.writeUInt32BE(breite, 16);
    b.writeUInt32BE(hoehe, 20);
    b.writeUInt32BE(zlib.crc32(b.subarray(12, 29)), 29);
    return b;
  };
  const MB = 1000 * 1000;

  it('Grenze 320 MB; Schätzung je Kodierung (über allen gemessenen Werten)', () => {
    expect(MAX_DEKODIER_BYTES).toBe(320 * MB);
    const px = (b, h) => ({ width: b, height: h });
    // JPEG: (B+16)(H+16) × (Kanäle × 1,25 bzw. progressiv 3,75 + 1)
    expect(dekodierBytes({ format: 'jpeg', channels: 3, isProgressive: false, ...px(984, 984) })).toBe(1000 * 1000 * 4.75);
    expect(dekodierBytes({ format: 'jpeg', channels: 4, isProgressive: true, ...px(984, 984) })).toBe(1000 * 1000 * 16);
    // fehlende Angaben zählen wie die teuerste Variante
    expect(dekodierBytes({ format: 'jpeg', channels: 3, ...px(984, 984) })).toBe(1000 * 1000 * 12.25);
    expect(dekodierBytes({ format: 'jpeg', isProgressive: false, ...px(984, 984) })).toBe(1000 * 1000 * 6);
    // PNG: (B·H + H) × (4,5 × Kanäle × Byte je Wert + 2)
    expect(dekodierBytes({ format: 'png', channels: 4, depth: 'ushort', ...px(1000, 1000) })).toBe(1001000 * 38);
    expect(dekodierBytes({ format: 'png', channels: 3, depth: 'uchar', ...px(1000, 1000) })).toBe(1001000 * 15.5);
    expect(dekodierBytes({ format: 'png', channels: 3, ...px(1000, 1000) })).toBe(1001000 * 29); // Bittiefe unbekannt → 16 Bit
    // anderes Format oder keine Abmessungen → unendlich (nie dekodiert)
    expect(dekodierBytes({ format: 'webp', channels: 3, ...px(10, 10) })).toBe(Infinity);
    expect(dekodierBytes({ format: 'jpeg', channels: 3 })).toBe(Infinity);
    expect(dekodierBytes(null)).toBe(Infinity);
    // Das größte Barcode-Foto in Produktion (48 MP, baseline 4:2:0) und ein baseline-JPEG mit 64 MP bleiben darunter
    expect(dekodierBytes({ format: 'jpeg', channels: 3, isProgressive: false, ...px(6000, 8000) })).toBeLessThan(MAX_DEKODIER_BYTES);
    expect(dekodierBytes({ format: 'jpeg', channels: 3, isProgressive: false, ...px(8000, 8000) })).toBeLessThanOrEqual(MAX_DEKODIER_BYTES);
  });

  it('progressives JPEG mit 8000 × 8000 im Kopf → bild_zu_aufwendig, entschieden allein aus dem Kopf; 4000 × 4000 geht', async () => {
    const klein = await sharp(await png('4061464833821', 'EAN-13')).flatten({ background: '#ffffff' }).jpeg({ progressive: true, chromaSubsampling: '4:4:4' }).toBuffer();
    expect((await sharp(klein).metadata()).isProgressive).toBe(true);
    expect(await liesBild(jpegMitKopf(klein, 8000, 8000))).toEqual({ fehler: 'bild_zu_aufwendig: 8000x8000 jpeg progressiv 3K, ~787 MB' });
    expect(await bildPruefen(jpegMitKopf(klein, 4000, 4000))).toBeNull();
    // baseline mit denselben Abmessungen bleibt erlaubt (Grenze wie bisher die Pixelzahl)
    const baseline = await sharp(await png('4061464833821', 'EAN-13')).flatten({ background: '#ffffff' }).jpeg().toBuffer();
    expect(await bildPruefen(jpegMitKopf(baseline, 8000, 8000))).toBeNull();
  }, 30000);

  it('PNG mit 16 Bit RGBA und 4000 × 4000 im Kopf → bild_zu_aufwendig; 2000 × 2000 geht', async () => {
    const rgba16 = await sharp(await png('4061464833821', 'EAN-13')).ensureAlpha().toColourspace('rgb16').png().toBuffer();
    expect(await sharp(rgba16).metadata()).toMatchObject({ format: 'png', channels: 4, depth: 'ushort' });
    expect(await liesBild(pngMitKopf(rgba16, 4000, 4000))).toEqual({ fehler: 'bild_zu_aufwendig: 4000x4000 png 4K 16bit, ~608 MB' });
    expect(await bildPruefen(pngMitKopf(rgba16, 2000, 2000))).toBeNull();
  }, 30000);

  it('kleine Bilder jeder Kodierung werden weiter gelesen (progressiv, CMYK, 16 Bit, interlaced)', async () => {
    const quelle = await sharp(await png('4000417025005', 'EAN-13')).flatten({ background: '#ffffff' }).toBuffer();
    expect(await liesBild(await sharp(quelle).jpeg({ progressive: true }).toBuffer())).toEqual({ gelesen: ['4000417025005'] });
    expect(await liesBild(await sharp(quelle).toColourspace('cmyk').jpeg().toBuffer())).toEqual({ gelesen: ['4000417025005'] });
    expect(await liesBild(await sharp(quelle).toColourspace('rgb16').png({ progressive: true }).toBuffer())).toEqual({ gelesen: ['4000417025005'] });
  }, 30000);

  it('Schätzung liegt über dem tatsächlichen Wachstum des WASM-Speichers (Gegenprobe mit dem echten Leser)', async () => {
    // Leser laden (aus dem Paket), dann das Modul ohne neue Einstellungen holen: dieselbe Instanz.
    await liesBild(await png('4000417025005', 'EAN-13'));
    const zx = require('zxing-wasm/reader');
    const modul = await zx.prepareZXingModule({ fireImmediately: true });
    const groesse = () => modul.HEAPU8.buffer.byteLength;
    const quelle = await sharp(await png('4000417025005', 'EAN-13')).flatten({ background: '#ffffff' }).toBuffer();
    const flaeche = (b, h, ch = 3) => sharp({ create: { width: b, height: h, channels: ch, background: ch === 4 ? { r: 255, g: 255, b: 255, alpha: 1 } : '#ffffff' } }).composite([{ input: quelle, gravity: 'centre' }]);
    // die beiden teuersten Kodierungen je Pixel (gemessen 12,8 bzw. 33 Byte je Pixel)
    // (das zweite Bild braucht mehr als das erste, sonst wüchse der Speicher nicht und die Probe wäre leer)
    const bilder = [
      await flaeche(1800, 2400).toColourspace('cmyk').jpeg({ progressive: true, chromaSubsampling: '4:4:4' }).toBuffer(),
      await flaeche(1500, 2000, 4).toColourspace('rgb16').png({ progressive: true }).toBuffer(),
    ];
    const basis = groesse();
    for (const bild of bilder) {
      const m = await sharp(bild).metadata();
      const vorher = groesse();
      expect(await liesBild(bild)).toEqual({ gelesen: ['4000417025005'] });
      // Der WASM-Speicher wächst (sonst sagte die Probe nichts) — aber nie über Grundbedarf + Schätzung.
      expect(groesse()).toBeGreaterThan(vorher);
      expect(groesse()).toBeLessThanOrEqual(basis + dekodierBytes(m));
    }
  }, 60000);
});
