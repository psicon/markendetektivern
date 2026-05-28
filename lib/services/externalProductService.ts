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
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
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

// ─── Reweapify (echte REWE-Pipeline) ─────────────────────────────────
//
// Die `reweapify`-Collection wird vom mediaingestor → reweapify-Pipeline
// gefüttert (REWE.de Web-Scrape). Felder folgen dem `attr_*` und
// `nutr_*`-Schema (siehe CLAUDE.md). Wir suchen per `gtin`-Equality.

function normaliseReweapify(
  data: any,
): Omit<ExternalProductDoc, 'ean' | 'source' | 'cachedAt'> {
  // reweapify-Schema ist nah am ExternalProductDoc — die meisten Felder
  // sind 1:1. Defensiv geschrieben falls ein Feld fehlt (Layout-Drift).
  const image =
    (Array.isArray(data?.images) && data.images[0]) ||
    data?.productImageUrl ||
    data?.attr_image ||
    undefined;
  return {
    productName:
      data?.productName ?? data?.attr_productName ?? data?.title ?? 'Produkt',
    brandName: data?.brandName ?? data?.attr_brand ?? data?.attr_marke,
    manufacturerName: data?.attr_hersteller ?? data?.producer,
    imageUrl: image,
    price:
      typeof data?.attr_preis === 'number'
        ? data.attr_preis
        : typeof data?.price === 'number'
        ? data.price
        : undefined,
    packSize:
      typeof data?.attr_packageSize === 'number' && data?.attr_packageUnit
        ? `${data.attr_packageSize} ${data.attr_packageUnit}`
        : typeof data?.attr_preisPackgroesse === 'string'
        ? data.attr_preisPackgroesse
        : data?.itemSize,
    category: data?.productCategory ?? data?.attr_category,
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

async function tryReweapify(ean: string): Promise<ExternalProductDoc | null> {
  try {
    const norm = normaliseEan(ean);
    if (!norm) return null;
    // Doppel-Query: gtin als String UND als Number, weil's je nach
    // Pipeline-Lauf unterschiedlich serialisiert sein kann.
    const asString = await getDocs(
      query(collection(db, 'reweapify'), where('gtin', '==', norm), limit(1)),
    );
    let docData: any = null;
    if (!asString.empty) {
      docData = asString.docs[0].data();
      console.error(`[reweapify] hit-by-string ${norm}`);
    } else {
      const eanNum = Number(norm);
      if (Number.isFinite(eanNum)) {
        const asNumber = await getDocs(
          query(collection(db, 'reweapify'), where('gtin', '==', eanNum), limit(1)),
        );
        if (!asNumber.empty) {
          docData = asNumber.docs[0].data();
          console.error(`[reweapify] hit-by-number ${norm}`);
        }
      }
    }
    if (!docData) {
      console.error(`[reweapify] no doc for gtin=${norm}`);
      return null;
    }
    const normalised = normaliseReweapify(docData);
    if (!normalised.productName || normalised.productName === 'Produkt') {
      if (!docData?.attr_ingredientStatement && !normalised.imageUrl) {
        console.error(`[reweapify] doc found but no useful data, skipping`);
        return null;
      }
    }
    await writeThrough(norm, 'rewe', normalised);
    return {
      ...normalised,
      ean: norm,
      source: 'rewe',
      cachedAt: Timestamp.fromMillis(Date.now()),
    } as ExternalProductDoc;
  } catch (e: any) {
    console.warn('externalProductService.tryReweapify failed', e?.message);
    return null;
  }
}

// ─── nutritionscrape (LLM-extrahierte Multi-Shop-Daten) ─────────────
//
// Die `nutritionscrape`-Collection wird vom nutrition-scraper-CF
// gefüttert. EAN ist die Doc-ID. Daten kommen von verschiedenen Shops
// (rewe.de, globus.de, metro.de, …) je nachdem wo der Scraper den
// EAN gefunden hat. `sourceShop`-Feld nennt die echte Quelle.

async function tryNutritionScrape(ean: string): Promise<ExternalProductDoc | null> {
  try {
    const norm = normaliseEan(ean);
    if (!norm) return null;
    const snap = await getDoc(doc(db, 'nutritionscrape', norm));
    if (!snap.exists()) {
      console.error(`[nutritionscrape] no doc for ean=${norm}`);
      return null;
    }
    const data = snap.data();
    if (!data) return null;
    console.log(
      `[nutritionscrape] doc found ean=${norm} sourceShop=${data?.sourceShop ?? '?'}`,
    );
    // Schema fast identisch zu reweapify — gleicher Normalizer.
    const normalised = normaliseReweapify(data);
    // Wenn weder Name noch Image noch Zutaten → nichts wertvolles
    if (
      (!normalised.productName || normalised.productName === 'Produkt') &&
      !normalised.imageUrl &&
      !normalised.attr_ingredientStatement
    ) {
      console.error(`[nutritionscrape] doc has no useful data, skipping`);
      return null;
    }
    // Bestimmen Sub-Source aus sourceShop (rewe.de/globus.de/…). Wenn
    // Shop unklar → 'scraper' als generic source.
    const shop = String(data?.sourceShop ?? '').toLowerCase();
    let subSource: ExternalProductSource = 'scraper';
    if (shop.includes('rewe')) subSource = 'rewe';
    else if (shop.includes('globus')) subSource = 'globus';
    else if (shop.includes('metro')) subSource = 'metro';
    else if (shop) subSource = shop.split('.')[0] as ExternalProductSource;
    await writeThrough(norm, subSource, normalised);
    return {
      ...normalised,
      ean: norm,
      source: subSource,
      cachedAt: Timestamp.fromMillis(Date.now()),
    } as ExternalProductDoc;
  } catch (e: any) {
    console.warn('externalProductService.tryNutritionScrape failed', e?.message);
    return null;
  }
}

// ─── Legacy scraped_products (bleibt als Fallback) ──────────────────

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

// T3: Globus-Scraper Cloud Function endpoint (europe-west1).
// Aktuell skeleton — returnt { found: false } bis die HTML-Parse-
// Logik in cloud-functions/globus-scraper/index.js implementiert ist.
// Sobald die CF deployed ist und echte Daten liefert, funktioniert
// die Cascade automatisch ohne weitere Client-Änderung.
const GLOBUS_FN_URL =
  (process as any).env?.EXPO_PUBLIC_GLOBUS_FN_URL ||
  'https://europe-west1-markendetektive-895f7.cloudfunctions.net/globusLookupByEan';

async function tryGlobus(ean: string): Promise<ExternalProductDoc | null> {
  try {
    // Callable-onCall-Format: { data: { ean } }, returnt { result: {...} }.
    const res = await fetch(GLOBUS_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { ean } }),
    });
    if (!res.ok) {
      // 404/500 etc. → silently fail, Cascade fällt zu OpenFood durch.
      return null;
    }
    const json = await res.json();
    const payload = json?.result ?? json;
    if (!payload?.found || !payload?.product) return null;
    // Globus-Schema = identisch zu ScrapedProduct (CF beschreibt das so).
    const normalised = normaliseScraped(payload.product as any);
    await writeThrough(ean, 'globus', normalised);
    return {
      ...normalised,
      ean: normaliseEan(ean),
      source: 'globus',
      cachedAt: Timestamp.fromMillis(Date.now()),
    } as ExternalProductDoc;
  } catch (e: any) {
    // Netzwerk-Fehler / CF nicht deployed / Timeout → null.
    // Wichtig: NICHT werfen, damit die Cascade weiter zu OpenFood fällt.
    console.warn('externalProductService.tryGlobus failed', e?.message);
    return null;
  }
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
 * Source-Priority-Order. Niedriger Index = bessere Quelle.
 * Ein gecachter Hit mit Source >= UPGRADE_THRESHOLD wird beim nächsten
 * Lookup nochmal gegen alle höher-priorisierten Sources gegen-geprüft
 * (cache-self-heal). Verhindert dass eine alte OpenFood-Cache-Eintrag
 * für immer "klebt" obwohl jetzt REWE/nutritionscrape Daten dazu hat.
 */
const SOURCE_PRIORITY: ExternalProductSource[] = [
  'rewe',
  'globus',
  'metro',
  'scraper',
  'openfood',
];
const UPGRADE_THRESHOLD_INDEX = SOURCE_PRIORITY.indexOf('openfood'); // 4

function sourcePriority(s: ExternalProductSource): number {
  const i = SOURCE_PRIORITY.indexOf(s);
  return i === -1 ? 99 : i;
}

/**
 * Volle Cascade: Cache → REWE → Globus → OpenFood.
 * Returnt null wenn ALLE Sources versagen.
 *
 * **Cache-Upgrade**: wenn der Cache eine schwache Source (openfood)
 * hat, versuchen wir VOR dem Return die besseren Sources nochmal.
 * Falls die jetzt was haben, Cache-Update + bessere Daten anzeigen.
 *
 * **Garantie**: throwt NIE.
 */
async function lookupByEAN(ean: string): Promise<ExternalLookupResult | null> {
  try {
    const norm = normaliseEan(ean);
    if (!norm) return null;
    console.error(`[external-lookup] start ean=${norm}`);

    // 1. Cache
    const cached = await getCached(ean);
    if (cached) {
      const stale = isExternalCacheStale(cached.cachedAt as any);
      const lowPrio = sourcePriority(cached.source) >= UPGRADE_THRESHOLD_INDEX;
      console.log(
        `[external-lookup] cache-hit source=${cached.source} stale=${stale} lowPrio=${lowPrio}`,
      );

      // Hoch-Priorität-Cache + nicht stale → direkt return.
      if (!stale && !lowPrio) {
        return { product: cached, fromCache: true, refreshed: false };
      }

      // Niedrig-Priorität-Cache (openfood) → versuche Upgrade auf
      // bessere Sources. Wenn keine Upgrade möglich → cached zurück.
      if (lowPrio) {
        const upgraded = await tryHigherPrioritySources(norm);
        if (upgraded) {
          console.error(`[external-lookup] cache upgraded openfood → ${upgraded.source}`);
          return { product: upgraded, fromCache: false, refreshed: true };
        }
      }

      // Stale (hoch-priorität) → trigger background refresh, return cached.
      if (stale) {
        void refreshSilent(norm, cached.source);
      }
      return { product: cached, fromCache: true, refreshed: false };
    }
    console.error(`[external-lookup] no cache, running full cascade`);

    // 2-6. Full cascade
    const cascadeResult = await runFullCascade(norm);
    return cascadeResult;
  } catch (e: any) {
    console.warn('externalProductService.lookupByEAN unexpected error', e?.message);
    return null;
  }
}

/**
 * Probiert nur Sources mit höherer Priorität als openfood. Für
 * Cache-Upgrade-Pfad. Returnt das BESTE Resultat das gefunden wird.
 */
async function tryHigherPrioritySources(
  ean: string,
): Promise<ExternalProductDoc | null> {
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
 * Volle Cascade ohne Cache-Check. Wird vom normalen Lookup
 * aufgerufen wenn kein Cache existiert.
 */
async function runFullCascade(
  ean: string,
): Promise<ExternalLookupResult | null> {
  const fromReweapify = await tryReweapify(ean);
  if (fromReweapify) {
    console.error(`[external-lookup] ✅ reweapify hit`);
    return { product: fromReweapify, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] reweapify: no hit`);

  const fromScrape = await tryNutritionScrape(ean);
  if (fromScrape) {
    console.error(`[external-lookup] ✅ nutritionscrape hit (source=${fromScrape.source})`);
    return { product: fromScrape, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] nutritionscrape: no hit`);

  const fromRewe = await tryRewe(ean);
  if (fromRewe) {
    console.error(`[external-lookup] ✅ scraped_products (legacy) hit`);
    return { product: fromRewe, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] scraped_products: no hit`);

  const fromGlobus = await tryGlobus(ean);
  if (fromGlobus) {
    console.error(`[external-lookup] ✅ globus-cf hit`);
    return { product: fromGlobus, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] globus-cf: no hit (Skeleton)`);

  const fromOpenFood = await tryOpenFood(ean);
  if (fromOpenFood) {
    console.error(`[external-lookup] ✅ openfood hit (Fallback)`);
    return { product: fromOpenFood, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] openfood: no hit — cascade ende, kein Produkt`);

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
      const r1 = await tryReweapify(ean);
      if (r1) return;
      await tryRewe(ean); // legacy fallback
      return;
    }
    if (preferredSource === 'globus' || preferredSource === 'metro' || preferredSource === 'scraper') {
      // Multi-shop LLM-Scrape — Daten leben in nutritionscrape
      await tryNutritionScrape(ean);
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

/**
 * Cache-busted Lookup: löscht das external_products-Doc für die EAN
 * BEVOR die Cascade läuft. Damit kann der Detail-Screen den "Cache
 * leeren & neu suchen"-Pfad anbieten.
 *
 * Throwt NIE — bei Delete-Fehler trotzdem Cascade ausführen.
 */
async function forceLookupByEAN(
  ean: string,
): Promise<ExternalLookupResult | null> {
  try {
    const norm = normaliseEan(ean);
    if (!norm) return null;
    try {
      await deleteDoc(doc(db, COLLECTION, norm));
      console.error(`[external-lookup] cache CLEARED for ${norm}`);
    } catch (e: any) {
      console.warn('forceLookupByEAN: cache-delete failed', e?.message);
    }
    return await lookupByEAN(norm);
  } catch (e: any) {
    console.warn('forceLookupByEAN failed', e?.message);
    return null;
  }
}

export const ExternalProductService = {
  getCached,
  getFresh,
  writeThrough,
  isExternalCacheStale,
  normaliseEan,
  lookupByEAN,
  forceLookupByEAN,
};

export default ExternalProductService;
