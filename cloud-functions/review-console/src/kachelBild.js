'use strict';

/**
 * Bildseite der Vorschaukacheln (siehe kachel.js für die Signatur).
 *
 * Dieselbe Verarbeitung wie die abgelöste Extension — resize auf die Breite,
 * Höhe proportional, JPEG Qualität 72 —, mit zwei bewussten Abweichungen:
 *
 *  1. `.rotate()` richtet nach der EXIF-Orientierung aus. Die Extension tat
 *     das nicht und entfernte die EXIF-Angabe trotzdem — Kacheln von Fotos
 *     mit Orientierung 6 (3 von 19 Stichproben am 01.10.2026) lagen quer,
 *     während die Lupe (Original im Browser) sie aufrecht zeigte.
 *  2. `failOn: 'none'`: ein abgeschnittener Upload wird so weit angezeigt,
 *     wie er reicht, statt als kaputte Kachel zu enden. Genau diese Fälle
 *     soll der Prüfer sehen (Namer-Merker `bildDefekt`).
 */

const sharp = require('sharp');

// Jede Kachel ist ein anderes Bild; der libvips-Operations-Cache brächte
// nichts und hielte nur Speicher fest.
sharp.cache(false);

const QUALITAET = 72;
/** Client-Uploads sind per Storage-Rules < 8 MB; Luft für Altbestand. */
const MAX_EINGABE_BYTES = 20 * 1024 * 1024;

class KachelFehler extends Error {
  constructor(code, status, nachricht) {
    super(nachricht || code);
    this.code = code;
    this.status = status;
  }
}

/**
 * Storage-Objekt in den Speicher laden — mit Obergrenze, damit ein
 * unerwartet großes Objekt die Instanz nicht sprengt.
 * `datei` ist ein @google-cloud/storage File (nur createReadStream wird genutzt).
 */
function ladeBegrenzt(datei, maxBytes = MAX_EINGABE_BYTES) {
  return new Promise((resolve, reject) => {
    const teile = [];
    let laenge = 0;
    let erledigt = false;
    const fertig = (fn, wert) => { if (!erledigt) { erledigt = true; fn(wert); } };
    const strom = datei.createReadStream();
    strom.on('data', (chunk) => {
      if (erledigt) return;
      laenge += chunk.length;
      if (laenge > maxBytes) {
        fertig(reject, new KachelFehler('zu_gross', 413, `Objekt größer als ${maxBytes} Byte`));
        strom.destroy();
        return;
      }
      teile.push(chunk);
    });
    strom.on('end', () => fertig(resolve, Buffer.concat(teile, laenge)));
    strom.on('error', (e) => {
      const nichtDa = e && (e.code === 404 || e.code === '404' || /No such object/i.test(String(e.message)));
      fertig(reject, nichtDa
        ? new KachelFehler('nicht_gefunden', 404, 'Objekt nicht gefunden')
        : new KachelFehler('storage_fehler', 502, String((e && e.message) || e)));
    });
  });
}

/** Original → JPEG-Kachel der gegebenen Breite. */
async function rendereKachel(eingabe, breite) {
  try {
    return await sharp(eingabe, { failOn: 'none' })
      .rotate()
      .resize({ width: breite })
      .jpeg({ quality: QUALITAET })
      .toBuffer();
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/unsupported image format|Input buffer contains unsupported|corrupt header|Input buffer is empty/i.test(msg)) {
      throw new KachelFehler('kein_bild', 415, msg);
    }
    throw new KachelFehler('verarbeitung', 500, msg);
  }
}

module.exports = { ladeBegrenzt, rendereKachel, KachelFehler, QUALITAET, MAX_EINGABE_BYTES };
