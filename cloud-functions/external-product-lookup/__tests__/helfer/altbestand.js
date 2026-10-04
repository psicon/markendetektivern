/**
 * Echte Dokumente (Prüfrunde 2, 04.10.2026, nur gelesen und gekürzt) aus
 * external_products und nutritionscrape — fixtures/altbestand-2026-10-04.json.
 *
 *   3560070417148  OFF-Dokument „Aceto Balsamico"; Rohablage = Globus-Seite
 *                  von 4260237970446 (Heidelbeer-Fruchtaufstrich)
 *   4000980231414  OFF-Dokument „XXL Latte Macchiato"; Rohablage = Sekt
 *                  (Globus-Seite von 4003310013568)
 *   4000540031874  OFF-Dokument „Schoko Hafer-Müsli"; Rohablage = OFF-Seite
 *                  von 4316268436137 (Laugenstangerl)
 *   2009010284293  OFF-Dokument „Kartoffeln mehlig" (Ladencode); Rohablage =
 *                  deutschlandcard-Seite von 4008391026063 (Müsli)
 *   20006204       RCN-8; OFF-Name „Weizenbrötchen", Zutaten eines
 *                  Hygienereinigers von gastro-direkt.de (Platzhalter 'Produkt')
 *   4000412017401  Shop-Quelle globus (Adresse nennt die EAN), Bild, Scores,
 *                  Kategorie und Marke aber von der OFF-API
 *
 * Zeitpunkte stehen als {__ms} in der Datei und werden hier zu Objekten mit
 * toMillis (wie Firestore-Timestamps) — `zeit` erlaubt einen eigenen Bauer
 * (etwa FakeTimestamp in den Ablauf-Tests).
 */

'use strict';

const roh = require('../fixtures/altbestand-2026-10-04.json');

function wandle(v, zeit) {
  if (Array.isArray(v)) return v.map((x) => wandle(x, zeit));
  if (v && typeof v === 'object') {
    if (typeof v.__ms === 'number') return zeit(v.__ms);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wandle(x, zeit)]));
  }
  return v;
}

const standardZeit = (ms) => ({ toMillis: () => ms });

/** { ep, ns } eines Barcodes, frisch kopiert. */
function altbestand(ean, zeit = standardZeit) {
  const x = roh[ean];
  if (!x) throw new Error(`keine Fixture für ${ean}`);
  return { ep: wandle(x.ep, zeit), ns: wandle(x.ns, zeit) };
}

module.exports = { altbestand, EANS: Object.keys(roh) };
