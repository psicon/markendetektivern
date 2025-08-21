import { collection, doc, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';
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
   * Load all purchased products for a user from dedicated purchases collection
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

        snapshot.docs.forEach(purchaseDoc => {
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
}

// Export singleton instance
const purchaseHistoryService = PurchaseHistoryService.getInstance();
export default purchaseHistoryService;
