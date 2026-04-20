/**
 * RevenueCat Konfiguration
 *
 * v6-Umstellung (siehe docs/DESIGN_SYSTEM.md §15):
 *  - Das einzige app-seitig genutzte Entitlement ist künftig `ad_free`
 *    (blendet Banner + Interstitial aus).
 *  - `LEGACY_PREMIUM` bleibt definiert, damit bestehende Abonnenten mit dem
 *    alten Entitlement-Namen `"MarkenDetektive Premium"` weiter ad-free
 *    bleiben, bis das RevenueCat-Dashboard auf `ad_free` migriert wurde.
 *
 * Dashboard-Koordination (offen, nicht im Code zu lösen):
 *  - In RevenueCat ein Entitlement `ad_free` anlegen.
 *  - Bestehende Produkte (weekly/monthly/annual/lifetime) an `ad_free` knüpfen.
 *  - Bestehende aktive Subs temporär auf BEIDE Entitlements mappen oder
 *    per RC-Sync-Migration auf `ad_free` umstellen.
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
  OFFERING_IDENTIFIER: 'AdFree',
  REVENUECAT_USER_ID: 'ofrngde415faa40',

  /**
   * Nur noch zwei Kontexte, beide zeigen die gleiche Ad-Free-Paywall.
   * Kategorie- / Profil-Upgrade-Paywalls entfallen komplett, da alle
   * Inhalte frei sind (Alkohol wird per Level-3-Gate + Rewarded Ad
   * kontrolliert, siehe categoryAccessService).
   */
  PAYWALL_CONTEXTS: {
    ONBOARDING: 'AdFreeOnboarding',
    DEFAULT: 'AdFree',
  },

  // Produkt-IDs (wie in RevenueCat Dashboard konfiguriert)
  PRODUCTS: {
    WEEKLY: '$rc_weekly',
    MONTHLY: '$rc_monthly',
    ANNUAL: '$rc_annual',
    YEARLY_OFFER: 'premiumyearly', // Spezial-Angebot
    LIFETIME: '$rc_lifetime',
  },

  /**
   * Entitlements.
   *  - `AD_FREE`: neues primäres Entitlement. Alle Subs werden künftig darauf
   *    gemappt.
   *  - `LEGACY_PREMIUM`: Grandfathering für bestehende Abonnenten, bis das
   *    RC-Dashboard migriert ist. Entfernen sobald Migration abgeschlossen.
   */
  ENTITLEMENTS: {
    AD_FREE: 'ad_free',
    LEGACY_PREMIUM: 'MarkenDetektive Premium',
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

/**
 * Liste aller Entitlement-Strings, die "Ad-Free" gewähren.
 * Der Service-Layer prüft, ob einer davon in `customerInfo.entitlements.active`
 * steht. So bleiben Grandfathered Users bis zur Dashboard-Migration ad-free.
 */
export const AD_FREE_ENTITLEMENTS: readonly string[] = [
  REVENUECAT_CONFIG.ENTITLEMENTS.AD_FREE,
  REVENUECAT_CONFIG.ENTITLEMENTS.LEGACY_PREMIUM,
];

/**
 * True, wenn das übergebene `customerInfo` (RevenueCat CustomerInfo) einen
 * Ad-Free-Zugang hat — entweder via neuem `ad_free` oder via altem
 * `MarkenDetektive Premium` (Grandfathering).
 *
 * Akzeptiert `any` da `react-native-purchases` nicht in jedem Build-Kontext
 * verfügbar ist (Expo Go nutzt Mock-Objekte).
 */
export function isAdFreeCustomer(customerInfo: any): boolean {
  const active = customerInfo?.entitlements?.active ?? {};
  return AD_FREE_ENTITLEMENTS.some((id) => !!active[id]);
}
