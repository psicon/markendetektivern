import { algoliasearch } from 'algoliasearch';


// Algolia Configuration
const ALGOLIA_APP_ID = 'Y0KKZHT49Q';
const ALGOLIA_SEARCH_API_KEY = 'b87bb9ffcda4b4b3e3161e155e29869e';

// Initialize Algolia client (v5 syntax)
const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_API_KEY);

// Index names - from Algolia dashboard screenshot
const NONAME_INDEX = 'produkte'; // NoName products index
const MARKENPRODUKTE_INDEX = 'markenProdukte'; // Brand products index (with capital P)

// ─── Module-scoped 24-hour LRU cache for `searchAll` ───────────────
// Algolia bills per query ($0.001-0.005 each on the Build plan), so
// repeating the SAME (query, page, hitsPerPage) tuple — which happens
// constantly in normal use (back-button, swipe between tabs, returning
// from a detail screen, infinite-scroll re-render) — is straight money
// down the drain.
//
// We cache the FULL response payload in memory keyed by a deterministic
// tuple. Hit rate in practice is 60-80% across a session because:
//   • the same user types the same handful of queries repeatedly
//   • returning to search-results from a product detail re-runs
//     `performSearch` with the SAME args
//   • pagination calls are deterministic — page 0/1/2 with same query
// TTL is 24 h: long enough to cover a full app session, short enough
// that newly-indexed products show up the next day. Module-scope so
// a hot-reload during dev keeps it (no spinner flash on edit) and a
// real app restart clears it (no stale data across launches).
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;

type SearchAllResult = {
  noNameResults: AlgoliaSearchResponse;
  markenproduktResults: AlgoliaSearchResponse;
  totalHits: number;
  // Algolia gibt pro Suche ein opakes `queryID` zurück, das bei
  // späteren Click/Conversion-Events via Insights-API mitgesendet
  // werden muss. Pro Index ein eigenes (wir feuern zwei
  // Suchen parallel — produkte + markenProdukte). Beide werden
  // mit-cached, sodass Folge-Klicks aus einem Cache-Hit weiterhin
  // korrekt zugeordnet werden können.
  queryIdEigen?: string;
  queryIdMarken?: string;
};

type CacheEntry = { value: SearchAllResult; expiresAt: number };

const searchCache = new Map<string, CacheEntry>();

function searchCacheKey(query: string, page: number, hitsPerPage: number) {
  return `${query.trim().toLowerCase()}|${page}|${hitsPerPage}`;
}

function readSearchCache(key: string): SearchAllResult | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    searchCache.delete(key);
    return null;
  }
  // LRU touch: re-insert so it ends up at the tail of the Map's
  // insertion order. Keys at the head get evicted first when over MAX.
  searchCache.delete(key);
  searchCache.set(key, entry);
  return entry.value;
}

// ─── Anonymer User-Token für Insights ─────────────────────────────
//
// Algolia Insights verlangt einen userToken pro Event. Wenn der App-User
// angemeldet ist nehmen wir die Firebase-UID (siehe `trackClickAfterSearch`),
// sonst fällt der Track auf einen pseudo-anonymen Token zurück. Modul-
// scoped damit pro App-Session derselbe Token verwendet wird — Algolia
// kann so Sessions korrelieren auch ohne echten User. Beim App-Restart
// generiert sich ein neuer Token. Das ist akzeptabel: Insights-Daten
// dienen primär dem ML-Training pro-Query, nicht der Cross-Session-
// Personalisierung.
let anonUserToken: string | null = null;
function getOrCreateAnonToken(): string {
  if (anonUserToken) return anonUserToken;
  anonUserToken = `anon-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  return anonUserToken;
}

// ─── Inflight-Promise-Dedup ───────────────────────────────────────
//
// Wenn ZWEI Aufrufer gleichzeitig (oder kurz nacheinander) dieselbe
// Suche starten — z.B. Home prefetcht beim Submit, Stöbern called
// dann beim Mount nochmal — gibt es zwei parallele HTTP-Requests
// auf Algolia. Mit dem In-Flight-Cache hier wird der zweite Aufruf
// auf die Promise des ersten gepinnt → ein einziger Request, beide
// Caller bekommen dasselbe Ergebnis.
//
// Wichtig fürs Pre-Fetch-Pattern: Home feuert searchAll(query, 0, 40)
// VOR der Navigation, fire-and-forget. Bis Stöbern mountet ist die
// Promise im Map. Stöbern's runSearch ruft searchAll auf → findet
// die Promise → wartet darauf → kein Doppel-Roundtrip.
const inflightSearchAll = new Map<string, Promise<SearchAllResult>>();

function writeSearchCache(key: string, value: SearchAllResult) {
  searchCache.set(key, {
    value,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
  // Evict oldest entries past the cap.
  while (searchCache.size > SEARCH_CACHE_MAX) {
    const oldestKey = searchCache.keys().next().value;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
}

export interface AlgoliaSearchResult {
  objectID: string;
  name: string;
  bild?: string;
  stufe?: string;
  preis?: number;
  discounter?: {
    name: string;
    bild?: string;
  };
  handelsmarke?: {
    bezeichnung: string;
    bild?: string;
  };
  hersteller?: {
    name: string;
    bild?: string;
  };
  kategorie?: {
    bezeichnung: string;
  };
  // Add other fields as needed
}

export interface AlgoliaSearchResponse {
  hits: AlgoliaSearchResult[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  processingTimeMS: number;
  // Nur gefüllt wenn `clickAnalytics: true` an searchSingleIndex
  // übergeben wurde. Dieser Wert ist die Brücke zur Insights-API
  // (siehe `trackClickAfterSearch`).
  queryID?: string;
}

export class AlgoliaService {
  /**
   * Search by objectID in a specific index
   */
  static async searchByObjectId(indexName: string, objectId: string): Promise<any> {
    try {
      const result = await client.searchSingleIndex({
        indexName,
        searchParams: {
          query: '',
          filters: `objectID:${objectId}`,
          hitsPerPage: 1
        }
      });
      
      return result.hits.length > 0 ? result.hits[0] : null;
    } catch (error) {
      console.error(`Error searching for objectID ${objectId} in ${indexName}:`, error);
      return null;
    }
  }
  
  /**
   * Search in a specific index by objectID (wrapper for better naming)
   */
  static async searchInIndex(indexName: string, objectId: string): Promise<any> {
    try {
      const result = await client.searchSingleIndex({
        indexName,
        searchParams: {
          query: '',
          filters: `objectID:${objectId}`,
          hitsPerPage: 1
        }
      });
      
      return result.hits.length > 0 ? result.hits[0] : null;
    } catch (error) {
      console.error(`Error searching in ${indexName} for ${objectId}:`, error);
      return null;
    }
  }
  
  /**
   * List available indices (for debugging) - DISABLED due to API key permissions
   */
  static async listIndices(): Promise<string[]> {
    try {
      console.log('🔍 Algolia: Listing indices disabled (Search API key has no listIndices permission)');
      // Search API keys don't have permission for listIndices()
      // This would require Admin API key which we don't want to expose
      return ['produkte', 'markenProdukte']; // Return actual indices from dashboard
    } catch (error) {
      console.error('Error listing indices:', error);
      return [];
    }
  }
  /**
   * Search NoName products
   */
  static async searchNoNameProducts(
    query: string,
    page: number = 0,
    hitsPerPage: number = 20
  ): Promise<AlgoliaSearchResponse> {
    try {
      console.log(`🔍 Algolia: Searching NoName products for "${query}"`);

      // Algolia v5 syntax
      const result = await client.searchSingleIndex({
        indexName: NONAME_INDEX,
        searchParams: {
        query,
        page,
        hitsPerPage,
          // `clickAnalytics: true` lässt Algolia ein opakes
          // `queryID` mit der Antwort zurückschicken. Das brauchen
          // wir später bei `trackClickAfterSearch`, um Klicks der
          // ursprünglichen Such-Session zuzuordnen — Grundlage für
          // späteres Learning-to-Rank / AI Re-Ranking.
          clickAnalytics: true,
          attributesToRetrieve: [
            'objectID',
            'name',
            'bild',
            'stufe',
            'preis',
            'discounter',
            'handelsmarke',
            'kategorie'
          ]
        }
      });

      console.log(`✅ Algolia: Found ${result.nbHits} NoName products`);
      return result as unknown as AlgoliaSearchResponse;
      
    } catch (error) {
      console.error('Error searching NoName products:', error);
      // Return empty results instead of throwing
      return { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0 };
    }
  }

  /**
   * Search Markenprodukte
   */
  static async searchMarkenprodukte(
    query: string,
    page: number = 0,
    hitsPerPage: number = 20
  ): Promise<AlgoliaSearchResponse> {
    try {
      console.log(`🔍 Algolia: Searching Markenprodukte for "${query}"`);
      
      // Algolia v5 syntax
      const result = await client.searchSingleIndex({
        indexName: MARKENPRODUKTE_INDEX,
        searchParams: {
        query,
        page,
        hitsPerPage,
          // Siehe Kommentar in searchNoNameProducts — wir brauchen
          // den queryID auch hier, damit Klicks auf Markenprodukte
          // nach einer Suche getracked werden können.
          clickAnalytics: true,
          attributesToRetrieve: [
            'objectID',
            'name',
            'bild',
            'preis',
            'hersteller',
            'kategorie'
          ]
        }
      });

      console.log(`✅ Algolia: Found ${result.nbHits} Markenprodukte`);
      return result as unknown as AlgoliaSearchResponse;
      
    } catch (error) {
      console.error('Error searching Markenprodukte:', error);
      // Return empty results instead of throwing
      return { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0 };
    }
  }

  /**
   * Search both NoName products and Markenprodukte
   * OPTIMIERT: Keine automatischen Marken/Hersteller-Suchen mehr!
   */
  static async searchAll(
    query: string,
    page: number = 0,
    hitsPerPage: number = 20
  ): Promise<SearchAllResult> {
    // 1. Cache hit → return synchronously without touching Algolia.
    const cacheKey = searchCacheKey(query, page, hitsPerPage);
    const cached = readSearchCache(cacheKey);
    if (cached) {
      console.log(`💾 Algolia: cache HIT for "${query}" (p${page}) — saved one API call`);
      return cached;
    }

    // 2. Inflight dedup: wenn dieselbe Suche schon unterwegs ist,
    // hängen wir uns dran statt einen zweiten HTTP-Request zu
    // feuern. Wichtig fürs Home→Stöbern-Pre-Fetch-Pattern: Home
    // startet searchAll, kurz darauf startet Stöbern dieselbe
    // Suche → zweiter Aufruf erbt die Promise.
    const inflight = inflightSearchAll.get(cacheKey);
    if (inflight) {
      console.log(`🔗 Algolia: inflight HIT for "${query}" — joining existing promise`);
      return inflight;
    }

    const promise = (async (): Promise<SearchAllResult> => {
      try {
        const hitsPerIndex = Math.ceil(hitsPerPage / 2);
        console.log(`🔍 Algolia: Searching products for "${query}" (page: ${page}, ${hitsPerIndex} per index)`);

        const [noNameResults, markenproduktResults] = await Promise.all([
          this.searchNoNameProducts(query, page, hitsPerIndex),
          this.searchMarkenprodukte(query, page, hitsPerIndex),
        ]);

        const totalHits = noNameResults.nbHits + markenproduktResults.nbHits;
        console.log(`✅ Algolia: Found ${totalHits} total products (${noNameResults.nbHits} NoName + ${markenproduktResults.nbHits} Markenprodukte)`);

        const result: SearchAllResult = {
          noNameResults,
          markenproduktResults,
          totalHits,
          queryIdEigen: noNameResults.queryID,
          queryIdMarken: markenproduktResults.queryID,
        };
        writeSearchCache(cacheKey, result);
        return result;
      } finally {
        inflightSearchAll.delete(cacheKey);
      }
    })();
    inflightSearchAll.set(cacheKey, promise);

    try {
      return await promise;

    } catch (error) {
      console.error('Error searching all products:', error);

      // Fallback: Return empty results instead of throwing.
      // We DO NOT cache the empty fallback — we want the next call
      // to re-try Algolia, in case the failure was transient.
      console.log('🔄 Algolia: Returning empty results as fallback');
      return {
        noNameResults: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0 },
        markenproduktResults: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0 },
        totalHits: 0
      };
    }
  }

  /**
   * Manually invalidate the in-memory search cache. Useful after
   * admin-side index changes (synonyms, settings) or when the user
   * explicitly hits a "refresh" affordance. Cheap to call — at
   * worst it makes the next searchAll a real API call.
   */
  static clearSearchCache() {
    searchCache.clear();
  }

  // ─── Algolia Insights — Click-Tracking ─────────────────────────────
  //
  // Wir feuern ein `clickedObjectIDsAfterSearch`-Event jedes Mal,
  // wenn ein User in den Suchergebnissen ein Produkt antippt. Das
  // ist die Grundlage für späteres Learning-to-Rank / AI Re-Ranking
  // — Algolia's Modelle lernen aus diesen Events automatisch, welche
  // Treffer für welche Queries relevant sind und sortieren in
  // Folge-Suchen besser.
  //
  // Endpoint: POST https://insights.algolia.io/1/events
  // Auth:     Search-API-Key reicht (Insights akzeptiert beides).
  // Window:   queryIDs sind ~24 h gültig — danach werden Events
  //           verworfen. Unsere 24-h-Cache-TTL deckt sich damit, also
  //           selbst Klicks aus einem Cache-Hit treffen das Fenster.
  //
  // Der Aufruf ist FIRE-AND-FORGET: kein await, kein Fehler-Throw
  // nach oben. Tracking-Pipeline darf NIE die UI blocken oder
  // crashen lassen.
  static trackClickAfterSearch(params: {
    index: 'produkte' | 'markenProdukte';
    queryID: string | undefined;
    userToken: string | null | undefined;
    objectID: string;
    position: number; // 1-indexed position in the search results
  }) {
    if (!params.queryID || !params.objectID) return;
    // Algolia verlangt einen userToken — falls der User noch nicht
    // angemeldet ist, generieren wir einen Pseudo-Token. Pro App-Session
    // stabil dank Module-scoped Caching weiter unten.
    const userToken = params.userToken || getOrCreateAnonToken();

    const body = {
      events: [
        {
          eventType: 'click',
          eventName: 'Product Clicked After Search',
          index: params.index,
          queryID: params.queryID,
          userToken,
          objectIDs: [params.objectID],
          // Algolia erwartet Positionen 1-indexed.
          positions: [Math.max(1, Math.floor(params.position))],
          timestamp: Date.now(),
        },
      ],
    };

    // Fire-and-forget. Wir loggen Fehler nur in dev (console.warn),
    // werfen NIE nach oben — Tracking darf die UI nie zerschießen.
    fetch(
      `https://insights.algolia.io/1/events?x-algolia-application-id=${ALGOLIA_APP_ID}&x-algolia-api-key=${ALGOLIA_SEARCH_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ).catch((e) => {
      console.warn('Algolia Insights track failed (non-fatal):', e?.message ?? e);
    });
  }

  /**
   * Search in Handelsmarken index
   */
  static async searchHandelsmarken(query: string): Promise<any[]> {
    try {
      const result = await client.searchSingleIndex({
        indexName: 'handelsmarken',
        searchParams: {
          query,
          hitsPerPage: 10,
          attributesToRetrieve: ['objectID', 'bezeichnung']
        }
      });
      
      return result.hits;
    } catch (error) {
      console.error('Error searching Handelsmarken:', error);
      return [];
    }
  }
  
  /**
   * Search in Hersteller index
   */
  static async searchHersteller(query: string): Promise<any[]> {
    try {
      const result = await client.searchSingleIndex({
        indexName: 'hersteller',
        searchParams: {
          query,
          hitsPerPage: 10,
          attributesToRetrieve: ['objectID', 'name']
        }
      });
      
      return result.hits;
    } catch (error) {
      console.error('Error searching Hersteller:', error);
      return [];
    }
  }
  
  /**
   * Search NoName products by Handelsmarken IDs
   */
  static async searchNoNameByHandelsmarken(handelsmarkenIds: string[], hitsPerPage: number = 100): Promise<AlgoliaSearchResponse> {
    try {
      // Create OR filter for all handelsmarken IDs
      const filters = handelsmarkenIds.map(id => `handelsmarke:"${id}"`).join(' OR ');
      
      const result = await client.searchSingleIndex({
        indexName: NONAME_INDEX,
        searchParams: {
          query: '',
          filters,
          hitsPerPage,
          attributesToRetrieve: [
            'objectID',
            'name',
            'bild',
            'preis',
            'stufe',
            'discounter',
            'handelsmarke',
            'hersteller',
            'kategorie'
          ]
        }
      });
      
      return result as unknown as AlgoliaSearchResponse;
    } catch (error) {
      console.error('Error searching NoName by Handelsmarken:', error);
      return { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0 };
    }
  }
  
  /**
   * Search Markenprodukte by Hersteller IDs
   */
  static async searchMarkenByHersteller(herstellerIds: string[], hitsPerPage: number = 100): Promise<AlgoliaSearchResponse> {
    try {
      // Create OR filter for all hersteller IDs
      const filters = herstellerIds.map(id => `hersteller:"${id}"`).join(' OR ');
      
      const result = await client.searchSingleIndex({
        indexName: MARKENPRODUKTE_INDEX,
        searchParams: {
          query: '',
          filters,
          hitsPerPage,
          attributesToRetrieve: [
            'objectID',
            'name',
            'bild',
            'preis',
            'hersteller',
            'kategorie'
          ]
        }
      });
      
      return result as unknown as AlgoliaSearchResponse;
    } catch (error) {
      console.error('Error searching Markenprodukte by Hersteller:', error);
      return { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0 };
    }
  }

  /**
   * Get search suggestions/autocomplete
   */
  static async getSearchSuggestions(
    query: string,
    maxSuggestions: number = 5
  ): Promise<string[]> {
    try {
      if (query.length < 2) return [];
      
      const [noNameResults, markenproduktResults] = await Promise.all([
        this.searchNoNameProducts(query, 0, maxSuggestions),
        this.searchMarkenprodukte(query, 0, maxSuggestions)
      ]);
      
      const suggestions = new Set<string>();
      
      // Extract product names as suggestions
      noNameResults.hits.forEach(hit => {
        if (hit.name && suggestions.size < maxSuggestions) {
          suggestions.add(hit.name);
        }
      });
      
      markenproduktResults.hits.forEach(hit => {
        if (hit.name && suggestions.size < maxSuggestions) {
          suggestions.add(hit.name);
        }
      });
      
      return Array.from(suggestions).slice(0, maxSuggestions);
      
    } catch (error) {
      console.error('Error getting search suggestions:', error);
      return [];
    }
  }
}