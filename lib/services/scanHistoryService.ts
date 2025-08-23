import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    Unsubscribe,
    updateDoc,
    where
} from 'firebase/firestore';
import { db } from '../firebase';

export interface ScanHistoryItem {
  id?: string;
  ean: string;
  productId: string;
  productName: string;
  productImage?: string;
  productType: 'noname' | 'markenprodukt';
  brandName?: string; // Marke oder Handelsmarke
  brandImage?: string; // Markenlogo oder Handelsmarkenlogo
  timestamp?: any;
  price?: number;
  market?: string;
  deleted?: boolean; // Soft-Delete Flag
}

class ScanHistoryService {
  private static instance: ScanHistoryService;
  private unsubscribe: Unsubscribe | null = null;

  private constructor() {}

  static getInstance(): ScanHistoryService {
    if (!ScanHistoryService.instance) {
      ScanHistoryService.instance = new ScanHistoryService();
    }
    return ScanHistoryService.instance;
  }

  /**
   * Speichert einen Scan in der Historie
   */
  async saveScan(userId: string, item: Omit<ScanHistoryItem, 'id' | 'timestamp'>): Promise<void> {
    if (!userId || !item.ean || !item.productId) return;

    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      
      // Prüfe ob dieser Scan kürzlich schon gespeichert wurde (innerhalb der letzten 5 Sekunden)
      const recentQuery = query(
        historyRef,
        where('ean', '==', item.ean),
        where('productId', '==', item.productId),
        orderBy('timestamp', 'desc'),
        limit(1)
      );
      
      const recentDocs = await getDocs(recentQuery);
      
      if (!recentDocs.empty) {
        const lastScan = recentDocs.docs[0].data();
        const lastTimestamp = lastScan.timestamp?.toDate?.() || new Date(0);
        const now = new Date();
        const timeDiff = now.getTime() - lastTimestamp.getTime();
        
        // Verhindere doppelte Einträge innerhalb von 5 Sekunden
        if (timeDiff < 5000) {
          console.log('🚫 Scan bereits kürzlich gespeichert, überspringe...');
          return;
        }
      }

      // Speichere den neuen Scan
      await addDoc(historyRef, {
        ...item,
        timestamp: serverTimestamp()
      });

      console.log('✅ Scan in Historie gespeichert:', item.productName);
    } catch (error) {
      console.error('❌ Fehler beim Speichern der Scanhistorie:', error);
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
        orderBy('timestamp', 'desc'),
        limit(limitCount * 2) // Mehr laden, da wir gelöschte herausfiltern
      );
      
      const snapshot = await getDocs(recentQuery);
      
      const allScans = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ScanHistoryItem));
      
      // Nur nicht-gelöschte Einträge zurückgeben, auf gewünschtes Limit beschränken
      return allScans
        .filter(scan => !scan.deleted)
        .slice(0, limitCount);
    } catch (error) {
      console.error('❌ Fehler beim Laden der Scanhistorie:', error);
      return [];
    }
  }

  /**
   * Abonniert die Scanhistorie für Live-Updates
   */
  subscribeToScanHistory(
    userId: string, 
    limitCount: number = 10,
    callback: (items: ScanHistoryItem[]) => void
  ): Unsubscribe {
    if (!userId) {
      callback([]);
      return () => {};
    }

    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      const recentQuery = query(
        historyRef,
        orderBy('timestamp', 'desc'),
        limit(limitCount * 2) // Mehr laden, da wir gelöschte herausfiltern
      );
      
      this.unsubscribe = onSnapshot(recentQuery, (snapshot) => {
        const allItems = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        } as ScanHistoryItem));
        
        // Nur nicht-gelöschte Einträge zurückgeben, auf gewünschtes Limit beschränken
        const filteredItems = allItems
          .filter(item => !item.deleted)
          .slice(0, limitCount);
        
        callback(filteredItems);
      }, (error) => {
        console.error('❌ Fehler beim Abonnieren der Scanhistorie:', error);
        callback([]);
      });

      return this.unsubscribe;
    } catch (error) {
      console.error('❌ Fehler beim Abonnieren der Scanhistorie:', error);
      callback([]);
      return () => {};
    }
  }

  /**
   * Löscht einen Scan aus der Historie
   */
  async deleteScan(userId: string, scanId: string): Promise<void> {
    if (!userId || !scanId) return;

    try {
      const scanRef = doc(db, 'users', userId, 'scanHistory', scanId);
      await deleteDoc(scanRef);
      console.log('✅ Scan aus Historie gelöscht');
    } catch (error) {
      console.error('❌ Fehler beim Löschen des Scans:', error);
    }
  }

  /**
   * Markiert alle Scans als gelöscht (Soft-Delete)
   */
  async markAllAsDeleted(userId: string): Promise<void> {
    if (!userId) return;

    try {
      const historyRef = collection(db, 'users', userId, 'scanHistory');
      const snapshot = await getDocs(historyRef);
      
      const updatePromises = snapshot.docs
        .filter(docSnapshot => !docSnapshot.data().deleted) // Nur nicht-gelöschte markieren
        .map(docSnapshot => {
          const docRef = doc(db, 'users', userId, 'scanHistory', docSnapshot.id);
          return updateDoc(docRef, { deleted: true });
        });
        
      await Promise.all(updatePromises);
      
      console.log('✅ Scanhistorie als gelöscht markiert');
    } catch (error) {
      console.error('❌ Fehler beim Markieren der Scanhistorie als gelöscht:', error);
    }
  }

  /**
   * Lädt Markeninformationen für ein Markenprodukt
   */
  async getBrandInfo(brandRef: any): Promise<{ name: string; image: string } | null> {
    if (!brandRef) return null;

    try {
      const brandDoc = await getDoc(brandRef);
      if (!brandDoc.exists()) return null;

      const data = brandDoc.data();
      return {
        name: data.name || 'Unbekannt',
        image: data.bild || ''
      };
    } catch (error) {
      console.error('❌ Fehler beim Laden der Markeninformationen:', error);
      return null;
    }
  }

  /**
   * Cleanup
   */
  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

// Singleton Export
export const scanHistoryService = ScanHistoryService.getInstance();


