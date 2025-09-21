import { analyticsService } from './analyticsService';

/**
 * Specialized service for tracking filter → conversion correlation
 * 
 * Tracks the complete user journey:
 * 1. Filter applied → Product discovered
 * 2. Product added to cart/favorites → Conversion intent
 * 3. Product marked as purchased → Final conversion
 */
class FilterConversionTracker {
  private static instance: FilterConversionTracker;
  
  // Cache für aktive Filter beim Produktzugriff
  private productDiscoveryContext: Map<string, {
    filters: any;
    timestamp: number;
    screenName: string;
    discoveryMethod: 'browse_filtered' | 'search_filtered';
  }> = new Map();

  static getInstance(): FilterConversionTracker {
    if (!FilterConversionTracker.instance) {
      FilterConversionTracker.instance = new FilterConversionTracker();
    }
    return FilterConversionTracker.instance;
  }

  /**
   * Trackt wenn ein Produkt durch gefilterte Suche/Browse entdeckt wird
   */
  trackProductDiscovery(
    productId: string,
    activeFilters: {
      markets?: string[];
      categories?: string[];
      stufe?: number[];
      allergens?: string[];
      nutrition?: string[];
      priceRange?: { min?: number; max?: number };
    },
    screenName: string,
    discoveryMethod: 'browse_filtered' | 'search_filtered',
    userId?: string
  ) {
    // Cache den Kontext für spätere Conversion-Attribution
    this.productDiscoveryContext.set(productId, {
      filters: activeFilters,
      timestamp: Date.now(),
      screenName,
      discoveryMethod
    });

    // Tracke die Entdeckung mit Filter-Kontext
    analyticsService.trackEvent({
      event_name: 'product_discovered_filtered',
      event_category: 'product_interaction',
      screen_name: screenName,
      product_id: productId,
      discovery_method: discoveryMethod,
      
      // Filter-spezifische Metriken
      total_active_filters: this.getTotalActiveFilters(activeFilters),
      filter_complexity: this.calculateFilterComplexity(activeFilters),
      
      // Einzelne Filter-Typen
      market_filters_count: activeFilters.markets?.length || 0,
      category_filters_count: activeFilters.categories?.length || 0,
      stufe_filters_count: activeFilters.stufe?.length || 0,
      allergen_filters_count: activeFilters.allergens?.length || 0,
      nutrition_filters_count: activeFilters.nutrition?.length || 0,
      has_price_filter: !!(activeFilters.priceRange?.min || activeFilters.priceRange?.max),
      
      // Motivation-Signale
      motivation_signal: this.getMotivationFromFilters(activeFilters),
      
      // Journey-Kontext
      journey_step: 'product_discovery'
    }, userId);

    // Cleanup alte Einträge (älter als 24h)
    this.cleanupOldEntries();
  }

  /**
   * Trackt Add-to-Cart mit Filter-Attribution
   */
  trackAddToCartWithFilters(
    productId: string,
    productName: string,
    productType: 'noname' | 'brand',
    userId?: string
  ) {
    const context = this.productDiscoveryContext.get(productId);
    
    if (context) {
      const timeSinceDiscovery = Date.now() - context.timestamp;
      
      analyticsService.trackEvent({
        event_name: 'add_to_cart_filtered',
        event_category: 'conversion',
        screen_name: 'add_to_cart',
        product_id: productId,
        product_type: productType,
        
        // Filter-Attribution
        discovery_filters: context.filters,
        discovery_method: context.discoveryMethod,
        discovery_screen: context.screenName,
        time_since_discovery_ms: timeSinceDiscovery,
        
        // Filter-Metriken
        total_discovery_filters: this.getTotalActiveFilters(context.filters),
        filter_complexity: this.calculateFilterComplexity(context.filters),
        motivation_signal: this.getMotivationFromFilters(context.filters),
        
        // Conversion-Metriken
        conversion_speed: timeSinceDiscovery < 30000 ? 'fast' : timeSinceDiscovery < 300000 ? 'medium' : 'slow',
        journey_step: 'add_to_cart'
      }, userId);
    } else {
      // Fallback: Normale Add-to-Cart ohne Filter-Kontext
      analyticsService.trackConversion('add_to_cart', productId, userId, {
        product_type: productType,
        discovery_method: 'unknown'
      });
    }
  }

  /**
   * Trackt Add-to-Favorites mit Filter-Attribution
   */
  trackAddToFavoritesWithFilters(
    productId: string,
    productName: string,
    userId?: string
  ) {
    const context = this.productDiscoveryContext.get(productId);
    
    if (context) {
      const timeSinceDiscovery = Date.now() - context.timestamp;
      
      analyticsService.trackEvent({
        event_name: 'add_to_favorites_filtered',
        event_category: 'conversion',
        screen_name: 'add_to_favorites',
        product_id: productId,
        
        // Filter-Attribution
        discovery_filters: context.filters,
        discovery_method: context.discoveryMethod,
        discovery_screen: context.screenName,
        time_since_discovery_ms: timeSinceDiscovery,
        
        // Filter-Metriken
        total_discovery_filters: this.getTotalActiveFilters(context.filters),
        filter_complexity: this.calculateFilterComplexity(context.filters),
        motivation_signal: this.getMotivationFromFilters(context.filters),
        
        // Conversion-Metriken
        conversion_speed: timeSinceDiscovery < 30000 ? 'fast' : timeSinceDiscovery < 300000 ? 'medium' : 'slow',
        journey_step: 'add_to_favorites'
      }, userId);
    }
  }

  /**
   * Trackt finalen Kauf mit vollständiger Filter-Attribution
   */
  trackPurchaseWithFilters(
    productIds: string[],
    totalSavings: number,
    userId?: string
  ) {
    const purchasedWithFilters: string[] = [];
    const filterAttributions: any[] = [];
    
    productIds.forEach(productId => {
      const context = this.productDiscoveryContext.get(productId);
      if (context) {
        purchasedWithFilters.push(productId);
        filterAttributions.push({
          product_id: productId,
          discovery_filters: context.filters,
          discovery_method: context.discoveryMethod,
          time_since_discovery_ms: Date.now() - context.timestamp,
          motivation_signal: this.getMotivationFromFilters(context.filters)
        });
      }
    });

    if (purchasedWithFilters.length > 0) {
      analyticsService.trackEvent({
        event_name: 'purchase_completed_filtered',
        event_category: 'conversion',
        screen_name: 'purchase_completed',
        
        // Kauf-Metriken
        total_items: productIds.length,
        filtered_items: purchasedWithFilters.length,
        filter_conversion_rate: purchasedWithFilters.length / productIds.length,
        total_savings: totalSavings,
        
        // Filter-Attributionen
        filter_attributions: filterAttributions,
        
        // Aggregierte Motivation-Signale
        dominant_motivation: this.getDominantMotivation(filterAttributions),
        
        journey_step: 'purchase_completed'
      }, userId);
      
      // Cleanup gekaufte Produkte
      purchasedWithFilters.forEach(productId => {
        this.productDiscoveryContext.delete(productId);
      });
    }
  }

  /**
   * Berechnet Filter-Komplexität (0-10 Skala)
   */
  private calculateFilterComplexity(filters: any): number {
    let complexity = 0;
    
    // Basis-Filter (niedrige Komplexität)
    complexity += (filters.markets?.length || 0) * 0.5;
    complexity += (filters.categories?.length || 0) * 0.5;
    complexity += (filters.stufe?.length || 0) * 0.3;
    
    // Erweiterte Filter (höhere Komplexität)
    complexity += (filters.allergens?.length || 0) * 1.5; // Allergen-Filter sind spezifischer
    complexity += (filters.nutrition?.length || 0) * 2.0; // Nährwert-Filter sind sehr spezifisch
    complexity += (filters.priceRange?.min || filters.priceRange?.max) ? 1.0 : 0;
    
    return Math.min(complexity, 10); // Cap bei 10
  }

  /**
   * Zählt Gesamt-Anzahl aktiver Filter
   */
  private getTotalActiveFilters(filters: any): number {
    let total = 0;
    total += filters.markets?.length || 0;
    total += filters.categories?.length || 0;
    total += filters.stufe?.length || 0;
    total += filters.allergens?.length || 0;
    total += filters.nutrition?.length || 0;
    total += (filters.priceRange?.min || filters.priceRange?.max) ? 1 : 0;
    return total;
  }

  /**
   * Leitet Haupt-Motivation aus Filtern ab
   */
  private getMotivationFromFilters(filters: any): string {
    if (filters.nutrition?.length > 0 || filters.allergens?.length > 0) {
      return 'content'; // Gesundheit/Inhaltsstoffe
    } else if (filters.priceRange?.min || filters.priceRange?.max) {
      return 'price'; // Preis-orientiert
    } else if (filters.markets?.length > 0) {
      return 'market_loyalty'; // Markt-Treue
    } else if (filters.categories?.length > 0) {
      return 'content'; // Kategorie-spezifisch
    } else {
      return 'exploration'; // Allgemeines Stöbern
    }
  }

  /**
   * Findet dominante Motivation aus mehreren Produkten
   */
  private getDominantMotivation(attributions: any[]): string {
    const motivations = attributions.map(a => a.motivation_signal);
    const counts = motivations.reduce((acc, motivation) => {
      acc[motivation] = (acc[motivation] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(counts).sort(([,a], [,b]) => b - a)[0]?.[0] || 'exploration';
  }

  /**
   * Cleanup alte Einträge (älter als 24h)
   */
  private cleanupOldEntries() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    for (const [productId, context] of this.productDiscoveryContext.entries()) {
      if (context.timestamp < oneDayAgo) {
        this.productDiscoveryContext.delete(productId);
      }
    }
  }
}

export const filterConversionTracker = FilterConversionTracker.getInstance();
