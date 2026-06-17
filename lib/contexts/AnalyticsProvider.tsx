import { useAuth } from '@/lib/contexts/AuthContext';
import Constants from 'expo-constants';
import { useFocusEffect, usePathname } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { AppState, AppStateStatus, InteractionManager, Platform } from 'react-native';
// Version wird aus Constants gelesen, nicht aus package.json
import { analyticsService } from '../services/analyticsService';
import journeyTrackingService from '../services/journeyTrackingService';
import { PERF } from '../perfFlags';
import { setCurrentPathname } from '../utils/currentRoute';
import { isExpoGo } from '../utils/platform';

interface AnalyticsContextType {
  // High-level tracking functions
  trackProductView: (productId: string, productType: 'noname' | 'brand', additionalData?: any) => void;
  trackSearch: (query: string, resultsCount: number, filters?: string[]) => void;
  trackFilter: (filterType: string, filterValue: string, screenName?: string) => void;
  trackConversion: (type: 'add_to_cart' | 'mark_purchased' | 'add_to_favorites', productId: string, additionalData?: any) => void;
  trackMotivation: (signalType: string, strength: number, context?: any) => void;
  trackCustomEvent: (eventName: string, eventData?: any) => void;
  
  // 🛒 SHOPPING JOURNEY
  trackAddToCart: (productId: string, productName: string, isMarke: boolean, source: 'search' | 'scan' | 'browse' | 'favorites' | 'repurchase' | 'comparison', additionalData?: any) => void;
  trackRemoveFromCart: (productId: string, reason: 'manual_delete' | 'conversion_to_noname' | 'purchase_completed', timeInCartMs?: number) => void;
  trackPurchaseCompleted: (itemsCount: number, totalSavings: number, noNameItems: number, brandItems: number, sourceMix: string[]) => void;
  trackProductConversion: (fromProductId: string, toProductId: string, savingsAmount: number, savingsPercent: number) => void;
  
  // 💡 MOTIVATION ANALYSIS
  trackSortChanged: (sortBy: 'name' | 'price' | 'savings', screenName: string, additionalData?: any) => void;
  trackFilterChanged: (filterType: 'market' | 'category' | 'price' | 'bio' | 'vegan' | 'vegetarian' | 'ingredients' | 'nutrition' | 'allergen' | 'nutrition_range' | 'quality', filterValue: string, action: 'added' | 'removed', screenName: string, additionalData?: any) => void;
  trackSavingsWidgetClicked: (widgetType: 'total_savings' | 'potential_savings' | 'comparison_savings', savingsAmount: number, screenName: string) => void;
  
  // 🎯 JOURNEY TRACKING
  startJourney: (discoveryMethod: 'search' | 'browse' | 'scan' | 'favorites' | 'repurchase', screenName: string, activeFilters?: any) => void;
  updateJourneyFilters: (filters: any, filterChange?: {action: 'added' | 'removed' | 'cleared', filterType: string, filterValue: string}) => void;
  
  // 🎯 ENHANCED FILTER JOURNEY TRACKING
  trackJourneyAbandonment: (reason: 'filter_timeout' | 'app_backgrounded' | 'filters_cleared' | 'no_results' | 'too_complex' | 'price_too_high' | 'tab_switched', context?: any) => void;
  trackFilterCleared: () => void;
  trackNoResultsFound: (searchQuery?: string, activeFilters?: any) => void;
  trackTabSwitched: (fromTab: string, toTab: string) => void;
  checkFilterComplexityOverload: () => void;
  trackProductViewWithJourney: (productId: string, productType: 'brand' | 'noname', productName: string, position?: number) => void;
  trackAddToCartWithJourney: (productId: string, productName: string, isMarke: boolean) => void;
  trackAddToFavoritesWithJourney: (productId: string, productName: string, productType: 'brand' | 'noname', priceInfo?: { price: number; savings: number }) => void;
  trackPurchaseWithJourney: (products: { productId: string; productName: string; productType: 'brand' | 'noname' }[], totalSavings: number) => void;
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined);

interface AnalyticsProviderProps {
  children: React.ReactNode;
}

export const AnalyticsProvider: React.FC<AnalyticsProviderProps> = ({ children }) => {
  const { user, userProfile } = useAuth();
  const pathname = usePathname();
  const lastScreenRef = useRef<string>('');
  const screenStartTimeRef = useRef<Date>(new Date());

  // Globalen Route-Spiegel pflegen, damit Nicht-Hook-Code (z.B. der onTap
  // eines global gefeuerten Banners) weiß, wo der User gerade ist und
  // redundante Navigation vermeiden kann. ClickUp 86caak83r.
  useEffect(() => {
    setCurrentPathname(pathname);
  }, [pathname]);

  // Update User-Level im Analytics Service wenn sich userProfile ändert
  useEffect(() => {
    const currentLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
    analyticsService.setUserLevel(currentLevel);
  }, [userProfile?.stats?.currentLevel, userProfile?.level]); // 🎯 NUR bei Level-Änderung neu laden!

  // Set App Version and Build Number als User Properties für GA4
  useEffect(() => {
    if (!isExpoGo()) {
      // Firebase Analytics importieren
      const analytics = require('@react-native-firebase/analytics').default;
      
      const buildNumber = Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || 'unknown';
      const environment = __DEV__ ? 'development' : 'production';
      
      // User Properties setzen (persistent für alle Events)
      const appVersion = Constants.expoConfig?.version || '1.0.0';
      analytics().setUserProperties({
        app_version: appVersion,
        build_number: buildNumber,
        environment: environment,
        platform: Platform.OS
      });
      
      console.log(`📊 GA4 User Properties gesetzt:`, { appVersion, buildNumber, environment });
    }
  }, []); // Nur einmal beim App-Start

  // App-Start-Zähler für den Demografie-Sheet-Aufschub (2026-06-11).
  useEffect(() => {
    import('@/lib/services/demographicsPromptSignals')
      .then((m) => m.registerAppStart())
      .catch(() => {});
  }, []);

  // Markt-Daten-Consent-Gate + Journey-Fortsetzung (ClickUp 86ca6u6xd):
  // Das Gate hält den Consent-Status des Users live (Cashback-Consent
  // v2 deckt die App-Nutzungsdaten ab). journeyTrackingService + IP-
  // Location prüfen es synchron vor jedem Write. loadActiveJourney
  // läuft erst, wenn der Consent bestätigt ist — der Snapshot kommt
  // async, ein sofortiger Call würde am Gate abprallen. Bei Widerruf
  // schließt das Gate sofort (Persist-Pfade droppen still). Logout/
  // User-Wechsel → Cleanup schließt das Gate (Default: kein Tracking).
  useEffect(() => {
    if (!user?.uid) return;
    // Journey-Tracking + IP-Location laufen für ALLE User (anon +
    // registriert), unabhängig vom Cashback-Consent (User-Vorgabe
    // 2026-06-14, DSGVO-konform). Beim User-Wechsel (anon→account) lädt
    // loadActiveJourney die aktive Journey des neuen Users bzw. startet eine
    // frische Session; der Owner-Mismatch-Guard im Persist verhindert
    // Cross-User-Writes.
    journeyTrackingService.loadActiveJourney(user.uid);
  }, [user?.uid]);

  // ─── Attribution Capture (T4, ClickUp 86c9zbxy7) ─────────────
  // Einmaliger Capture-Versuch sobald wir eine UID haben (anon
  // oder echt — beides ok für die Attribution-Tabelle). Service
  // ist idempotent (Storage-Flag), kann also bei jedem App-Start
  // sicher gerufen werden. Aktuelle Native Modules nicht
  // installiert → returnt 'unknown', schreibt aber trotzdem
  // einen Marker damit wir wissen wann der Versuch lief.
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      try {
        const { AttributionService } = await import(
          '@/lib/services/attributionService'
        );
        await AttributionService.initialize(user.uid);
      } catch (err) {
        if (__DEV__) {
          console.log('[Analytics] attribution init skipped:', err);
        }
      }
    })();
  }, [user?.uid]);

  // Automatisches Screen-Tracking bei Navigation + Journey-Management
  useFocusEffect(
    useCallback(() => {
      const screenName = pathname.replace(/^\//, '').replace(/\//g, '_') || 'home';
      const now = new Date();

      // Refs SOFORT updaten (nicht im deferred Block) — sonst
      // berechnet der nächste Focus-Effect ggf. mit veraltetem
      // lastScreenRef einen falschen dwellTime.
      const previousScreen = lastScreenRef.current;
      const previousStartTime = screenStartTimeRef.current;
      lastScreenRef.current = screenName;
      screenStartTimeRef.current = now;

      // Fix C — Screen-Tracking-Writes (3 Firestore-Writes pro Nav)
      // sind teuer und nicht zeit-kritisch. Mit `PERF.deferScreenTracking=true`:
      // in `runAfterInteractions` schicken, damit die Navigation-
      // Animation nicht gegen die Writes konkurriert. Events
      // sind eh fire-and-forget — User merkt nichts.
      // Rollback: PERF.deferScreenTracking = false.
      const fireWrites = () => {
        if (previousScreen) {
          const dwellTime = now.getTime() - previousStartTime.getTime();
          analyticsService.trackEvent({
            event_name: 'screen_transition',
            event_category: 'navigation',
            from_screen: previousScreen,
            to_screen: screenName,
            dwell_time_ms: dwellTime,
          }, user?.uid);

          analyticsService.trackEvent({
            event_name: 'screen_left',
            event_category: 'navigation',
            screen_name: previousScreen,
            dwell_time_ms: dwellTime,
          }, user?.uid);
        }

        analyticsService.trackScreenView(screenName, user?.uid);

        // 🎯 Journey-Management bei Screen-Wechsel
        journeyTrackingService.onScreenChange(screenName, {}, user?.uid);
      };

      if (PERF.deferScreenTracking) {
        InteractionManager.runAfterInteractions(fireWrites);
      } else {
        fireWrites();
      }
    }, [pathname, user?.uid])
  );

  // Cleanup beim Unmount
  useEffect(() => {
    return () => {
      analyticsService.cleanup();
    };
  }, []);

  // High-level Tracking Functions
  const trackProductView = useCallback((productId: string, productType: 'noname' | 'brand', additionalData?: any) => {
    analyticsService.trackProductView(productId, productType, user?.uid, {
      user_level: userProfile?.stats?.currentLevel || 1,
      ...additionalData
    });
  }, [user?.uid, userProfile]);

  const trackSearch = useCallback((query: string, resultsCount: number, filters?: string[]) => {
    analyticsService.trackSearch(query, resultsCount, user?.uid, filters);
    
    // Zusätzliche Motivation-Signale basierend auf Suche
    if (query.toLowerCase().includes('bio') || query.toLowerCase().includes('vegan') || query.toLowerCase().includes('glutenfrei')) {
      analyticsService.trackMotivationSignal('ingredient_filter_applied', 2, user?.uid, { search_query: query });
    }
    
    // Marken-Suche erkennen
    if (query.length > 3 && query.match(/^[A-Z][a-z]+/)) { // Groß geschriebene Wörter = wahrscheinlich Marken
      analyticsService.trackMotivationSignal('brand_searched', 3, user?.uid, { brand_query: query });
    }
  }, [user?.uid]);

  const trackFilter = useCallback((filterType: string, filterValue: string, screenName?: string) => {
    analyticsService.trackFilterApplied(filterType, filterValue, screenName || 'unknown', user?.uid);
    
    // Motivation-Signale aus Filtern ableiten
    if (filterType === 'sort' && filterValue.includes('price')) {
      analyticsService.trackMotivationSignal('sort_by_price', 2, user?.uid, { sort_by: filterValue });
    }
    if (filterType === 'market') {
      analyticsService.trackMotivationSignal('market_loyalty_detected', 1, user?.uid, { market: filterValue });
    }
  }, [user?.uid]);

  const trackConversion = useCallback((type: 'add_to_cart' | 'mark_purchased' | 'add_to_favorites', productId: string, additionalData?: any) => {
    analyticsService.trackConversion(type, productId, user?.uid, additionalData);
  }, [user?.uid]);

  const trackMotivation = useCallback((signalType: string, strength: number, context?: any) => {
    analyticsService.trackMotivationSignal(signalType as any, strength, user?.uid, context);
  }, [user?.uid]);

  const trackCustomEvent = useCallback((eventName: string, eventData?: any) => {
    analyticsService.trackEvent({
      event_name: eventName,
      ...eventData
    }, user?.uid);
  }, [user?.uid]);

  // 🛒 SHOPPING JOURNEY FUNCTIONS
  const trackAddToCart = useCallback((
    productId: string, 
    productName: string, 
    isMarke: boolean, 
    source: 'search' | 'scan' | 'browse' | 'favorites' | 'repurchase' | 'comparison',
    additionalData?: any
  ) => {
    analyticsService.trackAddToCart(productId, productName, isMarke, source, user?.uid, additionalData);
  }, [user?.uid]);

  const trackRemoveFromCart = useCallback((
    productId: string, 
    reason: 'manual_delete' | 'conversion_to_noname' | 'purchase_completed',
    timeInCartMs?: number
  ) => {
    analyticsService.trackRemoveFromCart(productId, reason, timeInCartMs, user?.uid);
  }, [user?.uid]);

  const trackPurchaseCompleted = useCallback((
    itemsCount: number,
    totalSavings: number,
    noNameItems: number,
    brandItems: number,
    sourceMix: string[]
  ) => {
    analyticsService.trackPurchaseCompleted(itemsCount, totalSavings, noNameItems, brandItems, sourceMix, user?.uid);
  }, [user?.uid]);

  const trackProductConversion = useCallback((
    fromProductId: string,
    toProductId: string,
    savingsAmount: number,
    savingsPercent: number
  ) => {
    analyticsService.trackProductConversion(fromProductId, toProductId, savingsAmount, savingsPercent, user?.uid);
  }, [user?.uid]);

  // 💡 MOTIVATION ANALYSIS FUNCTIONS
  const trackSortChanged = useCallback((
    sortBy: 'name' | 'price' | 'savings',
    screenName: string,
    additionalData?: any
  ) => {
    analyticsService.trackSortChanged(sortBy, screenName, user?.uid, additionalData);
  }, [user?.uid]);

  const trackFilterChanged = useCallback((
    filterType: 'market' | 'category' | 'price' | 'bio' | 'vegan' | 'vegetarian' | 'ingredients' | 'nutrition' | 'allergen' | 'nutrition_range' | 'quality',
    filterValue: string,
    action: 'added' | 'removed',
    screenName: string,
    additionalData?: any
  ) => {
    analyticsService.trackFilterChanged(filterType, filterValue, action, screenName, user?.uid, additionalData);
  }, [user?.uid]);

  const trackSavingsWidgetClicked = useCallback((
    widgetType: 'total_savings' | 'potential_savings' | 'comparison_savings',
    savingsAmount: number,
    screenName: string
  ) => {
    analyticsService.trackSavingsWidgetClicked(widgetType, savingsAmount, screenName, user?.uid);
  }, [user?.uid]);

  // 🎯 JOURNEY TRACKING FUNCTIONS
  const startJourney = useCallback((
    discoveryMethod: 'search' | 'browse' | 'scan' | 'favorites' | 'repurchase',
    screenName: string,
    activeFilters?: any
  ) => {
    journeyTrackingService.startJourney(discoveryMethod, screenName, activeFilters, user?.uid);
  }, [user?.uid]);

  const updateJourneyFilters = useCallback((filters: any, filterChange?: {action: 'added' | 'removed' | 'cleared', filterType: string, filterValue: string}) => {
    journeyTrackingService.updateFilters(filters, user?.uid, filterChange);
  }, [user?.uid]);

  // 🎯 ENHANCED FILTER JOURNEY TRACKING
  const trackJourneyAbandonment = useCallback((
    reason: 'filter_timeout' | 'app_backgrounded' | 'filters_cleared' | 'no_results' | 'too_complex' | 'price_too_high' | 'tab_switched', 
    context?: any
  ) => {
    journeyTrackingService.trackJourneyAbandonment(reason, context, user?.uid);
  }, [user?.uid]);

  const trackFilterCleared = useCallback(() => {
    journeyTrackingService.trackFilterCleared(user?.uid);
  }, [user?.uid]);

  const trackNoResultsFound = useCallback((searchQuery?: string, activeFilters?: any) => {
    journeyTrackingService.trackNoResultsFound(searchQuery, activeFilters, user?.uid);
  }, [user?.uid]);

  const trackTabSwitched = useCallback((fromTab: string, toTab: string) => {
    journeyTrackingService.trackTabSwitched(fromTab, toTab, user?.uid);
  }, [user?.uid]);

  const checkFilterComplexityOverload = useCallback(() => {
    journeyTrackingService.checkFilterComplexityOverload(user?.uid);
  }, [user?.uid]);

  const trackProductViewWithJourney = useCallback((
    productId: string, 
    productType: 'brand' | 'noname', 
    productName: string, 
    position?: number
  ) => {
    journeyTrackingService.trackProductView(productId, productType, productName, position, user?.uid);
  }, [user?.uid]);

  const trackAddToCartWithJourney = useCallback((
    productId: string, 
    productName: string, 
    isMarke: boolean
  ) => {
    journeyTrackingService.trackAddToCart(productId, productName, isMarke, user?.uid);
  }, [user?.uid]);

  const trackAddToFavoritesWithJourney = useCallback((
    productId: string, 
    productName: string,
    productType: 'brand' | 'noname',
    priceInfo?: { price: number; savings: number }
  ) => {
    journeyTrackingService.trackAddToFavorites(productId, productName, productType, user?.uid, priceInfo);
  }, [user?.uid]);

  const trackPurchaseWithJourney = useCallback((
    products: { productId: string; productName: string; productType: 'brand' | 'noname' }[], 
    totalSavings: number
  ) => {
    journeyTrackingService.trackPurchase(products, totalSavings, user?.uid);
  }, [user?.uid]);

  // App-Lifecycle Events für Background-Tracking
  //
  // BUGFIX (ClickUp 86c9pwcx5): Vorher war das ein NOOP — nur ein
  // console.log, der AppState.addEventListener wurde nie registriert.
  // Damit feuerte onAppBackground NIE und Journeys hatten kein
  // completedAt wenn der User die App schloss. Jetzt korrekt
  // gewired via AppState.addEventListener (RN-API ab v0.65+ gibt
  // ein Subscription-Objekt zurück, .remove() statt removeEventListener).
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        journeyTrackingService.onAppBackground(user?.uid);
      } else if (nextAppState === 'active') {
        journeyTrackingService.onAppForeground();
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    console.log('📱 App lifecycle tracking wired for journey abandonment');

    return () => {
      sub.remove();
    };
  }, [user?.uid]);

  // Inline-useCallbacks aus dem contextValue-Object herausgezogen,
  // damit der useMemo darunter ein deterministisches Dep-Set hat
  // (sonst würde React für jeden useCallback ein neues Object pro
  // Render erzeugen — bricht den Memo).
  const trackProductComparison = useCallback((
    mainProductId: string,
    mainProductName: string,
    mainProductType: 'brand' | 'noname',
    comparedProducts: any[]
  ) => {
    journeyTrackingService.trackProductComparison(
      mainProductId,
      mainProductName,
      mainProductType,
      comparedProducts,
      user?.uid
    );
  }, [user?.uid]);

  const trackComparisonEnd = useCallback((
    mainProductId: string,
    selectedProductId?: string,
    abandonmentReason?: string
  ) => {
    journeyTrackingService.trackComparisonEnd(
      mainProductId,
      selectedProductId,
      abandonmentReason as any
    );
  }, []);

  const trackRemoveFromCartWithJourney = useCallback((
    productId: string,
    productName: string,
    productType: 'brand' | 'noname'
  ) => {
    journeyTrackingService.trackRemoveFromCart(
      productId,
      productName,
      productType,
      user?.uid
    );
  }, [user?.uid]);

  // Fix B — Mit `PERF.memoAnalyticsValue=true`: stabilisiert das
  // contextValue-Object via useMemo. AnalyticsProvider rendert
  // besonders oft (`usePathname()` als Auth+Pathname-Dep), daher
  // ist die Cascade hier doppelt teuer ohne Memo.
  // Rollback: PERF.memoAnalyticsValue = false.
  const valueMemo = useMemo<AnalyticsContextType>(
    () => ({
      trackProductView,
      trackSearch,
      trackFilter,
      trackConversion,
      trackMotivation,
      trackCustomEvent,
      trackAddToCart,
      trackRemoveFromCart,
      trackPurchaseCompleted,
      trackProductConversion,
      trackSortChanged,
      trackFilterChanged,
      trackSavingsWidgetClicked,
      startJourney,
      updateJourneyFilters,
      trackJourneyAbandonment,
      trackFilterCleared,
      trackNoResultsFound,
      trackTabSwitched,
      checkFilterComplexityOverload,
      trackProductViewWithJourney,
      trackAddToCartWithJourney,
      trackAddToFavoritesWithJourney,
      trackPurchaseWithJourney,
      trackProductComparison,
      trackComparisonEnd,
      trackRemoveFromCartWithJourney,
    }),
    [
      trackProductView,
      trackSearch,
      trackFilter,
      trackConversion,
      trackMotivation,
      trackCustomEvent,
      trackAddToCart,
      trackRemoveFromCart,
      trackPurchaseCompleted,
      trackProductConversion,
      trackSortChanged,
      trackFilterChanged,
      trackSavingsWidgetClicked,
      startJourney,
      updateJourneyFilters,
      trackJourneyAbandonment,
      trackFilterCleared,
      trackNoResultsFound,
      trackTabSwitched,
      checkFilterComplexityOverload,
      trackProductViewWithJourney,
      trackAddToCartWithJourney,
      trackAddToFavoritesWithJourney,
      trackPurchaseWithJourney,
      trackProductComparison,
      trackComparisonEnd,
      trackRemoveFromCartWithJourney,
    ],
  );

  const contextValue: AnalyticsContextType = PERF.memoAnalyticsValue
    ? valueMemo
    : {
        trackProductView,
        trackSearch,
        trackFilter,
        trackConversion,
        trackMotivation,
        trackCustomEvent,
        trackAddToCart,
        trackRemoveFromCart,
        trackPurchaseCompleted,
        trackProductConversion,
        trackSortChanged,
        trackFilterChanged,
        trackSavingsWidgetClicked,
        startJourney,
        updateJourneyFilters,
        trackJourneyAbandonment,
        trackFilterCleared,
        trackNoResultsFound,
        trackTabSwitched,
        checkFilterComplexityOverload,
        trackProductViewWithJourney,
        trackAddToCartWithJourney,
        trackAddToFavoritesWithJourney,
        trackPurchaseWithJourney,
        trackProductComparison,
        trackComparisonEnd,
        trackRemoveFromCartWithJourney,
      };

  return (
    <AnalyticsContext.Provider value={contextValue}>
      {children}
    </AnalyticsContext.Provider>
  );
};

/**
 * Hook für einfaches Analytics-Tracking
 */
export const useAnalytics = () => {
  const context = useContext(AnalyticsContext);
  if (context === undefined) {
    throw new Error('useAnalytics must be used within an AnalyticsProvider');
  }
  return context;
};

// Export für direkten Service-Zugriff (falls benötigt)
export { analyticsService };
