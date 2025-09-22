import { AddCustomItemModal } from '@/components/ui/AddCustomItemModal';
import BatchActionLoader from '@/components/ui/BatchActionLoader';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { LevelUpOverlay } from '@/components/ui/LevelUpOverlay';
import { ShimmerSkeleton } from '@/components/ui/ShimmerSkeleton';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { TOAST_MESSAGES } from '@/constants/ToastMessages';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useTheme } from '@/lib/contexts/ThemeContext';
import achievementService from '@/lib/services/achievementService';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
import { FirestoreService } from '@/lib/services/firestore';
import { showBulkConvertSuccessToast, showBulkPurchasedToast, showConvertSuccessToast, showInfoToast, showPurchasedToast } from '@/lib/services/ui/toast';
import { updateUserStats } from '@/lib/services/userProfile';
import {
    Einkaufswagen,
    FirestoreDocument,
    MarkenProdukte,
    ProductToConvert,
    Produkte
} from '@/lib/types/firestore';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

// 🚀 HELPER: Optimierte Ersparnis-Berechnung (nutzt serverseitige Felder wenn verfügbar)
const getSavingsData = (brandProduct: any, noNameProduct: any): { savingsEur: number; savingsPercent: number } => {
  // 🚀 OPTIMIERUNG: Nutze serverseitige Berechnung falls vorhanden
  if (noNameProduct.ersparnis !== undefined && noNameProduct.ersparnisProz !== undefined) {
    if (__DEV__ && Math.random() < 0.05) { // Nur 5% der Shopping-List Aufrufe loggen
      console.log(`💰 Einkaufszettel: Using server-calculated savings: €${noNameProduct.ersparnis}, ${noNameProduct.ersparnisProz}%`);
    }
    return {
      savingsEur: parseFloat(String(noNameProduct.ersparnis || 0)),
      savingsPercent: parseInt(String(noNameProduct.ersparnisProz || 0))
    };
  }
  
  // 🔄 FALLBACK: Client-side Berechnung (für noch nicht berechnete oder Stufe 1,2)
  if (__DEV__ && Math.random() < 0.05) {
    console.log('🔄 Einkaufszettel: Calculating savings client-side (Firestore fields missing)');
  }
  
  if (!brandProduct.preis || !noNameProduct.preis || !brandProduct.packSize || !noNameProduct.packSize) {
    return { savingsEur: 0, savingsPercent: 0 };
  }
  
  // Preis pro Einheit (Gramm/Milliliter) - wie alte calculateSavings Logik
  const brandPricePerUnit = brandProduct.preis / brandProduct.packSize;
  const noNamePricePerUnit = noNameProduct.preis / noNameProduct.packSize;
  
  // Ersparnis in Prozent
  const savingsPercent = ((brandPricePerUnit - noNamePricePerUnit) / brandPricePerUnit) * 100;
  
  // Ersparnis in Euro (basiert auf NoName packSize - konsistent mit alter Logik)
  const savingsEur = Math.max(0, (brandPricePerUnit - noNamePricePerUnit) * noNameProduct.packSize);
  
  return {
    savingsEur: Math.round(savingsEur * 100) / 100,
    savingsPercent: Math.max(0, Math.round(savingsPercent))
  };
};

// Einfacher Shopping List Skeleton
const ShoppingListSkeleton = () => {
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];

  return (
 
      
        <View style={styles.productContainer}>
          <View  style={[styles.productCard, { backgroundColor: colors.cardBackground, marginBottom: 12 }]}>
            <ShimmerSkeleton width={60} height={60} borderRadius={8}  style={{ marginLeft: 12 , marginTop: 12, marginRight: 12, marginBottom: 12 } } />

            <View style={{ alignItems: 'center', width: 80 }}>
               
            </View>
          </View>
          <View  style={[styles.productCard, { backgroundColor: colors.cardBackground, marginBottom: 12 }]}>
            <ShimmerSkeleton width={60} height={60} borderRadius={8}  style={{ marginLeft: 12 , marginTop: 12, marginRight: 12, marginBottom: 12 } } />

            <View style={{ alignItems: 'center', width: 80 }}>
               
            </View>
          </View>
          <View  style={[styles.productCard, { backgroundColor: colors.cardBackground, marginBottom: 12 }]}>
            <ShimmerSkeleton width={60} height={60} borderRadius={8}  style={{ marginLeft: 12 , marginTop: 12, marginRight: 12, marginBottom: 12 } } />

            <View style={{ alignItems: 'center', width: 80 }}>
               
            </View>
          </View>
          <View  style={[styles.productCard, { backgroundColor: colors.cardBackground, marginBottom: 12 }]}>
            <ShimmerSkeleton width={60} height={60} borderRadius={8}  style={{ marginLeft: 12 , marginTop: 12, marginRight: 12, marginBottom: 12 } } />

            <View style={{ alignItems: 'center', width: 80 }}>
               
            </View>
          </View>
             <View  style={[styles.productCard, { backgroundColor: colors.cardBackground, marginBottom: 12 }]}>
            <ShimmerSkeleton width={60} height={60} borderRadius={8}  style={{ marginLeft: 12 , marginTop: 12, marginRight: 12, marginBottom: 12 } } />

            <View style={{ alignItems: 'center', width: 80 }}>
               
            </View>
          </View>
          <View  style={[styles.productCard, { backgroundColor: colors.cardBackground, marginBottom: 12 }]}>
            <ShimmerSkeleton width={60} height={60} borderRadius={8}  style={{ marginLeft: 12 , marginTop: 12, marginRight: 12, marginBottom: 12 } } />

            <View style={{ alignItems: 'center', width: 80 }}>
               
            </View>
          </View>
          </View>
        
      

  );
};

export default function ShoppingListScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, userProfile } = useAuth();
  const analytics = useAnalytics();
  const insets = useSafeAreaInsets();
  
  const [activeTab, setActiveTab] = useState<'brand' | 'noname'>('brand');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shoppingCartItems, setShoppingCartItems] = useState<FirestoreDocument<Einkaufswagen>[]>([]);
  const [brandProducts, setBrandProducts] = useState<any[]>([]);
  const [noNameProducts, setNoNameProducts] = useState<any[]>([]);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [selectedConversions, setSelectedConversions] = useState<ProductToConvert[]>([]);
  const [totalPotentialSavings, setTotalPotentialSavings] = useState(0);
  const [totalActualSavings, setTotalActualSavings] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [showInfoSheet, setShowInfoSheet] = useState(false);
  
  // Filter States
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    markets: [] as string[],
    categories: [] as string[],
    sortBy: 'name' as 'name' | 'price' | 'savings'
  });
  const [availableMarkets, setAvailableMarkets] = useState<any[]>([]);
  const [availableCategories, setAvailableCategories] = useState<any[]>([]);
  
  // Toasts laufen jetzt global über zentrale Toast-Library
  
  // Level-Up Overlay State (spektakuläre Animation)
  const [showLevelUpOverlay, setShowLevelUpOverlay] = useState(false);
  const [levelUpData, setLevelUpData] = useState<{ newLevel: number; oldLevel: number }>({ 
    newLevel: 1, 
    oldLevel: 1 
  });
  
  // Custom Item Modal State
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  
  // Loading States für Button-Aktionen
  const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());
  
  // Batch Action Loader States
  const [purchaseLoaderState, setPurchaseLoaderState] = useState<{
    visible: boolean;
    processedItems: number;
    totalItems: number;
    currentItem: string;
  }>({
    visible: false,
    processedItems: 0,
    totalItems: 0,
    currentItem: ''
  });
  
  const [convertLoaderState, setConvertLoaderState] = useState<{
    visible: boolean;
    processedItems: number;
    totalItems: number;
    currentItem: string;
  }>({
    visible: false,
    processedItems: 0,
    totalItems: 0,
    currentItem: ''
  });
  const [deletingItems, setDeletingItems] = useState<Set<string>>(new Set());
  const [convertingItems, setConvertingItems] = useState<Set<string>>(new Set());
  
  const tabIndicatorPosition = useState(new Animated.Value(0))[0];
  const pagerRef = useRef<PagerView>(null);

  // Gamified toast helper
  const showGameToast = (message: string, type: 'success' | 'error' | 'info' = 'success', enableAudio = true) => {
    showInfoToast(message, type);
  };

  // Helper ganz oben in der Datei
const safeCall = (fn?: (...a: any[]) => any, ...args: any[]) => {
  try { fn?.(...args); } catch (e) { if (__DEV__) console.warn('non-critical error', e); }
};
const safeAsync = async (p: Promise<any>) => {
  try { await p; } catch (e) { if (__DEV__) console.warn('non-critical async error', e); }
};

  // Header konfigurieren
  useLayoutEffect(() => {
    navigation.setOptions({
      ...getNavigationHeaderOptions(colorScheme, 'Einkaufszettel'),
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setShowCustomItemModal(true)}
          style={{ paddingRight: 16 }}
        >
          <IconSymbol name="plus" size={20} color="white" />
        </TouchableOpacity>
      ),
    });
  }, [colorScheme, navigation]);
  
  // 🚫 KEIN lokaler Achievement-Handler mehr!
  // Achievements werden jetzt ZENTRAL über GamificationProvider mit großen Lottie-Overlays angezeigt!
  
  // Load shopping cart data
  const loadShoppingCart = useCallback(async () => {
    if (!user?.uid) return;
    

    
    try {
      setLoading(true);
      
      // Reset selectedConversions to prevent accumulation on reload
      setSelectedConversions([]);
      
      // Load shopping cart items
      const items = await FirestoreService.getShoppingCartItems(user.uid);
      setShoppingCartItems(items);
      
      // 🚀 PERFORMANCE FIX: Parallele Verarbeitung aller Items!
      if (__DEV__ && typeof console.time === 'function') console.time('⚡ Parallele Einkaufszettel-Verarbeitung');
      
      // Separiere Custom Items (keine DB-Calls nötig)
      const customBrandItems = [];
      const customNoNameItems = [];
      const dbItems = [];
      
      for (const item of items) {
        if (item.customItem) {
          const customItemData = {
            id: item.id,
            name: item.customItem.name,
            isCustom: true,
            customType: item.customItem.type,
            marketName: item.customItem.marketName,
            marketLand: item.customItem.marketLand,
            marketBild: item.customItem.marketBild,
            gekauft: item.gekauft,
            einkaufswagenRef: item.id,
            // Markt für NoName Items
            ...(item.customItem.type === 'noname' && {
              markt: {
                name: item.customItem.marketName,
                land: item.customItem.marketLand,
                bild: item.customItem.marketBild
              }
            })
          };
          
          if (item.customItem.type === 'brand') {
            customBrandItems.push(customItemData);
          } else {
            customNoNameItems.push(customItemData);
          }
        } else {
          dbItems.push(item);
        }
      }
      
      // 🚀 PARALLELE VERARBEITUNG: Alle DB-Items parallel laden
      const processedItems = await Promise.all(dbItems.map(async (item) => {
        try {
          if (item.markenProdukt) {
            // Brand Product Parallel Loading
            const [productData, alternatives] = await Promise.all([
              FirestoreService.getDocumentByReference<MarkenProdukte>(item.markenProdukt),
              FirestoreService.getNoNameAlternatives(item.markenProdukt.id, userProfile?.favoriteMarket)
            ]);
            
            if (productData) {
              // Load hersteller parallel zu alternatives (schon geladen)
              let herstellerData = null;
              if (productData.hersteller) {
                try {
                  herstellerData = await FirestoreService.getDocumentByReference(productData.hersteller);
                } catch (error) {
                  console.error('Error loading hersteller for brand product:', error);
                }
              }
              
              // Calculate potential savings with best alternative
              let bestAlternative = null;
              let maxSavings = 0;
              
              for (const alt of alternatives) {
                // 🚀 OPTIMIERUNG: Nutze serverseitige Ersparnis falls verfügbar
                const savingsData = getSavingsData(productData, alt);
                if (savingsData.savingsEur > maxSavings) {
                  maxSavings = savingsData.savingsEur;
                  bestAlternative = alt;
                }
              }
              
              return {
                type: 'brand',
                data: {
                  ...item,
                  product: {
                    ...productData,
                    hersteller: herstellerData
                  },
                  alternatives,
                  bestAlternative,
                  potentialSavings: maxSavings
                },
                potentialSavings: maxSavings,
                actualSavings: 0,
                bestAlternative
              };
            }
          } else if (item.handelsmarkenProdukt) {
            // NoName Product Parallel Loading
            const productData = await FirestoreService.getDocumentByReference<Produkte>(item.handelsmarkenProdukt);
            if (productData) {
              // Alle NoName References parallel laden
              const [handelsmarkeData, discounterData, markenProdukt] = await Promise.all([
                productData.handelsmarke ? 
                  FirestoreService.getDocumentByReference(productData.handelsmarke).catch(() => null) : 
                  Promise.resolve(null),
                productData.discounter ? 
                  FirestoreService.getDocumentByReference(productData.discounter).catch(() => null) : 
                  Promise.resolve(null),
                productData.markenProdukt ? 
                  FirestoreService.getDocumentByReference<MarkenProdukte>(productData.markenProdukt).catch(() => null) : 
                  Promise.resolve(null)
              ]);
              
              // Fix discounter ID preservation
              let finalDiscounterData = discounterData;
              if (discounterData && productData.discounter) {
                finalDiscounterData = {
                  ...discounterData,
                  id: productData.discounter.id
                };
              }
              
              // Calculate actual savings
              let savings = 0;
              if (markenProdukt) {
                const savingsData = getSavingsData(markenProdukt, productData);
                savings = savingsData.savingsEur;
              }
              
              return {
                type: 'noname',
                data: {
                  ...item,
                  product: {
                    ...productData,
                    handelsmarke: handelsmarkeData,
                    discounter: finalDiscounterData
                  },
                  savings
                },
                potentialSavings: 0,
                actualSavings: savings
              };
            }
          }
          return null;
        } catch (error) {
          console.error('Error processing item:', error);
          return null;
        }
      }));
      
      // Ergebnisse sammeln und State setzen
      const brandItems = [...customBrandItems];
      const noNameItems = [...customNoNameItems];
      let potentialSavings = 0;
      let actualSavings = 0;
      const newSelectedConversions = [];
      
      for (const result of processedItems) {
        if (result) {
          if (result.type === 'brand') {
            brandItems.push(result.data as any); // Type assertion for mixed array
            potentialSavings += result.potentialSavings;
            
            // Auto-select best alternative for conversion
            if (result.bestAlternative && result.data.markenProdukt) {
              newSelectedConversions.push({
                einkaufswagenRef: result.data.id,
                markenProduktRef: result.data.markenProdukt.id,
                produktRef: result.bestAlternative.id
              });
            }
          } else if (result.type === 'noname') {
            noNameItems.push(result.data as any); // Type assertion for mixed array
            actualSavings += result.actualSavings;
          }
        }
      }
      
      // Batch State Updates
      setSelectedConversions(newSelectedConversions);
      if (__DEV__ && typeof console.timeEnd === 'function') console.timeEnd('⚡ Parallele Einkaufszettel-Verarbeitung');
      
      setBrandProducts(brandItems);
      setNoNameProducts(noNameItems);
      setTotalPotentialSavings(potentialSavings);
      setTotalActualSavings(actualSavings);
      

      console.log(`💰 Potential savings: €${potentialSavings.toFixed(2)}, Actual savings: €${actualSavings.toFixed(2)}`);
      
    } catch (error: any) {
      console.error('Error loading shopping cart:', error);
      showInfoToast(
        TOAST_MESSAGES.SHOPPING.loadError + " " + (error?.message ? error.message.toString() : String(error)),
        'error'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, userProfile]);
  
  useEffect(() => {
    if (user?.uid) {
      loadShoppingCart();
    }
  }, [user?.uid]); // Only reload when user changes, not on userProfile changes
  
  useEffect(() => {
    if (brandProducts.length > 0 || noNameProducts.length > 0) {
      loadFilterOptions();
    }
  }, [brandProducts.length, noNameProducts.length, activeTab]); // 🎯 Nur bei Längen-Änderung oder Tab-Wechsel
  
  const handleTabChange = (tab: 'brand' | 'noname') => {
    const pageIndex = tab === 'brand' ? 0 : 1;
    setActiveTab(tab);
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      // Animate tab indicator
      Animated.timing(tabIndicatorPosition, {
        toValue: position === 0 ? 0 : width / 2,
        duration: 200,
        useNativeDriver: true
      }).start();
    }
  };
  
  // Toggle expand/collapse for brand products
  const toggleExpanded = (itemId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedItems(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };
  
  // Select alternative for conversion
  const handleSelectAlternative = (
    einkaufswagenRef: string,
    markenProduktRef: string,
    produktRef: string
  ) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedConversions(prev => {
      const existingIndex = prev.findIndex(
        conv => conv.einkaufswagenRef === einkaufswagenRef
      );
      
      if (existingIndex !== -1) {
        const newConversions = [...prev];
        if (newConversions[existingIndex].produktRef === produktRef) {
          // Deselect if same product
          newConversions.splice(existingIndex, 1);
        } else {
          // Update selection
          newConversions[existingIndex] = {
            einkaufswagenRef,
            markenProduktRef,
            produktRef
          };
        }
        return newConversions;
      } else {
        // Add new selection
        return [
          ...prev,
          { einkaufswagenRef, markenProduktRef, produktRef }
        ];
      }
    });
  };
  
  // Convert single product
  const handleConvertSingle = async (
    einkaufswagenRef: string,
    markenProduktRef: string,
    produktRef: string
  ) => {
    if (!user) return;
    
    // Loading State setzen
    setConvertingItems(prev => new Set(prev).add(einkaufswagenRef));
    
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Convert this single product
      const conversions = [{
        einkaufswagenRef,
        markenProduktRef,
        produktRef
      }];
      
      const result = await FirestoreService.convertToNoName(user.uid, conversions);
      
      // Calculate savings for toast before reloading
      const brandItem = brandProducts.find(item => item.id === einkaufswagenRef);
      const savingsAmount = brandItem?.potentialSavings || 0;
      
      // 🚀 FIX: Erst Daten laden, dann Tab wechseln (verhindert Tab-Sprung-zurück)
      await loadShoppingCart();
      
      // ✅ FIX: Tab-Wechsel nach Daten-Laden (mit kleiner Verzögerung für Stabilität)
      setTimeout(() => {
        handleTabChange('noname');
      }, 100);
      
      // Success toast with savings amount
      showConvertSuccessToast(savingsAmount);
      
      // Track Achievement: convert_product
      await achievementService.trackAction(user.uid, 'convert_product');
      
    } catch (error) {
      console.error('Error converting single product:', error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.convertError, 'error');
    } finally {
      // Loading State entfernen
      setConvertingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(einkaufswagenRef);
        return newSet;
      });
    }
  };
  
  // Convert selected brand products to NoName
  const handleConvertSelected = async () => {
    if (!user?.uid) return;
    if (selectedConversions.length === 0) {
      showInfoToast(TOAST_MESSAGES.SHOPPING.selectFirstPrompt, 'info');
      return;
    }
  
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  
    Alert.alert(
      'In NoNames umwandeln?',
      `${selectedConversions.length} Produkt${selectedConversions.length > 1 ? 'e' : ''} umwandeln und €${totalPotentialSavings.toFixed(2)} sparen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Umwandeln',
          onPress: async () => {
            setIsConverting(true);
            setConvertLoaderState({
              visible: true,
              processedItems: 0,
              totalItems: selectedConversions.length,
              currentItem: ''
            });
  
            try {
              // UI-Progress (nur Anzeige)
              for (let i = 0; i < selectedConversions.length; i++) {
                const c = selectedConversions[i];
                const bp = brandProducts.find(p => p.id === c.einkaufswagenRef); // <-- FIX
                const name = bp?.product?.name || bp?.name || 'Produkt';
                setConvertLoaderState(prev => ({
                  ...prev,
                  currentItem: name,
                  processedItems: i
                }));
                await new Promise(res => setTimeout(res, 40));
              }
  
              // eigentliche Umwandlung
              setConvertLoaderState(prev => ({
                ...prev,
                currentItem: 'Umwandlung wird verarbeitet...',
                processedItems: selectedConversions.length
              }));
  
              await FirestoreService.convertToNoName(user.uid, selectedConversions);
              await FirestoreService.updateUserTotalSavings(user.uid, totalPotentialSavings);
  
              // Side-Effects: dürfen NIE den Erfolg kippen
              const sideEffects: Promise<any>[] = [];
              for (const c of selectedConversions) {
                const bp = brandProducts.find(p => p.id === c.einkaufswagenRef); // <-- FIX
                if (bp) {
                  const { savingsEur, savingsPercent } = getSavingsData(
                    bp.product,
                    { preis: bp.product?.preis ?? 0, packSize: bp.product?.packSize ?? 1 }
                  );
                  sideEffects.push(Promise.resolve(
                    analytics?.trackProductConversion?.(
                      c.markenProduktRef,
                      c.produktRef,
                      savingsEur,
                      savingsPercent
                    )
                  ));
                }
                sideEffects.push(Promise.resolve(
                  achievementService?.trackAction?.(user.uid, 'convert_product')
                ));
              }
              await Promise.allSettled(sideEffects); // <-- wirft nicht
  
              // Abschluss & UI
              setConvertLoaderState(prev => ({
                ...prev,
                currentItem: 'Abgeschlossen!',
                processedItems: selectedConversions.length
              }));
              await new Promise(res => setTimeout(res, 80));
  
              setConvertLoaderState({ visible: false, processedItems: 0, totalItems: 0, currentItem: '' });
  
              await loadShoppingCart();
              setTimeout(() => handleTabChange('noname'), 100);
  
              showBulkConvertSuccessToast(totalPotentialSavings);
            } catch (error) {
              console.error('[convert] bulk error', error);
              showInfoToast(TOAST_MESSAGES.SHOPPING.bulkConvertError, 'error');
            } finally {
              // falls irgendwo ein früher return passiert ist
              setConvertLoaderState({ visible: false, processedItems: 0, totalItems: 0, currentItem: '' });
              setIsConverting(false);
            }
          }
        }
      ]
    );
  };
  
  
  // Filter Functions
  const getActiveFiltersCount = () => {
    return filters.markets.length + filters.categories.length;
  };
  
  const getSortingOptions = () => {
    const baseSorting = [
      { value: 'name', label: 'Name', icon: 'textformat.abc' },
      { value: 'price', label: 'Preis', icon: 'eurosign' }
    ];
    
    if (activeTab === 'noname') {
      baseSorting.push({ value: 'savings', label: 'Ersparnis', icon: 'leaf.fill' });
    }
    
    return baseSorting;
  };
  
  const updateSorting = (sortBy: 'name' | 'price' | 'savings') => {
    setFilters(prev => ({ ...prev, sortBy }));
  };
  
  const toggleMarketFilter = (marketId: string) => {
    setFilters(prev => ({
      ...prev,
      markets: prev.markets.includes(marketId)
        ? prev.markets.filter(id => id !== marketId)
        : [...prev.markets, marketId]
    }));
  };
  
  const toggleCategoryFilter = (categoryId: string) => {
    setFilters(prev => ({
      ...prev,
      categories: prev.categories.includes(categoryId)
        ? prev.categories.filter(id => id !== categoryId)
        : [...prev.categories, categoryId]
    }));
  };
  
  const clearAllFilters = () => {
    setFilters({
      markets: [],
      categories: [],
      sortBy: 'name'
    });
  };
  
  // Load available markets and categories for filtering
  const loadFilterOptions = useCallback(async () => {
    try {

      
      // Load available markets from current products
      const marketsMap = new Map();
      const categoriesMap = new Map();
      
      // Check both brand and noname products
      const allProducts = [...brandProducts, ...noNameProducts];
      console.log(`📊 Checking ${allProducts.length} products for filter options`);
      
      allProducts.forEach(item => {
        // Market from discounter
        if (item.product?.discounter?.id && item.product?.discounter?.name) {
          marketsMap.set(item.product.discounter.id, {
            id: item.product.discounter.id,
            name: item.product.discounter.name
          });
        }
        
        // Category from kategorie
        if (item.product?.kategorie?.id && item.product?.kategorie?.bezeichnung) {
          categoriesMap.set(item.product.kategorie.id, {
            id: item.product.kategorie.id,
            bezeichnung: item.product.kategorie.bezeichnung
          });
        }
      });
      
      const marketsArray = Array.from(marketsMap.values());
      const categoriesArray = Array.from(categoriesMap.values());
      
      console.log(`✅ Found ${marketsArray.length} markets and ${categoriesArray.length} categories`);
      console.log('📍 Markets:', marketsArray.map(m => m.name));
      console.log('📂 Categories:', categoriesArray.map(c => c.bezeichnung));
      
      // Fallback: Lade alle Kategorien aus Firestore wenn keine in Produkten gefunden
      if (categoriesArray.length === 0) {
        try {
          // User Level für Kategorie-Zugriff
          const userLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
          const categoriesWithAccess = await categoryAccessService.getAllCategoriesWithAccess(userLevel);
          
          // Zeige nur verfügbare Kategorien
          const availableCategories = categoriesWithAccess.filter(cat => !cat.isLocked);
          setAvailableCategories(availableCategories);
        } catch (error) {
          console.error('Error loading categories from Firestore:', error);
          setAvailableCategories([]);
        }
      } else {
        // Filtere gefundene Kategorien basierend auf User-Level
        const userLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
        const filteredCategories = [];
        
        for (const cat of categoriesArray) {
          const isAvailable = await categoryAccessService.isCategoryAvailable(cat.id, userLevel);
          if (isAvailable) {
            filteredCategories.push(cat);
          }
        }
        
        setAvailableCategories(filteredCategories);
      }
      
      setAvailableMarkets(marketsArray);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  }, [brandProducts, noNameProducts, userProfile]);
  
  // Apply filters and sorting
  const applyFiltersAndSorting = useCallback((products: any[]) => {
    let filtered = [...products];
    
    // Apply market filter (only for noname)
    if (activeTab === 'noname' && filters.markets.length > 0) {
      filtered = filtered.filter(item => 
        item.product?.discounter?.id && filters.markets.includes(item.product.discounter.id)
      );
    }
    
    // Apply category filter
    if (filters.categories.length > 0) {
      filtered = filtered.filter(item =>
        item.product?.kategorie?.id && filters.categories.includes(item.product.kategorie.id)
      );
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      switch (filters.sortBy) {
        case 'name':
          const nameA = a.name || a.product?.produktName || a.product?.name || '';
          const nameB = b.name || b.product?.produktName || b.product?.name || '';
          return nameA.localeCompare(nameB);
        case 'price':
          const priceA = a.product?.preis || 0;
          const priceB = b.product?.preis || 0;
          return priceA - priceB;
        case 'savings':
          if (activeTab === 'noname') {
            const savingsA = a.savings || 0;
            const savingsB = b.savings || 0;
            return savingsB - savingsA; // Höchste Ersparnis zuerst
          }
          return 0;
        default:
          return 0;
      }
    });
    
    return filtered;
  }, [activeTab, filters]);
  
  // Mark all as purchased
    const handleMarkAllAsPurchased = async () => {
      if (!user || noNameProducts.length === 0) return;
      
      // Separate DB products and custom items
      const dbNoNameProducts = noNameProducts.filter(item => !item.isCustom);
      const customItems = noNameProducts.filter(item => item.isCustom);
      const dbProductCount = dbNoNameProducts.length;
      const customItemCount = customItems.length;
      const totalSavings = dbNoNameProducts.reduce((sum, item) => sum + (item.savings || 0), 0);
      
      // Total count for user display
      const totalCount = dbProductCount + customItemCount;
      
      // Check if there are any items to process
      if (totalCount === 0) return;
      
      // Create appropriate message based on what we have
      let message = '';
      if (dbProductCount > 0 && customItemCount > 0) {
        message = `Möchtest du alle ${totalCount} Produkte als erledigt markieren? (${dbProductCount} NoName-Produkte für €${totalSavings.toFixed(2)} Ersparnis + ${customItemCount} Freitext-Einträge)`;
      } else if (dbProductCount > 0) {
        message = `Möchtest du alle ${dbProductCount} NoName-Produkte als gekauft markieren und €${totalSavings.toFixed(2)} zu deiner Ersparnis hinzufügen?`;
      } else {
        message = `Möchtest du alle ${customItemCount} Freitext-Einträge als erledigt markieren?`;
      }
      
      // Confirmation dialog before bulk action
      Alert.alert(
        'Alle als erledigt markieren?',
        message,
        [
          {
            text: 'Abbrechen',
            style: 'cancel',
            onPress: () => console.log('Bulk purchase cancelled by user')
          },
          {
            text: 'Alle markieren',
            style: 'default',
            onPress: () => executeMarkAllAsPurchased(dbProductCount, customItemCount, totalSavings)
          }
        ]
      );
    };

    const executeMarkAllAsPurchased = async (dbProductCount: number, customItemCount: number, totalSavings: number) => {
      // Process DB products and custom items separately - MUSS VOR dem try-Block sein!
      const dbNoNameProducts = noNameProducts.filter(item => !item.isCustom);
      const customItems = noNameProducts.filter(item => item.isCustom);
      
      // Show batch loader
      setPurchaseLoaderState({
        visible: true,
        processedItems: 0,
        totalItems: dbProductCount + customItemCount,
        currentItem: 'Wird verarbeitet...'
      });
      
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        const totalCount = dbProductCount + customItemCount;
        console.log(`📊 Bulk update: ${dbProductCount} DB products, ${customItemCount} custom items, €${totalSavings.toFixed(2)} savings`);
        
        const promises = [];
        
        // Mark DB products as purchased (creates purchase history)
        if (dbNoNameProducts.length > 0) {
          // WICHTIG: Sammle alle Produkt-Infos für EINE Bulk-Journey-Update
          const productsForJourneyTracking = dbNoNameProducts.map(item => {
            // Debug: Log das Item um zu sehen, was wir haben
            console.log('🔍 Debug Item für Bulk Purchase:', {
              itemId: item.id,
              hasProduct: !!item.product,
              productId: item.product?.id,
              handelsmarkenProdukt: item.handelsmarkenProdukt,
              productName: item.product?.name || item.product?.produktName || item.name
            });
            
            return {
              productId: item.product?.id || (item.handelsmarkenProdukt && typeof item.handelsmarkenProdukt === 'object' && 'id' in item.handelsmarkenProdukt ? item.handelsmarkenProdukt.id : '') || '',
              productName: item.product?.name || item.product?.produktName || item.name || 'Unbekannt',
              productType: (item.isMarkenProdukt ? 'brand' : 'noname') as 'brand' | 'noname',
              finalPrice: item.product?.preis || 0,
              finalSavings: item.savings || 0,
              journeyId: item.journeyId // Falls vorhanden
            };
          });
          
          // Tracke alle Purchases in EINER Operation
          const journeyTrackingService = await import('@/lib/services/journeyTrackingService').then(m => m.default);
          if (productsForJourneyTracking.length > 0 && productsForJourneyTracking[0].journeyId) {
            // Bulk-Update für die Journey
            await journeyTrackingService.trackBulkPurchaseInSpecificJourney(
              productsForJourneyTracking[0].journeyId, // Alle sollten gleiche Journey haben
              productsForJourneyTracking,
              totalSavings,
              user.uid
            );
          }
          
          // Dann die einzelnen Firestore-Updates (ohne Journey-Tracking)
          promises.push(
            ...dbNoNameProducts.map(item => 
              FirestoreService.markAsPurchasedWithoutTracking(user.uid, item.id)
            )
          );
        }
        
        // Remove custom items from cart (no purchase history)
        if (customItems.length > 0) {
          promises.push(
            ...customItems.map(item => 
              FirestoreService.removeFromShoppingCart(user.uid, item.id)
            )
          );
        }
        
        // Show processing message
        setPurchaseLoaderState(prev => ({
          ...prev,
          currentItem: 'Alle Produkte werden verarbeitet...',
          processedItems: Math.floor(totalCount * 0.3)
        }));
        
        // Execute all operations in parallel
        await Promise.all(promises);
        
        // Update progress
        setPurchaseLoaderState(prev => ({
          ...prev,
          currentItem: 'Ersparnis wird gespeichert...',
          processedItems: Math.floor(totalCount * 0.7)
        }));
        
        // Update user's total savings and product count (only for DB products)
        if (totalSavings > 0 || dbProductCount > 0) {
          await updateUserStats(user.uid, {
            savingsToAdd: totalSavings,
            productsToAdd: dbProductCount
          });
        }
        
        // Clear all NoName products locally (both DB and custom)
        setNoNameProducts([]);
        setTotalActualSavings(0);
        
        // Track Achievement: complete_shopping (only for DB products)
        if (dbProductCount > 0) {
          setPurchaseLoaderState(prev => ({
            ...prev,
            currentItem: 'Achievement wird getrackt...',
            processedItems: totalCount
          }));
          
          await achievementService.trackAction(user.uid, 'complete_shopping', {
            productCount: dbProductCount,
            totalSavings
          });
        }
        
        // Final completion
        setPurchaseLoaderState(prev => ({
          ...prev,
          currentItem: 'Abgeschlossen!',
          processedItems: totalCount
        }));
        
        // Brief completion display
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 📊 Track Purchase Completed Event
        if (dbProductCount > 0) {
          // Sammle Source-Informationen aus den gekauften Produkten
          const sourceMix = dbNoNameProducts
            .map(item => item.source || 'unknown')
            .filter((source, index, arr) => arr.indexOf(source) === index); // Unique sources
          
          // 🎯 Track Purchase (korrekte Parameter)
          // Purchase-with-Journey wird durch Legacy Purchase Event abgedeckt
          
          // Legacy Purchase Event
          analytics.trackPurchaseCompleted(
            totalCount,
            totalSavings,
            dbProductCount,
            0, // Keine Brand-Produkte im NoName-Tab
            sourceMix
          );
        }
        
        // ENTFERNT: Doppeltes Tracking! 
        // Das Journey-Tracking passiert bereits in FirestoreService.markAsPurchased
        // für jedes einzelne Produkt mit der korrekten Original-Journey
        
        // Verwende Bulk-Purchased-Toast mit intelligenter Message-Auswahl
        showBulkPurchasedToast(dbProductCount, customItemCount, totalSavings);
        
      } catch (error) {
        console.error('Error marking all as purchased:', error);
        showInfoToast(TOAST_MESSAGES.SHOPPING.bulkPurchaseError, 'error');
      } finally {
        setPurchaseLoaderState({
          visible: false,
          processedItems: 0,
          totalItems: 0,
          currentItem: ''
        });
      }
    };

    const handleMarkAsPurchased = async (itemId: string, savings?: number) => {
      if (!user?.uid) return;
    
    // Loading State setzen
    setLoadingItems(prev => new Set(prev).add(itemId));
    
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      // Check if this is a custom item (freitext)
      const isCustomItem = [...brandProducts, ...noNameProducts].some(item => 
        item.id === itemId && item.isCustom
      );
      
      if (isCustomItem) {
        // For custom items: only remove from cart, no purchase history
        await FirestoreService.removeFromShoppingCart(user.uid, itemId);
        console.log('✅ Custom item removed from cart (no purchase history):', itemId);
      } else {
        // For DB items: normal purchase with history
        await FirestoreService.markAsPurchased(user.uid, itemId);
      }
      
      // Update user savings and product count (only for DB items)
      if (!isCustomItem) {
        console.log(`📊 Single update: 1 product, €${(savings || 0).toFixed(2)} savings`);
        await updateUserStats(user.uid, {
          savingsToAdd: savings || 0,
          productsToAdd: 1
        });
        
        // Profile wird automatisch über Achievement-Callback aktualisiert
        
        // Track Achievement: complete_shopping for single item
        console.log('🎯 Tracking complete_shopping action with:', {
          productCount: 1,
          totalSavings: savings || 0,
          currentLevel: (userProfile as any)?.stats?.currentLevel || userProfile?.level || 'unknown'
        });
        
        await achievementService.trackAction(user.uid, 'complete_shopping', {
          productCount: 1,
          totalSavings: savings || 0
        });
        
        // Motivational message based on savings
        if (savings && savings > 0) {
          showPurchasedToast(`Gekauft! Du hast €${savings.toFixed(2)} gespart - super gemacht!`);
        } else {
          showPurchasedToast(TOAST_MESSAGES.SHOPPING.purchasedSimple);
        }
      } else {
        // Custom items: simple confirmation message
        showInfoToast(TOAST_MESSAGES.SHOPPING.customItemPurchased, 'success');
      }
      
      // Optimized: Remove item from local state instead of reloading
      if (isCustomItem) {
        // Custom items: Check which list they belong to
        const customItem = [...brandProducts, ...noNameProducts].find(item => 
          item.id === itemId && item.isCustom
        );
        
        if (customItem?.customType === 'noname') {
          setNoNameProducts(prev => prev.filter(item => item.id !== itemId));
        } else {
          setBrandProducts(prev => prev.filter(item => item.id !== itemId));
        }
      } else if (savings && savings > 0) {
        // Regular NoName product - remove from noname list and update savings
        setNoNameProducts(prev => prev.filter(item => item.id !== itemId));
        setTotalActualSavings(prev => Math.max(0, prev - savings));
      } else {
        // Regular Brand product - remove from brand list
        setBrandProducts(prev => prev.filter(item => item.id !== itemId));
      }
    } catch (error) {
      console.error('Error marking as purchased:', error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.purchaseError, 'error');
    } finally {
      // Loading State entfernen
      setLoadingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    }
  };
  
  // Remove from cart
  const handleRemoveFromCart = async (itemId: string) => {
    if (!user?.uid) return;
    
    Alert.alert(
      'Produkt entfernen?',
      'Möchtest du dieses Produkt vom Einkaufszettel entfernen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            // Loading State setzen
            setDeletingItems(prev => new Set(prev).add(itemId));
            
            try {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              await FirestoreService.removeFromShoppingCart(user.uid, itemId);
              showInfoToast(TOAST_MESSAGES.SHOPPING.removedFromCart, 'info');
              
              // Optimized: Remove from local state instead of reloading
              setBrandProducts(prev => prev.filter(item => item.id !== itemId));
              setNoNameProducts(prev => {
                const removedItem = prev.find(item => item.id === itemId);
                if (removedItem) {
                  // Update total actual savings if removing a NoName product
                  setTotalActualSavings(prevSavings => Math.max(0, prevSavings - (removedItem.savings || 0)));
                }
                return prev.filter(item => item.id !== itemId);
              });
            } catch (error) {
              console.error('Error removing from cart:', error);
              showInfoToast(TOAST_MESSAGES.SHOPPING.removeError, 'error');
            } finally {
              // Loading State entfernen
              setDeletingItems(prev => {
                const newSet = new Set(prev);
                newSet.delete(itemId);
                return newSet;
              });
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        {/* Simple Header */}
        <View style={{ backgroundColor: colors.warning }}>
          <View style={styles.headerContent}>
            <ShimmerSkeleton width={150} height={44} borderRadius={0}  />
        </View>
        </View>
        
        {/* Simple Summary */}
     
 <ShoppingListSkeleton /> 
       </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      
      {/* Tabs with integrated Summary */}
      <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.tabButtons}>
          <TouchableOpacity style={styles.tab} onPress={() => handleTabChange('brand')}>
            <Text style={[styles.tabText, { color: activeTab === 'brand' ? colors.primary : colors.icon }]}>
              Marken ({brandProducts.length})
            </Text>
        </TouchableOpacity>
          
          <TouchableOpacity style={styles.tab} onPress={() => handleTabChange('noname')}>
            <Text style={[styles.tabText, { color: activeTab === 'noname' ? colors.primary : colors.icon }]}>
              NoNames ({noNameProducts.length})
            </Text>
          </TouchableOpacity>
          
          <Animated.View
            style={[styles.tabIndicator, {
              backgroundColor: colors.primary,
              transform: [{ translateX: tabIndicatorPosition }]
            }]}
          />
      </View>

        {/* Sticky Summary Bar */}
        {(activeTab === 'brand' ? brandProducts.length > 0 : noNameProducts.length > 0) && (
          <LinearGradient
            colors={activeTab === 'brand' 
              ? ['#FF9500', '#FF6B35']  // Orange gradient for brand
              : [colors.primary, colors.secondary]  // Primary to secondary for noname
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.stickySummaryGradient}
          >
                        <View style={styles.summaryContent}>
              <TouchableOpacity 
                style={styles.summaryLeft}
                onPress={() => setShowInfoSheet(true)}
                activeOpacity={0.7}
              >
                <View style={styles.summaryTitleRow}>
                  <Text style={styles.summaryTitle}>
                    {activeTab === 'brand' 
                      ? 'Dein Sparpotenzial'
                      : 'Einkaufszettel Ersparnis'}
                  </Text>
                  <View style={styles.infoIcon}>
                    <IconSymbol name="info.circle" size={16} color="rgba(255,255,255,0.8)" />
                  </View>
                </View>
                {activeTab === 'brand' && (
                  <Text style={styles.summarySubtitle}>
                    Mit NoName-Alternativen
                  </Text>
                )}{activeTab === 'noname' && (
                  <Text style={styles.summarySubtitle}>
                    Durch gewählte NoName-Produkte
                  </Text>
                )}
        </TouchableOpacity>
              <View style={styles.summaryRight}>
                <View style={styles.savingsContainer}>
                  <IconSymbol name="tag.fill" size={16} color="white" style={styles.savingsIcon} />
                  <Text style={styles.summaryAmount}>
                    -€{activeTab === 'brand' ? totalPotentialSavings.toFixed(2) : totalActualSavings.toFixed(2)}
                  </Text>
                </View>
              </View>
            </View>
          </LinearGradient>
      )}
    </View>

        <PagerView 
          ref={pagerRef}
          style={styles.pagerView}
          initialPage={0}
          onPageSelected={handlePageSelected}
        >
          {/* Page 1: Brand Products */}
          <View key="brand" style={styles.pageContainer}>
            <ScrollView 
              style={styles.productList}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => {
                    setRefreshing(true);
                    loadShoppingCart();
                  }}
                  tintColor={colors.primary}
                />
              }
            >
              {
              applyFiltersAndSorting(brandProducts).length === 0 ? (
              <View style={styles.emptyState}>
                <IconSymbol name="cart" size={48} color={colors.icon} />
                <Text style={[styles.emptyText, { color: colors.text }]}>
                  Keine Markenprodukte im Einkaufszettel
                </Text>
                <Text style={[styles.emptySubtext, { color: colors.icon }]}>
                  Füge Produkte über den Barcode-Scanner oder die Produktsuche hinzu
                </Text>
        </View>
            ) : (
              <View style={styles.productContainer}>
                {applyFiltersAndSorting(brandProducts).map((item) => {
                  const isExpanded = expandedItems.includes(item.id);
                  const selectedConversion = selectedConversions.find(c => c.einkaufswagenRef === item.id);

  return (
                    <View key={item.id} style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
                      <TouchableOpacity 
                        style={styles.productContent}
                        onPress={() => {
                          if (item.isCustom) {
                            // Custom items are not expandable
                            return;
                          }
                          if (item.alternatives?.length > 0) {
                            toggleExpanded(item.id);
                          }
                        }}
                        disabled={item.isCustom}
                      >
                        {/* Custom Items vs DB Items Rendering */}
                        {item.isCustom ? (
                          <>
                            {/* Custom Item Placeholder Image */}
                            <View style={[styles.productImage, { backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }]}>
                              <IconSymbol 
                                name="star.fill"
                                size={24} 
                                color={colors.icon} 
                              />
                            </View>
                            <View style={styles.productInfo}>
                              {/* Custom Badge */}
                              <View style={[styles.customBadge, { backgroundColor: colors.primary }]}>
                                <Text style={styles.customBadgeText}>
                                  MARKE
                                </Text>
                              </View>
                              
                              <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                                {item.name}
                              </Text>
                              
                              {/* Freitext Hinweis */}
                              <Text style={[styles.customItemHint, { color: colors.icon }]}>
                                Freitext-Eintrag
                              </Text>
                            </View>
                          </>
                        ) : (
                          <>
                            {/* Regular DB Item Rendering */}
                            <ImageWithShimmer
                              source={{ uri: item.product.bild }}
                              style={styles.productImage}
                            />
                            <View style={styles.productInfo}>
                          {/* Marke mit Logo zuerst */}
                          {item.product.hersteller?.name && (
                            <View style={styles.brandRow}>
                              {item.product.hersteller?.bild && (
                                <ImageWithShimmer
                                  source={{ uri: item.product.hersteller.bild }}
                                  style={styles.brandLogo}
                                />
                              )}
                              <Text style={[styles.brandName, { color: colors.primary }]} numberOfLines={1}>
                                {item.product.hersteller.name}
                              </Text>
      </View>
                          )}
                          
                          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                            {item.name || item.product.name || 'Unbekanntes Produkt'}
                          </Text>
                          
                          <Text style={[styles.productPrice, { color: colors.primary }]}>
                            €{item.product.preis?.toFixed(2) || '0.00'}
                          </Text>
                          {item.potentialSavings > 0 && (
                            <Text style={[styles.savingsHint, { color: colors.success }]}>
                              Ersparnis möglich: €{item.potentialSavings.toFixed(2)}
                            </Text>
                          )}
                            </View>
                          </>
                        )}
                        <View style={styles.productActions}>
                          {!item.isCustom && item.alternatives?.length > 0 && (
        <TouchableOpacity
                              style={styles.expandButton}
                              onPress={() => toggleExpanded(item.id)}
                            >
                              <IconSymbol 
                                name={isExpanded ? "chevron.up" : "chevron.down"} 
                                size={20} 
                                color={colors.icon} 
                              />
        </TouchableOpacity>
      )}
        <TouchableOpacity
          style={[
                              styles.actionButton, 
                              { backgroundColor: colors.primary, opacity: loadingItems.has(item.id) ? 0.7 : 1 }
                            ]}
                            onPress={() => handleMarkAsPurchased(item.id)}
                            disabled={loadingItems.has(item.id)}
                          >
                            {loadingItems.has(item.id) ? (
                              <ActivityIndicator size="small" color="white" />
                            ) : (
                              <IconSymbol name="checkmark" size={20} color="white" />
                            )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
                              styles.actionButton, 
                              { backgroundColor: colors.error, opacity: deletingItems.has(item.id) ? 0.7 : 1 }
                            ]}
                            onPress={() => handleRemoveFromCart(item.id)}
                            disabled={deletingItems.has(item.id)}
                          >
                            {deletingItems.has(item.id) ? (
                              <ActivityIndicator size="small" color="white" />
                            ) : (
                              <IconSymbol name="trash" size={20} color="white" />
                            )}
        </TouchableOpacity>
      </View>
                      </TouchableOpacity>
                      
                      {/* NoName Alternatives */}
                      {!item.isCustom && isExpanded && item.alternatives?.length > 0 && (
                        <View style={styles.alternativesContainer}>
                          <Text style={[styles.alternativesTitle, { color: colors.text }]}>
                            NoName Alternativen:
                          </Text>
                          {item.alternatives.map((alt: any) => {
                            const isSelected = selectedConversion?.produktRef === alt.id;
                            // 🚀 OPTIMIERUNG: Nutze serverseitige Ersparnis falls verfügbar
                            const savingsData = getSavingsData(item.product, alt);
                            const savings = { 
                              amount: savingsData.savingsEur, 
                              percent: savingsData.savingsPercent 
                            };

  return (
        <TouchableOpacity
                                key={alt.id}
          style={[
                                  styles.alternativeItem,
                                  { 
                                    backgroundColor: isSelected ? colors.primary + '20' : 'transparent',
                                    borderColor: isSelected ? colors.primary : colors.border
                                  }
                                ]}
                                onPress={() => handleSelectAlternative(item.id, item.markenProdukt.id, alt.id)}
                              >
                                <ImageWithShimmer
                                  source={{ uri: alt.bild }}
                                  style={styles.alternativeImage}
                                />
                                <View style={styles.alternativeInfo}>
                                  <Text style={[styles.alternativeName, { color: colors.text }]} numberOfLines={1}>
                                    {alt.produktName || alt.name}
                                  </Text>
                                  <View style={styles.alternativeMeta}>
                                    <View style={styles.marketInfo}>
                                      {alt.discounter?.bild ? (
                                        <ImageWithShimmer 
                                          source={{ uri: alt.discounter.bild }} 
                                          style={styles.marketLogo} 
                                        />
                                      ) : (
                                        <View style={[styles.marketLogo, styles.marketLogoFallback, { backgroundColor: colors.border }]}>
                                          <IconSymbol name="storefront" size={8} color={colors.icon} />
          </View>
                                      )}
                                      {userProfile?.favoriteMarket === alt.discounter?.id && (
                                        <IconSymbol name="heart.fill" size={10} color={colors.primary} style={styles.favoriteMarketIconLeft} />
                                      )}
                                      <Text style={[styles.marketName, { color: colors.icon }]} numberOfLines={1}>
                                        {alt.discounter?.name || 'Unbekannt'}
                                        {alt.discounter?.land && ` (${alt.discounter.land})`}
                                      </Text>
          </View>
                                    <Text style={[styles.alternativePrice, { color: colors.primary }]}>
                                      €{alt.preis?.toFixed(2)}
                                    </Text>
        </View>
          </View>
                                <View style={styles.alternativeSavings}>
                                  <Text style={[styles.savingsAmount, { color: colors.primary }]}>
                                    -€{savings.amount.toFixed(2)}
                                  </Text>
                                  <Text style={[styles.savingsPercent, { color: colors.primary }]}>
                                    -{savings.percent}%
                                  </Text>
          </View>
                                {isSelected ? (
        <TouchableOpacity
          style={[
                                      styles.convertSingleButton, 
                                      { 
                                        backgroundColor: colors.primary, 
                                        opacity: convertingItems.has(item.id) ? 0.7 : 1 
                                      }
                                    ]}
                                    onPress={() => handleConvertSingle(item.id, item.markenProdukt.id, alt.id)}
                                    disabled={convertingItems.has(item.id)}
                                  >
                                    {convertingItems.has(item.id) ? (
                                      <ActivityIndicator size="small" color="white" />
                                    ) : (
                                      <IconSymbol name="arrow.triangle.2.circlepath" size={14} color="white" />
                                    )}
        </TouchableOpacity>
                                ) : (
                                  <View style={styles.selectIndicator}>
                                    <IconSymbol name="circle" size={24} color={colors.border} />
        </View>
      )}
                              </TouchableOpacity>
                            );
                          })}
          </View>
      )}
          </View>
                  );
                })}
        </View>
            )
          }
            </ScrollView>
      </View>

          {/* Page 2: NoName Products */}
          <View key="noname" style={styles.pageContainer}>
            <ScrollView 
              style={styles.productList}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => {
                    setRefreshing(true);
                    loadShoppingCart();
                  }}
                  tintColor={colors.primary}
                />
              }
            >
              {
            applyFiltersAndSorting(noNameProducts).length === 0 ? (
              <View style={styles.emptyState}>
                <IconSymbol name="cart" size={48} color={colors.icon} />
                <Text style={[styles.emptyText, { color: colors.text }]}>
                  Keine NoName-Produkte im Einkaufszettel
                </Text>
                <Text style={[styles.emptySubtext, { color: colors.icon }]}>
                  Füge Produkte über den Barcode-Scanner oder die Produktsuche hinzu
                </Text>
          </View>
        ) : (
              <View style={styles.productContainer}>
                {applyFiltersAndSorting(noNameProducts).map((item) => (
                  <View key={item.id} style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
                    <View style={styles.productContent}>
                      {/* Custom Items vs DB Items Rendering */}
                      {item.isCustom ? (
                        <>
                          {/* Custom Item Placeholder Image */}
                          <View style={[styles.productImage, { backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }]}>
                            <IconSymbol 
                              name={item.customType === 'brand' ? "star.fill" : "storefront"} 
                              size={24} 
                              color={colors.icon} 
                            />
          </View>
                          <View style={styles.productInfo}>
                            {/* Custom Badge */}
                            <View style={[styles.customBadge, { backgroundColor: colors.primary }]}>
                              <Text style={styles.customBadgeText}>
                                {item.customType === 'brand' ? 'MARKE' : 'NONAME'}
                              </Text>
                            </View>
                            
                            <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                              {item.name}
                            </Text>
                            
                                                        {/* Market Info for Custom NoName */}
                            {item.customType === 'noname' && item.markt && (
                              <View style={styles.marketInfo}>
                                {item.markt.bild ? (
                                  <ImageWithShimmer
                                    source={{ uri: item.markt.bild }}
                                    style={styles.marketLogo}
                                    fallbackIcon="storefront"
                                    fallbackIconSize={8}
                                  />
                                ) : (
                                  <View style={[styles.marketLogo, styles.marketLogoFallback, { backgroundColor: colors.border }]}>
                                    <IconSymbol name="storefront" size={8} color={colors.icon} />
          </View>
        )}
                                <Text style={[styles.marketName, { color: colors.icon }]} numberOfLines={1}>
                                  {item.markt.name} {item.markt.land === 'Deutschland' ? '🇩🇪' : item.markt.land === 'Schweiz' ? '🇨🇭' : item.markt.land === 'Österreich' ? '🇦🇹' : ''}
                                </Text>
        </View>
      )}

                            {/* Freitext Hinweis */}
                            <Text style={[styles.customItemHint, { color: colors.icon }]}>
                              Freitext-Eintrag
                            </Text>
          </View>
                        </>
                      ) : (
                        <>
                          {/* Regular DB Item Rendering */}
                          <ImageWithShimmer
                            source={{ uri: item.product.bild }}
                            style={styles.productImage}
                          />
                          <View style={styles.productInfo}>
                            {/* Handelsmarke zuerst */}
                            {item.product.handelsmarke?.bezeichnung && (
                              <Text style={[styles.brandName, { color: colors.primary }]} numberOfLines={1}>
                                {item.product.handelsmarke.bezeichnung}
                              </Text>
                            )}
                            
                            <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
                              {item.product.name || item.product.produktName || 'Unbekanntes Produkt'}
                            </Text>
                            
                            {/* Discounter Info */}
                            <View style={styles.marketInfo}>
                              {item.product.discounter?.bild ? (
                                <ImageWithShimmer 
                                  source={{ uri: item.product.discounter.bild }} 
                                  style={styles.marketLogo} 
                                />
                              ) : (
                                <View style={[styles.marketLogo, styles.marketLogoFallback, { backgroundColor: colors.border }]}>
                                  <IconSymbol name="storefront" size={8} color={colors.icon} />
          </View>
        )}
                              {userProfile?.favoriteMarket === item.product.discounter?.id && (
                                <IconSymbol name="heart.fill" size={10} color={colors.primary} style={styles.favoriteMarketIconLeft} />
                              )}
                              <Text style={[styles.marketName, { color: colors.icon }]} numberOfLines={1}>
                                {item.product.discounter?.name || 'Unbekannt'}
                                {item.product.discounter?.land && ` (${item.product.discounter.land})`}
                              </Text>
                            </View>

                            {/* Preis mit Ersparnis in Klammern */}
                            <Text style={[styles.productPrice, { color: colors.primary }]}>
                              €{item.product.preis?.toFixed(2) || '0.00'}
                              {item.savings > 0 && (
                                <Text style={[styles.savingsInline, { color: colors.primary }]}>
                                  {' '}(- €{item.savings.toFixed(2)})
                                </Text>
                              )}
                            </Text>
                          </View>
                        </>
                      )}
                      <View style={styles.productActions}>
                        <TouchableOpacity 
                          style={[
                            styles.actionButton, 
                            { backgroundColor: colors.primary, opacity: loadingItems.has(item.id) ? 0.7 : 1 }
                          ]}
                          onPress={() => handleMarkAsPurchased(item.id, item.savings)}
                          disabled={loadingItems.has(item.id)}
                        >
                          {loadingItems.has(item.id) ? (
                            <ActivityIndicator size="small" color="white" />
                          ) : (
                            <IconSymbol name="checkmark" size={20} color="white" />
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={[
                            styles.actionButton, 
                            { backgroundColor: colors.error, opacity: deletingItems.has(item.id) ? 0.7 : 1 }
                          ]}
                          onPress={() => handleRemoveFromCart(item.id)}
                          disabled={deletingItems.has(item.id)}
                        >
                          {deletingItems.has(item.id) ? (
                            <ActivityIndicator size="small" color="white" />
                          ) : (
                            <IconSymbol name="trash" size={20} color="white" />
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )
              }
      </ScrollView>
          </View>
        </PagerView>

        {/* Bottom Buttons */}
        {activeTab === 'brand' && brandProducts.length > 0 && selectedConversions.length > 0 && (
          <View style={styles.bottomButtonContainer}>
        <TouchableOpacity 
              style={[styles.bottomButton, { backgroundColor: colors.primary }]}
              onPress={handleConvertSelected}
              disabled={isConverting}
            >
              {isConverting ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <>
                  <IconSymbol name="arrow.triangle.2.circlepath" size={20} color="white" />
                  <Text style={styles.bottomButtonText}>
            Produkte umwandeln
                  </Text>
                </>
              )}
        </TouchableOpacity>
          </View>
      )}

        {activeTab === 'noname' && noNameProducts.length > 0 && (
          <View style={styles.bottomButtonContainer}>
        <TouchableOpacity 
              style={[styles.bottomButton, { backgroundColor: colors.primary }]}
              onPress={() => handleMarkAllAsPurchased()}
        >
              <IconSymbol name="checkmark.circle.fill" size={20} color="white" />
              <Text style={styles.bottomButtonText}>
            Alle als gekauft markieren
              </Text>
        </TouchableOpacity>
          </View>
        )}
        
        {/* Floating Filter Button */}
        <TouchableOpacity 
          style={[styles.filterFab, { backgroundColor: colors.primary }]}
          onPress={() => setShowFilterModal(true)}
        >
          <IconSymbol name="line.3.horizontal.decrease" size={20} color="white" />
          {getActiveFiltersCount() > 0 && (
            <View style={[styles.filterBadge, { backgroundColor: colors.error }]}>
              <Text style={styles.filterBadgeText}>
                {getActiveFiltersCount()}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        
        {/* Filter Modal */}
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
                  {getSortingOptions().map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.sortingOption,
                        {
                          backgroundColor: filters.sortBy === option.value ? colors.primary : colors.cardBackground,
                          borderColor: colors.border
                        }
                      ]}
                      onPress={() => updateSorting(option.value)}
                    >
                      <IconSymbol 
                        name={option.icon} 
                        size={16} 
                        color={filters.sortBy === option.value ? 'white' : colors.primary}
                      />
                      <Text style={[
                        styles.sortingOptionText,
                        { color: filters.sortBy === option.value ? 'white' : colors.text }
                      ]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              
              {/* Märkte Filter (nur bei NoName Tab) - DEBUG */}
              {activeTab === 'noname' && (
                <View style={styles.filterSection}>
                  <Text style={[styles.filterSectionTitle, { color: colors.text }]}>
                    Märkte ({availableMarkets.length})
                  </Text>
                  {availableMarkets.length === 0 ? (
                    <Text style={[styles.debugText, { color: colors.error }]}>
                      Debug: Keine Märkte gefunden in {noNameProducts.length} NoName-Produkten
                    </Text>
                  ) : (
                    <View style={styles.chipsContainer}>
                      {availableMarkets.map((market) => (
                        <TouchableOpacity 
                          key={market.id}
                          style={[
                            styles.filterChip,
                            { 
                              backgroundColor: filters.markets.includes(market.id) 
                                ? colors.primary 
                                : colors.cardBackground,
                              borderColor: colors.border
                            }
                          ]}
                          onPress={() => toggleMarketFilter(market.id)}
                        >
                          <Text style={[
                            styles.chipText, 
                            { 
                              color: filters.markets.includes(market.id) 
                                ? 'white' 
                                : colors.text 
                            }
                          ]}>
                            {market.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}
              
              {/* Kategorien Filter - DEBUG */}
              <View style={styles.filterSection}>
                <Text style={[styles.filterSectionTitle, { color: colors.text }]}>
                  Kategorien ({availableCategories.length})
                </Text>
                {availableCategories.length === 0 ? (
                  <Text style={[styles.debugText, { color: colors.error }]}>
                    Debug: Keine Kategorien gefunden in {brandProducts.length + noNameProducts.length} Produkten
                  </Text>
                ) : (
                  <View style={styles.chipsContainer}>
                    {availableCategories.map((category) => (
                      <TouchableOpacity 
                        key={category.id}
                        style={[
                          styles.filterChip,
                          { 
                            backgroundColor: filters.categories.includes(category.id) 
                              ? colors.primary 
                              : colors.cardBackground,
                            borderColor: colors.border
                          }
                        ]}
                        onPress={() => toggleCategoryFilter(category.id)}
                      >
                        <Text style={[
                          styles.chipText, 
                          { 
                            color: filters.categories.includes(category.id) 
                              ? 'white' 
                              : colors.text 
                          }
                        ]}>
                          {category.bezeichnung || category.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>
        </View>
      </Modal>

        {/* Info Bottom Sheet */}
      <Modal
          visible={showInfoSheet}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowInfoSheet(false)}
              >
          <View style={[styles.pageSheetContainer, { backgroundColor: colors.background }]}>
            {/* Page Sheet Header */}
            <View style={styles.pageSheetHeader}>
              <View style={styles.handleContainer}>
                <View style={[styles.handle, { backgroundColor: colors.icon }]} />
            </View>
              <View style={styles.headerRow}>
            <TouchableOpacity 
                  style={styles.closeButtonLeft}
                  onPress={() => setShowInfoSheet(false)}
            >
                  <IconSymbol name="xmark" size={24} color={colors.icon} />
            </TouchableOpacity>
                <View style={styles.titleSection}>
                  <Text style={[styles.pageSheetTitle, { color: colors.text }]}>
                    {activeTab === 'brand' ? 'Sparpotenzial' : 'Ersparnis'} Erklärung
                  </Text>
          </View>
                <View style={styles.spacer} />
          </View>
        </View>
              
                            <ScrollView style={styles.sheetContent} showsVerticalScrollIndicator={false}>
                {activeTab === 'brand' ? (
                  <View>
                    <Text style={[styles.sheetText, { color: colors.text }]}>
                      🎯 <Text style={styles.boldText}>Dein Sparpotenzial</Text> zeigt dir, wie viel Geld du bei deiner nächsten Einkaufsmission sparen könntest! Verwandle teure Markenprodukte in günstigere NoName-Schätze und sammle dabei echte Euros.
                    </Text>
                    
                    <View style={styles.gamificationBox}>
                      <Text style={[styles.sheetText, { color: colors.text, marginTop: 12 }]}>
                        🔄 <Text style={styles.boldText}>Smart Umwandeln:</Text> Wähle deine Lieblingsalternativen aus und verwandle deine komplette Einkaufsliste mit einem Fingertipp!
                      </Text>
                      
                      <Text style={[styles.sheetText, { color: colors.text, marginTop: 12 }]}>
                        🏆 <Text style={styles.boldText}>Achievement Bonus:</Text> Je mehr du umwandelst, desto höher steigt dein Spar-Level und deine Gesamtersparnis!
                      </Text>
                      
                      <Text style={[styles.sheetText, { color: colors.text, marginTop: 12 }]}>
                        ❤️ <Text style={styles.boldText}>Lieblingsmarkt Power-Up:</Text> Produkte aus deinem Lieblingsmarkt werden prioritär angezeigt - für maximale Bequemlichkeit!
                      </Text>
            </View>
                    
                    <Text style={[styles.gameTip, { color: colors.primary, marginTop: 16 }]}>
                      💡 Pro-Tipp: Sammle Punkte durch jede erfolgreiche Umwandlung!
                    </Text>
          </View>
                ) : (
                  <View>
                    <Text style={[styles.sheetText, { color: colors.text }]}>
                      🏅 <Text style={styles.boldText}>Deine Ersparnis-Erfolge!</Text> Hier siehst du deine bereits erreichten Spar-Achievements mit NoName-Helden im Vergleich zu teuren Marken-Bossen.
                    </Text>
                    
                    <View style={styles.gamificationBox}>
                      <Text style={[styles.sheetText, { color: colors.text, marginTop: 12 }]}>
                        ✅ <Text style={styles.boldText}>Mission Complete:</Text> Markiere gekaufte Produkte als erledigt und übertrage deine verdienten Spar-Punkte in dein Profil!
                      </Text>
                      
                      <Text style={[styles.sheetText, { color: colors.text, marginTop: 12 }]}>
                        📈 <Text style={styles.boldText}>Level Up System:</Text> Jeder gesparte Euro bringt dich näher zum nächsten Spar-Champion Level!
                      </Text>
                      
                      <Text style={[styles.sheetText, { color: colors.text, marginTop: 12 }]}>
                        🌱 <Text style={styles.boldText}>Öko-Bonus:</Text> NoName-Helden können nachhaltiger sein durch weniger Verpackung - zusätzliche Karma-Punkte für die Umwelt!
                      </Text>
                    </View>
                    
                    <Text style={[styles.gameTip, { color: colors.primary, marginTop: 16 }]}>
                      🎮 Challenge: Schaffe es auf Platz 1 der Spar-Bestenliste!
                    </Text>
                  </View>
                )}
              </ScrollView>
        </View>
      </Modal>
      
      {/* LEVEL-UP OVERLAY - Spektakuläre Animation mit Confetti */}
      <LevelUpOverlay
        visible={showLevelUpOverlay}
        newLevel={levelUpData.newLevel}
        oldLevel={levelUpData.oldLevel}
        onClose={() => setShowLevelUpOverlay(false)}
      />
      
      {/* Batch Action Loaders */}
      <BatchActionLoader
        visible={convertLoaderState.visible}
        title="Produkte umwandeln"
        subtitle="Markenprodukte werden zu NoNames"
        icon="arrow.triangle.2.circlepath"
        gradient={['#FF9800', '#F57C00']}
        progress={convertLoaderState.totalItems > 0 ? convertLoaderState.processedItems / convertLoaderState.totalItems : 0}
        currentItem={convertLoaderState.currentItem}
        totalItems={convertLoaderState.totalItems}
        processedItems={convertLoaderState.processedItems}
      />
      
      <BatchActionLoader
        visible={purchaseLoaderState.visible}
        title="Als gekauft markieren"
        subtitle="NoName-Produkte werden abgehakt"
        icon="checkmark.circle.fill"
        gradient={['#4CAF50', '#2E7D32']}
        progress={purchaseLoaderState.totalItems > 0 ? purchaseLoaderState.processedItems / purchaseLoaderState.totalItems : 0}
        currentItem={purchaseLoaderState.currentItem}
        totalItems={purchaseLoaderState.totalItems}
        processedItems={purchaseLoaderState.processedItems}
      />

      {/* Lokale CartToast-Instanz entfernt – zentrale Toast-Library übernimmt */}

        {/* Custom Item Modal */}
        <AddCustomItemModal
          visible={showCustomItemModal}
          onClose={() => setShowCustomItemModal(false)}
          userId={user?.uid || ''}
          onSuccess={(message) => {
            showInfoToast(message, 'success');
            loadShoppingCart(); // Reload nach Hinzufügung
          }}
          onError={(message) => {
            showInfoToast(message, 'error');
          }}
        />
        </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, fontSize: 16, fontFamily: 'Nunito_600SemiBold' },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  
  // Summary Bar
  summaryBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },

  summaryContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLeft: {
    flex: 1,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  summaryTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  summarySubtitle: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255,255,255,0.8)',
  },
  summaryRight: {
    alignItems: 'flex-end',
  },
  savingsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  savingsIcon: {
    marginRight: 6,
  },
  infoIcon: {
    marginLeft: 8,
    padding: 4,
  },
  summaryLabel: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  summaryValues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryAmount: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
  },
  summaryPercent: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  convertAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginTop: 8,
    alignSelf: 'flex-end',
  },
  convertAllText: {
    color: 'white',
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  
  // Tabs
  tabContainer: { 
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
  },
  tabButtons: {
    flexDirection: 'row', 
    height: 48, 
    position: 'relative',
  },
  stickySummaryGradient: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  tab: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabText: { fontSize: 16, fontFamily: 'Nunito_600SemiBold' },
  tabIndicator: { position: 'absolute', bottom: 0, height: 3, width: width / 2 },
  
  // Product List
  pagerView: { flex: 1 },
  pageContainer: { flex: 1 },
  productList: { flex: 1 },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 16, fontFamily: 'Nunito_600SemiBold', marginTop: 16, textAlign: 'center' },
  emptySubtext: { fontSize: 14, fontFamily: 'Nunito_400Regular', marginTop: 8, textAlign: 'center', paddingHorizontal: 32 },
  
  // Product Cards
  productContainer: { padding: 16 },
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
  productImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
  },
  productMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  productName: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 2,
  },
  productPrice: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 2,
  },
  savingsHint: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  savingsInline: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    fontWeight: '400',
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
  productActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  expandButton: {
    padding: 4,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Alternatives
  alternativesContainer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  alternativesTitle: {
    fontSize: 13,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 8,
  },
  alternativeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
  },
  alternativeImage: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  alternativeInfo: {
    flex: 1,
    marginLeft: 8,
  },
  alternativeName: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
    marginBottom: 2,
  },
  alternativeMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  marketInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  marketLogo: {
    width: 14,
    height: 14,
    borderRadius: 0,
    resizeMode: 'contain',
    marginRight: 4,
  },
  marketLogoFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  marketName: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
    flex: 1,
  },
  favoriteMarketIcon: {
    marginLeft: 2,
  },
  favoriteMarketIconLeft: {
    marginRight: 4,
  },
  alternativePrice: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  alternativeSavings: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  savingsAmount: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
  },
  savingsPercent: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  convertSingleButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  selectIndicator: {
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  
  // Bottom Buttons (5% höher)
  bottomButtonContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingBottom: 16,
    marginBottom: 8,
  },
  bottomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
  },
  bottomButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginLeft: 8,
  },
  
  // Page Sheet (wie in Produktdetails)
  pageSheetContainer: {
    flex: 1,
    paddingTop: 20,
  },
  pageSheetHeader: {
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
    opacity: 0.5,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  closeButtonLeft: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleSection: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  spacer: {
    width: 40,
  },
  pageSheetTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
  },
  sheetContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sheetText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Nunito_400Regular',
  },
  boldText: {
    fontFamily: 'Nunito_600SemiBold',
  },
  
  // Floating Filter Button (wie in explore.tsx)
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
  
  // Filter Modal
  filterModalContainer: {
    flex: 1,
    paddingTop: 20,
  },
  filterModalHeader: {
    paddingBottom: 20,
  },
  filterModalTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
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
  clearAllButton: {
    alignItems: 'center',
  },
  clearAllText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  debugText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    fontStyle: 'italic',
  },
  gamificationBox: {
    backgroundColor: 'rgba(66, 169, 104, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#42a968',
  },
  gameTip: {
    fontSize: 13,
    fontFamily: 'Nunito_600SemiBold',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(13, 133, 117, 0.1)',
    borderRadius: 8,
  },
  
  // Alte Toast-Container Styles entfernt - zentrale Toast-Library übernimmt
  
  // Custom Item Styles
  customBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 4,
  },
  customBadgeText: {
    color: 'white',
    fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
  },
  customItemHint: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    fontStyle: 'italic',
    marginTop: 4,
  },
});