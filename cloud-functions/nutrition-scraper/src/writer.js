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
}) {
  if (!ean || !extracted) return { result: 'skip_empty' };

  const db = admin.firestore();
  const docRef = db.collection(COLLECTION).doc(String(ean));

  const data = {
    gtin: ean,
    productPath,
    scrapedAt: admin.firestore.FieldValue.serverTimestamp(),
    scrapedSource: 'scraper',
    scrapedUrl: sourceUrl,
    confidence: extracted._confidence ?? null,
    model: extracted._model ?? null,
    tokensIn: extracted._tokensIn ?? null,
    tokensOut: extracted._tokensOut ?? null,
  };

  // Strukturierte Daten — _-prefixed Felder NICHT übernehmen
  for (const [k, v] of Object.entries(extracted)) {
    if (k.startsWith('_')) continue;
    if (v == null) continue;
    data[k] = v;
  }

  // Idempotent-Write: nur überschreiben wenn vorhandenes Doc niedrigeren
  // confidence hat (oder kein confidence-Feld hat).
  const existing = await docRef.get();
  if (existing.exists) {
    const oldConf = existing.data()?.confidence ?? 0;
    const newConf = data.confidence ?? 0;
    if (newConf <= oldConf) {
      return { result: 'skip_lower_confidence', oldConf, newConf };
    }
  }

  await docRef.set(data, { merge: false });
  return { result: 'written', confidence: data.confidence };
}

module.exports = { writeScrapeResult, COLLECTION };
