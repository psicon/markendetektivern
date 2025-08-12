import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { getStufenColor, getStufenDescription, getStufenTitle } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
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
      icon: "star.fill"
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
  colors 
}: { 
  mainProduct: MarkenProduktWithDetails;
  selectedProducts: ProductWithDetails[];
  openFoodData: Map<string, OpenFoodProduct | null>;
  colors: any;
}) => {
  // Ähnlichkeitsberechnung für Zutaten
  const calculateIngredientSimilarity = (mainIngredients: string, compareIngredients: string): number => {
    console.log('🔍 Calculating ingredient similarity:');
    console.log('Main ingredients:', mainIngredients?.substring(0, 100));
    console.log('Compare ingredients:', compareIngredients?.substring(0, 100));
    
    if (!mainIngredients || !compareIngredients) {
      console.log('❌ Missing ingredients data');
      return 0;
    }
    
    const main = mainIngredients.toLowerCase().split(/[,;\s]+/).filter(i => i.length > 2);
    const compare = compareIngredients.toLowerCase().split(/[,;\s]+/).filter(i => i.length > 2);
    
    console.log('Main ingredients parsed:', main.length, main.slice(0, 5));
    console.log('Compare ingredients parsed:', compare.length, compare.slice(0, 5));
    
    if (main.length === 0 || compare.length === 0) {
      console.log('❌ No valid ingredients found');
      return 0;
    }
    
    const matches = main.filter(ingredient => 
      compare.some(comp => comp.includes(ingredient) || ingredient.includes(comp))
    ).length;
    
    const similarity = Math.round((matches / Math.max(main.length, compare.length)) * 100);
    console.log(`✅ Ingredient similarity: ${matches}/${Math.max(main.length, compare.length)} = ${similarity}%`);
    
    return similarity;
  };

  // Erweiterte Nährwert-Ähnlichkeitsberechnung
  const calculateNutritionSimilarity = (mainNutrition: any, compareNutrition: any): number => {
    if (!mainNutrition || !compareNutrition) return 0;
    
    const nutrients = [
      'energy_100g', 'fat_100g', 'carbohydrates_100g', 'proteins_100g', 
      'sugars_100g', 'salt_100g', 'fiber_100g', 'saturated-fat_100g'
    ];
    let totalDifference = 0;
    let validComparisons = 0;
    
    nutrients.forEach(nutrient => {
      const mainValue = mainNutrition[nutrient];
      const compareValue = compareNutrition[nutrient];
      
      if (mainValue !== undefined && compareValue !== undefined && mainValue > 0) {
        const difference = Math.abs(mainValue - compareValue) / mainValue;
        totalDifference += difference;
        validComparisons++;
      }
    });
    
    if (validComparisons === 0) return 0;
    
    const avgDifference = totalDifference / validComparisons;
    return Math.round(Math.max(0, (1 - avgDifference) * 100));
  };

  // Zusätzliche Qualitätsbewertung basierend auf Scores
  const calculateQualitySimilarity = (mainOpenFood: any, compareOpenFood: any): number => {
    if (!mainOpenFood || !compareOpenFood) return 0;
    
    let score = 0;
    let metrics = 0;
    
    // Nova-Score Vergleich (je niedriger, desto besser)
    if (mainOpenFood.nova_group && compareOpenFood.nova_group) {
      const diff = Math.abs(mainOpenFood.nova_group - compareOpenFood.nova_group);
      score += Math.max(0, (4 - diff) / 4 * 100);
      metrics++;
    }
    
    // Nutri-Score Vergleich (A=5, B=4, C=3, D=2, E=1)
    if (mainOpenFood.nutrition_grades && compareOpenFood.nutrition_grades) {
      const scoreMap: Record<string, number> = { 'a': 5, 'b': 4, 'c': 3, 'd': 2, 'e': 1 };
      const mainScore = scoreMap[mainOpenFood.nutrition_grades.toLowerCase()] || 0;
      const compareScore = scoreMap[compareOpenFood.nutrition_grades.toLowerCase()] || 0;
      const diff = Math.abs(mainScore - compareScore);
      score += Math.max(0, (4 - diff) / 4 * 100);
      metrics++;
    }
    
    return metrics > 0 ? Math.round(score / metrics) : 0;
  };

  // Gesamt-Ähnlichkeit berechnen
  const calculateOverallSimilarity = (product: ProductWithDetails): { 
    ingredients: number; 
    nutrition: number; 
    quality: number;
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
    
    const qualitySimilarity = calculateQualitySimilarity(
      mainOpenFood,
      productOpenFood
    );
    
    // Gewichteter Durchschnitt: Zutaten 40%, Nährwerte 40%, Qualität 20%
    const overall = Math.round(
      (ingredientSimilarity * 0.4) + 
      (nutritionSimilarity * 0.4) + 
      (qualitySimilarity * 0.2)
    );
    
    console.log(`📊 Final similarity scores - Ingredients: ${ingredientSimilarity}%, Nutrition: ${nutritionSimilarity}%, Quality: ${qualitySimilarity}%, Overall: ${overall}%`);
    
    return {
      ingredients: ingredientSimilarity,
      nutrition: nutritionSimilarity,
      quality: qualitySimilarity,
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
    <ScrollView style={{ flex: 1, paddingHorizontal: 8 }}>
      {/* Header wie im Details Sheet */}
      <View style={[styles.comparisonHeader, { backgroundColor: colors.cardBackground }]}>
        <ThemedText style={[styles.comparisonHeaderTitle, { color: colors.primary }]}>
          Produktvergleich
        </ThemedText>
        <ThemedText style={[styles.comparisonHeaderSubtitle, { color: colors.text }]}>
          {mainProduct.marke?.markenname || 'Marke'} vs. {selectedProducts.map((product) => 
            product.handelsmarke?.bezeichnung || product.discounter?.name || 'NoName'
          ).join(' vs. ')}
        </ThemedText>
      </View>

      {/* Markenprodukt - Details Sheet Stil */}
      <View style={[styles.detailCard, { backgroundColor: colors.cardBackground }]}>
        {/* Header wie im Details Sheet */}
        <View style={styles.cardHeader}>
          <ThemedText style={[styles.cardTitle, { color: colors.primary }]}>
            {mainProduct.marke?.markenname || 'Markenprodukt'}
          </ThemedText>
          <ThemedText style={styles.cardSubtitle}>
            {mainProduct.produktName}
          </ThemedText>
        </View>
        
        {/* Produktinformationen Grid */}
        <View style={styles.infoGrid}>
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>Packung:</ThemedText>
            <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
              {mainProduct.packSize ? `${mainProduct.packSize} ${mainProduct.packTypInfo?.typKurz || 'g'}` : 'Unbekannt'}
            </ThemedText>
          </View>
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>Preis:</ThemedText>
            <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
              €{mainProduct.preis ? mainProduct.preis.toFixed(2) : '0.00'}
            </ThemedText>
          </View>
          
          {/* Nährwerte für Markenprodukt */}
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>Nährwerte:</ThemedText>
            <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
              {(() => {
                const mainEAN = mainProduct.EANs?.[0] || mainProduct.gtin;
                const mainOpenFood = openFoodData.get(mainEAN || '');
                const nutrition = OpenFoodService.formatNutrition(mainOpenFood?.nutriments);
                return nutrition.slice(0, 3).map(n => `${n.label}: ${n.value}`).join(', ') || 'Keine Daten';
              })()}
            </ThemedText>
          </View>
          
          {/* Zutaten für Markenprodukt */}
          <View style={styles.infoRow}>
            <ThemedText style={styles.infoLabel}>Zutaten:</ThemedText>
            <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
              {(() => {
                const mainEAN = mainProduct.EANs?.[0] || mainProduct.gtin;
                const mainOpenFood = openFoodData.get(mainEAN || '');
                const ingredients = OpenFoodService.formatIngredients(mainOpenFood);
                return ingredients || 'Keine Informationen verfügbar';
              })()}
            </ThemedText>
          </View>
        </View>
      </View>

      {/* Vergleichsprodukte - Details Sheet Stil */}
      {selectedProducts.map((product) => {
        const similarity = calculateOverallSimilarity(product);
        const productEAN = product.EANs?.[0] || product.gtin;
        const productOpenFood = openFoodData.get(productEAN || '');
        
        return (
          <View key={product.id} style={[styles.detailCard, { backgroundColor: colors.cardBackground, marginTop: 16 }]}>
            {/* Header wie im Details Sheet */}
            <View style={styles.cardHeader}>
              <ThemedText style={[styles.cardTitle, { color: colors.primary }]}>
                {product.handelsmarke?.bezeichnung || product.discounter?.name || 'NoName'}
              </ThemedText>
              <ThemedText style={styles.cardSubtitle}>
                {product.produktName}
              </ThemedText>
              
              {/* Ähnlichkeits-Badge */}
              <View style={[
                styles.similarityBadge, 
                { backgroundColor: similarity.overall >= 70 ? colors.success : similarity.overall >= 50 ? colors.warning : colors.error }
              ]}>
                <ThemedText style={styles.similarityNumber}>
                  {similarity.overall}% Ähnlichkeit
                </ThemedText>
              </View>
            </View>
            
            {/* Produktinformationen Grid */}
            <View style={styles.infoGrid}>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Packung:</ThemedText>
                <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                  {product.packSize ? `${product.packSize} ${product.packTypInfo?.typKurz || 'g'}` : 'Unbekannt'}
                </ThemedText>
              </View>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Preis:</ThemedText>
                <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                  €{product.preis ? product.preis.toFixed(2) : '0.00'}
                </ThemedText>
              </View>
              {product.stufe && (
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Stufe:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.primary }]}>
                    {product.stufe} Ähnlichkeit
                  </ThemedText>
                </View>
              )}
            </View>

            {/* Ähnlichkeitsvergleich mit Progress Bars */}
            <View style={styles.infoGrid}>
              <View style={styles.similarityRow}>
                <ThemedText style={styles.infoLabel}>Zutaten-Ähnlichkeit</ThemedText>
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
                <ThemedText style={styles.infoLabel}>Nährwert-Ähnlichkeit</ThemedText>
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
              
              <View style={styles.similarityRow}>
                <ThemedText style={styles.infoLabel}>Qualitäts-Ähnlichkeit</ThemedText>
                <View style={styles.progressBarContainer}>
                  <View style={styles.progressBarBackground}>
                    <View 
                      style={[
                        styles.progressBarFill, 
                        { 
                          backgroundColor: similarity.quality >= 70 ? colors.success : similarity.quality >= 50 ? colors.warning : colors.error,
                          width: `${similarity.quality}%`
                        }
                      ]} 
                    />
                  </View>
                  <ThemedText style={[styles.progressBarText, { color: colors.icon }]}>
                    {similarity.quality}%
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Nährwerte und Zutaten */}
            <View style={styles.infoGrid}>
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Nährwerte:</ThemedText>
                <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                  {(() => {
                    const nutrition = OpenFoodService.formatNutrition(productOpenFood?.nutriments);
                    return nutrition.slice(0, 3).map(n => `${n.label}: ${n.value}`).join(', ') || 'Keine Daten';
                  })()}
                </ThemedText>
              </View>
              
              <View style={styles.infoRow}>
                <ThemedText style={styles.infoLabel}>Zutaten:</ThemedText>
                <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                  {(() => {
                    const ingredients = OpenFoodService.formatIngredients(productOpenFood);
                    return ingredients || 'Keine Informationen verfügbar';
                  })()}
                </ThemedText>
              </View>
            </View>
          </View>
        );
      })}
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
  const [showRegionalInfo, setShowRegionalInfo] = useState(false);

  // Rating form states
  const [overallRating, setOverallRating] = useState(0);
  const [tasteRating, setTasteRating] = useState(0);
  const [priceValueRating, setPriceValueRating] = useState(0);
  const [contentRating, setContentRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  


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
    // Produktnamen für Header sammeln - nur wenn Daten verfügbar sind
    const headerTitle = selectedProducts.size > 0 && comparisonData?.mainProduct && comparisonData?.relatedNoNameProducts?.length > 0
      ? `${comparisonData.mainProduct.produktName || 'Markenprodukt'} vs. ${Array.from(selectedProducts).map(id => {
          const product = comparisonData.relatedNoNameProducts.find((p: any) => p.id === id);
          return product?.produktName || 'NoName';
        }).join(' & ')}`
      : 'Produktvergleich';
      
    navigation.setOptions({
      title: headerTitle.length > 30 ? 'Produktvergleich' : headerTitle,
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
        fontSize: 17
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
          <IconSymbol name="scale.3d" size={24} color="white" />
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
  }, [navigation, router, colors.primary, colors.warning, selectedProducts, comparisonData]);


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
              fontSize: 17
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
              fontSize: 17
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
              fontSize: 17
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
        <View style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
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
              <IconSymbol name="info.circle" size={16} color={colors.primary} />
              <ThemedText style={[styles.detailsText, { color: colors.primary }]}>
              Details
            </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cartButton, { backgroundColor: colors.primary }]}>
              <IconSymbol name="cart" size={20} color="white" />
          </TouchableOpacity>
          </View>
        </View>

        {/* Alternatives Section */}
        <View style={styles.alternativesContainer}>
          <ThemedText style={styles.alternativesTitle}>
            No-Name Alternativen vom gleichen Hersteller
          </ThemedText>

                      {comparisonData.relatedNoNameProducts.map((noNameProduct, index) => {
                const isSelected = selectedProducts.has(noNameProduct.id);
                return (
              <TouchableOpacity
                key={noNameProduct.id} 
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
                    <ThemedText style={[styles.mainPrice, { color: colors.icon }]}>
                      {formatPrice(noNameProduct.preis)}
                  </ThemedText>
                    <ThemedText style={[styles.mainWeight, { color: colors.icon }]}>
                      {getPackageInfo(noNameProduct.packSize, noNameProduct.packTypInfo)}
                  </ThemedText>
                    </View>
                  </View>

              {/* Regional Info for first item */}
              {index === 0 && (
                <View style={[styles.regionalCard, { backgroundColor: colors.background }]}>
                  <TouchableOpacity 
                    style={styles.regionalHeader}
                    onPress={() => setShowRegionalInfo(!showRegionalInfo)}
                  >
                    <IconSymbol name="location" size={16} color={colors.primary} />
                    <ThemedText style={styles.regionalTitle}>
                      Regionale Produktinformation
                    </ThemedText>
                    <IconSymbol 
                      name={showRegionalInfo ? "chevron.up" : "chevron.down"} 
                      size={16} 
                      color={colors.icon} 
                    />
                  </TouchableOpacity>
                  
                  {showRegionalInfo && (
                    <View style={styles.regionalContent}>
                      {/* Aktuelle Region */}
                      <View style={styles.regionalRow}>
                        <View style={styles.regionColumn}>
                          <IconSymbol name="checkmark" size={12} color={colors.success} />
                          <ThemedText style={[styles.regionText, { color: colors.text }]}>
                            Bayern
                          </ThemedText>
                </View>
                        <ThemedText style={[styles.herstellerLabel, { color: colors.icon }]}>
                          Hersteller:
                    </ThemedText>
                        <View style={[styles.stufeChip, { backgroundColor: colors.success }]}>
                          <IconSymbol name="chart.bar" size={10} color="white" />
                          <ThemedText style={styles.stufeText}>Stufe4</ThemedText>
                  </View>
                      </View>
                      
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                      
                      <ThemedText style={[styles.weitereTitle, { color: colors.text }]}>
                        Weitere Regionen
                  </ThemedText>
                      
                      {regionalData.slice(1).map((data, regionIndex) => (
                        <View key={regionIndex} style={styles.regionalRow}>
                          <View style={styles.regionColumn}>
                            <ThemedText style={[styles.regionText, { color: colors.text }]}>
                              {data.region}
                  </ThemedText>
                </View>
                          <ThemedText style={[styles.herstellerLabel, { color: colors.icon }]}>
                            Hersteller:
                          </ThemedText>
                          <View style={[styles.stufeChip, { backgroundColor: colors.success }]}>
                            <IconSymbol name="chart.bar" size={10} color="white" />
                            <ThemedText style={styles.stufeText}>Stufe4</ThemedText>
              </View>
                        </View>
                      ))}
                      
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                      
                      {/* Settings Button */}
                      <View style={styles.settingsContainer}>
                        <TouchableOpacity style={[styles.settingsButton, { borderColor: colors.border }]}>
                          <IconSymbol name="gearshape" size={16} color={colors.icon} />
                        </TouchableOpacity>
                  </View>
                  </View>
                  )}
                </View>
              )}

              {/* Details and Cart Button Row */}
              <View style={styles.actionButtonsRow}>
              <TouchableOpacity 
                  style={[styles.detailsButton, { borderColor: colors.primary }]}
                  onPress={() => {
                    setSelectedProductForDetails(noNameProduct);
                    setShowProductDetails(true);
                  }}
              >
                  <IconSymbol name="info.circle" size={16} color={colors.primary} />
                  <ThemedText style={[styles.detailsText, { color: colors.primary }]}>
                  Details
                </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.cartButton, { backgroundColor: colors.primary }]}>
                  <IconSymbol name="cart" size={20} color="white" />
                </TouchableOpacity>
              </View>
              </TouchableOpacity>
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
                 <View style={styles.similarityHeader}>
                   <View style={[styles.similarityBadge, { backgroundColor: getStufenColor((selectedProductForDetails as ProductWithDetails).stufe!) }]}>
                     <ThemedText style={styles.similarityNumber}>{(selectedProductForDetails as ProductWithDetails).stufe}</ThemedText>
              </View>
                   <View style={styles.similarityTextContainer}>
                     <ThemedText style={styles.similarityTitle}>
                       {getStufenTitle((selectedProductForDetails as ProductWithDetails).stufe!)}
                     </ThemedText>
                     <ThemedText style={[styles.similarityDescription, { color: colors.icon }]}>
                       {getStufenDescription((selectedProductForDetails as ProductWithDetails).stufe!)}
              </ThemedText>
            </View>
                 </View>
               </View>
             )}

            {/* Manufacturer Info Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="building.2" size={16} color={colors.primary} />
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
                <IconSymbol name="info.circle" size={16} color={colors.primary} />
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
                <IconSymbol name="leaf" size={16} color={colors.primary} />
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
  },

  // Product Card (shared by main and alternatives)
  productCard: {
    margin: 16,
    marginBottom: 8,
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
    fontSize: 11,
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
    fontSize: 14,
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
    fontSize: 20,
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
    marginTop: 12,
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
    marginLeft: 16,
  },

  // Regional Info Card
  regionalCard: {
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 12,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  regionalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  regionalTitle: {
    fontSize: 13,
    fontFamily: 'Nunito_700Bold',
    flex: 1,
  },
  regionalContent: {
    marginTop: 8,
    gap: 6,
  },
  regionalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  regionColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 70,
  },
  regionText: {
    fontSize: 13,
    fontWeight: '500',
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
    fontSize: 10,
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
    fontSize: 18,
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
  similarityBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
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
    fontSize: 28,     // Reduziert von 32
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
    fontSize: 24,
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
    fontSize: 18,
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

  // Comparison Bottom Sheet Styles
  emptyComparisonContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    margin: 16,
  },
  emptyComparisonTitle: {
    fontSize: 18,
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
  comparisonProductImage: {
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
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
  },
  comparisonProductDetails: {
    marginTop: 2,
    gap: 1,
  },
  comparisonProductDetail: {
    fontSize: 10,
    fontFamily: 'Nunito_400Regular',
  },
  comparisonDetails: {
    marginBottom: 10,
  },
  comparisonMetric: {
    marginBottom: 8,
  },
  comparisonMetricLabel: {
    fontSize: 11,
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
    fontSize: 10,
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
  ingredientsText: {
    fontSize: 11,
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
    fontSize: 10,
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
    marginVertical: 8,
    paddingVertical: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    marginBottom: 12,
    position: 'relative',
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    marginBottom: 8,
  },

  similarityRow: {
    marginBottom: 8,
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
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
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    minWidth: 35,
    textAlign: 'right',
  },
});