import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Service für Gamification-Einstellungen
 *
 * Verwaltet einen einzigen Toggle: "Spielerische Inhalte aktiv?".
 * Wenn deaktiviert, sollen ALLE rein spielerischen UI-Elemente
 * (Level-Hero, Punkte-Toasts, Achievement-Banner/Modals,
 * Bestenliste, Streaks) verschwinden. Echte Wert-Anzeigen
 * (Cashback-Taler in €, Sparpotenzial in €) bleiben sichtbar —
 * das ist Kerninhalt der App, kein Spielelement.
 *
 * ─── Reactive Subscription ────────────────────────────────────
 *
 * Service hält den letzten bekannten State im Speicher und ruft
 * registrierte Listener auf, wenn er sich ändert. Damit kann der
 * `useGamificationEnabled()`-Hook den aktuellen Wert synchron
 * (im ersten Render) liefern UND auf Toggle-Änderungen sofort
 * reagieren — ohne dass jeder Consumer eine async-Lookup-Pipeline
 * pflegen muss.
 */

const STORAGE_KEYS = {
  NOTIFICATIONS_DISABLED: '@gamification_notifications_disabled',
};

type Listener = (enabled: boolean) => void;

class GamificationSettingsService {
  // In-Memory-Cache: speichert "disabled". Lazy-initialisiert beim
  // ersten Storage-Read; bis dahin `null` (= unknown). Caller die
  // synchron rendern müssen sollten `null` als optimistic
  // "enabled" interpretieren — sonst flackert UI beim Cold Start.
  private cachedDisabled: boolean | null = null;
  private listeners = new Set<Listener>();

  /**
   * Synchroner Lesezugriff auf den enabled-State. Liefert `null`
   * wenn der Service noch nie aus AsyncStorage geladen wurde.
   */
  getCachedEnabled(): boolean | null {
    if (this.cachedDisabled === null) return null;
    return !this.cachedDisabled;
  }

  /**
   * Lädt den State aus AsyncStorage und cached ihn. Idempotent;
   * weitere Aufrufe liefern den gecachten Wert ohne Storage-IO.
   * Wird vom Provider beim Mount gerufen, damit der erste UI-
   * Render nicht mit dem optimistic default arbeiten muss.
   */
  async loadInitial(): Promise<boolean> {
    if (this.cachedDisabled !== null) return !this.cachedDisabled;
    try {
      const value = await AsyncStorage.getItem(
        STORAGE_KEYS.NOTIFICATIONS_DISABLED,
      );
      this.cachedDisabled = value === 'true';
    } catch (error) {
      console.error('Error loading gamification setting:', error);
      this.cachedDisabled = false; // default: aktiviert
    }
    return !this.cachedDisabled;
  }

  /**
   * Prüfe ob Gamification-Benachrichtigungen deaktiviert sind.
   * Kompatibilitäts-Endpoint für bestehende Code-Pfade. Neue
   * Consumer nehmen `useGamificationEnabled()` (Hook) oder
   * `getCachedEnabled()` (sync).
   */
  async areNotificationsDisabled(): Promise<boolean> {
    if (this.cachedDisabled !== null) return this.cachedDisabled;
    try {
      const value = await AsyncStorage.getItem(
        STORAGE_KEYS.NOTIFICATIONS_DISABLED,
      );
      this.cachedDisabled = value === 'true';
      return this.cachedDisabled;
    } catch (error) {
      console.error(
        'Error checking gamification notifications setting:',
        error,
      );
      return false;
    }
  }

  /**
   * Setze Gamification-Benachrichtigungen Status. Schreibt nach
   * AsyncStorage und benachrichtigt alle Listener synchron damit
   * UI-Updates direkt durchpurzeln.
   */
  async setNotificationsDisabled(disabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.NOTIFICATIONS_DISABLED,
        disabled ? 'true' : 'false',
      );
      this.cachedDisabled = disabled;
      const enabled = !disabled;
      for (const fn of Array.from(this.listeners)) {
        try {
          fn(enabled);
        } catch (e) {
          console.warn('Gamification listener threw (non-fatal):', e);
        }
      }
      console.log(
        `✅ Gamification notifications ${
          disabled ? 'deaktiviert' : 'aktiviert'
        }`,
      );
    } catch (error) {
      console.error('Error setting gamification notifications:', error);
      throw error;
    }
  }

  /**
   * Listener-Registrierung. Liefert eine Cleanup-Funktion zurück;
   * Caller (Hook) deregistriert beim Unmount.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const gamificationSettingsService = new GamificationSettingsService();

// ─── Achievement Presentation Tier ────────────────────────────
//
// Achievements werden in zwei Stufen präsentiert:
//
//   • 'subtle' — kompakter Banner unten oberhalb der Tab-Bar,
//     mit Lottie + Text + Punkte. Auto-dismiss 5 s, swipe/tap
//     zum sofortigen Wegklicken. Soll feiern ohne den User zu
//     unterbrechen — passend für Trivial-Schwellen ("erste
//     Aktion", "1 Tag Streak", niedrigschwellige Punkte).
//
//   • 'major' — vollformatiges Modal mit Konfetti + Haptik
//     (= bestehende AchievementUnlockOverlay-Komponente). Soll
//     genuin festlich wirken — passend für echte Meilensteine
//     (50/100/500 € gespart, Level 5+, Streak ≥ 7, Cashback-
//     Auszahlung).
//
// Die Tier-Zuordnung läuft via Helper unten (NICHT als Feld auf
// dem Firestore-Achievement-Doc) — heuristik-basiert, ohne dass
// wir den Achievement-Katalog migrieren müssen.

import type { Achievement } from '@/lib/types/achievements';

// HISTORY: Es gab mal ein Tier-System (subtle vs. major) das niedrige
// Achievements/Level-Ups in einen Banner und große in ein Konfetti-
// Modal geroutet hat. User-Feedback: die Konfetti-Modals waren
// inkonsistent mit dem Banner-Stil und wirkten "alt". Wir haben
// das Tier-System komplett entfernt — JEDER Achievement-Unlock und
// JEDES Level-Up läuft jetzt einheitlich durch den
// AchievementUnlockBanner. Die Funktion bleibt als deprecated stub
// für externe Importe (falls noch welche existieren) und für
// zukünftige Erweiterungen falls wir mal wieder differenzieren.
export type AchievementTier = 'subtle';
/** @deprecated Tier-System abgeschafft — alle Celebrations sind jetzt
 *  Banner. Funktion returnt fix 'subtle' für Backward-Compat. */
export function getAchievementTier(_achievement: Achievement): AchievementTier {
  return 'subtle';
}
