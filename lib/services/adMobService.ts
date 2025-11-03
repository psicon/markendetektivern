import * as Device from 'expo-device';
import { InteractionManager, Platform } from 'react-native';
import { isExpoGo } from '../utils/platform';

// AdMob Configuration
export const AD_CONFIG = {
  ios: {
    banner: 'ca-app-pub-9082891656550991/9971461384',
    interstitial: 'ca-app-pub-9082891656550991/5257538443',
  },
  android: {
    banner: 'ca-app-pub-9082891656550991/3294372397',
    interstitial: 'ca-app-pub-9082891656550991/5912182559',
  },
  testDeviceIds: __DEV__ ? ['EMULATOR'] : [],
};

class AdMobService {
  private initialized = false;

  async initialize() {
    if (this.initialized || isExpoGo()) {
      console.log('⏭️ AdMob init skipped:', { 
        initialized: this.initialized, 
        isExpoGo: isExpoGo() 
      });
      return;
    }

    try {
      // Check if device should skip ads
      if (Platform.OS === 'android') {
        const shouldSkip = await this.shouldSkipAdsForDevice();
        if (shouldSkip) {
          console.log('⏭️ AdMob skipped for problematic device');
          return;
        }
      }

      // Import the module
      const { default: MobileAds } = require('react-native-google-mobile-ads');
      
      console.log('🎯 AdMob module check:', { 
        platform: Platform.OS,
        hasMobileAds: !!MobileAds,
        hasInitializeMethod: typeof MobileAds?.initialize === 'function'
      });
      
      // Set test devices in dev
      if (__DEV__ && MobileAds.setRequestConfiguration) {
        await MobileAds.setRequestConfiguration({
          testDeviceIdentifiers: AD_CONFIG.testDeviceIds,
        });
      }

      // Platform-specific initialization
      if (Platform.OS === 'ios') {
        // iOS: Direct initialization
        const initializationStatus = await MobileAds();
        this.initialized = true;
        console.log('✅ iOS AdMob initialized:', initializationStatus);
      } else {
        // Android: Defensive initialization with delay
        await new Promise((resolve) => {
          InteractionManager.runAfterInteractions(async () => {
            try {
              const initializationStatus = await MobileAds();
              this.initialized = true;
              console.log('✅ Android AdMob initialized:', initializationStatus);
              resolve(initializationStatus);
            } catch (androidError) {
              console.warn('⚠️ Android AdMob init failed (non-critical):', androidError);
              // App continues without ads
              resolve(null);
            }
          });
        });
      }
      
      console.log('✅ AdMob initialization complete:', { 
        platform: Platform.OS,
        initialized: this.initialized,
        bannerAdUnit: this.getAdUnitId('banner')
      });
    } catch (error) {
      console.error('❌ AdMob init failed (non-critical):', { 
        platform: Platform.OS, 
        error: error?.message || error 
      });
      // App continues without ads - no crash
    }
  }

  private async shouldSkipAdsForDevice(): Promise<boolean> {
    try {
      const model = Device.modelId || Device.modelName;
      if (!model) {
        console.log('Could not determine device model');
        return false;
      }
      
      // Samsung A13 5G models that have issues
      const problematicDevices = [
        'SM-A136U', 'SM-A136U1', 'SM-A136B', 'SM-A136W',
        'SM-A125F', 'SM-A125U' // Also A12 with similar issues
      ];
      
      if (problematicDevices.includes(model)) {
        console.log('⚠️ Problematic device detected:', model);
        return true;
      }
      
      return false;
    } catch (error) {
      console.log('Could not check device model:', error);
      return false;
    }
  }

  getAdUnitId(type: 'banner' | 'interstitial'): string {
    const platform = Platform.OS as 'ios' | 'android';
    
    // Use test ads in dev
    if (__DEV__) {
      const testIds = {
        ios: {
          banner: 'ca-app-pub-3940256099942544/2934735716',
          interstitial: 'ca-app-pub-3940256099942544/4411468910',
        },
        android: {
          banner: 'ca-app-pub-3940256099942544/6300978111',
          interstitial: 'ca-app-pub-3940256099942544/1033173712',
        },
      };
      return testIds[platform][type];
    }
    
    return AD_CONFIG[platform][type];
  }

  isAvailable(): boolean {
    return !isExpoGo() && this.initialized;
  }
}

export const adMobService = new AdMobService();