/**
 * Schreibt Scraper-Ergebnisse in die nutritionscrape-Collection.
 *
 * Dokument-Format passend zum CF2-Backfill-Adapter (tryScraper):
 *   {
 *     gtin: string,                 // EAN — Lookup-Key
 *     productPath?: string,         // Optional: ref auf produkte/markenProdukte
 *     attr_ingredientStatement?: string,
 *     nutr_*_val/_unit:             // alle nutr_*-Felder
 *     scrapedAt: Timestamp,         // wann gescrapet
 *     scrapedSource: 'scraper',
 *     scrapedUrl: string,           // welche URL die Daten hatte
 *     confidence: number,           // LLM-Self-rating
 *     model: string,                // welches LLM-Modell
 *     tokensIn/Out: number          // für Kosten-Tracking
 *   }
 */

const admin = require('firebase-admin');

const COLLECTION = 'nutritionscrape';

/** Schreibt ein Resultat. Idempotent — wenn schon ein Eintrag für die
 *  EAN existiert UND der confidence-Score geringer ist als der neue,
 *  wird überschrieben. */
async function writeScrapeResult({
  ean,
  productPath = null,
  extracted,
  sourceUrl,
  sourceShop = null,
}) {
  if (!ean || !extracted) return { result: 'skip_empty' };

  const db = admin.firestore();
  const docRef = db.collection(COLLECTION).doc(String(ean));

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

  const data = {
    gtin: ean,
    productPath,
    scrapedAt: admin.firestore.FieldValue.serverTimestamp(),
    scrapedSource: 'scraper',
    scrapedUrl: sourceUrl,
    sourceShop: derivedShop,
    sourceUrl: sourceUrl, // Alias damit tryScraper-Adapter beide findet
    confidence: extracted._confidence ?? null,
    model: extracted._model ?? null,
    tokensIn: extracted._tokensIn ?? null,
    tokensOut: extracted._tokensOut ?? null,
    // Schema-Version — Marker fürs smart-skip im scrapeBatch.
    // v3 = aktueller extended prompt mit allen attr_*-Feldern
    //      (preis, hersteller, packageSize, allergene[], isVegan, isBio,
    //       biosiegel, herkunftsland, nutri_score, eco_score, spuren[])
    schemaVersion: 3,
  };

  // Strukturierte Daten — _-prefixed Felder NICHT übernehmen
  for (const [k, v] of Object.entries(extracted)) {
    if (k.startsWith('_')) continue;
    if (v == null) continue;
    data[k] = v;
  }

  // Idempotent-Write Logik:
  //   newConf > oldConf → full overwrite (alte Daten ersetzt)
  //   newConf == oldConf:
  //     - new from real shop, old from openfoodfacts → full overwrite
  //     - sonst → MERGE neue Felder (alte Werte bleiben + neue ergänzt)
  //   newConf < oldConf → MERGE nur Felder die nicht existierten
  //     (besser-conf-Daten bleiben, neue attr_*-Felder werden additiv
  //     ergänzt — z.B. Hersteller/Allergene/Bio aus späterem schema-update)
  //
  //   Begründung: ermöglicht Schema-Migration ohne Daten-Verlust.
  let writeMode = 'overwrite'; // 'overwrite' | 'merge_new_only' | 'merge_full'
  const existing = await docRef.get();
  if (existing.exists) {
    const old = existing.data() || {};
    const oldConf = old.confidence ?? 0;
    const newConf = data.confidence ?? 0;
    const oldShop = (old.sourceShop || '').toLowerCase();
    const newShop = (derivedShop || '').toLowerCase();
    const oldIsOpenfood = /openfoodfacts/.test(oldShop) || oldShop === 'openfoodfacts';
    const newIsOpenfood = /openfoodfacts/.test(newShop) || newShop === 'openfoodfacts';
    const newIsBetterShop = !newIsOpenfood && oldIsOpenfood;

    if (newConf > oldConf) {
      writeMode = 'overwrite';
    } else if (newConf === oldConf) {
      writeMode = newIsBetterShop ? 'overwrite' : 'merge_full';
    } else {
      // newConf < oldConf — nur Felder ergänzen die noch nicht da waren
      writeMode = 'merge_new_only';
    }
  }

  if (writeMode === 'merge_full' || writeMode === 'merge_new_only') {
    const oldData = existing.data() || {};
    const mergeData = {};
    for (const [k, v] of Object.entries(data)) {
      if (v == null) continue;
      if (k === '_touchedAt') continue;
      if (writeMode === 'merge_new_only') {
        if (oldData[k] === undefined) mergeData[k] = v;
      } else {
        // merge_full: alle non-null Felder mergen
        if (k === 'confidence' && (oldData.confidence ?? 0) > (v ?? 0)) continue;
        mergeData[k] = v;
      }
    }
    if (Object.keys(mergeData).length === 0) {
      return {
        result: 'skip_no_new_fields',
        mode: writeMode,
        oldConf: existing.data()?.confidence,
      };
    }
    // scrapedAt IMMER updaten beim Merge (sonst sieht User in UI alte
    // Timestamps obwohl Daten gerade angereichert wurden).
    mergeData.scrapedAt = admin.firestore.FieldValue.serverTimestamp();
    await docRef.set(mergeData, { merge: true });
    return { result: 'merged', mode: writeMode, fields_added: Object.keys(mergeData) };
  }

  await docRef.set(data, { merge: false });

  // Telemetrie: per-Domain Erfolgs-Counter + Confidence-Average.
  // Wird vom Resolver für Auto-Whitelist/Blacklist-Logik gelesen.
  // Schwellen: successCount>=3 UND avgConfidence>=0.7 → Whitelist;
  //            failCount>=5 && successCount==0 → 24h Blacklist
  if (derivedShop && typeof derivedShop === 'string') {
    try {
      await incrementTelemetrySuccess(db, derivedShop, data.confidence ?? null, ean);
    } catch (e) {
      console.warn('[writer] telemetry write failed:', e?.message);
    }
  }

  return { result: 'written', confidence: data.confidence };
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
 *  ODER Claude conf<0.5 returnt. */
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

module.exports = { writeScrapeResult, incrementTelemetryFail, COLLECTION };
