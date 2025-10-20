import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { isExpoGo } from '../utils/platform';

// Firebase Analytics (nur außerhalb Expo Go)
let analytics: any = null;
let analyticsInitialized = false;

// Initialisiere Analytics sofort
if (!isExpoGo()) {
  try {
    analytics = require('@react-native-firebase/analytics').default;
    
    // Wichtig: Analytics explizit aktivieren!
    analytics().setAnalyticsCollectionEnabled(true).then(() => {
      console.log('✅ GA4 Analytics Collection aktiviert');
      analyticsInitialized = true;
      
      // Stelle sicher, dass User Properties gesetzt werden (für bessere Segmentierung)
      analytics().setUserId(null); // Wird später gesetzt wenn User bekannt
      
      // Setze Default-Parameter für alle Events
      analytics().setDefaultEventParameters({
        app_version: require('../../app.json').expo.version,
        platform: require('react-native').Platform.OS,
      });
    }).catch((error: any) => {
      console.error('❌ GA4 Analytics Aktivierung fehlgeschlagen:', error);
    });
  } catch (error) {
    console.warn('⚠️ Firebase Analytics nicht verfügbar:', error);
  }
}

// Einheitliches Event-Schema für alle Interaktionen
interface AnalyticsEvent {
  // Core Identifiers
  uid: string;
  session_id: string;
  timestamp: Date;
  
  // Event Details
  event_name: string;
  event_category: 'user_action' | 'product_interaction' | 'conversion' | 'navigation';
  
  // Context
  screen_name: string;
  tab_name?: string;
  
  // Product Context (wenn relevant)
  product_id?: string;
  product_type?: 'noname' | 'brand';
  brand_id?: string;
  category_id?: string;
  ean?: string;
  
  // Market Context
  market_chain?: string;
  store_geohash5?: string;
  
  // Value Metrics
  price?: number;
  savings_abs?: number;
  savings_pct?: number;
  
  // Behavioral Context für Motivations-Analysis
  sort_by?: 'name' | 'price' | 'savings';
  filters_active?: string[]; // ['market:aldi', 'category:bio']
  tab_viewed?: string;
  dwell_time_ms?: number;
  
  // User Journey
  source_action?: string; // Vorherige Action die zu dieser geführt hat
  journey_step?: number; // Position im Funnel
  
  // Additional Metadata
  [key: string]: any;
}

// Motivation-spezifische Event-Typen
type MotivationSignal = 
  | 'price_filter_applied' 
  | 'sort_by_price'
  | 'savings_widget_viewed'
  | 'ingredient_filter_applied'
  | 'nutrition_tab_viewed'
  | 'brand_searched'
  | 'market_loyalty_detected';

class AnalyticsService {
  private static instance: AnalyticsService;
  private sessionId: string = '';
  private sessionStartTime: Date = new Date();
  private pendingEvents: AnalyticsEvent[] = [];
  private userLevel: number = 1;
  private batchTimeout: NodeJS.Timeout | null = null;

  private constructor() {
    this.initializeSession();
  }

  static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  /**
   * Initialisiert neue Session beim App-Start
   */
  private async initializeSession() {
    try {
      this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.sessionStartTime = new Date();
      
      // Session-Start Event
      await this.trackEvent({
        event_name: 'session_started',
        event_category: 'navigation',
        screen_name: 'app_launch'
      });
      
      console.log(`📊 Analytics Session gestartet: ${this.sessionId}`);
    } catch (error) {
      console.error('❌ Analytics Session Init Error:', error);
    }
  }

  /**
   * Zentrale Event-Tracking Funktion
   */
  async trackEvent(eventData: Partial<AnalyticsEvent>, userId?: string) {
    try {
      // Session-ID automatisch setzen wenn nicht vorhanden
      if (!this.sessionId) {
        await this.initializeSession();
      }

      const event: AnalyticsEvent = {
        uid: userId || 'anonymous',
        session_id: this.sessionId,
        timestamp: new Date(),
        event_category: 'user_action',
        screen_name: 'unknown',
        ...eventData,
        event_name: eventData.event_name || 'unknown_event'
      };

      // Erweiterte Metadaten automatisch hinzufügen
      await this.enhanceWithContextData(event);

      // Event zur Batch-Queue hinzufügen
      this.pendingEvents.push(event);
      
      // Batch-Upload nach 2 Sekunden oder bei 10 Events
      this.scheduleBatchUpload();

      console.log(`📊 Event tracked: ${event.event_name} (${event.event_category})`);
    } catch (error) {
      console.error('❌ Analytics Tracking Error:', error);
    }
  }

  /**
   * Erweitert Events mit automatischen Context-Daten
   */
  private async enhanceWithContextData(event: AnalyticsEvent) {
    try {
      // User Level hinzufügen (falls verfügbar)
      const userLevel = await AsyncStorage.getItem('current_user_level');
      if (userLevel) {
        event.user_level = parseInt(userLevel);
      }

      // Geolocation (komplett optional - DSGVO-konform)
      try {
        // Nur in Production und nur wenn Permission bereits vorhanden
        if (!isExpoGo()) {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status === 'granted') {
            const location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Lowest, // Nur grobe Position
              maximumAge: 300000 // 5 Minuten Cache
            });
            
            // Konvertiere zu Geohash5 (~5km Genauigkeit)
            event.store_geohash5 = this.coordinatesToGeohash5(
              location.coords.latitude, 
              location.coords.longitude
            );
          }
        }
      } catch (error) {
        // Geolocation komplett optional - nie Error werfen
        console.log('📍 Location optional - übersprungen');
      }

      // Session-Kontext
      event.session_duration_ms = Date.now() - this.sessionStartTime.getTime();

    } catch (error) {
      console.error('❌ Context Enhancement Error:', error);
    }
  }

  /**
   * Vereinfachter Geohash5 (für 5km Genauigkeit)
   */
  private coordinatesToGeohash5(lat: number, lon: number): string {
    // Simplified geohash für DSGVO-konforme ~5km Genauigkeit
    const latBucket = Math.floor(lat * 20) / 20; // ~5.5km steps
    const lonBucket = Math.floor(lon * 20) / 20; // ~5.5km steps
    return `${latBucket.toFixed(2)}_${lonBucket.toFixed(2)}`;
  }

  /**
   * Batch-Upload aller pending Events
   */
  private scheduleBatchUpload() {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setTimeout(() => {
      this.uploadEventsBatch();
    }, 2000); // 2 Sekunden Puffer

    // Sofort senden bei 10+ Events
    if (this.pendingEvents.length >= 10) {
      this.uploadEventsBatch();
    }
  }

  /**
   * Upload Events zu GA4 (kein Firestore - spart Kosten!)
   */
  private async uploadEventsBatch() {
    if (this.pendingEvents.length === 0) return;

    try {
      const eventsToUpload = [...this.pendingEvents];
      this.pendingEvents = []; // Clear queue

      // GA4 Upload (Hauptziel für Dashboard)
      await this.uploadToGA4(eventsToUpload);

      // Nur bei vielen Events loggen
      if (eventsToUpload.length > 10) {
        console.log(`📤 ${eventsToUpload.length} Events zu GA4 hochgeladen`);
      }
    } catch (error) {
      console.error('❌ GA4 Upload Error:', error);
      
      // Fallback: Events zurück in Queue wenn Upload fehlschlägt
      this.pendingEvents.unshift(...eventsToUpload);
    }

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
  }

  /**
   * Upload zu Google Analytics 4
   */
  private async uploadToGA4(events: AnalyticsEvent[]) {
    try {
      // Check ob Firebase Analytics verfügbar (nicht in Expo Go)
      if (!analytics) {
        console.log(`📱 GA4 Upload übersprungen: ${events.length} Events (Expo Go Fallback)`);
        return;
      }

      console.log(`🔄 GA4 Upload: ${events.length} Events zu Google Analytics...`);
      
      // User-ID für alle Events setzen (falls vorhanden)
      for (const event of events) {
        if (event.uid && event.uid !== 'anonymous') {
          await analytics().setUserId(event.uid);
          break; // Nur einmal setzen pro Batch
        }
      }
      
      // Jedes Event einzeln zu GA4 senden
      for (const event of events) {
        // GA4-konforme Parameter (max 25 pro Event)
        const ga4Params: Record<string, any> = {
          screen_name: event.screen_name,
          event_category: event.event_category
        };

        // Wichtige Metadaten hinzufügen (für Dashboard)
        if (event.product_id) ga4Params.product_id = event.product_id;
        if (event.product_type) ga4Params.product_type = event.product_type;
        if (event.category_id) ga4Params.category_id = event.category_id;
        if (event.market_chain) ga4Params.market_chain = event.market_chain;
        if (event.price) ga4Params.price = event.price;
        if (event.savings_abs) ga4Params.savings_abs = event.savings_abs;
        if (event.savings_pct) ga4Params.savings_pct = event.savings_pct;
        if (event.sort_by) ga4Params.sort_by = event.sort_by;
        if (event.dwell_time_ms) ga4Params.dwell_time_ms = event.dwell_time_ms;
        if (event.store_geohash5) ga4Params.store_geohash5 = event.store_geohash5;
        if (event.user_level) ga4Params.user_level = event.user_level;
        if (event.session_duration_ms) ga4Params.session_duration_ms = event.session_duration_ms;
        if (event.journey_step) ga4Params.journey_step = event.journey_step;

        // 🆕 SCAN PARAMETER (kritisch!)
        if (event.ean_code) ga4Params.ean_code = event.ean_code;
        if (event.product_found !== undefined) ga4Params.product_found = event.product_found;
        if (event.product_name) ga4Params.product_name = event.product_name;
        if (event.total_scans_in_journey) ga4Params.total_scans_in_journey = event.total_scans_in_journey;
        
        // 🆕 SEARCH PARAMETER (kritisch!)
        if (event.search_query) ga4Params.search_query = event.search_query;
        if (event.results_count !== undefined) ga4Params.results_count = event.results_count;
        if (event.total_searches_in_journey) ga4Params.total_searches_in_journey = event.total_searches_in_journey;
        
        // 🆕 NAVIGATION / PFADANALYSE (kritisch!)
        if (event.from_screen) ga4Params.from_screen = event.from_screen;
        if (event.to_screen) ga4Params.to_screen = event.to_screen;
        if (event.tab_name) ga4Params.tab_name = event.tab_name;
        
        // 🆕 JOURNEY & SOURCE
        if (event.journey_id) ga4Params.journey_id = event.journey_id;
        if (event.source) ga4Params.source = event.source;
        
        // 🆕 FILTER DETAILS
        if (event.filter_type) ga4Params.filter_type = event.filter_type;
        if (event.filter_value) ga4Params.filter_value = event.filter_value;
        if (event.filters_active) ga4Params.filters_active = JSON.stringify(event.filters_active);
        
        // 🆕 FALLBACK & BRAND
        if (event.is_fallback !== undefined) ga4Params.is_fallback = event.is_fallback;
        if (event.fallback_source) ga4Params.fallback_source = event.fallback_source;
        if (event.brand_id) ga4Params.brand_id = event.brand_id;
        if (event.brand_name) ga4Params.brand_name = event.brand_name;
        
        // 🆕 TAB NAVIGATION
        if (event.from_tab) ga4Params.from_tab = event.from_tab;
        if (event.to_tab) ga4Params.to_tab = event.to_tab;

        // Event zu GA4 senden
        await analytics().logEvent(event.event_name, ga4Params);
      }
      
    } catch (error) {
      console.error('❌ GA4 Upload Error:', error);
      // Nicht rethrow - Analytics soll optional sein
    }
  }

  /**
   * HIGH-LEVEL TRACKING FUNCTIONS für häufige Events
   */

  // NAVIGATION
  async trackScreenView(screenName: string, userId?: string, additionalData?: any) {
    await this.trackEvent({
      event_name: 'screen_viewed',
      event_category: 'navigation',
      screen_name: screenName,
      ...additionalData
    }, userId);
  }

  async trackTabSwitch(fromTab: string, toTab: string, userId?: string) {
    await this.trackEvent({
      event_name: 'tab_switched',
      event_category: 'navigation',
      screen_name: 'tab_navigation',
      from_tab: fromTab,
      to_tab: toTab
    }, userId);
  }

  // PRODUCT INTERACTIONS  
  async trackProductView(productId: string, productType: 'noname' | 'brand', userId?: string, additionalData?: any) {
    await this.trackEvent({
      event_name: 'product_viewed',
      event_category: 'product_interaction',
      screen_name: productType === 'noname' ? 'noname_detail' : 'product_comparison',
      product_id: productId,
      product_type: productType,
      ...additionalData
    }, userId);
  }

  // 🛒 SHOPPING CART JOURNEY
  async trackAddToCart(
    productId: string, 
    productName: string, 
    isMarke: boolean, 
    source: 'search' | 'scan' | 'browse' | 'favorites' | 'repurchase' | 'comparison',
    userId?: string, 
    additionalData?: any
  ) {
    // 📊 Detailliertes Logging
    console.log(`🛒 Add-to-Cart: ${productName.substring(0, 30)}... (${isMarke ? 'Brand' : 'NoName'}) via ${source}`);
    
    await this.trackEvent({
      event_name: 'add_to_cart',
      event_category: 'conversion',
      screen_name: additionalData?.screen_name || 'unknown',
      product_id: productId,
      product_type: isMarke ? 'brand' : 'noname',
      source_method: source,
      ...additionalData
    }, userId);
  }

  async trackRemoveFromCart(
    productId: string, 
    reason: 'manual_delete' | 'conversion_to_noname' | 'purchase_completed',
    timeInCartMs?: number,
    userId?: string
  ) {
    await this.trackEvent({
      event_name: 'remove_from_cart',
      event_category: 'user_action',
      product_id: productId,
      removal_reason: reason,
      time_in_cart_ms: timeInCartMs,
    }, userId);
  }

  async trackPurchaseCompleted(
    itemsCount: number,
    totalSavings: number,
    noNameItems: number,
    brandItems: number,
    sourceMix: string[],
    userId?: string
  ) {
    // 📊 Detailliertes Logging
    console.log(`💰 Purchase: ${itemsCount} Produkte, €${totalSavings.toFixed(2)} gespart (Sources: ${sourceMix.join(', ')})`);
    
    await this.trackEvent({
      event_name: 'purchase_completed',
      event_category: 'conversion',
      items_count: itemsCount,
      total_savings: totalSavings,
      noname_items: noNameItems,
      brand_items: brandItems,
      source_methods: sourceMix,
    }, userId);
  }

  // 🔄 CONVERSION TRACKING
  async trackProductConversion(
    fromProductId: string,
    toProductId: string,
    savingsAmount: number,
    savingsPercent: number,
    userId?: string
  ) {
    await this.trackEvent({
      event_name: 'product_converted',
      event_category: 'conversion',
      from_product_id: fromProductId,
      to_product_id: toProductId,
      savings_abs: savingsAmount,
      savings_pct: savingsPercent,
    }, userId);
  }

  // 💡 MOTIVATION ANALYSIS - ENHANCED
  async trackSortChanged(
    sortBy: 'name' | 'price' | 'savings',
    screenName: string,
    userId?: string,
    additionalData?: any
  ) {
    await this.trackEvent({
      event_name: 'sort_changed',
      event_category: 'user_action',
      screen_name: screenName,
      sort_by: sortBy,
      motivation_signal: sortBy === 'price' ? 'price' : (sortBy === 'savings' ? 'savings' : 'content'),
      ...additionalData
    }, userId);
  }

  async trackFilterChanged(
    filterType: 'market' | 'category' | 'price' | 'bio' | 'vegan' | 'ingredients' | 'nutrition' | 'allergen' | 'nutrition_range',
    filterValue: string,
    action: 'added' | 'removed',
    screenName: string,
    userId?: string,
    additionalData?: any
  ) {
    const motivationSignal = this.getMotivationFromFilter(filterType, filterValue);
    
    // 📊 Detailliertes Logging für bessere Debugging
    console.log(`📊 Filter ${action}: ${filterType}="${filterValue}" auf ${screenName} (Motivation: ${motivationSignal})`);
    
    await this.trackEvent({
      event_name: 'filter_changed',
      event_category: 'user_action',
      screen_name: screenName,
      filter_type: filterType,
      filter_value: filterValue,
      filter_action: action,
      motivation_signal: motivationSignal,
      ...additionalData
    }, userId);
  }

  async trackSavingsWidgetClicked(
    widgetType: 'total_savings' | 'potential_savings' | 'comparison_savings',
    savingsAmount: number,
    screenName: string,
    userId?: string
  ) {
    await this.trackEvent({
      event_name: 'savings_widget_clicked',
      event_category: 'user_action',
      screen_name: screenName,
      widget_type: widgetType,
      savings_amount: savingsAmount,
      motivation_signal: 'savings',
    }, userId);
  }

  // Helper: Motivation aus Filter ableiten
  private getMotivationFromFilter(filterType: string, filterValue: string): string {
    if (filterType === 'price' || filterValue.toLowerCase().includes('günstig')) {
      return 'price';
    } else if (filterType === 'bio' || filterType === 'vegan' || filterType === 'ingredients' || filterType === 'nutrition' || filterType === 'allergen' || filterType === 'nutrition_range') {
      return 'content'; // Gesundheits- und Inhaltsstoffe-bezogene Motivation
    } else if (filterValue.toLowerCase().includes('bio') || filterValue.toLowerCase().includes('vegan') || filterValue.toLowerCase().includes('gluten')) {
      return 'content';
    } else if (filterType === 'market') {
      return 'market_loyalty';
    } else if (filterType === 'category') {
      return 'content';
    } else {
      return 'exploration';
    }
  }

  async trackProductTabView(productId: string, tabName: string, dwellTimeMs: number, userId?: string) {
    await this.trackEvent({
      event_name: 'product_tab_viewed',
      event_category: 'product_interaction',
      screen_name: 'product_detail',
      product_id: productId,
      tab_viewed: tabName,
      dwell_time_ms: dwellTimeMs
    }, userId);
  }

  // SEARCH & DISCOVERY
  async trackSearch(query: string, resultsCount: number, userId?: string, filters?: string[]) {
    await this.trackEvent({
      event_name: 'search_performed',
      event_category: 'user_action',
      screen_name: 'search',
      search_query: query,
      results_count: resultsCount,
      filters_active: filters
    }, userId);
  }

  async trackFilterApplied(filterType: string, filterValue: string, screenName: string, userId?: string) {
    await this.trackEvent({
      event_name: 'filter_applied',
      event_category: 'user_action',
      screen_name: screenName,
      filter_type: filterType,
      filter_value: filterValue
    }, userId);
  }

  // CONVERSIONS
  async trackConversion(conversionType: 'add_to_cart' | 'mark_purchased' | 'add_to_favorites', productId: string, userId?: string, additionalData?: any) {
    await this.trackEvent({
      event_name: conversionType,
      event_category: 'conversion',
      screen_name: 'conversion_action',
      product_id: productId,
      journey_step: this.getJourneyStep(conversionType),
      ...additionalData
    }, userId);
    
    // NEU: Standard E-Commerce Events für GA4
    if (analytics) {
      try {
        switch(conversionType) {
          case 'add_to_favorites':
            // Standard GA4 Event für Wishlist
            await analytics().logEvent('add_to_wishlist', {
              currency: 'EUR',
              value: additionalData?.price || 0,
              items: [{
                item_id: productId,
                item_name: additionalData?.productName || 'Unknown',
                item_category: additionalData?.category || 'uncategorized',
                price: additionalData?.price || 0,
                quantity: 1
              }]
            });
            break;
            
          case 'add_to_cart':
            // Standard GA4 E-Commerce Event
            await analytics().logEvent('add_to_cart', {
              currency: 'EUR',
              value: additionalData?.price || 0,
              items: [{
                item_id: productId,
                item_name: additionalData?.productName || 'Unknown',
                item_category: additionalData?.category || 'uncategorized',
                item_brand: additionalData?.brand || 'noname',
                price: additionalData?.price || 0,
                quantity: 1
              }]
            });
            break;
            
          case 'mark_purchased':
            // Standard GA4 Purchase Event
            await analytics().logEvent('purchase', {
              transaction_id: additionalData?.transactionId || `purchase_${Date.now()}`,
              currency: 'EUR',
              value: additionalData?.totalValue || 0,
              items: additionalData?.items || [{
                item_id: productId,
                item_name: additionalData?.productName || 'Unknown',
                price: additionalData?.price || 0,
                quantity: 1
              }]
            });
            break;
        }
      } catch (error) {
        console.warn('GA4 E-Commerce Event Error:', error);
      }
    }
  }

  // MOTIVATION-SPECIFIC SIGNALS
  async trackMotivationSignal(signalType: MotivationSignal, strength: number, userId?: string, context?: any) {
    await this.trackEvent({
      event_name: 'motivation_signal',
      event_category: 'user_action',
      screen_name: context?.screen || 'unknown',
      motivation_signal: signalType,
      signal_strength: strength,
      ...context
    }, userId);
  }

  /**
   * Journey-Step Helper
   */
  private getJourneyStep(conversionType: string): number {
    switch (conversionType) {
      case 'scan_product': return 1;
      case 'product_viewed': return 2;
      case 'compare_opened': return 3;
      case 'add_to_cart': return 4;
      case 'mark_purchased': return 5;
      default: return 0;
    }
  }

  /**
   * Cleanup beim App-Close
   */
  async cleanup() {
    if (this.pendingEvents.length > 0) {
      await this.uploadEventsBatch();
    }
  }

  /**
   * User-Level aktualisieren (für Events)
   */
  setUserLevel(level: number) {
    this.userLevel = level;
    AsyncStorage.setItem('current_user_level', level.toString());
  }
}

export const analyticsService = AnalyticsService.getInstance();
