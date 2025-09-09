import { useAuth } from '@/lib/contexts/AuthContext';
import { useFocusEffect, usePathname } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { analyticsService } from '../services/analyticsService';

interface AnalyticsContextType {
  // High-level tracking functions
  trackProductView: (productId: string, productType: 'noname' | 'brand', additionalData?: any) => void;
  trackSearch: (query: string, resultsCount: number, filters?: string[]) => void;
  trackFilter: (filterType: string, filterValue: string, screenName?: string) => void;
  trackConversion: (type: 'add_to_cart' | 'mark_purchased' | 'add_to_favorites', productId: string, additionalData?: any) => void;
  trackMotivation: (signalType: string, strength: number, context?: any) => void;
  trackCustomEvent: (eventName: string, eventData?: any) => void;
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

  // Update User-Level im Analytics Service wenn sich userProfile ändert
  useEffect(() => {
    const currentLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
    analyticsService.setUserLevel(currentLevel);
  }, [userProfile?.stats?.currentLevel, userProfile?.level]); // 🎯 NUR bei Level-Änderung neu laden!

  // Automatisches Screen-Tracking bei Navigation
  useFocusEffect(
    useCallback(() => {
      const screenName = pathname.replace(/^\//, '').replace(/\//g, '_') || 'home';
      const now = new Date();
      
      // Track Screen-Leave für vorherigen Screen (mit Verweildauer)
      if (lastScreenRef.current) {
        const dwellTime = now.getTime() - screenStartTimeRef.current.getTime();
        analyticsService.trackEvent({
          event_name: 'screen_left',
          event_category: 'navigation',
          screen_name: lastScreenRef.current,
          dwell_time_ms: dwellTime
        }, user?.uid);
      }

      // Track neuen Screen-View
      analyticsService.trackScreenView(screenName, user?.uid);
      
      // Update Refs für nächsten Screen-Wechsel
      lastScreenRef.current = screenName;
      screenStartTimeRef.current = now;
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

  const contextValue: AnalyticsContextType = {
    trackProductView,
    trackSearch,
    trackFilter,
    trackConversion,
    trackMotivation,
    trackCustomEvent
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
