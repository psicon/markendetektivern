'use strict';

/**
 * Ist ein hochgeladenes Foto vollständig? Strukturprüfung vor dem Gemini-Aufruf.
 *
 * Anlass (25.09.2026): 3 von 5.628 Produktfotos waren abgeschnitten, alle
 * genau 2^n Byte groß (512 KiB bzw. 1 MiB), ohne Bildende. Ein einziges
 * solches Foto ließ den ganzen Aufruf mit 400 „Failed to decode image data"
 * scheitern — Name, Preis und Hersteller blieben leer, obwohl die übrigen
 * Fotos einwandfrei waren.
 *
 * Bewusst NICHT verwendet (gemessen an denselben 5.628 Bildern):
 *  - „endet auf FFD9": 96 gesunde Bilder enden anders — 89 tragen einen
 *    Anhang hinter dem Bildende (Samsung SEFT/MPF, bis 492 KB), 13 sind PNG,
 *    die die App fest als image/jpeg hochlädt.
 *  - „Größe ist 2^n": trifft die bisherigen Fälle, ist aber kein Beweis.
 *    Nur als Hinweis (`zweierPotenz`) fürs Log.
 *
 * Grundsatz: defekt nur bei eindeutigem Befund. Ein fälschlich verworfenes
 * Foto kostet eine Lesung, ein unbekannter Dateityp wird deshalb
 * durchgelassen (bisheriges Verhalten).
 */

/** Bisheriger fester Typ — für alles, was nicht eindeutig PNG ist. */
const STANDARD_MIME = 'image/jpeg';
const PNG_SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EOI = Buffer.from([0xff, 0xd9]);

const istZweierPotenz = (n) => n > 0 && (n & (n - 1)) === 0;

/**
 * JPEG: Segmente anhand ihrer Längenfelder bis zum ersten Scan (SOS) laufen,
 * danach muss ein Bildende (FFD9) folgen. Im komprimierten Scan-Teil ist
 * FFD9 ausgeschlossen (jedes FF dort ist FF00 oder ein RST-Marker), ein
 * EXIF-Vorschaubild liegt innerhalb eines übersprungenen APP-Segments —
 * das erste FFD9 hinter dem Scan-Beginn ist also das echte Bildende. Was
 * danach kommt (Samsung-Anhang, zweites Bild), stört keinen Decoder.
 */
function pruefeJpeg(buf) {
  let off = 2;
  while (off < buf.length) {
    if (buf[off] !== 0xff) {
      // Fremdbytes vor einem Marker überspringt auch libjpeg (nur Warnung).
      off++;
      continue;
    }
    // Füllbytes FF FF … vor dem eigentlichen Marker.
    let m = off + 1;
    while (m < buf.length && buf[m] === 0xff) m++;
    if (m >= buf.length) break;
    const marker = buf[m];
    off = m + 1;
    // Marker ohne Längenfeld: TEM, RST0–7, SOI.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0x00) continue; // kein Marker (FF00), nur weiterlesen
    if (marker === 0xd9) return { ok: false, grund: 'jpeg_ende_vor_scan' };
    if (off + 2 > buf.length) break;
    const laenge = buf.readUInt16BE(off);
    if (laenge < 2) return { ok: false, grund: 'jpeg_segmentlaenge_ungueltig' };
    if (marker === 0xda) {
      return buf.indexOf(EOI, off + laenge) >= 0 ? { ok: true, grund: null } : { ok: false, grund: 'jpeg_ohne_bildende' };
    }
    if (off + laenge > buf.length) break;
    off += laenge;
  }
  return { ok: false, grund: 'jpeg_abgeschnitten_vor_scan' };
}

/** PNG: Chunks anhand ihrer Längen bis IEND; ein Chunk über das Dateiende hinaus = abgeschnitten. */
function pruefePng(buf) {
  let off = PNG_SIGNATUR.length;
  while (off + 8 <= buf.length) {
    const laenge = buf.readUInt32BE(off);
    const typ = buf.toString('latin1', off + 4, off + 8);
    const ende = off + 12 + laenge; // Länge + Typ + Daten + CRC
    if (ende > buf.length) return { ok: false, grund: 'png_abgeschnitten' };
    if (typ === 'IEND') return { ok: true, grund: null };
    off = ende;
  }
  return { ok: false, grund: 'png_ohne_iend' };
}

/**
 * @param {Buffer} buf vollständiger Dateiinhalt
 * @returns {{typ: 'jpeg'|'png'|'unbekannt', ok: boolean, grund: string|null,
 *   mimeType: string, groesse: number, zweierPotenz: boolean}}
 */
function bildPruefen(buf) {
  const groesse = buf ? buf.length : 0;
  const basis = { groesse, zweierPotenz: istZweierPotenz(groesse) };
  if (!groesse) return { ...basis, typ: 'unbekannt', ok: false, grund: 'leer', mimeType: STANDARD_MIME };
  if (groesse >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ...basis, typ: 'jpeg', mimeType: 'image/jpeg', ...pruefeJpeg(buf) };
  }
  if (groesse >= PNG_SIGNATUR.length && buf.subarray(0, PNG_SIGNATUR.length).equals(PNG_SIGNATUR)) {
    return { ...basis, typ: 'png', mimeType: 'image/png', ...pruefePng(buf) };
  }
  return { ...basis, typ: 'unbekannt', ok: true, grund: null, mimeType: STANDARD_MIME };
}

module.exports = { bildPruefen, STANDARD_MIME };
