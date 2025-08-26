import AsyncStorage from '@react-native-async-storage/async-storage';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

/**
 * Vollständiger Auth-Reset für Entwicklung
 * WARNUNG: Nur für Development verwenden!
 */
export const resetAuthCompletely = async () => {
  try {
    console.log('🧹 Resetting authentication completely...');
    
    // 1. Firebase signOut
    await signOut(auth);
    console.log('✅ Firebase signed out');
    
    // 2. Clear AsyncStorage (wo Firebase Auth persistiert wird)
    await AsyncStorage.clear();
    console.log('✅ AsyncStorage cleared');
    
    // 3. Reload app
    if (__DEV__) {
      // In development: Zeige Info
      console.log('🔄 Auth reset complete. Restart app to see Welcome screen.');
    }
    
  } catch (error) {
    console.error('❌ Reset auth error:', error);
  }
};

// Export für Debug-Zwecke
if (__DEV__) {
  // @ts-ignore - Global für Debug Console
  global.resetAuth = resetAuthCompletely;
}
