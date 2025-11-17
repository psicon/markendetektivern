import { Platform } from 'react-native';
import { isExpoGo } from '../utils/platform';
import { analyticsService } from './analyticsService';
import type { ConsentFlowResult, ConsentStatus } from './consentService';

// Ad Configuration with Fallbacks
const AD_CONFIG = {
  ios: {
    rewarded: 'ca-app-pub-9082891656550991/6734170596',
    rewardedInterstitial: 'ca-app-pub-9082891656550991/6041472810',
    interstitial: 'ca-app-pub-9082891656550991/1914525549',
  },
  android: {
    rewarded: 'ca-app-pub-9082891656550991/2930656956',
    rewardedInterstitial: 'ca-app-pub-9082891656550991/5738877029',
    interstitial: 'ca-app-pub-9082891656550991/5878477827',
  }
};

type RewardCallback = (categoryId: string) => void;
type ErrorCallback = (error: Error) => void;
type AdType = 'rewarded' | 'rewarded_interstitial' | 'interstitial';
export type RewardedAdErrorCode = 'NO_FILL' | 'CONSENT_REQUIRED' | 'UNKNOWN';

export class RewardedAdError extends Error {
  code: RewardedAdErrorCode;
  meta?: Record<string, any>;

  constructor(code: RewardedAdErrorCode, message: string, meta?: Record<string, any>) {
    super(message);
    this.code = code;
    this.meta = meta;
    this.name = 'RewardedAdError';
  }
}

class RewardedAdServiceWithFallback {
  private ads: { [key in AdType]?: any } = {};
  private currentType: AdType = 'rewarded';
  private loadStatus: { [key in AdType]: boolean } = {
    rewarded: false,
    rewarded_interstitial: false,
    interstitial: false,
  };
  private currentRequestOptions: { requestNonPersonalizedAdsOnly: boolean } = { requestNonPersonalizedAdsOnly: true };
  private consentStatus: ConsentStatus = 'UNKNOWN';
  private consentBypassActive = false;
  private lastConsentInfo: any = null;
  private isLoading = false;
  private isShowing = false;
  private pendingCategoryId: string | null = null;
  private onRewardCallback: RewardCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;
  private rewardEarned = false;
  private loadAttempts = 0;
  private readonly MAX_LOAD_ATTEMPTS = 3;
  private initialized = false;
  private lastError: { code: RewardedAdErrorCode; message: string } | null = null;
  
  async initialize() {
    if (isExpoGo()) {
      console.log('📱 RewardedAdServiceWithFallback: Skipping in Expo Go');
      return;
    }

    try {
      if (this.initialized) {
        return;
      }
      // Initialisierung OHNE forceForm - nur Status prüfen
      await this.ensureConsentAndAdInstances(false);
      this.initialized = true;
    } catch (error) {
      console.error('❌ RewardedAdServiceWithFallback init error:', error);
    }
  }
  
  private async ensureConsentAndAdInstances(forceForm: boolean): Promise<void> {
    let requestOptions = { requestNonPersonalizedAdsOnly: true };
    
    if (Platform.OS === 'android') {
      try {
        const { consentService } = require('./consentService');
        const consentResult: ConsentFlowResult = await consentService.ensureConsentForRewardedAd({ forceForm });
        this.consentStatus = consentResult.status;
        this.consentBypassActive = consentResult.isBypass;
        this.lastConsentInfo = consentResult.rawConsentInfo;
        requestOptions = consentResult.adRequestOptions;
      } catch (error) {
        console.warn('⚠️ Consent ensure failed - fallback to non-personalized ads', error);
        this.consentStatus = 'UNKNOWN';
        this.consentBypassActive = true;
        requestOptions = { requestNonPersonalizedAdsOnly: true };
      }
    } else {
      // iOS benötigt immer non-personalized Ads
      this.consentStatus = 'NOT_REQUIRED';
      this.consentBypassActive = false;
      requestOptions = { requestNonPersonalizedAdsOnly: true };
    }
    
    // Nur neu bauen wenn noch nicht initialisiert ODER consent options sich geändert haben
    if (!this.initialized || this.hasRequestOptionsChanged(requestOptions)) {
      await this.buildAdInstances(requestOptions);
    } else if (!this.loadStatus[this.currentType] && !this.isLoading) {
      // Einfach nachladen wenn noch nicht geladen
      await this.load();
    }
  }

  private hasRequestOptionsChanged(next: { requestNonPersonalizedAdsOnly: boolean }): boolean {
    return this.currentRequestOptions.requestNonPersonalizedAdsOnly !== next.requestNonPersonalizedAdsOnly;
  }

  private async buildAdInstances(adRequestOptions: { requestNonPersonalizedAdsOnly: boolean }) {
    const { 
      RewardedAd, 
      RewardedInterstitialAd, 
      InterstitialAd, 
      TestIds,
      default: MobileAds,
    } = require('react-native-google-mobile-ads');
    
    const platform = Platform.OS as 'ios' | 'android';
    
    // Set test device configuration (für bessere Test-Fills)
    if (__DEV__ && MobileAds?.setRequestConfiguration) {
      try {
        await MobileAds.setRequestConfiguration({
          testDeviceIdentifiers: ['EMULATOR'], // Füge hier deine Geräte-IDs hinzu
        });
        console.log('🧪 Test devices configured for better ad fills');
      } catch (e) {
        console.warn('⚠️ Could not set test device config:', e);
      }
    }
    
    console.log('🔧 Building ad instances with options:', adRequestOptions);
    
    // Reset states
    this.ads = {};
    this.loadStatus = {
      rewarded: false,
      rewarded_interstitial: false,
      interstitial: false,
    };
    this.currentType = 'rewarded';
    this.currentRequestOptions = adRequestOptions;
    this.isLoading = false;
    this.isShowing = false;
    
    // Initialize all ad types mit aktuellen Options
    await this.initializeAdType('rewarded', RewardedAd, TestIds.REWARDED, adRequestOptions);
    
    if (AD_CONFIG[platform].rewardedInterstitial) {
      await this.initializeAdType('rewarded_interstitial', RewardedInterstitialAd, TestIds.REWARDED_INTERSTITIAL, adRequestOptions);
    }
    
    if (AD_CONFIG[platform].interstitial) {
      await this.initializeAdType('interstitial', InterstitialAd, TestIds.INTERSTITIAL, adRequestOptions);
    }
    
    // Starte das Laden des primären Ad-Typs
    await this.load();
  }

  private async initializeAdType(
    type: AdType, 
    AdClass: any, 
    testId: string, 
    adRequestOptions: any
  ) {
    try {
      const platform = Platform.OS as 'ios' | 'android';
      
      // Map type to config key (handle underscore vs camelCase)
      const configKey = type === 'rewarded_interstitial' ? 'rewardedInterstitial' : type;
      // Im Production-Build: Echte Ad-Unit-IDs verwenden
      const adUnitId = AD_CONFIG[platform][configKey as keyof typeof AD_CONFIG['ios']];
      
      if (!adUnitId) {
        console.log(`⏭️ No ${type} ad unit ID for ${platform}`);
        return;
      }
      
      console.log(`📱 Initializing ${type} ad:`, { platform, adUnitId });
      
      this.ads[type] = AdClass.createForAdRequest(adUnitId, adRequestOptions);
      this.setupEventListeners(type);
      
    } catch (error) {
      console.error(`❌ Error initializing ${type} ad:`, error);
    }
  }
  
  private setupEventListeners(type: AdType) {
    const ad = this.ads[type];
    if (!ad) return;
    
    const { RewardedAdEventType, AdEventType } = require('react-native-google-mobile-ads');
    
    // LOADED event - RewardedInterstitialAd also uses RewardedAdEventType
    const loadedEvent = (type === 'rewarded' || type === 'rewarded_interstitial') 
      ? RewardedAdEventType.LOADED 
      : AdEventType.LOADED;
    ad.addAdEventListener(loadedEvent, () => {
      console.log(`✅ ${type} ad loaded`);
      this.loadStatus[type] = true;
      
      if (type === this.currentType) {
        this.isLoading = false;
        this.loadAttempts = 0;
      }
    });
    
    // ERROR event
    ad.addAdEventListener(AdEventType.ERROR, (error: any) => {
      console.log(`❌ ${type} ad error:`, error);
      const normalizedCode = this.normalizeAdError(error);
      this.lastError = {
        code: normalizedCode,
        message: error?.message || 'Werbung konnte nicht geladen werden.',
      };
      this.loadStatus[type] = false;
      
      // NUR bei aktuellem Typ Fallback versuchen
      if (type === this.currentType) {
        this.isLoading = false;
        // WICHTIG: Nicht sofort fallback bei NO_FILL im Hintergrund
        // Nur wenn User aktiv wartet (isShowing oder pendingCategoryId)
        if (this.isShowing || this.pendingCategoryId) {
          this.tryFallback(this.lastError);
        }
      }
    });
    
    // EARNED_REWARD event - both rewarded types use RewardedAdEventType
    if (type === 'rewarded' || type === 'rewarded_interstitial') {
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward: any) => {
        console.log(`🎁 User earned reward from ${type}:`, reward);
        this.rewardEarned = true;
      });
    }
    
    // CLOSED event
    ad.addAdEventListener(AdEventType.CLOSED, () => {
      console.log(`🚪 ${type} ad closed`);
      this.isShowing = false;
      
      // Deliver reward for all ad types
      if ((this.rewardEarned || type === 'interstitial') && this.pendingCategoryId && this.onRewardCallback) {
        try {
          console.log('🎯 Delivering reward for category:', this.pendingCategoryId);
          this.onRewardCallback(this.pendingCategoryId);
        } catch (error) {
          console.error('❌ Error in reward callback:', error);
        }
      }
      
      // Reset states
      this.rewardEarned = false;
      this.pendingCategoryId = null;
      this.onRewardCallback = null;
      this.onErrorCallback = null;
      this.loadStatus[type] = false;
      
      // Preload next ad
      setTimeout(() => this.load(), 100);
    });
    
    // Debug events
    ad.addAdEventListener(AdEventType.OPENED, () => {
      console.log(`📱 ${type} ad opened`);
    });
  }
  
  private async tryFallback(lastError?: { code: RewardedAdErrorCode; message: string }): Promise<boolean> {
    const fallbackOrder: AdType[] = ['rewarded', 'rewarded_interstitial', 'interstitial'];
    const currentIndex = fallbackOrder.indexOf(this.currentType);
    
    for (let i = currentIndex + 1; i < fallbackOrder.length; i++) {
      const nextType = fallbackOrder[i];
      if (this.ads[nextType]) {
        console.log(`🔄 Switching to ${nextType} fallback`);
        this.currentType = nextType;
        this.loadAttempts = 0;
        
        // Prüfe ob dieser Typ schon geladen ist
        if (this.loadStatus[nextType]) {
          console.log(`✅ ${nextType} already loaded - ready to show`);
          return true;
        }
        
        // Sonst lade ihn
        await this.load();
        return true;
      }
    }
    
    console.log('❌ No more fallback options');
    const finalError = lastError ?? {
      code: 'NO_FILL' as RewardedAdErrorCode,
      message: 'Keine Werbung verfügbar. Bitte versuche es später erneut.',
    };
    this.emitError(finalError.code, finalError.message);
    return false;
  }
  
  private async load() {
    const ad = this.ads[this.currentType];
    if (!ad) {
      console.log(`⚠️ ${this.currentType} ad not initialized`);
      await this.tryFallback({
        code: 'NO_FILL',
        message: 'Ad Instanz nicht verfügbar.',
      });
      return;
    }
    
    if (this.loadStatus[this.currentType]) {
      console.log(`✅ ${this.currentType} ad already loaded`);
      return;
    }
    
    if (this.isLoading) {
      console.log(`⏳ ${this.currentType} ad already loading...`);
      return;
    }
    
    this.isLoading = true;
    this.loadAttempts++;
    
    try {
      console.log(`📱 Loading ${this.currentType} ad (attempt ${this.loadAttempts})...`);
      await ad.load();
    } catch (error) {
      console.log(`❌ Failed to load ${this.currentType} ad:`, error);
      this.isLoading = false;
      this.lastError = {
        code: this.normalizeAdError(error),
        message: error?.message || 'Werbung konnte nicht geladen werden.',
      };
      
      // Retry nur wenn unter MAX_ATTEMPTS
      if (this.loadAttempts < this.MAX_LOAD_ATTEMPTS) {
        console.log(`🔄 Retrying ${this.currentType} ad load in 1s...`);
        setTimeout(() => this.load(), 1000);
      } else {
        // Nur fallback wenn User aktiv wartet
        if (this.isShowing || this.pendingCategoryId) {
          await this.tryFallback(this.lastError);
        } else {
          console.log('⏭️ Max attempts reached, but no active request - skipping fallback');
        }
      }
    }
  }
  
  async showForCategory(
    categoryId: string, 
    onReward: RewardCallback, 
    onError: ErrorCallback
  ): Promise<void> {
    console.log('🎯 showForCategory called for:', categoryId);
    
    this.pendingCategoryId = categoryId;
    this.onRewardCallback = onReward;
    this.onErrorCallback = onError;
    
    try {
      // WICHTIG: Consent NUR prüfen, NICHT erzwingen
      // User hat bereits im Modal die Möglichkeit, Consent zu geben
      await this.ensureConsentAndAdInstances(false);
      
      const ad = this.ads[this.currentType];
      if (!ad) {
        this.emitError('NO_FILL', 'Keine Werbung verfügbar. Bitte versuche es später erneut.');
        return;
      }
      
      // Warte bis zu 10 Sekunden auf Ad-Load (Best Practice für Rewarded Ads)
      if (!this.loadStatus[this.currentType]) {
        if (!this.isLoading) {
          this.load();
        }
        
        console.log('⏳ Waiting for ad to load...');
        let waitTime = 0;
        const checkInterval = 100;
        const maxWaitTime = 10000; // 10s statt 5s
        
        await new Promise<void>((resolve, reject) => {
          const checkLoaded = setInterval(() => {
            waitTime += checkInterval;
            
            if (this.loadStatus[this.currentType]) {
              clearInterval(checkLoaded);
              console.log('✅ Ad loaded after waiting', waitTime, 'ms');
              resolve();
            } else if (waitTime >= maxWaitTime) {
              clearInterval(checkLoaded);
              console.log('❌ Ad load timeout after 10s');
              // Versuche Fallback
              this.tryFallback().then((fallbackAvailable) => {
                if (fallbackAvailable && this.loadStatus[this.currentType]) {
                  console.log('✅ Fallback ad ready');
                  resolve();
                } else {
                  reject(new RewardedAdError('NO_FILL', 'Die Werbung konnte nicht geladen werden.'));
                }
              });
            }
          }, checkInterval);
        });
      }
      
      if (this.isShowing) {
        console.log('⚠️ Ad already showing');
        return;
      }
      
      console.log(`🎬 Showing ${this.currentType} ad for category:`, categoryId);
      this.isShowing = true;
      this.loadStatus[this.currentType] = false;
      
      // Track event
      analyticsService.trackEvent({
        event_name: `${this.currentType}_ad_started`,
        event_category: 'user_action',
        category_id: categoryId,
        ad_type: this.currentType,
        consent_status: this.consentStatus,
        consent_bypass: this.consentBypassActive,
      });
      
      await ad.show();
      console.log('✅ Show() completed');
      
    } catch (error: any) {
      console.error(`❌ Error showing ${this.currentType} ad:`, error);
      this.isShowing = false;
      
      const normalizedCode = this.normalizeAdError(error);
      const fallbackAvailable = await this.tryFallback({
        code: normalizedCode,
        message: error?.message || 'Werbung konnte nicht angezeigt werden.',
      });
      
      // Nur rekursiv aufrufen wenn Fallback verfügbar UND geladen
      if (fallbackAvailable && this.loadStatus[this.currentType]) {
        console.log('🔄 Retrying with fallback ad type');
        return this.showForCategory(categoryId, onReward, onError);
      }
    }
  }
  
  private normalizeAdError(error: any): RewardedAdErrorCode {
    const code = typeof error?.code === 'string' ? error.code.toLowerCase() : error?.code;
    const message = (error?.message || '').toLowerCase();
    
    if (
      code === 'no-fill' ||
      code === 'ad-not-available' ||
      code === 3 ||
      message.includes('no fill') ||
      message.includes('no ad') ||
      message.includes('ad not available')
    ) {
      return 'NO_FILL';
    }
    
    if (message.includes('consent') || message.includes('permission')) {
      return 'CONSENT_REQUIRED';
    }
    
    return 'UNKNOWN';
  }
  
  private emitError(code: RewardedAdErrorCode, message: string) {
    if (this.onErrorCallback) {
      this.onErrorCallback(new RewardedAdError(code, message, {
        consentStatus: this.consentStatus,
        bypassActive: this.consentBypassActive,
        adTypeTried: this.currentType,
      }));
    } else {
      console.warn(`RewardedAdService error [${code}]:`, message);
    }
  }
  
  isReady(): boolean {
    return this.loadStatus[this.currentType] && !this.isShowing;
  }
  
  getStatus() {
    return {
      isLoaded: this.loadStatus[this.currentType],
      isLoading: this.isLoading,
      isShowing: this.isShowing,
      currentType: this.currentType,
      loadStatus: this.loadStatus,
      consentStatus: this.consentStatus,
    };
  }
  
  preload(): void {
    // Preload OHNE forceForm
    this.ensureConsentAndAdInstances(false)
      .then(() => {
        if (!this.loadStatus[this.currentType] && !this.isLoading) {
          console.log('🔄 Preloading ad...');
          this.load();
        }
      })
      .catch((error) => {
        console.warn('⚠️ RewardedAd preload skipped:', error);
      });
  }
  
  // Reset to primary ad type
  resetToPrimary(): void {
    console.log('🔄 Resetting to primary rewarded ad type');
    this.currentType = 'rewarded';
    this.loadAttempts = 0;
    this.load();
  }
}

export const rewardedAdService = new RewardedAdServiceWithFallback();

// Development Helper
if (__DEV__ && typeof window !== 'undefined') {
  (window as any).rewardedAdService = rewardedAdService;
}


