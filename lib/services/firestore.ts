import {
    addDoc,
    collection,
    doc,
    DocumentReference,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    where
} from 'firebase/firestore';
import { db } from '../firebase';
import {
    Discounter,
    FirestoreDocument,
    Handelsmarken,
    HerstellerNew,
    Kategorien,
    MarkenProdukte,
    MarkenProduktWithDetails,
    Packungstypen,
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
   * Holt ein einzelnes Dokument per Referenz (unterstützt verschiedene Formate)
   */
  static async getDocumentByReference<T>(ref: DocumentReference | any): Promise<T | null> {
    try {
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
      console.log('Error fetching NoName product details (this is normal if product is in other collection):', error.message);
      return null;
    }
  }

  /**
   * Holt Markenprodukt mit allen Details (populated references)
   */
  static async getMarkenProduktWithDetails(productId: string): Promise<MarkenProduktWithDetails | null> {
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

      console.log(`🔍 HerstellerOrMarke für Produkt ${productId}:`, herstellerOrMarke);
      console.log(`🔍 Hersteller Reference Path:`, productData.hersteller);

      // Prüfe ob die hersteller Referenz auf eine Marke oder einen Hersteller zeigt
      let marke: any = null;
      let hersteller: any = null;
      let brands: any[] = [];
      
      if (herstellerOrMarke) {
        console.log(`🔍 Feld "hersteller" zeigt auf: ${herstellerOrMarke.name || herstellerOrMarke.herstellername}`);
        
        // Prüfe ob es eine Marke ist (hat herstellerref) oder ein Hersteller (hat herstellername)
        if (herstellerOrMarke.herstellerref) {
          // Das ist eine MARKE
          marke = herstellerOrMarke;
          hersteller = await this.getDocumentByReference<any>(marke.herstellerref);
          brands = await this.getMarkenByHersteller(marke.herstellerref);
          console.log(`✅ MARKE gefunden: ${marke.name}, Hersteller: ${hersteller?.herstellername}`);
        } else if (herstellerOrMarke.herstellername) {
          // Das ist direkt ein HERSTELLER
          hersteller = herstellerOrMarke;
          brands = await this.getMarkenByHersteller(productData.hersteller);
          console.log(`✅ HERSTELLER gefunden: ${hersteller.herstellername}, Brands: ${brands.length}`);
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

      // Resolve related products if available
      if (productData.relatedProdukte && productData.relatedProdukte.length > 0) {
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
      console.log(`🎯 Getting comparison data for ${productId} (${isMarkenProdukt ? 'Brand' : 'NoName'} product)`);
      
      if (isMarkenProdukt) {
        // CASE 1: Brand product clicked
        return await this.getBrandProductComparison(productId);
      } else {
        // CASE 2: NoName product clicked  
        return await this.getNoNameProductComparison(productId);
      }
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
      console.log('📱 CASE 1: Brand product clicked, ID:', brandProductId);
      
      // Get the brand product
      const brandProduct = await this.getMarkenProduktWithDetails(brandProductId);
      if (!brandProduct) {
        console.error('❌ Brand product not found:', brandProductId);
        return null;
      }
      
      console.log('✅ Found brand product:', brandProduct.name);
      
      // Find all NoName products that link to this brand product
      const relatedNoNameProducts = await this.findNoNameProductsByBrandId(brandProductId);
      
      console.log(`🔗 Found ${relatedNoNameProducts.length} related NoName products`);
      
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
      console.log('🛒 CASE 2: NoName product clicked, ID:', noNameProductId);
      
      // Get the NoName product
      const noNameProduct = await this.getProductWithDetails(noNameProductId);
      if (!noNameProduct) {
        console.error('❌ NoName product not found:', noNameProductId);
        return null;
      }
      
      console.log('✅ Found NoName product:', noNameProduct.name);
      
      // Check if markenProdukt field exists and is populated
      const markenProduktField = noNameProduct.markenProdukt;
      if (!markenProduktField) {
        console.error('❌ NoName product has no markenProdukt field');
        return null;
      }
      
      // The markenProdukt field is already populated with the full brand product object!
      console.log('✅ markenProdukt is populated object:', markenProduktField.name);
      
      // Convert the populated markenProdukt to our MarkenProduktWithDetails format
      // and populate its references properly
      const brandProduct: MarkenProduktWithDetails = {
        id: 'populated-brand-product', // We don't have the real ID, but we have the data
        name: markenProduktField.name,
        bild: markenProduktField.bild,
        beschreibung: markenProduktField.beschreibung,
        preis: markenProduktField.preis,
        packSize: markenProduktField.packSize,
        EAN: markenProduktField.EAN,
        rating: markenProduktField.rating,
        ratingCount: markenProduktField.ratingCount,
        created_at: markenProduktField.created_at,
        preisDatum: markenProduktField.preisDatum,
        averageRatingOverall: markenProduktField.averageRatingOverall,
        averageRatingContent: markenProduktField.averageRatingContent,
        averageRatingPriceValue: markenProduktField.averageRatingPriceValue,
        averageRatingSimilarity: markenProduktField.averageRatingSimilarity,
        averageRatingTasteFunction: markenProduktField.averageRatingTasteFunction,
        EANs: markenProduktField.EANs || [],
        relatedProdukteIDs: [],
        // Populate the references
        kategorie: markenProduktField.kategorie ? await this.getDocumentByReference(markenProduktField.kategorie, 'kategorien') : undefined,
        hersteller: markenProduktField.hersteller ? await this.getDocumentByReference(markenProduktField.hersteller, 'hersteller_new') : undefined,
        packTypInfo: markenProduktField.packTyp ? await this.getDocumentByReference(markenProduktField.packTyp, 'packungstypen') : undefined
      };
      
      console.log('✅ Converted to brand product format:', brandProduct.name);
      
      // SPEED OPTIMIZATION: Use the original markenProdukt reference directly!
      // We can extract the DocumentReference from the original NoName product data
      console.log('⚡ Using original markenProdukt reference for super-fast query...');
      
      // Check if the original noNameProduct still has the DocumentReference
      // (before it got populated by our service)
      let relatedNoNameProducts: ProductWithDetails[];
      
      // First, try to get the original DocumentReference from the raw Firestore data
      const rawProductDoc = await getDoc(doc(db, 'produkte', noNameProductId));
      if (rawProductDoc.exists()) {
        const rawData = rawProductDoc.data();
        const originalMarkenProduktRef = rawData.markenProdukt;
        
        if (originalMarkenProduktRef && typeof originalMarkenProduktRef === 'object') {
          console.log('✅ Using original DocumentReference for super-fast query');
          relatedNoNameProducts = await this.findNoNameProductsByBrandReference(originalMarkenProduktRef);
        } else {
          console.log('🔄 Fallback: Creating DocumentReference from brand name...');
          const markenProdukteRef = collection(db, 'markenProdukte');
          const brandQuery = query(markenProdukteRef, where('name', '==', brandProduct.name), limit(1));
          const brandQuerySnapshot = await getDocs(brandQuery);
          
          if (brandQuerySnapshot.empty) {
            console.error('❌ Could not find brand product in markenProdukte collection');
            relatedNoNameProducts = [noNameProduct];
          } else {
            const brandDoc = brandQuerySnapshot.docs[0];
            const brandDocRef = doc(db, 'markenProdukte', brandDoc.id);
            relatedNoNameProducts = await this.findNoNameProductsByBrandReference(brandDocRef);
          }
        }
      } else {
        console.error('❌ Could not fetch raw product data');
        relatedNoNameProducts = [noNameProduct];
      }
      
      console.log(`🔗 Found ${relatedNoNameProducts.length} total related NoName products`);
      
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
      console.log('⚡ SUPER FAST: Finding NoName products using DocumentReference');
      
      const produkteRef = collection(db, 'produkte');
      const q = query(produkteRef, where('markenProdukt', '==', brandProductRef));
      const querySnapshot = await getDocs(q);
      
      console.log(`🔍 Found ${querySnapshot.docs.length} NoName products`);
      
      const relatedProducts: ProductWithDetails[] = [];
      
      // Process all products in parallel for maximum speed
      const productPromises = querySnapshot.docs.map(async (docSnap) => {
        const productData = docSnap.data() as Produkte;
        const productWithDetails: ProductWithDetails = { id: docSnap.id, ...productData };
        
        // Populate references in parallel
        const [handelsmarke, kategorie, hersteller, packTypInfo, discounter] = await Promise.all([
          productWithDetails.handelsmarke ? this.getDocumentByReference(productWithDetails.handelsmarke, 'handelsmarken') : null,
          productWithDetails.kategorie ? this.getDocumentByReference(productWithDetails.kategorie, 'kategorien') : null,
          productWithDetails.hersteller ? this.getDocumentByReference(productWithDetails.hersteller, 'hersteller_new') : null,
          productWithDetails.packTyp ? this.getDocumentByReference(productWithDetails.packTyp, 'packungstypen') : null,
          productWithDetails.discounter ? this.getDocumentByReference(productWithDetails.discounter, 'discounter') : null,
        ]);
        
        if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;
        if (kategorie) productWithDetails.kategorie = kategorie;
        if (hersteller) productWithDetails.hersteller = hersteller;
        if (packTypInfo) productWithDetails.packTypInfo = packTypInfo;
        if (discounter) productWithDetails.discounter = discounter;

        // Lade Marken für den Hersteller (Reverse Lookup)
        if (productWithDetails.hersteller && productData.hersteller) {
          productWithDetails.brands = await this.getMarkenByHersteller(productData.hersteller);
        }
        
        return productWithDetails;
      });
      
      const results = await Promise.all(productPromises);
      relatedProducts.push(...results);
      
      console.log(`✅ SUPER FAST: Loaded ${relatedProducts.length} NoName products with full details`);
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
      const relatedProducts: ProductWithDetails[] = [];
      
      // Process each found NoName product
      for (const docSnap of querySnapshot.docs) {
        const productData = docSnap.data() as Produkte;
        const productWithDetails: ProductWithDetails = {
          id: docSnap.id,
          ...productData
        };

        // Populate references (same as existing logic)
        const [kategorie, discounter, handelsmarke, hersteller, packTypInfo] = await Promise.all([
          this.getDocumentByReference<Kategorien>(productData.kategorie),
          this.getDocumentByReference<Discounter>(productData.discounter),
          this.getDocumentByReference<Handelsmarken>(productData.handelsmarke),
          this.getDocumentByReference<HerstellerNew>(productData.hersteller),
          this.getDocumentByReference<Packungstypen>(productData.packTyp)
        ]);

        if (kategorie) productWithDetails.kategorie = kategorie;
        if (discounter) productWithDetails.discounter = discounter;
        if (handelsmarke) productWithDetails.handelsmarke = handelsmarke;
        if (hersteller) productWithDetails.hersteller = hersteller;
        if (packTypInfo) productWithDetails.packTypInfo = packTypInfo;

        relatedProducts.push(productWithDetails);
      }
      
      console.log(`✅ Found ${relatedProducts.length} NoName products linked to brand ${brandProductId}`);
      return relatedProducts;
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
      console.log(`🔍 Suche Marken für Hersteller:`, herstellerNewDocRef.path);
      
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
      
      console.log(`✅ Gefundene Marken für ${herstellerNewDocRef.path}:`, marken.map(m => m.name));
      return marken;
    } catch (error) {
      console.error('❌ Fehler beim Laden der Marken:', error);
      return [];
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

}

