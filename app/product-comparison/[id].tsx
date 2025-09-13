import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { LevelUpOverlay } from '@/components/ui/LevelUpOverlay';
import { CommentSkeleton, CommentsHeaderSkeleton, RatingOverviewSkeleton, ShimmerSkeleton } from '@/components/ui/ShimmerSkeleton';
import { getStufenColor, getStufenDescription, getStufenTitle } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { TOAST_MESSAGES, interpolateMessage } from '@/constants/ToastMessages';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { ingredientSynonyms } from '@/lib/data/ingredientSynonyms';
import { db } from '@/lib/firebase';
import { useFavorites } from '@/lib/hooks/useFavorites';
import achievementService from '@/lib/services/achievementService';
import { FirestoreService } from '@/lib/services/firestore';
import OpenFoodService, { OpenFoodProduct } from '@/lib/services/openfood';
import { showAlreadyInCartToast, showCartAddedToast, showFavoriteAddedToast, showFavoriteRemovedToast, showInfoToast, showRatingToast } from '@/lib/services/ui/toast';
import { MarkenProduktWithDetails, ProductWithDetails } from '@/lib/types/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Helper function to format price
const formatPrice = (price: number | undefined): string => {
  if (price === undefined || price === null) {
    return '€ 0,00';
  }
  return `€ ${price.toFixed(2)}`;
};

// Helper function to get savings data (€ and %) - uses Firestore fields if available, otherwise calculates
const getSavingsData = (brandProduct: any, noNameProduct: any): { savingsEur: number; savingsPercent: number } => {
  // 🚀 OPTIMIERUNG: Nutze serverseitige Berechnung falls vorhanden
  if (noNameProduct.ersparnis !== undefined && noNameProduct.ersparnisProz !== undefined) {
    // 🔇 Log nur bei Development (reduziert Spam)
    if (__DEV__ && Math.random() < 0.1) { // Nur 10% der Aufrufe loggen
      console.log(`💰 Using server-calculated savings: €${noNameProduct.ersparnis}, ${noNameProduct.ersparnisProz}%`);
    }
    return {
      savingsEur: parseFloat(String(noNameProduct.ersparnis || 0)),
      savingsPercent: parseInt(String(noNameProduct.ersparnisProz || 0))
    };
  }
  
  // 🔄 FALLBACK: Client-side Berechnung (für Stufe 1,2 oder noch nicht berechnete)
  if (__DEV__ && Math.random() < 0.1) { // Nur 10% der Aufrufe loggen
    console.log('🔄 Calculating savings client-side (Firestore fields missing)');
  }
  
  if (!brandProduct.preis || !noNameProduct.preis || !brandProduct.packSize || !noNameProduct.packSize) {
    return { savingsEur: 0, savingsPercent: 0 };
  }
  
  // Preis pro Einheit (Gramm/Milliliter)
  const brandPricePerUnit = brandProduct.preis / brandProduct.packSize;
  const noNamePricePerUnit = noNameProduct.preis / noNameProduct.packSize;
  
  // Ersparnis in Prozent (kann positiv oder negativ sein)
  const savingsPercent = ((brandPricePerUnit - noNamePricePerUnit) / brandPricePerUnit) * 100;
  
  // Ersparnis in Euro (basiert auf NoName packSize)
  const savingsEur = (brandPricePerUnit - noNamePricePerUnit) * noNameProduct.packSize;
  
  return {
    savingsEur: Math.round(savingsEur * 100) / 100, // Auf 2 Nachkommastellen runden
    savingsPercent: Math.round(savingsPercent) // Ganze Prozent
  };
};

// Helper function to calculate savings percentage (LEGACY - for backwards compatibility)
const calculateSavingsPercentage = (brandProduct: any, noNameProduct: any): number => {
  const data = getSavingsData(brandProduct, noNameProduct);
  return data.savingsPercent;
};

// Helper function to get savings display with correct sign and color
const getSavingsDisplay = (brandProduct: any, noNameProduct: any, colors: any) => {
  const { savingsEur, savingsPercent } = getSavingsData(brandProduct, noNameProduct);
  
  if (savingsPercent > 0) {
    // Ersparnis: grün mit Minus-Zeichen
    return {
      text: `-${savingsPercent}%`,
      color: colors.success,
      icon: "tag.fill",
      savingsEur: savingsEur // Zusätzliche Euro-Info
    };
  } else if (savingsPercent < 0) {
    // Mehrkosten: rot mit Plus-Zeichen
    return {
      text: `+${Math.abs(savingsPercent)}%`,
      color: '#FF3B30', // Rot
      icon: "exclamationmark.triangle.fill",
      savingsEur: Math.abs(savingsEur) // Zusätzliche Euro-Info
    };
  } else {
    // Gleicher Preis
    return {
      text: `±0%`,
      color: colors.icon,
      icon: "equal",
      savingsEur: 0
    };
  }
};

// Score Image component with real URLs (nutzt OpenFood Daten falls verfügbar)
const ScoreImage = ({ type, openFoodProduct, firestoreValue }: { 
  type: 'nutri' | 'eco' | 'nova'; 
  openFoodProduct?: OpenFoodProduct | null;
  firestoreValue?: string;
}) => {
  // Versuche zuerst OpenFood Daten zu nutzen, fallback auf Firestore
  const getScoreValue = () => {
    if (openFoodProduct && openFoodProduct.found) {
      let scoreValue: string | undefined;
      switch(type) {
        case 'nutri':
          scoreValue = openFoodProduct.nutriscore_grade;
          break;
        case 'eco':
          scoreValue = openFoodProduct.ecoscore_grade;
          break;
        case 'nova':
          scoreValue = openFoodProduct.nova_group?.toString();
          break;
      }
      if (scoreValue) return scoreValue;
    }
    // Fallback auf Firestore Daten
    return firestoreValue;
  };
  
  const value = getScoreValue();
  
  // Nur anzeigen wenn der Score existiert
  if (!value) {
    return null;
  }
  
  const getScoreImageUrl = () => {
    switch(type) {
      case 'nutri':
        return `https://markendetektive.de/images/scores/nutri_${value.toLowerCase()}.png`;
      case 'eco':
        return `https://markendetektive.de/images/scores/eco_${value.toLowerCase()}.png`;
      case 'nova':
        return `https://markendetektive.de/images/scores/nova_${value}.png`;
      default:
        return null;
    }
  };

  const imageUrl = getScoreImageUrl();
  
  if (!imageUrl) {
    return null;
  }

  return (
    <ImageWithShimmer
      source={{ uri: imageUrl }}
      style={styles.scoreImage}
      fallbackIcon="photo"
      fallbackIconSize={16}
      resizeMode="contain"
    />
  );
};

// Star Rating Component
const StarRating = ({ 
  rating, 
  onRatingChange, 
  size = 28, 
  colors 
}: { 
  rating: number; 
  onRatingChange: (rating: number) => void; 
  size?: number; 
  colors: any;
}) => {
  const isCompact = size <= 20;
  
  return (
    <View style={[styles.starRating, isCompact && styles.starRatingCompact]}>
      {[1, 2, 3, 4, 5].map((star) => (
        <TouchableOpacity 
          key={star} 
          style={[styles.starButton, isCompact && styles.starButtonCompact]}
          onPress={() => onRatingChange(star)}
          activeOpacity={0.7}
        >
          <ThemedText 
            style={[
              styles.starIconLarge, 
              { 
                color: star <= rating ? colors.warning : colors.border,
                fontSize: size,
                lineHeight: size + 2 // Verhindert Clipping
              }
            ]}
          >
            ★
          </ThemedText>
        </TouchableOpacity>
      ))}
    </View>
  );
};





// NoName Cart Button Component  
const NoNameCartButton = ({ 
  productId, 
  productName, 
  user, 
  colors,
  animateButtonPress,
  buttonAnimations
}: {
  productId: string;
  productName: string;
  user: any;
  colors: any;
  animateButtonPress: (buttonId: string) => void;
  buttonAnimations: {[key: string]: Animated.Value};
}) => {
  const router = useRouter();
  const [isInCart, setIsInCart] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  useEffect(() => {
    checkStatus();
  }, []);

  // Refresh cart status when screen comes back into focus
  useFocusEffect(
    useCallback(() => {
      // Cart status refresh - reduced logging
      checkStatus();
    }, [user?.uid, productId])
  );
  
  const checkStatus = async () => {
    if (!user?.uid) return;
    try {
      const inCart = await FirestoreService.isInShoppingCart(user.uid, productId, false);
      setIsInCart(inCart);
    } catch (error) {
      console.error('Error checking cart status:', error);
    }
  };
  
  const handlePress = async () => {
    if (!user?.uid) {
      showInfoToast(TOAST_MESSAGES.SHOPPING.addToCartAuthRequired, 'info');
      return;
    }
    
    if (isInCart) {
      showAlreadyInCartToast(() => router.push('/shopping-list' as any));
      return;
    }
    
    // Animate cart button before action
    animateButtonPress(`cart-${productId}`);
    setIsLoading(true);
    
    try {
      // 🎯 Track Add-to-Cart wird von FirestoreService automatisch gemacht
      
      await FirestoreService.addToShoppingCart(
        user.uid,
        productId,
        productName,
        false, // NoName product
        'comparison', // Source
        { 
          screenName: 'product_comparison',
          fromMainProduct: true
        }
      );
      setIsInCart(true);
      const message = interpolateMessage(TOAST_MESSAGES.SHOPPING.addedToCart, { productName });
      showCartAddedToast(message, () => router.push('/shopping-list' as any));
    } catch (error) {
      console.error('Error adding to cart:', error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.addToCartError, 'error');
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <>
      <TouchableOpacity 
        style={[styles.cartButtonGray, { 
          backgroundColor: isInCart ? colors.success : colors.background 
        }]}
        onPress={handlePress}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={isInCart ? "white" : colors.icon} />
        ) : (
          <Animated.View style={{
            transform: [{ scale: buttonAnimations[`cart-${productId}`] || new Animated.Value(1) }]
          }}>
            <IconSymbol 
              name={isInCart ? "checkmark" : "plus"} 
              size={20} 
              color={isInCart ? "white" : colors.icon}
            />
          </Animated.View>
        )}
      </TouchableOpacity>
    </>
  );
};

// Vergleichslogik Komponente
const ProductComparisonContent = ({ 
  mainProduct, 
  selectedProducts, 
  openFoodData, 
  colors,
  comparisonData,
  productAnimations
}: { 
  mainProduct: MarkenProduktWithDetails;
  selectedProducts: ProductWithDetails[];
  openFoodData: Map<string, OpenFoodProduct | null>;
  colors: any;
  comparisonData: {
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  } | null;
  productAnimations: {[key: string]: Animated.Value};
}) => {
  // Similarity Info Modal State
  const [showSimilarityInfo, setShowSimilarityInfo] = useState(false);
  const [similarityInfoType, setSimilarityInfoType] = useState<'ingredients' | 'nutrition' | 'overall'>('ingredients');
  
  // Handler for showing similarity info
  const handleShowSimilarityInfo = (type: 'ingredients' | 'nutrition' | 'overall' = 'ingredients') => {
    setSimilarityInfoType(type);
    setShowSimilarityInfo(true);
  };

  // Ähnlichkeitsberechnung für Zutaten
  const calculateIngredientSimilarity = (mainIngredients: string, compareIngredients: string): number => {
    console.log('🔍 Calculating ingredient similarity:');
    console.log('Main ingredients:', mainIngredients?.substring(0, 100));
    console.log('Compare ingredients:', compareIngredients?.substring(0, 100));
    
    if (!mainIngredients || !compareIngredients) {
      console.log('❌ Missing ingredients data');
      return 0;
    }
    
    // Verwende die umfassende Synonym-Map (500+ Zutaten)
    console.log('🔍 Synonym-Map geladen:', ingredientSynonyms.size, 'Einträge');

    // Universelle Pattern für automatische Synonym-Erkennung
    const ingredientPatterns = [
      // Pulver-Varianten
      { pattern: /(.+)pulver$/, base: '$1', variants: ['$1pulver', 'getrocknetes $1', '$1extrakt'] },
      
      // Öl-Varianten  
      { pattern: /(.+)öl$/, base: '$1öl', variants: ['$1kernöl', '$1samenöl', 'kaltgepresstes $1öl'] },
      
      // Mehl-Varianten
      { pattern: /(.+)mehl$/, base: '$1mehl', variants: ['$1vollkornmehl', 'type \\d+ $1mehl'] },
      
      // Saft-Varianten
      { pattern: /(.+)saft$/, base: '$1saft', variants: ['$1direktsaft', '$1konzentrat', 'natürlicher $1saft'] },
      
      // Essig-Varianten
      { pattern: /(.+)essig$/, base: '$1essig', variants: ['$1balsamico', '$1weinessig'] },
      
      // Nuss-Varianten (automatisch)
      { pattern: /(.+)nüsse?$/, base: '$1nüsse', variants: ['gemahlene $1nüsse', 'gehackte $1nüsse', '$1kerne'] },
      
      // Frucht-Varianten
      { pattern: /(.+)beeren?$/, base: '$1beeren', variants: ['getrocknete $1beeren', 'tiefgefrorene $1beeren'] },
    ];

    // MINIMALE Normalisierung - nur technische Bereinigung
    const cleanIngredient = (ingredient: string): string => {
      return ingredient
        .toLowerCase()
        .trim()
        // Nur technische Bereinigung - KEINE inhaltlichen Änderungen!
        .replace(/\([^)]*\)/g, '') // Entferne Klammern (Allergene, etc.)
        .replace(/\[[^\]]*\]/g, '') // Entferne eckige Klammern
        .replace(/\d+[,%\s]*%?/g, '') // Entferne Prozentangaben
        .replace(/\s*\*+\s*/g, ' ') // Entferne Sterne
        .replace(/^(emulgator:?\s*)/g, '') // Entferne "Emulgator:" Präfix
        .replace(/\be\d+[a-z]?\b/g, '') // Entferne E-Nummern
        .replace(/\s*-\s*/g, '') // 🔥 KRITISCH: Entferne Bindestriche mit Leerzeichen
        .replace(/\s+/g, ' ') // Normalisiere Leerzeichen
        .trim();
    };

    // INTELLIGENTE Ähnlichkeits-Erkennung ohne Qualitätsverlust
    const calculateIngredientSimilarity = (ing1: string, ing2: string): number => {
      const clean1 = cleanIngredient(ing1);
      const clean2 = cleanIngredient(ing2);
      

      
      // 1. Exakte Übereinstimmung = 100%
      if (clean1 === clean2) return 100;
      
      // 2. Synonym-Check (aus unserer Map) = 95%
      for (const [baseIngredient, synonyms] of ingredientSynonyms) {
        const allVariants = [baseIngredient, ...synonyms];
        if (allVariants.includes(clean1) && allVariants.includes(clean2)) {
          return 95;
        }
      }
      
      // 3. ADAPTIVE Pattern-Erkennung für unbekannte Zutaten
      const adaptivePatterns = [
        // Öl-Varianten (automatisch)
        { regex: /(.+)(öl|oil)$/, score: 90 },
        // Mehl-Varianten
        { regex: /(.+)(mehl|flour)$/, score: 90 },
        // Pulver-Varianten  
        { regex: /(.+)(pulver|powder)$/, score: 90 },
        // Extrakt-Varianten
        { regex: /(.+)(extrakt|extract)$/, score: 85 },
        // Saft-Varianten
        { regex: /(.+)(saft|juice)$/, score: 85 },
        // Sauce-Varianten
        { regex: /(.+)(sauce|soße)$/, score: 85 },
        // Paste-Varianten
        { regex: /(.+)(paste|mark)$/, score: 85 },
      ];
      
      for (const pattern of adaptivePatterns) {
        const match1 = clean1.match(pattern.regex);
        const match2 = clean2.match(pattern.regex);
        
        if (match1 && match2 && match1[1] === match2[1]) {
          return pattern.score; // Gleiche Basis, verschiedene Form
        }
      }
      
      // 4. Intelligente Wort-Ähnlichkeit
      const words1 = clean1.split(/\s+/).filter(w => w.length >= 3);
      const words2 = clean2.split(/\s+/).filter(w => w.length >= 3);
      
      if (words1.length === 0 || words2.length === 0) return 0;
      
      // Finde gemeinsame Hauptwörter
      let commonWords = 0;
      let totalWords = Math.max(words1.length, words2.length);
      
      words1.forEach(word1 => {
        let bestWordMatch = 0;
        words2.forEach(word2 => {
          // Exakte Wort-Übereinstimmung
          if (word1 === word2) {
            bestWordMatch = Math.max(bestWordMatch, 1);
          }
          // Wort-Ähnlichkeit (für Tippfehler)
          else if (word1.length >= 4 && word2.length >= 4) {
            const similarity = calculateWordSimilarity(word1, word2);
            if (similarity >= 0.8) {
              bestWordMatch = Math.max(bestWordMatch, similarity);
            }
          }
          // Ein Wort enthält das andere (z.B. "milch" in "vollmilch")
          else if (word1.length >= 4 && word2.includes(word1)) {
            bestWordMatch = Math.max(bestWordMatch, 0.8);
          }
          else if (word2.length >= 4 && word1.includes(word2)) {
            bestWordMatch = Math.max(bestWordMatch, 0.8);
          }
        });
        commonWords += bestWordMatch;
      });
      
      return Math.min(90, Math.round((commonWords / totalWords) * 100));
    };
    
    // Splitte die Zutaten (OHNE aggressive Normalisierung!)
    const main = mainIngredients
      .split(/[,;.]/)
      .map(i => i.trim())
      .filter(i => i.length > 2);
      
    const compare = compareIngredients
      .split(/[,;.]/)
      .map(i => i.trim())
      .filter(i => i.length > 2);
    
    console.log('Main ingredients normalized:', main);
    console.log('Compare ingredients normalized:', compare);
    
    // Spezial-Debug für Joghurt-Fall
    if (mainIngredients.includes('Magermilch') || compareIngredients.includes('Magermilch')) {
      console.log('🥛 JOGHURT-DEBUG:');
      console.log('  Original Main:', mainIngredients);
      console.log('  Original Compare:', compareIngredients);
      console.log('  Normalized Main:', main);
      console.log('  Normalized Compare:', compare);
    }
    
    if (main.length === 0 || compare.length === 0) {
      console.log('❌ No valid ingredients found');
      return 0;
    }
    


    // Hilfsfunktion: Berechnet Wort-Ähnlichkeit (vereinfachte Levenshtein)
    const calculateWordSimilarity = (word1: string, word2: string): number => {
      const maxLength = Math.max(word1.length, word2.length);
      if (maxLength === 0) return 1;
      
      let matches = 0;
      const minLength = Math.min(word1.length, word2.length);
      
      for (let i = 0; i < minLength; i++) {
        if (word1[i] === word2[i]) matches++;
      }
      
      return matches / maxLength;
    };

    // NEUE intelligente Matching-Logik
    const matches = new Set();
    const usedCompareIndices = new Set();
    
    main.forEach((mainIngredient, mainIndex) => {
      let bestMatch = null;
      let bestScore = 0;
      let bestCompareIndex = -1;
      
      compare.forEach((compareIngredient, compareIndex) => {
        if (usedCompareIndices.has(compareIndex)) return;
        
        // Verwende die neue intelligente Ähnlichkeits-Funktion
        const score = calculateIngredientSimilarity(mainIngredient, compareIngredient);
        
        if (score > bestScore && score >= 70) { // Mindestens 70% Ähnlichkeit
          bestScore = score;
          bestMatch = compareIngredient;
          bestCompareIndex = compareIndex;
        }
      });
      
      if (bestMatch) {
        matches.add(mainIngredient);
        usedCompareIndices.add(bestCompareIndex);
        
        // Detailliertes Logging
        let matchType = '';
        if (bestScore === 100) matchType = 'EXACT';
        else if (bestScore === 95) matchType = 'SYNONYM';
        else if (bestScore >= 80) matchType = 'SIMILAR';
        else matchType = 'PARTIAL';
        
        console.log(`✅ ${matchType}: "${mainIngredient}" → "${bestMatch}" (${bestScore}%)`);
      } else {
        console.log(`❌ No match for: "${mainIngredient}"`);
      }
    });
    
    // Berechne Ähnlichkeit basierend auf der Anzahl der Hauptzutaten
    // Verwende die kleinere Liste als Basis (wichtiger für Ähnlichkeit)
    const shorterList = Math.min(main.length, compare.length);
    const similarity = Math.round((matches.size / shorterList) * 100);
    
    console.log(`✅ Ingredient similarity: ${matches.size}/${shorterList} ingredients matched = ${similarity}%`);
    
    return similarity;
  };

  // Nährwert-Ähnlichkeitsberechnung (die 5 wichtigsten Werte)
  const calculateNutritionSimilarity = (mainNutrition: any, compareNutrition: any): number => {
    if (!mainNutrition || !compareNutrition) return 0;
    
    // Die 5 wichtigsten Nährwerte für Vergleich
    const nutrients = [
      { key: 'energy-kcal_100g', fallback: 'energy_100g', factor: 4.184, name: 'Energie' }, // Energie (kcal oder kJ->kcal)
      { key: 'fat_100g', name: 'Fett' },                    // Fett
      { key: 'carbohydrates_100g', name: 'Kohlenhydrate' },          // Kohlenhydrate  
      { key: 'sugars_100g', name: 'Zucker' },                  // Zucker
      { key: 'proteins_100g', name: 'Eiweiß' }               // Eiweiß
    ];
    
    let totalDifference = 0;
    let validComparisons = 0;
    
    nutrients.forEach(nutrient => {
      let mainValue = mainNutrition[nutrient.key];
      let compareValue = compareNutrition[nutrient.key];
      
      // Fallback für Energie: kJ -> kcal Konvertierung
      if (!mainValue && nutrient.fallback) {
        mainValue = mainNutrition[nutrient.fallback] ? mainNutrition[nutrient.fallback] / nutrient.factor : undefined;
      }
      if (!compareValue && nutrient.fallback) {
        compareValue = compareNutrition[nutrient.fallback] ? compareNutrition[nutrient.fallback] / nutrient.factor : undefined;
      }
      
      if (mainValue !== undefined && compareValue !== undefined && mainValue > 0) {
        // 🔥 INTELLIGENTE BERECHNUNG: Bei sehr kleinen Werten (< 1) verwende absolute Differenz statt relative
        let difference;
        if (mainValue < 1 && compareValue < 1) {
          // Bei Werten < 1g: Absolute Differenz, max 1.0 (100%)
          difference = Math.min(1.0, Math.abs(mainValue - compareValue));
        } else {
          // Bei größeren Werten: Relative Differenz wie bisher
          difference = Math.abs(mainValue - compareValue) / mainValue;
        }
        
        totalDifference += difference;
        validComparisons++;
      }
    });
    
    if (validComparisons === 0) return 0;
    
    const avgDifference = totalDifference / validComparisons;
    return Math.round(Math.max(0, (1 - avgDifference) * 100));
  };



  // Gesamt-Ähnlichkeit berechnen
  const calculateOverallSimilarity = (product: ProductWithDetails): { 
    ingredients: number; 
    nutrition: number; 
    overall: number; 
  } => {
    console.log('\n🔍 Calculating overall similarity for product:', product.produktName);
    
    // Gleiche EAN-Logik wie im Details Modal verwenden
    const mainEAN = mainProduct.EANs?.[0] || mainProduct.gtin;
    const productEAN = product.EANs?.[0] || product.gtin;
    
    console.log('Main product EAN:', mainEAN);
    console.log('Compare product EAN:', productEAN);
    
    const mainOpenFood = openFoodData.get(mainEAN || '');
    const productOpenFood = openFoodData.get(productEAN || '');
    
    console.log('Main OpenFood data available:', !!mainOpenFood);
    console.log('Compare OpenFood data available:', !!productOpenFood);
    console.log('OpenFood data map size:', openFoodData.size);
    console.log('OpenFood data keys:', Array.from(openFoodData.keys()));
    
    const mainIngredients = OpenFoodService.formatIngredients(mainOpenFood) || '';
    const productIngredients = OpenFoodService.formatIngredients(productOpenFood) || '';
    
    const ingredientSimilarity = calculateIngredientSimilarity(
      mainIngredients, 
      productIngredients
    );
    
    const nutritionSimilarity = calculateNutritionSimilarity(
      mainOpenFood?.nutriments,
      productOpenFood?.nutriments
    );
    
    // Gewichteter Durchschnitt: Nährwerte 60%, Zutaten 40% (Nährwerte objektiver)
    const overall = Math.round(
      (ingredientSimilarity * 0.4) + 
      (nutritionSimilarity * 0.6)
    );
    
    console.log(`📊 Final similarity scores - Ingredients: ${ingredientSimilarity}%, Nutrition: ${nutritionSimilarity}%, Overall: ${overall}%`);
    
    return {
      ingredients: ingredientSimilarity,
      nutrition: nutritionSimilarity,
      overall
    };
  };

  if (selectedProducts.length === 0) {
    return (
      <View style={[styles.emptyComparisonContainer, { backgroundColor: colors.cardBackground }]}>
        <IconSymbol name="scale.3d" size={48} color={colors.icon} />
        <ThemedText style={styles.emptyComparisonTitle}>Keine Produkte ausgewählt</ThemedText>
        <ThemedText style={[styles.emptyComparisonText, { color: colors.icon }]}>
          Wähle NoName-Produkte aus, um sie mit dem Markenprodukt zu vergleichen.
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, paddingHorizontal: 2 }}>
      {/* Markenprodukt - Details Sheet Stil */}
      <Animated.View 
        style={[
          styles.detailCard, 
          { 
            backgroundColor: colors.cardBackground,
            opacity: productAnimations[mainProduct.id] || 0, // ✨ Animation für Brand-Produkt
            transform: [{ scale: productAnimations[`${mainProduct.id}_scale`] || 0.8 }]
          }
        ]}
      >
        {/* Header mit Produktbild */}
        <View style={styles.productHeader}>
          <Image 
            source={{ uri: mainProduct.bild }} 
            style={styles.comparisonProductImage}
          />
          <View style={styles.productHeaderInfo}>
            <ThemedText style={[styles.cardTitle, { color: colors.primary }]}>
              {comparisonData?.mainProduct?.marke?.name || comparisonData?.mainProduct?.hersteller?.herstellername || comparisonData?.mainProduct?.hersteller?.name || 'Markenprodukt'}
            </ThemedText>
            <ThemedText style={styles.cardSubtitle}>
{comparisonData?.mainProduct?.name || 'Unbekanntes Produkt'}
            </ThemedText>
          </View>
        </View>
        
        {/* Horizontal Icons wie Wanderapp */}
        <View style={styles.wanderappDataRowBrand}>
          {/* Packung */}
          <View style={styles.wanderappDataItemBrand}>
            <IconSymbol name="cube.box" size={18} color={colors.primary} />
            <ThemedText style={[styles.wanderappDataValue, { color: colors.text }]}>
              {comparisonData?.mainProduct?.packSize ? `${comparisonData.mainProduct.packSize}${comparisonData.mainProduct.packTypInfo?.typKurz || 'g'}` : '?'}
            </ThemedText>
          </View>
          
          {/* Preis */}
          <View style={styles.wanderappDataItemBrand}>
            <IconSymbol name="eurosign" size={18} color={colors.primary} />
            <ThemedText style={[styles.wanderappDataValue, { color: colors.text }]}>
              €{comparisonData?.mainProduct?.preis ? comparisonData.mainProduct.preis.toFixed(2) : '0.00'}
            </ThemedText>
          </View>
          
          {/* Kategorie - mehr Platz */}
          <View style={styles.wanderappDataItemBrandCategory}>
            <IconSymbol name="square.grid.2x2" size={18} color={colors.primary} />
            <ThemedText style={[styles.wanderappDataValue, { color: colors.text }]} numberOfLines={2}>
              {comparisonData?.mainProduct?.kategorie?.bezeichnung || '?'}
            </ThemedText>
          </View>
        </View>
          
        {/* Nährwerte Sektion wie im Screenshot */}
        <View style={styles.nutritionSection}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeaderWithIconContainer}>
              <IconSymbol name="chart.bar.xaxis" size={16} color={colors.primary} />
              <ThemedText style={[styles.sectionHeaderWithIcon, { color: colors.primary }]}>
                Nährwerte
              </ThemedText>
            </View>
          </View>
          {(() => {
            const mainEAN = mainProduct.EANs?.[0] || mainProduct.gtin;
            const mainOpenFood = openFoodData.get(mainEAN || '');
            const nutrition = OpenFoodService.formatNutrition(mainOpenFood?.nutriments);
            
            return nutrition.length > 0 ? nutrition.slice(0, 4).map((n, index) => (
              <View key={index} style={styles.nutritionRow}>
                <ThemedText style={styles.nutritionLabel}>{n.label}:</ThemedText>
                <ThemedText style={[styles.nutritionValue, { color: colors.icon }]}>{n.value}</ThemedText>
              </View>
            )) : (
              <ThemedText style={[styles.nutritionValue, { color: colors.icon }]}>Keine Daten verfügbar</ThemedText>
            );
          })()}
        </View>
        
        {/* Zutaten Sektion wie im Screenshot */}
        <View style={styles.nutritionSection}>
          <View style={styles.sectionHeaderWithIconContainer}>
            <IconSymbol name="list.bullet" size={16} color={colors.primary} />
            <ThemedText style={[styles.sectionHeaderWithIcon, { color: colors.primary }]}>
              Zutaten
            </ThemedText>
          </View>
          <ThemedText style={[styles.ingredientsText, { color: colors.icon }]}>
            {(() => {
              const mainEAN = mainProduct.EANs?.[0] || mainProduct.gtin;
              const mainOpenFood = openFoodData.get(mainEAN || '');
              const ingredients = OpenFoodService.formatIngredients(mainOpenFood);
              return ingredients || 'Keine Informationen verfügbar';
            })()}
          </ThemedText>
        </View>
      </Animated.View>

      {/* Vergleichsprodukte - Details Sheet Stil */}
      {selectedProducts.map((product, index) => {
        const similarity = calculateOverallSimilarity(product);
        const productEAN = product.EANs?.[0] || product.gtin;
        const productOpenFood = openFoodData.get(productEAN || '');
        
        return (
          <Animated.View 
            key={product.id} 
            style={[
              styles.detailCard, 
              { 
                backgroundColor: colors.cardBackground, 
                marginTop: 12,
                opacity: productAnimations[product.id] || 0, // ✨ Animation
                transform: [{ scale: productAnimations[`${product.id}_scale`] || 0.8 }]
              }
            ]}
          >
            {/* Header mit Produktbild */}
            <View style={styles.productHeader}>
              <Image 
                source={{ uri: product.bild }} 
                style={styles.comparisonProductImage}
              />
              <View style={styles.productHeaderInfo}>
                <ThemedText style={[styles.cardTitle, { color: colors.primary }]}>
                  NoName-Produkt {index + 1}
                </ThemedText>
                <ThemedText style={styles.cardSubtitle}>
{product.handelsmarke?.bezeichnung || 'Unbekannte Handelsmarke'} - {product.name}
                </ThemedText>
              </View>
              
              {/* Ähnlichkeits-Anzeige */}
              <View style={styles.similarityIndicator}>
                <IconSymbol 
                  name="arrow.left.arrow.right" 
                  size={14} 
                  color={similarity.overall >= 70 ? colors.success : similarity.overall >= 50 ? colors.warning : colors.error} 
                />
                <ThemedText style={[
                  styles.similarityText,
                  { color: similarity.overall >= 70 ? colors.success : similarity.overall >= 50 ? colors.warning : colors.error }
                ]}>
                  {similarity.overall}%
                </ThemedText>
                <TouchableOpacity 
                  onPress={() => handleShowSimilarityInfo('overall')}
                  style={styles.infoIconButton}
                >
                  <IconSymbol name="info.circle" size={14} color={colors.icon} />
                </TouchableOpacity>
              </View>
            </View>
            
            {/* Horizontal Icons wie Wanderapp */}
            <View style={styles.wanderappDataRow}>
              {/* Supermarkt */}
              <View style={styles.wanderappDataItem}>
                <IconSymbol name="storefront" size={18} color={colors.primary} />
                <ThemedText style={[styles.wanderappDataValue, { color: colors.text }]} numberOfLines={1}>
                  {product.discounter?.name || '?'}
                </ThemedText>
              </View>
              
              {/* Packung */}
              <View style={styles.wanderappDataItem}>
                <IconSymbol name="cube.box" size={18} color={colors.primary} />
                <ThemedText style={[styles.wanderappDataValue, { color: colors.text }]}>
                  {product.packSize ? `${product.packSize}${product.packTypInfo?.typKurz || 'g'}` : '?'}
                </ThemedText>
              </View>
              
              {/* Preis */}
              <View style={styles.wanderappDataItem}>
                <IconSymbol name="eurosign" size={18} color={colors.primary} />
                <ThemedText style={[styles.wanderappDataValue, { color: colors.text }]}>
                  €{product.preis ? product.preis.toFixed(2) : '0.00'}
                </ThemedText>
              </View>
              
              {/* Stufe falls vorhanden */}
              {product.stufe && (
                <View style={styles.wanderappDataItem}>
                  <IconSymbol name="chart.bar" size={18} color={colors.primary} />
                  <ThemedText style={[styles.wanderappDataValue, { color: colors.primary }]}>
                    {product.stufe}
                  </ThemedText>
                </View>
              )}
            </View>

            {/* Ähnlichkeitsvergleich mit Progress Bars */}
            <View style={styles.similaritySection}>
              <View style={styles.similarityRow}>
                <View style={styles.similarityRowHeader}>
                  <ThemedText style={styles.infoLabel}>Zutaten-Ähnlichkeit</ThemedText>
                  <TouchableOpacity 
                    onPress={() => handleShowSimilarityInfo('ingredients')}
                    style={styles.similarityInfoIcon}
                  >
                    <IconSymbol name="info.circle" size={14} color={colors.icon} />
                  </TouchableOpacity>
                </View>
                <View style={styles.progressBarContainer}>
                  <View style={styles.progressBarBackground}>
                    <View 
                      style={[
                        styles.progressBarFill, 
                        { 
                          backgroundColor: similarity.ingredients >= 70 ? colors.success : similarity.ingredients >= 50 ? colors.warning : colors.error,
                          width: `${similarity.ingredients}%`
                        }
                      ]} 
                    />
                  </View>
                  <ThemedText style={[styles.progressBarText, { color: colors.icon }]}>
                    {similarity.ingredients}%
                  </ThemedText>
                </View>
              </View>
              
              <View style={styles.similarityRow}>
                <View style={styles.similarityRowHeader}>
                  <ThemedText style={styles.infoLabel}>Nährwert-Ähnlichkeit</ThemedText>
                  <TouchableOpacity 
                    onPress={() => handleShowSimilarityInfo('nutrition')}
                    style={styles.similarityInfoIcon}
                  >
                    <IconSymbol name="info.circle" size={14} color={colors.icon} />
                  </TouchableOpacity>
                </View>
                <View style={styles.progressBarContainer}>
                  <View style={styles.progressBarBackground}>
                    <View 
                      style={[
                        styles.progressBarFill, 
                        { 
                          backgroundColor: similarity.nutrition >= 70 ? colors.success : similarity.nutrition >= 50 ? colors.warning : colors.error,
                          width: `${similarity.nutrition}%`
                        }
                      ]} 
                    />
                  </View>
                  <ThemedText style={[styles.progressBarText, { color: colors.icon }]}>
                    {similarity.nutrition}%
                  </ThemedText>
                </View>
              </View>
              

            </View>

            {/* Nährwerte Sektion wie im Screenshot */}
            <View style={styles.nutritionSection}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionHeaderWithIconContainer}>
                  <IconSymbol name="chart.bar.xaxis" size={16} color={colors.primary} />
                  <ThemedText style={[styles.sectionHeaderWithIcon, { color: colors.primary }]}>
                    Nährwerte
                  </ThemedText>
                </View>
              </View>
              {(() => {
                const nutrition = OpenFoodService.formatNutrition(productOpenFood?.nutriments);
                
                return nutrition.length > 0 ? nutrition.slice(0, 4).map((n, index) => (
                  <View key={index} style={styles.nutritionRow}>
                    <ThemedText style={styles.nutritionLabel}>{n.label}:</ThemedText>
                    <ThemedText style={[styles.nutritionValue, { color: colors.icon }]}>{n.value}</ThemedText>
                  </View>
                )) : (
                  <ThemedText style={[styles.nutritionValue, { color: colors.icon }]}>Keine Daten verfügbar</ThemedText>
                );
              })()}
            </View>
            
            {/* Zutaten Sektion wie im Screenshot */}
            <View style={styles.nutritionSection}>
              <View style={styles.sectionHeaderWithIconContainer}>
                <IconSymbol name="list.bullet" size={16} color={colors.primary} />
                <ThemedText style={[styles.sectionHeaderWithIcon, { color: colors.primary }]}>
                  Zutaten
                </ThemedText>
              </View>
              <ThemedText style={[styles.ingredientsText, { color: colors.icon }]}>
                {(() => {
                  const ingredients = OpenFoodService.formatIngredients(productOpenFood);
                  return ingredients || 'Keine Informationen verfügbar';
                })()}
              </ThemedText>
            </View>
          </Animated.View>
        );
      })}
      
      {/* Extra Spacing für saubere Darstellung der letzten Card */}
      <View style={{ height: 60 }} />

      {/* Similarity Info Modal */}
      <Modal
        visible={showSimilarityInfo}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSimilarityInfo(false)}
      >
        <View style={[styles.bottomSheetContainer, { backgroundColor: colors.background }]}>
          {/* Bottom Sheet Header */}
          <View style={styles.bottomSheetHeader}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.headerRow}>
              <TouchableOpacity 
                style={styles.closeButtonLeft}
                onPress={() => setShowSimilarityInfo(false)}
              >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
              </TouchableOpacity>
              <View style={styles.titleSection}>
                <ThemedText style={styles.bottomSheetTitle}>
                  Berechnung
                </ThemedText>
           
              </View>
              <View style={styles.spacer} />
            </View>
          </View>

          {/* Content */}
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
            {/* Gesamt-Ähnlichkeit Card - immer anzeigen */}
              <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
                <View style={styles.infoCardHeader}>
                  <View style={styles.infoCardIconContainer}>
                    <IconSymbol name="arrow.left.arrow.right" size={24} color={colors.primary} />
                  </View>
                  <ThemedText style={styles.infoCardTitle}>Gesamt-Ähnlichkeit</ThemedText>
                </View>
                
                <View style={styles.infoCardContent}>
                  <ThemedText style={[styles.infoCardDescription, { color: colors.icon }]}>
                    Die Gesamt-Ähnlichkeit kombiniert Zutaten und Nährwerte zu einer einzigen Bewertung. So siehst du auf einen Blick, wie ähnlich zwei Produkte wirklich sind.
                  </ThemedText>
                  
                  <View style={styles.infoCardDivider} />
                  
                  <View style={styles.infoCardSubSection}>
                    <View style={styles.infoCardSubHeader}>
                      <IconSymbol name="percent" size={16} color={colors.primary} />
                      <ThemedText style={styles.infoCardSubTitle}>So berechnen wir</ThemedText>
                    </View>
                    <ThemedText style={[styles.infoCardSubDescription, { color: colors.icon }]}>
                      • Nährwert-Ähnlichkeit: 60% Gewichtung (objektiver){'\n'}
                      • Zutaten-Ähnlichkeit: 40% Gewichtung{'\n'}
                      • Ergebnis: Ein Wert zwischen 0% und 100%{'\n'}
                      • Je höher, desto ähnlicher sind die Produkte
                    </ThemedText>
                  </View>
                </View>
              </View>

            {/* Zutaten-Ähnlichkeit Card - immer anzeigen */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.infoCardHeader}>
                <View style={styles.infoCardIconContainer}>
                  <IconSymbol name="list.bullet" size={24} color={colors.primary} />
                </View>
                <ThemedText style={styles.infoCardTitle}>Zutaten-Vergleich</ThemedText>
              </View>
              
              <View style={styles.infoCardContent}>
                <ThemedText style={[styles.infoCardDescription, { color: colors.icon }]}>
                  Wir vergleichen die Zutatenlisten und schauen, wie ähnlich sie sind. Dabei erkennt unser System auch Synonyme und verschiedene Schreibweisen.
                </ThemedText>
                
                <View style={styles.infoCardDivider} />
                
                <View style={styles.infoCardSubSection}>
                  <View style={styles.infoCardSubHeader}>
                    <IconSymbol name="gear" size={16} color={colors.primary} />
                    <ThemedText style={styles.infoCardSubTitle}>So funktioniert's</ThemedText>
                  </View>
                  <ThemedText style={[styles.infoCardSubDescription, { color: colors.icon }]}>
                    • Identische Zutaten = 100% (z.B. &quot;Zucker&quot; = &quot;Zucker&quot;){'\n'}
                    • Gleicher Inhalt, andere Namen (z.B. &quot;Zucker&quot; = &quot;Saccharose&quot;) = 100%{'\n'}
                    • Verwandte Zutaten = 85-95% (z.B. &quot;Sonnenblumenöl&quot; ≈ &quot;Rapsöl&quot;){'\n'}
                    • Ähnliche Begriffe = 70-90%{'\n'}
                    • Qualität wird respektiert: &quot;Vanilleschoten&quot; ≠ &quot;Vanillearoma&quot;
                  </ThemedText>
                </View>
              </View>
            </View>


            {/* Nährwert-Ähnlichkeit Card - immer anzeigen */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.infoCardHeader}>
                <View style={styles.infoCardIconContainer}>
                  <IconSymbol name="chart.bar.xaxis" size={24} color={colors.primary} />
                </View>
                <ThemedText style={styles.infoCardTitle}>Nährwert-Vergleich</ThemedText>
              </View>
              
              <View style={styles.infoCardContent}>
                <ThemedText style={[styles.infoCardDescription, { color: colors.icon }]}>
                  Wir vergleichen die 5 wichtigsten Nährwerte: Kalorien, Fett, Kohlenhydrate, Zucker und Eiweiß. Je ähnlicher die Werte, desto höher die Prozentangabe.
                </ThemedText>
                
                <View style={styles.infoCardDivider} />
                
                <View style={styles.infoCardSubSection}>
                  <View style={styles.infoCardSubHeader}>
                    <IconSymbol name="info.circle" size={16} color={colors.primary} />
                    <ThemedText style={styles.infoCardSubTitle}>So rechnen wir</ThemedText>
                  </View>
                  <ThemedText style={[styles.infoCardSubDescription, { color: colors.icon }]}>
                    • Alle Werte werden auf 100g umgerechnet{'\n'}
                    • Bei kleinen Werten (&lt;1g) schauen wir auf den absoluten Unterschied{'\n'}
                    • Bei großen Werten schauen wir auf den prozentualen Unterschied{'\n'}
                    • So werden kleine Unterschiede nicht überbewertet
                  </ThemedText>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
};

export default function ProductComparisonScreen() {
  const { id, type } = useLocalSearchParams();
  
  // Product comparison loaded - reduced logging
  
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const analytics = useAnalytics();
  const { toggleFavorite, isLocalFavorite } = useFavorites();
  
  // Toast states mit Prioritäten - SEPARATE für verschiedene Aktionen
  // LEVEL-UP Overlay (ersetzt Toast für spektakuläre Animation)
  const [showLevelUpOverlay, setShowLevelUpOverlay] = useState(false);
  const [levelUpData, setLevelUpData] = useState<{ newLevel: number; oldLevel: number }>({ 
    newLevel: 1, 
    oldLevel: 1 
  });
  
  // FAVORITEN Toast (lokale Positionierung)
  const [showFavoriteToast, setShowFavoriteToast] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState('');
  const [favoriteType, setFavoriteType] = useState<'success' | 'error' | 'info'>('success');
  
  // ACHIEVEMENT Toast (mittlere Priorität)
  const [showAchievementToast, setShowAchievementToast] = useState(false);
  const [achievementMessage, setAchievementMessage] = useState('');
  
  // CART Toast (normale Priorität)
  // Toasts laufen jetzt über zentrale Toast-Library

  // Toast helper functions - SEPARATE für verschiedene Typen
  const showGameToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showInfoToast(message, type);
  };

  const showGameToastWithAction = (
    message: string, 
    type: 'success' | 'error' | 'info' = 'success'
  ) => {
    showCartAddedToast(message, () => router.push('/shopping-list' as any));
  };

  // FAVORITEN Toast (lokale Positionierung beim Herz-Icon)
  const showFavoriteGameToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    showInfoToast(message, type);
  };

  // LEVEL-UP Overlay anzeigen (spektakuläre Animation mit Confetti)
  const showLevelUpAnimation = (newLevel: number, oldLevel: number) => {
    setLevelUpData({ newLevel, oldLevel });
    setShowLevelUpOverlay(true);
  };

  // ACHIEVEMENT Toast (globale Positionierung)
  const showAchievementGameToast = (message: string) => {
    setAchievementMessage(message);
    setShowAchievementToast(true);
  };

  // (Legacy CartToast-Helper entfernt)

  // Handle favorite toggle
  const handleToggleFavorite = async (product: any, productType: 'markenprodukt' | 'noname') => {
    if (!user?.uid) {
      showInfoToast(TOAST_MESSAGES.FAVORITES.authRequired, 'info');
      return;
    }

    if (!product) return;

    // DEBUG: Typ prüfen
    console.log('🔍 FAVORIT HINZUFÜGEN:', {
      productId: product.id,
      productName: product.name || product.produktName,
      urlType: type,
      productType: productType,
      isMarkenProdukt: type === 'brand'
    });

    try {
      const wasAdded = await toggleFavorite(product.id, productType, {
        id: product.id,
        name: product.name,
        preis: product.preis,
        packSize: product.packSize,
        bild: product.bild,
        type: productType,
        category: product.kategorie?.bezeichnung || product.category,
        brand: product.marke?.bezeichnung || product.brand
      });

      // Konsistente Favoriten-Toasts (wie bei Stufe 1,2)
      if (wasAdded) {
        showFavoriteAddedToast(product.name);
      } else {
        showFavoriteRemovedToast(product.name);
      }
      
      // Haptic Feedback
      Haptics.impactAsync(wasAdded ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      console.error('Error toggling favorite:', error);
      showInfoToast(TOAST_MESSAGES.FAVORITES.addError, 'error');
    }
  };

  // Function to open image viewer
  const openImageViewer = (imageUrl: string) => {
    setSelectedImageUrl(imageUrl);
    setImageLoading(true);
    setImageViewerVisible(true);
  };

  // Function to close image viewer
  const closeImageViewer = () => {
    setImageViewerVisible(false);
    setImageLoading(false);
    setSelectedImageUrl('');
  };
  const [showProductDetails, setShowProductDetails] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [showRatingsView, setShowRatingsView] = useState(false);
  const [productRatings, setProductRatings] = useState<any[]>([]);
  const [ratingStats, setRatingStats] = useState<any>(null);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  
  // Ähnliche Produkte für Markenprodukte ohne NoName-Alternativen
  const [similarProducts, setSimilarProducts] = useState<ProductWithDetails[]>([]);
  const [similarProductsLoading, setSimilarProductsLoading] = useState(false);


  // Rating form states
  const [overallRating, setOverallRating] = useState(0);
  const [tasteRating, setTasteRating] = useState(0);
  const [priceValueRating, setPriceValueRating] = useState(0);
  const [contentRating, setContentRating] = useState(0);
  const [similarityRating, setSimilarityRating] = useState(0);
  const [comment, setComment] = useState('');
  const [existingRating, setExistingRating] = useState<any>(null);
  const [isEditingRating, setIsEditingRating] = useState(false);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  
  // Shopping Cart States
  const [isInCart, setIsInCart] = useState(false);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  
  // Animation States für sanftes Einblenden der Produktkarten
  const [productAnimations, setProductAnimations] = useState<{[key: string]: Animated.Value}>({});

  // Animation für den Alternatives Header
  const [headerAnimation] = useState(new Animated.Value(0));
  
  // Animation für "Weitere enttarnte Produkte" Header
  const [weitereHeaderAnimation] = useState(new Animated.Value(0));

  // 🎨 Sanfte Animation für Produktkarten mit Scale + Fade
  // Get rating circle color based on rating value
  const getRatingCircleColor = (rating: number) => {
    if (rating >= 4.5) return colors.primary; // Primary grün bei 4.5-5
    if (rating >= 4) return '#4CAF50'; // Leicht grün bei 4-4.5  
    if (rating >= 3) return '#FFC107'; // Gelb bei 3-4
    if (rating >= 2) return '#FF9800'; // Orange bei 2-3
    return '#F44336'; // Rot bei 1-2
  };

  const animateProductCard = (productId: string, delay: number = 0) => {
    if (!productAnimations[productId]) {
      const newOpacity = new Animated.Value(0);
      const newScale = new Animated.Value(0.8); // Startet etwas kleiner
      setProductAnimations(prev => ({ 
        ...prev, 
        [productId]: newOpacity,
        [`${productId}_scale`]: newScale
      }));
      
      setTimeout(() => {
        // Parallel Animation: Fade + Scale
        Animated.parallel([
        Animated.timing(newOpacity, {
          toValue: 1,
            duration: 250, // Schnellere Animation
          useNativeDriver: true,
          }),
          Animated.spring(newScale, {
            toValue: 1,
            tension: 120, // Straffere Feder
            friction: 7,
            useNativeDriver: true,
          })
        ]).start();
      }, delay);
    }
  };
  
  // Check if product is in shopping cart
  const checkIfInCart = async () => {
    if (!user?.uid || !comparisonData?.mainProduct?.id) return;
    
    try {
      // Check if mainProduct is a brand product (has 'preis' field) or noname (has 'produktName')
      const isMarke = 'preis' in comparisonData.mainProduct && !('produktName' in comparisonData.mainProduct);
      const inCart = await FirestoreService.isInShoppingCart(
        user.uid,
        comparisonData.mainProduct.id,
        isMarke
      );
      setIsInCart(inCart);
    } catch (error) {
      console.error('Error checking cart status:', error);
    }
  };
  
  // Add to shopping cart
  const handleAddToCart = async () => {
    if (!user?.uid) {
      showInfoToast(TOAST_MESSAGES.SHOPPING.addToCartAuthRequired, 'info');
      return;
    }
    
    if (!comparisonData?.mainProduct) return;
    
    if (isInCart) {
      showAlreadyInCartToast(() => router.push('/shopping-list' as any));
      return;
    }
    
    // Animate main cart button before action
    animateButtonPress('main-cart-button');
    
    // Execute the add to cart logic
    executeMainAddToCart();
  };
  
  const executeMainAddToCart = async () => {
    if (!comparisonData?.mainProduct) return;
    
    setIsAddingToCart(true);
    
    try {
      // Check if mainProduct is a brand product (has 'preis' field) or noname (has 'produktName')
      const isMarke = 'preis' in comparisonData.mainProduct && !('produktName' in comparisonData.mainProduct);
      const productName = comparisonData.mainProduct.name || comparisonData.mainProduct.produktName || 'Unbekanntes Produkt';
      const productId = comparisonData.mainProduct.id;
      
      console.log('Adding to cart:', { productId, productName, isMarke });
      
      // 🎯 Track Add-to-Cart wird von FirestoreService automatisch gemacht
      
      // Add to cart with source attribution
      await FirestoreService.addToShoppingCart(
        user.uid,
        productId,
        productName,
        isMarke,
        'comparison', // Source
        { 
          screenName: 'product_comparison',
          comparedWith: comparisonData?.relatedNoNameProducts?.length || 0,
          fromProductType: type
        }
      );
      setIsInCart(true);
      const message = interpolateMessage(TOAST_MESSAGES.SHOPPING.addedToCart, { productName });
      showCartAddedToast(message, () => router.push('/shopping-list' as any));
    } catch (error) {
      console.error('Error adding to cart:', error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.addToCartError, 'error');
    } finally {
      setIsAddingToCart(false);
    }
  };

  // Submit rating function for productRatings table
  const submitRating = async () => {
    if (overallRating === 0) {
              showRatingToast(TOAST_MESSAGES.RATINGS.ratingRequired, 'error');
      return;
    }

    setIsSubmittingRating(true);

    try {
      const productId = selectedProductForDetails?.id || comparisonData?.mainProduct?.id;
      // 🔧 FIX: Prüfe ob es ein NoName-Produkt ist basierend auf der 'stufe' Eigenschaft
      // NoName-Produkte haben eine 'stufe', Markenprodukte nicht
      const currentProduct = selectedProductForDetails || comparisonData?.mainProduct;
      const isNoNameProduct = currentProduct && 'stufe' in currentProduct;
      
      if (isEditingRating && existingRating) {
        // Update existing rating
        const updateData = {
          ratingOverall: overallRating,
          ratingPriceValue: priceValueRating || null,
          ratingTasteFunction: tasteRating || null,
          ratingSimilarity: isNoNameProduct ? (similarityRating || null) : null,
          ratingContent: contentRating || null,
          comment: comment || null,
          updatedate: new Date()
        };

        await FirestoreService.updateProductRating(existingRating.id, updateData);
        showRatingToast(TOAST_MESSAGES.RATINGS.ratingUpdated, 'success');
      } else {
        // Create new rating
      const productRatingData = {
          productID: isNoNameProduct ? productId : null,
          brandProductID: isNoNameProduct ? null : productId,
          userID: user?.uid || 'anonymous-user-' + Date.now(),
        ratingOverall: overallRating,
        ratingPriceValue: priceValueRating || null,
        ratingTasteFunction: tasteRating || null,
          ratingSimilarity: isNoNameProduct ? (similarityRating || null) : null,
        ratingContent: contentRating || null,
        comment: comment || null,
        ratedate: new Date(),
        updatedate: new Date()
      };

      await FirestoreService.addProductRating(productRatingData);
        showRatingToast(TOAST_MESSAGES.RATINGS.ratingSaved, 'success');
        
        // 🎯 TRACK ACTION: submit_rating (nur bei neuer Bewertung, nicht bei Update)
        if (user?.uid) {
          try {
            // Check minTextLength requirement (20 chars)
            const textLength = (comment || '').length;
            if (textLength >= 20) {
              await achievementService.trackAction(user.uid, 'submit_rating', {
                productId: productId,
                productName: isNoNameProduct ? selectedProductForDetails?.name : comparisonData?.mainProduct?.name,
                productType: isNoNameProduct ? 'noname' : 'markenprodukt',
                rating: overallRating,
                commentLength: textLength
              });
              console.log('✅ Action tracked: submit_rating');
            } else {
              console.log('ℹ️ submit_rating not tracked: comment too short (min 20 chars)');
            }
          } catch (error) {
            console.error('Error tracking submit_rating action:', error);
          }
        }
      }

      // Reset form
      setOverallRating(0);
      setTasteRating(0);
      setPriceValueRating(0);
      setContentRating(0);
      setSimilarityRating(0);
      setComment('');
      setExistingRating(null);
      setIsEditingRating(false);
      
      setShowRatingModal(false);
      
      // Reload comparison data to show updated ratings
      await loadComparisonData();
      
      // 🔄 WICHTIG: Ratings auch explizit neu laden (wie bei NoName)
      if (comparisonData?.mainProduct) {
        await loadProductRatings(comparisonData.mainProduct);
      }
      
      // Delayed reload for Cloud Function (3-5 seconds backup)
      setTimeout(async () => {
        console.log('🔄 Delayed backup reload for Cloud Function updates');
        await loadComparisonData();
        // Ratings auch im Backup neu laden
        if (comparisonData?.mainProduct) {
          await loadProductRatings(comparisonData.mainProduct);
        }
      }, 4000);
      
    } catch (error) {
      console.error('Error submitting rating:', error);
      showRatingToast(TOAST_MESSAGES.RATINGS.ratingError, 'error');
    } finally {
      setIsSubmittingRating(false);
    }
  };

  // Load product ratings for the ratings view with user info
  const loadProductRatings = async (productToLoad: any) => {
    if (!productToLoad?.id) {
      console.error('⚠️ loadProductRatings: No product provided!');
      return;
    }
    

    
    // WICHTIG: Reset old ratings BEFORE loading new ones
    setProductRatings([]);
    setRatingStats(null);
    
    try {
      setRatingsLoading(true);
      
      // Determine if it's NoName or Brand product based on the actual product passed
      const isNoNameProduct = productToLoad.stufe !== undefined; // NoName products have stufe, Brand products don't
      
      const ratings = await FirestoreService.getProductRatingsWithUserInfo(productToLoad.id, isNoNameProduct);
      setProductRatings(ratings);
      
      // Calculate rating statistics
      const stats = FirestoreService.calculateRatingStats(ratings);
      setRatingStats(stats);
      

    } catch (error) {
      console.error('Error loading product ratings:', error);
    } finally {
      setRatingsLoading(false);
    }
  };

  // Check for existing rating and open appropriate modal
  const openRatingModal = async () => {
    if (!user?.uid) {
      showRatingToast(TOAST_MESSAGES.RATINGS.authRequired, 'error');
      return;
    }

    const currentProduct = selectedProductForDetails || comparisonData?.mainProduct;
    if (!currentProduct?.id) return;

    try {
      // Check if user has already rated this product
      // 🔧 FIX: Prüfe ob es ein NoName-Produkt ist basierend auf der 'stufe' Eigenschaft
      const isNoNameProduct = currentProduct && 'stufe' in currentProduct;
      const existing = await FirestoreService.getUserRatingForProduct(
        user.uid, 
        currentProduct.id, 
        isNoNameProduct
      );

      if (existing) {
        // Load existing rating for editing
        setExistingRating(existing);
        setIsEditingRating(true);
        setOverallRating(existing.ratingOverall || 0);
        setTasteRating(existing.ratingTasteFunction || 0);
        setPriceValueRating(existing.ratingPriceValue || 0);
        setContentRating(existing.ratingContent || 0);
        setSimilarityRating(existing.ratingSimilarity || 0);
        setComment(existing.comment || '');
      } else {
        // New rating
        setExistingRating(null);
        setIsEditingRating(false);
    setOverallRating(0);
    setTasteRating(0);
    setPriceValueRating(0);
    setContentRating(0);
        setSimilarityRating(0);
    setComment('');
      }

    setShowRatingModal(true);
    } catch (error) {
      console.error('Error checking existing rating:', error);
      // Fallback to new rating
      setExistingRating(null);
      setIsEditingRating(false);
      setOverallRating(0);
      setTasteRating(0);
      setPriceValueRating(0);
      setContentRating(0);
      setSimilarityRating(0);
      setComment('');
      setShowRatingModal(true);
    }
  };
  
  // Ähnliche Produkte laden (für Markenprodukte ohne NoName-Alternativen)
  const loadSimilarProducts = async (categoryName: string, excludeProductId: string, limit: number = 7) => {
    try {
      setSimilarProductsLoading(true);
      
      console.log('🔍 Excluding product ID:', excludeProductId, 'Limit:', limit);
      
      const products = await FirestoreService.getSimilarProducts(categoryName, excludeProductId, limit);
      setSimilarProducts(products);
      
      // 🎨 Animiere Similar Products gestaffelt (schneller)
      products.forEach((product, index) => {
        animateProductCard(product.id, 50 + (index * 80)); // Schnellere Sequenz
      });

    } catch (error) {
      console.error('❌ Error loading similar products:', error);
    } finally {
      setSimilarProductsLoading(false);
    }
  };

  // Reload comparison data function
  const loadComparisonData = async () => {
    if (!id || typeof id !== 'string') {
      return;
    }

    try {

      
      // Determine product type from URL parameter
      const isMarkenProdukt = type === 'brand';
      
      // Get complete comparison data (brand product + related NoNames)
      const data = await FirestoreService.getProductComparisonData(id, isMarkenProdukt);
      
      if (data) {
          // 🚀 SOFORTIGE ANZEIGE: Hauptprodukt + korrekter Header sofort
          setComparisonData(data); // ALLE Daten sofort setzen
          setLoading(false); // UI SOFORT anzeigen!
          
          // 🎨 HEADER ANIMATION: Sanft einblenden nach kurzer Verzögerung
          setTimeout(() => {
            Animated.timing(headerAnimation, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }).start();
          }, 150);
          
          // 🎨 PRODUKT ANIMATIONEN: Alle Produkte einzeln animieren
          // Brand-Produkt sofort animieren
          animateProductCard(data.mainProduct.id, 100);
          
          // NoName-Produkte gestaffelt animieren
          data.relatedNoNameProducts.forEach((product, index) => {
            animateProductCard(product.id, 300 + (index * 120));
          });
          
          // 🆕 Für Stufe 3,4,5 Produkte: Lade "Weitere enttarnte Produkte" 
          if (data.relatedNoNameProducts.length > 0 && data.mainProduct.kategorie?.bezeichnung) {
            // Berechne wann die letzte NoName-Karte startet
            const lastNoNameCardDelay = 300 + ((data.relatedNoNameProducts.length - 1) * 120);
            
            // Header direkt nach letzter Karte (nur +120ms)
            setTimeout(() => {
              // ✨ Header sofort animieren
              Animated.timing(weitereHeaderAnimation, {
                toValue: 1,
                duration: 300, // Schnellere Animation
                useNativeDriver: true,
              }).start();
              
              // Lade Similar Products sofort
              loadSimilarProducts(data.mainProduct.kategorie.bezeichnung, id, 4);
            }, lastNoNameCardDelay + 60);
          }
          
          // OpenFood API im Hintergrund laden
          setTimeout(() => loadOpenFoodData(data), 400);
      }
    } catch (err) {
      console.error('Error reloading product comparison:', err);
    }
  };
  
  // Firestore data states
  const [comparisonData, setComparisonData] = useState<{
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
    clickedProductId: string;
    clickedWasNoName: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // OpenFood API Daten
  const [openFoodData, setOpenFoodData] = useState<Map<string, OpenFoodProduct | null>>(new Map());
  const [openFoodLoading, setOpenFoodLoading] = useState(false);
  
  // 🚀 PERFORMANCE: Memoized Ersparnis-Berechnungen (verhindert Re-Renders)
  const savingsDataCache = useMemo(() => {
    if (!comparisonData?.mainProduct || !comparisonData?.relatedNoNameProducts) {
      return new Map();
    }
    
    const cache = new Map();
    comparisonData.relatedNoNameProducts.forEach(noNameProduct => {
      const savingsData = getSavingsData(comparisonData.mainProduct, noNameProduct);
      const displayData = getSavingsDisplay(comparisonData.mainProduct, noNameProduct, colors);
      cache.set(noNameProduct.id, { savingsData, displayData });
    });
    
    if (__DEV__) {
      console.log(`🚀 Ersparnis-Cache erstellt für ${cache.size} Produkte`);
    }
    
    return cache;
  }, [comparisonData?.mainProduct, comparisonData?.relatedNoNameProducts, colors]);
  
  // Aktuell ausgewähltes Produkt für Details Modal
  const [selectedProductForDetails, setSelectedProductForDetails] = useState<ProductWithDetails | MarkenProduktWithDetails | null>(null);
  
  // Image Viewer Modal States
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>('');
  const [imageLoading, setImageLoading] = useState(false);
  
  // Stages Bottom Sheet State
  const [showStagesInfo, setShowStagesInfo] = useState(false);
  
  // Product Selection States für Vergleichsfunktion
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [showComparisonSheet, setShowComparisonSheet] = useState(false);
  
  // Button Animation States (Herz, Cart, Selection)
  const [buttonAnimations, setButtonAnimations] = useState<{[key: string]: Animated.Value}>({});
  
  // Card Selection Animation States (subtile Card-Animation)
  const [cardAnimations, setCardAnimations] = useState<{[key: string]: Animated.Value}>({});
  
  // Header Button Animation (für Vergleich-Button)
  const [headerButtonAnimation] = useState(new Animated.Value(1));
  
  // Onboarding Detection - solange bis Sheet geöffnet wurde
  const [showOnboarding, setShowOnboarding] = useState(false);
  
  // Helper: Animate any button on press (universal für alle Buttons)
  const animateButtonPress = (buttonId: string) => {
    if (!buttonAnimations[buttonId]) {
      const newAnim = new Animated.Value(1);
      setButtonAnimations(prev => ({ ...prev, [buttonId]: newAnim }));
      
      // Quick scale animation
      Animated.sequence([
        Animated.timing(newAnim, {
          toValue: 1.2,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(newAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Reuse existing animation
      Animated.sequence([
        Animated.timing(buttonAnimations[buttonId], {
          toValue: 1.2,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(buttonAnimations[buttonId], {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  // Helper: Animate card on selection (subtile Scale-Animation)
  const animateCardSelection = (cardId: string) => {
    if (!cardAnimations[cardId]) {
      const newAnim = new Animated.Value(1);
      setCardAnimations(prev => ({ ...prev, [cardId]: newAnim }));
      
      // Subtle card bounce animation
      Animated.sequence([
        Animated.timing(newAnim, {
          toValue: 1.02,  // Sehr subtil - nur 2% größer
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(newAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Reuse existing animation
      Animated.sequence([
        Animated.timing(cardAnimations[cardId], {
          toValue: 1.02,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.timing(cardAnimations[cardId], {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  };

  // Helper: Pulse animation für Onboarding-Hints
  const pulseIcon = (animationValue: Animated.Value, iterations: number = 3) => {
    const animations = [];
    for (let i = 0; i < iterations; i++) {
      animations.push(
        Animated.timing(animationValue, {
          toValue: 1.3,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(animationValue, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        })
      );
    }
    Animated.sequence(animations).start();
  };

  // Helper: Pulse Header-Button
  const pulseHeaderButton = () => {
    pulseIcon(headerButtonAnimation, 2); // 2 Pulse-Zyklen
  };

  // Helper: Prepare animation for icon if it doesn't exist
  const prepareIconAnimation = (buttonId: string) => {
    if (!buttonAnimations[buttonId]) {
      const newAnim = new Animated.Value(1);
      setButtonAnimations(prev => ({ ...prev, [buttonId]: newAnim }));
      return newAnim;
    }
    return buttonAnimations[buttonId];
  };

  // Helper: Open comparison sheet and mark as used (Onboarding beenden)
  const openComparisonSheet = async () => {
    setShowComparisonSheet(true);
    // Onboarding nur beim ersten Sheet-Öffnen beenden
    if (showOnboarding) {
      try {
        await AsyncStorage.setItem('@comparison_sheet_used', 'true');
        setShowOnboarding(false);
      } catch (error) {
        console.log('Could not save sheet usage status');
      }
    }
  };

  // Check if product is in cart when data loads
  useEffect(() => {
    if (comparisonData?.mainProduct) {
      checkIfInCart();
    }
  }, [comparisonData?.mainProduct?.id, user?.uid]);

  // Refresh cart status when screen comes back into focus
  useFocusEffect(
    useCallback(() => {
      if (comparisonData?.mainProduct) {
        checkIfInCart();
      }
    }, [comparisonData?.mainProduct?.id, user?.uid])
  );

  // Alle NoName-Produkte standardmäßig auswählen wenn Daten geladen sind
  useEffect(() => {
    if (comparisonData?.relatedNoNameProducts) {
      const allNoNameIds = new Set(comparisonData.relatedNoNameProducts.map(product => product.id));
      setSelectedProducts(allNoNameIds);
    }
  }, [comparisonData?.relatedNoNameProducts?.length]);

  // Onboarding Detection - prüfen ob Sheet schon mal geöffnet wurde
  useEffect(() => {
    const checkSheetUsage = async () => {
      try {
        const hasUsedSheet = await AsyncStorage.getItem('@comparison_sheet_used');
        if (!hasUsedSheet) {
          setShowOnboarding(true);
        }
      } catch (error) {
        console.log('Could not check sheet usage status');
      }
    };
    checkSheetUsage();
  }, []);

  // Onboarding-Animation-Sequenz (bis Sheet verwendet wurde)
  useEffect(() => {
    if (showOnboarding && comparisonData?.relatedNoNameProducts && comparisonData.relatedNoNameProducts.length > 0) {
      // Warte 1.5 Sekunden, dann starte subtile Hints
      setTimeout(() => {
        // 1. Auswahl-Icons pulsieren (staggered)
        comparisonData.relatedNoNameProducts.forEach((product, index) => {
          setTimeout(() => {
            const iconAnim = prepareIconAnimation(`selection-${product.id}`);
            pulseIcon(iconAnim, 2); // 2 Pulse-Zyklen pro Icon
          }, index * 300); // 300ms Stagger zwischen Icons
        });
        
        // 2. Header-Button pulsiert nach den Icons (1.5s nach dem letzten Icon)
        const totalIconTime = comparisonData.relatedNoNameProducts.length * 300 + 1500;
        setTimeout(() => {
          pulseHeaderButton();
        }, totalIconTime);
      }, 1500); // Initial delay
    }
  }, [showOnboarding, comparisonData?.relatedNoNameProducts, buttonAnimations]);
  
  // Toggle product selection
  const toggleProductSelection = (productId: string) => {
    setSelectedProducts(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(productId)) {
        newSelection.delete(productId);
      } else {
        newSelection.add(productId);
      }
      return newSelection;
    });
  };

  // Header-Optionen sofort setzen mit useLayoutEffect
  useLayoutEffect(() => {
    navigation.setOptions({
      ...getNavigationHeaderOptions(colorScheme, 'Produktvergleich'),
      headerRight: selectedProducts.size > 0 ? () => (
        <TouchableOpacity 
          onPress={openComparisonSheet}
          style={{ 
            paddingLeft: 8, 
            paddingRight: 0, 
            paddingVertical: 8,
            position: 'relative'
          }}
        >
          <Animated.View style={{
            transform: [{ scale: headerButtonAnimation }]
          }}>
          <IconSymbol name="arrow.left.arrow.right" size={24} color="white" />
          </Animated.View>
          {selectedProducts.size > 0 && (
            <Animated.View style={{
              position: 'absolute',
              top: 2,
              right: -4,
              backgroundColor: colors.error,
              borderRadius: 10,
              minWidth: 20,
              height: 20,
              justifyContent: 'center',
              alignItems: 'center',
               transform: [{ scale: headerButtonAnimation }]
            }}>
              <ThemedText style={{
                color: 'white',
                fontSize: 12,
                fontWeight: 'bold',
                textAlign: 'center',
                  textAlignVertical: 'center',
                  lineHeight: 15, // Gleich der fontSize für perfekte Zentrierung
                  includeFontPadding: false, // Android-spezifisch: entfernt extra Padding
              }}>
                {selectedProducts.size}
              </ThemedText>
            </Animated.View>
          )}
        </TouchableOpacity>
      ) : undefined,
    });
  }, [navigation, router, colors.primary, colors.error, selectedProducts]);


  // 🚫 KEIN lokaler Achievement-Handler mehr!
  // Achievements werden jetzt ZENTRAL über GamificationProvider mit großen Lottie-Overlays angezeigt!
  
  useEffect(() => {
    async function loadProductComparison() {
      if (!id || typeof id !== 'string') {
        setError('Ungültige Produkt-ID');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        // 🎨 Reset Header Animations
        headerAnimation.setValue(0);
        weitereHeaderAnimation.setValue(0);
        

        
        // Determine product type from URL parameter
        let isMarkenProdukt = type === 'brand';
        
        // SICHERHEITSCHECK: Prüfe echten Produkttyp aus Firestore
        if (!isMarkenProdukt) {
          // Wenn als "noname" angenommen, prüfe ob es wirklich ein Markenprodukt ist
          const markenCheck = await getDoc(doc(db, 'markenProdukte', id));
          if (markenCheck.exists()) {
            console.log('🔧 KORREKTUR: Produkt ist eigentlich ein Markenprodukt!');
            isMarkenProdukt = true;
          }
        }
        
        console.log('📍 FINALER TYP:', {
          urlType: type,
          isMarkenProdukt: isMarkenProdukt,
          correctType: isMarkenProdukt ? 'markenprodukt' : 'noname'
        });
        
        // Get complete comparison data (brand product + related NoNames)
        const data = await FirestoreService.getProductComparisonData(id, isMarkenProdukt);
        
        if (data) {
          // 🚀 SOFORTIGE ANZEIGE: Hauptprodukt + korrekter Header sofort
          setComparisonData(data); // ALLE Daten sofort setzen
          setLoading(false); // UI SOFORT anzeigen!
          
          // 🎨 HEADER ANIMATION: Sanft einblenden nach kurzer Verzögerung
          setTimeout(() => {
            Animated.timing(headerAnimation, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }).start();
          }, 150);
          
          // 🎨 PRODUKT ANIMATIONEN: Alle Produkte einzeln animieren
          // Brand-Produkt sofort animieren
          animateProductCard(data.mainProduct.id, 100);
          
          // NoName-Produkte gestaffelt animieren
          data.relatedNoNameProducts.forEach((product, index) => {
            animateProductCard(product.id, 300 + (index * 120));
          });
          
          // Wenn es ein Markenprodukt ist und keine NoName-Alternativen hat, lade ähnliche Produkte
          if (isMarkenProdukt && data.relatedNoNameProducts.length === 0 && data.mainProduct.kategorie?.bezeichnung) {
            setTimeout(() => {
            loadSimilarProducts(data.mainProduct.kategorie.bezeichnung, id);
            }, 400);
          }
          
          // 🆕 Für Stufe 3,4,5 Produkte: Lade "Weitere enttarnte Produkte" 
          if (data.relatedNoNameProducts.length > 0 && data.mainProduct.kategorie?.bezeichnung) {
            // Berechne wann die letzte NoName-Karte startet
            const lastNoNameCardDelay = 300 + ((data.relatedNoNameProducts.length - 1) * 120);
            
            // Header direkt nach letzter Karte (nur +120ms)
            setTimeout(() => {
              // ✨ Header sofort animieren
              Animated.timing(weitereHeaderAnimation, {
                toValue: 1,
                duration: 300, // Schnellere Animation
                useNativeDriver: true,
              }).start();
              
              // Lade Similar Products sofort
              loadSimilarProducts(data.mainProduct.kategorie.bezeichnung, id, 4);
            }, lastNoNameCardDelay + 120);
          }
          
          // OpenFood API im Hintergrund laden
          setTimeout(() => loadOpenFoodData(data), 400);
          
          // Track Achievement: view_comparison
          if (user?.uid) {
            achievementService.trackAction(user.uid, 'view_comparison', {
              productId: id,
              productType: type
            });
          }
        } else {
          setError('Produkt nicht gefunden');
        }
      } catch (err) {
        console.error('Error loading product comparison:', err);
        setError('Fehler beim Laden des Produkts');
      } finally {
        setLoading(false);
      }
    }

    loadProductComparison();
  }, [id]);

  // OpenFood API Daten nachladen (asynchron)
  const loadOpenFoodData = async (data: {
    mainProduct: MarkenProduktWithDetails;
    relatedNoNameProducts: ProductWithDetails[];
  }) => {
    try {
      setOpenFoodLoading(true);

      
      // Sammle alle EANs
      const allEANs: string[] = [];
      
      // Hauptprodukt EAN (gleiche Logik wie im Details Modal)
      if (data.mainProduct.EANs && data.mainProduct.EANs.length > 0) {
        allEANs.push(data.mainProduct.EANs[0]);
      } else if (data.mainProduct.gtin) {
        allEANs.push(data.mainProduct.gtin);
      }
      
      // NoName Produkte EANs (gleiche Logik wie im Details Modal)
      data.relatedNoNameProducts.forEach(product => {
        if (product.EANs && product.EANs.length > 0) {
          allEANs.push(product.EANs[0]);
        } else if (product.gtin) {
          allEANs.push(product.gtin);
        }
      });
      
      if (allEANs.length > 0) {

        const openFoodResults = await OpenFoodService.getProductsByEANs(allEANs);
        setOpenFoodData(openFoodResults);

      }
    } catch (error) {
      console.error('❌ Error loading OpenFood data:', error);
    } finally {
      setOpenFoodLoading(false);
    }
  };

  // Helper functions for data formatting
  const formatPrice = (price: number) => {
    return `€ ${price.toFixed(2).replace('.', ',')}`;
  };

  const getStufeDisplay = (stufe?: string) => {
    return stufe ? `Stufe ${stufe}` : 'Unbekannt';
  };

  const getPackageInfo = (packSize?: number, packTypInfo?: { typ: string; typKurz: string }) => {
    if (!packSize) return '0 g';
    if (packTypInfo) {
      return `${packSize} ${packTypInfo.typKurz}`;
    }
    return `${packSize} g`;
  };

  // Mock data - exakt wie im Screenshot (fallback for testing)
  const brandProduct = {
    id: '1',
    name: 'Bio Tofu Natur',
    brand: 'Berief',
    price: 4.09,
    image: require('@/assets/images/react-logo.png'), // Real product image later
    category: 'Veggie und Vegan',
    weight: '400 g',
    rating: 4.0,
    reviews: 1345,
    nutriscore: 'A',
    ecoscore: 'A',
    nova: 3,
    manufacturer: 'Soja Food GmbH',
      location: 'Beckum (DE)',
    ingredients: 'Sojabohnen*, Trinkwasser. *aus biologischem Anbau',
    nutrition: {
      energy: '137 kcal',
      fat: '8.0 g',
      carbs: '0.7 g',
      sugar: '0.5 g',
      protein: '15.4 g',
      salt: '0.03 g'
    }
  };

  const alternatives = [
    {
      id: '2',
      name: 'Tofu Natur',
      brand: 'Rewe Bio',
      price: 2.19,
      discount: -46,
      image: require('@/assets/images/react-logo.png'), // Gelbes Produkt
      market: 'REWE (DE)',
      category: 'Veggie und Vegan',
      similarityLevel: 4,
      weight: '400 g',
      rating: 4.5,
      reviews: 345,
      nutriscore: 'A',
      ecoscore: 'A',
      nova: 3,
    },
    {
      id: '3',
      name: 'Veganer Bio Tofu Natur',
      brand: 'K-Take it Veggie',
      price: 2.09,
      discount: -49,
      image: require('@/assets/images/react-logo.png'), // Grünes Produkt
      market: 'Kaufland (DE)',
      category: 'Veggie und Vegan',
      similarityLevel: 5,
      weight: '400 g',
      rating: 4.2,
      reviews: 89,
      nutriscore: 'A',
      ecoscore: 'A',
      nova: 3,
    }
  ];

  // Mock-Daten für regionale Informationen
  const regionalData = [
    { region: 'Bayern', hersteller: 'Soja Food GmbH', isActive: true },
    { region: 'BaWü', hersteller: 'Soja Food GmbH' },
    { region: 'Berlin', hersteller: 'Soja Food GmbH' },
    { region: 'DE Rest', hersteller: 'Soja Food GmbH' }
  ];

  const getSimilarityColor = (level: number) => {
    switch (level) {
      case 5: return '#4CAF50';
      case 4: return '#8BC34A';
      case 3: return '#FF9800';
      case 2: return '#FF5722';
      case 1: return '#F44336';
      default: return colors.icon;
    }
  };

  const ScoreImage = ({ type, value }: { type: 'nutri' | 'eco' | 'nova'; value: string | number }) => {
  return (
      <View style={styles.scoreContainer}>
        <Image 
          source={{
            uri: `https://markendetektive.de/images/scores/${type}_${String(value).toLowerCase()}.png`
          }} 
          style={styles.scoreImage}
          defaultSource={require('@/assets/images/react-logo.png')}
        />
      </View>
    );
  };

  // Show skeleton while loading
  if (loading || !comparisonData) {
  return (
      <ThemedView style={[styles.container]}>

        <ScrollView 
          style={styles.scrollView} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Skeleton Main Product Card */}
          <View style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
            {/* Skeleton Chips Row */}
            <View style={styles.chipsRow}>
              <ShimmerSkeleton width={100} height={28} style={{ borderRadius: 14 }} />
              <ShimmerSkeleton width={80} height={28} style={{ borderRadius: 14 }} />
          </View>

            {/* Skeleton Product Row */}
            <View style={styles.productRow}>
              <ShimmerSkeleton width={80} height={80} style={{ borderRadius: 12 }} />
          <View style={styles.productInfo}>
                <ShimmerSkeleton width="70%" height={16} style={{ marginBottom: 8 }} />
                <ShimmerSkeleton width="90%" height={20} style={{ marginBottom: 12 }} />
                <View style={styles.ratingRow}>
                  <ShimmerSkeleton width={40} height={16} />
                  <ShimmerSkeleton width={100} height={16} />
                  <ShimmerSkeleton width={50} height={16} />
            </View>

              </View>
              <View style={styles.priceSection}>
                <ShimmerSkeleton width="100%" height={24} style={{ marginBottom: 4 }} />
                <ShimmerSkeleton width="80%" height={16} />
              </View>
            </View>

            {/* Skeleton Action Buttons */}
            <View style={styles.actionButtonsRow}>
              <ShimmerSkeleton width="75%" height={44} style={{ borderRadius: 12 }} />
              <ShimmerSkeleton width={44} height={44} style={{ borderRadius: 12 }} />
            </View>
          </View>

          {/* Skeleton Alternatives Section */}
          <View style={styles.alternativesContainer}>
            {/* Skeleton Alternative Products */}
            {[1, 2].map((index) => (
              <View key={index} style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
                <View style={styles.chipsRow}>
                  <ShimmerSkeleton width={90} height={28} style={{ borderRadius: 14 }} />
                  <ShimmerSkeleton width={70} height={28} style={{ borderRadius: 14 }} />
                  <ShimmerSkeleton width={60} height={28} style={{ borderRadius: 14 }} />
                </View>
                <View style={styles.productRow}>
                  <ShimmerSkeleton width={80} height={80} style={{ borderRadius: 12 }} />
                  <View style={styles.productInfo}>
                    <ShimmerSkeleton width="60%" height={16} style={{ marginBottom: 8 }} />
                    <ShimmerSkeleton width="85%" height={20} style={{ marginBottom: 12 }} />
                    <View style={styles.ratingRow}>
                      <ShimmerSkeleton width={40} height={16} />
                      <ShimmerSkeleton width={100} height={16} />
                      <ShimmerSkeleton width={50} height={16} />
                    </View>
                  </View>
                  <View style={styles.priceSection}>
                    <View style={styles.discountRow}>
                      <ShimmerSkeleton width={50} height={16} />
                    </View>
                    <ShimmerSkeleton width="100%" height={24} style={{ marginBottom: 4 }} />
                    <ShimmerSkeleton width="70%" height={16} />
                  </View>
                </View>
                <View style={styles.actionButtonsRow}>
                  <ShimmerSkeleton width="75%" height={44} style={{ borderRadius: 12 }} />
                  <ShimmerSkeleton width={44} height={44} style={{ borderRadius: 12 }} />
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </ThemedView>
    );
  }

  // Show error screen
  if (error) {
    return (
      <ThemedView style={[styles.container, styles.centerContent]}>

        <IconSymbol name="exclamationmark.triangle" size={48} color={colors.error || '#FF3B30'} />
        <ThemedText style={[styles.errorText, { color: colors.error || '#FF3B30' }]}>
          {error}
              </ThemedText>
      </ThemedView>
    );
  }

  // Show product not found
  if (!comparisonData) {
    return (
      <ThemedView style={[styles.container, styles.centerContent]}>

        <IconSymbol name="questionmark.circle" size={48} color={colors.icon} />
        <ThemedText style={[styles.notFoundText, { color: colors.icon }]}>
          Produkt nicht gefunden
              </ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
    <ThemedView style={styles.container}>

      <ScrollView 
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        scrollEventThrottle={16}
      >
        {/* Main Brand Product Section */}
        <Animated.View 
          style={[
            styles.productCard, 
            { 
              backgroundColor: colors.cardBackground,
              opacity: productAnimations[comparisonData.mainProduct.id] || 0, // ✨ Animation für Hauptprodukt
              transform: [{ scale: productAnimations[`${comparisonData.mainProduct.id}_scale`] || 0.8 }]
            }
          ]}
        >
          {/* Top Chips Row */}
          <View style={styles.chipsRow}>
            <View style={[styles.brandChip, { backgroundColor: colors.primary }]}>
              <IconSymbol name="square.grid.2x2" size={12} color="white" />
              <ThemedText style={styles.chipText}>
              Markenprodukt
            </ThemedText>
              </View>
            {comparisonData.mainProduct.kategorie && (
              <View style={[styles.categoryMiniCard, { backgroundColor: colors.card }]}>
                <ThemedText style={[styles.categoryText, { color: colors.icon }]}>
                  {comparisonData.mainProduct.kategorie.bezeichnung}
                </ThemedText>
              </View>
            )}
            <View style={styles.spacer} />
                </View>

          {/* Product Row */}
          <View style={styles.productRow}>
            {/* Product Image */}
            <TouchableOpacity 
              style={styles.productImageContainer}
              onPress={() => comparisonData.mainProduct.bild && openImageViewer(comparisonData.mainProduct.bild)}
              disabled={!comparisonData.mainProduct.bild}
            >
              {comparisonData.mainProduct.bild ? (
                <Image 
                  source={{ uri: comparisonData.mainProduct.bild }}
                  style={styles.productImage}
                />
              ) : (
                <View style={[styles.productImagePlaceholder, { backgroundColor: colors.border }]}>
                  <IconSymbol name="photo" size={32} color={colors.icon} />
                </View>
              )}
            </TouchableOpacity>

            {/* Product Info */}
          <View style={styles.productInfo}>
              <View style={styles.brandRow}>
                {/* Marke ist in hersteller gespeichert */}
                {comparisonData.mainProduct.hersteller?.bild && (
                        <Image 
                    source={{ uri: comparisonData.mainProduct.hersteller.bild }}
                          style={styles.brandImage}
                          resizeMode="contain"
                        />
                      )}
                      <ThemedText style={[styles.brandText, { color: colors.primary }]}>
                  {comparisonData.mainProduct.marke?.name || comparisonData.mainProduct.hersteller?.herstellername || comparisonData.mainProduct.hersteller?.name || 'Markenprodukt'}
                      </ThemedText>
                </View>
              <ThemedText style={styles.productTitle}>
                {comparisonData.mainProduct.name}
              </ThemedText>

            </View>

            {/* Price Section */}
            <View style={styles.priceSection}>
              <ThemedText style={[styles.mainPrice, { color: colors.icon }]}>
                {formatPrice(comparisonData.mainProduct.preis)}
              </ThemedText>
              <ThemedText style={[styles.mainWeight, { color: colors.icon }]}>
                {getPackageInfo(comparisonData.mainProduct.packSize, comparisonData.mainProduct.packTypInfo)}
              </ThemedText>
            </View>
          </View>


          {/* Horizontal Divider */}
          <View style={[styles.horizontalDivider, { backgroundColor: colors.border }]} />

          {/* Ratings and Cart Button Row */}
          <View style={styles.ratingsCartRowDirect}>
          <TouchableOpacity 
              style={styles.ratingsSection}
              onPress={() => {
                setSelectedProductForDetails(comparisonData.mainProduct);
                setShowRatingsView(true);
                loadProductRatings(comparisonData.mainProduct);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.ratingCircle, { backgroundColor: getRatingCircleColor(comparisonData.mainProduct.averageRatingOverall || 0) }]}>
                <ThemedText style={styles.ratingCircleText}>
                  {(comparisonData.mainProduct.averageRatingOverall || 0).toFixed(1)}
            </ThemedText>
              </View>
              <View style={styles.ratingsContent}>
                <ThemedText style={[styles.ratingsText, { color: colors.icon }]}>
                  Bewertungen
                </ThemedText>
                <View style={styles.starsContainer}>
                  <StarRatingDisplay 
                    rating={comparisonData.mainProduct.averageRatingOverall || 0}
                    colors={colors}
                    size={16}
                    showValue={false}
                  />
                  <ThemedText style={[styles.ratingsCount, { color: colors.icon }]}>
                    ({comparisonData.mainProduct.ratingCount || 0})
                  </ThemedText>
                </View>
              </View>
            </TouchableOpacity>
            
            {/* Favorite Heart Button */}
            <TouchableOpacity 
              style={[styles.cartButtonGray, { backgroundColor: colors.background, marginRight: 12 }]} 
              onPress={async () => {
                if (comparisonData?.mainProduct) {
                  // Intelligente Typ-Erkennung
                  let correctType: 'markenprodukt' | 'noname' = type === 'brand' ? 'markenprodukt' : 'noname';
                  
                  // SICHERHEITSCHECK: Falls URL-Parameter falsch ist
                  if (correctType === 'noname') {
                    const markenCheck = await getDoc(doc(db, 'markenProdukte', comparisonData.mainProduct.id));
                    if (markenCheck.exists()) {
                      correctType = 'markenprodukt';
                      console.log('🔧 FAVORIT-KORREKTUR: Typ korrigiert zu markenprodukt');
                    }
                  }
                  
                  // Animate heart before action
                  animateButtonPress('main-product-heart');
                  handleToggleFavorite(comparisonData.mainProduct, correctType);
                }
              }}
            >
              <Animated.View style={{
                transform: [{ scale: buttonAnimations['main-product-heart'] || new Animated.Value(1) }]
              }}>
                <IconSymbol 
                  name={comparisonData?.mainProduct && (isLocalFavorite(comparisonData.mainProduct.id, 'markenprodukt') || isLocalFavorite(comparisonData.mainProduct.id, 'noname')) ? "heart.fill" : "heart"} 
                  size={20} 
                  color={comparisonData?.mainProduct && (isLocalFavorite(comparisonData.mainProduct.id, 'markenprodukt') || isLocalFavorite(comparisonData.mainProduct.id, 'noname')) ? colors.error : colors.icon} 
                />
              </Animated.View>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.cartButtonGray, { 
                backgroundColor: isInCart ? colors.success : colors.background 
              }]}
              onPress={handleAddToCart}
              disabled={isAddingToCart}
            >
              {isAddingToCart ? (
                <ActivityIndicator size="small" color={isInCart ? "white" : colors.icon} />
              ) : (
                <Animated.View style={{
                  transform: [{ scale: buttonAnimations['main-cart-button'] || new Animated.Value(1) }]
                }}>
                  <IconSymbol 
                    name={isInCart ? "checkmark" : "plus"} 
                    size={20} 
                    color={isInCart ? "white" : colors.icon}
                  />
                </Animated.View>
                )}
          </TouchableOpacity>
        </View>

          {/* Details Button */}
          <TouchableOpacity 
            style={[styles.detailsButtonDirect, { backgroundColor: colors.primary }]}
            onPress={() => {
              setSelectedProductForDetails(comparisonData.mainProduct);
              setShowProductDetails(true);
            }}
          >
            <IconSymbol name="info.circle" size={16} color="white" />
            <ThemedText style={[styles.detailsTextDirect, { color: "white" }]}>
              Details
            </ThemedText>
          </TouchableOpacity>
        

        </Animated.View>

        {/* Alternatives Section */}
        <View style={styles.alternativesContainer}>
          <Animated.View style={{ opacity: headerAnimation, alignItems: 'center' }}>
            <ThemedText style={[styles.alternativesTitle, { textAlign: 'center' }]}>
            {comparisonData.relatedNoNameProducts.length > 0 
                ? 'NoName Alternativen vom gleichen Hersteller'
              : 'Enttarnte Produkte'
            }
          </ThemedText>
          </Animated.View>
          {comparisonData.relatedNoNameProducts.length === 0 && (
            <Animated.View style={{ opacity: headerAnimation, alignItems: 'center' }}>
              <ThemedText style={[styles.alternativesSubtitle, { color: colors.icon, textAlign: 'center' }]}>
              Entdecke andere Produkte mit Stufe 3, 4 oder 5
            </ThemedText>
            </Animated.View>
          )}

          {/* NoName-Alternativen oder ähnliche Produkte */}
          {comparisonData.relatedNoNameProducts.length > 0 ? (
            // NoName-Alternativen anzeigen
            comparisonData.relatedNoNameProducts.map((noNameProduct, index) => {
                const isSelected = selectedProducts.has(noNameProduct.id);
                return (
              <Animated.View
                key={noNameProduct.id}
                style={[
                  {
                    opacity: productAnimations[noNameProduct.id] || 0, // ✨ Einblend-Animation
                    transform: [
                      { scale: productAnimations[`${noNameProduct.id}_scale`] || 0.8 }, // ✨ Einblend-Scale
                      { scale: cardAnimations[`card-${noNameProduct.id}`] || new Animated.Value(1) } // ✨ Selection-Animation
                    ]
                  }
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.productCard, 
                    { 
                      backgroundColor: colors.cardBackground,
                      // KONSTANTE Border-Width verhindert "Hüpfen" komplett
                      borderWidth: 2,  // Immer 2pt border (elegante Dicke)
                      borderColor: isSelected ? colors.primary : 'transparent',  // Grün sichtbar/unsichtbar
                      // Shadow ersetzt transparente Border bei nicht-ausgewählten Cards
                      shadowColor: isSelected ? 'transparent' : '#000',
                      shadowOffset: { width: 0, height: isSelected ? 0 : 2 },
                      shadowOpacity: isSelected ? 0 : 0.1,
                      shadowRadius: isSelected ? 0 : 4,
                      elevation: isSelected ? 0 : 3,
                    }
                  ]}
                  onPress={() => {
                    // Animate both card and selection icon when card is tapped
                    animateButtonPress(`selection-${noNameProduct.id}`);
                    animateCardSelection(`card-${noNameProduct.id}`);
                    toggleProductSelection(noNameProduct.id);
                  }}
                  activeOpacity={0.7}
              >
                {/* Alternative Chips Row */}
                <View style={styles.chipsRow}>
                  <View style={[styles.marketChip, { backgroundColor: noNameProduct.discounter?.color || colors.primary }]}>
                    <IconSymbol name="house.fill" size={12} color="white" />
                    <ThemedText style={styles.chipText}>
                      {noNameProduct.discounter?.name || 'Unbekannt'}
                  </ThemedText>
                </View>
                  {/* Stufe Chip statt Kategorie - gesamte Card klickbar */}
                  {noNameProduct.stufe && (
                    <TouchableOpacity 
                      style={[styles.stageChip, { backgroundColor: getStufenColor(noNameProduct.stufe) }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        setShowStagesInfo(true);
                      }}
                      activeOpacity={0.8}
                    >
                      <IconSymbol name="chart.bar" size={10} color="white" />
                      <ThemedText style={styles.chipText}>
                        {noNameProduct.stufe}
                  </ThemedText>
                      <IconSymbol name="info.circle" size={12} color="white" />
                    </TouchableOpacity>
                  )}
                  
                  
                  <View style={styles.spacer} />
                  
                  {/* Action Icons rechts oben */}
                  <View style={styles.topActionIcons}>
                    <TouchableOpacity 
                      style={[styles.actionIconButton, { backgroundColor: colors.background }]}
                      onPress={(e) => {
                        e.stopPropagation();
                        // Animate both selection icon and card before action
                        animateButtonPress(`selection-${noNameProduct.id}`);
                        animateCardSelection(`card-${noNameProduct.id}`);
                        toggleProductSelection(noNameProduct.id);
                      }}
                    >
                      <Animated.View style={{
                        transform: [{ scale: buttonAnimations[`selection-${noNameProduct.id}`] || new Animated.Value(1) }]
                      }}>
                      <IconSymbol 
                        name={isSelected ? "checkmark.circle.fill" : "circle"} 
                          size={24} 
                        color={isSelected ? colors.primary : colors.icon} 
                      />
                      </Animated.View>
                    </TouchableOpacity>
                </View>
              </View>

                {/* Product Row */}
                <View style={styles.productRow}>
                  {/* Product Image */}
                  <TouchableOpacity 
                    style={styles.productImageContainer}
                    onPress={() => noNameProduct.bild && openImageViewer(noNameProduct.bild)}
                    disabled={!noNameProduct.bild}
                  >
                    {noNameProduct.bild ? (
                      <Image 
                        source={{ uri: noNameProduct.bild }}
                        style={styles.productImage}
                      />
                    ) : (
                      <View style={[styles.productImagePlaceholder, { backgroundColor: colors.border }]}>
                        <IconSymbol name="photo" size={24} color={colors.icon} />
                </View>
                    )}
                  </TouchableOpacity>

              {/* Product Info */}
                  <View style={styles.productInfo}>
                    <View style={styles.brandRow}>
                    <ThemedText style={[styles.brandText, { color: colors.primary }]}>
                      {noNameProduct.handelsmarke?.bezeichnung || 'NoName-Produkt'}
                  </ThemedText>
                    </View>
                    <ThemedText style={styles.productTitle}>
                      {noNameProduct.name}
                  </ThemedText>
                  </View>

                  {/* Price Section */}
                  <View style={styles.priceSection}>
                                        <ThemedText style={[styles.mainPrice, { color: colors.icon }]}>
                      {formatPrice(noNameProduct.preis)}
                  </ThemedText>
                    <ThemedText style={[styles.mainWeight, { color: colors.icon }]}>
                      {getPackageInfo(noNameProduct.packSize, noNameProduct.packTypInfo)}
                  </ThemedText>
                    <View style={styles.discountRow}>
                      {(() => {
                        // 🚀 PERFORMANCE: Nutze gecachte Ersparnis-Berechnung
                        const cachedData = savingsDataCache.get(noNameProduct.id);
                        const savingsDisplay = cachedData?.displayData || { 
                          text: '±0%', 
                          color: colors.icon, 
                          icon: 'equal' 
                        };
                        return (
                          <>
                            <IconSymbol name={savingsDisplay.icon} size={14} color={savingsDisplay.color} />
                            <ThemedText style={[styles.discountValue, { color: savingsDisplay.color }]}>
                              {savingsDisplay.text}
                    </ThemedText>
                          </>
                        );
                      })()}
                  </View>
                  </View>
                </View>


          {/* Horizontal Divider */}
          <View style={[styles.horizontalDivider, { backgroundColor: colors.border }]} />


              {/* Ratings and Cart Button Row */}
              <View style={styles.ratingsCartRowDirect}>
              <TouchableOpacity 
                  style={styles.ratingsSection}
                  onPress={() => {
                    setSelectedProductForDetails(noNameProduct);
                    setShowRatingsView(true);
                    loadProductRatings(noNameProduct);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={[styles.ratingCircle, { backgroundColor: getRatingCircleColor(noNameProduct.averageRatingOverall || 0) }]}>
                    <ThemedText style={styles.ratingCircleText}>
                      {(noNameProduct.averageRatingOverall || 0).toFixed(1)}
                </ThemedText>
                  </View>
                  <View style={styles.ratingsContent}>
                    <ThemedText style={[styles.ratingsText, { color: colors.icon }]}>
                      Bewertungen
                    </ThemedText>
                    <View style={styles.starsContainer}>
                      <StarRatingDisplay 
                        rating={noNameProduct.averageRatingOverall || 0}
                        colors={colors}
                        size={16}
                        showValue={false}
                      />
                      <ThemedText style={[styles.ratingsCount, { color: colors.icon }]}>
                        ({noNameProduct.ratingCount || 0})
                      </ThemedText>
                    </View>
                  </View>
                </TouchableOpacity>
                
                {/* Favorite Heart Button */}
                <TouchableOpacity 
                  style={[styles.cartButtonGray, { backgroundColor: colors.background, marginRight: 12 }]}
                  onPress={(e) => {
                    e.stopPropagation();
                    // Animate heart before action
                    animateButtonPress(`noname-heart-${noNameProduct.id}`);
                    handleToggleFavorite(noNameProduct, 'noname');
                  }}
                >
                  <Animated.View style={{
                    transform: [{ scale: buttonAnimations[`noname-heart-${noNameProduct.id}`] || new Animated.Value(1) }]
                  }}>
                    <IconSymbol 
                      name={isLocalFavorite(noNameProduct.id, 'noname') ? "heart.fill" : "heart"} 
                      size={20} 
                      color={isLocalFavorite(noNameProduct.id, 'noname') ? colors.error : colors.icon} 
                    />
                  </Animated.View>
                </TouchableOpacity>
                
                <NoNameCartButton 
                  productId={noNameProduct.id}
                  productName={noNameProduct.produktName || noNameProduct.name || 'NoName Produkt'}
                  user={user}
                  colors={colors}
                  animateButtonPress={animateButtonPress}
                  buttonAnimations={buttonAnimations}
                />
              </View>

             
              {/* Details Button */}
              <TouchableOpacity 
                style={[styles.detailsButtonDirect, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setSelectedProductForDetails(noNameProduct);
                  setShowProductDetails(true);
                }}
              >
                <IconSymbol name="info.circle" size={16} color="white" />
                <ThemedText style={[styles.detailsTextDirect, { color: "white" }]}>
                  Details
                </ThemedText>
              </TouchableOpacity>
              </TouchableOpacity>
              </Animated.View>
          );
        })
          ) : null}
        
          {/* 🆕 Weitere enttarnte Produkte für Stufe 3,4,5 */}
          {comparisonData.relatedNoNameProducts.length > 0 && similarProducts.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Animated.View style={{ opacity: weitereHeaderAnimation, marginBottom: 12, alignItems: 'center' }}>
                <ThemedText style={[styles.alternativesTitle, { textAlign: 'center' }]}>
                  Weitere enttarnte Produkte
                </ThemedText>
                <ThemedText style={[styles.alternativesSubtitle, { color: colors.icon, textAlign: 'center' }]}>
                  Entdecke andere Produkte mit Stufe 3, 4 oder 5
                </ThemedText>
              </Animated.View>
              
              {similarProducts.map((product) => (
                <Animated.View 
                  key={product.id}
                  style={{
                    opacity: productAnimations[product.id] || 0,
                    transform: [{ scale: productAnimations[`${product.id}_scale`] || 0.8 }]
                  }}
                >
                <TouchableOpacity 
                  style={[styles.similarProductItem, { backgroundColor: colors.cardBackground }]}
                  onPress={() => router.push(`/product-comparison/${product.id}?type=noname` as any)}
                >
                  <View style={styles.similarProductImageContainer}>
                    {product.bild ? (
                      <ImageWithShimmer
                        source={{ uri: product.bild }}
                        style={styles.similarProductImage}
                        fallbackIcon="cube.box"
                        fallbackIconSize={20}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.similarProductImagePlaceholder, { backgroundColor: colors.border }]}>
                        <IconSymbol name="cube.box" size={20} color={colors.icon} />
                      </View>
                    )}
                  </View>
                  <View style={styles.similarProductContent}>
                    <ThemedText style={[styles.similarProductName, { color: colors.text }]} numberOfLines={2}>
                      {product.name}
                    </ThemedText>
                    <ThemedText style={[styles.similarProductBrand, { color: colors.icon }]} numberOfLines={1}>
                      {product.handelsmarke?.bezeichnung || 'NoName'}
                    </ThemedText>
                    <View style={styles.similarProductBottomRow}>
                      {product.discounter && (
                        <View style={styles.similarProductMarket}>
                          <ImageWithShimmer
                            source={{ uri: product.discounter.bild }}
                            style={styles.similarProductMarketLogo}
                            fallbackIcon="house.fill"
                            fallbackIconSize={12}
                            resizeMode="contain"
                          />
                          <ThemedText style={[styles.similarProductMarketText, { color: colors.icon }]}>
                            {product.discounter.name}
                    </ThemedText>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.similarProductRight}>
                    <View style={[styles.stufeBadgeSmall, { backgroundColor: getStufenColor(parseInt(product.stufe || '3')) }]}>
                      <IconSymbol name="chart.bar" size={8} color="white" />
                      <ThemedText style={styles.stufeBadgeTextSmall}>{product.stufe}</ThemedText>
                    </View>
                    <ThemedText style={[styles.similarProductPrice, { color: colors.primary }]}>
                      {product.preis ? `${product.preis.toFixed(2)} €` : 'Preis n.v.'}
                    </ThemedText>
                  </View>
                  <View style={styles.similarProductChevron}>
                        <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                  </View>
                </TouchableOpacity>
                </Animated.View>
              ))}
            </View>
          )}
        
        {/* Ähnliche Produkte für Markenprodukte ohne NoName-Alternativen */}
        {comparisonData.relatedNoNameProducts.length === 0 && (
          <View style={{ marginTop: 16 }}>
            {similarProductsLoading ? (
              [...Array(3)].map((_, index) => (
                <View key={index} style={[styles.similarProductItem, { backgroundColor: colors.cardBackground }]}>
                  <View style={[styles.similarProductImagePlaceholder, { backgroundColor: colors.border }]} />
                  <View style={styles.similarProductContent}>
                    <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: '80%', height: 14 }]} />
                    <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: '60%', height: 12, marginTop: 4 }]} />
            </View>
                </View>
              ))
            ) : similarProducts.length > 0 ? (
              similarProducts.map((product) => (
                <Animated.View 
                  key={product.id}
                  style={{
                    opacity: productAnimations[product.id] || 0,
                    transform: [{ 
                      scale: productAnimations[`${product.id}_scale`] || 0.8 
                    }]
                  }}
                >
                  <TouchableOpacity
                    style={[
                      styles.productCard, 
                      { 
                        backgroundColor: colors.cardBackground,
                        borderWidth: 2,
                        borderColor: 'transparent',
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 2 },
                        shadowOpacity: 0.1,
                        shadowRadius: 4,
                        elevation: 3,
                      }
                    ]}
                    onPress={() => router.push(`/product-comparison/${product.id}?type=noname` as any)}
                    activeOpacity={0.7}
                  >
                    {/* Chips Row */}
                    <View style={styles.chipsRow}>
                      <View style={[styles.marketChip, { backgroundColor: product.discounter?.color || colors.primary }]}>
                        <IconSymbol name="house.fill" size={12} color="white" />
                        <ThemedText style={styles.chipText}>
                          {product.discounter?.name || 'Unbekannt'}
                        </ThemedText>
                      </View>
                      {product.stufe && (
                        <View style={[styles.stageChip, { backgroundColor: getStufenColor(product.stufe) }]}>
                          <IconSymbol name="chart.bar" size={10} color="white" />
                          <ThemedText style={styles.chipText}>
                            {product.stufe}
                          </ThemedText>
                        </View>
                      )}
                    </View>

                    {/* Product Row */}
                    <View style={styles.productRow}>
                      {/* Product Image */}
                      <TouchableOpacity 
                        style={styles.productImageContainer}
                        onPress={() => product.bild && openImageViewer(product.bild)}
                        disabled={!product.bild}
                      >
                        {product.bild ? (
                          <Image 
                            source={{ uri: product.bild }}
                            style={styles.productImage}
                          />
                        ) : (
                          <View style={[styles.productImagePlaceholder, { backgroundColor: colors.border }]}>
                            <IconSymbol name="photo" size={24} color={colors.icon} />
                          </View>
                        )}
                      </TouchableOpacity>

                      {/* Product Info */}
                      <View style={styles.productInfo}>
                        <View style={styles.brandRow}>
                          <ThemedText style={[styles.brandText, { color: colors.primary }]}>
                            {product.handelsmarke?.bezeichnung || 'NoName-Produkt'}
                          </ThemedText>
                        </View>
                        <ThemedText style={styles.productTitle}>
                          {product.name}
                        </ThemedText>
                      </View>

                      {/* Price Section */}
                      <View style={styles.priceSection}>
                        <ThemedText style={[styles.mainPrice, { color: colors.icon }]}>
                          {formatPrice(product.preis)}
                        </ThemedText>
                        <ThemedText style={[styles.mainWeight, { color: colors.icon }]}>
                          {getPackageInfo(product.packSize, product.packTypInfo)}
                        </ThemedText>
                      </View>
                    </View>

                    {/* Horizontal Divider */}
                    <View style={[styles.horizontalDivider, { backgroundColor: colors.border }]} />

                    {/* Ratings and Cart Button Row */}
                    <View style={styles.ratingsCartRowDirect}>
                      <TouchableOpacity 
                        style={styles.ratingsSection}
                        onPress={() => {
                          setSelectedProductForDetails(product);
                          setShowRatingsView(true);
                          loadProductRatings(product);
                        }}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.ratingCircle, { backgroundColor: getRatingCircleColor(product.averageRatingOverall || 0) }]}>
                          <ThemedText style={styles.ratingCircleText}>
                            {(product.averageRatingOverall || 0).toFixed(1)}
                          </ThemedText>
                        </View>
                        <View style={styles.ratingsContent}>
                          <ThemedText style={[styles.ratingsText, { color: colors.icon }]}>
                            Bewertungen
                          </ThemedText>
                          <View style={styles.starsContainer}>
                            <StarRatingDisplay 
                              rating={product.averageRatingOverall || 0}
                              colors={colors}
                              size={16}
                              showValue={false}
                            />
                            <ThemedText style={[styles.ratingsCount, { color: colors.icon }]}>
                              ({product.ratingCount || 0})
                            </ThemedText>
                          </View>
                        </View>
                      </TouchableOpacity>
                      
                      {/* Favorite Heart Button */}
                      <TouchableOpacity 
                        style={[styles.cartButtonGray, { backgroundColor: colors.background, marginRight: 12 }]}
                        onPress={(e) => {
                          e.stopPropagation();
                          animateButtonPress(`stufe12-heart-${product.id}`);
                          handleToggleFavorite(product, 'noname');
                        }}
                      >
                        <Animated.View style={{
                          transform: [{ scale: buttonAnimations[`stufe12-heart-${product.id}`] || new Animated.Value(1) }]
                        }}>
                          <IconSymbol 
                            name={isLocalFavorite(product.id, 'noname') ? "heart.fill" : "heart"} 
                            size={20} 
                            color={isLocalFavorite(product.id, 'noname') ? colors.error : colors.icon} 
                          />
                        </Animated.View>
                      </TouchableOpacity>
                      
                      <NoNameCartButton 
                        productId={product.id}
                        productName={product.produktName || product.name || 'NoName Produkt'}
                        user={user}
                        colors={colors}
                        animateButtonPress={animateButtonPress}
                        buttonAnimations={buttonAnimations}
                      />
                    </View>

                    {/* Details Button */}
                    <TouchableOpacity 
                      style={[styles.detailsButtonDirect, { backgroundColor: colors.primary }]}
                      onPress={() => {
                        setSelectedProductForDetails(product);
                        setShowProductDetails(true);
                      }}
                    >
                      <IconSymbol name="info.circle" size={16} color="white" />
                      <ThemedText style={[styles.detailsTextDirect, { color: "white" }]}>
                        Details
                      </ThemedText>
                    </TouchableOpacity>
                  </TouchableOpacity>
                </Animated.View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <IconSymbol name="magnifyingglass" size={32} color={colors.icon} />
                <ThemedText style={[styles.emptyText, { color: colors.icon }]}>
                  Keine ähnlichen Produkte gefunden
                </ThemedText>
              </View>
            )}
          </View>
        )}
        </View>
      </ScrollView>


      
      {/* Product Details Bottom Sheet */}
      <Modal
        visible={showProductDetails}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowProductDetails(false)}
      >
        <View style={[styles.bottomSheetContainer, { backgroundColor: colors.background }]}>
          {/* Bottom Sheet Header */}
          <View style={styles.bottomSheetHeader}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.headerRow}>
            <TouchableOpacity 
                style={styles.closeButtonLeft}
                onPress={() => setShowProductDetails(false)}
            >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
            </TouchableOpacity>
              <View style={styles.titleSection}>
                <ThemedText style={styles.bottomSheetTitle}>
                  {(() => {
                    // Bei NoName-Produkten: Handelsmarke anzeigen
                    if ((selectedProductForDetails as ProductWithDetails)?.stufe) {
                      return (selectedProductForDetails as ProductWithDetails).handelsmarke?.bezeichnung || 'NoName-Produkt';
                    }
                    // Bei Markenprodukten: Marke anzeigen  
                    return selectedProductForDetails?.marke?.name || selectedProductForDetails?.hersteller?.herstellername || selectedProductForDetails?.hersteller?.name || 'Markenprodukt';
                  })()}
                </ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.primary }]}>
                  {selectedProductForDetails?.name || 'Produktname'}
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
                         {/* Similarity Section - nur bei NoName-Produkten anzeigen */}
             {(selectedProductForDetails as ProductWithDetails)?.stufe && (
               <View style={[styles.similarityCard, { backgroundColor: colors.cardBackground }]}>
                 <View style={styles.similarityHeaderNew}>
                   <View style={[styles.similarityBadgeRound, { backgroundColor: getStufenColor((selectedProductForDetails as ProductWithDetails).stufe!) }]}>
                     <ThemedText style={styles.similarityNumberRound}>{(selectedProductForDetails as ProductWithDetails).stufe}</ThemedText>
              </View>
                   <View style={styles.similarityTextContainerNew}>
                     <ThemedText style={styles.similarityTitleNew}>
                       {getStufenTitle((selectedProductForDetails as ProductWithDetails).stufe!)}
                     </ThemedText>
                     <ThemedText style={[styles.similarityDescriptionNew, { color: colors.icon }]}>
                       {getStufenDescription((selectedProductForDetails as ProductWithDetails).stufe!)}
              </ThemedText>
            </View>
                 </View>
               </View>
             )}

            {/* Manufacturer Info Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="building.2" size={18} color={colors.primary} />
                <ThemedText style={styles.sectionTitleText}>Herstellerinformationen</ThemedText>
              </View>
              <View style={styles.infoGrid}>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>
                  {selectedProductForDetails?.stufe ? 'Hersteller:' : 'Marke:'}
                </ThemedText>
                <View style={styles.markeRow}>
                  {(() => {
                    const isNoNameProduct = selectedProductForDetails?.stufe;
                    
                    if (isNoNameProduct) {
                      // NoName: Zeige Hersteller (ohne Bild)
                      return (
                        <ThemedText style={[styles.infoValue, { color: colors.icon, flex: 1 }]}>
                          {selectedProductForDetails?.hersteller?.herstellername || 
                           selectedProductForDetails?.hersteller?.name ||
                           'Keine Hersteller-Daten verfügbar'}
                        </ThemedText>
                      );
                    } else {
                      // Bei Markenprodukten: Zeige die Marke (nicht den Hersteller)
                      const direkteMarke = selectedProductForDetails?.marke || selectedProductForDetails?.hersteller;
                      
                      return (
                        <>
                          {direkteMarke?.bild && (
                            <Image 
                              source={{ uri: direkteMarke.bild }}
                              style={styles.markeImage}
                              resizeMode="contain"
                            />
                          )}
                          <ThemedText style={[styles.infoValue, { color: colors.icon, flex: 1 }]}>
                            {direkteMarke?.name || direkteMarke?.herstellername || 'Keine Marke gefunden'}
                          </ThemedText>
                        </>
                      );
                    }
                  })()}
              </View>
              </View>
              {/* Markt Info - NEU hinzugefügt */}
              {selectedProductForDetails?.stufe && selectedProductForDetails?.discounter && (
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Markt:</ThemedText>
                  <View style={styles.markeRow}>
                    {selectedProductForDetails.discounter.bild && (
                      <Image 
                        source={{ uri: selectedProductForDetails.discounter.bild }}
                        style={styles.markeImage}
                        resizeMode="contain"
                      />
                    )}
                    <ThemedText style={[styles.infoValue, { color: colors.icon, flex: 1 }]}>
                      {selectedProductForDetails.discounter.name || 'Keine Markt-Daten verfügbar'}
                    </ThemedText>
                  </View>
                </View>
              )}
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Ort:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                    {(() => {
                      const hersteller = comparisonData?.mainProduct.hersteller;
                      if (!hersteller) return 'Keine Daten verfügbar';
                      
                      const location = hersteller.stadt || hersteller.plz ? 
                        `${hersteller.stadt || ''} ${hersteller.plz ? `(${hersteller.plz})` : ''}`.trim() : 
                        hersteller.land;
                      
                      return location || 'Keine Daten verfügbar';
                    })()}
                  </ThemedText>
              </View>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Infos:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                    {comparisonData?.mainProduct.hersteller?.infos || 'Keine weiteren Informationen'}
                  </ThemedText>
              </View>
              {(() => {
                // Prüfe ob es ein NoName-Produkt ist (hat stufe)
                const isNoNameProduct = selectedProductForDetails?.stufe;
                
                if (isNoNameProduct) {
                  // NoName-Produkt: Zeige alle Marken des Herstellers
                  return (
                    <View style={styles.infoColumn}>
                      <ThemedText style={styles.infoLabel}>Alle Marken dieses Herstellers:</ThemedText>
                      <View style={styles.markenList}>
                        {(() => {
                          const brands = selectedProductForDetails?.brands;
                          if (brands && brands.length > 0) {
                            return brands.map((brand, index) => (
                              <View key={index} style={styles.markenItem}>
                                {brand.bild && (
                                  <Image 
                                    source={{ uri: brand.bild }}
                                    style={styles.markenItemImage}
                                    resizeMode="contain"
                                  />
                                )}
                                <ThemedText style={[styles.markenItemText, { color: colors.icon }]}>
                                  {brand.name}
                                </ThemedText>
                              </View>
                            ));
                          }
                          return (
                            <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                              Keine weiteren Marken verfügbar
                            </ThemedText>
                          );
                        })()}
                      </View>
                    </View>
                  );
                } else {
                  // Markenprodukt: Zeige Hersteller-Informationen
                  return (
              <View style={styles.infoRow}>
                      <ThemedText style={styles.infoLabel}>Hersteller:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                        {selectedProductForDetails?.hersteller?.herstellername || 
                         selectedProductForDetails?.hersteller?.name ||
                         selectedProductForDetails?.marke?.herstellername ||
                         'Keine Hersteller-Daten verfügbar'}
                      </ThemedText>
                    </View>
                  );
                }
              })()}
              </View>
            </View>

            {/* Product Info Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="info.circle" size={18} color={colors.primary} />
                <ThemedText style={styles.sectionTitleText}>Produktinformationen</ThemedText>
              </View>
              <View style={styles.infoGrid}>
              {/* Kategorie Info - NEU hinzugefügt */}
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Kategorie:</ThemedText>
                <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                  {selectedProductForDetails?.kategorie?.bezeichnung || 'Keine Kategorie verfügbar'}
                </ThemedText>
              </View>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Packung:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                    {(() => {
                      const product = selectedProductForDetails;
                      if (!product) return 'Keine Daten verfügbar';
                      
                      const size = product.packSize || 0;
                      const type = product.packTypInfo?.typKurz || product.packTypInfo?.typ || 'g';
                      
                      return `${size} ${type}`;
                    })()}
                  </ThemedText>
              </View>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Zutaten:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                    {(() => {
                      const ean = selectedProductForDetails?.EANs?.[0];
                      if (!ean) return 'Keine Daten verfügbar';
                      const openFoodProduct = openFoodData.get(ean);
                      const ingredients = OpenFoodService.formatIngredients(openFoodProduct);
                      return ingredients || 'Keine Informationen verfügbar';
                    })()}
                  </ThemedText>
            </View>

                {/* Scores Row */}
                {(() => {
                  const ean = selectedProductForDetails?.EANs?.[0];
                  const openFoodProduct = ean ? openFoodData.get(ean) : null;
                  
                  // Scores debug - reduced logging
                  const hasAnyScore = openFoodProduct?.nutriscore_grade || 
                                     openFoodProduct?.ecoscore_grade || 
                                     openFoodProduct?.nova_group;
                  
                  if (!hasAnyScore) return null;
                  
                  return (
              <View style={styles.infoRow}>
                      <ThemedText style={styles.infoLabel}>Scores:</ThemedText>
                                            <View style={styles.scoresInlineRow}>
                        {openFoodProduct?.nutriscore_grade && (
                          <View style={styles.scoreContainer}>
                            <ScoreImage 
                              type="nutri" 
                              value={openFoodProduct.nutriscore_grade.toUpperCase()} 
                            />
              </View>
                        )}
                        {openFoodProduct?.ecoscore_grade && (
                          <View style={styles.scoreContainer}>
                            <ScoreImage 
                              type="eco" 
                              value={openFoodProduct.ecoscore_grade.toUpperCase()} 
                            />
              </View>
                        )}
                        {openFoodProduct?.nova_group && (
                          <View style={styles.scoreContainer}>
                            <ScoreImage 
                              type="nova" 
                              value={String(openFoodProduct.nova_group)} 
                            />
              </View>
                        )}
              </View>
                    </View>
                  );
                })()}
              </View>
            </View>

            
            {/* Nutrition Info Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="leaf" size={18} color={colors.primary} />
                <ThemedText style={styles.sectionTitleText}>Nährwerte</ThemedText>
              </View>
              <View style={styles.infoGrid}>
                {(() => {
                  if (!comparisonData?.mainProduct.EANs?.[0]) {
                    return (
              <View style={styles.infoRow}>
                        <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                          Keine Nährwertdaten verfügbar
                        </ThemedText>
              </View>
                    );
                  }
                  
                  const openFoodProduct = openFoodData.get(comparisonData.mainProduct.EANs[0]);
                  const nutrition = OpenFoodService.formatNutrition(openFoodProduct?.nutriments);
                  
                  if (nutrition.length === 0) {
                    return (
              <View style={styles.infoRow}>
                        <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                          {openFoodLoading ? 'Lade Nährwerte...' : 'Keine Nährwertinformationen verfügbar'}
                        </ThemedText>
              </View>
                    );
                  }
                  
                  return nutrition.map((item, index) => (
                    <View key={index} style={styles.infoRow}>
                      <ThemedText style={styles.infoLabel}>{item.label}:</ThemedText>
                      <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                        {item.value}
                      </ThemedText>
              </View>
                  ));
                })()}
              </View>
              </View>

            {/* Rating Button */}
            <View style={styles.buttonSection}>
              <TouchableOpacity 
                style={[styles.ratingButton, { backgroundColor: colors.primary }]}
                onPress={async () => {
                  const targetProduct = selectedProductForDetails || comparisonData?.mainProduct;
                  console.log('🎯 Opening ratings from product details for:', targetProduct?.name);
                  setShowProductDetails(false);
                  setShowRatingsView(true); // Modal SOFORT öffnen!
                  loadProductRatings(targetProduct); // Parallel laden (ohne await!)
                }}
              >
                <ThemedText style={styles.ratingButtonText}>Bewertungen anzeigen</ThemedText>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Rating Bottom Sheet */}
      <Modal
        visible={showRatingModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRatingModal(false)}
      >
        <View style={[styles.bottomSheetContainer, { backgroundColor: colors.background }]}>
          {/* Rating Header */}
          <View style={styles.bottomSheetHeader}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.headerRow}>
            <TouchableOpacity 
                style={styles.closeButtonLeft}
              onPress={() => setShowRatingModal(false)}
            >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
            </TouchableOpacity>
              <View style={styles.titleSection}>
                <ThemedText style={styles.bottomSheetTitle}>
                  {isEditingRating ? 'Bewertung bearbeiten' : 'Bewertung abgeben'}
                </ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.primary }]}>
                  {selectedProductForDetails?.name || comparisonData?.mainProduct?.name || 'Produkt'}
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
            <View style={styles.ratingForm}>
              <ThemedText style={styles.ratingFormTitle}>Deine Gesamtbewertung</ThemedText>
              <StarRating 
                rating={overallRating} 
                onRatingChange={setOverallRating}
                colors={colors}
              />

              <ThemedText style={styles.ratingFormTitle}>Detail-Bewertung nach Kriterien (optional)</ThemedText>
              
              <View style={styles.criterionRating}>
                <View style={styles.criterionRow}>
                  <ThemedText style={styles.criterionLabelCompact}>Geschmack/Wirkung</ThemedText>
                  <StarRating 
                    rating={tasteRating} 
                    onRatingChange={setTasteRating}
                    size={20}
                    colors={colors}
                  />
                </View>
              </View>

              <View style={styles.criterionRating}>
                <View style={styles.criterionRow}>
                  <ThemedText style={styles.criterionLabelCompact}>Preis-Leistung</ThemedText>
                  <StarRating 
                    rating={priceValueRating} 
                    onRatingChange={setPriceValueRating}
                    size={20}
                    colors={colors}
                  />
                </View>
              </View>

              <View style={styles.criterionRating}>
                <View style={styles.criterionRow}>
                  <ThemedText style={styles.criterionLabelCompact}>Inhaltsstoffe</ThemedText>
                  <StarRating 
                    rating={contentRating} 
                    onRatingChange={setContentRating}
                    size={20}
                    colors={colors}
                  />
                </View>
              </View>

              {/* Ähnlichkeit nur für NoName-Produkte */}
              {((selectedProductForDetails || comparisonData?.mainProduct) && 
                'stufe' in (selectedProductForDetails || comparisonData?.mainProduct || {})) && (
                <View style={styles.criterionRating}>
                  <View style={styles.criterionRow}>
                    <ThemedText style={styles.criterionLabelCompact}>Ähnlichkeit zum Markenprodukt</ThemedText>
                    <StarRating 
                      rating={similarityRating} 
                      onRatingChange={setSimilarityRating}
                      size={20}
                      colors={colors}
                    />
                  </View>
                </View>
              )}

              <ThemedText style={styles.ratingFormTitle}>Dein Kommentar (optional)</ThemedText>
              <TextInput
                style={[styles.commentInput, { 
                  borderColor: colors.border, 
                  backgroundColor: colors.cardBackground,
                  color: colors.text 
                }]}
                placeholder="Teile deine Erfahrungen mit diesem Produkt..."
                placeholderTextColor={colors.icon}
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              <TouchableOpacity 
                style={[
                  styles.submitButton, 
                  { 
                    backgroundColor: overallRating > 0 ? colors.primary : colors.border,
                    opacity: isSubmittingRating ? 0.7 : 1
                  }
                ]}
                onPress={submitRating}
                disabled={overallRating === 0 || isSubmittingRating}
              >
                {isSubmittingRating ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <ThemedText style={styles.submitButtonText}>
                    {isEditingRating ? 'Bewertung aktualisieren' : 'Bewertung speichern'}
                  </ThemedText>
                )}
                  </TouchableOpacity>
              </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Image Viewer Modal */}
      <Modal
        visible={imageViewerVisible}
        transparent={true}
        onRequestClose={closeImageViewer}
      >
        <View style={styles.imageViewerContainer}>
          <TouchableOpacity 
            style={styles.imageViewerBackdrop}
            onPress={closeImageViewer}
          >
            <View style={styles.imageViewerContent}>
              <TouchableOpacity 
                style={styles.closeButton}
                onPress={closeImageViewer}
              >
                <IconSymbol name="xmark" size={24} color="white" />
              </TouchableOpacity>
              {/* Loading Indicator */}
              {imageLoading && (
                <View style={styles.imageLoader}>
                  <View style={styles.loaderContainer}>
                    <ActivityIndicator size="large" color="white" />
                    <ThemedText style={styles.loaderText}>Bild wird geladen...</ThemedText>
                  </View>
                </View>
              )}
              
              {selectedImageUrl && (
                <Image 
                  source={{ 
                    uri: selectedImageUrl,
                    cache: 'force-cache'  // Force use cached version
                  }}
                  style={styles.fullScreenImage}
                  resizeMode="contain"
                  onLoad={() => setImageLoading(false)}
                  onError={() => setImageLoading(false)}
                />
              )}
            </View>
                      </TouchableOpacity>
                  </View>
      </Modal>

      {/* Ratings View Bottom Sheet */}
      <Modal
        visible={showRatingsView}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRatingsView(false)}
      >
        <View style={[styles.bottomSheetContainer, { backgroundColor: colors.background }]}>
          {/* Header */}
          <View style={styles.bottomSheetHeader}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
                </View>
            <View style={styles.headerRow}>
              <TouchableOpacity 
                style={styles.closeButtonLeft}
                onPress={() => setShowRatingsView(false)}
              >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
              </TouchableOpacity>
              <View style={styles.titleSection}>
                <ThemedText style={styles.bottomSheetTitle}>Bewertungen</ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.primary }]}>
                  {selectedProductForDetails?.name || comparisonData?.mainProduct?.name || 'Produkt'}
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
            {/* Loading state or data */}
            {ratingsLoading ? (
              <>
                <RatingOverviewSkeleton />
                <CommentsHeaderSkeleton />
                <CommentSkeleton />
                <CommentSkeleton />
                <CommentSkeleton />
              </>
            ) : (
              <>
            {/* Overall Rating Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.ratingOverallSection}>
                <View style={[styles.ratingCircleLarge, { backgroundColor: getRatingCircleColor(ratingStats?.averageOverall || 0) }]}>
                  <ThemedText style={styles.ratingCircleNumber}>
                        {(ratingStats?.averageOverall || 0).toFixed(1)}
                  </ThemedText>
                </View>
                <View style={styles.ratingDetails}>
                  <ThemedText style={styles.ratingTitle}>Allgemeine Bewertung</ThemedText>
                  <View style={styles.starsRow}>
                        <StarRatingDisplay 
                          rating={ratingStats?.averageOverall || 0}
                          colors={colors}
                          size={20}
                          showValue={false}
                        />
                  </View>
                  <ThemedText style={[styles.ratingsCount, { color: colors.icon }]}>
                        Basierend auf {ratingStats?.totalCount || 0} Bewertungen
                  </ThemedText>
                </View>
              </View>
            </View>
              </>
            )}

            {/* Detailed Ratings Card */}
            {!ratingsLoading && ratingStats && (
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
                <ThemedText style={[styles.infoLabel, { flexShrink: 0 }]}>Kriterien-Bewertungen</ThemedText>
              
              <View style={styles.criteriaRatings}>
                <View style={styles.criteriaRow}>
                    <ThemedText style={styles.criteriaLabel}>Qualität & Geschmack</ThemedText>
                    <View style={styles.criterionRightSide}>
                      <StarRatingDisplay 
                        rating={ratingStats.averageTaste || 0}
                        colors={colors}
                        size={14}
                        valueStyle={[styles.criteriaValue, { color: colors.icon }]}
                      />
                    </View>
              </View>

                <View style={styles.criteriaRow}>
                  <ThemedText style={styles.criteriaLabel}>Preis-Leistung</ThemedText>
                    <View style={styles.criterionRightSide}>
                      <StarRatingDisplay 
                        rating={ratingStats.averagePrice || 0}
                        colors={colors}
                        size={14}
                        valueStyle={[styles.criteriaValue, { color: colors.icon }]}
                      />
                    </View>
                </View>
                
                <View style={styles.criteriaRow}>
                  <ThemedText style={styles.criteriaLabel}>Inhaltsstoffe</ThemedText>
                    <View style={styles.criterionRightSide}>
                      <StarRatingDisplay 
                        rating={ratingStats.averageContent || 0}
                        colors={colors}
                        size={14}
                        valueStyle={[styles.criteriaValue, { color: colors.icon }]}
                      />
                    </View>
                </View>
                
                  {/* Only show similarity for NoName products */}
                  {((selectedProductForDetails || (showRatingsView && comparisonData?.mainProduct)) && 
                    'stufe' in (selectedProductForDetails || comparisonData?.mainProduct || {})) && (
                <View style={styles.criteriaRow}>
                      <ThemedText style={styles.criteriaLabel}>Ähnlichkeit zu Marke</ThemedText>
                      <View style={styles.criterionRightSide}>
                        <StarRatingDisplay 
                          rating={ratingStats.averageSimilarity || 0}
                          colors={colors}
                          size={14}
                          valueStyle={[styles.criteriaValue, { color: colors.icon }]}
                        />
                </View>
              </View>
                  )}
            </View>
              </View>
            )}

            {/* Rating Button */}
            <View style={styles.buttonSection}>
              <TouchableOpacity 
                style={[styles.ratingButton, { backgroundColor: colors.primary }]}
                onPress={async () => {
                  setShowRatingsView(false);
                  await openRatingModal();
                }}
              >
                <ThemedText style={styles.ratingButtonText}>Bewertung abgeben</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Comments Section - Simpler Style from noname-detail */}
            <View style={[styles.commentsSection, { backgroundColor: colors.cardBackground, marginBottom: 20, marginTop: 6 }]}>
              <View style={styles.commentsSectionHeader}>
                <IconSymbol name="bubble.left.and.bubble.right" size={18} color={colors.primary} />
                <ThemedText style={styles.commentsSectionTitle}>
                  Kommentare
                </ThemedText>
                <View style={[styles.commentCountBadge, { backgroundColor: colors.primary + '20' }]}>
                  <ThemedText style={[styles.commentCountText, { color: colors.primary }]}>
                    {ratingStats?.commentsCount || 0}
                </ThemedText>
              </View>
              </View>
              
              {!ratingsLoading && productRatings.length > 0 ? (
                <>
                  {productRatings
                    .filter(rating => rating.comment && rating.comment.trim())
                    .slice(0, 5) // Show only first 5 comments
                    .map((rating, index) => (
                      <View key={rating.id || index} style={styles.commentItem}>
                        {/* Compact User Header */}
                        <View style={styles.commentUserHeader}>
                          <View style={styles.userAvatarContainer}>
                            {rating.userInfo?.avatarUrl ? (
                              <Image 
                                source={{ uri: rating.userInfo.avatarUrl }}
                                style={styles.userAvatar}
                              />
                            ) : (
                              <View style={[styles.userAvatarPlaceholder, { backgroundColor: colors.border }]}>
                                <ThemedText style={styles.userAvatarText}>
                                  {rating.userInfo?.displayName?.charAt(0)?.toUpperCase() || '?'}
                                </ThemedText>
                              </View>
                            )}
                          </View>
                          <View style={styles.userInfoContainer}>
                            <View style={styles.userTopRow}>
                              <ThemedText style={[styles.userName, { color: colors.text }]}>
                                {rating.userInfo?.displayName || 'Unbekannter User'}
                              </ThemedText>
                              <View style={[styles.userLevelBadge, { backgroundColor: rating.userInfo?.currentLevel?.color || '#6B7280' }]}>
                                <ThemedText style={styles.userLevelText}>
                                  {rating.userInfo?.currentLevel?.name || 'Neuling'}
                                </ThemedText>
                              </View>
                            </View>
                            <View style={styles.userBottomRow}>
                              <StarRatingDisplay 
                                rating={rating.ratingOverall || 0}
                                colors={colors}
                                size={14}
                                showValue={false}
                              />
                              <ThemedText style={[styles.commentDate, { color: colors.icon }]}>
                                {rating.ratedate ? new Date(rating.ratedate).toLocaleDateString('de-DE') : 'Datum unbekannt'}
                              </ThemedText>
                            </View>
                          </View>
                        </View>
                        
                        {/* Comment Text */}
                        <ThemedText style={[styles.commentText, { color: colors.text }]}>
                          {rating.comment}
                        </ThemedText>
                      </View>
                    ))}
                </>
              ) : (
                <View style={styles.noCommentsContainer}>
                  <ThemedText style={[styles.noCommentsText, { color: colors.icon }]}>
                    {ratingsLoading ? 'Lade Kommentare...' : 'Oh, hier ist noch nichts!'}
                  </ThemedText>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Product Comparison Bottom Sheet */}
      <Modal
        visible={showComparisonSheet}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowComparisonSheet(false)}
      >
        <View style={[styles.bottomSheetContainer, { backgroundColor: colors.background }]}>
          {/* Bottom Sheet Header */}
          <View style={styles.bottomSheetHeader}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.headerRow}>
              <TouchableOpacity 
                style={styles.closeButtonLeft}
                onPress={() => setShowComparisonSheet(false)}
              >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
              </TouchableOpacity>
              <View style={styles.titleSection}>
                <ThemedText style={styles.modalTitle}>Produktvergleich</ThemedText>
                <ThemedText style={[styles.modalSubtitle, { color: colors.primary }]}>
                  {comparisonData?.mainProduct?.marke?.name || comparisonData?.mainProduct?.hersteller?.herstellername || comparisonData?.mainProduct?.hersteller?.name || 'Marke'} vs. {Array.from(selectedProducts).map(id => {
                    const product = comparisonData?.relatedNoNameProducts?.find((p: any) => p.id === id);
                    return product?.handelsmarke?.bezeichnung || product?.discounter?.name || 'NoName';
                  }).join(' vs. ')}
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
            {comparisonData && (
              <ProductComparisonContent
                mainProduct={comparisonData.mainProduct}
                selectedProducts={comparisonData.relatedNoNameProducts.filter(p => selectedProducts.has(p.id))}
                openFoodData={openFoodData}
                colors={colors}
                comparisonData={comparisonData}
                productAnimations={productAnimations}
              />
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Stages Info Bottom Sheet */}
      <Modal
        visible={showStagesInfo}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowStagesInfo(false)}
      >
        <View style={[styles.bottomSheetContainer, { backgroundColor: colors.background }]}>
          {/* Bottom Sheet Header */}
          <View style={styles.bottomSheetHeader}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.headerRow}>
              <TouchableOpacity 
                style={styles.closeButtonLeft}
                onPress={() => setShowStagesInfo(false)}
              >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
              </TouchableOpacity>
              <View style={styles.titleSection}>
                <ThemedText style={styles.bottomSheetTitle}>
                  Ähnlichkeitsstufen
                </ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.primary }]}>
                  Bewertung der Produktähnlichkeit
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
            {/* Stages Cards */}
            {[0, 1, 2, 3, 4, 5].map((stage) => (
              <View key={stage} style={[styles.stageInfoCard, { backgroundColor: colors.cardBackground }]}>
                <View style={styles.stageInfoHeader}>
                  <View style={[styles.stageInfoBadge, { backgroundColor: getStufenColor(stage) }]}>
                    <ThemedText style={styles.stageInfoNumber}>{stage}</ThemedText>
                  </View>
                  <View style={styles.stageInfoTextContainer}>
                    <ThemedText style={styles.stageInfoTitle}>
                      {getStufenTitle(stage)}
                    </ThemedText>
                    <ThemedText style={[styles.stageInfoDescription, { color: colors.icon }]}>
                      {getStufenDescription(stage)}
                    </ThemedText>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
      
      {/* Shopping List FAB */}
      <TouchableOpacity 
        style={[styles.shoppingListFab, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/shopping-list')}
      >
        <IconSymbol name="cart.fill" size={20} color="white" />
      </TouchableOpacity>

      {/* LEVEL-UP OVERLAY - Spektakuläre Animation mit Confetti */}
      <LevelUpOverlay
        visible={showLevelUpOverlay}
        newLevel={levelUpData.newLevel}
        oldLevel={levelUpData.oldLevel}
        onClose={() => setShowLevelUpOverlay(false)}
      />

      {/* Alle lokalen Toast-Container entfernt – zentrale Toast-Library übernimmt */}
    </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
  },
  notFoundText: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
    paddingHorizontal: 16,
  },

  // Product Card (shared by main and alternatives)
  productCard: {
    marginVertical: 8,
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
  },

  // Chips Row
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 6,
  },
  brandChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  marketChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  stageChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  chipText: {
    color: 'white',
    fontSize: 10, // Tiny // Tiny - sehr kleine Details
    fontWeight: '600',
  },
  categoryMiniCard: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '500',
  },
  spacer: {
    flex: 1,
  },

  // Product Row
  productRow: {
    flexDirection: 'row',
    alignItems: 'flex-start', // Alle Items oben ausrichten
    marginBottom: 12,
    gap: 10,
  },

  // Product Image
  productImageContainer: {
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  productImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain', // Verhindert Abschneiden
  },
  productImagePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Product Info
  productInfo: {
    flex: 1,
    paddingTop: 0, // Entferne padding um Text ganz oben zu haben
    justifyContent: 'flex-start', // Stelle sicher, dass Content oben bleibt
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    gap: 6,
  },
  brandImage: {
    width: 18,
    height: 18,
    borderRadius: 3,
  },
  brandText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  productTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 0, // Kein Abstand nach unten
    marginTop: 0, // Kein Abstand nach oben
    lineHeight: 20,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 6,
  },
  priceText: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  weightText: {
    fontSize: 12,
    opacity: 0.7,
  },
  discountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  discountValue: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  ratingValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 1,
  },
  starIcon: {
    fontSize: 14,
  },
  reviewsText: {
    fontSize: 12,
    opacity: 0.7,
    marginLeft: 4,
  },
  scoresRow: {
    flexDirection: 'row',
    gap: 4,
  },
  scoreContainer: {
    width: 32,
    height: 16,
  },

  // Price Section (Right)
  priceSection: {
    alignItems: 'flex-end',
    paddingTop: 0, // Entferne padding für bessere Ausrichtung
    minWidth: 80,
    justifyContent: 'flex-start', // Preis-Content auch oben halten
  },
  mainPrice: {
    fontSize: 16, // Large - reduziert von 20
    fontFamily: 'Nunito_700Bold',
    marginBottom: 2,
  },
  mainWeight: {
    fontSize: 12,
    
  },

  // Direct Layout (ohne Box)
  ratingsCartRowDirect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 0,
    marginBottom: 8,
  },
  ratingsSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  ratingCircle: {
    width: 44, // Optimale Größe zwischen Cart Button und zu klein
    height: 44,
    borderRadius: 22, // Halbe Breite für perfekten Kreis
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingCircleText: {
    fontSize: 14, // Passend für 32px Kreis
    fontFamily: 'Nunito_700Bold',
    color: 'white',
  },
  ratingsContent: {
    flex: 1,
    gap: 0, // Kein gap
  },
  starsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4, // Abstand zwischen Sternen und Anzahl
    marginTop: -3, // 3px näher zum "Bewertungen" Text
  },
  ratingsText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
      // Kein zusätzlicher Abstand - gap regelt das
  },
  ratingsCount: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    
  },

  // Details Button direkt (ohne Box)
  detailsButtonDirect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  detailsTextDirect: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
  },

  // Legacy Details Button inside Box (keep for compatibility)
  detailsButtonInBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  detailsTextInBox: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
  },

  // Legacy Details Button (keep for compatibility)
  detailsButtonNew: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    marginTop: 2,
  },
  detailsTextNew: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
  },

  // Legacy Action Buttons Row (keep for compatibility)
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 3,
  },
  detailsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'transparent',
    gap: 6,
    height: 44,
  },
  detailsText: {
    fontSize: 14,
    fontWeight: '500',
  },
  cartButton: {
    width: 44,              // Breiter (35→44)
    height: 44,             // Höher (30→44) - äquivalent zu Details
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartButtonGray: {
    width: 44,
    height: 44,
    borderRadius: 22,       // Runder Kreis wie Favorites Button
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',    // Gleicher Schatten wie actionIconButton
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,          // Android Schatten
  },

  // Alternatives Section
  alternativesContainer: {
    paddingHorizontal: 0,
  },
  alternativesTitle: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 0, // Reduziert von 6 auf 3px
    marginTop: 12,   // Reduziert von 32 auf 16px für weniger Abstand
    marginLeft: 0,
    
  },


  herstellerLabel: {
    fontSize: 12,
    flex: 1,
  },
  stufeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    gap: 2,
  },
  stufeText: {
    color: 'white',
    fontSize: 10, // Tiny
    fontWeight: '600',
  },
  weitereTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 2,
  },
  settingsContainer: {
    alignItems: 'flex-end',
    marginTop: 8,
  },
  settingsButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  divider: {
    height: 1,
    marginVertical: 8,
    opacity: 0.3,
  },
  horizontalDivider: {
    height: 1,
    marginVertical: 4,
    borderRadius: 1,
    opacity: 0.5,
    marginBottom: 12,
  },

  // Bottom Sheet Styles
  bottomSheetContainer: {
    flex: 1,
  },
  bottomSheetHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  handleContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  closeButtonLeft: {
    padding: 8,
    marginTop: -4,
  },
  titleSection: {
    flex: 1,
  },
  bottomSheetTitle: {
    fontSize: 16, // Large - wichtige Überschriften
    fontFamily: 'Nunito_700Bold',
    
  },
  bottomSheetSubtitle: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 2,
  },
  bottomSheetContent: {
    flex: 1,
    paddingHorizontal: 16,
  },

  // Similarity Card
  similarityCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
  },
  similarityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  // Neue runde Similarity Styles wie Referenz
  similarityHeaderNew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  similarityBadgeRound: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  similarityNumberRound: {
    color: 'white',
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
  },
  similarityTextContainerNew: {
    flex: 1,
  },
  similarityTitleNew: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
  },
  similarityDescriptionNew: {
    fontSize: 14,
    lineHeight: 20,
  },
  similarityIndicator: {
    position: 'absolute',
    top: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  similarityText: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  similarityNumber: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  similarityTextContainer: {
    flex: 1,
    minHeight: 50, // Mindesthöhe für mehrzeiligen Text
  },
  similarityTitle: {
    fontSize: 14,
    fontWeight: '600',  // Konsistent mit anderen Titel
    marginBottom: 4,
    lineHeight: 16,     // Kompakter
  },
  similarityDescription: {
    fontSize: 12,
    fontWeight: '300',  // Wie in Alle Level
    lineHeight: 16,     // Mehr Platz für mehrzeiligen Text
    opacity: 0.7,       // Leicht transparent für Hierarchie
  },

  // Info Cards
  infoCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitleText: {
    fontSize: 14,
    fontWeight: '600',  // Konsistent mit anderen Titeln
    lineHeight: 16,
  },
  infoGrid: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',  // Stärker für bessere Lesbarkeit
    width: 120,
    flexShrink: 0,
    lineHeight: 14,
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '300',  // Leichter für Hierarchie
    flex: 1,
    lineHeight: 14,
    opacity: 0.7,       // Helleres Grau wie bei Stufenbeschreibung
  },
  infoColumn: {
    paddingVertical: 6,
  },
  markeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  markeImage: {
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  markenList: {
    marginTop: 8,
    gap: 8,
  },
  markenItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  markenItemImage: {
    width: 20,
    height: 20,
    borderRadius: 3,
  },
  markenItemText: {
    fontSize: 13,
    flex: 1,
    opacity: 0.7,       // Helleres Grau wie bei anderen Info-Texten
  },
  scoreImage: {
    width: 28,
    height: 28,
    resizeMode: 'contain',
  },
  
  // Rating Button
  buttonSection: {
    paddingVertical: 12,
  },
  ratingButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  
  // Rating Form Styles
  ratingForm: {
    paddingBottom: 20, // Reduziert von 40
  },
  ratingFormTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 12, // Reduziert von 16
    marginTop: 4,     // Reduziert von 8
  },
  starRating: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16, // Reduziert von 24
    gap: 6,           // Reduziert von 8
    paddingVertical: 4, // Padding für besseren Touch-Bereich
  },
  starRatingCompact: {
    justifyContent: 'flex-end', // Rechtsbündig für horizontales Layout
    marginBottom: 0,
    gap: 3,           // Weniger Abstand bei kompakten Sternen
    paddingVertical: 2,
  },
  starButton: {
    padding: 6,       // Erhöht von 4 für besseren Touch-Bereich
    minWidth: 36,     // Mindestbreite für Touch-Target
    minHeight: 36,    // Mindesthöhe für Touch-Target
    alignItems: 'center',
    justifyContent: 'center',
  },
  starButtonCompact: {
    padding: 3,       // Kompakter für kleine Sterne
    minWidth: 24,     // Kleinerer Touch-Bereich
    minHeight: 24,
  },
  starIconLarge: {
    fontSize: 16,     // Large - stark reduziert von 28
    lineHeight: 28,   // Explizite Zeilenhöhe gegen Clipping
  },
  criterionRating: {
    marginBottom: 12, // Weiter reduziert von 16
  },
  criterionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  criterionLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
    flex: 1,
    flexShrink: 0,
  },
  criterionRightSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  criterionStars: {
    flexDirection: 'row',
    gap: 2,
  },
  criterionStarIcon: {
    fontSize: 14,
    lineHeight: 16,
  },
  criterionValue: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    minWidth: 30,
    textAlign: 'center',
  },
  criterionLabelCompact: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    marginRight: 16,
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,      // Reduziert von 16
    minHeight: 80,    // Reduziert von 120
    marginBottom: 16, // Reduziert von 24
    textAlignVertical: 'top',
    fontSize: 14,     // Explizite Schriftgröße
    fontFamily: 'Nunito_400Regular',
  },
  commentPlaceholder: {
    fontSize: 14,
  },
  submitButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  
  // Ratings View Styles
  ratingOverallSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
  },
  ratingCircleLarge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor wird dynamisch durch getRatingCircleColor() gesetzt
  },
  ratingCircleNumber: {
    fontSize: 16, // Large - reduziert von 24
    fontFamily: 'Nunito_700Bold',
    color: 'white',
  },
  ratingDetails: {
    flex: 1,
  },
  ratingTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 4,
  },
  starIconMedium: {
    fontSize: 16,
  },
  ratingsCount: {
    fontSize: 12,
    opacity: 0.7,
  },
  criteriaRatings: {
    gap: 12,
  },
  criteriaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  criteriaLabel: {
    fontSize: 14,
    flex: 1,
  },
  criteriaValue: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'right',
  },
  commentsContainer: {
    marginTop: 12,
  },
  commentItem: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  commentRating: {
    fontSize: 14,
    color: '#f59e0b', // Warning color for stars
  },
  commentDate: {
    fontSize: 12,
    opacity: 0.7,
  },
  commentText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Nunito_400Regular',
    marginTop: 8,
  },
  
  // Comments Section Styles - Simpler style from noname-detail
  commentsSection: {
    padding: 12,
    marginBottom: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  commentsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  commentsSectionTitle: {
    fontSize: 15,
    fontFamily: 'Nunito_600SemiBold',
    flex: 1,
  },
  commentCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  commentCountText: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  noCommentsContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  noCommentsText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'center',
  },
  commentUserHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  userAvatarContainer: {
    marginRight: 10,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f0f0',
  },
  userAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  userInfoContainer: {
    flex: 1,
  },
  userTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    gap: 6,
  },
  userBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'Nunito_600SemiBold',
  },
  userLevelBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  userLevelText: {
    fontSize: 10,
    fontWeight: '600',
    color: 'white',
  },
  commentRating: {
    fontSize: 12,
  },
  
  // Top action icons - Mobile UX optimiert
  topActionIcons: {
    flexDirection: 'row',
    gap: 12,  // Mehr Abstand zwischen Buttons (8→12)
    alignItems: 'center',
  },
  actionIconButton: {
    width: 44,        // Apple HIG: Minimum 44pt Touch-Target
    height: 44,       // Quadratisch für optimale Ergonomie
    borderRadius: 22, // Perfekt rund
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor wird dynamisch über colors.background gesetzt (Light: #f5f5f5, Dark: #000000)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },


  // Image Viewer Modal Styles
  imageViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerBackdrop: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerContent: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 1,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: screenWidth * 0.9,
    height: screenHeight * 0.7,
  },
  imageLoader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    minWidth: 160,
  },
  loaderText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 12,
    textAlign: 'center',
    opacity: 0.8,
  },

  // Scores Card Styles
  scoresGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 8,
  },
  scoreItem: {
    alignItems: 'center',
    gap: 6,
  },
  scoreLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  
  // Inline Scores Row (for Product Info Card)
  scoresInlineRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },

  // Stages Info Bottom Sheet Styles - identisch zu Produktdetails-Sheet
  stageInfoCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
  },
  stageInfoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  stageInfoBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stageInfoNumber: {
    color: 'white',
    fontSize: 16, // Large - wichtige Überschriften
    fontFamily: 'Nunito_700Bold',
  },
  stageInfoTextContainer: {
    flex: 1,
    minHeight: 50, // Mindesthöhe für mehrzeiligen Text
  },
  stageInfoTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
    lineHeight: 16,
  },
  stageInfoDescription: {
    fontSize: 12,
    fontWeight: '300',
    lineHeight: 16,
    opacity: 0.7,
  },

  // Info Card Styles - neue schöne Cards
  infoCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoCardIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(66, 169, 104, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoCardTitle: {
    fontSize: 16, // Large
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 18,
    flex: 1,
  },
  infoCardContent: {
    gap: 12,
  },
  infoCardDescription: {
    fontSize: 12, // Small
    fontFamily: 'Nunito_400Regular',
    lineHeight: 16,
  },
  infoCardDivider: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    marginVertical: 4,
  },
  infoCardSubSection: {
    gap: 6,
  },
  infoCardSubHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoCardSubTitle: {
    fontSize: 14, // Medium
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 16,
  },
  infoCardSubDescription: {
    fontSize: 12, // Small
    fontFamily: 'Nunito_400Regular',
    lineHeight: 16,
  },

  // Comparison Bottom Sheet Styles
  emptyComparisonContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    margin: 16,
  },
  emptyComparisonTitle: {
    fontSize: 16, // Large - wichtige Überschriften
    fontFamily: 'Nunito_600SemiBold',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyComparisonText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  comparisonCard: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 8,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  comparisonCardTitle: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 8,
  },
  comparisonHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  comparisonSimilarityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  similarityBadgeText: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  comparisonProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  comparisonProductImageOld: {
    width: 50,
    height: 50,
    borderRadius: 6,
    marginRight: 10,
  },
  comparisonProductInfo: {
    flex: 1,
  },
  comparisonProductName: {
    fontSize: 13,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 2,
  },
  comparisonProductBrand: {
    fontSize: 10, // Tiny // Tiny - sehr kleine Details
    fontFamily: 'Nunito_400Regular',
  },
  comparisonProductDetails: {
    marginTop: 2,
    gap: 1,
  },
  comparisonProductDetail: {
    fontSize: 10, // Tiny
    fontFamily: 'Nunito_400Regular',
  },
  comparisonDetails: {
    marginBottom: 10,
  },
  comparisonMetric: {
    marginBottom: 8,
  },
  comparisonMetricLabel: {
    fontSize: 10, // Tiny // Tiny - sehr kleine Details
    fontFamily: 'Nunito_500Medium',
    marginBottom: 4,
  },
  comparisonMetricBar: {
    height: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 2,
  },
  comparisonMetricFill: {
    height: '100%',
    borderRadius: 4,
  },
  comparisonMetricValue: {
    fontSize: 10, // Tiny
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'right',
  },
  comparisonSectionTitle: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 8,
  },
  ingredientsComparisonSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  ingredientsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  ingredientsColumn: {
    flex: 1,
  },
  ingredientsColumnTitle: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 6,
  },
  ingredientsTextOld: {
    fontSize: 10, // Tiny // Tiny - sehr kleine Details
    lineHeight: 16,
    fontFamily: 'Nunito_400Regular',
  },

  // Nährwerte-Vergleich Styles
  nutrientsComparisonSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  nutrientsGrid: {
    gap: 8,
  },
  nutrientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  nutrientLabel: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
  },
  nutrientValues: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nutrientValue: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    minWidth: 60,
    textAlign: 'center',
  },
  nutrientVs: {
    fontSize: 10, // Tiny
    fontFamily: 'Nunito_400Regular',
    color: '#999',
  },

  // Zusätzliche Infos Styles
  additionalInfoSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  additionalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  additionalInfoLabel: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
    marginRight: 8,
  },
  additionalInfoValue: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    flex: 2,
    textAlign: 'right',
  },
  
  // Neue Details Sheet Styles
  detailCard: {
    borderRadius: 12,
    marginVertical: 2,
    paddingVertical: 12, // Mehr vertikaler Raum
    paddingHorizontal: 20, // Noch mehr horizontaler Content-Raum
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  comparisonHeader: {
    borderRadius: 12,
    marginVertical: 4,
    paddingVertical: 12,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  comparisonHeaderTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 18,
    marginBottom: 2,
  },
  comparisonHeaderSubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 16,
  },
  productHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    position: 'relative',
    paddingHorizontal: 0, // Kein Padding - bündig mit Content darunter
  },
  productHeaderInfo: {
    flex: 1,
    marginLeft: 16, // Mehr Abstand zum größeren Bild
  },
  comparisonProductImage: {
    width: 60, // Größer für bessere Platzausnutzung
    height: 60,
    borderRadius: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 18,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 12, // Small - sekundäre Info
    fontFamily: 'Nunito_400Regular',
    lineHeight: 14,
    marginBottom: 0,
  },

  similaritySection: {
    marginTop: 8, // Mehr Abstand zur Sektion darüber
    gap: 2,       // Weniger Abstand zwischen similarity rows
    paddingHorizontal: 0, // Kein Padding - bündig mit anderen Elementen
  },
  similarityRow: {
    marginBottom: 1, // Bars näher an Text
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 0, // Noch näher an den Text
    gap: 2,
  },
  progressBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressBarText: {
    fontSize: 12, // Small - Progress Werte
    fontFamily: 'Nunito_600SemiBold',
    minWidth: 35,
    textAlign: 'right',
  },
  
  // Nutrition Section Styles (kompakt wie im Screenshot)
  nutritionSection: {
    marginTop: 4,
    marginBottom: 2,
  },
  sectionHeaderWithIcon: {
    fontSize: 14, // Medium - Standard Labels
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 0, // Kein marginBottom für perfekte Zentrierung
    lineHeight: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    minHeight: 16, // Mindesthöhe für konsistente Ausrichtung
  },
  sectionHeaderWithIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6, // Weniger Gap für bessere Optik
    height: 16, // Feste Höhe für perfekte Ausrichtung
  },
  nutritionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  nutritionLabel: {
    fontSize: 12, // Small - Nährwerte Labels
    fontFamily: 'Nunito_500Medium',
    lineHeight: 14,
    flex: 1,
  },
  nutritionValue: {
    fontSize: 12, // Small - Nährwerte Werte
    fontFamily: 'Nunito_400Regular',
    lineHeight: 14,
    textAlign: 'right',
    flex: 1,
  },
  ingredientsText: {
    fontSize: 12, // Small - Zutaten Text
    fontFamily: 'Nunito_400Regular',
    lineHeight: 14,
    marginTop: 2,
  },
  
  // Wanderapp Styles - Horizontal Icons ohne Textlabels
  wanderappDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between', // Gleichmäßige Verteilung über volle Breite
    paddingVertical: 10,
    paddingHorizontal: 0,
    width: '100%',
  },
  wanderappDataItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1, // Kann schrumpfen wenn nötig
    flexGrow: 0,   // Wächst nicht über natürliche Größe
  },
  wanderappDataValue: {
    fontSize: 12, // Small - Daten Werte
    fontFamily: 'Nunito_500Medium',
    lineHeight: 14,
  },
  
  // Spezielle Styles für Markenprodukt
  wanderappDataRowBrand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between', // Gleichmäßige Verteilung über volle Breite
    paddingVertical: 10,
    paddingHorizontal: 0,
    width: '100%',
  },
  wanderappDataItemBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1, // Kann schrumpfen wenn nötig
    flexGrow: 0,   // Wächst nicht über natürliche Größe
  },
  wanderappDataItemBrandCategory: {
    flexDirection: 'row',
    alignItems: 'flex-start', // Icon oben ausrichten
    gap: 6,
    flexShrink: 1, // Kann schrumpfen wenn nötig
    flexGrow: 0,   // Wächst NICHT - gleich wie andere Items
  },
  
  // Modal Subtitle Style
  modalSubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 16,
    marginTop: 2,
  },
  
  // Similarity Info Styles
  similarityRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 1,
  },
  similarityInfoIcon: {
    padding: 2,
    marginLeft: 0,
    marginRight: -2,
  },
  infoIconButton: {
    padding: 2,
    marginLeft: 4,
  },
  
  // Ähnliche Produkte Styles (kopiert von noname-detail)
  alternativesSubtitle: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 14,
    marginTop: 2,
  },
  similarProductItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    marginBottom: 6,
  },
  similarProductImageContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 12,
  },
  similarProductImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  similarProductImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  similarProductContent: {
    flex: 1,
    marginRight: 8,
  },
  similarProductName: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 16,
    marginBottom: 2,
  },
  similarProductBrand: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 14,
    marginBottom: 2,
  },
  similarProductPrice: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 20,
    marginTop: 2,
  },
  similarProductRight: {
    alignItems: 'flex-end',
    gap: 0,
  },
  similarProductChevron: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 20,
    height: 50,
    marginLeft: 6,
  },
  similarProductBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 0,
  },
  similarProductMarket: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  similarProductMarketLogo: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  similarProductMarketText: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
  },
  stufeBadgeSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    gap: 2,
  },
  stufeBadgeTextSmall: {
    fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  skeletonLine: {
    borderRadius: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },
  
  // Shopping List FAB mit mehr Schatten für bessere Sichtbarkeit
  shoppingListFab: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  
  // Alte Toast-Container Styles entfernt - zentrale Toast-Library übernimmt
});