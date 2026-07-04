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

// Boot-Restore-Throttle (User-Anforderung 2026-07-04 „Premium wird oft
// nicht sauber gezogen"): Ergebnis + Zeitpunkt des letzten erfolgreichen
// Restores persistieren. Ein kürzlich (<30 Tage) Restore-validiertes
// "kein Premium" wird beim Boot NICHT erneut restored (kein StoreKit-
// Hammering bei jedem Start); ein persistiertes true bei SDK-false ist
// dagegen GENAU der "Premium verloren"-Fall → Restore sofort, ohne
// Throttle. Key device-global wie premium_cache_v1 (Premium hängt am
// Store-Account, nicht an der uid). Einziger Schreiber: dieses File.
const BOOT_RESTORE_KEY = 'premium_boot_restore_v1';
const BOOT_RESTORE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

type BootRestoreRecord = { at: number; result: boolean };

const readBootRestoreRecord = async (): Promise<BootRestoreRecord | null> => {
  try {
    const raw = await AsyncStorage.getItem(BOOT_RESTORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.at !== 'number' || typeof parsed?.result !== 'boolean') return null;
    return parsed as BootRestoreRecord;
  } catch {
    return null;
  }
};

const writeBootRestoreRecord = (result: boolean) => {
  AsyncStorage.setItem(BOOT_RESTORE_KEY, JSON.stringify({ at: Date.now(), result })).catch(
    () => {},
  );
};

const isFreshRestoreRecord = (rec: BootRestoreRecord | null): rec is BootRestoreRecord => {
  if (!rec || !Number.isFinite(rec.at)) return false;
  const age = Date.now() - rec.at;
  return Number.isFinite(age) && age >= 0 && age < BOOT_RESTORE_COOLDOWN_MS;
};

interface RevenueCatContextType {
  isPremium: boolean;
  /** true, sobald der Status aus einer VERLÄSSLICHEN Quelle stammt
   *  (lokaler Cache-Hit, bestätigter SDK-Read oder Update-Listener).
   *  Solange false: Status ist UNBEKANNT — nicht als "kein Premium"
   *  behandeln! */
  premiumKnown: boolean;
  /** Werbe-Gate: NUR true, wenn BESTÄTIGT kein Premium vorliegt.
   *  Bei unbekanntem Status → keine Ads (fail-closed zugunsten
   *  zahlender Kunden). Alle Ad-Callsites nutzen DIESES Flag,
   *  nicht !isPremium. */
  showAds: boolean;
  /** Content-Gate (z.B. Premium-Kategorien): unbekannter Status wird
   *  wie Premium behandelt, damit zahlende Kunden im Boot-Fenster
   *  keine Sperren/Upsells sehen. */
  isPremiumEffective: boolean;
  isLoading: boolean;
  offerings: any[];
  purchasePackage: (packageId: string) => Promise<boolean>;
  restorePurchases: () => Promise<void>;
  /** Liefert den frischen Status (true/false) oder null, wenn er nicht
   *  ermittelt werden konnte — Caller dürfen null NICHT als false lesen. */
  refreshPremiumStatus: (forceRefresh?: boolean) => Promise<boolean | null>;
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
  // Premium-Boot-Fix 2026-07: false = Status UNBEKANNT (weder Cache-Hit
  // noch SDK-Bestätigung). Konsumenten (Ads/Paywall/Kategorien) dürfen
  // "unbekannt" NIE als "kein Premium" behandeln — das war die Ursache
  // für "Premium-User sieht beim Start Werbung".
  const [premiumKnown, setPremiumKnown] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [offerings, setOfferings] = useState<any[]>([]);
  // 2.6a (Stufe 2): letzter nach Firestore gespiegelter Premium-Wert —
  // vermeidet redundante Writes bei jedem Refresh (nur bei echter Änderung).
  const lastSyncedPremiumRef = useRef<boolean | null>(null);
  // true, sobald ein SDK-BESTÄTIGTER Wert gesetzt wurde — der (langsamere)
  // Cache-Hydrate darf ihn dann nicht mehr überschreiben (Ref statt
  // Timing-Annahme).
  const sdkConfirmedRef = useRef(false);

  /** Einzige Stelle, die einen VERLÄSSLICHEN Status setzt (SDK/Listener). */
  const confirmPremium = (value: boolean) => {
    sdkConfirmedRef.current = true;
    setIsPremium(value);
    setPremiumKnown(true);
  };

  // Hydrate from cache ONCE on mount (synchron-ish via useEffect ohne
  // Auth-Dep — feuert vor dem User-Effect). Hält den Fall ab dass
  // User-Effect verspätet feuert und initial-render trotzdem `false`
  // zeigt.
  useEffect(() => {
    let cancelled = false;
    readCachedPremium().then((cached) => {
      if (cancelled || cached === null) return;
      if (sdkConfirmedRef.current) return; // SDK war schneller — nicht überschreiben
      setIsPremium(cached);
      setPremiumKnown(true);
    });
    return () => { cancelled = true; };
  }, []);

  // Cache schreiben — NUR verlässliche Werte (premiumKnown). Vorher schrieb
  // der Effect auch das initiale/fehlerinduzierte false und vergiftete damit
  // den nächsten Boot (Symptom "Werbung bleibt oft").
  useEffect(() => {
    if (premiumKnown) writeCachedPremium(isPremium);
  }, [isPremium, premiumKnown]);

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
    let unsubscribePremium: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const initializeRevenueCat = async (attempt = 0) => {
      try {
        if (!initRanRef.current) {
          setIsLoading(true);
        }

        await revenueCatService.initialize(user?.uid);
        if (cancelled) return;

        // Premium-Boot-Fix 2026-07: init-Fehler kippt den Service nicht
        // mehr in den Mock-Mode (= dauerhaft false), sondern lässt ihn
        // uninitialisiert → hier mit Backoff erneut versuchen. Bis dahin
        // liefern die Status-Reads null (unbekannt) statt false.
        if (revenueCatService.needsInitialization) {
          if (attempt < 3) {
            retryTimer = setTimeout(() => {
              if (!cancelled) void initializeRevenueCat(attempt + 1);
            }, 3000 * (attempt + 1));
          }
          return;
        }

        if (user?.uid) {
          await revenueCatService.setUserId(user?.uid);
          if (cancelled) return;
        }

        // Push-Korrektiv: RC meldet Käufe/Renewals (auch von anderen
        // Geräten) aktiv. REGRESSION-FIX 2026-07-02: NUR-TRUE-Semantik!
        // Der Listener feuert bei der Registrierung sofort mit der
        // gecachten CustomerInfo — bei Receipt-gebundenem Premium (Kauf
        // hängt am Apple-Account, nicht am RC-User der uid) ist die OHNE
        // Entitlement → ein confirm(false) hier vergiftete Cache+State,
        // BEVOR der Boot-Restore das Premium zurückholen konnte („Premium
        // wird GAR NICHT mehr erkannt"). Downgrades laufen ausschließlich
        // über den Restore-Pfad unten bzw. explizite Force-Refreshes.
        unsubscribePremium = revenueCatService.onPremiumChanged((premium) => {
          if (!cancelled && premium === true) confirmPremium(true);
        });

        // Ersten Premium-Status holen (cached innerhalb von RC SDK).
        // isPremiumOrNull maskiert Fehler NICHT als false: null = Status
        // unbekannt → bestehenden (Cache-)Wert behalten.
        const isPremiumUser = await revenueCatService.isPremiumOrNull();
        if (cancelled) return;
        if (isPremiumUser === true) confirmPremium(true);

        // Sofortiger Server-Abgleich im Hintergrund — NUR-TRUE: er läuft
        // PARALLEL zum Restore und darf dessen Ergebnis (oder den
        // Cache-Wert) nicht mit einem Vor-Restore-false überschreiben.
        revenueCatService
          .forceRefreshPremiumOrNull()
          .then((premiumNow) => {
            if (!cancelled && premiumNow === true) confirmPremium(true);
          })
          .catch(() => {});

        if (isPremiumUser === false) {
          if (Device.isDevice) {
            // Restore-first: Ein „kein Premium" ist erst FINAL, wenn der
            // Restore-Versuch durch ist (Receipt-Sync). Das Ergebnis kommt
            // DIREKT aus der restore-CustomerInfo — kein zweiter Cache-
            // Read (der stale sein konnte: „Restore bringt es nur
            // MANCHMAL zurück"). NICHT im Simulator: restorePurchases
            // triggert dort den Sandbox-Apple-ID-Prompt in Endlosschleife.
            // GEDROSSELT (2026-07-04): ein <30 Tage altes, Restore-
            // validiertes false gilt ohne erneuten StoreKit-Restore.
            void (async () => {
              const rec = await readBootRestoreRecord();
              if (cancelled) return;
              if (isFreshRestoreRecord(rec) && rec.result === false) {
                // Kürzlich per Restore bestätigt: wirklich kein Premium →
                // SDK-false darf ohne neuen Restore final werden.
                confirmPremium(false);
                return;
              }
              // Kein/veralteter Datensatz ODER zuletzt true (= Premium
              // verloren → sofort zurückholen, kein Throttle für Kunden).
              const restored = await revenueCatService.restorePremiumOrNull().catch(() => null);
              if (cancelled || restored === null) return; // Fehler: nichts persistieren/confirmen
              writeBootRestoreRecord(restored);
              confirmPremium(restored);
            })();
          } else {
            // Simulator: kein Restore möglich → SDK-false gilt.
            confirmPremium(false);
          }
        } else if (isPremiumUser === null && Device.isDevice) {
          // NEU (User-Report „Premium wird oft nicht sauber gezogen"):
          // auch bei UNBEKANNTEM SDK-Status (Offline-Start, SDK-Fehler)
          // einen Restore versuchen — aber NUR-TRUE übernehmen (Forbidden
          // Pattern 18cc685: unbekannt darf nie als false enden). Ein
          // frisches Restore-Record blockt auch hier (kürzlich validiert).
          void (async () => {
            const rec = await readBootRestoreRecord();
            if (cancelled || isFreshRestoreRecord(rec)) return;
            const restored = await revenueCatService.restorePremiumOrNull().catch(() => null);
            if (cancelled) return;
            if (restored === true) {
              writeBootRestoreRecord(true);
              confirmPremium(true);
            }
            // false bei unbekanntem Ausgangsstatus: weder confirmen noch
            // persistieren — der nächste saubere SDK-Read entscheidet.
          })();
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
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribePremium?.();
    };
  }, [user?.uid]);

  const refreshPremiumStatus = async (forceRefresh: boolean = false): Promise<boolean | null> => {
    // T17.21: KEIN reset-then-set Trick mehr. setIsPremium nur einmal
    // mit dem echten Wert. Premium-Boot-Fix 2026-07: über die ehrlichen
    // *OrNull-Reads — null (Status unbekannt) lässt den bestehenden State
    // unangetastet und wird an den Caller durchgereicht (Caller dürfen
    // null NICHT als "kein Premium" behandeln).
    try {
      const premium = forceRefresh
        ? await revenueCatService.forceRefreshPremiumOrNull()
        : await revenueCatService.isPremiumOrNull();
      if (premium === null) {
        console.warn('⚠️ Premium Check: Status unbekannt — State unverändert.');
        return null;
      }
      confirmPremium(premium);
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
      return premium;
    } catch (error) {
      console.error('❌ Error refreshing premium status:', error);
      return null;
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

      // REGRESSION-FIX 2026-07-02: Das Restore-Ergebnis kommt DIREKT aus
      // der vom SDK zurückgegebenen CustomerInfo. Vorher lief danach ein
      // separater Cache-Read (refreshPremiumStatus), der stale sein konnte
      // → „Käufe wiederherstellen bringt es nur MANCHMAL zurück".
      const restored = await revenueCatService.restorePremiumOrNull();
      if (restored !== null) {
        // Manueller Restore resettet die 30-Tage-Uhr des Boot-Restores mit.
        writeBootRestoreRecord(restored);
        confirmPremium(restored);
      }
      console.log('✅ Purchases restored, premium:', restored);

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
    premiumKnown,
    // Ads NUR bei bestätigtem "kein Premium" — unbekannter Status zeigt
    // keine Werbung (fail-closed für zahlende Kunden; Free-User sehen die
    // erste Ad wenige hundert ms später, sobald Cache/SDK geantwortet hat).
    showAds: premiumKnown && !isPremium,
    // Content-Gates (Premium-Kategorien etc.): unbekannt = wie Premium
    // behandeln, damit keine Sperren/Upsells im Boot-Fenster aufblitzen.
    isPremiumEffective: isPremium || !premiumKnown,
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
