import {
    addDoc,
    collection,
    doc,
    DocumentReference,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    where,
    writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';

export interface ScanHistoryItem {
  id?: string;
  ean: string;
  productId: string;
  productName: string;
  productImage?: string;
  productType: 'noname' | 'markenprodukt';
  brandName?: string;
  brandImage?: string;
  price?: number;
  timestamp?: any;
  deleted?: boolean;
  // Firestore references - für Kompatibilität mit altem Schema
  markenProduktRef?: DocumentReference;
  produktRef?: DocumentReference;
  isMarke?: boolean;
}

class ScanHistoryService {
  private static instance: ScanHistoryService;
  
  private constructor() {}
  
  static getInstance(): ScanHistoryService {
    if (!ScanHistoryService.instance) {
      ScanHistoryService.instance = new ScanHistoryService();
    }
    return ScanHistoryService.instance;
  }

  /**
   * Speichert einen Scan in der History
   */
  async saveScan(userId: string, scanData: {
    ean: string;
    productId: string;
    productName: string;
    productImage?: string;
    productType: 'noname' | 'markenprodukt';
    brandName?: string;
    brandImage?: string;
    price?: number;
  }): Promise<void> {
    if (!userId || !scanData.ean || !scanData.productId) return;
    
    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      
      // 🚀 IMMER speichern - jeder Scan ist ein neuer Eintrag!
      
      // Erstelle Firestore-Referenz für Kompatibilität
      let productRef: DocumentReference | undefined;
      if (scanData.productType === 'noname') {
        productRef = doc(db, 'produkte', scanData.productId);
      } else {
        productRef = doc(db, 'markenProdukte', scanData.productId);
      }

      await addDoc(historyRef, {
        ean: scanData.ean,
        productId: scanData.productId,
        productName: scanData.productName,
        productImage: scanData.productImage,
        productType: scanData.productType,
        brandName: scanData.brandName,
        brandImage: scanData.brandImage,
        price: scanData.price,
        timestamp: serverTimestamp(),
        deleted: false,
        // Alte Schema-Kompatibilität
        EAN: scanData.ean, // Großschreibung für altes Schema
        isMarke: scanData.productType === 'markenprodukt',
        ...(scanData.productType === 'markenprodukt' && productRef 
          ? { markenProduktRef: productRef } 
          : { produktRef: productRef }
        )
      });
      
      console.log('✅ Scan gespeichert:', scanData.productName);
      
      // Alte Einträge löschen (behalte nur die letzten 50)
      await this.cleanupOldScans(userId);
    } catch (error) {
      console.error('❌ Fehler beim Speichern des Scans:', error);
    }
  }

  /**
   * Lädt die letzten Scans des Users
   */
  async getRecentScans(userId: string, limitCount: number = 10): Promise<ScanHistoryItem[]> {
    if (!userId) return [];
    
    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      const recentQuery = query(
        historyRef,
        where('deleted', '!=', true),
        orderBy('deleted'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      
      const snapshot = await getDocs(recentQuery);
      const scans: ScanHistoryItem[] = [];
      
      snapshot.forEach(doc => {
        const data = doc.data();
        scans.push({
          id: doc.id,
          ean: data.ean || data.EAN, // Support für beide Versionen
          productId: data.productId,
          productName: data.productName,
          productImage: data.productImage,
          productType: data.productType || (data.isMarke ? 'markenprodukt' : 'noname'),
          brandName: data.brandName,
          brandImage: data.brandImage,
          price: data.price,
          timestamp: data.timestamp,
          deleted: data.deleted || false
        });
      });
      
      console.log(`✅ ${scans.length} Scans geladen für User: ${userId}`);
      return scans;
    } catch (error) {
      console.error('❌ Fehler beim Laden der Scan-Historie:', error);
      return [];
    }
  }

  /**
   * Live-Subscription für Scan-Historie
   */
  subscribeToScanHistory(
    userId: string, 
    limitCount: number, 
    callback: (scans: ScanHistoryItem[]) => void
  ): () => void {
    if (!userId) return () => {};
    
    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      const recentQuery = query(
        historyRef,
        where('deleted', '!=', true),
        orderBy('deleted'),
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );
      
      const unsubscribe = onSnapshot(recentQuery, (snapshot) => {
        const scans: ScanHistoryItem[] = [];
        
        snapshot.forEach(doc => {
          const data = doc.data();
          scans.push({
            id: doc.id,
            ean: data.ean || data.EAN,
            productId: data.productId,
            productName: data.productName,
            productImage: data.productImage,
            productType: data.productType || (data.isMarke ? 'markenprodukt' : 'noname'),
            brandName: data.brandName,
            brandImage: data.brandImage,
            price: data.price,
            timestamp: data.timestamp,
            deleted: data.deleted || false
          });
        });
        
        console.log(`🔄 Scan-Historie Live-Update: ${scans.length} Items`);
        callback(scans);
      }, (error) => {
        console.error('❌ Fehler bei Scan-Historie Live-Update:', error);
        callback([]);
      });
      
      return unsubscribe;
    } catch (error) {
      console.error('❌ Fehler beim Einrichten der Live-Subscription:', error);
      return () => {};
    }
  }

  /**
   * Markiert alle Scans als gelöscht (Soft-Delete)
   */
  async markAllAsDeleted(userId: string): Promise<void> {
    if (!userId) return;
    
    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      const activeQuery = query(
        historyRef,
        where('deleted', '!=', true)
      );
      
      const snapshot = await getDocs(activeQuery);
      
      if (snapshot.empty) {
        console.log('✅ Keine aktiven Scans zum Löschen gefunden');
        return;
      }
      
      const batch = writeBatch(db);
      
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { deleted: true });
      });
      
      await batch.commit();
      console.log(`✅ ${snapshot.docs.length} Scans als gelöscht markiert`);
    } catch (error) {
      console.error('❌ Fehler beim Löschen der Scan-Historie:', error);
    }
  }

  /**
   * Lädt Marken-/Hersteller-Informationen
   */
  async getBrandInfo(herstellerRef: DocumentReference): Promise<{ name: string; image: string } | null> {
    if (!herstellerRef) return null;
    
    try {
      const herstellerDoc = await getDoc(herstellerRef);
      
      if (herstellerDoc.exists()) {
        const data = herstellerDoc.data();
        return {
          name: data.name || 'Unbekannt',
          image: data.bild || data.image || ''
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Fehler beim Laden der Marken-Info:', error);
      return null;
    }
  }

  /**
   * Löscht alte Scans (behalte nur die letzten N)
   */
  private async cleanupOldScans(userId: string, keepCount: number = 50): Promise<void> {
    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      const allQuery = query(
        historyRef,
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(allQuery);
      
      if (snapshot.docs.length <= keepCount) return;
      
      const batch = writeBatch(db);
      const docsToDelete = snapshot.docs.slice(keepCount);
      
      docsToDelete.forEach(doc => {
        batch.update(doc.ref, { deleted: true });
      });
      
      await batch.commit();
      console.log(`✅ ${docsToDelete.length} alte Scans bereinigt`);
    } catch (error) {
      console.error('❌ Fehler beim Bereinigen alter Scans:', error);
    }
  }

  /**
   * Holt Scan-Statistiken
   */
  async getScanStats(userId: string): Promise<{
    totalScans: number;
    scansThisWeek: number;
    scansThisMonth: number;
    topBrands: { name: string; count: number }[];
  }> {
    if (!userId) return { totalScans: 0, scansThisWeek: 0, scansThisMonth: 0, topBrands: [] };
    
    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      const activeQuery = query(
        historyRef,
        where('deleted', '!=', true),
        orderBy('deleted'),
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(activeQuery);
      const totalScans = snapshot.size;
      
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      let scansThisWeek = 0;
      let scansThisMonth = 0;
      const brandCounts: { [key: string]: number } = {};
      
      snapshot.forEach(doc => {
        const data = doc.data();
        const timestamp = data.timestamp?.toDate() || new Date();
        
        if (timestamp > oneWeekAgo) scansThisWeek++;
        if (timestamp > oneMonthAgo) scansThisMonth++;
        
        if (data.brandName) {
          brandCounts[data.brandName] = (brandCounts[data.brandName] || 0) + 1;
        }
      });
      
      const topBrands = Object.entries(brandCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      return {
        totalScans,
        scansThisWeek,
        scansThisMonth,
        topBrands
      };
    } catch (error) {
      console.error('❌ Fehler beim Laden der Scan-Statistiken:', error);
      return { totalScans: 0, scansThisWeek: 0, scansThisMonth: 0, topBrands: [] };
    }
  }
}

// Export singleton instance
const scanHistoryService = ScanHistoryService.getInstance();
export default scanHistoryService;
export { ScanHistoryService };
