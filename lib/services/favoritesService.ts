import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface FavoriteProduct {
  id: string;
  userId: string;
  productId: string;
  productType: 'markenprodukt' | 'noname';
  productData?: any;
  addedAt: Date;
}

export interface ProductForFavorites {
  id: string;
  name: string;
  preis: number;
  packSize?: number;
  bild?: string;
  type: 'markenprodukt' | 'noname';
  category?: string;
  brand?: string;
}

class FavoritesService {
  private static instance: FavoritesService;

  private constructor() {}

  static getInstance(): FavoritesService {
    if (!FavoritesService.instance) {
      FavoritesService.instance = new FavoritesService();
    }
    return FavoritesService.instance;
  }

  /**
   * Fügt ein Produkt zu den Favoriten hinzu (als Subcollection)
   */
  async addToFavorites(
    userId: string, 
    productId: string, 
    productType: 'markenprodukt' | 'noname',
    productData?: any
  ): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const favoriteId = `${productType}_${productId}`;
      const favoriteRef = doc(userRef, 'favorites', favoriteId);

      // Bereinige productData von undefined Werten
      const cleanProductData = productData ? {
        id: productData.id || null,
        name: productData.name || null,
        preis: productData.preis || null,
        packSize: productData.packSize || null,
        bild: productData.bild || null,
        type: productData.type || null,
        category: productData.category || null,
        brand: productData.brand || null
      } : null;

      await setDoc(favoriteRef, {
        productId,
        productType,
        productData: cleanProductData,
        addedAt: serverTimestamp()
      });
    } catch (error: any) {
      console.error('❌ Error adding to favorites:', error);
      
      // Bei Permission-Fehler: Warnung statt Fehler
      if (error?.code === 'permission-denied') {
        console.warn('⚠️ Keine Berechtigung für Favoriten - Firebase Rules deployment erforderlich');
        return; // Nicht werfen, damit UI nicht crasht
      }
      
      throw error;
    }
  }

  /**
   * Entfernt ein Produkt aus den Favoriten (Subcollection)
   */
  async removeFromFavorites(
    userId: string, 
    productId: string, 
    productType: 'markenprodukt' | 'noname'
  ): Promise<void> {
    try {
      const userRef = doc(db, 'users', userId);
      const favoriteId = `${productType}_${productId}`;
      const favoriteRef = doc(userRef, 'favorites', favoriteId);

      await deleteDoc(favoriteRef);
    } catch (error: any) {
      console.error('❌ Error removing from favorites:', error);
      
      if (error?.code === 'permission-denied') {
        console.warn('⚠️ Keine Berechtigung für Favoriten - Firebase Rules deployment erforderlich');
        return;
      }
      
      throw error;
    }
  }

  /**
   * Prüft ob ein Produkt in den Favoriten ist (Subcollection)
   */
  async isFavorite(
    userId: string, 
    productId: string, 
    productType: 'markenprodukt' | 'noname'
  ): Promise<boolean> {
    try {
      const userRef = doc(db, 'users', userId);
      const favoriteId = `${productType}_${productId}`;
      const favoriteRef = doc(userRef, 'favorites', favoriteId);

      const favoriteDoc = await getDoc(favoriteRef);
      return favoriteDoc.exists();
    } catch (error: any) {
      console.error('❌ Error checking favorite status:', error);
      
      if (error?.code === 'permission-denied') {
        console.warn('⚠️ Keine Berechtigung für Favoriten - Firebase Rules deployment erforderlich');
        return false;
      }
      
      throw error;
    }
  }

  /**
   * Holt alle Favoriten eines Users (Subcollection)
   */
  async getUserFavorites(userId: string): Promise<FavoriteProduct[]> {
    try {
      const userRef = doc(db, 'users', userId);
      const favoritesQuery = query(
        collection(userRef, 'favorites'),
        orderBy('addedAt', 'desc')
      );

      const querySnapshot = await getDocs(favoritesQuery);
      const favorites: FavoriteProduct[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        favorites.push({
          id: doc.id,
          userId: userId,
          productId: data.productId,
          productType: data.productType,
          productData: data.productData,
          addedAt: data.addedAt?.toDate() || new Date()
        });
      });

      return favorites;
    } catch (error: any) {
      console.error('❌ Error loading favorites:', error);
      
      if (error?.code === 'permission-denied') {
        console.warn('⚠️ Keine Berechtigung für Favoriten - Firebase Rules deployment erforderlich');
        return []; // Leere Liste zurückgeben
      }
      
      throw error;
    }
  }

  /**
   * Erweitert Favoriten mit VOLLSTÄNDIGEN Produktdaten aus den echten Collections
   */
  async getFavoritesWithProductData(userId: string): Promise<any[]> {
    try {
      const favorites = await this.getUserFavorites(userId);
      const productsWithData: any[] = [];

      for (const favorite of favorites) {
        try {
          let productData: any = null;
          
          if (favorite.productType === 'markenprodukt') {
            // Echte Markenprodukte aus markenProdukte Collection
            const productDoc = await getDoc(doc(db, 'markenProdukte', favorite.productId));
            if (productDoc.exists()) {
              const rawData = productDoc.data();
              
              // Ersparnis berechnen
              let savings = 0;
              if (rawData.relatedProdukteIDs?.length > 0) {
                for (const noNameId of rawData.relatedProdukteIDs.slice(0, 3)) {
                  try {
                    const noNameDoc = await getDoc(doc(db, 'produkte', noNameId));
                    if (noNameDoc.exists() && noNameDoc.data().preis < rawData.preis) {
                      const potentialSaving = rawData.preis - noNameDoc.data().preis;
                      if (potentialSaving > savings) {
                        savings = potentialSaving;
                      }
                    }
                  } catch (err) {
                    // Ignore loading errors for individual NoName products
                  }
                }
              }
              
              // MARKE laden (aus hersteller Collection) - wie im Einkaufszettel
              let hersteller = null;
              try {
                if (rawData.hersteller) {
                  const herstellerDoc = await getDoc(rawData.hersteller);
                  if (herstellerDoc.exists()) {
                    const herstellerData = herstellerDoc.data();
                    hersteller = {
                      name: herstellerData.name, // ✅ KORREKT: name statt bezeichnung
                      bild: herstellerData.bild
                    };
                  }
                }
              } catch (err) {
                console.warn('Error loading hersteller:', err);
              }
              
              productData = {
                ...rawData,
                id: productDoc.id,
                type: 'markenprodukt',
                savings,
                hersteller, // EXAKT wie im Einkaufszettel: hersteller.name + hersteller.bild
                discounter: null
              };
            }
          } else {
            // MIGRATION FIX: Prüfe zuerst ob es fälschlicherweise als "noname" gespeichert wurde
            const markenProduktDoc = await getDoc(doc(db, 'markenProdukte', favorite.productId));
            if (markenProduktDoc.exists()) {
              // MIGRATION: Das ist eigentlich ein Markenprodukt!
              console.log('🔧 MIGRATION: Korrigiere Favorit von noname zu markenprodukt:', favorite.productId);
              
              const rawData = markenProduktDoc.data();
              
              // Ersparnis berechnen
              let savings = 0;
              if (rawData.relatedProdukteIDs?.length > 0) {
                for (const noNameId of rawData.relatedProdukteIDs.slice(0, 3)) {
                  try {
                    const noNameDoc = await getDoc(doc(db, 'produkte', noNameId));
                    if (noNameDoc.exists() && noNameDoc.data().preis < rawData.preis) {
                      const potentialSaving = rawData.preis - noNameDoc.data().preis;
                      if (potentialSaving > savings) {
                        savings = potentialSaving;
                      }
                    }
                  } catch (err) {
                    // Ignore
                  }
                }
              }
              
              // MARKE laden (aus hersteller Collection) - wie im Einkaufszettel
              let hersteller = null;
              try {
                if (rawData.hersteller) {
                  const herstellerDoc = await getDoc(rawData.hersteller);
                  if (herstellerDoc.exists()) {
                    const herstellerData = herstellerDoc.data();
                    hersteller = {
                      name: herstellerData.name, // ✅ KORREKT: name statt bezeichnung
                      bild: herstellerData.bild
                    };
                  }
                }
              } catch (err) {
                console.warn('Error loading hersteller in migration:', err);
              }
              
              productData = {
                ...rawData,
                id: markenProduktDoc.id,
                type: 'markenprodukt', // Korrigierter Typ!
                savings,
                hersteller, // EXAKT wie im Einkaufszettel
                discounter: null
              };
            } else {
              // Echtes NoName Produkt aus produkte Collection
              const productDoc = await getDoc(doc(db, 'produkte', favorite.productId));
              if (productDoc.exists()) {
                const rawData = productDoc.data();
                
                // Referenzen auflösen
                let handelsmarke = null;
                let discounter = null;
                
                try {
                  if (rawData.handelsmarke) {
                    const handelsmarkeDoc = await getDoc(rawData.handelsmarke);
                    if (handelsmarkeDoc.exists()) {
                      handelsmarke = handelsmarkeDoc.data();
                    }
                  }
                  
                  if (rawData.discounter) {
                    const discounterDoc = await getDoc(rawData.discounter);
                    if (discounterDoc.exists()) {
                      discounter = {
                        ...discounterDoc.data(),
                        id: discounterDoc.id
                      };
                    }
                  }
                } catch (err) {
                  console.warn('Error loading references for NoName product:', err);
                }
                
                productData = {
                  ...rawData,
                  id: productDoc.id,
                  type: 'noname',
                  savings: 0,
                  handelsmarke,
                  discounter
                };
              }
            }
          }

          if (productData) {
            productsWithData.push({
              ...productData,
              addedAt: favorite.addedAt
            });
          }
        } catch (productError) {
          console.warn('Fehler beim Laden von Produkt:', favorite.productId, productError);
          // Fallback nur wenn wirklich nötig
          if (favorite.productData) {
            productsWithData.push({
              id: favorite.productId,
              name: favorite.productData.name || 'Unbekanntes Produkt',
              preis: favorite.productData.preis || 0,
              bild: favorite.productData.bild,
              type: favorite.productType,
              handelsmarke: null,
              discounter: null,
              savings: 0,
              addedAt: favorite.addedAt
            });
          }
        }
      }

      return productsWithData;
    } catch (error) {
      console.error('❌ Error loading favorites with product data:', error);
      return []; // Return leeres Array statt throw
    }
  }

  /**
   * Toggles Favoriten-Status
   */
  async toggleFavorite(
    userId: string, 
    productId: string, 
    productType: 'markenprodukt' | 'noname',
    productData?: any
  ): Promise<boolean> {
    try {
      const isFav = await this.isFavorite(userId, productId, productType);
      
      if (isFav) {
        await this.removeFromFavorites(userId, productId, productType);
        return false;
      } else {
        await this.addToFavorites(userId, productId, productType, productData);
        return true;
      }
    } catch (error) {
      console.error('❌ Error toggling favorite:', error);
      throw error;
    }
  }

  /**
   * Subscription für Realtime Updates
   */
  subscribeToFavorites(userId: string, callback: (favorites: FavoriteProduct[]) => void) {
    const userRef = doc(db, 'users', userId);
    const favoritesRef = collection(userRef, 'favorites');

    return onSnapshot(favoritesRef, (snapshot) => {
      const favorites: FavoriteProduct[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        favorites.push({
          id: doc.id,
          userId,
          productId: data.productId,
          productType: data.productType,
          productData: data.productData,
          addedAt: data.addedAt?.toDate() || new Date()
        });
      });

      callback(favorites);
    }, (error) => {
      console.error('❌ Error in favorites subscription:', error);
      // Bei Fehler: Leere Liste zurückgeben
      callback([]);
    });
  }
}

// Export singleton instance
export const favoritesService = FavoritesService.getInstance();
export default favoritesService;