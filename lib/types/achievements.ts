// Achievement System Types

export type AchievementType = 'count' | 'streak' | 'milestone' | 'one-time';

export type ActionType = 
  | 'convert_product'      // Produkt zu NoName umwandeln
  | 'complete_shopping'     // Einkaufszettel abschließen
  | 'view_comparison'       // Produktvergleich ansehen
  | 'submit_rating'         // Bewertung abgeben
  | 'share_app'            // App teilen (später)
  | 'daily_streak'         // Tägliche App-Nutzung
  | 'scan_product'         // Produkt scannen
  | 'search_product'       // Produkt suchen
  | 'submit_product'       // Produkt einreichen (später)
  | 'save_product'         // Produkt als Favorit speichern
  | 'create_list'          // Einkaufszettel erstellen
  | 'first_action_any'     // Erste Action überhaupt (10 Punkte Bonus)
  | 'mission_daily_done'   // Tägliche Mission abgeschlossen
  | 'mission_weekly_done'  // Wöchentliche Mission abgeschlossen
  | 'savings_total';       // Für Savings-Milestones (100€, 500€ etc.)

// Achievement Definition in Firestore
export interface Achievement {
  id: string;
  name: string;
  description: string;
  points: number;
  icon: string;
  type: AchievementType;
  trigger: {
    action: ActionType;
    target: number;              // Zielwert (z.B. 5 für "5 Einkaufszettel")
    resetPeriod?: 'daily' | 'weekly' | 'monthly';
  };
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt?: Date;
  color?: string;
  lottieAnimation?: string;     // Lottie Animation für Achievement
}

// User Achievement Progress
export interface UserAchievementProgress {
  achievementId: string;
  progress: number;
  completed: boolean;
  completedAt?: Date;
  lastUpdated: Date;
}

// User Stats for tracking
export interface UserStats {
  // Points & Level
  pointsTotal: number;          // Gesammelte Punkte aus Achievements (neu: ersetzt totalPoints)
  currentLevel: number;         // Aktuelles Level
  
  // Savings (separate from points)
  savingsTotal: number;         // Ersparnis in € (neu: ersetzt totalSavings für Konsistenz)
  productsSaved: number;        // Anzahl gekaufter NoName Produkte
  
  // Activity Counters
  conversions: number;          // Produkte umgewandelt
  shoppingListsCompleted: number;
  comparisonsViewed: number;
  ratingsSubmitted: number;
  productsScanned: number;
  productsSearched: number;
  favoritesAdded: number;
  listsCreated: number;
  
  // Streak Management (erweitert)
  currentStreak: number;        // Aktuelle Streak-Anzahl
  longestStreak: number;        // Längste erreichte Streak
  lastOpenedAt: Date;          // Letzter App-Zugriff
  lastStreakCheckDate: string; // Format: YYYY-MM-DD für tägliche Checks
  lastStreakActiveDayDate?: string; // Letzter Tag mit aktiver Streak-Activity
  streakTier: number;          // Aktueller Streak-Tier (1-5)
  freezeTokens: number;        // Verfügbare Freeze-Token
  
  // Timestamps
  lastActivityAt: Date;
  statsUpdatedAt: Date;
  
  // Backwards compatibility (optional, kann später entfernt werden)
  totalPoints?: number;        // Deprecated: Use pointsTotal instead
  totalSavings?: number;       // Deprecated: Use savingsTotal instead
}

// Extended UserProfile with Achievement Data
export interface UserProfileWithAchievements {
  // ... existing UserProfile fields ...
  
  // Achievement System
  achievements: {
    [achievementId: string]: UserAchievementProgress;
  };
  
  stats: UserStats;
}

// === NEUE GAMIFICATION INTERFACES ===

// Game Action Definition (für Anti-Abuse System)
export interface GameAction {
  points: number;
  oneTime?: boolean;           // Einmalige Aktion (z.B. first_action_any)
  dailyCap?: number;          // Max. Punkte pro Tag
  weeklyCap?: number;         // Max. Punkte pro Woche
  dedupeWindowSec?: number;   // Anti-Spam Fenster in Sekunden
  minTextLength?: number;     // Min. Textlänge (für Ratings)
  notes?: string;             // Beschreibung/Notizen
  
  // Anti-Abuse Struktur (alternativ zur direkten Properties)
  antiAbuse?: {
    oneTime?: boolean;
    dailyCap?: number;
    weeklyCap?: number;
    dedupeWindowSec?: number;
    minTextLength?: number;
  };
}

// Actions Configuration Map
export interface GameActionsConfig {
  [actionKey: string]: GameAction;
}

// Streak Tier Definition
export interface StreakTier {
  minDays: number;
  maxDays: number;
  dailyBonusPoints: number;
}

// Freeze Token Configuration
export interface FreezeConfig {
  grantedEveryDays: number;   // Alle X Tage ein Token
  maxHeld: number;            // Max. gehaltene Token
}

// Streak System Configuration
export interface StreakConfig {
  activeEvents: string[];     // Actions die für Streak zählen
  tiers: StreakTier[];       // Streak-Tiers mit Bonus-Punkten
  freeze: FreezeConfig;      // Freeze-Token Konfiguration
}

// Ledger Entry für Punkte-Transaktionen
export interface PointsLedgerEntry {
  timestamp: Date;
  action: string;
  points: number;
  metadata?: {
    productId?: string;
    searchTerm?: string;
    ratingText?: string;
    [key: string]: any;
  };
  isDedupe?: boolean;        // War es ein Dedupe-Event?
  isFirstAction?: boolean;   // War es die allererste Action?
}

// Event for tracking actions
export interface AchievementEvent {
  userId: string;
  action: ActionType;
  timestamp: Date;
  metadata?: {
    productId?: string;
    listId?: string;
    comparisonId?: string;
    ratingId?: string;
    value?: number;          // Für Ersparnis-Events
    [key: string]: any;
  };
}

// Level Definition
export interface Level {
  id: number;
  name: string;
  description: string;
  savingsRequired: number;
  pointsRequired: number;
  reward: string;
  icon: string;
  color: string;
  lottieAnimation: string;     // Lottie Animation für Level-Up
  createdAt?: Date;
  updatedAt?: Date;
}

// ============================
// ALLE LOKALEN DATEN GELÖSCHT!
// ============================
// Daten werden jetzt NUR aus Firestore geladen
// - Levels: /gamification/config/levels
// - Actions: /gamification/config/actions
// - Streaks: /gamification/config/streaks
// - Achievements: /achievements
// ============================
