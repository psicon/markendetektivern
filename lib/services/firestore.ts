import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    DocumentReference,
    getCountFromServer,
    getDoc,
    getDocs,
    increment,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    startAfter,
    updateDoc,
    where,
    writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import {
    Discounter,
    Einkaufswagen,
    FirestoreDocument,
    Handelsmarken,
    HerstellerNew,
    Kategorien,
    MarkenProdukte,
    MarkenProduktWithDetails,
    Packungstypen,
    ProductToConvert,
    ProductWithDetails,
    Produkte
} from '../types/firestore';
import achievementService from './achievementService';

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
   * Holt NoName-Produkte mit Pagination für lazy loading
   */
  static async getNoNameProductsPaginated(
    pageSize: number = 20,
    lastDoc?: any,
    filters?: {
      categoryFilters?: string[];
      discounterFilters?: string[];
      stufeFilters?: number[];
      priceMin?: number;
      priceMax?: number;
      markeFilter?: string; // hersteller_new ID
      sortBy?: string; // 'name' | 'created_at' | 'preis'
      allergenFilters?: Record<string, boolean>; // Neue Allergen-Filter
      nutritionFilters?: Record<string, { min?: number; max?: number }>; // Neue Nährwert-Filter
    }
  ): Promise<{
    products: (FirestoreDocument<Produkte> & {
      discounter?: Discounter;
      handelsmarke?: Handelsmarken;
    })[];
    lastDoc: any;
    hasMore: boolean;
  }> {
    try {
      console.log(`🔍 Loading ${pageSize} NoName products...`);
      const startTime = Date.now();
      
      const produkteRef = collection(db, 'produkte');
      
      // Sortierung standardmäßig nach Name, außer bei Preis-Filtern
      const sortBy = filters?.sortBy || 'name';
      const sortDirection = sortBy === 'preis' ? 'asc' : 'asc';
      
      // Check if we have complex filters (not just category)
      const hasComplexFilters = (filters?.discounterFilters && filters.discounterFilters.length > 0) || 
                        (filters?.stufeFilters && filters.stufeFilters.length > 0) || 
                        filters?.priceMin !== undefined || 
                        filters?.priceMax !== undefined;
      
      // Sortierung möglich bei category-only Filtern (braucht composite index)
      const canSort = !hasComplexFilters;
      
      // Start with base query
      let q = canSort ? 
        query(produkteRef, orderBy(sortBy, sortDirection)) : 
        query(produkteRef);

      // Add filters if provided
      if (filters?.categoryFilters && filters.categoryFilters.length > 0) {
        if (filters.categoryFilters.length === 1) {
          const categoryRef = doc(db, 'kategorien', filters.categoryFilters[0]);
          q = query(q, where('kategorie', '==', categoryRef));
        } else {
          // Multiple categories - use 'in' query (max 10)
          const categoryRefs = filters.categoryFilters.slice(0, 10).map(id => doc(db, 'kategorien', id));
          q = query(q, where('kategorie', 'in', categoryRefs));
        }
      }
      
      if (filters?.discounterFilters && filters.discounterFilters.length > 0) {
        if (filters.discounterFilters.length === 1) {
          const discounterRef = doc(db, 'discounter', filters.discounterFilters[0]);
          q = query(q, where('discounter', '==', discounterRef));
        } else {
          // Multiple discounters - use 'in' query (max 10)
          const discounterRefs = filters.discounterFilters.slice(0, 10).map(id => doc(db, 'discounter', id));
          q = query(q, where('discounter', 'in', discounterRefs));
        }
      }

      if (filters?.stufeFilters && filters.stufeFilters.length > 0) {
        if (filters.stufeFilters.length === 1) {
          q = query(q, where('stufe', '==', filters.stufeFilters[0].toString()));
        } else {
          // Multiple stufen - use 'in' query (max 10)
          const stufeStrings = filters.stufeFilters.slice(0, 10).map(s => s.toString());
          q = query(q, where('stufe', 'in', stufeStrings));
        }
      }

      if (filters?.priceMin !== undefined) {
        q = query(q, where('preis', '>=', filters.priceMin));
      }

      if (filters?.priceMax !== undefined) {
        q = query(q, where('preis', '<=', filters.priceMax));
      }

      // TODO: Marke-Filter ist komplexer - erstmal deaktiviert wegen Firestore 'in' Limits
      // if (filters?.markeFilter) {
      //   const markeRef = doc(db, 'hersteller_new', filters.markeFilter);
      //   // Erst alle hersteller finden die auf diese marke zeigen
      //   const herstellerQuery = query(
      //     collection(db, 'hersteller'),
      //     where('herstellerref', '==', markeRef)
      //   );
      //   const herstellerSnapshot = await getDocs(herstellerQuery);
      //   
      //   if (herstellerSnapshot.docs.length > 0) {
      //     // Dann nach diesen hersteller-IDs filtern
      //     const herstellerRefs = herstellerSnapshot.docs.map(doc => doc.ref);
      //     q = query(q, where('hersteller', 'in', herstellerRefs));
      //   } else {
      //     // Keine Hersteller gefunden für diese Marke - leeres Ergebnis
      //     return { products: [], lastDoc: null, hasMore: false };
      //   }
      // }

      // Add pagination
      if (lastDoc) {
        q = query(q, startAfter(lastDoc));
      }
      
      q = query(q, limit(pageSize));

      const querySnapshot = await getDocs(q);
      
      // ✅ Parallel processing für bessere Performance
      const productPromises = querySnapshot.docs.map(async (docSnap) => {
        const productData = docSnap.data() as Produkte;
        const productWithDetails: FirestoreDocument<Produkte> & {
          discounter?: Discounter;
          handelsmarke?: Handelsmarken;
        } = {
          id: docSnap.id,
          ...productData
        };

        // Populate references parallel für UI-Daten
        const [discounter, handelsmarke] = await Promise.all([
          this.getDocumentByReference<Discounter>(productData.discounter),
          this.getDocumentByReference<Handelsmarken>(productData.handelsmarke)
        ]);

        if (discounter) productWithDetails.discounter = discounter;
        if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;

        return productWithDetails;
      });
      
      let products = await Promise.all(productPromises);
      
      // Client-Side Filtering für Allergene und Nährwerte
      if (filters?.allergenFilters || filters?.nutritionFilters) {
        products = products.filter(product => {
          const moreInfo = (product as any).moreInformation;
          
          // Produkte ohne moreInformation werden nicht gefiltert (durchgelassen)
          if (!moreInfo) return true;
          
          // Prüfe Allergene
          if (filters.allergenFilters) {
            for (const [allergen, shouldExclude] of Object.entries(filters.allergenFilters)) {
              if (shouldExclude && moreInfo[allergen] === true) {
                return false; // Produkt enthält ein ausgeschlossenes Allergen
              }
            }
          }
          
          // Prüfe Nährwerte
          if (filters.nutritionFilters) {
            for (const [nutritionKey, range] of Object.entries(filters.nutritionFilters)) {
              if (!range || (range.min === undefined && range.max === undefined)) continue;
              
              const valueStr = moreInfo[nutritionKey];
              // Wenn kein Wert vorhanden, Produkt durchlassen
              if (!valueStr) return true;
              
              // Extrahiere Zahl aus String wie "87 kcal" oder "<0,1 g"
              const match = valueStr.match(/[<>]?\s*(\d+(?:,\d+)?)/);
              if (!match) return true; // Bei ungültigem Format durchlassen
              
              const value = parseFloat(match[1].replace(',', '.'));
              
              if (range.min !== undefined && value < range.min) return false;
              if (range.max !== undefined && value > range.max) return false;
            }
          }
          
          return true;
        });
      }
      
      const newLastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      const hasMore = querySnapshot.docs.length === pageSize;

      const endTime = Date.now();
      console.log(`✅ Loaded ${products.length} NoName products in ${endTime - startTime}ms (with populated refs)`);

      return {
        products,
        lastDoc: newLastDoc,
        hasMore
      };
    } catch (error) {
      console.error('Error fetching paginated NoName products:', error);
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
   * Holt ein einzelnes Dokument per Referenz (unterstützt verschiedene Formate)
   */
  static async getDocumentByReference<T>(ref: DocumentReference | any): Promise<T | null> {
    try {
      // ✅ Null/undefined check first
      if (!ref) {
        return null;
      }

      let docRef: DocumentReference;
      
      // Handle different reference formats
      if ((ref as any).referencePath) {
        // Firestore serialized format: {"referencePath": "collection/id", "type": "firestore/documentReference/1.0"}
        const path = (ref as any).referencePath;
        const [collection, id] = path.split('/');
        docRef = doc(db, collection, id);
      } else if (ref.id && ref.path) {
        // Standard DocumentReference
        docRef = ref;
      } else {
        console.error('Unsupported reference format:', ref);
        return null;
      }
      
      const docSnap = await getDoc(docRef);
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
   * Holt Markenprodukte mit Pagination für lazy loading
   */
  static async getMarkenproduktePaginated(
    pageSize: number = 20,
    lastDoc?: any,
    filters?: {
      categoryFilters?: string[];
      herstellerFilters?: string[]; // hersteller_new IDs
      priceMin?: number;
      priceMax?: number;
      sortBy?: string; // 'name' | 'created_at' | 'preis'
      allergenFilters?: Record<string, boolean>; // Neue Allergen-Filter
      nutritionFilters?: Record<string, { min?: number; max?: number }>; // Neue Nährwert-Filter
    }
  ): Promise<{
    products: (FirestoreDocument<any> & {
      hersteller?: HerstellerNew;
    })[];
    lastDoc: any;
    hasMore: boolean;
  }> {
    try {
      console.log(`🔍 Loading ${pageSize} Markenprodukte...`);
      const startTime = Date.now();
      
      const produkteRef = collection(db, 'markenProdukte');
      
      // Sortierung standardmäßig nach Name
      const sortBy = filters?.sortBy || 'name';
      const sortDirection = sortBy === 'preis' ? 'asc' : 'asc';
      
      // Check if we have complex filters (preis macht composite indexes schwierig)
      const hasComplexFilters = filters?.priceMin !== undefined || 
                        filters?.priceMax !== undefined;
      
      // Sortierung möglich bei category/hersteller-only Filtern (braucht composite index)
      const canSort = !hasComplexFilters;
      
      // Start with base query
      let q = canSort ? 
        query(produkteRef, orderBy(sortBy, sortDirection)) : 
        query(produkteRef);

      // Add filters if provided
      if (filters?.categoryFilters && filters.categoryFilters.length > 0) {
        if (filters.categoryFilters.length === 1) {
          const categoryRef = doc(db, 'kategorien', filters.categoryFilters[0]);
          q = query(q, where('kategorie', '==', categoryRef));
        } else {
          const categoryRefs = filters.categoryFilters.slice(0, 10).map(id => doc(db, 'kategorien', id));
          q = query(q, where('kategorie', 'in', categoryRefs));
        }
      }

      if (filters?.herstellerFilters && filters.herstellerFilters.length > 0) {
        console.log('🔍 Applying hersteller filters:', filters.herstellerFilters);
        if (filters.herstellerFilters.length === 1) {
          // WICHTIG: markenProdukte haben 'hersteller' Referenz auf 'hersteller' Collection, nicht 'hersteller_new'
          const herstellerRef = doc(db, 'hersteller', filters.herstellerFilters[0]);
          q = query(q, where('hersteller', '==', herstellerRef));
          console.log('🎯 Single hersteller filter:', herstellerRef.path);
        } else {
          const herstellerRefs = filters.herstellerFilters.slice(0, 10).map(id => doc(db, 'hersteller', id));
          q = query(q, where('hersteller', 'in', herstellerRefs));
          console.log('🎯 Multiple hersteller filters:', herstellerRefs.map(ref => ref.path));
        }
      }

      if (filters?.priceMin !== undefined) {
        q = query(q, where('preis', '>=', filters.priceMin));
      }

      if (filters?.priceMax !== undefined) {
        q = query(q, where('preis', '<=', filters.priceMax));
      }

      // Add pagination
      if (lastDoc) {
        q = query(q, startAfter(lastDoc));
      }
      
      q = query(q, limit(pageSize));

      const querySnapshot = await getDocs(q);
      
      // Parallel processing für bessere Performance
      const productPromises = querySnapshot.docs.map(async (docSnap) => {
        const productData = docSnap.data();
        const productWithDetails: any = {
          id: docSnap.id,
          ...productData
        };

        // Populate hersteller reference für UI-Daten (nur wenn vorhanden)
        if (productData.hersteller) {
          const hersteller = await this.getDocumentByReference<any>(productData.hersteller);
          if (hersteller) {
            productWithDetails.hersteller = hersteller;
            console.log(`✅ Loaded hersteller for ${productData.name}:`, hersteller.name);
          }
        }

        return productWithDetails;
      });
      
      let products = await Promise.all(productPromises);
      
      // Client-Side Filtering für Allergene und Nährwerte (gleiche Logik wie bei NoName)
      if (filters?.allergenFilters || filters?.nutritionFilters) {
        products = products.filter(product => {
          const moreInfo = (product as any).moreInformation;
          
          // Produkte ohne moreInformation werden nicht gefiltert (durchgelassen)
          if (!moreInfo) return true;
          
          // Prüfe Allergene
          if (filters.allergenFilters) {
            for (const [allergen, shouldExclude] of Object.entries(filters.allergenFilters)) {
              if (shouldExclude && moreInfo[allergen] === true) {
                return false; // Produkt enthält ein ausgeschlossenes Allergen
              }
            }
          }
          
          // Prüfe Nährwerte
          if (filters.nutritionFilters) {
            for (const [nutritionKey, range] of Object.entries(filters.nutritionFilters)) {
              if (!range || (range.min === undefined && range.max === undefined)) continue;
              
              const valueStr = moreInfo[nutritionKey];
              // Wenn kein Wert vorhanden, Produkt durchlassen
              if (!valueStr) return true;
              
              // Extrahiere Zahl aus String wie "87 kcal" oder "<0,1 g"
              const match = valueStr.match(/[<>]?\s*(\d+(?:,\d+)?)/);
              if (!match) return true; // Bei ungültigem Format durchlassen
              
              const value = parseFloat(match[1].replace(',', '.'));
              
              if (range.min !== undefined && value < range.min) return false;
              if (range.max !== undefined && value > range.max) return false;
            }
          }
          
          return true;
        });
      }
      
      const newLastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      const hasMore = querySnapshot.docs.length === pageSize;

      const endTime = Date.now();
      console.log(`✅ Loaded ${products.length} Markenprodukte in ${endTime - startTime}ms (with populated refs)`);

      return {
        products,
        lastDoc: newLastDoc,
        hasMore
      };
    } catch (error) {
      console.error('Error fetching paginated Markenprodukte:', error);
      throw error;
    }
  }

  /**
   * Holt Marken mit Pagination für lazy loading (für Marken-Tab)
   */
  static async getMarkenPaginated(
    pageSize: number = 20,
    lastDoc?: any
  ): Promise<{
    marken: FirestoreDocument<any>[];
    lastDoc: any;
    hasMore: boolean;
  }> {
    try {
      console.log(`🔍 Loading ${pageSize} Marken...`);
      const startTime = Date.now();
      
      const markenRef = collection(db, 'hersteller');
      
      let q = query(
        markenRef,
        orderBy('name', 'asc'),
        limit(pageSize)
      );
      
      if (lastDoc) {
        q = query(
          markenRef,
          orderBy('name', 'asc'),
          startAfter(lastDoc),
          limit(pageSize)
        );
      }
      
      const querySnapshot = await getDocs(q);
      const marken: FirestoreDocument<any>[] = [];
      
      querySnapshot.forEach((doc) => {
        marken.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      const newLastDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
      const hasMore = querySnapshot.docs.length === pageSize;
      
      const endTime = Date.now();
      console.log(`✅ Loaded ${marken.length} marken in ${endTime - startTime}ms`);
      
      return {
        marken,
        lastDoc: newLastDoc,
        hasMore
      };
    } catch (error) {
      console.error('Error fetching marken paginated:', error);
      return {
        marken: [],
        lastDoc: null,
        hasMore: false
      };
    }
  }

  /**
   * Holt alle Kategorien für Filter
   */
  static async getKategorien(): Promise<FirestoreDocument<Kategorien>[]> {
    try {
      const kategorienRef = collection(db, 'kategorien');
      const q = query(kategorienRef, orderBy('bezeichnung', 'asc'));
      const querySnapshot = await getDocs(q);
      
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
      return [];
    }
  }

  /**
   * Holt alle Marken (hersteller_new) für Filter
   */
  static async getMarken(): Promise<FirestoreDocument<any>[]> {
    try {
      const markenRef = collection(db, 'hersteller');
      const q = query(markenRef, orderBy('name', 'asc'));
      const querySnapshot = await getDocs(q);
      
      const marken: FirestoreDocument<any>[] = [];
      querySnapshot.forEach((doc) => {
        marken.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      console.log(`✅ Loaded ${marken.length} Marken from 'hersteller' collection:`, marken.slice(0, 5).map(m => m.name));
      return marken;
    } catch (error) {
      console.error('Error fetching marken:', error);
      return [];
    }
  }

  /**
   * Holt ähnliche Produkte (Stufe 3,4,5) aus der gleichen Kategorie
   * Für die "Ähnliche Produkte" Sektion auf Stufe 1+2 Detailseiten
   */
  static async getSimilarProducts(
    categoryName: string, // Einfach der Kategorie-Name
    excludeProductId: string,
    limitCount: number = 7
  ): Promise<(FirestoreDocument<Produkte> & {
    discounter?: Discounter;
    handelsmarke?: Handelsmarken;
    kategorie?: Kategorien;
  })[]> {
    try {
      console.log('🔍 Loading similar products for category:', categoryName);
      
      // EINFACH: Kleine Query, random 7 Stufe 3,4,5 - SOFORT
      const produkteRef = collection(db, 'produkte');
      
      const q = query(
        produkteRef,
        where('stufe', 'in', ['3', '4', '5']),
        limit(20) // NUR 20 laden - KLEIN!
      );
      
      const querySnapshot = await getDocs(q);
      console.log(`📊 Found ${querySnapshot.docs.length} products with stufe 3,4,5`);
      
      // Random shuffle und nimm 7 - OHNE Kategorie-Check
      const shuffledDocs = querySnapshot.docs
        .filter(doc => doc.id !== excludeProductId)
        .sort(() => Math.random() - 0.5)
        .slice(0, limitCount);
      
      console.log(`✅ Selected ${shuffledDocs.length} random products, loading details...`);
      
      // Lade References parallel - SCHNELL
      const productPromises = shuffledDocs.map(async (docSnap) => {
        const productData = docSnap.data() as Produkte;
        const productWithDetails: any = { id: docSnap.id, ...productData };

        // Parallel References laden
        const [discounter, handelsmarke, kategorie] = await Promise.all([
          productData.discounter ? this.getDocumentByReference<Discounter>(productData.discounter) : null,
          productData.handelsmarke ? this.getDocumentByReference<Handelsmarken>(productData.handelsmarke) : null,
          productData.kategorie ? this.getDocumentByReference<Kategorien>(productData.kategorie) : null,
        ]);

        if (discounter) productWithDetails.discounter = discounter;
        if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;
        if (kategorie) productWithDetails.kategorie = kategorie;

        return productWithDetails;
      });

      const finalProducts = await Promise.all(productPromises);
      console.log(`✅ Returning ${finalProducts.length} random products FAST`);
      
      return finalProducts;
    } catch (error) {
      console.error('Error fetching similar products:', error);
      return [];
    }
  }

  /**
   * Holt alle Discounter/Märkte
   */
  static async getDiscounter(): Promise<FirestoreDocument<Discounter>[]> {
    try {
      const discounterRef = collection(db, 'discounter');
      const querySnapshot = await getDocs(discounterRef);
      const discounter: FirestoreDocument<Discounter>[] = [];
      
      querySnapshot.forEach((doc) => {
        discounter.push({
          id: doc.id,
          ...doc.data() as Discounter
        });
      });
      
      return discounter;
    } catch (error) {
      console.error('Error fetching discounter:', error);
      throw error;
    }
  }

  /**
   * Zählt Produkte pro Discounter - OPTIMIERT mit getCountFromServer
   */
  static async getProductCountByDiscounter(discounterId: string): Promise<number> {
    try {
      const produkteRef = collection(db, 'produkte');
      const discounterDocRef = doc(db, 'discounter', discounterId);
      const q = query(produkteRef, where('discounter', '==', discounterDocRef));
      
      // ✅ OPTIMIERT: Nutze getCountFromServer statt getDocs
      // Das lädt KEINE Dokumente, sondern zählt nur serverseitig!
      const countSnapshot = await getCountFromServer(q);
      return countSnapshot.data().count;
    } catch (error) {
      console.error('Error counting products for discounter:', error);
      return 0;
    }
  }

  /**
   * Zählt Produkte pro Kategorie - OPTIMIERT mit getCountFromServer
   */
  static async getProductCountByCategory(categoryId: string): Promise<number> {
    try {
      const produkteRef = collection(db, 'produkte');
      const categoryDocRef = doc(db, 'kategorien', categoryId);
      const q = query(produkteRef, where('kategorie', '==', categoryDocRef));
      
      // ✅ OPTIMIERT: Nutze getCountFromServer statt getDocs
      // Das lädt KEINE Dokumente, sondern zählt nur serverseitig!
      const countSnapshot = await getCountFromServer(q);
      return countSnapshot.data().count;
    } catch (error) {
      console.error('Error counting products for category:', error);
      return 0;
    }
  }

  /**
   * Zählt Markenprodukte pro Marke (hersteller) - OPTIMIERT mit getCountFromServer
   */
  static async getProductCountByMarke(markeId: string): Promise<number> {
    try {
      const markenProdukteRef = collection(db, 'markenProdukte');
      const markeDocRef = doc(db, 'hersteller', markeId);
      const q = query(markenProdukteRef, where('hersteller', '==', markeDocRef));
      
      // ✅ OPTIMIERT: Nutze getCountFromServer statt getDocs
      // Das lädt KEINE Dokumente, sondern zählt nur serverseitig!
      const countSnapshot = await getCountFromServer(q);
      return countSnapshot.data().count;
    } catch (error) {
      console.error('Error counting products for marke:', error);
      return 0;
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
        console.log('NoName product not found with ID:', productId);
        return null;
      }
      
      const productData = productSnap.data() as Produkte;
      const productWithDetails: ProductWithDetails = {
        id: productId,
        ...productData
      };

      // Populate references parallel
      console.log(`🚀 Loading references for product ${productId}...`);
      const refStartTime = Date.now();
      
      const [kategorie, discounter, handelsmarke, hersteller, markenProdukt] = await Promise.all([
        this.getDocumentByReference<Kategorien>(productData.kategorie),
        this.getDocumentByReference<Discounter>(productData.discounter),
        this.getDocumentByReference<Handelsmarken>(productData.handelsmarke),
        this.getDocumentByReference<HerstellerNew>(productData.hersteller),
        this.getDocumentByReference<MarkenProdukte>(productData.markenProdukt)
      ]);
      
      const refEndTime = Date.now();
      console.log(`✅ References loaded in ${refEndTime - refStartTime}ms`);

      if (kategorie) productWithDetails.kategorie = kategorie;
      if (discounter) productWithDetails.discounter = discounter;
      if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;
      if (hersteller) productWithDetails.hersteller = hersteller;
      if (markenProdukt) productWithDetails.markenProdukt = markenProdukt;

      return productWithDetails;
    } catch (error) {
      console.log('Error fetching NoName product details (this is normal if product is in other collection):', error.message);
      return null;
    }
  }

  /**
   * Get Discounter by ID
   */
  static async getDiscounterById(id: string): Promise<any> {
    try {
      const docRef = doc(db, 'discounter', id);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
      console.error(`Error fetching discounter ${id}:`, error);
      return null;
    }
  }

  /**
   * Get Handelsmarke by ID
   */
  static async getHandelsmarkeById(id: string): Promise<any> {
    try {
      const docRef = doc(db, 'handelsmarken', id);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
      console.error(`Error fetching handelsmarke ${id}:`, error);
      return null;
    }
  }

  /**
   * Get Hersteller by ID
   */
  static async getHerstellerById(id: string): Promise<any> {
    try {
      const docRef = doc(db, 'hersteller', id);
      const docSnap = await getDoc(docRef);
      return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
      console.error(`Error fetching hersteller ${id}:`, error);
      return null;
    }
  }

  /**
   * Holt Markenprodukt mit allen Details (populated references)
   */
  static async getMarkenProduktWithDetails(productId: string, skipRelatedProducts: boolean = false, skipBrandsQuery: boolean = false): Promise<MarkenProduktWithDetails | null> {
    try {
      const productRef = doc(db, 'markenProdukte', productId);
      const productSnap = await getDoc(productRef);
      
      if (!productSnap.exists()) {
        console.log('Brand product not found with ID:', productId);
        return null;
      }
      
      const productData = productSnap.data() as MarkenProdukte;
      
      // Populate references
      const [kategorie, herstellerOrMarke, packTypInfo] = await Promise.all([
        productData.kategorie ? this.getDocumentByReference<Kategorien>(productData.kategorie) : Promise.resolve(null),
        productData.hersteller ? this.getDocumentByReference<any>(productData.hersteller) : Promise.resolve(null),
        productData.packTyp ? this.getDocumentByReference<Packungstypen>(productData.packTyp) : Promise.resolve(null)
      ]);

      // Removed verbose logs

      // Prüfe ob die hersteller Referenz auf eine Marke oder einen Hersteller zeigt
      let marke: any = null;
      let hersteller: any = null;
      let brands: any[] = [];
      
      if (herstellerOrMarke) {
        // Feld zeigt auf: herstellerOrMarke.name || herstellerOrMarke.herstellername
        
        // Prüfe ob es eine Marke ist (hat herstellerref) oder ein Hersteller (hat herstellername)
        if (herstellerOrMarke.herstellerref) {
          // Das ist eine MARKE
          marke = herstellerOrMarke;
          hersteller = await this.getDocumentByReference<any>(marke.herstellerref);
          brands = skipBrandsQuery ? [] : await this.getMarkenByHersteller(marke.herstellerref);
          // MARKE gefunden
        } else if (herstellerOrMarke.herstellername) {
          // Das ist direkt ein HERSTELLER
          hersteller = herstellerOrMarke;
          brands = skipBrandsQuery ? [] : await this.getMarkenByHersteller(productData.hersteller);
          // HERSTELLER gefunden
        }
      }
      
      const productWithDetails: MarkenProduktWithDetails = {
        id: productId,
        ...productData,
        kategorie,
        hersteller, // Echter Hersteller (hersteller_new)
        marke, // Die spezifische Marke dieses Produkts (hersteller)
        packTypInfo,
        brands // Alle Marken dieses Herstellers
      };

      // Resolve related products if available (SKIP for performance in comparison view)
      if (!skipRelatedProducts && productData.relatedProdukte && productData.relatedProdukte.length > 0) {
        const relatedProducts = await Promise.all(
          productData.relatedProdukte.map(async (ref) => {
            const relatedProductSnap = await getDoc(ref);
            if (relatedProductSnap.exists()) {
              const relatedData = relatedProductSnap.data() as Produkte;
              const relatedWithDetails: ProductWithDetails = {
                id: relatedProductSnap.id,
                ...relatedData
              };

              // Populate basic references for related products
              const [relKategorie, relDiscounter, relHandelsmarke, relHersteller, relPackTyp] = await Promise.all([
                this.getDocumentByReference<Kategorien>(relatedData.kategorie),
                this.getDocumentByReference<Discounter>(relatedData.discounter),
                this.getDocumentByReference<Handelsmarken>(relatedData.handelsmarke),
                this.getDocumentByReference<HerstellerNew>(relatedData.hersteller),
                this.getDocumentByReference<Packungstypen>(relatedData.packTyp)
              ]);

              if (relKategorie) relatedWithDetails.kategorie = relKategorie;
              if (relDiscounter) relatedWithDetails.discounter = relDiscounter;
              if (relHandelsmarke) relatedWithDetails.handelsmarke = relHandelsmarke;
              if (relHersteller) relatedWithDetails.hersteller = relHersteller;
              if (relPackTyp) relatedWithDetails.packTypInfo = relPackTyp;

              return relatedWithDetails;
            }
            return null;
          })
        );

        productWithDetails.relatedProdukte = relatedProducts.filter(p => p !== null) as ProductWithDetails[];
      }

      return productWithDetails;
    } catch (error) {
      console.log('Error fetching brand product details (this is normal if product is in other collection):', error.message);
      return null;
    }
  }

  /**
   * CORE FUNCTION: Get product comparison data
   * 
   * Logic:
   * 1. NoName clicked → Get linked brand product → Find all other NoName products linking to same brand
   * 2. Brand clicked → Show brand product → Find all NoName products linking to this brand
   * 
   * Always shows: Brand product on top + All related NoName products below
   */
  static async getProductComparisonData(productId: string, isMarkenProdukt: boolean = false): Promise<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  } | null> {
    try {
      const totalStartTime = Date.now();
      
      let result;
      if (isMarkenProdukt) {
        // CASE 1: Brand product clicked
        result = await this.getBrandProductComparison(productId);
      } else {
        // CASE 2: NoName product clicked  
        result = await this.getNoNameProductComparison(productId);
      }
      
      const totalEndTime = Date.now();
      // Total time logged in individual cases
      
      return result;
    } catch (error) {
      console.error('Error in getProductComparisonData:', error);
      return null;
    }
  }

  /**
   * CASE 1: Brand product clicked
   * → Show this brand product + find all NoName products that link to it
   */
  private static async getBrandProductComparison(brandProductId: string): Promise<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  } | null> {
    try {
      const stepTimes: Record<string, number> = {};
      const totalStartTime = Date.now();
      
      // Get the brand product (skip related products and brands query for performance)
      let lastTime = Date.now();
      const brandProduct = await this.getMarkenProduktWithDetails(brandProductId, true, true);
      stepTimes['1_getBrandProduct'] = Date.now() - lastTime;
      lastTime = Date.now();
      if (!brandProduct) {
        console.error('❌ Brand product not found:', brandProductId);
        return null;
      }
      
      // Found brand product
      
      // Find all NoName products that link to this brand product
      const relatedNoNameProducts = await this.findNoNameProductsByBrandId(brandProductId);
      stepTimes['2_findNoNameProducts'] = Date.now() - lastTime;
      
      console.log(`⏱️ BRAND CLICKED Performance:`);
      Object.entries(stepTimes).forEach(([step, time]) => {
        console.log(`  ${step}: ${time}ms`);
      });
      console.log(`  TOTAL: ${Date.now() - totalStartTime}ms`);
      console.log(`  Found ${relatedNoNameProducts.length} NoName alternatives`);
      
      return {
        mainProduct: brandProduct,
        relatedNoNameProducts,
        clickedProductId: brandProductId,
        clickedWasNoName: false
      };
    } catch (error) {
      console.error('Error in getBrandProductComparison:', error);
      return null;
    }
  }

  /**
   * CASE 2: NoName product clicked
   * → Get its linked brand product + find all other NoName products linking to same brand
   */
  private static async getNoNameProductComparison(noNameProductId: string): Promise<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  } | null> {
    try {
      const stepTimes: Record<string, number> = {};
      const totalStartTime = Date.now();
      let lastTime = Date.now();
      
      // 🚀 PERFORMANCE FIX: Single Firebase call with parallel reference extraction
      const rawProductDoc = await getDoc(doc(db, 'produkte', noNameProductId));
      stepTimes['1_getRawProduct'] = Date.now() - lastTime;
      lastTime = Date.now();
      if (!rawProductDoc.exists()) {
        console.error('❌ NoName product not found:', noNameProductId);
        return null;
      }
      
      const rawData = rawProductDoc.data();
      // Found NoName product
      
      // Extract brand product ID from reference
      const originalMarkenProduktRef = rawData.markenProdukt;
      if (!originalMarkenProduktRef || !originalMarkenProduktRef.id) {
        console.error('❌ NoName product has no valid markenProdukt reference');
        return null;
      }
      
      const markenProduktId = originalMarkenProduktRef.id;
      // Extracted brand product ID
      
      // 🚀 PARALLEL: Load NoName product details + Brand product simultaneously
      const [noNameProduct, brandProduct] = await Promise.all([
        this.populateProductReferences(rawData, noNameProductId),
        this.getMarkenProduktWithDetails(markenProduktId, true, true) // skip both for max performance!
      ]);
      stepTimes['2_loadBothProducts'] = Date.now() - lastTime;
      lastTime = Date.now();
      
      if (!noNameProduct || !brandProduct) {
        console.error('❌ Failed to load product details');
        return null;
      }
      
      // Found products, now find alternatives
      
      const relatedNoNameProducts = await this.findNoNameProductsByBrandReference(originalMarkenProduktRef);
      stepTimes['3_findAlternatives'] = Date.now() - lastTime;
      
      console.log(`⏱️ NONAME CLICKED Performance:`);
      Object.entries(stepTimes).forEach(([step, time]) => {
        console.log(`  ${step}: ${time}ms`);
      });
      console.log(`  TOTAL: ${Date.now() - totalStartTime}ms`);
      console.log(`  Found ${relatedNoNameProducts.length} NoName alternatives`);
      
      return {
        mainProduct: brandProduct,
        relatedNoNameProducts,
        clickedProductId: noNameProductId,
        clickedWasNoName: true
      };
    } catch (error) {
      console.error('Error in getNoNameProductComparison:', error);
      return null;
    }
  }

  /**
   * Helper: Extract brand product ID from NoName product's markenProdukt reference
   * Handles different DocumentReference formats (just like handelsmarke logic)
   */
  private static extractBrandProductId(noNameProduct: ProductWithDetails): string | null {
    const markenProduktRef = noNameProduct.markenProdukt;
    
    console.log('🔍 Extracting brand product ID from markenProdukt field:', markenProduktRef);
    
    if (!markenProduktRef) {
      console.log('❌ No markenProdukt field found');
      return null;
    }
    
    // Handle different reference formats (same as existing logic)
    if (typeof markenProduktRef === 'string') {
      console.log('✅ String format:', markenProduktRef);
      return markenProduktRef;
    } else if (markenProduktRef.id) {
      console.log('✅ DocumentReference.id format:', markenProduktRef.id);
      return markenProduktRef.id;
    } else if ((markenProduktRef as any).referencePath) {
      // Firestore serialized format: {"referencePath": "markenProdukte/abc123"}
      const path = (markenProduktRef as any).referencePath;
      const id = path.split('/').pop() || null;
      console.log('✅ referencePath format:', path, '→', id);
      return id;
    } else if ((markenProduktRef as any).__ref__) {
      // Alternative format: {"__ref__": "markenProdukte/abc123"}
      const path = (markenProduktRef as any).__ref__;
      const id = path.split('/').pop() || null;
      console.log('✅ __ref__ format:', path, '→', id);
      return id;
    }
    
    console.error('❌ Unknown markenProdukt reference format:', markenProduktRef);
    console.error('❌ Type:', typeof markenProduktRef);
    console.error('❌ Keys:', Object.keys(markenProduktRef));
    return null;
  }



  /**
   * Helper: Find all NoName products using DocumentReference (FASTEST)
   * Query: produkte collection where markenProdukt == brandProductRef
   */
  private static async findNoNameProductsByBrandReference(brandProductRef: any): Promise<ProductWithDetails[]> {
    try {
      // Finding NoName products using DocumentReference
      
      const produkteRef = collection(db, 'produkte');
      const q = query(produkteRef, where('markenProdukt', '==', brandProductRef));
      const querySnapshot = await getDocs(q);
      
      // Found NoName products
      
      // 🚀 PERFORMANCE REVOLUTION: Use the shared batching function!
      return await this.batchProcessNoNameProducts(querySnapshot.docs);
      
      // Sammle alle einzigartigen Referenzen
      querySnapshot.docs.forEach((docSnap) => {
        const productData = docSnap.data() as Produkte;
        
        if (productData.handelsmarke) uniqueReferences.set(productData.handelsmarke.path || productData.handelsmarke.id, productData.handelsmarke);
        if (productData.kategorie) uniqueReferences.set(productData.kategorie.path || productData.kategorie.id, productData.kategorie);
        if (productData.hersteller) uniqueReferences.set(productData.hersteller.path || productData.hersteller.id, productData.hersteller);
        if (productData.packTyp) uniqueReferences.set(productData.packTyp.path || productData.packTyp.id, productData.packTyp);
        if (productData.discounter) uniqueReferences.set(productData.discounter.path || productData.discounter.id, productData.discounter);
      });
      
      // 🚀 PARALLEL: Load ALL unique references at once
      const referenceStartTime = Date.now();
      
      const referencePromises = Array.from(uniqueReferences.values()).map(async (ref) => {
        try {
          const doc = await this.getDocumentByReference(ref);
          return { ref: ref.path || ref.id, doc };
        } catch (error) {
          return { ref: ref.path || ref.id, doc: null };
        }
      });
      
      const referenceResults = await Promise.all(referencePromises);
      const referenceMap = new Map();
      referenceResults.forEach(result => {
        if (result.doc) referenceMap.set(result.ref, result.doc);
      });
      
      // Loaded references
      
      // Process products with cached references
      const productPromises = querySnapshot.docs.map(async (docSnap) => {
        const productData = docSnap.data() as Produkte;
        const productWithDetails: ProductWithDetails = { id: docSnap.id, ...productData };
        
        // Use cached references
        if (productData.handelsmarke) {
          const key = productData.handelsmarke.path || productData.handelsmarke.id;
          productWithDetails.handelsmarke = referenceMap.get(key) || null;
        }
        if (productData.kategorie) {
          const key = productData.kategorie.path || productData.kategorie.id;
          productWithDetails.kategorie = referenceMap.get(key) || null;
        }
        if (productData.hersteller) {
          const key = productData.hersteller.path || productData.hersteller.id;
          productWithDetails.hersteller = referenceMap.get(key) || null;
        }
        if (productData.packTyp) {
          const key = productData.packTyp.path || productData.packTyp.id;
          productWithDetails.packTypInfo = referenceMap.get(key) || null;
        }
        if (productData.discounter) {
          const key = productData.discounter.path || productData.discounter.id;
          productWithDetails.discounter = referenceMap.get(key) || null;
        }

       // 🚫 REMOVED: NoName-Produkte brauchen keine Marken-Abfrage!
       // Das war völlig unnötig und hat Performance gekostet
        
        return productWithDetails;
      });
      
      const results = await Promise.all(productPromises);
      relatedProducts.push(...results);
      
      // ✅ Sortiere nach preisDatum (neueste zuerst)
      relatedProducts.sort((a, b) => {
        const dateA = a.preisDatum;
        const dateB = b.preisDatum;
        
        // Wenn beide Daten vorhanden, nach Datum sortieren (neueste zuerst)
        if (dateA && dateB) {
          // Firestore Timestamp oder ISO String handling
          const timeA = typeof dateA === 'string' ? new Date(dateA).getTime() : 
                       dateA.seconds ? dateA.seconds * 1000 : 0;
          const timeB = typeof dateB === 'string' ? new Date(dateB).getTime() : 
                       dateB.seconds ? dateB.seconds * 1000 : 0;
          return timeB - timeA; // Neueste zuerst (DESC)
        }
        
        // Fallback: Produkte ohne Datum nach unten, dann nach Preis
        if (!dateA && dateB) return 1;
        if (dateA && !dateB) return -1;
        
        // Beide ohne Datum: Nach Preis sortieren
        const priceA = a.preis || 999999;
        const priceB = b.preis || 999999;
        return priceA - priceB;
      });
      
      // Loaded NoName products with full details
      return relatedProducts;
    } catch (error) {
      console.error('Error in findNoNameProductsByBrandReference:', error);
      return [];
    }
  }

  /**
   * Helper: Find all NoName products that link to a specific brand product
   * Query: produkte collection where markenProdukt == brandProductId
   */
  private static async findNoNameProductsByBrandId(brandProductId: string): Promise<ProductWithDetails[]> {
    try {
      console.log('🔍 Finding NoName products linked to brand ID:', brandProductId);
      
      // Create reference to the brand product
      const brandProductRef = doc(db, 'markenProdukte', brandProductId);
      
      // Query produkte collection for products that link to this brand
      const produkteRef = collection(db, 'produkte');
      const q = query(produkteRef, where('markenProdukt', '==', brandProductRef));
      
      const querySnapshot = await getDocs(q);
      
      // Processing NoName products with mega-batch optimization
      
      // 🚀 PERFORMANCE REVOLUTION: Use the shared batching function!
      return await this.batchProcessNoNameProducts(querySnapshot.docs);
    } catch (error) {
      console.error('Error finding related NoName products:', error);
      return [];
    }
  }

  /**
   * Findet alle Marken (hersteller Collection) die zu einem Hersteller (hersteller_new) gehören
   */
  static async getMarkenByHersteller(herstellerNewDocRef: DocumentReference): Promise<any[]> {
    try {
      // Suche Marken für Hersteller
      
      // Query alle hersteller Dokumente, die auf diesen hersteller_new zeigen
      const markenQuery = query(
        collection(db, 'hersteller'),
        where('herstellerref', '==', herstellerNewDocRef)
      );
      
      const markenSnapshot = await getDocs(markenQuery);
      const marken: any[] = [];
      
      markenSnapshot.forEach((doc) => {
        marken.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      // Gefundene Marken
      return marken;
    } catch (error) {
      console.error('❌ Fehler beim Laden der Marken:', error);
      return [];
    }
  }

  /**
   * Sucht NoName-Produkte anhand EAN/Barcode
   */
  static async searchProductsByEAN(ean: string): Promise<FirestoreDocument<ProductWithDetails>[]> {
    try {
      console.log(`🔍 Searching NoName products for EAN: ${ean}`);
      
      const produkteRef = collection(db, 'produkte');
      
      // Suche sowohl in EAN als auch in EANs Array
      const queries = [
        query(produkteRef, where('EAN', '==', ean)),
        query(produkteRef, where('EANs', 'array-contains', ean))
      ];
      
      const results = await Promise.all(queries.map(q => getDocs(q)));
      const foundProducts = new Map<string, any>();
      
      // Sammle alle gefundenen Produkte und entferne Duplikate
      for (const querySnapshot of results) {
        querySnapshot.forEach((doc) => {
          if (!foundProducts.has(doc.id)) {
            foundProducts.set(doc.id, {
              id: doc.id,
              ...doc.data() as Produkte
            });
          }
        });
      }
      
      const products = Array.from(foundProducts.values());
      console.log(`✅ Found ${products.length} NoName products for EAN: ${ean}`);
      
      return products;
      
    } catch (error) {
      console.error('Error searching products by EAN:', error);
      throw error;
    }
  }

  /**
   * Sucht Markenprodukte anhand EAN/Barcode
   */
  static async searchBrandProductsByEAN(ean: string): Promise<FirestoreDocument<MarkenProduktWithDetails>[]> {
    try {
      console.log(`🔍 Searching brand products for EAN: ${ean}`);
      
      const markenProdukteRef = collection(db, 'markenProdukte');
      
      // Suche sowohl in EAN als auch in EANs Array
      const queries = [
        query(markenProdukteRef, where('EAN', '==', ean)),
        query(markenProdukteRef, where('EANs', 'array-contains', ean))
      ];
      
      const results = await Promise.all(queries.map(q => getDocs(q)));
      const foundProducts = new Map<string, any>();
      
      // Sammle alle gefundenen Produkte und entferne Duplikate
      for (const querySnapshot of results) {
        querySnapshot.forEach((doc) => {
          if (!foundProducts.has(doc.id)) {
            foundProducts.set(doc.id, {
              id: doc.id,
              ...doc.data() as MarkenProdukte
            });
          }
        });
      }
      
      const products = Array.from(foundProducts.values());
      console.log(`✅ Found ${products.length} brand products for EAN: ${ean}`);
      
      return products;
      
    } catch (error) {
      console.error('Error searching brand products by EAN:', error);
      throw error;
    }
  }

  /**
   * Lädt User-Informationen für Community-Features
   */
  static async getUserInfo(userId: string): Promise<{
    displayName: string;
    avatarUrl?: string;
    level: number;
    currentLevel?: { 
      name: string; 
      color: string; 
      icon: string; 
    };
  } | null> {
    try {
      // Vereinfachte Abfrage - nur users Collection, keine Subcollections
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        // Fallback für nicht existierende User (normal für neue anonyme User)
        console.log('📝 User-Profil nicht gefunden:', userId, '- verwende Standard-Fallback');
        return {
          displayName: 'Community Mitglied',
          level: 1,
          currentLevel: {
            name: 'Neuling',
            color: '#6B7280',
            icon: 'person'
          }
        };
      }
      
      const userData = userDoc.data();
      
      // Versuche Stats zu laden, aber ohne Fehler wenn keine Permissions
      let userLevel = userData.level || 1;
      try {
        const userStatsRef = doc(db, 'users', userId, 'stats', 'achievements');
        const userStatsDoc = await getDoc(userStatsRef);
        if (userStatsDoc.exists()) {
          const stats = userStatsDoc.data();
          userLevel = stats.level || userLevel;
        }
      } catch (statsError) {
        // Ignoriere Stats-Fehler, verwende userData.level
        console.log('Stats not accessible, using user level:', userLevel);
      }
      
      // Level-Daten aus echtem Achievement-System laden
      let levelInfo = { name: 'Neuling', color: '#6B7280', icon: 'person' };
      
      try {
        // Verwende echtes Achievement-Service für korrekte Level-Daten
        await achievementService.initialize();
        const userPoints = userData.stats?.pointsTotal || 0;
        const userSavings = userData.stats?.savingsTotal || userData.totalSavings || 0;
        const realLevel = achievementService.getLevelForPoints(userPoints, userSavings);
        
        if (realLevel) {
          levelInfo = {
            name: realLevel.name,
            color: realLevel.color,
            icon: realLevel.icon
          };
          userLevel = realLevel.id; // Verwende echte Level-ID
          console.log(`✅ User Level für Kommentar: ${realLevel.name} (${userPoints} Punkte, €${userSavings} Ersparnis)`);
        }
      } catch (levelError) {
        console.log('Could not load achievement levels, using fallback');
        // Fallback bleibt bestehen
      }
      
      // Bessere Fallbacks für Display Name
      const displayName = userData.displayName || 
                         userData.name || 
                         userData.nickname ||
                         userData.email?.split('@')[0] || 
                         'Community Mitglied';
      
      return {
        displayName: displayName,
        avatarUrl: userData.photo_url || userData.photoURL || userData.profilePicture || userData.avatarUrl || userData.profileImageUrl,
        level: userLevel,
        currentLevel: levelInfo
      };
    } catch (error) {
      console.log('Could not load full user info, using defaults');
      
      // Fallback mit echten Level-1 Daten
      let fallbackLevel = { name: 'Neuling', color: '#6B7280', icon: 'person' };
      try {
        await achievementService.initialize();
        const level1 = achievementService.getLevelForPoints(0, 0);
        if (level1) {
          fallbackLevel = {
            name: level1.name,
            color: level1.color,
            icon: level1.icon
          };
        }
      } catch (e) {
        // Hardcoded Fallback bleibt bestehen
      }
      
      return {
        displayName: 'Community Mitglied',
        level: 1,
        currentLevel: fallbackLevel
      };
    }
  }

  /**
   * Lädt alle Bewertungen für ein Produkt mit LIVE User-Informationen
   * User-Level wird beim Öffnen des Rating-Sheets LIVE aus User-Dokument geladen
   */
  static async getProductRatingsWithUserInfo(productId: string, isNoNameProduct: boolean = true): Promise<any[]> {
    try {
      console.log('📊 LIVE Loading ratings with current user info for product:', productId);
      
      // Erst normale Bewertungen laden (schnell)
      const ratings = await this.getProductRatings(productId, isNoNameProduct);
      
      // Dann User-Infos LIVE laden (jedes Mal aktuell!)
      const ratingsWithUserInfo = await Promise.all(
        ratings.map(async (rating) => {
          const userId = rating.userID;
          if (userId) {
            // LIVE User-Info aus User-Dokument → Immer aktuelles Level!
            const userInfo = await this.getLiveUserInfo(userId);
            return {
              ...rating,
              userInfo
            };
          }
          
          // Fallback für Kommentare ohne userID
          return {
            ...rating,
            userInfo: {
              displayName: 'Community Mitglied',
              level: 1,
              currentLevel: await this.getLevel1Info()
            }
          };
        })
      );
      
      console.log(`✅ LIVE Loaded ${ratingsWithUserInfo.length} ratings with current user levels`);
      return ratingsWithUserInfo;
      
    } catch (error) {
      console.error('Error loading ratings with live user info:', error);
      return [];
    }
  }

  /**
   * Lädt LIVE User-Info direkt aus User-Dokument (immer aktuell!)
   */
  static async getLiveUserInfo(userId: string): Promise<{
    displayName: string;
    avatarUrl?: string;
    level: number;
    currentLevel: { name: string; color: string; icon: string; };
  }> {
    try {
      // User-Dokument direkt laden → Aktuellste Daten
      const userRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        return {
          displayName: 'Community Mitglied',
          level: 1,
          currentLevel: await this.getLevel1Info()
        };
      }
      
      const userData = userDoc.data();
      
      // Level LIVE aus Achievement-Service berechnen
      await achievementService.initialize();
      const userPoints = userData.stats?.pointsTotal || 0;
      const userSavings = userData.stats?.savingsTotal || userData.totalSavings || 0;
      const realLevel = achievementService.getLevelForPoints(userPoints, userSavings);
      
      const levelInfo = realLevel ? {
        name: realLevel.name,
        color: realLevel.color,
        icon: realLevel.icon
      } : await this.getLevel1Info();
      
      const displayName = userData.display_name || 
                         userData.displayName || 
                         userData.name || 
                         userData.email?.split('@')[0] || 
                         'Community Mitglied';
      
      return {
        displayName,
        avatarUrl: userData.photo_url || userData.photoURL,
        level: realLevel?.id || 1,
        currentLevel: levelInfo
      };
      
    } catch (error) {
      console.log('Error loading live user info, using fallback');
      return {
        displayName: 'Community Mitglied',
        level: 1,
        currentLevel: await this.getLevel1Info()
      };
    }
  }

  /**
   * Helper: Level-1 Daten aus Achievement-System
   */
  private static async getLevel1Info(): Promise<{ name: string; color: string; icon: string; }> {
    try {
      await achievementService.initialize();
      const level1 = achievementService.getLevelForPoints(0, 0);
      return level1 ? {
        name: level1.name,
        color: level1.color,
        icon: level1.icon
      } : { name: 'Neuling', color: '#6B7280', icon: 'person' };
    } catch (e) {
      return { name: 'Neuling', color: '#6B7280', icon: 'person' };
    }
  }

  /**
   * Lädt alle Bewertungen für ein Produkt aus der productRatings Collection
   */
  static async getProductRatings(productId: string, isNoNameProduct: boolean = true): Promise<any[]> {
    try {
      console.log('📊 Loading ratings for product:', productId, 'IsNoName:', isNoNameProduct);
      
      const ratingsCollection = collection(db, 'productRatings');
      let ratingsQuery;
      
      if (isNoNameProduct) {
        // Query for NoName product ratings
        ratingsQuery = query(
          ratingsCollection,
          where('productID', '==', doc(db, 'produkte', productId))
        );
      } else {
        // Query for Brand product ratings
        ratingsQuery = query(
          ratingsCollection,
          where('brandProductID', '==', doc(db, 'markenProdukte', productId))
        );
      }
      
      const ratingsSnapshot = await getDocs(ratingsQuery);
      const ratings = [];
      
      ratingsSnapshot.forEach((doc) => {
        const data = doc.data();
        ratings.push({
          id: doc.id,
          ...data,
          ratedate: data.ratedate?.toDate ? data.ratedate.toDate() : data.ratedate,
          updatedate: data.updatedate?.toDate ? data.updatedate.toDate() : data.updatedate,
        });
      });
      
      // Sort by date (newest first)
      ratings.sort((a, b) => {
        const dateA = a.ratedate || new Date(0);
        const dateB = b.ratedate || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });
      
      console.log(`✅ Loaded ${ratings.length} ratings for product ${productId}`);
      return ratings;
      
    } catch (error) {
      console.error('Error loading product ratings:', error);
      return [];
    }
  }

  /**
   * Berechnet aggregierte Bewertungsstatistiken für ein Produkt
   */
  static calculateRatingStats(ratings: any[]): {
    averageOverall: number;
    averagePrice: number;
    averageTaste: number;
    averageContent: number;
    averageSimilarity: number;
    totalCount: number;
    commentsCount: number;
  } {
    if (ratings.length === 0) {
      return {
        averageOverall: 0,
        averagePrice: 0,
        averageTaste: 0,
        averageContent: 0,
        averageSimilarity: 0,
        totalCount: 0,
        commentsCount: 0
      };
    }

    const stats = {
      overall: 0,
      price: 0,
      taste: 0,
      content: 0,
      similarity: 0,
      overallCount: 0,
      priceCount: 0,
      tasteCount: 0,
      contentCount: 0,
      similarityCount: 0,
      commentsCount: 0
    };

    ratings.forEach(rating => {
      if (rating.ratingOverall) {
        stats.overall += rating.ratingOverall;
        stats.overallCount++;
      }
      if (rating.ratingPriceValue) {
        stats.price += rating.ratingPriceValue;
        stats.priceCount++;
      }
      if (rating.ratingTasteFunction) {
        stats.taste += rating.ratingTasteFunction;
        stats.tasteCount++;
      }
      if (rating.ratingContent) {
        stats.content += rating.ratingContent;
        stats.contentCount++;
      }
      if (rating.ratingSimilarity) {
        stats.similarity += rating.ratingSimilarity;
        stats.similarityCount++;
      }
      if (rating.comment && rating.comment.trim()) {
        stats.commentsCount++;
      }
    });

    return {
      averageOverall: stats.overallCount > 0 ? stats.overall / stats.overallCount : 0,
      averagePrice: stats.priceCount > 0 ? stats.price / stats.priceCount : 0,
      averageTaste: stats.tasteCount > 0 ? stats.taste / stats.tasteCount : 0,
      averageContent: stats.contentCount > 0 ? stats.content / stats.contentCount : 0,
      averageSimilarity: stats.similarityCount > 0 ? stats.similarity / stats.similarityCount : 0,
      totalCount: ratings.length,
      commentsCount: stats.commentsCount
    };
  }

  /**
   * Prüft ob ein User bereits eine Bewertung für ein Produkt abgegeben hat
   */
  static async getUserRatingForProduct(userId: string, productId: string, isNoNameProduct: boolean = true): Promise<any | null> {
    try {
      console.log('🔍 Checking existing rating for user:', userId, 'product:', productId);
      
      const ratingsCollection = collection(db, 'productRatings');
      let ratingsQuery;
      
      if (isNoNameProduct) {
        ratingsQuery = query(
          ratingsCollection,
          where('userID', '==', userId),
          where('productID', '==', doc(db, 'produkte', productId))
        );
      } else {
        ratingsQuery = query(
          ratingsCollection,
          where('userID', '==', userId),
          where('brandProductID', '==', doc(db, 'markenProdukte', productId))
        );
      }
      
      const ratingsSnapshot = await getDocs(ratingsQuery);
      
      if (!ratingsSnapshot.empty) {
        const rating = ratingsSnapshot.docs[0];
        const data = rating.data();
        console.log('✅ Found existing rating:', rating.id);
        return {
          id: rating.id,
          ...data,
          ratedate: data.ratedate?.toDate ? data.ratedate.toDate() : data.ratedate,
          updatedate: data.updatedate?.toDate ? data.updatedate.toDate() : data.updatedate,
        };
      }
      
      console.log('❌ No existing rating found');
      return null;
      
    } catch (error) {
      console.error('Error checking user rating:', error);
      return null;
    }
  }

  /**
   * Aktualisiert eine bestehende Bewertung
   */
  static async updateProductRating(ratingId: string, updateData: {
    ratingOverall: number;
    ratingPriceValue?: number | null;
    ratingTasteFunction?: number | null;
    ratingSimilarity?: number | null;
    ratingContent?: number | null;
    comment?: string | null;
    updatedate: Date;
  }): Promise<void> {
    try {
      console.log('🔄 Updating rating:', ratingId);
      
      const ratingRef = doc(db, 'productRatings', ratingId);
      await updateDoc(ratingRef, updateData);
      
      console.log('✅ Rating updated successfully');
    } catch (error) {
      console.error('Error updating rating:', error);
      throw error;
    }
  }

  /**
   * Fügt eine neue Bewertung zur productRatings Collection hinzu
   */
  static async addProductRating(ratingData: {
    productID: string | null;           // NoName product ID
    brandProductID: string | null;      // Brand product ID  
    userID: string;                     // User ID
    ratingOverall: number;              // 1-5 Gesamtbewertung (Pflicht)
    ratingPriceValue?: number | null;   // 1-5 Preis-Leistung (Optional)
    ratingTasteFunction?: number | null; // 1-5 Geschmack/Funktion (Optional)
    ratingSimilarity?: number | null;   // 1-5 Ähnlichkeit (Optional)
    ratingContent?: number | null;      // 1-5 Inhaltsstoffe (Optional)
    comment?: string | null;            // Freitext Kommentar (Optional)
    ratedate: Date;                     // Bewertungsdatum
    updatedate: Date;                   // Update-Datum
  }): Promise<string> {
    try {
      console.log('💾 Saving product rating to Firestore:', ratingData);
      
      // Validate required fields
      if (!ratingData.userID) {
        throw new Error('userID is required');
      }
      if (!ratingData.ratingOverall || ratingData.ratingOverall < 1 || ratingData.ratingOverall > 5) {
        throw new Error('ratingOverall must be between 1 and 5');
      }
      if (!ratingData.productID && !ratingData.brandProductID) {
        throw new Error('Either productID or brandProductID must be provided');
      }

      // Create product references if IDs are provided
      const firestoreData: any = {
        userID: ratingData.userID,
        ratingOverall: ratingData.ratingOverall,
        ratingPriceValue: ratingData.ratingPriceValue,
        ratingTasteFunction: ratingData.ratingTasteFunction,
        ratingSimilarity: ratingData.ratingSimilarity,
        ratingContent: ratingData.ratingContent,
        comment: ratingData.comment,
        ratedate: ratingData.ratedate,
        updatedate: ratingData.updatedate
      };

      // Add product references
      if (ratingData.productID) {
        firestoreData.productID = doc(db, 'produkte', ratingData.productID);
      }
      if (ratingData.brandProductID) {
        firestoreData.brandProductID = doc(db, 'markenProdukte', ratingData.brandProductID);
      }

      // Add to productRatings collection
      const docRef = await addDoc(collection(db, 'productRatings'), firestoreData);
      
      console.log('✅ Product rating saved with ID:', docRef.id);
      return docRef.id;
      
    } catch (error) {
      console.error('Error adding product rating:', error);
      throw error;
    }
  }

  // ========================================
  // EINKAUFSZETTEL / SHOPPING CART METHODS
  // ========================================

  /**
   * Holt alle Einkaufszettel-Einträge für einen User
   */
  static async getShoppingCartItems(userId: string): Promise<FirestoreDocument<Einkaufswagen>[]> {
    try {
      const userRef = doc(db, 'users', userId);
      const q = query(
        collection(userRef, 'einkaufswagen'),
        where('gekauft', '==', false),
        orderBy('timestamp', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FirestoreDocument<Einkaufswagen>[];
      
      console.log(`✅ Loaded ${items.length} shopping cart items`);
      return items;
    } catch (error) {
      console.error('Error loading shopping cart:', error);
      return [];
    }
  }

  /**
   * Fügt ein Custom-Item (Freitext) zum Einkaufszettel hinzu
   */
  static async addCustomItemToShoppingCart(
    userId: string,
    customItem: {
      name: string;
      type: 'brand' | 'noname';
      marketId?: string;
      marketName?: string;
    }
  ): Promise<string> {
    try {
      const userRef = doc(db, 'users', userId);
      const data: Partial<Einkaufswagen> = {
        customItem: customItem,
        gekauft: false,
        name: customItem.name, // Für schnelle Anzeige
        timestamp: serverTimestamp() as Timestamp
      };

      const docRef = await addDoc(collection(userRef, 'einkaufswagen'), data);
      console.log('✅ Added custom item to shopping cart:', docRef.id, customItem);
      return docRef.id;
    } catch (error) {
      console.error('Error adding custom item to shopping cart:', error);
      throw error;
    }
  }

  /**
   * Fügt ein Produkt zum Einkaufszettel hinzu (bestehende Funktion)
   */
  static async addToShoppingCart(
    userId: string,
    productId: string,
    productName: string,
    isMarke: boolean,
    source?: 'search' | 'scan' | 'browse' | 'favorites' | 'repurchase' | 'comparison',
    sourceMetadata?: any,
    priceInfo?: {
      price: number;
      savings: number;
      comparedProducts?: {
        productId: string;
        productName: string;
        price: number;
        savings: number;
      }[];
    },
    comparisonContext?: { // NEU: Kontext wenn aus Vergleich hinzugefügt
      mainProductId: string;
      mainProductName: string;
      mainProductType: 'brand' | 'noname';
    }
  ): Promise<string> {
    try {
      const userRef = doc(db, 'users', userId);
      
      // Hole aktuelle Journey-ID
      const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
      const currentJourneyId = journeyTrackingService.getCurrentJourneyId();
      
      const data: any = {
        gekauft: false,
        timestamp: serverTimestamp(),
        name: productName,
        // 🎯 Journey-ID für späteres Tracking speichern!
        journeyId: currentJourneyId,
        // 💰 Preis-Snapshot zum Zeitpunkt des Hinzufügens
        ...(priceInfo && {
          priceAtTime: priceInfo.price,
          savingsAtTime: priceInfo.savings
        }),
        // 📊 Source Attribution (optional)
        ...(source && { source }),
        ...(sourceMetadata && { sourceMetadata })
      };

      if (isMarke) {
        data.markenProdukt = doc(db, 'markenProdukte', productId);
      } else {
        data.handelsmarkenProdukt = doc(db, 'produkte', productId);
      }

      const docRef = await addDoc(collection(userRef, 'einkaufswagen'), data);
      
      // 📊 Track Add-to-Cart Event mit Source UND Journey-Context
      if (source) {
        const { analyticsService } = await import('./analyticsService');
        const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
        
        // Track mit normaler Analytics
        await analyticsService.trackAddToCart(
          productId, 
          productName, 
          isMarke, 
          source, 
          userId, 
          {
            screen_name: sourceMetadata?.screenName || 'unknown',
            ...sourceMetadata
          }
        );
        
        // Track mit Journey-Context und hole Index zurück
        const viewedProductIndex = journeyTrackingService.trackAddToCart(productId, productName, isMarke, userId, priceInfo, comparisonContext);
        
        // WICHTIG: Speichere Index im Einkaufszettel für spätere Zuordnung
        if (viewedProductIndex !== null) {
          await updateDoc(docRef, {
            viewedProductIndex: viewedProductIndex
          });
          console.log(`📍 ViewedProduct Index ${viewedProductIndex} gespeichert für ${productName}`);
        }
      }
      
      console.log('✅ Added to shopping cart:', docRef.id);
      return docRef.id;
    } catch (error) {
      console.error('Error adding to shopping cart:', error);
      throw error;
    }
  }
  
  /**
   * Prüft ob ein Produkt bereits im Einkaufszettel ist
   */
  static async isInShoppingCart(
    userId: string,
    productId: string,
    isMarke: boolean
  ): Promise<boolean> {
    try {
      const userRef = doc(db, 'users', userId);
      let q;
      
      if (isMarke) {
        const markenRef = doc(db, 'markenProdukte', productId);
        q = query(
          collection(userRef, 'einkaufswagen'),
          where('markenProdukt', '==', markenRef),
          where('gekauft', '==', false),
          limit(1)
        );
      } else {
        const produktRef = doc(db, 'produkte', productId);
        q = query(
          collection(userRef, 'einkaufswagen'),
          where('handelsmarkenProdukt', '==', produktRef),
          where('gekauft', '==', false),
          limit(1)
        );
      }
      
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } catch (error) {
      console.error('Error checking shopping cart:', error);
      return false;
    }
  }

  /**
   * Entfernt ein Produkt vom Einkaufszettel
   */
  static async removeFromShoppingCart(userId: string, itemId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const cartItemRef = doc(userRef, 'einkaufswagen', itemId);
      
      // Lade Produktdaten vor dem Löschen für Journey-Tracking
      const cartItemDoc = await getDoc(cartItemRef);
      if (cartItemDoc.exists()) {
        const cartData = cartItemDoc.data();
        
        // KORRIGIERT: Hole Produktdaten aus der richtigen Quelle
        let productData = null;
        let productId = '';
        let productName = '';
        let productType: 'brand' | 'noname' = 'noname';
        
        if (cartData.markenProdukt) {
          // Markenprodukt
          productData = cartData.markenProdukt;
          productId = productData.id || '';
          productName = cartData.name || 'Markenprodukt';
          productType = 'brand';
        } else if (cartData.handelsmarkenProdukt) {
          // NoName Produkt - DocumentReference!
          productData = cartData.handelsmarkenProdukt;
          productId = productData.id || ''; // DocumentReference.id
          productName = cartData.name || 'NoName Produkt';
          productType = 'noname';
        }
        
        // EINFACHER FALLBACK: Wenn immer noch keine Daten, direkt aus cartData
        if (!productId && cartData.name) {
          productId = cartData.handelsmarkenProdukt?.id || cartData.markenProdukt?.id || 'unknown';
          productName = cartData.name;
          productType = cartData.markenProdukt ? 'brand' : 'noname';
          productData = cartData.handelsmarkenProdukt || cartData.markenProdukt;
        }
        
        console.log('🔍 DEBUG removeFromShoppingCart:', {
          hasProductData: !!productData,
          hasJourneyId: !!cartData.journeyId,
          journeyId: cartData.journeyId,
          productId: productId,
          productName: productName,
          productType: productType
        });
        
        if (productData && productId) {
          // Track mit Journey
          const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
          
          // NEU: Verwende die gespeicherte journeyId UND Index!
          if (cartData.journeyId) {
            console.log('🎯 Tracking Remove in Specific Journey:', cartData.journeyId, 'Index:', cartData.viewedProductIndex);
            await journeyTrackingService.trackRemoveInSpecificJourney(
              cartData.journeyId,
              productId,
              productName,
              productType,
              userId,
              cartData.viewedProductIndex // NEU: Index für eindeutige Zuordnung
            );
          } else {
            // Fallback: Normale trackRemoveFromCart wenn keine journeyId
            console.warn('⚠️ Keine journeyId - verwende normale trackRemoveFromCart');
            journeyTrackingService.trackRemoveFromCart(
              productId,
              productName,
              productType,
              userId
            );
          }
        } else {
          console.error('❌ Keine productData für Journey-Tracking!', { 
            hasProductData: !!productData, 
            hasProductId: !!productId,
            cartData: cartData 
          });
        }
        
        // ENTFERNT: laterUpdates - Tracking passiert direkt in aktueller Journey
      }
      
      await deleteDoc(cartItemRef);
      console.log('✅ Removed from shopping cart:', itemId);
    } catch (error) {
      console.error('Error removing from shopping cart:', error);
      throw error;
    }
  }

  /**
   * Markiert ein Produkt als gekauft UND erstellt Kaufhistorie-Eintrag
   */
  static async markAsPurchased(userId: string, itemId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const cartItemRef = doc(userRef, 'einkaufswagen', itemId);
      
      // 1. Lade die aktuellen Einkaufszettel-Daten
      const cartItemDoc = await getDoc(cartItemRef);
      if (!cartItemDoc.exists()) {
        throw new Error('Einkaufszettel-Item nicht gefunden');
      }
      
      const cartData = cartItemDoc.data();
      
      // 2. Erstelle vollständigen Kaufhistorie-Eintrag
      await this.createPurchaseHistoryEntry(userId, cartData);
      
      // 3. Markiere im Einkaufszettel als gekauft
      await updateDoc(cartItemRef, {
        gekauft: true
      });
      
      // 4. Track Purchase in der ORIGINAL Journey (nicht neue!)
      // Hole die richtigen Produktdaten aus dem cartData
      let productId: string = '';
      let productName: string = '';
      let productType: 'brand' | 'noname' = 'noname';
      let finalPrice: number = 0;
      let finalSavings: number = 0;

      if (cartData.markenProdukt) {
        // Markenprodukt
        const productRef = cartData.markenProdukt;
        productId = productRef.id || '';
        productType = 'brand';
        // Name aus cartData oder aus dem geladenen Produktdaten
        productName = cartData.name || 'Markenprodukt';
        finalPrice = cartData.priceAtTime || 0;
        finalSavings = cartData.savingsAtTime || 0;
      } else if (cartData.handelsmarkenProdukt) {
        // NoName Produkt
        const productRef = cartData.handelsmarkenProdukt;
        productId = productRef.id || '';
        productType = 'noname';
        // Name aus cartData
        productName = cartData.name || 'NoName Produkt';
        finalPrice = cartData.priceAtTime || 0;
        finalSavings = cartData.savingsAtTime || 0;
      }

      if (productId) {
        const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
        
        // NEU: Hole den aktuellen Index für dieses Produkt
        const viewedProductIndex = journeyTrackingService.getViewedProductIndexAfterAction(productId);
        
        // NEU: Verwende die gespeicherte journeyId!
        if (cartData.journeyId) {
          await journeyTrackingService.trackPurchaseInSpecificJourney(
            cartData.journeyId,
            [{
              productId: productId,
              productName: productName,
              productType: productType,
              finalPrice: finalPrice,
              finalSavings: finalSavings,
              viewedProductIndex: viewedProductIndex // NEU: Index für eindeutige Zuordnung
            }],
            finalSavings,
            userId
          );
          
          // WICHTIG: Warte bis Journey-Update abgeschlossen ist!
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          // Fallback: Normale trackPurchase wenn keine journeyId
          console.warn('⚠️ Keine journeyId im cartData - verwende normale trackPurchase');
          journeyTrackingService.trackPurchase([{
            productId: productId,
            productName: productName,
            productType: productType,
            finalPrice: finalPrice,
            finalSavings: finalSavings
          }], finalSavings, userId);
        }
      } else {
        console.error('❌ Keine productId gefunden für Journey-Tracking!', cartData);
      }
      
      console.log('✅ Marked as purchased and added to history:', itemId);
    } catch (error) {
      console.error('Error marking as purchased:', error);
      throw error;
    }
  }
  
  /**
   * Markiert ein Produkt als gekauft OHNE Journey-Tracking (für Bulk-Operations)
   */
  static async markAsPurchasedWithoutTracking(userId: string, itemId: string): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const cartItemRef = doc(userRef, 'einkaufswagen', itemId);
      
      // 1. Lade Einkaufszettel-Item
      const cartItemDoc = await getDoc(cartItemRef);
      if (!cartItemDoc.exists()) {
        throw new Error('Einkaufszettel-Item nicht gefunden');
      }
      
      const cartData = cartItemDoc.data();
      
      // 2. Erstelle Kaufhistorie-Eintrag
      await this.createPurchaseHistoryEntry(userId, cartData);
      
      // 3. Markiere im Einkaufszettel als gekauft
      await updateDoc(cartItemRef, {
        gekauft: true
      });
      
      // KEIN Journey-Tracking hier! Das passiert im Bulk
      
      console.log('✅ Marked as purchased (without tracking):', itemId);
    } catch (error) {
      console.error('Error marking as purchased:', error);
      throw error;
    }
  }

  /**
   * Erstellt einen Kaufhistorie-Eintrag mit vollständigen Produktdaten
   */
  private static async createPurchaseHistoryEntry(userId: string, cartData: any): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      
      let purchaseData: any = {
        purchasedAt: serverTimestamp(),
        originalCartData: cartData
      };
      
      if (cartData.markenProdukt) {
        // Markenprodukt - lade vollständige Daten
        const productDoc = await getDoc(cartData.markenProdukt);
        if (productDoc.exists()) {
          const rawData = productDoc.data();
          
          // Lade Hersteller (MARKE) Daten
          let hersteller = null;
          if (rawData.hersteller) {
            const herstellerDoc = await getDoc(rawData.hersteller);
            if (herstellerDoc.exists()) {
              const herstellerData = herstellerDoc.data();
              hersteller = {
                name: herstellerData.name,
                bild: herstellerData.bild
              };
            }
          }
          
          // Berechne Ersparnis
          let savings = 0;
          if (rawData.relatedProdukteIDs && rawData.relatedProdukteIDs.length > 0) {
            let cheapestPrice = Infinity;
            for (const relatedId of rawData.relatedProdukteIDs) {
              const relatedDoc = await getDoc(doc(db, 'produkte', relatedId));
              if (relatedDoc.exists()) {
                const relatedData = relatedDoc.data();
                if (relatedData.preis && relatedData.preis < cheapestPrice) {
                  cheapestPrice = relatedData.preis;
                }
              }
            }
            if (cheapestPrice !== Infinity && rawData.preis) {
              savings = Math.max(0, rawData.preis - cheapestPrice);
            }
          }
          
          purchaseData = {
            ...purchaseData,
            productId: productDoc.id,
            productType: 'markenprodukt',
            name: rawData.name || rawData.produktName || cartData.name,
            preis: rawData.preis || 0,
            bild: rawData.bild || '',
            savings: savings,
            hersteller: hersteller,
            // Vollständige Produktdaten für späteren Zugriff
            productData: {
              ...rawData,
              id: productDoc.id,
              hersteller: hersteller
            }
          };
        }
        
      } else if (cartData.handelsmarkenProdukt) {
        // NoName Produkt - lade vollständige Daten
        const productDoc = await getDoc(cartData.handelsmarkenProdukt);
        if (productDoc.exists()) {
          const rawData = productDoc.data();
          
          // Lade Handelsmarke Daten
          let handelsmarke = null;
          if (rawData.handelsmarke) {
            const handelsmarkeDoc = await getDoc(rawData.handelsmarke);
            if (handelsmarkeDoc.exists()) {
              const handelsmarkeData = handelsmarkeDoc.data();
              handelsmarke = {
                bezeichnung: handelsmarkeData.bezeichnung
              };
            }
          }
          
          // Lade Discounter Daten
          let discounter = null;
          if (rawData.discounter) {
            const discounterDoc = await getDoc(rawData.discounter);
            if (discounterDoc.exists()) {
              const discounterData = discounterDoc.data();
              discounter = {
                id: discounterDoc.id,
                name: discounterData.name,
                bild: discounterData.bild,
                land: discounterData.land
              };
            }
          }
          
          purchaseData = {
            ...purchaseData,
            productId: productDoc.id,
            productType: 'noname',
            name: rawData.name || rawData.produktName || cartData.name,
            preis: rawData.preis || 0,
            bild: rawData.bild || '',
            savings: 0, // NoName hat keine Ersparnis
            stufe: rawData.stufe || 3, // Wichtig für Navigation
            handelsmarke: handelsmarke,
            discounter: discounter,
            // Vollständige Produktdaten für späteren Zugriff
            productData: {
              ...rawData,
              id: productDoc.id,
              handelsmarke: handelsmarke,
              discounter: discounter
            }
          };
        }
      }
      
      // Eindeutige Purchase ID basierend auf Produkttyp und ID + Timestamp für Duplikat-Vermeidung
      const productId = cartData.markenProdukt?.id || cartData.handelsmarkenProdukt?.id || 'unknown';
      const timestamp = Date.now();
      const uniquePurchaseId = `${purchaseData.productType || 'noname'}_${productId}_${timestamp}`;
      
      // Speichere in purchases Subcollection - bereinige undefined Werte inline
      const cleanedData = {
        ...purchaseData,
        // Bereinige explizit undefined Werte
        productId: purchaseData.productId || null,
        name: purchaseData.name || null,
        preis: purchaseData.preis || 0,
        bild: purchaseData.bild || null,
        savings: purchaseData.savings || 0,
        stufe: purchaseData.stufe || 3,
        hersteller: purchaseData.hersteller || null,
        handelsmarke: purchaseData.handelsmarke || null,
        discounter: purchaseData.discounter || null,
        productData: purchaseData.productData || null
      };
      
      // Verwende setDoc mit eindeutiger ID statt addDoc um Duplikate zu vermeiden
      await setDoc(doc(userRef, 'purchases', uniquePurchaseId), cleanedData);
      console.log('✅ Created purchase history entry with ID:', uniquePurchaseId, 'for:', purchaseData.name);
      
    } catch (error) {
      console.error('Error creating purchase history entry:', error);
      throw error;
    }
  }

  /**
   * Wandelt Markenprodukt in NoName um (Batch Operation)
   */
  static async convertToNoName(
    userId: string,
    conversions: ProductToConvert[]
  ): Promise<{ newItems: any[], idMapping: { [oldId: string]: string } }> {
    try {
      const batch = writeBatch(db);
      const userRef = doc(db, 'users', userId);
      const idMapping: { [oldId: string]: string } = {};
      const newItems: any[] = [];
      
      // First get ALL product details for tracking
      const detailPromises = conversions.map(async (conversion) => {
        const [markenDoc, noNameDoc, cartDoc] = await Promise.all([
          getDoc(doc(db, 'markenProdukte', conversion.markenProduktRef)),
          getDoc(doc(db, 'produkte', conversion.produktRef)),
          getDoc(doc(userRef, 'einkaufswagen', conversion.einkaufswagenRef))
        ]);
        
        const noNameData = noNameDoc.exists() ? noNameDoc.data() : null;
        const markenData = markenDoc.exists() ? markenDoc.data() : null;
        const cartData = cartDoc.exists() ? cartDoc.data() : null;
        
        // Hole Discounter-Info
        let discounterData = null;
        if (noNameData?.discounter) {
          const discounterDoc = await getDoc(noNameData.discounter);
          discounterData = discounterDoc.exists() ? discounterDoc.data() : null;
        }
        
        return {
          fromProduct: markenData,
          toProduct: { ...noNameData, discounter: discounterData },
          originalJourneyId: cartData?.journeyId, // NEU: Original Journey ID
          originalViewedProductIndex: cartData?.viewedProductIndex // NEU: Original Index
        };
      });
      const trackingDetails = await Promise.all(detailPromises);
      
      // 🎯 Track Conversion mit Journey und Details
      const journeyTrackingService = await import('./journeyTrackingService').then(m => m.default);
      journeyTrackingService.trackProductConversion(conversions, trackingDetails, userId);
      
      // Get product details for cart items
      const productPromises = conversions.map(async (conversion) => {
        const produktDoc = await getDoc(doc(db, 'produkte', conversion.produktRef));
        return produktDoc.exists() ? { id: conversion.produktRef, ...produktDoc.data() } : null;
      });
      const productDetails = await Promise.all(productPromises);
      
      // NEU: Journey ID für Tracking holen
      const currentJourneyId = journeyTrackingService.getCurrentJourneyId();
      
      conversions.forEach((conversion, index) => {
        // Lösche alten Eintrag
        batch.delete(doc(userRef, 'einkaufswagen', conversion.einkaufswagenRef));
        
        // Füge neuen NoName Eintrag hinzu
        const newDoc = doc(collection(userRef, 'einkaufswagen'));
        const productData = productDetails[index];
        const trackingDetail = trackingDetails[index];
        
        const newCartItem = {
          handelsmarkenProdukt: doc(db, 'produkte', conversion.produktRef),
          gekauft: false,
          timestamp: serverTimestamp(),
          name: productData?.name || 'NoName Produkt',
          // NEU: Journey ID speichern für späteres Tracking!
          journeyId: currentJourneyId || trackingDetail?.originalJourneyId,
          viewedProductIndex: trackingDetail?.originalViewedProductIndex // NEU: Index übertragen
        };
        
        batch.set(newDoc, newCartItem);
        
        // Map old ID to new ID and store new item data
        idMapping[conversion.einkaufswagenRef] = newDoc.id;
        newItems.push({
          id: newDoc.id,
          product: productData,
          savings: 0 // Will be calculated in frontend
        });
      });
      
      await batch.commit();
      console.log(`✅ Converted ${conversions.length} products to NoName`);
      return { newItems, idMapping };
    } catch (error) {
      console.error('Error converting to NoName:', error);
      throw error;
    }
  }

  /**
   * Berechnet die Ersparnis für ein NoName Produkt
   */
  static calculateSavings(
    noNamePrice: number,
    noNamePackSize: number,
    brandPrice: number,
    brandPackSize: number
  ): { amount: number; percent: number } {
    const noNamePricePerUnit = noNamePrice / (noNamePackSize || 1);
    const brandPricePerUnit = brandPrice / (brandPackSize || 1);
    const savingsAmount = brandPricePerUnit - noNamePricePerUnit;
    const savingsPercent = (savingsAmount / brandPricePerUnit) * 100;
    
    return {
      amount: Math.max(0, savingsAmount * (noNamePackSize || 1)),
      percent: Math.max(0, Math.round(savingsPercent))
    };
  }

  /**
   * Holt NoName Alternativen für ein Markenprodukt
   * OPTIMIERT: Vermeidet Composite Index durch Code-seitige Filterung
   */
  static async getNoNameAlternatives(
    markenProduktId: string,
    favoriteMarketId?: string
  ): Promise<FirestoreDocument<Produkte>[]> {
    try {
      console.log(`🔍 Getting NoName alternatives for brand product: ${markenProduktId}`);
      const markenProduktRef = doc(db, 'markenProdukte', markenProduktId);
      
      // Einfache Query: nur markenProdukt filter (vermeidet Composite Index)
      const q = query(
        collection(db, 'produkte'),
        where('markenProdukt', '==', markenProduktRef),
        limit(50) // Mehr holen für bessere Filterung
      );

      const snapshot = await getDocs(q);
      let allProducts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FirestoreDocument<Produkte>[];

      console.log(`🔍 Found ${allProducts.length} total alternatives before filtering`);

      // Code-seitige Filterung und Sortierung
      let favoriteProducts: FirestoreDocument<Produkte>[] = [];
      let otherProducts: FirestoreDocument<Produkte>[] = [];

      // Separiere nach Lieblingsmarkt
      if (favoriteMarketId) {
        allProducts.forEach(product => {
          // Prüfe ob discounter übereinstimmt (sowohl als ID als auch als Reference)
          const discounterMatch = 
            product.discounter === favoriteMarketId ||
            (product.discounter && typeof product.discounter === 'object' && 
             'id' in product.discounter && product.discounter.id === favoriteMarketId) ||
            (product.discounter && typeof product.discounter === 'string' && 
             product.discounter.includes(favoriteMarketId));
          
          if (discounterMatch) {
            favoriteProducts.push(product);
          } else {
            otherProducts.push(product);
          }
        });
      } else {
        otherProducts = allProducts;
      }

      // Sortiere beide Arrays nach preisDatum (neueste zuerst)
      const sortByPreisDatum = (a: FirestoreDocument<Produkte>, b: FirestoreDocument<Produkte>) => {
        const dateA = a.preisDatum;
        const dateB = b.preisDatum;
        
        // Wenn beide Daten vorhanden, nach Datum sortieren (neueste zuerst)
        if (dateA && dateB) {
          // Firestore Timestamp oder ISO String handling
          const timeA = typeof dateA === 'string' ? new Date(dateA).getTime() : 
                       dateA.seconds ? dateA.seconds * 1000 : 0;
          const timeB = typeof dateB === 'string' ? new Date(dateB).getTime() : 
                       dateB.seconds ? dateB.seconds * 1000 : 0;
          return timeB - timeA; // Neueste zuerst (DESC)
        }
        
        // Fallback: Produkte ohne Datum nach unten, dann nach Preis
        if (!dateA && dateB) return 1;
        if (dateA && !dateB) return -1;
        
        // Beide ohne Datum: Nach Preis sortieren
        const priceA = a.preis || 999999;
        const priceB = b.preis || 999999;
        return priceA - priceB;
      };

      favoriteProducts.sort(sortByPreisDatum);
      otherProducts.sort(sortByPreisDatum);

      // Kombiniere: Lieblingsmarkt zuerst, dann andere
      let finalProducts = [
        ...favoriteProducts.slice(0, 5), // Max 5 vom Lieblingsmarkt
        ...otherProducts.slice(0, 5)     // Max 5 von anderen
      ].slice(0, 10); // Max 10 insgesamt

      // Populate discounter information for UI display
      const populatedProducts = await Promise.all(
        finalProducts.map(async (product) => {
          if (product.discounter && typeof product.discounter === 'object' && 'id' in product.discounter) {
            try {
              const originalId = product.discounter.id;
              const discounterData = await this.getDocumentByReference(product.discounter);
              return {
                ...product,
                discounter: {
                  ...discounterData,
                  id: originalId  // Preserve the original ID for matching
                }
              };
            } catch (error) {
              console.error('Error populating discounter for product:', product.id, error);
              return product;
            }
          }
          return product;
        })
      );

      console.log(`✅ Found ${populatedProducts.length} NoName alternatives (${favoriteProducts.length} from favorite market)`);
      return populatedProducts;
    } catch (error) {
      console.error('Error getting NoName alternatives:', error);
      return [];
    }
  }

  /**
   * Aktualisiert die Gesamtersparnis des Users
   */
  static async updateUserTotalSavings(userId: string, amount: number): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        totalSavings: increment(amount)
      });
      
      // 📊 Update Leaderboard with savings
      const leaderboardService = (await import('./leaderboardService')).default;
      await leaderboardService.updateUserStats(userId, 0, amount);
      
      console.log(`✅ Updated user total savings by €${amount.toFixed(2)}`);
    } catch (error) {
      console.error('Error updating user savings:', error);
      throw error;
    }
  }

  /**
   * Holt alle Kategorien für Filter-Optionen
   */
  static async getAllKategorien(): Promise<FirestoreDocument<Kategorien>[]> {
    try {
      const snapshot = await getDocs(collection(db, 'kategorien'));
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FirestoreDocument<Kategorien>[];
    } catch (error) {
      console.error('Error getting all categories:', error);
      return [];
    }
  }

  /**
   * 🚀 PERFORMANCE: Helper to populate product references from raw data
   * Avoids duplicate Firebase calls by reusing raw data
   */
  private static async populateProductReferences(
    rawData: any, 
    productId: string
  ): Promise<ProductWithDetails | null> {
    try {
      // 🚀 PARALLEL: Load all references at once
      const [kategorie, discounter, handelsmarke, hersteller, markenProdukt] = await Promise.all([
        this.getDocumentByReference<Kategorien>(rawData.kategorie),
        this.getDocumentByReference<Discounter>(rawData.discounter),
        this.getDocumentByReference<Handelsmarken>(rawData.handelsmarke),
        this.getDocumentByReference<HerstellerNew>(rawData.hersteller),
        this.getDocumentByReference<MarkenProdukte>(rawData.markenProdukt)
      ]);

      return {
        id: productId,
        ...rawData,
        kategorie,
        discounter,
        handelsmarke,
        hersteller,
        markenProdukt
      };
    } catch (error) {
      console.error('Error populating product references:', error);
      return null;
    }
  }

  /**
   * 🚀 PERFORMANCE: Batch process NoName products with mega-optimization
   * Eliminates redundant reference calls and caches Hersteller lookups
   */
  private static async batchProcessNoNameProducts(docs: any[]): Promise<ProductWithDetails[]> {
     const uniqueReferences = new Map();
    
    // Sammle alle einzigartigen Referenzen
    docs.forEach((docSnap) => {
      const productData = docSnap.data() as Produkte;
      
      if (productData.handelsmarke) uniqueReferences.set(productData.handelsmarke.path || productData.handelsmarke.id, productData.handelsmarke);
      if (productData.kategorie) uniqueReferences.set(productData.kategorie.path || productData.kategorie.id, productData.kategorie);
      if (productData.hersteller) uniqueReferences.set(productData.hersteller.path || productData.hersteller.id, productData.hersteller);
      if (productData.packTyp) uniqueReferences.set(productData.packTyp.path || productData.packTyp.id, productData.packTyp);
      if (productData.discounter) uniqueReferences.set(productData.discounter.path || productData.discounter.id, productData.discounter);
    });
    
    // 🚀 PARALLEL: Load ALL unique references at once
    console.log(`🚀 Loading ${uniqueReferences.size} unique references in mega-batch...`);
    const referenceStartTime = Date.now();
    
    const referencePromises = Array.from(uniqueReferences.values()).map(async (ref) => {
      try {
        const doc = await this.getDocumentByReference(ref);
        return { ref: ref.path || ref.id, doc };
      } catch (error) {
        return { ref: ref.path || ref.id, doc: null };
      }
    });
    
    const referenceResults = await Promise.all(referencePromises);
    const referenceMap = new Map();
    referenceResults.forEach(result => {
      if (result.doc) referenceMap.set(result.ref, result.doc);
    });
    
    console.log(`⚡ Loaded ${referenceMap.size} references in ${Date.now() - referenceStartTime}ms`);
    
    // Process products with cached references
    const productPromises = docs.map(async (docSnap) => {
      const productData = docSnap.data() as Produkte;
      const productWithDetails: ProductWithDetails = { id: docSnap.id, ...productData };
      
      // Use cached references
      if (productData.handelsmarke) {
        const key = productData.handelsmarke.path || productData.handelsmarke.id;
        productWithDetails.handelsmarke = referenceMap.get(key) || null;
      }
      if (productData.kategorie) {
        const key = productData.kategorie.path || productData.kategorie.id;
        productWithDetails.kategorie = referenceMap.get(key) || null;
      }
      if (productData.hersteller) {
        const key = productData.hersteller.path || productData.hersteller.id;
        productWithDetails.hersteller = referenceMap.get(key) || null;
      }
      if (productData.packTyp) {
        const key = productData.packTyp.path || productData.packTyp.id;
        productWithDetails.packTypInfo = referenceMap.get(key) || null;
      }
      if (productData.discounter) {
        const key = productData.discounter.path || productData.discounter.id;
        productWithDetails.discounter = referenceMap.get(key) || null;
      }

       // 🚫 REMOVED: NoName-Produkte brauchen keine Marken-Abfrage!
       // Das war völlig unnötig und hat Performance gekostet
      
      return productWithDetails;
    });
    
    const results = await Promise.all(productPromises);
    
    // ✅ Sortiere nach preisDatum (neueste zuerst)
    results.sort((a, b) => {
      const dateA = a.preisDatum;
      const dateB = b.preisDatum;
      
      // Wenn beide Daten vorhanden, nach Datum sortieren (neueste zuerst)
      if (dateA && dateB) {
        // Firestore Timestamp oder ISO String handling
        const timeA = typeof dateA === 'string' ? new Date(dateA).getTime() : 
                     dateA.seconds ? dateA.seconds * 1000 : 0;
        const timeB = typeof dateB === 'string' ? new Date(dateB).getTime() : 
                     dateB.seconds ? dateB.seconds * 1000 : 0;
        return timeB - timeA; // Neueste zuerst
      }
      
      // Fallback: Produkte mit Datum vor solche ohne
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      
      return 0; // Beide ohne Datum: Reihenfolge beibehalten
    });
    
    return results;
  }

}

