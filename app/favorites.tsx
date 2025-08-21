import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { CartToast } from '@/components/ui/CartToast';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { ShimmerSkeleton } from '@/components/ui/ShimmerSkeleton';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { FirestoreService } from '@/lib/services/firestore';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import PagerView from 'react-native-pager-view';

const { width } = Dimensions.get('window');

// Skeleton Loader EXAKT wie Einkaufszettel
const FavoritesSkeletonLoader = () => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const SkeletonItem = () => (
    <View style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
      <View style={styles.productContent}>
        <ShimmerSkeleton width={20} height={20} borderRadius={10} style={{ marginRight: 12 }} />
        <ShimmerSkeleton width={60} height={60} borderRadius={8} />
        <View style={styles.productInfo}>
          <ShimmerSkeleton width={120} height={14} />
          <ShimmerSkeleton width={200} height={16} style={{ marginTop: 4 }} />
          <View style={styles.marketInfo}>
            <ShimmerSkeleton width={16} height={16} borderRadius={2} />
            <ShimmerSkeleton width={80} height={12} />
          </View>
          <ShimmerSkeleton width={60} height={16} />
        </View>
        <View style={styles.productActions}>
          <ShimmerSkeleton width={32} height={32} borderRadius={16} />
          <ShimmerSkeleton width={32} height={32} borderRadius={16} style={{ marginTop: 6 }} />
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.productContainer}>
      {Array.from({ length: 6 }).map((_, index) => (
        <SkeletonItem key={index} />
      ))}
    </View>
  );
};

export default function FavoritesScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, userProfile } = useAuth();

  const { 
    favoritesWithData, 
    loading: favoritesLoading, 
    error, 
    loadFavoritesWithData, 
    removeFromFavorites 
  } = useFavorites();

  const [activeTab, setActiveTab] = useState<'brand' | 'noname'>('brand');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [brandFavorites, setBrandFavorites] = useState<any[]>([]);
  const [noNameFavorites, setNoNameFavorites] = useState<any[]>([]);
  const [availableMarkets, setAvailableMarkets] = useState<{id: string, name: string}[]>([]);
  
  // Tab Animation EXAKT wie Einkaufszettel
  const tabIndicatorPosition = useState(new Animated.Value(0))[0];
  const pagerRef = useRef<PagerView>(null);
  
  // Filter States EXAKT wie Einkaufszettel  
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    markets: [] as string[],
    sortBy: 'name' as 'name' | 'price' | 'newest'
  });
  
  // WICHTIG: Initial loading state um "Noch keine Favoriten" zu vermeiden
  const [initialLoading, setInitialLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  
  // Toast states ERWEITERT für Action-Toast
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [toastActionLabel, setToastActionLabel] = useState<string | undefined>(undefined);
  const [toastActionPress, setToastActionPress] = useState<(() => void) | undefined>(undefined);

  const showGameToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastActionLabel(undefined);
    setToastActionPress(undefined);
    setShowToast(true);
  };

  const showGameToastWithAction = (
    message: string, 
    type: 'success' | 'error' | 'info' = 'success'
  ) => {
    setToastMessage(message);
    setToastType(type);
    setToastActionLabel('Einkaufszettel');
    setToastActionPress(() => () => {
      router.push('/shopping-list' as any);
    });
    setShowToast(true);
  };

  // Header konfigurieren EXAKT wie Einkaufszettel
  useLayoutEffect(() => {
    navigation.setOptions({
      ...getNavigationHeaderOptions(colorScheme, 'Deine Lieblingsprodukte'),
      headerRight: () => (
        selectedProducts.length > 0 && (
          <TouchableOpacity
            onPress={handleBulkAddToCart}
            style={styles.headerButton}
            disabled={isAddingToCart}
          >
            <View style={[styles.headerBadge, { backgroundColor: colors.primary }]}>
              <IconSymbol name="cart.badge.plus" size={16} color="white" />
              <ThemedText style={styles.headerBadgeText}>
                {selectedProducts.length}
              </ThemedText>
            </View>
          </TouchableOpacity>
        )
      ),
    });
  }, [navigation, colorScheme, selectedProducts.length, isAddingToCart]);

  // Initial Load - NUR EINMAL und mit Loading State
  useEffect(() => {
    if (user?.uid && !hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      loadInitialData();
    }
  }, [user?.uid]);

  const loadInitialData = async () => {
    setInitialLoading(true);
    try {
      const data = await loadFavoritesWithData();
      
      // Trenne die Daten nach Typ EXAKT wie Einkaufszettel
      const brandProducts = data.filter((item: any) => item.type === 'markenprodukt');
      const noNameProducts = data.filter((item: any) => item.type === 'noname');
      
      setBrandFavorites(brandProducts);
      setNoNameFavorites(noNameProducts);
      
      // Extrahiere unique Markets für Filter aus allen Produkten
      const uniqueMarkets = new Map();
      data.forEach((item: any) => {
        if (item.discounter?.id && item.discounter?.name) {
          uniqueMarkets.set(item.discounter.id, {
            id: item.discounter.id,
            name: item.discounter.name
          });
        }
      });
      
      setAvailableMarkets(Array.from(uniqueMarkets.values()));
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  // Tab Change Handler EXAKT wie Einkaufszettel
  const handleTabChange = (tab: 'brand' | 'noname') => {
    if (tab === activeTab) return;

    const pageIndex = tab === 'brand' ? 0 : 1;
    setActiveTab(tab);
    
    // WICHTIG: Selektion beim Tab-Wechsel zurücksetzen
    setSelectedProducts([]);
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Animate tab indicator
    Animated.timing(tabIndicatorPosition, {
      toValue: tab === 'brand' ? 0 : width / 2,
      duration: 200,
      useNativeDriver: true
    }).start();
    
    // Switch PagerView page
    pagerRef.current?.setPage(pageIndex);
  };

  const handlePageSelected = (e: any) => {
    const position = e.nativeEvent.position;
    const newTab = position === 0 ? 'brand' : 'noname';
    
    if (newTab !== activeTab) {
      setActiveTab(newTab);
      
      // WICHTIG: Selektion beim Swipe zurücksetzen
      setSelectedProducts([]);
      
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      // Animate tab indicator
      Animated.timing(tabIndicatorPosition, {
        toValue: position === 0 ? 0 : width / 2,
        duration: 200,
        useNativeDriver: true
      }).start();
    }
  };

  // Filter Helper Function EXAKT wie Einkaufszettel
  const applyFiltersAndSorting = (products: any[]) => {
    let filtered = [...products];
    
    // Market Filter
    if (filters.markets.length > 0) {
      filtered = filtered.filter((item: any) => 
        filters.markets.includes(item.discounter?.id)
      );
    }
    
    // Sortierung
    filtered.sort((a, b) => {
      switch (filters.sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'price':
          return (a.preis || 0) - (b.preis || 0);
        case 'newest':
          const dateA = (a as any).addedAt ? new Date((a as any).addedAt).getTime() : 0;
          const dateB = (b as any).addedAt ? new Date((b as any).addedAt).getTime() : 0;
          return dateB - dateA;
        default:
          return 0;
      }
    });
    
    return filtered;
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    const data = await loadFavoritesWithData();
    
    // Trenne die Daten nach Typ
    const brandProducts = data.filter((item: any) => item.type === 'markenprodukt');
    const noNameProducts = data.filter((item: any) => item.type === 'noname');
    
    setBrandFavorites(brandProducts);
    setNoNameFavorites(noNameProducts);
    
    // Update available markets
    const uniqueMarkets = new Map();
    data.forEach((item: any) => {
      if (item.discounter?.id && item.discounter?.name) {
        uniqueMarkets.set(item.discounter.id, {
          id: item.discounter.id,
          name: item.discounter.name
        });
      }
    });
    setAvailableMarkets(Array.from(uniqueMarkets.values()));
    
    setRefreshing(false);
  };

  // Filter Functions EXAKT wie Einkaufszettel
  const toggleMarketFilter = (marketId: string) => {
    setFilters(prev => ({
      ...prev,
      markets: prev.markets.includes(marketId)
        ? prev.markets.filter(id => id !== marketId)
        : [...prev.markets, marketId]
    }));
  };

  const setSorting = (sortBy: 'name' | 'price' | 'newest') => {
    setFilters(prev => ({ ...prev, sortBy }));
  };

  const clearAllFilters = () => {
    setFilters({
      markets: [],
      sortBy: 'name'
    });
  };

  const getActiveFilterCount = () => {
    let count = 0;
    if (filters.markets.length > 0) count += filters.markets.length;
    if (filters.sortBy !== 'name') count += 1;
    return count;
  };

  const handleToggleSelect = (productId: string) => {
    setSelectedProducts(prev => 
      prev.includes(productId) 
        ? prev.filter(id => id !== productId)
        : [...prev, productId]
    );
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleToggleSelectAll = () => {
    const currentFiltered = getFilteredFavorites();
    if (selectedProducts.length === currentFiltered.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(currentFiltered.map(p => p.id));
    }
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleRemoveFavorite = async (product: any) => {
    try {
      // Optimistisch: Sofort aus dem richtigen Array entfernen
      if (product.type === 'markenprodukt') {
        setBrandFavorites(prev => prev.filter(p => p.id !== product.id));
      } else {
        setNoNameFavorites(prev => prev.filter(p => p.id !== product.id));
      }
      setSelectedProducts(prev => prev.filter(id => id !== product.id));
      
      await removeFromFavorites(product.id, product.type);
      
      showGameToast(`💔 ${product.name || product.produktName} aus Favoriten entfernt`, 'success');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error removing favorite:', error);
      showGameToast('Fehler beim Entfernen des Favoriten', 'error');
      // Bei Fehler: Reload
      loadInitialData();
    }
  };

  const handleProductPress = (product: any) => {
    if (product.type === 'markenprodukt') {
      router.push(`/product-comparison/${product.id}?type=brand` as any);
    } else {
      router.push(`/noname-detail/${product.id}` as any);
    }
  };

  const handleBulkAddToCart = async () => {
    if (!user?.uid || selectedProducts.length === 0) return;

    setIsAddingToCart(true);
    
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      
      const selectedFavorites = getFilteredFavorites().filter(p => selectedProducts.includes(p.id));
      let successCount = 0;
      let errorCount = 0;

      for (const product of selectedFavorites) {
        try {
          const isBrand = product.type === 'markenprodukt';
          const productName = product.name || product.produktName || 'Unbekanntes Produkt';
          await FirestoreService.addToShoppingCart(user.uid, product.id, productName, isBrand);
          successCount++;
        } catch (error) {
          console.error('Error adding to cart:', product.id, error);
          errorCount++;
        }
      }

      setSelectedProducts([]);

      if (errorCount === 0) {
        showGameToastWithAction(
          `🛒 ${successCount} ${successCount === 1 ? 'Produkt' : 'Produkte'} hinzugefügt!`,
          'success'
        );
      } else {
        showGameToast(
          `⚠️ ${successCount} hinzugefügt, ${errorCount} Fehler`,
          'info'
        );
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Error in bulk add to cart:', error);
      showGameToast('Fehler beim Hinzufügen zum Einkaufszettel', 'error');
    } finally {
      setIsAddingToCart(false);
    }
  };

  // Berechne Gesamtersparnis für aktiven Tab
  const getCurrentFavorites = () => {
    return activeTab === 'brand' ? brandFavorites : noNameFavorites;
  };

  const getFilteredFavorites = () => {
    return applyFiltersAndSorting(getCurrentFavorites());
  };

  const totalSavings = getFilteredFavorites().reduce((sum, item) => {
    const savings = typeof item.savings === 'number' ? item.savings : parseFloat(item.savings) || 0;
    return sum + savings;
  }, 0);

  // WICHTIG: Initial Loading zeigt NUR Skeleton, NICHT "Noch keine Favoriten"
  if (initialLoading) {
    return (
      <ThemedView style={styles.container}>
        <FavoritesSkeletonLoader />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {/* Tabs with integrated Summary EXAKT wie Einkaufszettel */}
      <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.tabButtons}>
          <TouchableOpacity style={styles.tab} onPress={() => handleTabChange('brand')}>
            <Text style={[styles.tabText, { color: activeTab === 'brand' ? colors.primary : colors.icon }]}>
              Marken ({brandFavorites.length})
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.tab} onPress={() => handleTabChange('noname')}>
            <Text style={[styles.tabText, { color: activeTab === 'noname' ? colors.primary : colors.icon }]}>
              NoNames ({noNameFavorites.length})
            </Text>
          </TouchableOpacity>
          
          <Animated.View
            style={[styles.tabIndicator, {
              backgroundColor: colors.primary,
              transform: [{ translateX: tabIndicatorPosition }]
            }]}
          />
        </View>

        {/* Sticky Summary Bar für aktiven Tab */}
        {getFilteredFavorites().length > 0 && (
          <LinearGradient
            colors={['rgba(66, 169, 104, 0.95)', 'rgba(52, 134, 82, 0.95)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.actionBarGradient}
          >
            <View style={styles.actionBarContent}>
              <View style={styles.actionBarLeft}>
                <ThemedText style={styles.actionBarTitle}>
                  {getFilteredFavorites().length} {activeTab === 'brand' ? 'Marken' : 'NoNames'}
                </ThemedText>
                <ThemedText style={styles.actionBarSubtitle}>
                  {selectedProducts.length > 0 
                    ? `${selectedProducts.length} ausgewählt` 
                    : totalSavings > 0 
                      ? `Ersparnis: €${totalSavings.toFixed(2)}`
                      : 'Zum Auswählen antippen'}
                </ThemedText>
              </View>
              
              <View style={styles.actionBarRight}>
                <TouchableOpacity 
                  style={styles.selectAllButton} 
                  onPress={handleToggleSelectAll}
                >
                  <IconSymbol 
                    name={selectedProducts.length === getFilteredFavorites().length ? "checkmark.square.fill" : "square"} 
                    size={18} 
                    color="white" 
                  />
                  <ThemedText style={styles.selectAllText}>
                    Alle
                  </ThemedText>
                </TouchableOpacity>
                
                {selectedProducts.length > 0 && (
                  <TouchableOpacity
                    style={styles.addToCartButton}
                    onPress={handleBulkAddToCart}
                    disabled={isAddingToCart}
                  >
                    <IconSymbol name="cart.badge.plus" size={16} color="white" />
                    <ThemedText style={styles.addToCartText}>
                      Hinzufügen
                    </ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </LinearGradient>
        )}
      </View>

      {/* PagerView für Swipeable Tabs EXAKT wie Einkaufszettel */}
      <PagerView 
        ref={pagerRef}
        style={styles.pagerView}
        initialPage={0}
        onPageSelected={handlePageSelected}
      >
        {/* Page 1: Brand Products */}
        <View key="brand" style={styles.pageContainer}>
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        {applyFiltersAndSorting(brandFavorites).length === 0 ? (
          <View style={styles.emptyState}>
            <IconSymbol name="heart" size={64} color={colors.icon} />
            <ThemedText style={styles.emptyText}>
              {brandFavorites.length > 0 
                ? 'Keine Markenprodukte für diese Filter' 
                : 'Noch keine Marken-Favoriten'}
            </ThemedText>
            <ThemedText style={styles.emptySubtext}>
              {brandFavorites.length > 0 
                ? 'Passe die Filter an oder entferne sie über den Filter-Button'
                : 'Tippe auf das ❤️ bei Markenprodukten um sie zu deinen Favoriten hinzuzufügen'}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.productContainer}>
            {applyFiltersAndSorting(brandFavorites).map((item) => {
              const isSelected = selectedProducts.includes(item.id);
              const savings = typeof item.savings === 'number' ? item.savings : parseFloat(item.savings) || 0;
              
              return (
                <TouchableOpacity 
                  key={item.id} 
                  style={[styles.productCard, { backgroundColor: colors.cardBackground }]}
                  onPress={() => handleToggleSelect(item.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.productContent}>
                    {/* Selection Checkbox EXAKT wie Einkaufszettel */}
                    <TouchableOpacity 
                      style={styles.selectionButton}
                      onPress={() => handleToggleSelect(item.id)}
                    >
                      <IconSymbol 
                        name={isSelected ? "checkmark.circle.fill" : "circle"} 
                        size={20} 
                        color={isSelected ? colors.primary : colors.icon} 
                      />
                    </TouchableOpacity>

                    {/* Product Image EXAKT wie Einkaufszettel */}
                    <ImageWithShimmer
                      source={{ uri: item.bild || '' }}
                      style={styles.productImage}
                      shimmerStyle={styles.productImage}
                    />

                                            {/* Product Info EXAKT wie Einkaufszettel */}
                        <View style={styles.productInfo}>
                          {/* MARKE mit Logo EXAKT wie im Einkaufszettel */}
                          {item.hersteller?.name && (
                            <View style={styles.brandRow}>
                              {item.hersteller?.bild && (
                                <ImageWithShimmer
                                  source={{ uri: item.hersteller.bild }}
                                  style={styles.brandLogo}
                                />
                              )}
                              <Text style={[styles.brandName, { color: colors.primary }]} numberOfLines={1}>
                                {item.hersteller.name}
                              </Text>
                            </View>
                          )}
                          

                          
                          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                            {item.name || item.produktName || 'Unbekanntes Produkt'}
                          </Text>
                          
                          {/* Discounter Info NUR für NoName-Produkte */}
                          {item.type === 'noname' && (
                            <View style={styles.marketInfo}>
                              {item.discounter?.bild ? (
                                <ImageWithShimmer 
                                  source={{ uri: item.discounter.bild }} 
                                  style={styles.marketLogo} 
                                />
                              ) : (
                                <View style={[styles.marketLogo, styles.marketLogoFallback, { backgroundColor: colors.border }]}>
                                  <IconSymbol name="storefront" size={8} color={colors.icon} />
                                </View>
                              )}
                              {userProfile?.favoriteMarket === item.discounter?.id && (
                                <IconSymbol name="heart.fill" size={10} color={colors.primary} style={styles.favoriteMarketIcon} />
                              )}
                              <Text style={[styles.marketName, { color: colors.icon }]} numberOfLines={1}>
                                {item.discounter?.name || 'Unbekannt'}
                                {item.discounter?.land && ` (${item.discounter.land})`}
                              </Text>
                            </View>
                          )}

                      {/* Preis mit Ersparnis EXAKT wie Einkaufszettel */}
                      <Text style={[styles.productPrice, { color: colors.primary }]}>
                        €{item.preis?.toFixed(2) || '0.00'}
                        {savings > 0 && (
                          <Text style={[styles.savingsInline, { color: colors.primary }]}>
                            {' '}(- €{savings.toFixed(2)})
                          </Text>
                        )}
                      </Text>
                    </View>

                    {/* Action Button - NUR LÖSCHEN */}
                    <View style={styles.productActions}>
                      <TouchableOpacity 
                        style={[styles.actionButton, { backgroundColor: colors.error }]}
                        onPress={(e) => {
                          e.stopPropagation();
                          handleRemoveFavorite(item);
                        }}
                      >
                        <IconSymbol name="trash" size={20} color="white" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
        </View>

        {/* Page 2: NoName Products */}
        <View key="noname" style={styles.pageContainer}>
          <ScrollView 
            style={styles.scrollView}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
            }
            showsVerticalScrollIndicator={false}
          >
            {applyFiltersAndSorting(noNameFavorites).length === 0 ? (
              <View style={styles.emptyState}>
                <IconSymbol name="heart" size={64} color={colors.icon} />
                <ThemedText style={styles.emptyText}>
                  {noNameFavorites.length > 0 
                    ? 'Keine NoName-Produkte für diese Filter' 
                    : 'Noch keine NoName-Favoriten'}
                </ThemedText>
                <ThemedText style={styles.emptySubtext}>
                  {noNameFavorites.length > 0 
                    ? 'Passe die Filter an oder entferne sie über den Filter-Button'
                    : 'Tippe auf das ❤️ bei NoName-Produkten um sie zu deinen Favoriten hinzuzufügen'}
                </ThemedText>
              </View>
            ) : (
              <View style={styles.productContainer}>
                {applyFiltersAndSorting(noNameFavorites).map((item) => {
                  const isSelected = selectedProducts.includes(item.id);
                  const savings = typeof item.savings === 'number' ? item.savings : parseFloat(item.savings) || 0;
                  
                  return (
                    <TouchableOpacity 
                      key={item.id} 
                      style={[styles.productCard, { backgroundColor: colors.cardBackground }]}
                      onPress={() => handleToggleSelect(item.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.productContent}>
                        {/* Selection Checkbox EXAKT wie Einkaufszettel */}
                        <TouchableOpacity 
                          style={styles.selectionButton}
                          onPress={() => handleToggleSelect(item.id)}
                        >
                          <IconSymbol 
                            name={isSelected ? "checkmark.circle.fill" : "circle"} 
                            size={20} 
                            color={isSelected ? colors.primary : colors.icon} 
                          />
                        </TouchableOpacity>

                        {/* Product Image EXAKT wie Einkaufszettel */}
                        <ImageWithShimmer
                          source={{ uri: item.bild || '' }}
                          style={styles.productImage}
                          shimmerStyle={styles.productImage}
                        />

                        {/* Product Info für NoName-Produkte */}
                        <View style={styles.productInfo}>
                          {/* HANDELSMARKE über Produktname (OHNE Bild wie im Original) */}
                          {item.handelsmarke?.bezeichnung && (
                            <Text style={[styles.brandName, { color: colors.primary }]} numberOfLines={1}>
                              {item.handelsmarke.bezeichnung}
                            </Text>
                          )}
                          
                          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                            {item.name || item.produktName || 'Unbekanntes Produkt'}
                          </Text>
                          
                          {/* Discounter Info */}
                          <View style={styles.marketInfo}>
                            {item.discounter?.bild ? (
                              <ImageWithShimmer 
                                source={{ uri: item.discounter.bild }} 
                                style={styles.marketLogo} 
                              />
                            ) : (
                              <View style={[styles.marketLogo, styles.marketLogoFallback, { backgroundColor: colors.border }]}>
                                <IconSymbol name="storefront" size={8} color={colors.icon} />
                              </View>
                            )}
                            {userProfile?.favoriteMarket === item.discounter?.id && (
                              <IconSymbol name="heart.fill" size={10} color={colors.primary} style={styles.favoriteMarketIcon} />
                            )}
                            <Text style={[styles.marketName, { color: colors.icon }]} numberOfLines={1}>
                              {item.discounter?.name || 'Unbekannt'}
                              {item.discounter?.land && ` (${item.discounter.land})`}
                            </Text>
                          </View>

                          {/* Preis mit Ersparnis EXAKT wie Einkaufszettel */}
                          <Text style={[styles.productPrice, { color: colors.primary }]}>
                            €{item.preis?.toFixed(2) || '0.00'}
                            {savings > 0 && (
                              <Text style={[styles.savingsInline, { color: colors.primary }]}>
                                {' '}(- €{savings.toFixed(2)})
                              </Text>
                            )}
                          </Text>
                        </View>

                        {/* Action Button - NUR LÖSCHEN */}
                        <View style={styles.productActions}>
                          <TouchableOpacity 
                            style={[styles.actionButton, { backgroundColor: colors.error }]}
                            onPress={(e) => {
                              e.stopPropagation();
                              handleRemoveFavorite(item);
                            }}
                          >
                            <IconSymbol name="trash" size={20} color="white" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      </PagerView>

      {/* Floating Filter Button EXAKT wie Einkaufszettel */}
      {(brandFavorites.length > 0 || noNameFavorites.length > 0) && (
        <TouchableOpacity 
          style={[styles.filterFab, { backgroundColor: colors.primary }]}
          onPress={() => setShowFilterModal(true)}
        >
          <IconSymbol name="line.horizontal.3.decrease" size={24} color="white" />
          {getActiveFilterCount() > 0 && (
            <View style={[styles.filterBadge, { backgroundColor: colors.error }]}>
              <Text style={styles.filterBadgeText}>
                {getActiveFilterCount()}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Filter Modal EXAKT wie Einkaufszettel */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={[styles.filterModalContainer, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={styles.filterModalHeader}>
            <View style={styles.handleContainer}>
              <View style={[styles.handle, { backgroundColor: colors.icon }]} />
            </View>
            <View style={styles.headerRow}>
              <TouchableOpacity 
                style={styles.closeButtonLeft}
                onPress={() => setShowFilterModal(false)}
              >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
              </TouchableOpacity>
              <View style={styles.titleSection}>
                <Text style={[styles.filterModalTitle, { color: colors.text }]}>
                  Filter & Sortierung
                </Text>
              </View>
              <TouchableOpacity 
                style={styles.clearAllButton}
                onPress={clearAllFilters}
              >
                <Text style={[styles.clearAllText, { color: colors.primary }]}>
                  Zurücksetzen
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <ScrollView style={styles.filterOptions}>
            {/* Sortierung */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>
                Sortierung
              </Text>
              <View style={styles.sortingOptions}>
                {[
                  { key: 'name', label: 'Name A-Z', icon: 'textformat.abc' },
                  { key: 'price', label: 'Preis aufsteigend', icon: 'eurosign' },
                  { key: 'newest', label: 'Zuletzt hinzugefügt', icon: 'clock' }
                ].map(option => (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.sortingOption,
                      { 
                        backgroundColor: filters.sortBy === option.key ? colors.primary : 'transparent',
                        borderColor: filters.sortBy === option.key ? colors.primary : colors.border
                      }
                    ]}
                    onPress={() => setSorting(option.key as any)}
                  >
                    <IconSymbol 
                      name={option.icon as any} 
                      size={16} 
                      color={filters.sortBy === option.key ? 'white' : colors.icon} 
                    />
                    <Text style={[
                      styles.sortingOptionText,
                      { color: filters.sortBy === option.key ? 'white' : colors.text }
                    ]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Märkte */}
            {availableMarkets.length > 0 && (
              <View style={styles.filterSection}>
                <Text style={[styles.filterSectionTitle, { color: colors.text }]}>
                  Märkte ({availableMarkets.length})
                </Text>
                <View style={styles.chipsContainer}>
                  {availableMarkets.map(market => (
                    <TouchableOpacity
                      key={market.id}
                      style={[
                        styles.filterChip,
                        { 
                          backgroundColor: filters.markets.includes(market.id) ? colors.primary : 'transparent',
                          borderColor: filters.markets.includes(market.id) ? colors.primary : colors.border
                        }
                      ]}
                      onPress={() => toggleMarketFilter(market.id)}
                    >
                      <IconSymbol 
                        name="storefront" 
                        size={16} 
                        color={filters.markets.includes(market.id) ? 'white' : colors.icon} 
                      />
                      <Text style={[
                        styles.chipText,
                        { color: filters.markets.includes(market.id) ? 'white' : colors.text }
                      ]}>
                        {market.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Toast ERWEITERT mit Action-Button */}
      <CartToast
        visible={showToast}
        message={toastMessage}
        type={toastType}
        actionLabel={toastActionLabel}
        onActionPress={toastActionPress}
        onHide={() => {
          setShowToast(false);
          setToastActionLabel(undefined);
          setToastActionPress(undefined);
        }}
      />
    </ThemedView>
  );
}

// Styles EXAKT übernommen aus shopping-list.tsx
const styles = StyleSheet.create({
  container: { 
    flex: 1 
  },
  scrollView: { 
    flex: 1 
  },

  // Floating Filter Button EXAKT wie Einkaufszettel
  filterFab: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
    lineHeight: 12,
  },
  
  // Filter Modal EXAKT wie Einkaufszettel
  filterModalContainer: {
    flex: 1,
    paddingTop: 20,
  },
  filterModalHeader: {
    paddingBottom: 20,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  closeButtonLeft: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  titleSection: {
    flex: 1,
    alignItems: 'center',
  },
  filterModalTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
  },
  clearAllButton: {
    alignItems: 'flex-end',
    width: 80,
  },
  clearAllText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  filterOptions: {
    flex: 1,
    paddingHorizontal: 20,
  },
  filterSection: {
    marginBottom: 24,
  },
  filterSectionTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 12,
  },
  sortingOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sortingOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  sortingOptionText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  chipText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
  },

  // Action Bar EXAKT wie Einkaufszettel Summary
  actionBarContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  actionBarGradient: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  actionBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionBarLeft: {
    flex: 1,
  },
  actionBarTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  actionBarSubtitle: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255,255,255,0.8)',
  },
  actionBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  selectAllText: {
    color: 'white',
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  addToCartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  addToCartText: {
    color: 'white',
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },

  // Header Badge
  headerButton: {
    marginRight: 16,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  headerBadgeText: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },

  // Product List EXAKT wie Einkaufszettel
  productContainer: { 
    padding: 16 
  },
  productCard: {
    marginBottom: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  productContent: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'center',
  },
  selectionButton: {
    marginRight: 12,
    padding: 4,
  },
  productImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    marginTop: 2,
    gap: 6,
  },
  brandLogo: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  brandName: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
  },
  productName: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
  },
  marketInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  marketLogo: {
    width: 16,
    height: 16,
    borderRadius: 2,
    marginRight: 6,
  },
  marketLogoFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoriteMarketIcon: {
    marginRight: 4,
  },
  marketName: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
    flex: 1,
  },
  productPrice: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  savingsInline: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
  },
  productActions: {
    flexDirection: 'column',
    gap: 6,
    marginLeft: 8,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Empty State EXAKT wie Einkaufszettel
  emptyState: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  emptyText: { 
    fontSize: 16, 
    fontFamily: 'Nunito_600SemiBold', 
    marginTop: 16, 
    textAlign: 'center' 
  },
  emptySubtext: { 
    fontSize: 14, 
    fontFamily: 'Nunito_400Regular', 
    marginTop: 8, 
    textAlign: 'center', 
    paddingHorizontal: 32,
  },

  // Tab System EXAKT wie Einkaufszettel
  tabContainer: {
    backgroundColor: 'transparent',
    paddingBottom: 0,
  },
  tabButtons: {
    flexDirection: 'row',
    position: 'relative',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'center',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    width: width / 2,
    borderRadius: 1.5,
  },

  // PagerView EXAKT wie Einkaufszettel
  pagerView: {
    flex: 1,
  },
  pageContainer: {
    flex: 1,
  },
});