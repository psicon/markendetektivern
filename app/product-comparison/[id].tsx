import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { getStufenColor, getStufenDescription, getStufenTitle } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { FirestoreService } from '@/lib/services/firestore';
import OpenFoodService, { OpenFoodProduct } from '@/lib/services/openfood';
import { MarkenProduktWithDetails, ProductWithDetails } from '@/lib/types/firestore';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
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
  
  // Ersparnis in Prozent
  const savings = ((brandPricePerUnit - noNamePricePerUnit) / brandPricePerUnit) * 100;
  
  return Math.round(Math.max(0, savings)); // Mindestens 0%, aufgerundet
};

// Score Image component with real URLs (nutzt OpenFood Daten falls verfügbar)
const ScoreImage = ({ type, productEAN, firestoreValue }: { 
  type: 'nutri' | 'eco' | 'nova'; 
  productEAN?: string;
  firestoreValue?: string;
}) => {
  // Debug: Log input values
  console.log(`🔍 ScoreImage Debug - Type: ${type}, EAN: ${productEAN}, FirestoreValue: ${firestoreValue}`);
  
  // Versuche zuerst OpenFood Daten zu nutzen, fallback auf Firestore
  const getScoreValue = () => {
    if (productEAN && openFoodData.has(productEAN)) {
      const openFoodProduct = openFoodData.get(productEAN);
      console.log(`📊 OpenFood Product for EAN ${productEAN}:`, openFoodProduct);
      
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
        console.log(`🎯 OpenFood ${type} score: ${scoreValue}`);
        if (scoreValue) return scoreValue;
      }
    }
    // Fallback auf Firestore Daten
    console.log(`🔄 Using Firestore fallback for ${type}: ${firestoreValue}`);
    return firestoreValue;
  };
  
  const value = getScoreValue();
  console.log(`✅ Final ${type} score value: ${value}`);
  
  // Nur anzeigen wenn der Score existiert
  if (!value) {
    console.log(`❌ No ${type} score available - not rendering`);
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
  console.log(`🖼️ Generated image URL for ${type}: ${imageUrl}`);
  
  if (!imageUrl) {
    console.log(`❌ No image URL generated for ${type}`);
    return null;
  }

  return (
    <Image 
      source={{ uri: imageUrl }}
      style={styles.scoreImage}
      resizeMode="contain"
      onError={(error) => {
        console.error(`❌ Failed to load score image: ${imageUrl}`, error);
        console.error(`❌ Error details:`, error.nativeEvent);
      }}
      onLoad={() => console.log(`✅ Score image loaded successfully: ${imageUrl}`)}
    />
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



export default function ProductComparisonScreen() {
  const { id, type } = useLocalSearchParams();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();

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
  const [showRegionalInfo, setShowRegionalInfo] = useState(false);
  
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
      
      // Hauptprodukt EAN
      if (data.mainProduct.EANs && data.mainProduct.EANs.length > 0) {
        allEANs.push(data.mainProduct.EANs[0]);
      }
      
      // NoName Produkte EANs
      data.relatedNoNameProducts.forEach(product => {
        if (product.EANs && product.EANs.length > 0) {
          allEANs.push(product.EANs[0]);
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
            title: 'Produktvergleich',
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
                  paddingLeft: 16, 
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
                  paddingLeft: 16, 
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
                  paddingLeft: 16, 
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
              style={{ paddingLeft: 16, paddingRight: 8, paddingVertical: 8 }}
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
              <View style={styles.ratingRow}>
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
              </View>

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

                      {comparisonData.relatedNoNameProducts.map((noNameProduct, index) => (
              <View key={noNameProduct.id} style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
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
                      onPress={() => setShowStagesInfo(true)}
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
                    <TouchableOpacity style={styles.actionIconButton}>
                      <IconSymbol name="checkmark.circle" size={20} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionIconButton}>
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
                    <View style={styles.ratingRow}>
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
                    </View>

                    </View>

                  {/* Price Section */}
                  <View style={styles.priceSection}>
                    <View style={styles.discountRow}>
                      <IconSymbol name="star.fill" size={14} color={colors.success} />
                      <ThemedText style={[styles.discountValue, { color: colors.success }]}>
                        {calculateSavingsPercentage(comparisonData.mainProduct, noNameProduct)}%
                    </ThemedText>
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
            </View>
          ))}
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
                  setShowRatingModal(true);
                }}
              >
                <ThemedText style={styles.ratingButtonText}>Bewertungen</ThemedText>
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
                <ThemedText style={styles.bottomSheetTitle}>Bewertung abgeben (Markenprodukt)</ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.primary }]}>
                  Bio Tofu Natur
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
            <View style={styles.ratingForm}>
              <ThemedText style={styles.ratingFormTitle}>Deine Gesamtbewertung</ThemedText>
              <View style={styles.starRating}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity key={star} style={styles.starButton}>
                    <ThemedText style={[styles.starIconLarge, { color: colors.warning }]}>⭐</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemedText style={styles.ratingFormTitle}>Detail-Bewertung nach Kriterien (optional)</ThemedText>
              
              {[
                'Geschmack bzw. Funktion/Wirkung',
                'Preis-Leistungsgefühl',
                'Deine Bewertung der Inhaltsstoffe'
              ].map((criterion, index) => (
                <View key={index} style={styles.criterionRating}>
                  <ThemedText style={styles.criterionLabel}>{criterion}</ThemedText>
                  <View style={styles.starRating}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity key={star} style={styles.starButton}>
                        <ThemedText style={[styles.starIconLarge, { color: colors.warning }]}>⭐</ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}

              <ThemedText style={styles.ratingFormTitle}>Dein Kommentar (optional)</ThemedText>
              <View style={[styles.commentInput, { borderColor: colors.border, backgroundColor: colors.cardBackground }]}>
                <ThemedText style={[styles.commentPlaceholder, { color: colors.icon }]}>
                  Teile deine Erfahrungen mit diesem Produkt...
                </ThemedText>
              </View>

              <TouchableOpacity 
                style={[styles.submitButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowRatingModal(false)}
              >
                <ThemedText style={styles.submitButtonText}>Bewertung speichern</ThemedText>
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
    fontWeight: 'bold',
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
    fontWeight: 'bold',
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
  scoreImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },

  // Price Section (Right)
  priceSection: {
    alignItems: 'flex-end',
    paddingTop: 2,
    minWidth: 80,
  },
  mainPrice: {
    fontSize: 20,
    fontWeight: 'bold',
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
    fontWeight: 'bold',
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
    fontWeight: 'bold',
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
    fontWeight: 'bold',
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
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  similarityNumber: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
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
    paddingBottom: 40,
  },
  ratingFormTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 8,
  },
  starRating: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 8,
  },
  starButton: {
    padding: 4,
  },
  starIconLarge: {
    fontSize: 32,
  },
  criterionRating: {
    marginBottom: 24,
  },
  criterionLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    minHeight: 120,
    marginBottom: 24,
    textAlignVertical: 'top',
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
  
  // Top action icons
  topActionIcons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionIconButton: {
    padding: 4,
  },
  scoreImage: {
    width: 40,
    height: 30,
    marginRight: 8,
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
  scoreContainer: {
    width: 40,
    height: 20,
  },
  scoreImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
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
    fontWeight: 'bold',
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
});