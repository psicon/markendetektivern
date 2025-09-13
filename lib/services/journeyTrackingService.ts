import { analyticsService } from './analyticsService';

export interface JourneyContext {
  journeyId: string;
  startTime: number;
  
  // Discovery Context
  discoveryMethod: 'search' | 'browse' | 'scan' | 'favorites' | 'repurchase' | 'similar_products';
  screenName: string;
  
  // Filter Context (wenn über browse/search)
  activeFilters?: {
    markets?: string[];
    categories?: string[];
    sortBy?: 'name' | 'price' | 'savings';
    searchQuery?: string;
    stufe?: number[];
  };
  
  // Product Context
  viewedProducts: {
    productId: string;
    productType: 'brand' | 'noname';
    productName: string;
    timestamp: number;
    position?: number; // Position in Liste
  }[];
  
  // Actions
  addedToCart?: {
    productId: string;
    timestamp: number;
    fromFilters: any;
  };
  addedToFavorites?: {
    productId: string;
    timestamp: number;
    fromFilters: any;
  };
  purchased?: {
    productIds: string[];
    timestamp: number;
    totalSavings: number;
  };
}

class JourneyTrackingService {
  private static instance: JourneyTrackingService;
  private currentJourney: JourneyContext | null = null;
  private journeyTimeout: NodeJS.Timeout | null = null;

  static getInstance(): JourneyTrackingService {
    if (!JourneyTrackingService.instance) {
      JourneyTrackingService.instance = new JourneyTrackingService();
    }
    return JourneyTrackingService.instance;
  }

  /**
   * Startet eine neue User Journey
   */
  startJourney(
    discoveryMethod: JourneyContext['discoveryMethod'],
    screenName: string,
    activeFilters?: JourneyContext['activeFilters']
  ): string {
    const journeyId = `journey_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.currentJourney = {
      journeyId,
      startTime: Date.now(),
      discoveryMethod,
      screenName,
      activeFilters,
      viewedProducts: []
    };

    console.log(`🎯 Journey Started: ${discoveryMethod} auf ${screenName}`, {
      filters: activeFilters,
      journeyId: journeyId.substring(0, 20) + '...'
    });

    // Auto-complete Journey nach 30 Minuten
    if (this.journeyTimeout) {
      clearTimeout(this.journeyTimeout);
    }
    this.journeyTimeout = setTimeout(() => {
      this.completeJourney('timeout');
    }, 30 * 60 * 1000);

    return journeyId;
  }

  /**
   * Trackt Product View mit Journey-Context
   */
  trackProductView(
    productId: string,
    productType: 'brand' | 'noname',
    productName: string,
    position?: number
  ): void {
    if (!this.currentJourney) {
      // Keine aktive Journey - starte eine neue
      this.startJourney('browse', 'unknown');
    }

    this.currentJourney!.viewedProducts.push({
      productId,
      productType,
      productName,
      timestamp: Date.now(),
      position
    });

    console.log(`👁️ Product View: ${productName.substring(0, 30)}... (Journey: ${this.currentJourney!.discoveryMethod})`);

    // Track zu GA4 mit Journey-Context
    analyticsService.trackProductView(productId, productType, undefined, {
      journey_id: this.currentJourney!.journeyId,
      discovery_method: this.currentJourney!.discoveryMethod,
      active_filters: this.currentJourney!.activeFilters,
      position_in_journey: this.currentJourney!.viewedProducts.length,
      journey_duration_ms: Date.now() - this.currentJourney!.startTime
    });
  }

  /**
   * Trackt Add-to-Cart mit vollständigem Journey-Context
   */
  trackAddToCart(
    productId: string,
    productName: string,
    isMarke: boolean,
    userId?: string
  ): void {
    if (!this.currentJourney) {
      console.warn('⚠️ Add-to-Cart ohne aktive Journey!');
      return;
    }

    this.currentJourney.addedToCart = {
      productId,
      timestamp: Date.now(),
      fromFilters: this.currentJourney.activeFilters
    };

    console.log(`🛒 Add-to-Cart mit Journey: ${productName.substring(0, 30)}...`, {
      discoveryMethod: this.currentJourney.discoveryMethod,
      activeFilters: this.currentJourney.activeFilters,
      journeyDuration: Date.now() - this.currentJourney.startTime
    });

    // Track zu GA4 mit vollständigem Context
    analyticsService.trackAddToCart(
      productId,
      productName,
      isMarke,
      this.currentJourney.discoveryMethod,
      userId,
      {
        journey_id: this.currentJourney.journeyId,
        discovery_filters: this.currentJourney.activeFilters,
        products_viewed_before: this.currentJourney.viewedProducts.length,
        journey_duration_ms: Date.now() - this.currentJourney.startTime,
        screen_name: this.currentJourney.screenName
      }
    );
  }

  /**
   * Trackt Add-to-Favorites mit Journey-Context
   */
  trackAddToFavorites(
    productId: string,
    productName: string,
    userId?: string
  ): void {
    if (!this.currentJourney) {
      console.warn('⚠️ Add-to-Favorites ohne aktive Journey!');
      return;
    }

    this.currentJourney.addedToFavorites = {
      productId,
      timestamp: Date.now(),
      fromFilters: this.currentJourney.activeFilters
    };

    console.log(`❤️ Add-to-Favorites mit Journey: ${productName.substring(0, 30)}...`, {
      discoveryMethod: this.currentJourney.discoveryMethod,
      activeFilters: this.currentJourney.activeFilters
    });

    // Track zu GA4
    analyticsService.trackEvent({
      event_name: 'add_to_favorites',
      event_category: 'conversion',
      product_id: productId,
      journey_id: this.currentJourney.journeyId,
      discovery_method: this.currentJourney.discoveryMethod,
      discovery_filters: this.currentJourney.activeFilters,
      journey_duration_ms: Date.now() - this.currentJourney.startTime,
      screen_name: this.currentJourney.screenName
    }, userId);
  }

  /**
   * Trackt Purchase mit vollständiger Journey-Attribution
   */
  trackPurchase(
    productIds: string[],
    totalSavings: number,
    userId?: string
  ): void {
    if (!this.currentJourney) {
      console.warn('⚠️ Purchase ohne aktive Journey!');
      return;
    }

    this.currentJourney.purchased = {
      productIds,
      timestamp: Date.now(),
      totalSavings
    };

    console.log(`💰 Purchase mit Journey: ${productIds.length} Produkte, €${totalSavings.toFixed(2)}`, {
      discoveryMethod: this.currentJourney.discoveryMethod,
      originalFilters: this.currentJourney.activeFilters,
      journeyDuration: Date.now() - this.currentJourney.startTime
    });

    // Track vollständige Journey zu GA4
    analyticsService.trackEvent({
      event_name: 'journey_purchase_completed',
      event_category: 'conversion',
      journey_id: this.currentJourney.journeyId,
      discovery_method: this.currentJourney.discoveryMethod,
      discovery_filters: this.currentJourney.activeFilters,
      products_purchased: productIds.length,
      products_viewed_total: this.currentJourney.viewedProducts.length,
      total_savings: totalSavings,
      journey_duration_ms: Date.now() - this.currentJourney.startTime,
      conversion_rate: productIds.length / Math.max(1, this.currentJourney.viewedProducts.length)
    }, userId);

    // Journey nach Purchase abschließen
    this.completeJourney('purchase');
  }

  /**
   * Aktualisiert Filter-Context während der Journey
   */
  updateFilters(newFilters: JourneyContext['activeFilters']): void {
    if (this.currentJourney) {
      this.currentJourney.activeFilters = newFilters;
      console.log(`🔄 Journey Filter Update:`, newFilters);
    }
  }

  /**
   * Holt den aktuellen Journey-Context
   */
  getCurrentJourney(): JourneyContext | null {
    return this.currentJourney;
  }

  /**
   * Schließt die aktuelle Journey ab
   */
  completeJourney(reason: 'purchase' | 'timeout' | 'navigation'): void {
    if (!this.currentJourney) return;

    const duration = Date.now() - this.currentJourney.startTime;
    console.log(`🏁 Journey Completed: ${reason} nach ${Math.round(duration/1000)}s`, {
      viewedProducts: this.currentJourney.viewedProducts.length,
      addedToCart: !!this.currentJourney.addedToCart,
      addedToFavorites: !!this.currentJourney.addedToFavorites,
      purchased: !!this.currentJourney.purchased
    });

    // Cleanup
    this.currentJourney = null;
    if (this.journeyTimeout) {
      clearTimeout(this.journeyTimeout);
      this.journeyTimeout = null;
    }
  }

  /**
   * Startet neue Journey bei Screen-Navigation
   */
  onScreenChange(screenName: string, context?: any): void {
    // Schließe vorherige Journey ab
    if (this.currentJourney) {
      this.completeJourney('navigation');
    }

    // Starte neue Journey basierend auf Screen
    let discoveryMethod: JourneyContext['discoveryMethod'] = 'browse';
    let activeFilters: JourneyContext['activeFilters'] | undefined;

    if (screenName.includes('search')) {
      discoveryMethod = 'search';
      activeFilters = { searchQuery: context?.searchQuery };
    } else if (screenName.includes('scanner')) {
      discoveryMethod = 'scan';
    } else if (screenName.includes('favorites')) {
      discoveryMethod = 'favorites';
    } else if (screenName.includes('purchase-history')) {
      discoveryMethod = 'repurchase';
    }

    this.startJourney(discoveryMethod, screenName, activeFilters);
  }
}

export default JourneyTrackingService.getInstance();
