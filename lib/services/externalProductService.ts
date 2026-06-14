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

import { auth, db } from '@/lib/firebase';
import { isOnline } from '@/lib/services/network';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
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
  EXTERNAL_MISS_DEFAULT_STATUS,
  type ExternalLookupResult,
  type ExternalProductDoc,
  type ExternalProductSource,
} from '@/lib/types/externalProduct';

const COLLECTION = 'external_products';
const MISSES_COLLECTION = 'external_lookup_misses';

// Wie lange nach einem (erfolglosen) Online-Upgrade-Versuch für eine
// schwache (openfood-)Quelle NICHT erneut versucht wird. Verhindert, dass
// JEDER Screen-Aufruf die Source-Cascade online anstößt ("nicht immer
// online nachladen"). Dazwischen wird sofort aus dem Cache bedient.
const UPGRADE_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage

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
 * Stempelt `lastUpgradeAttemptAt = now` auf das Cache-Doc, damit künftige
 * Lookups innerhalb der Cooldown-Frist KEINE erneute Online-Upgrade-
 * Cascade anstoßen. Fire-and-forget — blockiert den Lookup nie (und
 * `lastUpgradeAttemptAt` ist NICHT in RELEVANT_EXTERNAL_FIELDS der CF →
 * triggert kein Re-Assessment).
 */
async function stampUpgradeAttempt(ean: string): Promise<void> {
  const norm = normaliseEan(ean);
  if (!norm) return;
  try {
    await setDoc(
      doc(db, COLLECTION, norm),
      { lastUpgradeAttemptAt: serverTimestamp() as Timestamp },
      { merge: true },
    );
  } catch {
    // egal — Cooldown ist Best-Effort
  }
}

/**
 * Schreibt / aktualisiert ein "Miss"-Doc für eine EAN deren Cascade
 * keinen oder nur einen schwachen Hit (openfood) lieferte.
 *
 * Pattern: Upsert via `merge: true`.
 *   • Erste Sichtung → firstSeenAt = now, status = 'pending', hitCount = 1
 *   • Folge-Sichtung → lastSeenAt = now, hitCount + 1, status & firstSeenAt
 *                      bleiben (Firestore merge ändert sie nicht)
 *
 * **Throwt NIE** — bei Permission-Fehler / offline silent warn, der
 * Caller (Cascade) darf NICHT blockieren.
 *
 * Aufruf nur intern aus runFullCascade. Public-API ist optional —
 * wir exposen es für ggf. spätere Manual-Reporting-Pfade ("dieses
 * Produkt ist falsch, bitte neu scrapen").
 */
async function recordMiss(
  ean: string,
  triedSources: string[],
  bestSource: ExternalProductSource | null,
): Promise<void> {
  const norm = normaliseEan(ean);
  if (!norm) return;
  try {
    const ref = doc(db, MISSES_COLLECTION, norm);

    // Erst lesen damit wir wissen ob firstSeenAt schon existiert
    // (sonst würde merge: true es überschreiben).
    let exists = false;
    try {
      const snap = await getDoc(ref);
      exists = snap.exists();
    } catch {
      // Read-Failure egal — wir behandeln es wie "noch nicht da"
      // und überschreiben firstSeenAt unten. Schlimmster Fall:
      // firstSeenAt wandert nach vorne. Kein Daten-Verlust.
      exists = false;
    }

    const now = serverTimestamp() as Timestamp;
    const payload: Record<string, any> = {
      ean: norm,
      lastSeenAt: now,
      hitCount: increment(1),
      triedSources,
      bestSource,
    };
    if (!exists) {
      payload.firstSeenAt = now;
      payload.status = EXTERNAL_MISS_DEFAULT_STATUS;
    }

    await setDoc(ref, payload, { merge: true });
    console.error(
      `[miss] recorded ean=${norm} bestSource=${bestSource ?? 'null'} tried=${triedSources.join(',')}`,
    );
  } catch (e: any) {
    // Permission denied (Rules nicht freigegeben) / offline → silent.
    // User-Flow muss weiterlaufen. Wir loggen für Debugging.
    console.warn(
      'externalProductService.recordMiss failed (non-blocking)',
      e?.message,
    );
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
  // ACHTUNG: reweapify-Schema benutzt eigene Feld-Namen — NICHT
  // attr_brand / attr_hersteller / images / attr_preis (das war eine
  // falsche Annahme). Echte Felder (siehe User-gepasted Doc 2026-05-28):
  //   - image: string (single, nicht array)
  //   - price_current / price_regular: number
  //   - price_grammage: string ("130g (1 kg = 23 €)")
  //   - attr_BrandId / brandKey: string (Marke, z.B. "Kerrygold")
  //   - attr_ContactName: string (Hersteller-Firma, z.B. "Ornua Deutschland GmbH")
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
  let packSize: string | undefined;
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

async function tryReweapify(ean: string): Promise<ExternalProductDoc | null> {
  const norm = normaliseEan(ean);
  if (!norm) return null;
  let docData: any = null;

  // String-Query (Standard — Firestore-Console-Test bestätigt:
  // gtin ist als String gespeichert)
  try {
    const asString = await getDocs(
      query(collection(db, 'reweapify'), where('gtin', '==', norm), limit(1)),
    );
    if (!asString.empty) {
      docData = asString.docs[0].data();
      console.error(`[reweapify] ✅ hit-by-string ${norm}`);
    }
  } catch (e: any) {
    // KRITISCH: zeige exakten Error-Code — wenn permission-denied,
    // dann sind die Firestore-Rules das Problem (Reweapify ist meist
    // nur für admin lesbar). User muss in Firebase-Console die
    // `reweapify`-Collection für allUsers (oder zumindest auth) lesen
    // freigeben.
    console.error(
      `[reweapify] ❌ STRING-QUERY ERROR code=${e?.code} msg=${e?.message}`,
    );
  }

  // Number-Query Fallback nur wenn String nichts gefunden hat
  if (!docData) {
    try {
      const eanNum = Number(norm);
      if (Number.isFinite(eanNum)) {
        const asNumber = await getDocs(
          query(collection(db, 'reweapify'), where('gtin', '==', eanNum), limit(1)),
        );
        if (!asNumber.empty) {
          docData = asNumber.docs[0].data();
          console.error(`[reweapify] ✅ hit-by-number ${norm}`);
        }
      }
    } catch (e: any) {
      console.error(
        `[reweapify] ❌ NUMBER-QUERY ERROR code=${e?.code} msg=${e?.message}`,
      );
    }
  }

  if (!docData) {
    console.error(`[reweapify] no doc for gtin=${norm}`);
    return null;
  }

  try {
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
    console.error(`[reweapify] normalise failed: ${e?.message}`);
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
//
// ─── STATUS 2026-05-28: DEAKTIVIERT ──────────────────────────────────
// Die CF ist NICHT deployed (firebase functions:list zeigt sie nicht,
// curl gibt 404) und sie ist auch NICHT in firebase.json als Codebase
// registriert. Plus: der CF-Code in cloud-functions/globus-scraper/
// index.js ist ein Skeleton (returnt immer { found: false }).
//
// Wir skippen den HTTP-Call deshalb komplett bis das alles steht —
// sonst kostet jeder EAN-Lookup einen unnötigen 200-500ms-Roundtrip
// zu einer 404-Page.
//
// Was zu tun ist um Globus zu aktivieren:
//   1. Strategie in cloud-functions/globus-scraper/index.js wählen
//      (Serper.dev-Search ist die naheliegende Option — siehe
//      Code-Kommentare in index.js)
//   2. Codebase in firebase.json eintragen (analog nutrition-scraper)
//   3. Secrets falls nötig setzen: firebase functions:secrets:set SERPER_API_KEY
//   4. firebase deploy --only functions:globus-scraper
//   5. EXPO_PUBLIC_GLOBUS_ENABLED=true in .env / EAS-Env setzen
//
// Bis Schritt 5 ist `tryGlobus` ein No-Op. Cascade fällt direkt von
// nutritionscrape zu OpenFood durch.
const GLOBUS_FN_URL =
  (process as any).env?.EXPO_PUBLIC_GLOBUS_FN_URL ||
  'https://europe-west1-markendetektive-895f7.cloudfunctions.net/globusLookupByEan';
const GLOBUS_ENABLED =
  String((process as any).env?.EXPO_PUBLIC_GLOBUS_ENABLED ?? 'false') === 'true';

async function tryGlobus(ean: string): Promise<ExternalProductDoc | null> {
  if (!GLOBUS_ENABLED) {
    // CF nicht deployed bzw. nicht implementiert — silently skip ohne
    // HTTP-Roundtrip zu verbrennen.
    return null;
  }
  try {
    // Callable-onCall-Format: { data: { ean } }, returnt { result: {...} }.
    // ACHTUNG: wenn die CF mit functions.onCall (statt onRequest) gebaut
    // ist, braucht der Call ein Firebase-Auth-Bearer-Token. Anonymes
    // Auth reicht — aber wir müssen den ID-Token an den Request hängen
    // wenn der Server das prüft. Aktuell ist der Code dafür nicht
    // vorbereitet; sobald die echte CF steht, hier ggf. Auth-Header
    // ergänzen ODER die CF auf onRequest (cors:true) umbauen.
    const res = await fetch(GLOBUS_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { ean } }),
    });
    if (!res.ok) {
      console.warn(`[globus] HTTP ${res.status} from CF — check deployment`);
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
    // Netzwerk-Fehler / Timeout → null.
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
 *
 * @deprecated DEAD CODE seit der Server-Migration: die Cascade läuft jetzt
 * server-seitig in cloud-functions/external-product-lookup (Client-Writes auf
 * external_products sind durch Firestore-Rules gesperrt). Bleibt vorerst als
 * Referenz/Notfall-Pfad stehen; das öffentliche `lookupByEAN` unten ruft die
 * CF. TODO: nach erfolgreichem CF-Rollout dieses Insel-Stück (alle try-,
 * normalise-, runFullCascade + OpenFood/ScrapedProducts-Imports) entfernen.
 */
async function lookupByEANViaCascade(ean: string): Promise<ExternalLookupResult | null> {
  try {
    const norm = normaliseEan(ean);
    if (!norm) return null;
    console.error(`[external-lookup] start ean=${norm}`);

    // 1. Cache
    const cached = await getCached(ean);
    if (cached) {
      const stale = isExternalCacheStale(cached.cachedAt as any);
      const lowPrio = sourcePriority(cached.source) >= UPGRADE_THRESHOLD_INDEX;
      // Auto-heal: wenn essentielle Felder fehlen (Bild + Preis + Name
      // alle leer), ist das Doc kaputt — z.B. weil ein früherer
      // Normalizer-Bug die Felder nicht gemappt hat. Re-fetch erzwingen
      // damit der User nicht "Cache leeren" tippen muss.
      const isBroken =
        !cached.imageUrl &&
        (cached.price === undefined || cached.price === null) &&
        (!cached.productName || cached.productName === 'Produkt');
      console.log(
        `[external-lookup] cache-hit source=${cached.source} stale=${stale} lowPrio=${lowPrio} broken=${isBroken}`,
      );

      // Kaputtes Doc → komplett neu cascaden (Cache überschreibt sich selbst).
      if (isBroken) {
        console.error(
          `[external-lookup] cached doc broken (no image+price+name) → forcing re-fetch`,
        );
        const fresh = await runFullCascade(norm);
        if (fresh) return fresh;
        // Wenn Re-Fetch auch nichts liefert → cached zurück (Datenrest ist
        // besser als nichts).
        return { product: cached, fromCache: true, refreshed: false };
      }

      // Hoch-Priorität-Cache + nicht stale → direkt return.
      if (!stale && !lowPrio) {
        return { product: cached, fromCache: true, refreshed: false };
      }

      // Niedrig-Priorität-Cache (openfood) → versuche Upgrade auf
      // bessere Sources. ABER nur wenn nicht auf Cooldown — sonst stößt
      // jeder Screen-Aufruf die Online-Cascade an ("immer online
      // nachgeladen"). Dazwischen sofort aus dem Cache.
      if (lowPrio) {
        const lastAttempt =
          (cached as any).lastUpgradeAttemptAt?.toMillis?.() ?? 0;
        const onCooldown = Date.now() - lastAttempt < UPGRADE_RETRY_COOLDOWN_MS;
        if (!onCooldown) {
          // Versuchszeitpunkt sofort stempeln (fire-and-forget) → die
          // nächsten Views innerhalb der Cooldown-Frist überspringen.
          void stampUpgradeAttempt(norm);
          const upgraded = await tryHigherPrioritySources(norm);
          if (upgraded) {
            console.error(`[external-lookup] cache upgraded openfood → ${upgraded.source}`);
            return { product: upgraded, fromCache: false, refreshed: true };
          }
          // Upgrade fehlgeschlagen — EAN hat NUR openfood-Daten. Miss
          // erneut tracken damit der Processor noch eine Runde dreht.
          void recordMiss(
            norm,
            ['reweapify', 'nutritionscrape', 'scraped_products', GLOBUS_ENABLED ? 'globus-cf' : 'globus-cf(disabled)'],
            'openfood',
          );
        } else {
          console.log('[external-lookup] upgrade on cooldown → serve cache');
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
  // Track welche Sources versucht wurden — für Miss-Recording. Hilft
  // beim Debugging ("welche Sources haben wir schon abgeklappert?")
  // und ist ein gutes Signal für den Miss-Processor (T4) welche
  // Strategie noch übrig ist.
  const tried: string[] = [];

  const fromReweapify = await tryReweapify(ean);
  tried.push('reweapify');
  if (fromReweapify) {
    console.error(`[external-lookup] ✅ reweapify hit`);
    return { product: fromReweapify, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] reweapify: no hit`);

  const fromScrape = await tryNutritionScrape(ean);
  tried.push('nutritionscrape');
  if (fromScrape) {
    console.error(`[external-lookup] ✅ nutritionscrape hit (source=${fromScrape.source})`);
    return { product: fromScrape, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] nutritionscrape: no hit`);

  const fromRewe = await tryRewe(ean);
  tried.push('scraped_products');
  if (fromRewe) {
    console.error(`[external-lookup] ✅ scraped_products (legacy) hit`);
    return { product: fromRewe, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] scraped_products: no hit`);

  const fromGlobus = await tryGlobus(ean);
  tried.push(GLOBUS_ENABLED ? 'globus-cf' : 'globus-cf(disabled)');
  if (fromGlobus) {
    console.error(`[external-lookup] ✅ globus-cf hit`);
    return { product: fromGlobus, fromCache: false, refreshed: false };
  }
  console.error(
    `[external-lookup] globus-cf: ${GLOBUS_ENABLED ? 'no hit' : 'DISABLED (CF nicht deployed)'}`,
  );

  const fromOpenFood = await tryOpenFood(ean);
  tried.push('openfood');
  if (fromOpenFood) {
    console.error(`[external-lookup] ✅ openfood hit (Fallback)`);
    // SCHWACHER HIT: openfood ist Last-Resort. Wir wollen für diese EAN
    // einen Multi-Shop-Re-Scrape triggern damit beim nächsten Lookup
    // bessere Daten da sind. Fire-and-forget — UI bekommt sofort die
    // openfood-Daten zurück.
    void recordMiss(ean, tried, 'openfood');
    return { product: fromOpenFood, fromCache: false, refreshed: false };
  }
  console.error(`[external-lookup] openfood: no hit — cascade ende, kein Produkt`);

  // KOMPLETTER MISS: keine Source hatte was. Persistieren für Processor.
  void recordMiss(ean, tried, null);
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
// @deprecated DEAD CODE — siehe lookupByEANViaCascade. Das öffentliche
// forceLookupByEAN unten ruft die CF mit force=true.
async function forceLookupByEANViaCascade(
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
    return await lookupByEANViaCascade(norm);
  } catch (e: any) {
    console.warn('forceLookupByEAN failed', e?.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Server-seitiger Lookup (cloud-functions/external-product-lookup)
// ════════════════════════════════════════════════════════════════════════
//
// Die komplette Cascade + alle external_products/external_lookup_misses-
// Writes laufen server-seitig (Admin-Rechte; Client-Writes sind durch
// Firestore-Rules gesperrt). Der Client ruft die CF und liest das Cache-Doc
// (read:true) als Offline-/Sofort-Fallback.
//
// WICHTIG: Das von der CF per HTTP zurückgegebene `product` trägt
// Timestamps als `{_seconds,_nanoseconds}` (JSON), NICHT als Firestore-
// Timestamp. Für die ANZEIGE (Name/Preis/Bild/Nährwerte/aiAssessment) egal.
// Timestamp-Methoden (.toMillis()) NUR auf dem via getCached gelesenen Doc
// aufrufen. Die KI-Karte aktualisiert der external-product-Screen ohnehin
// live via onSnapshot aufs echte Doc.
const EXTERNAL_LOOKUP_FN_BASE =
  process.env.EXPO_PUBLIC_EXTERNAL_LOOKUP_FN_BASE ||
  'https://europe-west1-markendetektive-895f7.cloudfunctions.net';

async function resolveViaCF(
  ean: string,
  force: boolean,
): Promise<ExternalLookupResult | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null; // ohne Auth kein CF-Call (anonyme User haben Auth)
    const idToken = await user.getIdToken();
    const res = await fetch(`${EXTERNAL_LOOKUP_FN_BASE}/resolveExternalProduct`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ ean, force }),
    });
    if (!res.ok) {
      console.warn('[external-lookup] CF non-ok', res.status);
      return null;
    }
    const json: any = await res.json();
    if (!json?.product) return null;
    return {
      product: json.product as ExternalProductDoc,
      fromCache: !!json.fromCache,
      refreshed: !!json.refreshed,
    };
  } catch (e: any) {
    console.warn('[external-lookup] CF call failed', e?.message);
    return null;
  }
}

/**
 * Öffentlicher Lookup: online → Server-CF (Cascade + Write + KI-Trigger);
 * offline/CF-Fehler → das gecachte external_products-Doc (Firestore-Offline-
 * Cache bedient es, sofern die EAN schon einmal aufgelöst wurde). throwt NIE.
 */
async function lookupByEAN(ean: string): Promise<ExternalLookupResult | null> {
  const norm = normaliseEan(ean);
  if (!norm) return null;
  if (isOnline()) {
    const viaCf = await resolveViaCF(norm, false);
    if (viaCf) return viaCf;
  }
  const cached = await getCached(norm);
  return cached ? { product: cached, fromCache: true, refreshed: false } : null;
}

/**
 * Cache-busted Lookup (Dev „Cache leeren"-Button): zwingt die CF zur
 * kompletten Neu-Cascade (force=true → Doc-Delete + Re-Fetch server-seitig).
 */
async function forceLookupByEAN(
  ean: string,
): Promise<ExternalLookupResult | null> {
  const norm = normaliseEan(ean);
  if (!norm) return null;
  if (isOnline()) {
    const viaCf = await resolveViaCF(norm, true);
    if (viaCf) return viaCf;
  }
  const cached = await getCached(norm);
  return cached ? { product: cached, fromCache: true, refreshed: false } : null;
}

export const ExternalProductService = {
  getCached,
  getFresh,
  writeThrough,
  isExternalCacheStale,
  normaliseEan,
  lookupByEAN,
  forceLookupByEAN,
  recordMiss,
};

export default ExternalProductService;
