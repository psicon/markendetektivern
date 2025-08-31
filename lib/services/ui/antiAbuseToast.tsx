import { TOAST_MESSAGES, formatTimeLeft, interpolateMessage } from '@/constants/ToastMessages';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showInfoToast } from './toast';

/**
 * Helper: Generate action-specific storage keys  
 */
const getStorageKey = (type: string, action: string) => `@anti_abuse_${type}_${action}`;

/**
 * LocalStorage key types for tracking shown anti-abuse toasts
 */
const STORAGE_TYPES = {
  ONE_TIME_SHOWN: 'one_time_shown',
  DEDUPE_SHOWN: 'dedupe_shown',
  DAILY_CAP_SHOWN: 'daily_cap_shown', 
  WEEKLY_CAP_SHOWN: 'weekly_cap_shown'
} as const;

/**
 * Helper: Check if anti-abuse toast was already shown today
 */
const wasShownToday = async (storageKey: string): Promise<boolean> => {
  try {
    const lastShown = await AsyncStorage.getItem(storageKey);
    if (!lastShown) return false;
    
    const lastShownDate = new Date(lastShown);
    const today = new Date();
    
    // Check if it was shown today
    return (
      lastShownDate.getFullYear() === today.getFullYear() &&
      lastShownDate.getMonth() === today.getMonth() &&
      lastShownDate.getDate() === today.getDate()
    );
  } catch (error) {
    console.log('Could not check anti-abuse toast status:', error);
    return false;
  }
};

/**
 * Helper: Mark anti-abuse toast as shown today
 */
const markShownToday = async (storageKey: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(storageKey, new Date().toISOString());
  } catch (error) {
    console.log('Could not save anti-abuse toast status:', error);
  }
};

/**
 * Show one-time restriction toast (nur 1x pro Tag pro Action)
 */
export const showOneTimeRestrictionToast = async (action: string): Promise<void> => {
  const storageKey = getStorageKey(STORAGE_TYPES.ONE_TIME_SHOWN, action);
  if (await wasShownToday(storageKey)) {
    return; // Bereits heute gezeigt für diese Action
  }
  
  showInfoToast(
    TOAST_MESSAGES.ANTI_ABUSE.oneTimeRestriction,
    'ANTI_ABUSE'
  );
  
  await markShownToday(storageKey);
};

/**
 * Show dedupe window toast (nur 1x pro Tag pro Action)
 */
export const showDedupeWindowToast = async (action: string, remainingSeconds: number): Promise<void> => {
  const storageKey = getStorageKey(STORAGE_TYPES.DEDUPE_SHOWN, action);
  if (await wasShownToday(storageKey)) {
    return; // Bereits heute gezeigt für diese Action
  }
  
  const timeLeft = formatTimeLeft(remainingSeconds);
  const message = interpolateMessage(TOAST_MESSAGES.ANTI_ABUSE.dedupeWindow, { timeLeft });
  
  showInfoToast(message, 'ANTI_ABUSE');
  
  await markShownToday(storageKey);
};

/**
 * Show daily cap toast (nur 1x pro Tag pro Action)
 */
export const showDailyCapToast = async (action: string): Promise<void> => {
  const storageKey = getStorageKey(STORAGE_TYPES.DAILY_CAP_SHOWN, action);
  if (await wasShownToday(storageKey)) {
    return; // Bereits heute gezeigt für diese Action
  }
  
  showInfoToast(
    TOAST_MESSAGES.ANTI_ABUSE.dailyCapReached,
    'ANTI_ABUSE'
  );
  
  await markShownToday(storageKey);
};

/**
 * Show weekly cap toast (nur 1x pro Tag pro Action)
 */
export const showWeeklyCapToast = async (action: string): Promise<void> => {
  const storageKey = getStorageKey(STORAGE_TYPES.WEEKLY_CAP_SHOWN, action);
  if (await wasShownToday(storageKey)) {
    return; // Bereits heute gezeigt für diese Action
  }
  
  showInfoToast(
    TOAST_MESSAGES.ANTI_ABUSE.weeklyCapReached,
    'ANTI_ABUSE'
  );
  
  await markShownToday(storageKey);
};
