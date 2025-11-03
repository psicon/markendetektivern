import { AppState, AppStateStatus } from 'react-native';
import { auth } from '../firebase';
import { revenueCatService } from './revenueCatService';

class AppLifecycleService {
  private static instance: AppLifecycleService;
  private appStateSubscription: any;

  static getInstance(): AppLifecycleService {
    if (!AppLifecycleService.instance) {
      AppLifecycleService.instance = new AppLifecycleService();
    }
    return AppLifecycleService.instance;
  }

  initialize() {
    // Überwache App-State Changes
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    console.log('📱 App Lifecycle Service initialized');
  }

  private handleAppStateChange = async (nextAppState: AppStateStatus) => {
    console.log('📱 App State Changed:', nextAppState);
    
    if (nextAppState === 'active') {
      // App kommt in den Vordergrund
      await this.handleAppResume();
    }
  };

  private handleAppResume = async () => {
    try {
      // 1. Firebase Auth Token erneuern (falls nötig)
      const user = auth.currentUser;
      if (user) {
        // Force token refresh
        await user.getIdToken(true);
        console.log('✅ Auth token refreshed');
      } else {
        // 🔧 KEIN USER? Versuche Session wiederherzustellen!
        console.log('⚠️ Kein Auth User gefunden - versuche Wiederherstellung...');
        
        try {
          // Warte kurz, manchmal braucht Firebase etwas Zeit
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const currentUser = auth.currentUser;
          if (currentUser) {
            console.log('✅ Auth User wiederhergestellt:', currentUser.uid);
          } else {
            console.log('⚠️ Auth User wirklich verloren - Anonymous Login wird getriggert');
            // AuthContext wird automatisch anonymous login machen
          }
        } catch (error) {
          console.error('❌ Session recovery error:', error);
        }
      }

      // 2. RevenueCat Customer Info neu laden
      if (revenueCatService.isInitialized) {
        await revenueCatService.getCustomerInfo();
        console.log('✅ RevenueCat info refreshed');
      }
    } catch (error) {
      console.error('❌ Error refreshing app state:', error);
    }
  };

  cleanup() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
  }
}

export default AppLifecycleService.getInstance();
