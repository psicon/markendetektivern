import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { AllergenFilterChips } from '@/components/ui/AllergenFilterChips';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { LockedCategoryModal } from '@/components/ui/LockedCategoryModal';
import { NutritionRangeFilter } from '@/components/ui/NutritionRangeFilter';
import { ListItemSkeleton, LoadingFooterSkeleton } from '@/components/ui/ShimmerSkeleton';
import { getStufenColor } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
// Keine ExtendedFirestoreService mehr nötig
import { FirestoreService } from '@/lib/services/firestore';
import { AllergenFilters, ExtendedMarkenproduktFilters, ExtendedNoNameFilters, NutritionFilters } from '@/lib/types/filters';
import { Discounter, FirestoreDocument, Handelsmarken, Kategorien, Produkte } from '@/lib/types/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Dimensions, FlatList, Modal, PanResponder, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

const { width: screenWidth } = Dimensions.get('window');

export default function ExploreScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const params = useLocalSearchParams();
  const { userProfile } = useAuth();
  const analytics = useAnalytics();
  const [activeTab, setActiveTab] = useState('märkte');
  
  // 🎯 Journey-Tracking für Explore
  // ENTFERNT! Explore startet KEINE eigene Journey mehr.
  // Journeys werden nur auf Hauptscreens (Home) oder bei spezifischen Actions (Search, Scan) gestartet
  
  // Verarbeite Navigation-Parameter von der Startseite
  useEffect(() => {
    if (params.tab === 'nonames' && params.categoryFilter) {
      setActiveTab('nonames');
      setNoNameFilters(prev => ({
        ...prev,
        categoryFilters: [params.categoryFilter as string]
      }));
      
      // Update Journey mit Kategorie-Filter - nur einmal!
      analytics.updateJourneyFilters({
        categories: [params.categoryFilter as string]
      }, {
        action: 'added',
        filterType: 'category',
        filterValue: params.categoryName as string || params.categoryFilter as string
      });
    }
  }, [params.tab, params.categoryFilter, params.categoryName]); // Spezifische Dependencies!

  // Journey wird NICHT hier gestartet - nur einmal beim App-Start in AnalyticsProvider!
  
  // Track Tab-Wechsel - WICHTIG: Nur zwischen Produkt-Tabs tracken
  const prevActiveTab = useRef(activeTab);
  useEffect(() => {
    if (prevActiveTab.current !== activeTab) {
      // Nur tracken wenn zwischen NoName und Markenprodukte gewechselt wird
      const productTabs = ['nonames', 'markenprodukte'];
      const wasProductTab = productTabs.includes(prevActiveTab.current);
      const isProductTab = productTabs.includes(activeTab);
      
      if (wasProductTab && isProductTab) {
        // Tab-Wechsel tracken, aber Journey NICHT beenden!
        console.log(`📊 Tab-Wechsel: ${prevActiveTab.current} → ${activeTab}`);
      }
      
      prevActiveTab.current = activeTab;
    }
  }, [activeTab]);
  
  // 🎯 OPTIMIERTE Animation für Swipe-Navigation
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
  
  // Locked Category Modal State
  const [lockedCategoryModal, setLockedCategoryModal] = useState<{
    visible: boolean;
    category: FirestoreDocument<Kategorien> | null;
  }>({ visible: false, category: null });
  
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
  const [noNameFilters, setNoNameFilters] = useState<ExtendedNoNameFilters>({
    categoryFilters: [],
    discounterFilters: [],
    stufeFilters: [],
    allergenFilters: {},
    nutritionFilters: {}
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
  const [markenproduktFilters, setMarkenproduktFilters] = useState<ExtendedMarkenproduktFilters>({
    categoryFilters: [],
    herstellerFilters: [],
    allergenFilters: {},
    nutritionFilters: {}
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
    const isAdding = !noNameFilters.categoryFilters.includes(categoryId);
    
    setNoNameFilters(prev => ({
      ...prev,
      categoryFilters: prev.categoryFilters.includes(categoryId)
        ? prev.categoryFilters.filter(id => id !== categoryId)
        : [...prev.categoryFilters, categoryId]
    }));
    
    // 📊 Track Filter Change
    const category = categoriesData.find(c => c.id === categoryId);
    if (category) {
      analytics.trackFilterChanged(
        'category',
        category.bezeichnung,
        isAdding ? 'added' : 'removed',
        'explore_nonames'
      );
      
      // 🎯 Update Journey with UPDATED filters (korrekte Werte!)
      const updatedCategories = isAdding 
        ? [...noNameFilters.categoryFilters, categoryId]
        : noNameFilters.categoryFilters.filter(id => id !== categoryId);
        
      analytics.updateJourneyFilters({
        markets: noNameFilters.discounterFilters.map(id => {
          const marketData = discounter.find(d => d.id === id);
          return {
            id,
            name: marketData?.name || 'Unbekannt',
            docRef: `discounter/${id}`
          };
        }),
        categories: updatedCategories.map(id => {
          const categoryData = categoriesData.find(c => c.id === id);
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
    
    setNoNameFilters(prev => ({
      ...prev,
      discounterFilters: prev.discounterFilters.includes(discounterId)
        ? prev.discounterFilters.filter(id => id !== discounterId)
        : [...prev.discounterFilters, discounterId]
    }));
    
    // 📊 Track Filter Change
    const market = discounter.find(d => d.id === discounterId);
    if (market) {
      analytics.trackFilterChanged(
        'market',
        market.name,
        isAdding ? 'added' : 'removed',
        'explore_nonames'
      );
      
      // 🎯 Update Journey with UPDATED filters (korrekte Werte!)
      const updatedMarkets = isAdding 
        ? [...noNameFilters.discounterFilters, discounterId]
        : noNameFilters.discounterFilters.filter(id => id !== discounterId);
        
      analytics.updateJourneyFilters({
        markets: updatedMarkets.map(id => {
          const marketData = discounter.find(d => d.id === id);
          return {
            id,
            name: marketData?.name || 'Unbekannt',
            docRef: `discounter/${id}`
          };
        }),
        categories: noNameFilters.categoryFilters.map(id => {
          const categoryData = categoriesData.find(c => c.id === id);
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
    
    // 📊 Track Stufe Filter Change
    analytics.trackFilterChanged(
      'price', // Stufe ist eine Art Preis-Filter (höhere Stufe = höherer Preis)
      `stufe_${stufe}`,
      isAdding ? 'added' : 'removed',
      'explore_nonames',
      {
        stufe_level: stufe,
        total_stufe_filters: noNameFilters.stufeFilters.length + (isAdding ? 1 : -1)
      }
    );
    
    // 🎯 Update Journey with new filters
    const updatedFilters = {
      markets: noNameFilters.discounterFilters,
      categories: noNameFilters.categoryFilters,
      stufe: isAdding 
        ? [...noNameFilters.stufeFilters, stufe]
        : noNameFilters.stufeFilters.filter(s => s !== stufe),
      allergens: Object.entries(noNameFilters.allergenFilters || {}).filter(([_, v]) => v).map(([k, _]) => k),
      nutrition: Object.entries(noNameFilters.nutritionFilters || {}).filter(([_, v]) => v && (v.min !== undefined || v.max !== undefined)).map(([k, _]) => k)
    };
    
    analytics.updateJourneyFilters(updatedFilters, {
      action: isAdding ? 'added' : 'removed',
      filterType: 'stufe',
      filterValue: `stufe_${stufe}`
    });
    analytics.checkFilterComplexityOverload();
  };

  const clearAllFilters = () => {
    // Track Filter-Clearing für Journey-Analyse
    analytics.trackFilterCleared();
    
    setNoNameFilters({
      categoryFilters: [],
      discounterFilters: [],
      stufeFilters: [],
      allergenFilters: {},
      nutritionFilters: {}
    });
  };
  
  // Neue Filter-Handler für Allergene
  const toggleAllergenFilter = (allergen: keyof AllergenFilters) => {
    const isAdding = !(noNameFilters.allergenFilters || {})[allergen];
    
    setNoNameFilters(prev => ({
      ...prev,
      allergenFilters: {
        ...(prev.allergenFilters || {}),
        [allergen]: isAdding
      }
    }));

    // 📊 Track Allergen Filter Change
    analytics.trackFilterChanged(
      'allergen',
      allergen.replace('allergens_', ''),
      isAdding ? 'added' : 'removed',
      'explore_nonames',
      {
        allergen_type: allergen,
        total_allergen_filters: Object.values(noNameFilters.allergenFilters || {}).filter(Boolean).length + (isAdding ? 1 : -1)
      }
    );
    
    // 🎯 Update Journey with new filters
    const updatedFilters = {
      markets: noNameFilters.discounterFilters,
      categories: noNameFilters.categoryFilters,
      stufe: noNameFilters.stufeFilters,
      allergens: Object.entries({...(noNameFilters.allergenFilters || {}), [allergen]: isAdding}).filter(([_, v]) => v).map(([k, _]) => k)
    };
    
    analytics.updateJourneyFilters(updatedFilters);
    
    // Check für Filter-Komplexitäts-Überlastung
    analytics.checkFilterComplexityOverload();
  };
  
  // Neue Filter-Handler für Nährwerte
  const updateNutritionFilter = useCallback((filters: NutritionFilters) => {
    // Finde Änderungen für Analytics
    const oldFilters = noNameFilters.nutritionFilters;
    const newFilters = filters;
    
    // Tracke jede Änderung einzeln
    Object.entries(newFilters).forEach(([key, newRange]) => {
      const oldRange = oldFilters[key as keyof NutritionFilters];
      const hasOldRange = oldRange && (oldRange.min !== undefined || oldRange.max !== undefined);
      const hasNewRange = newRange && (newRange.min !== undefined || newRange.max !== undefined);
      
      if (!hasOldRange && hasNewRange) {
        // Neuer Filter hinzugefügt
        analytics.trackFilterChanged(
          'nutrition_range',
          key,
          'added',
          'explore_nonames',
          {
            nutrition_type: key,
            min_value: newRange.min,
            max_value: newRange.max,
            range_size: newRange.max && newRange.min ? newRange.max - newRange.min : undefined
          }
        );
      } else if (hasOldRange && !hasNewRange) {
        // Filter entfernt
        analytics.trackFilterChanged(
          'nutrition_range',
          key,
          'removed',
          'explore_nonames',
          {
            nutrition_type: key
          }
        );
      }
    });
    
    setNoNameFilters(prev => ({
      ...prev,
      nutritionFilters: filters
    }));
    
    // 🎯 Update Journey with new filters
    const updatedFilters = {
      markets: noNameFilters.discounterFilters,
      categories: noNameFilters.categoryFilters,
      stufe: noNameFilters.stufeFilters,
      allergens: Object.entries(noNameFilters.allergenFilters || {}).filter(([_, v]) => v).map(([k, _]) => k),
      nutrition: Object.entries(filters || {}).filter(([_, range]) => range && (range.min !== undefined || range.max !== undefined)).map(([k, _]) => k)
    };
    
    analytics.updateJourneyFilters(updatedFilters);
    
    // Check für Filter-Komplexitäts-Überlastung
    analytics.checkFilterComplexityOverload();
  }, [noNameFilters, analytics]); // Dependencies!
  
  // Automatisch verfügbare Kategorien als Filter hinzufügen
  const getAvailableCategoriesFilter = () => {
    const availableCategories = kategorien.filter(k => !k.isLocked);
    return availableCategories.map(k => k.id);
  };
  
  // Synchrone Filter-Validation (keine async Calls)  
  const validateFiltersSync = (filters: any) => {
    // IMMER auf verfügbare Kategorien beschränken
    const availableCategoryIds = getAvailableCategoriesFilter();
    
    let finalCategoryFilters = availableCategoryIds;
    
    // Wenn explizite Filter gesetzt: Intersection mit verfügbaren
    if (filters.categoryFilters && filters.categoryFilters.length > 0) {
      finalCategoryFilters = filters.categoryFilters.filter((categoryId: string) => {
        const isValid = availableCategoryIds.includes(categoryId);
        if (!isValid) {
          console.warn(`🔒 Kategorie ${categoryId} ist gesperrt - aus Filter entfernt`);
        }
        return isValid;
      });
      console.log(`🔍 Explizite Filter: ${filters.categoryFilters.length} → ${finalCategoryFilters.length} verfügbar`);
    } else {
      console.log(`🔍 Keine expliziten Filter → Verwende alle ${finalCategoryFilters.length} verfügbaren Kategorien`);
    }
    
    return {
      ...filters,
      categoryFilters: finalCategoryFilters, // Immer nur verfügbare Kategorien
      sortBy: filters.sortBy || 'name' // Sortierung beibehalten
    };
  };

  // Helper functions for Markenprodukte filters
  const toggleMarkenproduktCategoryFilter = (categoryId: string) => {
    const isAdding = !markenproduktFilters.categoryFilters.includes(categoryId);
    
    setMarkenproduktFilters(prev => ({
      ...prev,
      categoryFilters: prev.categoryFilters.includes(categoryId)
        ? prev.categoryFilters.filter(id => id !== categoryId)
        : [...prev.categoryFilters, categoryId]
    }));
    
    // 📊 Track Filter Change
    const category = categoriesData.find(c => c.id === categoryId);
    if (category) {
      analytics.trackFilterChanged(
        'category',
        category.bezeichnung,
        isAdding ? 'added' : 'removed',
        'explore_markenprodukte'
      );
    }
  };



  const toggleMarkenproduktHerstellerFilter = (herstellerId: string) => {
    const isAdding = !markenproduktFilters.herstellerFilters.includes(herstellerId);
    
    setMarkenproduktFilters(prev => ({
      ...prev,
      herstellerFilters: prev.herstellerFilters.includes(herstellerId)
        ? prev.herstellerFilters.filter(id => id !== herstellerId)
        : [...prev.herstellerFilters, herstellerId]
    }));
    
    // 📊 Track Hersteller Filter Change
    const hersteller = markenData.find(h => h.id === herstellerId);
    if (hersteller) {
      analytics.trackFilterChanged(
        'market', // Hersteller ist ähnlich wie Markt-Filter
        hersteller.name || herstellerId,
        isAdding ? 'added' : 'removed',
        'explore_markenprodukte',
        {
          hersteller_id: herstellerId,
          total_hersteller_filters: markenproduktFilters.herstellerFilters.length + (isAdding ? 1 : -1)
        }
      );
    }
    
    // 🎯 Update Journey with new filters
    const updatedFilters = {
      categories: markenproduktFilters.categoryFilters,
      hersteller: isAdding 
        ? [...markenproduktFilters.herstellerFilters, herstellerId]
        : markenproduktFilters.herstellerFilters.filter(id => id !== herstellerId),
      allergens: Object.entries(markenproduktFilters.allergenFilters || {}).filter(([_, v]) => v).map(([k, _]) => k),
      nutrition: Object.entries(markenproduktFilters.nutritionFilters || {}).filter(([_, v]) => v && (v.min !== undefined || v.max !== undefined)).map(([k, _]) => k)
    };
    
    analytics.updateJourneyFilters(updatedFilters);
    analytics.checkFilterComplexityOverload();
  };

  const clearAllMarkenproduktFilters = () => {
    // Track Filter-Clearing für Journey-Analyse
    analytics.trackFilterCleared();
    
    setMarkenproduktFilters({
      categoryFilters: [],
      herstellerFilters: [],
      allergenFilters: {},
      nutritionFilters: {}
    });
  };
  
  // Neue Filter-Handler für Markenprodukte Allergene
  const toggleMarkenproduktAllergenFilter = (allergen: keyof AllergenFilters) => {
    const isAdding = !(markenproduktFilters.allergenFilters || {})[allergen];
    
    setMarkenproduktFilters(prev => ({
      ...prev,
      allergenFilters: {
        ...(prev.allergenFilters || {}),
        [allergen]: isAdding
      }
    }));

    // 📊 Track Allergen Filter Change
    analytics.trackFilterChanged(
      'allergen',
      allergen.replace('allergens_', ''),
      isAdding ? 'added' : 'removed',
      'explore_markenprodukte',
      {
        allergen_type: allergen,
        total_allergen_filters: Object.values(markenproduktFilters.allergenFilters || {}).filter(Boolean).length + (isAdding ? 1 : -1)
      }
    );
    
    // 🎯 Update Journey with new filters
    analytics.updateJourneyFilters({
      categories: markenproduktFilters.categoryFilters,
      hersteller: markenproduktFilters.herstellerFilters,
      allergens: Object.entries({...(markenproduktFilters.allergenFilters || {}), [allergen]: isAdding}).filter(([_, v]) => v).map(([k, _]) => k)
    });
  };
  
  // Neue Filter-Handler für Markenprodukte Nährwerte
  const updateMarkenproduktNutritionFilter = useCallback((filters: NutritionFilters) => {
    // Finde Änderungen für Analytics
    const oldFilters = markenproduktFilters.nutritionFilters;
    const newFilters = filters;
    
    // Tracke jede Änderung einzeln
    Object.entries(newFilters).forEach(([key, newRange]) => {
      const oldRange = oldFilters[key as keyof NutritionFilters];
      const hasOldRange = oldRange && (oldRange.min !== undefined || oldRange.max !== undefined);
      const hasNewRange = newRange && (newRange.min !== undefined || newRange.max !== undefined);
      
      if (!hasOldRange && hasNewRange) {
        // Neuer Filter hinzugefügt
        analytics.trackFilterChanged(
          'nutrition_range',
          key,
          'added',
          'explore_markenprodukte',
          {
            nutrition_type: key,
            min_value: newRange.min,
            max_value: newRange.max,
            range_size: newRange.max && newRange.min ? newRange.max - newRange.min : undefined
          }
        );
      } else if (hasOldRange && !hasNewRange) {
        // Filter entfernt
        analytics.trackFilterChanged(
          'nutrition_range',
          key,
          'removed',
          'explore_markenprodukte',
          {
            nutrition_type: key
          }
        );
      }
    });
    
    setMarkenproduktFilters(prev => ({
      ...prev,
      nutritionFilters: filters
    }));
    
    // 🎯 Update Journey with new filters
    analytics.updateJourneyFilters({
      categories: markenproduktFilters.categoryFilters,
      hersteller: markenproduktFilters.herstellerFilters,
      allergens: Object.entries(markenproduktFilters.allergenFilters || {}).filter(([_, v]) => v).map(([k, _]) => k),
      nutrition: Object.entries(filters || {}).filter(([_, range]) => range && (range.min !== undefined || range.max !== undefined)).map(([k, _]) => k)
    });
  }, [markenproduktFilters, analytics]); // Dependencies!

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
    
    // Zähle Allergen-Filter
    if (filters.allergenFilters) {
      count += Object.values(filters.allergenFilters).filter(v => v === true).length;
    }
    
    // Zähle Nährwert-Filter
    if (filters.nutritionFilters) {
      const nutritionKeys = ['calories', 'saturatedFat', 'sugar', 'protein', 'carbohydrates', 'totalFat'] as const;
      count += nutritionKeys.filter(key => {
        const filter = filters.nutritionFilters[key];
        return filter && (filter.min !== undefined || filter.max !== undefined);
      }).length;
    }
    
    return count;
  };

  const getMarketFiltersCount = () => {
    // Badge zeigen wenn ein spezifisches Land gewählt ist (inkl. Deutschland als Standard)
    // Nur bei "Alle Länder" ist kein Filter aktiv
    return selectedCountry !== 'Alle Länder' ? 1 : 0;
  };

  // Swipe Navigation Logic - KORREKTE Reihenfolge wie in UI
  const tabOrder = ['märkte', 'kategorien', 'markenprodukte', 'nonames'];
  
  // 🎯 OPTIMIERTE Tab-Wechsel Animation (smoother Timing)
  const switchToTab = (newTab: string) => {
    if (isAnimating.current || newTab === activeTab) return;
    
    const currentIndex = tabOrder.indexOf(activeTab);
    const newIndex = tabOrder.indexOf(newTab);
    const direction = newIndex > currentIndex ? -1 : 1;
    
    isAnimating.current = true;
    
    // 🚀 VERBESSERTE Animation-Parameter:
    // Slide-out Animation (schneller)
    Animated.timing(translateX, {
      toValue: direction * screenWidth,
      duration: 150, // 200→150: snappier
      useNativeDriver: true,
    }).start(() => {
      // Track Tab-Switch für Abbruch-Analyse
      analytics.trackTabSwitched(activeTab, newTab);
      
      // Tab wechseln
      setActiveTab(newTab);
      
      // Von der anderen Seite einsliden
      translateX.setValue(-direction * screenWidth);
      
      // Slide-in Animation (schneller)
      Animated.timing(translateX, {
        toValue: 0,
        duration: 150, // 200→150: snappier
        useNativeDriver: true,
      }).start(() => {
        isAnimating.current = false;
      });
    });
  };
  
  // 🎯 OPTIMIERTER PanResponder (kleine Performance-Verbesserung)
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (evt, gestureState) => {
      return Math.abs(gestureState.dx) > Math.abs(gestureState.dy) && Math.abs(gestureState.dx) > 8; // 10→8: responsiver
    },
    
    onPanResponderMove: (evt, gestureState) => {
      // Live-Feedback während des Swipes - weniger Resistance
      const maxTranslation = screenWidth * 0.2; // 30%→20%: weniger Widerstand
      let translation = Math.max(-maxTranslation, Math.min(maxTranslation, gestureState.dx));
      
      translateX.setValue(translation);
    },
    
    onPanResponderRelease: (evt, gestureState) => {
      const currentIndex = tabOrder.indexOf(activeTab);
      const threshold = screenWidth * 0.15; // 25%→15%: einfacher zu triggern
      
      if (Math.abs(gestureState.dx) > threshold) {
        let nextIndex;
        
        if (gestureState.dx < 0) {
          // Swipe nach LINKS = NÄCHSTER Tab
          nextIndex = (currentIndex + 1) % tabOrder.length;
        } else {
          // Swipe nach RECHTS = VORHERIGER Tab  
          nextIndex = (currentIndex - 1 + tabOrder.length) % tabOrder.length;
        }
        
        switchToTab(tabOrder[nextIndex]);
        return;
      }
      
      // Zurück zur ursprünglichen Position - schnellere Animation
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        tension: 120, // Höher = schnapper
        friction: 6,  // Niedriger = weniger Dampfing
      }).start();
    },
  });



  // Load NoName Products with pagination
  const loadNoNameProducts = async (reset: boolean = false) => {
    if (noNameLoading || (!noNameHasMore && !reset)) return;
    
    try {
      setNoNameLoading(true);
      setNoNameError(null);

      // Nutze die normale FirestoreService mit erweiterten Filtern
      const result = await FirestoreService.getNoNameProductsPaginated(
        20, // Page size
        reset ? null : noNameLastDoc,
        {
          categoryFilters: noNameFilters.categoryFilters,
          discounterFilters: noNameFilters.discounterFilters,
          stufeFilters: noNameFilters.stufeFilters,
          priceMin: noNameFilters.priceMin,
          priceMax: noNameFilters.priceMax,
          allergenFilters: noNameFilters.allergenFilters,
          nutritionFilters: noNameFilters.nutritionFilters,
          sortBy: 'name'
        }
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
    
    try {
      setMarkenproduktLoading(true);
      setMarkenproduktError(null);

      // Nutze die normale FirestoreService mit erweiterten Filtern
      const result = await FirestoreService.getMarkenproduktePaginated(
        20, // Page size
        reset ? null : markenproduktLastDoc,
        {
          categoryFilters: markenproduktFilters.categoryFilters,
          herstellerFilters: markenproduktFilters.herstellerFilters,
          priceMin: markenproduktFilters.priceMin,
          priceMax: markenproduktFilters.priceMax,
          allergenFilters: markenproduktFilters.allergenFilters,
          nutritionFilters: markenproduktFilters.nutritionFilters,
          sortBy: 'name'
        }
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

  // Verhindere mehrfache Initialisierung
  const hasInitialized = useRef(false);

  // Load markets data
  useEffect(() => {
    // Verhindere mehrfache Ausführung bei schnellen userProfile-Updates
    if (hasInitialized.current) {
      console.log('⚠️ Explore: Markets/Categories bereits geladen - überspringe');
      return;
    }
    const loadMarkets = async () => {
      try {
        setMarketsLoading(true);
        
        // Lade Märkte SOFORT - ohne Produktzählung
        const discounterData = await FirestoreService.getDiscounter();

        
        // Sortiere Märkte alphabetisch nach Name
        const sortedDiscounter = discounterData.sort((a, b) => 
          a.name.localeCompare(b.name, 'de')
        );
        setDiscounter(sortedDiscounter);
        setMarketsLoading(false); // ✅ Märkte sofort anzeigen!
        
        // Lade Produktanzahl im Hintergrund (nicht blockierend, individuell)

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
        

        
      } catch (error) {
        console.error('Error loading markets:', error);
        setMarketsLoading(false);
      }
    };

    // Load categories data - ähnlich wie loadMarkets
    const loadCategories = async () => {
      try {
        setCategoriesLoading(true);
        
        // User Level für Kategorie-Zugriff
        const userLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
        
        // Lade Kategorien mit Access-Information
        const categoriesWithAccess = await categoryAccessService.getAllCategoriesWithAccess(userLevel);
        
        // Zeige ALLE Kategorien, auch gesperrte (wie auf Startseite)
        setCategoriesData(categoriesWithAccess);
        setCategoriesLoading(false); // ✅ Kategorien sofort anzeigen!
        
        // Lade Produktanzahl im Hintergrund (nicht blockierend)

        
        // Lade jeden Count individuell und update sofort (nicht blockierend)
        // Für ALLE Kategorien (auch gesperrte) um Wert zu zeigen
        categoriesWithAccess.forEach(async (category, index) => {
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
        

        
      } catch (error) {
        console.error('Error loading categories:', error);
        setCategoriesLoading(false);
      }
    };

    loadMarkets();
    loadCategories();
    hasInitialized.current = true; // Markiere als initialisiert
  }, [userProfile?.stats?.currentLevel, userProfile?.level]); // Nur bei Level-Änderung, nicht bei jedem Profile-Update



  // Handle URL parameters for navigation from other screens
  useEffect(() => {
    if (params.tab) {
      setActiveTab(params.tab as string);
    }
    
    if (params.categoryFilter && params.categoryName) {
      console.log(`🔗 Processing URL params - Category: ${params.categoryName}, Filter: ${params.categoryFilter}`);
      
      // Prüfe ob Kategorie verfügbar ist
      const checkCategoryAccess = async () => {
        const userLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
        const isAvailable = await categoryAccessService.isCategoryAvailable(params.categoryFilter as string, userLevel);
        
        if (!isAvailable) {
          // Kategorie ist gesperrt - zeige Hinweis und navigiere zurück
          Alert.alert(
            'Kategorie gesperrt 🔒',
            `Die Kategorie "${params.categoryName}" ist noch nicht verfügbar. Du musst ein höheres Level erreichen.`,
            [
              { text: 'OK', onPress: () => router.back() }
            ]
          );
          return;
        }
        
        // Kategorie ist verfügbar - setze Filter
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

            // Validiere Filter vor der Abfrage (synchron)
            const validatedFilters = validateFiltersSync({
              ...newFilters,
              sortBy: 'name'
            });
            
            const result = await FirestoreService.getNoNameProductsPaginated(
              20,
              null,
              validatedFilters
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
        };
        
        loadFilteredProducts();
      };
      
      checkCategoryAccess();
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

          // Validiere Filter vor der Abfrage (synchron)
          const validatedFilters = validateFiltersSync({
            ...newFilters,
            sortBy: 'name'
          });
          
          const result = await FirestoreService.getMarkenproduktePaginated(
            20,
            null,
            validatedFilters
          );
          setMarkenprodukte(result.products);
          setMarkenproduktLastDoc(result.lastDoc);
          setMarkenproduktHasMore(result.hasMore);

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
        // User Level für Filter-Kategorien
        const userLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
        
        const [kategorienWithAccess, markenData] = await Promise.all([
          categoryAccessService.getAllCategoriesWithAccess(userLevel),
          FirestoreService.getMarken()
        ]);
        setKategorien(kategorienWithAccess);
        setMarkenData(markenData);

      } catch (error) {
        console.error('Error loading filter options:', error);
      }
    };

    loadFilterOptions();
  }, [userProfile?.stats?.currentLevel, userProfile?.level]); // 🎯 NUR bei Level-Änderung neu laden!

  // Load NoName Products when tab becomes active or filters change
  useEffect(() => {
    if (activeTab === 'nonames' && kategorien.length > 0) { // Warte auf Kategorien
      loadNoNameProducts(true);
    }
  }, [activeTab, noNameFilters, kategorien]);

  // Load Markenprodukte when tab becomes active or filters change
  useEffect(() => {
    if (activeTab === 'markenprodukte' && kategorien.length > 0) { // Warte auf Kategorien
      loadMarkenprodukte(true);
    }
  }, [activeTab, markenproduktFilters, kategorien]);

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
                      index < categoriesData.length - 1 && { 
                        borderBottomColor: colors.border, 
                        borderBottomWidth: 0.5 
                      },
                      category.isLocked && { opacity: 0.6 } // Ausgegraut für gesperrte
                    ]}
                    onPress={() => {
                      if (category.isLocked) {
                        // Zeige gesperrte Kategorie Modal
                        setLockedCategoryModal({
                          visible: true,
                          category: category
                        });
                        return;
                      }
                      
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
                          // Validiere Filter vor der Abfrage (synchron)
                          const validatedFilters = validateFiltersSync({
                            ...newFilters,
                            sortBy: 'name'
                          });
                          
                          const result = await FirestoreService.getNoNameProductsPaginated(
                            20,
                            null,
                            validatedFilters
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
                    <View style={styles.marketLogo}>
                      {category.bild && category.bild.trim() !== '' && !failedImages.has(category.id) ? (
                        <ImageWithShimmer
                          source={{ uri: category.bild }}
                          style={[
                            styles.marketImage,
                            category.isLocked && styles.marketImageLocked
                          ]}
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
                          color={category.isLocked ? colors.icon : colors.primary}
                        />
                      )}
                      {category.isLocked && (
                        <View style={styles.marketLockBadge}>
                          <IconSymbol name="lock" size={12} color="white" />
                        </View>
                      )}
                    </View>
                    <View style={styles.marketContent}>
                      <ThemedText style={[
                        styles.marketTitle, 
                        { color: category.isLocked ? colors.icon : colors.text }
                      ]}>
                        {category.bezeichnung}
                      </ThemedText>
                      <Animated.View style={{ opacity: countOpacities[category.id] || 1 }}>
                        <ThemedText style={[
                          styles.marketCount, 
                          { 
                            color: category.isLocked ? colors.icon : colors.text, 
                            marginTop: -1
                          }
                        ]}>
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
                          // Validiere Filter vor der Abfrage (synchron)
                          const validatedFilters = validateFiltersSync({
                            ...newFilters,
                            sortBy: 'name'
                          });
                          
                          const result = await FirestoreService.getNoNameProductsPaginated(
                            20,
                            null,
                            validatedFilters // Verwende die validierten Filter
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
                          {market.name}
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
                      // 🎯 Track Product View mit Journey-Context
                      analytics.trackProductViewWithJourney(
                        product.id,
                        'noname',
                        product.name || product.produktName || 'NoName Produkt',
                        index
                      );
                      
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
                  onPress={() => {
                    // 🎯 Track Product View mit Journey-Context
                    analytics.trackProductViewWithJourney(
                      product.id,
                      'brand',
                      product.name || product.produktName || 'Markenprodukt',
                      index
                    );
                    
                    router.push(`/product-comparison/${product.id}?type=brand` as any);
                  }}
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

      {/* Content mit optimiertem Swipe-Verhalten */}
      <Animated.View 
        style={[
          { flex: 1, transform: [{ translateX }] }
        ]}
        {...panResponder.panHandlers}
      >
        {activeTab === 'nonames' || activeTab === 'markenprodukte' ? (
          // ✅ FlatList direkt ohne ScrollView für Produkt-Listen - volle Höhe
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
                        borderColor: colors.border,
                        opacity: kategorie.isLocked ? 0.4 : 1
                      }
                    ]}
                    onPress={kategorie.isLocked ? undefined : () => toggleCategoryFilter(kategorie.id)}
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

                        {/* Allergene Filter */}
            <View style={styles.filterSection}>
              <AllergenFilterChips
                selectedAllergens={noNameFilters.allergenFilters || {}}
                onToggleAllergen={toggleAllergenFilter}
              />
            </View>

            {/* Nährwerte Filter */}
            <View style={styles.filterSection}>
              <NutritionRangeFilter
                nutritionFilters={noNameFilters.nutritionFilters || {}}
                onUpdateFilter={(filters) => {
                  setNoNameFilters(prev => ({
                    ...prev,
                    nutritionFilters: filters
                  }));
                }}
              />
            </View>
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
                        borderColor: colors.border,
                        opacity: kategorie.isLocked ? 0.4 : 1
                      }
                    ]}
                    onPress={kategorie.isLocked ? undefined : () => toggleMarkenproduktCategoryFilter(kategorie.id)}
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

            {/* Allergene Filter */}
            <View style={styles.filterSection}>
              <AllergenFilterChips
                selectedAllergens={markenproduktFilters.allergenFilters || {}}
                onToggleAllergen={toggleMarkenproduktAllergenFilter}
              />
            </View>

            {/* Nährwerte Filter */}
            <View style={styles.filterSection}>
              <NutritionRangeFilter
                nutritionFilters={markenproduktFilters.nutritionFilters || {}}
                onUpdateFilter={(filters) => {
                  setMarkenproduktFilters(prev => ({
                    ...prev,
                    nutritionFilters: filters
                  }));
                }}
              />
            </View>

          </ScrollView>
        </View>
      </Modal>

      {/* Locked Category Modal */}
      {lockedCategoryModal.category && (
        <LockedCategoryModal
          visible={lockedCategoryModal.visible}
          categoryName={lockedCategoryModal.category.bezeichnung}
          categoryImage={lockedCategoryModal.category.bild}
          requiredLevel={lockedCategoryModal.category.requiredLevel || 1}
          currentLevel={userProfile?.stats?.currentLevel || userProfile?.level || 1}
          onClose={() => setLockedCategoryModal({ visible: false, category: null })}
          onNavigateToLevels={() => {
            setLockedCategoryModal({ visible: false, category: null });
            router.push('/achievements' as any);
          }}
        />
      )}

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
    paddingBottom: Platform.OS === 'ios' ? 100 : 20, // Platz für Tab Bar + extra Abstand
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
    position: 'relative', // Für Lock-Badge Positionierung
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
  marketImageLocked: {
    opacity: 0.5,
  },
  marketLockBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
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
  chipCategoryImage: {
    width: 16,
    height: 16,
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
  // Country Hint Styles
  countryHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
    gap: 6,
  },
  countryHintText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
  },
  noResultsText: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },

  // 🎯 Optimiertes Content-Layout
  contentContainer: {
    flex: 1,
  },
});
