import AsyncStorage from '@react-native-async-storage/async-storage';
import { isExpoGo } from '../utils/platform';

const CONSENT_STATUS_KEY = '@user_consent_status';
const LAST_CONSENT_CHECK_KEY = '@last_consent_check';
const CONSENT_CHECK_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 Tage

export type ConsentStatus = 'OBTAINED' | 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN';

class ConsentService {
  private consentStatus: ConsentStatus = 'UNKNOWN';
  private consentInfoUpdateListener: any = null;
  
  /**
   * Prüft ob es der erste App Launch ist (kein gespeicherter Consent)
   */
  private async isFirstLaunch(): Promise<boolean> {
    try {
      const savedStatus = await AsyncStorage.getItem(CONSENT_STATUS_KEY);
      return !savedStatus; // true wenn noch nie Consent gespeichert
    } catch (error) {
      return true; // Im Fehlerfall annehmen dass es First Launch ist
    }
  }

  /**
   * Initialisiert UMP (User Messaging Platform) und prüft Consent
   */
  async initialize(): Promise<ConsentStatus> {
    try {
      // Skip in Expo Go
      if (isExpoGo()) {
        console.log('⏭️ UMP skipped (Expo Go)');
        this.consentStatus = 'NOT_REQUIRED';
        return 'NOT_REQUIRED';
      }

      // Lade gespeicherten Consent Status
      const savedStatus = await AsyncStorage.getItem(CONSENT_STATUS_KEY);
      const lastCheck = await AsyncStorage.getItem(LAST_CONSENT_CHECK_KEY);
      
      // Prüfe ob Consent-Check nötig ist (alle 30 Tage ODER beim ersten Mal)
      const needsCheck = !lastCheck || 
        (Date.now() - parseInt(lastCheck)) > CONSENT_CHECK_INTERVAL;

      if (savedStatus && !needsCheck) {
        console.log('✅ UMP: Cached consent status:', savedStatus);
        this.consentStatus = savedStatus as ConsentStatus;
        return this.consentStatus;
      }

      // Importiere UMP Module
      const { AdsConsent, AdsConsentStatus } = require('react-native-google-mobile-ads');

      console.log('🔄 UMP: Requesting consent info update...');
      
      // Request consent information
      const consentInfo = await AdsConsent.requestInfoUpdate();

      console.log('📊 UMP Consent Info:', {
        status: consentInfo.status,
        isConsentFormAvailable: consentInfo.isConsentFormAvailable,
        canRequestAds: consentInfo.canRequestAds
      });

      // Speichere Last Check
      await AsyncStorage.setItem(LAST_CONSENT_CHECK_KEY, Date.now().toString());

      // Prüfe Status
      if (consentInfo.status === AdsConsentStatus.REQUIRED && consentInfo.isConsentFormAvailable) {
        console.log('📝 UMP: Consent required - form available');
        this.consentStatus = 'REQUIRED';
      } else if (consentInfo.status === AdsConsentStatus.OBTAINED) {
        console.log('✅ UMP: Consent obtained');
        this.consentStatus = 'OBTAINED';
        await AsyncStorage.setItem(CONSENT_STATUS_KEY, 'OBTAINED');
      } else if (consentInfo.status === AdsConsentStatus.NOT_REQUIRED) {
        console.log('✅ UMP: Consent not required (outside EEA)');
        this.consentStatus = 'NOT_REQUIRED';
        await AsyncStorage.setItem(CONSENT_STATUS_KEY, 'NOT_REQUIRED');
      } else {
        console.log('⚠️ UMP: Unknown status');
        this.consentStatus = 'UNKNOWN';
      }

      return this.consentStatus;

    } catch (error) {
      console.error('❌ UMP initialization failed:', error);
      // Fallback: Erlaube Ads (non-personalized als Fallback)
      this.consentStatus = 'UNKNOWN';
      return 'UNKNOWN';
    }
  }

  /**
   * Zeigt Consent Form (nur wenn nötig) - Best Practices Implementation
   */
  async showConsentFormIfRequired(): Promise<boolean> {
    try {
      const { AdsConsent, AdsConsentStatus } = require('react-native-google-mobile-ads');
      
      // Prüfe ob Form nötig ist
      if (this.consentStatus !== 'REQUIRED') {
        console.log('⏭️ UMP: Consent form not required, status:', this.consentStatus);
        return true; // Ads können gezeigt werden
      }

      console.log('📝 UMP: Loading and showing consent form...');
      
      // Best Practice: loadAndShowConsentFormIfRequired ist die empfohlene Methode
      const formResult = await AdsConsent.loadAndShowConsentFormIfRequired();

      console.log('✅ UMP: Consent form result:', {
        status: formResult.status,
        canRequestAds: formResult.canRequestAds
      });

      // Status nach Form neu laden
      const consentInfo = await AdsConsent.requestInfoUpdate();
      
      // Update lokalen Status
      if (consentInfo.status === AdsConsentStatus.OBTAINED) {
        this.consentStatus = 'OBTAINED';
        await AsyncStorage.setItem(CONSENT_STATUS_KEY, 'OBTAINED');
        console.log('✅ UMP: User gave consent - ads can be shown');
        return true;
      } else if (consentInfo.status === AdsConsentStatus.NOT_REQUIRED) {
        this.consentStatus = 'NOT_REQUIRED';
        await AsyncStorage.setItem(CONSENT_STATUS_KEY, 'NOT_REQUIRED');
        console.log('✅ UMP: User outside EEA - ads can be shown');
        return true;
      } else {
        // User hat abgelehnt oder Status unklar
        console.log('⚠️ UMP: Consent not obtained, status:', consentInfo.status);
        // Erlaube trotzdem non-personalized ads
        return true;
      }

    } catch (error) {
      console.error('❌ UMP form error:', error);
      // Fallback: Erlaube non-personalized ads
      return true;
    }
  }
  
  /**
   * Prüft ob Consent bereits gegeben wurde
   */
  async hasConsent(): Promise<boolean> {
    const savedStatus = await AsyncStorage.getItem(CONSENT_STATUS_KEY);
    return savedStatus === 'OBTAINED' || savedStatus === 'NOT_REQUIRED';
  }

  /**
   * Prüft ob Ads gezeigt werden können
   * UNKNOWN wird als "erlauben" behandelt (Fallback zu personalized ads)
   */
  canShowAds(): boolean {
    // OBTAINED, NOT_REQUIRED, UNKNOWN → Ads erlaubt
    // Nur REQUIRED blockiert (bis Consent gegeben)
    return this.consentStatus !== 'REQUIRED';
  }

  /**
   * Holt aktuellen Consent Status
   */
  getConsentStatus(): ConsentStatus {
    return this.consentStatus;
  }
  
  /**
   * Gibt die Ad Request Options basierend auf Consent Status zurück
   * FALSE = Personalized Ads (Standard, wenn Consent gegeben oder unbekannt)
   * TRUE = Non-Personalized Ads (nur wenn Consent explizit REQUIRED)
   */
  getAdRequestOptions(): { requestNonPersonalizedAdsOnly: boolean } {
    // Standard: Personalized Ads (false)
    // Nur wenn REQUIRED (explizit Consent nötig) → Non-Personalized (true)
    // OBTAINED, NOT_REQUIRED, UNKNOWN → Personalized (false)
    const useNonPersonalized = this.consentStatus === 'REQUIRED';
    
    return {
      requestNonPersonalizedAdsOnly: useNonPersonalized
    };
  }

  /**
   * Reset Consent (für Testing/Debugging)
   */
  async resetConsent(): Promise<void> {
    try {
      await AsyncStorage.removeItem(CONSENT_STATUS_KEY);
      await AsyncStorage.removeItem(LAST_CONSENT_CHECK_KEY);
      
      if (!isExpoGo()) {
        const { AdsConsent } = require('react-native-google-mobile-ads');
        await AdsConsent.reset();
      }
      
      this.consentStatus = 'UNKNOWN';
      console.log('🔄 UMP: Consent reset');
    } catch (error) {
      console.error('❌ UMP reset error:', error);
    }
  }
  
  /**
   * Force Consent Form (für Testing in Deutschland)
   */
  async forceShowConsentForm(): Promise<void> {
    try {
      const { AdsConsent, AdsConsentDebugGeography } = require('react-native-google-mobile-ads');
      
      // Reset + EEA erzwingen
      await this.resetConsent();
      await AdsConsent.setDebugGeography(AdsConsentDebugGeography.EEA);
      
      // Neu initialisieren
      await this.initialize();
      
      // Form zeigen
      await this.showConsentFormIfRequired();
      
      console.log('✅ UMP: Forced consent form shown');
    } catch (error) {
      console.error('❌ Force consent error:', error);
    }
  }
}

export const consentService = new ConsentService();

