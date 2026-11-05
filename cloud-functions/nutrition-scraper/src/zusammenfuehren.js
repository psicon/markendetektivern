/**
 * Zusammenführen eines neuen Fundes mit dem vorhandenen nutritionscrape-
 * Dokument — FELDWEISE, ohne Seiteneffekte (der Writer schreibt das Ergebnis
 * in einer Transaktion).
 *
 * Warum neu (04.10.2026): Der Writer schrieb bei höherer KI-Sicherheit oder
 * „besserem Shop“ `set(data, { merge: false })` und ersetzte damit das ganze
 * Dokument. Zutaten und Nährwerte der alten Lesung verschwanden, wenn die neue
 * sie nicht hatte, und `productPath` wurde null — nutrition-backfill
 * (onNutritionScrapeWrite) findet darüber das Katalogprodukt.
 *
 * Regeln:
 *   • Ein leerer/fehlender neuer Wert ersetzt NIE einen vorhandenen
 *     (null, '', [] gelten als leer; false und 0 nicht).
 *   • Stabile Felder (Zutaten, Nährwerte, Hersteller, Name, Bild, übrige
 *     attr_*) nach der bisherigen Regel, aber je Feld:
 *       neue Sicherheit ≥ alte → der neue Wert gewinnt;
 *       neue Sicherheit < alte → nur fehlende Felder ergänzen.
 *   • Name: ein schwächer belegter Name ('seitentext') ersetzt nie einen
 *     stärker belegten ('jsonld_gtin'). Name und eanBeleg gehören zusammen.
 *   • Preis ist ein Block (attr_preis, Packungsgröße, Grundpreis, priceShop,
 *     priceCurrency, priceFetchedAt): ein Fund ohne Preis lässt den alten
 *     stehen; im Modus `auffrischen` (nur der Prozessor) gilt immer der neue
 *     Preis, sonst die Sicherheitsregel. Zu einem neuen Preis passende alte
 *     Packungs-/Grundpreisangaben werden entfernt, nicht vermischt.
 *   • productPath bleibt, wenn vorhanden.
 *   • fetchedAt = jetzt bei JEDEM Aufruf — er folgt immer auf einen echten
 *     Abruf mit KI-Auslesen, auch wenn sich kein Wert ändert (sonst würde die
 *     2-Monats-Auffrischung dieselbe EAN immer wieder bezahlen).
 *   • scrapedAt behält seine bisherige Bedeutung („zuletzt etwas
 *     geschrieben“): nur wenn sich ein Feld ändert. nutrition-backfill nutzt
 *     es als Datenstand.
 *
 * Ausnahme — unbelegter Altbestand (Prüfrunde 04.10.2026): Ein Dokument mit
 * Daten, aber ohne fetchedAt, stammt aus der Zeit vor v4. Diese Daten wurden
 * bei bekannten Shops ohne EAN-Prüfung gelesen (fixtures/QUELLE.md: violey,
 * shop-apotheke, OpenFoodFacts-Seiten fremder Produkte) und Preise ohne
 * Währungs-/Länderprüfung übernommen (zdroweslodycze.pl 24,69 als „EUR“).
 * Feldweise blieben sie neben einem belegten Namen stehen, und ein Altpreis
 * bekäme Shop und Datum des neuen Abrufs. Deshalb ERSETZT der erste belegte
 * Fund den Altbestand vollständig (Modus 'ersetzen'): was er nicht liefert,
 * wird gelöscht; nur gtin, productPath und Widerlegungsvermerk bleiben.
 * Feldweise gilt ab diesem ersten belegten Fund.
 *
 * Widerlegt die gespeicherte Quellseite selbst den Altbestand (Auffrischung:
 * andere GTIN, EAN fehlt, mehrere Produkte — src/suche.js), entfernt
 * widerlegeAltbestand dessen Daten auch ohne neuen Fund.
 */

'use strict';

const PREIS_FELDER = ['attr_preis', 'attr_preisPackgroesse', 'attr_preisPerKg', 'priceShop', 'priceCurrency'];
const PREIS_BEGLEITER = ['attr_preisPackgroesse', 'attr_preisPerKg'];
const META_FELDER = ['scrapedUrl', 'sourceShop', 'sourceUrl', 'confidence', 'model', 'tokensIn', 'tokensOut'];
const SONDER_FELDER = new Set([
  ...PREIS_FELDER,
  ...META_FELDER,
  'gtin', 'productPath', 'scrapedSource', 'schemaVersion',
  'productName', 'eanBeleg',
  'scrapedAt', 'fetchedAt', 'priceFetchedAt',
]);
const BELEG_RANG = { jsonld_gtin: 2, seitentext: 1 };

function istLeer(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return !Number.isFinite(v);
  return false;
}

function gleich(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => gleich(x, b[i]));
  }
  return a === b;
}

function hatPreis(d) {
  return !!d && typeof d.attr_preis === 'number' && d.attr_preis > 0;
}

function istOpenFoodFacts(shop) {
  return /openfoodfacts/.test(String(shop || '').toLowerCase());
}

/** Hat das Dokument schon echte Daten (nicht nur einen Fehlversuch-Marker
 *  aus scrapeBatch)? */
function hatDaten(alt) {
  return !!alt && !!(alt.scrapedSource || alt.scrapedAt);
}

/** Daten aus der Zeit vor v4 (kein fetchedAt) — ohne EAN-Beleg gelesen. */
function istUnbelegterAltbestand(alt) {
  return hatDaten(alt) && alt.fetchedAt == null;
}

// Was beim Ersetzen/Widerlegen stehen bleibt: Schlüssel, Katalogbezug,
// Widerlegungsvermerk und die _-Marker von scrapeBatch (deren Pflege macht
// das Zusammenführen selbst).
const STAMM_FELDER = new Set(['gtin', 'productPath', 'widerlegtAm', 'widerlegtGrund', 'widerlegtUrl']);
const loeschbar = (k) => !k.startsWith('_') && !STAMM_FELDER.has(k);

function adresse(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    return new URL(url.trim()).toString();
  } catch {
    return null;
  }
}

/**
 * Die gespeicherte Quellseite widerlegt den Altbestand — Daten entfernen.
 * Nur für unbelegten Altbestand und nur, wenn die verworfene Seite genau die
 * gespeicherte Quellseite ist. Belegte Daten (v4) bleiben: dass eine damals
 * belegte Seite heute anders aussieht (Produkt ausgelistet), macht sie nicht
 * falsch.
 *
 * @param {object|null} alt
 * @param {{url:string, grund:string, jetzt:*}} w
 * @returns {{setzen:object, loeschen:string[]}|null} null = nichts zu tun
 */
function widerlegeAltbestand(alt, { url, grund, jetzt }) {
  if (!istUnbelegterAltbestand(alt)) return null;
  const gespeichert = adresse(alt.sourceUrl) || adresse(alt.scrapedUrl);
  if (!gespeichert || gespeichert !== adresse(url)) return null;
  return {
    setzen: { widerlegtAm: jetzt, widerlegtGrund: grund, widerlegtUrl: gespeichert },
    loeschen: Object.keys(alt).filter(loeschbar),
  };
}

/**
 * @param {object|null} alt  vorhandenes Dokument (data()) oder null
 * @param {object} neu       flaches Objekt: gtin, productPath, scrapedSource,
 *                           scrapedUrl, sourceShop, sourceUrl, confidence,
 *                           model, tokensIn/Out, schemaVersion + Datenfelder
 * @param {object} opts      { auffrischen?: boolean, jetzt: Zeitstempelwert }
 * @returns {{ setzen: object, loeschen: string[],
 *             modus: 'neu'|'ueberschreiben'|'zusammenfuehren'|'ergaenzen'|'ersetzen'|'nur_abrufdatum',
 *             geaendert: string[], erfolgFuerTelemetrie: boolean }}
 */
function fuehreZusammen(alt, neu, optionen = {}) {
  if (!istUnbelegterAltbestand(alt)) return fuehreFeldweiseZusammen(alt, neu, optionen);
  // Unbelegter Altbestand: der belegte Fund ersetzt ihn (Kopfkommentar).
  const stamm = {};
  for (const [k, v] of Object.entries(alt)) if (!loeschbar(k)) stamm[k] = v;
  const r = fuehreFeldweiseZusammen(stamm, neu, optionen);
  for (const k of Object.keys(alt)) {
    if (!loeschbar(k) || k in r.setzen || r.loeschen.includes(k)) continue;
    r.loeschen.push(k);
    r.geaendert.push(k);
  }
  return { ...r, modus: 'ersetzen', erfolgFuerTelemetrie: true };
}

function fuehreFeldweiseZusammen(alt, neu, { auffrischen = false, jetzt } = {}) {
  const setzen = {};
  const loeschen = [];
  const geaendert = [];
  const setze = (k, v) => {
    setzen[k] = v;
    geaendert.push(k);
  };

  const vorhanden = hatDaten(alt) ? alt : null;
  const altDoc = alt || {};

  // ── Wer gewinnt? (bisherige Konfidenz-/Shop-Regel) ──
  let modus = 'neu';
  let neuGewinnt = true;
  let erfolgFuerTelemetrie = true;
  if (vorhanden) {
    const altConf = vorhanden.confidence ?? 0;
    const neuConf = neu.confidence ?? 0;
    const besserShop = !istOpenFoodFacts(neu.sourceShop) && istOpenFoodFacts(vorhanden.sourceShop);
    if (neuConf > altConf || (neuConf === altConf && besserShop)) {
      modus = 'ueberschreiben';
    } else if (neuConf === altConf) {
      modus = 'zusammenfuehren';
      erfolgFuerTelemetrie = false;
    } else {
      modus = 'ergaenzen';
      neuGewinnt = false;
      erfolgFuerTelemetrie = false;
    }
  }

  const nimmFeld = (k) => {
    const v = neu[k];
    if (istLeer(v)) return;
    if (neuGewinnt ? !gleich(altDoc[k], v) : istLeer(altDoc[k])) setze(k, v);
  };

  // ── Stabile Datenfelder ──
  for (const k of Object.keys(neu)) {
    if (k.startsWith('_') || SONDER_FELDER.has(k)) continue;
    nimmFeld(k);
  }

  // ── Name mit Beleg ──
  if (!istLeer(neu.productName)) {
    const rangNeu = BELEG_RANG[neu.eanBeleg] || 0;
    const rangAlt = BELEG_RANG[altDoc.eanBeleg] || 0;
    const nimm =
      istLeer(altDoc.productName) ||
      rangNeu > rangAlt ||
      (rangNeu === rangAlt && neuGewinnt);
    if (nimm && (!gleich(altDoc.productName, neu.productName) || altDoc.eanBeleg !== neu.eanBeleg)) {
      setze('productName', neu.productName);
      if (!istLeer(neu.eanBeleg)) setze('eanBeleg', neu.eanBeleg);
    }
  }

  // ── Preisblock ──
  if (hatPreis(neu)) {
    const nimm = auffrischen || !hatPreis(altDoc) || neuGewinnt;
    if (nimm) {
      const unveraendert = PREIS_FELDER.every((k) => istLeer(neu[k]) ? istLeer(altDoc[k]) : gleich(altDoc[k], neu[k]));
      for (const k of PREIS_FELDER) {
        if (!istLeer(neu[k])) {
          if (!gleich(altDoc[k], neu[k])) setze(k, neu[k]);
        } else if (PREIS_BEGLEITER.includes(k) && !istLeer(altDoc[k])) {
          // Gehörte zum alten Preis — nicht neben einem neuen stehen lassen.
          loeschen.push(k);
          geaendert.push(k);
        }
      }
      // Der Preis wurde gerade wirklich gelesen — auch ein bestätigter
      // gleicher Preis bekommt das neue Datum.
      setzen.priceFetchedAt = jetzt;
      if (!unveraendert) geaendert.push('priceFetchedAt');
    }
  }

  // ── Herkunft (Meta) ──
  for (const k of META_FELDER) nimmFeld(k);
  if (!istLeer(neu.scrapedSource) && altDoc.scrapedSource !== neu.scrapedSource) setze('scrapedSource', neu.scrapedSource);
  if (typeof neu.schemaVersion === 'number' && !(altDoc.schemaVersion >= neu.schemaVersion)) {
    setze('schemaVersion', neu.schemaVersion);
  }
  if (istLeer(altDoc.gtin) && !istLeer(neu.gtin)) setze('gtin', neu.gtin);
  // productPath bleibt, wenn vorhanden (nutrition-backfill findet darüber
  // das Katalogprodukt).
  if (istLeer(altDoc.productPath) && !istLeer(neu.productPath)) setze('productPath', neu.productPath);

  // Erfolgreicher Fund → Fehlversuch-Marker aus scrapeBatch aufheben.
  if (altDoc._failed) {
    loeschen.push('_failed');
    geaendert.push('_failed');
  }

  setzen.fetchedAt = jetzt;
  if (geaendert.length > 0) setzen.scrapedAt = jetzt;

  return {
    setzen,
    loeschen,
    modus: geaendert.length === 0 ? 'nur_abrufdatum' : modus,
    geaendert,
    erfolgFuerTelemetrie,
  };
}

/**
 * scrapeBatch sammelt Funde über mehrere Seiten: der erste Fund bestimmt,
 * spätere füllen nur Lücken. Der Preis wandert als Block, der Name mit seinem
 * Beleg — sonst stünde ein Preis von Shop A mit der Packungsgröße von Shop B
 * im Dokument.
 */
function ergaenzeBefund(gesammelt, neu) {
  if (!gesammelt) return { ...neu };
  const out = { ...gesammelt };
  for (const [k, v] of Object.entries(neu)) {
    if (k.startsWith('_') || istLeer(v)) continue;
    if (PREIS_FELDER.includes(k) || k === 'productName' || k === 'eanBeleg') continue;
    if (istLeer(out[k])) out[k] = v;
  }
  if (!hatPreis(out) && hatPreis(neu)) {
    for (const k of PREIS_FELDER) {
      if (istLeer(neu[k])) delete out[k];
      else out[k] = neu[k];
    }
  }
  if (istLeer(out.productName) && !istLeer(neu.productName)) {
    out.productName = neu.productName;
    out.eanBeleg = neu.eanBeleg;
  }
  return out;
}

module.exports = {
  fuehreZusammen,
  widerlegeAltbestand,
  istUnbelegterAltbestand,
  ergaenzeBefund,
  istLeer,
  PREIS_FELDER,
};
