import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import purchaseHistoryService, { PurchasedProduct } from '../services/purchaseHistoryService';

export interface PurchaseHistoryHook {
  // Data
  brandPurchases: PurchasedProduct[];
  noNamePurchases: PurchasedProduct[];
  
  // State - Brand
  brandLoading: boolean;
  brandLoadingMore: boolean;
  brandHasMore: boolean;
  
  // State - NoName
  noNameLoading: boolean;
  noNameLoadingMore: boolean;
  noNameHasMore: boolean;
  
  // Global State
  error: string | null;
  
  // Stats
  totalBrandCount: number;
  totalNoNameCount: number;
  totalSavings: number;
  
  // Actions
  loadBrandPurchases: (reset?: boolean) => Promise<void>;
  loadNoNamePurchases: (reset?: boolean) => Promise<void>;
  refreshData: () => Promise<void>;
}

export function usePurchaseHistory(): PurchaseHistoryHook {
  const { user } = useAuth();
  
  // Separate states for Brand and NoName (like explore.tsx)
  const [brandPurchases, setBrandPurchases] = useState<PurchasedProduct[]>([]);
  const [brandLoading, setBrandLoading] = useState(true);
  const [brandLoadingMore, setBrandLoadingMore] = useState(false);
  const [brandLastDoc, setBrandLastDoc] = useState<any>(null);
  const [brandHasMore, setBrandHasMore] = useState(true);
  
  const [noNamePurchases, setNoNamePurchases] = useState<PurchasedProduct[]>([]);
  const [noNameLoading, setNoNameLoading] = useState(true);
  const [noNameLoadingMore, setNoNameLoadingMore] = useState(false);
  const [noNameLastDoc, setNoNameLastDoc] = useState<any>(null);
  const [noNameHasMore, setNoNameHasMore] = useState(true);
  
  // Global states
  const [error, setError] = useState<string | null>(null);
  const [totalBrandCount, setTotalBrandCount] = useState(0);
  const [totalNoNameCount, setTotalNoNameCount] = useState(0);
  
  // Calculate stats
  const totalSavings = [...brandPurchases, ...noNamePurchases].reduce((sum, p) => sum + p.savings, 0);

  // Load brand purchases with pagination
  const loadBrandPurchases = useCallback(async (reset: boolean = false) => {
    if (!user?.uid) {
      setError('Benutzer nicht angemeldet');
      setBrandLoading(false);
      return;
    }

    // Don't load if already loading or no more items (unless reset)
    if ((brandLoadingMore || !brandHasMore) && !reset) return;

    try {
      setError(null);
      if (reset) {
        setBrandLoading(true);
        setBrandLastDoc(null);
      } else {
        setBrandLoadingMore(true);
      }

      const result = await purchaseHistoryService.getUserPurchaseHistoryPaginated(
        user.uid,
        20, // Page size - same as explore.tsx
        reset ? null : brandLastDoc,
        'markenprodukt' // Only brand products
      );

      if (reset) {
        setBrandPurchases(result.products);
      } else {
        setBrandPurchases(prev => [...prev, ...result.products]);
      }

      setBrandLastDoc(result.lastDoc);
      setBrandHasMore(result.hasMore);
    } catch (error) {
      console.error('Error loading brand purchases:', error);
      setError('Fehler beim Laden der Markenprodukte');
    } finally {
      setBrandLoading(false);
      setBrandLoadingMore(false);
    }
  }, [user?.uid, brandLoadingMore, brandHasMore, brandLastDoc]);

  // Load NoName purchases with pagination
  const loadNoNamePurchases = useCallback(async (reset: boolean = false) => {
    if (!user?.uid) {
      setError('Benutzer nicht angemeldet');
      setNoNameLoading(false);
      return;
    }

    // Don't load if already loading or no more items (unless reset)
    if ((noNameLoadingMore || !noNameHasMore) && !reset) return;

    try {
      setError(null);
      if (reset) {
        setNoNameLoading(true);
        setNoNameLastDoc(null);
      } else {
        setNoNameLoadingMore(true);
      }

      const result = await purchaseHistoryService.getUserPurchaseHistoryPaginated(
        user.uid,
        20, // Page size - same as explore.tsx
        reset ? null : noNameLastDoc,
        'noname' // Only NoName products
      );

      if (reset) {
        setNoNamePurchases(result.products);
      } else {
        setNoNamePurchases(prev => [...prev, ...result.products]);
      }

      setNoNameLastDoc(result.lastDoc);
      setNoNameHasMore(result.hasMore);
    } catch (error) {
      console.error('Error loading NoName purchases:', error);
      setError('Fehler beim Laden der NoName-Produkte');
    } finally {
      setNoNameLoading(false);
      setNoNameLoadingMore(false);
    }
  }, [user?.uid, noNameLoadingMore, noNameHasMore, noNameLastDoc]);

  // Load total counts
  const loadTotalCounts = useCallback(async () => {
    if (!user?.uid) return;

    try {
      const [brandCount, noNameCount] = await Promise.all([
        purchaseHistoryService.getUserPurchaseCount(user.uid, 'markenprodukt'),
        purchaseHistoryService.getUserPurchaseCount(user.uid, 'noname')
      ]);
      
      setTotalBrandCount(brandCount);
      setTotalNoNameCount(noNameCount);
    } catch (error) {
      console.error('Error loading total counts:', error);
    }
  }, [user?.uid]);

  // Refresh data (reset both tabs and counts)
  const refreshData = useCallback(async () => {
    await Promise.all([
      loadBrandPurchases(true),
      loadNoNamePurchases(true),
      loadTotalCounts()
    ]);
  }, [loadBrandPurchases, loadNoNamePurchases, loadTotalCounts]);

  // Initial load 
  useEffect(() => {
    if (!user?.uid) {
      setBrandLoading(false);
      setNoNameLoading(false);
      return;
    }

    // Load initial data for both tabs and total counts
    Promise.all([
      loadBrandPurchases(true),
      loadNoNamePurchases(true),
      loadTotalCounts()
    ]);
  }, [user?.uid]);

  return {
    // Data
    brandPurchases,
    noNamePurchases,
    
    // State - Brand
    brandLoading,
    brandLoadingMore,
    brandHasMore,
    
    // State - NoName
    noNameLoading,
    noNameLoadingMore,
    noNameHasMore,
    
    // Global State
    error,
    
    // Stats
    totalBrandCount,
    totalNoNameCount,
    totalSavings,
    
    // Actions
    loadBrandPurchases,
    loadNoNamePurchases,
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
