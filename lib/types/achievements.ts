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
  | 'create_list';         // Einkaufszettel erstellen

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
  color?: string;
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
  totalPoints: number;          // Gesammelte Punkte aus Achievements
  currentLevel: number;         // Aktuelles Level
  
  // Savings (separate from points)
  totalSavings: number;         // Ersparnis in €
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
  
  // Streak Management  
  currentStreak: number;        // Aktuelle Streak-Anzahl
  longestStreak: number;        // Längste erreichte Streak
  lastOpenedAt: Date;          // Letzter App-Zugriff
  lastStreakCheckDate: string; // Format: YYYY-MM-DD für tägliche Checks
  
  // Timestamps
  lastActivityAt: Date;
  statsUpdatedAt: Date;
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
}

// Predefined Levels
export const LEVELS: Level[] = [
  {
    id: 1,
    name: 'Sparanfänger',
    description: 'Der erste Schritt',
    savingsRequired: 0,
    pointsRequired: 0,
    reward: 'Zugang zu allen Grundfunktionen',
    icon: 'pawprint',
    color: '#BF8970',
  },
  {
    id: 2,
    name: 'Sparprofi',
    description: 'Ab 50 € Ersparnis & 50 Punkte',
    savingsRequired: 50,
    pointsRequired: 50,
    reward: 'Zugang zu 1 weiteren Kategorie',
    icon: 'trophy',
    color: '#FFB74D',
  },
  {
    id: 3,
    name: 'Sparmeister',
    description: 'Ab 350 € Ersparnis & 150 Punkte',
    savingsRequired: 350,
    pointsRequired: 150,
    reward: 'Zugang zu 1 weiteren Kategorie',
    icon: 'trophy.fill',
    color: '#81C784',
  },
  {
    id: 4,
    name: 'Sparfuchs',
    description: 'Ab 750 € Ersparnis & 300 Punkte',
    savingsRequired: 750,
    pointsRequired: 300,
    reward: 'Zugang zu 2 weiteren Kategorien',
    icon: 'pawprint.fill',
    color: '#FFD54F',
  },
  {
    id: 5,
    name: 'MarkenDetektiv',
    description: 'Ab 1.500 € Ersparnis & 500 Punkte',
    savingsRequired: 1500,
    pointsRequired: 500,
    reward: 'Zugang zu allen Kategorien',
    icon: 'star.fill',
    color: '#FF6B6B',
  },
];

// Default Achievements (will be stored in Firestore)
export const DEFAULT_ACHIEVEMENTS: Omit<Achievement, 'id' | 'createdAt'>[] = [
  {
    name: 'Erste Umwandlung',
    description: 'Wandle dein erstes Markenprodukt zu einem No-Name Produkt um',
    points: 5,
    icon: 'wand.and.stars',
    type: 'one-time',
    trigger: {
      action: 'convert_product',
      target: 1,
    },
    isActive: true,
    sortOrder: 1,
    color: '#007AFF',
  },
  {
    name: 'Einkaufszettelmaster',
    description: '5 No-Name Einkaufszettel erstellen und leer "gekauft"',
    points: 10,
    icon: 'list.bullet',
    type: 'count',
    trigger: {
      action: 'complete_shopping',
      target: 5,
    },
    isActive: true,
    sortOrder: 2,
    color: '#007AFF',
  },
  {
    name: 'Vergleichsexperte',
    description: '10 Produktvergleiche durchführen',
    points: 15,
    icon: 'scale.3d',
    type: 'count',
    trigger: {
      action: 'view_comparison',
      target: 10,
    },
    isActive: true,
    sortOrder: 3,
    color: '#FF9500',
  },
  {
    name: 'Feedbackgeber',
    description: 'Gib 20 Bewertungen für Produkte ab',
    points: 20,
    icon: 'bubble.left',
    type: 'count',
    trigger: {
      action: 'submit_rating',
      target: 20,
    },
    isActive: true,
    sortOrder: 4,
    color: '#FF9500',
  },
  {
    name: 'Treu bleiben',
    description: 'Öffne die App an 30 Tagen in Folge',
    points: 50,
    icon: 'heart',
    type: 'streak',
    trigger: {
      action: 'daily_streak',
      target: 30,
    },
    isActive: true,
    sortOrder: 5,
    color: '#FF2D55',
  },
  {
    name: 'Scanner-Profi',
    description: 'Scanne 50 Produkte',
    points: 20,
    icon: 'barcode',
    type: 'count',
    trigger: {
      action: 'scan_product',
      target: 50,
    },
    isActive: true,
    sortOrder: 6,
    color: '#5AC8FA',
  },
  {
    name: 'Suchmeister',
    description: 'Suche 100 Produkte',
    points: 25,
    icon: 'magnifyingglass',
    type: 'count',
    trigger: {
      action: 'search_product',
      target: 100,
    },
    isActive: true,
    sortOrder: 7,
    color: '#4CD964',
  },
  {
    name: 'Sammler',
    description: 'Speichere 25 Lieblingsprodukte',
    points: 15,
    icon: 'heart.fill',
    type: 'count',
    trigger: {
      action: 'save_product',
      target: 25,
    },
    isActive: true,
    sortOrder: 8,
    color: '#FF3B30',
  },
];
