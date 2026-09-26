'use strict';

/**
 * Geräte-Standort und App-Version, die die App beim Bon mitschickt (26.09.2026).
 *
 * Feldnamen 1:1 wie bei crowd_uploads (lib/services/productSubmit.ts
 * collectContext + submitProduct): `capture.gpsStatus`, `capture.gps
 * {lat, lon, accuracyM, fixAt}`, top-level `clientVersion {app, build, platform}`.
 * Keine neuen Feldnamen — ein verworfener Fix steht im vorhandenen Typfeld
 * `gpsError` (lib/services/captureContext.ts CaptureContext.gpsError).
 *
 * NICHT VERTRAUENSWÜRDIG: alles stammt vom Client. Diese Funktion
 *  - wirft nie (Zusatzdaten dürfen einen Bon nicht blockieren),
 *  - gibt nur Felder aus einer festen Liste zurück (kein Spread von Client-Objekten),
 *  - schreibt nichts, wenn die App nichts geschickt hat (Fehlen = alte App).
 */

const GPS_STATUS = new Set(['granted_precise', 'granted_coarse', 'denied', 'not_asked', 'timeout', 'unavailable']);
const MIT_FIX = new Set(['granted_precise', 'granted_coarse']);
const PLATTFORMEN = new Set(['ios', 'android']);

const MAX_GENAUIGKEIT_M = 100000;             // >100 km ist kein Standort mehr
const FIX_NACH_AUFNAHME_MAX_MS = 5 * 60e3;    // Client misst ≤4 s nach dem Auslösen; Rest = Uhr-Toleranz
const FIX_VOR_AUFNAHME_MAX_MS = 24 * 3600e3;  // last-known darf alt sein, ein Tag ist die Grenze
const ABSOLUT_MIN_MS = Date.UTC(2024, 0, 1);  // fängt Sekunden statt Millisekunden, 0, Unsinn
const ZUKUNFT_MAX_MS = 24 * 3600e3;

const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function text(v, max, muster) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return muster && !muster.test(t) ? null : t;
}

/** Prüft einen GPS-Fix. Liefert {gps} oder {grund}. */
function pruefeGps(roh, aufnahmeMs, jetztMs) {
  if (!roh || typeof roh !== 'object') return { grund: 'form' };
  const lat = zahl(roh.lat);
  const lon = zahl(roh.lon);
  if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return { grund: 'koordinate' };
  if (lat === 0 && lon === 0) return { grund: 'nullpunkt' };

  let accuracyM = null;
  if (roh.accuracyM != null) {
    accuracyM = zahl(roh.accuracyM);
    // iOS: negative horizontalAccuracy = Koordinate ungültig.
    if (accuracyM == null || accuracyM < 0 || accuracyM > MAX_GENAUIGKEIT_M) return { grund: 'genauigkeit' };
  }

  const fixAt = zahl(roh.fixAt);
  if (fixAt == null || fixAt < ABSOLUT_MIN_MS || fixAt > jetztMs + ZUKUNFT_MAX_MS) return { grund: 'fixzeit' };
  // Gemessen erst beim Hochladen statt beim Fotografieren → beschreibt nicht den Einkauf.
  if (fixAt > aufnahmeMs + FIX_NACH_AUFNAHME_MAX_MS) return { grund: 'fix_nach_aufnahme' };
  if (fixAt < aufnahmeMs - FIX_VOR_AUFNAHME_MAX_MS) return { grund: 'fix_zu_alt' };

  return { gps: { lat, lon, accuracyM, fixAt: new Date(fixAt) } };
}

/**
 * @param {object} body      req.body von enqueueCashback
 * @param {object} opts      {jetztMs}
 * @returns {{capture: object, clientVersion: object|null, verworfen: string|null}}
 *   `capture` enthält NUR gpsStatus/gps/gpsError (leer, wenn nichts geschickt wurde).
 */
function uebernehmeClientKontext(body, opts = {}) {
  const leer = { capture: {}, clientVersion: null, verworfen: null };
  try {
    const b = body && typeof body === 'object' ? body : {};
    const jetztMs = zahl(opts.jetztMs) ?? Date.now();
    let aufnahmeMs = b.capturedAt != null ? new Date(b.capturedAt).getTime() : NaN;
    if (!Number.isFinite(aufnahmeMs)) aufnahmeMs = jetztMs;

    const out = { capture: {}, clientVersion: null, verworfen: null };

    const k = b.captureContext;
    if (k && typeof k === 'object' && !Array.isArray(k)) {
      const status = GPS_STATUS.has(k.gpsStatus) ? k.gpsStatus : null;
      if (status) out.capture.gpsStatus = status;

      if (k.gps != null) {
        const r = !status ? { grund: 'status_ungueltig' }
          : !MIT_FIX.has(status) ? { grund: 'status_ohne_freigabe' }
          : pruefeGps(k.gps, aufnahmeMs, jetztMs);
        if (r.gps) out.capture.gps = r.gps;
        else out.verworfen = r.grund;
      }

      if (!out.capture.gps) {
        const fehler = out.verworfen ? `verworfen_${out.verworfen}` : text(k.gpsError, 120);
        if (fehler) out.capture.gpsError = fehler;
      }
    }

    const v = b.clientVersion;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const app = text(v.app, 32, /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/);
      const build = text(v.build, 16, /^[0-9A-Za-z._-]+$/);
      const platform = typeof v.platform === 'string' && PLATTFORMEN.has(v.platform) ? v.platform : null;
      if (app || build || platform) out.clientVersion = { app, build, platform };
    }
    return out;
  } catch {
    return leer;
  }
}

/** Für Logs: nie Koordinaten, nur Status und Grund. */
function logZusammenfassung(k) {
  return {
    gpsStatus: k.capture.gpsStatus ?? null,
    hatGps: Boolean(k.capture.gps),
    gpsVerworfen: k.verworfen,
    platform: k.clientVersion?.platform ?? null,
    app: k.clientVersion?.app ?? null,
  };
}

module.exports = { uebernehmeClientKontext, logZusammenfassung, GPS_STATUS };
