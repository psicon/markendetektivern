import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { FirestoreDocument, Kategorien } from '../types/firestore';

interface CategoryWithAccess extends FirestoreDocument<Kategorien> {
  isLocked: boolean;
  requiredLevel: number;
  unlocksAtLevel?: number;
}

class CategoryAccessService {
  private static instance: CategoryAccessService;
  private cachedCategories: CategoryWithAccess[] = [];
  private lastCacheTime = 0;
  private cacheDuration = 5 * 60 * 1000; // 5 Minuten Cache

  private constructor() {}

  static getInstance(): CategoryAccessService {
    if (!CategoryAccessService.instance) {
      CategoryAccessService.instance = new CategoryAccessService();
    }
    return CategoryAccessService.instance;
  }

  /**
   * Lädt alle Kategorien mit Access-Informationen
   * @param userLevel - Aktuelles User-Level
   * @param isPremium - Premium-Status (Premium-User haben Zugang zu allen Kategorien)
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
        const getsFreeAtLevel = data.getsFreeAtLevel ?? 0; // Default: sofort verfügbar
        
        categories.push({
          id: doc.id,
          ...data,
          isLocked: isPremium ? false : userLevel < getsFreeAtLevel, // Premium-User haben Zugang zu allem
          requiredLevel: getsFreeAtLevel,
          unlocksAtLevel: getsFreeAtLevel > 0 ? getsFreeAtLevel : undefined
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
    const allCategories = await this.getAllCategoriesWithAccess(userLevel, isPremium);
    const category = allCategories.find(cat => cat.id === categoryId);
    return category ? !category.isLocked : true; // Default: verfügbar wenn nicht gefunden
  }

  /**
   * Gibt die Kategorie zurück die bei einem bestimmten Level freigeschaltet wird
   */
  async getCategoryUnlockedAtLevel(level: number): Promise<CategoryWithAccess | null> {
    try {
      const kategorienRef = collection(db, 'kategorien');
      const q = query(kategorienRef, where('getsFreeAtLevel', '==', level));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        const data = doc.data() as Kategorien;
        
        return {
          id: doc.id,
          ...data,
          isLocked: false, // Wird ja gerade freigeschaltet
          requiredLevel: level,
          unlocksAtLevel: level
        };
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
   * Hilfsfunktion um Access-Status basierend auf User-Level und Premium-Status zu mappen
   */
  private mapCategoriesWithAccess(categories: CategoryWithAccess[], userLevel: number, isPremium: boolean = false): CategoryWithAccess[] {
    return categories.map(cat => ({
      ...cat,
      isLocked: isPremium ? false : userLevel < cat.requiredLevel // Premium-User haben Zugang zu allem
    }));
  }

  /**
   * Cache leeren (z.B. nach Level-Up)
   */
  clearCache(): void {
    this.cachedCategories = [];
    this.lastCacheTime = 0;
  }
}

export const categoryAccessService = CategoryAccessService.getInstance();
