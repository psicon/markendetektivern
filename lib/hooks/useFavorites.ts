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
    productType: 'markenprodukt' | 'noname',
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
    productType: 'markenprodukt' | 'noname'
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
    productType: 'markenprodukt' | 'noname',
    productData?: any
  ) => {
    if (!user) return false;

    try {
      const isNowFavorite = await favoritesService.toggleFavorite(user.uid, productId, productType, productData);
      
      if (isNowFavorite) {
        // 🚀 PERFORMANCE: Achievement Non-Blocking nur beim Hinzufügen
        achievementService.trackAction(user.uid, 'save_product', {
          productId,
          productType
        }).catch(error => {
          console.error('❌ Save Product Achievement Tracking Fehler:', error);
        });
        
        // 🎯 Track zu Journey
        const productName = productData?.name || productData?.produktName || 'Unbekanntes Produkt';
        const journeyProductType = productType === 'markenprodukt' ? 'brand' : 'noname';
        
        // Preis-Info extrahieren
        const priceInfo = {
          price: productData?.preis || productData?.price || 0,
          savings: productData?.ersparnis || productData?.savings || 0
        };
        
        // Importiere und nutze journeyTrackingService direkt
        const journeyTrackingService = (await import('../services/journeyTrackingService')).default;
        journeyTrackingService.trackAddToFavorites(productId, productName, journeyProductType, user.uid, priceInfo);
      }
      
      console.log(`✅ Toggled favorite: ${productId} - now: ${isNowFavorite}`);
      return isNowFavorite;
    } catch (err) {
      console.error(`❌ Error toggling favorite:`, err);
      return false;
    }
  }, [user]);

  const isFavorite = useCallback(async (
    productId: string, 
    productType: 'markenprodukt' | 'noname'
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
    productType: 'markenprodukt' | 'noname'
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
export function useFavoriteStatus(productId: string, productType: 'markenprodukt' | 'noname') {
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

    try {
      const isNowFavorite = await favoritesService.toggleFavorite(user.uid, productId, productType, productData);
      setIsFav(isNowFavorite);
      
      if (isNowFavorite) {
        // 🚀 PERFORMANCE: Achievement Non-Blocking
        achievementService.trackAction(user.uid, 'save_product', {
          productId,
          productType
        }).catch(error => {
          console.error('❌ Save Product Achievement Tracking Fehler:', error);
        });
      }
      
      return isNowFavorite;
    } catch (error) {
      console.error('Error toggling favorite:', error);
      return false;
    }
  };

  return {
    isFavorite: isFav,
    loading,
    toggleFavorite: toggle,
  };
}
