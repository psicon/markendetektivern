/**
 * EAN → URL(s) Resolver mit Shop-Priorität.
 *
 * Suche IMMER per GTIN (EAN), niemals per Produkt-Name. User-Vorgabe
 * 2026-05-17.
 *
 * Reihenfolge (1. Treffer wins):
 *   1. Direct-URL-Patterns für Shops die deterministische EAN-URLs
 *      haben (codecheck, product-search.net)
 *   2. Vertex AI Search über alle konfigurierten Shop-Domains. Die
 *      Resultate werden gemäß `SHOPS`-Prio-Reihenfolge in
 *      `domains.js` SORTIERT (codecheck > product-search > metro >
 *      globus > mein-aldi > knuspr > mytime > liefershop > gurkerl
 *      > interspar > roksh).
 *
 * Wenn Vertex AI nicht konfiguriert ist (DATASTORE_ID fehlt), wird
 * nur Direct-URL-Pfad genutzt. Codecheck allein deckt einen großen
 * Teil ab.
 */

const { getShopsInPriorityOrder, findShopByUrl, getShopPriority, SHOPS } = require('./domains');
const { searchByEan } = require('./vertexAiSearch');

/** Stage 1: Direct URL patterns für Shops mit deterministischen
 *  EAN-URLs. Returnt eine Liste in Prio-Reihenfolge. */
function resolveDirectUrls(ean) {
  if (!ean) return [];
  const urls = [];
  for (const shop of getShopsInPriorityOrder()) {
    if (typeof shop.directUrl === 'function') {
      try {
        const u = shop.directUrl(ean);
        if (typeof u === 'string' && u.startsWith('http')) {
          urls.push({ url: u, source: 'direct', shop: shop.name });
        }
      } catch (e) {
        console.warn(`[resolver] ${shop.name}.directUrl threw:`, e?.message);
      }
    }
  }
  return urls;
}

/** Stage 2: Vertex AI Search über alle indexed Shop-Domains.
 *  Resultate werden per Shop-Prio sortiert. */
async function resolveVertexAI(ean, { dataStoreId, location } = {}) {
  if (!ean || !dataStoreId) return [];
  const hits = await searchByEan({ ean, dataStoreId, location });
  if (hits.length === 0) return [];

  // Annotiere mit Shop-Match + Prio
  const annotated = hits
    .map((h) => {
      const shop = findShopByUrl(h.link);
      const priority = shop ? getShopPriority(shop.name) : Number.MAX_SAFE_INTEGER;
      return { url: h.link, source: 'vertex-ai', shop: shop?.name ?? null, priority };
    })
    // Sortiere nach Shop-Prio (kleiner = besser). Hits außerhalb der
    // SHOPS-Liste landen am Ende.
    .sort((a, b) => a.priority - b.priority);

  return annotated.map(({ url, source, shop }) => ({ url, source, shop }));
}

/** Hauptfunktion. Sammelt URL-Kandidaten in Prio-Reihenfolge.
 *  Dedupliziert. */
async function resolveCandidates(eans, { vertexAi } = {}) {
  if (!Array.isArray(eans) || eans.length === 0) return [];
  const seen = new Set();
  const out = [];
  const add = (entry) => {
    if (!entry?.url) return;
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    out.push(entry);
  };

  for (const ean of eans) {
    // Stage 1: Direct URLs (sehr schnell, keine API-Cost)
    for (const entry of resolveDirectUrls(ean)) add(entry);

    // Stage 2: Vertex AI über alle Shop-Domains
    if (vertexAi?.dataStoreId) {
      const vertexHits = await resolveVertexAI(ean, {
        dataStoreId: vertexAi.dataStoreId,
        location: vertexAi.location || 'global',
      });
      for (const entry of vertexHits) add(entry);
    }
  }

  return out;
}

module.exports = {
  resolveDirectUrls,
  resolveVertexAI,
  resolveCandidates,
  SHOPS,
};
