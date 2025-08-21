import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import purchaseHistoryService, { PurchasedProduct } from '../services/purchaseHistoryService';

export interface PurchaseHistoryHook {
  // Data
  purchases: PurchasedProduct[];
  brandPurchases: PurchasedProduct[];
  noNamePurchases: PurchasedProduct[];
  
  // State
  loading: boolean;
  error: string | null;
  
  // Stats
  totalCount: number;
  totalSavings: number;
  
  // Actions
  loadPurchases: () => Promise<void>;
  refreshData: () => Promise<void>;
}

export function usePurchaseHistory(): PurchaseHistoryHook {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<PurchasedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Split purchases by type
  const brandPurchases = purchases.filter(p => p.type === 'markenprodukt');
  const noNamePurchases = purchases.filter(p => p.type === 'noname');
  
  // Calculate stats
  const totalCount = purchases.length;
  const totalSavings = purchases.reduce((sum, p) => sum + p.savings, 0);

  // Load purchases function
  const loadPurchases = useCallback(async () => {
    if (!user?.uid) {
      setError('Benutzer nicht angemeldet');
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const purchasedProducts = await purchaseHistoryService.getUserPurchaseHistory(user.uid);
      setPurchases(purchasedProducts);
    } catch (error) {
      console.error('Error loading purchase history:', error);
      setError('Fehler beim Laden der Kaufhistorie');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  // Refresh data (alias for loadPurchases)
  const refreshData = useCallback(() => {
    setLoading(true);
    return loadPurchases();
  }, [loadPurchases]);

  // Initial load and real-time subscription
  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    // Set up real-time subscription
    const unsubscribe = purchaseHistoryService.subscribeToUserPurchaseHistory(
      user.uid,
      (purchasedProducts, error) => {
        if (error) {
          setError(error);
        } else {
          setPurchases(purchasedProducts);
          setError(null);
        }
        setLoading(false);
      }
    );

    // Cleanup subscription
    return unsubscribe;
  }, [user?.uid]);

  return {
    // Data
    purchases,
    brandPurchases,
    noNamePurchases,
    
    // State
    loading,
    error,
    
    // Stats
    totalCount,
    totalSavings,
    
    // Actions
    loadPurchases,
    refreshData,
  };
}

// Hook for purchase statistics
export function usePurchaseStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalPurchases: 0,
    totalSavings: 0,
    brandPurchases: 0,
    noNamePurchases: 0,
    favoriteMarkets: [] as { name: string; count: number }[]
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const purchaseStats = await purchaseHistoryService.getUserPurchaseStats(user.uid);
      setStats(purchaseStats);
    } catch (error) {
      console.error('Error loading purchase stats:', error);
      setError('Fehler beim Laden der Statistiken');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  return {
    stats,
    loading,
    error,
    refreshStats: loadStats
  };
}
