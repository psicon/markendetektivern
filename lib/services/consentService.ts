import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Storage Keys
const CONSENT_STATUS_KEY = 'ump_consent_status';
const CONSENT_INFO_KEY = 'ump_consent_info';

export type ConsentStatus = 'UNKNOWN' | 'REQUIRED' | 'NOT_REQUIRED' | 'OBTAINED';

export interface ConsentFlowResult {
  status: ConsentStatus;
  canShowAds: boolean;
  canShowPersonalizedAds: boolean;
  isBypass: boolean;
  adRequestOptions: { requestNonPersonalizedAdsOnly: boolean };
  rawConsentInfo?: any;
}

class ConsentService {
  private consentStatus: ConsentStatus = 'UNKNOWN';
  private consentInfo: any = null;
  private isInitialized = false;
  private isPromptInFlight = false;
  private hasShownThisSession = false;

  async initialize(): Promise<ConsentStatus> {
    try {
      if (Platform.OS === 'ios') {
        // iOS braucht kein UMP
        this.consentStatus = 'NOT_REQUIRED';
        this.isInitialized = true;
        return this.consentStatus;
      }

      if (this.isInitialized) {
        return this.consentStatus;
      }

      // Lade gespeicherten Status
      const savedStatus = await AsyncStorage.getItem(CONSENT_STATUS_KEY);
      const savedInfo = await AsyncStorage.getItem(CONSENT_INFO_KEY);

      if (savedStatus) {
        this.consentStatus = savedStatus as ConsentStatus;
        this.consentInfo = savedInfo ? JSON.parse(savedInfo) : null;
        this.isInitialized = true;
        console.log('🔒 Loaded saved consent:', this.consentStatus);
        return this.consentStatus;
      }

      // Falls kein gespeicherter Status, dann prüfe SDK Status
      const { AdsConsent } = require('react-native-google-mobile-ads');
      
      // Prüfe ob bereits Consent gegeben wurde
      const consentInfo = await AdsConsent.requestInfoUpdate();
      console.log('📊 UMP Consent Info:', consentInfo);

      this.updateConsentStatusFromInfo(consentInfo);

      // Speichere Status
      await this.saveConsentInfo(this.consentStatus, consentInfo);
      
      this.isInitialized = true;
      return this.consentStatus;

    } catch (error) {
      console.error('❌ Consent initialization error:', error);
      // Bei Fehler: Erlaube Ads mit non-personalized
      this.consentStatus = 'OBTAINED';
      this.isInitialized = true;
      return this.consentStatus;
    }
  }

  async showConsentFormIfRequired(options?: { force?: boolean }): Promise<boolean> {
    const force = options?.force ?? false;
    
    try {
      if (Platform.OS === 'ios') {
        return false;
      }

      if (this.hasShownThisSession && !force) {
        console.log('⏭️ Consent form already shown this session - skipping');
        return false;
      }

      const { AdsConsent } = require('react-native-google-mobile-ads');
      
      if (this.isPromptInFlight) {
        console.log('⏭️ Consent form already showing - skipping duplicate request');
        return false;
      }

      if (this.consentStatus === 'REQUIRED') {
        console.log('📝 Showing consent form...');
        this.isPromptInFlight = true;
        try {
          const formResult = await AdsConsent.loadAndShowConsentFormIfRequired();
          console.log('✅ Consent form result:', formResult);
          
          // Update status nach Form
          const newInfo = await AdsConsent.requestInfoUpdate();
          this.updateConsentStatusFromInfo(newInfo);
          await this.saveConsentInfo(this.consentStatus, newInfo);
          this.hasShownThisSession = true;
          
          return true;
        } finally {
          this.isPromptInFlight = false;
        }
      }
      
      return false;
    } catch (error) {
      console.error('❌ Error showing consent form:', error);
      return false;
    }
  }

  async forceShowConsentForm(): Promise<void> {
    try {
      if (Platform.OS === 'ios') {
        console.log('⚠️ Consent form not available on iOS');
        return;
      }

      const { AdsConsent } = require('react-native-google-mobile-ads');

      if (this.isPromptInFlight) {
        console.log('⏭️ Consent form already showing - skipping duplicate force request');
        return;
      }

      console.log('🔧 Force showing consent form...');
      this.isPromptInFlight = true;
      try {
        await AdsConsent.showForm();

        // Update status
        const newInfo = await AdsConsent.requestInfoUpdate();
        this.updateConsentStatusFromInfo(newInfo);
        await this.saveConsentInfo(this.consentStatus, newInfo);
        this.hasShownThisSession = true;
      } finally {
        this.isPromptInFlight = false;
      }
    } catch (error) {
      console.error('❌ Error force showing consent form:', error);
      throw error;
    }
  }

  async resetConsent(): Promise<void> {
    try {
      console.log('🗑️ Resetting consent...');
      
      // Lösche gespeicherte Daten
      await AsyncStorage.removeItem(CONSENT_STATUS_KEY);
      await AsyncStorage.removeItem(CONSENT_INFO_KEY);
      
      // Reset internal state
      this.consentStatus = 'UNKNOWN';
      this.consentInfo = null;
      this.isInitialized = false;
      this.hasShownThisSession = false;
      
      if (Platform.OS === 'android') {
        try {
          const { AdsConsent } = require('react-native-google-mobile-ads');
          // Reset SDK consent state
          await AdsConsent.reset();
        } catch (error) {
          console.warn('⚠️ Could not reset SDK consent:', error);
        }
      }
      
      console.log('✅ Consent reset complete');
    } catch (error) {
      console.error('❌ Error resetting consent:', error);
    }
  }

  getConsentStatus(): ConsentStatus {
    return this.consentStatus;
  }

  canShowAds(): boolean {
    // iOS: Immer erlaubt (mit non-personalized)
    if (Platform.OS === 'ios') {
      return true;
    }
    
    // Android: Prüfe ob wirklich Consent gegeben wurde
    // WICHTIG: Nur OBTAINED bedeutet, dass der User zugestimmt hat!
    if (this.consentStatus === 'OBTAINED') {
      return true;
    }
    
    // NOT_REQUIRED bedeutet, dass kein Consent nötig ist (z.B. außerhalb EU)
    if (this.consentStatus === 'NOT_REQUIRED') {
      return true;
    }
    
    // In allen anderen Fällen (UNKNOWN, REQUIRED) keine Ads
    return false;
  }

  canShowPersonalizedAds(): boolean {
    if (Platform.OS === 'ios') {
      // iOS: Keine personalisierten Ads ohne UMP
      return false;
    }

    // Prüfe ob personalisierte Ads erlaubt sind
    if (this.consentInfo?.privacyOptionsRequirementStatus === 'NOT_REQUIRED') {
      return true;
    }
    
    // Sonst nur wenn explizit erlaubt
    return this.consentInfo?.canRequestAds === true;
  }

  getAdRequestOptions(forceNonPersonalized: boolean = false): { requestNonPersonalizedAdsOnly: boolean } {
    // iOS: Immer non-personalized
    if (Platform.OS === 'ios') {
      return { requestNonPersonalizedAdsOnly: true };
    }
    
    // Android: Basierend auf Consent
    const canShowPersonalized = this.canShowPersonalizedAds();
    
    return {
      requestNonPersonalizedAdsOnly: forceNonPersonalized ? true : !canShowPersonalized,
    };
  }

  async hasConsent(): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return this.canShowAds();
  }

  private async saveConsentInfo(status: ConsentStatus, info: any): Promise<void> {
    try {
      await AsyncStorage.setItem(CONSENT_STATUS_KEY, status);
      await AsyncStorage.setItem(CONSENT_INFO_KEY, JSON.stringify(info));
      this.consentStatus = status;
      this.consentInfo = info;
    } catch (error) {
      console.error('❌ Error saving consent info:', error);
    }
  }

  private normalizeConsentStatus(status: any): ConsentStatus {
    if (!status) {
      return 'UNKNOWN';
    }
    
    const normalized = typeof status === 'string'
      ? status.toUpperCase()
      : status;
    
    if (normalized === 'OBTAINED') return 'OBTAINED';
    if (normalized === 'NOT_REQUIRED') return 'NOT_REQUIRED';
    if (normalized === 'REQUIRED') return 'REQUIRED';
    return 'UNKNOWN';
  }

  private updateConsentStatusFromInfo(info: any): void {
    const { AdsConsentStatus } = require('react-native-google-mobile-ads');
    const status = info?.status ?? AdsConsentStatus.UNKNOWN;
    const normalizedStatus = this.normalizeConsentStatus(status);
    this.consentStatus = normalizedStatus;
    this.consentInfo = info;
  }

  async ensureConsentForRewardedAd(options?: { forceForm?: boolean }): Promise<ConsentFlowResult> {
    await this.initialize();
    
    // iOS: kein Consent nötig, aber immer non-personalized
    if (Platform.OS === 'ios') {
      const adRequestOptions = this.getAdRequestOptions(true);
      return {
        status: this.consentStatus,
        canShowAds: true,
        canShowPersonalizedAds: false,
        isBypass: false,
        adRequestOptions,
        rawConsentInfo: null,
      };
    }
    
    const forceForm = options?.forceForm ?? false; // DEFAULT: false!
    
    try {
      const { AdsConsent } = require('react-native-google-mobile-ads');
      
      // Nur Status aktualisieren, kein automatisches Anzeigen
      const latestInfo = await AdsConsent.requestInfoUpdate();
      if (latestInfo) {
        this.updateConsentStatusFromInfo(latestInfo);
        await this.saveConsentInfo(this.consentStatus, latestInfo);
      }
      
      // Falls weiterhin REQUIRED UND explizit forceForm → Formular zeigen
      // WICHTIG: Nur wenn explizit angefordert (z.B. vom Modal-Button)
      if (forceForm && this.consentStatus === 'REQUIRED') {
        console.log('📝 ensureConsentForRewardedAd: Force showing consent form');
        try {
          await this.showConsentFormIfRequired({ force: true });
        } catch (formError) {
          console.warn('⚠️ Consent form display failed:', formError);
        }
      }
    } catch (error) {
      console.warn('⚠️ ensureConsentForRewardedAd failed:', error);
    }
    
    // isBypass = true bedeutet: wir zeigen non-personalized Ads auch ohne Consent
    const isBypass = !(this.consentStatus === 'OBTAINED' || this.consentStatus === 'NOT_REQUIRED');
    const adRequestOptions = this.getAdRequestOptions(isBypass);
    
    return {
      status: this.consentStatus,
      canShowAds: this.canShowAds(),
      canShowPersonalizedAds: this.canShowPersonalizedAds(),
      isBypass,
      adRequestOptions,
      rawConsentInfo: this.consentInfo,
    };
  }

  async getDetailedStatus(): Promise<any> {
    try {
      // Lade gespeicherte Daten
      const savedStatus = await AsyncStorage.getItem(CONSENT_STATUS_KEY);
      const savedInfo = await AsyncStorage.getItem(CONSENT_INFO_KEY);
      
      // Hole aktuelle SDK Info (nur Android)
      let sdkInfo = null;
      if (Platform.OS === 'android') {
        try {
          const { AdsConsent } = require('react-native-google-mobile-ads');
          sdkInfo = await AdsConsent.requestInfoUpdate();
        } catch (e) {
          console.warn('Could not get SDK info:', e);
        }
      }
      
      return {
        // Basic status
        status: this.consentStatus,
        isInitialized: this.isInitialized,
        platform: Platform.OS,
        
        // Computed values
        canShowAds: this.canShowAds(),
        canShowPersonalizedAds: this.canShowPersonalizedAds(),
        adRequestOptions: this.getAdRequestOptions(),
        
        // Stored data
        hasSavedStatus: !!savedStatus,
        savedStatus: savedStatus,
        savedInfo: savedInfo ? JSON.parse(savedInfo) : null,
        
        // Current consent info
        privacyOptionsRequirementStatus: this.consentInfo?.privacyOptionsRequirementStatus,
        canRequestAds: this.consentInfo?.canRequestAds,
        isConsentFormAvailable: this.consentInfo?.isConsentFormAvailable,
        
        // Raw data for debugging
        rawConsentInfo: this.consentInfo,
        rawSdkInfo: sdkInfo,
      };
    } catch (error) {
      console.error('Error getting detailed status:', error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        status: this.consentStatus,
        canShowAds: this.canShowAds(),
      };
    }
  }
}

export const consentService = new ConsentService();
