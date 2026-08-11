'use strict';

/**
 * Liest GPS und Aufnahmezeit aus den hochgeladenen Bildern.
 *
 * ERWARTUNGSHALTUNG: Das findet fast nie etwas — und das ist bekannt, kein
 * Defekt. Ein Vollscan über alle 2.086 Bilder (11.08.2026) fand GPS in
 * 10 Bildern aus 4 Dokumenten (0,48 %). Grund: `takePictureAsync` läuft
 * ohne `exif: true`, und auf iOS gehen 6 der 7 Aufnahmen über den nativen
 * BonScanner, der jedes Bild aus rohen Pixeln neu kodiert und dabei jeden
 * Metadaten-Container verwirft. Was überhaupt EXIF trägt, kommt praktisch
 * ausschließlich aus dem Galerie-Import — dort reicht expo-image-picker
 * bei quality 1 die Originalbytes durch.
 *
 * Trotzdem lohnt sich der Aufruf: Diese wenigen Treffer sind die EINZIGE
 * Ground Truth, an der sich die übrigen Signale überhaupt messen lassen.
 * Genau an ihnen wurde belegt, dass die IP-Ortung 61–377 km danebenliegt.
 *
 * `DateTimeOriginal` ist dabei fast wichtiger als die Koordinate: nur damit
 * lässt sich „frisch im Laden aufgenommen" von „aus der Galerie gesucht"
 * unterscheiden. Eines der vier Fundstücke war 10,8 Tage alt — ohne diese
 * Prüfung würde es einen falschen Einreichungsort behaupten.
 *
 * KOSTEN: Ein Range-Read der ersten 32 KB genügt. Alle im Vollscan
 * gefundenen APP1-Segmente lagen in den ersten 24 KB, während die Dateien
 * im Mittel 2,7 MB groß sind — das spart rund 99 % des Transfers.
 */

const exifr = require('exifr');

/** Nur der Anfang der Datei; dort steht der APP1/Exif-Block. */
const RANGE_BYTES = 32 * 1024;

/**
 * Genauigkeitsangabe des Geräts, falls vorhanden. Ohne Angabe wird ein
 * konservativer Wert angenommen — ein Foto-GPS liegt praktisch nie unter
 * ~10 m, aber wir behaupten lieber zu wenig als zu viel.
 */
const EXIF_DEFAULT_ACCURACY_M = 25;

/**
 * @param {import('@google-cloud/storage').Bucket} bucket
 * @param {string[]} pfade Storage-Pfade der Bilder dieser Einreichung.
 * @param {(m: string, d?: object) => void} log
 * @returns {Promise<{lat,lon,accuracyM,takenAtMs,pfad}|null>}
 */
async function findeExifGps(bucket, pfade, log = () => {}) {
  const treffer = [];

  for (const pfad of pfade) {
    try {
      const [buf] = await bucket.file(pfad).download({ start: 0, end: RANGE_BYTES - 1 });
      const daten = await exifr.parse(buf, {
        gps: true,
        // DateTimeOriginal steht im ExifIFD, DateTime im IFD0. Beide
        // mitnehmen — Galerie-Bilder tragen mal das eine, mal das andere.
        pick: ['DateTimeOriginal', 'DateTime', 'GPSHPositioningError', 'Make'],
      });
      if (!daten) continue;

      const lat = daten.latitude;
      const lon = daten.longitude;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;

      const aufnahme = daten.DateTimeOriginal || daten.DateTime || null;
      treffer.push({
        pfad,
        lat,
        lon,
        accuracyM:
          typeof daten.GPSHPositioningError === 'number'
            ? daten.GPSHPositioningError
            : EXIF_DEFAULT_ACCURACY_M,
        takenAtMs: aufnahme instanceof Date ? aufnahme.getTime() : null,
      });
    } catch (e) {
      // Ein unlesbares Bild darf die Bewertung nicht kippen — es ist eines
      // von mehreren Signalen, kein Pflichtbestandteil.
      log('exif_read_failed', { pfad, error: e.message });
    }
  }

  if (treffer.length === 0) return null;

  // Mehrere GPS-Bilder: das mit der besten gemeldeten Genauigkeit gewinnt.
  // Liegen sie weit auseinander, fällt das später im Scorer als Konflikt
  // auf — hier wird nicht gemittelt.
  treffer.sort((a, b) => a.accuracyM - b.accuracyM);
  return { ...treffer[0], anzahlTreffer: treffer.length };
}

module.exports = { findeExifGps, RANGE_BYTES, EXIF_DEFAULT_ACCURACY_M };
