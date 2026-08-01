import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Not-Aus für den Bewertungs-Prompt.
 *
 * WARUM: Die Wirkungsrichtung des Prompts ist vorab unbekannt — er kann
 * den Sterne-Schnitt heben oder senken, je nachdem wie die neu Gefragten
 * bewerten. Ohne Fernschalter ließe sich eine schiefgelaufene Welle NUR
 * mit einem neuen Build stoppen. Und weil alle firstCase-Schlüssel
 * versions-gebunden sind, wäre genau dieser Korrektur-Build das Problem:
 * er trägt eine neue Versionsnummer und würde den Auslöser für die
 * gesamte Basis erneut schärfen. Ein Build kann das also nicht heilen —
 * nur dieser Schalter.
 *
 * FAIL-OPEN, bewusst: Ein Netzfehler, ein fehlendes Dokument oder ein
 * kalter Start dürfen das Feature NICHT abschalten. Nur ein
 * ausdrückliches `enabled: false` im Dokument stoppt es. Andernfalls
 * würde jede Firestore-Störung stillschweigend die Bewertungen
 * abwürgen — ein Ausfall, den niemand bemerkt, weil er wie „läuft halt
 * gerade nicht" aussieht.
 *
 * Gelesen wird höchstens einmal pro Stunde; der letzte bekannte Wert
 * liegt lokal, damit ein Offline-Start nicht auf den Default zurückfällt
 * und der Schalter auch ohne Netz weiter greift.
 */

const DOC_PATH = ['app_config', 'rating'] as const;
const CACHE_KEY = 'ratingKillSwitch/v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 Stunde

let memo: { enabled: boolean; at: number } | null = null;

export async function isRatingPromptEnabled(): Promise<boolean> {
  const now = Date.now();
  if (memo && now - memo.at < CACHE_TTL_MS) return memo.enabled;

  // Lokaler Stand zuerst: trägt den Schalter über Offline-Starts.
  let cached: { enabled: boolean; at: number } | null = null;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch {
    /* egal — dann eben frisch lesen */
  }
  if (cached && now - cached.at < CACHE_TTL_MS) {
    memo = cached;
    return cached.enabled;
  }

  try {
    // Lazy require: hält das Modul import-sicher (Tests, siehe
    // ratingTelemetry). `react-native` bleibt anderswo statisch.
    const { doc, getDoc } = require('@react-native-firebase/firestore');
    const { db } = require('../firebase');
    const snap = await getDoc(doc(db, DOC_PATH[0], DOC_PATH[1]));
    // Nur ein ausdrückliches false schaltet ab. Fehlendes Dokument,
    // fehlendes Feld, kaputter Wert → an.
    const enabled = snap?.exists?.() === false ? true : snap?.data?.()?.enabled !== false;
    memo = { enabled, at: now };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(memo));
    return enabled;
  } catch (e) {
    console.warn('RatingKillSwitch read failed (fail-open):', e);
    // Kein Netz, kein Zugriff → letzter bekannter Wert, sonst AN.
    const fallback = cached?.enabled ?? true;
    memo = { enabled: fallback, at: now };
    return fallback;
  }
}

/** Dev-Panel / Tests: gecachten Stand verwerfen. */
export async function resetRatingKillSwitchCache(): Promise<void> {
  memo = null;
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    /* egal */
  }
}
