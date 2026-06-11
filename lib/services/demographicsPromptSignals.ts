/**
 * Aufschub-Signale für das Demografie-Sheet (User-Spec 2026-06-11):
 * Nach KOMPLETT durchlaufenem Home-Walkthrough darf das Sheet sofort
 * kommen. Nach SKIP erst, wenn der User "angekommen" ist — beim
 * 2. App-Start ODER nach dem ersten Produktbesuch (+ Rückkehr zum
 * Home, die der Fokus-Effect des Sheets ohnehin abwartet).
 *
 * Bewusst AsyncStorage-Service (CLAUDE.md: Keys nie direkt schreiben).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const START_COUNT_KEY = 'demographics_app_start_count_v1';
const PRODUCT_VISITED_KEY = 'demographics_product_visited_v1';

// Pro JS-Boot genau einmal zählen (Fast-Refresh/Re-Mounts zählen nicht).
let startRegisteredThisBoot = false;

export async function registerAppStart(): Promise<void> {
  if (startRegisteredThisBoot) return;
  startRegisteredThisBoot = true;
  try {
    const raw = await AsyncStorage.getItem(START_COUNT_KEY);
    const current = raw ? parseInt(raw, 10) || 0 : 0;
    await AsyncStorage.setItem(START_COUNT_KEY, String(current + 1));
  } catch {
    /* non-fatal — Aufschub bleibt dann einfach länger aktiv */
  }
}

export async function getAppStartCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(START_COUNT_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function markProductVisited(): Promise<void> {
  try {
    await AsyncStorage.setItem(PRODUCT_VISITED_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

export async function wasProductVisited(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRODUCT_VISITED_KEY)) === '1';
  } catch {
    return false;
  }
}
