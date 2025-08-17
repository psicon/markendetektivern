import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { ListItemSkeleton, LoadingFooterSkeleton } from '@/components/ui/ShimmerSkeleton';
import { getStufenColor } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { FirestoreService } from '@/lib/services/firestore';
import { Discounter, FirestoreDocument, Handelsmarken, Kategorien, Produkte } from '@/lib/types/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, FlatList, Modal, PanResponder, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

const { width: screenWidth } = Dimensions.get('window');

export default function ExploreScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const params = useLocalSearchParams();
  const [activeTab, setActiveTab] = useState('märkte');
  
  // Animation für Swipe-Navigation
  const translateX = useRef(new Animated.Value(0)).current;
  const isAnimating = useRef(false);
  
  // Firestore State
  const [discounter, setDiscounter] = useState<FirestoreDocument<Discounter>[]>([]);
  const [productCounts, setProductCounts] = useState<{[key: string]: number}>({});
  const [marketsLoading, setMarketsLoading] = useState(true);
  
  // Categories State
  const [categoriesData, setCategoriesData] = useState<FirestoreDocument<Kategorien>[]>([]);
  const [categoryProductCounts, setCategoryProductCounts] = useState<{[key: string]: number}>({});
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  
  // Failed images state (für alle Tabs)
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  
  // Animation für sanftes Einblenden der Produktzahlen
  const [countOpacities, setCountOpacities] = useState<{[key: string]: Animated.Value}>({});
  
  // Filter States
  const [selectedCountry, setSelectedCountry] = useState('Deutschland');
  const [showFilterModal, setShowFilterModal] = useState(false);
  
  // NoName Products States
  const [noNameProducts, setNoNameProducts] = useState<(FirestoreDocument<Produkte> & {
    discounter?: Discounter;
    handelsmarke?: Handelsmarken;
  })[]>([]);
  const [noNameLoading, setNoNameLoading] = useState(false);
  const [noNameLastDoc, setNoNameLastDoc] = useState<any>(null);
  const [noNameHasMore, setNoNameHasMore] = useState(true);
  const [noNameError, setNoNameError] = useState<string | null>(null);

  // NoName Filter States - Multi-Select
  const [showNoNameFilterModal, setShowNoNameFilterModal] = useState(false);
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
  
  // Filter Options Data
  const [kategorien, setKategorien] = useState<FirestoreDocument<Kategorien>[]>([]);
  const [markenData, setMarkenData] = useState<FirestoreDocument<any>[]>([]);

  // Markenprodukte States
  const [markenprodukte, setMarkenprodukte] = useState<(FirestoreDocument<any> & {
    hersteller?: any; // Kann sowohl hersteller als auch hersteller_new sein
  })[]>([]);
  const [markenproduktLoading, setMarkenproduktLoading] = useState(false);
  const [markenproduktLastDoc, setMarkenproduktLastDoc] = useState<any>(null);
  const [markenproduktHasMore, setMarkenproduktHasMore] = useState(true);
  const [markenproduktError, setMarkenproduktError] = useState<string | null>(null);

  // Markenprodukte Filter States
  const [showMarkenproduktFilterModal, setShowMarkenproduktFilterModal] = useState(false);
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



  // Helper function to get country flag emoji
  const getCountryFlag = (country: string): string => {
    const flagMap: {[key: string]: string} = {
      'Deutschland': '🇩🇪',
      'DE': '🇩🇪',
      'Schweiz': '🇨🇭',
      'CH': '🇨🇭',
      'Österreich': '🇦🇹',
      'AT': '🇦🇹',
      'Austria': '🇦🇹',
      'Switzerland': '🇨🇭',
      'Germany': '🇩🇪',
      'Alle Länder': '🌍',
    };
    
    return flagMap[country] || '🏳️';
  };

  // Normalize country names for filtering
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

  // Filter markets by selected country
  const filteredMarkets = React.useMemo(() => {
    if (selectedCountry === 'Alle Länder') {
      return discounter;
    }
    return discounter.filter(market => normalizeCountry(market.land) === selectedCountry);
  }, [discounter, selectedCountry]);

  // Handle country selection
  const handleCountrySelect = (country: string) => {
    setSelectedCountry(country);
    setShowFilterModal(false);
  };

  // Format price helper
  const formatPrice = (price: number): string => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR'
    }).format(price);
  };

  // getStufenColor wird jetzt aus @/constants/AppTexts importiert

  // Icon-Mapping für Kategorien (kopiert von index.tsx)
  const getCategoryIcon = (bezeichnung: string): SymbolViewProps['name'] => {
    const iconMap: {[key: string]: SymbolViewProps['name']} = {
      'alkohol': 'wineglass',
      'alkoholfreie getränke': 'cup.and.saucer',
      'backwaren': 'birthday.cake',
      'fertigteig': 'birthday.cake',
      'butter': 'drop.fill',
      'margarine': 'drop.fill',
      'fleisch': 'fork.knife',
      'wurst': 'fork.knife',
      'fisch': 'fish',
      'meeresfrüchte': 'fish',
      'milch': 'drop.fill',
      'käse': 'square.grid.2x2',
      'joghurt': 'cup.and.saucer',
      'obst': 'leaf.fill',
      'gemüse': 'leaf.fill',
      'brot': 'birthday.cake',
      'getreide': 'leaf.fill',
      'süßwaren': 'heart.fill',
      'schokolade': 'heart.fill',
      'snacks': 'bag',
      'chips': 'bag',
      'tiefkühl': 'snowflake',
      'konserven': 'archivebox',
      'gewürze': 'sparkles',
      'öl': 'drop.fill',
      'essig': 'drop.fill',
      'drogerie': 'sparkles',
      'haushalt': 'house',
      'körperpflege': 'sparkles',
      'baby': 'heart.fill',
      'tiernahrung': 'pawprint'
    };

    const normalizedName = bezeichnung.toLowerCase().trim();
    
    // Exakte Übereinstimmung
    if (iconMap[normalizedName]) {
      return iconMap[normalizedName];
    }
    
    // Teilstring-Suche
    for (const [key, icon] of Object.entries(iconMap)) {
      if (normalizedName.includes(key) || key.includes(normalizedName)) {
        return icon;
      }
    }
    
    return 'tag'; // Fallback
  };

  // Helper functions for multi-select filters
  const toggleCategoryFilter = (categoryId: string) => {
    setNoNameFilters(prev => ({
      ...prev,
      categoryFilters: prev.categoryFilters.includes(categoryId)
        ? prev.categoryFilters.filter(id => id !== categoryId)
        : [...prev.categoryFilters, categoryId]
    }));
  };

  const toggleDiscounterFilter = (discounterId: string) => {
    setNoNameFilters(prev => ({
      ...prev,
      discounterFilters: prev.discounterFilters.includes(discounterId)
        ? prev.discounterFilters.filter(id => id !== discounterId)
        : [...prev.discounterFilters, discounterId]
    }));
  };

  const toggleStufeFilter = (stufe: number) => {
    setNoNameFilters(prev => ({
      ...prev,
      stufeFilters: prev.stufeFilters.includes(stufe)
        ? prev.stufeFilters.filter(s => s !== stufe)
        : [...prev.stufeFilters, stufe]
    }));
  };

  const clearAllFilters = () => {
    setNoNameFilters({
      categoryFilters: [],
      discounterFilters: [],
      stufeFilters: []
    });
  };

  // Helper functions for Markenprodukte filters
  const toggleMarkenproduktCategoryFilter = (categoryId: string) => {
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

  const clearAllMarkenproduktFilters = () => {
    setMarkenproduktFilters({
      categoryFilters: [],
      herstellerFilters: []
    });
  };

  // Filtered and sorted Marken for search
  const filteredAndSortedMarken = useMemo(() => {
    let filtered = markenData;
    
    // Filter by search query
    if (markenSearchQuery.trim()) {
      filtered = markenData.filter(marke => 
        marke.name.toLowerCase().includes(markenSearchQuery.toLowerCase())
      );
    }
    
    // Sort: selected first, then alphabetically
    return filtered.sort((a, b) => {
      const aSelected = markenproduktFilters.herstellerFilters.includes(a.id);
      const bSelected = markenproduktFilters.herstellerFilters.includes(b.id);
      
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      
      return a.name.localeCompare(b.name);
    });
  }, [markenData, markenSearchQuery, markenproduktFilters.herstellerFilters]);

  // Helper Functions für Filter-Zählung
  const getActiveFiltersCount = (filters: any) => {
    let count = 0;
    if (filters.categoryFilters?.length > 0) count += filters.categoryFilters.length;
    if (filters.discounterFilters?.length > 0) count += filters.discounterFilters.length;
    if (filters.stufeFilters?.length > 0) count += filters.stufeFilters.length;
    if (filters.herstellerFilters?.length > 0) count += filters.herstellerFilters.length;
    if (filters.priceMin !== undefined || filters.priceMax !== undefined) count += 1;
    return count;
  };

  const getMarketFiltersCount = () => {
    // Badge zeigen wenn ein spezifisches Land gewählt ist (inkl. Deutschland als Standard)
    // Nur bei "Alle Länder" ist kein Filter aktiv
    return selectedCountry !== 'Alle Länder' ? 1 : 0;
  };

  // Swipe Navigation Logic - KORREKTE Reihenfolge wie in UI
  const tabOrder = ['märkte', 'kategorien', 'markenprodukte', 'nonames'];
  
  const switchToTab = (newTab: string) => {
    if (isAnimating.current || newTab === activeTab) return;
    
    const currentIndex = tabOrder.indexOf(activeTab);
    const newIndex = tabOrder.indexOf(newTab);
    const direction = newIndex > currentIndex ? -1 : 1;
    
    isAnimating.current = true;
    
    // Slide-out Animation
    Animated.timing(translateX, {
      toValue: direction * screenWidth,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      // Tab wechseln
      setActiveTab(newTab);
      
      // Von der anderen Seite einsliden
      translateX.setValue(-direction * screenWidth);
      
      // Slide-in Animation
      Animated.timing(translateX, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        isAnimating.current = false;
      });
    });
  };
  
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 10;
    },
    
    onPanResponderGrant: () => {
      if (isAnimating.current) return;
    },
    
    onPanResponderMove: (evt, gestureState) => {
      if (isAnimating.current) return;
      
      // Live-Feedback während des Swipes
      const maxTranslation = screenWidth * 0.3; // Maximal 30% der Bildschirmbreite
      let translation = Math.max(-maxTranslation, Math.min(maxTranslation, gestureState.dx));
      
      translateX.setValue(translation);
    },
    
    onPanResponderRelease: (evt, gestureState) => {
      if (isAnimating.current) return;
      
      const currentIndex = tabOrder.indexOf(activeTab);
      const threshold = screenWidth * 0.25; // 25% der Bildschirmbreite
      
      if (Math.abs(gestureState.dx) > threshold) {
        let nextIndex;
        
        if (gestureState.dx < 0) {
          // Swipe nach LINKS = NÄCHSTER Tab (Index +1)
          nextIndex = (currentIndex + 1) % tabOrder.length; // Zirkulär: nach letztem kommt erster
        } else {
          // Swipe nach RECHTS = VORHERIGER Tab (Index -1)  
          nextIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length; // Zirkulär: vor erstem kommt letzter
        }
        
        console.log(`🔄 Swipe: ${activeTab} (${currentIndex}) → ${tabOrder[nextIndex]} (${nextIndex})`);
        switchToTab(tabOrder[nextIndex]);
        return;
      }
      
      // Zurück zur ursprünglichen Position
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    },
  });

  // Load NoName Products with pagination
  const loadNoNameProducts = async (reset: boolean = false) => {
    if (noNameLoading || (!noNameHasMore && !reset)) return;
    
    console.log(`🔄 Loading NoName products - Reset: ${reset}, HasMore: ${noNameHasMore}`);

    try {
      setNoNameLoading(true);
      setNoNameError(null);

      const result = await FirestoreService.getNoNameProductsPaginated(
        20, // Page size
        reset ? null : noNameLastDoc,
        noNameFilters // Filter anwenden
      );

      if (reset) {
        setNoNameProducts(result.products);
      } else {
        // ✅ Verhindere Duplikate beim Hinzufügen neuer Produkte
        setNoNameProducts(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newProducts = result.products.filter(p => !existingIds.has(p.id));
          return [...prev, ...newProducts];
        });
      }

      setNoNameLastDoc(result.lastDoc);
      setNoNameHasMore(result.hasMore);

    } catch (error) {
      console.error('Error loading NoName products:', error);
      setNoNameError('Fehler beim Laden der Produkte');
    } finally {
      setNoNameLoading(false);
    }
  };

  // Load Markenprodukte with pagination
  const loadMarkenprodukte = async (reset: boolean = false) => {
    if (markenproduktLoading || (!markenproduktHasMore && !reset)) return;
    
    console.log(`🔄 Loading Markenprodukte - Reset: ${reset}, HasMore: ${markenproduktHasMore}`);

    try {
      setMarkenproduktLoading(true);
      setMarkenproduktError(null);

      const result = await FirestoreService.getMarkenproduktePaginated(
        20, // Page size
        reset ? null : markenproduktLastDoc,
        markenproduktFilters // Filter anwenden
      );

      if (reset) {
        setMarkenprodukte(result.products);
      } else {
        // ✅ Verhindere Duplikate beim Hinzufügen neuer Produkte
        setMarkenprodukte(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newProducts = result.products.filter(p => !existingIds.has(p.id));
          return [...prev, ...newProducts];
        });
      }

      setMarkenproduktLastDoc(result.lastDoc);
      setMarkenproduktHasMore(result.hasMore);

    } catch (error) {
      console.error('Error loading Markenprodukte:', error);
      setMarkenproduktError('Fehler beim Laden der Produkte');
    } finally {
      setMarkenproduktLoading(false);
    }
  };

  // Load NoName products when tab is selected
  React.useEffect(() => {
    if (activeTab === 'nonames' && noNameProducts.length === 0) {
      loadNoNameProducts(true);
    }
  }, [activeTab]);

  // Sanfte Animation für Produktzahlen
  const animateProductCount = (marketId: string) => {
    if (!countOpacities[marketId]) {
      const newOpacity = new Animated.Value(0);
      setCountOpacities(prev => ({ ...prev, [marketId]: newOpacity }));
      
      // Sanftes Einblenden über 300ms
      Animated.timing(newOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  };

  // Load markets data
  useEffect(() => {
    const loadMarkets = async () => {
      try {
        setMarketsLoading(true);
        
        // Lade Märkte SOFORT - ohne Produktzählung
        const discounterData = await FirestoreService.getDiscounter();
        console.log('Loaded discounter:', discounterData);
        
        // Sortiere Märkte alphabetisch nach Name
        const sortedDiscounter = discounterData.sort((a, b) => 
          a.name.localeCompare(b.name, 'de')
        );
        setDiscounter(sortedDiscounter);
        setMarketsLoading(false); // ✅ Märkte sofort anzeigen!
        
        // Lade Produktanzahl im Hintergrund (nicht blockierend, individuell)
        console.log('🚀 Loading product counts in background (non-blocking)...');
        const startTime = Date.now();
        
        // Lade jeden Count individuell und update sofort (nicht blockierend)
        sortedDiscounter.forEach(async (market, index) => {
          try {
            // Kleine Verzögerung zwischen Requests für bessere Performance
            setTimeout(async () => {
              try {
                const count = await FirestoreService.getProductCountByDiscounter(market.id);
                console.log(`✅ Count for ${market.name}: ${count}`);
                
                // Update State sofort für diesen Market
                setProductCounts(prevCounts => ({
                  ...prevCounts,
                  [market.id]: count
                }));
                
                // Triggere Animation für diesen Count
                setTimeout(() => animateProductCount(market.id), 100);
                
              } catch (error) {
                console.error(`❌ Error counting products for ${market.name}:`, error);
                // Setze 0 als Fallback
                setProductCounts(prevCounts => ({
                  ...prevCounts,
                  [market.id]: 0
                }));
              }
            }, index * 100); // Gestaffelte Requests (100ms Abstand)
            
          } catch (error) {
            console.error(`❌ Error setting up count loading for ${market.name}:`, error);
          }
        });
        
        console.log(`✅ Product count loading initiated (non-blocking)`);
        
      } catch (error) {
        console.error('Error loading markets:', error);
        setMarketsLoading(false);
      }
    };

    // Load categories data - ähnlich wie loadMarkets
    const loadCategories = async () => {
      try {
        setCategoriesLoading(true);
        
        // Lade Kategorien SOFORT - ohne Produktzählung
        const categoriesData = await FirestoreService.getKategorien();
        console.log('Loaded categories:', categoriesData);
        
        // Sortiere Kategorien alphabetisch nach Bezeichnung
        const sortedCategories = categoriesData.sort((a, b) => 
          a.bezeichnung.localeCompare(b.bezeichnung, 'de')
        );
        setCategoriesData(sortedCategories);
        setCategoriesLoading(false); // ✅ Kategorien sofort anzeigen!
        
        // Lade Produktanzahl im Hintergrund (nicht blockierend)
        console.log('🚀 Loading category product counts in background (non-blocking)...');
        
        // Lade jeden Count individuell und update sofort (nicht blockierend)
        sortedCategories.forEach(async (category, index) => {
          try {
            // Kleine Verzögerung zwischen Requests für bessere Performance
            setTimeout(async () => {
              try {
                const count = await FirestoreService.getProductCountByCategory(category.id);
                console.log(`✅ Count for ${category.bezeichnung}: ${count}`);
                
                // Update State sofort für diese Category
                setCategoryProductCounts(prevCounts => ({
                  ...prevCounts,
                  [category.id]: count
                }));
                
                // Triggere Animation für diesen Count
                setTimeout(() => animateProductCount(category.id), 100);
                
              } catch (error) {
                console.error(`❌ Error counting products for ${category.bezeichnung}:`, error);
                // Setze 0 als Fallback
                setCategoryProductCounts(prevCounts => ({
                  ...prevCounts,
                  [category.id]: 0
                }));
              }
            }, index * 100); // Gestaffelte Requests (100ms Abstand)
            
          } catch (error) {
            console.error(`❌ Error setting up count loading for ${category.bezeichnung}:`, error);
          }
        });
        
        console.log(`✅ Category product count loading initiated (non-blocking)`);
        
      } catch (error) {
        console.error('Error loading categories:', error);
        setCategoriesLoading(false);
      }
    };

    loadMarkets();
    loadCategories();
  }, []);



  // Handle URL parameters for navigation from other screens
  useEffect(() => {
    if (params.tab) {
      setActiveTab(params.tab as string);
    }
    
    if (params.categoryFilter && params.categoryName) {
      console.log(`🔗 Processing URL params - Category: ${params.categoryName}, Filter: ${params.categoryFilter}`);
      
      // Set category filter for NoName products
      const newFilters = {
        discounterFilters: [],
        categoryFilters: [params.categoryFilter as string],
        stufeFilters: [],
        priceRange: [0, 100]
      };
      setNoNameFilters(newFilters);
      
      // Reset and load NoName products with category filter
      setNoNameProducts([]);
      setNoNameLastDoc(null);
      setNoNameHasMore(true);
      setNoNameError(null);
      
      // Load products immediately without setTimeout
      const loadFilteredProducts = async () => {
        try {
          setNoNameLoading(true);
          console.log(`🔍 Loading NoName products for category: ${params.categoryName}`);
          const result = await FirestoreService.getNoNameProductsPaginated(
            20,
            null,
            newFilters
          );
          setNoNameProducts(result.products);
          setNoNameLastDoc(result.lastDoc);
          setNoNameHasMore(result.hasMore);
          console.log(`✅ Loaded ${result.products.length} NoName products for category: ${params.categoryName}`);
        } catch (error) {
          console.error('Error loading filtered products:', error);
          setNoNameError('Fehler beim Laden der Produkte');
        } finally {
          setNoNameLoading(false);
        }
      };
      
      loadFilteredProducts();
    }
    
    if (params.markeFilter && params.markeName) {
      console.log(`🔗 Processing URL params - Marke: ${params.markeName}, Filter: ${params.markeFilter}`);
      
      // Set marke filter for Markenprodukte
      const newFilters = {
        categoryFilters: [],
        herstellerFilters: [params.markeFilter as string]
      };
      setMarkenproduktFilters(newFilters);
      
      // Reset and load Markenprodukte with marke filter
      setMarkenprodukte([]);
      setMarkenproduktLastDoc(null);
      setMarkenproduktHasMore(true);
      setMarkenproduktError(null);
      
      // Load products immediately
      const loadFilteredMarkenprodukte = async () => {
        try {
          setMarkenproduktLoading(true);
          console.log(`🔍 Loading Markenprodukte for marke: ${params.markeName}`);
          const result = await FirestoreService.getMarkenproduktePaginated(
            20,
            null,
            newFilters
          );
          setMarkenprodukte(result.products);
          setMarkenproduktLastDoc(result.lastDoc);
          setMarkenproduktHasMore(result.hasMore);
          console.log(`✅ Loaded ${result.products.length} Markenprodukte for marke: ${params.markeName}`);
        } catch (error) {
          console.error('Error loading filtered markenprodukte:', error);
          setMarkenproduktError('Fehler beim Laden der Markenprodukte');
        } finally {
          setMarkenproduktLoading(false);
        }
      };
      
      loadFilteredMarkenprodukte();
    }
  }, [params.tab, params.categoryFilter, params.categoryName, params.markeFilter, params.markeName]); // Spezifische Dependencies

  // Load filter options when component mounts
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const [kategorienData, markenData] = await Promise.all([
          FirestoreService.getKategorien(),
          FirestoreService.getMarken()
        ]);
        setKategorien(kategorienData);
        setMarkenData(markenData);
        console.log('🏷️ Loaded Marken:', markenData.length, markenData.slice(0, 3));
      } catch (error) {
        console.error('Error loading filter options:', error);
      }
    };

    loadFilterOptions();
  }, []);

  // Load NoName Products when tab becomes active or filters change
  useEffect(() => {
    if (activeTab === 'nonames') {
      loadNoNameProducts(true);
    }
  }, [activeTab, noNameFilters]);

  // Load Markenprodukte when tab becomes active or filters change
  useEffect(() => {
    if (activeTab === 'markenprodukte') {
      loadMarkenprodukte(true);
    }
  }, [activeTab, markenproduktFilters]);

  // Static tab titles without counts
  const getTabTitle = (tabId: string) => {
    switch (tabId) {
      case 'märkte':
        return 'Märkte';
      case 'kategorien':
        return 'Kategorien';
      case 'markenprodukte':
        return 'Marken-\nProdukte';
              case 'nonames':
          return 'NoName-\nProdukte';
        default:
          return tabId;
    }
  };

  const tabs = [
    { id: 'märkte', title: 'Märkte', icon: 'house.fill' },
    { id: 'kategorien', title: 'Kategorien', icon: 'square.grid.2x2' },
    { id: 'markenprodukte', title: 'Marken-\nProdukte', icon: 'heart.fill' },
    { id: 'nonames', title: 'NoName-\nProdukte', icon: 'star.fill' },
  ];

  const categories = [
    { title: 'Alkohol', count: '99 Produkte', icon: '🍷', color: colors.primary },
    { title: 'Backwaren / Fertigteig', count: '875 Produkte', icon: '🥖', color: colors.primary },
    { title: 'Butter, Margarine etc.', count: '85 Produkte', icon: '🧈', color: colors.primary },
    { title: 'Drogerie & Haushalt', count: '464 Produkte', icon: '🧴', color: colors.primary },
    { title: 'Fertiggerichte', count: '499 Produkte', icon: '🍝', color: colors.primary },
    { title: 'Festliches', count: '584 Produkte', icon: '🎄', color: colors.primary },
    { title: 'Fisch, Feinkost & mehr', count: '1556 Produkte', icon: '🐟', color: colors.primary },
  ];



  const staticMarken = [
    {
      title: '11er elfer',
      logo: '🏷️',
      description: 'Wir sind ein modernes Familienunternehmen aus dem Westen Österreichs, das sich ganz der Kartoffel verschrieben hat.',
    },
    {
      title: 'ACETUM',
      logo: '🫒',
      description: 'ACETUM hat seinen Sitz im Herzen einer der reichsten, kulinarischen Region Italiens und ist der weltweit größte Hersteller von zertifiziertem Balsamico-Essig aus Modena PGI.',
    },
    {
      title: 'AHAMA',
      logo: '🌾',
      description: 'Mit über 70 Jahren Erfahrung steht AHAMA für höchste Qualitätsstandards in der Herstellung von Naturprodukten.',
    },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'kategorien':
        return (
          <View style={styles.contentSection}>
            {categoriesLoading ? (
              <View style={[styles.marketListContainer, { backgroundColor: colors.cardBackground }]}>
                {[1, 2, 3, 4, 5].map((index) => (
                  <View 
                    key={index} 
                    style={[
                      styles.marketListItem,
                      index === 1 && styles.firstMarketItem,
                      index === 5 && styles.lastMarketItem,
                      { borderBottomColor: colors.border }
                    ]}
                  >
                    <ListItemSkeleton />
                </View>
                ))}
                </View>
            ) : (
              <View style={[styles.marketListContainer, { backgroundColor: colors.cardBackground }]}>
                {categoriesData.map((category, index) => (
                  <TouchableOpacity 
                    key={category.id} 
                    style={[
                      styles.marketListItem,
                      index === 0 && styles.firstMarketItem,
                      index === categoriesData.length - 1 && styles.lastMarketItem,
                      { borderBottomColor: colors.border }
                    ]}
                    onPress={() => {
                      // Switch to NoName tab with category filter
                      setActiveTab('nonames');
                      
                      const newFilters = {
                        ...noNameFilters,
                        categoryFilters: [category.id]
                      };
                      setNoNameFilters(newFilters);
                      
                      // Reset and load NoName products with category filter
                      setNoNameProducts([]);
                      setNoNameLastDoc(null);
                      setNoNameHasMore(true);
                      
                      setTimeout(async () => {
                        try {
                          setNoNameLoading(true);
                          const result = await FirestoreService.getNoNameProductsPaginated(
                            20,
                            null,
                            newFilters
                          );
                          setNoNameProducts(result.products);
                          setNoNameLastDoc(result.lastDoc);
                          setNoNameHasMore(result.hasMore);
                          console.log(`✅ Loaded NoName products for category: ${category.bezeichnung} (${result.products.length} products)`);
                        } catch (error) {
                          console.error('Error loading filtered products:', error);
                          setNoNameError('Fehler beim Laden der Produkte');
                        } finally {
                          setNoNameLoading(false);
                        }
                      }, 100);
                    }}
                  >
                    <View style={styles.marketLogo}>
                      {category.bild && category.bild.trim() !== '' && !failedImages.has(category.id) ? (
                        <ImageWithShimmer
                          source={{ uri: category.bild }}
                          style={styles.marketImage}
                          fallbackIcon={getCategoryIcon(category.bezeichnung.toLowerCase())}
                          fallbackIconSize={24}
                          resizeMode="contain"
                          onError={() => {
                            console.log(`Failed to load image for category: ${category.bezeichnung}`);
                            setFailedImages(prev => new Set([...prev, category.id]));
                          }}
                        />
                      ) : (
                        <IconSymbol 
                          name={getCategoryIcon(category.bezeichnung.toLowerCase())} 
                          size={24} 
                          color={colors.primary} 
                        />
                      )}
                    </View>
                    <View style={styles.marketContent}>
                      <ThemedText style={[styles.marketTitle, { color: colors.text }]}>
                        {category.bezeichnung}
                      </ThemedText>
                      <Animated.View style={{ opacity: countOpacities[category.id] || 1 }}>
                        <ThemedText style={[styles.marketCount, { color: colors.text }]}>
                          {categoryProductCounts[category.id] !== undefined 
                            ? `${categoryProductCounts[category.id]} Produkte`
                            : '... Produkte'
                          }
                        </ThemedText>
                      </Animated.View>
                    </View>
                                        <View style={styles.productChevron}>
                      <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                    </View>
              </TouchableOpacity>
            ))}
              </View>
            )}
          </View>
        );
      case 'märkte':
        return (
          <View style={styles.contentSection}>
            {marketsLoading ? (
              <View style={[styles.marketListContainer, { backgroundColor: colors.cardBackground }]}>
                {[1, 2, 3, 4, 5].map((index) => (
                  <View 
                    key={index}
                    style={[
                      styles.marketListItem,
                      index === 1 && styles.firstMarketItem,
                      index === 5 && styles.lastMarketItem,
                      index < 5 && { borderBottomColor: colors.border, borderBottomWidth: 0.5 }
                    ]}
                  >
                    <ListItemSkeleton />
                  </View>
                ))}
              </View>
            ) : (
              <View style={[styles.marketListContainer, { backgroundColor: colors.cardBackground }]}>
                {filteredMarkets.map((market, index) => (
                  <TouchableOpacity 
                    key={market.id} 
                    style={[
                      styles.marketListItem,
                      index === 0 && styles.firstMarketItem,
                      index === filteredMarkets.length - 1 && styles.lastMarketItem,
                      index < filteredMarkets.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 0.5 }
                    ]}
                    onPress={() => {
                      // Wechsle zum NoName Tab und setze Markt-Filter
                      setActiveTab('nonames');
                      
                      const newFilters = {
                        ...noNameFilters,
                        discounterFilters: [market.id] // Setze diesen Markt als Filter
                      };
                      
                      setNoNameFilters(newFilters);
                      
                      // Lade NoName Produkte mit dem neuen Filter
                      setNoNameProducts([]);
                      setNoNameLastDoc(null);
                      setNoNameHasMore(true);
                      
                      // Lade mit den neuen Filtern direkt
                      setTimeout(async () => {
                        try {
                          setNoNameLoading(true);
                          const result = await FirestoreService.getNoNameProductsPaginated(
                            20,
                            null,
                            newFilters // Verwende die neuen Filter direkt
                          );
                          setNoNameProducts(result.products);
                          setNoNameLastDoc(result.lastDoc);
                          setNoNameHasMore(result.hasMore);
                        } catch (error) {
                          console.error('Error loading filtered products:', error);
                          setNoNameError('Fehler beim Laden der Produkte');
                        } finally {
                          setNoNameLoading(false);
                        }
                      }, 100);
                    }}
                  >
                    <View style={[styles.marketLogo, { backgroundColor: colors.background }]}>
                      {market.bild && market.bild.trim() !== '' && !failedImages.has(`market-${market.id}`) ? (
                        <ImageWithShimmer
                          source={{ uri: market.bild }}
                          style={styles.marketImage}
                          fallbackIcon="storefront"
                          fallbackIconSize={20}
                          resizeMode="contain"
                          onError={() => {
                            console.log(`Failed to load image for market: ${market.name}`);
                            setFailedImages(prev => new Set([...prev, `market-${market.id}`]));
                          }}
                        />
                      ) : (
                        <IconSymbol name="storefront" size={20} color={colors.primary} />
                      )}
                </View>
                <View style={styles.marketContent}>
                  <View style={styles.marketHeader}>
                        <ThemedText style={styles.marketTitle}>
                          {market.name} - ({market.land})
                        </ThemedText>
                        <ThemedText style={styles.marketFlag}>
                          {getCountryFlag(market.land)}
                        </ThemedText>
                  </View>
                      {productCounts[market.id] !== undefined ? (
                        <Animated.View style={{ opacity: countOpacities[market.id] || 0 }}>
                          <ThemedText style={styles.marketCount}>
                            {`${productCounts[market.id]} Produkte`}
                          </ThemedText>
                        </Animated.View>
                      ) : (
                        <ThemedText style={styles.marketCount}>
                          ... Produkte
                        </ThemedText>
                      )}
                      {market.infos && (
                        <ThemedText style={styles.marketDescription} numberOfLines={2}>
                          {market.infos}
                        </ThemedText>
                      )}
                </View>
                    <View style={styles.productChevron}>
                      <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                    </View>
              </TouchableOpacity>
            ))}
                  </View>
            )}
          </View>
        );
      case 'nonames':
        console.log('🔍 Rendering NoName products:', noNameProducts.length, 'Error:', noNameError);
        return noNameError ? (
          <View style={styles.contentSection}>
            <View style={styles.errorState}>
              <IconSymbol name="exclamationmark.triangle" size={48} color={colors.error} />
              <ThemedText style={[styles.errorText, { color: colors.error }]}>
                {noNameError}
              </ThemedText>
              <TouchableOpacity 
                style={[styles.retryButton, { backgroundColor: colors.primary }]}
                onPress={() => loadNoNameProducts(true)}
              >
                <ThemedText style={styles.retryButtonText}>Erneut versuchen</ThemedText>
              </TouchableOpacity>
                </View>
                </View>
        ) : (
          <FlatList
            data={noNameProducts}
            keyExtractor={(item, index) => `${item.id}-${index}`}
                renderItem={({ item: product, index }) => (
                  <View 
                    style={[
                      styles.productItemContainer,
                      { backgroundColor: colors.cardBackground },
                      index === 0 && styles.firstProductItem,
                      index === noNameProducts.length - 1 && styles.lastProductItem,
                    ]}
                  >
                                      <TouchableOpacity 
                    style={[
                      styles.productListItem,
                      index < noNameProducts.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 0.5 }
                    ]}
                    onPress={() => {
                      const stufe = parseInt(product.stufe) || 1;
                      if (stufe <= 2) {
                        // Stufe 1 und 2: Zur speziellen NoName-Detailseite
                        router.push(`/noname-detail/${product.id}` as any);
                      } else {
                        // Stufe 3+: Zum normalen Produktvergleich
                        router.push(`/product-comparison/${product.id}?type=noname` as any);
                      }
                    }}
                  >
                    <View style={styles.productLogo}>
                      {product.bild && product.bild.trim() !== '' && !failedImages.has(`product-${product.id}`) ? (
                        <ImageWithShimmer
                          source={{ uri: product.bild }}
                          style={styles.productImage}
                          fallbackIcon="photo"
                          fallbackIconSize={24}
                          resizeMode="contain"
                          onError={() => {
                            console.log(`Failed to load image for product: ${product.name}`);
                            setFailedImages(prev => new Set([...prev, `product-${product.id}`]));
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
                        {product.name}
                      </ThemedText>
                      <ThemedText style={styles.productSubtitle}>
                        {product.handelsmarke?.bezeichnung || 'Unbekannte Handelsmarke'}
                      </ThemedText>
                      <View style={styles.productMarketRow}>
                        {product.discounter?.bild && product.discounter.bild.trim() !== '' && !failedImages.has(`market-${product.discounter.id}`) ? (
                          <ImageWithShimmer
                            source={{ uri: product.discounter.bild }}
                            style={styles.productMarketImage}
                            fallbackIcon="storefront"
                            fallbackIconSize={12}
                            resizeMode="contain"
                            onError={() => {
                              console.log(`Failed to load market image: ${product.discounter?.name}`);
                              setFailedImages(prev => new Set([...prev, `market-${product.discounter?.id}`]));
                            }}
                          />
                        ) : (
                          <View style={[styles.productMarketImagePlaceholder, { backgroundColor: colors.background }]}>
                            <IconSymbol name="storefront" size={12} color={colors.icon} />
                          </View>
                        )}
                        <ThemedText style={styles.productMarket}>
                          {product.discounter?.name || 'Unbekannter Markt'} ({product.discounter?.land || 'DE'})
                        </ThemedText>
                      </View>
                    </View>

                    {/* Rechte Seite: Stufe, Preis und Chevron */}
                    <View style={styles.productRightSection}>
                      <View style={styles.productInfoColumn}>
                        <View style={[styles.stufeBadge, { backgroundColor: getStufenColor(parseInt(product.stufe) || 1) }]}>
                          <IconSymbol name="chart.bar" size={10} color="white" />
                          <ThemedText style={styles.stufeBadgeText}>
                            {product.stufe || '1'}
                          </ThemedText>
                        </View>
                        <ThemedText style={styles.productPrice}>
                          {formatPrice(product.preis)}
                        </ThemedText>
                      </View>
                      <View style={styles.productChevron}>
                        <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                      </View>
                    </View>
              </TouchableOpacity>
          </View>
                )}
                onEndReached={() => {
                  console.log('🔄 onEndReached triggered - HasMore:', noNameHasMore, 'Loading:', noNameLoading);
                  if (noNameHasMore && !noNameLoading) {
                    loadNoNameProducts(false);
                  }
                }}
                onEndReachedThreshold={0.5}
                ListFooterComponent={() => 
                  noNameLoading ? (
                    <LoadingFooterSkeleton />
                  ) : null
                }
            style={[styles.productListContainer, { backgroundColor: colors.cardBackground }]}
            contentContainerStyle={styles.productListContent}
            showsVerticalScrollIndicator={false}
          />
        );
      case 'markenprodukte':
        console.log('🔍 Rendering Markenprodukte:', markenprodukte.length, 'Error:', markenproduktError);
        return markenproduktError ? (
          <View style={styles.contentSection}>
            <View style={styles.errorState}>
              <IconSymbol name="exclamationmark.triangle" size={48} color={colors.error} />
              <ThemedText style={[styles.errorText, { color: colors.error }]}>
                {markenproduktError}
              </ThemedText>
              <TouchableOpacity 
                style={[styles.retryButton, { backgroundColor: colors.primary }]}
                onPress={() => loadMarkenprodukte(true)}
              >
                <ThemedText style={styles.retryButtonText}>Erneut versuchen</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <FlatList
            data={markenprodukte}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            renderItem={({ item: product, index }) => (
              <View 
                style={[
                  styles.productItemContainer,
                  { backgroundColor: colors.cardBackground },
                  index === 0 && styles.firstProductItem,
                  index === markenprodukte.length - 1 && styles.lastProductItem,
                ]}
              >
                <TouchableOpacity 
                  style={[
                    styles.productListItem,
                    index < markenprodukte.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 0.5 }
                  ]}
                  onPress={() => router.push(`/product-comparison/${product.id}?type=brand` as any)}
                >
                  <View style={styles.productLogo}>
                    {product.bild && product.bild.trim() !== '' && !failedImages.has(`markenprodukt-${product.id}`) ? (
                      <ImageWithShimmer
                        source={{ uri: product.bild }}
                        style={styles.productImage}
                        fallbackIcon="cube.box"
                        fallbackIconSize={32}
                        resizeMode="contain"
                        onError={() => {
                          console.log(`Failed to load image for markenprodukt: ${product.name}`);
                          setFailedImages(prev => new Set([...prev, `markenprodukt-${product.id}`]));
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
                      {product.name}
                    </ThemedText>
                    <ThemedText style={styles.productSubtitle}>
                      {product.hersteller?.name || 'Unbekannte Marke'}
                    </ThemedText>
                  </View>

                  {/* Rechte Seite: Nur Preis und Chevron */}
                  <View style={styles.productRightSection}>
                    <View style={styles.productInfoColumn}>
                      <ThemedText style={styles.productPrice}>
                        {formatPrice(product.preis)}
                      </ThemedText>
                    </View>
                    <View style={styles.productChevron}>
                      <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            )}
            onEndReached={() => {
              console.log('🔄 onEndReached triggered - HasMore:', markenproduktHasMore, 'Loading:', markenproduktLoading);
              if (markenproduktHasMore && !markenproduktLoading) {
                loadMarkenprodukte(false);
              }
            }}
            onEndReachedThreshold={0.5}
            ListFooterComponent={() => 
              markenproduktLoading ? (
                <LoadingFooterSkeleton />
              ) : null
            }
            style={[styles.productListContainer, { backgroundColor: colors.cardBackground }]}
            contentContainerStyle={styles.productListContent}
            showsVerticalScrollIndicator={false}
          />
        );

      default:
        return (
          <View style={styles.emptyState}>
            <ThemedText style={styles.emptyText}>Inhalte für {activeTab} werden geladen...</ThemedText>
          </View>
        );
    }
  };

  return (
    <ThemedView style={styles.container}>
      {/* Tab Navigation */}
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
                size={18} 
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

            {/* Content mit Swipe-Gesten */}
      <Animated.View 
        style={[
          { flex: 1, transform: [{ translateX }] }
        ]}
        {...panResponder.panHandlers}
      >
                                {activeTab === 'nonames' || activeTab === 'markenprodukte' || activeTab === 'marken' ? (
          // ✅ FlatList direkt ohne ScrollView für Produkt-Listen und Marken - volle Höhe
          renderContent()
        ) : (
          // ScrollView für andere Tabs (märkte, kategorien)
          <ScrollView 
            style={styles.scrollView} 
            showsVerticalScrollIndicator={false}
          >
            {renderContent()}
        </ScrollView>
        )}
      </Animated.View>

      {/* Floating Filter Button - nur bei Märkte Tab */}
      {activeTab === 'märkte' && (
        <TouchableOpacity 
          style={[styles.filterFab, { backgroundColor: colors.primary }]}
          onPress={() => setShowFilterModal(true)}
        >
          <IconSymbol name="line.3.horizontal.decrease" size={20} color="white" />
          {getMarketFiltersCount() > 0 && (
            <View style={[styles.filterBadge, { backgroundColor: colors.error }]}>
              <ThemedText style={styles.filterBadgeText}>
                {getMarketFiltersCount()}
              </ThemedText>
      </View>
          )}
        </TouchableOpacity>
      )}
      
      {activeTab === 'nonames' && (
        <TouchableOpacity 
          style={[styles.filterFab, { backgroundColor: colors.primary }]}
          onPress={() => setShowNoNameFilterModal(true)}
        >
          <IconSymbol name="line.3.horizontal.decrease" size={20} color="white" />
          {getActiveFiltersCount(noNameFilters) > 0 && (
            <View style={[styles.filterBadge, { backgroundColor: colors.error }]}>
              <ThemedText style={styles.filterBadgeText}>
                {getActiveFiltersCount(noNameFilters)}
              </ThemedText>
            </View>
          )}
        </TouchableOpacity>
      )}
      
      {activeTab === 'markenprodukte' && (
        <TouchableOpacity 
          style={[styles.filterFab, { backgroundColor: colors.primary }]}
          onPress={() => setShowMarkenproduktFilterModal(true)}
        >
          <IconSymbol name="line.3.horizontal.decrease" size={20} color="white" />
          {getActiveFiltersCount(markenproduktFilters) > 0 && (
            <View style={[styles.filterBadge, { backgroundColor: colors.error }]}>
              <ThemedText style={styles.filterBadgeText}>
                {getActiveFiltersCount(markenproduktFilters)}
              </ThemedText>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Filter Modal */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={[styles.filterModalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.filterModalHeader, { borderBottomColor: colors.border }]}>
            <ThemedText style={styles.filterModalTitle}>Nach Land filtern</ThemedText>
            <TouchableOpacity onPress={() => setShowFilterModal(false)}>
              <IconSymbol name="xmark" size={24} color={colors.icon} />
            </TouchableOpacity>
      </View>

          <ScrollView style={styles.filterOptions}>
            {availableCountries.map((country) => (
              <TouchableOpacity 
                key={country}
                style={[styles.filterOption, { borderBottomColor: colors.border }]}
                onPress={() => handleCountrySelect(country)}
              >
                <ThemedText style={[styles.filterOptionText, { color: colors.text }]}>
                  {country} {getCountryFlag(country)}
                </ThemedText>
                {selectedCountry === country && (
                  <IconSymbol name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* NoName Filter Modal */}
      <Modal
        visible={showNoNameFilterModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNoNameFilterModal(false)}
      >
        <View style={[styles.filterModalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.filterModalHeader, { borderBottomColor: colors.border }]}>
            <ThemedText style={styles.filterModalTitle}>NoName-Produkte filtern</ThemedText>
            <TouchableOpacity onPress={() => setShowNoNameFilterModal(false)}>
              <IconSymbol name="xmark" size={24} color={colors.icon} />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.filterOptions}>
            {/* Clear All Button */}
            <View style={styles.filterSection}>
              <TouchableOpacity 
                style={[styles.clearAllButton, { backgroundColor: colors.primary }]}
                onPress={clearAllFilters}
              >
                <IconSymbol name="xmark.circle.fill" size={16} color="white" />
                <ThemedText style={styles.clearAllText}>Alle Filter löschen</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Markt Filter - Chips */}
            <View style={styles.filterSection}>
              <ThemedText style={[styles.filterSectionTitle, { color: colors.text }]}>Märkte</ThemedText>
              <View style={styles.chipsContainer}>
                {discounter.map((market) => (
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
                    onPress={() => toggleDiscounterFilter(market.id)}
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

            {/* Kategorie Filter - Chips */}
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
                        borderColor: colors.border
                      }
                    ]}
                    onPress={() => toggleCategoryFilter(kategorie.id)}
                  >
                    <IconSymbol 
                      name={getCategoryIcon(kategorie.bezeichnung)} 
                      size={16} 
                      color={noNameFilters.categoryFilters.includes(kategorie.id) ? 'white' : colors.primary}
                    />
                    <ThemedText style={[
                      styles.chipText, 
                      { 
                        color: noNameFilters.categoryFilters.includes(kategorie.id) 
                          ? 'white' 
                          : colors.text 
                      }
                    ]}>
                      {kategorie.bezeichnung}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Stufe Filter - Chips */}
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
                    onPress={() => toggleStufeFilter(stufe)}
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

                        {/* TODO: Marke Filter - temporär deaktiviert wegen Firestore Komplexität */}
            {/* <View style={styles.filterSection}>
              <ThemedText style={[styles.filterSectionTitle, { color: colors.text }]}>Marke</ThemedText>
              <TouchableOpacity 
                style={[styles.filterOption, { borderBottomColor: colors.border }]}
                onPress={() => setNoNameFilters(prev => ({ ...prev, markeFilter: undefined }))}
              >
                <ThemedText style={[styles.filterOptionText, { color: colors.text }]}>
                  Alle Marken
                </ThemedText>
                {!noNameFilters.markeFilter && (
                  <IconSymbol name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
              {markenData.slice(0, 20).map((marke) => (
                <TouchableOpacity 
                  key={marke.id}
                  style={[styles.filterOption, { borderBottomColor: colors.border }]}
                  onPress={() => setNoNameFilters(prev => ({ ...prev, markeFilter: marke.id }))}
                >
                  <ThemedText style={[styles.filterOptionText, { color: colors.text }]}>
                    {marke.name}
                  </ThemedText>
                  {noNameFilters.markeFilter === marke.id && (
                    <IconSymbol name="checkmark" size={20} color={colors.primary} />
                  )}
      </TouchableOpacity>
              ))}
            </View> */}
      </ScrollView>
        </View>
      </Modal>

      {/* Markenprodukte Filter Modal */}
      <Modal
        visible={showMarkenproduktFilterModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowMarkenproduktFilterModal(false)}
      >
        <View style={[styles.filterModalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.filterModalHeader, { borderBottomColor: colors.border }]}>
            <ThemedText style={styles.filterModalTitle}>Markenprodukte filtern</ThemedText>
            <TouchableOpacity onPress={() => setShowMarkenproduktFilterModal(false)}>
              <IconSymbol name="xmark" size={24} color={colors.icon} />
      </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.filterOptions}>
            {/* Clear All Button */}
            <View style={styles.filterSection}>
              <TouchableOpacity 
                style={[styles.clearAllButton, { backgroundColor: colors.primary }]}
                onPress={clearAllMarkenproduktFilters}
              >
                <IconSymbol name="xmark.circle.fill" size={16} color="white" />
                <ThemedText style={styles.clearAllText}>Alle Filter löschen</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Hersteller/Marke Filter - Suchfeld + Chips */}
            <View style={styles.filterSection}>
              <ThemedText style={[styles.filterSectionTitle, { color: colors.text }]}>
                Marken ({markenproduktFilters.herstellerFilters.length} ausgewählt)
              </ThemedText>
              
                            {/* Suchfeld im Stil der Startseite */}
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
                      onPress={() => toggleMarkenproduktHerstellerFilter(marke.id)}
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



            {/* Kategorie Filter - Chips */}
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
                        borderColor: colors.border
                      }
                    ]}
                    onPress={() => toggleMarkenproduktCategoryFilter(kategorie.id)}
                  >
                    <IconSymbol 
                      name={getCategoryIcon(kategorie.bezeichnung)} 
                      size={16} 
                      color={markenproduktFilters.categoryFilters.includes(kategorie.id) ? 'white' : colors.primary}
                    />
                    <ThemedText style={[
                      styles.chipText, 
                      { 
                        color: markenproduktFilters.categoryFilters.includes(kategorie.id) 
                          ? 'white' 
                          : colors.text 
                      }
                    ]}>
                      {kategorie.bezeichnung}
                    </ThemedText>
      </TouchableOpacity>
                ))}
              </View>
            </View>


          </ScrollView>
        </View>
      </Modal>

    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabContainer: {
    paddingTop: 60,
    borderBottomWidth: 1,
  },
  tabScroll: {
    paddingHorizontal: 8, // Weniger Padding
  },
  tab: {
    alignItems: 'center',
    paddingVertical: 10, // Weniger Padding
    paddingHorizontal: 8, // Viel weniger Padding
    marginRight: 4, // Weniger Margin
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    minWidth: 60, // Kleinere Mindestbreite
    flex: 1, // Gleichmäßige Verteilung
  },
  tabText: {
    fontSize: 10, // Kleinere Schrift
    fontFamily: 'Nunito_500Medium',
    marginTop: 2, // Weniger Margin
    textAlign: 'center',
    lineHeight: 11,
  },

  scrollView: {
    flex: 1,
  },
  contentSection: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 100, // Platz für Tab Bar + extra Abstand
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    gap: 16,
  },
  itemIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemEmoji: {
    fontSize: 24,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 2,
    lineHeight: 18,
  },
  itemSubtitle: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.7,
    lineHeight: 12,
  },
  // iOS-Style Market List Container
  marketListContainer: {
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
    overflow: 'hidden',
  },
  marketListItem: {
    flexDirection: 'row',
    paddingVertical: 10, // 40% weniger (16 → 10)
    paddingHorizontal: 16,
    gap: 12,
    alignItems: 'center', // ✅ Vertikal zentriert
  },
  firstMarketItem: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  lastMarketItem: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  marketChevron: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 20,
    height: 36, // 40% weniger (60 → 36) für kompaktere Zeilen
  },
  // Legacy market item (kept for other tabs)
  marketItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    gap: 12,
    alignItems: 'flex-start',
  },
  marketLogo: {
    width: 60,
    height: 60,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  marketEmoji: {
    fontSize: 24,
  },
  marketImage: {
    width: 44,
    height: 44,
    borderRadius: 1,
    resizeMode: 'contain',
  },

  marketContent: {
    flex: 1,
    paddingTop: 6, // Mehr Platz gegen Abschneiden
    paddingBottom: 2, // Verhindert Abschneiden am unteren Rand
  },
  marketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  marketTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    flex: 1,
    lineHeight: 18, // Etwas mehr Line-Height
    marginTop: 2, // Mehr Abstand nach oben
  },
  marketFlag: {
    fontSize: 20,
    marginLeft: 8,
  },
  marketCount: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.7,
    marginBottom: 3, // Abstand zur Beschreibung
    marginTop: 1, // Gleicher Abstand wie zur Beschreibung
    lineHeight: 14, // Etwas mehr Line-Height
  },
  marketDescription: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.8,
    lineHeight: 14,
    marginTop: 1, // Symmetrischer Abstand zur Produktzahl
  },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    opacity: 0.7,
  },

  // Floating Action Button (exakt wie auf Startseite)
  filterFab: {
    position: 'absolute',
    bottom: 120,      // Gleiche Position wie auf Startseite
    right: 20,        // Gleiche Position wie auf Startseite
    width: 48,        // Gleiche Größe wie auf Startseite
    height: 48,       // Gleiche Größe wie auf Startseite
    borderRadius: 12, // Gleicher Radius wie auf Startseite
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, // Gleiche Shadow wie auf Startseite
    shadowOpacity: 0.25,                   // Gleiche Shadow wie auf Startseite
    shadowRadius: 4,                       // Gleiche Shadow wie auf Startseite
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

  // Filter Modal
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
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 0.5,
  },
  filterOptionText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  filterSection: {
    marginBottom: 24,
  },
  filterSectionTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  clearAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginHorizontal: 20,
    gap: 8,
  },
  clearAllText: {
    color: 'white',
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
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
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    marginBottom: 8,
  },
  chipLogo: {
    width: 20,
    height: 20,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  chipImage: {
    width: 16,
    height: 16,
    borderRadius: 2,
    resizeMode: 'contain',
  },
  chipText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
  },
  filterOptionWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stufeBadgeSmall: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  stufeBadgeSmallText: {
    color: 'white',
    fontSize: 8,
    fontFamily: 'Nunito_600SemiBold',
  },

  // Product List Styles (ähnlich wie Märkte)
  productListContainer: {
    flex: 1,
  },
  productListContent: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 100,
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
  productRightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  productInfoColumn: {
    alignItems: 'center',
    gap: 4,
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
  productPrice: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    color: '#22c55e',
    textAlign: 'center',
  },
  productChevron: {
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Infinite Scroll Loading
  loadingFooter: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
  },
  errorFooter: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Error State
  errorState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  brandItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  brandLogo: {
    width: 60,
    height: 60,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandEmoji: {
    fontSize: 24,
  },
  brandContent: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
    lineHeight: 16,
  },
  brandDescription: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.8,
    lineHeight: 14,
  },
  // Alte Styles für andere Verwendung beibehalten
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 2,
    fontFamily: 'Nunito_400Regular',
  },
  
  // Neue Marken-Suchfeld Styles im Startseiten-Stil
  markenSearchSection: {
    paddingHorizontal: 20, // Bündig mit chipsContainer
    marginBottom: 16,
  },
  markenSearchContainer: {
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
  markenSearchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  // Alte Styles beibehalten für Kompatibilität
  moreMarkenHint: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 8,
    marginHorizontal: 20,
    gap: 4,
  },
  moreMarkenText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    textAlign: 'center',
  },
  moreMarkenSubtext: {
    fontSize: 10,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    opacity: 0.8,
  },
  
  // Neue kompakte Styles
  moreMarkenHintCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 6,
    marginHorizontal: 20,
    gap: 6,
    alignSelf: 'center',
    maxWidth: 200,
  },
  moreMarkenTextCompact: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    opacity: 0.7,
  },
  noResultsText: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
});
