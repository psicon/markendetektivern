'use strict';

/**
 * Filialadresse vom Kassenbon auf dem Preisfoto → Eingabe für den Scorer
 * (ploc-v2, Entscheidung Patrick 24.09.2026: Bon-Adresse ist Ortsquelle Nr. 1).
 *
 * `priceReceipt` schreibt crowd-upload-namer aus dem Bon-Kopf ({merchant,
 * street, zip, city, bonDate, complete}). Gezählt wird nur eine VOLLSTÄNDIGE
 * Adresse (PLZ und Ort) — dieselbe Schwelle wie die Vergütungsregel
 * (crowd-upload-reward/src/locationGate.js), damit Ort und Geld nicht
 * auseinanderlaufen.
 *
 * Rein: die PLZ-Tabelle wird hereingereicht.
 */

/**
 * @param {object} doc     crowd_uploads-Dokument
 * @param {object} plz     Tabelle {"DE:12345": [lat, lon, ort, bundesland, ...]}
 * @returns {{zip: string, city: string, lat: number|null, lon: number|null, land: string|null, bundesland: string|null}|null}
 */
function bonAdresseAusDoc(doc, plz) {
  const r = doc && doc.priceReceipt;
  if (!r || !r.complete || !r.zip || !r.city) return null;
  const zip = String(r.zip).trim();
  const markt = String(doc.marketLand || '').toUpperCase().slice(0, 2);
  // Land der Filiale: fünfstellige PLZ = Deutschland, vierstellige =
  // Österreich — aber nur, wenn der Markt nicht ausdrücklich woanders steht.
  // Eine vierstellige PLZ an einem deutschen Markt ist ein Lesefehler.
  const land = zip.length === 5 ? 'DE' : zip.length === 4 && (markt === 'AT' || markt === '') ? 'AT' : null;
  const e = plz && land ? plz[`${land}:${zip}`] : null;
  // Rang 1 nur mit aufgelöster Koordinate (Review 24.09.2026): ohne sie
  // könnte der Scorer den Widerspruch zu einem GPS-Punkt nicht prüfen, und
  // ein Lesefehler im Bon verdrängte einen genauen Aufnahmeort. Die
  // Vergütungsregel bleibt davon unberührt — dort zählt, DASS ein Ort
  // belegt ist, nicht wo er auf der Karte liegt.
  if (!e) return null;
  return {
    zip,
    city: String(r.city).trim(),
    lat: e[0],
    lon: e[1],
    land,
    bundesland: e[3] || null,
  };
}

/** Hat sich die Bon-Adresse zwischen zwei Ständen geändert? */
function bonAdresseGeaendert(vorher, nachher) {
  const k = (d) => {
    const r = d && d.priceReceipt;
    return r ? `${r.complete ? 1 : 0}|${r.zip || ''}|${r.city || ''}` : '';
  };
  return k(vorher) !== k(nachher);
}

module.exports = { bonAdresseAusDoc, bonAdresseGeaendert };
