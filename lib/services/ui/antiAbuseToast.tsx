import { TOAST_MESSAGES, formatTimeLeft, interpolateMessage } from '@/constants/ToastMessages';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showInfoToast } from './toast';

// Action-Namen für benutzerfreundliche Anzeige
const ACTION_DISPLAY_NAMES: { [key: string]: string } = {
  'scan_product': 'Produkt scannen',
  'compare_products': 'Produkte vergleichen',
  'add_to_cart': 'Zum Einkaufszettel hinzufügen',
  'purchase_product': 'Produkt kaufen',
  'rate_product': 'Produkt bewerten',
  'search_products': 'Produkte suchen',
  'view_product': 'Produkt ansehen',
  'share_product': 'Produkt teilen',
  'complete_shopping': 'Einkauf abschließen',
  'daily_login': 'Täglicher Login',
  'weekly_login': 'Wöchentlicher Login',
  'first_scan': 'Erster Scan',
  'first_purchase': 'Erster Kauf',
  'streak_bonus': 'Streak Bonus'
};

// Fallback für unbekannte Actions
const getActionDisplayName = (action: string): string => {
  return ACTION_DISPLAY_NAMES[action] || action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

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
  const actionName = getActionDisplayName(action);
  
  // Spezifische Nachricht mit Action-Name
  const message = interpolateMessage(TOAST_MESSAGES.ANTI_ABUSE.dedupeWindowSpecific, {
    actionName,
    timeLeft
  });
  
  showInfoToast(message, 'ANTI_ABUSE');
  
  await markShownToday(storageKey);
};

/**
 * Show daily cap toast (nur 1x pro Tag pro Action)
 */
export const showDailyCapToast = async (action: string, limit?: number): Promise<void> => {
  const storageKey = getStorageKey(STORAGE_TYPES.DAILY_CAP_SHOWN, action);
  if (await wasShownToday(storageKey)) {
    return; // Bereits heute gezeigt für diese Action
  }
  
  const actionName = getActionDisplayName(action);
  
  if (limit) {
    // Spezifische Nachricht mit Action-Name und Limit
    const message = interpolateMessage(TOAST_MESSAGES.ANTI_ABUSE.dailyCapReachedSpecific, {
      actionName,
      limit: limit.toString()
    });
    showInfoToast(message, 'ANTI_ABUSE');
  } else {
    // Fallback zur generischen Nachricht
    showInfoToast(TOAST_MESSAGES.ANTI_ABUSE.dailyCapReached, 'ANTI_ABUSE');
  }
  
  await markShownToday(storageKey);
};

/**
 * Show weekly cap toast (nur 1x pro Tag pro Action)
 */
export const showWeeklyCapToast = async (action: string, limit?: number): Promise<void> => {
  const storageKey = getStorageKey(STORAGE_TYPES.WEEKLY_CAP_SHOWN, action);
  if (await wasShownToday(storageKey)) {
    return; // Bereits heute gezeigt für diese Action
  }
  
  const actionName = getActionDisplayName(action);
  
  if (limit) {
    // Spezifische Nachricht mit Action-Name und Limit
    const message = interpolateMessage(TOAST_MESSAGES.ANTI_ABUSE.weeklyCapReachedSpecific, {
      actionName,
      limit: limit.toString()
    });
    showInfoToast(message, 'ANTI_ABUSE');
  } else {
    // Fallback zur generischen Nachricht
    showInfoToast(TOAST_MESSAGES.ANTI_ABUSE.weeklyCapReached, 'ANTI_ABUSE');
  }
  
  await markShownToday(storageKey);
};
