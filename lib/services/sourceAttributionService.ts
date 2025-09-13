import AsyncStorage from '@react-native-async-storage/async-storage';

export type ProductSource = 'search' | 'scan' | 'browse' | 'favorites' | 'repurchase' | 'comparison' | 'similar_products';

interface ProductSourceData {
  source: ProductSource;
  timestamp: number;
  metadata?: {
    searchQuery?: string;
    filters?: string[];
    categoryBrowsed?: string;
    scanMethod?: 'camera' | 'manual';
    fromProductId?: string; // Bei similar_products oder comparison
    position?: number; // Position in Liste
  };
}

class SourceAttributionService {
  private static instance: SourceAttributionService;
  private attributionCache = new Map<string, ProductSourceData>();

  static getInstance(): SourceAttributionService {
    if (!SourceAttributionService.instance) {
      SourceAttributionService.instance = new SourceAttributionService();
    }
    return SourceAttributionService.instance;
  }

  /**
   * Setzt die Quelle für ein Produkt
   */
  async setProductSource(
    productId: string, 
    source: ProductSource, 
    metadata?: ProductSourceData['metadata']
  ): Promise<void> {
    const sourceData: ProductSourceData = {
      source,
      timestamp: Date.now(),
      metadata
    };

    // In-Memory Cache für schnelle Zugriffe
    this.attributionCache.set(productId, sourceData);

    // Persistent Storage für längere Sessions
    try {
      const cacheKey = `product_source_${productId}`;
      await AsyncStorage.setItem(cacheKey, JSON.stringify(sourceData));
      
      // Cleanup alte Einträge (älter als 24h)
      this.cleanupOldSources();
    } catch (error) {
      console.warn('Could not persist product source:', error);
    }
  }

  /**
   * Holt die Quelle für ein Produkt
   */
  async getProductSource(productId: string): Promise<ProductSourceData | null> {
    // Zuerst Cache prüfen
    if (this.attributionCache.has(productId)) {
      const cached = this.attributionCache.get(productId)!;
      
      // Prüfe ob noch gültig (24h)
      if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return cached;
      } else {
        this.attributionCache.delete(productId);
      }
    }

    // Fallback zu AsyncStorage
    try {
      const cacheKey = `product_source_${productId}`;
      const stored = await AsyncStorage.getItem(cacheKey);
      
      if (stored) {
        const sourceData = JSON.parse(stored) as ProductSourceData;
        
        // Prüfe ob noch gültig (24h)
        if (Date.now() - sourceData.timestamp < 24 * 60 * 60 * 1000) {
          this.attributionCache.set(productId, sourceData);
          return sourceData;
        } else {
          await AsyncStorage.removeItem(cacheKey);
        }
      }
    } catch (error) {
      console.warn('Could not load product source:', error);
    }

    return null;
  }

  /**
   * Entfernt die Quelle für ein Produkt (nach Add-to-Cart)
   */
  async clearProductSource(productId: string): Promise<void> {
    this.attributionCache.delete(productId);
    
    try {
      const cacheKey = `product_source_${productId}`;
      await AsyncStorage.removeItem(cacheKey);
    } catch (error) {
      console.warn('Could not clear product source:', error);
    }
  }

  /**
   * Batch-Funktion für mehrere Produkte (für Bulk-Aktionen)
   */
  async getMultipleProductSources(productIds: string[]): Promise<{[key: string]: ProductSourceData}> {
    const sources: {[key: string]: ProductSourceData} = {};
    
    for (const productId of productIds) {
      const source = await this.getProductSource(productId);
      if (source) {
        sources[productId] = source;
      }
    }
    
    return sources;
  }

  /**
   * Cleanup alte Source-Einträge
   */
  private async cleanupOldSources(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const sourceKeys = keys.filter(key => key.startsWith('product_source_'));
      
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 Stunden
      
      for (const key of sourceKeys) {
        try {
          const stored = await AsyncStorage.getItem(key);
          if (stored) {
            const sourceData = JSON.parse(stored) as ProductSourceData;
            if (now - sourceData.timestamp > maxAge) {
              await AsyncStorage.removeItem(key);
              
              // Auch aus Cache entfernen
              const productId = key.replace('product_source_', '');
              this.attributionCache.delete(productId);
            }
          }
        } catch (error) {
          // Korrupte Einträge entfernen
          await AsyncStorage.removeItem(key);
        }
      }
    } catch (error) {
      console.warn('Source cleanup failed:', error);
    }
  }

  /**
   * Hilfsfunktion: Bestimme Source automatisch basierend auf Screen
   */
  getSourceFromScreen(screenName: string, additionalContext?: any): ProductSource {
    if (screenName.includes('search') || additionalContext?.searchQuery) {
      return 'search';
    } else if (screenName.includes('scanner') || additionalContext?.scanMethod) {
      return 'scan';
    } else if (screenName.includes('explore') || screenName.includes('browse')) {
      return 'browse';
    } else if (screenName.includes('favorites')) {
      return 'favorites';
    } else if (screenName.includes('purchase-history') || additionalContext?.repurchase) {
      return 'repurchase';
    } else if (screenName.includes('comparison') || screenName.includes('similar')) {
      return 'comparison';
    } else {
      return 'browse'; // Default fallback
    }
  }
}

export default SourceAttributionService.getInstance();
