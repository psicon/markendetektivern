import { app } from '@/lib/firebase';
import Constants from 'expo-constants';

class RemoteConfigService {
  private static instance: RemoteConfigService;
  private remoteConfig: any;
  private isInitialized = false;
  private isExpoGo = false;
  
  // Fallback-Werte für Development/Expo Go
  private fallbackConfig = {
    showonboardingpaywall: false, // Default: Paywall AUS
  };

  private constructor() {
    // Expo Go zuverlässig erkennen (nur über appOwnership)
    this.isExpoGo = Constants.appOwnership === 'expo';
    console.log('🔧 Remote Config Service:', this.isExpoGo ? 'Fallback Mode' : 'Native Mode');
  }

  static getInstance(): RemoteConfigService {
    if (!RemoteConfigService.instance) {
      RemoteConfigService.instance = new RemoteConfigService();
    }
    return RemoteConfigService.instance;
  }

  /**
   * Remote Config initialisieren
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      if (this.isExpoGo) {
        console.log('🔧 Remote Config: Using Expo Go fallback mode');
        this.isInitialized = true;
        return;
      }

      // Native Firebase Remote Config (nur wenn nicht Expo Go)
      const { getRemoteConfig, fetchAndActivate } = await import('firebase/remote-config');
      
      this.remoteConfig = getRemoteConfig(app);
      
      // Default-Werte setzen
      this.remoteConfig.defaultConfig = {
        showonboardingpaywall: false, // Default: Paywall nicht anzeigen
        // Coachmark-Tour: kuratiertes Demo-Produkt für die Home-
        // Spotlight-Phase. Leer-String = automatischer Fallback auf
        // den aktuellen Top-Enttarnt-Kandidaten (siehe
        // HomeWalkthrough.fetchDemoProduct). Setze diesen Wert in
        // der Firebase-Konsole auf eine konkrete Produkt-objectID
        // wenn du einen WOW-Vergleich (hohe Stufe + großer
        // Preisunterschied) als Demo zeigen willst — wirkt
        // überzeugender als ein zufälliger Treffer.
        coachmark_home_demo_product_id: '',
      };

      // Fetch-Intervall (Development: 0, Production: 12h)
      this.remoteConfig.settings = {
        minimumFetchIntervalMillis: __DEV__ ? 0 : 12 * 60 * 60 * 1000, // 12 Stunden
        fetchTimeoutMillis: 10000, // 10 Sekunden Timeout
      };

      // Initial fetch
      await fetchAndActivate(this.remoteConfig);
      
      console.log('✅ Firebase Remote Config initialized');
      this.isInitialized = true;

    } catch (error) {
      console.error('❌ Remote Config initialization failed:', error);
      // Fallback zu Expo Go Modus
      this.isExpoGo = true;
      this.isInitialized = true;
    }
  }

  /**
   * Remote Config Werte aktualisieren
   */
  async fetchAndActivate(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isExpoGo) {
      console.log('🔧 Remote Config: Mock fetch in Expo Go');
      return;
    }

    try {
      const { fetchAndActivate } = await import('firebase/remote-config');
      const activated = await fetchAndActivate(this.remoteConfig);
      console.log('🔄 Remote Config updated:', activated ? 'New values' : 'No changes');
    } catch (error) {
      console.error('❌ Error fetching Remote Config:', error);
    }
  }

  /**
   * Soll Onboarding Paywall angezeigt werden?
   */
  async shouldShowOnboardingPaywall(): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isExpoGo) {
      // Expo Go Fallback - verwende lokale Konfiguration
      const showPaywall = this.fallbackConfig.showonboardingpaywall;
      console.log('🛒 Remote Config (Expo Go Fallback) - Show Onboarding Paywall:', showPaywall);
      return showPaywall;
    }

    try {
      const { getBoolean } = await import('firebase/remote-config');
      
      // Erst fetchAndActivate aufrufen um sicherzustellen, dass wir die neuesten Werte haben
      if (this.remoteConfig) {
        const { fetchAndActivate } = await import('firebase/remote-config');
        try {
          await fetchAndActivate(this.remoteConfig);
          console.log('🔄 Remote Config: Fetched latest values');
        } catch (fetchError) {
          console.log('⚠️ Remote Config: Using cached values', fetchError);
        }
      }
      
      const showPaywall = getBoolean(this.remoteConfig, 'showonboardingpaywall');
      console.log('🛒 Remote Config - Show Onboarding Paywall:', showPaywall);
      return showPaywall;
    } catch (error) {
      console.error('❌ Error getting showonboardingpaywall:', error);
      return false; // Fallback: Keine Paywall
    }
  }

  /**
   * Beliebigen Remote Config Wert abrufen
   */
  async getValue(key: string): Promise<any> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isExpoGo) {
      return this.fallbackConfig[key as keyof typeof this.fallbackConfig] || null;
    }

    try {
      const { getValue } = await import('firebase/remote-config');
      const value = getValue(this.remoteConfig, key);
      return value.asString();
    } catch (error) {
      console.error(`❌ Error getting Remote Config value ${key}:`, error);
      return null;
    }
  }

  /**
   * Boolean Remote Config Wert abrufen
   */
  async getBoolean(key: string): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isExpoGo) {
      return this.fallbackConfig[key as keyof typeof this.fallbackConfig] || false;
    }

    try {
      const { getBoolean } = await import('firebase/remote-config');
      return getBoolean(this.remoteConfig, key);
    } catch (error) {
      console.error(`❌ Error getting Remote Config boolean ${key}:`, error);
      return false;
    }
  }

  /**
   * Expo Go Fallback-Werte setzen (für Testing)
   */
  setFallbackValue(key: string, value: any): void {
    if (this.isExpoGo) {
      (this.fallbackConfig as any)[key] = value;
      console.log(`🔧 Remote Config Fallback set: ${key} = ${value}`);
    }
  }
}

// Singleton Export
export const remoteConfigService = RemoteConfigService.getInstance();
