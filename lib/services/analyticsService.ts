import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { isExpoGo } from '../utils/platform';

// Firebase Analytics (nur außerhalb Expo Go)
let analytics: any = null;
if (!isExpoGo()) {
  try {
    analytics = require('@react-native-firebase/analytics').default;
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

      console.log(`📤 ${eventsToUpload.length} Events zu GA4 hochgeladen`);
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

        // Event zu GA4 senden
        await analytics().logEvent(event.event_name, ga4Params);
        
        console.log(`📊 GA4 Event gesendet: ${event.event_name}`, {
          screen: event.screen_name,
          product: event.product_id?.substring(0, 8) || 'none',
          market: event.market_chain || 'none'
        });
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
