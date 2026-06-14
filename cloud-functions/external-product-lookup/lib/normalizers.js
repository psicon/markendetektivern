/**
 * Pure Normalizer + Konstanten der external-product-lookup-Cascade.
 *
 * Aus index.js extrahiert → unit-testbar OHNE firebase-admin /
 * Modul-Seiteneffekte (index.js ruft admin.initializeApp() beim Laden).
 * Behaviour-identische Verbatim-Kopie; index.js requirt diese Funktionen.
 * Spiegelt lib/services/externalProductService.ts (Client) — bei Änderungen
 * beide Seiten + die Tests nachziehen.
 */

'use strict';

// Wie alt darf ein cached Eintrag sein bevor wir frisch fetchen. (4 Wochen)
const EXTERNAL_CACHE_MAX_AGE_MS = 4 * 7 * 24 * 60 * 60 * 1000; // 4 Wochen

// Source-Priority-Order. Niedriger Index = bessere Quelle.
const SOURCE_PRIORITY = ['rewe', 'globus', 'metro', 'scraper', 'openfood'];
const UPGRADE_THRESHOLD_INDEX = SOURCE_PRIORITY.indexOf('openfood'); // 4

function sourcePriority(s) {
  const i = SOURCE_PRIORITY.indexOf(s);
  return i === -1 ? 99 : i;
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

/** Parst den führenden Float aus Strings wie "12,5 g" → 12.5. */
function parseLeadingNumber(s) {
  if (!s || typeof s !== 'string') return undefined;
  const m = s.trim().replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

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

module.exports = {
  EXTERNAL_CACHE_MAX_AGE_MS,
  SOURCE_PRIORITY,
  UPGRADE_THRESHOLD_INDEX,
  sourcePriority,
  normaliseEan,
  isExternalCacheStale,
  parseLeadingNumber,
  normaliseScraped,
  normaliseOpenFood,
  normaliseReweapify,
};
