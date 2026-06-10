import { collection, doc, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query, startAfter, where } from '@react-native-firebase/firestore';
import { db } from '../firebase';

export interface PurchasedProduct {
  id: string;
  name: string;
  type: 'markenprodukt' | 'noname';
  preis: number;
  bild: string;
  purchasedAt: Date;
  savings: number;
  stufe?: number; // Für Navigation-Logik
  // Markenprodukt fields
  hersteller?: {
    name: string;
    bild: string;
  };
  // NoName fields
  handelsmarke?: {
    bezeichnung: string;
  };
  discounter?: {
    id: string;
    name: string;
    bild: string;
    land: string;
  };
  /** Kategorie-Doc-ID (aus productData.kategorie-Ref) — für den Kategoriefilter
   *  in der Statistik. Name wird im Screen via getKategorien() aufgelöst. */
  kategorieId?: string | null;
  // Original cart data
  originalCartData?: any;
}

class PurchaseHistoryService {
  private static instance: PurchaseHistoryService;

  static getInstance(): PurchaseHistoryService {
    if (!PurchaseHistoryService.instance) {
      PurchaseHistoryService.instance = new PurchaseHistoryService();
    }
    return PurchaseHistoryService.instance;
  }

  /**
   * Load purchased products with pagination support
   * @param userId - The user ID
   * @param pageSize - Number of items per page (default 20)
   * @param lastDoc - Last document from previous page for pagination
   * @param productType - Filter by product type ('markenprodukt' or 'noname')
   */
  async getUserPurchaseHistoryPaginated(
    userId: string, 
    pageSize: number = 20,
    lastDoc?: any,
    productType?: 'markenprodukt' | 'noname'
  ): Promise<{
    products: PurchasedProduct[];
    lastDoc: any;
    hasMore: boolean;
  }> {
    try {
      const userRef = doc(db, 'users', userId);

      // Server-seitiger Filter statt Client-Filter (Fix 2026-06-10,
      // ClickUp 86ca78dxh "Kaufhistorie lädt nicht / unfassbar lange"):
      // Vorher wurden pro Page max(100, pageSize*5) Docs geladen und
      // client-seitig auf productType gefiltert — bei großen Collections
      // (real: 1300+ Käufe) plus den Full-Scan-Counts ergab das tausende
      // Reads pro Screen-Öffnung. Jetzt filtert Firestore selbst:
      // where(productType) + orderBy(purchasedAt) — braucht den
      // Composite-Index purchases(productType ASC, purchasedAt DESC),
      // angelegt 2026-06-10 via Admin-REST-API (siehe firestore.indexes.json).
      // Verhalten identisch: Docs ohne productType/purchasedAt waren auch
      // vorher unsichtbar (Client-Filter bzw. orderBy schließen sie aus).
      const queryConstraints: any[] = [];
      if (productType) {
        queryConstraints.push(where('productType', '==', productType));
      }
      queryConstraints.push(orderBy('purchasedAt', 'desc'));
      if (lastDoc) {
        queryConstraints.push(startAfter(lastDoc));
      }
      // pageSize+1: das Extra-Doc verrät ob es eine weitere Seite gibt.
      queryConstraints.push(limit(pageSize + 1));

      const q = query(collection(userRef, 'purchases'), ...queryConstraints);

      const snapshot = await getDocs(q);
      const allDocs = snapshot.docs;

      const purchasedItems: PurchasedProduct[] = [];

      const hasMore = allDocs.length > pageSize;
      const docs = allDocs.slice(0, pageSize);

      // lastDoc = letztes ANGEZEIGTES Doc — die Folge-Query nutzt
      // dieselben Constraints, startAfter ist damit konsistent.
      const newLastDoc = docs.length > 0 ? docs[docs.length - 1] : null;

      for (const purchaseDoc of docs) {
        const purchaseData = purchaseDoc.data();
        
        try {
          const productData: PurchasedProduct = {
            id: purchaseData.productId || purchaseDoc.id,
            name: purchaseData.name || 'Unbekanntes Produkt',
            type: purchaseData.productType || 'noname',
            preis: purchaseData.preis || 0,
            bild: purchaseData.bild || '',
            purchasedAt: purchaseData.purchasedAt?.toDate() || new Date(),
            savings: purchaseData.savings || 0,
            stufe: purchaseData.stufe || 3,
            hersteller: purchaseData.hersteller || null,
            handelsmarke: purchaseData.handelsmarke || null,
            discounter: purchaseData.discounter || null,
            kategorieId: purchaseData.productData?.kategorie?.id ?? null,
            originalCartData: purchaseData.originalCartData || null
          };

          purchasedItems.push(productData);
        } catch (error) {
          console.warn('Error processing purchase data:', purchaseDoc.id, error);
        }
      }

      console.log(`✅ Loaded ${purchasedItems.length} ${productType || 'all'} purchase history items (hasMore: ${hasMore})`);
      return {
        products: purchasedItems,
        lastDoc: newLastDoc,
        hasMore
      };
    } catch (error) {
      console.error('Error loading paginated purchase history:', error);
      throw error;
    }
  }

  /**
   * Load all purchased products for a user from dedicated purchases collection
   * @deprecated Use getUserPurchaseHistoryPaginated for better performance
   */
  async getUserPurchaseHistory(userId: string): Promise<PurchasedProduct[]> {
    try {
      const userRef = doc(db, 'users', userId);
      const q = query(
        collection(userRef, 'purchases'),
        orderBy('purchasedAt', 'desc')
      );

      const snapshot = await getDocs(q);
      const purchasedItems: PurchasedProduct[] = [];

      for (const purchaseDoc of snapshot.docs) {
        const purchaseData = purchaseDoc.data();
        
        try {
          const productData: PurchasedProduct = {
            id: purchaseData.productId || purchaseDoc.id,
            name: purchaseData.name || 'Unbekanntes Produkt',
            type: purchaseData.productType || 'noname',
            preis: purchaseData.preis || 0,
            bild: purchaseData.bild || '',
            purchasedAt: purchaseData.purchasedAt?.toDate() || new Date(),
            savings: purchaseData.savings || 0,
            stufe: purchaseData.stufe || 3,
            hersteller: purchaseData.hersteller || null,
            handelsmarke: purchaseData.handelsmarke || null,
            discounter: purchaseData.discounter || null,
            kategorieId: purchaseData.productData?.kategorie?.id ?? null,
            originalCartData: purchaseData.originalCartData || null
          };

          purchasedItems.push(productData);
        } catch (error) {
          console.warn('Error processing purchase data:', purchaseDoc.id, error);
        }
      }

      console.log(`✅ Loaded ${purchasedItems.length} purchase history items from dedicated collection`);
      return purchasedItems;
    } catch (error) {
      console.error('Error loading purchase history:', error);
      throw error;
    }
  }

  /**
   * Subscribe to real-time purchase history updates from dedicated purchases collection
   */
  subscribeToUserPurchaseHistory(
    userId: string,
    callback: (purchases: PurchasedProduct[], error?: string) => void
  ): () => void {
    const userRef = doc(db, 'users', userId);
    const q = query(
      collection(userRef, 'purchases'),
      orderBy('purchasedAt', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
      try {
        const purchasedItems: PurchasedProduct[] = [];

        snapshot.docs.forEach((purchaseDoc: any) => {
          const purchaseData = purchaseDoc.data();
          
          try {
            const productData: PurchasedProduct = {
              id: purchaseData.productId || purchaseDoc.id,
              name: purchaseData.name || 'Unbekanntes Produkt',
              type: purchaseData.productType || 'noname',
              preis: purchaseData.preis || 0,
              bild: purchaseData.bild || '',
              purchasedAt: purchaseData.purchasedAt?.toDate() || new Date(),
              savings: purchaseData.savings || 0,
              stufe: purchaseData.stufe || 3,
              hersteller: purchaseData.hersteller || null,
              handelsmarke: purchaseData.handelsmarke || null,
              discounter: purchaseData.discounter || null,
              originalCartData: purchaseData.originalCartData || null
            };

            purchasedItems.push(productData);
          } catch (error) {
            console.warn('Error processing purchase data in real-time:', purchaseDoc.id, error);
          }
        });

        callback(purchasedItems);
      } catch (error) {
        console.error('Error in real-time purchase history subscription:', error);
        callback([], 'Fehler beim Laden der Kaufhistorie');
      }
    }, (error) => {
      console.error('Purchase history subscription error:', error);
      callback([], 'Verbindungsfehler');
    });
  }

  /**
   * Get purchase statistics from dedicated purchases collection
   */
  async getUserPurchaseStats(userId: string): Promise<{
    totalPurchases: number;
    totalSavings: number;
    brandPurchases: number;
    noNamePurchases: number;
    favoriteMarkets: { name: string; count: number }[];
  }> {
    try {
      const purchases = await this.getUserPurchaseHistory(userId);
      
      const totalPurchases = purchases.length;
      const totalSavings = purchases.reduce((sum, p) => sum + p.savings, 0);
      const brandPurchases = purchases.filter(p => p.type === 'markenprodukt').length;
      const noNamePurchases = purchases.filter(p => p.type === 'noname').length;
      
      // Count favorite markets
      const marketCounts: { [key: string]: number } = {};
      purchases.forEach(p => {
        if (p.discounter?.name) {
          marketCounts[p.discounter.name] = (marketCounts[p.discounter.name] || 0) + 1;
        }
      });
      
      const favoriteMarkets = Object.entries(marketCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      console.log(`✅ Calculated purchase stats: ${totalPurchases} total, €${totalSavings.toFixed(2)} saved`);
      return {
        totalPurchases,
        totalSavings,
        brandPurchases,
        noNamePurchases,
        favoriteMarkets
      };
    } catch (error) {
      console.error('Error getting purchase stats:', error);
      throw error;
    }
  }

  /**
   * Get total count of purchases by type
   * @param userId - The user ID
   * @param productType - Filter by product type ('markenprodukt' or 'noname')
   */
  async getUserPurchaseCount(
    userId: string,
    productType?: 'markenprodukt' | 'noname'
  ): Promise<number> {
    try {
      const userRef = doc(db, 'users', userId);

      // Server-seitige COUNT-Aggregation (Fix 2026-06-10, ClickUp
      // 86ca78dxh): Vorher wurde die KOMPLETTE purchases-Collection
      // geladen und client-seitig gezählt — 2× pro Screen-Öffnung
      // (Marken + NoNames), bei großen Usern tausende Reads und der
      // Hauptgrund für "Kaufhistorie lädt ewig". getCountFromServer
      // liefert nur die Zahl (1 Aggregations-Read, keine Doc-Downloads).
      const base = collection(userRef, 'purchases');
      const q = productType
        ? query(base, where('productType', '==', productType))
        : query(base);
      const agg = await getCountFromServer(q);
      return agg.data().count;
    } catch (error) {
      console.error('Error getting purchase count:', error);
      return 0; // Return 0 instead of throwing to prevent UI breaks
    }
  }
}

// Export singleton instance
const purchaseHistoryService = PurchaseHistoryService.getInstance();
export default purchaseHistoryService;
