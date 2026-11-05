/**
 * Zeit-Helfer der Produktsuche — ohne Seiteneffekte, ohne firebase-admin.
 *
 * Firestore liefert Zeitpunkte als Timestamp (toMillis), die reinen
 * Entscheidungsfunktionen bekommen in Tests Date oder Zahlen. `zuMs` macht
 * daraus eine Zahl, damit Vergleiche überall gleich laufen.
 */

'use strict';

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Millisekunden aus Timestamp | Date | Zahl | {_seconds,_nanoseconds}.
 * Alles andere (null, Sentinel wie serverTimestamp(), Text) → null.
 */
function zuMs(wert) {
  if (wert == null) return null;
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : null;
  if (wert instanceof Date) {
    const ms = wert.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof wert.toMillis === 'function') {
    const ms = wert.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof wert._seconds === 'number') {
    return wert._seconds * 1000 + Math.floor((wert._nanoseconds || 0) / 1e6);
  }
  return null;
}

// Ein Formatierer je Prozess — Intl-Objekte sind teuer anzulegen.
const BERLIN_TAG = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Kalendertag in Europe/Berlin als 'YYYY-MM-DD' (en-CA formatiert genau so). */
function berlinTag(ms) {
  return BERLIN_TAG.format(new Date(ms));
}

module.exports = { TAG_MS, zuMs, berlinTag };
