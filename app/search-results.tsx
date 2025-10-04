import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { LockedCategoryModal } from '@/components/ui/LockedCategoryModal';
import { getStufenColor } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { getStackScreenHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { achievementService } from '@/lib/services/achievementService';
import { AlgoliaSearchResult, AlgoliaService } from '@/lib/services/algolia';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    FlatList,
    Image,
    Modal,
    PanResponder,
    Platform,
    ScrollView,
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
  const { user, userProfile } = useAuth();
  const { isPremium } = useRevenueCat();
  const analytics = useAnalytics();
  
  // 🎯 Journey-Tracking für Search
  useEffect(() => {
    const searchQuery = params.query as string || '';
    
    // Starte Journey wenn noch keine läuft (z.B. wenn App neu geöffnet wurde)
    // Dies wird von AnalyticsProvider gehandhabt, aber wir müssen die searchQuery setzen
    analytics.updateJourneyFilters({
      searchQuery
    }, {
      action: 'added',
      filterType: 'search',
      filterValue: searchQuery
    });
  }, [params.query, analytics]);
  
  // Search States
  const [searchQuery, setSearchQuery] = useState(params.query as string || '');
  const [activeTab, setActiveTab] = useState<'nonames' | 'markenprodukte'>('nonames');
  
  // Minimum Zeichen Warnung
  const [showMinCharWarning, setShowMinCharWarning] = useState(false);
  

  
  // Filter States (EXAKT wie explore.tsx)
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [kategorien, setKategorien] = useState<any[]>([]);
  const [discounter, setDiscounter] = useState<any[]>([]);
  const [selectedCountry, setSelectedCountry] = useState('Deutschland');
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  
  // NoName Filter States - EXAKT wie explore.tsx
  const [noNameFilters, setNoNameFilters] = useState<{
    categoryFilters: string[];
    discounterFilters: string[];
    stufeFilters: number[];
    priceMin?: number;
    priceMax?: number;
    markeFilter?: string;
  }>({
    categoryFilters: [],
    discounterFilters: [],
    stufeFilters: []
  });
  
  // Markenprodukte Filter States - EXAKT wie explore.tsx
  const [markenproduktFilters, setMarkenproduktFilters] = useState<{
    categoryFilters: string[];
    herstellerFilters: string[];
    priceMin?: number;
    priceMax?: number;
  }>({
    categoryFilters: [],
    herstellerFilters: []
  });
  
  // Marken-Suche States
  const [markenSearchQuery, setMarkenSearchQuery] = useState('');
  const [markenData, setMarkenData] = useState<any[]>([]);
  
  // Locked Category Modal State
  const [lockedCategoryModal, setLockedCategoryModal] = useState<{
    visible: boolean;
    category: any | null;
  }>({ visible: false, category: null });
  
  // Animation für Swipe-Navigation (kopiert von explore.tsx)
  const translateX = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);
  const searchInputRef = useRef<TextInput>(null);
  
  // Algolia Results States
  const [noNameResults, setNoNameResults] = useState<AlgoliaSearchResult[]>([]);
  const [markenproduktResults, setMarkenproduktResults] = useState<AlgoliaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  
  // Validierung für Mindestzeichen
  const validateAndSearch = async (query: string) => {
    const trimmedQuery = query.trim();
    
    if (trimmedQuery.length < 3) {
      // Zeige Warnung
      setShowMinCharWarning(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      
      // Verstecke Warnung nach 3 Sekunden
      setTimeout(() => {
        setShowMinCharWarning(false);
      }, 3000);
      
      return;
    }
    
    // Verstecke Warnung falls sichtbar
    setShowMinCharWarning(false);
    
    // Starte Suche
    await performSearch(trimmedQuery);
  };
  
  // Search function - load ALL results and populate from Algolia
  const performSearch = async (query: string) => {
    if (!query.trim()) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // GA4 Event: Search started
      analytics.trackCustomEvent('search_started', {
        screen_name: 'search_results',
        search_query: query.trim(),
        active_tab: activeTab
      });
      
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
      
      // GA4 Event: Search completed
      analytics.trackCustomEvent('search_completed', {
        screen_name: 'search_results',
        search_query: query.trim(),
        results_found: populatedNoName.length + populatedMarken.length,
        noname_results: populatedNoName.length,
        marken_results: populatedMarken.length,
        active_tab: activeTab
      });
      
      // 🎯 TRACK ACTION: search_product (für Gamification)
      if (user?.uid) {
        // 🚀 PERFORMANCE: Achievement Non-Blocking
        achievementService.trackAction(user.uid, 'search_product', {
          searchTerm: query.trim(),
          resultsFound: populatedNoName.length + populatedMarken.length,
          noNameResults: populatedNoName.length,
          markenResults: populatedMarken.length
        }).then(() => {
          console.log('✅ Action tracked: search_product');
        }).catch(error => {
          console.error('❌ Search Achievement Tracking Fehler:', error);
        });
      }
      
    } catch (error) {
      console.error('Search error:', error);
      setError('Fehler bei der Suche. Bitte versuchen Sie es erneut.');
    } finally {
      setLoading(false);
    }
  };



  // Helper Functions - EXAKT wie explore.tsx
  const normalizeCountry = (country: string): string => {
    const countryMap: {[key: string]: string} = {
      'DE': 'Deutschland',
      'Germany': 'Deutschland', 
      'CH': 'Schweiz',
      'Switzerland': 'Schweiz',
      'AT': 'Österreich',
      'Austria': 'Österreich'
    };
    return countryMap[country] || country;
  };

  // Get available countries from markets
  const availableCountries = React.useMemo(() => {
    const uniqueCountries = new Set(
      discounter.map(market => normalizeCountry(market.land))
    );
    return ['Alle Länder', ...Array.from(uniqueCountries).sort()];
  }, [discounter]);

  // Filter markets by selected country - EXAKT wie explore.tsx
  const filteredMarkets = React.useMemo(() => {
    if (selectedCountry === 'Alle Länder') {
      return discounter;
    }
    return discounter.filter(market => normalizeCountry(market.land) === selectedCountry);
  }, [discounter, selectedCountry]);

  // Icon-Mapping für Kategorien - EXAKT wie explore.tsx
  const getCategoryIcon = (bezeichnung: string): any => {
    const iconMap: {[key: string]: any} = {
      'alkohol': 'wineglass',
      'alkoholfreie getränke': 'cup.and.saucer',
      'backwaren': 'birthday.cake',
      'fertigteig': 'birthday.cake',
      'butter': 'drop.fill',
      'margarine': 'drop.fill',
      'fleisch': 'fork.knife',
      'wurst': 'fork.knife',
      'fisch': 'fish',
      'milchprodukte': 'drop',
      'käse': 'square.grid.2x2',
      'joghurt': 'cup.and.saucer',
      'desserts': 'birthday.cake',
      'süßigkeiten': 'heart.fill',
      'knabberwaren': 'heart.fill',
      'getränke': 'cup.and.saucer',
      'tiefkühlprodukte': 'snowflake',
      'baby': 'heart',
      'haustier': 'heart',
      'drogerie': 'sparkles',
      'haushalt': 'house',
      'gewürze': 'leaf',
      'veggie': 'leaf.fill',
      'vegan': 'leaf.fill'
    };
    
    const key = bezeichnung.toLowerCase();
    for (const [searchKey, icon] of Object.entries(iconMap)) {
      if (key.includes(searchKey)) {
        return icon;
      }
    }
    return 'square.grid.2x2'; // Default icon
  };

  // Load filter options (explore.tsx Logic)
  const loadFilterOptions = useCallback(async () => {
    try {
      const userLevel = (userProfile as any)?.stats?.currentLevel || (userProfile as any)?.level || 1;
      
      const [kategorienWithAccess, discounterData, markenDataRaw] = await Promise.all([
        categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium),
        import('@/lib/services/firestore').then(m => m.FirestoreService.getDiscounter()),
        import('@/lib/services/firestore').then(m => m.FirestoreService.getMarken())
      ]);
      
      setKategorien(kategorienWithAccess);
      setDiscounter(discounterData);
      setMarkenData(markenDataRaw);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  }, [userProfile?.stats?.currentLevel, userProfile?.level]); // 🎯 NUR bei Level-Änderung neu laden!



  // Filter functions - EXAKT wie explore.tsx
  const toggleCategoryFilter = (categoryId: string) => {
    const category = kategorien.find(k => k.id === categoryId);
    if (category?.isLocked) {
      setLockedCategoryModal({ visible: true, category });
      return;
    }
    
    const isAdding = !noNameFilters.categoryFilters.includes(categoryId);
    
    setNoNameFilters(prev => ({
      ...prev,
      categoryFilters: prev.categoryFilters.includes(categoryId)
        ? prev.categoryFilters.filter(id => id !== categoryId)
        : [...prev.categoryFilters, categoryId]
    }));
    
    // Track Filter Change und Update Journey
    if (category) {
      analytics.trackFilterChanged(
        'category',
        category.bezeichnung,
        isAdding ? 'added' : 'removed',
        'search_results'
      );
      
      // Update Journey mit allen aktuellen Filtern
      const updatedCategories = isAdding 
        ? [...noNameFilters.categoryFilters, categoryId]
        : noNameFilters.categoryFilters.filter(id => id !== categoryId);
        
      analytics.updateJourneyFilters({
        searchQuery,
        markets: noNameFilters.discounterFilters.map(id => {
          const marketData = discounter.find(d => d.id === id);
          return {
            id,
            name: marketData?.name || 'Unbekannt',
            docRef: `discounter/${id}`
          };
        }),
        categories: updatedCategories.map(id => {
          const categoryData = kategorien.find(c => c.id === id);
          return {
            id,
            name: categoryData?.bezeichnung || 'Unbekannt',
            docRef: `kategorien/${id}`
          };
        }),
        stufe: noNameFilters.stufeFilters
      }, {
        action: isAdding ? 'added' : 'removed',
        filterType: 'category',
        filterValue: category.bezeichnung
      });
    }
  };

  const toggleDiscounterFilter = (discounterId: string) => {
    const isAdding = !noNameFilters.discounterFilters.includes(discounterId);
    const market = discounter.find(d => d.id === discounterId);
    
    setNoNameFilters(prev => ({
      ...prev,
      discounterFilters: prev.discounterFilters.includes(discounterId)
        ? prev.discounterFilters.filter(id => id !== discounterId)
        : [...prev.discounterFilters, discounterId]
    }));
    
    // Track Filter Change und Update Journey
    if (market) {
      analytics.trackFilterChanged(
        'market',
        market.name,
        isAdding ? 'added' : 'removed',
        'search_results'
      );
      
      // Update Journey mit allen aktuellen Filtern
      const updatedMarkets = isAdding 
        ? [...noNameFilters.discounterFilters, discounterId]
        : noNameFilters.discounterFilters.filter(id => id !== discounterId);
        
      analytics.updateJourneyFilters({
        searchQuery,
        markets: updatedMarkets.map(id => {
          const marketData = discounter.find(d => d.id === id);
          return {
            id,
            name: marketData?.name || 'Unbekannt',
            docRef: `discounter/${id}`
          };
        }),
        categories: noNameFilters.categoryFilters.map(id => {
          const categoryData = kategorien.find(c => c.id === id);
          return {
            id,
            name: categoryData?.bezeichnung || 'Unbekannt',
            docRef: `kategorien/${id}`
          };
        }),
        stufe: noNameFilters.stufeFilters
      }, {
        action: isAdding ? 'added' : 'removed',
        filterType: 'market',
        filterValue: market.name
      });
    }
  };

  const toggleStufeFilter = (stufe: number) => {
    const isAdding = !noNameFilters.stufeFilters.includes(stufe);
    
    setNoNameFilters(prev => ({
      ...prev,
      stufeFilters: prev.stufeFilters.includes(stufe)
        ? prev.stufeFilters.filter(s => s !== stufe)
        : [...prev.stufeFilters, stufe]
    }));
    
    // Track Filter Change und Update Journey
    analytics.trackFilterChanged(
      'price', // Stufe ist ein Preis-Filter
      `Stufe ${stufe}`,
      isAdding ? 'added' : 'removed',
      'search_results'
    );
    
    // Update Journey mit allen aktuellen Filtern
    const updatedStufe = isAdding 
      ? [...noNameFilters.stufeFilters, stufe]
      : noNameFilters.stufeFilters.filter(s => s !== stufe);
      
    analytics.updateJourneyFilters({
      searchQuery,
      markets: noNameFilters.discounterFilters.map(id => {
        const marketData = discounter.find(d => d.id === id);
        return {
          id,
          name: marketData?.name || 'Unbekannt',
          docRef: `discounter/${id}`
        };
      }),
      categories: noNameFilters.categoryFilters.map(id => {
        const categoryData = kategorien.find(c => c.id === id);
        return {
          id,
          name: categoryData?.bezeichnung || 'Unbekannt',
          docRef: `kategorien/${id}`
        };
      }),
      stufe: updatedStufe
    }, {
      action: isAdding ? 'added' : 'removed',
      filterType: 'price',
      filterValue: `Stufe ${stufe}`
    });
  };

  // Markenprodukte Filter functions
  const toggleMarkenproduktCategoryFilter = (categoryId: string) => {
    const category = kategorien.find(k => k.id === categoryId);
    if (category?.isLocked) {
      setLockedCategoryModal({ visible: true, category });
      return;
    }
    
    setMarkenproduktFilters(prev => ({
      ...prev,
      categoryFilters: prev.categoryFilters.includes(categoryId)
        ? prev.categoryFilters.filter(id => id !== categoryId)
        : [...prev.categoryFilters, categoryId]
    }));
  };

  const toggleMarkenproduktHerstellerFilter = (herstellerId: string) => {
    setMarkenproduktFilters(prev => ({
      ...prev,
      herstellerFilters: prev.herstellerFilters.includes(herstellerId)
        ? prev.herstellerFilters.filter(id => id !== herstellerId)
        : [...prev.herstellerFilters, herstellerId]
    }));
  };

  const clearAllFilters = () => {
    setNoNameFilters({
      categoryFilters: [],
      discounterFilters: [],
      stufeFilters: []
    });
  };

  const clearAllMarkenproduktFilters = () => {
    setMarkenproduktFilters({
      categoryFilters: [],
      herstellerFilters: []
    });
  };

  // Get active filters count for badge
  const getActiveFiltersCount = () => {
    if (activeTab === 'nonames') {
      return noNameFilters.categoryFilters.length + 
             noNameFilters.discounterFilters.length + 
             noNameFilters.stufeFilters.length;
    } else {
      return markenproduktFilters.categoryFilters.length + 
             markenproduktFilters.herstellerFilters.length;
    }
  };

  // Filtered and sorted marken for search
  const filteredAndSortedMarken = React.useMemo(() => {
    let filtered = markenData;
    
    if (markenSearchQuery.trim()) {
      const query = markenSearchQuery.toLowerCase().trim();
      filtered = filtered.filter(marke => 
        marke.name.toLowerCase().includes(query)
      );
    }
    
    // KEINE Sortierung - behalte Algolia Relevanz-Reihenfolge
    return filtered;
  }, [markenData, markenSearchQuery]);



  // Load data on mount (nur einmal ausführen!)
  useEffect(() => {
    loadFilterOptions();
    
    if (searchQuery) {
      performSearch(searchQuery);
    }
  }, []); // KEINE Dependencies - nur beim Mount

  // Filter options neu laden wenn userProfile sich ändert
  useEffect(() => {
    if (userProfile) {
      loadFilterOptions();
    }
  }, [userProfile?.stats?.currentLevel, userProfile?.level]); // 🎯 NUR bei Level-Änderung neu laden!

  // Tab titles with FILTERED result counts
  const getTabTitle = (tabId: string) => {
    // Berechne gefilterte Counts für beide Tabs
    const filteredNoName = getFilteredResults('nonames').length;
    const filteredMarken = getFilteredResults('markenprodukte').length;
    
    switch (tabId) {
      case 'nonames':
        return `NoName-\nProdukte${filteredNoName > 0 ? ` (${filteredNoName})` : ''}`;
      case 'markenprodukte':
        return `Marken-\nProdukte${filteredMarken > 0 ? ` (${filteredMarken})` : ''}`;
      default:
        return tabId;
    }
  };

  // Helper für gefilterte Ergebnisse pro Tab - NEUE LOGIK basierend auf activeTab
  const getFilteredResults = (forTab?: string) => {
    const currentTab = forTab || activeTab;
    const sourceResults = currentTab === 'nonames' ? noNameResults : markenproduktResults;
    const currentFilters = currentTab === 'nonames' ? noNameFilters : markenproduktFilters;
    
    let filtered = [...sourceResults];

    // Apply category filters
    if (currentFilters.categoryFilters.length > 0) {
      filtered = filtered.filter(item => {
        const kategorie = item.kategorie as any;
        const itemCategoryId = typeof kategorie === 'string' 
          ? kategorie.split('/').pop() 
          : kategorie?.id || kategorie?.bezeichnung || kategorie;
        return itemCategoryId && currentFilters.categoryFilters.includes(itemCategoryId);
      });
    }

    // Apply NoName-spezifische Filter
    if (currentTab === 'nonames') {
      const filters = currentFilters as typeof noNameFilters;
      
      // Apply discounter filters  
      if (filters.discounterFilters.length > 0) {
        filtered = filtered.filter(item => {
          const discounter = item.discounter as any;
          const itemMarketId = typeof discounter === 'string'
            ? discounter.split('/').pop()
            : discounter?.id || discounter?.name || discounter;
          return itemMarketId && filters.discounterFilters.includes(itemMarketId);
        });
      }

      // Apply stufe filters
      if (filters.stufeFilters.length > 0) {
        filtered = filtered.filter(item => {
          const stufe = parseInt(item.stufe || '3') || 3;
          return filters.stufeFilters.includes(stufe);
        });
      }
    }

    // Apply Marken-spezifische Filter
    if (currentTab === 'markenprodukte') {
      const filters = currentFilters as typeof markenproduktFilters;
      
      // Apply hersteller filters
      if (filters.herstellerFilters.length > 0) {
        filtered = filtered.filter(item => {
          const hersteller = item.hersteller as any;
          const itemHerstellerId = typeof hersteller === 'string'
            ? hersteller.split('/').pop()
            : hersteller?.id || hersteller?.name || hersteller;
          return itemHerstellerId && filters.herstellerFilters.includes(itemHerstellerId);
        });
      }
    }

    // KEINE Sortierung - behalte Algolia Relevanz-Reihenfolge
    // filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));

    return filtered;
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
    
    // GA4 Event: Tab switched
    analytics.trackCustomEvent('tab_switched', {
      screen_name: 'search_results',
      from_tab: activeTab,
      to_tab: tabId,
      search_query: searchQuery
    });
    
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
            // 🎯 Track Product View mit Journey-Context
            analytics.trackProductViewWithJourney(
              item.objectID,
              isNoName ? 'noname' : 'brand',
              item.name || item.produktName || 'Produkt',
              index
            );
            
            // Legacy GA4 Event (kann später entfernt werden)
            analytics.trackProductView(item.objectID, isNoName ? 'noname' : 'brand', {
              source: 'search_results',
              search_query: searchQuery,
              position: index + 1,
              price: item.preis ? parseFloat(String(item.preis)) || 0 : 0,
              category_id: item.kategorie || 'unknown'
            });
            
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
                : (item.marke?.name || item.hersteller?.name || item.hersteller?.herstellername || 'Unbekannte Marke')
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

  // Get current results based on active tab (MIT FILTERN!)
  const getCurrentResults = () => {
    return getFilteredResults();
  };

  return (
    <>
      <Stack.Screen
        options={getStackScreenHeaderOptions(colorScheme, 'Suchergebnisse')}
      />
      
      <ThemedView style={styles.container} {...panResponder.panHandlers}>
        {/* Search Section - SearchBottomSheet komplett übernehmen */}
        <View style={styles.searchSection}>
          <View style={[
            styles.searchFieldContainer, 
            { 
              backgroundColor: colors.cardBackground, 
              borderColor: showMinCharWarning ? '#ff3b30' : colors.border,
              borderWidth: showMinCharWarning ? 2 : 1
            }
          ]}>
            <IconSymbol 
              name="magnifyingglass" 
              size={20} 
              color={showMinCharWarning ? '#ff3b30' : colors.icon} 
            />
            <TextInput
              ref={searchInputRef}
              style={[styles.searchField, { color: colors.text }]}
              placeholder="Produkte suchen ..."
              placeholderTextColor={colors.icon}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmitEditing={() => validateAndSearch(searchQuery)}
              returnKeyType="search"
              autoFocus={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <IconSymbol name="xmark.circle.fill" size={18} color={colors.icon + '80'} />
              </TouchableOpacity>
            )}
          </View>
          
          {/* Such-Button WEISS - SearchBottomSheet Stil */}
          <TouchableOpacity
            style={[styles.searchButton, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
            onPress={() => {
              analytics.trackCustomEvent('search_button_clicked', {
                screen_name: 'search_results',
                search_query: searchQuery,
                active_tab: activeTab
              });
              validateAndSearch(searchQuery);
            }}
            disabled={loading}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <IconSymbol name="magnifyingglass" size={20} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>

        {/* Minimum Zeichen Warnung */}
        {showMinCharWarning && (
          <View style={[styles.warningContainer, { backgroundColor: '#ff3b30' + '15' }]}>
            <IconSymbol name="exclamationmark.triangle.fill" size={16} color="#ff3b30" />
            <ThemedText style={[styles.warningText, { color: '#ff3b30' }]}>
              Mindestens 3 Zeichen für die Suche eingeben
            </ThemedText>
          </View>
        )}



        {/* Tab Navigation - Wie explore.tsx ohne horizontale Margins */}
        <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground, borderBottomColor: colors.border }]}>
          <View style={styles.tabScroll}>
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
                  size={20} 
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
              style={[styles.productListContainer, { backgroundColor: colors.cardBackground }]}
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
        
        {/* Filter Button - explore.tsx 1:1 Design */}
        <TouchableOpacity 
          style={[styles.filterFab, { backgroundColor: colors.primary }]}
          onPress={() => {
            // GA4 Event: Filter-Button geklickt
            analytics.trackCustomEvent('filter_button_clicked', {
              screen_name: 'search_results',
              active_tab: activeTab,
              search_query: searchQuery,
              current_filters: getActiveFiltersCount()
            });
            setShowFilterModal(true);
          }}
          activeOpacity={0.7}
        >
          <IconSymbol name="line.3.horizontal.decrease" size={20} color="white" />
          {/* Filter-Badge für aktive Filter */}
          {getActiveFiltersCount() > 0 && (
            <View style={[styles.filterBadge, { backgroundColor: colors.error }]}>
              <ThemedText style={styles.filterBadgeText}>
                {getActiveFiltersCount()}
              </ThemedText>
            </View>
          )}
        </TouchableOpacity>
        
        {/* Locked Category Modal */}
        {lockedCategoryModal.category && (
          <LockedCategoryModal
            visible={lockedCategoryModal.visible}
            categoryName={lockedCategoryModal.category.bezeichnung}
            categoryImage={lockedCategoryModal.category.bild}
            requiredLevel={lockedCategoryModal.category.requiredLevel || 1}
            currentLevel={(userProfile as any)?.stats?.currentLevel || (userProfile as any)?.level || 1}
            onClose={() => setLockedCategoryModal({ visible: false, category: null })}
            onNavigateToLevels={() => {
              setLockedCategoryModal({ visible: false, category: null });
              router.push('/achievements' as any);
            }}
          />
        )}
        
        {/* Filter Modal - EXAKT wie explore.tsx je nach activeTab */}
        <Modal
          visible={showFilterModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowFilterModal(false)}
        >
          <View style={[styles.filterModalContainer, { backgroundColor: colors.background }]}>
            <View style={[styles.filterModalHeader, { borderBottomColor: colors.border }]}>
              <ThemedText style={styles.filterModalTitle}>
                {activeTab === 'nonames' ? 'NoName-Produkte filtern' : 'Markenprodukte filtern'}
              </ThemedText>
              <TouchableOpacity onPress={() => setShowFilterModal(false)}>
                <IconSymbol name="xmark" size={24} color={colors.icon} />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.filterOptions}>
              {/* Clear All Button */}
              <View style={styles.filterSection}>
                <TouchableOpacity 
                  style={[styles.clearAllButton, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    if (activeTab === 'nonames') {
                      clearAllFilters();
                    } else {
                      clearAllMarkenproduktFilters();
                    }
                    analytics.trackCustomEvent('filters_cleared', {
                      screen_name: 'search_results',
                      search_query: searchQuery
                    });
                  }}
                >
                  <IconSymbol name="xmark.circle.fill" size={16} color="white" />
                  <ThemedText style={styles.clearAllText}>Alle Filter löschen</ThemedText>
                </TouchableOpacity>
              </View>

              {/* NoName-spezifische Filter */}
              {activeTab === 'nonames' && (
                <>
                  {/* Märkte Filter - mit Bildern und Land-Einschränkung */}
                  <View style={styles.filterSection}>
                    <ThemedText style={[styles.filterSectionTitle, { color: colors.text }]}>Märkte</ThemedText>
                    {selectedCountry !== 'Alle Länder' && (
                      <View style={[styles.countryHint, { backgroundColor: colors.primary + '15' }]}>
                        <IconSymbol name="info.circle" size={14} color={colors.primary} />
                        <ThemedText style={[styles.countryHintText, { color: colors.text }]}>
                          Nur Märkte aus {selectedCountry} (wie im Märkte-Tab gewählt)
                        </ThemedText>
                      </View>
                    )}
                    <View style={styles.chipsContainer}>
                      {filteredMarkets.map((market) => (
                        <TouchableOpacity 
                          key={market.id}
                          style={[
                            styles.filterChip,
                            { 
                              backgroundColor: noNameFilters.discounterFilters.includes(market.id) 
                                ? colors.primary 
                                : colors.cardBackground,
                              borderColor: colors.border
                            }
                          ]}
                          onPress={() => {
                            toggleDiscounterFilter(market.id);
                            analytics.trackFilter('market', market.name, 'search_results');
                          }}
                        >
                          <View style={[styles.chipLogo, { backgroundColor: colors.background }]}>
                            {market.bild && market.bild.trim() !== '' && !failedImages.has(`chip-market-${market.id}`) ? (
                              <ImageWithShimmer
                                source={{ uri: market.bild }}
                                style={styles.chipImage}
                                fallbackIcon="storefront"
                                fallbackIconSize={12}
                                resizeMode="contain"
                                onError={() => {
                                  setFailedImages(prev => new Set([...prev, `chip-market-${market.id}`]));
                                }}
                              />
                            ) : (
                              <IconSymbol name="storefront" size={12} color={colors.icon} />
                            )}
                          </View>
                          <ThemedText style={[
                            styles.chipText, 
                            { 
                              color: noNameFilters.discounterFilters.includes(market.id) 
                                ? 'white' 
                                : colors.text 
                            }
                          ]}>
                            {market.name}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Kategorien Filter - mit Lock Icons */}
                  <View style={styles.filterSection}>
                    <ThemedText style={[styles.filterSectionTitle, { color: colors.text }]}>Kategorien</ThemedText>
                    <View style={styles.chipsContainer}>
                      {kategorien.map((kategorie) => (
                        <TouchableOpacity 
                          key={kategorie.id}
                          style={[
                            styles.filterChip,
                            { 
                              backgroundColor: noNameFilters.categoryFilters.includes(kategorie.id) 
                                ? colors.primary 
                                : colors.cardBackground,
                              borderColor: colors.border,
                              opacity: kategorie.isLocked ? 0.4 : 1
                            }
                          ]}
                          onPress={kategorie.isLocked ? undefined : () => {
                            toggleCategoryFilter(kategorie.id);
                            analytics.trackFilter('category', kategorie.bezeichnung, 'search_results');
                          }}
                          disabled={kategorie.isLocked}
                        >
                          {kategorie.bild && kategorie.bild.trim() !== '' && !failedImages.has(`filter-cat-${kategorie.id}`) ? (
                            <ImageWithShimmer
                              source={{ uri: kategorie.bild }}
                              style={styles.chipCategoryImage}
                              fallbackIcon={getCategoryIcon(kategorie.bezeichnung)}
                              fallbackIconSize={16}
                              resizeMode="contain"
                              onError={() => {
                                setFailedImages(prev => new Set([...prev, `filter-cat-${kategorie.id}`]));
                              }}
                            />
                          ) : (
                            <IconSymbol 
                              name={getCategoryIcon(kategorie.bezeichnung)} 
                              size={16} 
                              color={
                                noNameFilters.categoryFilters.includes(kategorie.id) 
                                  ? 'white' 
                                  : kategorie.isLocked 
                                    ? colors.icon 
                                    : colors.primary
                              }
                            />
                          )}
                          <ThemedText style={[
                            styles.chipText, 
                            { 
                              color: noNameFilters.categoryFilters.includes(kategorie.id)
                                ? 'white' 
                                : kategorie.isLocked
                                  ? colors.icon
                                  : colors.text 
                            }
                          ]}>
                            {kategorie.bezeichnung}
                          </ThemedText>
                          {kategorie.isLocked && (
                            <IconSymbol name="lock" size={12} color={colors.icon} />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Stufen Filter - mit Stufen-Farben */}
                  <View style={styles.filterSection}>
                    <ThemedText style={[styles.filterSectionTitle, { color: colors.text }]}>Stufen</ThemedText>
                    <View style={styles.chipsContainer}>
                      {[1, 2, 3, 4, 5].map((stufe) => (
                        <TouchableOpacity 
                          key={stufe}
                          style={[
                            styles.filterChip,
                            { 
                              backgroundColor: noNameFilters.stufeFilters.includes(stufe) 
                                ? getStufenColor(stufe)
                                : colors.cardBackground,
                              borderColor: colors.border
                            }
                          ]}
                          onPress={() => {
                            toggleStufeFilter(stufe);
                            analytics.trackFilter('stufe', stufe.toString(), 'search_results');
                          }}
                        >
                          <IconSymbol name="chart.bar" size={12} color={noNameFilters.stufeFilters.includes(stufe) ? 'white' : colors.icon} />
                          <ThemedText style={[
                            styles.chipText, 
                            { 
                              color: noNameFilters.stufeFilters.includes(stufe) 
                                ? 'white' 
                                : colors.text 
                            }
                          ]}>
                            Stufe {stufe}
                          </ThemedText>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </>
              )}

              {/* Markenprodukte-spezifische Filter */}
              {activeTab === 'markenprodukte' && (
                <>
                  {/* Hersteller/Marke Filter - mit Suchfeld */}
                  <View style={styles.filterSection}>
                    <ThemedText style={[styles.filterSectionTitle, { color: colors.text }]}>
                      Marken ({markenproduktFilters.herstellerFilters.length} ausgewählt)
                    </ThemedText>
                    
                    {/* Suchfeld für Marken */}
                    <View style={styles.markenSearchSection}>
                      <View style={[styles.markenSearchContainer, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
                        <IconSymbol name="magnifyingglass" size={20} color={colors.icon} />
                        <TextInput
                          style={[styles.markenSearchInput, { color: colors.text }]}
                          placeholder="Marke suchen..."
                          placeholderTextColor={colors.icon}
                          value={markenSearchQuery}
                          onChangeText={setMarkenSearchQuery}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        {markenSearchQuery.length > 0 && (
                          <TouchableOpacity onPress={() => setMarkenSearchQuery('')}>
                            <IconSymbol name="xmark.circle.fill" size={18} color={colors.icon} />
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    {/* Dynamische Chips basierend auf Suche */}
                    <View style={styles.chipsContainer}>
                      {filteredAndSortedMarken.slice(0, markenSearchQuery.trim() ? 50 : 7).map((marke) => {
                        const isSelected = markenproduktFilters.herstellerFilters.includes(marke.id);
                        return (
                          <TouchableOpacity 
                            key={marke.id}
                            style={[
                              styles.filterChip,
                              { 
                                backgroundColor: isSelected 
                                  ? colors.primary 
                                  : colors.cardBackground,
                                borderColor: isSelected ? colors.primary : colors.border,
                                borderWidth: 1
                              }
                            ]}
                            onPress={() => {
                              toggleMarkenproduktHerstellerFilter(marke.id);
                              analytics.trackFilter('hersteller', marke.name, 'search_results');
                            }}
                          >
                            <IconSymbol 
                              name={isSelected ? "checkmark" : "tag"} 
                              size={14} 
                              color={isSelected ? 'white' : colors.primary}
                            />
                            <ThemedText style={[
                              styles.chipText, 
                              { 
                                color: isSelected ? 'white' : colors.text 
                              }
                            ]}>
                              {marke.name}
                            </ThemedText>
                          </TouchableOpacity>
                        );
                      })}
                      
                      {filteredAndSortedMarken.length === 0 && markenSearchQuery.trim() && (
                        <ThemedText style={[styles.noResultsText, { color: colors.icon }]}>
                          Keine Marken gefunden für "{markenSearchQuery}"
                        </ThemedText>
                      )}
                    </View>

                    {/* Kompakter Hinweis für weitere Marken */}
                    {!markenSearchQuery.trim() && filteredAndSortedMarken.length > 7 && (
                      <View style={[styles.moreMarkenHintCompact, { backgroundColor: colors.background, borderColor: colors.border }]}>
                        <IconSymbol name="magnifyingglass" size={12} color={colors.icon} />
                        <ThemedText style={[styles.moreMarkenTextCompact, { color: colors.icon }]}>
                          +{filteredAndSortedMarken.length - 7} weitere • Suchen
                        </ThemedText>
                      </View>
                    )}
                  </View>

                  {/* Kategorien Filter - mit Lock Icons */}
                  <View style={styles.filterSection}>
                    <ThemedText style={[styles.filterSectionTitle, { color: colors.text }]}>Kategorien</ThemedText>
                    <View style={styles.chipsContainer}>
                      {kategorien.map((kategorie) => (
                        <TouchableOpacity 
                          key={kategorie.id}
                          style={[
                            styles.filterChip,
                            { 
                              backgroundColor: markenproduktFilters.categoryFilters.includes(kategorie.id) 
                                ? colors.primary 
                                : colors.cardBackground,
                              borderColor: colors.border,
                              opacity: kategorie.isLocked ? 0.4 : 1
                            }
                          ]}
                          onPress={kategorie.isLocked ? undefined : () => {
                            toggleMarkenproduktCategoryFilter(kategorie.id);
                            analytics.trackFilter('category', kategorie.bezeichnung, 'search_results');
                          }}
                          disabled={kategorie.isLocked}
                        >
                          {kategorie.bild && kategorie.bild.trim() !== '' && !failedImages.has(`filter-marken-cat-${kategorie.id}`) ? (
                            <ImageWithShimmer
                              source={{ uri: kategorie.bild }}
                              style={styles.chipCategoryImage}
                              fallbackIcon={getCategoryIcon(kategorie.bezeichnung)}
                              fallbackIconSize={16}
                              resizeMode="contain"
                              onError={() => {
                                setFailedImages(prev => new Set([...prev, `filter-marken-cat-${kategorie.id}`]));
                              }}
                            />
                          ) : (
                            <IconSymbol 
                              name={getCategoryIcon(kategorie.bezeichnung)} 
                              size={16} 
                              color={
                                markenproduktFilters.categoryFilters.includes(kategorie.id) 
                                  ? 'white' 
                                  : kategorie.isLocked 
                                    ? colors.icon 
                                    : colors.primary
                              }
                            />
                          )}
                          <ThemedText style={[
                            styles.chipText, 
                            { 
                              color: markenproduktFilters.categoryFilters.includes(kategorie.id) 
                                ? 'white' 
                                : kategorie.isLocked
                                  ? colors.icon
                                  : colors.text 
                            }
                          ]}>
                            {kategorie.bezeichnung}
                          </ThemedText>
                          {kategorie.isLocked && (
                            <IconSymbol name="lock" size={12} color={colors.icon} />
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </Modal>
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
    paddingHorizontal: 15,
    paddingTop: 12,
    paddingBottom: 8,
  },
  // Search Styles - SearchBottomSheet 1:1 Design mit schönem Spacing
  searchSection: {
    flexDirection: 'row',
    paddingHorizontal: 15,
    paddingTop: 16,
    paddingBottom: 12,
    marginTop: 8,
    gap: 12,
  },
  searchFieldContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#00000010',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    gap: 12,
    height: 48,
  },
  searchField: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  searchButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  

  // Tab Styles - explore.tsx Design ohne Margins
  tabContainer: {
    borderBottomWidth: 1,
    paddingTop: 8,
  },
  tabScroll: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  tab: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    flex: 1,
  },
  tabText: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 14,
  },
  
  // Filter Button - explore.tsx 1:1 Design
  filterFab: {
    position: 'absolute',
    bottom: 120,      // explore.tsx Position
    right: 20,        // explore.tsx Position  
    width: 48,        // explore.tsx Size
    height: 48,       // explore.tsx Size
    borderRadius: 12, // explore.tsx Radius
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, // explore.tsx Shadow
    shadowOpacity: 0.25,                   // explore.tsx Shadow
    shadowRadius: 4,                       // explore.tsx Shadow
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
  contentContainer: {
    flex: 1,
  },
  // Product List Styles - 1:1 von explore.tsx übernommen
  productListContainer: {
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
    overflow: 'hidden',
  },
  productListContent: {
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 100 : 20,
  },
  productItemContainer: {
    borderRadius: 16,
    marginBottom: 12,
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  lastProductItem: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
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
  
  // Filter Modal Styles - explore.tsx echte Filter
  filterModalContainer: {
    flex: 1,
  },
  filterModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  filterModalTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
  },
  filterOptions: {
    flex: 1,
    paddingTop: 16,
  },
  filterSection: {
    marginBottom: 20,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
  },
  clearAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginHorizontal: 20,
    gap: 8,
  },
  clearAllText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  
  // New Styles für explore.tsx Filter Components
  countryHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  countryHintText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
    lineHeight: 16,
  },
  chipLogo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  chipImage: {
    width: 16,
    height: 16,
  },
  chipCategoryImage: {
    width: 16,
    height: 16,
  },
  markenSearchSection: {
    marginBottom: 12,
  },
  markenSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  markenSearchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  noResultsText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    paddingVertical: 20,
  },
  moreMarkenHintCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    gap: 6,
  },
  moreMarkenTextCompact: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
  },
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 15,
    marginTop: 8,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ff3b30',
  },
  warningText: {
    marginLeft: 8,
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
  },
});