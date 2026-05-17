/**
 * OpenFoodFacts-Adapter für nutrition-backfill (Node, Server-Side).
 *
 * Port des App-internen `lib/services/openfood.ts` ohne RN-spezifische
 * Abhängigkeiten (kein AsyncStorage, kein expo-constants, keine
 * Platform). Memory-Cache only — bei CF-Instanzen ist das pro Instanz
 * (cold-start löscht Cache), das ist OK weil reweapify zuerst greift
 * und OpenFood nur fuer ~6800 produkte angefragt wird.
 *
 * Mapping OpenFood → reweapify-Schema:
 *   ingredients_text_de || ingredients_text  → attr_ingredientStatement
 *   nutriments['energy-kcal_100g']           → nutr_Energie_val (kcal)
 *   nutriments.energy_100g (kJ)              → nutr_Energie_val (kcal, /4.184)
 *   nutriments.fat_100g                      → nutr_Fett_val (g)
 *   nutriments['saturated-fat_100g']         → nutr_FettdavongesttigteFettsuren_val
 *   nutriments.carbohydrates_100g            → nutr_Kohlenhydrate_val
 *   nutriments.sugars_100g                   → nutr_KohlenhydratedavonZucker_val
 *   nutriments.fiber_100g                    → nutr_Ballaststoffe_val
 *   nutriments.proteins_100g                 → nutr_Eiwei_val
 *   nutriments.salt_100g                     → nutr_Salz_val
 *
 * Timestamp-Source: OpenFood `last_modified_t` (UNIX seconds).
 */

const BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = [
  'code',
  'product_name',
  'ingredients_text_de',
  'ingredients_text',
  'nutriments',
  'last_modified_t',
].join(',');

const USER_AGENT =
  'MarkenDetektive-Backfill/1.0 (Cloud Functions; contact: patrick@markendetektive.de)';

const MEMORY_TTL_FOUND_MS = 60 * 60 * 1000; // 1h
const MEMORY_TTL_NOTFOUND_MS = 30 * 60 * 1000; // 30 min
const RATE_LIMIT_BACKOFF_MS = 60 * 1000; // 60s nach 429
// Min Abstand zwischen Network-Requests — gegen 429-Storm.
// 800ms = 75 req/min. OpenFoodFacts toleriert ~100/min mit UA,
// 800ms gibt Puffer. Wird vom Backfill bei sequentiellem Lookup
// automatisch erzwungen.
const MIN_REQUEST_INTERVAL_MS = 800;

const memoryCache = new Map(); // ean → { data, ts }
const inflight = new Map(); // ean → Promise
let rateLimitUntilMs = 0;
let lastNetworkRequestMs = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lädt ein Produkt für EINE EAN von OpenFood. Returnt:
 *   { found: true, ...parsed }  oder
 *   { found: false }
 *  Caching + Inflight-Dedup inkludiert. */
async function fetchByEan(ean) {
  // Inflight-Dedup
  const inflightPromise = inflight.get(ean);
  if (inflightPromise) return inflightPromise;

  const p = (async () => {
    // Memory-Cache
    const cached = memoryCache.get(ean);
    if (cached) {
      const ttl = cached.data.found ? MEMORY_TTL_FOUND_MS : MEMORY_TTL_NOTFOUND_MS;
      if (Date.now() - cached.ts < ttl) return cached.data;
    }

    // Rate-Limit-Backoff (post-429)
    if (Date.now() < rateLimitUntilMs) {
      return { code: ean, found: false };
    }

    // Pro-aktives Throttling: nicht häufiger als alle
    // MIN_REQUEST_INTERVAL_MS ein Network-Request. Mit ~800ms
    // Abstand bleiben wir unter den OpenFood-Limits selbst bei
    // tausenden produkte sequentieller Verarbeitung.
    const elapsed = Date.now() - lastNetworkRequestMs;
    if (elapsed < MIN_REQUEST_INTERVAL_MS) {
      await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
    }
    lastNetworkRequestMs = Date.now();

    const url = `${BASE_URL}/${ean}.json?fields=${FIELDS}`;
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      });
    } catch (e) {
      console.warn(`[openfood] fetch error for ${ean}:`, e?.message || e);
      return { code: ean, found: false };
    }

    if (resp.status === 429) {
      rateLimitUntilMs = Date.now() + RATE_LIMIT_BACKOFF_MS;
      console.warn(
        `[openfood] 429 rate-limited — backoff ${RATE_LIMIT_BACKOFF_MS / 1000}s`,
      );
      return { code: ean, found: false };
    }
    if (resp.status === 404 || (resp.status >= 400 && resp.status < 500)) {
      const notFound = { code: ean, found: false };
      memoryCache.set(ean, { data: notFound, ts: Date.now() });
      return notFound;
    }
    if (!resp.ok) {
      console.warn(`[openfood] HTTP ${resp.status} for ${ean}`);
      return { code: ean, found: false };
    }

    let json;
    try {
      json = await resp.json();
    } catch (e) {
      return { code: ean, found: false };
    }
    if (json.status !== 1 || !json.product) {
      const notFound = { code: ean, found: false };
      memoryCache.set(ean, { data: notFound, ts: Date.now() });
      return notFound;
    }

    const product = json.product;
    const parsed = {
      code: ean,
      found: true,
      product_name: product.product_name,
      ingredients_text_de: product.ingredients_text_de,
      ingredients_text: product.ingredients_text,
      nutriments: product.nutriments || {},
      last_modified_t: product.last_modified_t || 0,
    };
    memoryCache.set(ean, { data: parsed, ts: Date.now() });
    return parsed;
  })().finally(() => {
    inflight.delete(ean);
  });

  inflight.set(ean, p);
  return p;
}

/** Probiert EANs sequentiell, 1. Treffer wins. */
async function getProductByFirstEAN(eans) {
  if (!eans || eans.length === 0) return null;
  for (const ean of eans) {
    if (!ean) continue;
    try {
      const result = await fetchByEan(ean);
      if (result && result.found) return result;
    } catch {
      // continue
    }
  }
  return null;
}

/** True wenn der parsed-OpenFood-product brauchbare Zutaten hat. */
function hasIngredients(p) {
  if (!p) return false;
  const z =
    typeof p.ingredients_text_de === 'string' && p.ingredients_text_de.trim()
      ? p.ingredients_text_de.trim()
      : typeof p.ingredients_text === 'string' && p.ingredients_text.trim()
        ? p.ingredients_text.trim()
        : null;
  return !!z;
}

/** Extrahiert attr_ingredientStatement-String. */
function extractIngredientStatement(p) {
  if (!p) return null;
  const z = p.ingredients_text_de || p.ingredients_text;
  if (typeof z !== 'string') return null;
  const cleaned = z.replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** True wenn mindestens ein Nährwert-Wert in nutriments ist. */
function hasNutrition(p) {
  if (!p || !p.nutriments) return false;
  const n = p.nutriments;
  return (
    typeof n['energy-kcal_100g'] === 'number' ||
    typeof n.energy_100g === 'number' ||
    typeof n.fat_100g === 'number' ||
    typeof n['saturated-fat_100g'] === 'number' ||
    typeof n.carbohydrates_100g === 'number' ||
    typeof n.sugars_100g === 'number' ||
    typeof n.fiber_100g === 'number' ||
    typeof n.proteins_100g === 'number' ||
    typeof n.salt_100g === 'number'
  );
}

/** Map OpenFood nutriments → reweapify-Schema nutr_*_val/_unit. */
function extractNutrFields(p) {
  if (!p || !p.nutriments) return {};
  const n = p.nutriments;
  const out = {};

  // Energie in kcal — bevorzugt kcal, fallback kJ → konvertiert
  if (typeof n['energy-kcal_100g'] === 'number') {
    out.nutr_Energie_val = Math.round(n['energy-kcal_100g']);
    out.nutr_Energie_unit = 'kcal';
  } else if (typeof n.energy_100g === 'number') {
    out.nutr_Energie_val = Math.round(n.energy_100g / 4.184);
    out.nutr_Energie_unit = 'kcal';
  }

  if (typeof n.fat_100g === 'number') {
    out.nutr_Fett_val = n.fat_100g;
    out.nutr_Fett_unit = 'g';
  }
  if (typeof n['saturated-fat_100g'] === 'number') {
    out.nutr_FettdavongesttigteFettsuren_val = n['saturated-fat_100g'];
    out.nutr_FettdavongesttigteFettsuren_unit = 'g';
  }
  if (typeof n.carbohydrates_100g === 'number') {
    out.nutr_Kohlenhydrate_val = n.carbohydrates_100g;
    out.nutr_Kohlenhydrate_unit = 'g';
  }
  if (typeof n.sugars_100g === 'number') {
    out.nutr_KohlenhydratedavonZucker_val = n.sugars_100g;
    out.nutr_KohlenhydratedavonZucker_unit = 'g';
  }
  if (typeof n.fiber_100g === 'number') {
    out.nutr_Ballaststoffe_val = n.fiber_100g;
    out.nutr_Ballaststoffe_unit = 'g';
  }
  if (typeof n.proteins_100g === 'number') {
    out.nutr_Eiwei_val = n.proteins_100g;
    out.nutr_Eiwei_unit = 'g';
  }
  if (typeof n.salt_100g === 'number') {
    out.nutr_Salz_val = n.salt_100g;
    out.nutr_Salz_unit = 'g';
  }

  if (Object.keys(out).length === 0) return {};

  // serving — default 100g
  out.nutr_serving_size = 100;
  out.nutr_serving_unit = 'g';
  return out;
}

module.exports = {
  getProductByFirstEAN,
  hasIngredients,
  hasNutrition,
  extractIngredientStatement,
  extractNutrFields,
};
