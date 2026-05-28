/**
 * ExternalProductService — Cache-Layer für EAN-Lookups aus externen
 * Quellen (REWE/scraped_products, Globus, OpenFood, …).
 *
 * T1 (dieser File): nur Cache-Layer (Read/Write/Expiry-Check). Die
 * Lookup-Cascade kommt in T2 als `lookupByEAN`-Methode hierauf.
 *
 * Collection: `external_products` (Doc-Id = EAN).
 *
 * Cache-Regel: `cachedAt + 4 Wochen < now` → stale → Re-Fetch nötig.
 */

import { db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
} from '@react-native-firebase/firestore';

import OpenFoodService, {
  type OpenFoodProduct,
} from '@/lib/services/openfood';
import ScrapedProductsService, {
  type ScrapedProduct,
} from '@/lib/services/scrapedProductsService';
import {
  EXTERNAL_CACHE_MAX_AGE_MS,
  type ExternalLookupResult,
  type ExternalProductDoc,
  type ExternalProductSource,
} from '@/lib/types/externalProduct';

const COLLECTION = 'external_products';

/** Normalisiert einen EAN-String auf nur Ziffern (Doc-Id-safe). */
export function normaliseEan(ean: string): string {
  return String(ean ?? '').trim().replace(/\D/g, '');
}

/**
 * True wenn ein Eintrag älter als die Cache-Lebenszeit ist und neu
 * gefetched werden sollte.
 */
export function isExternalCacheStale(cachedAt?: Timestamp | null): boolean {
  if (!cachedAt) return true;
  const ts = cachedAt.toMillis?.() ?? 0;
  return Date.now() - ts > EXTERNAL_CACHE_MAX_AGE_MS;
}

/**
 * Liest einen Eintrag aus der external_products-Collection.
 * Gibt das Doc zurück egal ob frisch oder stale — Stale-Check macht
 * der Caller (T2 entscheidet ob Re-Fetch). null wenn kein Doc.
 */
async function getCached(ean: string): Promise<ExternalProductDoc | null> {
  const norm = normaliseEan(ean);
  if (!norm) return null;
  try {
    const ref = doc(db, COLLECTION, norm);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as ExternalProductDoc;
  } catch (e: any) {
    console.warn('ExternalProductService.getCached failed', e?.message);
    return null;
  }
}

/**
 * Schreibt einen normalisierten Source-Treffer in den Cache.
 * `cachedAt` wird via serverTimestamp gesetzt damit Timezone-egal
 * konsistent ist. Existierende Doc-Felder werden via merge:true
 * überschrieben, NICHT komplett ersetzt — so kann eine zweite Source
 * (z.B. OpenFood) ergänzende Felder (Nutriscore) nachschieben ohne
 * REWE-Daten zu kippen.
 */
async function writeThrough(
  ean: string,
  source: ExternalProductSource,
  data: Omit<ExternalProductDoc, 'ean' | 'source' | 'cachedAt'>,
): Promise<void> {
  const norm = normaliseEan(ean);
  if (!norm) return;
  try {
    const ref = doc(db, COLLECTION, norm);
    const payload: Partial<ExternalProductDoc> = {
      ...data,
      ean: norm,
      source,
      cachedAt: serverTimestamp() as Timestamp,
    };
    await setDoc(ref, payload, { merge: true });
  } catch (e: any) {
    console.warn('ExternalProductService.writeThrough failed', e?.message);
  }
}

/**
 * Liefert das gecachte Doc nur wenn es noch frisch ist (< 4 Wochen).
 * Stale-Hits returnen null damit der Caller (T2) sauber re-fetched.
 * Wer das stale Doc trotzdem braucht (z.B. als Fallback wenn Source
 * tot ist), nimmt `getCached` direkt.
 */
async function getFresh(ean: string): Promise<ExternalProductDoc | null> {
  const cached = await getCached(ean);
  if (!cached) return null;
  if (isExternalCacheStale(cached.cachedAt as any)) return null;
  return cached;
}

// ─── Source-Normalizer ──────────────────────────────────────────────
//
// Jeder Normalizer mappt eine Source-spezifische Datenstruktur auf
// das uniform ExternalProductDoc-Schema (ohne ean/source/cachedAt —
// die schreibt writeThrough).
//
// Pragmatisch: alle Felder strikt optional, was die Source nicht
// liefert bleibt undefined. Reweapify-nutr_*-Keys werden bevorzugt
// (matched die DB-Produkte), OpenFood wird auf diese Keys umgemappt.

function normaliseScraped(
  p: ScrapedProduct,
): Omit<ExternalProductDoc, 'ean' | 'source' | 'cachedAt'> {
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
    // ScrapedProduct hat Nutrition als string-Felder ("12,5 g") —
    // wir parsen den führenden Float raus, Unit hardcoded weil das
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

function normaliseOpenFood(
  p: OpenFoodProduct,
): Omit<ExternalProductDoc, 'ean' | 'source' | 'cachedAt'> {
  const n = p.nutriments ?? {};
  const allergens = p.allergens_tags ?? [];
  const has = (s: string) => allergens.some((t) => t.toLowerCase().includes(s));
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
function parseLeadingNumber(s?: string | null): number | undefined {
  if (!s || typeof s !== 'string') return undefined;
  const m = s.trim().replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!m) return undefined;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

// ─── Lookup-Cascade (T2) ────────────────────────────────────────────
//
// Reihenfolge:
//   1. external_products (Cache) — wenn fresh, sofort return.
//   2. REWE: scraped_products via ScrapedProductsService
//   3. Globus: globusScraper Cloud Function (STUB für jetzt, T3 baut
//      die echte Pipeline)
//   4. OpenFood: OpenFoodFacts API
//
// Stale-Hit aus external_products triggert silent Refresh aber gibt
// trotzdem die alten Daten zurück — UX > Frische. Wenn der Refresh
// erfolgreich ist, ist beim nächsten Aufruf der Cache aktualisiert.

async function tryRewe(ean: string): Promise<ExternalProductDoc | null> {
  try {
    const scraped = await ScrapedProductsService.searchScrapedProductByGTIN(ean);
    if (!scraped) return null;
    const normalised = normaliseScraped(scraped);
    await writeThrough(ean, 'rewe', normalised);
    return {
      ...normalised,
      ean: normaliseEan(ean),
      source: 'rewe',
      cachedAt: Timestamp.fromMillis(Date.now()),
    } as ExternalProductDoc;
  } catch (e: any) {
    console.warn('externalProductService.tryRewe failed', e?.message);
    return null;
  }
}

async function tryGlobus(ean: string): Promise<ExternalProductDoc | null> {
  // T3-Stub: Globus-Cloud-Function existiert noch nicht. Wenn die CF
  // implementiert ist, hier einen httpsCallable-Aufruf einbauen.
  // void-ean damit ESLint nicht meckert.
  void ean;
  return null;
}

async function tryOpenFood(ean: string): Promise<ExternalProductDoc | null> {
  try {
    const off = await OpenFoodService.getProductByEAN(ean);
    if (!off || !off.found) return null;
    const normalised = normaliseOpenFood(off);
    await writeThrough(ean, 'openfood', normalised);
    return {
      ...normalised,
      ean: normaliseEan(ean),
      source: 'openfood',
      cachedAt: Timestamp.fromMillis(Date.now()),
    } as ExternalProductDoc;
  } catch (e: any) {
    console.warn('externalProductService.tryOpenFood failed', e?.message);
    return null;
  }
}

/**
 * Volle Cascade: Cache → REWE → Globus → OpenFood.
 * Returnt null wenn ALLE Sources versagen.
 */
async function lookupByEAN(ean: string): Promise<ExternalLookupResult | null> {
  const norm = normaliseEan(ean);
  if (!norm) return null;

  // 1. Cache (frisch)
  const cached = await getCached(ean);
  if (cached) {
    const stale = isExternalCacheStale(cached.cachedAt as any);
    if (!stale) {
      return { product: cached, fromCache: true, refreshed: false };
    }
    // Stale: trigger background-refresh aus der ursprünglichen Source,
    // gib aber trotzdem die alten Daten zurück (UX > Frische).
    void refreshSilent(norm, cached.source);
    return { product: cached, fromCache: true, refreshed: false };
  }

  // 2. REWE
  const fromRewe = await tryRewe(norm);
  if (fromRewe) return { product: fromRewe, fromCache: false, refreshed: false };

  // 3. Globus
  const fromGlobus = await tryGlobus(norm);
  if (fromGlobus) return { product: fromGlobus, fromCache: false, refreshed: false };

  // 4. OpenFood
  const fromOpenFood = await tryOpenFood(norm);
  if (fromOpenFood) return { product: fromOpenFood, fromCache: false, refreshed: false };

  return null;
}

/**
 * Hintergrund-Refresh eines stalen Eintrags. Versucht zuerst die
 * ursprüngliche Source, fällt durch wenn diese nichts liefert.
 * Schreibt nicht zurück wenn Refresh leer ist — Doc bleibt stale,
 * wir versuchen's beim nächsten Lookup wieder.
 */
async function refreshSilent(
  ean: string,
  preferredSource: ExternalProductSource,
): Promise<void> {
  try {
    if (preferredSource === 'rewe') {
      await tryRewe(ean);
      return;
    }
    if (preferredSource === 'globus') {
      await tryGlobus(ean);
      return;
    }
    if (preferredSource === 'openfood') {
      await tryOpenFood(ean);
      return;
    }
  } catch (e: any) {
    console.warn('externalProductService.refreshSilent failed', e?.message);
  }
}

export const ExternalProductService = {
  getCached,
  getFresh,
  writeThrough,
  isExternalCacheStale,
  normaliseEan,
  lookupByEAN,
};

export default ExternalProductService;
