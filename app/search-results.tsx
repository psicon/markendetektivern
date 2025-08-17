import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { getStufenColor } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { getStackScreenHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { AlgoliaSearchResult, AlgoliaService } from '@/lib/services/algolia';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Image,
  PanResponder,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const { width: screenWidth } = Dimensions.get('window');

export default function SearchResultsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const params = useLocalSearchParams();
  
  // Search States
  const [searchQuery, setSearchQuery] = useState(params.query as string || '');
  const [activeTab, setActiveTab] = useState<'nonames' | 'markenprodukte'>('nonames');
  
  // Animation für Swipe-Navigation (kopiert von explore.tsx)
  const translateX = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);
  
  // Algolia Results States
  const [noNameResults, setNoNameResults] = useState<AlgoliaSearchResult[]>([]);
  const [markenproduktResults, setMarkenproduktResults] = useState<AlgoliaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Set header options like explore.tsx - grün ohne (tabs)
  useLayoutEffect(() => {
    router.setParams({});
  }, []);

  // Cache für Algolia lookups
  const [lookupCache, setLookupCache] = useState<Map<string, any>>(new Map());
  
  // Helper to get cached or fetch from Algolia
  const getCachedLookup = async (path: string): Promise<any> => {
    if (!path) return null;
    
    // Check cache first
    if (lookupCache.has(path)) {
      return lookupCache.get(path);
    }
    
    // Parse path and fetch from Algolia
    const [collection, id] = path.split('/');
    let result = null;
    
    try {
      // Direct Algolia search using filters
      const searchResult = await AlgoliaService.searchInIndex(collection, id);
      if (searchResult) {
        result = searchResult;
        console.log(`Loaded ${collection} for ${id}:`, result);
      }
    } catch (error) {
      console.error(`Failed to lookup ${path}:`, error);
    }
    
    // Cache the result
    if (result) {
      setLookupCache(prev => new Map(prev).set(path, result));
    }
    
    return result;
  };
  
  // Search function - load ALL results and populate from Algolia
  const performSearch = async (query: string) => {
    if (!query.trim()) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // Load ALL results by setting a high hitsPerPage
      const results = await AlgoliaService.searchAll(query.trim(), 0, 1000);
      
      // Populate references from Algolia
      const populatedNoName = await Promise.all(results.noNameResults.hits.map(async (product) => {
        const populated = { ...product };
        
        // Load handelsmarke from Algolia if it's a string reference
        if (product.handelsmarke && typeof product.handelsmarke === 'string') {
          const lookup = await getCachedLookup(product.handelsmarke);
          if (lookup) {
            populated.handelsmarke = lookup;
            console.log(`Set handelsmarke: ${lookup.bezeichnung} for product: ${product.name}`);
          }
        }
        
        // Load discounter from Algolia if it's a string reference
        if (product.discounter && typeof product.discounter === 'string') {
          const lookup = await getCachedLookup(product.discounter);
          if (lookup) {
            populated.discounter = lookup;
          }
        }
        
        return populated;
      }));
      
      const populatedMarken = await Promise.all(results.markenproduktResults.hits.map(async (product) => {
        const populated = { ...product };
        
        // Load hersteller from Algolia if it's a string reference
        if (product.hersteller && typeof product.hersteller === 'string') {
          const lookup = await getCachedLookup(product.hersteller);
          if (lookup) {
            populated.hersteller = lookup;
          }
        }
        
        return populated;
      }));
      
      setNoNameResults(populatedNoName);
      setMarkenproduktResults(populatedMarken);
      
    } catch (error) {
      console.error('Search error:', error);
      setError('Fehler bei der Suche. Bitte versuchen Sie es erneut.');
    } finally {
      setLoading(false);
    }
  };

  // Initial search
  useEffect(() => {
    if (searchQuery) {
      performSearch(searchQuery);
    }
  }, []);

  // Tab titles with result counts (exakt wie explore.tsx)
  const getTabTitle = (tabId: string) => {
    switch (tabId) {
      case 'nonames':
        return `NoName-\nProdukte${noNameResults.length > 0 ? ` (${noNameResults.length})` : ''}`;
      case 'markenprodukte':
        return `Marken-\nProdukte${markenproduktResults.length > 0 ? ` (${markenproduktResults.length})` : ''}`;
      default:
        return tabId;
    }
  };

  // Tab configuration (nur 2 Tabs)
  const tabs = [
    { id: 'nonames', title: 'NoName-\nProdukte', icon: 'star.fill' },
    { id: 'markenprodukte', title: 'Marken-\nProdukte', icon: 'heart.fill' },
  ];

  // Tab Order für Swipe Navigation
  const tabOrder = ['nonames', 'markenprodukte'];

  // Swipe Navigation (kopiert von explore.tsx)
  const switchToTab = (tabId: string) => {
    if (isAnimating.current) return;
    setActiveTab(tabId as 'nonames' | 'markenprodukte');
  };

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dx) > 20 && Math.abs(gestureState.dy) < 50;
    },
    onPanResponderMove: (_, gestureState) => {
      if (!isAnimating.current) {
        translateX.setValue(gestureState.dx);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (isAnimating.current) return;
      
      const threshold = screenWidth * 0.3;
      const currentIndex = tabOrder.indexOf(activeTab);
      let newIndex = currentIndex;
      
      if (gestureState.dx > threshold && currentIndex > 0) {
        newIndex = currentIndex - 1;
      } else if (gestureState.dx < -threshold && currentIndex < tabOrder.length - 1) {
        newIndex = currentIndex + 1;
      } else if (gestureState.dx > threshold && currentIndex === 0) {
        newIndex = tabOrder.length - 1;
      } else if (gestureState.dx < -threshold && currentIndex === tabOrder.length - 1) {
        newIndex = 0;
      }
      
      isAnimating.current = true;
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start(() => {
        isAnimating.current = false;
      });
      
      if (newIndex !== currentIndex) {
        setActiveTab(tabOrder[newIndex] as 'nonames' | 'markenprodukte');
      }
    },
  });

  // Render product item - EXAKT wie explore.tsx
  const renderProductItem = ({ item, index }: { item: AlgoliaSearchResult; index: number }) => {
    const isNoName = activeTab === 'nonames';
    const results = getCurrentResults();
    
    return (
      <View 
        style={[
          styles.productItemContainer,
          { backgroundColor: colors.cardBackground },
          index === 0 && styles.firstProductItem,
          index === results.length - 1 && styles.lastProductItem,
        ]}
      >
        <TouchableOpacity 
          style={[
            styles.productListItem,
            index < results.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 0.5 }
          ]}
          onPress={() => {
            if (isNoName) {
              const stufe = parseInt(item.stufe || '3') || 3;
              if (stufe <= 2) {
                router.push(`/noname-detail/${item.objectID}` as any);
              } else {
                router.push(`/product-comparison/${item.objectID}?type=noname` as any);
              }
            } else {
              // Markenprodukt: Direkt zur Produktvergleichsseite
              router.push(`/product-comparison/${item.objectID}?type=brand` as any);
            }
          }}
        >
          <View style={styles.productLogo}>
            {item.bild && item.bild.trim() !== '' && !failedImages.has(`product-${item.objectID}`) ? (
              <ImageWithShimmer
                source={{ uri: item.bild }}
                style={styles.productImage}
                fallbackIcon="cube.box"
                fallbackIconSize={32}
                resizeMode="contain"
                onError={() => {
                  console.log(`Failed to load image for product: ${item.name}`);
                  setFailedImages(prev => new Set([...prev, `product-${item.objectID}`]));
                }}
              />
            ) : (
              <View style={[styles.productImagePlaceholder, { backgroundColor: colors.background }]}>
                <IconSymbol name="cube.box" size={32} color={colors.primary} />
              </View>
            )}
          </View>

          <View style={styles.productContent}>
            <ThemedText style={styles.productTitle}>
              {item.name}
            </ThemedText>
            <ThemedText style={styles.productSubtitle}>
              {isNoName 
                ? (item.handelsmarke?.bezeichnung || 'Unbekannte Handelsmarke')
                : (item.hersteller?.name || 'Unbekannte Marke')
              }
            </ThemedText>
            {isNoName && item.discounter && (
              <View style={styles.productMarketRow}>
                {(typeof item.discounter === 'object' ? item.discounter.bild : null) && !failedImages.has(`market-${item.objectID}`) ? (
                  <Image 
                    source={{ uri: item.discounter.bild }} 
                    style={styles.productMarketImage}
                    onError={() => {
                      console.log(`Failed to load market image for product: ${item.name}`);
                      setFailedImages(prev => new Set([...prev, `market-${item.objectID}`]));
                    }}
                  />
                ) : (
                  <View style={[styles.productMarketImagePlaceholder, { backgroundColor: colors.background }]}>
                    <IconSymbol name="storefront" size={12} color={colors.icon} />
                  </View>
                )}
                <ThemedText style={styles.productMarket}>
                  {item.discounter?.name || 'Unbekannter Markt'}
                </ThemedText>
              </View>
            )}
          </View>

          <View style={styles.productRightSection}>
            <View style={styles.productInfoColumn}>
              {isNoName && item.stufe && (
                <View style={[styles.stufeBadge, { backgroundColor: getStufenColor(parseInt(item.stufe)) }]}>
                  <IconSymbol name="chart.bar" size={8} color="white" />
                  <ThemedText style={styles.stufeBadgeText}>{item.stufe}</ThemedText>
                </View>
              )}
              {item.preis && (
                <ThemedText style={styles.productPrice}>
                  {item.preis.toFixed(2)} €
                </ThemedText>
              )}
            </View>
            <View style={styles.productChevron}>
              <IconSymbol name="chevron.right" size={16} color={colors.icon} />
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // Get current results based on active tab
  const getCurrentResults = () => {
    return activeTab === 'nonames' ? noNameResults : markenproduktResults;
  };

  return (
    <>
      <Stack.Screen
        options={getStackScreenHeaderOptions(colorScheme, 'Suchergebnisse')}
      />
      
      <ThemedView style={styles.container} {...panResponder.panHandlers}>
        {/* Kompakte Search Header */}
        <View style={styles.searchHeader}>
          <View style={[styles.searchContainer, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <IconSymbol name="magnifyingglass" size={14} color={colors.icon} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Suchen..."
              placeholderTextColor={colors.icon}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => performSearch(searchQuery)}
              returnKeyType="search"
              autoFocus={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <IconSymbol name="xmark.circle.fill" size={14} color={colors.icon} />
              </TouchableOpacity>
            )}
          </View>
          
          <TouchableOpacity
            style={[styles.searchButton, { backgroundColor: colors.primary }]}
            onPress={() => performSearch(searchQuery)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <IconSymbol name="magnifyingglass" size={14} color="white" />
            )}
          </TouchableOpacity>
        </View>

        {/* Kompakte Tab Navigation */}
        <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground, borderBottomColor: colors.border }]}>
          <View style={[styles.tabScroll, { flexDirection: 'row' }]}>
            {tabs.map((tab) => (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.tab,
                  activeTab === tab.id && { borderBottomColor: colors.primary }
                ]}
                onPress={() => switchToTab(tab.id)}
              >
                <IconSymbol 
                  name={tab.icon as any} 
                  size={16} 
                  color={activeTab === tab.id ? colors.primary : colors.icon} 
                />
                <ThemedText 
                  style={[
                    styles.tabText,
                    { color: activeTab === tab.id ? colors.primary : colors.icon }
                  ]}
                >
                  {getTabTitle(tab.id)}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Results List */}
        <Animated.View style={[styles.contentContainer, { transform: [{ translateX }] }]}>
          {error ? (
            <View style={styles.errorContainer}>
              <ThemedText style={[styles.errorText, { color: colors.text }]}>{error}</ThemedText>
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: colors.primary }]}
                onPress={() => performSearch(searchQuery)}
              >
                <ThemedText style={styles.retryButtonText}>Erneut versuchen</ThemedText>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={getCurrentResults()}
              keyExtractor={(item, index) => `${item.objectID}-${index}`}
              renderItem={renderProductItem}
              contentContainerStyle={styles.productListContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={() => (
                <View style={styles.emptyContainer}>
                  {loading ? (
                    <>
                      <ActivityIndicator size="large" color={colors.primary} />
                      <ThemedText style={[styles.emptyText, { color: colors.text }]}>
                        Suche läuft...
                      </ThemedText>
                    </>
                  ) : (
                    <>
                      <IconSymbol name="magnifyingglass" size={48} color={colors.icon} />
                      <ThemedText style={[styles.emptyText, { color: colors.text }]}>
                        {searchQuery ? 'Keine Ergebnisse gefunden' : 'Geben Sie einen Suchbegriff ein'}
                      </ThemedText>
                    </>
                  )}
                </View>
              )}
            />
          )}
        </Animated.View>
      </ThemedView>
    </>
  );
}

// Styles exakt kopiert von explore.tsx
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  searchButton: {
    padding: 8,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    width: 36,
    height: 36,
  },
  tabContainer: {
    paddingTop: 8,
    borderBottomWidth: 1,
  },
  tabScroll: {
    paddingHorizontal: 8,
  },
  tab: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginRight: 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    minWidth: 50,
    flex: 1,
  },
  tabText: {
    fontSize: 9,
    fontFamily: 'Nunito_500Medium',
    marginTop: 1,
    textAlign: 'center',
    lineHeight: 10,
  },
  contentContainer: {
    flex: 1,
  },
  productListContent: {
    paddingBottom: 100,
  },
  // Product List Styles - exakt wie explore.tsx
  productItemContainer: {
    borderRadius: 16,
    marginBottom: 12,
    marginHorizontal: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    overflow: 'hidden',
  },
  productListItem: {
    flexDirection: 'row',
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    gap: 12,
  },
  firstProductItem: {
    marginTop: 8,
  },
  lastProductItem: {
    marginBottom: 0,
  },
  productLogo: {
    width: 70,
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productImage: {
    width: 70,
    height: 70,
    borderRadius: 8,
    resizeMode: 'contain',
  },
  productImagePlaceholder: {
    width: 70,
    height: 70,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productContent: {
    flex: 1,
    paddingTop: 2,
    paddingBottom: 2,
    paddingRight: 8,
  },
  productTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 18,
    marginBottom: 4,
  },
  productSubtitle: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.7,
    lineHeight: 14,
    marginBottom: 2,
  },
  productMarketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  productMarketImage: {
    width: 16,
    height: 16,
    borderRadius: 4,
    resizeMode: 'contain',
  },
  productMarketImagePlaceholder: {
    width: 16,
    height: 16,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productMarket: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.8,
    lineHeight: 14,
    flex: 1,
  },
  productRightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  productInfoColumn: {
    alignItems: 'center',
    gap: 4,
  },
  productPrice: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    color: '#22c55e',
    textAlign: 'center',
  },
  stufeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  stufeBadgeText: {
    color: 'white',
    fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
  },
  productChevron: {
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 64,
    gap: 16,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },
});