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
const openfood = require('./openfood');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const PAGE_SIZE = 500;
// Trusted-Sources werden NIE vom automatisierten Backfill überschrieben:
//   - manual: eigene Recherche (z.B. Admin-Edit-Tool)
//   - rewe:   reweapify-Pipeline (offizielle Rewe-API-Daten)
//   - ocr:    Bilder-Erkennung von Produkt-Etiketten (User-eigene
//             Bilder, Stufen-1/2-Scans, eigene Kassenbon-Photos)
// scraper/openfood/legacy = untrusted, newer-wins.
const TRUSTED_SOURCES = new Set(['manual', 'rewe', 'ocr']);

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

/** Normalisiert eine reweapify-`scrapedAt` zu Firestore.Timestamp.
 *  reweapify speichert das als ISO-String — wir wollen aber Timestamp
 *  am Produkt für saubere Ordering/Query-Operationen. */
function toFirestoreTs(value) {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (typeof value.toDate === 'function') {
    return admin.firestore.Timestamp.fromDate(value.toDate());
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    return admin.firestore.Timestamp.fromMillis(ms);
  }
  if (typeof value === 'number') {
    return admin.firestore.Timestamp.fromMillis(value);
  }
  return null;
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
    // ISO-String → Firestore.Timestamp damit am Produkt sauber als
    // Timestamp persistiert (nicht als String). Wichtig für orderBy
    // und für die Diff-Logik beim nächsten Backfill-Run.
    sourceTimestamp: toFirestoreTs(bestDoc.scrapedAt),
    sourceUrl: bestDoc.url ?? null, // reweapify-Pipeline hat url-Feld
    sourceShop: 'rewe.de',
    hasIngredients: reweapifyHasIngredients(bestDoc),
    ingredientStatement: bestDoc.attr_ingredientStatement ?? null,
    hasNutrition: reweapifyHasNutrition(bestDoc),
    nutrFields: extractNutrFields(bestDoc),
  };
}

// ─── Scraper Source-Adapter ───────────────────────────────────────

/** Source-Adapter für die `nutritionscrape`-Collection — wird vom
 *  separaten `cloud-functions/nutrition-scraper` Repo befuellt
 *  (LLM-Extraction aus Discounter-Websites). Doc-ID == EAN. */
async function tryScraper(eans) {
  if (!eans || eans.length === 0) return null;
  // Versuche jede EAN sequentiell — erstes vorhandenes Doc gewinnt.
  for (const ean of eans) {
    try {
      const snap = await db.collection('nutritionscrape').doc(String(ean)).get();
      if (!snap.exists) continue;
      const data = snap.data();
      if (!data) continue;

      // Nutr-Fields aus dem Doc extrahieren
      const nutrFields = {};
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
      let hasNutrition = false;
      for (const f of NUTR_FIELDS) {
        const v = data[`nutr_${f}_val`];
        const u = data[`nutr_${f}_unit`];
        if (typeof v === 'number') {
          nutrFields[`nutr_${f}_val`] = v;
          if (u) nutrFields[`nutr_${f}_unit`] = u;
          hasNutrition = true;
        }
      }
      if (typeof data.nutr_serving_size === 'number') {
        nutrFields.nutr_serving_size = data.nutr_serving_size;
      }
      if (typeof data.nutr_serving_unit === 'string') {
        nutrFields.nutr_serving_unit = data.nutr_serving_unit;
      }

      const ingredientStatement =
        typeof data.attr_ingredientStatement === 'string' &&
        data.attr_ingredientStatement.trim().length > 0
          ? data.attr_ingredientStatement.trim()
          : null;

      if (!ingredientStatement && !hasNutrition) continue;

      // Shop-Name aus der URL extrahieren — Host-Mapping. Damit
      // wir am Produkt sehen "Quelle: metro.de" o.ä.
      let sourceShop = null;
      try {
        if (typeof data.scrapedUrl === 'string') {
          sourceShop = new URL(data.scrapedUrl).host.replace(/^www\./, '');
        }
      } catch {}

      return {
        source: 'scraper',
        sourceTimestamp: data.scrapedAt ?? admin.firestore.Timestamp.now(),
        sourceUrl: data.scrapedUrl ?? null,
        sourceShop, // z.B. 'metro.de', 'codecheck.info'
        hasIngredients: !!ingredientStatement,
        ingredientStatement,
        hasNutrition,
        nutrFields,
      };
    } catch (e) {
      console.warn(`tryScraper: EAN ${ean} lookup failed:`, e?.message);
    }
  }
  return null;
}

// ─── OpenFood Source-Adapter ──────────────────────────────────────

/** Source-Adapter für openfood. Iteriert alle EANs sequentiell
 *  (1. Treffer wins). Returnt normalized Shape analog tryReweapify. */
async function tryOpenFood(eans) {
  if (!eans || eans.length === 0) return null;
  const result = await openfood.getProductByFirstEAN(eans);
  if (!result || !result.found) return null;

  // last_modified_t ist UNIX seconds. Wenn fehlt → "now" als
  // Fallback (kommt selten vor).
  const tsMs = result.last_modified_t
    ? result.last_modified_t * 1000
    : Date.now();
  return {
    source: 'openfood',
    sourceTimestamp: admin.firestore.Timestamp.fromMillis(tsMs),
    // OpenFoodFacts hat eine deterministische Product-URL die wir
    // ans Produkt schreiben damit transparent ist von wo die Daten
    // kamen. Format: https://world.openfoodfacts.org/product/<ean>
    sourceUrl: `https://world.openfoodfacts.org/product/${result.code}`,
    sourceShop: 'openfoodfacts.org',
    hasIngredients: openfood.hasIngredients(result),
    ingredientStatement: openfood.extractIngredientStatement(result),
    hasNutrition: openfood.hasNutrition(result),
    nutrFields: openfood.extractNutrFields(result),
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

  const update = {};
  const reasons = [];
  let ingredientsCovered = ingTrusted;
  let nutritionCovered = nutTrusted;

  // ─── Source 1: reweapify ──────────────────────────────────
  // Trusted-Quelle (Rewe). Wenn hier ein Treffer ist → wir
  // schreiben source='rewe' und IGNORIEREN newer-wins-Check
  // gegenueber niedriger-priorisierten Sources (openfood/scraper).
  // Innerhalb von reweapify: nur überschreiben wenn candidate
  // wirklich neuer als current.
  if (!ingredientsCovered || !nutritionCovered) {
    const r = await tryReweapify(eans);
    if (r) {
      // Ingredients
      if (!ingredientsCovered && r.hasIngredients) {
        const cur = product.ingredientsSource;
        // Wenn current bereits 'rewe' → newer-wins. Sonst: rewe
        // gewinnt automatisch (Priority over openfood/scraper/legacy).
        const allowWrite =
          cur !== 'rewe' || tsToMillis(r.sourceTimestamp) > tsToMillis(product.ingredientsUpdatedAt);
        if (allowWrite) {
          update.attr_ingredientStatement = r.ingredientStatement;
          update.ingredientsSource = r.source;
          update.ingredientsUpdatedAt = r.sourceTimestamp;
          if (r.sourceUrl) update.ingredientsSourceUrl = r.sourceUrl;
          if (r.sourceShop) update.ingredientsSourceShop = r.sourceShop;
          reasons.push('ingredients(rewe)');
        }
        ingredientsCovered = true;
      }
      // Nutrition
      if (!nutritionCovered && r.hasNutrition) {
        const cur = product.nutritionSource;
        const allowWrite =
          cur !== 'rewe' || tsToMillis(r.sourceTimestamp) > tsToMillis(product.nutritionUpdatedAt);
        if (allowWrite) {
          Object.assign(update, r.nutrFields);
          update.nutritionSource = r.source;
          update.nutritionUpdatedAt = r.sourceTimestamp;
          if (r.sourceUrl) update.nutritionSourceUrl = r.sourceUrl;
          if (r.sourceShop) update.nutritionSourceShop = r.sourceShop;
          reasons.push('nutrition(rewe)');
        }
        nutritionCovered = true;
      }
    }
  }

  // ─── Source 2: scraper (nutritionscrape collection) ──────────
  // User-Vorgabe 2026-05-17: scraper VOR openfood. Begründung:
  // scraper hat shop-spezifische Daten von DE/AT-Märkten, die für
  // unsere Discounter-Eigenmarken meist verlässlicher als crowd-
  // sourced OpenFoodFacts sind.
  if (!ingredientsCovered || !nutritionCovered) {
    const s = await tryScraper(eans);
    if (s) {
      if (!ingredientsCovered && s.hasIngredients) {
        const cur = product.ingredientsSource;
        const allowWrite =
          cur !== 'scraper' ||
          tsToMillis(s.sourceTimestamp) > tsToMillis(product.ingredientsUpdatedAt);
        if (allowWrite) {
          update.attr_ingredientStatement = s.ingredientStatement;
          update.ingredientsSource = 'scraper';
          update.ingredientsUpdatedAt = s.sourceTimestamp;
          // Quelle-URL + Shop ans Produkt damit transparent ist
          // von welchem Shop die Daten kamen (z.B. 'metro.de').
          if (s.sourceUrl) update.ingredientsSourceUrl = s.sourceUrl;
          if (s.sourceShop) update.ingredientsSourceShop = s.sourceShop;
          reasons.push(`ingredients(scraper:${s.sourceShop || '?'})`);
        }
        ingredientsCovered = true;
      }
      if (!nutritionCovered && s.hasNutrition) {
        const cur = product.nutritionSource;
        const allowWrite =
          cur !== 'scraper' ||
          tsToMillis(s.sourceTimestamp) > tsToMillis(product.nutritionUpdatedAt);
        if (allowWrite) {
          Object.assign(update, s.nutrFields);
          update.nutritionSource = 'scraper';
          update.nutritionUpdatedAt = s.sourceTimestamp;
          if (s.sourceUrl) update.nutritionSourceUrl = s.sourceUrl;
          if (s.sourceShop) update.nutritionSourceShop = s.sourceShop;
          reasons.push(`nutrition(scraper:${s.sourceShop || '?'})`);
        }
        nutritionCovered = true;
      }
    }
  }

  // ─── Source 3: openfood ────────────────────────────────────
  // Letzte Ressource. Nur fuer Feldgruppen die weder reweapify
  // noch scraper abgedeckt haben.
  if (!ingredientsCovered || !nutritionCovered) {
    const of = await tryOpenFood(eans);
    if (of) {
      if (!ingredientsCovered && of.hasIngredients) {
        const cur = product.ingredientsSource;
        const allowWrite =
          cur !== 'openfood' ||
          tsToMillis(of.sourceTimestamp) > tsToMillis(product.ingredientsUpdatedAt);
        if (allowWrite) {
          update.attr_ingredientStatement = of.ingredientStatement;
          update.ingredientsSource = 'openfood';
          update.ingredientsUpdatedAt = of.sourceTimestamp;
          if (of.sourceUrl) update.ingredientsSourceUrl = of.sourceUrl;
          if (of.sourceShop) update.ingredientsSourceShop = of.sourceShop;
          reasons.push('ingredients(openfood)');
        }
        ingredientsCovered = true;
      }
      if (!nutritionCovered && of.hasNutrition) {
        const cur = product.nutritionSource;
        const allowWrite =
          cur !== 'openfood' ||
          tsToMillis(of.sourceTimestamp) > tsToMillis(product.nutritionUpdatedAt);
        if (allowWrite) {
          Object.assign(update, of.nutrFields);
          update.nutritionSource = 'openfood';
          update.nutritionUpdatedAt = of.sourceTimestamp;
          if (of.sourceUrl) update.nutritionSourceUrl = of.sourceUrl;
          if (of.sourceShop) update.nutritionSourceShop = of.sourceShop;
          reasons.push('nutrition(openfood)');
        }
        nutritionCovered = true;
      }
    }
  }

  if (Object.keys(update).length === 0) {
    // Wenn keine Source ueberhaupt was hatte → no_source_hit.
    // Wenn was kam aber alles bereits aktueller im DB →
    // no_update_needed (= alles iO).
    const anyHitButOlder = reasons.length === 0;
    return { result: anyHitButOlder ? 'no_source_hit' : 'no_update_needed' };
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

// ══ Auto-Trigger für neue Produkte ════════════════════════════════
//
// User-Vorgabe 2026-05-17: Wenn neue produkte / markenProdukte ohne
// nutrition data hinzugefügt werden, sollen alle Quellen automatisch
// anspringen (reweapify → scraper → openfood, in dieser Reihenfolge).
//
// Implementation:
//   • onCreate-Trigger auf produkte/* und markenProdukte/* — feuert
//     processProduct() (reweapify + scraper-cache + openfood).
//   • Wenn ALLE Quellen leer waren UND der Scraper-Service erreichbar
//     ist → fire-and-forget HTTPS-POST an scraper.scrapeEan.
//   • onWrite-Trigger auf nutritionscrape/* — sobald der Scraper was
//     reinschreibt, läuft processProduct erneut für die produkte mit
//     matching EAN.
//
// Trust-Protection greift wie üblich: manual/rewe-sourced Produkte
// werden NICHT überschrieben.
// ══════════════════════════════════════════════════════════════════

const SCRAPER_REGION = REGION;
const SCRAPER_PROJECT = process.env.GCLOUD_PROJECT || 'markendetektive-895f7';
// Scraper-URL wird via env-Var konfiguriert beim Deploy.
// Default ist convention-based (Gen 2 URLs).
const SCRAPER_URL =
  process.env.SCRAPER_SCRAPE_EAN_URL ||
  `https://${SCRAPER_REGION}-${SCRAPER_PROJECT}.cloudfunctions.net/scrapeEan`;

/** Feuert async HTTP-POST zum Scraper. Fire-and-forget — wir warten
 *  NICHT auf das Ergebnis. Der Scraper schreibt in nutritionscrape,
 *  was den onNutritionScrapeWrite-Trigger feuert. */
async function fireScraperForEan(ean, productPath, productName) {
  const triggerKey = functions.config()?.nutritionscraper?.trigger_key;
  if (!triggerKey) {
    console.warn(
      '[auto-trigger] nutritionscraper.trigger_key not configured — skip scraper-fire',
    );
    return;
  }
  try {
    const params = new URLSearchParams({
      key: triggerKey,
      ean: String(ean),
      productPath: productPath || '',
      productName: productName || '',
    });
    // Kein await — fire & forget. Scraper läuft eigene Function.
    fetch(`${SCRAPER_URL}?${params.toString()}`, {
      method: 'GET',
      // 1-sek-timeout damit wir nicht aus Versehen warten.
      signal: AbortSignal.timeout(1500),
    }).catch(() => {
      // Erwartet — wir wollen nicht warten. Fehler wird ignoriert.
    });
  } catch (e) {
    console.warn('[auto-trigger] fireScraperForEan threw:', e?.message);
  }
}

async function handleProductCreate(snap, context, collectionName) {
  const product = snap.data();
  if (!product) return null;
  const docRef = snap.ref;

  try {
    const result = await processProduct(docRef, product, false);
    console.log(
      `[onCreate ${collectionName}/${snap.id}] processProduct → ${result.result}${
        result.reasons ? ` (${result.reasons.join(',')})` : ''
      }`,
    );

    // Wenn nichts gefunden wurde UND wir EANs haben → Scraper async
    // feuern. Der Scraper macht den teuren LLM-Lookup im Hintergrund;
    // sobald er was findet, triggert onNutritionScrapeWrite das
    // erneute processProduct.
    if (result.result === 'no_source_hit') {
      const eans = extractEans(product);
      if (eans.length > 0) {
        const ean = eans[0]; // Scraper iteriert sowieso alle EANs intern
        const productPath = `${collectionName}/${snap.id}`;
        await fireScraperForEan(ean, productPath, product.name);
        console.log(
          `[onCreate ${collectionName}/${snap.id}] fired scraper for EAN ${ean}`,
        );
      }
    }
  } catch (e) {
    console.error(`[onCreate ${collectionName}/${snap.id}] failed:`, e);
  }
  return null;
}

exports.onProdukteCreate = functions
  .region(REGION)
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('produkte/{productId}')
  .onCreate((snap, ctx) => handleProductCreate(snap, ctx, 'produkte'));

exports.onMarkenProdukteCreate = functions
  .region(REGION)
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('markenProdukte/{productId}')
  .onCreate((snap, ctx) => handleProductCreate(snap, ctx, 'markenProdukte'));

/** Wenn der Scraper ein Doc in nutritionscrape/<ean> schreibt,
 *  suchen wir produkte + markenProdukte mit dieser EAN und feuern
 *  processProduct, damit die Daten ans Produkt geschrieben werden
 *  (durch tryScraper in der priority chain). */
exports.onNutritionScrapeWrite = functions
  .region(REGION)
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('nutritionscrape/{ean}')
  .onWrite(async (change, ctx) => {
    if (!change.after.exists) return null; // Delete → ignore
    const ean = ctx.params.ean;
    if (!ean) return null;

    // Find products with matching EAN in either collection.
    // EAN kann in `EAN`, `gtin`, oder `EANs[]` stehen — wir prüfen
    // alle Varianten. `array-contains` für arrays + equality für
    // singles. Bis zu 6 Queries pro Collection (kombiniert via
    // Promise.all).
    const queries = [];
    for (const col of ['produkte', 'markenProdukte']) {
      for (const field of ['EAN', 'gtin']) {
        queries.push(db.collection(col).where(field, '==', ean).limit(5).get());
      }
      queries.push(db.collection(col).where('EANs', 'array-contains', ean).limit(5).get());
    }

    let snaps;
    try {
      snaps = await Promise.all(queries);
    } catch (e) {
      console.error(`[onNutritionScrapeWrite ${ean}] queries failed:`, e);
      return null;
    }

    const matched = new Map(); // path → { ref, data }
    for (const snap of snaps) {
      snap.forEach((d) => {
        const path = d.ref.path;
        if (!matched.has(path)) matched.set(path, { ref: d.ref, data: d.data() });
      });
    }

    if (matched.size === 0) {
      console.log(
        `[onNutritionScrapeWrite ${ean}] kein produkt/markenProdukt matched`,
      );
      return null;
    }

    let updated = 0;
    for (const { ref, data } of matched.values()) {
      try {
        const r = await processProduct(ref, data, false);
        if (r.result === 'updated') updated += 1;
      } catch (e) {
        console.warn(`[onNutritionScrapeWrite ${ean}] processProduct on ${ref.path} failed:`, e);
      }
    }
    console.log(
      `[onNutritionScrapeWrite ${ean}] ${matched.size} matched, ${updated} updated`,
    );
    return null;
  });

// ══ Scheduled Daily Backfill ══════════════════════════════════════
//
// Läuft nightly 02:30 Berlin durch alle produkte + markenProdukte
// und pickt Updates auf (z.B. neue reweapify-Einträge, frische
// nutritionscrape-Docs vom Scraper, neue OpenFood-Hits).
//
// Idempotent — trusted source skip ist schnell, untrusted sources
// werden mit newer-wins gewertet, processProduct skippt sauber.
// Bei rate-limit-cap auf openfood-Seite läuft der Scheduled-Job
// gestaffelt: produkte zuerst, dann markenProdukte. CF Timeout
// 540s — bei OpenFood-heavy Run reicht das normalerweise nicht für
// ALLE 10k+ Docs, aber wir cappen pro Source intelligent
// (in-memory Rate-Limit-Backoff stoppt OpenFood-Storm).
// ══════════════════════════════════════════════════════════════════

exports.scheduledBackfill = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every day 02:30')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    const startedAt = Date.now();
    console.log('🕓 scheduled daily backfill starting');
    const results = {};
    try {
      results.produkte = await runBackfill('produkte', null, false);
    } catch (e) {
      console.error('produkte backfill failed:', e);
    }
    try {
      results.markenProdukte = await runBackfill('markenProdukte', null, false);
    } catch (e) {
      console.error('markenProdukte backfill failed:', e);
    }
    console.log(
      `🕓 scheduled daily backfill done in ${Date.now() - startedAt}ms:`,
      JSON.stringify(results),
    );
    return null;
  });

// ══ Source-URL/Shop Migration ═════════════════════════════════════
//
// One-Shot Migration für Produkte die VOR Commit 3413390 mit Source
// 'rewe' oder 'openfood' geschrieben wurden — diese haben keine
// sourceUrl/sourceShop Felder. Da wir die Werte aus der Source
// ableiten können (rewe → 'rewe.de', openfood → openfoodfacts-URL),
// schreiben wir die Felder nachträglich rein. Werte werden nicht
// verändert, nur Metadaten angefügt.
//
// HTTPS-Trigger, idempotent (kann mehrfach laufen — nur Docs ohne
// sourceShop werden angefasst).
//
// Trigger:
//   curl "https://...cloudfunctions.net/migrateSourceUrls?key=<KEY>&collection=both"
// ══════════════════════════════════════════════════════════════════

async function migrateCollection(collectionName) {
  const stats = { scanned: 0, migrated: 0, skipped: 0, error: 0 };
  let lastDoc = null;
  let pageNum = 0;
  while (true) {
    pageNum += 1;
    let q = db.collection(collectionName).orderBy('__name__').limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchWrites = 0;
    snap.forEach((d) => {
      stats.scanned += 1;
      const x = d.data();
      const update = {};

      // Ingredients side
      if (x.ingredientsSource && !x.ingredientsSourceShop) {
        if (x.ingredientsSource === 'rewe') {
          update.ingredientsSourceShop = 'rewe.de';
        } else if (x.ingredientsSource === 'openfood') {
          update.ingredientsSourceShop = 'openfoodfacts.org';
          const ean = x.EAN || x.EANs?.[0];
          if (ean) {
            update.ingredientsSourceUrl = `https://world.openfoodfacts.org/product/${ean}`;
          }
        }
      }

      // Nutrition side
      if (x.nutritionSource && !x.nutritionSourceShop) {
        if (x.nutritionSource === 'rewe') {
          update.nutritionSourceShop = 'rewe.de';
        } else if (x.nutritionSource === 'openfood') {
          update.nutritionSourceShop = 'openfoodfacts.org';
          const ean = x.EAN || x.EANs?.[0];
          if (ean) {
            update.nutritionSourceUrl = `https://world.openfoodfacts.org/product/${ean}`;
          }
        }
      }

      if (Object.keys(update).length === 0) {
        stats.skipped += 1;
        return;
      }
      batch.update(d.ref, update);
      batchWrites += 1;
      stats.migrated += 1;
    });

    if (batchWrites > 0) {
      try {
        await batch.commit();
      } catch (e) {
        console.error(`migrate ${collectionName} page ${pageNum} batch failed:`, e);
        stats.error += batchWrites;
        stats.migrated -= batchWrites;
      }
    }

    console.log(
      `migrate ${collectionName} page ${pageNum}: scanned=${snap.size}, migrated=${batchWrites}`,
    );

    lastDoc = snap.docs[snap.docs.length - 1];
    if (pageNum > 1000) break;
  }
  return stats;
}

exports.migrateSourceUrls = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const expected = functions.config()?.nutritionbackfill?.trigger_key;
    if (!expected || req.query.key !== expected) {
      res.status(401).send('Unauthorized');
      return;
    }
    const collection = String(req.query.collection || 'both').toLowerCase();
    const startedAt = Date.now();
    try {
      const result = {};
      if (collection === 'produkte' || collection === 'both') {
        result.produkte = await migrateCollection('produkte');
      }
      if (
        collection === 'markenprodukte' ||
        collection === 'both'
      ) {
        result.markenProdukte = await migrateCollection('markenProdukte');
      }
      res.status(200).json({
        elapsedMs: Date.now() - startedAt,
        ...result,
      });
    } catch (e) {
      console.error('migrateSourceUrls failed:', e);
      res.status(500).send(String(e?.message || e));
    }
  });
