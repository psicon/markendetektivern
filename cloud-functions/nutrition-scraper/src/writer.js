/**
 * Schreibt Scraper-Ergebnisse in die nutritionscrape-Collection.
 *
 * Dokument-Format passend zum CF2-Backfill-Adapter (tryScraper) und zur
 * Übernahme in external_products (external-product-lookup):
 *   {
 *     gtin: string,                 // EAN — Lookup-Key
 *     productPath?: string,         // ref auf produkte/markenProdukte (bleibt)
 *     attr_ingredientStatement?: string,
 *     nutr_*_val/_unit:             // alle nutr_*-Felder
 *     attr_*:                       // Hersteller, Packung, Allergene …
 *     productName?: string,         // nur mit eanBeleg (src/seitenDaten.js)
 *     shopBildUrl?: string,         // Bild der Shopseite, nur mit eanBeleg
 *     eanBeleg?: 'jsonld_gtin' | 'seitentext',
 *     attr_preis?, attr_preisPackgroesse?, attr_preisPerKg?,
 *     priceShop?, priceCurrency?: 'EUR', priceFetchedAt?: Timestamp,
 *     fetchedAt: Timestamp,         // letzter echter Abruf mit KI-Auslesen
 *     scrapedAt: Timestamp,         // zuletzt ein Feld geändert (wie bisher)
 *     widerlegtAm?, widerlegtGrund?, widerlegtUrl?  // Altbestand von der
 *                                   // eigenen Quellseite widerlegt (Daten weg)
 *     scrapedSource: 'scraper',
 *     scrapedUrl/sourceUrl: string, // welche URL die Daten hatte
 *     sourceShop: string,
 *     confidence: number,           // KI-Selbsteinschätzung
 *     model: string,                // welches KI-Modell
 *     tokensIn/Out: number          // für Kosten-Tracking
 *   }
 */

const admin = require('firebase-admin');

const { fuehreZusammen, widerlegeAltbestand } = require('./zusammenfuehren');

const COLLECTION = 'nutritionscrape';
// v4 (04.10.2026): + productName/shopBildUrl/eanBeleg, fetchedAt,
// priceShop/priceCurrency/priceFetchedAt, Zusammenführen feldweise.
// v3: extended prompt mit allen attr_*-Feldern.
const SCHEMA_VERSION = 4;

// Felder, die nur der Writer setzt — gleichnamige Felder im Befund werden
// ignoriert (die KI-Antwort filtert schon der Extractor, das hier ist die
// zweite Sicherung: Herkunft und Katalogbezug fälscht kein Befund).
const FESTE_FELDER = new Set([
  'gtin', 'productPath', 'scrapedSource', 'scrapedUrl', 'sourceShop', 'sourceUrl',
  'confidence', 'model', 'tokensIn', 'tokensOut', 'schemaVersion',
  'fetchedAt', 'scrapedAt', 'priceFetchedAt',
  'widerlegtAm', 'widerlegtGrund', 'widerlegtUrl',
]);

/**
 * Schreibt einen Fund feldweise in nutritionscrape/{ean} — in EINER
 * Transaktion (Lesen, Zusammenführen, Schreiben). Nie `merge: false`: ein
 * Fund ohne Zutaten löscht keine vorhandenen Zutaten mehr, `productPath`
 * bleibt. Unbelegter Altbestand (vor v4) wird vom ersten belegten Fund
 * ersetzt. Regeln: src/zusammenfuehren.js.
 *
 * @param {object} args
 * @param {object|null} args.extracted Befund (src/befund.js) oder null, wenn
 *   nur eine Widerlegung zu schreiben ist
 * @param {boolean} [args.auffrischen=false] nur vom external-misses-processor:
 *   ein gültiger neuer Preis ersetzt den alten unabhängig von der
 *   KI-Sicherheit (Preise ändern sich mit der Zeit).
 * @param {{url:string, grund:string}|null} [args.widerlegung] die bevorzugte
 *   Seite wurde verworfen (src/suche.js) — widerlegt sie den gespeicherten
 *   Altbestand, werden dessen Daten entfernt und der Vermerk gesetzt.
 * @returns {Promise<{result:string, mode?:string, fields?:string[],
 *   confidence?:number|null, altdatenWiderlegt:boolean}>}
 */
async function writeScrapeResult({
  ean,
  productPath = null,
  extracted,
  sourceUrl,
  sourceShop = null,
  auffrischen = false,
  widerlegung = null,
}) {
  if (!ean || (!extracted && !widerlegung)) return { result: 'skip_empty', altdatenWiderlegt: false };

  const db = admin.firestore();
  const docRef = db.collection(COLLECTION).doc(String(ean));
  const jetzt = admin.firestore.FieldValue.serverTimestamp();

  if (!extracted) {
    // Kein neuer Fund — nur widerlegen, falls der Altbestand dazu passt.
    const w = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const r = widerlegeAltbestand(snap.exists ? snap.data() : null, { ...widerlegung, jetzt });
      if (r) tx.set(docRef, mitLoeschungen(r.setzen, r.loeschen), { merge: true });
      return r;
    });
    if (w) console.log(`[writer] ${ean}: Altbestand widerlegt (${widerlegung.grund}), ${w.loeschen.length} Felder entfernt`);
    return { result: w ? 'widerlegt' : 'skip_empty', altdatenWiderlegt: !!w };
  }

  // Wenn sourceShop nicht explizit gesetzt → von URL ableiten
  let derivedShop = sourceShop;
  if (!derivedShop && sourceUrl) {
    try {
      const host = new URL(sourceUrl).host.replace(/^www\./, '');
      derivedShop = host;
    } catch {
      /* noop */
    }
  }

  // Strukturierte Daten — _-prefixed und feste Felder NICHT aus dem Befund
  const neu = {};
  for (const [k, v] of Object.entries(extracted)) {
    if (k.startsWith('_') || FESTE_FELDER.has(k)) continue;
    if (v == null) continue;
    neu[k] = v;
  }
  // Feste Felder NACH den Daten — sie kommen nur vom Writer.
  Object.assign(neu, {
    gtin: String(ean),
    productPath: productPath || null,
    scrapedSource: 'scraper',
    scrapedUrl: sourceUrl,
    sourceShop: derivedShop,
    sourceUrl: sourceUrl, // Alias damit tryScraper-Adapter beide findet
    confidence: extracted._confidence ?? null,
    model: extracted._model ?? null,
    tokensIn: extracted._tokensIn ?? null,
    tokensOut: extracted._tokensOut ?? null,
    schemaVersion: SCHEMA_VERSION,
  });
  if (typeof neu.attr_preis === 'number' && neu.attr_preis > 0 && !neu.priceShop) {
    neu.priceShop = derivedShop;
  }

  const { plan, widerlegt } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const alt = snap.exists ? snap.data() : null;
    const p = fuehreZusammen(alt, neu, { auffrischen, jetzt });
    // Widerlegter Altbestand: fuehreZusammen hat ihn schon ersetzt (ein
    // widerlegbarer Altbestand ist immer unbelegt); dazu der Vermerk.
    const w = widerlegung ? widerlegeAltbestand(alt, { ...widerlegung, jetzt }) : null;
    if (w) Object.assign(p.setzen, w.setzen);
    tx.set(docRef, mitLoeschungen(p.setzen, p.loeschen), { merge: true });
    return { plan: p, widerlegt: !!w };
  });

  // Telemetrie: per-Domain Erfolgs-Counter + Confidence-Average.
  // Wird vom Resolver für Auto-Whitelist/Blacklist-Logik gelesen.
  // Schwellen: successCount>=3 UND avgConfidence>=0.7 → Whitelist;
  //            failCount>=5 && successCount==0 → 24h Blacklist
  // Gezählt wird wie bisher nur, wenn der neue Fund das Dokument bestimmt
  // (neu angelegt oder sicherer/besserer Shop).
  if (plan.erfolgFuerTelemetrie && derivedShop && typeof derivedShop === 'string') {
    try {
      await incrementTelemetrySuccess(db, derivedShop, neu.confidence ?? null, ean);
    } catch (e) {
      console.warn('[writer] telemetry write failed:', e?.message);
    }
  }

  return {
    result: ['neu', 'ueberschreiben', 'ersetzen'].includes(plan.modus) ? 'written' : plan.modus === 'nur_abrufdatum' ? 'skip_no_new_fields' : 'merged',
    mode: plan.modus,
    fields: plan.geaendert,
    confidence: neu.confidence,
    altdatenWiderlegt: widerlegt,
  };
}

function mitLoeschungen(setzen, loeschen) {
  const daten = { ...setzen };
  for (const k of loeschen) daten[k] = admin.firestore.FieldValue.delete();
  return daten;
}

/** Per-Domain Success-Counter inkrementieren + running average der
 *  Confidence pflegen. */
async function incrementTelemetrySuccess(db, shop, confidence, ean) {
  const safeKey = shop.replace(/[\/.#$\[\]]/g, '_');
  const ref = db.collection('nutritionscrape_telemetry').doc(safeKey);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const old = snap.exists ? snap.data() : null;
    const oldCount = old?.successCount ?? 0;
    const oldAvg = old?.avgConfidence ?? confidence ?? 0;
    const newCount = oldCount + 1;
    const newAvg =
      typeof confidence === 'number'
        ? (oldAvg * oldCount + confidence) / newCount
        : oldAvg;
    tx.set(
      ref,
      {
        shop,
        successCount: admin.firestore.FieldValue.increment(1),
        avgConfidence: Number(newAvg.toFixed(4)),
        lastConfidence: confidence,
        lastSuccessAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEan: ean,
      },
      { merge: true },
    );
  });
}

/** Per-Domain Fail-Counter inkrementieren. Wird vom Resolver/Quality-
 *  Check aufgerufen wenn eine Page als nicht-verwertbar verworfen wird
 *  ODER die Seite nicht zur EAN gehört. */
async function incrementTelemetryFail(db, shop, ean, reason) {
  if (!shop || typeof shop !== 'string') return;
  const safeKey = shop.replace(/[\/.#$\[\]]/g, '_');
  const ref = db.collection('nutritionscrape_telemetry').doc(safeKey);
  try {
    await ref.set(
      {
        shop,
        failCount: admin.firestore.FieldValue.increment(1),
        lastFailAt: admin.firestore.FieldValue.serverTimestamp(),
        lastFailReason: reason || 'unknown',
        lastFailEan: ean,
      },
      { merge: true },
    );
  } catch (e) {
    console.warn('[telemetry] fail-increment fehler:', e?.message);
  }
}

module.exports = { writeScrapeResult, incrementTelemetryFail, COLLECTION, SCHEMA_VERSION };
