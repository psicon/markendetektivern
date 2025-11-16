import { algoliasearch } from 'algoliasearch';


// Algolia Configuration
const ALGOLIA_APP_ID = 'Y0KKZHT49Q';
const ALGOLIA_SEARCH_API_KEY = 'b87bb9ffcda4b4b3e3161e155e29869e';

// Initialize Algolia client (v5 syntax)
const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_API_KEY);

// Index names - from Algolia dashboard screenshot
const NONAME_INDEX = 'produkte'; // NoName products index
const MARKENPRODUKTE_INDEX = 'markenProdukte'; // Brand products index (with capital P)

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
  ): Promise<{
    noNameResults: AlgoliaSearchResponse;
    markenproduktResults: AlgoliaSearchResponse;
    totalHits: number;
  }> {
    try {
      // Split hitsPerPage between both indices
      const hitsPerIndex = Math.ceil(hitsPerPage / 2);
      
      console.log(`🔍 Algolia: Searching products for "${query}" (page: ${page}, ${hitsPerIndex} per index)`);
      
      // OPTIMIERT: Nur noch direkte Produktsuche - keine extra Marken/Hersteller-Anfragen!
      const [noNameResults, markenproduktResults] = await Promise.all([
        this.searchNoNameProducts(query, page, hitsPerIndex),
        this.searchMarkenprodukte(query, page, hitsPerIndex)
      ]);
      
      const totalHits = noNameResults.nbHits + markenproduktResults.nbHits;
      console.log(`✅ Algolia: Found ${totalHits} total products (${noNameResults.nbHits} NoName + ${markenproduktResults.nbHits} Markenprodukte)`);
      
      return {
        noNameResults,
        markenproduktResults,
        totalHits
      };
      
    } catch (error) {
      console.error('Error searching all products:', error);
      
      // Fallback: Return empty results instead of throwing
      console.log('🔄 Algolia: Returning empty results as fallback');
      return {
        noNameResults: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0 },
        markenproduktResults: { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 0, processingTimeMS: 0 },
        totalHits: 0
      };
    }
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