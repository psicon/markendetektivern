/**
 * OpenFoodFacts API Service
 * Lädt Nährwerte und Zutaten basierend auf EAN
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export interface OpenFoodNutrition {
  energy_100g?: number;           // kJ pro 100g
  'energy-kcal_100g'?: number;    // kcal pro 100g
  fat_100g?: number;              // Fett pro 100g
  'saturated-fat_100g'?: number;  // Gesättigte Fettsäuren pro 100g
  carbohydrates_100g?: number;    // Kohlenhydrate pro 100g
  sugars_100g?: number;           // Zucker pro 100g
  fiber_100g?: number;            // Ballaststoffe pro 100g
  proteins_100g?: number;         // Protein pro 100g
  salt_100g?: number;             // Salz pro 100g
  sodium_100g?: number;           // Natrium pro 100g
}

export interface OpenFoodProduct {
  code: string;                   // EAN Code
  product_name?: string;          // Produktname
  brands?: string;                // Marken
  categories?: string;            // Kategorien
  ingredients_text_de?: string;   // Zutaten auf Deutsch
  ingredients_text?: string;      // Zutaten (Fallback)
  nutriments?: OpenFoodNutrition; // Nährwerte
  nutriscore_grade?: string;      // Nutri-Score (a-e)
  ecoscore_grade?: string;        // Eco-Score (a-e)
  nova_group?: number;            // NOVA Score (1-4)
  image_url?: string;             // Produktbild
  image_front_url?: string;       // Alternatives Produktbild
  quantity?: string;              // Packungsgröße
  allergens_tags?: string[];      // Allergene
  manufacturing_places?: string;  // Herstellungsorte
  generic_name?: string;          // Generischer Name
  found: boolean;                 // Wurde das Produkt gefunden?
}

/** Firestore `naehrwerte`-Schema (per 100g). Stimmt mit den Keys
 *  überein die `NutritionTable` im comparison-Screen erwartet. */
export interface NaehrwerteShape {
  brennwertKcal?: number;
  energie?: number;
  fett?: number;
  gesaettigteFettsaeuren?: number;
  gesaettigt?: number;
  kohlenhydrate?: number;
  zucker?: number;
  eiweiss?: number;
  eiweis?: number;
  salz?: number;
}

class OpenFoodService {
  // V2 API + ?fields= Filter:
  //   • V2 ist die offiziell empfohlene API (V0 funktioniert noch aber
  //     ist als legacy markiert).
  //   • ?fields=… reduziert die Response auf die Felder die wir
  //     brauchen — kleinere Payload, OFF rate-limited großzügiger.
  // Siehe https://openfoodfacts.github.io/openfoodfacts-server/api/
  private static readonly BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
  private static readonly FIELDS = [
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

  // User-Agent ist KRITISCH: OpenFoodFacts rate-limited anonyme
  // Requests (kein UA) aggressiv (429-Storm). Mit identifizierender
  // UA bekommen wir die normalen ~100 req/min Quota.
  // Format empfohlen: "AppName/Version (contact)"
  private static readonly USER_AGENT = (() => {
    const version =
      Constants?.expoConfig?.version ?? Constants?.manifest?.version ?? '0.0.0';
    return `MarkenDetektive/${version} (${Platform.OS}; contact: patrick@markendetektive.de)`;
  })();

  private static readonly CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 Tage (AsyncStorage)
  private static readonly MEMORY_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 Stunden (Memory)
  // Negative Results (Produkt nicht in OFF) cachen wir kürzer — falls
  // OFF das Produkt später crowdsourcing-mäßig bekommt.
  private static readonly NEGATIVE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24h
  // Rate-Limit-Backoff: wenn wir 429 sehen, blocken wir ALLE OpenFood-
  // Requests für eine Weile. 30s — kurz genug dass ein einmaliges 429
  // (z.B. weil ein Bulk-Fetch zu schnell kam) nicht ALLE anderen
  // EANs derselben Page blockiert; lang genug dass ein echter Quota-
  // Hit nicht sofort wieder hammered. Mit korrekt gesetztem User-Agent
  // ist 429 ohnehin selten.
  private static readonly RATE_LIMIT_BACKOFF_MS = 30 * 1000; // 30 s
  private static rateLimitUntilMs = 0;

  private static memoryCache = new Map<string, { data: OpenFoodProduct, timestamp: number }>();
  // Inflight-Dedup — wenn dieselbe EAN parallel mehrfach angefragt
  // wird (Brand- und NoName-Effekte starten beim Mount ~simultan),
  // teilt sich das selbe Promise. Verhindert doppelte Network-Hits.
  private static inflight = new Map<string, Promise<OpenFoodProduct | null>>();
  private static readonly STORAGE_PREFIX = 'openfood_cache_';

  /**
   * Lädt Produktdaten von OpenFoodFacts API
   */
  static async getProductByEAN(ean: string): Promise<OpenFoodProduct | null> {
    // Inflight-Dedup: wenn schon eine Anfrage für diese EAN läuft,
    // returnen wir das gleiche Promise. Verhindert N×fetch wenn
    // mehrere Components gleichzeitig anfragen.
    const inflight = this.inflight.get(ean);
    if (inflight) return inflight;
    const promise = this._fetchByEAN(ean).finally(() => {
      this.inflight.delete(ean);
    });
    this.inflight.set(ean, promise);
    return promise;
  }

  private static async _fetchByEAN(ean: string): Promise<OpenFoodProduct | null> {
    try {
      // 1. Prüfe Memory Cache (schnellst). Eine "found=false"-Antwort
      //    wird KÜRZER gecached (24h) als ein gefundenes Produkt (Memory:
      //    24h; AsyncStorage: 7d). Negative Caching MUSS — sonst feuern
      //    wir bei jedem Screen-Mount erneut Network-Requests für EANs
      //    die OFF nicht kennt und triggern 429.
      const memCached = this.memoryCache.get(ean);
      if (memCached) {
        const ttl = memCached.data.found
          ? this.MEMORY_CACHE_DURATION
          : this.NEGATIVE_CACHE_DURATION;
        if (Date.now() - memCached.timestamp < ttl) {
          // Reduziertes Logging — nur bei found=true logging
          if (memCached.data.found) {
            console.log(`⚡ OpenFood Memory Cache Hit für EAN: ${ean}`);
          }
          return memCached.data;
        }
      }

      // 2. Prüfe AsyncStorage Cache (persistent — auch negative Results)
      try {
        const storageCached = await AsyncStorage.getItem(`${this.STORAGE_PREFIX}${ean}`);
        if (storageCached) {
          const { data, timestamp } = JSON.parse(storageCached);
          const ttl = data?.found ? this.CACHE_DURATION : this.NEGATIVE_CACHE_DURATION;
          if (Date.now() - timestamp < ttl) {
            if (data?.found) {
              console.log(`🗄️ OpenFood AsyncStorage Cache Hit für EAN: ${ean}`);
            }
            // In Memory Cache übertragen für schnelleren nächsten Zugriff
            this.memoryCache.set(ean, { data, timestamp });
            return data;
          }
        }
      } catch (storageError) {
        console.warn('AsyncStorage read error:', storageError);
      }

      // 3. Rate-Limit Backoff: wenn wir kürzlich 429 gesehen haben,
      //    skip den Network-Hit komplett für RATE_LIMIT_BACKOFF_MS.
      //    Returnt als "not found" — Consumer-Code rendert Empty-State,
      //    keine sichtbaren Errors für User.
      if (Date.now() < this.rateLimitUntilMs) {
        const secsLeft = Math.ceil((this.rateLimitUntilMs - Date.now()) / 1000);
        console.warn(
          `⏸️ OpenFood rate-limited — skipping fetch für EAN ${ean} (${secsLeft}s backoff verbleibend)`,
        );
        return { code: ean, found: false };
      }

      console.log(`🌍 Lade OpenFood Daten für EAN: ${ean}`);

      const url = `${this.BASE_URL}/${ean}.json?fields=${this.FIELDS}`;
      const response = await fetch(url, {
        headers: {
          // User-Agent ist KRITISCH — siehe Konstanten-Kommentar oben.
          // RN setzt manchmal keinen UA-Header by default → ohne den
          // landen wir im strict-rate-limit-Bucket.
          'User-Agent': this.USER_AGENT,
          Accept: 'application/json',
        },
      });

      // 429 → Rate-Limit-Backoff aktivieren. Wichtig: KEIN Cache-
      // Write hier — das Produkt existiert ja möglicherweise auf
      // OpenFood, wir konnten gerade nur nicht abfragen. Wäre fatal
      // wenn wir ein gültiges Produkt 24h als "found=false" cachen
      // weil ein einziger Request 429'd hat. Stattdessen: in-memory
      // Backoff-Window short-circuitet alle weiteren Requests bis
      // RATE_LIMIT_BACKOFF_MS abgelaufen ist. Danach probieren wir
      // wieder normal und cachen erst wenn wir eine echte Antwort
      // (200 oder echtes not-found) sehen.
      if (response.status === 429) {
        this.rateLimitUntilMs = Date.now() + this.RATE_LIMIT_BACKOFF_MS;
        console.warn(
          `⏸️ OpenFood 429 Rate-Limit — backoff für ${this.RATE_LIMIT_BACKOFF_MS / 1000}s aktiviert`,
        );
        return { code: ean, found: false };
      }

      // 404 (oder andere 4xx ≠ 429) = "EAN nicht in OpenFood-DB".
      // Normaler Fall — kein Error, einfach als not-found cachen.
      // Verhindert console.error-Lärm + Re-Fetch-Storm.
      if (response.status === 404 || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        console.log(`📭 OpenFood: EAN ${ean} not in DB (HTTP ${response.status})`);
        const notFound: OpenFoodProduct = { code: ean, found: false };
        this.cacheResult(ean, notFound);
        return notFound;
      }

      if (!response.ok) {
        // 5xx → echter Server-Fehler. Werfen damit der catch-Block
        // ihn loggt und nicht cached (transient, kann später wieder
        // gehen).
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.status !== 1 || !result.product) {
        console.log(`📭 OpenFood: EAN ${ean} not found (body status:${result.status})`);
        const notFound: OpenFoodProduct = { code: ean, found: false };
        // Negative Result cachen — verhindert Re-Fetch-Storm bei
        // EANs die OFF nicht kennt.
        this.cacheResult(ean, notFound);
        return notFound;
      }

      const product: OpenFoodProduct = {
        code: ean,
        product_name: result.product.product_name,
        brands: result.product.brands,
        categories: result.product.categories,
        ingredients_text_de: result.product.ingredients_text_de,
        ingredients_text: result.product.ingredients_text,
        nutriments: result.product.nutriments,
        nutriscore_grade: result.product.nutriscore_grade?.toUpperCase(),
        ecoscore_grade: result.product.ecoscore_grade?.toUpperCase(),
        nova_group: result.product.nova_group,
        image_url: result.product.image_url,
        image_front_url: result.product.image_front_url,
        quantity: result.product.quantity,
        allergens_tags: result.product.allergens_tags,
        manufacturing_places: result.product.manufacturing_places,
        generic_name: result.product.generic_name,
        found: true
      };

      // Debug Scores
      console.log(`🔍 OpenFood Scores for ${ean}:`, {
        nutriscore: result.product.nutriscore_grade,
        ecoscore: result.product.ecoscore_grade,
        nova: result.product.nova_group,
        formatted: {
          nutriscore: product.nutriscore_grade,
          ecoscore: product.ecoscore_grade,
          nova: product.nova_group
        }
      });

      // Cache via shared helper.
      this.cacheResult(ean, product);

      console.log(`✅ OpenFood Daten geladen für: ${product.product_name}`);
      return product;

    } catch (error) {
      // Nur als warn loggen, nicht error — sonst LogBox-Overlay
      // beim User. Echte Server-Fehler (5xx) oder Network-Issues
      // sind transient und kein UI-Problem.
      console.warn(`⚠️ OpenFood transient error für EAN ${ean}:`, error);
      return null;
    }
  }

  /** Schreibt Memory + AsyncStorage Cache. Wird sowohl für gefundene
   *  Produkte als auch für not-found-Antworten verwendet — letztere
   *  mit kürzerer TTL (durch die NEGATIVE_CACHE_DURATION-Prüfung beim
   *  Read). */
  private static cacheResult(ean: string, data: OpenFoodProduct): void {
    const cacheData = { data, timestamp: Date.now() };
    this.memoryCache.set(ean, cacheData);
    // AsyncStorage fire-and-forget — blockiert nicht.
    AsyncStorage.setItem(
      `${this.STORAGE_PREFIX}${ean}`,
      JSON.stringify(cacheData),
    ).catch((err) => console.warn('AsyncStorage write error:', err));
  }

  /**
   * Probiert mehrere EANs SEQUENTIELL (nicht parallel!) und returnt
   * den ersten Treffer. Used für Produkte mit mehreren EANs/GTINs —
   * z.B. weil ein Produkt unter unterschiedlichen Codes in Algolia
   * indexed ist. User-Vorgabe: "bei 1. treffer anzeigen und nicht
   * weiter ean prüfen".
   *
   * Sequentiell statt parallel weil:
   *   1. Wir wollen rate-limit-conservative sein (Backoff ist global,
   *      paralleler Storm würde nichts bringen)
   *   2. Bei Cache-Hit für EAN-1 wird EAN-2 gar nicht erst gefetcht
   *   3. Negative-Caches greifen: wenn alle EANs schon mal als
   *      not-found gecached sind, kein einziger Network-Hit.
   */
  static async getProductByFirstEAN(
    eans: string[],
  ): Promise<OpenFoodProduct | null> {
    if (!eans || eans.length === 0) {
      console.log('[OpenFood iter] keine EANs übergeben → skip');
      return null;
    }
    console.log(`[OpenFood iter] starte für ${eans.length} EAN(s): ${eans.join(', ')}`);
    let i = 0;
    for (const ean of eans) {
      i += 1;
      if (!ean) {
        console.log(`[OpenFood iter] ${i}/${eans.length}: empty EAN, skip`);
        continue;
      }
      try {
        const result = await this.getProductByEAN(ean);
        if (result && result.found) {
          console.log(
            `[OpenFood iter] ${i}/${eans.length}: ${ean} → ✅ HIT (${result.product_name ?? 'unbenannt'})`,
          );
          return result;
        } else {
          console.log(
            `[OpenFood iter] ${i}/${eans.length}: ${ean} → not found, weiter`,
          );
        }
      } catch (e) {
        console.warn(
          `[OpenFood iter] ${i}/${eans.length}: ${ean} → Error, weiter`,
          e,
        );
      }
    }
    console.log(
      `[OpenFood iter] alle ${eans.length} EANs durchgeprüft, kein Treffer`,
    );
    return null;
  }

  /**
   * Lädt Daten für mehrere EANs parallel (wird vom Legacy-Code noch
   * genutzt; für neue Aufrufer ist getProductByFirstEAN besser).
   */
  static async getProductsByEANs(eans: string[]): Promise<Map<string, OpenFoodProduct | null>> {
    console.log(`🌍 Lade OpenFood Daten für ${eans.length} EANs parallel`);
    
    const results = await Promise.allSettled(
      eans.map(async (ean) => ({
        ean,
        data: await this.getProductByEAN(ean)
      }))
    );

    const dataMap = new Map<string, OpenFoodProduct | null>();
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        dataMap.set(result.value.ean, result.value.data);
      } else {
        console.error(`❌ OpenFood Fehler für EAN ${eans[index]}:`, result.reason);
        dataMap.set(eans[index], null);
      }
    });

    return dataMap;
  }

  /**
   * Formatiert Nährwerte für die Anzeige
   */
  static formatNutrition(nutriments?: OpenFoodNutrition): Array<{label: string, value: string}> {
    if (!nutriments) return [];

    const nutrition = [];

    // 1. Energie - bevorzuge kcal, fallback auf kJ
    if (nutriments['energy-kcal_100g']) {
      nutrition.push({
        label: 'Energie',
        value: `${Math.round(nutriments['energy-kcal_100g'])} kcal`
      });
    } else if (nutriments.energy_100g) {
      // Konvertiere kJ zu kcal (1 kcal = 4.184 kJ)
      const kcal = Math.round(nutriments.energy_100g / 4.184);
      nutrition.push({
        label: 'Energie',
        value: `${kcal} kcal`
      });
    }

    // 2. Fett
    if (nutriments.fat_100g !== undefined) {
      nutrition.push({
        label: 'Fett',
        value: `${nutriments.fat_100g.toFixed(1)} g`
      });
    }

    // 3. Kohlenhydrate
    if (nutriments.carbohydrates_100g !== undefined) {
      nutrition.push({
        label: 'Kohlenhydrate',
        value: `${nutriments.carbohydrates_100g.toFixed(1)} g`
      });
    }

    // 4. Zucker
    if (nutriments.sugars_100g !== undefined) {
      nutrition.push({
        label: 'Zucker',
        value: `${nutriments.sugars_100g.toFixed(1)} g`
      });
    }

    return nutrition;
  }

  /**
   * Formatiert Zutaten für die Anzeige
   */
  static formatIngredients(openFoodProduct?: OpenFoodProduct): string {
    if (!openFoodProduct) return '';
    
    // Bevorzuge deutsche Zutaten, Fallback auf englische
    const ingredients = openFoodProduct.ingredients_text_de || openFoodProduct.ingredients_text;
    
    if (!ingredients) return '';
    
    // Bereinige und formatiere den Text
    return ingredients
      .replace(/\*/g, '') // Entferne Sterne
      .replace(/\s+/g, ' ') // Normalisiere Leerzeichen
      .trim();
  }

  /**
   * Mapped OpenFood-`nutriments` (per 100g) auf unser Firestore-
   * `naehrwerte`-Schema. Returnt nur Felder die OpenFood wirklich
   * hatte (kein "0" für fehlende Werte). Verwendet von Stufe-3/4/5
   * comparison-Screen + Stufe-1/2 noname-detail als Fallback wenn
   * Firestore keine Nährwerte hat.
   */
  static toNaehrwerteShape(product?: OpenFoodProduct | null): NaehrwerteShape | null {
    const n = product?.nutriments;
    if (!n) return null;
    const out: NaehrwerteShape = {};

    if (typeof n['energy-kcal_100g'] === 'number') {
      out.brennwertKcal = Math.round(n['energy-kcal_100g']);
    } else if (typeof n.energy_100g === 'number') {
      out.brennwertKcal = Math.round(n.energy_100g / 4.184);
    }
    if (typeof n.fat_100g === 'number') out.fett = n.fat_100g;
    if (typeof n['saturated-fat_100g'] === 'number') {
      out.gesaettigteFettsaeuren = n['saturated-fat_100g'];
    }
    if (typeof n.carbohydrates_100g === 'number') out.kohlenhydrate = n.carbohydrates_100g;
    if (typeof n.sugars_100g === 'number') out.zucker = n.sugars_100g;
    if (typeof n.proteins_100g === 'number') out.eiweiss = n.proteins_100g;
    if (typeof n.salt_100g === 'number') out.salz = n.salt_100g;

    // Wenn nichts ankommt — null statt leeres Object damit Aufrufer
    // einfacher leere Returns prüfen können.
    return Object.keys(out).length === 0 ? null : out;
  }

  /**
   * Cache löschen (für Testing/Debug)
   */
  static clearCache(): void {
    this.memoryCache.clear();
    console.log('🗑️ OpenFood Memory Cache geleert');
  }

  /**
   * Löscht alle negativen (not-found) Cache-Einträge im Memory- UND
   * AsyncStorage. Wird einmalig beim App-Start aufgerufen, um
   * Pollutions aus alten 429-Storm-Phasen zu beseitigen (in denen
   * vorübergehende Rate-Limit-Antworten fälschlich als 24h-not-found
   * cached wurden — siehe Commit-History). Positive Treffer bleiben
   * erhalten.
   */
  static async purgeNegativeCacheOnce(): Promise<void> {
    try {
      // Memory: alle found=false rauslöschen.
      for (const [k, v] of this.memoryCache) {
        if (v.data && !v.data.found) this.memoryCache.delete(k);
      }
      // AsyncStorage: alle openfood_cache_* keys lesen, found=false löschen.
      const allKeys = await AsyncStorage.getAllKeys();
      const ourKeys = allKeys.filter((k) => k.startsWith(this.STORAGE_PREFIX));
      if (ourKeys.length === 0) return;
      const entries = await AsyncStorage.multiGet(ourKeys);
      const toDelete: string[] = [];
      for (const [key, raw] of entries) {
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.data && !parsed.data.found) {
            toDelete.push(key);
          }
        } catch {
          // corrupt entry — auch löschen
          toDelete.push(key);
        }
      }
      if (toDelete.length > 0) {
        await AsyncStorage.multiRemove(toDelete);
        console.log(
          `🧹 OpenFood: ${toDelete.length} stale negative Cache-Einträge gelöscht`,
        );
      }
    } catch (e) {
      console.warn('purgeNegativeCacheOnce failed:', e);
    }
  }
}

export default OpenFoodService;
