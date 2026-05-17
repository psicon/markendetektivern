/**
 * Nutrition-Backfill (ClickUp 86c9uq418)
 *
 * One-Shot HTTPS-Trigger der durch alle `produkte` + `markenProdukte`
 * iteriert und fehlende Zutaten + Nährwerte aus externen Quellen
 * nachträgt.
 *
 * Quellen-Priorität (1. Treffer wins, getrennt pro Feldgruppe):
 *   1. reweapify   (lokale Firestore-Collection, Rewe-Daten)
 *   2. openfood    (TODO Sprint 2 — Service-Port)
 *   3. sonstiges   (TODO Sprint 3 — Scraper-Output)
 *
 * Sprint-1-Implementation: NUR reweapify. openfood + sonstiges
 * folgen wenn reweapify-Run stable ist.
 *
 * Regeln:
 *   • Produkte mit ingredientsSource ∈ {manual, rewe} werden NICHT
 *     angefasst (trusted, dürfen nicht überschrieben werden).
 *     Analog nutritionSource.
 *   • "Newer wins" — wir überschreiben nur wenn die Source einen
 *     neueren Zeitstempel hat als das aktuelle ingredientsUpdatedAt/
 *     nutritionUpdatedAt am Produkt.
 *   • Der Schreibvorgang triggert dann den Watcher (CF1) der die
 *     History anlegt — falls die NEUE Source nicht trusted ist.
 *
 * Schema-Ziel: reweapify-Format überall (attr_ingredientStatement +
 * nutr_*_val / nutr_*_unit). Bei reweapify-Hit ist das 1:1 Mapping
 * (gleiche Feldnamen, einfach kopieren).
 *
 * Deployment-Codebase: nutrition-backfill
 * Manueller Trigger:
 *   curl "https://europe-west1-markendetektive-895f7.cloudfunctions.net/backfillNutritionManual?key=<TRIGGER_KEY>&collection=produkte"
 *   curl "...?key=...&collection=markenProdukte"
 *   (oder ?collection=both)
 * Optional Query-Params:
 *   • limit=N — nur N Produkte verarbeiten (für Testing/Tracing)
 *   • dryRun=1 — keine Schreibvorgänge, nur Logging
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const PAGE_SIZE = 500;
const TRUSTED_SOURCES = new Set(['manual', 'rewe']);

const NUTR_FIELDS = [
  'Energie',
  'Fett',
  'FettdavongesttigteFettsuren',
  'Kohlenhydrate',
  'KohlenhydratedavonZucker',
  'Ballaststoffe',
  'Eiwei',
  'Salz',
];

// ─── Helpers ──────────────────────────────────────────────────────

function tsToMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (t && t._seconds) return t._seconds * 1000;
  return 0;
}

/** Sammelt alle EAN-Kandidaten aus einem Produkt-Doc in Reihenfolge.
 *  Filtert >= 8 Zeichen, dedupliziert. */
function extractEans(product) {
  if (!product) return [];
  const raw = [];
  raw.push(product.EAN, product.ean, product.gtin, product.GTIN);
  if (Array.isArray(product.EANs)) raw.push(...product.EANs);
  if (Array.isArray(product.eans)) raw.push(...product.eans);
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (v == null) continue;
    const s = typeof v === 'number' ? String(v) : String(v).trim();
    if (s.length < 8) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** True wenn ein reweapify-Doc Zutaten-Daten hat. */
function reweapifyHasIngredients(doc) {
  return (
    typeof doc.attr_ingredientStatement === 'string' &&
    doc.attr_ingredientStatement.trim().length > 0
  );
}

/** True wenn ein reweapify-Doc Nährwert-Daten hat (mindestens 1 Feld). */
function reweapifyHasNutrition(doc) {
  for (const f of NUTR_FIELDS) {
    if (doc[`nutr_${f}_val`] != null) return true;
  }
  return false;
}

/** Liest alle nutr_*-Felder aus einem reweapify-Doc. */
function extractNutrFields(doc) {
  const out = {};
  for (const f of NUTR_FIELDS) {
    const valKey = `nutr_${f}_val`;
    const unitKey = `nutr_${f}_unit`;
    if (doc[valKey] !== undefined) out[valKey] = doc[valKey];
    if (doc[unitKey] !== undefined) out[unitKey] = doc[unitKey];
  }
  if (doc.nutr_serving_size !== undefined) out.nutr_serving_size = doc.nutr_serving_size;
  if (doc.nutr_serving_unit !== undefined) out.nutr_serving_unit = doc.nutr_serving_unit;
  return out;
}

// ─── reweapify Source-Adapter ─────────────────────────────────────

/** Sucht in der `reweapify`-Collection nach Treffern für die übergebenen
 *  EANs. Returnt den Treffer mit dem neuesten `scrapedAt`. */
async function tryReweapify(eans) {
  if (!eans || eans.length === 0) return null;

  // Firestore-where-in unterstützt max 30 values pro Query. Splitten
  // wenn > 30 (aber selten >5 in der Praxis).
  const chunks = [];
  for (let i = 0; i < eans.length; i += 30) {
    chunks.push(eans.slice(i, i + 30));
  }

  let bestDoc = null;
  let bestTs = 0;

  for (const chunk of chunks) {
    try {
      const snap = await db
        .collection('reweapify')
        .where('gtin', 'in', chunk)
        .get();
      snap.forEach((d) => {
        const data = d.data();
        const ts = tsToMillis(data.scrapedAt);
        if (ts >= bestTs) {
          bestDoc = data;
          bestTs = ts;
        }
      });
    } catch (e) {
      console.warn(`tryReweapify: query für chunk ${chunk.join(',')} failed:`, e);
    }
  }

  if (!bestDoc) return null;
  return {
    source: 'rewe', // semantisch — Rewe-Daten sind trusted
    sourceTimestamp: bestDoc.scrapedAt ?? null,
    hasIngredients: reweapifyHasIngredients(bestDoc),
    ingredientStatement: bestDoc.attr_ingredientStatement ?? null,
    hasNutrition: reweapifyHasNutrition(bestDoc),
    nutrFields: extractNutrFields(bestDoc),
  };
}

// ─── Per-Produkt Logik ────────────────────────────────────────────

async function processProduct(docRef, product, dryRun) {
  const eans = extractEans(product);
  if (eans.length === 0) {
    return { result: 'skip_no_eans' };
  }

  const ingTrusted = TRUSTED_SOURCES.has(product.ingredientsSource);
  const nutTrusted = TRUSTED_SOURCES.has(product.nutritionSource);

  // Wenn beide Felder schon trusted → kompletter Skip
  if (ingTrusted && nutTrusted) {
    return { result: 'skip_all_trusted' };
  }

  // Quellen probieren in Reihenfolge. Pro Quelle: ingredients +
  // nutrition separat checken. Erstes Hit pro Feldgruppe wins.
  // Sprint 1: nur reweapify. Später: openfood, sonstiges.
  const candidate = await tryReweapify(eans);
  if (!candidate) {
    return { result: 'no_source_hit' };
  }

  const update = {};
  const reasons = [];

  // Ingredients
  if (!ingTrusted && candidate.hasIngredients) {
    const currentTs = tsToMillis(product.ingredientsUpdatedAt);
    const candidateTs = tsToMillis(candidate.sourceTimestamp);
    if (candidateTs > currentTs) {
      update.attr_ingredientStatement = candidate.ingredientStatement;
      update.ingredientsSource = candidate.source;
      update.ingredientsUpdatedAt = candidate.sourceTimestamp;
      reasons.push('ingredients');
    }
  }

  // Nutrition
  if (!nutTrusted && candidate.hasNutrition) {
    const currentTs = tsToMillis(product.nutritionUpdatedAt);
    const candidateTs = tsToMillis(candidate.sourceTimestamp);
    if (candidateTs > currentTs) {
      Object.assign(update, candidate.nutrFields);
      update.nutritionSource = candidate.source;
      update.nutritionUpdatedAt = candidate.sourceTimestamp;
      reasons.push('nutrition');
    }
  }

  if (Object.keys(update).length === 0) {
    return { result: 'no_update_needed' };
  }

  if (dryRun) {
    console.log(`[dry-run] would update ${docRef.path}:`, reasons.join(','));
    return { result: 'would_update', reasons };
  }

  try {
    await docRef.update(update);
    return { result: 'updated', reasons };
  } catch (e) {
    console.error(`update failed für ${docRef.path}:`, e);
    return { result: 'error', error: String(e?.message || e) };
  }
}

// ─── Backfill-Runner ──────────────────────────────────────────────

async function runBackfill(collectionName, limit, dryRun) {
  const startedAt = Date.now();
  console.log(
    `🚀 Backfill ${collectionName} starting${limit ? ` (limit=${limit})` : ''}${dryRun ? ' [DRY-RUN]' : ''}`,
  );

  const stats = {
    scanned: 0,
    updated: 0,
    would_update: 0,
    skip_all_trusted: 0,
    skip_no_eans: 0,
    no_source_hit: 0,
    no_update_needed: 0,
    error: 0,
  };

  let lastDoc = null;
  let pageNum = 0;

  while (true) {
    pageNum += 1;
    let q = db.collection(collectionName).orderBy('__name__').limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    // Innerhalb einer Page sequentiell (sonst sprengt's reweapify-
    // Read-Limits + macht Logs unleserlich).
    for (const d of snap.docs) {
      stats.scanned += 1;
      const r = await processProduct(d.ref, d.data(), dryRun);
      const key = r.result;
      stats[key] = (stats[key] || 0) + 1;
      if (limit && stats.scanned >= limit) break;
    }

    console.log(
      `  page ${pageNum} (${snap.size} docs): scanned=${stats.scanned} updated=${stats.updated} skip=${stats.skip_all_trusted + stats.skip_no_eans + stats.no_source_hit + stats.no_update_needed}`,
    );

    lastDoc = snap.docs[snap.docs.length - 1];
    if (limit && stats.scanned >= limit) break;
    if (pageNum > 1000) {
      console.warn('Backfill: pageNum > 1000, breaking safety');
      break;
    }
  }

  const elapsed = Date.now() - startedAt;
  console.log(`✅ Backfill ${collectionName} done in ${elapsed} ms:`, stats);
  return { collection: collectionName, elapsedMs: elapsed, ...stats };
}

// ─── HTTPS-Trigger ────────────────────────────────────────────────

exports.backfillNutritionManual = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const expected = functions.config()?.nutritionbackfill?.trigger_key;
    if (!expected || req.query.key !== expected) {
      res.status(401).send('Unauthorized');
      return;
    }

    // collection-param case-INsensitive akzeptieren, intern aber die
    // exakten Firestore-Collection-Namen (case-sensitive!) benutzen.
    const collectionParam = String(req.query.collection || 'both').toLowerCase();
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : null;
    const dryRun = String(req.query.dryRun || '') === '1';

    try {
      const results = {};
      if (collectionParam === 'produkte' || collectionParam === 'both') {
        results.produkte = await runBackfill('produkte', limit, dryRun);
      }
      if (
        collectionParam === 'markenprodukte' ||
        collectionParam === 'markenProdukte'.toLowerCase() ||
        collectionParam === 'both'
      ) {
        results.markenProdukte = await runBackfill('markenProdukte', limit, dryRun);
      }
      res.status(200).json(results);
    } catch (e) {
      console.error('backfill failed:', e);
      res.status(500).send(String(e?.message || e));
    }
  });
