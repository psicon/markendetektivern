import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter } from 'firebase/firestore';
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
      
      // SMART FALLBACK: Load larger batches and handle pagination correctly
      let queryConstraints: any[] = [
        orderBy('purchasedAt', 'desc')
      ];
      
      // For client-side filtering, we need to load much more to ensure we get enough items
      const batchSize = productType ? Math.max(100, pageSize * 5) : pageSize + 1;
      
      // Add pagination
      if (lastDoc) {
        queryConstraints.push(startAfter(lastDoc));
      }
      queryConstraints.push(limit(batchSize));
      
      const q = query(collection(userRef, 'purchases'), ...queryConstraints);

      const snapshot = await getDocs(q);
      const allDocs = snapshot.docs;
      
      // Client-side filter by productType if specified
      const filteredDocs = productType 
        ? allDocs.filter(doc => doc.data().productType === productType)
        : allDocs;
      
      const purchasedItems: PurchasedProduct[] = [];
      
      // Take only pageSize items after filtering
      const docs = filteredDocs.slice(0, pageSize);
      
      // Smart hasMore calculation: 
      // - If we got fewer filtered docs than pageSize, definitely no more
      // - If we got exactly pageSize filtered docs, check if there were more total docs
      let hasMore = false;
      if (filteredDocs.length >= pageSize) {
        // We got enough filtered items, check if there might be more
        hasMore = allDocs.length >= batchSize; // Hit our batch limit, likely more exists
      }
      
      // Set lastDoc to the last document from the ORIGINAL (unfiltered) query for proper pagination
      let newLastDoc = null;
      if (allDocs.length > 0) {
        newLastDoc = allDocs[allDocs.length - 1];
      }

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
      
      // FALLBACK: Load all and count client-side (until Firebase index is created)
      const q = query(collection(userRef, 'purchases'));
      const snapshot = await getDocs(q);
      
      if (!productType) {
        return snapshot.docs.length;
      }
      
      // Client-side filter and count
      const filteredCount = snapshot.docs.filter(doc => 
        doc.data().productType === productType
      ).length;
      
      return filteredCount;
    } catch (error) {
      console.error('Error getting purchase count:', error);
      return 0; // Return 0 instead of throwing to prevent UI breaks
    }
  }
}

// Export singleton instance
const purchaseHistoryService = PurchaseHistoryService.getInstance();
export default purchaseHistoryService;
