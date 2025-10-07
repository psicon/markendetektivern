import { Platform } from 'react-native';
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
      return;
    }

    try {
      const MobileAds = require('react-native-google-mobile-ads').default;
      
      // Set test devices in dev
      if (__DEV__) {
        await MobileAds.setRequestConfiguration({
          testDeviceIdentifiers: AD_CONFIG.testDeviceIds,
        });
      }

      // Initialize - that's it!
      await MobileAds.initialize();
      this.initialized = true;
      
      console.log('✅ AdMob initialized');
    } catch (error) {
      console.error('❌ AdMob init failed:', error);
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