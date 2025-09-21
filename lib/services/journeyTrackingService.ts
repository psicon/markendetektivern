import { db } from '@/lib/firebase';
import { addDoc, collection, doc, DocumentReference, serverTimestamp, updateDoc } from 'firebase/firestore';
import { analyticsService } from './analyticsService';

export interface JourneyContext {
  journeyId: string;
  startTime: number;
  
  // Discovery Context
  discoveryMethod: 'search' | 'browse' | 'scan' | 'favorites' | 'repurchase' | 'category' | 'comparison';
  screenName: string;
  
  // Filter Context (wenn über browse/search)
  activeFilters?: {
    markets?: {
      id: string;
      name: string;
      docRef: DocumentReference; // Echte Firestore Referenz
    }[];
    categories?: {
      id: string;
      name: string;
      docRef: DocumentReference; // Echte Firestore Referenz
    }[];
    sortBy?: 'name' | 'price' | 'savings';
    searchQuery?: string;
    stufe?: number[];
    // NEU: Erweiterte Filter
    allergens?: {
      key: string;
      name: string;
    }[];
    nutrition?: {
      key: string;
      name: string;
      range: { min?: number; max?: number };
    }[];
    priceRange?: { min?: number; max?: number };
  };
  
  // NEU: Filter-Analyse
  filterMetrics?: {
    complexity: number;           // 0-10 Skala
    motivation: 'price' | 'content' | 'market_loyalty' | 'brand' | 'exploration';
    totalActiveFilters: number;
    filterChangesCount: number;   // Anzahl Filter-Änderungen in dieser Journey
  };
  
  // NEU: Detaillierte Motivations-Signale
  motivationSignals?: {
    priceSignals: number;      // Preis-Filter, Sortierung nach Preis, etc.
    brandSignals: number;      // Marken-Suche, Hersteller-Filter
    contentSignals: number;    // Allergen-, Nährwert-Filter
    marketSignals: number;     // Markt-Treue
    searchTerms: string[];     // Gesuchte Begriffe für Analyse
  };
  
  // NEU: Filter-Historie
  filterHistory?: {
    timestamp: number;
    action: 'added' | 'removed' | 'cleared';
    filterType: string;
    filterValue: string;
    filtersSnapshot: any;
  }[];
  
  // Product Context - NEU: Erweitert um alle Aktionen pro Produkt
  viewedProducts: {
    productId: string;
    productType: 'brand' | 'noname';
    productName: string;
    timestamp: number;
    position?: number; // Position in Liste
    fromScreen: string; // Screen von dem das Produkt aufgerufen wurde
    
    // NEU: Discovery Context - wie wurde das Produkt gefunden
    discoveryContext: {
      method: 'browse' | 'search' | 'scan' | 'category' | 'favorites' | 'repurchase' | 'comparison';
      searchQuery?: string;
      activeFiltersSnapshot?: any; // Filter zum Zeitpunkt der Entdeckung
      comparedWithProducts?: { // Bei Vergleichsansicht
        productId: string;
        productName: string;
        productType: 'brand' | 'noname';
      }[];
    };
    
    // NEU: Alle Aktionen die mit diesem Produkt passiert sind
    actions?: {
      timestamp: number;
      type: 'viewed' | 'addedToCart' | 'removedFromCart' | 'addedToFavorites' | 
            'removedFromFavorites' | 'purchased' | 'converted' | 'compared';
      
      // Produkt-Details
      productId?: string;
      productName?: string;
      productType?: 'brand' | 'noname';
      productRef?: DocumentReference; // NEU: Echte Firestore Referenz
      
      fromScreen?: string;
      fromFilters?: any;
      price?: number;
      savings?: number;
      comparedProducts?: {
        productId: string;
        productName: string;
        productType: 'brand' | 'noname';
        productRef?: DocumentReference;
        price: number;
        savings: number;
      }[];
      
      // NEU: Motivation für diese spezifische Action
      motivationSignals?: {
        priceMotivation: number;     // 0-1: Wie sehr war Preis ein Faktor?
        brandMotivation: number;     // 0-1: Wie sehr war Marke ein Faktor?
        contentMotivation: number;   // 0-1: Wie sehr waren Inhaltsstoffe ein Faktor?
        savingsMotivation: number;   // 0-1: Wie sehr war Ersparnis ein Faktor?
        reason?: string;             // Erklärender Text
      };
      
      // NEU: Bei Aktionen aus Vergleichsansicht - welches Produkt war Kontext?
      comparisonContext?: {
        mainProductId: string; // Das Hauptprodukt der Vergleichsansicht
        mainProductName: string;
        mainProductType: 'brand' | 'noname';
        actionProduct?: { // Falls die Aktion ein anderes Produkt betrifft
          productId: string;
          productName: string;
          productType: 'brand' | 'noname';
        };
      };
      
      // Für Conversions
      toProductId?: string;
      toProductName?: string;
      toProductRef?: DocumentReference;
      market?: string;
      // Für View-Actions
      viewDuration?: number; // Sekunden auf der Produktseite
    }[];
    
    // NEU: Finaler Status dieses Produkts
    finalStatus?: {
      wasAddedToCart: boolean;
      wasAddedToFavorites: boolean;
      wasPurchased: boolean;
      wasConverted: boolean;
      finalPrice?: number;
      finalSavings?: number;
      totalInteractions: number; // Anzahl aller Interaktionen
    };
    
    // NEU: Comparison Result (falls es eine Vergleichsansicht war)
    comparisonResult?: {
      viewDuration: number; // Sekunden auf der Vergleichsseite
      productsCompared: number; // Anzahl verglichener Produkte
      selectedProduct?: string; // Welches Produkt wurde gewählt (falls eines)
      abandonmentReason?: 'price_too_high' | 'no_suitable_alternative' | 'just_browsing' | 'app_closed';
      priceRange: { min: number; max: number }; // Preisspanne der Alternativen
      savingsRange: { min: number; max: number }; // Ersparnisse der Alternativen
    };
  }[];
  
  // Actions - NEU: Arrays für mehrere Produkte pro Journey
  addedToCart?: {
    productId: string;
    productName: string;
    productType: 'noname' | 'brand';
    timestamp: number;
    fromFilters: any;
    // NEU: Preis-Snapshot zum Zeitpunkt der Aktion
    priceAtTime: number;
    savingsAtTime: number;
    comparedProducts?: {
      productId: string;
      productName: string;
      price: number;
      savings: number;
    }[];
    savingsRank?: number; // 1 = höchste Ersparnis unter verglichenen Produkten
    // NEU: Spätere Aktion (Kauf/Löschung)
    laterAction?: {
      type: 'purchase' | 'removed';
      timestamp: number;
      finalPrice?: number;
      finalSavings?: number;
    };
  }[];
  addedToFavorites?: {
    productId: string;
    productName: string;
    productType: 'noname' | 'brand';
    timestamp: number;
    fromFilters: any;
    priceAtTime: number;
    savingsAtTime: number;
    // NEU: Spätere Aktion (Kauf/Löschung aus Favoriten)
    laterAction?: {
      type: 'purchase' | 'removed';
      timestamp: number;
      finalPrice?: number;
      finalSavings?: number;
    };
  }[];
  purchased?: {
    products: {
      productId: string;
      productName: string;
      productType: 'noname' | 'brand';
      finalPrice: number;
      finalSavings: number;
    }[];
    timestamp: number;
    totalSavings: number;
  };
  
  // NEU: Markenprodukt zu NoName Converted (mit Details)
  converted?: {
    timestamp: number;
    products: {
      fromProductId: string;
      fromProductName: string;
      fromProductPrice: number;
      toProductId: string;
      toProductName: string;
      toProductPrice: number;
      savings: number;
      market: string;
      marketId: string;
    }[];
    totalSavings: number;
    fromFilters: any;
  }[];
  
  // NEU: Abbruch-Tracking
  abandoned?: {
    reason: 'filter_timeout' | 'app_backgrounded' | 'filters_cleared' | 'no_results' | 'too_complex' | 'price_too_high' | 'tab_switched';
    timestamp: number;
    context?: any;
  };
  
  // NEU: Firestore-Persistierung
  persistedToFirestore?: boolean;
  firestoreDocId?: string;
}

class JourneyTrackingService {
  private static instance: JourneyTrackingService;
  private currentJourney: JourneyContext | null = null;
  private journeyTimeout: NodeJS.Timeout | null = null;
  private backgroundTimeout: NodeJS.Timeout | null = null;
  private readonly JOURNEY_SESSION_KEY = 'active_journey_id';

  static getInstance(): JourneyTrackingService {
    if (!JourneyTrackingService.instance) {
      JourneyTrackingService.instance = new JourneyTrackingService();
    }
    return JourneyTrackingService.instance;
  }

  /**
   * Gibt die aktuelle Journey-ID zurück (für Verknüpfung mit Produkten)
   */
  getCurrentJourneyId(): string | null {
    return this.currentJourney?.journeyId || null;
  }

  /**
   * Aktualisiert eine (eventuell alte) Journey mit späteren Aktionen
   */
  async updateOriginalJourney(journeyId: string, update: {
    type: 'purchase' | 'removed';
    productId: string;
    timestamp: number;
    laterUpdate: boolean;
    finalPrice?: number;
    finalSavings?: number;
  }, userId: string): Promise<void> {
    try {
      const { query, where, getDocs, updateDoc, arrayUnion, getDoc } = await import('firebase/firestore');
      
      // Finde die Journey
      const userJourneysRef = collection(db, 'users', userId, 'journeys');
      const q = query(userJourneysRef, where('journeyId', '==', journeyId));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const journeyDoc = snapshot.docs[0];
        const journeyData = journeyDoc.data();
        
        // Erstelle das Update-Objekt für laterUpdates
        const updateData: any = {
          lastUpdated: serverTimestamp(),
          laterUpdates: arrayUnion(update)
        };
        
        // Finde und update das spezifische Produkt in addedToCart
        if (journeyData.addedToCart && Array.isArray(journeyData.addedToCart)) {
          const updatedCart = journeyData.addedToCart.map((item: any) => {
            if (item.productId === update.productId) {
              // Füge die späteren Aktionen direkt zum Produkt hinzu
              return {
                ...item,
                laterAction: {
                  type: update.type,
                  timestamp: update.timestamp,
                  ...(update.type === 'purchase' && {
                    finalPrice: update.finalPrice,
                    finalSavings: update.finalSavings
                  })
                }
              };
            }
            return item;
          });
          updateData.addedToCart = updatedCart;
        }
        
        // Finde und update das spezifische Produkt in addedToFavorites
        if (journeyData.addedToFavorites && Array.isArray(journeyData.addedToFavorites)) {
          const updatedFavorites = journeyData.addedToFavorites.map((item: any) => {
            if (item.productId === update.productId) {
              return {
                ...item,
                laterAction: {
                  type: update.type,
                  timestamp: update.timestamp,
                  ...(update.type === 'purchase' && {
                    finalPrice: update.finalPrice,
                    finalSavings: update.finalSavings
                  })
                }
              };
            }
            return item;
          });
          updateData.addedToFavorites = updatedFavorites;
        }
        
        // Update Status basierend auf Aktion
        if (update.type === 'purchase') {
          updateData.finalStatus = 'purchased_later';
          updateData.purchasedLaterAt = serverTimestamp();
        }
        
        await updateDoc(journeyDoc.ref, updateData);
        console.log(`📝 Original Journey ${journeyId} updated with ${update.type} for product ${update.productId}`);
      }
    } catch (error) {
      console.error('❌ Error updating original journey:', error);
    }
  }

  /**
   * Lädt aktive Journey aus Firestore (für Session-Fortsetzung)
   */
  async loadActiveJourney(userId: string): Promise<void> {
    try {
      // Suche nach aktiver Journey
      const { getDocs, query, where, orderBy, limit, Timestamp } = await import('firebase/firestore');
      const userJourneysRef = collection(db, 'users', userId, 'journeys');
      const q = query(
        userJourneysRef,
        where('status', '==', 'active'),
        orderBy('startTime', 'desc'),
        limit(1)
      );
      
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const journeyDoc = snapshot.docs[0];
        const data = journeyDoc.data();
        
        // Rekonstruiere Journey-Context
        this.currentJourney = {
          journeyId: data.journeyId,
          startTime: data.startTime.toDate().getTime(),
          discoveryMethod: data.discoveryMethod,
          screenName: data.screenName,
          activeFilters: data.activeFilters,
          filterMetrics: data.filterMetrics,
          viewedProducts: data.viewedProducts || [],
          addedToCart: data.addedToCart || [],
          addedToFavorites: data.addedToFavorites,
          purchased: data.purchased,
          abandoned: data.abandoned,
          persistedToFirestore: true,
          firestoreDocId: journeyDoc.id
        };
        
        console.log(`🔄 Journey wiederhergestellt: ${this.currentJourney.journeyId}`);
        
        // Restart Timeout
        if (this.journeyTimeout) {
          clearTimeout(this.journeyTimeout);
        }
        this.journeyTimeout = setTimeout(() => {
          this.completeJourney('timeout', userId);
        }, 30 * 60 * 1000);
      } else {
        // KEINE aktive Journey gefunden -> Neue starten!
        console.log('🆕 Keine aktive Journey gefunden - starte neue Session');
        this.startJourney('browse', 'app_start', undefined, userId);
      }
    } catch (error) {
      console.error('❌ Error loading active journey:', error);
      // Bei Fehler auch neue Journey starten
      this.startJourney('browse', 'app_start', undefined, userId);
    }
  }

  /**
   * Startet eine neue User Journey
   */
  startJourney(
    discoveryMethod: JourneyContext['discoveryMethod'],
    screenName: string,
    activeFilters?: JourneyContext['activeFilters'],
    userId?: string
  ): string {
    // Beende vorherige Journey falls vorhanden
    if (this.currentJourney) {
      console.log(`🔄 Beende vorherige Journey bevor neue gestartet wird`);
      this.completeJourney('navigation', userId);
    }
    
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
      journeyId: journeyId.substring(0, 20) + '...',
      userId: userId || 'NO USER ID PROVIDED!'
    });

    // Auto-complete Journey nach 30 Minuten
    if (this.journeyTimeout) {
      clearTimeout(this.journeyTimeout);
    }
    this.journeyTimeout = setTimeout(() => {
      this.completeJourney('timeout', userId);
    }, 30 * 60 * 1000);
    
    // WICHTIG: Persistiere Journey direkt beim Start!
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }

    return journeyId;
  }

  /**
   * Updated Filter in der Journey
   */
  updateFilters(filters: JourneyContext['activeFilters'], userId?: string, filterChange?: {action: 'added' | 'removed' | 'cleared', filterType: string, filterValue: string}): void {
    if (!this.currentJourney) {
      console.warn('⚠️ Keine aktive Journey für Filter-Update');
      return;
    }

    this.currentJourney.activeFilters = filters;
    
    // Berechne Filter-Metriken
    this.currentJourney.filterMetrics = this.calculateFilterMetrics(filters);
    this.currentJourney.filterMetrics.filterChangesCount++;
    
    // Füge zu Filter-Historie hinzu
    if (filterChange) {
      if (!this.currentJourney.filterHistory) {
        this.currentJourney.filterHistory = [];
      }
      this.currentJourney.filterHistory.push({
        timestamp: Date.now(),
        action: filterChange.action,
        filterType: filterChange.filterType,
        filterValue: filterChange.filterValue,
        filtersSnapshot: JSON.parse(JSON.stringify(filters))
      });
    }

    console.log('🔄 Journey Filter Update:', {
      filters,
      metrics: this.currentJourney.filterMetrics,
      historyLength: this.currentJourney.filterHistory?.length || 0
    });
    
    // Persistiere Updates zu Firestore
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }
  }

  /**
   * Trackt Product View mit Journey-Context
   */
  trackProductView(
    productId: string,
    productType: 'brand' | 'noname',
    productName: string,
    position?: number,
    userId?: string
  ): void {
    if (!this.currentJourney) {
      // Keine aktive Journey - starte eine neue
      this.startJourney('browse', 'unknown', undefined, userId);
    }

    // Prüfe ob Produkt schon viewed wurde
    let existingProduct = this.currentJourney!.viewedProducts.find(p => p.productId === productId);
    
    if (!existingProduct) {
      // Neues Produkt - erstelle vollständigen Eintrag
      const newProduct: any = {
        productId,
        productType,
        productName,
        timestamp: Date.now(),
        fromScreen: this.currentJourney!.screenName,
        discoveryContext: {
          method: this.currentJourney!.discoveryMethod
        },
        actions: [{
          timestamp: Date.now(),
          type: 'viewed' as const,
          // NEU: Produkt-Details direkt in der Action
          productId: productId,
          productName: productName,
          productType: productType,
          productRef: doc(db, productType === 'brand' ? 'markenProdukte' : 'produkte', productId),
          fromScreen: this.currentJourney!.screenName,
          fromFilters: JSON.parse(JSON.stringify(this.currentJourney!.activeFilters || {})),
          motivationSignals: this.calculateActionMotivation({ type: 'viewed' }, this.currentJourney!.activeFilters)
        }],
        finalStatus: {
          wasAddedToCart: false,
          wasAddedToFavorites: false,
          wasPurchased: false,
          wasConverted: false,
          totalInteractions: 1
        }
      };
      
      // Optional fields
      if (position !== undefined && position !== null) {
        newProduct.position = position;
      }
      
      // Discovery context optional fields
      if (this.currentJourney!.activeFilters?.searchQuery) {
        newProduct.discoveryContext.searchQuery = this.currentJourney!.activeFilters.searchQuery;
      }
      if (this.currentJourney!.activeFilters && Object.keys(this.currentJourney!.activeFilters).length > 0) {
        newProduct.discoveryContext.activeFiltersSnapshot = JSON.parse(JSON.stringify(this.currentJourney!.activeFilters));
      }
      this.currentJourney!.viewedProducts.push(newProduct);
      existingProduct = newProduct;
    } else {
      // Produkt wurde schon mal angesehen - füge weitere View-Action hinzu
      if (!existingProduct.actions) existingProduct.actions = [];
      existingProduct.actions.push({
        timestamp: Date.now(),
        type: 'viewed',
        // NEU: Produkt-Details direkt in der Action
        productId: productId,
        productName: productName,
        productType: productType,
        productRef: doc(db, productType === 'brand' ? 'markenProdukte' : 'produkte', productId),
        fromScreen: this.currentJourney!.screenName,
        fromFilters: JSON.parse(JSON.stringify(this.currentJourney!.activeFilters || {})),
        motivationSignals: this.calculateActionMotivation({ type: 'viewed' }, this.currentJourney!.activeFilters)
      });
      existingProduct.finalStatus!.totalInteractions = (existingProduct.finalStatus!.totalInteractions || 0) + 1;
    }

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
   * Trackt Produkt-Vergleichsansicht
   */
  trackProductComparison(
    mainProductId: string,
    mainProductName: string,
    mainProductType: 'brand' | 'noname',
    comparedProducts: Array<{
      productId: string;
      productName: string;
      productType: 'brand' | 'noname';
      price: number;
      savings: number;
    }>,
    userId?: string
  ): void {
    if (!this.currentJourney) {
      this.startJourney('browse', 'product-comparison', undefined, userId);
    }

    // Tracke für das Hauptprodukt
    let mainProduct = this.currentJourney!.viewedProducts.find(p => p.productId === mainProductId);
    if (mainProduct) {
      if (!mainProduct.actions) mainProduct.actions = [];
      mainProduct.actions.push({
        timestamp: Date.now(),
        type: 'compared',
        // NEU: Produkt-Details direkt in der Action
        productId: mainProductId,
        productName: mainProductName,
        productType: mainProductType,
        productRef: doc(db, mainProductType === 'brand' ? 'markenProdukte' : 'produkte', mainProductId),
        fromScreen: this.currentJourney!.screenName,
        comparedProducts: comparedProducts.map(p => ({
          ...p,
          productRef: doc(db, p.productType === 'brand' ? 'markenProdukte' : 'produkte', p.productId)
        })),
        motivationSignals: this.calculateActionMotivation({
          type: 'compared',
          comparedProducts: comparedProducts
        }, this.currentJourney!.activeFilters)
      });
      
      // Update discoveryContext
      if (!mainProduct.discoveryContext.comparedWithProducts) {
        mainProduct.discoveryContext.comparedWithProducts = comparedProducts;
      }
      
      // NEU: Initialize comparison result tracking
      if (!mainProduct.comparisonResult) {
        const prices = comparedProducts.map(p => p.price);
        const savings = comparedProducts.map(p => p.savings);
        
        mainProduct.comparisonResult = {
          viewDuration: 0, // Wird beim Verlassen aktualisiert
          productsCompared: comparedProducts.length,
          priceRange: {
            min: Math.min(...prices),
            max: Math.max(...prices)
          },
          savingsRange: {
            min: Math.min(...savings),
            max: Math.max(...savings)
          }
        };
        
        // Speichere Start-Zeit für Duration-Tracking
        (mainProduct as any).comparisonStartTime = Date.now();
      }
    }

    console.log(`🔍 Product Comparison: ${mainProductName} mit ${comparedProducts.length} Alternativen`);
  }
  
  /**
   * Trackt das Ende einer Vergleichsansicht
   */
  trackComparisonEnd(
    mainProductId: string,
    selectedProductId?: string,
    abandonmentReason?: 'price_too_high' | 'no_suitable_alternative' | 'just_browsing' | 'app_closed'
  ): void {
    if (!this.currentJourney) return;
    
    const mainProduct = this.currentJourney.viewedProducts.find(p => p.productId === mainProductId);
    if (mainProduct && mainProduct.comparisonResult) {
      // Update view duration
      if ((mainProduct as any).comparisonStartTime) {
        mainProduct.comparisonResult.viewDuration = 
          Math.round((Date.now() - (mainProduct as any).comparisonStartTime) / 1000);
        delete (mainProduct as any).comparisonStartTime;
      }
      
      // Set selected product or abandonment reason
      if (selectedProductId) {
        mainProduct.comparisonResult.selectedProduct = selectedProductId;
      } else if (abandonmentReason) {
        mainProduct.comparisonResult.abandonmentReason = abandonmentReason;
      }
      
      console.log(`📊 Comparison End: ${abandonmentReason || 'Product selected'}`);
    }
  }

  /**
   * Trackt Add-to-Cart mit vollständigem Journey-Context
   */
  trackAddToCart(
    productId: string,
    productName: string,
    isMarke: boolean,
    userId?: string,
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
  ): void {
    if (!this.currentJourney) {
      console.warn('⚠️ Add-to-Cart ohne aktive Journey!');
      // Starte Fallback-Journey für isolierte Add-to-Cart Actions
      this.startJourney('browse', 'unknown', undefined, userId);
      if (!this.currentJourney) return;
    }

    // Initialisiere Array wenn noch nicht vorhanden
    if (!this.currentJourney.addedToCart) {
      this.currentJourney.addedToCart = [];
    }

    // Füge neues Produkt hinzu mit Preis-Snapshot
    const cartItem = {
      productId,
      productName,
      productType: (isMarke ? 'brand' : 'noname') as 'brand' | 'noname',
      timestamp: Date.now(),
      fromFilters: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {})),
      priceAtTime: priceInfo?.price || 0,
      savingsAtTime: priceInfo?.savings || 0,
      comparedProducts: priceInfo?.comparedProducts,
      // NEU: Tracke ob höchste/niedrigste Ersparnis gewählt wurde
      savingsRank: this.calculateSavingsRank(priceInfo?.savings || 0, priceInfo?.comparedProducts)
    };
    
    this.currentJourney.addedToCart.push(cartItem);
    
    // NEU: Update auch viewedProducts mit der Aktion
    let viewedProduct = this.currentJourney.viewedProducts.find(p => p.productId === productId);
    
    // Wenn Produkt noch nicht viewed wurde, füge es jetzt hinzu
    if (!viewedProduct) {
      viewedProduct = {
        productId,
        productType: (isMarke ? 'brand' : 'noname') as 'brand' | 'noname',
        productName,
        timestamp: Date.now(),
        fromScreen: this.currentJourney.screenName,
        discoveryContext: {
          method: this.currentJourney.discoveryMethod,
          searchQuery: this.currentJourney.activeFilters?.searchQuery,
          activeFiltersSnapshot: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {}))
        },
        actions: [],
        finalStatus: {
          wasAddedToCart: false,
          wasAddedToFavorites: false,
          wasPurchased: false,
          wasConverted: false,
          totalInteractions: 0
        }
      };
      this.currentJourney.viewedProducts.push(viewedProduct);
    }
    
    // Füge die AddToCart Aktion hinzu
    if (!viewedProduct.actions) viewedProduct.actions = [];
    const action: any = {
      timestamp: Date.now(),
      type: 'addedToCart',
      // NEU: Produkt-Details direkt in der Action
      productId: productId,
      productName: productName,
      productType: isMarke ? 'brand' : 'noname',
      productRef: doc(db, isMarke ? 'markenProdukte' : 'produkte', productId),
      fromFilters: cartItem.fromFilters,
      price: priceInfo?.price,
      savings: priceInfo?.savings,
      comparedProducts: priceInfo?.comparedProducts,
      motivationSignals: this.calculateActionMotivation({
        type: 'addedToCart',
        price: priceInfo?.price,
        savings: priceInfo?.savings,
        comparedProducts: priceInfo?.comparedProducts
      }, this.currentJourney!.activeFilters)
    };
    
    // NEU: Füge Vergleichskontext hinzu wenn vorhanden
    if (comparisonContext) {
      action.comparisonContext = {
        mainProductId: comparisonContext.mainProductId,
        mainProductName: comparisonContext.mainProductName,
        mainProductType: comparisonContext.mainProductType
      };
      
      // Wenn das hinzugefügte Produkt NICHT das Hauptprodukt ist
      if (productId !== comparisonContext.mainProductId) {
        action.comparisonContext.actionProduct = {
          productId: productId,
          productName: productName,
          productType: isMarke ? 'brand' : 'noname'
        };
      }
    }
    
    viewedProduct.actions.push(action);
    viewedProduct.finalStatus!.wasAddedToCart = true;
    viewedProduct.finalStatus!.totalInteractions = (viewedProduct.finalStatus!.totalInteractions || 0) + 1;

    console.log(`🛒 Add-to-Cart mit Journey: ${productName.substring(0, 30)}...`, {
      discoveryMethod: this.currentJourney.discoveryMethod,
      activeFilters: this.currentJourney.activeFilters,
      totalInCart: this.currentJourney.addedToCart.length,
      journeyDuration: Date.now() - this.currentJourney.startTime
    });

    // Track zu GA4 mit vollständigem Context
    analyticsService.trackAddToCart(
      productId,
      productName,
      isMarke,
      this.currentJourney.discoveryMethod as any, // Type cast für discovery method
      userId,
      {
        journey_id: this.currentJourney.journeyId,
        discovery_filters: this.currentJourney.activeFilters,
        products_viewed_before: this.currentJourney.viewedProducts.length,
        products_in_cart: this.currentJourney.addedToCart.length,
        journey_duration_ms: Date.now() - this.currentJourney.startTime,
        screen_name: this.currentJourney.screenName
      }
    );

    // Persistiere Journey Update
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }
  }

  /**
   * Trackt Add-to-Favorites mit Journey-Context
   */
  trackAddToFavorites(
    productId: string,
    productName: string,
    productType: 'noname' | 'brand',
    userId?: string,
    priceInfo?: {
      price: number;
      savings: number;
    },
    comparisonContext?: { // NEU: Kontext wenn aus Vergleich hinzugefügt
      mainProductId: string;
      mainProductName: string;
      mainProductType: 'brand' | 'noname';
    }
  ): void {
    if (!this.currentJourney) {
      console.warn('⚠️ Add-to-Favorites ohne aktive Journey!');
      // Starte Fallback-Journey
      this.startJourney('browse', 'unknown', undefined, userId);
      if (!this.currentJourney) return;
    }

    // Initialisiere Array wenn noch nicht vorhanden
    if (!this.currentJourney.addedToFavorites) {
      this.currentJourney.addedToFavorites = [];
    }

    this.currentJourney.addedToFavorites.push({
      productId,
      productName,
      productType,
      timestamp: Date.now(),
      fromFilters: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {})),
      priceAtTime: priceInfo?.price || 0,
      savingsAtTime: priceInfo?.savings || 0
    });
    
    // NEU: Update auch viewedProducts mit der Aktion
    let viewedProduct = this.currentJourney.viewedProducts.find(p => p.productId === productId);
    
    // Wenn Produkt noch nicht viewed wurde, füge es jetzt hinzu
    if (!viewedProduct) {
      viewedProduct = {
        productId,
        productType,
        productName,
        timestamp: Date.now(),
        fromScreen: this.currentJourney.screenName,
        discoveryContext: {
          method: this.currentJourney.discoveryMethod,
          searchQuery: this.currentJourney.activeFilters?.searchQuery,
          activeFiltersSnapshot: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {}))
        },
        actions: [],
        finalStatus: {
          wasAddedToCart: false,
          wasAddedToFavorites: false,
          wasPurchased: false,
          wasConverted: false,
          totalInteractions: 0
        }
      };
      this.currentJourney.viewedProducts.push(viewedProduct);
    }
    
    // Füge die AddToFavorites Aktion hinzu
    if (!viewedProduct.actions) viewedProduct.actions = [];
    const action: any = {
      timestamp: Date.now(),
      type: 'addedToFavorites',
      // NEU: Produkt-Details direkt in der Action
      productId: productId,
      productName: productName,
      productType: productType,
      productRef: doc(db, productType === 'brand' ? 'markenProdukte' : 'produkte', productId),
      fromFilters: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {})),
      price: priceInfo?.price,
      savings: priceInfo?.savings,
      motivationSignals: this.calculateActionMotivation({
        type: 'addedToFavorites',
        price: priceInfo?.price,
        savings: priceInfo?.savings
      }, this.currentJourney.activeFilters)
    };
    
    // NEU: Füge Vergleichskontext hinzu wenn vorhanden
    if (comparisonContext) {
      action.comparisonContext = {
        mainProductId: comparisonContext.mainProductId,
        mainProductName: comparisonContext.mainProductName,
        mainProductType: comparisonContext.mainProductType
      };
      
      // Wenn das hinzugefügte Produkt NICHT das Hauptprodukt ist
      if (productId !== comparisonContext.mainProductId) {
        action.comparisonContext.actionProduct = {
          productId: productId,
          productName: productName,
          productType: productType
        };
      }
    }
    
    viewedProduct.actions.push(action);
    viewedProduct.finalStatus!.wasAddedToFavorites = true;

    console.log(`❤️ Add-to-Favorites mit Journey: ${productName.substring(0, 30)}...`, {
      discoveryMethod: this.currentJourney.discoveryMethod,
      activeFilters: this.currentJourney.activeFilters,
      totalFavorites: this.currentJourney.addedToFavorites.length
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
    
    // WICHTIG: Persistiere zu Firestore!
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }
  }

  /**
   * Berechnet Ersparnis-Rang (1 = höchste Ersparnis)
   */
  private calculateSavingsRank(savings: number, comparedProducts?: any[]): number {
    if (!comparedProducts || comparedProducts.length === 0) return 1;
    
    const allSavings = [savings, ...comparedProducts.map(p => p.savings || 0)];
    allSavings.sort((a, b) => b - a); // Sortiere absteigend
    
    return allSavings.indexOf(savings) + 1;
  }

  /**
   * Trackt Purchase mit vollständiger Journey-Attribution
   */
  trackPurchase(
    products: { 
      productId: string; 
      productName: string; 
      productType: 'brand' | 'noname';
      finalPrice?: number;
      finalSavings?: number;
    }[],
    totalSavings: number,
    userId?: string
  ): void {
    if (!this.currentJourney) {
      console.warn('⚠️ Purchase ohne aktive Journey!');
      // Starte Fallback-Journey
      this.startJourney('browse', 'shopping-list', undefined, userId);
      if (!this.currentJourney) return;
    }

    this.currentJourney.purchased = {
      products: products.map(p => ({
        productId: p.productId,
        productName: p.productName,
        productType: p.productType,
        finalPrice: p.finalPrice || 0,
        finalSavings: p.finalSavings || 0
      })),
      timestamp: Date.now(),
      totalSavings
    };
    
    // NEU: Update auch viewedProducts mit der Purchase-Aktion
    products.forEach(product => {
      const viewedProduct = this.currentJourney!.viewedProducts.find(p => p.productId === product.productId);
      if (viewedProduct) {
        if (!viewedProduct.actions) viewedProduct.actions = [];
        viewedProduct.actions.push({
          timestamp: Date.now(),
          type: 'purchased',
          // NEU: Produkt-Details direkt in der Action
          productId: product.productId,
          productName: product.productName,
          productType: product.productType,
          productRef: doc(db, product.productType === 'brand' ? 'markenProdukte' : 'produkte', product.productId),
          price: product.finalPrice,
          savings: product.finalSavings,
          motivationSignals: this.calculateActionMotivation({
            type: 'purchased',
            price: product.finalPrice,
            savings: product.finalSavings
          }, this.currentJourney!.activeFilters)
        });
        viewedProduct.finalStatus!.wasPurchased = true;
        viewedProduct.finalStatus!.finalPrice = product.finalPrice;
        viewedProduct.finalStatus!.finalSavings = product.finalSavings;
      }
    });

    console.log(`💰 Purchase mit Journey: ${products.length} Produkte, €${totalSavings.toFixed(2)}`, {
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
      products_purchased: products.length,
      products_viewed_total: this.currentJourney.viewedProducts.length,
      total_savings: totalSavings,
      journey_duration_ms: Date.now() - this.currentJourney.startTime,
      conversion_rate: products.length / Math.max(1, this.currentJourney.viewedProducts.length)
    }, userId);

    // Journey nach Purchase abschließen
    this.completeJourney('purchase');
  }


  /**
   * Berechnet Motivation Signals für eine spezifische Action
   */
  private calculateActionMotivation(
    action: { type: string; price?: number; savings?: number; comparedProducts?: any[] },
    filters?: JourneyContext['activeFilters']
  ): any {
    const motivation = {
      priceMotivation: 0,
      brandMotivation: 0,
      contentMotivation: 0,
      savingsMotivation: 0,
      reason: ''
    };

    // Preis-Motivation
    if (filters?.sortBy === 'price' || filters?.priceRange) {
      motivation.priceMotivation += 0.3;
    }
    if (action.savings && action.savings > 0) {
      motivation.savingsMotivation = Math.min(action.savings / 5, 1); // Normalisiert auf 0-1
      motivation.priceMotivation += 0.2;
    }
    if (action.comparedProducts?.length) {
      // Wurde das günstigste Produkt gewählt?
      const prices = action.comparedProducts.map(p => p.price || 0);
      const minPrice = Math.min(...prices);
      if (action.price && action.price <= minPrice * 1.1) {
        motivation.priceMotivation += 0.3;
        motivation.reason = 'Günstigstes Produkt gewählt';
      }
    }

    // Content-Motivation (Allergene, Nährwerte)
    if (filters?.allergens && Object.keys(filters.allergens).length > 0) {
      motivation.contentMotivation += 0.5;
    }
    if (filters?.nutrition && Object.keys(filters.nutrition).length > 0) {
      motivation.contentMotivation += 0.5;
    }

    // Brand-Motivation
    if (filters?.searchQuery) {
      // Marken-Keywords in Suche?
      const brandKeywords = ['milka', 'nutella', 'coca', 'haribo', 'ferrero'];
      const searchLower = filters.searchQuery.toLowerCase();
      if (brandKeywords.some(brand => searchLower.includes(brand))) {
        motivation.brandMotivation = 0.8;
      }
    }

    // Normalisiere alle Werte auf 0-1
    motivation.priceMotivation = Math.min(motivation.priceMotivation, 1);
    motivation.contentMotivation = Math.min(motivation.contentMotivation, 1);

    return motivation;
  }

  /**
   * Berechnet Filter-Metriken
   */
  private calculateFilterMetrics(filters?: JourneyContext['activeFilters']): JourneyContext['filterMetrics'] {
    if (!filters) {
      return {
        complexity: 0,
        motivation: 'exploration',
        totalActiveFilters: 0,
        filterChangesCount: 0
      };
    }

    // Berechne Komplexität (0-10 Skala)
    let complexity = 0;
    complexity += (filters.markets?.length || 0) * 0.5;
    complexity += (filters.categories?.length || 0) * 0.5;
    complexity += (filters.stufe?.length || 0) * 0.3;
    complexity += (filters.allergens?.length || 0) * 1.5; // Höhere Komplexität
    complexity += (filters.nutrition?.length || 0) * 2.0; // Sehr spezifisch
    complexity += (filters.priceRange?.min || filters.priceRange?.max) ? 1.0 : 0;
    
    const finalComplexity = Math.min(complexity, 10);

    // Bestimme Haupt-Motivation mit Prioritäten
    let motivation: JourneyContext['filterMetrics']['motivation'] = 'exploration';
    
    // Update Motivations-Signale
    if (!this.currentJourney.motivationSignals) {
      this.currentJourney.motivationSignals = {
        priceSignals: 0,
        brandSignals: 0,
        contentSignals: 0,
        marketSignals: 0,
        searchTerms: []
      };
    }
    
    // Zähle Signale mit Gewichtung
    let priceWeight = 0;
    let contentWeight = 0;
    let brandWeight = 0;
    let marketWeight = 0;
    
    if (filters.stufe?.length || filters.priceRange || filters.sortBy === 'price') {
      this.currentJourney.motivationSignals.priceSignals++;
      priceWeight = filters.sortBy === 'price' ? 3 : 2; // Sortierung nach Preis = starkes Signal
    }
    if (filters.sortBy === 'savings') {
      this.currentJourney.motivationSignals.priceSignals++;
      priceWeight = 3; // Sortierung nach Ersparnis = sehr starkes Preis-Signal
    }
    if (filters.nutrition?.length || filters.allergens?.length) {
      this.currentJourney.motivationSignals.contentSignals++;
      contentWeight = (filters.allergens?.length || 0) * 2 + (filters.nutrition?.length || 0);
    }
    if (filters.markets?.length) {
      this.currentJourney.motivationSignals.marketSignals++;
      marketWeight = filters.markets.length === 1 ? 2 : 1; // Single-Market = stärkere Loyalität
    }
    if (filters.searchQuery) {
      this.currentJourney.motivationSignals.searchTerms.push(filters.searchQuery);
      // Marken-Erkennung in Suchbegriffen
      if (filters.searchQuery.match(/^[A-Z][a-z]+/) || filters.searchQuery.length > 4) {
        this.currentJourney.motivationSignals.brandSignals++;
        brandWeight = 2;
      }
    }
    
    // Bestimme dominante Motivation
    const motivationScores = {
      price: priceWeight,
      content: contentWeight,
      brand: brandWeight,
      market_loyalty: marketWeight
    };
    
    const maxScore = Math.max(...Object.values(motivationScores));
    if (maxScore > 0) {
      motivation = Object.entries(motivationScores).find(([_, score]) => score === maxScore)?.[0] as any || 'exploration';
    }

    // Zähle aktive Filter
    let totalActiveFilters = 0;
    totalActiveFilters += filters.markets?.length || 0;
    totalActiveFilters += filters.categories?.length || 0;
    totalActiveFilters += filters.stufe?.length || 0;
    totalActiveFilters += filters.allergens?.length || 0;
    totalActiveFilters += filters.nutrition?.length || 0;
    totalActiveFilters += (filters.priceRange?.min || filters.priceRange?.max) ? 1 : 0;

    return {
      complexity: finalComplexity,
      motivation,
      totalActiveFilters,
      filterChangesCount: this.currentJourney?.filterMetrics?.filterChangesCount || 0
    };
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
  completeJourney(reason: 'purchase' | 'timeout' | 'app_closed' | 'logout' | 'new_session' | 'navigation', userId?: string): void {
    if (!this.currentJourney) return;

    const duration = Date.now() - this.currentJourney.startTime;
    
    // Wenn Timeout und Filter aktiv → als Abbruch markieren
    if (reason === 'timeout' && this.currentJourney.filterMetrics?.totalActiveFilters > 0) {
      this.trackJourneyAbandonment('filter_timeout', {
        filterComplexity: this.currentJourney.filterMetrics.complexity,
        activeFilters: this.currentJourney.filterMetrics.totalActiveFilters,
        productsViewed: this.currentJourney.viewedProducts.length
      }, userId);
    }
    
    console.log(`🏁 Journey Completed: ${reason} nach ${Math.round(duration/1000)}s`, {
      viewedProducts: this.currentJourney.viewedProducts.length,
      addedToCart: !!this.currentJourney.addedToCart,
      addedToFavorites: !!this.currentJourney.addedToFavorites,
      purchased: !!this.currentJourney.purchased,
      abandoned: !!this.currentJourney.abandoned,
      filterMetrics: this.currentJourney.filterMetrics
    });

    // Final Firestore Update - speichere Journey-Referenz VOR dem Cleanup
    const journeyToFinalize = this.currentJourney;
    
    // Cleanup ZUERST (damit keine neuen Events mehr kommen)
    this.currentJourney = null;
    if (this.journeyTimeout) {
      clearTimeout(this.journeyTimeout);
      this.journeyTimeout = null;
    }
    if (this.backgroundTimeout) {
      clearTimeout(this.backgroundTimeout);
      this.backgroundTimeout = null;
    }
    
    // Finalisiere mit gespeicherter Referenz
    if (userId && journeyToFinalize) {
      this.finalizeJourneyInFirestore(userId, reason, journeyToFinalize);
    }
  }

  /**
   * Trackt Journey-Abbruch
   */
  trackJourneyAbandonment(
    reason: JourneyContext['abandoned']['reason'],
    context?: any,
    userId?: string
  ): void {
    if (!this.currentJourney) return;

    this.currentJourney.abandoned = {
      reason,
      timestamp: Date.now(),
      context
    };

    console.log(`❌ Journey Abandoned: ${reason}`, {
      filterMetrics: this.currentJourney.filterMetrics,
      productsViewed: this.currentJourney.viewedProducts.length,
      context
    });

    // Track zu Analytics
    analyticsService.trackEvent({
      event_name: 'journey_abandoned',
      event_category: 'user_action',
      journey_id: this.currentJourney.journeyId,
      abandonment_reason: reason,
      filter_complexity: this.currentJourney.filterMetrics?.complexity || 0,
      filter_motivation: this.currentJourney.filterMetrics?.motivation || 'exploration',
      total_active_filters: this.currentJourney.filterMetrics?.totalActiveFilters || 0,
      products_viewed: this.currentJourney.viewedProducts.length,
      journey_duration_ms: Date.now() - this.currentJourney.startTime,
      context
    }, userId);

    // Persistiere zu Firestore
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }
  }

  /**
   * Persistiert Journey zu Firestore
   */
  private async persistJourneyToFirestore(userId: string): Promise<void> {
    // WICHTIG: Sichere Referenz vor async Operationen
    const journey = this.currentJourney;
    
    console.log('📝 Attempting to persist journey to Firestore...', {
      userId: userId || 'NO USER ID!',
      hasCurrentJourney: !!journey,
      journeyId: journey?.journeyId
    });
    
    if (!journey) {
      console.warn('⚠️ No current journey to persist');
      return;
    }
    
    if (!userId) {
      console.error('❌ No userId provided for journey persistence!');
      return;
    }

    try {
      // Bereite Journey-Daten vor und entferne undefined Werte
      const cleanActiveFilters: any = {};
      if (journey.activeFilters) {
        Object.entries(journey.activeFilters).forEach(([key, value]) => {
          if (value !== undefined) {
            cleanActiveFilters[key] = value;
          }
        });
      }

      const journeyData: any = {
        journeyId: journey.journeyId,
        startTime: new Date(journey.startTime),
        lastUpdated: serverTimestamp(),
        
        // Discovery Context
        discoveryMethod: journey.discoveryMethod,
        screenName: journey.screenName,
        
        // Filter Context
        activeFilters: cleanActiveFilters,
        filterMetrics: journey.filterMetrics || {},
        filterHistory: journey.filterHistory || [],
        
        // Product Interactions - Clean undefined values
        viewedProducts: (journey.viewedProducts || []).map(product => {
          const cleanProduct: any = {
            productId: product.productId,
            productType: product.productType,
            productName: product.productName,
            timestamp: product.timestamp,
            fromScreen: product.fromScreen,
            discoveryContext: {
              method: product.discoveryContext?.method || 'browse',
              ...(product.discoveryContext?.searchQuery && { searchQuery: product.discoveryContext.searchQuery }),
              ...(product.discoveryContext?.activeFiltersSnapshot && { activeFiltersSnapshot: product.discoveryContext.activeFiltersSnapshot }),
              ...(product.discoveryContext?.comparedWithProducts && { comparedWithProducts: product.discoveryContext.comparedWithProducts })
            }
          };
          
          // Optional fields - nur wenn definiert und nicht null
          if (product.position !== undefined && product.position !== null) {
            cleanProduct.position = product.position;
          }
          
          // Clean actions array
          if (product.actions && product.actions.length > 0) {
            cleanProduct.actions = product.actions.map(action => {
              const cleanAction: any = {
                timestamp: action.timestamp,
                type: action.type
              };
              
              // NEU: Produkt-Details in der Action
              if (action.productId) cleanAction.productId = action.productId;
              if (action.productName) cleanAction.productName = action.productName;
              if (action.productType) cleanAction.productType = action.productType;
              if (action.productRef) cleanAction.productRef = action.productRef;
              
              // NEU: Motivation Signals
              if (action.motivationSignals) {
                cleanAction.motivationSignals = action.motivationSignals;
              }
              
              // Optional action fields
              if (action.fromScreen) cleanAction.fromScreen = action.fromScreen;
              if (action.fromFilters) cleanAction.fromFilters = action.fromFilters;
              if (action.price !== undefined) cleanAction.price = action.price;
              if (action.savings !== undefined) cleanAction.savings = action.savings;
              if (action.comparedProducts) cleanAction.comparedProducts = action.comparedProducts;
              
              // Clean comparisonContext if present
              if (action.comparisonContext) {
                cleanAction.comparisonContext = {};
                if (action.comparisonContext.mainProductId) {
                  cleanAction.comparisonContext.mainProductId = action.comparisonContext.mainProductId;
                }
                if (action.comparisonContext.mainProductName) {
                  cleanAction.comparisonContext.mainProductName = action.comparisonContext.mainProductName;
                }
                if (action.comparisonContext.mainProductType) {
                  cleanAction.comparisonContext.mainProductType = action.comparisonContext.mainProductType;
                }
                if (action.comparisonContext.actionProduct) {
                  cleanAction.comparisonContext.actionProduct = action.comparisonContext.actionProduct;
                }
              }
              
      // Conversion fields
      if (action.toProductId) cleanAction.toProductId = action.toProductId;
      if (action.toProductName) cleanAction.toProductName = action.toProductName;
      if ((action as any).toProductRef) cleanAction.toProductRef = (action as any).toProductRef;
              if (action.market) cleanAction.market = action.market;
              if (action.viewDuration !== undefined) cleanAction.viewDuration = action.viewDuration;
              
              return cleanAction;
            });
          }
          
          // Final status
          if (product.finalStatus) {
            cleanProduct.finalStatus = product.finalStatus;
          }
          
          // NEU: Comparison Result
          if (product.comparisonResult) {
            cleanProduct.comparisonResult = product.comparisonResult;
          }
          
          return cleanProduct;
        }),
        viewedProductsCount: journey.viewedProducts.length,
        
      // Conversions - Clean undefined values from arrays
      addedToCart: (journey.addedToCart || []).map(item => {
        const cleanItem: any = {
          productId: item.productId,
          productName: item.productName,
          productType: item.productType,
          timestamp: item.timestamp,
          fromFilters: item.fromFilters || {},
          priceAtTime: item.priceAtTime || 0,
          savingsAtTime: item.savingsAtTime || 0
        };
        if (item.comparedProducts) cleanItem.comparedProducts = item.comparedProducts;
        if (item.savingsRank !== undefined) cleanItem.savingsRank = item.savingsRank;
        if (item.laterAction) cleanItem.laterAction = item.laterAction;
        return cleanItem;
        }),
        addedToCartCount: journey.addedToCart?.length || 0,
        
        // Converted (Markenprodukt zu NoName)
        converted: journey.converted || [],
        convertedCount: journey.converted?.length || 0,
      addedToFavorites: (journey.addedToFavorites || []).map(item => {
        const cleanItem: any = {
          productId: item.productId,
          productName: item.productName,
          productType: item.productType,
          timestamp: item.timestamp,
          fromFilters: item.fromFilters || {},
          priceAtTime: item.priceAtTime || 0,
          savingsAtTime: item.savingsAtTime || 0
        };
        if (item.laterAction) cleanItem.laterAction = item.laterAction;
        return cleanItem;
      }),
      addedToFavoritesCount: journey.addedToFavorites?.length || 0,
      
      // Motivations-Signale
      motivationSignals: journey.motivationSignals || {
        priceSignals: 0,
        brandSignals: 0,
        contentSignals: 0,
        marketSignals: 0,
        searchTerms: []
      },
        
        // Status
        status: journey.purchased ? 'purchased' : 
                (journey.addedToCart && journey.addedToCart.length > 0) ? 'in_cart' :
                journey.abandoned ? 'abandoned' : 'active'
      };
      
      // Nur hinzufügen wenn nicht null
      if (journey.purchased) {
        journeyData.purchased = journey.purchased;
      }
      if (journey.abandoned) {
        journeyData.abandoned = journey.abandoned;
      }

      const userJourneysRef = collection(db, 'users', userId, 'journeys');
      
      if (!journey.firestoreDocId) {
        // Neue Journey erstellen
        const docRef = await addDoc(userJourneysRef, journeyData);
        
        // Update currentJourney nur wenn sie noch existiert
        if (this.currentJourney && this.currentJourney.journeyId === journey.journeyId) {
          this.currentJourney.firestoreDocId = docRef.id;
          this.currentJourney.persistedToFirestore = true;
        }
        
        console.log(`💾 Journey persisted to Firestore: ${docRef.id}`);
      } else {
        // Bestehende Journey updaten
        const docRef = doc(userJourneysRef, journey.firestoreDocId);
        await updateDoc(docRef, journeyData);
        
        console.log(`💾 Journey updated in Firestore: ${journey.firestoreDocId}`);
      }
      
    } catch (error) {
      console.error('❌ Error persisting journey to Firestore:', error);
    }
  }

  /**
   * Finalisiert Journey in Firestore
   */
  private async finalizeJourneyInFirestore(userId: string, completionReason: string, journey?: JourneyContext): Promise<void> {
    const journeyToFinalize = journey || this.currentJourney;
    if (!journeyToFinalize) return;

    try {
      const finalData = {
        completedAt: serverTimestamp(),
        completionReason,
        journeyDurationMs: Date.now() - journeyToFinalize.startTime,
        finalStatus: journeyToFinalize.purchased ? 'purchased' : 
                    (journeyToFinalize.addedToCart && journeyToFinalize.addedToCart.length > 0) ? 'in_cart' :
                    journeyToFinalize.abandoned ? 'abandoned' : 'completed'
      };

      if (journeyToFinalize.firestoreDocId) {
        const docRef = doc(db, 'users', userId, 'journeys', journeyToFinalize.firestoreDocId);
        await updateDoc(docRef, finalData);
        
        console.log(`🏁 Journey finalized in Firestore: ${journeyToFinalize.firestoreDocId}`);
      }
    } catch (error) {
      console.error('❌ Error finalizing journey in Firestore:', error);
    }
  }

  /**
   * Startet neue Journey bei Screen-Navigation
   */
  onScreenChange(screenName: string, context?: any, userId?: string): void {
    // WICHTIG: Journey läuft IMMER weiter während der gesamten App-Session!
    // Journeys werden NUR beendet bei:
    // 1. Explizitem Journey-Ende (z.B. Purchase)
    // 2. Timeout (30 Minuten)
    // 3. App wird geschlossen
    
    if (this.currentJourney) {
      // Journey fortsetzen und aktuellen Screen updaten
      console.log(`📱 Journey fortsetzend: ${this.currentJourney.screenName} → ${screenName}`);
      this.currentJourney.screenName = screenName;
      
      // Journey in Firestore updaten
      if (userId) {
        this.persistJourneyToFirestore(userId);
      }
    } else {
      // Journey noch nicht geladen - warte kurz
      console.log('⏳ Journey noch nicht aktiv - warte auf Initialisierung...');
      // Keine Aktion nötig, loadActiveJourney startet automatisch eine neue Journey
    }
  }

  /**
   * Trackt wenn Markenprodukte zu NoName umgewandelt werden
   */
  trackProductConversion(conversions: any[], productDetails: any[], userId?: string): void {
    if (!this.currentJourney || !userId) {
      console.warn('⚠️ Product-Conversion ohne aktive Journey oder User!');
      return;
    }

    // Track Conversion Event mit Details
    this.currentJourney.converted = this.currentJourney.converted || [];
    
    // Erstelle detaillierte Produkt-Liste
    const convertedProducts = conversions.map((conv, index) => {
      const details = productDetails[index];
      const fromProductId = conv.markenProduktRef;
      const toProductId = conv.produktRef;
      const savings = (details?.fromProduct?.preis || 0) - (details?.toProduct?.preis || 0);
      const market = details?.toProduct?.discounter?.name || 'Unbekannt';
      
      // NEU: Update viewedProducts mit der Conversion-Aktion
      const viewedProduct = this.currentJourney!.viewedProducts.find(p => p.productId === fromProductId);
      if (viewedProduct) {
        if (!viewedProduct.actions) viewedProduct.actions = [];
        viewedProduct.actions.push({
          timestamp: Date.now(),
          type: 'converted',
          // NEU: Produkt-Details direkt in der Action
          productId: fromProductId,
          productName: details?.fromProduct?.name || 'Markenprodukt',
          productType: 'brand', // Conversion ist immer von Marke zu NoName
          productRef: doc(db, 'markenProdukte', fromProductId),
          toProductId: toProductId,
          toProductName: details?.toProduct?.name || 'NoName Produkt',
          toProductRef: doc(db, 'produkte', toProductId), // NEU: Referenz zum NoName Produkt
          market: market,
          savings: savings,
          motivationSignals: this.calculateActionMotivation({
            type: 'converted',
            savings: savings
          }, this.currentJourney!.activeFilters)
        });
        viewedProduct.finalStatus!.wasConverted = true;
      }
      
      return {
        fromProductId: fromProductId,
        fromProductName: details?.fromProduct?.name || 'Markenprodukt',
        fromProductPrice: details?.fromProduct?.preis || 0,
        toProductId: toProductId,
        toProductName: details?.toProduct?.name || 'NoName Produkt',
        toProductPrice: details?.toProduct?.preis || 0,
        savings: savings,
        market: market,
        marketId: details?.toProduct?.discounter?.id || ''
      };
    });
    
    const totalSavings = convertedProducts.reduce((sum, p) => sum + p.savings, 0);
    
    this.currentJourney.converted.push({
      timestamp: Date.now(),
      products: convertedProducts,
      totalSavings: totalSavings,
      fromFilters: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {}))
    });

    // Update Motivation Signals für Conversion
    if (!this.currentJourney.motivationSignals) {
      this.currentJourney.motivationSignals = {
        priceSignals: 0,
        brandSignals: 0,
        contentSignals: 0,
        marketSignals: 0,
        searchTerms: []
      };
    }
    this.currentJourney.motivationSignals.priceSignals += 2; // Conversion = starkes Preis-Signal

    console.log(`🔄 Product Conversion: ${conversions.length} Produkte umgewandelt, €${totalSavings.toFixed(2)} gespart`, {
      discoveryMethod: this.currentJourney.discoveryMethod,
      activeFilters: this.currentJourney.activeFilters,
      products: convertedProducts
    });

    // Journey in Firestore persistieren
    this.persistJourneyToFirestore(userId);
  }

  /**
   * Trackt wenn ein Produkt aus dem Warenkorb gelöscht wird
   */
  trackRemoveFromCart(
    productId: string,
    productName: string,
    productType: 'noname' | 'brand',
    userId?: string
  ): void {
    if (!this.currentJourney) return;
    
    // NEU: Update viewedProducts mit der Remove-Aktion
    const viewedProduct = this.currentJourney.viewedProducts.find(p => p.productId === productId);
    if (viewedProduct) {
      if (!viewedProduct.actions) viewedProduct.actions = [];
      viewedProduct.actions.push({
        timestamp: Date.now(),
        type: 'removedFromCart',
        // NEU: Produkt-Details direkt in der Action
        productId: productId,
        productName: productName,
        productType: productType,
        productRef: doc(db, productType === 'brand' ? 'markenProdukte' : 'produkte', productId),
        motivationSignals: this.calculateActionMotivation({
          type: 'removedFromCart'
        }, this.currentJourney.activeFilters)
      });
      viewedProduct.finalStatus!.wasAddedToCart = false; // Reset Status
    }
    
    console.log(`🗑️ Removed from Cart: ${productName.substring(0, 30)}...`, {
      productType,
      journeyId: this.currentJourney.journeyId
    });
    
    // Track zu GA4
    analyticsService.trackEvent({
      event_name: 'remove_from_cart',
      event_category: 'conversion',
      product_id: productId,
      product_name: productName,
      product_type: productType,
      journey_id: this.currentJourney.journeyId,
      discovery_method: this.currentJourney.discoveryMethod
    }, userId);
  }

  /**
   * Behandelt App-Background-Event (kritisch für Abbruch-Tracking)
   */
  onAppBackground(userId?: string): void {
    if (this.currentJourney && this.currentJourney.filterMetrics?.totalActiveFilters > 0) {
      // Starte 5-Minuten Timer für Background-Abbruch
      this.backgroundTimeout = setTimeout(() => {
        this.trackJourneyAbandonment('app_backgrounded', {
          backgroundDurationMs: 5 * 60 * 1000,
          activeFiltersCount: this.currentJourney?.filterMetrics?.totalActiveFilters,
          productsViewedCount: this.currentJourney?.viewedProducts.length
        }, userId);
      }, 5 * 60 * 1000); // 5 Minuten
    }
  }

  /**
   * Behandelt App-Foreground-Event
   */
  onAppForeground(): void {
    if (this.backgroundTimeout) {
      clearTimeout(this.backgroundTimeout);
      this.backgroundTimeout = null;
      console.log('📱 App returned to foreground - background timeout cleared');
    }
  }

  /**
   * Spezielle Abbruch-Methoden für verschiedene Szenarien
   */
  trackFilterCleared(userId?: string): void {
    if (this.currentJourney && this.currentJourney.filterMetrics?.totalActiveFilters > 0) {
      this.trackJourneyAbandonment('filters_cleared', {
        previousFilterComplexity: this.currentJourney.filterMetrics.complexity,
        previousFilterCount: this.currentJourney.filterMetrics.totalActiveFilters,
        filterChangesBeforeClear: this.currentJourney.filterMetrics.filterChangesCount
      }, userId);
    }
  }

  trackNoResultsFound(searchQuery?: string, activeFilters?: any, userId?: string): void {
    if (this.currentJourney) {
      this.trackJourneyAbandonment('no_results', {
        searchQuery,
        activeFilters,
        filterComplexity: this.currentJourney.filterMetrics?.complexity
      }, userId);
    }
  }

  trackTabSwitched(fromTab: string, toTab: string, userId?: string): void {
    if (this.currentJourney && this.currentJourney.filterMetrics?.totalActiveFilters > 0) {
      this.trackJourneyAbandonment('tab_switched', {
        fromTab,
        toTab,
        activeFiltersLost: this.currentJourney.filterMetrics.totalActiveFilters
      }, userId);
    }
  }

  /**
   * Prüft ob aktuelle Filter zu komplex sind (Überforderung)
   */
  checkFilterComplexityOverload(userId?: string): void {
    if (this.currentJourney?.filterMetrics?.complexity > 8 && 
        this.currentJourney.viewedProducts.length === 0 &&
        this.currentJourney.filterMetrics.filterChangesCount > 5) {
      
      this.trackJourneyAbandonment('too_complex', {
        finalComplexity: this.currentJourney.filterMetrics.complexity,
        filterChanges: this.currentJourney.filterMetrics.filterChangesCount,
        timeSpentMs: Date.now() - this.currentJourney.startTime
      }, userId);
    }
  }
}

export default JourneyTrackingService.getInstance();
