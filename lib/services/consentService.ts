import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { isExpoGo } from '../utils/platform';

const CONSENT_STATUS_KEY = '@user_consent_status';
const LAST_CONSENT_CHECK_KEY = '@last_consent_check';
const CONSENT_CHECK_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 Tage

export type ConsentStatus = 'OBTAINED' | 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN';

class ConsentService {
  private consentStatus: ConsentStatus = 'UNKNOWN';
  private consentInfoUpdateListener: any = null;

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
        console.log('📝 UMP: Consent required - will show form');
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
      // Fallback: Erlaube non-personalized Ads
      this.consentStatus = 'NOT_REQUIRED';
      return 'NOT_REQUIRED';
    }
  }

  /**
   * Zeigt Consent Form (nur wenn nötig)
   */
  async showConsentFormIfRequired(): Promise<boolean> {
    try {
      if (this.consentStatus !== 'REQUIRED') {
        console.log('⏭️ UMP: Consent form not required');
        return true; // Ads können gezeigt werden
      }

      const { AdsConsent } = require('react-native-google-mobile-ads');

      console.log('📝 UMP: Loading consent form...');
      
      // Load consent form
      const consentForm = await AdsConsent.loadConsentForm();
      
      console.log('📝 UMP: Showing consent form...');
      
      // Show form
      const formResult = await consentForm.show();
      
      console.log('✅ UMP: Consent form result:', formResult);

      // Update status
      const consentInfo = await AdsConsent.requestInfoUpdate();
      
      if (consentInfo.canRequestAds) {
        this.consentStatus = 'OBTAINED';
        await AsyncStorage.setItem(CONSENT_STATUS_KEY, 'OBTAINED');
        console.log('✅ UMP: User gave consent - ads can be shown');
        return true;
      } else {
        console.log('⚠️ UMP: User declined consent');
        return false;
      }

    } catch (error) {
      console.error('❌ UMP form error:', error);
      // Fallback: non-personalized ads erlauben
      return true;
    }
  }

  /**
   * Prüft ob Ads gezeigt werden können
   */
  canShowAds(): boolean {
    return this.consentStatus === 'OBTAINED' || this.consentStatus === 'NOT_REQUIRED';
  }

  /**
   * Holt aktuellen Consent Status
   */
  getConsentStatus(): ConsentStatus {
    return this.consentStatus;
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
}

export const consentService = new ConsentService();

