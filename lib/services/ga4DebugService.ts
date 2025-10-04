// GA4 Debug Service für TestFlight
import { isExpoGo } from '../utils/platform';

class GA4DebugService {
  private static instance: GA4DebugService;
  
  static getInstance(): GA4DebugService {
    if (!GA4DebugService.instance) {
      GA4DebugService.instance = new GA4DebugService();
    }
    return GA4DebugService.instance;
  }

  async testGA4Connection() {
    console.log('🔍 GA4 Debug Test gestartet...');
    
    if (isExpoGo()) {
      console.log('❌ Expo Go erkannt - GA4 nicht verfügbar');
      return false;
    }

    try {
      const analytics = require('@react-native-firebase/analytics').default;
      
      // Test 1: Analytics Objekt verfügbar?
      console.log('✅ Analytics Modul geladen');
      
      // Test 2: Collection aktiviert?
      const isEnabled = await analytics().isAnalyticsCollectionEnabled();
      console.log(`📊 Analytics Collection: ${isEnabled ? '✅ AKTIVIERT' : '❌ DEAKTIVIERT'}`);
      
      if (!isEnabled) {
        console.log('🔧 Aktiviere Analytics Collection...');
        await analytics().setAnalyticsCollectionEnabled(true);
      }
      
      // Test 3: Sende Test-Event
      console.log('📤 Sende Test-Event...');
      await analytics().logEvent('ga4_test_event', {
        test_timestamp: new Date().toISOString(),
        test_source: 'debug_service',
        platform: require('react-native').Platform.OS
      });
      
      console.log('✅ Test-Event gesendet!');
      
      // Test 4: App Instance ID
      const appInstanceId = await analytics().getAppInstanceId();
      console.log(`🆔 App Instance ID: ${appInstanceId}`);
      
      // Test 5: User Properties
      await analytics().setUserProperties({
        ga4_debug_test: 'active',
        test_timestamp: new Date().toISOString()
      });
      
      console.log('✅ User Properties gesetzt');
      
      return true;
    } catch (error) {
      console.error('❌ GA4 Test fehlgeschlagen:', error);
      return false;
    }
  }

  async enableDebugMode() {
    try {
      const analytics = require('@react-native-firebase/analytics').default;
      
      // Aktiviere Debug Mode für GA4
      await analytics().setAnalyticsCollectionEnabled(true);
      
      // Sende Debug-aktiviert Event
      await analytics().logEvent('debug_mode_enabled', {
        timestamp: new Date().toISOString()
      });
      
      console.log('🐛 GA4 Debug Mode aktiviert');
    } catch (error) {
      console.error('❌ Debug Mode Aktivierung fehlgeschlagen:', error);
    }
  }
}

export const ga4DebugService = GA4DebugService.getInstance();
