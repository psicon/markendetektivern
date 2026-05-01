import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    DocumentReference,
    getCountFromServer,
    getDoc,
    getDocs,
    increment,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    startAfter,
    Timestamp,
    updateDoc,
    where,
    writeBatch
} from 'firebase/firestore';
import { Image as RNImage } from 'react-native';
import { db } from '../firebase';
import {
    Discounter,
    Einkaufswagen,
    FirestoreDocument,
    Handelsmarken,
    HerstellerNew,
    Kategorien,
    MarkenProdukte,
    MarkenProduktWithDetails,
    Packungstypen,
    ProductToConvert,
    ProductWithDetails,
    Produkte
} from '../types/firestore';
import achievementService from './achievementService';

// ─── In-memory product-detail cache ────────────────────────────────
//
// Detail screens (`noname-detail`, `product-comparison`) re-fetch the
// same product on every navigation, which means each back-and-forth
// pays a full Firestore round-trip — visible as a long skeleton phase
// then a "pop". We cache the result for 5 minutes so:
//   1. Repeat navigations are INSTANT (no skeleton).
//   2. Pre-fetch on tap (see `prefetchProductDetails` below) can warm
//      the cache while the navigation animation is still running, so
//      the destination screen often has data before its first paint.
// The cache is module-scoped, lives only in RAM, and is bounded by
// the natural session lifetime — no memory pressure to worry about.

const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { value: T | null; expiresAt: number };
type InflightEntry<T> = Promise<T | null>;

const productDetailsCache = new Map<string, CacheEntry<ProductWithDetails>>();
const productDetailsInflight = new Map<
  string,
  InflightEntry<ProductWithDetails>
>();
const markenProduktDetailsCache = new Map<
  string,
  CacheEntry<MarkenProduktWithDetails>
>();
const markenProduktDetailsInflight = new Map<
  string,
  InflightEntry<MarkenProduktWithDetails>
>();
const comparisonCache = new Map<
  string,
  CacheEntry<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  }>
>();
const comparisonInflight = new Map<
  string,
  InflightEntry<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  }>
>();

function readCache<T>(map: Map<string, CacheEntry<T>>, key: string): T | null | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeCache<T>(map: Map<string, CacheEntry<T>>, key: string, value: T | null, ttlMs: number = PRODUCT_CACHE_TTL_MS) {
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ─── Homepage caches ─────────────────────────────────────────────
//
// The Home tab fires several queries on mount: full discounter list,
// 200-product pool for the random pick, and a parallel
// `getDocumentByReference` per product to resolve the Handelsmarke
// label. Caching these dramatically improves perceived speed on tab
// re-entry — second visit and onward, Home renders with data
// already in hand.
//
// TTLs:
// • Discounters:  30 min   — list of grocery-store brands; basically static
// • Handelsmarken: 30 min  — same; per-id, cached forever within the session
// • Top-products:  3 min   — featured products rotate, but within a short
//                            window of activity we want stability
const TTL_LONG_MS = 30 * 60 * 1000;
const TTL_SHORT_MS = 3 * 60 * 1000;

const discounterCache = new Map<string, CacheEntry<any[]>>();
const discounterInflight = new Map<string, Promise<any[]>>();

// Marken (= Hersteller-Collection, ~968 Docs full scan) — gleiche
// Caching-Strategie wie Discounter, weil das die teuerste Reference-
// Query der App ist. Pro Session ein einziger Read; bis 30 Min
// nach Cache-Write sind alle weiteren `getMarken()`-Aufrufe
// in-memory.
const markenCache = new Map<string, CacheEntry<any[]>>();
const markenInflight = new Map<string, Promise<any[]>>();

// Top-Products-Aggregate (Cloud Function: top-products-aggregator) —
// 1 Read pro Session statt clientseitiger Aggregation der
// productRatings-Collection. Wird wöchentlich befüllt, plus manuell
// re-runnable via /aggregateTopProductsHttp.
const topProductsAggregateCache = {
  value: null as {
    overall: any[];
    monthly: any[];
    mostViewed: any[];
    updatedAt: Date | null;
  } | null,
  expiresAt: 0,
};
let topProductsAggregateInflight: Promise<{
  overall: any[];
  monthly: any[];
  mostViewed: any[];
  updatedAt: Date | null;
}> | null = null;

const refDocCache = new Map<string, CacheEntry<any>>();
const refDocInflight = new Map<string, Promise<any>>();

const topProductsCache = new Map<string, CacheEntry<any[]>>();
const topProductsInflight = new Map<string, Promise<any[]>>();

// Top-rated Produkte des letzten Monats — Cache + Inflight-Dedup, 10
// Min TTL. Die Anfrage fasst alle productRatings der letzten 30 Tage
// zusammen, aggregiert client-side per productId und holt dann die
// Produkt-Dokumente nach. Bei vielen Bewertungen kann das teurer
// werden (~hunderte Reads), deshalb pro Session nur 1× pro 10 Minuten.
const topRatedCache = new Map<string, CacheEntry<any[]>>();
const topRatedInflight = new Map<string, Promise<any[]>>();

// ─── Name-Similarity Helpers (für getEnttarnteAlternatives) ─────
//
// Cheap Token-Score-Funktion für die "Weitere enttarnte Produkte"-
// Liste. Ziel: bei einem Toastbrot zuerst andere Toastbrote zeigen,
// dann andere Brote, dann Rest-Kategorie. KEIN Levenshtein, KEINE
// externe Lib — nur Tokenisierung + exact/substring-Match.

const PRODUCT_NAME_STOPWORDS = new Set([
  // Artikel + Bindewörter (deutsch)
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einer', 'einem', 'einen', 'eines',
  'mit', 'und', 'oder', 'für', 'aus', 'auf', 'in', 'im',
  'zu', 'zum', 'zur', 'an', 'am', 'auch',
  'von', 'vom', 'bei', 'beim', 'als',
  // Generische Marketing-Worte die in vielen Produktnamen
  // auftauchen ohne tatsächliche Produktinformation. Beim Stufe-3-
  // Vergleich helfen sie nicht und verzerren das Score.
  'beste', 'wahl', 'gut', 'gold', 'select', 'premium',
  'feinkost',
]);

function tokenizeProductName(
  name: string,
  handelsmarkeName?: string | null,
): string[] {
  if (!name) return [];
  const cleaned = String(name)
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Handelsmarken-Tokens entfernen — sonst matchen z.B. zwei "REWE
  // Beste Wahl"-Produkte sich gegenseitig nur über die Marke statt
  // über den Inhalt.
  const hmTokens = new Set<string>();
  if (handelsmarkeName) {
    String(handelsmarkeName)
      .toLowerCase()
      .replace(/[^a-zäöüß0-9\s-]/g, ' ')
      .replace(/-/g, ' ')
      .split(/\s+/)
      .forEach((t) => {
        if (t) hmTokens.add(t);
      });
  }
  return cleaned
    .split(' ')
    .filter(
      (t) =>
        t.length >= 3 && !PRODUCT_NAME_STOPWORDS.has(t) && !hmTokens.has(t),
    );
}

function scoreNameSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let score = 0;
  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb) {
        score += 2; // exakter Token-Match (z.B. "toastbrot" == "toastbrot")
      } else if (ta.length >= 4 && tb.length >= 4) {
        // Substring-Stem-Match: "toast" inside "toastbrot",
        // "brot" inside "toastbrot". Mindest-Länge 4 vermeidet
        // dass "ml" / "kg" / "g" usw. Lärm produzieren.
        if (ta.includes(tb) || tb.includes(ta)) score += 1;
      }
    }
  }
  return score;
}

// Per-Kategorie-Alternativen-Cache — pro Kategorie ein Eintrag mit
// 30-Min TTL. Damit verursacht das Anschauen mehrerer Produkte
// derselben Kategorie nur EINEN Firestore-Query. Empty-Treffer
// werden mit kürzerem TTL (1 Min) gespeichert, damit eine eben neu
// hochgeladene Stufe-3-Variante schnell sichtbar wird.
const enttarnteAlternativesCache = new Map<
  string,
  CacheEntry<Array<{
    id: string;
    name: string;
    bild: string | null;
    preis: number | null;
    stufe: number;
    handelsmarkeName: string | null;
    handelsmarkeLogo: string | null;
    discounterName: string | null;
    discounterLogo: string | null;
    discounterLand: string | null;
  }>>
>();
const enttarnteAlternativesInflight = new Map<
  string,
  Promise<any[]>
>();

// Connected-Brands map — pre-computed im Cloud-Function-Aggregator
// (`cloud-functions/connected-brands-aggregator/`) als EIN einziger
// Top-Level-Doc unter `aggregates/herstellerBrands_v1` mit Field
// `byHersteller.{herstellerId} = brands[]`. Pro App-Session genau
// ein einziger Read für ALLE Hersteller-Lookups, danach In-Memory-
// Cache. Erbt automatisch die `aggregates/*`-Read-Permission, die
// auch die Leaderboard-Aggregates nutzen.
const connectedBrandsAllCache = {
  value: null as Record<string, any[]> | null,
  expiresAt: 0,
};
let connectedBrandsAllInflight: Promise<Record<string, any[]>> | null = null;

// Fire-and-forget image prefetch. The hero image is the slowest
// network resource on the detail screens — by kicking off the
// download in parallel with the Firestore reference fetch, the
// image is usually in the iOS/Android disk cache by the time the
// destination screen tries to render it. Eliminates the "image
// pops in mid-fade" feel.
function prefetchImage(uri: string | undefined | null) {
  if (!uri || typeof uri !== 'string' || !uri.startsWith('http')) return;
  // RNImage.prefetch returns a promise we deliberately don't await.
  RNImage.prefetch(uri).catch(() => {
    /* network errors are non-fatal — the screen will load it later */
  });
}

export class FirestoreService {

  /**
   * Holt die letzten 10 enttarnten Produkte (NoName-Produkte sortiert nach created_at)
   */
  static async getLatestEnttarnteProdukte(limitCount: number = 10): Promise<FirestoreDocument<Produkte>[]> {
    try {
      const produkteRef = collection(db, 'produkte');
      const q = query(
        produkteRef,
        orderBy('created_at', 'desc'),
        limit(limitCount)
      );

      const querySnapshot = await getDocs(q);
      const produkte: FirestoreDocument<Produkte>[] = [];

      querySnapshot.forEach((doc) => {
        produkte.push({
          id: doc.id,
          ...doc.data() as Produkte
        });
      });

      return produkte;
    } catch (error) {
      console.error('Error fetching latest enttarnte produkte:', error);
      throw error;
    }
  }

  /**
   * Top-enttarnte-Produkte-Rotator für die Home-Sektion:
   *   • Zieht einen Pool von `poolSize` Stufe-3/4/5-Produkten aus
   *     `produkte`.
   *   • Mischt den Pool Fisher-Yates.
   *   • Gibt die ersten `pickCount` Einträge zurück.
   *
   * Bewusst OHNE orderBy('created_at') — Firestore würde sonst einen
   * Composite-Index auf (stufe, created_at) verlangen, den wir nicht
   * haben. Seit wir den Pool sowieso clientseitig shuffeln, ist die
   * serverseitige Sortierreihenfolge egal: der User bekommt bei jedem
   * Home-Besuch 10 aus einem größeren Pool, egal in welcher
   * Reihenfolge Firestore die zurückliefert.
   */
  static async getTopEnttarnteProdukteRandomized(
    poolSize: number = 200,
    pickCount: number = 10,
  ): Promise<FirestoreDocument<Produkte>[]> {
    // Cache the POOL (not the random pick) so the user still sees
    // a fresh shuffle each visit, but we don't pay 200 doc-reads
    // per Home-tab open. Pool is shared across visits within the
    // 3-minute TTL window.
    const cacheKey = `pool:${poolSize}`;
    const cached = readCache(topProductsCache, cacheKey) as FirestoreDocument<Produkte>[] | null | undefined;
    let pool: FirestoreDocument<Produkte>[] | undefined =
      cached === undefined ? undefined : (cached ?? undefined);

    if (!pool) {
      const inflight = topProductsInflight.get(cacheKey);
      if (inflight) {
        pool = (await inflight) as FirestoreDocument<Produkte>[];
      } else {
        const promise = (async () => {
          try {
            const produkteRef = collection(db, 'produkte');
            const q = query(
              produkteRef,
              where('stufe', 'in', ['3', '4', '5']),
              limit(poolSize),
            );

            const snap = await getDocs(q);
            const fresh: FirestoreDocument<Produkte>[] = [];
            snap.forEach((d) => {
              fresh.push({ id: d.id, ...(d.data() as Produkte) });
            });
            writeCache(topProductsCache, cacheKey, fresh, TTL_SHORT_MS);
            return fresh;
          } finally {
            topProductsInflight.delete(cacheKey);
          }
        })();
        topProductsInflight.set(cacheKey, promise);
        pool = (await promise) as FirestoreDocument<Produkte>[];
      }
    }

    try {
      // Shuffle a COPY so we don't mutate the cached array.
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, pickCount);
    } catch (error) {
      console.error('Error fetching top enttarnte produkte:', error);
      throw error;
    }
  }

  /**
   * Holt NoName-Produkte mit Pagination für lazy loading
   */
  static async getNoNameProductsPaginated(
    pageSize: number = 10, // Reduziert von 20 auf 10 - spart Reads!
    lastDoc?: any,
    filters?: {
      categoryFilters?: string[];
      discounterFilters?: string[];
      stufeFilters?: number[];
      priceMin?: number;
      priceMax?: number;
      markeFilter?: string; // hersteller_new ID
      sortBy?: string; // 'name' | 'created_at' | 'preis'
      allergenFilters?: Record<string, boolean>; // Neue Allergen-Filter
      nutritionFilters?: Record<string, { min?: number; max?: number }>; // Neue Nährwert-Filter
    }
  ): Promise<{
    products: (FirestoreDocument<Produkte> & {
      discounter?: Discounter;
      handelsmarke?: Handelsmarken;
    })[];
    lastDoc: any;
    hasMore: boolean;
  }> {
    try {
      console.log(`🔍 Loading ${pageSize} NoName products...`);
      const startTime = Date.now();
      
      const produkteRef = collection(db, 'produkte');
      
      // Sortierung standardmäßig nach Name, außer bei Preis-Filtern
      const sortBy = filters?.sortBy || 'name';
      const sortDirection = sortBy === 'preis' ? 'asc' : 'asc';
      
      // Check if we have complex filters (not just category)
      const hasComplexFilters = (filters?.discounterFilters && filters.discounterFilters.length > 0) || 
                        (filters?.stufeFilters && filters.stufeFilters.length > 0) || 
                        filters?.priceMin !== undefined || 
                        filters?.priceMax !== undefined;
      
      // Sortierung möglich bei category-only Filtern (braucht composite index)
      const canSort = !hasComplexFilters;
      
      // Start with base query
      let q = canSort ? 
        query(produkteRef, orderBy(sortBy, sortDirection)) : 
        query(produkteRef);

      // Add filters if provided
      if (filters?.categoryFilters && filters.categoryFilters.length > 0) {
        if (filters.categoryFilters.length === 1) {
          const categoryRef = doc(db, 'kategorien', filters.categoryFilters[0]);
          q = query(q, where('kategorie', '==', categoryRef));
        } else {
          // Multiple categories - use 'in' query (max 10)
          const categoryRefs = filters.categoryFilters.slice(0, 10).map(id => doc(db, 'kategorien', id));
          q = query(q, where('kategorie', 'in', categoryRefs));
        }
      }
      
      if (filters?.discounterFilters && filters.discounterFilters.length > 0) {
        if (filters.discounterFilters.length === 1) {
          const discounterRef = doc(db, 'discounter', filters.discounterFilters[0]);
          q = query(q, where('discounter', '==', discounterRef));
        } else {
          // Multiple discounters - use 'in' query (max 10)
          const discounterRefs = filters.discounterFilters.slice(0, 10).map(id => doc(db, 'discounter', id));
          q = query(q, where('discounter', 'in', discounterRefs));
        }
      }

      if (filters?.stufeFilters && filters.stufeFilters.length > 0) {
        if (filters.stufeFilters.length === 1) {
          q = query(q, where('stufe', '==', filters.stufeFilters[0].toString()));
        } else {
          // Multiple stufen - use 'in' query (max 10)
          const stufeStrings = filters.stufeFilters.slice(0, 10).map(s => s.toString());
          q = query(q, where('stufe', 'in', stufeStrings));
        }
      }

      if (filters?.priceMin !== undefined) {
        q = query(q, where('preis', '>=', filters.priceMin));
      }

      if (filters?.priceMax !== undefined) {
        q = query(q, where('preis', '<=', filters.priceMax));
      }

      // TODO: Marke-Filter ist komplexer - erstmal deaktiviert wegen Firestore 'in' Limits
      // if (filters?.markeFilter) {
      //   const markeRef = doc(db, 'hersteller_new', filters.markeFilter);
      //   // Erst alle hersteller finden die auf diese marke zeigen
      //   const herstellerQuery = query(
      //     collection(db, 'hersteller'),
      //     where('herstellerref', '==', markeRef)
      //   );
      //   const herstellerSnapshot = await getDocs(herstellerQuery);
      //   
      //   if (herstellerSnapshot.docs.length > 0) {
      //     // Dann nach diesen hersteller-IDs filtern
      //     const herstellerRefs = herstellerSnapshot.docs.map(doc => doc.ref);
      //     q = query(q, where('hersteller', 'in', herstellerRefs));
      //   } else {
      //     // Keine Hersteller gefunden für diese Marke - leeres Ergebnis
      //     return { products: [], lastDoc: null, hasMore: false };
      //   }
      // }

      // Add pagination
      if (lastDoc) {
        q = query(q, startAfter(lastDoc));
      }
      
      q = query(q, limit(pageSize));

      const querySnapshot = await getDocs(q);
      
      // ✅ Parallel processing für bessere Performance
      const productPromises = querySnapshot.docs.map(async (docSnap) => {
        const productData = docSnap.data() as Produkte;
        const productWithDetails: FirestoreDocument<Produkte> & {
          discounter?: Discounter;
          handelsmarke?: Handelsmarken;
          hersteller?: any;
        } = {
          id: docSnap.id,
          ...productData
        };

        // Populate references parallel für UI-Daten
        // hersteller_new ist neu dabei — UI zeigt seinen `name` als
        // zweite Zeile unter dem Produkttitel auf NoName-Karten
        // (Stöbern, shopping-list, comparison alt-cards). Cost: +1
        // ref-fetch pro Produkt — aber `getDocumentByReference` cacht
        // 30 min sessionsweit, und viele Produkte teilen denselben
        // Hersteller (e.g. "Andechser Molkerei" für 50 Produkte) →
        // praktisch fast immer Cache-Hits nach dem ersten Load.
        const [discounter, handelsmarke, hersteller] = await Promise.all([
          this.getDocumentByReference<Discounter>(productData.discounter),
          this.getDocumentByReference<Handelsmarken>(productData.handelsmarke),
          (productData as any).hersteller
            ? this.getDocumentByReference<any>((productData as any).hersteller)
            : Promise.resolve(null),
        ]);

        if (discounter) productWithDetails.discounter = discounter;
        if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;
        if (hersteller) productWithDetails.hersteller = hersteller;

        return productWithDetails;
      });
      
      let products = await Promise.all(productPromises);
      
      // Client-Side Filtering für Allergene und Nährwerte
      if (filters?.allergenFilters || filters?.nutritionFilters) {
        products = products.filter(product => {
          const moreInfo = (product as any).moreInformation;
          
          // Produkte ohne moreInformation werden nicht gefiltert (durchgelassen)
          if (!moreInfo) return true;
          
          // Prüfe Allergene
          if (filters.allergenFilters) {
            for (const [allergen, shouldExclude] of Object.entries(filters.allergenFilters)) {
              if (shouldExclude && moreInfo[allergen] === true) {
                return false; // Produkt enthält ein ausgeschlossenes Allergen
              }
            }
          }
          
          // Prüfe Nährwerte
          if (filters.nutritionFilters) {
            for (const [nutritionKey, range] of Object.entries(filters.nutritionFilters)) {
              if (!range || (range.min === undefined && range.max === undefined)) continue;
              
              const valueStr = moreInfo[nutritionKey];
              // Wenn kein Wert vorhanden, Produkt durchlassen
              if (!valueStr) return true;
              
              // Extrahiere Zahl aus String wie "87 kcal" oder "<0,1 g"
              const match = valueStr.match(/[<>]?\s*(\d+(?:,\d+)?)/);
              if (!match) return true; // Bei ungültigem Format durchlassen
              
              const value = parseFloat(match[1].replace(',', '.'));
              
              if (range.min !== undefined && value < range.min) return false;
              if (range.max !== undefined && value > range.max) return false;
            }
          }
          
          return true;
        });
      }
      
      const newLastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      const hasMore = querySnapshot.docs.length === pageSize;

      const endTime = Date.now();
      console.log(`✅ Loaded ${products.length} NoName products in ${endTime - startTime}ms (with populated refs)`);

      return {
        products,
        lastDoc: newLastDoc,
        hasMore
      };
    } catch (error) {
      console.error('Error fetching paginated NoName products:', error);
      throw error;
    }
  }

  /**
   * Holt die letzten 10 Markenprodukte sortiert nach created_at
   */
  static async getLatestMarkenProdukte(limitCount: number = 10): Promise<FirestoreDocument<MarkenProdukte>[]> {
    try {
      const markenProdukteRef = collection(db, 'markenProdukte');
      const q = query(
        markenProdukteRef, 
        orderBy('created_at', 'desc'), 
        limit(limitCount)
      );
      
      const querySnapshot = await getDocs(q);
      const markenProdukte: FirestoreDocument<MarkenProdukte>[] = [];
      
      querySnapshot.forEach((doc) => {
        markenProdukte.push({
          id: doc.id,
          ...doc.data() as MarkenProdukte
        });
      });
      
      return markenProdukte;
    } catch (error) {
      console.error('Error fetching latest marken produkte:', error);
      throw error;
    }
  }

  /**
   * Holt ein einzelnes Dokument per Referenz (unterstützt verschiedene Formate).
   *
   * Cached for 30 min by full document path — Handelsmarke /
   * Hersteller / Kategorie / Discounter values rarely change, and
   * this method is called dozens of times during a Home-tab open
   * (one per featured product, etc.). Cache hit avoids the round
   * trip entirely.
   */
  static async getDocumentByReference<T>(ref: DocumentReference | any): Promise<T | null> {
    if (!ref) return null;

    let docRef: DocumentReference;
    let cacheKey: string;

    try {
      if ((ref as any).referencePath) {
        const path = (ref as any).referencePath;
        const [collection, id] = path.split('/');
        docRef = doc(db, collection, id);
        cacheKey = path;
      } else if (ref.id && ref.path) {
        docRef = ref;
        cacheKey = ref.path;
      } else {
        console.error('Unsupported reference format:', ref);
        return null;
      }
    } catch (e) {
      console.error('Error parsing reference:', e);
      return null;
    }

    // Cache hit
    const cached = readCache(refDocCache, cacheKey);
    if (cached !== undefined) return cached as T | null;

    // Inflight de-dup: parallel callers for the same ref share one
    // Firestore round-trip.
    const inflight = refDocInflight.get(cacheKey);
    if (inflight) return (await inflight) as T | null;

    const promise = (async () => {
      try {
        const docSnap = await getDoc(docRef);
        const value = docSnap.exists() ? (docSnap.data() as any) : null;
        writeCache(refDocCache, cacheKey, value, TTL_LONG_MS);
        return value;
      } catch (error) {
        console.error('Error fetching document by reference:', error);
        return null;
      } finally {
        refDocInflight.delete(cacheKey);
      }
    })();

    refDocInflight.set(cacheKey, promise);
    return (await promise) as T | null;
  }

  /**
   * Holt alle Kategorien
   */
  static async getKategorien(): Promise<FirestoreDocument<Kategorien>[]> {
    try {
      const kategorienRef = collection(db, 'kategorien');
      const querySnapshot = await getDocs(kategorienRef);
      const kategorien: FirestoreDocument<Kategorien>[] = [];
      
      querySnapshot.forEach((doc) => {
        kategorien.push({
          id: doc.id,
          ...doc.data() as Kategorien
        });
      });
      
      return kategorien;
    } catch (error) {
      console.error('Error fetching kategorien:', error);
      throw error;
    }
  }

  /**
   * Holt Markenprodukte mit Pagination für lazy loading
   */
  static async getMarkenproduktePaginated(
    pageSize: number = 10, // Reduziert von 20 auf 10 - spart Reads!
    lastDoc?: any,
    filters?: {
      categoryFilters?: string[];
      herstellerFilters?: string[]; // hersteller_new IDs
      priceMin?: number;
      priceMax?: number;
      sortBy?: string; // 'name' | 'created_at' | 'preis'
      allergenFilters?: Record<string, boolean>; // Neue Allergen-Filter
      nutritionFilters?: Record<string, { min?: number; max?: number }>; // Neue Nährwert-Filter
    }
  ): Promise<{
    products: (FirestoreDocument<any> & {
      hersteller?: HerstellerNew;
    })[];
    lastDoc: any;
    hasMore: boolean;
  }> {
    try {
      console.log(`🔍 Loading ${pageSize} Markenprodukte...`);
      const startTime = Date.now();
      
      const produkteRef = collection(db, 'markenProdukte');
      
      // Sortierung standardmäßig nach Name
      const sortBy = filters?.sortBy || 'name';
      const sortDirection = sortBy === 'preis' ? 'asc' : 'asc';
      
      // Check if we have complex filters (preis macht composite indexes schwierig)
      const hasComplexFilters = filters?.priceMin !== undefined || 
                        filters?.priceMax !== undefined;
      
      // Sortierung möglich bei category/hersteller-only Filtern (braucht composite index)
      const canSort = !hasComplexFilters;
      
      // Start with base query
      let q = canSort ? 
        query(produkteRef, orderBy(sortBy, sortDirection)) : 
        query(produkteRef);

      // Add filters if provided
      if (filters?.categoryFilters && filters.categoryFilters.length > 0) {
        if (filters.categoryFilters.length === 1) {
          const categoryRef = doc(db, 'kategorien', filters.categoryFilters[0]);
          q = query(q, where('kategorie', '==', categoryRef));
        } else {
          const categoryRefs = filters.categoryFilters.slice(0, 10).map(id => doc(db, 'kategorien', id));
          q = query(q, where('kategorie', 'in', categoryRefs));
        }
      }

      if (filters?.herstellerFilters && filters.herstellerFilters.length > 0) {
        console.log('🔍 Applying hersteller filters:', filters.herstellerFilters);
        if (filters.herstellerFilters.length === 1) {
          // WICHTIG: markenProdukte haben 'hersteller' Referenz auf 'hersteller' Collection, nicht 'hersteller_new'
          const herstellerRef = doc(db, 'hersteller', filters.herstellerFilters[0]);
          q = query(q, where('hersteller', '==', herstellerRef));
          console.log('🎯 Single hersteller filter:', herstellerRef.path);
        } else {
          const herstellerRefs = filters.herstellerFilters.slice(0, 10).map(id => doc(db, 'hersteller', id));
          q = query(q, where('hersteller', 'in', herstellerRefs));
          console.log('🎯 Multiple hersteller filters:', herstellerRefs.map(ref => ref.path));
        }
      }

      if (filters?.priceMin !== undefined) {
        q = query(q, where('preis', '>=', filters.priceMin));
      }

      if (filters?.priceMax !== undefined) {
        q = query(q, where('preis', '<=', filters.priceMax));
      }

      // Add pagination
      if (lastDoc) {
        q = query(q, startAfter(lastDoc));
      }
      
      q = query(q, limit(pageSize));

      const querySnapshot = await getDocs(q);
      
      // Parallel processing für bessere Performance
      const productPromises = querySnapshot.docs.map(async (docSnap) => {
        const productData = docSnap.data();
        const productWithDetails: any = {
          id: docSnap.id,
          ...productData
        };

        // Populate hersteller reference für UI-Daten (nur wenn vorhanden)
        if (productData.hersteller) {
          const hersteller = await this.getDocumentByReference<any>(productData.hersteller);
          if (hersteller) {
            productWithDetails.hersteller = hersteller;
            console.log(`✅ Loaded hersteller for ${productData.name}:`, hersteller.name);
          }
        }

        return productWithDetails;
      });
      
      let products = await Promise.all(productPromises);
      
      // Client-Side Filtering für Allergene und Nährwerte (gleiche Logik wie bei NoName)
      if (filters?.allergenFilters || filters?.nutritionFilters) {
        products = products.filter(product => {
          const moreInfo = (product as any).moreInformation;
          
          // Produkte ohne moreInformation werden nicht gefiltert (durchgelassen)
          if (!moreInfo) return true;
          
          // Prüfe Allergene
          if (filters.allergenFilters) {
            for (const [allergen, shouldExclude] of Object.entries(filters.allergenFilters)) {
              if (shouldExclude && moreInfo[allergen] === true) {
                return false; // Produkt enthält ein ausgeschlossenes Allergen
              }
            }
          }
          
          // Prüfe Nährwerte
          if (filters.nutritionFilters) {
            for (const [nutritionKey, range] of Object.entries(filters.nutritionFilters)) {
              if (!range || (range.min === undefined && range.max === undefined)) continue;
              
              const valueStr = moreInfo[nutritionKey];
              // Wenn kein Wert vorhanden, Produkt durchlassen
              if (!valueStr) return true;
              
              // Extrahiere Zahl aus String wie "87 kcal" oder "<0,1 g"
              const match = valueStr.match(/[<>]?\s*(\d+(?:,\d+)?)/);
              if (!match) return true; // Bei ungültigem Format durchlassen
              
              const value = parseFloat(match[1].replace(',', '.'));
              
              if (range.min !== undefined && value < range.min) return false;
              if (range.max !== undefined && value > range.max) return false;
            }
          }
          
          return true;
        });
      }
      
      const newLastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      const hasMore = querySnapshot.docs.length === pageSize;

      const endTime = Date.now();
      console.log(`✅ Loaded ${products.length} Markenprodukte in ${endTime - startTime}ms (with populated refs)`);

      return {
        products,
        lastDoc: newLastDoc,
        hasMore
      };
    } catch (error) {
      console.error('Error fetching paginated Markenprodukte:', error);
      throw error;
    }
  }

  /**
   * Holt Marken mit Pagination für lazy loading (für Marken-Tab)
   */
  static async getMarkenPaginated(
    pageSize: number = 10, // Reduziert von 20 auf 10 - spart Reads!
    lastDoc?: any
  ): Promise<{
    marken: FirestoreDocument<any>[];
    lastDoc: any;
    hasMore: boolean;
  }> {
    try {
      console.log(`🔍 Loading ${pageSize} Marken...`);
      const startTime = Date.now();
      
      const markenRef = collection(db, 'hersteller');
      
      let q = query(
        markenRef,
        orderBy('name', 'asc'),
        limit(pageSize)
      );
      
      if (lastDoc) {
        q = query(
          markenRef,
          orderBy('name', 'asc'),
          startAfter(lastDoc),
          limit(pageSize)
        );
      }
      
      const querySnapshot = await getDocs(q);
      const marken: FirestoreDocument<any>[] = [];
      
      querySnapshot.forEach((doc) => {
        marken.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      const newLastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      const hasMore = querySnapshot.docs.length === pageSize;
      
      const endTime = Date.now();
      console.log(`✅ Loaded ${marken.length} marken in ${endTime - startTime}ms`);
      
      return {
        marken,
        lastDoc: newLastDoc,
        hasMore
      };
    } catch (error) {
      console.error('Error fetching marken paginated:', error);
      return {
        marken: [],
        lastDoc: null,
        hasMore: false
      };
    }
  }

  /**
   * Holt alle Kategorien für Filter
   */
  static async getKategorien(): Promise<FirestoreDocument<Kategorien>[]> {
    try {
      const kategorienRef = collection(db, 'kategorien');
      const q = query(kategorienRef, orderBy('bezeichnung', 'asc'));
      const querySnapshot = await getDocs(q);
      
      const kategorien: FirestoreDocument<Kategorien>[] = [];
      querySnapshot.forEach((doc) => {
        kategorien.push({
          id: doc.id,
          ...doc.data() as Kategorien
        });
      });
      
      return kategorien;
    } catch (error) {
      console.error('Error fetching kategorien:', error);
      return [];
    }
  }

  /**
   * Holt alle Marken (hersteller_new) für Filter
   */
  static async getMarken(): Promise<FirestoreDocument<any>[]> {
    const KEY = 'all';
    // 30-Min In-Memory Cache + Inflight-Dedup. `getMarken()` scannt
    // die ganze `hersteller`-Collection (~968 Docs) — das teuerste
    // einzelne Read in der App. Pro Session ein einziger Roundtrip
    // reicht völlig, da sich die Marken-Liste praktisch nicht
    // innerhalb einer Session ändert.
    const cached = readCache(markenCache, KEY);
    if (cached !== undefined) return cached as FirestoreDocument<any>[];
    const inflight = markenInflight.get(KEY);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const markenRef = collection(db, 'hersteller');
        const q = query(markenRef, orderBy('name', 'asc'));
        const querySnapshot = await getDocs(q);

        const marken: FirestoreDocument<any>[] = [];
        querySnapshot.forEach((d) => {
          marken.push({
            id: d.id,
            ...d.data(),
          });
        });

        writeCache(markenCache, KEY, marken, TTL_LONG_MS);
        return marken;
      } catch (error) {
        console.error('Error fetching marken:', error);
        return [];
      } finally {
        markenInflight.delete(KEY);
      }
    })();

    markenInflight.set(KEY, promise as Promise<any[]>);
    return promise as Promise<FirestoreDocument<any>[]>;
  }

  /**
   * Sucht ähnliche NoName-Produkte basierend auf Keywords mit Algolia
   * Für Fallback-Produkte (z.B. Nutella → ähnliche Nuss-Nougat-Cremes)
   */
  static async searchSimilarProductsByKeywords(
    productName: string,
    limit: number = 5
  ): Promise<(FirestoreDocument<Produkte> & {
    discounter?: Discounter;
    handelsmarke?: Handelsmarken;
    kategorie?: Kategorien;
  })[]> {
    try {
      const { KeywordExtractor } = await import('./keywordExtractor');
      const { AlgoliaService } = await import('./algolia');
      
      // Bereinige den Produktnamen für die Algolia-Suche
      const searchQuery = KeywordExtractor.extractSearchQuery(productName);
      
      if (!searchQuery) {
        console.log('⚠️ No valid search query from:', productName);
        return [];
      }
      
      console.log(`🔍 Searching similar products with Algolia query: "${searchQuery}"`);
      
      // Suche mit Algolia (nur NoName Produkte) - mehr laden, da wir nach Stufe filtern
      const algoliaResults = await AlgoliaService.searchNoNameProducts(searchQuery, 0, limit * 2);
      
      if (algoliaResults.hits.length === 0) {
        console.log('⚠️ No similar products found');
        return [];
      }
      
      console.log(`✅ Found ${algoliaResults.hits.length} similar products from Algolia`);
      
      // Lade die vollständigen Produkte aus Firestore basierend auf Algolia objectIDs
      const productPromises = algoliaResults.hits.map(async (hit) => {
        try {
          // Lade Produkt aus Firestore
          const productDoc = await getDoc(doc(db, 'produkte', hit.objectID));
          
          if (!productDoc.exists()) {
            console.warn(`Product ${hit.objectID} not found in Firestore`);
            return null;
          }
          
          const data = productDoc.data() as Produkte;
          const productWithDetails = {
            id: productDoc.id,
            ...data
          } as FirestoreDocument<Produkte> & {
            discounter?: Discounter;
            handelsmarke?: Handelsmarken;
            kategorie?: Kategorien;
          };
          
          // Lade References parallel
          const [discounterData, handelsmarkeData, kategorieData] = await Promise.all([
            data.discounter ? getDoc(data.discounter) : null,
            data.handelsmarke ? getDoc(data.handelsmarke) : null,
            data.kategorie ? getDoc(data.kategorie) : null
          ]);
          
          if (discounterData?.exists()) {
            productWithDetails.discounter = { id: discounterData.id, ...discounterData.data() } as Discounter;
          }
          if (handelsmarkeData?.exists()) {
            productWithDetails.handelsmarke = { id: handelsmarkeData.id, ...handelsmarkeData.data() } as Handelsmarken;
          }
          if (kategorieData?.exists()) {
            productWithDetails.kategorie = { id: kategorieData.id, ...kategorieData.data() } as Kategorien;
          }
          
          return productWithDetails;
        } catch (error) {
          console.error(`Error loading product ${hit.objectID}:`, error);
          return null;
        }
      });
      
      const products = await Promise.all(productPromises);
      
      // Filtere null-Werte und nur Stufe 3, 4, 5 Produkte
      const filteredProducts = products.filter(p => {
        if (!p) return false;
        const stufe = parseInt(p.stufe || '0');
        return stufe >= 3 && stufe <= 5;
      }) as (FirestoreDocument<Produkte> & {
        discounter?: Discounter;
        handelsmarke?: Handelsmarken;
        kategorie?: Kategorien;
      })[];
      
      console.log(`✅ Filtered to ${filteredProducts.length} products with Stufe 3-5`);
      
      // Limitiere auf die gewünschte Anzahl
      return filteredProducts.slice(0, limit);
      
    } catch (error) {
      console.error('Error searching similar products with Algolia:', error);
      return [];
    }
  }

  /**
   * Holt ähnliche Produkte (Stufe 3,4,5) aus der gleichen Kategorie
   * Für die "Ähnliche Produkte" Sektion auf Stufe 1+2 Detailseiten
   */
  /**
   * "Weitere enttarnte Produkte" — Liste ähnlicher NoNames am
   * unteren Ende der Detail-Seiten. Sauber + günstig:
   *
   *   1. SAME-CATEGORY ONLY — kein globaler Fallback. Nur Produkte
   *      aus DERSELBEN `kategorie` werden gezeigt. "Toast neben
   *      Smoothie" tritt damit nicht mehr auf; Nischen-Kategorien
   *      ohne Stufe-3+-Treffer rendern gar nichts.
   *
   *   2. SINGLE-FIELD INDEX — Query nur mit `where('kategorie',
   *      '==', ref) limit 50`. Stufen-Filter (3,4,5) passiert
   *      client-side. Kein composite Index nötig.
   *
   *   3. PER-KATEGORIE CACHE — Pool pro Kategorie 30 Min im Memory.
   *      Zweiter Toast-Aufruf derselben Session: 0 zusätzliche Reads.
   *      Empty-Treffer cachen nur 1 Min (frisch hochgeladene Stufe-3-
   *      Variante schnell sichtbar).
   *
   *   4. NAME-NÄHE RANKING — der Pool wird client-side per Token-
   *      Similarity gegen den Namen des AKTUELLEN Produkts gerankt.
   *      Toastbrot-Visit zeigt zuerst andere Toastbrote, dann andere
   *      Brote (Substring-Match), dann der Rest der Kategorie.
   *      Random-Tiebreaker damit gleich-bewertete Treffer pro Visit
   *      varieren.
   */
  static async getEnttarnteAlternatives(
    opts: {
      excludeProductId: string;
      kategorieId?: string | null;
      productName?: string | null;
      handelsmarkeName?: string | null;
    },
    limitCount: number = 5,
  ): Promise<Array<{
    id: string;
    name: string;
    bild: string | null;
    preis: number | null;
    stufe: number;
    handelsmarkeName: string | null;
    handelsmarkeLogo: string | null;
    discounterName: string | null;
    discounterLogo: string | null;
    discounterLand: string | null;
  }>> {
    if (!opts.kategorieId) return [];

    const cacheKey = opts.kategorieId;
    let pool = readCache(enttarnteAlternativesCache, cacheKey);

    if (pool === undefined) {
      // Inflight-Dedup falls zwei Detail-Pages parallel dieselbe
      // Kategorie laden.
      const inflight = enttarnteAlternativesInflight.get(cacheKey);
      if (inflight) {
        pool = await inflight;
      } else {
        const promise = (async () => {
          try {
            const produkteRef = collection(db, 'produkte');
            const catRef = doc(db, 'kategorien', opts.kategorieId!);
            // Single-Field-where → kein composite Index nötig.
            const q = query(
              produkteRef,
              where('kategorie', '==', catRef),
              limit(50),
            );
            const snap = await getDocs(q);

            // Client-side Stufe-Filter (Stufe 3,4,5).
            const filtered = snap.docs.filter((d) => {
              const s = parseInt(String((d.data() as any).stufe ?? ''), 10);
              return s >= 3 && s <= 5;
            });

            // Joins parallel — Discounter + Handelsmarke. Beide
            // 30-Min-cached über `getDocumentByReference`, also
            // beim zweiten Aufruf fast immer Cache-Hits.
            const enriched = await Promise.all(
              filtered.map(async (docSnap) => {
                const p: any = { id: docSnap.id, ...(docSnap.data() as any) };
                const [hmDoc, dcDoc] = await Promise.all([
                  p.handelsmarke
                    ? this.getDocumentByReference<Handelsmarken>(p.handelsmarke).catch(
                        () => null,
                      )
                    : Promise.resolve(null),
                  p.discounter
                    ? this.getDocumentByReference<Discounter>(p.discounter).catch(
                        () => null,
                      )
                    : Promise.resolve(null),
                ]);
                return {
                  id: p.id,
                  name: p.name ?? 'Produkt',
                  bild: p.bild ?? null,
                  bildClean: (p as any).bildClean ?? null,
                  bildCleanPng: (p as any).bildCleanPng ?? null,
                  bildCleanHq: (p as any).bildCleanHq ?? null,
                  preis: typeof p.preis === 'number' ? p.preis : null,
                  stufe: parseInt(String(p.stufe ?? '')) || 1,
                  handelsmarkeName:
                    (hmDoc as any)?.bezeichnung ?? (hmDoc as any)?.name ?? null,
                  handelsmarkeLogo: (hmDoc as any)?.bild ?? null,
                  discounterName: (dcDoc as any)?.name ?? null,
                  discounterLogo: (dcDoc as any)?.bild ?? null,
                  discounterLand: (dcDoc as any)?.land ?? null,
                };
              }),
            );

            const ttl = enriched.length === 0 ? 60_000 : 30 * 60 * 1000;
            writeCache(enttarnteAlternativesCache, cacheKey, enriched, ttl);
            return enriched;
          } catch (e) {
            console.warn('getEnttarnteAlternatives failed', e);
            writeCache(enttarnteAlternativesCache, cacheKey, [], 60_000);
            return [];
          } finally {
            enttarnteAlternativesInflight.delete(cacheKey);
          }
        })();
        enttarnteAlternativesInflight.set(cacheKey, promise);
        pool = await promise;
      }
    }

    const raw = (pool ?? []).filter(
      (p: any) => p.id !== opts.excludeProductId,
    );

    // Name-Similarity-Ranking. Tokenize beide Seiten, scoring nach
    // exact match (+2) und Substring-Stem-Match (+1, wenn beide
    // Tokens ≥ 4 Zeichen → vermeidet Lärm wie "ml" matched "milch").
    // Für "Toastbrot": exact match auf "toastbrot" gewinnt, dann
    // substring "toast"/"brot", dann der Rest der Kategorie ohne
    // Token-Treffer.
    const currentTokens = tokenizeProductName(
      opts.productName ?? '',
      opts.handelsmarkeName,
    );
    const scored = raw.map((c) => ({
      item: c,
      score:
        currentTokens.length > 0
          ? scoreNameSimilarity(
              currentTokens,
              tokenizeProductName(c.name, c.handelsmarkeName),
            )
          : 0,
    }));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Random-Tiebreaker damit gleich-bewertete Treffer pro Visit
      // verschieden gemischt sind (Discovery-Charakter).
      return Math.random() - 0.5;
    });

    return scored.slice(0, limitCount).map((s) => s.item);
  }

  static async getSimilarProducts(
    categoryName: string, // Einfach der Kategorie-Name
    excludeProductId: string,
    limitCount: number = 3
  ): Promise<(FirestoreDocument<Produkte> & {
    discounter?: Discounter;
    handelsmarke?: Handelsmarken;
    kategorie?: Kategorien;
  })[]> {
    try {
      console.log('🔍 Loading similar products for category:', categoryName);
      
      // EINFACH: Kleine Query, random 7 Stufe 3,4,5 - SOFORT
      const produkteRef = collection(db, 'produkte');
      
      const q = query(
        produkteRef,
        where('stufe', 'in', ['3', '4', '5']),
        limit(10) // NUR 10 laden - noch sparsamer!
      );
      
      const querySnapshot = await getDocs(q);
      console.log(`📊 Found ${querySnapshot.docs.length} products with stufe 3,4,5`);
      
      // Random shuffle und nimm 7 - OHNE Kategorie-Check
      const shuffledDocs = querySnapshot.docs
        .filter(doc => doc.id !== excludeProductId)
        .sort(() => Math.random() - 0.5)
        .slice(0, limitCount);
      
      console.log(`✅ Selected ${shuffledDocs.length} random products, loading details...`);
      
      // Lade References parallel - SCHNELL
      const productPromises = shuffledDocs.map(async (docSnap) => {
        const productData = docSnap.data() as Produkte;
        const productWithDetails: any = { id: docSnap.id, ...productData };

        // Parallel References laden
        const [discounter, handelsmarke, kategorie] = await Promise.all([
          productData.discounter ? this.getDocumentByReference<Discounter>(productData.discounter) : null,
          productData.handelsmarke ? this.getDocumentByReference<Handelsmarken>(productData.handelsmarke) : null,
          productData.kategorie ? this.getDocumentByReference<Kategorien>(productData.kategorie) : null,
        ]);

        if (discounter) productWithDetails.discounter = discounter;
        if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;
        if (kategorie) productWithDetails.kategorie = kategorie;

        return productWithDetails;
      });

      const finalProducts = await Promise.all(productPromises);
      console.log(`✅ Returning ${finalProducts.length} random products FAST`);
      
      return finalProducts;
    } catch (error) {
      console.error('Error fetching similar products:', error);
      return [];
    }
  }

  /**
   * Holt alle Discounter/Märkte
   */
  static async getDiscounter(): Promise<FirestoreDocument<Discounter>[]> {
    // Cache for 30 min — the discounter list (Aldi, Lidl, …) is
    // basically static, refetching on every Home-tab focus is
    // wasteful. Inflight de-dup so concurrent callers share work.
    const KEY = 'discounter:all';
    const cached = readCache(discounterCache, KEY);
    if (cached !== undefined) return (cached ?? []) as FirestoreDocument<Discounter>[];

    const inflight = discounterInflight.get(KEY);
    if (inflight) return (await inflight) as FirestoreDocument<Discounter>[];

    const promise = (async () => {
      try {
        const discounterRef = collection(db, 'discounter');
        const querySnapshot = await getDocs(discounterRef);
        const discounter: FirestoreDocument<Discounter>[] = [];

        querySnapshot.forEach((doc) => {
          discounter.push({
            id: doc.id,
            ...doc.data() as Discounter
          });
        });
        writeCache(discounterCache, KEY, discounter, TTL_LONG_MS);
        return discounter;
      } catch (error) {
        console.error('Error fetching discounter:', error);
        throw error;
      } finally {
        discounterInflight.delete(KEY);
      }
    })();

    discounterInflight.set(KEY, promise as Promise<any[]>);
    return (await promise) as FirestoreDocument<Discounter>[];
  }

  /**
   * Zählt Produkte pro Discounter - OPTIMIERT mit getCountFromServer
   */
  static async getProductCountByDiscounter(discounterId: string): Promise<number> {
    try {
      const produkteRef = collection(db, 'produkte');
      const discounterDocRef = doc(db, 'discounter', discounterId);
      const q = query(produkteRef, where('discounter', '==', discounterDocRef));
      
      // ✅ OPTIMIERT: Nutze getCountFromServer statt getDocs
      // Das lädt KEINE Dokumente, sondern zählt nur serverseitig!
      const countSnapshot = await getCountFromServer(q);
      return countSnapshot.data().count;
    } catch (error) {
      console.error('Error counting products for discounter:', error);
      return 0;
    }
  }

  /**
   * Zählt Produkte pro Kategorie - OPTIMIERT mit getCountFromServer
   */
  static async getProductCountByCategory(categoryId: string): Promise<number> {
    try {
      const produkteRef = collection(db, 'produkte');
      const categoryDocRef = doc(db, 'kategorien', categoryId);
      const q = query(produkteRef, where('kategorie', '==', categoryDocRef));
      
      // ✅ OPTIMIERT: Nutze getCountFromServer statt getDocs
      // Das lädt KEINE Dokumente, sondern zählt nur serverseitig!
      const countSnapshot = await getCountFromServer(q);
      return countSnapshot.data().count;
    } catch (error) {
      console.error('Error counting products for category:', error);
      return 0;
    }
  }

  /**
   * Zählt Markenprodukte pro Marke (hersteller) - OPTIMIERT mit getCountFromServer
   */
  static async getProductCountByMarke(markeId: string): Promise<number> {
    try {
      const markenProdukteRef = collection(db, 'markenProdukte');
      const markeDocRef = doc(db, 'hersteller', markeId);
      const q = query(markenProdukteRef, where('hersteller', '==', markeDocRef));
      
      // ✅ OPTIMIERT: Nutze getCountFromServer statt getDocs
      // Das lädt KEINE Dokumente, sondern zählt nur serverseitig!
      const countSnapshot = await getCountFromServer(q);
      return countSnapshot.data().count;
    } catch (error) {
      console.error('Error counting products for marke:', error);
      return 0;
    }
  }

  /**
   * Holt Produkt mit allen Details (populated references)
   */
  /**
   * Fetch a NoName product with all references populated.
   *
   * Optional `onBasic` callback fires after the initial doc read but
   * BEFORE the parallel reference fetch resolves, with the product
   * payload as it sits in Firestore (raw refs, not joined). Detail
   * screens use this to render the hero (name/image/price/stufe) the
   * moment the main doc lands, then swap in the joined view (info
   * card with Hersteller + Kategorie names) once references resolve.
   * Result: a top-then-bottom reveal instead of one big flash.
   */
  static async getProductWithDetails(
    productId: string,
    onBasic?: (basic: ProductWithDetails) => void,
  ): Promise<ProductWithDetails | null> {
    // Cache hit → return immediately. The detail screen sees the
    // resolved promise on the very first paint, so there's no
    // skeleton flash on revisits / back-navigations.
    //
    // Schema-Check: ältere Cache-Einträge (ohne `herstellerId` /
    // `kategorieId`) müssen invalidiert werden, sonst sieht der
    // Client die nötigen IDs nicht und Connected-Brands /
    // Alternatives-Liste laden nicht. Wir prüfen NUR Felder, die
    // bei vorhandener Original-Ref auch da sein müssen — Produkte
    // ohne Kategorie/Hersteller brauchen die ID nicht.
    const cached = readCache(productDetailsCache, productId);
    const cachedAny = cached as any;
    const cachedSchemaOk =
      cached === null /* null-cached miss */ ||
      cachedAny == null ||
      ((cachedAny.hersteller == null || cachedAny.herstellerId !== undefined) &&
        (cachedAny.kategorie == null || cachedAny.kategorieId !== undefined));
    if (cached !== undefined && cachedSchemaOk) {
      // Fire the basic hook synchronously for symmetry with the
      // uncached path; it's a no-op if the caller doesn't pass one.
      if (onBasic && cached) {
        try {
          onBasic(cached);
        } catch (e) {
          console.warn('getProductWithDetails: onBasic callback threw (cached)', e);
        }
      }
      return cached;
    }
    if (cached !== undefined && !cachedSchemaOk) {
      if (__DEV__) {
        console.log(
          `[getProductWithDetails] dropping stale cache for ${productId} (no herstellerId)`,
        );
      }
      productDetailsCache.delete(productId);
    }

    // Inflight de-dup: if two screens (or screen + prefetch) ask for
    // the same product at once, both await the same Promise.
    const inflight = productDetailsInflight.get(productId);
    if (inflight) return inflight;

    const promise = (async (): Promise<ProductWithDetails | null> => {
      try {
        const productRef = doc(db, 'produkte', productId);
        const productSnap = await getDoc(productRef);

        if (!productSnap.exists()) {
          console.log('NoName product not found with ID:', productId);
          writeCache(productDetailsCache, productId, null);
          return null;
        }

        const productData = productSnap.data() as Produkte;
        const productWithDetails: ProductWithDetails = {
          id: productId,
          ...productData
        };

        // Kick the hero image into the OS disk cache in parallel
        // with the reference fetch — by the time the screen renders,
        // the image typically loads instantly (no "image pops in
        // mid-fade" pop).
        prefetchImage((productData as any).bild);

        // Fire the staged-load hook — caller can render the hero now.
        // Wrapped in try/catch so a screen-side render error never
        // breaks the data fetch itself.
        if (onBasic) {
          try {
            onBasic(productWithDetails);
          } catch (e) {
            console.warn('getProductWithDetails: onBasic callback threw', e);
          }
        }

        // Populate references parallel
        console.log(`🚀 Loading references for product ${productId}...`);
        const refStartTime = Date.now();

        // Hersteller-Brands werden bewusst NICHT hier mitgeladen.
        // Sie hängen an einem separaten Aggregate-Doc (Cloud-Function
        // `connected-brands-aggregator`) und haben damit ein anderes
        // Refresh-Intervall als das Produkt selbst. Wenn wir sie hier
        // mit-cachten, würde ein zwischenzeitlicher Aggregator-Run
        // erst nach Ablauf des 5-Min-Product-Caches sichtbar — wir
        // wollen aber, dass neu aggregierte Brands beim nächsten
        // Detail-Aufruf direkt erscheinen. Stattdessen ruft der
        // Client `getConnectedBrandsForHersteller(herstellerId)`
        // separat ab.
        const [kategorie, discounter, handelsmarke, hersteller, markenProdukt, packTypInfo] = await Promise.all([
          FirestoreService.getDocumentByReference<Kategorien>(productData.kategorie),
          FirestoreService.getDocumentByReference<Discounter>(productData.discounter),
          FirestoreService.getDocumentByReference<Handelsmarken>(productData.handelsmarke),
          FirestoreService.getDocumentByReference<HerstellerNew>(productData.hersteller),
          FirestoreService.getDocumentByReference<MarkenProdukte>(productData.markenProdukt),
          // packTyp resolution was missing here — same as the marken-
          // produkt loader at line ~1722, but for the noname path. Without
          // it, `packTypInfo` stays undefined on stufe-1+2 docs and the
          // detail screen's price chip silently drops the "Xg ·
          // Y€/kg" line. Adding the parallel fetch costs zero (it
          // joins the same Promise.all).
          FirestoreService.getDocumentByReference<Packungstypen>(productData.packTyp),
        ]);

        const refEndTime = Date.now();
        console.log(`✅ References loaded in ${refEndTime - refStartTime}ms`);

        if (kategorie) productWithDetails.kategorie = kategorie;
        if (discounter) productWithDetails.discounter = discounter;
        if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;
        if (hersteller) productWithDetails.hersteller = hersteller;
        if (markenProdukt) productWithDetails.markenProdukt = markenProdukt;
        if (packTypInfo) (productWithDetails as any).packTypInfo = packTypInfo;
        // Original-Refs liefern ID, populierte Daten nicht. Wir
        // hängen die IDs explizit an, damit Caller (Connected-Brands,
        // Alternatives-Liste, …) sie ohne weiteren Fetch haben.
        // Defensive Extraktion über alle Ref-Shapes (Modular SDK,
        // Legacy `referencePath`, Lite-SDK `_path.segments`, alter
        // `path`-Getter).
        const refToId = (ref: any): string | null => {
          if (!ref) return null;
          if (typeof ref === 'string') return ref;
          if (ref.id) return ref.id;
          if (ref.referencePath) {
            const parts = String(ref.referencePath).split('/');
            return parts[parts.length - 1] || null;
          }
          if (ref._path?.segments && Array.isArray(ref._path.segments)) {
            const segs = ref._path.segments;
            return segs[segs.length - 1] || null;
          }
          if (ref.path) {
            const parts = String(ref.path).split('/');
            return parts[parts.length - 1] || null;
          }
          return null;
        };
        (productWithDetails as any).herstellerId = refToId(productData.hersteller);
        (productWithDetails as any).kategorieId = refToId(productData.kategorie);

        writeCache(productDetailsCache, productId, productWithDetails);
        return productWithDetails;
      } catch (error: any) {
        console.log('Error fetching NoName product details (this is normal if product is in other collection):', error?.message);
        return null;
      } finally {
        productDetailsInflight.delete(productId);
      }
    })();

    productDetailsInflight.set(productId, promise);
    return promise;
  }

  /**
   * Pre-warm the product-detail cache. Call this the moment the user
   * taps a product card, BEFORE pushing the route. By the time the
   * destination screen mounts and calls `getProductWithDetails`, the
   * Firestore round-trip is often already complete and the screen
   * gets a synchronous cache hit on its first render.
   *
   * Safe to call repeatedly — inflight de-dup means redundant calls
   * are free.
   */
  static prefetchProductDetails(productId: string): void {
    if (!productId) return;
    if (readCache(productDetailsCache, productId) !== undefined) return;
    if (productDetailsInflight.has(productId)) return;
    // Fire-and-forget; the inflight map will hand the same promise
    // back to the screen when it asks.
    void this.getProductWithDetails(productId);
  }

  /**
   * Get Discounter by ID
   */
  static async getDiscounterById(id: string): Promise<any> {
    try {
      const docRef = doc(db, 'discounter', id);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
      console.error(`Error fetching discounter ${id}:`, error);
      return null;
    }
  }

  /**
   * Get Handelsmarke by ID
   */
  static async getHandelsmarkeById(id: string): Promise<any> {
    try {
      const docRef = doc(db, 'handelsmarken', id);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
      console.error(`Error fetching handelsmarke ${id}:`, error);
      return null;
    }
  }

  /**
   * Get Hersteller by ID
   */
  static async getHerstellerById(id: string): Promise<any> {
    try {
      const docRef = doc(db, 'hersteller', id);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
      console.error(`Error fetching hersteller ${id}:`, error);
      return null;
    }
  }

  /**
   * Holt Markenprodukt mit allen Details (populated references).
   *
   * Optional `onBasic` callback fires after the initial doc read but
   * BEFORE any reference fetches resolve, with the raw product
   * payload. Detail screens use this to render the brand-product
   * hero (name/image/price) immediately, then swap in the
   * fully-joined view (Hersteller chip, Kategorie, Pack info, related
   * products) once the references and joins resolve.
   */
  static async getMarkenProduktWithDetails(
    productId: string,
    skipRelatedProducts: boolean = false,
    skipBrandsQuery: boolean = false,
    onBasic?: (basic: MarkenProduktWithDetails) => void,
  ): Promise<MarkenProduktWithDetails | null> {
    // Cache key includes the skip-flags because they materially
    // change the returned shape (related products, brands list).
    const cacheKey = `${productId}:${skipRelatedProducts ? 1 : 0}:${skipBrandsQuery ? 1 : 0}`;

    const cached = readCache(markenProduktDetailsCache, cacheKey);
    if (cached !== undefined) {
      if (onBasic && cached) {
        try {
          onBasic(cached);
        } catch (e) {
          console.warn('getMarkenProduktWithDetails: onBasic callback threw (cached)', e);
        }
      }
      return cached;
    }

    const inflight = markenProduktDetailsInflight.get(cacheKey);
    if (inflight) return inflight;

    const promise = (async (): Promise<MarkenProduktWithDetails | null> => {
    try {
      const productRef = doc(db, 'markenProdukte', productId);
      const productSnap = await getDoc(productRef);

      if (!productSnap.exists()) {
        console.log('Brand product not found with ID:', productId);
        writeCache(markenProduktDetailsCache, cacheKey, null);
        return null;
      }

      const productData = productSnap.data() as MarkenProdukte;

      // Pre-warm the image cache — same reasoning as the noname
      // path above (avoid hero-image-pops-in-mid-fade).
      prefetchImage((productData as any).bild);
      prefetchImage((productData as any).hersteller?.bild);

      // Fire the staged-load hook with the raw product BEFORE any
      // reference fetch — caller can render the hero now.
      if (onBasic) {
        try {
          onBasic({ id: productId, ...productData } as MarkenProduktWithDetails);
        } catch (e) {
          console.warn('getMarkenProduktWithDetails: onBasic callback threw', e);
        }
      }

      // Populate references
      const [kategorie, herstellerOrMarke, packTypInfo] = await Promise.all([
        productData.kategorie ? this.getDocumentByReference<Kategorien>(productData.kategorie) : Promise.resolve(null),
        productData.hersteller ? this.getDocumentByReference<any>(productData.hersteller) : Promise.resolve(null),
        productData.packTyp ? this.getDocumentByReference<Packungstypen>(productData.packTyp) : Promise.resolve(null)
      ]);

      // Removed verbose logs

      // Prüfe ob die hersteller Referenz auf eine Marke oder einen Hersteller zeigt
      let marke: any = null;
      let hersteller: any = null;
      let brands: any[] = [];
      
      if (herstellerOrMarke) {
        // Feld zeigt auf: herstellerOrMarke.name || herstellerOrMarke.herstellername
        
        // Prüfe ob es eine Marke ist (hat herstellerref) oder ein Hersteller (hat herstellername)
        if (herstellerOrMarke.herstellerref) {
          // Das ist eine MARKE
          marke = herstellerOrMarke;
          hersteller = await this.getDocumentByReference<any>(marke.herstellerref);
          brands = skipBrandsQuery ? [] : await this.getMarkenByHersteller(marke.herstellerref);
          // MARKE gefunden
        } else if (herstellerOrMarke.herstellername) {
          // Das ist direkt ein HERSTELLER
          hersteller = herstellerOrMarke;
          brands = skipBrandsQuery ? [] : await this.getMarkenByHersteller(productData.hersteller);
          // HERSTELLER gefunden
        }
      }
      
      // Original-Refs liefern ID, populierte Daten nicht — wir
      // hängen die Kategorie-ID separat an, sonst läuft die
      // "Weitere enttarnte Produkte"-Section auf der product-
      // comparison-Seite leer (sie braucht `kategorieId` für die
      // gezielte Same-Category-Query). Defensive Extraktion über
      // alle Ref-Shapes.
      const refToId = (ref: any): string | null => {
        if (!ref) return null;
        if (typeof ref === 'string') return ref;
        if (ref.id) return ref.id;
        if (ref.referencePath) {
          const parts = String(ref.referencePath).split('/');
          return parts[parts.length - 1] || null;
        }
        if (ref._path?.segments && Array.isArray(ref._path.segments)) {
          const segs = ref._path.segments;
          return segs[segs.length - 1] || null;
        }
        if (ref.path) {
          const parts = String(ref.path).split('/');
          return parts[parts.length - 1] || null;
        }
        return null;
      };

      const productWithDetails: MarkenProduktWithDetails = {
        id: productId,
        ...productData,
        kategorie,
        hersteller, // Echter Hersteller (hersteller_new)
        marke, // Die spezifische Marke dieses Produkts (hersteller)
        packTypInfo,
        brands, // Alle Marken dieses Herstellers
      };
      // ID-Felder als zusätzliche Properties — populierte Refs
      // verlieren ihre IDs sonst, und der Client braucht z.B.
      // `kategorieId` für die "Weitere enttarnte Produkte"-Liste.
      (productWithDetails as any).kategorieId = refToId(productData.kategorie);

      // Resolve related products if available (SKIP for performance in comparison view)
      if (!skipRelatedProducts && productData.relatedProdukte && productData.relatedProdukte.length > 0) {
        const relatedProducts = await Promise.all(
          productData.relatedProdukte.map(async (ref) => {
            const relatedProductSnap = await getDoc(ref);
            if (relatedProductSnap.exists()) {
              const relatedData = relatedProductSnap.data() as Produkte;
              const relatedWithDetails: ProductWithDetails = {
                id: relatedProductSnap.id,
                ...relatedData
              };

              // Populate basic references for related products
              const [relKategorie, relDiscounter, relHandelsmarke, relHersteller, relPackTyp] = await Promise.all([
                this.getDocumentByReference<Kategorien>(relatedData.kategorie),
                this.getDocumentByReference<Discounter>(relatedData.discounter),
                this.getDocumentByReference<Handelsmarken>(relatedData.handelsmarke),
                this.getDocumentByReference<HerstellerNew>(relatedData.hersteller),
                this.getDocumentByReference<Packungstypen>(relatedData.packTyp)
              ]);

              if (relKategorie) relatedWithDetails.kategorie = relKategorie;
              if (relDiscounter) relatedWithDetails.discounter = relDiscounter;
              if (relHandelsmarke) relatedWithDetails.handelsmarke = relHandelsmarke;
              if (relHersteller) relatedWithDetails.hersteller = relHersteller;
              if (relPackTyp) relatedWithDetails.packTypInfo = relPackTyp;

              return relatedWithDetails;
            }
            return null;
          })
        );

        productWithDetails.relatedProdukte = relatedProducts.filter(p => p !== null) as ProductWithDetails[];
      }

      writeCache(markenProduktDetailsCache, cacheKey, productWithDetails);
      return productWithDetails;
    } catch (error: any) {
      console.log('Error fetching brand product details (this is normal if product is in other collection):', error?.message);
      return null;
    } finally {
      markenProduktDetailsInflight.delete(cacheKey);
    }
    })();

    markenProduktDetailsInflight.set(cacheKey, promise);
    return promise;
  }

  /**
   * CORE FUNCTION: Get product comparison data
   * 
   * Logic:
   * 1. NoName clicked → Get linked brand product → Find all other NoName products linking to same brand
   * 2. Brand clicked → Show brand product → Find all NoName products linking to this brand
   * 
   * Always shows: Brand product on top + All related NoName products below
   */
  static async getProductComparisonData(
    productId: string,
    isMarkenProdukt: boolean = false,
    callbacks?: {
      /** Fires after the main brand product's main doc resolves —
       *  caller can render the hero (name/image/price) right away. */
      onMainBasic?: (basic: MarkenProduktWithDetails) => void;
      /** Fires once the main brand product is fully resolved with
       *  references — caller can render Hersteller chip, pack info,
       *  pricing-with-grundpreis. */
      onMainResolved?: (full: MarkenProduktWithDetails) => void;
    },
  ): Promise<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  } | null> {
    const cacheKey = `${productId}:${isMarkenProdukt ? 1 : 0}`;

    const cached = readCache(comparisonCache, cacheKey);
    // Schema-Check: alte Cache-Einträge ohne `kategorieId` am
    // mainProduct müssen invalidiert werden — sonst sieht der
    // Client `mainProduct.kategorieId === undefined` und die
    // Alternatives-Liste rendert nicht. Nur prüfen wenn das Doc
    // eine kategorie-Ref hat (sonst ist die ID irrelevant).
    const cachedSchemaOk =
      cached === null ||
      cached == null ||
      !((cached as any).mainProduct?.kategorie) ||
      (cached as any).mainProduct?.kategorieId !== undefined;
    if (cached !== undefined && cachedSchemaOk) {
      // Replay both staged-load callbacks synchronously so callers
      // that rely on them keep working with the cached path.
      if (cached) {
        if (callbacks?.onMainBasic) {
          try { callbacks.onMainBasic(cached.mainProduct); } catch {}
        }
        if (callbacks?.onMainResolved) {
          try { callbacks.onMainResolved(cached.mainProduct); } catch {}
        }
      }
      return cached;
    }
    if (cached !== undefined && !cachedSchemaOk) {
      comparisonCache.delete(cacheKey);
    }

    const inflight = comparisonInflight.get(cacheKey);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        let result;
        if (isMarkenProdukt) {
          // CASE 1: Brand product clicked
          result = await FirestoreService.getBrandProductComparison(productId, callbacks);
        } else {
          // CASE 2: NoName product clicked
          result = await FirestoreService.getNoNameProductComparison(productId, callbacks);
        }
        writeCache(comparisonCache, cacheKey, result);
        return result;
      } catch (error) {
        console.error('Error in getProductComparisonData:', error);
        return null;
      } finally {
        comparisonInflight.delete(cacheKey);
      }
    })();

    comparisonInflight.set(cacheKey, promise);
    return promise;
  }

  /**
   * Pre-warm the comparison cache. Call this when the user taps a
   * product card that routes to the comparison screen, before the
   * router push, so the destination screen often has data ready on
   * its first render. See `prefetchProductDetails` for details.
   */
  static prefetchComparisonData(productId: string, isMarkenProdukt: boolean): void {
    if (!productId) return;
    const cacheKey = `${productId}:${isMarkenProdukt ? 1 : 0}`;
    if (readCache(comparisonCache, cacheKey) !== undefined) return;
    if (comparisonInflight.has(cacheKey)) return;
    void this.getProductComparisonData(productId, isMarkenProdukt);
  }

  /**
   * CASE 1: Brand product clicked
   * → Show this brand product + find all NoName products that link to it
   */
  private static async getBrandProductComparison(
    brandProductId: string,
    callbacks?: {
      onMainBasic?: (basic: MarkenProduktWithDetails) => void;
      onMainResolved?: (full: MarkenProduktWithDetails) => void;
    },
  ): Promise<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  } | null> {
    try {
      const stepTimes: Record<string, number> = {};
      const totalStartTime = Date.now();

      // Get the brand product (skip related products and brands query for performance)
      let lastTime = Date.now();
      const brandProduct = await this.getMarkenProduktWithDetails(
        brandProductId,
        true,
        true,
        callbacks?.onMainBasic,
      );
      stepTimes['1_getBrandProduct'] = Date.now() - lastTime;
      lastTime = Date.now();
      if (!brandProduct) {
        console.error('❌ Brand product not found:', brandProductId);
        return null;
      }

      // Brand product fully resolved — caller can fill in Hersteller
      // chip, pack info, etc. before the noname carousel finishes.
      if (callbacks?.onMainResolved) {
        try {
          callbacks.onMainResolved(brandProduct);
        } catch (e) {
          console.warn('getBrandProductComparison: onMainResolved threw', e);
        }
      }

      // Find all NoName products that link to this brand product
      const relatedNoNameProducts = await this.findNoNameProductsByBrandId(brandProductId);
      stepTimes['2_findNoNameProducts'] = Date.now() - lastTime;
      
      console.log(`⏱️ BRAND CLICKED Performance:`);
      Object.entries(stepTimes).forEach(([step, time]) => {
        console.log(`  ${step}: ${time}ms`);
      });
      console.log(`  TOTAL: ${Date.now() - totalStartTime}ms`);
      console.log(`  Found ${relatedNoNameProducts.length} NoName alternatives`);
      
      return {
        mainProduct: brandProduct,
        relatedNoNameProducts,
        clickedProductId: brandProductId,
        clickedWasNoName: false
      };
    } catch (error) {
      console.error('Error in getBrandProductComparison:', error);
      return null;
    }
  }

  /**
   * CASE 2: NoName product clicked
   * → Get its linked brand product + find all other NoName products linking to same brand
   */
  private static async getNoNameProductComparison(
    noNameProductId: string,
    callbacks?: {
      onMainBasic?: (basic: MarkenProduktWithDetails) => void;
      onMainResolved?: (full: MarkenProduktWithDetails) => void;
    },
  ): Promise<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  } | null> {
    try {
      const stepTimes: Record<string, number> = {};
      const totalStartTime = Date.now();
      let lastTime = Date.now();
      
      // 🚀 PERFORMANCE FIX: Single Firebase call with parallel reference extraction
      const rawProductDoc = await getDoc(doc(db, 'produkte', noNameProductId));
      stepTimes['1_getRawProduct'] = Date.now() - lastTime;
      lastTime = Date.now();
      if (!rawProductDoc.exists()) {
        console.error('❌ NoName product not found:', noNameProductId);
        return null;
      }
      
      const rawData = rawProductDoc.data();
      // Found NoName product
      
      // Extract brand product ID from reference
      const originalMarkenProduktRef = rawData.markenProdukt;
      if (!originalMarkenProduktRef || !originalMarkenProduktRef.id) {
        console.error('❌ NoName product has no valid markenProdukt reference');
        return null;
      }
      
      const markenProduktId = originalMarkenProduktRef.id;
      // Extracted brand product ID
      
      // 🚀 PARALLEL: Load NoName product details + Brand product simultaneously
      const [noNameProduct, brandProduct] = await Promise.all([
        this.populateProductReferences(rawData, noNameProductId),
        this.getMarkenProduktWithDetails(
          markenProduktId,
          true,
          true,
          callbacks?.onMainBasic,
        ) // skip both for max performance!
      ]);
      stepTimes['2_loadBothProducts'] = Date.now() - lastTime;
      lastTime = Date.now();

      if (brandProduct && callbacks?.onMainResolved) {
        try {
          callbacks.onMainResolved(brandProduct);
        } catch (e) {
          console.warn('getNoNameProductComparison: onMainResolved threw', e);
        }
      }

      if (!noNameProduct || !brandProduct) {
        console.error('❌ Failed to load product details');
        return null;
      }
      
      // Found products, now find alternatives
      
      const relatedNoNameProducts = await this.findNoNameProductsByBrandReference(originalMarkenProduktRef);
      stepTimes['3_findAlternatives'] = Date.now() - lastTime;
      
      console.log(`⏱️ NONAME CLICKED Performance:`);
      Object.entries(stepTimes).forEach(([step, time]) => {
        console.log(`  ${step}: ${time}ms`);
      });
      console.log(`  TOTAL: ${Date.now() - totalStartTime}ms`);
      console.log(`  Found ${relatedNoNameProducts.length} NoName alternatives`);
      
      return {
        mainProduct: brandProduct,
        relatedNoNameProducts,
        clickedProductId: noNameProductId,
        clickedWasNoName: true
      };
    } catch (error) {
      console.error('Error in getNoNameProductComparison:', error);
      return null;
    }
  }

  /**
   * Helper: Extract brand product ID from NoName product's markenProdukt reference
   * Handles different DocumentReference formats (just like handelsmarke logic)
   */
  private static extractBrandProductId(noNameProduct: ProductWithDetails): string | null {
    const markenProduktRef = noNameProduct.markenProdukt;
    
    console.log('🔍 Extracting brand product ID from markenProdukt field:', markenProduktRef);
    
    if (!markenProduktRef) {
      console.log('❌ No markenProdukt field found');
      return null;
    }
    
    // Handle different reference formats (same as existing logic)
    if (typeof markenProduktRef === 'string') {
      console.log('✅ String format:', markenProduktRef);
      return markenProduktRef;
    } else if (markenProduktRef.id) {
      console.log('✅ DocumentReference.id format:', markenProduktRef.id);
      return markenProduktRef.id;
    } else if ((markenProduktRef as any).referencePath) {
      // Firestore serialized format: {"referencePath": "markenProdukte/abc123"}
      const path = (markenProduktRef as any).referencePath;
      const id = path.split('/').pop() || null;
      console.log('✅ referencePath format:', path, '→', id);
      return id;
    } else if ((markenProduktRef as any).__ref__) {
      // Alternative format: {"__ref__": "markenProdukte/abc123"}
      const path = (markenProduktRef as any).__ref__;
      const id = path.split('/').pop() || null;
      console.log('✅ __ref__ format:', path, '→', id);
      return id;
    }
    
    console.error('❌ Unknown markenProdukt reference format:', markenProduktRef);
    console.error('❌ Type:', typeof markenProduktRef);
    console.error('❌ Keys:', Object.keys(markenProduktRef));
    return null;
  }



  /**
   * Helper: Find all NoName products using DocumentReference (FASTEST)
   * Query: produkte collection where markenProdukt == brandProductRef
   */
  static async findNoNameProductsByBrandReference(brandProductRef: any): Promise<ProductWithDetails[]> {
    try {
      // Finding NoName products using DocumentReference
      
      const produkteRef = collection(db, 'produkte');
      const q = query(produkteRef, where('markenProdukt', '==', brandProductRef));
      const querySnapshot = await getDocs(q);
      
      // Found NoName products
      
      // 🚀 PERFORMANCE REVOLUTION: Use the shared batching function!
      return await this.batchProcessNoNameProducts(querySnapshot.docs);
      
    } catch (error) {
      console.error('Error in findNoNameProductsByBrandReference:', error);
      return [];
    }
  }

  /**
   * Helper: Find all NoName products that link to a specific brand product
   * Query: produkte collection where markenProdukt == brandProductId
   */
  static async findNoNameProductsByBrandId(brandProductId: string): Promise<ProductWithDetails[]> {
    try {
      console.log('🔍 Finding NoName products linked to brand ID:', brandProductId);
      
      // Create reference to the brand product
      const brandProductRef = doc(db, 'markenProdukte', brandProductId);
      
      // Query produkte collection for products that link to this brand
      const produkteRef = collection(db, 'produkte');
      const q = query(produkteRef, where('markenProdukt', '==', brandProductRef));
      
      const querySnapshot = await getDocs(q);
      
      // Processing NoName products with mega-batch optimization
      
      // 🚀 PERFORMANCE REVOLUTION: Use the shared batching function!
      return await this.batchProcessNoNameProducts(querySnapshot.docs);
    } catch (error) {
      console.error('Error finding related NoName products:', error);
      return [];
    }
  }

  /**
   * Findet alle Marken (hersteller Collection) die zu einem Hersteller (hersteller_new) gehören
   */
  static async getMarkenByHersteller(herstellerNewDocRef: DocumentReference): Promise<any[]> {
    try {
      // Suche Marken für Hersteller

      // Query alle hersteller Dokumente, die auf diesen hersteller_new zeigen
      const markenQuery = query(
        collection(db, 'hersteller'),
        where('herstellerref', '==', herstellerNewDocRef)
      );

      const markenSnapshot = await getDocs(markenQuery);
      const marken: any[] = [];

      markenSnapshot.forEach((doc) => {
        marken.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Dummy-/Platzhalter-Marken rausfiltern. Konvention im
      // Datenbestand: Platzhalter werden mit "z - " (z.B. "z - NoName")
      // benannt, damit sie alphabetisch ans Ende sortieren — die
      // dürfen nirgends als echte Marke auftauchen. Zusätzlich
      // exemplarische Generic-Begriffe (NoName / Dummy / Test /
      // Platzhalter) als Defensive.
      const isPlaceholder = (b: any): boolean => {
        const raw = String(b?.name ?? b?.bezeichnung ?? '').trim().toLowerCase();
        if (!raw) return true;
        if (raw.startsWith('z - ')) return true;
        if (raw.startsWith('z-')) return true;
        if (raw === 'noname' || raw === 'no name') return true;
        if (raw === 'dummy' || raw === 'test' || raw === 'platzhalter') return true;
        return false;
      };
      return marken.filter((m) => !isPlaceholder(m));
    } catch (error) {
      console.error('❌ Fehler beim Laden der Marken:', error);
      return [];
    }
  }

  /**
   * Connected Marken eines Herstellers — direkt UND via NoName→
   * Markenprodukt-Verknüpfung. Wird vom wöchentlichen Cloud-Function-
   * Aggregator (`cloud-functions/connected-brands-aggregator/`)
   * pre-computed und unter `aggregates/herstellerBrands_v1/items/
   * {herstellerNewId}` abgelegt.
   *
   * Returnt pro Eintrag: `{ id, name, bild, source: 'direct' |
   * 'via-markenprodukt' }`.
   *
   * Fallback-Logik:
   *   • Wenn das Aggregate-Doc existiert → nutzen.
   *   • Wenn nicht (z.B. ganz neuer Hersteller, Aggregator noch nie
   *     gelaufen) → fallback zu `getMarkenByHersteller` (nur direkte
   *     Marken). Damit funktioniert die UI auch ohne deployten
   *     Aggregator weiter, eben mit reduziertem Datenstand.
   *
   * 30 Min Cache + Inflight-Dedup pro Hersteller-ID.
   */
  /**
   * Lädt einmalig pro App-Session den kompletten Connected-Brands-
   * Index (~540 KB, 1 Read). Pro Hersteller-ID kommt der Lookup dann
   * aus der In-Memory-Map ohne weiteren Roundtrip.
   */
  private static async loadConnectedBrandsAll(): Promise<Record<string, any[]>> {
    if (
      connectedBrandsAllCache.value &&
      Date.now() < connectedBrandsAllCache.expiresAt
    ) {
      return connectedBrandsAllCache.value;
    }
    if (connectedBrandsAllInflight) return connectedBrandsAllInflight;

    connectedBrandsAllInflight = (async () => {
      try {
        const snap = await getDoc(doc(db, 'aggregates', 'herstellerBrands_v1'));
        if (!snap.exists()) {
          // Aggregat noch nicht vorhanden — leeres Map cachen für 45 s,
          // damit die App nicht jeden Detail-Aufruf erneut versucht.
          connectedBrandsAllCache.value = {};
          connectedBrandsAllCache.expiresAt = Date.now() + 45_000;
          return {};
        }
        const data = snap.data() as any;
        const byHersteller =
          data && typeof data.byHersteller === 'object' && data.byHersteller !== null
            ? (data.byHersteller as Record<string, any[]>)
            : {};
        // 30 Min Cache — Aggregat ändert sich wöchentlich, Sessions
        // sind selten länger als 30 Min.
        connectedBrandsAllCache.value = byHersteller;
        connectedBrandsAllCache.expiresAt = Date.now() + TTL_LONG_MS;
        return byHersteller;
      } catch (e) {
        console.warn('loadConnectedBrandsAll failed', e);
        connectedBrandsAllCache.value = {};
        connectedBrandsAllCache.expiresAt = Date.now() + 30_000;
        return {};
      } finally {
        connectedBrandsAllInflight = null;
      }
    })();

    return connectedBrandsAllInflight;
  }

  static async getConnectedBrandsForHersteller(
    herstellerNewRefOrId: DocumentReference | string | null | undefined,
  ): Promise<Array<{ id: string; name: string; bild: string | null; source: 'direct' | 'via-markenprodukt' }>> {
    if (!herstellerNewRefOrId) return [];

    // Defensive Extraktion über alle möglichen Ref-Shapes.
    let herstellerId = '';
    if (typeof herstellerNewRefOrId === 'string') {
      herstellerId = herstellerNewRefOrId;
    } else {
      const r = herstellerNewRefOrId as any;
      if (r.id) {
        herstellerId = r.id;
      } else if (r.referencePath) {
        const parts = String(r.referencePath).split('/');
        herstellerId = parts[parts.length - 1] || '';
      } else if (r._path?.segments && Array.isArray(r._path.segments)) {
        const segs = r._path.segments;
        herstellerId = segs[segs.length - 1] || '';
      } else if (r.path) {
        const parts = String(r.path).split('/');
        herstellerId = parts[parts.length - 1] || '';
      }
    }
    if (!herstellerId) return [];

    try {
      const all = await this.loadConnectedBrandsAll();
      const list = all[herstellerId];
      if (Array.isArray(list)) {
        // Defensive Normalisierung — falls jemand mal das Doc-Format
        // hand-editiert.
        return list
          .filter((b: any) => b?.id && b?.name)
          .map((b: any) => ({
            id: String(b.id),
            name: String(b.name),
            bild: b.bild ?? null,
            source:
              b.source === 'via-markenprodukt' ? 'via-markenprodukt' : 'direct',
          }));
      }

      // Hersteller nicht im Aggregat → Fallback auf direkte Marken-
      // Query. Tritt nur für ganz neue Hersteller auf, die nach dem
      // letzten Aggregator-Lauf erstellt wurden.
      const refForFallback =
        typeof herstellerNewRefOrId === 'string'
          ? doc(db, 'hersteller_new', herstellerNewRefOrId)
          : (herstellerNewRefOrId as DocumentReference);
      const direct = await this.getMarkenByHersteller(refForFallback);
      return (direct || [])
        .filter((b: any) => b?.id && (b?.name || b?.bezeichnung))
        .map((b: any) => ({
          id: String(b.id),
          name: String(b.name ?? b.bezeichnung),
          bild: b.bild ?? null,
          source: 'direct' as const,
        }));
    } catch (e) {
      console.warn('getConnectedBrandsForHersteller failed', e);
      return [];
    }
  }

  /**
   * Sucht NoName-Produkte anhand EAN/Barcode
   */
  static async searchProductsByEAN(ean: string): Promise<FirestoreDocument<ProductWithDetails>[]> {
    try {
      console.log(`🔍 Searching NoName products for EAN: ${ean}`);
      
      const produkteRef = collection(db, 'produkte');
      
      // Suche sowohl in EAN als auch in EANs Array
      const queries = [
        query(produkteRef, where('EAN', '==', ean)),
        query(produkteRef, where('EANs', 'array-contains', ean))
      ];
      
      const results = await Promise.all(queries.map(q => getDocs(q)));
      const foundProducts = new Map<string, any>();
      
      // Sammle alle gefundenen Produkte und entferne Duplikate
      for (const querySnapshot of results) {
        querySnapshot.forEach((doc) => {
          if (!foundProducts.has(doc.id)) {
            foundProducts.set(doc.id, {
              id: doc.id,
              ...doc.data() as Produkte
            });
          }
        });
      }
      
      const products = Array.from(foundProducts.values());
      console.log(`✅ Found ${products.length} NoName products for EAN: ${ean}`);
      
      return products;
      
    } catch (error) {
      console.error('Error searching products by EAN:', error);
      throw error;
    }
  }

  /**
   * Sucht Markenprodukte anhand EAN/Barcode
   */
  static async searchBrandProductsByEAN(ean: string): Promise<FirestoreDocument<MarkenProduktWithDetails>[]> {
    try {
      console.log(`🔍 Searching brand products for EAN: ${ean}`);
      
      const markenProdukteRef = collection(db, 'markenProdukte');
      
      // Suche sowohl in EAN als auch in EANs Array
      const queries = [
        query(markenProdukteRef, where('EAN', '==', ean)),
        query(markenProdukteRef, where('EANs', 'array-contains', ean))
      ];
      
      const results = await Promise.all(queries.map(q => getDocs(q)));
      const foundProducts = new Map<string, any>();
      
      // Sammle alle gefundenen Produkte und entferne Duplikate
      for (const querySnapshot of results) {
        querySnapshot.forEach((doc) => {
          if (!foundProducts.has(doc.id)) {
            foundProducts.set(doc.id, {
              id: doc.id,
              ...doc.data() as MarkenProdukte
            });
          }
        });
      }
      
      const products = Array.from(foundProducts.values());
      console.log(`✅ Found ${products.length} brand products for EAN: ${ean}`);
      
      return products;
      
    } catch (error) {
      console.error('Error searching brand products by EAN:', error);
      throw error;
    }
  }

  /**
   * Lädt User-Informationen für Community-Features
   */
  static async getUserInfo(userId: string): Promise<{
    displayName: string;
    avatarUrl?: string;
    level: number;
    currentLevel?: { 
      name: string; 
      color: string; 
      icon: string; 
    };
  } | null> {
    try {
      // Vereinfachte Abfrage - nur users Collection, keine Subcollections
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        // Fallback für nicht existierende User (normal für neue anonyme User)
        console.log('📝 User-Profil nicht gefunden:', userId, '- verwende Standard-Fallback');
        return {
          displayName: 'Community Mitglied',
          level: 1,
          currentLevel: {
            name: 'Neuling',
            color: '#6B7280',
            icon: 'person'
          }
        };
      }
      
      const userData = userDoc.data();
      
      // Versuche Stats zu laden, aber ohne Fehler wenn keine Permissions
      let userLevel = userData.level || 1;
      try {
        const userStatsRef = doc(db, 'users', userId, 'stats', 'achievements');
        const userStatsDoc = await getDoc(userStatsRef);
        if (userStatsDoc.exists()) {
          const stats = userStatsDoc.data();
          userLevel = stats.level || userLevel;
        }
      } catch (statsError) {
        // Ignoriere Stats-Fehler, verwende userData.level
        console.log('Stats not accessible, using user level:', userLevel);
      }
      
      // Level-Daten aus echtem Achievement-System laden
      let levelInfo = { name: 'Neuling', color: '#6B7280', icon: 'person' };
      
      try {
        // Verwende echtes Achievement-Service für korrekte Level-Daten
        await achievementService.initialize();
        const userPoints = userData.stats?.pointsTotal || 0;
        const userSavings = userData.stats?.savingsTotal || userData.totalSavings || 0;
        const realLevel = achievementService.getLevelForPoints(userPoints, userSavings);
        
        if (realLevel) {
          levelInfo = {
            name: realLevel.name,
            color: realLevel.color,
            icon: realLevel.icon
          };
          userLevel = realLevel.id; // Verwende echte Level-ID
          console.log(`✅ User Level für Kommentar: ${realLevel.name} (${userPoints} Punkte, €${userSavings} Ersparnis)`);
        }
      } catch (levelError) {
        console.log('Could not load achievement levels, using fallback');
        // Fallback bleibt bestehen
      }
      
      // Bessere Fallbacks für Display Name
      const displayName = userData.displayName || 
                         userData.name || 
                         userData.nickname ||
                         userData.email?.split('@')[0] || 
                         'Community Mitglied';
      
      return {
        displayName: displayName,
        avatarUrl: userData.photo_url || userData.photoURL || userData.profilePicture || userData.avatarUrl || userData.profileImageUrl,
        level: userLevel,
        currentLevel: levelInfo
      };
    } catch (error) {
      console.log('Could not load full user info, using defaults');
      
      // Fallback mit echten Level-1 Daten
      let fallbackLevel = { name: 'Neuling', color: '#6B7280', icon: 'person' };
      try {
        await achievementService.initialize();
        const level1 = achievementService.getLevelForPoints(0, 0);
        if (level1) {
          fallbackLevel = {
            name: level1.name,
            color: level1.color,
            icon: level1.icon
          };
        }
      } catch (e) {
        // Hardcoded Fallback bleibt bestehen
      }
      
      return {
        displayName: 'Community Mitglied',
        level: 1,
        currentLevel: fallbackLevel
      };
    }
  }

  /**
   * Lädt alle Bewertungen für ein Produkt mit LIVE User-Informationen
   * User-Level wird beim Öffnen des Rating-Sheets LIVE aus User-Dokument geladen
   */
  static async getProductRatingsWithUserInfo(productId: string, isNoNameProduct: boolean = true): Promise<any[]> {
    try {
      console.log('📊 LIVE Loading ratings with current user info for product:', productId);
      
      // Erst normale Bewertungen laden (schnell)
      const ratings = await this.getProductRatings(productId, isNoNameProduct);
      
      // Dann User-Infos LIVE laden (jedes Mal aktuell!)
      const ratingsWithUserInfo = await Promise.all(
        ratings.map(async (rating) => {
          const userId = rating.userID;
          if (userId) {
            // LIVE User-Info aus User-Dokument → Immer aktuelles Level!
            const userInfo = await this.getLiveUserInfo(userId);
            return {
              ...rating,
              userInfo
            };
          }
          
          // Fallback für Kommentare ohne userID
          return {
            ...rating,
            userInfo: {
              displayName: 'Community Mitglied',
              level: 1,
              currentLevel: await this.getLevel1Info()
            }
          };
        })
      );
      
      console.log(`✅ LIVE Loaded ${ratingsWithUserInfo.length} ratings with current user levels`);
      return ratingsWithUserInfo;
      
    } catch (error) {
      console.error('Error loading ratings with live user info:', error);
      return [];
    }
  }

  /**
   * Lädt LIVE User-Info direkt aus User-Dokument (immer aktuell!)
   */
  static async getLiveUserInfo(userId: string): Promise<{
    displayName: string;
    avatarUrl?: string;
    level: number;
    currentLevel: { name: string; color: string; icon: string; };
  }> {
    try {
      // User-Dokument direkt laden → Aktuellste Daten
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        return {
          displayName: 'Community Mitglied',
          level: 1,
          currentLevel: await this.getLevel1Info()
        };
      }
      
      const userData = userDoc.data();
      
      // Level LIVE aus Achievement-Service berechnen
      await achievementService.initialize();
      const userPoints = userData.stats?.pointsTotal || 0;
      const userSavings = userData.stats?.savingsTotal || userData.totalSavings || 0;
      const realLevel = achievementService.getLevelForPoints(userPoints, userSavings);
      
      const levelInfo = realLevel ? {
        name: realLevel.name,
        color: realLevel.color,
        icon: realLevel.icon
      } : await this.getLevel1Info();
      
      const displayName = userData.display_name || 
                         userData.displayName || 
                         userData.name || 
                         userData.email?.split('@')[0] || 
                         'Community Mitglied';
      
      return {
        displayName,
        avatarUrl: userData.photo_url || userData.photoURL,
        level: realLevel?.id || 1,
        currentLevel: levelInfo
      };
      
    } catch (error) {
      console.log('Error loading live user info, using fallback');
      return {
        displayName: 'Community Mitglied',
        level: 1,
        currentLevel: await this.getLevel1Info()
      };
    }
  }

  /**
   * Helper: Level-1 Daten aus Achievement-System
   */
  private static async getLevel1Info(): Promise<{ name: string; color: string; icon: string; }> {
    try {
      await achievementService.initialize();
      const level1 = achievementService.getLevelForPoints(0, 0);
      return level1 ? {
        name: level1.name,
        color: level1.color,
        icon: level1.icon
      } : { name: 'Neuling', color: '#6B7280', icon: 'person' };
    } catch (e) {
      return { name: 'Neuling', color: '#6B7280', icon: 'person' };
    }
  }

  /**
   * Lädt alle Bewertungen für ein Produkt aus der productRatings Collection
   */
  /**
   * Liefert die Top-N am besten bewerteten Produkte.
   *
   * `windowDays`:
   *   - `undefined` → Overall (alle Bewertungen, keine Datums-Filter)
   *   - `30`        → nur Bewertungen der letzten 30 Tage
   *   - andere Zahl → entsprechendes Tagesfenster
   *
   * Aggregation:
   *   1. Bewertungen aus `productRatings` lesen (mit/ohne Date-Filter).
   *   2. Pro Produkt-Referenz (NoName ODER Marke) avgRating, count
   *      und commentCount berechnen, plus den jüngsten Kommentar
   *      mit Inhalt (für die Vorschau-Card auf Home).
   *   3. Filter auf Produkte mit mindestens 1 Kommentar — sonst
   *      reißt die Liste optisch auseinander, weil die Card eine
   *      Kommentar-Vorschau zeigt.
   *   4. Combined-Score sortieren: Bayesian-Avg × log10(1 + count
   *      + 2 × commentCount). Verhindert Outlier UND zieht
   *      diskussionsfreudige Produkte nach oben.
   *   5. Top-N Produkte einzeln nachladen.
   *
   * Kosten-Profil: 1 collection-Query (mit/ohne Date-Filter) + N
   * parallele getDoc Calls (default 10). Cached 3 Min pro Window.
   * Overall ist auf <30 Tage Tagesbewertungen-Volumen vergleichbar,
   * solange die App nicht extrem viele Ratings akkumuliert; ab
   * ~5k+ Ratings gesamt sollten wir auf einen Cloud-Function-
   * Aggregator wechseln (siehe CLAUDE.md "Cost-conscious data").
   *
   * Rückgabe-Shape pro Eintrag:
   *   { id, type: 'noname' | 'marken', product (Doc-Daten),
   *     avgRating, ratingCount, commentCount, latestComment,
   *     latestRating }
   */
  /**
   * Liest die drei Home-Top-Produkt-Listen aus dem
   * Cloud-Function-pre-computed Aggregat-Doc:
   *   • Top 10 overall (Bewertungen, Bayesian-gerankt)
   *   • Top 10 letzter Monat (Bewertungen, gleiche Logik, 30-Tage-Filter)
   *   • Top 10 meist aufgerufen (Journey-Sessions letzte 30 Tage)
   *
   * 1 Firestore-Read pro App-Session. 30-Min In-Memory-Cache.
   * Aggregator-Doc wird wöchentlich vom `top-products-aggregator`
   * Cloud-Function befüllt.
   *
   * Pro Eintrag wird das vollständige Render-Shape geliefert
   * (Bild, Preis, Stufe, Brand-/Markt-/Hersteller-Joins) — keine
   * weiteren Reads nötig.
   */
  static async getTopProducts(): Promise<{
    overall: any[];
    monthly: any[];
    mostViewed: any[];
    updatedAt: Date | null;
  }> {
    if (
      topProductsAggregateCache.value &&
      Date.now() < topProductsAggregateCache.expiresAt
    ) {
      return topProductsAggregateCache.value;
    }
    if (topProductsAggregateInflight) return topProductsAggregateInflight;

    topProductsAggregateInflight = (async () => {
      try {
        const snap = await getDoc(doc(db, 'aggregates', 'topProducts_v1'));
        const empty = { overall: [], monthly: [], mostViewed: [], updatedAt: null };
        if (!snap.exists()) {
          // Aggregat noch nicht da (Erst-Deploy, neue Installation)
          // — leer cachen für 1 Min, danach erneut probieren.
          topProductsAggregateCache.value = empty;
          topProductsAggregateCache.expiresAt = Date.now() + 60_000;
          return empty;
        }
        const data = snap.data() as any;
        const result = {
          overall: Array.isArray(data?.overall) ? data.overall : [],
          monthly: Array.isArray(data?.monthly) ? data.monthly : [],
          mostViewed: Array.isArray(data?.mostViewed) ? data.mostViewed : [],
          updatedAt:
            data?.updatedAt?.toDate?.() ?? null,
        };
        topProductsAggregateCache.value = result;
        topProductsAggregateCache.expiresAt = Date.now() + TTL_LONG_MS;
        return result;
      } catch (e) {
        console.warn('getTopProducts failed', e);
        const empty = { overall: [], monthly: [], mostViewed: [], updatedAt: null };
        topProductsAggregateCache.value = empty;
        topProductsAggregateCache.expiresAt = Date.now() + 30_000;
        return empty;
      } finally {
        topProductsAggregateInflight = null;
      }
    })();

    return topProductsAggregateInflight;
  }

  static async getTopRatedProducts(
    limit: number = 10,
    windowDays?: number,
  ): Promise<Array<{
    id: string;
    type: 'noname' | 'marken';
    product: any;
    avgRating: number;
    ratingCount: number;
    commentCount: number;
    latestComment: string | null;
    latestRating: number | null;
    brandName: string | null;
    brandLogoUri: string | null;
    marketName: string | null;
    marketCountry: string | null;
    marketLogoUri: string | null;
    herstellerName: string | null;
    herstellerLogoUri: string | null;
  }>> {
    const cacheKey = `top-rated:${limit}:${windowDays ?? 'all'}`;
    const cached = readCache(topRatedCache, cacheKey) as any[] | null | undefined;
    if (cached) return cached as any;
    const inflight = topRatedInflight.get(cacheKey);
    if (inflight) return inflight as any;

    const promise = (async () => {
      try {
        const ratingsCollection = collection(db, 'productRatings');

        // Single Query — entweder alle Bewertungen oder die der
        // letzten N Tage. Wir sortieren NICHT serverseitig nach
        // Rating (würde teuren composite index erfordern); die
        // Aggregation ist client-seitig billig genug.
        const q = windowDays
          ? (() => {
              const cutoff = new Date();
              cutoff.setDate(cutoff.getDate() - windowDays);
              return query(
                ratingsCollection,
                where('ratedate', '>=', Timestamp.fromDate(cutoff)),
              );
            })()
          : query(ratingsCollection);
        const snap = await getDocs(q);

        // Aggregation: Map<productKey, AggData>. Key = "noname:<id>"
        // oder "marken:<id>", damit NoName- und Markenprodukte
        // getrennt aggregiert werden. `commentCount` zählt nur die
        // Bewertungen MIT Text — die Karte zeigt einen Kommentar-
        // Excerpt, also fließt das auch ins Ranking ein, damit
        // diskussionsfreudige Produkte oben landen.
        type Agg = {
          id: string;
          type: 'noname' | 'marken';
          sum: number;
          count: number;
          commentCount: number;
          latestComment: string | null;
          latestRating: number | null;
          latestTs: number;
        };
        const aggMap = new Map<string, Agg>();
        snap.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const productRef = data.productID || data.brandProductID;
          if (!productRef || typeof productRef !== 'object') return;
          const isNoName = !!data.productID;
          const productId: string = productRef.id;
          if (!productId) return;
          const overall = Number(data.ratingOverall) || 0;
          if (overall <= 0) return;
          const key = `${isNoName ? 'noname' : 'marken'}:${productId}`;
          const ts = data.ratedate?.toDate?.()?.getTime?.() ?? 0;
          const comment = (data.comment ?? '').toString().trim();
          const hasComment = comment.length > 0;

          const existing = aggMap.get(key);
          if (existing) {
            existing.sum += overall;
            existing.count += 1;
            if (hasComment) existing.commentCount += 1;
            if (hasComment && ts > existing.latestTs) {
              existing.latestComment = comment;
              existing.latestRating = overall;
              existing.latestTs = ts;
            }
          } else {
            aggMap.set(key, {
              id: productId,
              type: isNoName ? 'noname' : 'marken',
              sum: overall,
              count: 1,
              commentCount: hasComment ? 1 : 0,
              latestComment: comment || null,
              latestRating: hasComment ? overall : null,
              latestTs: hasComment ? ts : 0,
            });
          }
        });

        // Nur Produkte mit mindestens einem Kommentar — die Card zeigt
        // einen Kommentar-Excerpt, also würden Karten ohne Kommentar
        // visuell deutlich kürzer sein und die Liste optisch zerreißen.
        // Außerdem ist ein Bewertungstext oft aussagekräftiger als
        // eine reine Sterne-Wertung.
        const itemsWithComment = Array.from(aggMap.values()).filter(
          (a) => a.commentCount > 0,
        );
        if (itemsWithComment.length === 0) {
          writeCache(topRatedCache, cacheKey, [], TTL_SHORT_MS);
          return [];
        }

        // Combined-Score:
        //   1. Bayesian-Avg: avg' = (C × m + R × n) / (C + n)
        //      → dämpft Outlier mit wenigen Bewertungen.
        //      C = 3 (Confidence-Threshold), m = globaler Durchschnitt,
        //      n = ratingCount, R = sum.
        //   2. Multiplier auf Basis von `count` UND `commentCount`:
        //      score = bayesian × log10(1 + count + 2 × commentCount)
        //      → Produkte mit mehr Bewertungen UND mehr Kommentaren
        //        rutschen nach oben; Kommentare doppelt gewichtet
        //        weil sie aufwendiger sind als reine Sterne-Vergaben.
        //      Logarithmus, damit ein Produkt mit 50 Bewertungen
        //      nicht 50× mehr "wert" ist als eines mit einer.
        const C = 3;
        const totalSum = itemsWithComment.reduce((s, a) => s + a.sum, 0);
        const totalCount = itemsWithComment.reduce((s, a) => s + a.count, 0);
        const m = totalCount > 0 ? totalSum / totalCount : 0;
        const ranked = itemsWithComment
          .map((a) => {
            const rawAvg = a.sum / a.count;
            const bayesian = (C * m + a.sum) / (C + a.count);
            const engagement = Math.log10(1 + a.count + 2 * a.commentCount);
            const score = bayesian * engagement;
            return { agg: a, rawAvg, score };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);

        // Produkt-Daten parallel nachladen — inkl. der typischen
        // Joins (Markt/Hersteller/Handelsmarke), die die Card auf
        // Home später anzeigen will. Alle Reference-Lookups gehen
        // über `getDocumentByReference`, der einen 30-Min-Cache hat
        // → die meisten Calls sind Cache-Hits.
        const enriched = await Promise.all(
          ranked.map(async ({ agg, rawAvg }) => {
            try {
              const collectionName = agg.type === 'noname' ? 'produkte' : 'markenProdukte';
              const productSnap = await getDoc(doc(db, collectionName, agg.id));
              if (!productSnap.exists()) return null;
              const product = { id: productSnap.id, ...(productSnap.data() as any) };

              // Joins parallel: Marke/Handelsmarke, Markt, Hersteller.
              // Defensives optional chaining — Refs können fehlen.
              const [brandJoin, marketJoin, herstellerJoin] = await Promise.all([
                agg.type === 'noname' && product.handelsmarke
                  ? this.getDocumentByReference<any>(product.handelsmarke).catch(() => null)
                  : Promise.resolve(null),
                agg.type === 'noname' && product.discounter
                  ? this.getDocumentByReference<any>(product.discounter).catch(() => null)
                  : Promise.resolve(null),
                agg.type === 'marken' && product.hersteller
                  ? this.getDocumentByReference<any>(product.hersteller).catch(() => null)
                  : Promise.resolve(null),
              ]);

              return {
                id: agg.id,
                type: agg.type,
                product,
                avgRating: Math.round(rawAvg * 10) / 10,
                ratingCount: agg.count,
                commentCount: agg.commentCount,
                latestComment: agg.latestComment,
                latestRating: agg.latestRating,
                // Join-Daten — die Card pickt sich raus was sie braucht.
                brandName:
                  (brandJoin as any)?.bezeichnung ?? (brandJoin as any)?.name ?? null,
                brandLogoUri: (brandJoin as any)?.bild ?? null,
                marketName: (marketJoin as any)?.name ?? null,
                marketCountry: (marketJoin as any)?.land ?? null,
                marketLogoUri: (marketJoin as any)?.bild ?? null,
                herstellerName:
                  (herstellerJoin as any)?.name ??
                  (herstellerJoin as any)?.herstellername ??
                  null,
                herstellerLogoUri: (herstellerJoin as any)?.bild ?? null,
              };
            } catch (e) {
              console.warn('getTopRatedProducts: product fetch failed', agg.id, e);
              return null;
            }
          }),
        );

        const result = enriched.filter((x): x is NonNullable<typeof x> => !!x);
        writeCache(topRatedCache, cacheKey, result, TTL_SHORT_MS);
        return result;
      } catch (error) {
        console.error('Error loading top rated products:', error);
        throw error;
      } finally {
        topRatedInflight.delete(cacheKey);
      }
    })();

    topRatedInflight.set(cacheKey, promise);
    return promise as any;
  }

  /**
   * Convenience-Wrapper: Top-N am besten bewerteten Produkte der
   * letzten 30 Tage. Reicht direkt an `getTopRatedProducts` durch.
   * Bestand vor der Generalisierung — bleibt erhalten, damit
   * existierende Aufrufer (Home) ohne Anpassung weiter laufen.
   */
  static async getTopRatedProductsLastMonth(limit: number = 10) {
    return this.getTopRatedProducts(limit, 30);
  }

  static async getProductRatings(productId: string, isNoNameProduct: boolean = true): Promise<any[]> {
    try {
      console.log('📊 Loading ratings for product:', productId, 'IsNoName:', isNoNameProduct);
      
      const ratingsCollection = collection(db, 'productRatings');
      let ratingsQuery;
      
      if (isNoNameProduct) {
        // Query for NoName product ratings
        ratingsQuery = query(
          ratingsCollection,
          where('productID', '==', doc(db, 'produkte', productId))
        );
      } else {
        // Query for Brand product ratings
        ratingsQuery = query(
          ratingsCollection,
          where('brandProductID', '==', doc(db, 'markenProdukte', productId))
        );
      }
      
      const ratingsSnapshot = await getDocs(ratingsQuery);
      const ratings = [];
      
      ratingsSnapshot.forEach((doc) => {
        const data = doc.data();
        ratings.push({
          id: doc.id,
          ...data,
          ratedate: data.ratedate?.toDate ? data.ratedate.toDate() : data.ratedate,
          updatedate: data.updatedate?.toDate ? data.updatedate.toDate() : data.updatedate,
        });
      });
      
      // Sort by date (newest first)
      ratings.sort((a, b) => {
        const dateA = a.ratedate || new Date(0);
        const dateB = b.ratedate || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
      
      console.log(`✅ Loaded ${ratings.length} ratings for product ${productId}`);
      return ratings;
      
    } catch (error) {
      console.error('Error loading product ratings:', error);
      return [];
    }
  }

  /**
   * Berechnet aggregierte Bewertungsstatistiken für ein Produkt
   */
  static calculateRatingStats(ratings: any[]): {
    averageOverall: number;
    averagePrice: number;
    averageTaste: number;
    averageContent: number;
    averageSimilarity: number;
    totalCount: number;
    commentsCount: number;
  } {
    if (ratings.length === 0) {
      return {
        averageOverall: 0,
        averagePrice: 0,
        averageTaste: 0,
        averageContent: 0,
        averageSimilarity: 0,
        totalCount: 0,
        commentsCount: 0
      };
    }

    const stats = {
      overall: 0,
      price: 0,
      taste: 0,
      content: 0,
      similarity: 0,
      overallCount: 0,
      priceCount: 0,
      tasteCount: 0,
      contentCount: 0,
      similarityCount: 0,
      commentsCount: 0
    };

    ratings.forEach(rating => {
      if (rating.ratingOverall) {
        stats.overall += rating.ratingOverall;
        stats.overallCount++;
      }
      if (rating.ratingPriceValue) {
        stats.price += rating.ratingPriceValue;
        stats.priceCount++;
      }
      if (rating.ratingTasteFunction) {
        stats.taste += rating.ratingTasteFunction;
        stats.tasteCount++;
      }
      if (rating.ratingContent) {
        stats.content += rating.ratingContent;
        stats.contentCount++;
      }
      if (rating.ratingSimilarity) {
        stats.similarity += rating.ratingSimilarity;
        stats.similarityCount++;
      }
      if (rating.comment && rating.comment.trim()) {
        stats.commentsCount++;
      }
    });

    return {
      averageOverall: stats.overallCount > 0 ? stats.overall / stats.overallCount : 0,
      averagePrice: stats.priceCount > 0 ? stats.price / stats.priceCount : 0,
      averageTaste: stats.tasteCount > 0 ? stats.taste / stats.tasteCount : 0,
      averageContent: stats.contentCount > 0 ? stats.content / stats.contentCount : 0,
      averageSimilarity: stats.similarityCount > 0 ? stats.similarity / stats.similarityCount : 0,
      totalCount: ratings.length,
      commentsCount: stats.commentsCount
    };
  }

  /**
   * Prüft ob ein User bereits eine Bewertung für ein Produkt abgegeben hat
   */
  static async getUserRatingForProduct(userId: string, productId: string, isNoNameProduct: boolean = true): Promise<any | null> {
    try {
      console.log('🔍 Checking existing rating for user:', userId, 'product:', productId);
      
      const ratingsCollection = collection(db, 'productRatings');
      let ratingsQuery;
      
      if (isNoNameProduct) {
        ratingsQuery = query(
          ratingsCollection,
          where('userID', '==', userId),
          where('productID', '==', doc(db, 'produkte', productId))
        );
      } else {
        ratingsQuery = query(
          ratingsCollection,
          where('userID', '==', userId),
          where('brandProductID', '==', doc(db, 'markenProdukte', productId))
        );
      }
      
      const ratingsSnapshot = await getDocs(ratingsQuery);
      
      if (!ratingsSnapshot.empty) {
        const rating = ratingsSnapshot.docs[0];
        const data = rating.data();
        console.log('✅ Found existing rating:', rating.id);
        return {
          id: rating.id,
          ...data,
          ratedate: data.ratedate?.toDate ? data.ratedate.toDate() : data.ratedate,
          updatedate: data.updatedate?.toDate ? data.updatedate.toDate() : data.updatedate,
        };
      }
      
      console.log('❌ No existing rating found');
      return null;
      
    } catch (error) {
      console.error('Error checking user rating:', error);
      return null;
    }
  }

  /**
   * Aktualisiert eine bestehende Bewertung
   */
  static async updateProductRating(ratingId: string, updateData: {
    ratingOverall: number;
    ratingPriceValue?: number | null;
    ratingTasteFunction?: number | null;
    ratingSimilarity?: number | null;
    ratingContent?: number | null;
    comment?: string | null;
    updatedate: Date;
  }): Promise<void> {
    try {
      console.log('🔄 Updating rating:', ratingId);
      
      const ratingRef = doc(db, 'productRatings', ratingId);
      await updateDoc(ratingRef, updateData);
      
      console.log('✅ Rating updated successfully');
    } catch (error) {
      console.error('Error updating rating:', error);
      throw error;
    }
  }

  /**
   * Fügt eine neue Bewertung zur productRatings Collection hinzu
   */
  static async addProductRating(ratingData: {
    productID: string | null;           // NoName product ID
    brandProductID: string | null;      // Brand product ID
    userID: string;                     // User ID
    ratingOverall: number;              // 1-5 Gesamtbewertung (Pflicht)
    ratingPriceValue?: number | null;   // 1-5 Preis-Leistung (Optional)
    ratingTasteFunction?: number | null; // 1-5 Geschmack/Funktion (Optional)
    ratingSimilarity?: number | null;   // 1-5 Ähnlichkeit (Optional)
    ratingContent?: number | null;      // 1-5 Inhaltsstoffe (Optional)
    comment?: string | null;            // Freitext Kommentar (Optional)
    ratedate: Date;                     // Bewertungsdatum
    updatedate: Date;                   // Update-Datum
  }): Promise<string> {
    try {
      console.log('💾 Saving product rating to Firestore:', ratingData);

      // Validate required fields
      if (!ratingData.userID) {
        throw new Error('userID is required');
      }
      if (!ratingData.ratingOverall || ratingData.ratingOverall < 1 || ratingData.ratingOverall > 5) {
        throw new Error('ratingOverall must be between 1 and 5');
      }
      if (!ratingData.productID && !ratingData.brandProductID) {
        throw new Error('Either productID or brandProductID must be provided');
      }

      // 🛡️ One-rating-per-user-per-product enforcement.
      //
      // User-Bug-Report (alte Version vor UI-Refactor):
      // anonyme User konnten via Submit-Spam unbegrenzt viele
      // productRatings-Docs für dasselbe Produkt erzeugen — unter
      // anderem weil das UI die Submit-Action nicht mit einem
      // Has-User-Already-Rated-Check gegated hat. Vor dem Insert
      // schauen wir jetzt nach einer bestehenden Bewertung dieses
      // Users für dieses Produkt; wenn vorhanden, wird sie
      // ge-updated statt eine zweite parallel anzulegen.
      const productKeyId = ratingData.productID || ratingData.brandProductID!;
      const isNoName = !!ratingData.productID;
      try {
        const existing = await this.getUserRatingForProduct(
          ratingData.userID,
          productKeyId,
          isNoName,
        );
        if (existing?.id) {
          console.log(
            '↩️ addProductRating: existing rating gefunden — updating statt inserting',
            existing.id,
          );
          await this.updateProductRating(existing.id, {
            ratingOverall: ratingData.ratingOverall,
            ratingPriceValue: ratingData.ratingPriceValue ?? null,
            ratingTasteFunction: ratingData.ratingTasteFunction ?? null,
            ratingSimilarity: ratingData.ratingSimilarity ?? null,
            ratingContent: ratingData.ratingContent ?? null,
            comment: ratingData.comment ?? null,
            updatedate: ratingData.updatedate,
          });
          return existing.id;
        }
      } catch (err) {
        // Wenn der Existing-Check fehlschlägt (Network-Glitch),
        // fallen wir defensiv auf den klassischen Insert-Pfad
        // zurück — schlechter als Update, aber besser als gar keine
        // Bewertung.
        console.warn(
          'addProductRating: existing-rating check failed, fallback to insert',
          err,
        );
      }

      // Create product references if IDs are provided
      const firestoreData: any = {
        userID: ratingData.userID,
        ratingOverall: ratingData.ratingOverall,
        ratingPriceValue: ratingData.ratingPriceValue,
        ratingTasteFunction: ratingData.ratingTasteFunction,
        ratingSimilarity: ratingData.ratingSimilarity,
        ratingContent: ratingData.ratingContent,
        comment: ratingData.comment,
        ratedate: ratingData.ratedate,
        updatedate: ratingData.updatedate
      };

      // Add product references
      if (ratingData.productID) {
        firestoreData.productID = doc(db, 'produkte', ratingData.productID);
      }
      if (ratingData.brandProductID) {
        firestoreData.brandProductID = doc(db, 'markenProdukte', ratingData.brandProductID);
      }

      // Add to productRatings collection
      const docRef = await addDoc(collection(db, 'productRatings'), firestoreData);

      console.log('✅ Product rating saved with ID:', docRef.id);
      return docRef.id;

    } catch (error) {
      console.error('Error adding product rating:', error);
      throw error;
    }
  }

  // ========================================
  // EINKAUFSZETTEL / SHOPPING CART METHODS
  // ========================================

  /**
   * Holt alle Einkaufszettel-Einträge für einen User
   */
  static async getShoppingCartItems(userId: string): Promise<FirestoreDocument<Einkaufswagen>[]> {
    try {
      const userRef = doc(db, 'users', userId);
      const q = query(
        collection(userRef, 'einkaufswagen'),
        where('gekauft', '==', false),
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FirestoreDocument<Einkaufswagen>[];
      
      console.log(`✅ Loaded ${items.length} shopping cart items`);
      return items;
    } catch (error) {
      console.error('Error loading shopping cart:', error);
      return [];
    }
  }

  /**
   * Fügt ein Custom-Item (Freitext) zum Einkaufszettel hinzu
   */
  static async addCustomItemToShoppingCart(
    userId: string,
    customItem: {
      name: string;
      type: 'brand' | 'noname';
      icon?: string;
      marketId?: string;
      marketName?: string;
      marketLand?: string;
      marketBild?: string;
    }
  ): Promise<string> {
    try {
      const userRef = doc(db, 'users', userId);
      const data: Partial<Einkaufswagen> = {
        customItem: customItem,
        gekauft: false,
        name: customItem.name, // Für schnelle Anzeige
        timestamp: serverTimestamp() as Timestamp
      };

      const docRef = await addDoc(collection(userRef, 'einkaufswagen'), data);
      console.log('✅ Added custom item to shopping cart:', docRef.id, customItem);
      return docRef.id;
    } catch (error) {
      console.error('Error adding custom item to shopping cart:', error);
      throw error;
    }
  }

  /**
   * Fügt ein Produkt zum Einkaufszettel hinzu (bestehende Funktion)
   */
  static async addToShoppingCart(
    userId: string,
    productId: string,
    productName: string,
    isMarke: boolean,
    source?: 'search' | 'scan' | 'browse' | 'favorites' | 'repurchase' | 'comparison',
    sourceMetadata?: any,
    priceInfo?: {
      price: number;
      savings: number;
      comparedProducts?: {
        productId: string;
        productName: string;
        price: number;
        savings: number;
      }[];
    },
    comparisonContext?: { // NEU: Kontext wenn aus Vergleich hinzugefügt
      mainProductId: string;
      mainProductName: string;
      mainProductType: 'brand' | 'noname';
    }
  ): Promise<string> {
    try {
      const userRef = doc(db, 'users', userId);
      
      // Hole aktuelle Journey-ID
      const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
      const currentJourneyId = journeyTrackingService.getCurrentJourneyId();
      
      const data: any = {
        gekauft: false,
        timestamp: serverTimestamp(),
        name: productName,
        // 🎯 Journey-ID für späteres Tracking speichern!
        journeyId: currentJourneyId,
        // 💰 Preis-Snapshot zum Zeitpunkt des Hinzufügens
        ...(priceInfo && {
          priceAtTime: priceInfo.price,
          savingsAtTime: priceInfo.savings
        }),
        // 📊 Source Attribution (optional)
        ...(source && { source }),
        ...(sourceMetadata && { sourceMetadata })
      };

      if (isMarke) {
        data.markenProdukt = doc(db, 'markenProdukte', productId);
      } else {
        data.handelsmarkenProdukt = doc(db, 'produkte', productId);
      }

      const docRef = await addDoc(collection(userRef, 'einkaufswagen'), data);
      
      // 📊 Track Add-to-Cart Event mit Source UND Journey-Context
      if (source) {
        const { analyticsService } = await import('./analyticsService');
        const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
        
        // Track mit normaler Analytics
        await analyticsService.trackAddToCart(
          productId, 
          productName, 
          isMarke, 
          source, 
          userId, 
          {
            screen_name: sourceMetadata?.screenName || 'unknown',
            ...sourceMetadata
          }
        );
        
        // Track mit Journey-Context und hole Index zurück
        const viewedProductIndex = journeyTrackingService.trackAddToCart(productId, productName, isMarke, userId, priceInfo, comparisonContext);
        
        // WICHTIG: Speichere Index im Einkaufszettel für spätere Zuordnung
        if (viewedProductIndex !== null) {
          await updateDoc(docRef, {
            viewedProductIndex: viewedProductIndex
          });
          console.log(`📍 ViewedProduct Index ${viewedProductIndex} gespeichert für ${productName}`);
        }
      }
      
      console.log('✅ Added to shopping cart:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('Error adding to shopping cart:', error);
      throw error;
    }
  }
  
  /**
   * Prüft ob ein Produkt bereits im Einkaufszettel ist
   */
  static async isInShoppingCart(
    userId: string,
    productId: string,
    isMarke: boolean
  ): Promise<boolean> {
    try {
      const userRef = doc(db, 'users', userId);
      let q;
      
      if (isMarke) {
        const markenRef = doc(db, 'markenProdukte', productId);
        q = query(
          collection(userRef, 'einkaufswagen'),
          where('markenProdukt', '==', markenRef),
          where('gekauft', '==', false),
          limit(1)
        );
      } else {
        const produktRef = doc(db, 'produkte', productId);
        q = query(
          collection(userRef, 'einkaufswagen'),
          where('handelsmarkenProdukt', '==', produktRef),
          where('gekauft', '==', false),
          limit(1)
        );
      }
      
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } catch (error) {
      console.error('Error checking shopping cart:', error);
      return false;
    }
  }

  /**
   * Entfernt alle (offenen) Einträge eines Produkts aus dem
   * Einkaufszettel. Convenience-Wrapper über `removeFromShoppingCart`,
   * sodass Aufrufer nur Produkt-ID + Typ kennen müssen, nicht die
   * intern generierte cart-item-ID. Findet das passende Doc per
   * Reference-Query (`markenProdukt` / `handelsmarkenProdukt`) und
   * löscht es. Falls mehrere offene Einträge desselben Produkts
   * existieren (sollte nicht passieren, kann aber durch
   * Race-Conditions entstehen), werden alle entfernt.
   */
  static async removeFromShoppingCartByProductId(
    userId: string,
    productId: string,
    isMarke: boolean,
  ): Promise<number> {
    try {
      const userRef = doc(db, 'users', userId);
      const productRef = isMarke
        ? doc(db, 'markenProdukte', productId)
        : doc(db, 'produkte', productId);
      const refField = isMarke ? 'markenProdukt' : 'handelsmarkenProdukt';
      const q = query(
        collection(userRef, 'einkaufswagen'),
        where(refField, '==', productRef),
        where('gekauft', '==', false),
      );
      const snap = await getDocs(q);
      if (snap.empty) return 0;
      // Sequenziell löschen (kleine Liste, sollte fast immer 1 sein).
      // `removeFromShoppingCart` triggered Journey-Tracking +
      // Achievement-Logik korrekt — nutzen wir hier auch.
      let removed = 0;
      for (const docSnap of snap.docs) {
        try {
          await this.removeFromShoppingCart(userId, docSnap.id);
          removed += 1;
        } catch (e) {
          console.warn('removeFromShoppingCartByProductId: single delete failed', e);
        }
      }
      return removed;
    } catch (error) {
      console.error('Error removing by product id from cart:', error);
      throw error;
    }
  }

  /**
   * Entfernt ein Produkt vom Einkaufszettel
   */
  static async removeFromShoppingCart(userId: string, itemId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const cartItemRef = doc(userRef, 'einkaufswagen', itemId);
      
      // Lade Produktdaten vor dem Löschen für Journey-Tracking
      const cartItemDoc = await getDoc(cartItemRef);
      if (cartItemDoc.exists()) {
        const cartData = cartItemDoc.data();
        
        // ZUERST prüfen ob es ein Custom Item ist!
        if (cartData.customItem) {
          console.log('🛒 Custom Item - kein Journey-Tracking nötig');
          await deleteDoc(cartItemRef);
          console.log('✅ Custom item removed from shopping cart:', itemId);
          return; // Früh beenden für Custom Items
        }
        
        // KORRIGIERT: Hole Produktdaten aus der richtigen Quelle
        let productData = null;
        let productId = '';
        let productName = '';
        let productType: 'brand' | 'noname' = 'noname';
        
        if (cartData.markenProdukt) {
          // Markenprodukt
          productData = cartData.markenProdukt;
          productId = productData.id || '';
          productName = cartData.name || 'Markenprodukt';
          productType = 'brand';
        } else if (cartData.handelsmarkenProdukt) {
          // NoName Produkt - DocumentReference!
          productData = cartData.handelsmarkenProdukt;
          productId = productData.id || ''; // DocumentReference.id
          productName = cartData.name || 'NoName Produkt';
          productType = 'noname';
        }
        
        // EINFACHER FALLBACK: Wenn immer noch keine Daten, direkt aus cartData
        if (!productId && cartData.name) {
          productId = cartData.handelsmarkenProdukt?.id || cartData.markenProdukt?.id || 'unknown';
          productName = cartData.name;
          productType = cartData.markenProdukt ? 'brand' : 'noname';
          productData = cartData.handelsmarkenProdukt || cartData.markenProdukt;
        }
        
        console.log('🔍 DEBUG removeFromShoppingCart:', {
          hasProductData: !!productData,
          hasJourneyId: !!cartData.journeyId,
          journeyId: cartData.journeyId,
          productId: productId,
          productName: productName,
          productType: productType
        });
        
        if (productData && productId) {
          // Track mit Journey
          const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
          
          // NEU: Verwende die gespeicherte journeyId UND Index!
          if (cartData.journeyId) {
            console.log('🎯 Tracking Remove in Specific Journey:', cartData.journeyId, 'Index:', cartData.viewedProductIndex);
            await journeyTrackingService.trackRemoveInSpecificJourney(
              cartData.journeyId,
              productId,
              productName,
              productType,
              userId,
              cartData.viewedProductIndex // NEU: Index für eindeutige Zuordnung
            );
          } else {
            // Fallback: Normale trackRemoveFromCart wenn keine journeyId
            console.warn('⚠️ Keine journeyId - verwende normale trackRemoveFromCart');
            journeyTrackingService.trackRemoveFromCart(
              productId,
              productName,
              productType,
              userId
            );
          }
        } else {
          console.warn('⚠️ Kein Journey-Tracking möglich:', { 
            hasProductData: !!productData, 
            hasProductId: !!productId,
            isCustomItem: !!cartData.customItem,
            cartData: cartData 
          });
        }
        
        // ENTFERNT: laterUpdates - Tracking passiert direkt in aktueller Journey
      }
      
      await deleteDoc(cartItemRef);
      console.log('✅ Removed from shopping cart:', itemId);
    } catch (error) {
      console.error('Error removing from shopping cart:', error);
      throw error;
    }
  }

  /**
   * Markiert ein Produkt als gekauft UND erstellt Kaufhistorie-Eintrag
   */
  static async markAsPurchased(userId: string, itemId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const cartItemRef = doc(userRef, 'einkaufswagen', itemId);
      
      // 1. Lade die aktuellen Einkaufszettel-Daten
      const cartItemDoc = await getDoc(cartItemRef);
      if (!cartItemDoc.exists()) {
        throw new Error('Einkaufszettel-Item nicht gefunden');
      }
      
      const cartData = cartItemDoc.data();
      
      // 2. Erstelle vollständigen Kaufhistorie-Eintrag
      await this.createPurchaseHistoryEntry(userId, cartData);
      
      // 3. Markiere im Einkaufszettel als gekauft
      await updateDoc(cartItemRef, {
        gekauft: true
      });
      
      // 4. Track Purchase in der ORIGINAL Journey (nicht neue!)
      // Hole die richtigen Produktdaten aus dem cartData
      let productId: string = '';
      let productName: string = '';
      let productType: 'brand' | 'noname' = 'noname';
      let finalPrice: number = 0;
      let finalSavings: number = 0;

      if (cartData.markenProdukt) {
        // Markenprodukt
        const productRef = cartData.markenProdukt;
        productId = productRef.id || '';
        productType = 'brand';
        // Name aus cartData oder aus dem geladenen Produktdaten
        productName = cartData.name || 'Markenprodukt';
        finalPrice = cartData.priceAtTime || 0;
        finalSavings = cartData.savingsAtTime || 0;
      } else if (cartData.handelsmarkenProdukt) {
        // NoName Produkt
        const productRef = cartData.handelsmarkenProdukt;
        productId = productRef.id || '';
        productType = 'noname';
        // Name aus cartData
        productName = cartData.name || 'NoName Produkt';
        finalPrice = cartData.priceAtTime || 0;
        finalSavings = cartData.savingsAtTime || 0;
      }

      if (productId) {
        const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
        
        // NEU: Hole den aktuellen Index für dieses Produkt
        const viewedProductIndex = journeyTrackingService.getViewedProductIndexAfterAction(productId);
        
        // NEU: Verwende die gespeicherte journeyId!
        if (cartData.journeyId) {
          // 🚀 PERFORMANCE: Sequential Non-Blocking - UI ist sofort frei!
          journeyTrackingService.trackPurchaseInSpecificJourney(
            cartData.journeyId,
            [{
              productId: productId,
              productName: productName,
              productType: productType,
              finalPrice: finalPrice,
              finalSavings: finalSavings,
              viewedProductIndex: viewedProductIndex // NEU: Index für eindeutige Zuordnung
            }],
            finalSavings,
            userId
          ).catch(error => {
            console.error('❌ Journey-Tracking Fehler:', error);
          });
        } else {
          // Fallback: Normale trackPurchase wenn keine journeyId
          console.warn('⚠️ Keine journeyId im cartData - verwende normale trackPurchase');
          journeyTrackingService.trackPurchase([{
            productId: productId,
            productName: productName,
            productType: productType,
            finalPrice: finalPrice,
            finalSavings: finalSavings
          }], finalSavings, userId);
        }
      } else {
        console.error('❌ Keine productId gefunden für Journey-Tracking!', cartData);
      }
      
      console.log('✅ Marked as purchased and added to history:', itemId);
    } catch (error) {
      console.error('Error marking as purchased:', error);
      throw error;
    }
  }
  
  /**
   * Markiert ein Produkt als gekauft OHNE Journey-Tracking (für Bulk-Operations)
   */
  static async markAsPurchasedWithoutTracking(userId: string, itemId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const cartItemRef = doc(userRef, 'einkaufswagen', itemId);
      
      // 1. Lade Einkaufszettel-Item
      const cartItemDoc = await getDoc(cartItemRef);
      if (!cartItemDoc.exists()) {
        throw new Error('Einkaufszettel-Item nicht gefunden');
      }
      
      const cartData = cartItemDoc.data();
      
      // 2. Erstelle Kaufhistorie-Eintrag
      await this.createPurchaseHistoryEntry(userId, cartData);
      
      // 3. Markiere im Einkaufszettel als gekauft
      await updateDoc(cartItemRef, {
        gekauft: true
      });
      
      // KEIN Journey-Tracking hier! Das passiert im Bulk
      
      console.log('✅ Marked as purchased (without tracking):', itemId);
    } catch (error) {
      console.error('Error marking as purchased:', error);
      throw error;
    }
  }

  /**
   * Erstellt einen Kaufhistorie-Eintrag mit vollständigen Produktdaten
   */
  private static async createPurchaseHistoryEntry(userId: string, cartData: any): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      
      let purchaseData: any = {
        purchasedAt: serverTimestamp(),
        originalCartData: cartData
      };
      
      if (cartData.markenProdukt) {
        // Markenprodukt - lade vollständige Daten
        const productDoc = await getDoc(cartData.markenProdukt);
        if (productDoc.exists()) {
          const rawData = productDoc.data();
          
          // Lade Hersteller (MARKE) Daten
          let hersteller = null;
          if (rawData.hersteller) {
            const herstellerDoc = await getDoc(rawData.hersteller);
            if (herstellerDoc.exists()) {
              const herstellerData = herstellerDoc.data();
              hersteller = {
                name: herstellerData.name,
                bild: herstellerData.bild
              };
            }
          }
          
          // Berechne Ersparnis
          let savings = 0;
          if (rawData.relatedProdukteIDs && rawData.relatedProdukteIDs.length > 0) {
            let cheapestPrice = Infinity;
            for (const relatedId of rawData.relatedProdukteIDs) {
              const relatedDoc = await getDoc(doc(db, 'produkte', relatedId));
              if (relatedDoc.exists()) {
                const relatedData = relatedDoc.data();
                if (relatedData.preis && relatedData.preis < cheapestPrice) {
                  cheapestPrice = relatedData.preis;
                }
              }
            }
            if (cheapestPrice !== Infinity && rawData.preis) {
              savings = Math.max(0, rawData.preis - cheapestPrice);
            }
          }
          
          purchaseData = {
            ...purchaseData,
            productId: productDoc.id,
            productType: 'markenprodukt',
            name: rawData.name || rawData.produktName || cartData.name,
            preis: rawData.preis || 0,
            bild: rawData.bild || '',
            savings: savings,
            hersteller: hersteller,
            // Vollständige Produktdaten für späteren Zugriff
            productData: {
              ...rawData,
              id: productDoc.id,
              hersteller: hersteller
            }
          };
        }
        
      } else if (cartData.handelsmarkenProdukt) {
        // NoName Produkt - lade vollständige Daten
        const productDoc = await getDoc(cartData.handelsmarkenProdukt);
        if (productDoc.exists()) {
          const rawData = productDoc.data();
          
          // Lade Handelsmarke Daten
          let handelsmarke = null;
          if (rawData.handelsmarke) {
            const handelsmarkeDoc = await getDoc(rawData.handelsmarke);
            if (handelsmarkeDoc.exists()) {
              const handelsmarkeData = handelsmarkeDoc.data();
              handelsmarke = {
                bezeichnung: handelsmarkeData.bezeichnung
              };
            }
          }
          
          // Lade Discounter Daten
          let discounter = null;
          if (rawData.discounter) {
            const discounterDoc = await getDoc(rawData.discounter);
            if (discounterDoc.exists()) {
              const discounterData = discounterDoc.data();
              discounter = {
                id: discounterDoc.id,
                name: discounterData.name,
                bild: discounterData.bild,
                land: discounterData.land
              };
            }
          }
          
          purchaseData = {
            ...purchaseData,
            productId: productDoc.id,
            productType: 'noname',
            name: rawData.name || rawData.produktName || cartData.name,
            preis: rawData.preis || 0,
            bild: rawData.bild || '',
            savings: 0, // NoName hat keine Ersparnis
            stufe: rawData.stufe || 3, // Wichtig für Navigation
            handelsmarke: handelsmarke,
            discounter: discounter,
            // Vollständige Produktdaten für späteren Zugriff
            productData: {
              ...rawData,
              id: productDoc.id,
              handelsmarke: handelsmarke,
              discounter: discounter
            }
          };
        }
      }
      
      // Eindeutige Purchase ID basierend auf Produkttyp und ID + Timestamp für Duplikat-Vermeidung
      const productId = cartData.markenProdukt?.id || cartData.handelsmarkenProdukt?.id || 'unknown';
      const timestamp = Date.now();
      const uniquePurchaseId = `${purchaseData.productType || 'noname'}_${productId}_${timestamp}`;
      
      // Speichere in purchases Subcollection - bereinige undefined Werte inline
      const cleanedData = {
        ...purchaseData,
        // Bereinige explizit undefined Werte
        productId: purchaseData.productId || null,
        name: purchaseData.name || null,
        preis: purchaseData.preis || 0,
        bild: purchaseData.bild || null,
        savings: purchaseData.savings || 0,
        stufe: purchaseData.stufe || 3,
        hersteller: purchaseData.hersteller || null,
        handelsmarke: purchaseData.handelsmarke || null,
        discounter: purchaseData.discounter || null,
        productData: purchaseData.productData || null
      };
      
      // Verwende setDoc mit eindeutiger ID statt addDoc um Duplikate zu vermeiden
      await setDoc(doc(userRef, 'purchases', uniquePurchaseId), cleanedData);
      console.log('✅ Created purchase history entry with ID:', uniquePurchaseId, 'for:', purchaseData.name);
      
    } catch (error) {
      console.error('Error creating purchase history entry:', error);
      throw error;
    }
  }

  /**
   * Wandelt Markenprodukt in NoName um (Batch Operation)
   */
  static async convertToNoName(
    userId: string,
    conversions: ProductToConvert[]
  ): Promise<{ newItems: any[], idMapping: { [oldId: string]: string } }> {
    try {
      const batch = writeBatch(db);
      const userRef = doc(db, 'users', userId);
      const idMapping: { [oldId: string]: string } = {};
      const newItems: any[] = [];
      
      // First get ALL product details for tracking
      const detailPromises = conversions.map(async (conversion) => {
        const [markenDoc, noNameDoc, cartDoc] = await Promise.all([
          getDoc(doc(db, 'markenProdukte', conversion.markenProduktRef)),
          getDoc(doc(db, 'produkte', conversion.produktRef)),
          getDoc(doc(userRef, 'einkaufswagen', conversion.einkaufswagenRef))
        ]);
        
        const noNameData = noNameDoc.exists() ? noNameDoc.data() : null;
        const markenData = markenDoc.exists() ? markenDoc.data() : null;
        const cartData = cartDoc.exists() ? cartDoc.data() : null;
        
        // Hole Discounter-Info
        let discounterData = null;
        if (noNameData?.discounter) {
          const discounterDoc = await getDoc(noNameData.discounter);
          discounterData = discounterDoc.exists() ? discounterDoc.data() : null;
        }
        
        return {
          fromProduct: markenData,
          toProduct: { ...noNameData, discounter: discounterData },
          originalJourneyId: cartData?.journeyId, // NEU: Original Journey ID
          originalViewedProductIndex: cartData?.viewedProductIndex // NEU: Original Index
        };
      });
      const trackingDetails = await Promise.all(detailPromises);
      
      // 🎯 Track Conversion mit Journey und Details
      const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
      journeyTrackingService.trackProductConversion(conversions, trackingDetails, userId);
      
      // Get product details for cart items
      const productPromises = conversions.map(async (conversion) => {
        const produktDoc = await getDoc(doc(db, 'produkte', conversion.produktRef));
        return produktDoc.exists() ? { id: conversion.produktRef, ...produktDoc.data() } : null;
      });
      const productDetails = await Promise.all(productPromises);
      
      // NEU: Journey ID für Tracking holen
      const currentJourneyId = journeyTrackingService.getCurrentJourneyId();
      
      conversions.forEach((conversion, index) => {
        // Lösche alten Eintrag
        batch.delete(doc(userRef, 'einkaufswagen', conversion.einkaufswagenRef));
        
        // Füge neuen NoName Eintrag hinzu
        const newDoc = doc(collection(userRef, 'einkaufswagen'));
        const productData = productDetails[index];
        const trackingDetail = trackingDetails[index];
        
        const newCartItem = {
          handelsmarkenProdukt: doc(db, 'produkte', conversion.produktRef),
          gekauft: false,
          timestamp: serverTimestamp(),
          name: productData?.name || 'NoName Produkt',
          // NEU: Journey ID speichern für späteres Tracking!
          journeyId: currentJourneyId || trackingDetail?.originalJourneyId,
          viewedProductIndex: trackingDetail?.originalViewedProductIndex // NEU: Index übertragen
        };
        
        batch.set(newDoc, newCartItem);
        
        // Map old ID to new ID and store new item data
        idMapping[conversion.einkaufswagenRef] = newDoc.id;
        newItems.push({
          id: newDoc.id,
          product: productData,
          savings: 0 // Will be calculated in frontend
        });
      });
      
      await batch.commit();
      console.log(`✅ Converted ${conversions.length} products to NoName`);
      return { newItems, idMapping };
    } catch (error) {
      console.error('Error converting to NoName:', error);
      throw error;
    }
  }

  /**
   * Berechnet die Ersparnis für ein NoName Produkt
   */
  static calculateSavings(
    noNamePrice: number,
    noNamePackSize: number,
    brandPrice: number,
    brandPackSize: number
  ): { amount: number; percent: number } {
    const noNamePricePerUnit = noNamePrice / (noNamePackSize || 1);
    const brandPricePerUnit = brandPrice / (brandPackSize || 1);
    const savingsAmount = brandPricePerUnit - noNamePricePerUnit;
    const savingsPercent = (savingsAmount / brandPricePerUnit) * 100;
    
    return {
      amount: Math.max(0, savingsAmount * (noNamePackSize || 1)),
      percent: Math.max(0, Math.round(savingsPercent))
    };
  }

  /**
   * Holt NoName Alternativen für ein Markenprodukt
   * OPTIMIERT: Vermeidet Composite Index durch Code-seitige Filterung
   */
  static async getNoNameAlternatives(
    markenProduktId: string,
    favoriteMarketId?: string
  ): Promise<FirestoreDocument<Produkte>[]> {
    try {
      console.log(`🔍 Getting NoName alternatives for brand product: ${markenProduktId}`);
      const markenProduktRef = doc(db, 'markenProdukte', markenProduktId);
      
      // Einfache Query: nur markenProdukt filter (vermeidet Composite Index)
      const q = query(
        collection(db, 'produkte'),
        where('markenProdukt', '==', markenProduktRef),
        limit(50) // Mehr holen für bessere Filterung
      );

      const snapshot = await getDocs(q);
      let allProducts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FirestoreDocument<Produkte>[];

      console.log(`🔍 Found ${allProducts.length} total alternatives before filtering`);

      // Code-seitige Filterung und Sortierung
      let favoriteProducts: FirestoreDocument<Produkte>[] = [];
      let otherProducts: FirestoreDocument<Produkte>[] = [];

      // Separiere nach Lieblingsmarkt
      if (favoriteMarketId) {
        allProducts.forEach(product => {
          // Prüfe ob discounter übereinstimmt (sowohl als ID als auch als Reference)
          const discounterMatch = 
            product.discounter === favoriteMarketId ||
            (product.discounter && typeof product.discounter === 'object' && 
             'id' in product.discounter && product.discounter.id === favoriteMarketId) ||
            (product.discounter && typeof product.discounter === 'string' && 
             product.discounter.includes(favoriteMarketId));
          
          if (discounterMatch) {
            favoriteProducts.push(product);
          } else {
            otherProducts.push(product);
          }
        });
      } else {
        otherProducts = allProducts;
      }

      // Sortiere beide Arrays nach preisDatum (neueste zuerst)
      const sortByPreisDatum = (a: FirestoreDocument<Produkte>, b: FirestoreDocument<Produkte>) => {
        const dateA = a.preisDatum;
        const dateB = b.preisDatum;
        
        // Wenn beide Daten vorhanden, nach Datum sortieren (neueste zuerst)
        if (dateA && dateB) {
          // Firestore Timestamp oder ISO String handling
          const timeA = typeof dateA === 'string' ? new Date(dateA).getTime() : 
                       dateA.seconds ? dateA.seconds * 1000 : 0;
          const timeB = typeof dateB === 'string' ? new Date(dateB).getTime() : 
                       dateB.seconds ? dateB.seconds * 1000 : 0;
          return timeB - timeA; // Neueste zuerst (DESC)
        }
        
        // Fallback: Produkte ohne Datum nach unten, dann nach Preis
        if (!dateA && dateB) return 1;
        if (dateA && !dateB) return -1;
        
        // Beide ohne Datum: Nach Preis sortieren
        const priceA = a.preis || 999999;
        const priceB = b.preis || 999999;
        return priceA - priceB;
      };

      favoriteProducts.sort(sortByPreisDatum);
      otherProducts.sort(sortByPreisDatum);

      // Kombiniere: Lieblingsmarkt zuerst, dann andere
      let finalProducts = [
        ...favoriteProducts.slice(0, 5), // Max 5 vom Lieblingsmarkt
        ...otherProducts.slice(0, 5)     // Max 5 von anderen
      ].slice(0, 10); // Max 10 insgesamt

      // Populate discounter information for UI display
      const populatedProducts = await Promise.all(
        finalProducts.map(async (product) => {
          if (product.discounter && typeof product.discounter === 'object' && 'id' in product.discounter) {
            try {
              const originalId = product.discounter.id;
              const discounterData = await this.getDocumentByReference(product.discounter);
              return {
                ...product,
                discounter: {
                  ...discounterData,
                  id: originalId  // Preserve the original ID for matching
                }
              };
            } catch (error) {
              console.error('Error populating discounter for product:', product.id, error);
              return product;
            }
          }
          return product;
        })
      );

      console.log(`✅ Found ${populatedProducts.length} NoName alternatives (${favoriteProducts.length} from favorite market)`);
      return populatedProducts;
    } catch (error) {
      console.error('Error getting NoName alternatives:', error);
      return [];
    }
  }

  /**
   * Aktualisiert die Gesamtersparnis des Users
   */
  static async updateUserTotalSavings(userId: string, amount: number): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        totalSavings: increment(amount)
      });
      
      // 📊 Update Leaderboard with savings
      const leaderboardService = (await import('./leaderboardService')).default;
      await leaderboardService.updateUserStats(userId, 0, amount);
      
      console.log(`✅ Updated user total savings by €${amount.toFixed(2)}`);
    } catch (error) {
      console.error('Error updating user savings:', error);
      throw error;
    }
  }

  /**
   * Holt alle Kategorien für Filter-Optionen
   */
  static async getAllKategorien(): Promise<FirestoreDocument<Kategorien>[]> {
    try {
      const snapshot = await getDocs(collection(db, 'kategorien'));
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FirestoreDocument<Kategorien>[];
    } catch (error) {
      console.error('Error getting all categories:', error);
      return [];
    }
  }

  /**
   * 🚀 PERFORMANCE: Helper to populate product references from raw data
   * Avoids duplicate Firebase calls by reusing raw data
   */
  static async populateProductReferences(
    rawData: any, 
    productId: string
  ): Promise<ProductWithDetails | null> {
    try {
      // 🚀 PARALLEL: Load all references at once
      const [kategorie, discounter, handelsmarke, hersteller, markenProdukt] = await Promise.all([
        this.getDocumentByReference<Kategorien>(rawData.kategorie),
        this.getDocumentByReference<Discounter>(rawData.discounter),
        this.getDocumentByReference<Handelsmarken>(rawData.handelsmarke),
        this.getDocumentByReference<HerstellerNew>(rawData.hersteller),
        this.getDocumentByReference<MarkenProdukte>(rawData.markenProdukt)
      ]);

      return {
        id: productId,
        ...rawData,
        kategorie,
        discounter,
        handelsmarke,
        hersteller,
        markenProdukt
      };
    } catch (error) {
      console.error('Error populating product references:', error);
      return null;
    }
  }

  /**
   * 🚀 PERFORMANCE: Batch process NoName products with mega-optimization
   * Eliminates redundant reference calls and caches Hersteller lookups
   */
  private static async batchProcessNoNameProducts(docs: any[]): Promise<ProductWithDetails[]> {
     const uniqueReferences = new Map();
    
    // Sammle alle einzigartigen Referenzen
    docs.forEach((docSnap) => {
      const productData = docSnap.data() as Produkte;
      
      if (productData.handelsmarke) uniqueReferences.set(productData.handelsmarke.path || productData.handelsmarke.id, productData.handelsmarke);
      if (productData.kategorie) uniqueReferences.set(productData.kategorie.path || productData.kategorie.id, productData.kategorie);
      if (productData.hersteller) uniqueReferences.set(productData.hersteller.path || productData.hersteller.id, productData.hersteller);
      if (productData.packTyp) uniqueReferences.set(productData.packTyp.path || productData.packTyp.id, productData.packTyp);
      if (productData.discounter) uniqueReferences.set(productData.discounter.path || productData.discounter.id, productData.discounter);
    });
    
    // 🚀 PARALLEL: Load ALL unique references at once
    console.log(`🚀 Loading ${uniqueReferences.size} unique references in mega-batch...`);
    const referenceStartTime = Date.now();
    
    const referencePromises = Array.from(uniqueReferences.values()).map(async (ref) => {
      try {
        const doc = await this.getDocumentByReference(ref);
        return { ref: ref.path || ref.id, doc };
      } catch (error) {
        return { ref: ref.path || ref.id, doc: null };
      }
    });
    
    const referenceResults = await Promise.all(referencePromises);
    const referenceMap = new Map();
    referenceResults.forEach(result => {
      if (result.doc) referenceMap.set(result.ref, result.doc);
    });
    
    console.log(`⚡ Loaded ${referenceMap.size} references in ${Date.now() - referenceStartTime}ms`);
    
    // Process products with cached references
    const productPromises = docs.map(async (docSnap) => {
      const productData = docSnap.data() as Produkte;
      const productWithDetails: ProductWithDetails = { id: docSnap.id, ...productData };
      
      // Use cached references
      if (productData.handelsmarke) {
        const key = productData.handelsmarke.path || productData.handelsmarke.id;
        productWithDetails.handelsmarke = referenceMap.get(key) || null;
      }
      if (productData.kategorie) {
        const key = productData.kategorie.path || productData.kategorie.id;
        productWithDetails.kategorie = referenceMap.get(key) || null;
      }
      if (productData.hersteller) {
        const key = productData.hersteller.path || productData.hersteller.id;
        productWithDetails.hersteller = referenceMap.get(key) || null;
      }
      if (productData.packTyp) {
        const key = productData.packTyp.path || productData.packTyp.id;
        productWithDetails.packTypInfo = referenceMap.get(key) || null;
      }
      if (productData.discounter) {
        const key = productData.discounter.path || productData.discounter.id;
        productWithDetails.discounter = referenceMap.get(key) || null;
      }

       // 🚫 REMOVED: NoName-Produkte brauchen keine Marken-Abfrage!
       // Das war völlig unnötig und hat Performance gekostet
      
      return productWithDetails;
    });
    
    const results = await Promise.all(productPromises);
    
    // ✅ Sortiere nach preisDatum (neueste zuerst)
    results.sort((a, b) => {
      const dateA = a.preisDatum;
      const dateB = b.preisDatum;
      
      // Wenn beide Daten vorhanden, nach Datum sortieren (neueste zuerst)
      if (dateA && dateB) {
        // Firestore Timestamp oder ISO String handling
        const timeA = typeof dateA === 'string' ? new Date(dateA).getTime() : 
                     dateA.seconds ? dateA.seconds * 1000 : 0;
        const timeB = typeof dateB === 'string' ? new Date(dateB).getTime() : 
                     dateB.seconds ? dateB.seconds * 1000 : 0;
        return timeB - timeA; // Neueste zuerst
      }
      
      // Fallback: Produkte mit Datum vor solche ohne
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      
      return 0; // Beide ohne Datum: Reihenfolge beibehalten
    });
    
    return results;
  }

}

