import {
    collection,
    doc,
    DocumentReference,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query
} from 'firebase/firestore';
import { db } from '../firebase';
import {
    Discounter,
    FirestoreDocument,
    Handelsmarken,
    HerstellerNew,
    Kategorien,
    MarkenProdukte,
    ProductWithDetails,
    Produkte
} from '../types/firestore';

export class FirestoreService {
  
  /**
   * Holt die letzten 10 enttarnten Produkte (NoName-Produkte sortiert nach created_at)
   */
  static async getLatestEnttarnteProdukte(limitCount: number = 10): Promise<FirestoreDocument<Produkte>[]> {
    try {
      const produkteRef = collection(db, 'produkte');
      const q = query(
        produkteRef, 
        orderBy('created_at', 'desc'), 
        limit(limitCount)
      );
      
      const querySnapshot = await getDocs(q);
      const produkte: FirestoreDocument<Produkte>[] = [];
      
      querySnapshot.forEach((doc) => {
        produkte.push({
          id: doc.id,
          ...doc.data() as Produkte
        });
      });
      
      return produkte;
    } catch (error) {
      console.error('Error fetching latest enttarnte produkte:', error);
      throw error;
    }
  }

  /**
   * Holt die letzten 10 Markenprodukte sortiert nach created_at
   */
  static async getLatestMarkenProdukte(limitCount: number = 10): Promise<FirestoreDocument<MarkenProdukte>[]> {
    try {
      const markenProdukteRef = collection(db, 'markenProdukte');
      const q = query(
        markenProdukteRef, 
        orderBy('created_at', 'desc'), 
        limit(limitCount)
      );
      
      const querySnapshot = await getDocs(q);
      const markenProdukte: FirestoreDocument<MarkenProdukte>[] = [];
      
      querySnapshot.forEach((doc) => {
        markenProdukte.push({
          id: doc.id,
          ...doc.data() as MarkenProdukte
        });
      });
      
      return markenProdukte;
    } catch (error) {
      console.error('Error fetching latest marken produkte:', error);
      throw error;
    }
  }

  /**
   * Holt ein einzelnes Dokument per Referenz
   */
  static async getDocumentByReference<T>(ref: DocumentReference): Promise<T | null> {
    try {
      const docSnap = await getDoc(ref);
      if (docSnap.exists()) {
        return docSnap.data() as T;
      }
      return null;
    } catch (error) {
      console.error('Error fetching document by reference:', error);
      return null;
    }
  }

  /**
   * Holt alle Kategorien
   */
  static async getKategorien(): Promise<FirestoreDocument<Kategorien>[]> {
    try {
      const kategorienRef = collection(db, 'kategorien');
      const querySnapshot = await getDocs(kategorienRef);
      const kategorien: FirestoreDocument<Kategorien>[] = [];
      
      querySnapshot.forEach((doc) => {
        kategorien.push({
          id: doc.id,
          ...doc.data() as Kategorien
        });
      });
      
      return kategorien;
    } catch (error) {
      console.error('Error fetching kategorien:', error);
      throw error;
    }
  }

  /**
   * Holt Produkt mit allen Details (populated references)
   */
  static async getProductWithDetails(productId: string): Promise<ProductWithDetails | null> {
    try {
      const productRef = doc(db, 'produkte', productId);
      const productSnap = await getDoc(productRef);
      
      if (!productSnap.exists()) {
        return null;
      }
      
      const productData = productSnap.data() as Produkte;
      const productWithDetails: ProductWithDetails = {
        id: productId,
        ...productData
      };

      // Populate references parallel
      const [kategorie, discounter, handelsmarke, hersteller, markenProdukt] = await Promise.all([
        this.getDocumentByReference<Kategorien>(productData.kategorie),
        this.getDocumentByReference<Discounter>(productData.discounter),
        this.getDocumentByReference<Handelsmarken>(productData.handelsmarke),
        this.getDocumentByReference<HerstellerNew>(productData.hersteller),
        this.getDocumentByReference<MarkenProdukte>(productData.markenProdukt)
      ]);

      if (kategorie) productWithDetails.kategorie = kategorie;
      if (discounter) productWithDetails.discounter = discounter;
      if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;
      if (hersteller) productWithDetails.hersteller = hersteller;
      if (markenProdukt) productWithDetails.markenProdukt = markenProdukt;

      return productWithDetails;
    } catch (error) {
      console.error('Error fetching product with details:', error);
      return null;
    }
  }
}

