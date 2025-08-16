import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { getStufenColor, getStufenDescription, getStufenTitle } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { FirestoreService } from '@/lib/services/firestore';
import OpenFoodService, { OpenFoodProduct } from '@/lib/services/openfood';
import { ProductWithDetails } from '@/lib/types/firestore';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

// ScoreImage Komponente - 1:1 wie im Produktvergleich
const ScoreImage = ({ type, value }: { type: 'nutri' | 'eco' | 'nova'; value: string | number }) => {
  return (
    <View style={scoreImageStyles.container}>
      <Image 
        source={{
          uri: `https://static.openfoodfacts.org/images/misc/${type}-score-${value.toString().toLowerCase()}.svg`
        }}
        style={scoreImageStyles.image}
        resizeMode="contain"
      />
    </View>
  );
};

const scoreImageStyles = StyleSheet.create({
  container: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: 32,
    height: 32,
  },
});

export default function NoNameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const [product, setProduct] = useState<ProductWithDetails | null>(null);
  const [openFoodData, setOpenFoodData] = useState<OpenFoodProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [showProductDetails, setShowProductDetails] = useState(false);
  const [showRatingsView, setShowRatingsView] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showStagesInfo, setShowStagesInfo] = useState(false);

  // Animation für smooth loading
  const [productAnimation] = useState(new Animated.Value(0));
  
  // Ähnliche Produkte States
  const [similarProducts, setSimilarProducts] = useState<ProductWithDetails[]>([]);
  const [similarProductsLoading, setSimilarProductsLoading] = useState(false);

  // Header konfigurieren
  useLayoutEffect(() => {
    navigation.setOptions({
      title: product?.name || 'NoName-Produkt',
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
    });
  }, [navigation, colors.primary, product?.name]);

  // Produkt laden
  useEffect(() => {
    if (!id) return;

    const loadProduct = async () => {
      try {
        setLoading(true);
        setError(null);

        console.log('🔍 Loading NoName product details for ID:', id);
        
        // Lade Produktdetails
        const productData = await FirestoreService.getProductWithDetails(id);
        if (!productData) {
          setError('Produkt nicht gefunden');
          return;
        }

        setProduct(productData);
        console.log('✅ Loaded product:', productData.name);
        console.log('🏷️ Product kategorie:', productData.kategorie);

        // Animation starten
        Animated.timing(productAnimation, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();

        // Lade OpenFoodFacts Daten falls EAN vorhanden
        if (productData.EANs?.[0] || productData.ean) {
          const ean = productData.EANs?.[0] || productData.ean;
          console.log('🔍 Loading OpenFoodFacts data for EAN:', ean);
          try {
            const openFoodResponse = await OpenFoodService.getProductByEAN(ean);
            if (openFoodResponse) {
              setOpenFoodData(openFoodResponse);
              console.log('✅ Loaded OpenFoodFacts data');
            }
          } catch (openFoodError) {
            console.log('⚠️ OpenFoodFacts data not available:', openFoodError);
          }
        }

        // Ähnliche Produkte laden (im Hintergrund)
        if (productData.kategorie?.bezeichnung) {
          loadSimilarProducts(productData.kategorie.bezeichnung, productData.id);
        }

      } catch (err) {
        console.error('❌ Error loading product:', err);
        setError('Fehler beim Laden des Produkts');
      } finally {
        setLoading(false);
      }
    };

    loadProduct();
  }, [id]);

  // Helper Functions
  const formatPrice = (price: number | string) => {
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(numPrice);
  };

  // Ähnliche Produkte laden
  const loadSimilarProducts = async (categoryRef: any, excludeProductId: string) => {
    try {
      setSimilarProductsLoading(true);
      console.log('🔍 Loading similar products for category:', categoryRef);
      console.log('🔍 Excluding product ID:', excludeProductId);
      
      const products = await FirestoreService.getSimilarProducts(categoryRef, excludeProductId, 7);
      setSimilarProducts(products);
      console.log(`✅ Loaded ${products.length} similar products:`, products.map(p => `${p.name} (Stufe ${p.stufe})`));
    } catch (error) {
      console.error('❌ Error loading similar products:', error);
    } finally {
      setSimilarProductsLoading(false);
    }
  };

  const getPackageInfo = (packSize?: string, packTypInfo?: any) => {
    if (packSize && packTypInfo?.bezeichnung) {
      return `${packSize} ${packTypInfo.bezeichnung}`;
    } else if (packSize) {
      return packSize;
    } else if (packTypInfo?.bezeichnung) {
      return packTypInfo.bezeichnung;
    }
    return 'Keine Angabe';
  };

  const openImageViewer = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setShowImageViewer(true);
  };

  // Loading State
  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>
            Lade Produktdetails...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  // Error State
  if (error || !product) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.errorContainer}>
          <IconSymbol name="exclamationmark.triangle" size={48} color={colors.error} />
          <ThemedText style={[styles.errorText, { color: colors.error }]}>
            {error || 'Produkt nicht gefunden'}
          </ThemedText>
          <TouchableOpacity 
            style={[styles.backButton, { backgroundColor: colors.primary }]}
            onPress={() => router.back()}
          >
            <ThemedText style={styles.backButtonText}>Zurück</ThemedText>
          </TouchableOpacity>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        
        {/* Main Product Card - Same style as product comparison */}
        <Animated.View 
          style={[
            styles.productCard, 
            { 
              backgroundColor: colors.cardBackground,
              opacity: productAnimation
            }
          ]}
        >
          {/* Header with Market and Stage */}
          <View style={styles.productCardHeader}>
            {/* Market Chip oben links - GENAU wie bei Stufe 3,4,5 */}
            {product.discounter && (
              <View style={[styles.marketChip, { backgroundColor: product.discounter?.color || colors.primary }]}>
                <IconSymbol name="house.fill" size={12} color="white" />
                <ThemedText style={styles.chipText}>
                  {product.discounter.name}
                </ThemedText>
              </View>
            )}
            
            {/* Stage Chip neben Market - GENAU wie bei Stufe 3,4,5 */}
            {product.stufe && (
              <TouchableOpacity 
                style={[styles.stageChip, { backgroundColor: getStufenColor(product.stufe) }]}
                onPress={() => setShowStagesInfo(true)}
                activeOpacity={0.8}
              >
                <IconSymbol name="chart.bar" size={10} color="white" />
                <ThemedText style={styles.chipText}>
                  {product.stufe}
                </ThemedText>
                <IconSymbol name="info.circle" size={12} color="white" />
              </TouchableOpacity>
            )}
            
            {/* Kategorie Chip - GENAU wie bei Markenprodukten */}
            {product.kategorie && (
              <View style={[styles.categoryMiniCard, { backgroundColor: colors.cardBackground }]}>
                <ThemedText style={[styles.categoryText, { color: colors.icon }]}>
                  {product.kategorie.bezeichnung}
                </ThemedText>
              </View>
            )}

            <View style={styles.spacer} />

            {/* Action Icons */}
            <View style={styles.topActionIcons}>
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
              onPress={() => product.bild && openImageViewer(product.bild)}
              disabled={!product.bild}
            >
              {product.bild && !failedImages.has(`product-${product.id}`) ? (
                <Image 
                  source={{ uri: product.bild }}
                  style={styles.productImage}
                  onError={() => {
                    console.log(`Failed to load image for product: ${product.name}`);
                    setFailedImages(prev => new Set([...prev, `product-${product.id}`]));
                  }}
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
                {product.handelsmarke?.bezeichnung || 'NoName-Produkt'}
              </ThemedText>
              <ThemedText style={styles.productTitle}>
                {product.name}
              </ThemedText>
              <TouchableOpacity 
                style={styles.ratingRow}
                onPress={() => setShowRatingsView(true)}
                activeOpacity={0.7}
              >
                <ThemedText style={[styles.ratingValue, { color: colors.warning }]}>
                  {(product.rating || 0).toFixed(1)}
                </ThemedText>
                <View style={styles.starsContainer}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <ThemedText 
                      key={star} 
                      style={[styles.starIcon, { color: star <= (product.rating || 0) ? colors.warning : colors.border }]}
                    >
                      ★
                    </ThemedText>
                  ))}
                </View>
                <ThemedText style={[styles.reviewsText, { color: colors.icon }]}>
                  ({product.ratingCount || 0})
                </ThemedText>
              </TouchableOpacity>


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

          {/* Details and Cart Button Row */}
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity 
              style={[styles.detailsButton, { borderColor: colors.primary }]}
              onPress={() => setShowProductDetails(true)}
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

        {/* Ähnliche Produkte Sektion - immer anzeigen wenn Kategorie vorhanden */}
        {product?.kategorie && (
          <View style={[styles.similarProductsSection, { backgroundColor: colors.background }]}>
            <View style={styles.similarProductsHeader}>
              <ThemedText style={[styles.similarProductsTitle, { color: colors.text }]}>
                Enttarnte Produkte
              </ThemedText>
              <ThemedText style={[styles.similarProductsSubtitle, { color: colors.icon }]}>
                Entdecke andere Produkte mit Stufe 3, 4 oder 5
              </ThemedText>
            </View>

            {similarProductsLoading ? (
              // Loading Skeleton
              <View style={styles.similarProductsList}>
                {[...Array(3)].map((_, index) => (
                  <View key={index} style={[styles.similarProductItem, { backgroundColor: colors.cardBackground }]}>
                    <View style={[styles.similarProductImagePlaceholder, { backgroundColor: colors.border }]} />
                    <View style={styles.similarProductContent}>
                      <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: '80%', height: 14 }]} />
                      <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: '60%', height: 12, marginTop: 4 }]} />
                      <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: '40%', height: 12, marginTop: 4 }]} />
                    </View>
                    <View style={styles.similarProductRight}>
                      <View style={[styles.skeletonLine, { backgroundColor: colors.border, width: 40, height: 12 }]} />
                    </View>
                  </View>
                ))}
              </View>
            ) : similarProducts.length > 0 ? (
              // Produkte Liste
              <View style={styles.similarProductsList}>
                {similarProducts.map((product, index) => (
                  <TouchableOpacity 
                    key={product.id}
                    style={[styles.similarProductItem, { backgroundColor: colors.cardBackground }]}
                    onPress={() => {
                      // Navigation zu Produktvergleich (Stufe 3,4,5)
                      router.push(`/product-comparison/${product.id}?type=noname` as any);
                    }}
                  >
                    {/* Produktbild */}
                    <View style={styles.similarProductImageContainer}>
                      {product.bild && !failedImages.has(product.bild) ? (
                        <Image 
                          source={{ uri: product.bild }}
                          style={styles.similarProductImage}
                          resizeMode="contain"
                          onError={() => setFailedImages(prev => new Set([...prev, product.bild!]))}
                        />
                      ) : (
                        <View style={[styles.similarProductImagePlaceholder, { backgroundColor: colors.border }]}>
                          <IconSymbol name="photo" size={20} color={colors.icon} />
                        </View>
                      )}
                    </View>

                    {/* Produktinfo */}
                    <View style={styles.similarProductContent}>
                      <ThemedText style={[styles.similarProductTitle, { color: colors.text }]} numberOfLines={1}>
                        {product.name}
                      </ThemedText>
                      <ThemedText style={[styles.similarProductSubtitle, { color: colors.icon }]} numberOfLines={1}>
                        {product.handelsmarke?.bezeichnung || 'NoName-Produkt'}
                      </ThemedText>
                      
                      {/* Markt Row */}
                      <View style={styles.similarProductMarketRow}>
                        {product.discounter?.bild && (
                          <Image 
                            source={{ uri: product.discounter.bild }}
                            style={styles.similarProductMarketImage}
                            resizeMode="contain"
                          />
                        )}
                        <ThemedText style={[styles.similarProductMarket, { color: colors.icon }]} numberOfLines={1}>
                          {product.discounter?.name || 'Unbekannter Markt'}
                        </ThemedText>
                      </View>
                    </View>

                    {/* Rechte Seite: Stufe + Preis + Chevron */}
                    <View style={styles.similarProductRight}>
                      <View style={styles.similarProductInfoColumn}>
                        {/* Stufe Badge */}
                        <View style={[styles.similarProductStufeBadge, { backgroundColor: getStufenColor(parseInt(product.stufe) || 1) }]}>
                          <IconSymbol name="chart.bar" size={10} color="white" />
                          <ThemedText style={styles.similarProductStufeBadgeText}>
                            {product.stufe}
                          </ThemedText>
                        </View>
                        
                        {/* Preis */}
                        <ThemedText style={[styles.similarProductPrice, { color: colors.text }]}>
                          {formatPrice(product.preis)}
                        </ThemedText>
                      </View>
                      
                      {/* Chevron */}
                      <View style={styles.similarProductChevron}>
                        <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              // Keine Produkte gefunden
              <View style={styles.noSimilarProductsContainer}>
                <IconSymbol name="magnifyingglass" size={24} color={colors.icon} />
                <ThemedText style={[styles.noSimilarProductsText, { color: colors.icon }]}>
                  Keine ähnlichen Produkte gefunden
                </ThemedText>
                <ThemedText style={[styles.noSimilarProductsSubtext, { color: colors.icon }]}>
                  In der Kategorie "{product?.kategorie?.bezeichnung}" sind momentan keine vergleichbaren Produkte verfügbar.
                </ThemedText>
              </View>
            )}
          </View>
        )}

        {/* Bottom Spacing */}
        <View style={{ height: 100 }} />
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
              <View style={styles.titleSectionLeft}>
                <ThemedText style={styles.bottomSheetTitleLeft}>
                  {product.handelsmarke?.bezeichnung || 'NoName-Produkt'}
                </ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitleLeft, { color: colors.primary }]}>
                  {product.name}
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
            {/* Stage Info Card */}
            {product.stufe && (
              <View style={[styles.similarityCard, { backgroundColor: colors.cardBackground }]}>
                <View style={styles.similarityHeaderNew}>
                  <View style={[styles.similarityBadgeRound, { backgroundColor: getStufenColor(product.stufe) }]}>
                    <ThemedText style={styles.similarityNumberRound}>{product.stufe}</ThemedText>
                  </View>
                  <View style={styles.similarityTextContainerNew}>
                    <ThemedText style={styles.similarityTitleNew}>
                      {getStufenTitle(product.stufe)}
                    </ThemedText>
                    <ThemedText style={[styles.similarityDescriptionNew, { color: colors.icon }]}>
                      {getStufenDescription(product.stufe)}
                    </ThemedText>
                  </View>
                </View>
              </View>
            )}

            {/* Manufacturer Info Card - 1:1 wie im Produktvergleich */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="building.2" size={18} color={colors.primary} />
                <ThemedText style={styles.sectionTitleText}>Herstellerinformationen</ThemedText>
              </View>
              <View style={styles.infoGrid}>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Hersteller:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon, flex: 1 }]}>
                    {product.hersteller?.herstellername || 
                     product.hersteller?.name ||
                     'Keine Hersteller-Daten verfügbar'}
                  </ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Markt:</ThemedText>
                  <View style={styles.markeRow}>
                    {product.discounter?.bild && (
                      <Image 
                        source={{ uri: product.discounter.bild }}
                        style={styles.markeImage}
                        resizeMode="contain"
                      />
                    )}
                    <ThemedText style={[styles.infoValue, { color: colors.icon, flex: 1 }]}>
                      {product.discounter?.name || 'Keine Markt-Daten verfügbar'}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Ort:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                    {(() => {
                      const hersteller = product.hersteller;
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
                    {product.hersteller?.infos || 'Keine weiteren Informationen'}
                  </ThemedText>
                </View>
                {/* Alle Marken dieses Herstellers - wie im Original */}
                <View style={styles.infoColumn}>
                  <ThemedText style={styles.infoLabel}>Alle Marken dieses Herstellers:</ThemedText>
                  <View style={styles.markenList}>
                    {(() => {
                      const brands = product.brands;
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
              </View>
            </View>

            {/* Product Info Card - 1:1 wie im Produktvergleich */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="info.circle" size={18} color={colors.primary} />
                <ThemedText style={styles.sectionTitleText}>Produktinformationen</ThemedText>
              </View>
              <View style={styles.infoGrid}>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Kategorie:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                    {product.kategorie?.bezeichnung || 'Keine Kategorie verfügbar'}
                  </ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Packung:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                    {(() => {
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
                      const ean = product.EANs?.[0] || product.ean;
                      if (!ean) return 'Keine Daten verfügbar';
                      // GENAU wie im Original - verwende OpenFoodService.formatIngredients
                      const ingredients = OpenFoodService.formatIngredients(openFoodData);
                      return ingredients || 'Keine Informationen verfügbar';
                    })()}
                  </ThemedText>
                </View>

                {/* Scores Row - wie im Original */}
                {(() => {
                  const ean = product.EANs?.[0] || product.ean;
                  const hasAnyScore = openFoodData?.nutriscore_grade || 
                                     openFoodData?.ecoscore_grade || 
                                     openFoodData?.nova_group;
                  
                  if (!hasAnyScore) return null;
                  
                  return (
                    <View style={styles.infoRow}>
                      <ThemedText style={styles.infoLabel}>Scores:</ThemedText>
                      <View style={styles.scoresInlineRow}>
                        {openFoodData?.nutriscore_grade && (
                          <View style={styles.scoreContainer}>
                            <ScoreImage 
                              type="nutri" 
                              value={openFoodData.nutriscore_grade.toUpperCase()} 
                            />
                          </View>
                        )}
                        {openFoodData?.ecoscore_grade && (
                          <View style={styles.scoreContainer}>
                            <ScoreImage 
                              type="eco" 
                              value={openFoodData.ecoscore_grade.toUpperCase()} 
                            />
                          </View>
                        )}
                        {openFoodData?.nova_group && (
                          <View style={styles.scoreContainer}>
                            <ScoreImage 
                              type="nova" 
                              value={String(openFoodData.nova_group)} 
                            />
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })()}
              </View>
            </View>

            {/* Nutrition Info Card - 1:1 wie im Produktvergleich */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="leaf" size={18} color={colors.primary} />
                <ThemedText style={styles.sectionTitleText}>Nährwerte</ThemedText>
              </View>
              <View style={styles.infoGrid}>
                {(() => {
                  if (!product.EANs?.[0] && !product.ean) {
                    return (
                      <View style={styles.infoRow}>
                        <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                          Keine Nährwertdaten verfügbar
                        </ThemedText>
                      </View>
                    );
                  }
                  
                  // GENAU wie im Original - verwende OpenFoodService.formatNutrition
                  const nutrition = OpenFoodService.formatNutrition(openFoodData?.nutriments);
                  
                  if (nutrition.length === 0) {
                    return (
                      <View style={styles.infoRow}>
                        <ThemedText style={[styles.infoValue, { color: colors.icon }]}>
                          Keine Nährwertinformationen verfügbar
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

            {/* Rating Button - wie im Original */}
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

      {/* Rating Bottom Sheet - GENAU wie im Produktvergleich */}
      <Modal
        visible={showRatingsView}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowRatingsView(false)}
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
                onPress={() => setShowRatingsView(false)}
              >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
              </TouchableOpacity>
              <View style={styles.titleSection}>
                <ThemedText style={styles.bottomSheetTitle}>
                  Bewertungen
                </ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.primary }]}>
                  {product?.name || 'Produkt'}
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
            {/* Overall Rating Display */}
            <View style={[styles.overallRatingCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.ratingCircle}>
                <ThemedText style={styles.ratingNumber}>
                  {(product?.rating || 0).toFixed(1)}
                </ThemedText>
              </View>
              <View style={styles.ratingInfo}>
                <ThemedText style={styles.ratingTitle}>Allgemeine Bewertung</ThemedText>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <ThemedText 
                      key={star} 
                      style={[styles.starIcon, { color: star <= (product?.rating || 0) ? colors.warning : colors.border }]}
                    >
                      ★
                    </ThemedText>
                  ))}
                </View>
                <ThemedText style={[styles.ratingCount, { color: colors.icon }]}>
                  Basierend auf {product?.ratingCount || 0} Bewertungen
                </ThemedText>
              </View>
            </View>

            {/* Detailed Ratings */}
            <View style={[styles.detailedRatingsCard, { backgroundColor: colors.cardBackground }]}>
              <ThemedText style={styles.detailedRatingsTitle}>
                Bewertung nach Kriterien
              </ThemedText>
              
              <View style={styles.criterionRow}>
                <ThemedText style={styles.criterionLabel}>Geschmack/Wirkung/Funktion</ThemedText>
                <ThemedText style={[styles.criterionValue, { color: colors.icon }]}>
                  {(product?.tasteRating || 0).toFixed(1)}
                </ThemedText>
              </View>
              
              <View style={styles.criterionRow}>
                <ThemedText style={styles.criterionLabel}>Preis-Leistung</ThemedText>
                <ThemedText style={[styles.criterionValue, { color: colors.icon }]}>
                  {(product?.priceValueRating || 0).toFixed(1)}
                </ThemedText>
              </View>
              
              <View style={styles.criterionRow}>
                <ThemedText style={styles.criterionLabel}>Inhaltsstoffe</ThemedText>
                <ThemedText style={[styles.criterionValue, { color: colors.icon }]}>
                  {(product?.contentRating || 0).toFixed(1)}
                </ThemedText>
              </View>
              
              <View style={styles.criterionRow}>
                <ThemedText style={styles.criterionLabel}>Ähnlichkeit</ThemedText>
                <ThemedText style={[styles.criterionValue, { color: colors.icon }]}>
                  {(product?.similarityRating || 0).toFixed(1)}
                </ThemedText>
              </View>
            </View>

            {/* Rating Button */}
            <View style={styles.buttonSection}>
              <TouchableOpacity 
                style={[styles.ratingButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setShowRatingsView(false);
                  router.push(`/rating/${product?.id}` as any);
                }}
              >
                <ThemedText style={styles.ratingButtonText}>Bewertung abgeben</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Comments Section */}
            <View style={[styles.commentsSection, { backgroundColor: colors.cardBackground }]}>
              <ThemedText style={styles.commentsSectionTitle}>
                Neueste Kommentare
              </ThemedText>
              
              <View style={styles.noCommentsContainer}>
                <ThemedText style={[styles.noCommentsText, { color: colors.icon }]}>
                  Oh, hier ist noch nichts!
                </ThemedText>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Stages Info Bottom Sheet - GENAU wie im Produktvergleich */}
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

      {/* Image Viewer Modal */}
      <Modal
        visible={showImageViewer}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowImageViewer(false)}
      >
        <View style={styles.imageViewerContainer}>
          <TouchableOpacity 
            style={styles.imageViewerClose}
            onPress={() => setShowImageViewer(false)}
          >
            <IconSymbol name="xmark" size={24} color="white" />
          </TouchableOpacity>
          {selectedImage && (
            <Image 
              source={{ uri: selectedImage }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  errorText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },
  backButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },

  // Product Card - Same as product comparison
  productCard: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  productCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
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
    fontSize: 10,
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
  topActionIcons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 10,
  },
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
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  productImagePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productInfo: {
    flex: 1,
    paddingTop: 2,
  },
  brandText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  productTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 6,
    lineHeight: 20,
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
    fontFamily: 'Nunito_400Regular',
  },

  priceSection: {
    alignItems: 'flex-end',
    paddingTop: 2,
  },
  mainPrice: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 2,
  },
  mainWeight: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
  },
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


  ratingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  ratingButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },

  // Bottom Sheet Styles - Same as product comparison
  bottomSheetContainer: {
    flex: 1,
    paddingTop: 20,
  },
  bottomSheetHeader: {
    paddingBottom: 20,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#D1D5DB',
    borderRadius: 2,
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
  titleSectionLeft: {
    flex: 1,
    alignItems: 'flex-start',
    paddingHorizontal: 20,
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
  },
  bottomSheetTitleLeft: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'left',
  },
  bottomSheetSubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    textAlign: 'center',
    marginTop: 2,
  },
  bottomSheetSubtitleLeft: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    textAlign: 'left',
    marginTop: 2,
  },
  bottomSheetContent: {
    flex: 1,
    paddingHorizontal: 20,
  },

  // Info Cards
  similarityCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  similarityHeaderNew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  similarityBadgeRound: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  similarityNumberRound: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
  },
  similarityTextContainerNew: {
    flex: 1,
  },
  similarityTitleNew: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 2,
  },
  similarityDescriptionNew: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 16,
  },
  infoCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitleText: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  infoGrid: {
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoLabel: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    width: 80,
    flexShrink: 0,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    flex: 1,
  },
  markeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  markeImage: {
    width: 18,
    height: 18,
    borderRadius: 3,
  },

  // Marken List - wie im Original
  infoColumn: {
    marginTop: 12,
  },
  markenList: {
    marginTop: 8,
    gap: 8,
  },
  markenItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  markenItemImage: {
    width: 20,
    height: 20,
    borderRadius: 4,
  },
  markenItemText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },

  // Scores - wie im Original
  scoresInlineRow: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  scoreContainer: {
    alignItems: 'center',
  },

  // Button Section - wie im Original
  buttonSection: {
    paddingVertical: 20,
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
    fontFamily: 'Nunito_600SemiBold',
  },

  // Rating Modal Styles - GENAU wie im Produktvergleich
  overallRatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    gap: 16,
  },
  ratingCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#6B7280',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingNumber: {
    fontSize: 24,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
  },
  ratingInfo: {
    flex: 1,
  },
  ratingTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 8,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
    marginBottom: 4,
  },
  ratingCount: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  detailedRatingsCard: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  detailedRatingsTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 16,
  },
  criterionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  criterionLabel: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    flex: 1,
  },
  criterionValue: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  commentsSection: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  commentsSectionTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 16,
  },
  noCommentsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noCommentsText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },

  // Stages Info Modal Styles - GENAU wie im Produktvergleich
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
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  stageInfoTextContainer: {
    flex: 1,
    minHeight: 50,
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

  // Image Viewer
  imageViewerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageViewerClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 1,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: '90%',
    height: '80%',
  },

  // Ähnliche Produkte Styles
  similarProductsSection: {
    marginTop: 32,
    paddingHorizontal: 16,
  },
  similarProductsHeader: {
    marginBottom: 16,
  },
  similarProductsTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 0,
  },
  similarProductsSubtitle: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 14,
  },
  similarProductsList: {
    gap: 6,
  },
  similarProductItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  similarProductImageContainer: {
    width: 50,
    height: 50,
    marginRight: 12,
  },
  similarProductImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
  },
  similarProductImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  similarProductContent: {
    flex: 1,
    marginRight: 12,
  },
  similarProductTitle: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 18,
    marginBottom: 2,
  },
  similarProductSubtitle: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 16,
    marginBottom: 4,
  },
  similarProductMarketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  similarProductMarketImage: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  similarProductMarket: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 14,
    flex: 1,
  },
  similarProductRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  similarProductInfoColumn: {
    alignItems: 'flex-end',
    gap: 4,
  },
  similarProductStufeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 2,
  },
  similarProductStufeBadgeText: {
    fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  similarProductPrice: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'right',
  },
  similarProductChevron: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 20,
    height: 50,
  },
  skeletonLine: {
    borderRadius: 4,
  },
  noSimilarProductsContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  },
  noSimilarProductsText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginTop: 12,
    textAlign: 'center',
  },
  noSimilarProductsSubtext: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 16,
  },
});