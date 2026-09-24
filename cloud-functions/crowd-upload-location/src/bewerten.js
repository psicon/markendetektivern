'use strict';

/**
 * Dokument → probableLocation, als reine Funktion.
 *
 * Genutzt von BEIDEN Triggern (index.js) und vom Backfill-Skript
 * (`.backfill-ploc-v2.js`). Eine zweite, handgeschriebene Kopie der Eingaben
 * im Skript würde früher oder später still abweichen — dann bewertete der
 * Bestand anders als der laufende Betrieb.
 *
 * `zusatz` trägt, was nur der Anlage-Trigger kennt (rekonstruierte
 * IP-Ortung, Profil, EXIF, Aufnahmezeit); fehlt es, kommen die Werte aus
 * dem Dokument, wo der Anlage-Trigger sie als Nachtrag abgelegt hat.
 */

const { bewerteLocation, landAusKoordinate } = require('./scorer');
const { bonAdresseAusDoc } = require('./bonAdresse');

const zeitMs = (t) => (t && typeof t.toDate === 'function' ? t.toDate().getTime() : null);

/** Minuten zwischen zwei Zeitpunkten, gerundet. */
const minutenZwischen = (aMs, bMs) =>
  aMs == null || bMs == null ? null : Math.round(Math.abs(aMs - bMs) / 60000);

/**
 * Landeszuordnung der IP-Ortung. Die Stadt ist wertlos, das Land war in
 * allen vier Ground-Truth-Fällen korrekt — also wird genau das und nicht
 * mehr daraus abgeleitet. Die Boxen liegen in `scorer.landAusKoordinate`.
 */
function landAusIpOrtung(loc) {
  const { lat, lon } = loc || {};
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  // Der DACH-Fallback (51.15/10.45) ist kein Ort und darf auch kein Land
  // begründen — er steht genau dann im Feld, wenn die IP-Abfrage scheiterte.
  if (Math.abs(lat - 51.15) < 0.01 && Math.abs(lon - 10.45) < 0.01) return null;
  return landAusKoordinate(lat, lon);
}

/**
 * @param {object} doc     crowd_uploads-Dokument (frischer Stand)
 * @param {object} zusatz  {ipLocation?, profileRegion?, exifGps?, capturedAtMs?}
 * @param {object} plz     PLZ-Tabelle (data/plz.json)
 * @param {number} [jetztMs] nur für Tests
 * @returns {{probableLocation: object, resolvedBy: 'client'|'server'}}
 */
function bewerteDokument(doc, zusatz, plz, jetztMs = Date.now()) {
  const z = zusatz || {};
  const createdMs = zeitMs(doc.createdAt);
  const capturedAtMs = z.capturedAtMs ?? zeitMs(doc.capture?.capturedAt) ?? createdMs ?? jetztMs;
  const ipLocation = z.ipLocation ?? doc.journeyLocation ?? null;
  const profileRegion = z.profileRegion ?? doc.userLocation ?? null;
  const exifGps = z.exifGps
    ?? (doc.exifGps && typeof doc.exifGps.lat === 'number'
      ? { lat: doc.exifGps.lat, lon: doc.exifGps.lon, accuracyM: doc.exifGps.accuracyM ?? null, ageMinutes: doc.exifGps.ageMinutes ?? null }
      : null);
  const captureGps = doc.capture?.gps
    ? {
        lat: doc.capture.gps.lat,
        lon: doc.capture.gps.lon,
        accuracyM: doc.capture.gps.accuracyM ?? null,
        ageMinutes: minutenZwischen(zeitMs(doc.capture.gps.fixAt) ?? capturedAtMs, capturedAtMs),
      }
    : null;

  const probableLocation = bewerteLocation({
    submittedAtMs: createdMs ?? jetztMs,
    receiptAddress: bonAdresseAusDoc(doc, plz),
    captureGps,
    exifGps,
    confirmedPlace: doc.capture?.confirmedPlace ?? null,
    profileRegion,
    marketLand: doc.marketLand ?? null,
    ipLand: ipLocation?.source === 'ip' ? landAusIpOrtung(ipLocation) : null,
    ipLocation,
  });
  return {
    probableLocation,
    resolvedBy: doc.capture?.gps || doc.capture?.confirmedPlace ? 'client' : 'server',
  };
}

module.exports = { bewerteDokument, landAusIpOrtung, minutenZwischen };
