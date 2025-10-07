import { revenueCatService } from '@/lib/services/revenueCatService';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';

interface RevenueCatContextType {
  isPremium: boolean;
  isLoading: boolean;
  offerings: any[];
  purchasePackage: (packageId: string) => Promise<boolean>;
  restorePurchases: () => Promise<void>;
  refreshPremiumStatus: () => Promise<void>;
  presentPaywall: (context?: string, offeringId?: string) => Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }>;
  presentPaywallIfNeeded: () => Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }>;
  // Helper-Funktionen für spezifische Paywalls
  showOnboardingPaywall: () => Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }>;
  showCategoryUnlockPaywall: () => Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }>;
  showProfileUpgradePaywall: () => Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }>;
  showFeatureGatePaywall: () => Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }>;
}

const RevenueCatContext = createContext<RevenueCatContextType | undefined>(undefined);

export const useRevenueCat = () => {
  const context = useContext(RevenueCatContext);
  if (!context) {
    throw new Error('useRevenueCat must be used within a RevenueCatProvider');
  }
  return context;
};

interface RevenueCatProviderProps {
  children: React.ReactNode;
}

export const RevenueCatProvider: React.FC<RevenueCatProviderProps> = ({ children }) => {
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offerings, setOfferings] = useState<any[]>([]);
  const [hasCheckedInitialStatus, setHasCheckedInitialStatus] = useState(false);
  

  // RevenueCat initialisieren wenn User sich ändert
  useEffect(() => {
    const initializeRevenueCat = async () => {
      try {
        setIsLoading(true);
        
        // RevenueCat mit User ID initialisieren
        await revenueCatService.initialize(user?.uid);
        
        // User ID setzen falls bereits initialisiert
        if (user?.uid) {
          await revenueCatService.setUserId(user?.uid);
        }
        
        // EINFACH: Nur getCustomerInfo, kein restore beim Start!
        try {
          const isPremiumUser = await revenueCatService.isPremium();
          setIsPremium(isPremiumUser);
          
          // Falls kein Premium, trotzdem im Hintergrund restore versuchen
          if (!isPremiumUser) {
            // Async im Hintergrund, blockiert nicht
            revenueCatService.restorePurchases()
              .then(async () => {
                // Nochmal checken nach restore
                const isPremiumNow = await revenueCatService.isPremium();
                if (isPremiumNow && !isPremiumUser) {
                  setIsPremium(true);
                }
              })
              .catch(() => {}); // Ignoriere Fehler
          }
        } catch (error) {
          // Bei Fehler: Kein Premium
          setIsPremium(false);
        }
        
        // Premium Status und Offerings laden (mit Timeout)
        const loadPromises = [
          refreshPremiumStatus(),
          loadOfferings()
        ];
        
        // 10 Sekunden Timeout für RevenueCat Calls
        await Promise.race([
          Promise.all(loadPromises),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('RevenueCat timeout')), 10000)
          )
        ]);

        console.log('✅ RevenueCat Provider: Fully initialized');

      } catch (error) {
        console.error('❌ RevenueCat Provider initialization failed:', error);
        // App soll trotzdem funktionieren - setze Safe Defaults
        setIsPremium(false);
        setOfferings([]);
        console.log('🛒 RevenueCat Provider: Using safe defaults due to error');
      } finally {
        setIsLoading(false);
        setHasCheckedInitialStatus(true);
      }
    };

    // Nur initialisieren wenn User vorhanden (verhindert Race Conditions)
    if (user) {
      initializeRevenueCat();
    } else {
      setIsLoading(false);
    }
  }, [user?.uid]);
  
  // SOFORTIGER Premium-Check beim App-Start (ohne Verzögerung!)
  useEffect(() => {
    // Skip wenn kein User - wird automatisch nochmal laufen wenn User kommt
    if (!user) return;
    
    const checkPremiumOnMount = async () => {
      
      // Warte kurz bis RevenueCat ready ist
      let retries = 0;
      const maxRetries = 10;
      
      while (retries < maxRetries) {
        try {
          if (revenueCatService.isInitialized) {
            const isPremiumNow = await revenueCatService.isPremium();
            setIsPremium(isPremiumNow);
            console.log('✅ App-Start Premium Check:', isPremiumNow ? 'PREMIUM AKTIV' : 'Kein Premium');
            break;
          }
        } catch (error) {
          console.log('⏳ Warte auf RevenueCat...', retries);
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
        retries++;
      }
    };
    
    checkPremiumOnMount();
  }, [user]);

  const refreshPremiumStatus = async (forceRefresh: boolean = false) => {
    try {
      console.log('🛒 Refreshing premium status...', { forceRefresh });
      
      let premium: boolean;
      
      try {
        if (forceRefresh) {
          // FORCE REFRESH: Cache löschen und neu laden
          const customerInfo = await revenueCatService.forceRefreshCustomerInfo();
          premium = !!customerInfo?.entitlements?.active?.[REVENUECAT_CONFIG.ENTITLEMENTS.PREMIUM];
        } else {
          // Normal: Cache nutzen für Speed
          premium = await revenueCatService.isPremium();
        }
      } catch (error) {
        console.warn('⚠️ Premium Check fehlgeschlagen, nutze Fallback:', error);
        // Fallback: Versuche normalen Check
        try {
          premium = await revenueCatService.isPremium();
        } catch (fallbackError) {
          console.error('❌ Auch Fallback fehlgeschlagen:', fallbackError);
          premium = false;
        }
      }
      
      // Force State Update auch wenn Wert gleich ist
      setIsPremium(false); // Reset
      setTimeout(() => setIsPremium(premium), 100); // Dann setzen
      
      console.log('🛒 Premium Status refreshed:', premium, forceRefresh ? '(forced)' : '(cached)');
    } catch (error) {
      console.error('❌ Error refreshing premium status:', error);
      setIsPremium(false);
    }
  };

  const loadOfferings = async () => {
    try {
      const loadedOfferings = await revenueCatService.getOfferings();
      setOfferings(loadedOfferings);
      console.log('🛒 Offerings loaded:', loadedOfferings.length);
    } catch (error) {
      console.error('❌ Error loading offerings:', error);
      setOfferings([]);
    }
  };

  const purchasePackage = async (packageId: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      
      const result = await revenueCatService.purchasePackage(packageId);
      
      if (result.success) {
        // Premium Status aktualisieren
        await refreshPremiumStatus();
        console.log('✅ Purchase successful:', packageId);
        return true;
      }
      
      return false;

    } catch (error: any) {
      console.error('❌ Purchase failed:', error);
      
      // User cancelled - kein Fehler
      if (error.userCancelled) {
        return false;
      }
      
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const restorePurchases = async () => {
    try {
      setIsLoading(true);
      
      if (revenueCatService['isExpoGo']) {
        console.log('🛒 RevenueCat: Mock restore in Expo Go');
        return;
      }

      const Purchases = await import('react-native-purchases');
      await Purchases.default.restorePurchases();
      
      // Premium Status aktualisieren
      await refreshPremiumStatus();
      console.log('✅ Purchases restored');

    } catch (error) {
      console.error('❌ Error restoring purchases:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const presentPaywall = async (context?: string, offeringId?: string) => {
    const result = await revenueCatService.presentPaywall(context, offeringId);
    
    // IMMER Premium Status prüfen nach Paywall (egal ob gekauft oder nicht!)
    console.log('🛒 Paywall geschlossen - prüfe Premium Status...');
    await refreshPremiumStatus();
    
    // Bei Kauf extra sicherstellen
    if (result.result === 'purchased') {
      console.log('✅ Kauf erkannt - Premium sollte jetzt aktiv sein');
      // Nochmal nach kurzer Verzögerung prüfen
      setTimeout(async () => {
        await refreshPremiumStatus();
      }, 500);
    }
    
    return result;
  };

  const presentPaywallIfNeeded = async () => {
    const result = await revenueCatService.presentPaywallIfNeeded();
    
    // IMMER Premium Status prüfen nach Paywall
    console.log('🛒 PaywallIfNeeded geschlossen - prüfe Premium Status...');
    await refreshPremiumStatus();
    
    // Bei Kauf extra sicherstellen mit FORCE REFRESH
    if (result.result === 'purchased') {
      console.log('✅ Kauf erkannt - Force Refresh für sofortige Aktivierung');
      setTimeout(async () => {
        await refreshPremiumStatus(true); // FORCE = Cache bypass!
      }, 500);
    }
    
    return result;
  };

  // Helper-Funktionen für spezifische Paywalls
  const showOnboardingPaywall = async () => {
    const result = await revenueCatService.showOnboardingPaywall();
    if (result.result === 'purchased') {
      await refreshPremiumStatus();
    }
    return result;
  };

  const showCategoryUnlockPaywall = async () => {
    const result = await revenueCatService.showCategoryUnlockPaywall();
    if (result.result === 'purchased') {
      await refreshPremiumStatus();
    }
    return result;
  };

  const showProfileUpgradePaywall = async () => {
    const result = await revenueCatService.showProfileUpgradePaywall();
    if (result.result === 'purchased') {
      await refreshPremiumStatus();
    }
    return result;
  };

  const showFeatureGatePaywall = async () => {
    const result = await revenueCatService.showFeatureGatePaywall();
    if (result.result === 'purchased') {
      await refreshPremiumStatus();
    }
    return result;
  };

  const value: RevenueCatContextType = {
    isPremium,
    isLoading,
    offerings,
    purchasePackage,
    restorePurchases,
    refreshPremiumStatus,
    presentPaywall,
    presentPaywallIfNeeded,
    showOnboardingPaywall,
    showCategoryUnlockPaywall,
    showProfileUpgradePaywall,
    showFeatureGatePaywall,
  };

  return (
    <RevenueCatContext.Provider value={value}>
      {children}
    </RevenueCatContext.Provider>
  );
};
