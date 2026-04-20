import { REVENUECAT_CONFIG, isAdFreeCustomer } from '@/lib/config/revenueCatConfig';
import Constants from 'expo-constants';
import { LogBox, Platform } from 'react-native';

// RevenueCat Types
interface RevenueCatOffering {
  identifier: string;
  serverDescription: string;
  availablePackages: RevenueCatPackage[];
}

interface RevenueCatPackage {
  identifier: string;
  packageType: 'MONTHLY' | 'ANNUAL' | 'LIFETIME' | 'CUSTOM';
  product: {
    identifier: string;
    description: string;
    title: string;
    price: number;
    priceString: string;
    currencyCode: string;
  };
}

interface RevenueCatCustomerInfo {
  activeSubscriptions: string[];
  allPurchasedProductIdentifiers: string[];
  entitlements: {
    active: { [key: string]: any };
    all: { [key: string]: any };
  };
  originalAppUserId: string;
}

class RevenueCatService {
  private static instance: RevenueCatService;
  private _isInitialized = false;
  private isExpoGo = false;
  
  get isInitialized() {
    return this._isInitialized;
  }

  private constructor() {
    // Nur echtes Expo Go verwenden Fallback, nicht TestFlight!
    this.isExpoGo = Constants.appOwnership === 'expo';
    
    // Font-Fehler sofort unterdrücken (falls sehr früh auftreten)
    if (__DEV__ && !this.isExpoGo) {
      this.suppressRevenueCatFontErrors();
      
      // Zusätzlich: LogBox für RevenueCat Warnungen unterdrücken
      LogBox.ignoreLogs([
        'Font registration error',
        'fonts.pawwalls.com', 
        'Font registration was unsuccessful',
        'Error installing font',
        'RevenueCat.*font',
        'Paywall event flushing failed',
        'RevenueCat.BackendError',
        'The operation couldn\'t be completed',
      ]);
    }
    
    console.log('🛒 RevenueCat Service Detection:', {
      appOwnership: Constants.appOwnership,
      executionEnvironment: Constants.executionEnvironment,
      isDev: __DEV__,
      finalMode: this.isExpoGo ? 'Expo Go Fallback' : 'Native Mode'
    });
  }

  static getInstance(): RevenueCatService {
    if (!RevenueCatService.instance) {
      RevenueCatService.instance = new RevenueCatService();
    }
    return RevenueCatService.instance;
  }

  /**
   * RevenueCat initialisieren
   */
  async initialize(userId?: string): Promise<void> {
    if (this._isInitialized) return;

    console.log('🛒 RevenueCat: Starting initialization...', {
      isExpoGo: this.isExpoGo,
      userId: userId || 'none',
      platform: Platform.OS
    });

    try {
      if (this.isExpoGo) {
        console.log('🛒 RevenueCat: Expo Go detected - using fallback mode');
        this._isInitialized = true;
      return;
    }

      console.log('🛒 RevenueCat: Attempting native initialization...');

      // Native RevenueCat Import (nur wenn nicht Expo Go)
      let Purchases;
      try {
        Purchases = require('react-native-purchases');
      } catch (error) {
        // Fallback für dynamic import wenn require fehlschlägt
        Purchases = await import('react-native-purchases');
      }
      console.log('🛒 RevenueCat: Module imported successfully');

      // RevenueCat API Keys aus Config
      const apiKey = Platform.select({
        ios: REVENUECAT_CONFIG.API_KEYS.IOS,
        android: REVENUECAT_CONFIG.API_KEYS.ANDROID
      });

      console.log('🛒 RevenueCat: API Key selected for platform:', Platform.OS, apiKey ? 'Found' : 'Missing');

      if (!apiKey) {
        throw new Error(`RevenueCat API Key not configured for platform: ${Platform.OS}`);
      }

      // RevenueCat konfigurieren
      console.log('🛒 RevenueCat: Configuring with API key...');
      await Purchases.default.configure({
        apiKey,
        appUserID: userId || REVENUECAT_CONFIG.REVENUECAT_USER_ID,
        observerMode: false,
        userDefaultsSuiteName: undefined,
        useAmazon: false,
        // Font-Fehler in Development Builds unterdrücken
        shouldShowInAppMessagesAutomatically: false,
      });

      // Font-Unterdrückung bereits im Constructor aktiviert

      console.log('✅ RevenueCat initialized successfully');
      this._isInitialized = true;
      
    } catch (error) {
      console.error('❌ RevenueCat initialization failed:', error);
      console.error('❌ Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack',
        isExpoGo: this.isExpoGo,
        platform: Platform.OS
      });
      
      // Fallback zu Mock-Mode für Stabilität
      console.log('🛒 RevenueCat: Falling back to mock mode due to error');
      this.isExpoGo = true;
      this._isInitialized = true;
    }
  }

  /**
   * Verfügbare Offerings laden
   */
  async getOfferings(): Promise<RevenueCatOffering[]> {
    if (this.isExpoGo) {
      // Mock-Offerings für Expo Go
      return this.getMockOfferings();
    }

    try {
      const Purchases = require('react-native-purchases');
      const offerings = await Purchases.default.getOfferings();
      
      console.log('🛒 RevenueCat Offerings loaded:', Object.keys(offerings.all).length);
      
      return Object.values(offerings.all).map(offering => ({
        identifier: offering.identifier,
        serverDescription: offering.serverDescription,
        availablePackages: offering.availablePackages.map(pkg => ({
          identifier: pkg.identifier,
          packageType: pkg.packageType as any,
          product: {
            identifier: pkg.product.identifier,
            description: pkg.product.description,
            title: pkg.product.title,
            price: pkg.product.price,
            priceString: pkg.product.priceString,
            currencyCode: pkg.product.currencyCode,
          }
        }))
      }));
      
    } catch (error) {
      console.error('❌ Error loading RevenueCat offerings:', error);
      return this.getMockOfferings();
    }
  }

  /**
   * Kauf durchführen
   */
  async purchasePackage(packageIdentifier: string): Promise<{ success: boolean; customerInfo?: RevenueCatCustomerInfo }> {
    if (this.isExpoGo) {
      console.log('🛒 RevenueCat: Mock purchase in Expo Go:', packageIdentifier);
      // Mock successful purchase
      return {
        success: true,
        customerInfo: this.getMockCustomerInfo(true)
      };
    }

    try {
      const Purchases = require('react-native-purchases');
      const offerings = await Purchases.default.getOfferings();
      
      // Finde das Package
      let targetPackage: any = null;
      for (const offering of Object.values(offerings.all)) {
        targetPackage = offering.availablePackages.find(pkg => pkg.identifier === packageIdentifier);
        if (targetPackage) break;
      }

      if (!targetPackage) {
        throw new Error(`Package ${packageIdentifier} not found`);
      }

      // Kauf durchführen
      const { customerInfo } = await Purchases.default.purchasePackage(targetPackage);
      
      console.log('🛒 Purchase response - CustomerInfo:', {
        activeSubscriptions: customerInfo.activeSubscriptions,
        allPurchasedProducts: customerInfo.allPurchasedProductIdentifiers,
        entitlements: customerInfo.entitlements.active,
        entitlementKeys: Object.keys(customerInfo.entitlements.active || {}),
      });
      
      // Prüfe ob ein Ad-Free-Entitlement (neu oder legacy) aktiv ist.
      const isPremium = isAdFreeCustomer(customerInfo);

      console.log('✅ RevenueCat purchase completed:', {
        packageIdentifier,
        isPremium,
        adFreeEntitlement: REVENUECAT_CONFIG.ENTITLEMENTS.AD_FREE,
        activeEntitlements: Object.keys(customerInfo.entitlements.active || {}),
      });
      
      return {
        success: isPremium, // Nur true wenn wirklich Premium!
        customerInfo: {
          activeSubscriptions: customerInfo.activeSubscriptions,
          allPurchasedProductIdentifiers: customerInfo.allPurchasedProductIdentifiers,
          entitlements: {
            active: customerInfo.entitlements.active,
            all: customerInfo.entitlements.all,
          },
          originalAppUserId: customerInfo.originalAppUserId,
        }
      };
      
    } catch (error: any) {
      console.error('❌ RevenueCat purchase failed:', error);
      
      // User cancelled purchase
      if (error.userCancelled) {
        return { success: false };
      }
      
      throw error;
    }
  }

  /**
   * Käufe wiederherstellen
   */
  async restorePurchases(): Promise<RevenueCatCustomerInfo | void> {
    if (this.isExpoGo) {
      console.log('🛒 RevenueCat: Mock restorePurchases in Expo Go');
      return;
    }

    try {
      const Purchases = require('react-native-purchases');
      const customerInfo = await Purchases.default.restorePurchases();
      
      // Direkt Ad-Free Status loggen (neu + legacy).
      const hasPremium = isAdFreeCustomer(customerInfo);
      const hasAnyEntitlement = Object.keys(customerInfo?.entitlements?.active || {}).length > 0;
      const hasActiveSubscriptions = customerInfo?.activeSubscriptions?.length > 0;
      
      console.log('✅ RevenueCat Käufe wiederhergestellt:', {
        hasPremium,
        hasAnyEntitlement,
        hasActiveSubscriptions,
        activeSubscriptions: customerInfo?.activeSubscriptions || [],
        entitlements: Object.keys(customerInfo?.entitlements?.active || {})
      });
      
      return {
        activeSubscriptions: customerInfo.activeSubscriptions,
        allPurchasedProductIdentifiers: customerInfo.allPurchasedProductIdentifiers,
        entitlements: {
          active: customerInfo.entitlements.active,
          all: customerInfo.entitlements.all,
        },
        originalAppUserId: customerInfo.originalAppUserId,
      };
      
    } catch (error) {
      console.error('❌ Error restoring purchases:', error);
      // Kein Fehler werfen - App soll trotzdem funktionieren
    }
  }

  /**
   * Customer Info abrufen
   */
  async getCustomerInfo(): Promise<RevenueCatCustomerInfo> {
    if (this.isExpoGo) {
      return this.getMockCustomerInfo(false);
    }

    try {
      const Purchases = require('react-native-purchases');
      const customerInfo = await Purchases.default.getCustomerInfo();
      
      
      return {
        activeSubscriptions: customerInfo.activeSubscriptions,
        allPurchasedProductIdentifiers: customerInfo.allPurchasedProductIdentifiers,
        entitlements: {
          active: customerInfo.entitlements.active,
          all: customerInfo.entitlements.all,
        },
        originalAppUserId: customerInfo.originalAppUserId,
      };
      
    } catch (error) {
      console.error('❌ Error getting RevenueCat customer info:', error);
      return this.getMockCustomerInfo(false);
    }
  }

  /**
   * Premium Status prüfen
   */
  async isPremium(): Promise<boolean> {
    try {
      const customerInfo = await this.getCustomerInfo();
      
      // EINFACH: Hat der User IRGENDEIN aktives Entitlement?
      const hasAnyEntitlement = Object.keys(customerInfo.entitlements.active || {}).length > 0;
      
      // ODER: Hat der User aktive Subscriptions?
      const hasActiveSubscriptions = (customerInfo.activeSubscriptions?.length || 0) > 0;
      
      // Premium = IRGENDWAS aktiv
      return hasAnyEntitlement || hasActiveSubscriptions;

    } catch (error) {
      console.error('❌ Error checking premium status:', error);
      return false;
    }
  }

  /**
   * User ID setzen (für anonyme → registrierte User)
   */
  async setUserId(userId: string): Promise<void> {
    if (this.isExpoGo) {
      console.log('🛒 RevenueCat: Mock setUserId in Expo Go:', userId);
      return;
    }

    try {
      const Purchases = require('react-native-purchases');
      await Purchases.default.logIn(userId);
      console.log('✅ RevenueCat user ID set:', userId);
      
    } catch (error) {
      console.error('❌ Error setting RevenueCat user ID:', error);
    }
  }

  /**
   * RevenueCat Paywall anzeigen
   * @param context - Kontext für Analytics/A/B Testing ('onboarding', 'category_unlock', 'profile_upgrade', 'feature_gate')
   * @param offeringIdentifier - Spezifisches Offering (optional, wird automatisch aus Kontext bestimmt)
   */
  async presentPaywall(context?: string, offeringIdentifier?: string): Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }> {
    if (this.isExpoGo) {
      console.log('🛒 RevenueCat: Mock paywall in Expo Go');
      return { result: 'cancelled' };
    }

    try {
      // Automatische Offering-Auswahl basierend auf Kontext
      let targetOffering = offeringIdentifier;
      
      if (!targetOffering && context) {
        // v6: Nur noch zwei Paywall-Kontexte (Onboarding + Default).
        // Legacy-Kontext-Namen werden weiter akzeptiert, fallen aber alle
        // auf das DEFAULT-Offering zurück.
        targetOffering =
          context.toLowerCase() === 'onboarding'
            ? REVENUECAT_CONFIG.PAYWALL_CONTEXTS.ONBOARDING
            : REVENUECAT_CONFIG.PAYWALL_CONTEXTS.DEFAULT;
      }
      
      // Fallback zum Standard-Offering
      if (!targetOffering) {
        targetOffering = REVENUECAT_CONFIG.OFFERING_IDENTIFIER;
      }
      
      console.log('🛒 RevenueCat: Presenting paywall...', { 
        context: context || 'default',
        offering: targetOffering,
        autoSelected: !offeringIdentifier
      });
      
      const RevenueCatUI = require('react-native-purchases-ui');
      
      // Prüfe ob Offering existiert (verhindert Backend-Fehler)
      try {
        const Purchases = require('react-native-purchases');
        const offerings = await Purchases.default.getOfferings();
        
        if (!offerings.all[targetOffering]) {
          console.warn(`⚠️ Offering '${targetOffering}' nicht gefunden. Fallback zu 'current'.`);
          
          // Fallback zu current offering
          if (offerings.current) {
            targetOffering = offerings.current.identifier;
      } else {
            console.warn('⚠️ Kein current offering verfügbar. Verwende Standard.');
            targetOffering = REVENUECAT_CONFIG.OFFERING_IDENTIFIER;
          }
        }
      } catch (offeringError) {
        console.warn('⚠️ Konnte Offerings nicht laden:', offeringError);
        // Verwende trotzdem das gewünschte Offering
      }
      
      // React Native API: RevenueCatUI.presentPaywall()
      const result = await RevenueCatUI.default.presentPaywall({
        offering: targetOffering,
      });
      
      console.log('🛒 Paywall result:', result, 'Context:', context, 'Offering:', targetOffering);
      return { result: result.toLowerCase() as any };
      
    } catch (error) {
      console.error('❌ Error presenting paywall:', error);
      return { result: 'error' };
    }
  }

  /**
   * RevenueCat Paywall anzeigen wenn nicht Premium
   */
  async presentPaywallIfNeeded(): Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }> {
    if (this.isExpoGo) {
      console.log('🛒 RevenueCat: Mock paywall if needed in Expo Go');
      return { result: 'not_presented' };
    }

    try {
      console.log('🛒 RevenueCat: Attempting to present paywall if needed...');
      const RevenueCatUI = require('react-native-purchases-ui');
      
      // React Native API: RevenueCatUI.presentPaywallIfNeeded()
      // NOTE: Grandfathered users (LEGACY_PREMIUM) sehen hier ggf. die
      // Paywall erneut, bis das RC-Dashboard auf `ad_free` migriert wurde.
      const result = await RevenueCatUI.default.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: REVENUECAT_CONFIG.ENTITLEMENTS.AD_FREE,
      });
      
      console.log('🛒 Paywall if needed result:', result);
      return { result: result.toLowerCase() as any };
      
    } catch (error) {
      console.error('❌ Error presenting paywall if needed:', error);
      return { result: 'error' };
    }
  }

  /**
   * Mock-Offerings für Expo Go (echte Produkt-IDs)
   */
  private getMockOfferings(): RevenueCatOffering[] {
    return [
      {
        identifier: REVENUECAT_CONFIG.OFFERING_IDENTIFIER, // Echte Offering ID
        serverDescription: 'Premium Offering',
        availablePackages: [
          {
            identifier: REVENUECAT_CONFIG.PRODUCTS.WEEKLY,
            packageType: 'CUSTOM',
            product: {
              identifier: REVENUECAT_CONFIG.PRODUCTS.WEEKLY,
              description: 'Premium Zugang für eine Woche',
              title: 'Premium Wöchentlich',
              price: REVENUECAT_CONFIG.MOCK_PRICES.WEEKLY.price,
              priceString: REVENUECAT_CONFIG.MOCK_PRICES.WEEKLY.priceString,
              currencyCode: 'EUR',
            }
          },
          {
            identifier: REVENUECAT_CONFIG.PRODUCTS.MONTHLY,
            packageType: 'MONTHLY',
            product: {
              identifier: REVENUECAT_CONFIG.PRODUCTS.MONTHLY,
              description: 'Premium Zugang für einen Monat',
              title: 'Premium Monatlich',
              price: REVENUECAT_CONFIG.MOCK_PRICES.MONTHLY.price,
              priceString: REVENUECAT_CONFIG.MOCK_PRICES.MONTHLY.priceString,
              currencyCode: 'EUR',
            }
          },
          {
            identifier: REVENUECAT_CONFIG.PRODUCTS.ANNUAL,
            packageType: 'ANNUAL',
            product: {
              identifier: REVENUECAT_CONFIG.PRODUCTS.ANNUAL,
              description: 'Premium Zugang für ein Jahr',
              title: 'Premium Jährlich',
              price: REVENUECAT_CONFIG.MOCK_PRICES.ANNUAL.price,
              priceString: REVENUECAT_CONFIG.MOCK_PRICES.ANNUAL.priceString,
              currencyCode: 'EUR',
            }
          },
          {
            identifier: REVENUECAT_CONFIG.PRODUCTS.YEARLY_OFFER,
            packageType: 'ANNUAL',
            product: {
              identifier: REVENUECAT_CONFIG.PRODUCTS.YEARLY_OFFER,
              description: 'Premium Yearly Offer',
              title: 'Premium Yearly Special',
              price: REVENUECAT_CONFIG.MOCK_PRICES.YEARLY_OFFER.price,
              priceString: REVENUECAT_CONFIG.MOCK_PRICES.YEARLY_OFFER.priceString,
              currencyCode: 'EUR',
            }
          },
          {
            identifier: REVENUECAT_CONFIG.PRODUCTS.LIFETIME,
            packageType: 'LIFETIME',
            product: {
              identifier: REVENUECAT_CONFIG.PRODUCTS.LIFETIME,
              description: 'Premium Zugang für immer',
              title: 'Premium Lifetime',
              price: REVENUECAT_CONFIG.MOCK_PRICES.LIFETIME.price,
              priceString: REVENUECAT_CONFIG.MOCK_PRICES.LIFETIME.priceString,
              currencyCode: 'EUR',
            }
          }
        ]
      }
    ];
  }

  /**
   * Font-Fehler global unterdrücken (Development Build)
   */
  private suppressRevenueCatFontErrors(): void {
    if (!__DEV__) return;

    // Console.warn überschreiben
    const originalWarn = console.warn;
    const originalError = console.error;
    
    console.warn = (...args) => {
      const message = args.join(' ');
      if (this.isRevenueCatFontError(message)) {
        return; // RevenueCat Font-Fehler ignorieren
      }
      originalWarn.apply(console, args);
    };

    console.error = (...args) => {
      const message = args.join(' ');
      if (this.isRevenueCatFontError(message)) {
        return; // RevenueCat Font-Fehler ignorieren
      }
      originalError.apply(console, args);
    };

    console.log('🔇 RevenueCat Font-Fehler werden unterdrückt (Development Build)');
  }

  /**
   * Prüft ob es sich um einen RevenueCat Font-Fehler handelt
   */
  private isRevenueCatFontError(message: string): boolean {
    const errorPatterns = [
      // Font-Fehler
      'Font registration error',
      'fonts.pawwalls.com',
      'Font registration was unsuccessful',
      'RevenueCat.*font',
      'Error installing font',
      'pawwalls.com',
      '996728_', // RevenueCat Font-ID Pattern
      
      // Backend-Fehler (Development Build)
      'Paywall event flushing failed',
      'RevenueCat.BackendError',
      'The operation couldn\'t be completed',
      'will retry',
    ];

    return errorPatterns.some(pattern => 
      message.toLowerCase().includes(pattern.toLowerCase()) ||
      new RegExp(pattern, 'i').test(message)
    );
  }

  /**
   * Helper: Spezifische Paywall für Kontext anzeigen
   */
  async showOnboardingPaywall(): Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }> {
    return this.presentPaywall('onboarding');
  }

  /** @deprecated v6: Alle Kategorien außer Alkohol sind frei. Zeigt nun die Standard-Ad-Free-Paywall. */
  async showCategoryUnlockPaywall(): Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }> {
    return this.presentPaywall('default');
  }

  /** @deprecated v6: Profil-Upgrade entfällt, es gibt nur noch Ad-Free. Zeigt die Standard-Paywall. */
  async showProfileUpgradePaywall(): Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }> {
    return this.presentPaywall('default');
  }

  /** @deprecated v6: Feature-Gates entfallen, es gibt nur noch Ad-Free. Zeigt die Standard-Paywall. */
  async showFeatureGatePaywall(): Promise<{ result: 'purchased' | 'cancelled' | 'error' | 'not_presented' }> {
    return this.presentPaywall('default');
  }

  /**
   * Cache invalidieren und frische CustomerInfo holen
   * WICHTIG: Erzwingt Server-Call, umgeht Cache!
   */
  async invalidateCustomerInfoCache(): Promise<void> {
    if (this.isExpoGo) {
      console.log('🛒 Mock cache invalidation in Expo Go');
      return;
    }

    try {
      const Purchases = require('react-native-purchases');
      
      // Prüfen ob die Methode existiert
      if (typeof Purchases.default.invalidateCustomerInfoCache === 'function') {
        // RevenueCat API: invalidateCustomerInfoCache()
        // Löscht den lokalen Cache und erzwingt beim nächsten Call einen Server-Request
        await Purchases.default.invalidateCustomerInfoCache();
        console.log('🗑️ RevenueCat Cache invalidiert - nächster Call geht zum Server');
      } else {
        // Fallback: restorePurchases erzwingt auch einen Server-Call
        console.log('⚠️ invalidateCustomerInfoCache nicht verfügbar - nutze restorePurchases als Fallback');
        await this.restorePurchases();
      }
    } catch (error) {
      console.error('❌ Error invalidating cache:', error);
      // Keine Exception werfen - das würde die App crashen
    }
  }

  /**
   * Force-Refresh: Cache löschen UND sofort neue Daten holen
   * Perfekt für: Nach Kauf, bei Verdacht auf veraltete Daten
   */
  async forceRefreshCustomerInfo(): Promise<RevenueCatCustomerInfo> {
    if (this.isExpoGo) {
      return this.getMockCustomerInfo(false);
    }

    try {
      console.log('🔄 Force-Refresh CustomerInfo...');
      
      // 1. Versuche Cache zu invalidieren (optional, kann fehlschlagen)
      try {
        await this.invalidateCustomerInfoCache();
      } catch (error) {
        console.warn('⚠️ Cache invalidation fehlgeschlagen, fahre fort:', error);
      }
      
      // 2. Sofort neue Daten holen
      const customerInfo = await this.getCustomerInfo();
      
      console.log('✅ Force-Refresh erfolgreich:', {
        activeSubscriptions: customerInfo.activeSubscriptions?.length || 0,
        hasPremium: isAdFreeCustomer(customerInfo),
      });
      
      return customerInfo;
    } catch (error) {
      console.error('❌ Force-Refresh fehlgeschlagen:', error);
      // Fallback zu normalem getCustomerInfo
      try {
        return await this.getCustomerInfo();
      } catch (fallbackError) {
        console.error('❌ Auch Fallback fehlgeschlagen:', fallbackError);
        // Return mock data to prevent crash
        return this.getMockCustomerInfo(false);
      }
    }
  }

  /**
   * Smart Premium Check mit Fallback
   * 1. Schneller Cache-Check
   * 2. Bei Unsicherheit: Force-Refresh
   */
  async isPremiumWithFallback(forceRefresh: boolean = false): Promise<boolean> {
    try {
      if (forceRefresh) {
        const customerInfo = await this.forceRefreshCustomerInfo();
        return isAdFreeCustomer(customerInfo);
      }
      
      // Normaler Check
      return await this.isPremium();
    } catch (error) {
      console.error('❌ Premium check with fallback failed:', error);
      return false;
    }
  }

  /**
   * Debug-Funktion: Zeigt alle RevenueCat Details
   */
  async debugPremiumStatus(): Promise<void> {
    console.log('🔍 === RevenueCat Debug Info ===');
    console.log('Initialized:', this._isInitialized);
    console.log('Is Expo Go:', this.isExpoGo);
    console.log('Entitlement Name (primary):', REVENUECAT_CONFIG.ENTITLEMENTS.AD_FREE);
    console.log('Entitlement Name (legacy):', REVENUECAT_CONFIG.ENTITLEMENTS.LEGACY_PREMIUM);
    
    if (!this._isInitialized) {
      console.log('❌ RevenueCat nicht initialisiert!');
      return;
    }
    
    try {
      const customerInfo = await this.getCustomerInfo();
      console.log('📊 Customer Info:', {
        activeSubscriptions: customerInfo.activeSubscriptions,
        allPurchased: customerInfo.allPurchasedProductIdentifiers,
        entitlementsActive: customerInfo.entitlements.active,
        entitlementKeys: Object.keys(customerInfo.entitlements.active || {})
      });
      
      const isPremium = await this.isPremium();
      console.log('✅ isPremium Result:', isPremium);
      
    } catch (error) {
      console.error('❌ Debug Error:', error);
    }
    console.log('🔍 === Ende Debug Info ===');
  }

  /**
   * Mock Customer Info für Expo Go
   */
  private getMockCustomerInfo(isPremium: boolean): RevenueCatCustomerInfo {
    return {
      activeSubscriptions: isPremium ? ['premium_monthly'] : [],
      allPurchasedProductIdentifiers: isPremium ? ['premium_monthly'] : [],
      entitlements: {
        active: isPremium ? { [REVENUECAT_CONFIG.ENTITLEMENTS.AD_FREE]: { isActive: true } } : {},
        all: { [REVENUECAT_CONFIG.ENTITLEMENTS.AD_FREE]: { isActive: isPremium } },
      },
      originalAppUserId: 'mock_user_id',
    };
  }
}

// Singleton Export
export const revenueCatService = RevenueCatService.getInstance();
