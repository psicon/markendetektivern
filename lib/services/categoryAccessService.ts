import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { FirestoreDocument, Kategorien } from '../types/firestore';

/**
 * v6-Regel (siehe docs/DESIGN_SYSTEM.md §15):
 * Alle Kategorien sind frei zugänglich — mit EINER Ausnahme: `alkohol`
 * benötigt Level 3 (Produktdetektiv). Die Freischaltung kann entweder
 * durch Level-Up oder temporär durch einen Rewarded Ad erfolgen.
 *
 * Das Mapping überschreibt den Firestore-Wert `getsFreeAtLevel` für die
 * Gating-Entscheidung. Firestore bleibt unangetastet; eine Bereinigung
 * der DB (alle anderen auf 0 setzen) kann unabhängig erfolgen.
 *
 * Schlüssel = `bezeichnung.toLowerCase()` der Kategorie (robuster als Doc-ID,
 * da die Bezeichnung auch im Rest der App als Normalized Key genutzt wird).
 */
const GATED_CATEGORIES: Record<string, number> = {
  alkohol: 3,
};

function getEffectiveRequiredLevel(category: Pick<Kategorien, 'bezeichnung'>): number {
  const key = category.bezeichnung?.toLowerCase?.() ?? '';
  return GATED_CATEGORIES[key] ?? 0;
}

interface CategoryWithAccess extends FirestoreDocument<Kategorien> {
  isLocked: boolean;
  requiredLevel: number;
  unlocksAtLevel?: number;
  temporaryUnlock?: {
    unlockedAt: number;
    expiresAt: number;
  };
}

interface TemporaryUnlock {
  unlockedAt: number;
  expiresAt: number;
}

interface TemporaryUnlocks {
  [categoryId: string]: TemporaryUnlock;
}

class CategoryAccessService {
  private static instance: CategoryAccessService;
  private cachedCategories: CategoryWithAccess[] = [];
  private lastCacheTime = 0;
  private cacheDuration = 5 * 60 * 1000; // 5 Minuten Cache
  private temporaryUnlocks: TemporaryUnlocks = {};
  private TEMP_UNLOCKS_KEY = 'temporary_category_unlocks';

  private constructor() {
    this.loadTemporaryUnlocks();
  }

  static getInstance(): CategoryAccessService {
    if (!CategoryAccessService.instance) {
      CategoryAccessService.instance = new CategoryAccessService();
    }
    return CategoryAccessService.instance;
  }

  /**
   * Lädt temporäre Freischaltungen aus AsyncStorage
   */
  private async loadTemporaryUnlocks(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(this.TEMP_UNLOCKS_KEY);
      if (stored) {
        const unlocks = JSON.parse(stored) as TemporaryUnlocks;
        // Entferne abgelaufene Freischaltungen
        const now = Date.now();
        Object.keys(unlocks).forEach(categoryId => {
          if (unlocks[categoryId].expiresAt <= now) {
            delete unlocks[categoryId];
          }
        });
        this.temporaryUnlocks = unlocks;
        // Speichere bereinigten Stand
        await this.saveTemporaryUnlocks();
      }
    } catch (error) {
      console.error('❌ Fehler beim Laden temporärer Freischaltungen:', error);
    }
  }

  /**
   * Speichert temporäre Freischaltungen in AsyncStorage
   */
  private async saveTemporaryUnlocks(): Promise<void> {
    try {
      await AsyncStorage.setItem(this.TEMP_UNLOCKS_KEY, JSON.stringify(this.temporaryUnlocks));
    } catch (error) {
      console.error('❌ Fehler beim Speichern temporärer Freischaltungen:', error);
    }
  }

  /**
   * Schaltet eine Kategorie temporär frei (24 Stunden)
   */
  async unlockCategoryTemporarily(categoryId: string): Promise<void> {
    const now = Date.now();
    const expiresAt = now + (24 * 60 * 60 * 1000); // 24 Stunden

    this.temporaryUnlocks[categoryId] = {
      unlockedAt: now,
      expiresAt
    };

    await this.saveTemporaryUnlocks();
    // Cache leeren um Änderungen sofort sichtbar zu machen
    this.clearCache();
  }

  /**
   * Prüft ob eine Kategorie temporär freigeschaltet ist
   */
  isCategoryTemporarilyUnlocked(categoryId: string): boolean {
    const unlock = this.temporaryUnlocks[categoryId];
    if (!unlock) return false;

    const now = Date.now();
    if (unlock.expiresAt > now) {
      return true;
    } else {
      // Abgelaufene Freischaltung entfernen
      delete this.temporaryUnlocks[categoryId];
      this.saveTemporaryUnlocks(); // Async speichern
      return false;
    }
  }

  /**
   * Gibt die verbleibende Zeit einer temporären Freischaltung zurück
   */
  getTemporaryUnlockRemaining(categoryId: string): number {
    const unlock = this.temporaryUnlocks[categoryId];
    if (!unlock) return 0;

    const now = Date.now();
    const remaining = unlock.expiresAt - now;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Lädt alle Kategorien mit Access-Informationen.
   *
   * @param userLevel - Aktuelles User-Level
   * @param isPremium - @deprecated Seit v6 wird `isPremium` für Kategorie-Gating
   *   ignoriert; Parameter bleibt für API-Kompatibilität erhalten. Gating
   *   erfolgt ausschließlich via GATED_CATEGORIES + Level + Temp-Unlock.
   */
  async getAllCategoriesWithAccess(userLevel: number, isPremium: boolean = false): Promise<CategoryWithAccess[]> {
    const now = Date.now();

    // Cache verwenden wenn noch gültig
    if (this.cachedCategories.length > 0 && now - this.lastCacheTime < this.cacheDuration) {
      return this.mapCategoriesWithAccess(this.cachedCategories, userLevel, isPremium);
    }

    try {
      // Lade alle Kategorien aus Firestore
      const kategorienRef = collection(db, 'kategorien');
      const querySnapshot = await getDocs(kategorienRef);

      const categories: CategoryWithAccess[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data() as Kategorien;
        const requiredLevel = getEffectiveRequiredLevel(data);

        const temporaryUnlock = this.isCategoryTemporarilyUnlocked(doc.id)
          ? this.temporaryUnlocks[doc.id]
          : undefined;

        const isTemporarilyUnlocked = this.isCategoryTemporarilyUnlocked(doc.id);
        const isLocked = requiredLevel > 0 && userLevel < requiredLevel && !isTemporarilyUnlocked;

        categories.push({
          id: doc.id,
          ...data,
          isLocked,
          requiredLevel,
          unlocksAtLevel: requiredLevel > 0 ? requiredLevel : undefined,
          temporaryUnlock,
        });
      });
      
      // Sortiere alphabetisch
      categories.sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'));
      
      // Cache aktualisieren
      this.cachedCategories = categories;
      this.lastCacheTime = now;
      
      return this.mapCategoriesWithAccess(categories, userLevel, isPremium);
    } catch (error) {
      console.error('❌ Fehler beim Laden der Kategorien mit Access:', error);
      return [];
    }
  }

  /**
   * Gibt nur die für den User verfügbaren Kategorien zurück
   */
  async getAvailableCategories(userLevel: number, isPremium: boolean = false): Promise<CategoryWithAccess[]> {
    const allCategories = await this.getAllCategoriesWithAccess(userLevel, isPremium);
    return allCategories.filter(cat => !cat.isLocked);
  }

  /**
   * Gibt nur die gesperrten Kategorien zurück
   */
  async getLockedCategories(userLevel: number, isPremium: boolean = false): Promise<CategoryWithAccess[]> {
    const allCategories = await this.getAllCategoriesWithAccess(userLevel, isPremium);
    return allCategories.filter(cat => cat.isLocked);
  }

  /**
   * Prüft ob eine spezifische Kategorie verfügbar ist
   */
  async isCategoryAvailable(categoryId: string, userLevel: number, isPremium: boolean = false): Promise<boolean> {
    // Check temporary unlock first
    if (this.isCategoryTemporarilyUnlocked(categoryId)) {
      return true;
    }
    
    const allCategories = await this.getAllCategoriesWithAccess(userLevel, isPremium);
    const category = allCategories.find(cat => cat.id === categoryId);
    return category ? !category.isLocked : true; // Default: verfügbar wenn nicht gefunden
  }

  /**
   * Gibt die Kategorie zurück, die bei einem bestimmten Level freigeschaltet wird.
   * Nutzt GATED_CATEGORIES als Quelle der Wahrheit (Firestore-Wert wird ignoriert).
   */
  async getCategoryUnlockedAtLevel(level: number): Promise<CategoryWithAccess | null> {
    const gatedKey = Object.entries(GATED_CATEGORIES).find(([, lvl]) => lvl === level)?.[0];
    if (!gatedKey) return null;

    try {
      const kategorienRef = collection(db, 'kategorien');
      const querySnapshot = await getDocs(kategorienRef);

      for (const doc of querySnapshot.docs) {
        const data = doc.data() as Kategorien;
        if (data.bezeichnung?.toLowerCase?.() === gatedKey) {
          return {
            id: doc.id,
            ...data,
            isLocked: false,
            requiredLevel: level,
            unlocksAtLevel: level,
          };
        }
      }

      return null;
    } catch (error) {
      console.error(`❌ Fehler beim Laden der Kategorie für Level ${level}:`, error);
      return null;
    }
  }

  /**
   * Gibt alle Kategorien zurück die in zukünftigen Levels freigeschaltet werden
   */
  async getUpcomingCategories(currentLevel: number, isPremium: boolean = false): Promise<CategoryWithAccess[]> {
    const allCategories = await this.getAllCategoriesWithAccess(currentLevel, isPremium);
    return allCategories
      .filter(cat => cat.isLocked && cat.requiredLevel > currentLevel)
      .sort((a, b) => a.requiredLevel - b.requiredLevel);
  }

  /**
   * Hilfsfunktion um Access-Status basierend auf User-Level zu mappen.
   * `isPremium` ist seit v6 ohne Wirkung (siehe JSDoc von `getAllCategoriesWithAccess`).
   */
  private mapCategoriesWithAccess(categories: CategoryWithAccess[], userLevel: number, _isPremium: boolean = false): CategoryWithAccess[] {
    return categories.map(cat => {
      const isTemporarilyUnlocked = this.isCategoryTemporarilyUnlocked(cat.id);
      const isLocked = cat.requiredLevel > 0 && userLevel < cat.requiredLevel && !isTemporarilyUnlocked;

      const temporaryUnlock = isTemporarilyUnlocked
        ? this.temporaryUnlocks[cat.id]
        : undefined;

      return {
        ...cat,
        isLocked,
        temporaryUnlock,
      };
    });
  }

  /**
   * Cache leeren (z.B. nach Level-Up)
   */
  clearCache(): void {
    this.cachedCategories = [];
    this.lastCacheTime = 0;
  }

  /**
   * Entfernt alle temporären Freischaltungen (Debug/Test)
   */
  async resetAllTemporaryUnlocks(): Promise<void> {
    try {
      this.temporaryUnlocks = {};
      await AsyncStorage.removeItem(this.TEMP_UNLOCKS_KEY);
      this.clearCache();
      console.log('🔄 Alle temporären Kategorie-Freischaltungen wurden zurückgesetzt.');
    } catch (error) {
      console.error('❌ Fehler beim Zurücksetzen der temporären Freischaltungen:', error);
      throw error;
    }
  }
}

export const categoryAccessService = CategoryAccessService.getInstance();
