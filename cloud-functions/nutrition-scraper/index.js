/**
 * Nutrition-Scraper — Cloud Functions Gen 2 HTTPS-Trigger.
 *
 * Three HTTPS-Endpoints:
 *
 *   1. scrapeSingleUrl
 *      Body/Query: { ean, url, productName?, productPath? }
 *      Fetcht eine spezifische URL → Extract → Write.
 *      Für Tests + manuelle Recherchen.
 *
 *   2. scrapeEan
 *      Body/Query: { ean, productName?, productPath? }
 *      Resolver → mehrere URLs probieren → 1. Treffer wins.
 *      Für Einzel-Lookups (z.B. nach User-Feedback "fehlende Daten").
 *
 *   3. scrapeBatch
 *      Iteriert produkte + markenProdukte ohne irgendeine source.
 *      Pro Produkt: Resolver → 1. erfolgreicher Extract.
 *      Schreibt in nutritionscrape, sodass CF2-Backfill diese
 *      später als 'sonstiges'-Source einlesen kann.
 *      Throttle + Limit + dryRun-Modes.
 *
 * Auth: shared key in functions.config().nutritionscraper.trigger_key
 * Claude-API-Key: functions.config().anthropic.api_key
 * Google CSE (optional): functions.config().google.cse_key + cse_id
 */

const functions = require('firebase-functions/v2/https');
const params = require('firebase-functions/params');
const admin = require('firebase-admin');

const { fetchHtml } = require('./src/fetcher');
const { extractFromHtml } = require('./src/extractor');
const { resolveCandidates } = require('./src/resolver');
const { writeScrapeResult } = require('./src/writer');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Gen 2 Param-API für Secrets / Config. Migration-friendly weg von
// legacy functions.config(). Auf Deploy werden die Werte aus
// .env.<project> oder Secret Manager gelesen.
const TRIGGER_KEY = params.defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');
const ANTHROPIC_API_KEY = params.defineSecret('ANTHROPIC_API_KEY');
// Vertex AI Search (Nachfolger der deprecated Custom Search JSON API).
// Optional — wenn nicht gesetzt, wird nur Direct-URL-Pfad genutzt.
const VERTEX_AI_DATASTORE_ID = params.defineSecret('VERTEX_AI_SEARCH_DATASTORE_ID');
const VERTEX_AI_LOCATION = params.defineSecret('VERTEX_AI_SEARCH_LOCATION');

const REGION = 'europe-west1';
const COMMON_OPTS = {
  region: REGION,
  timeoutSeconds: 540, // Gen 2 erlaubt bis 3600; für jetzt 9 min
  memory: '1GiB',
};

function checkAuth(req, expected) {
  if (!expected) return false;
  const key = req.query?.key || req.body?.key;
  return key === expected;
}

function getEans(product) {
  if (!product) return [];
  const out = new Set();
  const candidates = [
    product.EAN,
    product.ean,
    product.gtin,
    product.GTIN,
    ...(Array.isArray(product.EANs) ? product.EANs : []),
    ...(Array.isArray(product.eans) ? product.eans : []),
  ];
  for (const v of candidates) {
    if (v == null) continue;
    const s = typeof v === 'number' ? String(v) : String(v).trim();
    if (s.length >= 8) out.add(s);
  }
  return [...out];
}

// ─── Endpoint 1: scrapeSingleUrl ──────────────────────────────────
exports.scrapeSingleUrl = functions.onRequest(
  {
    ...COMMON_OPTS,
    secrets: [TRIGGER_KEY, ANTHROPIC_API_KEY],
  },
  async (req, res) => {
    if (!checkAuth(req, TRIGGER_KEY.value())) {
      res.status(401).send('Unauthorized');
      return;
    }

    const { ean, url, productName, productPath } = req.method === 'POST'
      ? req.body
      : req.query;

    if (!ean || !url) {
      res.status(400).send('Missing ean or url param');
      return;
    }

    try {
      const fetched = await fetchHtml(url);
      if (!fetched) {
        res.status(200).json({ result: 'fetch_failed', url });
        return;
      }
      const extracted = await extractFromHtml({
        html: fetched.html,
        apiKey: ANTHROPIC_API_KEY.value(),
        productName,
      });
      if (!extracted) {
        res.status(200).json({ result: 'extract_failed', url });
        return;
      }
      const writeRes = await writeScrapeResult({
        ean: String(ean),
        productPath: productPath || null,
        extracted,
        sourceUrl: fetched.finalUrl,
      });
      res.status(200).json({ result: 'ok', extracted, write: writeRes });
    } catch (e) {
      console.error('[scrapeSingleUrl] error:', e);
      res.status(500).send(String(e?.message || e));
    }
  },
);

// ─── Endpoint 2: scrapeEan ────────────────────────────────────────
exports.scrapeEan = functions.onRequest(
  {
    ...COMMON_OPTS,
    secrets: [TRIGGER_KEY, ANTHROPIC_API_KEY, VERTEX_AI_DATASTORE_ID, VERTEX_AI_LOCATION],
  },
  async (req, res) => {
    if (!checkAuth(req, TRIGGER_KEY.value())) {
      res.status(401).send('Unauthorized');
      return;
    }

    const { ean, productName, productPath } = req.method === 'POST'
      ? req.body
      : req.query;

    if (!ean) {
      res.status(400).send('Missing ean param');
      return;
    }

    try {
      const datastoreId = VERTEX_AI_DATASTORE_ID.value();
      const location = VERTEX_AI_LOCATION.value() || 'global';
      const candidates = await resolveCandidates([String(ean)], {
        vertexAi: datastoreId
          ? { dataStoreId: datastoreId, location }
          : null,
      });

      if (candidates.length === 0) {
        res.status(200).json({ result: 'no_urls' });
        return;
      }

      // Versuche URLs sequentiell in Prio-Reihenfolge (codecheck →
      // product-search → metro → ...). 1. erfolgreicher Extract wins.
      for (const candidate of candidates) {
        const fetched = await fetchHtml(candidate.url);
        if (!fetched) continue;
        const extracted = await extractFromHtml({
          html: fetched.html,
          apiKey: ANTHROPIC_API_KEY.value(),
          productName,
        });
        if (!extracted) continue;
        const writeRes = await writeScrapeResult({
          ean: String(ean),
          productPath: productPath || null,
          extracted,
          sourceUrl: fetched.finalUrl,
        });
        res.status(200).json({
          result: 'ok',
          triedUrls: candidates.length,
          successUrl: fetched.finalUrl,
          successShop: candidate.shop,
          extracted,
          write: writeRes,
        });
        return;
      }
      res.status(200).json({ result: 'all_failed', triedUrls: candidates.length });
    } catch (e) {
      console.error('[scrapeEan] error:', e);
      res.status(500).send(String(e?.message || e));
    }
  },
);

// ─── Endpoint 3: scrapeBatch ──────────────────────────────────────
exports.scrapeBatch = functions.onRequest(
  {
    ...COMMON_OPTS,
    timeoutSeconds: 3600, // Gen 2 max 60min
    secrets: [TRIGGER_KEY, ANTHROPIC_API_KEY, VERTEX_AI_DATASTORE_ID, VERTEX_AI_LOCATION],
  },
  async (req, res) => {
    if (!checkAuth(req, TRIGGER_KEY.value())) {
      res.status(401).send('Unauthorized');
      return;
    }

    const params = req.method === 'POST' ? req.body : req.query;
    const collection = String(params.collection || 'produkte');
    const limit = params.limit ? parseInt(String(params.limit), 10) : 50;
    const dryRun = String(params.dryRun || '') === '1';

    if (collection !== 'produkte' && collection !== 'markenProdukte') {
      res.status(400).send('collection must be produkte or markenProdukte');
      return;
    }

    const stats = {
      scanned: 0,
      already_in_nutritionscrape: 0,
      scrape_ok: 0,
      scrape_failed: 0,
      no_eans: 0,
      no_urls: 0,
      error: 0,
    };
    const startedAt = Date.now();

    try {
      // Holen Produkte ohne nutritionSource (= weder rewe, openfood,
      // manual, scraper, legacy).
      const snap = await db
        .collection(collection)
        .where('nutritionSource', '==', null)
        // ↑ Firestore behandelt unset-Felder als 'null' in modernen
        // Versionen NICHT — wir wollen aber unset matchen. Fallback
        // unten: filter in-code.
        .limit(limit * 4) // overhead für client-side filter
        .get()
        .catch(() => null);

      let docs = [];
      if (snap && !snap.empty) {
        docs = snap.docs.filter((d) => !d.data()?.nutritionSource);
      } else {
        // Fallback: full scan limit-N (für Init-Use-Case wo `null`-
        // Query nicht greift)
        const fallback = await db.collection(collection).limit(limit * 4).get();
        docs = fallback.docs.filter((d) => !d.data()?.nutritionSource);
      }
      docs = docs.slice(0, limit);

      const datastoreId = VERTEX_AI_DATASTORE_ID.value();
      const location = VERTEX_AI_LOCATION.value() || 'global';
      const vertexCfg = datastoreId
        ? { dataStoreId: datastoreId, location }
        : null;
      const apiKey = ANTHROPIC_API_KEY.value();

      for (const d of docs) {
        stats.scanned += 1;
        const product = d.data();
        const eans = getEans(product);
        if (eans.length === 0) {
          stats.no_eans += 1;
          continue;
        }

        // Skip wenn schon in nutritionscrape
        const scrapeDoc = await db
          .collection('nutritionscrape')
          .doc(eans[0])
          .get();
        if (scrapeDoc.exists) {
          stats.already_in_nutritionscrape += 1;
          continue;
        }

        if (dryRun) {
          stats.scrape_ok += 1;
          continue;
        }

        const candidates = await resolveCandidates(eans, {
          vertexAi: vertexCfg,
        });
        if (candidates.length === 0) {
          stats.no_urls += 1;
          continue;
        }

        let success = false;
        for (const candidate of candidates) {
          const fetched = await fetchHtml(candidate.url);
          if (!fetched) continue;
          const extracted = await extractFromHtml({
            html: fetched.html,
            apiKey,
            productName: product?.name,
          });
          if (!extracted) continue;
          await writeScrapeResult({
            ean: eans[0],
            productPath: `${collection}/${d.id}`,
            extracted,
            sourceUrl: fetched.finalUrl,
          });
          success = true;
          break;
        }
        if (success) {
          stats.scrape_ok += 1;
        } else {
          stats.scrape_failed += 1;
        }
      }

      res.status(200).json({
        collection,
        limit,
        dryRun,
        elapsedMs: Date.now() - startedAt,
        ...stats,
      });
    } catch (e) {
      console.error('[scrapeBatch] error:', e);
      res.status(500).send(String(e?.message || e));
    }
  },
);
