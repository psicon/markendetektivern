/**
 * Gewählte Produktfoto-Aktion (Single Source of Truth für den Storage-Key).
 *
 * Der Nutzer wählt auf der Produktbilder-Übersicht, für welche laufende Aktion
 * er erfasst; der Wizard liest dieselbe Wahl über `getActiveProductCampaign()`.
 * Persistiert, damit die Wahl App-Neustarts überlebt — aber nur als Vorschlag:
 * `pickProductCampaign` ignoriert eine Wahl, die nicht mehr aktiv ist.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'product_campaign_choice_v1';
let memo: string | null | undefined; // undefined = noch nicht geladen

export async function getChosenProductCampaignId(): Promise<string | null> {
  if (memo !== undefined) return memo;
  try {
    memo = (await AsyncStorage.getItem(KEY)) || null;
  } catch {
    memo = null;
  }
  return memo;
}

export async function setChosenProductCampaignId(id: string | null): Promise<void> {
  memo = id;
  try {
    if (id) await AsyncStorage.setItem(KEY, id);
    else await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.warn('[productCampaignChoice] Speichern fehlgeschlagen (non-fatal):', e);
  }
}
