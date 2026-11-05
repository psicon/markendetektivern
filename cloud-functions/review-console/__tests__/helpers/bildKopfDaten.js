'use strict';
/**
 * Kleine, gültige Bildköpfe für die Tests der Bildschirm-Regel
 * (src/preisBildschirm.js bildKopf) — PNG mit IHDR, JPEG mit SOF0 und
 * optional EXIF. Nur der Anfang der Datei, wie ihn die Runde liest.
 */

/**
 * TIFF-Block (ohne „Exif\0\0") mit den gewünschten Einträgen.
 * @param {{ifd0?:Array<{tag:number, text?:string, kurz?:number}>, exif?:Array<{tag:number, text?:string, kurz?:number}>|null, bigEndian?:boolean}} o
 *   `exif`: Einträge im EXIF-Unterverzeichnis (Zeiger 0x8769 in IFD0); `text` = ASCII, `kurz` = SHORT.
 */
function tiffBlock({ ifd0 = [], exif = null, bigEndian = false } = {}) {
  const w16 = (b, v, p) => (bigEndian ? b.writeUInt16BE(v, p) : b.writeUInt16LE(v, p));
  const w32 = (b, v, p) => (bigEndian ? b.writeUInt32BE(v, p) : b.writeUInt32LE(v, p));
  const groesse = (liste) => 2 + liste.length * 12 + 4;
  const daten = (e) => (e.text != null ? Buffer.from(`${e.text}\0`, 'latin1') : null);
  const sortiert = (liste) => [...liste].sort((a, b) => a.tag - b.tag);
  const l0 = sortiert([...ifd0, ...(exif ? [{ tag: 0x8769, zeiger: true }] : [])]);
  const lx = exif ? sortiert(exif) : [];
  let off = 8;
  const ifd0Off = off; off += groesse(l0);
  const platz = (liste) => liste.map((e) => { const d = daten(e); if (d && d.length > 4) { const o = off; off += d.length; return o; } return null; });
  const d0 = platz(l0);
  const exifOff = exif ? off : null;
  if (exif) off += groesse(lx);
  const dx = platz(lx);
  const b = Buffer.alloc(off);
  b.write(bigEndian ? 'MM' : 'II', 0, 'ascii');
  w16(b, 42, 2); w32(b, ifd0Off, 4);
  const schreibe = (liste, start, dOff) => {
    w16(b, liste.length, start);
    liste.forEach((e, i) => {
      const p = start + 2 + i * 12;
      w16(b, e.tag, p);
      if (e.zeiger) { w16(b, 4, p + 2); w32(b, 1, p + 4); w32(b, exifOff, p + 8); return; }
      const d = daten(e);
      if (d) {
        w16(b, 2, p + 2); w32(b, d.length, p + 4);
        if (d.length > 4) { w32(b, dOff[i], p + 8); d.copy(b, dOff[i]); } else d.copy(b, p + 8);
        return;
      }
      w16(b, 3, p + 2); w32(b, 1, p + 4); w16(b, e.kurz || 0, p + 8);
    });
    w32(b, 0, start + 2 + liste.length * 12);
  };
  schreibe(l0, ifd0Off, d0);
  if (exif) schreibe(lx, exifOff, dx);
  return b;
}

const EXIF_KENNUNG = Buffer.from('Exif\0\0', 'latin1');

/** EXIF-Block mit genau einem Eintrag Make in IFD0. */
function exifMitHersteller(hersteller, { bigEndian = false } = {}) {
  return Buffer.concat([EXIF_KENNUNG, tiffBlock({ ifd0: [{ tag: 0x010f, text: hersteller }], bigEndian })]);
}

/**
 * Typische EXIF-Inhalte, wie sie an echten Preisfotos gemessen wurden
 * (Prüfrunde 2, 04.10.2026; Tag-Listen, keine echten Bytes):
 *  - iosAppKamera: Ausrichtung, Auflösung, EXIF-Zeiger mit Pixelmaßen —
 *    kein Datum, keine Software (49 von 294 App-Kamera-Fotos),
 *  - androidBildschirm: Software „Android …", Datum, Aufnahmedatum, ohne Make,
 *  - zugeschnitten: Datum und Aufnahmedatum, ohne Make und Software,
 *  - kamera: Make, Datum, Aufnahmedatum.
 */
const EXIF = Object.freeze({
  iosAppKamera: { ifd0: [{ tag: 0x0112, kurz: 1 }, { tag: 0x0128, kurz: 2 }], exif: [{ tag: 0xa002, kurz: 3024 }, { tag: 0xa003, kurz: 4032 }] },
  androidBildschirm: { ifd0: [{ tag: 0x0131, text: 'Android BP2A.250605.031.A3' }, { tag: 0x0132, text: '2026:08:29 10:33:00' }], exif: [{ tag: 0x9003, text: '2026:08:29 10:33:00' }] },
  zugeschnitten: { ifd0: [{ tag: 0x0112, kurz: 1 }, { tag: 0x0132, text: '2026:08:30 07:34:34' }], exif: [{ tag: 0x9003, text: '2026:08:30 07:34:34' }, { tag: 0xa002, kurz: 446 }] },
  kamera: { ifd0: [{ tag: 0x010f, text: 'samsung' }, { tag: 0x0132, text: '2026:08:30 07:34:34' }], exif: [{ tag: 0x9003, text: '2026:08:30 07:34:34' }] },
});

function png(breite, hoehe, { exif = null } = {}) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(breite, 16);
  b.writeUInt32BE(hoehe, 20);
  if (!exif) return b;
  // eXIf-Abschnitt (roher TIFF-Block) hinter IHDR, CRC als Platzhalter.
  const t = tiffBlock(exif);
  const kopf = Buffer.alloc(8);
  kopf.writeUInt32BE(t.length, 0); kopf.write('eXIf', 4, 'ascii');
  return Buffer.concat([b, kopf, t, Buffer.alloc(4)]);
}

function segment(marker, inhalt) {
  const kopf = Buffer.alloc(4);
  kopf[0] = 0xff; kopf[1] = marker; kopf.writeUInt16BE(inhalt.length + 2, 2);
  return Buffer.concat([kopf, inhalt]);
}

/**
 * JPEG-Anfang: SOI, optional APP1 mit EXIF (nur Hersteller oder ein Satz aus
 * EXIF), optional ein großer APP2 (schiebt SOF nach hinten), SOF0 mit Maßen.
 * `bisSof: false` lässt SOF weg (abgeschnittener Kopf).
 */
function jpeg(breite, hoehe, { hersteller = null, exif = null, bigEndian = false, fuellBytes = 0, bisSof = true } = {}) {
  const teile = [Buffer.from([0xff, 0xd8])];
  if (hersteller) teile.push(segment(0xe1, exifMitHersteller(hersteller, { bigEndian })));
  else if (exif) teile.push(segment(0xe1, Buffer.concat([EXIF_KENNUNG, tiffBlock({ ...exif, bigEndian })])));
  if (fuellBytes) teile.push(segment(0xe2, Buffer.alloc(fuellBytes)));
  if (bisSof) {
    const sof = Buffer.alloc(15);
    sof[0] = 8; sof.writeUInt16BE(hoehe, 1); sof.writeUInt16BE(breite, 3); sof[5] = 3;
    teile.push(segment(0xc0, sof));
  }
  return Buffer.concat(teile);
}

module.exports = { png, jpeg, exifMitHersteller, tiffBlock, EXIF };
