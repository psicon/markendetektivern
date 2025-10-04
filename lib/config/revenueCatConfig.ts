/**
 * RevenueCat Konfiguration
 * Zentrale Stelle für alle RevenueCat-bezogenen Einstellungen
 */

export const REVENUECAT_CONFIG = {
  // Projekt-Konfiguration
  PROJECT_ID: '70e04385',
  
  // API Keys
  API_KEYS: {
    IOS: 'appl_iQGRbkxjSgJilMZzERbwGVIkwIE',
    ANDROID: 'goog_rqEHCmPiwAkDnfTSbzzNulNAzLO',
  },
  
  // Default Offering
  OFFERING_IDENTIFIER: 'Premium',
  REVENUECAT_USER_ID: 'ofrngde415faa40',
  
  // Verschiedene Paywall-Kontexte mit spezifischen Offerings
  PAYWALL_CONTEXTS: {
    ONBOARDING: 'Onboarding',        // Nach Onboarding - spezielle Onboarding Paywall
    CATEGORY_UNLOCK: 'CategoryUnlock', // Gesperrte Kategorie - Feature Gate Paywall
    PROFILE_UPGRADE: 'ProfileUpgrade', // "Premium Mitglied werden" - Upgrade Paywall
    FEATURE_GATE: 'Premium',         // Standard Feature-Gate
    DEFAULT: 'Premium',              // Fallback
  },
  
  // Produkt-IDs (wie in RevenueCat Dashboard konfiguriert)
  PRODUCTS: {
    WEEKLY: '$rc_weekly',
    MONTHLY: '$rc_monthly', 
    ANNUAL: '$rc_annual',
    YEARLY_OFFER: 'premiumyearly', // Spezial-Angebot
    LIFETIME: '$rc_lifetime',
  },
  
  // Entitlements
  ENTITLEMENTS: {
    PREMIUM: 'MarkenDetektive Premium', // Hauptentitlement für Premium-Features
  },
  
  // Mock-Preise für Expo Go (echte Preise kommen von RevenueCat Dashboard)
  MOCK_PRICES: {
    WEEKLY: { price: 4.99, priceString: 'Lädt...' },
    MONTHLY: { price: 9.99, priceString: 'Lädt...' },
    ANNUAL: { price: 19.99, priceString: 'Lädt...' },
    YEARLY_OFFER: { price: 9.99, priceString: 'Lädt...' },
    LIFETIME: { price: 34.99, priceString: 'Lädt...' },
  },
} as const;

// Type-safe Product IDs
export type ProductId = keyof typeof REVENUECAT_CONFIG.PRODUCTS;
export type EntitlementId = keyof typeof REVENUECAT_CONFIG.ENTITLEMENTS;
