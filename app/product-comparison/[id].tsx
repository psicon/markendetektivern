import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { getStufenColor, getStufenDescription, getStufenTitle } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { ingredientSynonyms } from '@/lib/data/ingredientSynonyms';
import { FirestoreService } from '@/lib/services/firestore';
import OpenFoodService, { OpenFoodProduct } from '@/lib/services/openfood';
import { MarkenProduktWithDetails, ProductWithDetails } from '@/lib/types/firestore';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

// Helper function to calculate savings percentage based on price per unit
const calculateSavingsPercentage = (brandProduct: any, noNameProduct: any): number => {
  if (!brandProduct.preis || !noNameProduct.preis || !brandProduct.packSize || !noNameProduct.packSize) {
    return 0;
  }
  
  // Preis pro Einheit (Gramm/Milliliter)
  const brandPricePerUnit = brandProduct.preis / brandProduct.packSize;
  const noNamePricePerUnit = noNameProduct.preis / noNameProduct.packSize;
  
  // Ersparnis in Prozent (kann positiv oder negativ sein)
  const savings = ((brandPricePerUnit - noNamePricePerUnit) / brandPricePerUnit) * 100;
  
  return Math.round(savings); // Kann positiv (Ersparnis) oder negativ (Mehrkosten) sein
};

// Helper function to get savings display with correct sign and color
const getSavingsDisplay = (brandProduct: any, noNameProduct: any, colors: any) => {
  const savings = calculateSavingsPercentage(brandProduct, noNameProduct);
  
  if (savings > 0) {
    // Ersparnis: grün mit Minus-Zeichen
    return {
      text: `-${savings}%`,
      color: colors.success,
      icon: "tag.fill"
    };
  } else if (savings < 0) {
    // Mehrkosten: rot mit Plus-Zeichen
    return {
      text: `+${Math.abs(savings)}%`,
      color: '#FF3B30', // Rot
      icon: "exclamationmark.triangle.fill"
    };
  } else {
    // Gleicher Preis
    return {
      text: `±0%`,
      color: colors.icon,
      icon: "equal"
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
    <Image 
      source={{ uri: imageUrl }}
      style={styles.scoreImage}
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

// Skeleton placeholder with pulsing animation
const SkeletonPlaceholder = ({ width, height, style }: { width?: number | string, height?: number, style?: any }) => {
  const opacity = useState(new Animated.Value(0.3))[0];

  useEffect(() => {
    const pulse = () => {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]).start(() => pulse());
    };
    pulse();
  }, []);

  return (
    <Animated.View
      style={[
        {
          backgroundColor: '#E0E0E0',
          borderRadius: 6,
          width: width || '100%',
          height: height || 12,
          opacity,
        },
        style,
      ]}
    />
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
            opacity: productAnimations[mainProduct.id] || 0 // ✨ Animation für Brand-Produkt
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
              Markenprodukt
            </ThemedText>
            <ThemedText style={styles.cardSubtitle}>
{comparisonData?.mainProduct?.marke?.name || comparisonData?.mainProduct?.hersteller?.name || 'Unbekannte Marke'} - {comparisonData?.mainProduct?.name || 'Unbekanntes Produkt'}
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
                opacity: productAnimations[product.id] || 0 // ✨ Animation
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
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();

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


  // Rating form states
  const [overallRating, setOverallRating] = useState(0);
  const [tasteRating, setTasteRating] = useState(0);
  const [priceValueRating, setPriceValueRating] = useState(0);
  const [contentRating, setContentRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  
  // Animation States für sanftes Einblenden der Produktkarten
  const [productAnimations, setProductAnimations] = useState<{[key: string]: Animated.Value}>({});

  // Sanfte Animation für Produktkarten
  const animateProductCard = (productId: string, delay: number = 0) => {
    if (!productAnimations[productId]) {
      const newOpacity = new Animated.Value(0);
      setProductAnimations(prev => ({ ...prev, [productId]: newOpacity }));
      
      setTimeout(() => {
        Animated.timing(newOpacity, {
          toValue: 1,
          duration: 400, // Etwas länger als bei Märkten für eleganten Effekt
          useNativeDriver: true,
        }).start();
      }, delay);
    }
  };

  // Submit rating function for productRatings table
  const submitRating = async () => {
    if (overallRating === 0) {
      Alert.alert('Fehler', 'Bitte gib eine Gesamtbewertung ab.');
      return;
    }

    setIsSubmittingRating(true);

    try {
      // Get the correct product ID and type
      const productId = selectedProductForDetails?.id || comparisonData?.mainProduct?.id;
      const isNoNameProduct = !!selectedProductForDetails;
      
      // Determine correct product references
      const productRatingData = {
        productID: isNoNameProduct ? productId : null,           // NoName product reference
        brandProductID: isNoNameProduct ? null : productId,      // Brand product reference
        userID: user?.uid || 'anonymous-user-' + Date.now(),     // Use authenticated user ID or fallback
        ratingOverall: overallRating,
        ratingPriceValue: priceValueRating || null,
        ratingTasteFunction: tasteRating || null,
        ratingSimilarity: null, // Not used in rating form
        ratingContent: contentRating || null,
        comment: comment || null,
        ratedate: new Date(),
        updatedate: new Date()
      };

      // Save to productRatings collection
      await FirestoreService.addProductRating(productRatingData);

      // Reset form
      setOverallRating(0);
      setTasteRating(0);
      setPriceValueRating(0);
      setContentRating(0);
      setComment('');
      
      Alert.alert('Erfolg', 'Deine Bewertung wurde gespeichert!');
      setShowRatingModal(false);
      
      // Reload comparison data to show updated ratings
      await loadComparisonData();
      
    } catch (error) {
      console.error('Error submitting rating:', error);
      Alert.alert('Fehler', 'Bewertung konnte nicht gespeichert werden.');
    } finally {
      setIsSubmittingRating(false);
    }
  };

  // Reset rating form when modal opens
  const openRatingModal = () => {
    setOverallRating(0);
    setTasteRating(0);
    setPriceValueRating(0);
    setContentRating(0);
    setComment('');
    setShowRatingModal(true);
  };

  // Reload comparison data function
  const loadComparisonData = async () => {
    if (!id || typeof id !== 'string') {
      return;
    }

    try {
      console.log('Reloading product comparison for ID:', id, 'Type:', type);
      
      // Determine product type from URL parameter
      const isMarkenProdukt = type === 'brand';
      
      // Get complete comparison data (brand product + related NoNames)
      const data = await FirestoreService.getProductComparisonData(id, isMarkenProdukt);
      
      if (data) {
        setComparisonData(data);
        console.log('Product comparison reloaded:', {
          mainProduct: data.mainProduct.name,
          relatedCount: data.relatedNoNameProducts.length,
          clickedWasNoName: data.clickedWasNoName
        });
        
        // Nach dem Laden der Firestore-Daten: OpenFood API aufrufen
        loadOpenFoodData(data);
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

  // Alle NoName-Produkte standardmäßig auswählen wenn Daten geladen sind
  useEffect(() => {
    console.log('🔍 Auto-selection useEffect triggered, comparisonData:', !!comparisonData);
    if (comparisonData?.relatedNoNameProducts) {
      console.log('📦 Related NoName products found:', comparisonData.relatedNoNameProducts.length);
      const allNoNameIds = new Set(comparisonData.relatedNoNameProducts.map(product => product.id));
      console.log('🎯 Setting selected products:', Array.from(allNoNameIds));
      setSelectedProducts(allNoNameIds);
      console.log('✅ Auto-selected all NoName products:', allNoNameIds.size);
    } else {
      console.log('❌ No comparisonData or relatedNoNameProducts found');
    }
  }, [comparisonData]);
  
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
      title: 'Produktvergleich',
      headerStyle: { 
        backgroundColor: colors.primary,
        borderBottomWidth: 0,
        elevation: 0,
        shadowOpacity: 0,
      },
      headerTintColor: 'white',
      headerTitleStyle: { 
        color: 'white',
        fontFamily: 'Nunito_600SemiBold',
        fontSize: 16
      },
      headerShadowVisible: false,
      headerBackVisible: false,
      headerTransparent: false,
      headerBlurEffect: 'none',
      headerLargeTitle: false,
      headerSearchBarOptions: undefined,
      headerBackTitleVisible: false,
      gestureEnabled: true,
      animation: 'none',
      headerLeft: () => (
        <TouchableOpacity 
          onPress={() => router.back()}
          style={{ 
            paddingLeft: 0, 
            paddingRight: 8, 
            paddingVertical: 8 
          }}
        >
          <IconSymbol name="chevron.left" size={24} color="white" />
        </TouchableOpacity>
      ),
      headerRight: selectedProducts.size > 0 ? () => (
        <TouchableOpacity 
          onPress={() => setShowComparisonSheet(true)}
          style={{ 
            paddingLeft: 8, 
            paddingRight: 0, 
            paddingVertical: 8,
            position: 'relative'
          }}
        >
          <IconSymbol name="arrow.left.arrow.right" size={24} color="white" />
          {selectedProducts.size > 0 && (
            <View style={{
              position: 'absolute',
              top: 4,
              right: -2,
              backgroundColor: colors.warning,
              borderRadius: 10,
              minWidth: 20,
              height: 20,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 4,
            }}>
              <ThemedText style={{
                color: 'white',
                fontSize: 12,
                fontWeight: 'bold',
                textAlign: 'center',
              }}>
                {selectedProducts.size}
              </ThemedText>
            </View>
          )}
        </TouchableOpacity>
      ) : undefined,
    });
  }, [navigation, router, colors.primary, colors.warning, selectedProducts]);


  // Load product comparison data from Firestore
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
        
        console.log('Loading product comparison for ID:', id, 'Type:', type);
        
        // Determine product type from URL parameter
        const isMarkenProdukt = type === 'brand';
        
        // Get complete comparison data (brand product + related NoNames)
        const data = await FirestoreService.getProductComparisonData(id, isMarkenProdukt);
        
        if (data) {
          setComparisonData(data);
          
          console.log('Product comparison loaded:', {
            mainProduct: data.mainProduct.name,
            relatedCount: data.relatedNoNameProducts.length,
            clickedWasNoName: data.clickedWasNoName
          });
          
          // ✨ Triggere sanfte Animationen für Produktkarten
          // Brand-Produkt sofort animieren
          animateProductCard(data.mainProduct.id, 100);
          
          // NoName-Produkte gestaffelt animieren
          data.relatedNoNameProducts.forEach((product, index) => {
            animateProductCard(product.id, 200 + (index * 150));
          });
          
          // Nach dem Laden der Firestore-Daten: OpenFood API aufrufen
          loadOpenFoodData(data);
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
      console.log('🌍 Loading OpenFood data...');
      
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
        console.log(`🌍 Loading OpenFood data for ${allEANs.length} products`);
        const openFoodResults = await OpenFoodService.getProductsByEANs(allEANs);
        setOpenFoodData(openFoodResults);
        console.log(`✅ OpenFood data loaded for ${openFoodResults.size} products`);
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
      <Stack.Screen 
        options={{
          title: 'Marke vs. NoNames',
            headerStyle: { 
              backgroundColor: colors.primary,
            },
          headerTintColor: 'white',
            headerTitleStyle: { 
              color: 'white',
              fontWeight: '600',
              fontSize: 16
            },
            headerShadowVisible: false,
            headerBackVisible: false,
            gestureEnabled: true,
            animation: 'slide_from_right',
            headerLeft: () => (
              <TouchableOpacity 
                onPress={() => router.back()}
                style={{ 
                  paddingLeft: 2, 
                  paddingRight: 8, 
                  paddingVertical: 8 
                }}
              >
                <IconSymbol name="chevron.left" size={24} color="white" />
              </TouchableOpacity>
            ),
          }} 
        />

        <ScrollView 
          style={styles.scrollView} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Skeleton Main Product Card */}
          <View style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
            {/* Skeleton Chips Row */}
            <View style={styles.chipsRow}>
              <SkeletonPlaceholder width={100} height={28} style={{ borderRadius: 14 }} />
              <SkeletonPlaceholder width={80} height={28} style={{ borderRadius: 14 }} />
          </View>

            {/* Skeleton Product Row */}
            <View style={styles.productRow}>
              <SkeletonPlaceholder width={80} height={80} style={{ borderRadius: 12 }} />
          <View style={styles.productInfo}>
                <SkeletonPlaceholder width="70%" height={16} style={{ marginBottom: 8 }} />
                <SkeletonPlaceholder width="90%" height={20} style={{ marginBottom: 12 }} />
                <View style={styles.ratingRow}>
                  <SkeletonPlaceholder width={40} height={16} />
                  <SkeletonPlaceholder width={100} height={16} />
                  <SkeletonPlaceholder width={50} height={16} />
            </View>

              </View>
              <View style={styles.priceSection}>
                <SkeletonPlaceholder width="100%" height={24} style={{ marginBottom: 4 }} />
                <SkeletonPlaceholder width="80%" height={16} />
              </View>
            </View>

            {/* Skeleton Action Buttons */}
            <View style={styles.actionButtonsRow}>
              <SkeletonPlaceholder width="75%" height={44} style={{ borderRadius: 12 }} />
              <SkeletonPlaceholder width={44} height={44} style={{ borderRadius: 12 }} />
            </View>
          </View>

          {/* Skeleton Alternatives Section */}
          <View style={styles.alternativesContainer}>
            {/* Skeleton Alternative Products */}
            {[1, 2].map((index) => (
              <View key={index} style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
                <View style={styles.chipsRow}>
                  <SkeletonPlaceholder width={90} height={28} style={{ borderRadius: 14 }} />
                  <SkeletonPlaceholder width={70} height={28} style={{ borderRadius: 14 }} />
                  <SkeletonPlaceholder width={60} height={28} style={{ borderRadius: 14 }} />
                </View>
                <View style={styles.productRow}>
                  <SkeletonPlaceholder width={80} height={80} style={{ borderRadius: 12 }} />
                  <View style={styles.productInfo}>
                    <SkeletonPlaceholder width="60%" height={16} style={{ marginBottom: 8 }} />
                    <SkeletonPlaceholder width="85%" height={20} style={{ marginBottom: 12 }} />
                    <View style={styles.ratingRow}>
                      <SkeletonPlaceholder width={40} height={16} />
                      <SkeletonPlaceholder width={100} height={16} />
                      <SkeletonPlaceholder width={50} height={16} />
                    </View>
                  </View>
                  <View style={styles.priceSection}>
                    <View style={styles.discountRow}>
                      <SkeletonPlaceholder width={50} height={16} />
                    </View>
                    <SkeletonPlaceholder width="100%" height={24} style={{ marginBottom: 4 }} />
                    <SkeletonPlaceholder width="70%" height={16} />
                  </View>
                </View>
                <View style={styles.actionButtonsRow}>
                  <SkeletonPlaceholder width="75%" height={44} style={{ borderRadius: 12 }} />
                  <SkeletonPlaceholder width={44} height={44} style={{ borderRadius: 12 }} />
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
        <Stack.Screen 
          options={{
            title: 'Fehler',
            headerStyle: { 
              backgroundColor: colors.primary,
            },
            headerTintColor: 'white',
            headerTitleStyle: { 
              color: 'white',
              fontWeight: '600',
              fontSize: 16
            },
            headerShadowVisible: false,
            headerBackVisible: false,
            gestureEnabled: true,
            animation: 'slide_from_right',
            headerLeft: () => (
              <TouchableOpacity 
                onPress={() => router.back()}
                style={{ 
                  paddingLeft: 0, 
                  paddingRight: 8, 
                  paddingVertical: 8 
                }}
              >
                <IconSymbol name="chevron.left" size={24} color="white" />
              </TouchableOpacity>
            ),
          }} 
        />
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
        <Stack.Screen 
          options={{
            title: 'Nicht gefunden',
            headerStyle: { 
              backgroundColor: colors.primary,
            },
            headerTintColor: 'white',
            headerTitleStyle: { 
              color: 'white',
              fontWeight: '600',
              fontSize: 16
            },
            headerShadowVisible: false,
            headerBackVisible: false,
            gestureEnabled: true,
            animation: 'slide_from_right',
            headerLeft: () => (
              <TouchableOpacity 
                onPress={() => router.back()}
                style={{ 
                  paddingLeft: 0, 
                  paddingRight: 8, 
                  paddingVertical: 8 
                }}
              >
                <IconSymbol name="chevron.left" size={24} color="white" />
              </TouchableOpacity>
            ),
          }} 
        />
        <IconSymbol name="questionmark.circle" size={48} color={colors.icon} />
        <ThemedText style={[styles.notFoundText, { color: colors.icon }]}>
          Produkt nicht gefunden
              </ThemedText>
      </ThemedView>
    );
  }

  return (
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
              opacity: productAnimations[comparisonData.mainProduct.id] || 0 // ✨ Animation für Hauptprodukt
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
            <TouchableOpacity>
              <IconSymbol name="heart.fill" size={20} color={colors.error} />
            </TouchableOpacity>
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
                {(() => {
  
                  
                  const marke = comparisonData.mainProduct.marke;
                  
                  return (
                    <>
                      {(marke?.bild || comparisonData.mainProduct.brands?.[0]?.bild) && (
                        <Image 
                          source={{ uri: marke?.bild || comparisonData.mainProduct.brands?.[0]?.bild }}
                          style={styles.brandImage}
                          resizeMode="contain"
                        />
                      )}
                      <ThemedText style={[styles.brandText, { color: colors.primary }]}>
                        {marke?.name || 
                         comparisonData.mainProduct.brands?.[0]?.name || 
                         comparisonData.mainProduct.hersteller?.name ||
                         comparisonData.mainProduct.hersteller?.herstellername || 
                         'Markenprodukt'}
                      </ThemedText>
                    </>
                  );
                })()}
                </View>
              <ThemedText style={styles.productTitle}>
                {comparisonData.mainProduct.name}
              </ThemedText>
              <TouchableOpacity 
                style={styles.ratingRow}
                onPress={() => setShowRatingsView(true)}
                activeOpacity={0.7}
              >
                <ThemedText style={[styles.ratingValue, { color: colors.warning }]}>
                  {(comparisonData.mainProduct.rating || 0).toFixed(1)}
              </ThemedText>
                <View style={styles.starsContainer}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <ThemedText 
                      key={star} 
                      style={[styles.starIcon, { color: star <= (comparisonData.mainProduct.rating || 0) ? colors.warning : colors.border }]}
                    >
                      ★
                </ThemedText>
                  ))}
              </View>
                <ThemedText style={[styles.reviewsText, { color: colors.icon }]}>
                  ({comparisonData.mainProduct.ratingCount || 0})
                </ThemedText>
              </TouchableOpacity>

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

          {/* Details and Cart Button Row */}
          <View style={styles.actionButtonsRow}>
          <TouchableOpacity 
              style={[styles.detailsButton, { borderColor: colors.primary }]}
              onPress={() => {
                setSelectedProductForDetails(comparisonData.mainProduct);
                setShowProductDetails(true);
              }}
          >
              <IconSymbol name="info.circle" size={18} color={colors.primary} />
              <ThemedText style={[styles.detailsText, { color: colors.primary }]}>
              Details
            </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cartButton, { backgroundColor: colors.primary }]}>
              <IconSymbol name="cart.badge.plus" size={20} color="white" />
          </TouchableOpacity>
        </View>
        </Animated.View>

        {/* Alternatives Section */}
        <View style={styles.alternativesContainer}>
          <ThemedText style={styles.alternativesTitle}>
            No-Name Alternativen vom gleichen Hersteller
          </ThemedText>

                      {comparisonData.relatedNoNameProducts.map((noNameProduct, index) => {
                const isSelected = selectedProducts.has(noNameProduct.id);
                return (
              <Animated.View
                key={noNameProduct.id}
                style={[
                  {
                    opacity: productAnimations[noNameProduct.id] || 0 // ✨ Animation
                  }
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.productCard, 
                    { 
                      backgroundColor: colors.cardBackground,
                      shadowColor: isSelected ? colors.primary : '#000',
                      shadowOffset: { width: 0, height: isSelected ? 4 : 2 },
                      shadowOpacity: isSelected ? 0.3 : 0.1,
                      shadowRadius: isSelected ? 8 : 4,
                      elevation: isSelected ? 8 : 3,
                    }
                  ]}
                  onPress={() => toggleProductSelection(noNameProduct.id)}
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
                      style={styles.actionIconButton}
                      onPress={(e) => {
                        e.stopPropagation();
                        toggleProductSelection(noNameProduct.id);
                      }}
                    >
                      <IconSymbol 
                        name={isSelected ? "checkmark.circle.fill" : "circle"} 
                        size={20} 
                        color={isSelected ? colors.primary : colors.icon} 
                      />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.actionIconButton}
                      onPress={(e) => e.stopPropagation()}
                    >
                      <IconSymbol name="heart" size={20} color={colors.icon} />
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
                    <ThemedText style={[styles.brandText, { color: colors.primary }]}>
                      {noNameProduct.handelsmarke?.bezeichnung || 'NoName-Produkt'}
                  </ThemedText>
                    <ThemedText style={styles.productTitle}>
                      {noNameProduct.name}
                  </ThemedText>
                    <TouchableOpacity 
                      style={styles.ratingRow}
                      onPress={() => setShowRatingsView(true)}
                      activeOpacity={0.7}
                    >
                      <ThemedText style={[styles.ratingValue, { color: colors.warning }]}>
                        {(noNameProduct.rating || 0).toFixed(1)}
                    </ThemedText>
                      <View style={styles.starsContainer}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <ThemedText 
                            key={star} 
                            style={[styles.starIcon, { color: star <= (noNameProduct.rating || 0) ? colors.warning : colors.border }]}
                          >
                            ★
                    </ThemedText>
                        ))}
                  </View>
                      <ThemedText style={[styles.reviewsText, { color: colors.icon }]}>
                        ({noNameProduct.ratingCount || 0})
                    </ThemedText>
                    </TouchableOpacity>

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
                        const savingsDisplay = getSavingsDisplay(comparisonData.mainProduct, noNameProduct, colors);
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



              {/* Details and Cart Button Row */}
              <View style={styles.actionButtonsRow}>
              <TouchableOpacity 
                  style={[styles.detailsButton, { borderColor: colors.primary }]}
                  onPress={() => {
                    setSelectedProductForDetails(noNameProduct);
                    setShowProductDetails(true);
                  }}
              >
                  <IconSymbol name="info.circle" size={18} color={colors.primary} />
                  <ThemedText style={[styles.detailsText, { color: colors.primary }]}>
                  Details
                </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.cartButton, { backgroundColor: colors.primary }]}>
                  <IconSymbol name="cart.badge.plus" size={20} color="white" />
                </TouchableOpacity>
              </View>
              </TouchableOpacity>
              </Animated.View>
          )
        })}
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
                    return selectedProductForDetails?.hersteller?.name || 'Markenprodukt';
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
                      // Bei Markenprodukten ist "hersteller" die DIREKTE MARKE
                      const direkteMarke = selectedProductForDetails?.hersteller;
                      
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
                            {direkteMarke?.name || 'Keine Marke gefunden'}
                          </ThemedText>
                        </>
                      );
                    }
                  })()}
                </View>
              </View>
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
                  
                  console.log(`🎯 SCORES DEBUG - Selected Product: ${selectedProductForDetails?.name}`);
                  console.log(`🎯 SCORES DEBUG - EAN: ${ean}`);
                  console.log(`🎯 SCORES DEBUG - OpenFood Product:`, openFoodProduct ? 'FOUND' : 'NOT FOUND');
                  console.log(`🎯 SCORES DEBUG - Scores:`, {
                    nutri: openFoodProduct?.nutriscore_grade,
                    eco: openFoodProduct?.ecoscore_grade,
                    nova: openFoodProduct?.nova_group
                  });
                  
                  const hasAnyScore = openFoodProduct?.nutriscore_grade || 
                                     openFoodProduct?.ecoscore_grade || 
                                     openFoodProduct?.nova_group;
                  
                  console.log(`🎯 SCORES DEBUG - Has any score: ${!!hasAnyScore}`);
                  
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
                onPress={() => {
                  setShowProductDetails(false);
                  setShowRatingsView(true);
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
                  Bewertung abgeben {selectedProductForDetails ? '(NoName-Produkt)' : '(Markenprodukt)'}
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
                numberOfLines={3}  // Reduziert von 4
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
                    Bewertung speichern
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
            {/* Overall Rating Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.ratingOverallSection}>
                <View style={styles.ratingCircle}>
                  <ThemedText style={styles.ratingCircleNumber}>
                    {selectedProductForDetails?.averageRatingOverall?.toFixed(1) || 
                     comparisonData?.mainProduct?.averageRatingOverall?.toFixed(1) || '0.0'}
                  </ThemedText>
                </View>
                <View style={styles.ratingDetails}>
                  <ThemedText style={styles.ratingTitle}>Allgemeine Bewertung</ThemedText>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <ThemedText 
                        key={star} 
                        style={[
                          styles.starIconMedium, 
                          { color: star <= (selectedProductForDetails?.averageRatingOverall || 
                                          comparisonData?.mainProduct?.averageRatingOverall || 0) 
                                  ? colors.warning : colors.border }
                        ]}
                      >
                        ★
                      </ThemedText>
                    ))}
                  </View>
                  <ThemedText style={[styles.ratingsCount, { color: colors.icon }]}>
                    Basierend auf {selectedProductForDetails?.ratingCount || 
                                  comparisonData?.mainProduct?.ratingCount || 0} Bewertungen
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Detailed Ratings Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <ThemedText style={styles.infoLabel}>Bewertung nach Kriterien</ThemedText>
              
              <View style={styles.criteriaRatings}>
                <View style={styles.criteriaRow}>
                  <ThemedText style={styles.criteriaLabel}>Geschmack/Wirkung/Funktion</ThemedText>
                  <ThemedText style={[styles.criteriaValue, { color: colors.icon }]}>
                    {selectedProductForDetails?.averageRatingTasteFunction?.toFixed(1) || 
                     comparisonData?.mainProduct?.averageRatingTasteFunction?.toFixed(1) || '0'}
                </ThemedText>
              </View>

                <View style={styles.criteriaRow}>
                  <ThemedText style={styles.criteriaLabel}>Preis-Leistung</ThemedText>
                  <ThemedText style={[styles.criteriaValue, { color: colors.icon }]}>
                    {selectedProductForDetails?.averageRatingPriceValue?.toFixed(1) || 
                     comparisonData?.mainProduct?.averageRatingPriceValue?.toFixed(1) || '0'}
                  </ThemedText>
                </View>
                
                <View style={styles.criteriaRow}>
                  <ThemedText style={styles.criteriaLabel}>Inhaltsstoffe</ThemedText>
                  <ThemedText style={[styles.criteriaValue, { color: colors.icon }]}>
                    {selectedProductForDetails?.averageRatingContent?.toFixed(1) || 
                     comparisonData?.mainProduct?.averageRatingContent?.toFixed(1) || '0'}
                  </ThemedText>
                </View>
                
                <View style={styles.criteriaRow}>
                  <ThemedText style={styles.criteriaLabel}>Ähnlichkeit</ThemedText>
                  <ThemedText style={[styles.criteriaValue, { color: colors.icon }]}>
                    {selectedProductForDetails?.averageRatingSimilarity?.toFixed(1) || 
                     comparisonData?.mainProduct?.averageRatingSimilarity?.toFixed(1) || '0'}
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Rating Button */}
            <View style={styles.buttonSection}>
              <TouchableOpacity 
                style={[styles.ratingButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setShowRatingsView(false);
                  openRatingModal();
                }}
              >
                <ThemedText style={styles.ratingButtonText}>Bewertung abgeben</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Comments Section */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <ThemedText style={styles.infoLabel}>Neueste Kommentare</ThemedText>
              <View style={styles.commentsPlaceholder}>
                <ThemedText style={[styles.placeholderText, { color: colors.icon }]}>
                  Oh, hier ist noch nichts!
                </ThemedText>
              </View>
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
                  {comparisonData?.mainProduct?.marke?.markenname || 'Marke'} vs. {Array.from(selectedProducts).map(id => {
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
    </ThemedView>
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
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 10,
  },

  // Product Image
  productImageContainer: {
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  productImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
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
    paddingTop: 2,
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
    marginBottom: 6,
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
    fontWeight: '600',
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
    paddingTop: 2,
    minWidth: 80,
  },
  mainPrice: {
    fontSize: 16, // Large - reduziert von 20
    fontFamily: 'Nunito_700Bold',
    marginBottom: 2,
  },
  mainWeight: {
    fontSize: 12,
    opacity: 0.7,
  },

  // Action Buttons Row
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 3, // Reduziert von 12 auf 5px (60% weniger)
  },
  detailsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 1,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'transparent',
    gap: 6,
    height: 30,
  },
  detailsText: {
    fontSize: 14,
    fontWeight: '500',
  },
  cartButton: {
    width: 35,
    height: 30,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingVertical: 40,
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
  },
  criterionLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
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
  ratingCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#6B7280',
    justifyContent: 'center',
    alignItems: 'center',
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
  commentsPlaceholder: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 14,
    textAlign: 'center',
  },
  
  // Top action icons
  topActionIcons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionIconButton: {
    padding: 4,
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
});