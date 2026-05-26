import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Onboarding-Status-Modell (v2)
 *
 * Ein einziges Enum-Feld in AsyncStorage statt zweier Booleans
 * (`_completed` + `_skipped`) wie im v1-Schema. Damit können wir
 * zwischen den verschiedenen "fertig"-Pfaden unterscheiden ohne
 * sie zu vermischen.
 *
 *   pending           — User hat Onboarding noch nicht gestartet
 *                       (oder wurde frisch reset)
 *   in_progress       — Onboarding läuft (mind. 1 Step passiert)
 *   completed         — User hat Climax erreicht + ggf. Auth gewählt
 *   skipped_early     — User hat im Hero-Screen "Später" gedrückt
 *                       (= keine Daten erfasst)
 *   skipped_mid       — User hat ab Step 2 die Skip-Pille gedrückt
 *                       (= Teil-Daten erfasst, in Firestore-Session
 *                       als status='abandoned')
 *
 * Migration aus v1:
 *   _completed=true → completed
 *   _skipped=true   → skipped_early (best guess, kein Step-Tracking
 *                     in v1)
 */
export type OnboardingStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped_early'
  | 'skipped_mid';

/** Storage-Keys. v1 = alte Booleans (werden bei Migration entfernt). */
const KEY_STATUS_V2 = 'onboarding_v2_status';
const KEY_PROGRESS = 'onboarding_v2_progress';

// Legacy v1 Keys — nur für Migration nötig
const LEGACY_KEY_COMPLETED = 'onboarding_v1_completed';
const LEGACY_KEY_SKIPPED = 'onboarding_v1_skipped';
const LEGACY_KEY_PROGRESS = 'onboarding_v1_progress';

export interface OnboardingProgress {
  currentStep: number;
  completedSteps: number[];
  data: any;
}

export class OnboardingService {
  /**
   * Liest den aktuellen Status. Migriert v1 → v2 wenn nötig
   * (one-shot, idempotent). Cached innerhalb des Prozess-Lifecycles.
   *
   * Lifecycle:
   *   pending → in_progress (auf "Los geht's"-Tap)
   *   in_progress → completed (Climax-Auth abgeschlossen)
   *   in_progress → skipped_mid (Skip-Pille ab Step 2)
   *   pending → skipped_early (Skip vom Hero — kein in_progress)
   *
   * Caller: app/index.tsx (Boot-Route), onboarding/index.tsx
   * (lifecycle).
   */
  static async getStatus(): Promise<OnboardingStatus> {
    try {
      const v2 = await AsyncStorage.getItem(KEY_STATUS_V2);
      if (v2) return v2 as OnboardingStatus;

      // Migration: v1-Booleans nachschauen + auf v2 hochziehen
      const [completed, skipped] = await Promise.all([
        AsyncStorage.getItem(LEGACY_KEY_COMPLETED),
        AsyncStorage.getItem(LEGACY_KEY_SKIPPED),
      ]);
      let migrated: OnboardingStatus = 'pending';
      if (completed === 'true') migrated = 'completed';
      else if (skipped === 'true') migrated = 'skipped_early';

      if (migrated !== 'pending') {
        // Persist + cleanup alte Keys.
        await AsyncStorage.setItem(KEY_STATUS_V2, migrated);
        await Promise.all([
          AsyncStorage.removeItem(LEGACY_KEY_COMPLETED),
          AsyncStorage.removeItem(LEGACY_KEY_SKIPPED),
          AsyncStorage.removeItem(LEGACY_KEY_PROGRESS),
        ]);
      }
      return migrated;
    } catch (error) {
      console.error('[OnboardingService] getStatus failed:', error);
      return 'pending';
    }
  }

  /**
   * Setzt den Status. Atomar — die einzige Stelle die in den
   * Storage schreibt. Kein anderer Code darf direkt AsyncStorage
   * für Onboarding-Status anfassen (siehe CLAUDE.md Best Practices).
   *
   * Side-effect: bei 'completed' werden auch die Progress-Daten
   * gelöscht (Resume nicht mehr nötig).
   */
  static async setStatus(status: OnboardingStatus): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY_STATUS_V2, status);
      if (status === 'completed' || status === 'skipped_early' || status === 'skipped_mid') {
        await AsyncStorage.removeItem(KEY_PROGRESS);
      }
    } catch (error) {
      console.error('[OnboardingService] setStatus failed:', error);
      throw error;
    }
  }

  /**
   * Convenience: hat der User das Onboarding "hinter sich"?
   * (Completed ODER skipped, jeweils). Caller: app/index.tsx
   * Boot-Routing — wenn true → /(tabs), sonst → /onboarding.
   */
  static async hasPassedOnboarding(): Promise<boolean> {
    const status = await this.getStatus();
    return status === 'completed' || status === 'skipped_early' || status === 'skipped_mid';
  }

  /** Convenience: Climax erreicht? Wird in (tabs)/index.tsx für
   *  den Demographics-Bottom-Sheet-Trigger genutzt — wir wollen
   *  den Sheet NUR bei status='completed' zeigen, nicht bei den
   *  Skip-Pfaden. */
  static async wasCompleted(): Promise<boolean> {
    return (await this.getStatus()) === 'completed';
  }

  // ─── Convenience Setters (DRY für die Caller) ───────────────

  static markStarted = () => this.setStatus('in_progress');
  static markCompleted = () => this.setStatus('completed');
  static markSkippedEarly = () => this.setStatus('skipped_early');
  static markSkippedMid = () => this.setStatus('skipped_mid');

  // ─── Progress (Resume-Support) ──────────────────────────────
  // 2026-05-22: Resume ist aktuell NICHT integriert in den
  // onboarding/index.tsx-Flow. Behält die Methoden aber damit
  // T2 (Variante B) sie auf Wunsch einbauen kann ohne Service-
  // Erweiterung. Wenn T2 entscheidet kein Resume zu bauen,
  // werden diese 3 Methoden im selben Task gelöscht.

  static async saveProgress(progress: OnboardingProgress): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY_PROGRESS, JSON.stringify(progress));
    } catch (error) {
      console.error('[OnboardingService] saveProgress failed:', error);
    }
  }

  static async loadProgress(): Promise<OnboardingProgress | null> {
    try {
      const json = await AsyncStorage.getItem(KEY_PROGRESS);
      return json ? JSON.parse(json) : null;
    } catch (error) {
      console.error('[OnboardingService] loadProgress failed:', error);
      return null;
    }
  }

  static async clearProgress(): Promise<void> {
    try {
      await AsyncStorage.removeItem(KEY_PROGRESS);
    } catch (error) {
      console.error('[OnboardingService] clearProgress failed:', error);
    }
  }

  /**
   * Reset für Testing / Debug-Screen. Löscht ALLE Schlüssel
   * (v2 + v1-Legacy) — User landet beim nächsten App-Start wieder
   * in /onboarding.
   *
   * Aufrufer: app/profile.tsx Debug-Aktion (kein direkter
   * AsyncStorage-Touch mehr — geht durch diesen Service).
   */
  static async resetOnboarding(): Promise<void> {
    try {
      await Promise.all([
        AsyncStorage.removeItem(KEY_STATUS_V2),
        AsyncStorage.removeItem(KEY_PROGRESS),
        // Auch Legacy-Keys mit löschen falls Migration nicht lief.
        AsyncStorage.removeItem(LEGACY_KEY_COMPLETED),
        AsyncStorage.removeItem(LEGACY_KEY_SKIPPED),
        AsyncStorage.removeItem(LEGACY_KEY_PROGRESS),
      ]);
      console.log('[OnboardingService] reset complete');
    } catch (error) {
      console.error('[OnboardingService] reset failed:', error);
      throw error;
    }
  }
}
