import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { FirestoreDocument, Kategorien, Produkte } from '../types/firestore';

export interface SearchHistoryItem {
  id?: string;
  searchTerm: string;  // Das primäre Feld für den Suchbegriff
  timestamp?: any;     // Zeitstempel der Suche
  resultCount?: number;
  deleted?: boolean;   // Soft-Delete Flag
}

export interface PopularSearch {
  term: string;
  count: number;
  icon?: string;
  category?: string;
  // Für echte Produkte
  id?: string;
  productName?: string;
  productImage?: string;
  averageRating?: number;
  isRealProduct?: boolean;
}

class SearchHistoryService {
  private static instance: SearchHistoryService;
  
  private constructor() {}
  
  static getInstance(): SearchHistoryService {
    if (!SearchHistoryService.instance) {
      SearchHistoryService.instance = new SearchHistoryService();
    }
    return SearchHistoryService.instance;
  }

  /**
   * Speichert einen Suchbegriff in der History
   */
  async saveSearchTerm(userId: string, term: string, resultCount?: number): Promise<void> {
    if (!userId || !term || term.trim().length === 0) return;
    
    try {
      const historyRef = collection(db, 'users', userId, 'searchHistory');
      
      // Prüfe ob der Begriff schon existiert (in den letzten 24h)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const existingQuery = query(
        historyRef,
        where('searchTerm', '==', term.trim()),
        where('timestamp', '>', yesterday),
        limit(1)
      );
      
      const existingDocs = await getDocs(existingQuery);
      
      // Nur speichern wenn nicht kürzlich gesucht
      if (existingDocs.empty) {
        await addDoc(historyRef, {
          searchTerm: term.trim(),
          timestamp: serverTimestamp(),
          resultCount: resultCount || 0
        });
        
        // Alte Einträge löschen (behalte nur die letzten 20)
        await this.cleanupOldSearches(userId);
      }
    } catch (error) {
      console.error('Fehler beim Speichern der Suchhistorie:', error);
    }
  }

  /**
   * Lädt die letzten Suchbegriffe des Users (max 10 für horizontales Scrollen)
   */
  async getRecentSearches(userId: string, limitCount: number = 10): Promise<SearchHistoryItem[]> {
    if (!userId) return [];
    
    try {
      const historyRef = collection(db, 'users', userId, 'searchHistory');
      const recentQuery = query(
        historyRef,
        orderBy('timestamp', 'desc'),
        limit(limitCount * 2) // Mehr laden, da wir gelöschte herausfiltern
      );
      
      const snapshot = await getDocs(recentQuery);
      const allSearches = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          searchTerm: data.searchTerm || data.searchItem || '', // Fallback für alte Daten
          timestamp: data.timestamp,
          resultCount: data.resultCount,
          deleted: data.deleted || false
        } as SearchHistoryItem;
      });
      
      // Nur nicht-gelöschte Einträge zurückgeben, auf gewünschtes Limit beschränken
      return allSearches
        .filter(search => !search.deleted)
        .slice(0, limitCount);
    } catch (error) {
      console.error('Fehler beim Laden der Suchhistorie:', error);
      return [];
    }
  }

  /**
   * Markiert einen einzelnen Eintrag als gelöscht (Soft-Delete)
   */
  async deleteSearchItem(userId: string, itemId: string): Promise<void> {
    if (!userId || !itemId) return;
    
    try {
      const itemRef = doc(db, 'users', userId, 'searchHistory', itemId);
      await updateDoc(itemRef, { deleted: true });
      
      console.log('✅ Sucheintrag als gelöscht markiert');
    } catch (error) {
      console.error('❌ Fehler beim Markieren des Sucheintrags als gelöscht:', error);
    }
  }

  /**
   * Markiert alle Suchbegriffe als gelöscht (Soft-Delete)
   */
  async markAllAsDeleted(userId: string): Promise<void> {
    if (!userId) return;

    try {
      const historyRef = collection(db, 'users', userId, 'searchHistory');
      const snapshot = await getDocs(historyRef);
      
      const batch = writeBatch(db);
      snapshot.docs
        .filter(docSnapshot => !docSnapshot.data().deleted) // Nur nicht-gelöschte markieren
        .forEach(docSnapshot => {
          batch.update(docSnapshot.ref, { deleted: true });
        });
        
      await batch.commit();
      
      console.log('✅ Suchhistorie als gelöscht markiert');
    } catch (error) {
      console.error('❌ Fehler beim Markieren der Suchhistorie als gelöscht:', error);
    }
  }

  /**
   * Cleanup alte Einträge (behalte nur die letzten 20)
   */
  private async cleanupOldSearches(userId: string): Promise<void> {
    try {
      const historyRef = collection(db, 'users', userId, 'searchHistory');
      const allQuery = query(historyRef, orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(allQuery);
      
      if (snapshot.docs.length > 20) {
        const batch = writeBatch(db);
        snapshot.docs.slice(20).forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
      }
    } catch (error) {
      console.error('Fehler beim Cleanup der Suchhistorie:', error);
    }
  }

  /**
   * Lädt die best bewerteten NoName-Produkte als beliebte Suchen
   */
  async getPopularProducts(): Promise<PopularSearch[]> {
    try {
      // Lade die 6 best bewerteten NoName-Produkte
      const topRatedQuery = query(
        collection(db, 'produkte'),
        where('averageRatingOverall', '>', 0),
        orderBy('averageRatingOverall', 'desc'),
        orderBy('ratingCount', 'desc'), // Bei gleicher Bewertung: mehr Bewertungen = besser
        limit(6)
      );
      
      const topRatedSnapshot = await getDocs(topRatedQuery);
      const popularProducts: PopularSearch[] = [];
      
      // Konvertiere zu PopularSearch Format
      for (const productDoc of topRatedSnapshot.docs) {
        const productData = productDoc.data() as Produkte;
        
        // Lade Kategorie-Info
        let categoryName = 'Unbekannt';
        if (productData.kategorie) {
          try {
            const categoryDoc = await getDoc(productData.kategorie);
            if (categoryDoc.exists()) {
              const categoryData = categoryDoc.data() as Kategorien;
              categoryName = categoryData.bezeichnung;
            }
          } catch (error) {
            console.log('Kategorie konnte nicht geladen werden:', error);
          }
        }
        
        popularProducts.push({
          id: productDoc.id,
          term: productData.name,
          productName: productData.name,
          productImage: productData.bild,
          count: productData.ratingCount || 0,
          category: categoryName,
          averageRating: productData.averageRatingOverall,
          isRealProduct: true,
          icon: this.getCategoryEmoji(categoryName),
        });
      }
      
      // Falls weniger als 6: Mit zufälligen Produkten auffüllen
      if (popularProducts.length < 6) {
        const randomQuery = query(
          collection(db, 'produkte'),
          limit(20) // Mehr laden für bessere Zufälligkeit
        );
        
        const randomSnapshot = await getDocs(randomQuery);
        const randomProducts = randomSnapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as FirestoreDocument<Produkte>))
          .filter(product => !popularProducts.some(p => p.id === product.id)) // Duplikate vermeiden
          .sort(() => Math.random() - 0.5) // Zufällig mischen
          .slice(0, 6 - popularProducts.length); // Nur benötigte Anzahl
        
        for (const product of randomProducts) {
          // Lade Kategorie-Info
          let categoryName = 'Unbekannt';
          if (product.kategorie) {
            try {
              const categoryDoc = await getDoc(product.kategorie);
              if (categoryDoc.exists()) {
                const categoryData = categoryDoc.data() as Kategorien;
                categoryName = categoryData.bezeichnung;
              }
            } catch (error) {
              console.log('Kategorie konnte nicht geladen werden:', error);
            }
          }
          
          popularProducts.push({
            id: product.id,
            term: product.name,
            productName: product.name,
            productImage: product.bild,
            count: product.ratingCount || 0,
            category: categoryName,
            averageRating: product.averageRatingOverall || 0,
            isRealProduct: true,
            icon: this.getCategoryEmoji(categoryName),
          });
        }
      }
      
      return popularProducts.slice(0, 6);
    } catch (error) {
      console.error('Fehler beim Laden beliebter Produkte:', error);
      // Fallback zu Mock-Daten
      return this.getMockPopularSearches();
    }
  }

  /**
   * Fallback Mock-Daten
   */
  private getMockPopularSearches(): PopularSearch[] {
    return [
      { term: 'Milka', count: 1250, icon: '🍫', category: 'Süßigkeiten' },
      { term: 'Coca Cola', count: 980, icon: '🥤', category: 'Getränke' },
      { term: 'Nutella', count: 850, icon: '🍯', category: 'Aufstriche' },
      { term: 'Haribo', count: 720, icon: '🍬', category: 'Süßigkeiten' },
      { term: 'Barilla', count: 680, icon: '🍝', category: 'Nudeln' },
      { term: 'Kellogg\'s', count: 590, icon: '🥣', category: 'Cerealien' },
    ];
  }

  /**
   * Kategorie zu Emoji mapping
   */
  private getCategoryEmoji(category: string): string {
    const emojiMap: {[key: string]: string} = {
      'süßigkeiten': '🍫',
      'knabberwaren': '🍬',
      'schokolade': '🍫',
      'getränke': '🥤',
      'alkohol': '🍷',
      'milchprodukte': '🥛',
      'käse': '🧀',
      'joghurt': '🥛',
      'desserts': '🍮',
      'backwaren': '🥖',
      'fertigteig': '🥧',
      'brot': '🍞',
      'gebäck': '🥐',
      'fleisch': '🥩',
      'wurst': '🌭',
      'fisch': '🐟',
      'obst': '🍎',
      'gemüse': '🥬',
      'tiefkühl': '🧊',
      'baby': '👶',
      'haustier': '🐕',
      'drogerie': '🧴',
      'haushalt': '🧽',
      'gewürze': '🌶️',
      'kaffee': '☕',
      'tee': '🫖',
      'kakao': '🍫',
    };
    
    const key = category.toLowerCase();
    for (const [searchKey, emoji] of Object.entries(emojiMap)) {
      if (key.includes(searchKey)) {
        return emoji;
      }
    }
    return '🛒'; // Default emoji
  }

  /**
   * Listener für Echtzeit-Updates der Suchhistorie
   */
  subscribeToSearchHistory(
    userId: string, 
    callback: (searches: SearchHistoryItem[]) => void
  ): () => void {
    if (!userId) {
      callback([]);
      return () => {};
    }
    
    const historyRef = collection(db, 'users', userId, 'searchHistory');
    const recentQuery = query(
      historyRef,
      orderBy('timestamp', 'desc'),
      limit(20) // Mehr laden, da wir gelöschte herausfiltern
    );
    
    const unsubscribe = onSnapshot(recentQuery, (snapshot) => {
      const allSearches = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          searchTerm: data.searchTerm || data.searchItem || '',
          timestamp: data.timestamp,
          resultCount: data.resultCount,
          deleted: data.deleted || false
        } as SearchHistoryItem;
      });
      
      // Nur nicht-gelöschte Einträge zurückgeben, auf 10 beschränken
      const filteredSearches = allSearches
        .filter(search => !search.deleted)
        .slice(0, 10);
      
      callback(filteredSearches);
    }, (error) => {
      console.error('Fehler beim Subscription der Suchhistorie:', error);
      callback([]);
    });
    
    return unsubscribe;
  }
}

export const searchHistoryService = SearchHistoryService.getInstance();
export default searchHistoryService;


