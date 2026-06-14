/**
 * external-product-lookup — Server-side port of the client EAN-lookup
 * cascade.
 *
 * ──────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ──────────────────────────────────────────────────────────────────────
 * `external_products/{ean}` (and the `external_lookup_misses` backlog) must
 * be written with ADMIN rights — Firestore rules block client writes. The
 * cascade previously ran client-side in
 *   lib/services/externalProductService.ts
 * which only worked because the rules were (temporarily) open. This CF moves
 * the entire cascade server-side so the client can call it and let the CF do
 * the privileged writes.
 *
 * This file is a 1:1 PORT of lib/services/externalProductService.ts +
 * lib/services/openfood.ts (getProductByEAN) +
 * lib/services/scrapedProductsService.ts (searchScrapedProductByGTIN).
 * Keep them IN SYNC — if you change a normalizer, priority, threshold, or
 * the cascade order here, mirror it in the client service (and vice-versa).
 * The normalizers (normaliseReweapify / normaliseOpenFood / normaliseScraped /
 * parseLeadingNumber) are copied VERBATIM, only TS types stripped.
 *
 * ──────────────────────────────────────────────────────────────────────
 * SERVER-SIDE ADAPTATIONS vs. the client
 * ──────────────────────────────────────────────────────────────────────
 *  • The client fired writes fire-and-forget (`void writeThrough(...)`).
 *    A CF terminates as soon as it responds, so fire-and-forget writes
 *    would be LOST. Here `writeThrough`, `recordMiss`, `stampUpgradeAttempt`
 *    are AWAITED before responding.
 *  • `refreshSilent` (client's fire-and-forget background refresh of a stale
 *    high-priority doc): in the CF we do NOT background-refresh. We simply
 *    return the cached doc (stale data is better than a slow response, and
 *    the next call will re-evaluate staleness). See the comment in
 *    `lookupByEAN`. We deliberately skip it rather than `void`-fire it,
 *    because a fire-and-forget write here would be dropped at termination.
 *  • Globus is DISABLED (GLOBUS_ENABLED=false, mirrors the client). No
 *    globus endpoint is called.
 *  • Firestore: firebase-admin instead of @react-native-firebase. Admin
 *    Timestamps support `.toMillis()` so the cooldown read works unchanged.
 *  • OpenFood: plain Node global `fetch` (Node 22). AsyncStorage / Memory
 *    caches dropped (no per-process persistence needed; the
 *    external_products doc IS the cache). Rate-limit 429 backoff is stored
 *    in Firestore `_meta/openFoodRateLimit` (best-effort, cross-invocation).
 */

'use strict';

const admin = require('firebase-admin');
const { logger } = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');

if (!admin.apps.length) admin.initializeApp();

const REGION = 'europe-west1';

// ─── Constants (mirror lib/services/externalProductService.ts) ──────────

const COLLECTION = 'external_products';
const MISSES_COLLECTION = 'external_lookup_misses';

// Wie alt darf ein cached Eintrag sein bevor wir frisch fetchen. (4 Wochen)
// Mirror of EXTERNAL_CACHE_MAX_AGE_MS in lib/types/externalProduct.ts.
const EXTERNAL_CACHE_MAX_AGE_MS = 4 * 7 * 24 * 60 * 60 * 1000; // 4 Wochen

// Default-Status für neue Miss-Docs (mirror EXTERNAL_MISS_DEFAULT_STATUS).
const EXTERNAL_MISS_DEFAULT_STATUS = 'pending';

// Wie lange nach einem (erfolglosen) Online-Upgrade-Versuch für eine
// schwache (openfood-)Quelle NICHT erneut versucht wird. (7 Tage)
const UPGRADE_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

// Globus ist deaktiviert — mirror des Clients (GLOBUS_ENABLED=false). Wir
// rufen KEINEN globus-Endpoint auf. tryGlobus ist ein No-Op.
const GLOBUS_ENABLED = false;

// Source-Priority-Order. Niedriger Index = bessere Quelle.
const SOURCE_PRIORITY = ['rewe', 'globus', 'metro', 'scraper', 'openfood'];
const UPGRADE_THRESHOLD_INDEX = SOURCE_PRIORITY.indexOf('openfood'); // 4

function sourcePriority(s) {
  const i = SOURCE_PRIORITY.indexOf(s);
  return i === -1 ? 99 : i;
}

// ─── Firestore helpers ──────────────────────────────────────────────────

function db() {
  return admin.firestore();
}

/** Normalisiert einen EAN-String auf nur Ziffern (Doc-Id-safe). */
function normaliseEan(ean) {
  return String(ean ?? '').trim().replace(/\D/g, '');
}

/**
 * True wenn ein Eintrag älter als die Cache-Lebenszeit ist und neu
 * gefetched werden sollte. `cachedAt` ist ein admin Timestamp.
 */
function isExternalCacheStale(cachedAt) {
  if (!cachedAt) return true;
  const ts = cachedAt.toMillis ? cachedAt.toMillis() : 0;
  return Date.now() - ts > EXTERNAL_CACHE_MAX_AGE_MS;
}

/**
 * Liest einen Eintrag aus der external_products-Collection. Gibt das Doc
 * zurück egal ob frisch oder stale — Stale-Check macht der Caller.
 */
async function getCached(ean) {
  const norm = normaliseEan(ean);
  if (!norm) return null;
  try {
    const snap = await db().collection(COLLECTION).doc(norm).get();
    if (!snap.exists) return null;
    return snap.data();
  } catch (e) {
    logger.warn('getCached failed', { err: e && e.message });
    return null;
  }
}

/**
 * Schreibt einen normalisierten Source-Treffer in den Cache.
 * SERVER-SIDE: AWAITED (client fired this fire-and-forget). merge:true
 * damit eine zweite Source ergänzende Felder nachschieben kann ohne
 * bessere Daten zu kippen.
 */
async function writeThrough(ean, source, data) {
  const norm = normaliseEan(ean);
  if (!norm) return;
  try {
    const payload = {
      ...data,
      ean: norm,
      source,
      cachedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await db().collection(COLLECTION).doc(norm).set(payload, { merge: true });
  } catch (e) {
    logger.warn('writeThrough failed', { err: e && e.message });
  }
}

/**
 * Stempelt `lastUpgradeAttemptAt = now` auf das Cache-Doc, damit künftige
 * Lookups innerhalb der Cooldown-Frist KEINE erneute Online-Upgrade-
 * Cascade anstoßen. SERVER-SIDE: AWAITED (client fired fire-and-forget).
 */
async function stampUpgradeAttempt(ean) {
  const norm = normaliseEan(ean);
  if (!norm) return;
  try {
    await db()
      .collection(COLLECTION)
      .doc(norm)
      .set(
        { lastUpgradeAttemptAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
  } catch {
    // egal — Cooldown ist Best-Effort
  }
}

/**
 * Schreibt / aktualisiert ein "Miss"-Doc für eine EAN deren Cascade keinen
 * oder nur einen schwachen Hit (openfood) lieferte. Upsert via merge:true:
 *   • Erste Sichtung → firstSeenAt = now, status = 'pending', hitCount = 1
 *   • Folge-Sichtung → lastSeenAt = now, hitCount + 1
 * Throwt NIE. SERVER-SIDE: AWAITED (client fired fire-and-forget).
 */
async function recordMiss(ean, triedSources, bestSource) {
  const norm = normaliseEan(ean);
  if (!norm) return;
  try {
    const ref = db().collection(MISSES_COLLECTION).doc(norm);

    // Erst lesen damit wir wissen ob firstSeenAt schon existiert (sonst
    // würde merge: true es überschreiben).
    let exists = false;
    try {
      const snap = await ref.get();
      exists = snap.exists;
    } catch {
      exists = false;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const payload = {
      ean: norm,
      lastSeenAt: now,
      hitCount: admin.firestore.FieldValue.increment(1),
      triedSources,
      bestSource: bestSource ?? null,
    };
    if (!exists) {
      payload.firstSeenAt = now;
      payload.status = EXTERNAL_MISS_DEFAULT_STATUS;
    }

    await ref.set(payload, { merge: true });
    logger.info('[miss] recorded', {
      ean: norm,
      bestSource: bestSource ?? 'null',
      tried: triedSources.join(','),
    });
  } catch (e) {
    logger.warn('recordMiss failed (non-blocking)', { err: e && e.message });
  }
}

// ─── Source-Normalizer (copied VERBATIM, TS types stripped) ─────────────
//
// Jeder Normalizer mappt eine Source-spezifische Datenstruktur auf das
// uniform ExternalProductDoc-Schema (ohne ean/source/cachedAt — die
// schreibt writeThrough).

function normaliseScraped(p) {
  const image =
    p.thumbnails && p.thumbnails.length > 0
      ? p.thumbnails[0]
      : p.images && p.images.length > 0
      ? p.images[0]
      : undefined;
  return {
    productName: p.productName,
    brandName: p.brandName,
    manufacturerName: p.producer,
    manufacturerRef: p.master_manufacturer_id ?? p.herstellerId,
    imageUrl: image,
    price: typeof p.price === 'number' ? p.price : undefined,
    packSize: p.itemSize,
    category: p.productCategory,
    productDescription: p.productDescription,
    attr_ingredientStatement: p.ingredients,
    allergen_gluten: p.allergens_gluten,
    allergen_milk: p.allergens_milk,
    allergen_egg: p.allergens_egg,
    allergen_nuts: p.allergens_nuts,
    allergen_soy: p.allergens_soy,
    isVegan: p.isVegan,
    isVegetarian: p.isVegetarian,
    isGlutenFree: p.isGlutenFree,
    isLactoseFree: p.isLactoseFree,
    // ScrapedProduct hat Nutrition als string-Felder ("12,5 g") — wir
    // parsen den führenden Float raus, Unit hardcoded weil das
    // Reweapify-Schema sie kennt.
    nutr_Energie_val: parseLeadingNumber(p.nutrition_caloriesKcal),
    nutr_Energie_unit: 'kcal',
    nutr_Fett_val: parseLeadingNumber(p.nutrition_totalFat),
    nutr_Fett_unit: 'g',
    nutr_FettdavongesttigteFettsuren_val: parseLeadingNumber(p.nutrition_saturatedFat),
    nutr_FettdavongesttigteFettsuren_unit: 'g',
    nutr_Kohlenhydrate_val: parseLeadingNumber(p.nutrition_totalCarbohydrates),
    nutr_Kohlenhydrate_unit: 'g',
    nutr_KohlenhydratedavonZucker_val: parseLeadingNumber(p.nutrition_sugar),
    nutr_KohlenhydratedavonZucker_unit: 'g',
    nutr_Eiwei_val: parseLeadingNumber(p.nutrition_protein),
    nutr_Eiwei_unit: 'g',
    nutr_Salz_val: parseLeadingNumber(p.nutrition_salt),
    nutr_Salz_unit: 'g',
    nutr_serving_size: parseLeadingNumber(p.nutrition_servingSize) ?? 100,
    nutr_serving_unit: 'g',
    raw: p,
  };
}

function normaliseOpenFood(p) {
  const n = p.nutriments ?? {};
  const allergens = p.allergens_tags ?? [];
  const has = (s) => allergens.some((t) => t.toLowerCase().includes(s));
  return {
    productName: p.product_name ?? p.generic_name ?? 'Unbekannt',
    brandName: p.brands,
    imageUrl: p.image_front_url ?? p.image_url,
    packSize: p.quantity,
    category: p.categories,
    attr_ingredientStatement: p.ingredients_text_de ?? p.ingredients_text,
    nutr_Energie_val:
      typeof n['energy-kcal_100g'] === 'number'
        ? n['energy-kcal_100g']
        : undefined,
    nutr_Energie_unit: 'kcal',
    nutr_Fett_val: typeof n.fat_100g === 'number' ? n.fat_100g : undefined,
    nutr_Fett_unit: 'g',
    nutr_FettdavongesttigteFettsuren_val:
      typeof n['saturated-fat_100g'] === 'number'
        ? n['saturated-fat_100g']
        : undefined,
    nutr_FettdavongesttigteFettsuren_unit: 'g',
    nutr_Kohlenhydrate_val:
      typeof n.carbohydrates_100g === 'number' ? n.carbohydrates_100g : undefined,
    nutr_Kohlenhydrate_unit: 'g',
    nutr_KohlenhydratedavonZucker_val:
      typeof n.sugars_100g === 'number' ? n.sugars_100g : undefined,
    nutr_KohlenhydratedavonZucker_unit: 'g',
    nutr_Ballaststoffe_val:
      typeof n.fiber_100g === 'number' ? n.fiber_100g : undefined,
    nutr_Ballaststoffe_unit: 'g',
    nutr_Eiwei_val: typeof n.proteins_100g === 'number' ? n.proteins_100g : undefined,
    nutr_Eiwei_unit: 'g',
    nutr_Salz_val: typeof n.salt_100g === 'number' ? n.salt_100g : undefined,
    nutr_Salz_unit: 'g',
    nutr_serving_size: 100,
    nutr_serving_unit: 'g',
    allergen_gluten: has('gluten'),
    allergen_milk: has('milk') || has('milch'),
    allergen_egg: has('egg') || has('ei'),
    allergen_nuts: has('nut') || has('nuss'),
    allergen_soy: has('soy') || has('soja'),
    scoreNutri: p.nutriscore_grade,
    scoreEco: p.ecoscore_grade,
    scoreNova: typeof p.nova_group === 'number' ? String(p.nova_group) : undefined,
    raw: p,
  };
}

/** Parst den führenden Float aus Strings wie "12,5 g" → 12.5. */
function parseLeadingNumber(s) {
  if (!s || typeof s !== 'string') return undefined;
  const m = s.trim().replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

function normaliseReweapify(data) {
  // ACHTUNG: reweapify-Schema benutzt eigene Feld-Namen. Echte Felder:
  //   - image: string (single, nicht array)
  //   - price_current / price_regular: number
  //   - price_grammage: string ("130g (1 kg = 23 €)")
  //   - attr_BrandId / brandKey: string (Marke, z.B. "Kerrygold")
  //   - attr_ContactName: string (Hersteller-Firma)
  //   - url: string (REWE-Shop-URL)
  //   - merchant_company: string ("Rewe")
  // Wir fallen für jedes Feld auf alte Namen zurück damit Daten aus
  // anderen Sources (nutritionscrape Multi-Shop) noch greifen.
  const image =
    (typeof data?.image === 'string' && data.image) ||
    (Array.isArray(data?.images) && data.images[0]) ||
    data?.productImageUrl ||
    data?.attr_image ||
    undefined;
  // Pack-Size: aus price_grammage extrahieren ("130g (1 kg = 23 €)" → "130g")
  let packSize;
  if (typeof data?.price_grammage === 'string' && data.price_grammage) {
    const m = data.price_grammage.match(/^([^(]+)/);
    packSize = m ? m[1].trim() : data.price_grammage;
  } else if (
    typeof data?.attr_packageSize === 'number' &&
    data?.attr_packageUnit
  ) {
    packSize = `${data.attr_packageSize} ${data.attr_packageUnit}`;
  } else if (typeof data?.attr_preisPackgroesse === 'string') {
    packSize = data.attr_preisPackgroesse;
  } else {
    packSize = data?.itemSize;
  }
  return {
    productName:
      data?.productName ?? data?.attr_productName ?? data?.title ?? 'Produkt',
    brandName:
      data?.attr_BrandId ??
      data?.brandKey ??
      data?.brandName ??
      data?.attr_brand ??
      data?.attr_marke,
    manufacturerName:
      data?.attr_ContactName ?? data?.attr_hersteller ?? data?.producer,
    imageUrl: image,
    price:
      typeof data?.price_current === 'number'
        ? data.price_current
        : typeof data?.price_regular === 'number'
        ? data.price_regular
        : typeof data?.attr_preis === 'number'
        ? data.attr_preis
        : typeof data?.price === 'number'
        ? data.price
        : undefined,
    packSize,
    category:
      data?.productCategory ??
      data?.attr_category ??
      (typeof data?.productGroupId === 'string' ? data.productGroupId : undefined),
    sourceUrl: data?.scrapedUrl ?? data?.url ?? undefined,
    attr_ingredientStatement: data?.attr_ingredientStatement,
    nutr_Energie_val: typeof data?.nutr_Energie_val === 'number' ? data.nutr_Energie_val : undefined,
    nutr_Energie_unit: data?.nutr_Energie_unit,
    nutr_Fett_val: typeof data?.nutr_Fett_val === 'number' ? data.nutr_Fett_val : undefined,
    nutr_Fett_unit: data?.nutr_Fett_unit,
    nutr_FettdavongesttigteFettsuren_val:
      typeof data?.nutr_FettdavongesttigteFettsuren_val === 'number'
        ? data.nutr_FettdavongesttigteFettsuren_val
        : undefined,
    nutr_FettdavongesttigteFettsuren_unit: data?.nutr_FettdavongesttigteFettsuren_unit,
    nutr_Kohlenhydrate_val:
      typeof data?.nutr_Kohlenhydrate_val === 'number' ? data.nutr_Kohlenhydrate_val : undefined,
    nutr_Kohlenhydrate_unit: data?.nutr_Kohlenhydrate_unit,
    nutr_KohlenhydratedavonZucker_val:
      typeof data?.nutr_KohlenhydratedavonZucker_val === 'number'
        ? data.nutr_KohlenhydratedavonZucker_val
        : undefined,
    nutr_KohlenhydratedavonZucker_unit: data?.nutr_KohlenhydratedavonZucker_unit,
    nutr_Ballaststoffe_val:
      typeof data?.nutr_Ballaststoffe_val === 'number' ? data.nutr_Ballaststoffe_val : undefined,
    nutr_Ballaststoffe_unit: data?.nutr_Ballaststoffe_unit,
    nutr_Eiwei_val: typeof data?.nutr_Eiwei_val === 'number' ? data.nutr_Eiwei_val : undefined,
    nutr_Eiwei_unit: data?.nutr_Eiwei_unit,
    nutr_Salz_val: typeof data?.nutr_Salz_val === 'number' ? data.nutr_Salz_val : undefined,
    nutr_Salz_unit: data?.nutr_Salz_unit,
    nutr_serving_size: data?.nutr_serving_size ?? 100,
    nutr_serving_unit: data?.nutr_serving_unit ?? 'g',
    scoreNutri: data?.attr_nutri_score,
    scoreEco: data?.attr_eco_score,
    isVegan: data?.attr_isVegan,
    isVegetarian: data?.attr_isVegetarisch,
    raw: data,
  };
}

// ─── OpenFood (port of lib/services/openfood.ts getProductByEAN) ────────
//
// Plain Node global fetch (Node 22). AsyncStorage / Memory caches dropped
// — the external_products doc IS the cache. 429-Backoff cross-invocation
// in Firestore `_meta/openFoodRateLimit` (best-effort).

const OPENFOOD_BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
const OPENFOOD_FIELDS = [
  'code',
  'product_name',
  'brands',
  'categories',
  'ingredients_text_de',
  'ingredients_text',
  'nutriments',
  'nutriscore_grade',
  'ecoscore_grade',
  'nova_group',
  'image_url',
  'image_front_url',
  'quantity',
  'allergens_tags',
  'manufacturing_places',
  'generic_name',
].join(',');
// Hardcoded UA — OFF rate-limits anonymous (no-UA) requests aggressively.
const OPENFOOD_USER_AGENT = 'MarkenDetektive-CF/1.0 (+patrick@markendetektive.de)';
const OPENFOOD_RATE_LIMIT_BACKOFF_MS = 30 * 1000; // 30 s (mirror client)
const OPENFOOD_RATE_LIMIT_DOC = '_meta/openFoodRateLimit';

/** Liest das (best-effort) Rate-Limit-Window aus Firestore. */
async function readOpenFoodRateLimitUntilMs() {
  try {
    const snap = await db().doc(OPENFOOD_RATE_LIMIT_DOC).get();
    if (!snap.exists) return 0;
    const v = snap.data()?.rateLimitUntilMs;
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/** Schreibt ein neues Rate-Limit-Window nach einem 429. Best-effort. */
async function writeOpenFoodRateLimit(untilMs) {
  try {
    await db()
      .doc(OPENFOOD_RATE_LIMIT_DOC)
      .set(
        {
          rateLimitUntilMs: untilMs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch {
    // egal — Backoff ist Best-Effort
  }
}

/**
 * Lädt Produktdaten von OpenFoodFacts. Returnt ein OpenFoodProduct-Shape
 * ({ code, found, ... }) oder null bei transientem Fehler. Behält das
 * openfood result→normaliseOpenFood Mapping identisch (gleiche Keys).
 */
async function openFoodGetProductByEAN(ean) {
  try {
    // Rate-Limit Backoff (cross-invocation via Firestore). Wenn wir
    // kürzlich 429 sahen, skip den Network-Hit. Returnt als not-found.
    const rateLimitUntilMs = await readOpenFoodRateLimitUntilMs();
    if (Date.now() < rateLimitUntilMs) {
      const secsLeft = Math.ceil((rateLimitUntilMs - Date.now()) / 1000);
      logger.warn('OpenFood rate-limited — skipping fetch', { ean, secsLeft });
      return { code: ean, found: false };
    }

    const url = `${OPENFOOD_BASE_URL}/${ean}.json?fields=${OPENFOOD_FIELDS}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': OPENFOOD_USER_AGENT,
        Accept: 'application/json',
      },
    });

    // 429 → Rate-Limit-Backoff aktivieren. KEIN Cache-Write — das Produkt
    // existiert ja möglicherweise, wir konnten gerade nur nicht abfragen.
    if (response.status === 429) {
      await writeOpenFoodRateLimit(Date.now() + OPENFOOD_RATE_LIMIT_BACKOFF_MS);
      logger.warn('OpenFood 429 — backoff aktiviert', {
        backoffMs: OPENFOOD_RATE_LIMIT_BACKOFF_MS,
      });
      return { code: ean, found: false };
    }

    // 404 (oder andere 4xx ≠ 429) = "EAN nicht in OpenFood-DB". Normaler
    // Fall — kein Error, einfach als not-found behandeln.
    if (
      response.status === 404 ||
      (response.status >= 400 && response.status < 500 && response.status !== 429)
    ) {
      logger.info('OpenFood: EAN not in DB', { ean, status: response.status });
      return { code: ean, found: false };
    }

    if (!response.ok) {
      // 5xx → echter Server-Fehler. Werfen damit der catch ihn loggt
      // (transient, kann später wieder gehen).
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.status !== 1 || !result.product) {
      logger.info('OpenFood: EAN not found (body status)', {
        ean,
        status: result.status,
      });
      return { code: ean, found: false };
    }

    const product = {
      code: ean,
      product_name: result.product.product_name,
      brands: result.product.brands,
      categories: result.product.categories,
      ingredients_text_de: result.product.ingredients_text_de,
      ingredients_text: result.product.ingredients_text,
      nutriments: result.product.nutriments,
      nutriscore_grade: result.product.nutriscore_grade
        ? result.product.nutriscore_grade.toUpperCase()
        : undefined,
      ecoscore_grade: result.product.ecoscore_grade
        ? result.product.ecoscore_grade.toUpperCase()
        : undefined,
      nova_group: result.product.nova_group,
      image_url: result.product.image_url,
      image_front_url: result.product.image_front_url,
      quantity: result.product.quantity,
      allergens_tags: result.product.allergens_tags,
      manufacturing_places: result.product.manufacturing_places,
      generic_name: result.product.generic_name,
      found: true,
    };

    logger.info('OpenFood Daten geladen', { name: product.product_name });
    return product;
  } catch (error) {
    // Nur warn — echte Server-Fehler (5xx) / Network-Issues sind transient.
    logger.warn('OpenFood transient error', { ean, err: error && error.message });
    return null;
  }
}

// ─── scraped_products (port of searchScrapedProductByGTIN) ──────────────

async function searchScrapedProductByGTIN(gtin) {
  try {
    const snap = await db()
      .collection('scraped_products')
      .where('gtin', '==', gtin)
      .limit(1)
      .get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const product = { id: doc.id, ...doc.data() };
      logger.info('Found scraped product', { name: product.productName });
      return product;
    }
    return null;
  } catch (error) {
    logger.warn('searchScrapedProductByGTIN failed', {
      err: error && error.message,
    });
    return null;
  }
}

// ─── Source-Tries ───────────────────────────────────────────────────────

async function tryReweapify(ean) {
  const norm = normaliseEan(ean);
  if (!norm) return null;
  let docData = null;

  // String-Query (Standard — gtin ist als String gespeichert).
  try {
    const asString = await db()
      .collection('reweapify')
      .where('gtin', '==', norm)
      .limit(1)
      .get();
    if (!asString.empty) {
      docData = asString.docs[0].data();
      logger.info('[reweapify] hit-by-string', { ean: norm });
    }
  } catch (e) {
    logger.warn('[reweapify] STRING-QUERY ERROR', {
      code: e && e.code,
      msg: e && e.message,
    });
  }

  // Number-Query Fallback nur wenn String nichts gefunden hat.
  if (!docData) {
    try {
      const eanNum = Number(norm);
      if (Number.isFinite(eanNum)) {
        const asNumber = await db()
          .collection('reweapify')
          .where('gtin', '==', eanNum)
          .limit(1)
          .get();
        if (!asNumber.empty) {
          docData = asNumber.docs[0].data();
          logger.info('[reweapify] hit-by-number', { ean: norm });
        }
      }
    } catch (e) {
      logger.warn('[reweapify] NUMBER-QUERY ERROR', {
        code: e && e.code,
        msg: e && e.message,
      });
    }
  }

  if (!docData) {
    logger.info('[reweapify] no doc', { gtin: norm });
    return null;
  }

  try {
    const normalised = normaliseReweapify(docData);
    if (!normalised.productName || normalised.productName === 'Produkt') {
      if (!docData?.attr_ingredientStatement && !normalised.imageUrl) {
        logger.info('[reweapify] doc found but no useful data, skipping');
        return null;
      }
    }
    await writeThrough(norm, 'rewe', normalised);
    return {
      ...normalised,
      ean: norm,
      source: 'rewe',
      cachedAt: admin.firestore.Timestamp.fromMillis(Date.now()),
    };
  } catch (e) {
    logger.warn('[reweapify] normalise failed', { msg: e && e.message });
    return null;
  }
}

async function tryNutritionScrape(ean) {
  try {
    const norm = normaliseEan(ean);
    if (!norm) return null;
    const snap = await db().collection('nutritionscrape').doc(norm).get();
    if (!snap.exists) {
      logger.info('[nutritionscrape] no doc', { ean: norm });
      return null;
    }
    const data = snap.data();
    if (!data) return null;
    logger.info('[nutritionscrape] doc found', {
      ean: norm,
      sourceShop: data?.sourceShop ?? '?',
    });
    // Schema fast identisch zu reweapify — gleicher Normalizer.
    const normalised = normaliseReweapify(data);
    // Wenn weder Name noch Image noch Zutaten → nichts wertvolles.
    if (
      (!normalised.productName || normalised.productName === 'Produkt') &&
      !normalised.imageUrl &&
      !normalised.attr_ingredientStatement
    ) {
      logger.info('[nutritionscrape] doc has no useful data, skipping');
      return null;
    }
    // Sub-Source aus sourceShop (rewe.de/globus.de/…). Unklar → 'scraper'.
    const shop = String(data?.sourceShop ?? '').toLowerCase();
    let subSource = 'scraper';
    if (shop.includes('rewe')) subSource = 'rewe';
    else if (shop.includes('globus')) subSource = 'globus';
    else if (shop.includes('metro')) subSource = 'metro';
    else if (shop) subSource = shop.split('.')[0];
    await writeThrough(norm, subSource, normalised);
    return {
      ...normalised,
      ean: norm,
      source: subSource,
      cachedAt: admin.firestore.Timestamp.fromMillis(Date.now()),
    };
  } catch (e) {
    logger.warn('tryNutritionScrape failed', { err: e && e.message });
    return null;
  }
}

async function tryRewe(ean) {
  try {
    const scraped = await searchScrapedProductByGTIN(normaliseEan(ean));
    if (!scraped) return null;
    const normalised = normaliseScraped(scraped);
    await writeThrough(ean, 'rewe', normalised);
    return {
      ...normalised,
      ean: normaliseEan(ean),
      source: 'rewe',
      cachedAt: admin.firestore.Timestamp.fromMillis(Date.now()),
    };
  } catch (e) {
    logger.warn('tryRewe failed', { err: e && e.message });
    return null;
  }
}

// Globus ist deaktiviert (mirror client). No-Op, KEIN HTTP-Call.
async function tryGlobus(_ean) {
  if (!GLOBUS_ENABLED) return null;
  // (Wenn jemals aktiviert: hier den globus-CF-Call + normaliseScraped +
  // writeThrough(ean,'globus',...) ergänzen. Mirror den Client.)
  return null;
}

async function tryOpenFood(ean) {
  try {
    const off = await openFoodGetProductByEAN(normaliseEan(ean));
    if (!off || !off.found) return null;
    const normalised = normaliseOpenFood(off);
    await writeThrough(ean, 'openfood', normalised);
    return {
      ...normalised,
      ean: normaliseEan(ean),
      source: 'openfood',
      cachedAt: admin.firestore.Timestamp.fromMillis(Date.now()),
    };
  } catch (e) {
    logger.warn('tryOpenFood failed', { err: e && e.message });
    return null;
  }
}

/**
 * Probiert nur Sources mit höherer Priorität als openfood (Cache-Upgrade-
 * Pfad). Returnt das BESTE Resultat das gefunden wird.
 */
async function tryHigherPrioritySources(ean) {
  const r1 = await tryReweapify(ean);
  if (r1) return r1;
  const r2 = await tryNutritionScrape(ean);
  if (r2) return r2;
  const r3 = await tryRewe(ean);
  if (r3) return r3;
  const r4 = await tryGlobus(ean);
  if (r4) return r4;
  return null;
}

/**
 * Volle Cascade ohne Cache-Check. Reihenfolge:
 *   reweapify → nutritionscrape → scraped_products → globus(off) → openfood.
 * Returnt null wenn ALLE Sources versagen. SERVER-SIDE: recordMiss AWAITED.
 */
async function runFullCascade(ean) {
  const tried = [];

  const fromReweapify = await tryReweapify(ean);
  tried.push('reweapify');
  if (fromReweapify) {
    logger.info('[external-lookup] reweapify hit');
    return { product: fromReweapify, fromCache: false, refreshed: false };
  }

  const fromScrape = await tryNutritionScrape(ean);
  tried.push('nutritionscrape');
  if (fromScrape) {
    logger.info('[external-lookup] nutritionscrape hit', {
      source: fromScrape.source,
    });
    return { product: fromScrape, fromCache: false, refreshed: false };
  }

  const fromRewe = await tryRewe(ean);
  tried.push('scraped_products');
  if (fromRewe) {
    logger.info('[external-lookup] scraped_products (legacy) hit');
    return { product: fromRewe, fromCache: false, refreshed: false };
  }

  const fromGlobus = await tryGlobus(ean);
  tried.push(GLOBUS_ENABLED ? 'globus-cf' : 'globus-cf(disabled)');
  if (fromGlobus) {
    logger.info('[external-lookup] globus-cf hit');
    return { product: fromGlobus, fromCache: false, refreshed: false };
  }

  const fromOpenFood = await tryOpenFood(ean);
  tried.push('openfood');
  if (fromOpenFood) {
    logger.info('[external-lookup] openfood hit (Fallback)');
    // SCHWACHER HIT: openfood ist Last-Resort. Miss tracken damit der
    // Processor einen Re-Scrape für bessere Daten anstößt.
    await recordMiss(ean, tried, 'openfood');
    return { product: fromOpenFood, fromCache: false, refreshed: false };
  }

  // KOMPLETTER MISS: keine Source hatte was. Persistieren für Processor.
  await recordMiss(ean, tried, null);
  return null;
}

/**
 * Volle Cascade: Cache → REWE → Globus(off) → OpenFood. Returnt null wenn
 * ALLE Sources versagen.
 *
 * Cache-Upgrade: wenn der Cache eine schwache Source (openfood) hat,
 * versuchen wir VOR dem Return die besseren Sources nochmal (mit Cooldown).
 *
 * SERVER-SIDE Unterschiede zum Client:
 *  • stampUpgradeAttempt + recordMiss werden AWAITED.
 *  • refreshSilent (Client: fire-and-forget) → hier INLINE-AWAITED: ein
 *    stale high-prio Doc wird vor der Response über die High-Prio-Sources
 *    aufgefrischt (eine fire-and-forget-Schreibung ginge bei CF-Termination
 *    verloren). Kostet etwas Latenz auf stale Hits, hält aber REWE-/
 *    nutritionscrape-Daten frisch statt 4 Wochen+ alt zu servieren.
 *
 * Garantie: throwt NIE.
 */
async function lookupByEAN(ean) {
  try {
    const norm = normaliseEan(ean);
    if (!norm) return null;
    logger.info('[external-lookup] start', { ean: norm });

    // 1. Cache
    const cached = await getCached(ean);
    if (cached) {
      const stale = isExternalCacheStale(cached.cachedAt);
      const lowPrio = sourcePriority(cached.source) >= UPGRADE_THRESHOLD_INDEX;
      // Auto-heal: wenn essentielle Felder fehlen (Bild + Preis + Name
      // alle leer), ist das Doc kaputt → re-fetch erzwingen.
      const isBroken =
        !cached.imageUrl &&
        (cached.price === undefined || cached.price === null) &&
        (!cached.productName || cached.productName === 'Produkt');
      logger.info('[external-lookup] cache-hit', {
        source: cached.source,
        stale,
        lowPrio,
        broken: isBroken,
      });

      // Kaputtes Doc → komplett neu cascaden.
      if (isBroken) {
        logger.warn('[external-lookup] cached doc broken → forcing re-fetch');
        const fresh = await runFullCascade(norm);
        if (fresh) return fresh;
        // Re-Fetch lieferte nichts → cached zurück (Datenrest > nichts).
        return { product: cached, fromCache: true, refreshed: false };
      }

      // Hoch-Priorität-Cache + nicht stale → direkt return.
      if (!stale && !lowPrio) {
        return { product: cached, fromCache: true, refreshed: false };
      }

      // Niedrig-Priorität-Cache (openfood) → Upgrade-Versuch, ABER nur
      // wenn nicht auf Cooldown.
      if (lowPrio) {
        const lastAttempt = cached.lastUpgradeAttemptAt?.toMillis?.() ?? 0;
        const onCooldown = Date.now() - lastAttempt < UPGRADE_RETRY_COOLDOWN_MS;
        if (!onCooldown) {
          // SERVER-SIDE: AWAITED (client fired fire-and-forget). Stempelt
          // den Versuchszeitpunkt, damit Folge-Aufrufe in der Cooldown-
          // Frist die Online-Cascade überspringen.
          await stampUpgradeAttempt(norm);
          const upgraded = await tryHigherPrioritySources(norm);
          if (upgraded) {
            logger.info('[external-lookup] cache upgraded openfood', {
              to: upgraded.source,
            });
            return { product: upgraded, fromCache: false, refreshed: true };
          }
          // Upgrade fehlgeschlagen — EAN hat NUR openfood-Daten. Miss
          // erneut tracken. SERVER-SIDE: AWAITED.
          await recordMiss(
            norm,
            [
              'reweapify',
              'nutritionscrape',
              'scraped_products',
              GLOBUS_ENABLED ? 'globus-cf' : 'globus-cf(disabled)',
            ],
            'openfood',
          );
        } else {
          logger.info('[external-lookup] upgrade on cooldown → serve cache');
        }
      }

      // Stale + hoch-priorität → SERVER-SIDE: inline (awaited) Refresh über
      // die High-Prio-Sources versuchen. Der Client tat das fire-and-forget
      // (refreshSilent); im CF muss es VOR der Response passieren, sonst ginge
      // der Write bei Termination verloren. Liefert der Refresh nichts, geben
      // wir den (stale) Cache zurück — stale > nichts. (lowPrio/openfood-Stale
      // wurde oben mit Cooldown behandelt.)
      if (stale) {
        const refreshed = await tryHigherPrioritySources(norm);
        if (refreshed) {
          logger.info('[external-lookup] stale high-prio refreshed', {
            to: refreshed.source,
          });
          return { product: refreshed, fromCache: false, refreshed: true };
        }
      }
      return { product: cached, fromCache: true, refreshed: false };
    }
    logger.info('[external-lookup] no cache, running full cascade');

    // 2-6. Full cascade
    return await runFullCascade(norm);
  } catch (e) {
    logger.warn('lookupByEAN unexpected error', { err: e && e.message });
    return null;
  }
}

/**
 * Cache-busted Lookup: löscht das external_products-Doc für die EAN BEVOR
 * die Cascade läuft. Throwt NIE — bei Delete-Fehler trotzdem Cascade.
 */
async function forceLookupByEAN(ean) {
  try {
    const norm = normaliseEan(ean);
    if (!norm) return null;
    try {
      await db().collection(COLLECTION).doc(norm).delete();
      logger.info('[external-lookup] cache CLEARED', { ean: norm });
    } catch (e) {
      logger.warn('forceLookupByEAN: cache-delete failed', {
        err: e && e.message,
      });
    }
    return await lookupByEAN(norm);
  } catch (e) {
    logger.warn('forceLookupByEAN failed', { err: e && e.message });
    return null;
  }
}

// ─── Auth (copied from cashback-pipeline) ───────────────────────────────

async function verifyAuthFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return decoded;
  } catch (e) {
    logger.warn('verifyIdToken-failed', { err: e.message });
    return null;
  }
}

// ─── HTTPS handler ──────────────────────────────────────────────────────

exports.resolveExternalProduct = onRequest(
  { region: REGION, timeoutSeconds: 30, memory: '256MiB', cors: true, invoker: 'public' },
  async (req, res) => {
    try {
      // Bearer-Auth (anonyme Firebase-User haben einen gültigen idToken →
      // akzeptieren). 401 wenn kein uid.
      const decoded = await verifyAuthFromRequest(req);
      if (!decoded?.uid) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }

      // ean + optional force aus body (JSON) ODER query (fallback).
      const body = req.body || {};
      const eanRaw = body.ean ?? req.query?.ean;
      const forceRaw = body.force ?? req.query?.force;
      const force =
        forceRaw === true || forceRaw === 1 || forceRaw === '1' || forceRaw === 'true';

      const norm = normaliseEan(eanRaw);
      if (!norm) {
        res.status(400).json({ error: 'invalid_ean' });
        return;
      }

      const result = force
        ? await forceLookupByEAN(norm)
        : await lookupByEAN(norm);

      if (!result || !result.product) {
        res.status(200).json({ product: null });
        return;
      }

      // `raw` (voller Source-Doc, ggf. mit DocumentReferences) ist Debug-only
      // + bereits im Firestore-Doc persistiert → NICHT über die Wire schicken
      // (Bloat + serialisiert Refs zu Junk). Der Client liest `raw` nie.
      const { raw: _omitRaw, ...productLite } = result.product;
      res.status(200).json({
        product: productLite,
        fromCache: result.fromCache,
        refreshed: result.refreshed,
      });
    } catch (e) {
      // NEVER let it throw uncaught.
      logger.error('resolveExternalProduct failed', { err: e && e.message });
      res.status(500).json({ error: (e && e.message) || 'internal' });
    }
  },
);
