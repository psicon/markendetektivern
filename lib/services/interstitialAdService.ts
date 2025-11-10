import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { isExpoGo } from '../utils/platform';
import { adMobService } from './adMobService';

// Counter Keys
const COUNTER_KEYS = {
  PRODUCT_VIEW: '@interstitial_product_view_count',
  SCAN: '@interstitial_scan_count',
  SEARCH: '@interstitial_search_count',
  LAST_SHOWN: '@interstitial_last_shown',
};

// Thresholds
const THRESHOLDS = {
  PRODUCT_VIEW: 4, // Nach jedem 4. Produktaufruf
  SCAN: 3, // Nach jedem 3. Scan
  SEARCH: 3, // Nach jeder 3. Suche
};

// Minimum time between ads (in milliseconds)
const MIN_TIME_BETWEEN_ADS = 60000; // 1 Minute

class InterstitialAdService {
  private interstitialAd: any = null;
  private isLoaded = false;
  private isShowing = false;

  async initialize() {
    if (isExpoGo()) {
      console.log('📱 InterstitialAdService: Skipping in Expo Go');
      return;
    }

    try {
      // Android: Consent prüfen
      if (Platform.OS === 'android') {
        const { consentService } = require('./consentService');
        
        // Initialisiere Consent falls noch nicht geschehen
        const consentStatus = consentService.getConsentStatus();
        if (consentStatus === 'UNKNOWN') {
          console.log('🔄 InterstitialAd: Initializing consent service...');
          await consentService.initialize();
        }
        
        // Prüfe ob Ads gezeigt werden können
        const canShowAds = consentService.canShowAds();
        if (!canShowAds) {
          console.log('⏭️ InterstitialAd: Skipping (consent required, not obtained)');
          return;
        }
      }
      // iOS: Direkt fortfahren (wie in 5.0.1)
      
      const { InterstitialAd, TestIds, AdEventType } = require('react-native-google-mobile-ads');
      
      // Get ad unit ID (test in dev, real in production)
      const adUnitId = __DEV__ 
        ? TestIds.INTERSTITIAL 
        : adMobService.getAdUnitId('interstitial');

      // Create interstitial instance mit Consent-basierten Options
      // iOS: Personalized Ads (kein Consent nötig)
      // Android: Dynamisch basierend auf Consent Status
      let adRequestOptions = { requestNonPersonalizedAdsOnly: false }; // iOS Default
      if (Platform.OS === 'android') {
        const { consentService } = require('./consentService');
        adRequestOptions = consentService.getAdRequestOptions();
      }
      
      console.log('📊 Interstitial Ad Request Options:', {
        ...adRequestOptions,
        platform: Platform.OS
      });
      
      this.interstitialAd = InterstitialAd.createForAdRequest(adUnitId, adRequestOptions);

      // Set up event listeners
      this.interstitialAd.addAdEventListener(AdEventType.LOADED, () => {
        console.log('✅ Interstitial loaded');
        this.isLoaded = true;
      });

      this.interstitialAd.addAdEventListener(AdEventType.ERROR, (error: any) => {
        console.log('❌ Interstitial failed to load:', error);
        this.isLoaded = false;
        // Retry loading after error
        setTimeout(() => {
          console.log('🔄 Retrying interstitial load after error...');
          this.loadAd();
        }, 5000); // Retry after 5 seconds
      });

      this.interstitialAd.addAdEventListener(AdEventType.CLOSED, () => {
        console.log('🔄 Interstitial closed, loading next one');
        this.isShowing = false;
        this.isLoaded = false;
        // Load next ad immediately
        this.loadAd();
      });

      // Load first ad
      this.loadAd();
      
      // Preload backup ad after a delay
      setTimeout(() => {
        if (!this.isLoaded && !this.isShowing) {
          console.log('⏰ Preloading backup interstitial...');
          this.loadAd();
        }
      }, 3000);
    } catch (error) {
      console.error('❌ InterstitialAdService init error:', error);
    }
  }

  private loadAd() {
    if (this.interstitialAd && !this.isLoaded) {
      console.log('📥 Loading interstitial ad...');
      this.interstitialAd.load();
    } else {
      console.log('⚠️ Cannot load ad:', { hasAd: !!this.interstitialAd, isLoaded: this.isLoaded });
    }
  }

  private async canShowAd(): Promise<boolean> {
    // Check last shown time
    const lastShownStr = await AsyncStorage.getItem(COUNTER_KEYS.LAST_SHOWN);
    if (lastShownStr) {
      const lastShown = parseInt(lastShownStr);
      const timeSinceLastAd = Date.now() - lastShown;
      if (timeSinceLastAd < MIN_TIME_BETWEEN_ADS) {
        console.log(`⏱️ Too soon since last ad (${Math.round(timeSinceLastAd / 1000)}s ago)`);
        return false;
      }
    }
    return true;
  }

  private async updateLastShownTime() {
    await AsyncStorage.setItem(COUNTER_KEYS.LAST_SHOWN, Date.now().toString());
  }

  async showIfReady(isPremium: boolean, retryCount: number = 0) {
    console.log('🎯 showIfReady called:', { 
      isPremium, 
      isLoaded: this.isLoaded, 
      isShowing: this.isShowing,
      retryCount 
    });
    
    // Skip if premium
    if (isPremium) {
      console.log('👑 Skipping interstitial - user has premium');
      return;
    }

    // Skip in Expo Go
    if (isExpoGo()) {
      console.log('📱 Would show interstitial (Expo Go)');
      return;
    }

    // iOS: Consent nicht prüfen (nicht kritisch)
    if (Platform.OS === 'android') {
      // Android: Prüfe Consent Status
      try {
        const { consentService } = require('./consentService');
        const canShowAds = consentService.canShowAds();
        if (!canShowAds) {
          console.log('⏭️ Interstitial: Skipping (no consent)');
          return;
        }
      } catch (err) {
        console.warn('⚠️ Interstitial: Could not check consent, allowing anyway');
      }
    }

    // Check if enough time has passed
    if (!(await this.canShowAd())) {
      return;
    }

    // Show ad if loaded
    if (this.interstitialAd && this.isLoaded && !this.isShowing) {
      try {
        this.isShowing = true;
        console.log('🚀 Showing interstitial ad now!');
        await this.interstitialAd.show();
        await this.updateLastShownTime();
        this.isLoaded = false; // Mark as not loaded after showing
      } catch (error) {
        console.error('❌ Error showing interstitial:', error);
        this.isShowing = false;
      }
    } else {
      console.log('⏳ Interstitial not ready:', { 
        hasAd: !!this.interstitialAd, 
        isLoaded: this.isLoaded, 
        isShowing: this.isShowing 
      });
      
      // Try loading if not loaded
      if (!this.isLoaded) {
        this.loadAd();
      }
      
      // Retry showing after a delay (max 3 retries)
      if (retryCount < 3) {
        setTimeout(() => {
          console.log(`🔄 Retry ${retryCount + 1}/3 to show interstitial...`);
          this.showIfReady(isPremium, retryCount + 1);
        }, 2000); // Retry after 2 seconds
      } else {
        console.log('❌ Max retries reached, giving up on showing interstitial');
      }
    }
  }

  async trackProductView(isPremium: boolean) {
    const countStr = await AsyncStorage.getItem(COUNTER_KEYS.PRODUCT_VIEW) || '0';
    const count = parseInt(countStr) + 1;
    
    console.log(`📦 Product view count: ${count}/${THRESHOLDS.PRODUCT_VIEW}`);
    
    if (count >= THRESHOLDS.PRODUCT_VIEW) {
      await AsyncStorage.setItem(COUNTER_KEYS.PRODUCT_VIEW, '0');
      await this.showIfReady(isPremium);
    } else {
      await AsyncStorage.setItem(COUNTER_KEYS.PRODUCT_VIEW, count.toString());
      // Preload ad when getting close to threshold
      if (count === THRESHOLDS.PRODUCT_VIEW - 1) {
        this.preloadIfNeeded();
      }
    }
  }

  async trackScan(isPremium: boolean) {
    const countStr = await AsyncStorage.getItem(COUNTER_KEYS.SCAN) || '0';
    const count = parseInt(countStr) + 1;
    
    console.log(`📷 Scan count: ${count}/${THRESHOLDS.SCAN}`);
    
    if (count >= THRESHOLDS.SCAN) {
      await AsyncStorage.setItem(COUNTER_KEYS.SCAN, '0');
      await this.showIfReady(isPremium);
    } else {
      await AsyncStorage.setItem(COUNTER_KEYS.SCAN, count.toString());
      // Preload ad when getting close to threshold
      if (count === THRESHOLDS.SCAN - 1) {
        this.preloadIfNeeded();
      }
    }
  }

  async trackSearch(isPremium: boolean) {
    const countStr = await AsyncStorage.getItem(COUNTER_KEYS.SEARCH) || '0';
    const count = parseInt(countStr) + 1;
    
    console.log(`🔍 Search count: ${count}/${THRESHOLDS.SEARCH}`);
    
    if (count >= THRESHOLDS.SEARCH) {
      await AsyncStorage.setItem(COUNTER_KEYS.SEARCH, '0');
      await this.showIfReady(isPremium);
    } else {
      await AsyncStorage.setItem(COUNTER_KEYS.SEARCH, count.toString());
      // Preload ad when getting close to threshold
      if (count === THRESHOLDS.SEARCH - 1) {
        this.preloadIfNeeded();
      }
    }
  }

  private preloadIfNeeded() {
    if (!this.isLoaded && !this.isShowing && this.interstitialAd) {
      console.log('🔮 Preloading interstitial ad (threshold approaching)...');
      this.loadAd();
    }
  }

  // Reset all counters (useful for testing)
  async resetCounters() {
    await AsyncStorage.multiRemove([
      COUNTER_KEYS.PRODUCT_VIEW,
      COUNTER_KEYS.SCAN,
      COUNTER_KEYS.SEARCH,
      COUNTER_KEYS.LAST_SHOWN,
    ]);
    console.log('🔄 All interstitial counters reset');
  }
}

export const interstitialAdService = new InterstitialAdService();
