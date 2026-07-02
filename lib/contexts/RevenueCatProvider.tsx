import * as Device from 'expo-device';
import { doc, setDoc } from '@react-native-firebase/firestore';
import { REVENUECAT_CONFIG } from '@/lib/config/revenueCatConfig';
import { db } from '@/lib/firebase';
import { revenueCatService } from '@/lib/services/revenueCatService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';

// T17.21: Premium-Cache so dass returning Premium-User beim App-Start
// NICHT erst "kein Premium" rendern (→ Ads / Buy-Button für 200-800ms
// sichtbar) und dann "doch Premium" (→ Pop weg). Wir cachen den
// letzten bekannten Wert lokal, hydraten als initial state, und
// schreiben bei jedem Statuswechsel zurück. RevenueCat ist Source of
// Truth, der Cache nur Bridge gegen die async-Latenz.
const PREMIUM_CACHE_KEY = 'premium_cache_v1';

const readCachedPremium = async (): Promise<boolean | null> => {
  try {
    const raw = await AsyncStorage.getItem(PREMIUM_CACHE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
};

const writeCachedPremium = (value: boolean) => {
  AsyncStorage.setItem(PREMIUM_CACHE_KEY, value ? 'true' : 'false').catch(() => {});
};

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
  // T17.21: Initial-State aus AsyncStorage-Cache hydratiert (siehe
  // Effect unten). Beim allerersten App-Open ist's `false` (also wie
  // vorher) — aber returning Premium-User starten mit `true` und sehen
  // KEINEN Pop wenn RC-Call später bestätigt.
  const [isPremium, setIsPremium] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offerings, setOfferings] = useState<any[]>([]);
  // 2.6a (Stufe 2): letzter nach Firestore gespiegelter Premium-Wert —
  // vermeidet redundante Writes bei jedem Refresh (nur bei echter Änderung).
  const lastSyncedPremiumRef = useRef<boolean | null>(null);

  // Hydrate from cache ONCE on mount (synchron-ish via useEffect ohne
  // Auth-Dep — feuert vor dem User-Effect). Hält den Fall ab dass
  // User-Effect verspätet feuert und initial-render trotzdem `false`
  // zeigt.
  useEffect(() => {
    let cancelled = false;
    readCachedPremium().then((cached) => {
      if (cancelled || cached === null) return;
      // Nur setzen wenn noch nicht durch RC-Call überschrieben.
      // RC-Service-Init dauert min. eine Round-Trip, der Cache-Read
      // ist immer schneller → kein Konflikt zu erwarten.
      setIsPremium(cached);
    });
    return () => { cancelled = true; };
  }, []);

  // Cache schreiben bei jedem isPremium-Wechsel (RC = Source of Truth,
  // Cache nur ein Hint für nächsten Boot).
  useEffect(() => {
    writeCachedPremium(isPremium);
  }, [isPremium]);

  // RevenueCat initialisieren wenn User sich ändert.
  // T17.21: KEIN paralleler Polling-Effect mehr (war Race-Condition).
  // KEIN reset-then-set-Trick in refreshPremiumStatus mehr (war Pop-
  // Ursache). State-Updates passieren direkt, einmal pro echter
  // Status-Änderung.
  const initRanRef = useRef(false);
  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const initializeRevenueCat = async () => {
      try {
        if (!initRanRef.current) {
          setIsLoading(true);
        }

        await revenueCatService.initialize(user?.uid);
        if (cancelled) return;

        if (user?.uid) {
          await revenueCatService.setUserId(user?.uid);
          if (cancelled) return;
        }

        // Ersten Premium-Status holen (cached innerhalb von RC SDK)
        try {
          const isPremiumUser = await revenueCatService.isPremium();
          if (cancelled) return;
          setIsPremium(isPremiumUser);

          // Sofortiger Server-Abgleich im Hintergrund (User-Vorgabe
          // 2026-06-11: "beim Start die Käufe checken — oft Werbung
          // trotz Premium"). Der isPremium()-Call oben bedient sich
          // aus dem RC-SDK-Cache — ist der stale-false (Kauf auf
          // anderem Gerät, abgelaufene TTL), bleibt Werbung sichtbar.
          // forceRefresh holt CustomerInfo frisch vom RC-Server;
          // danach liest isPremium() den frischen Cache. Fire-and-
          // forget: nur ein ERFOLGREICHER Refresh updated den State
          // (Netz-Fehler lassen den Cache-Wert unangetastet).
          revenueCatService
            .forceRefreshCustomerInfo()
            .then(async () => {
              if (cancelled) return;
              const premiumNow = await revenueCatService.isPremium();
              if (!cancelled) setIsPremium(premiumNow);
            })
            .catch(() => {});

          // Falls (noch) kein Premium: restore im Hintergrund versuchen.
          // Cleanup-Flag verhindert state-set nach Unmount.
          // NICHT im Simulator: restorePurchases triggert dort den
          // Sandbox-Apple-ID-Login-Prompt in Endlosschleife (Sim hat
          // keinen App-Store-Account) — blockiert jedes Sim-Testing.
          if (!isPremiumUser && Device.isDevice) {
            revenueCatService.restorePurchases()
              .then(async () => {
                if (cancelled) return;
                const isPremiumNow = await revenueCatService.isPremium();
                if (cancelled) return;
                if (isPremiumNow) setIsPremium(true);
              })
              .catch(() => {});
          }
        } catch {
          // Bei Fehler: cached value behalten, nicht künstlich auf false setzen
        }

        // Offerings parallel laden mit Timeout
        await Promise.race([
          loadOfferings(),
          new Promise<void>((resolve) =>
            setTimeout(() => resolve(), 10000)
          ),
        ]);
        if (cancelled) return;

        console.log('✅ RevenueCat Provider: Fully initialized');
      } catch (error) {
        console.error('❌ RevenueCat Provider initialization failed:', error);
        if (!cancelled) setOfferings([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          initRanRef.current = true;
        }
      }
    };

    initializeRevenueCat();
    return () => { cancelled = true; };
  }, [user?.uid]);

  const refreshPremiumStatus = async (forceRefresh: boolean = false) => {
    // T17.21: KEIN reset-then-set Trick mehr. setIsPremium nur einmal
    // mit dem echten Wert. React diffd selbst und re-rendert nur wenn
    // sich der Wert ändert — kein "Force-Flip" nötig.
    try {
      let premium: boolean;
      try {
        if (forceRefresh) {
          const customerInfo = await revenueCatService.forceRefreshCustomerInfo();
          premium = !!customerInfo?.entitlements?.active?.[REVENUECAT_CONFIG.ENTITLEMENTS.PREMIUM];
        } else {
          premium = await revenueCatService.isPremium();
        }
      } catch (error) {
        console.warn('⚠️ Premium Check fehlgeschlagen, nutze Fallback:', error);
        try {
          premium = await revenueCatService.isPremium();
        } catch {
          // Bei doppeltem Fail: bestehenden State nicht antasten.
          // Reset auf false würde alle Premium-User „depremium-en" bis
          // zum nächsten erfolgreichen Check — unerwünscht.
          return;
        }
      }
      setIsPremium(premium);
      console.log('🛒 Premium Status refreshed:', premium, forceRefresh ? '(forced)' : '(cached)');

      // 2.6a (Stufe 2): Premium-Status ins User-Doc spiegeln. RevenueCat bleibt
      // Source of Truth; das gespiegelte Feld liest nur das Umfrage-Targeting
      // (surveyTargeting) + der Kategorie-Zugang — vorher war es IMMER false,
      // sodass Premium-Umfragen Premium-User nie erreichten. Nur für nicht-
      // anonyme User + nur bei echter Wertänderung (spart Writes). `isPremium`
      // ist KEIN Geld-Feld → von den Stufe-0-Firestore-Rules erlaubt.
      const uid = user?.uid;
      if (uid && !(user as any)?.isAnonymous && lastSyncedPremiumRef.current !== premium) {
        lastSyncedPremiumRef.current = premium;
        setDoc(doc(db, 'users', uid), { isPremium: premium }, { merge: true }).catch((err) => {
          console.warn('⚠️ isPremium-Firestore-Sync fehlgeschlagen (nicht fatal):', err);
          lastSyncedPremiumRef.current = null; // Retry beim nächsten Refresh erlauben
        });
      }
    } catch (error) {
      console.error('❌ Error refreshing premium status:', error);
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
