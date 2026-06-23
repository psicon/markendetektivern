import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import achievementService from '../services/achievementService';
import { FavoriteProduct, favoritesService, ProductForFavorites } from '../services/favoritesService';

/**
 * Hook für Favoriten-Management
 */
export function useFavorites() {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([]);
  const [favoritesWithData, setFavoritesWithData] = useState<ProductForFavorites[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lade Favoriten beim Mount
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    loadFavorites();
  }, [user]);

  // Real-time Updates der Favoriten
  useEffect(() => {
    if (!user) return;

    const unsubscribe = favoritesService.subscribeToFavorites(user.uid, (updatedFavorites) => {
      setFavorites(updatedFavorites);
    });

    return unsubscribe;
  }, [user]);

  const loadFavorites = async () => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      const userFavorites = await favoritesService.getUserFavorites(user.uid);
      setFavorites(userFavorites);

      console.log(`✅ Loaded ${userFavorites.length} favorites`);
    } catch (err) {
      console.error('❌ Error loading favorites:', err);
      setError('Fehler beim Laden der Favoriten');
    } finally {
      setLoading(false);
    }
  };

  const loadFavoritesWithData = async () => {
    if (!user) return [];

    try {
      setLoading(true);
      const favoritesData = await favoritesService.getFavoritesWithProductData(user.uid);
      setFavoritesWithData(favoritesData);
      return favoritesData;
    } catch (err) {
      console.error('❌ Error loading favorites with data:', err);
      setError('Fehler beim Laden der Favoriten');
      return [];
    } finally {
      setLoading(false);
    }
  };

  const addToFavorites = useCallback(async (
    productId: string, 
    productType: 'markenprodukt' | 'noname' | 'external',
    productData?: any
  ) => {
    if (!user) {
      console.warn('Keine User-Session für Favoriten');
      return false;
    }

    try {
      await favoritesService.addToFavorites(user.uid, productId, productType, productData);
      
      // 🚀 PERFORMANCE: Achievement Non-Blocking
      achievementService.trackAction(user.uid, 'save_product', {
        productId,
        productType
      }).catch(error => {
        console.error('❌ Save Product Achievement Tracking Fehler:', error);
      });
      
      console.log(`✅ Added to favorites: ${productId}`);
      return true;
    } catch (err) {
      console.error(`❌ Error adding to favorites:`, err);
      return false;
    }
  }, [user]);

  const removeFromFavorites = useCallback(async (
    productId: string, 
    productType: 'markenprodukt' | 'noname' | 'external'
  ) => {
    if (!user) return false;

    try {
      await favoritesService.removeFromFavorites(user.uid, productId, productType);
      console.log(`✅ Removed from favorites: ${productId}`);
      return true;
    } catch (err) {
      console.error(`❌ Error removing from favorites:`, err);
      return false;
    }
  }, [user]);

  const toggleFavorite = useCallback(async (
    productId: string,
    productType: 'markenprodukt' | 'noname' | 'external',
    productData?: any
  ) => {
    if (!user) return false;

    // Errors RETHROWEN damit der Caller (Detail-Page mit Optimistic
    // UI) den Fehler-Toast zeigen kann. Vorher haben wir hier silent
    // 'false' returnt — das hat den Optimistic-Revert-Path getötet
    // (Caller sah keinen Fehler, glaubte das Toggle wäre erfolgreich
    // und der Heart blieb in der falschen Position bei Network-Fail).
    const isNowFavorite = await favoritesService.toggleFavorite(user.uid, productId, productType, productData);

    if (isNowFavorite) {
      // 🚀 PERFORMANCE: Achievement Non-Blocking nur beim Hinzufügen
      achievementService.trackAction(user.uid, 'save_product', {
        productId,
        productType
      }).catch(error => {
        console.error('❌ Save Product Achievement Tracking Fehler:', error);
      });

      // 🎯 Track zu Journey — NICHT für externe Produkte: trackAddToFavorites
      // baut die productRef über collectionForProductType('noname'/'brand') und
      // kennt 'external' nicht → würde eine Bogus produkte/{ean}-Ref schreiben
      // (ClickUp 86cad6d6h). save_product-Achievement oben läuft trotzdem.
      if (productType !== 'external') {
        const productName = productData?.name || productData?.produktName || 'Unbekanntes Produkt';
        const journeyProductType = productType === 'markenprodukt' ? 'brand' : 'noname';

        const priceInfo = {
          price: productData?.preis || productData?.price || 0,
          savings: productData?.ersparnis || productData?.savings || 0
        };

        const journeyTrackingService = (await import('../services/journeyTrackingService')).default;
        journeyTrackingService.trackAddToFavorites(productId, productName, journeyProductType, user.uid, priceInfo);
      }
    }

    console.log(`✅ Toggled favorite: ${productId} - now: ${isNowFavorite}`);
    return isNowFavorite;
  }, [user]);

  const isFavorite = useCallback(async (
    productId: string, 
    productType: 'markenprodukt' | 'noname' | 'external'
  ) => {
    if (!user) return false;

    try {
      return await favoritesService.isFavorite(user.uid, productId, productType);
    } catch (err) {
      console.error('❌ Error checking favorite status:', err);
      return false;
    }
  }, [user]);

  // Helper: Ist Produkt in lokalen Favoriten?
  const isLocalFavorite = useCallback((
    productId: string, 
    productType: 'markenprodukt' | 'noname' | 'external'
  ) => {
    return favorites.some(fav => 
      fav.productId === productId && fav.productType === productType
    );
  }, [favorites]);

  return {
    // Data
    favorites,
    favoritesWithData,
    favoriteCount: favorites.length,
    loading,
    error,

    // Actions
    addToFavorites,
    removeFromFavorites,
    toggleFavorite,
    isFavorite,
    isLocalFavorite,
    loadFavorites,
    loadFavoritesWithData,
  };
}

/**
 * Hook für einzelne Produkt-Favoriten Status  
 */
export function useFavoriteStatus(productId: string, productType: 'markenprodukt' | 'noname' | 'external') {
  const { user } = useAuth();
  const [isFav, setIsFav] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid || !productId) {
      setLoading(false);
      return;
    }

    checkFavoriteStatus();
  }, [user, productId, productType]);

  const checkFavoriteStatus = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const status = await favoritesService.isFavorite(user.uid, productId, productType);
      setIsFav(status);
    } catch (error) {
      console.error('Error checking favorite status:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (productData?: any) => {
    if (!user) return false;

    // Errors RETHROWEN — Caller managed Optimistic-UI + Toast.
    const isNowFavorite = await favoritesService.toggleFavorite(user.uid, productId, productType, productData);
    setIsFav(isNowFavorite);

    if (isNowFavorite) {
      achievementService.trackAction(user.uid, 'save_product', {
        productId,
        productType
      }).catch(error => {
        console.error('❌ Save Product Achievement Tracking Fehler:', error);
      });
    }

    return isNowFavorite;
  };

  return {
    isFavorite: isFav,
    loading,
    toggleFavorite: toggle,
  };
}
