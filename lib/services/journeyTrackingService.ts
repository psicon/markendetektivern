import { db } from '@/lib/firebase';
import { addDoc, collection, doc, DocumentReference, serverTimestamp, updateDoc } from 'firebase/firestore';
import { analyticsService } from './analyticsService';
import { AnonymousLocationService } from './anonymousLocationService';

export interface JourneyContext {
  journeyId: string;
  startTime: number;
  
  // Discovery Context
  discoveryMethod: 'search' | 'browse' | 'scan' | 'favorites' | 'repurchase' | 'category' | 'comparison';
  screenName: string;
  
  // NEU: Location-Daten (ohne Permission)
  location?: {
    lat: number;
    lon: number;
    city: string;
    geohash5: string;
    source: 'ip' | 'fallback';
  };
  
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
      method: 'browse' | 'search' | 'scan' | 'category' | 'favorites' | 'repurchase' | 'comparison' | 'conversion_source' | 'conversion_result';
      searchQuery?: string;
      activeFiltersSnapshot?: any; // Filter zum Zeitpunkt der Entdeckung
      comparedWithProducts?: { // Bei Vergleichsansicht
        productId: string;
        productName: string;
        productType: 'brand' | 'noname';
      }[];
      // NEU: Bei Conversion-Result
      fromProductId?: string;
      fromProductName?: string;
      market?: string;
    };
    
    // NEU: Alle Aktionen die mit diesem Produkt passiert sind
    actions?: {
      timestamp: number;
      type: 'viewed' | 'addedToCart' | 'removedFromCart' | 'addedToFavorites' | 
        'removedFromFavorites' | 'purchased' | 'converted' | 'compared' | 'converted_from';
      
      // Produkt-Details (nur bei Cross-Product Actions wie Conversion)
      productId?: string;
      productName?: string;
      productType?: 'brand' | 'noname';
      productRef?: DocumentReference;
      
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
      motivation?: {
        primary: 'price' | 'brand' | 'content' | 'savings' | 'exploration';
        confidence: number; // 0-1: Wie sicher sind wir?
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
      marketId?: string;
      fromProductPrice?: number;
      toProductPrice?: number;
      // Für View-Actions
      viewDuration?: number; // Sekunden auf der Produktseite
    }[];
    
    // ENTFERNT: finalStatus - kann aus actions[] abgeleitet werden
    
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
  
  // ENTFERNT: Alte Arrays - alles ist jetzt in viewedProducts[].actions
  
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
  
  // NEU: Tracking für gescannte Codes
  scannedcodes?: Array<{
    ean: string;
    timestamp: number;
    hasResult: boolean;
    productType?: 'brand' | 'noname'; // nur wenn hasResult true
    productId?: string; // nur wenn hasResult true
    productName?: string; // nur wenn hasResult true
  }>;
  
  // NEU: Tracking für Suchbegriffe
  searchedproducts?: Array<{
    searchQuery: string;
    timestamp: number;
    resultCount?: number;
  }>;
}

class JourneyTrackingService {
  private static instance: JourneyTrackingService;
  private currentJourney: JourneyContext | null = null;
  private journeyTimeout: NodeJS.Timeout | null = null;
  private backgroundTimeout: NodeJS.Timeout | null = null;
  private readonly JOURNEY_SESSION_KEY = 'active_journey_id';
  private isLoadingJourney: boolean = false; // NEU: Verhindert Race Conditions

  static getInstance(): JourneyTrackingService {
    if (!JourneyTrackingService.instance) {
      JourneyTrackingService.instance = new JourneyTrackingService();
    }
    return JourneyTrackingService.instance;
  }

  /**
   * Entfernt rekursiv alle undefined-Werte aus einem Objekt/Array.
   * - Bewahrt null (ist in Firestore erlaubt)
   * - Belässt Firestore FieldValues (z.B. serverTimestamp()) unverändert
   * - Belässt DocumentReference-Objekte unverändert
   */
  private removeUndefinedValues(obj: any): any {
    if (obj === undefined) return null;
    if (obj === null) return null;

    // Firestore FieldValue (z.B. serverTimestamp): heuristisch erkennen
    if (typeof obj === 'object' && obj !== null) {
      const protoName = Object.prototype.toString.call(obj);
      // Date unverändert lassen
      if (obj instanceof Date) return obj;
      // DocumentReference unverändert lassen (hat id/path Eigenschaften oft)
      if ((obj as any).path || (obj as any).id && (obj as any).type === 'document') return obj;
      // Firebase FieldValue wird meist als object mit internen Symbolen repräsentiert → nicht anfassen
      if (protoName.includes('FieldValue')) return obj;
    }

    if (Array.isArray(obj)) {
      return obj
        .filter((item) => item !== undefined)
        .map((item) => this.removeUndefinedValues(item));
    }

    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          cleaned[key] = this.removeUndefinedValues(value);
        }
      }
      return cleaned;
    }

    return obj;
  }

  /**
   * Gibt die aktuelle Journey-ID zurück (für Verknüpfung mit Produkten)
   */
  getCurrentJourneyId(): string | null {
    return this.currentJourney?.journeyId || null;
  }

  /**
   * Holt den Index eines Produkts in viewedProducts (für eindeutige Zuordnung)
   * NACH einer Add-to-Cart Action
   */
  getViewedProductIndexAfterAction(productId: string): number | null {
    if (!this.currentJourney?.viewedProducts) return null;
    
    // Finde den LETZTEN Index (neueste Interaktion) mit addedToCart Action
    for (let i = this.currentJourney.viewedProducts.length - 1; i >= 0; i--) {
      const product = this.currentJourney.viewedProducts[i];
      if (product.productId === productId && 
          product.actions?.some(a => a.type === 'addedToCart')) {
        return i;
      }
    }
    
    return null;
  }

  /**
   * Updated nur den Status einer Journey in Firestore
   */
  private async updateJourneyStatus(status: string, userId: string): Promise<void> {
    if (!this.currentJourney || !this.currentJourney.firestoreDocId) return;
    
    try {
      const { doc, updateDoc, serverTimestamp, collection } = await import('firebase/firestore');
      const userJourneysRef = collection(db, 'users', userId, 'journeys');
      const docRef = doc(userJourneysRef, this.currentJourney.firestoreDocId);
      
      await updateDoc(docRef, {
        status: status,
        lastUpdated: serverTimestamp()
      });
      
      console.log(`📝 Journey Status updated to: ${status}`);
    } catch (error) {
      console.error('❌ Error updating journey status:', error);
    }
  }

  /**
   * Fügt Location-Daten zur aktuellen Journey hinzu (asynchron)
   */
  private async addLocationToJourney(userId?: string): Promise<void> {
    if (!this.currentJourney) return;

    try {
      const location = await AnonymousLocationService.getLocation();
      
      if (location) {
        this.currentJourney.location = location;
        
        console.log(`📍 Location: ${location.city} (${location.geohash5}) via ${location.source}`);

        // Persistiere Journey-Update mit Location
        if (userId) {
          this.persistJourneyToFirestore(userId);
        }
      } else {
        console.log('📍 No location available for journey');
      }
    } catch (error) {
      console.error('❌ Error adding location to journey:', error);
      // Fehler wird ignoriert - Journey funktioniert auch ohne Location
    }
  }

  // ENTFERNT: updateOriginalJourney - alles wird direkt in viewedProducts[].actions getrackt

  /**
   * Lädt aktive Journey aus Firestore (für Session-Fortsetzung)
   */
  async loadActiveJourney(userId: string): Promise<void> {
    // Verhindere Race Conditions
    if (this.isLoadingJourney) {
      console.log('⏳ Journey wird bereits geladen - überspringe');
      return;
    }
    
    this.isLoadingJourney = true;
    
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
          converted: data.converted || [], // NEU: Lade converted Array
          location: data.location, // NEU: Location-Daten laden
          abandoned: data.abandoned,
          persistedToFirestore: true,
          firestoreDocId: journeyDoc.id
        };
        
        // Stelle sicher, dass alle Arrays initialisiert sind (für ältere Journeys)
        if (!this.currentJourney.viewedProducts) this.currentJourney.viewedProducts = [];
        if (!this.currentJourney.converted) this.currentJourney.converted = [];
        if (!this.currentJourney.filterHistory) this.currentJourney.filterHistory = [];
        
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
    } finally {
      this.isLoadingJourney = false;
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
      activeFilters: (() => {
        // Entferne undefined values aus activeFilters
        const clean: any = {};
        if (activeFilters) {
          Object.keys(activeFilters).forEach(key => {
            if (activeFilters[key] !== undefined) {
              clean[key] = activeFilters[key];
            }
          });
        }
        return clean;
      })(),
      viewedProducts: [],
      converted: [] // NEU: Initialisiere converted Array
    };

    // NEU: Location asynchron hinzufügen (non-blocking)
    this.addLocationToJourney(userId);

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
    }, 120 * 60 * 1000); // 2 Stunden statt 30 Minuten
    
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

    // WICHTIG: Entferne undefined values aus filters
    const cleanFilters: any = {};
    if (filters) {
      Object.keys(filters).forEach(key => {
        if (filters[key] !== undefined) {
          cleanFilters[key] = filters[key];
        }
      });
    }
    this.currentJourney.activeFilters = cleanFilters;
    
    // Debug: Zeige was in activeFilters gespeichert wird
    console.log('🔍 DEBUG updateFilters - activeFilters gesetzt:', {
      keys: Object.keys(cleanFilters),
      hasNutritionDetails: !!cleanFilters.nutritionDetails,
      nutritionDetails: cleanFilters.nutritionDetails
    });
    
    // Berechne Filter-Metriken
    this.currentJourney.filterMetrics = this.calculateFilterMetrics(filters);
    this.currentJourney.filterMetrics.filterChangesCount++;
    
    // Füge zu Filter-Historie hinzu
    if (filterChange) {
      if (!this.currentJourney.filterHistory) {
        this.currentJourney.filterHistory = [];
      }
      this.currentJourney.filterHistory.push({
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
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

    // IMMER neuen Eintrag erstellen - jeder View ist ein separater Eintrag
    // Dies ermöglicht es, das gleiche Produkt mehrmals in einer Journey zu tracken
      const newProduct: any = {
        productId,
        productType,
        productName,
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
        fromScreen: this.currentJourney!.screenName,
        discoveryContext: {
          method: this.currentJourney!.discoveryMethod
        },
        actions: [{
          timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
          type: 'viewed' as const,
          // NEU: Produkt-Details direkt in der Action
          productId: productId,
          productName: productName,
          productType: productType,
          productRef: doc(db, productType === 'brand' ? 'markenProdukte' : 'produkte', productId),
          fromScreen: this.currentJourney!.screenName,
          fromFilters: JSON.parse(JSON.stringify(this.currentJourney!.activeFilters || {})),
          motivation: this.calculateActionMotivation({ type: 'viewed' }, this.currentJourney!.activeFilters)
        }],
        // finalStatus wird aus actions[] abgeleitet
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
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
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
        motivation: this.calculateActionMotivation({
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
  ): number | null {
    if (!this.currentJourney) {
      console.warn('⚠️ Add-to-Cart ohne aktive Journey!');
      // Starte Fallback-Journey für isolierte Add-to-Cart Actions
      this.startJourney('browse', 'unknown', undefined, userId);
      if (!this.currentJourney) return null;
    }

    // ENTFERNT: Alte addedToCart Array - alles ist jetzt in viewedProducts[].actions
    
    // NEU: Update auch viewedProducts mit der Aktion
    let viewedProduct = this.currentJourney.viewedProducts.find(p => p.productId === productId);
    
    // Wenn Produkt noch nicht viewed wurde, füge es jetzt hinzu
    if (!viewedProduct) {
      viewedProduct = {
        productId,
        productType: (isMarke ? 'brand' : 'noname') as 'brand' | 'noname',
        productName,
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
        fromScreen: this.currentJourney.screenName,
        discoveryContext: {
          method: this.currentJourney.discoveryMethod,
          ...(this.currentJourney.activeFilters?.searchQuery && { searchQuery: this.currentJourney.activeFilters.searchQuery }),
          activeFiltersSnapshot: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {}))
        },
        actions: [],
        // finalStatus wird aus actions[] abgeleitet
      };
      this.currentJourney.viewedProducts.push(viewedProduct);
    }
    
    // Füge die AddToCart Aktion hinzu
    if (!viewedProduct.actions) viewedProduct.actions = [];
    const action: any = {
          timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
      type: 'addedToCart',
      // NEU: Produkt-Details direkt in der Action
      productId: productId,
      productName: productName,
      productType: isMarke ? 'brand' : 'noname',
      productRef: doc(db, isMarke ? 'markenProdukte' : 'produkte', productId),
      fromFilters: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {})),
      price: priceInfo?.price,
      savings: priceInfo?.savings,
      comparedProducts: priceInfo?.comparedProducts,
      motivation: this.calculateActionMotivation({
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
    // finalStatus wird aus actions[] abgeleitet

    console.log(`🛒 Add-to-Cart mit Journey: ${productName.substring(0, 30)}...`, {
      discoveryMethod: this.currentJourney.discoveryMethod,
      activeFilters: this.currentJourney.activeFilters,
      totalInCart: this.currentJourney.viewedProducts.reduce((count, p) => 
        count + (this.getFinalStatusFromActions(p.actions).wasAddedToCart ? 1 : 0), 0),
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
        products_in_cart: this.currentJourney.viewedProducts.reduce((count, p) => 
          count + (this.getFinalStatusFromActions(p.actions).wasAddedToCart ? 1 : 0), 0),
        journey_duration_ms: Date.now() - this.currentJourney.startTime,
        screen_name: this.currentJourney.screenName
      }
    );

    // Persistiere Journey Update
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }
    
    // WICHTIG: Return den Index für Einkaufszettel-Speicherung
    const productIndex = this.currentJourney.viewedProducts.findIndex(p => 
      p.productId === productId && p.actions?.some(a => a.type === 'addedToCart')
    );
    
    return productIndex >= 0 ? productIndex : null;
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
    // ENTFERNT: Alte addedToFavorites Array - alles ist jetzt in viewedProducts[].actions
    
    // NEU: Update auch viewedProducts mit der Aktion
    let viewedProduct = this.currentJourney.viewedProducts.find(p => p.productId === productId);
    
    // Wenn Produkt noch nicht viewed wurde, füge es jetzt hinzu
    if (!viewedProduct) {
      viewedProduct = {
        productId,
        productType,
        productName,
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
        fromScreen: this.currentJourney.screenName,
        discoveryContext: {
          method: this.currentJourney.discoveryMethod,
          ...(this.currentJourney.activeFilters?.searchQuery && { searchQuery: this.currentJourney.activeFilters.searchQuery }),
          activeFiltersSnapshot: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {}))
        },
        actions: [],
        // finalStatus wird aus actions[] abgeleitet
      };
      this.currentJourney.viewedProducts.push(viewedProduct);
    }
    
    // Füge die AddToFavorites Aktion hinzu
    if (!viewedProduct.actions) viewedProduct.actions = [];
    const action: any = {
          timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
      type: 'addedToFavorites',
      // NEU: Produkt-Details direkt in der Action
      productId: productId,
      productName: productName,
      productType: productType,
      productRef: doc(db, productType === 'brand' ? 'markenProdukte' : 'produkte', productId),
      fromFilters: JSON.parse(JSON.stringify(this.currentJourney.activeFilters || {})),
      price: priceInfo?.price,
      savings: priceInfo?.savings,
      motivation: this.calculateActionMotivation({
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
    // finalStatus wird aus actions[] abgeleitet

    console.log(`❤️ Add-to-Favorites mit Journey: ${productName.substring(0, 30)}...`, {
      discoveryMethod: this.currentJourney.discoveryMethod,
      activeFilters: this.currentJourney.activeFilters,
      totalFavorites: this.currentJourney.viewedProducts.reduce((count, p) => 
        count + (this.getFinalStatusFromActions(p.actions).wasAddedToFavorites ? 1 : 0), 0)
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

    // ENTFERNT: Alte purchased Object - alles ist jetzt in viewedProducts[].actions
    
    // NEU: Update viewedProducts mit der Purchase-Aktion (ROBUST)
    products.forEach(product => {
      let viewedProduct = this.currentJourney!.viewedProducts.find(p => p.productId === product.productId);
      
      // Falls Produkt noch nicht in viewedProducts, füge es hinzu
      if (!viewedProduct) {
        viewedProduct = {
          productId: product.productId,
          productName: product.productName,
          productType: product.productType,
          timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
          discoveryContext: {
            method: 'repurchase' // Aus Einkaufszettel
          },
          actions: []
        };
        this.currentJourney!.viewedProducts.push(viewedProduct);
      }
      
      if (!viewedProduct.actions) viewedProduct.actions = [];
      viewedProduct.actions.push({
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
        type: 'purchased',
        productId: product.productId,
        productName: product.productName,
        productType: product.productType,
        productRef: doc(db, product.productType === 'brand' ? 'markenProdukte' : 'produkte', product.productId),
        price: product.finalPrice,
        savings: product.finalSavings,
        motivation: this.calculateActionMotivation({
          type: 'purchased',
          price: product.finalPrice,
          savings: product.finalSavings
        }, this.currentJourney!.activeFilters)
      });
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

    // ENTFERNT: Journey sollte NICHT nach Purchase beendet werden!
    // User kann weiter einkaufen, umwandeln, etc.
    // this.completeJourney('purchase');
  }


  /**
   * Berechnet finalStatus aus actions[] (ersetzt das redundante finalStatus Feld)
   */
  private getFinalStatusFromActions(actions?: any[]): {
    wasAddedToCart: boolean;
    wasAddedToFavorites: boolean;
    wasPurchased: boolean;
    wasConverted: boolean;
    wasRemovedFromCart: boolean;
    totalInteractions: number;
  } {
    if (!actions || actions.length === 0) {
      return {
        wasAddedToCart: false,
        wasAddedToFavorites: false,
        wasPurchased: false,
        wasConverted: false,
        wasRemovedFromCart: false,
        totalInteractions: 0
      };
    }

    return {
      wasAddedToCart: actions.some(a => a.type === 'addedToCart'),
      wasAddedToFavorites: actions.some(a => a.type === 'addedToFavorites'),
      wasPurchased: actions.some(a => a.type === 'purchased'),
      wasConverted: actions.some(a => a.type === 'converted'),
      wasRemovedFromCart: actions.some(a => a.type === 'removedFromCart'),
      totalInteractions: actions.length
    };
  }

  /**
   * Berechnet vereinfachte Motivation für eine spezifische Action
   */
  private calculateActionMotivation(
    action: { type: string; price?: number; savings?: number; comparedProducts?: any[] },
    filters?: JourneyContext['activeFilters']
  ): { primary: string; confidence: number } {
    
    // Nur bei wichtigen Actions berechnen
    if (!['addedToCart', 'purchased', 'converted'].includes(action.type)) {
      return { primary: 'exploration', confidence: 0.5 };
    }

    let scores = {
      price: 0,
      savings: 0,
      content: 0,
      brand: 0
    };

    // Preis-Signale
    if (filters?.sortBy === 'price') scores.price += 0.5;
    if (action.savings && action.savings > 1) scores.savings += 0.8;
    
    // Content-Signale (Allergene, Nährwerte)
    if (filters?.allergens && Object.keys(filters.allergens).length > 0) scores.content += 0.7;
    if (filters?.nutrition && Object.keys(filters.nutrition).length > 0) scores.content += 0.3;
    
    // Brand-Signale
    if (filters?.searchQuery) {
       const brandKeywords = ['milka', 'nutella', 'coca', 'haribo', 'ferrero'];
      if (brandKeywords.some(brand => filters.searchQuery!.toLowerCase().includes(brand))) {
        scores.brand += 0.8;
      }
    }

    // Finde höchsten Score
    const maxScore = Math.max(scores.price, scores.savings, scores.content, scores.brand);
    if (maxScore === 0) return { primary: 'exploration', confidence: 0.3 };

    const primary = Object.keys(scores).find(key => scores[key as keyof typeof scores] === maxScore) as string;
    return {
      primary: primary === 'price' || primary === 'savings' ? 'price' : primary,
      confidence: Math.min(maxScore, 1)
    };
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
    
    // WICHTIG: Prüfe ob noch Produkte im Einkaufszettel sind
    const hasItemsInCart = this.currentJourney.viewedProducts.some(p => {
      const status = this.getFinalStatusFromActions(p.actions);
      return status.wasAddedToCart && !status.wasPurchased && !status.wasRemovedFromCart;
    });
    
    // Wenn Timeout UND noch Produkte im Einkaufszettel → Journey NICHT beenden!
    if (reason === 'timeout' && hasItemsInCart) {
      console.log(`⏸️ Journey Timeout ABER ${this.currentJourney.viewedProducts.filter(p => {
        const status = this.getFinalStatusFromActions(p.actions);
        return status.wasAddedToCart && !status.wasPurchased && !status.wasRemovedFromCart;
      }).length} Produkte noch im Einkaufszettel - Journey bleibt aktiv!`);
      
      // Restart Timeout für weitere 2 Stunden
      if (this.journeyTimeout) {
        clearTimeout(this.journeyTimeout);
      }
      this.journeyTimeout = setTimeout(() => {
        this.completeJourney('timeout', userId);
      }, 120 * 60 * 1000); // Weitere 2 Stunden
      
      // Journey als "inactive_with_cart" markieren aber NICHT beenden
      if (userId) {
        this.updateJourneyStatus('inactive_with_cart', userId);
      }
      return; // WICHTIG: Hier abbrechen, Journey nicht beenden!
    }
    
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
      addedToCart: this.currentJourney.viewedProducts.some(p => this.getFinalStatusFromActions(p.actions).wasAddedToCart),
      addedToFavorites: this.currentJourney.viewedProducts.some(p => this.getFinalStatusFromActions(p.actions).wasAddedToFavorites),
      purchased: this.currentJourney.viewedProducts.some(p => this.getFinalStatusFromActions(p.actions).wasPurchased),
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
          timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
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
        
        // NEU: Location-Daten (nur wenn vorhanden)
        ...(journey.location && { location: journey.location }),
        
        // Filter Context
        activeFilters: cleanActiveFilters,
        filterMetrics: journey.filterMetrics || {},
        filterHistory: (journey.filterHistory || []).map(hist => ({
          timestamp: hist.timestamp || Date.now(),
          action: hist.action || 'added',
          filterType: hist.filterType || '',
          filterValue: hist.filterValue || '',
          filtersSnapshot: hist.filtersSnapshot || {}
        })),
        
        // Product Interactions - Clean undefined values
        viewedProducts: (journey.viewedProducts || []).map(product => {
          const cleanProduct: any = {
            productId: product.productId,
            productType: product.productType,
            productName: product.productName,
            timestamp: product.timestamp,
            fromScreen: product.fromScreen,
            discoveryContext: (() => {
              const dc: any = {
                method: product.discoveryContext?.method || 'browse'
              };
              
              // NUR hinzufügen wenn WIRKLICH definiert (nicht undefined)
              if (product.discoveryContext?.searchQuery !== undefined && product.discoveryContext?.searchQuery !== null) {
                dc.searchQuery = product.discoveryContext.searchQuery;
              }
              if (product.discoveryContext?.activeFiltersSnapshot !== undefined && product.discoveryContext?.activeFiltersSnapshot !== null) {
                dc.activeFiltersSnapshot = product.discoveryContext.activeFiltersSnapshot;
              }
              if (product.discoveryContext?.comparedWithProducts !== undefined && product.discoveryContext?.comparedWithProducts !== null) {
                dc.comparedWithProducts = product.discoveryContext.comparedWithProducts;
              }
              if (product.discoveryContext?.fromProductId !== undefined && product.discoveryContext?.fromProductId !== null) {
                dc.fromProductId = product.discoveryContext.fromProductId;
              }
              if (product.discoveryContext?.fromProductName !== undefined && product.discoveryContext?.fromProductName !== null) {
                dc.fromProductName = product.discoveryContext.fromProductName;
              }
              if (product.discoveryContext?.market !== undefined && product.discoveryContext?.market !== null) {
                dc.market = product.discoveryContext.market;
              }
              
              return dc;
            })()
          };
          
          // Optional fields - nur wenn definiert und nicht null
          if (product.position !== undefined && product.position !== null) {
            cleanProduct.position = product.position;
          }
          
          // Clean actions array - ONLY ESSENTIAL FIELDS!
          if (product.actions && product.actions.length > 0) {
            cleanProduct.actions = product.actions.map(action => {
              const cleanAction: any = {
                timestamp: action.timestamp || Date.now(),
                type: action.type || 'viewed'
              };
              
              // ONLY add fields that are NOT undefined
              const safeFields = ['productId', 'productName', 'productType', 'fromScreen', 'price', 'savings', 'market'];
              safeFields.forEach(field => {
                if (action[field] !== undefined && action[field] !== null) {
                  cleanAction[field] = action[field];
                }
              });
              
              // Handle motivation safely
              if (action.motivation && typeof action.motivation === 'object') {
                cleanAction.motivation = {
                  primary: action.motivation.primary || 'exploration',
                  confidence: action.motivation.confidence || 0.5
                };
              }
              
              // Handle DocumentReference fields safely
              if (action.productRef && typeof action.productRef === 'object') {
                cleanAction.productRef = action.productRef;
              }
              
              return cleanAction;
            });
          }
          
          // ENTFERNT: finalStatus wird aus actions[] abgeleitet
          
          // NEU: Comparison Result
          if (product.comparisonResult) {
            cleanProduct.comparisonResult = product.comparisonResult;
          }
          
          return cleanProduct;
        }),
        viewedProductsCount: journey.viewedProducts.length,
        
      // ENTFERNT: Alte Arrays - alles ist jetzt in viewedProducts[].actions
        
        // Converted (Markenprodukt zu NoName)
        converted: (journey.converted || []).map(conv => ({
          timestamp: conv.timestamp,
          products: (conv.products || []).map(prod => ({
            fromProductId: prod.fromProductId || '',
            fromProductName: prod.fromProductName || '',
            fromProductPrice: prod.fromProductPrice || 0,
            toProductId: prod.toProductId || '',
            toProductName: prod.toProductName || '',
            toProductPrice: prod.toProductPrice || 0,
            savings: prod.savings || 0,
            market: prod.market || '',
            marketId: typeof prod.marketId === 'string' ? prod.marketId : (prod.marketId?.id || '')
          })),
          totalSavings: conv.totalSavings || 0,
          fromFilters: conv.fromFilters || {}
        })),
        convertedCount: journey.converted?.length || 0,
      // ENTFERNT: Alte addedToFavorites Array
      
      // Motivations-Signale
      motivationSignals: journey.motivationSignals || {
        priceSignals: 0,
        brandSignals: 0,
        contentSignals: 0,
        marketSignals: 0,
        searchTerms: []
      },
        
        // Status
        status: journey.viewedProducts.some(p => this.getFinalStatusFromActions(p.actions).wasPurchased) ? 'purchased' : 
                journey.viewedProducts.some(p => this.getFinalStatusFromActions(p.actions).wasAddedToCart) ? 'in_cart' :
                journey.abandoned ? 'abandoned' : 'active',
                
        // NEU: Scanned codes und Searched products
        ...(journey.scannedcodes && journey.scannedcodes.length > 0 && { 
          scannedcodes: journey.scannedcodes 
        }),
        ...(journey.searchedproducts && journey.searchedproducts.length > 0 && { 
          searchedproducts: journey.searchedproducts 
        })
      };
      
      // Nur hinzufügen wenn nicht null
      if (journey.abandoned) {
        journeyData.abandoned = journey.abandoned;
      }

      const userJourneysRef = collection(db, 'users', userId, 'journeys');

      // Rekursiv alle undefined entfernen
      const cleanedJourneyData = this.removeUndefinedValues(journeyData);

      if (!journey.firestoreDocId) {
        // Neue Journey erstellen
        const docRef = await addDoc(userJourneysRef, cleanedJourneyData);
        
        // Update currentJourney nur wenn sie noch existiert
        if (this.currentJourney && this.currentJourney.journeyId === journey.journeyId) {
          this.currentJourney.firestoreDocId = docRef.id;
          this.currentJourney.persistedToFirestore = true;
        }
        
        console.log(`💾 Journey persisted to Firestore: ${docRef.id}`);
      } else {
        // Bestehende Journey updaten
        const docRef = doc(userJourneysRef, journey.firestoreDocId);
        await updateDoc(docRef, cleanedJourneyData);
        
        console.log(`💾 Journey updated in Firestore: ${journey.firestoreDocId}`);
      }
      
    } catch (error) { 
      console.error('❌ Error persisting journey to Firestore:', error);

    
      
      throw error;
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
        const cleanedFinalData = this.removeUndefinedValues(finalData);
        await updateDoc(docRef, cleanedFinalData);
        
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
    // 2. Timeout (2 Stunden)
    // 3. App wird geschlossen
    
    if (this.currentJourney) {
      // Journey fortsetzen und aktuellen Screen updaten
      console.log(`📱 Journey fortsetzend: ${this.currentJourney.screenName} → ${screenName}`);
      this.currentJourney.screenName = screenName;
      
      // Journey in Firestore updaten
      if (userId) {
        this.persistJourneyToFirestore(userId);
      }
    } else if (!this.isLoadingJourney) {
      // Journey noch nicht geladen UND nicht gerade am Laden - starte neue
      console.log('⏳ Journey noch nicht aktiv - starte neue...');
      this.startJourney('browse', screenName, undefined, userId);
    } else {
      console.log('⏳ Journey wird geladen - warte...');
    }
  }

  /**
   * Trackt das Löschen von Produkten aus dem Einkaufszettel (ROBUSTE VERSION)
   */
  trackRemoveFromCart(
    productId: string,
    productName: string,
    productType: 'brand' | 'noname',
    userId?: string
  ): void {
    if (!this.currentJourney) {
      console.warn('⚠️ Remove-from-Cart ohne aktive Journey - starte neue!');
      this.startJourney('repurchase', 'shopping-list', undefined, userId);
      if (!this.currentJourney) return;
    }

    // NEU: Finde oder erstelle viewedProduct Eintrag
    let viewedProduct = this.currentJourney.viewedProducts.find(p => p.productId === productId);
    
    if (!viewedProduct) {
      // Falls Produkt noch nicht in viewedProducts, füge es hinzu
      viewedProduct = {
        productId,
        productName,
        productType,
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
        discoveryContext: {
          method: 'repurchase', // Aus Einkaufszettel
          fromScreen: 'shopping-list'
        },
        actions: []
      };
      this.currentJourney.viewedProducts.push(viewedProduct);
    }

    if (!viewedProduct.actions) viewedProduct.actions = [];
    viewedProduct.actions.push({
          timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
      type: 'removedFromCart',
      productId: productId,
      productName: productName,
      productType: productType,
      productRef: doc(db, productType === 'brand' ? 'markenProdukte' : 'produkte', productId),
      motivation: this.calculateActionMotivation({
        type: 'removedFromCart'
      }, this.currentJourney.activeFilters)
    });
    
    console.log(`🗑️ Removed from Cart: ${productName.substring(0, 30)}...`, {
      productType,
      journeyDuration: Date.now() - this.currentJourney.startTime
    });

    // Track zu GA4
    analyticsService.trackEvent({
      event_name: 'remove_from_cart',
      user_id: userId,
      product_id: productId,
      product_name: productName,
      product_type: productType
    }, userId);

    // Persistiere zu Firestore
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }
  }

  /**
   * Trackt wenn Markenprodukte zu NoName umgewandelt werden
   */
  trackProductConversion(conversions: any[], productDetails: any[], userId?: string): void {
    if (!userId) {
      console.warn('⚠️ Product-Conversion ohne User!');
      return;
    }
    
    // NEU: Wenn keine Journey aktiv, starte eine neue
    if (!this.currentJourney) {
      console.warn('⚠️ Product-Conversion ohne aktive Journey - starte neue!');
      this.startJourney('repurchase', 'shopping-list', undefined, userId);
      if (!this.currentJourney) return;
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
      
      // NEU: Update viewedProducts mit der Conversion-Aktion (ROBUST)
      let viewedProduct = this.currentJourney!.viewedProducts.find(p => p.productId === fromProductId);
      
      // Falls Produkt noch nicht in viewedProducts, füge es hinzu
      if (!viewedProduct) {
          viewedProduct = {
            productId: fromProductId,
            productName: details?.fromProduct?.name || 'Markenprodukt',
            productType: 'brand',
            timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
            discoveryContext: {
              method: 'conversion_source' // Quelle für Conversion (aus Einkaufszettel)
            },
            actions: []
          };
        this.currentJourney!.viewedProducts.push(viewedProduct);
      }
      
      if (!viewedProduct.actions) viewedProduct.actions = [];
      viewedProduct.actions.push({
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
        type: 'converted',
        productId: fromProductId,
        productName: details?.fromProduct?.name || 'Markenprodukt',
        productType: 'brand', // Conversion ist immer von Marke zu NoName
        productRef: doc(db, 'markenProdukte', fromProductId),
        toProductId: toProductId,
        toProductName: details?.toProduct?.name || 'NoName Produkt',
        toProductRef: doc(db, 'produkte', toProductId),
        market: market,
        marketId: (() => {
          const discounter = details?.toProduct?.discounter;
          if (!discounter) return '';
          if (typeof discounter === 'string') return discounter;
          if (discounter.id) return String(discounter.id);
          if (discounter.name) return String(discounter.name);
          if (discounter.path) return String(discounter.path);
          return '';
        })(),
        fromProductPrice: details?.fromProduct?.preis || 0,
        toProductPrice: details?.toProduct?.preis || 0,
        savings: savings,
        motivation: this.calculateActionMotivation({
          type: 'converted',
          savings: savings
        }, this.currentJourney!.activeFilters)
      });
      
      // NEU: Füge auch das neue NoName Produkt zu viewedProducts hinzu
      // mit klarer Markierung dass es aus einer Conversion stammt
      const convertedProduct = {
        productId: toProductId,
        productName: details?.toProduct?.name || 'NoName Produkt',
        productType: 'noname' as const,
        timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
        fromScreen: this.currentJourney!.screenName, // WICHTIG: fromScreen ist REQUIRED!
        discoveryContext: {
          method: 'conversion_result' as const, // Klare Markierung: Ergebnis einer Conversion
          fromProductId: fromProductId,
          fromProductName: details?.fromProduct?.name || 'Markenprodukt',
          market: market
        },
        actions: [{
          timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
          type: 'converted_from' as const, // Neue Action-Type für konvertierte Produkte
          productId: toProductId,
          productName: details?.toProduct?.name || 'NoName Produkt',
          productType: 'noname' as const,
          productRef: doc(db, 'produkte', toProductId),
          fromProductId: fromProductId,
          fromProductName: details?.fromProduct?.name || 'Markenprodukt',
          fromProductRef: doc(db, 'markenProdukte', fromProductId),
          market: market,
          marketId: (() => {
          const discounter = details?.toProduct?.discounter;
          if (!discounter) return '';
          if (typeof discounter === 'string') return discounter;
          if (discounter.id) return String(discounter.id);
          if (discounter.name) return String(discounter.name);
          if (discounter.path) return String(discounter.path);
          return '';
        })(),
          savings: savings,
          motivation: this.calculateActionMotivation({
            type: 'converted',
            savings: savings
          }, this.currentJourney!.activeFilters)
        }]
      };
      this.currentJourney!.viewedProducts.push(convertedProduct);
      
      return {
        fromProductId: fromProductId,
        fromProductName: details?.fromProduct?.name || 'Markenprodukt',
        fromProductPrice: details?.fromProduct?.preis || 0,
        toProductId: toProductId,
        toProductName: details?.toProduct?.name || 'NoName Produkt',
        toProductPrice: details?.toProduct?.preis || 0,
        savings: savings,
        market: market,
        marketId: (() => {
          const discounter = details?.toProduct?.discounter;
          if (!discounter) return '';
          if (typeof discounter === 'string') return discounter;
          if (discounter.id) return String(discounter.id);
          if (discounter.name) return String(discounter.name);
          if (discounter.path) return String(discounter.path);
          return '';
        })()
      };
    });
    
    const totalSavings = convertedProducts.reduce((sum, p) => sum + p.savings, 0);
    
    // Stelle sicher, dass converted Array existiert (für ältere Journeys)
    if (!this.currentJourney.converted) {
      this.currentJourney.converted = [];
    }
    
    this.currentJourney.converted.push({
          timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
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

  // ENTFERNT: Doppelte Methode - siehe robuste Version oben

  /**
   * NEU: Trackt Purchase in einer SPEZIFISCHEN Journey (aus Einkaufszettel)
   */
  async trackPurchaseInSpecificJourney(
    journeyId: string,
    products: { 
      productId: string; 
      productName: string; 
      productType: 'brand' | 'noname';
      finalPrice?: number;
      finalSavings?: number;
    }[],
    totalSavings: number,
    userId: string
  ): Promise<void> {
    
    try {
      const { query, where, getDocs, updateDoc, collection } = await import('firebase/firestore');
      
      // Finde die spezifische Journey
      const userJourneysRef = collection(db, 'users', userId, 'journeys');
      const q = query(userJourneysRef, where('journeyId', '==', journeyId));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const journeyDoc = snapshot.docs[0];
        const journeyData = journeyDoc.data() as JourneyContext;
        
        // Update viewedProducts mit Purchase Actions
        const updatedViewedProducts = [...(journeyData.viewedProducts || [])];
        
        products.forEach(product => {
          // NEU: Verwende Index wenn verfügbar, sonst Fallback zu find()
          let viewedProduct = null;
          
          if (product.viewedProductIndex !== undefined && product.viewedProductIndex !== null) {
            // DIREKTE Zuordnung via Index!
            viewedProduct = updatedViewedProducts[product.viewedProductIndex];
            console.log(`🎯 Single Purchase using INDEX ${product.viewedProductIndex} for ${product.productName}`);
          } else {
            // Fallback: Suche wie bisher
            viewedProduct = updatedViewedProducts.find(p => p.productId === product.productId);
            console.log(`⚠️ Single Purchase using FIND for ${product.productName} (no index available)`);
          }
          
          if (!viewedProduct) {
            // Produkt war nicht in der Journey - füge es hinzu
            viewedProduct = {
              productId: product.productId,
              productName: product.productName,
              productType: product.productType,
              timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
              discoveryContext: {
                method: 'repurchase',
                fromScreen: 'shopping-list'
              },
              actions: []
            };
            updatedViewedProducts.push(viewedProduct);
          }
          
          if (!viewedProduct.actions) viewedProduct.actions = [];
          // SICHERE Action mit guaranteed Werten
          const safeAction: any = {
            timestamp: Date.now(),
            type: 'purchased'
          };
          
          // NUR definierte Werte hinzufügen
          if (product.productId) safeAction.productId = product.productId;
          if (product.productName) safeAction.productName = product.productName;
          if (product.productType) safeAction.productType = product.productType;
          if (product.finalPrice !== undefined) safeAction.price = product.finalPrice;
          if (product.finalSavings !== undefined) safeAction.savings = product.finalSavings;
          if (product.productId) {
            safeAction.productRef = doc(db, product.productType === 'brand' ? 'markenProdukte' : 'produkte', product.productId);
          }
          safeAction.motivation = { primary: 'price', confidence: 0.8 };
          
          viewedProduct.actions.push(safeAction);
        });
        
        // Update die Journey in Firestore
        await updateDoc(journeyDoc.ref, {
          viewedProducts: updatedViewedProducts,
          lastUpdated: serverTimestamp()
          // ENTFERNT: finalStatus und completedAt - Journey soll weiterlaufen!
        });
        
        console.log(`💰 Purchase in Original Journey ${journeyId} tracked: ${products.length} Produkte`, {
          productIds: products.map(p => p.productId),
          updatedProductsCount: updatedViewedProducts.length,
          actionsAdded: products.length
        });
      } else {
        console.warn(`⚠️ Journey ${journeyId} nicht gefunden - verwende normale trackPurchase`);
        // Fallback zu normaler trackPurchase
        this.trackPurchase(products, totalSavings, userId);
      }
    } catch (error) {
      console.error('❌ Error tracking purchase in specific journey:', error);
      // Fallback zu normaler trackPurchase
      this.trackPurchase(products, totalSavings, userId);
    }
  }

  /**
   * NEU: Trackt BULK Purchase in einer SPEZIFISCHEN Journey (vermeidet Race Conditions)
   */
  async trackBulkPurchaseInSpecificJourney(
    journeyId: string,
    products: {
      productId: string;
      productName: string;
      productType: 'brand' | 'noname';
      finalPrice?: number;
      finalSavings?: number;
      viewedProductIndex?: number; // NEU: Index für eindeutige Zuordnung
    }[],
    totalSavings: number,
    userId: string
  ): Promise<void> {
    try {
      const { query, where, getDocs, updateDoc, collection } = await import('firebase/firestore');
      
      // Finde die spezifische Journey
      const userJourneysRef = collection(db, 'users', userId, 'journeys');
      const q = query(userJourneysRef, where('journeyId', '==', journeyId));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const journeyDoc = snapshot.docs[0];
        const journeyData = journeyDoc.data() as JourneyContext;
        
        // Update alle Produkte in EINER Operation
        const updatedViewedProducts = [...(journeyData.viewedProducts || [])];
        
        console.log(`🔍 DEBUG Bulk Purchase - Ursprüngliche viewedProducts:`, {
          totalProducts: updatedViewedProducts.length,
          productIds: updatedViewedProducts.map(p => p.productId),
          actionsPerProduct: updatedViewedProducts.map(p => ({
            id: p.productId,
            actionsCount: p.actions?.length || 0,
            actions: p.actions?.map(a => a.type) || []
          }))
        });
        
        products.forEach(product => {
          // NEU: Verwende Index wenn verfügbar, sonst Fallback zu find()
          let viewedProduct = null;
          
          if (product.viewedProductIndex !== undefined && product.viewedProductIndex !== null) {
            // DIREKTE Zuordnung via Index!
            viewedProduct = updatedViewedProducts[product.viewedProductIndex];
            console.log(`🎯 Using INDEX ${product.viewedProductIndex} for ${product.productName}`);
          } else {
            // Fallback: Suche wie bisher
            viewedProduct = updatedViewedProducts.find(p => p.productId === product.productId);
            console.log(`⚠️ Using FIND for ${product.productName} (no index available)`);
          }
          
          console.log(`🔍 DEBUG Bulk Purchase für ${product.productName}:`, {
            productId: product.productId,
            useIndex: product.viewedProductIndex,
            foundExisting: !!viewedProduct,
            existingActionsCount: viewedProduct?.actions?.length || 0,
            existingActions: viewedProduct?.actions?.map(a => a.type) || []
          });
          
          if (!viewedProduct) {
            // Produkt war nicht in der Journey - füge es hinzu
            viewedProduct = {
              productId: product.productId,
              productName: product.productName,
              productType: product.productType,
              timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
              discoveryContext: {
                method: 'repurchase',
                fromScreen: 'shopping-list'
              },
              actions: []
            };
            updatedViewedProducts.push(viewedProduct);
          }
          
          if (!viewedProduct.actions) viewedProduct.actions = [];
          
          console.log(`🔍 BEFORE adding purchased action:`, {
            actionsCount: viewedProduct.actions.length,
            actions: viewedProduct.actions.map(a => a.type)
          });
          
          // SICHERE Action mit guaranteed Werten
          const safeAction: any = {
            timestamp: Date.now(),
            type: 'purchased'
          };
          
          // NUR definierte Werte hinzufügen
          if (product.productId) safeAction.productId = product.productId;
          if (product.productName) safeAction.productName = product.productName;
          if (product.productType) safeAction.productType = product.productType;
          if (product.finalPrice !== undefined) safeAction.price = product.finalPrice;
          if (product.finalSavings !== undefined) safeAction.savings = product.finalSavings;
          if (product.productId) {
            safeAction.productRef = doc(db, product.productType === 'brand' ? 'markenProdukte' : 'produkte', product.productId);
          }
          safeAction.motivation = { primary: 'price', confidence: 0.8 };
          
          viewedProduct.actions.push(safeAction);
          
          console.log(`🔍 AFTER adding purchased action:`, {
            actionsCount: viewedProduct.actions.length,
            actions: viewedProduct.actions.map(a => a.type),
            lastAction: viewedProduct.actions[viewedProduct.actions.length - 1]?.type
          });
        });
        
        console.log(`🔍 DEBUG Final updatedViewedProducts vor Firestore:`, {
          totalProducts: updatedViewedProducts.length,
          actionsPerProduct: updatedViewedProducts.map(p => ({
            id: p.productId,
            actionsCount: p.actions?.length || 0,
            actions: p.actions?.map(a => a.type) || []
          }))
        });
        
        // EINE Update-Operation für alle Produkte
        await updateDoc(journeyDoc.ref, {
          viewedProducts: updatedViewedProducts,
          lastUpdated: serverTimestamp()
        });
        
        console.log(`💰 BULK Purchase in Original Journey ${journeyId} tracked: ${products.length} Produkte`, {
          productIds: products.map(p => p.productId),
          updatedProductsCount: updatedViewedProducts.length,
          actionsAdded: products.length
        });
      } else {
        console.warn(`⚠️ Journey ${journeyId} nicht gefunden - verwende normale trackPurchase`);
        this.trackPurchase(products, totalSavings, userId);
      }
    } catch (error) {
      console.error('❌ Error tracking bulk purchase in specific journey:', error);
      this.trackPurchase(products, totalSavings, userId);
    }
  }

  /**
   * NEU: Trackt Remove in einer SPEZIFISCHEN Journey (aus Einkaufszettel)
   */
  async trackRemoveInSpecificJourney(
    journeyId: string,
    productId: string,
    productName: string,
    productType: 'brand' | 'noname',
    userId: string,
    viewedProductIndex?: number // NEU: Index für eindeutige Zuordnung
  ): Promise<void> {
    try {
      const { query, where, getDocs, updateDoc, collection } = await import('firebase/firestore');
      
      // Finde die spezifische Journey
      const userJourneysRef = collection(db, 'users', userId, 'journeys');
      const q = query(userJourneysRef, where('journeyId', '==', journeyId));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        const journeyDoc = snapshot.docs[0];
        const journeyData = journeyDoc.data() as JourneyContext;
        
        // Update viewedProducts mit Remove Action
        const updatedViewedProducts = [...(journeyData.viewedProducts || [])];
        
        // NEU: Verwende Index wenn verfügbar, sonst Fallback zu find()
        let viewedProduct = null;
        
        if (viewedProductIndex !== undefined && viewedProductIndex !== null) {
          // DIREKTE Zuordnung via Index!
          viewedProduct = updatedViewedProducts[viewedProductIndex];
          console.log(`🎯 Remove using INDEX ${viewedProductIndex} for ${productName}`);
        } else {
          // Fallback: Suche wie bisher
          viewedProduct = updatedViewedProducts.find(p => p.productId === productId);
          console.log(`⚠️ Remove using FIND for ${productName} (no index available)`);
        }
        
        if (!viewedProduct) {
          // Produkt war nicht in der Journey - füge es hinzu
          viewedProduct = {
            productId,
            productName,
            productType,
            timestamp: Date.now(), // Arrays unterstützen kein serverTimestamp()
            discoveryContext: {
              method: 'repurchase',
              fromScreen: 'shopping-list'
            },
            actions: []
          };
          updatedViewedProducts.push(viewedProduct);
        }
        
        if (!viewedProduct.actions) viewedProduct.actions = [];
        // SICHERE Action mit guaranteed Werten
        const safeAction: any = {
          timestamp: Date.now(),
          type: 'removedFromCart'
        };
        
        // NUR definierte Werte hinzufügen
        if (productId) safeAction.productId = productId;
        if (productName) safeAction.productName = productName;
        if (productType) safeAction.productType = productType;
        if (productId) {
          safeAction.productRef = doc(db, productType === 'brand' ? 'markenProdukte' : 'produkte', productId);
        }
        safeAction.motivation = { primary: 'exploration', confidence: 0.5 };
        
        viewedProduct.actions.push(safeAction);
        
        // Update die Journey in Firestore
        await updateDoc(journeyDoc.ref, {
          viewedProducts: updatedViewedProducts,
          lastUpdated: serverTimestamp()
        });
        
        console.log(`🗑️ Remove from Cart in Original Journey ${journeyId} tracked: ${productName}`, {
          productId,
          productType,
          actionsAdded: 1,
          updatedProductsCount: updatedViewedProducts.length
        });
      } else {
        console.warn(`⚠️ Journey ${journeyId} nicht gefunden - verwende normale trackRemoveFromCart`);
        // Fallback zu normaler trackRemoveFromCart
        this.trackRemoveFromCart(productId, productName, productType, userId);
      }
    } catch (error) {
      console.error('❌ Error tracking remove in specific journey:', error);
      // Fallback zu normaler trackRemoveFromCart
      this.trackRemoveFromCart(productId, productName, productType, userId);
    }
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

  /**
   * Trackt einen gescannten Code (mit oder ohne Treffer)
   */
  trackScannedCode(
    ean: string,
    hasResult: boolean,
    productInfo?: {
      productId: string;
      productName: string;
      productType: 'brand' | 'noname';
    },
    userId?: string
  ): void {
    if (!this.currentJourney) {
      // Starte neue Journey falls keine aktiv
      this.startJourney('scan', 'barcode-scanner', undefined, userId);
      if (!this.currentJourney) return;
    }

    // Initialisiere scannedcodes Array wenn nicht vorhanden
    if (!this.currentJourney.scannedcodes) {
      this.currentJourney.scannedcodes = [];
    }

    // Füge gescannten Code hinzu
    const scanEntry: any = {
      ean,
      timestamp: Date.now(),
      hasResult
    };

    // Füge Produktinfo hinzu wenn vorhanden
    if (hasResult && productInfo) {
      scanEntry.productType = productInfo.productType;
      scanEntry.productId = productInfo.productId;
      scanEntry.productName = productInfo.productName;
    }

    this.currentJourney.scannedcodes.push(scanEntry);

    console.log(`📱 Tracked scan: ${ean} - ${hasResult ? 'Found' : 'Not found'}`, {
      productType: productInfo?.productType,
      totalScans: this.currentJourney.scannedcodes.length
    });

    // Track zu GA4
    analyticsService.trackEvent({
      event_name: hasResult ? 'scan_successful' : 'scan_failed',
      event_category: 'user_action',
      journey_id: this.currentJourney.journeyId,
      ean_code: ean,
      product_found: hasResult,
      product_type: productInfo?.productType,
      product_id: productInfo?.productId,
      product_name: productInfo?.productName,
      total_scans_in_journey: this.currentJourney.scannedcodes.length
    }, userId);

    // Persistiere zu Firestore
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }
  }

  /**
   * Trackt einen Suchbegriff
   */
  trackSearchQuery(
    searchQuery: string,
    resultCount?: number,
    userId?: string
  ): void {
    if (!this.currentJourney) {
      // Starte neue Journey falls keine aktiv
      this.startJourney('search', 'search-results', undefined, userId);
      if (!this.currentJourney) return;
    }

    // Initialisiere searchedproducts Array wenn nicht vorhanden
    if (!this.currentJourney.searchedproducts) {
      this.currentJourney.searchedproducts = [];
    }

    // Füge Suchbegriff hinzu
    this.currentJourney.searchedproducts.push({
      searchQuery,
      timestamp: Date.now(),
      resultCount
    });

    console.log(`🔍 Tracked search: "${searchQuery}"`, {
      resultCount,
      totalSearches: this.currentJourney.searchedproducts.length
    });

    // Track zu GA4
    analyticsService.trackEvent({
      event_name: 'search_query_tracked',
      event_category: 'user_action',
      journey_id: this.currentJourney.journeyId,
      search_query: searchQuery,
      result_count: resultCount,
      total_searches_in_journey: this.currentJourney.searchedproducts.length
    }, userId);

    // Persistiere zu Firestore
    if (userId) {
      this.persistJourneyToFirestore(userId);
    }
  }

}

export default JourneyTrackingService.getInstance();
