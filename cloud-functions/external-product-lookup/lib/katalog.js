/**
 * Steht ein Barcode schon im Katalog (produkte / markenProdukte)?
 *
 * Warum alle Schreibweisen: Die EAN steht im Katalog je nach Herkunft in
 * EANs[] (Wahrheit laut CLAUDE.md), eans[], EAN, ean, gtin, GTIN oder
 * moreInformation.EAN (dieselben Felder wie extractEans) — und mit oder ohne
 * führende Nullen (8/12/13/14 Stellen). onNutritionScrapeWrite prüfte nur
 * EAN, gtin und EANs; wer weniger Varianten prüft als dort gespeichert sind,
 * legt Dubletten zwischen Katalog und external_products an.
 *
 * Eine Abfrage pro Feld und Sammlung mit `in` / `array-contains-any` über
 * alle Schreibweisen (≤ 8 Werte, Firestore erlaubt 30): 14 Abfragen, je
 * höchstens ein Treffer, nur Dokument-IDs.
 *
 * `eanVarianten` ist eine Kopie aus review-console/src/werte.js (Codebases
 * teilen keinen Code) — bei Änderungen beide nachziehen.
 */

'use strict';

const KATALOG_SAMMLUNGEN = ['produkte', 'markenProdukte'];
const EINZELFELDER = ['EAN', 'ean', 'gtin', 'GTIN', 'moreInformation.EAN'];
const LISTENFELDER = ['EANs', 'eans'];

const ziffern = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Alle Schreibweisen derselben GTIN (8–14 Stellen, nur führende Nullen
 * verschieden). Der Rohwert ist immer dabei.
 */
function eanVarianten(ean) {
  const z = ziffern(ean);
  if (!z) return [];
  const out = new Set([z]);
  if (z.length >= 8 && z.length <= 14) {
    const s = z.padStart(14, '0');
    for (let n = 8; n <= 14; n++) {
      if (/^0*$/.test(s.slice(0, 14 - n))) out.add(s.slice(14 - n));
    }
  }
  return [...out];
}

/** Werte für die Abfragen: alle Schreibweisen + die Zahl (Altbestand speichert EANs teils als Zahl). */
function abfrageWerte(ean) {
  const varianten = eanVarianten(ean);
  if (varianten.length === 0) return [];
  const zahl = Number(ziffern(ean));
  return Number.isSafeInteger(zahl) && zahl > 0 ? [...varianten, zahl] : varianten;
}

/**
 * true, wenn mindestens ein Katalogprodukt diese EAN trägt.
 * Wirft bei Lesefehlern — ein Fehler ist KEIN „nicht im Katalog"
 * (sonst entstünden Dubletten); der Aufrufer wiederholt.
 */
async function istImKatalog(db, ean) {
  const werte = abfrageWerte(ean);
  if (werte.length === 0) return false;
  const abfragen = [];
  for (const sammlung of KATALOG_SAMMLUNGEN) {
    const col = db.collection(sammlung);
    for (const feld of EINZELFELDER) {
      abfragen.push(col.where(feld, 'in', werte).limit(1).select().get());
    }
    for (const feld of LISTENFELDER) {
      abfragen.push(col.where(feld, 'array-contains-any', werte).limit(1).select().get());
    }
  }
  const ergebnisse = await Promise.all(abfragen);
  return ergebnisse.some((snap) => !snap.empty);
}

module.exports = { EINZELFELDER, LISTENFELDER, eanVarianten, abfrageWerte, istImKatalog };
