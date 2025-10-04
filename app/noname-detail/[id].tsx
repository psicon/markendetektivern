import { StarRatingDisplay } from '@/components/StarRatingDisplay';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { CommentSkeleton, CommentsHeaderSkeleton, ListItemSkeleton, ProductComparisonSkeleton, RatingOverviewSkeleton } from '@/components/ui/ShimmerSkeleton';
import { getStufenColor, getStufenDescription, getStufenTitle } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { TOAST_MESSAGES, interpolateMessage } from '@/constants/ToastMessages';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { useFavoriteStatus } from '@/lib/hooks/useFavorites';
import achievementService from '@/lib/services/achievementService';
import { FirestoreService } from '@/lib/services/firestore';
import OpenFoodService, { OpenFoodProduct } from '@/lib/services/openfood';
import { showAlreadyInCartToast, showCartAddedToast, showFavoriteAddedToast, showFavoriteRemovedToast, showInfoToast, showRatingToast } from '@/lib/services/ui/toast';
import { ProductWithDetails } from '@/lib/types/firestore';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

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

// Star Rating Component - copied from product-comparison
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
                lineHeight: size + 2
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

export default function NoNameDetailScreen() {
  const { id, source, sourceProduct } = useLocalSearchParams<{ id: string; source?: string; sourceProduct?: string }>();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const analytics = useAnalytics();
  
  // Favorites Hook
  const { isFavorite, loading: favoriteLoading, toggleFavorite } = useFavoriteStatus(id || '', 'noname');
  
  // Alle Toasts laufen jetzt über zentrale Toast-Library (konsistent mit Stufe 3+)
  
  const [product, setProduct] = useState<ProductWithDetails | null>(null);
  const [isInCart, setIsInCart] = useState(false);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [openFoodData, setOpenFoodData] = useState<OpenFoodProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [showProductDetails, setShowProductDetails] = useState(false);
  
  // Button Animation States (Herz + Cart)
  const [heartAnimation] = useState(new Animated.Value(1));
  const [cartAnimation] = useState(new Animated.Value(1));
  
  // Helper: Animate button on press
  const animateButtonPress = (animationRef: Animated.Value) => {
    Animated.sequence([
      Animated.timing(animationRef, {
        toValue: 1.2,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(animationRef, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Get rating circle color based on rating value
  const getRatingCircleColor = (rating: number) => {
    if (rating >= 4.5) return colors.primary; // Primary grün bei 4.5-5
    if (rating >= 4) return '#4CAF50'; // Leicht grün bei 4-4.5  
    if (rating >= 3) return '#FFC107'; // Gelb bei 3-4
    if (rating >= 2) return '#FF9800'; // Orange bei 2-3
    return '#F44336'; // Rot bei 1-2
  };
  
  // Handle favorite toggle
  const handleToggleFavorite = async () => {
    if (!user?.uid) {
      showInfoToast(TOAST_MESSAGES.FAVORITES.authRequired, 'info');
      return;
    }

    if (!product) return;

    // Animate heart before action
    animateButtonPress(heartAnimation);

    try {
      const wasAdded = await toggleFavorite({
        id: product.id,
        name: product.name,
        preis: product.preis,
        packSize: product.packSize,
        bild: product.bild,
        type: 'noname',
        category: product.kategorie?.bezeichnung,
        ersparnis: product.ersparnis || 0,  // Wichtig für Tracking!
        savings: product.ersparnis || 0     // Alternative Property
      });

      // Konsistente Favoriten-Toasts (wie bei Stufe 3+)
      if (wasAdded) {
        showFavoriteAddedToast(product.name);
      } else {
        showFavoriteRemovedToast(product.name);
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      showInfoToast(TOAST_MESSAGES.FAVORITES.addError, 'error');
    }
  };

  // Check if product is in shopping cart
  const checkIfInCart = async () => {
    if (!user?.uid || !product?.id) return;
    
    try {
      const inCart = await FirestoreService.isInShoppingCart(
        user.uid,
        product.id,
        false // NoName product
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
    
    if (!product) return;
    
    if (isInCart) {
      showAlreadyInCartToast(() => router.push('/shopping-list' as any));
      return;
    }
    
    // Animate cart button before action
    animateButtonPress(cartAnimation);
    setIsAddingToCart(true);
    
    try {
      // 🎯 Track Add-to-Cart wird von FirestoreService automatisch gemacht
      const productName = product.name || 'NoName Produkt';
      
      // Berechne Ersparnis für Stufe 1,2 Produkte
      const ersparnis = product.ersparnis || 0;
      const priceInfo = {
        price: product.preis || 0,
        savings: ersparnis,
        comparedProducts: [] // Keine Vergleichsprodukte bei direktem Add
      };
      
      await FirestoreService.addToShoppingCart(
        user.uid,
        product.id,
        productName,
        false, // NoName product
        'browse', // Source (Stufe 1,2 wird meist über Stöbern gefunden)
        { 
          screenName: 'noname_detail',
          productStufe: product.stufe
        },
        priceInfo
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
  
  // Load product ratings with user info
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
      const ratings = await FirestoreService.getProductRatingsWithUserInfo(productToLoad.id, true);
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

  // Check for existing rating and open appropriate modal - copied from product-comparison
  const openRatingModal = async () => {
    if (!user?.uid) {
      showRatingToast(TOAST_MESSAGES.RATINGS.authRequired, 'error');
      return;
    }

    if (!product?.id) return;

    try {
      // Check if user has already rated this product
      const existing = await FirestoreService.getUserRatingForProduct(
        user.uid, 
        product.id, 
        true // isNoNameProduct
      );

      if (existing) {
        // Load existing rating for editing
        setExistingRating(existing);
        setIsEditingRating(true);
        setOverallRating(existing.ratingOverall || 0);
        setTasteRating(existing.ratingTasteFunction || 0);
        setPriceValueRating(existing.ratingPriceValue || 0);
        setContentRating(existing.ratingContent || 0);
        // Only set similarity for Stufe 3+
        if (product.stufe && parseInt(product.stufe) >= 3) {
          setSimilarityRating(existing.ratingSimilarity || 0);
        }
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

  // Submit rating function - copied from product-comparison
  const submitRating = async () => {
    if (overallRating === 0) {
      showRatingToast(TOAST_MESSAGES.RATINGS.ratingRequired, 'error');
      return;
    }

    setIsSubmittingRating(true);

    try {
      if (isEditingRating && existingRating) {
        // Update existing rating
        const updateData = {
          ratingOverall: overallRating,
          ratingPriceValue: priceValueRating || null,
          ratingTasteFunction: tasteRating || null,
          ratingSimilarity: (product.stufe && parseInt(product.stufe) >= 3) ? (similarityRating || null) : null,
          ratingContent: contentRating || null,
          comment: comment || null,
          updatedate: new Date()
        };

        await FirestoreService.updateProductRating(existingRating.id, updateData);
        showRatingToast(TOAST_MESSAGES.RATINGS.ratingUpdated, 'success');
      } else {
        // Create new rating
        const productRatingData = {
          productID: product?.id || null,
          brandProductID: null,
          userID: user?.uid || 'anonymous-user-' + Date.now(),
          ratingOverall: overallRating,
          ratingPriceValue: priceValueRating || null,
          ratingTasteFunction: tasteRating || null,
          ratingSimilarity: (product.stufe && parseInt(product.stufe) >= 3) ? (similarityRating || null) : null,
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
                productId: product?.id,
                productName: product?.name,
                productType: 'noname',
                rating: overallRating,
                commentLength: textLength
              });
              console.log('✅ Action tracked: submit_rating (NoName)');
            } else {
              console.log('ℹ️ submit_rating not tracked: comment too short (min 20 chars)');
            }
          } catch (error) {
            console.error('Error tracking submit_rating action:', error);
          }
        }
      }

      // Reset form and close modal
      setOverallRating(0);
      setTasteRating(0);
      setPriceValueRating(0);
      setContentRating(0);
      setSimilarityRating(0);
      setComment('');
      setExistingRating(null);
      setIsEditingRating(false);
      
      setShowRatingModal(false);
      
      // Delayed reload for Cloud Function (3-5 seconds backup)
      setTimeout(async () => {
        if (product?.id) {
          console.log('🔄 Delayed backup reload for Cloud Function updates');
          const updatedProduct = await FirestoreService.getProductWithDetails(product.id);
          if (updatedProduct) {
            setProduct(updatedProduct);
            await loadProductRatings(updatedProduct);
          }
        }
      }, 4000);
      
    } catch (error) {
      console.error('Error submitting rating:', error);
      showRatingToast(TOAST_MESSAGES.RATINGS.ratingError, 'error');
    } finally {
      setIsSubmittingRating(false);
    }
  };

  const [showRatingsView, setShowRatingsView] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [productRatings, setProductRatings] = useState<any[]>([]);
  const [ratingStats, setRatingStats] = useState<any>(null);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  
  // Rating form states - exactly like product-comparison
  const [overallRating, setOverallRating] = useState(0);
  const [tasteRating, setTasteRating] = useState(0);
  const [priceValueRating, setPriceValueRating] = useState(0);
  const [contentRating, setContentRating] = useState(0);
  const [similarityRating, setSimilarityRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [isEditingRating, setIsEditingRating] = useState(false);
  const [existingRating, setExistingRating] = useState<any>(null);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showStagesInfo, setShowStagesInfo] = useState(false);

  // Ähnliche Produkte States
  const [similarProducts, setSimilarProducts] = useState<ProductWithDetails[]>([]);
  const [similarProductsLoading, setSimilarProductsLoading] = useState(false);
  
  // Animation States für sanftes Einblenden
  const [productAnimation] = useState(new Animated.Value(0));
  const [similarProductAnimations, setSimilarProductAnimations] = useState<{[key: string]: Animated.Value}>({});

  // Animation Funktionen
  const animateProductCard = () => {
    Animated.timing(productAnimation, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  };

  const animateSimilarProduct = (productId: string, delay: number = 0) => {
    if (!similarProductAnimations[productId]) {
      const newOpacity = new Animated.Value(0);
      setSimilarProductAnimations(prev => ({ ...prev, [productId]: newOpacity }));
      
      setTimeout(() => {
        Animated.timing(newOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
      }, delay);
    }
  };

  // Header konfigurieren (konsistent mit Produktvergleich - fester Titel verhindert "Poppen")
  useLayoutEffect(() => {
    navigation.setOptions({
      ...getNavigationHeaderOptions(colorScheme, 'NoName-Produkt'),
    });
  }, [navigation, colorScheme]);

  // Check if product is in cart when product loads
  useEffect(() => {
    if (product) {
      checkIfInCart();
    }
  }, [product, user]);

  // Refresh cart status when screen comes back into focus
  useFocusEffect(
    useCallback(() => {
      if (product) {
        console.log('🔄 NoName Screen focused - refreshing cart status');
        checkIfInCart();
      }
    }, [product?.id, user?.uid])
  );
  
  // Produkt laden
  // Real-time product updates listener for rating changes
  const setupProductListener = (productId: string) => {
    const productRef = doc(db, 'produkte', productId);
    
    const unsubscribe = onSnapshot(productRef, (doc) => {
      if (doc.exists()) {
        const updatedData = { id: doc.id, ...doc.data() } as ProductWithDetails;
        
        // Check if rating data has changed
        if (product && (
          updatedData.averageRatingOverall !== product.averageRatingOverall ||
          updatedData.ratingCount !== product.ratingCount ||
          updatedData.averageRatingSimilarity !== product.averageRatingSimilarity
        )) {
          console.log('🔄 Rating data updated via Cloud Function - refreshing display');
          setProduct(updatedData);
          
          // Also reload detailed ratings
          loadProductRatings(updatedData);
        }
      }
    }, (error) => {
      console.error('❌ Real-time listener error:', error);
    });

    return unsubscribe;
  };

  useEffect(() => {
    if (!id) return;

    let unsubscribeListener: (() => void) | undefined;

    const loadProduct = async () => {
      try {
        setLoading(true);
        setError(null);


        
        // Lade Produktdetails
        const productData = await FirestoreService.getProductWithDetails(id);
        if (!productData) {
          setError('Produkt nicht gefunden');
          return;
        }

        setProduct(productData);

        console.log('🏷️ Product kategorie:', productData.kategorie);

        // Setup real-time listener for rating updates
        unsubscribeListener = setupProductListener(id);

        // Animation starten
        Animated.timing(productAnimation, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();

        // Lade OpenFoodFacts Daten falls EAN vorhanden
        if (productData.EANs?.[0] || productData.ean) {
          const ean = productData.EANs?.[0] || productData.ean;

          try {
            const openFoodResponse = await OpenFoodService.getProductByEAN(ean);
            if (openFoodResponse) {
              setOpenFoodData(openFoodResponse);

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
        // Starte Animation nach dem Laden
        setTimeout(() => animateProductCard(), 50);
      }
    };

    loadProduct();

    // Cleanup function
    return () => {
      if (unsubscribeListener) {
        unsubscribeListener();
        console.log('🧹 Real-time product listener cleaned up');
      }
    };
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

      console.log('🔍 Excluding product ID:', excludeProductId);
      
      const products = await FirestoreService.getSimilarProducts(categoryRef, excludeProductId, 3);
      setSimilarProducts(products);

      
      // Starte Animation für ähnliche Produkte
      products.forEach((product, index) => {
        animateSimilarProduct(product.id, index * 40);
      });
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
        <ProductComparisonSkeleton />
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
    <>
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        
        {/* Navigation Context Header */}
        {source && sourceProduct && (
          <Animated.View 
            style={[
              styles.navigationContext,
              { 
                backgroundColor: colors.cardBackground + 'F5',
                borderBottomColor: colors.border
              }
            ]}
            entering={undefined}
          >
            <TouchableOpacity 
              style={styles.navigationContextContent}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <IconSymbol 
                name="chevron.left" 
                size={16} 
                color={colors.primary} 
              />
              <ThemedText style={[styles.navigationContextText, { color: colors.text + 'CC' }]}>
                Gefunden über
              </ThemedText>
              <ThemedText style={[styles.navigationContextProduct, { color: colors.primary }]} numberOfLines={1}>
                {decodeURIComponent(sourceProduct as string)}
              </ThemedText>
            </TouchableOpacity>
          </Animated.View>
        )}
        
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
                <ImageWithShimmer
                  source={{ uri: product.bild }}
                  style={styles.productImage}
                  fallbackIcon="cube.box"
                  fallbackIconSize={40}
                  resizeMode="contain"
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
                console.log('🎯 Opening ratings for NoName product:', product.name);
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
              onPress={() => {
                animateButtonPress(heartAnimation);
                handleToggleFavorite();
              }}
            >
              <Animated.View style={{
                transform: [{ scale: heartAnimation }]
              }}>
                <IconSymbol 
                  name={isFavorite ? "heart.fill" : "heart"} 
                  size={20} 
                  color={isFavorite ? colors.error : colors.icon} 
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
                  transform: [{ scale: cartAnimation }]
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
            onPress={() => setShowProductDetails(true)}
          >
            <IconSymbol name="info.circle" size={16} color="white" />
            <ThemedText style={[styles.detailsTextDirect, { color: "white" }]}>
              Details
            </ThemedText>
          </TouchableOpacity>
          
          {/* Lokaler Toast entfernt – zentrale Toast-Library übernimmt */}

          {/* Rating Toast entfernt – zentrale Toast-Library übernimmt */}
        </Animated.View>

        {/* Ähnliche Produkte Sektion - immer anzeigen wenn Kategorie vorhanden */}
        {product?.kategorie && (
          <View style={[styles.similarProductsSection, { backgroundColor: colors.background }]}>
            <View style={styles.similarProductsHeader}>
              <ThemedText style={[styles.similarProductsTitle, { color: colors.text }]}>
                Weitere enttarnte Produkte
              </ThemedText>
              <ThemedText style={[styles.similarProductsSubtitle, { color: colors.icon }]}>
                Entdecke andere Produkte mit Stufe 3, 4 oder 5
              </ThemedText>
            </View>

            {similarProductsLoading ? (
              // Shimmer Skeleton Loading
              <View style={styles.similarProductsList}>
                {[...Array(3)].map((_, index) => (
                  <ListItemSkeleton key={`similar-skeleton-${index}`} />
                ))}
              </View>
            ) : similarProducts.length > 0 ? (
              // Produkte Liste
              <View style={styles.similarProductsList}>
                {similarProducts.map((product, index) => (
                  <Animated.View 
                    key={product.id}
                    style={{
                      opacity: similarProductAnimations[product.id] || 0
                    }}
                  >
                    <TouchableOpacity 
                      style={[styles.similarProductItem, { backgroundColor: colors.cardBackground }]}
                      onPress={() => {
                        // Navigation zu Produktvergleich (Stufe 3,4,5)
                        router.push(`/product-comparison/${product.id}?type=noname&source=noname&sourceProduct=${encodeURIComponent(product.produktName || product.name || 'NoName Produkt')}` as any);
                      }}
                    >
                    {/* Produktbild */}
                    <View style={styles.similarProductImageContainer}>
                      {product.bild && !failedImages.has(product.bild) ? (
                        <ImageWithShimmer
                          source={{ uri: product.bild }}
                          style={styles.similarProductImage}
                          fallbackIcon="cube.box"
                          fallbackIconSize={20}
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
                          <ImageWithShimmer
                            source={{ uri: product.discounter.bild }}
                            style={styles.similarProductMarketImage}
                            fallbackIcon="storefront"
                            fallbackIconSize={10}
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
                  </Animated.View>
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
                      <ImageWithShimmer
                        source={{ uri: product.discounter.bild }}
                        style={styles.markeImage}
                        fallbackIcon="storefront"
                        fallbackIconSize={16}
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
                              <ImageWithShimmer
                                source={{ uri: brand.bild }}
                                style={styles.markenItemImage}
                                fallbackIcon="tag"
                                fallbackIconSize={16}
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
                      const ean = product.EANs?.[0] || product.EAN;
                      if (!ean) return 'Keine Daten verfügbar';
                      // GENAU wie im Original - verwende OpenFoodService.formatIngredients
                      const ingredients = OpenFoodService.formatIngredients(openFoodData);
                      return ingredients || 'Keine Informationen verfügbar';
                    })()}
                  </ThemedText>
                </View>

                {/* Scores Row - wie im Original */}
                {(() => {
                  const ean = product.EANs?.[0] || product.EAN;
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
                  if (!product.EANs?.[0] && !product.EAN) {
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
                onPress={async () => {
                  console.log('🎯 Opening ratings from product details for NoName product:', product?.name);
                  setShowProductDetails(false);
                  setShowRatingsView(true); // Modal SOFORT öffnen!
                  loadProductRatings(product); // Parallel laden (ohne await!)
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
                {/* Overall Rating Display */}
                <View style={[styles.overallRatingCard, { backgroundColor: colors.cardBackground }]}>
                  <View style={[styles.ratingCircleLarge, { backgroundColor: getRatingCircleColor(ratingStats?.averageOverall || 0) }]}>
                    <ThemedText style={styles.ratingNumber}>
                      {(ratingStats?.averageOverall || 0).toFixed(1)}
                    </ThemedText>
                  </View>
                  <View style={styles.ratingInfo}>
                    <ThemedText style={styles.ratingTitle}>Allgemeine Bewertung</ThemedText>
                    <View style={styles.starsRow}>
                      <StarRatingDisplay 
                        rating={ratingStats?.averageOverall || 0}
                        colors={colors}
                        size={20}
                        showValue={false}
                      />
                    </View>
                    <ThemedText style={[styles.ratingCount, { color: colors.icon }]}>
                      Basierend auf {ratingStats?.totalCount || 0} Bewertungen
                    </ThemedText>
                  </View>
                </View>
              </>
            )}

            {/* Detailed Ratings */}
            {!ratingsLoading && ratingStats && (
              <View style={[styles.detailedRatingsCard, { backgroundColor: colors.cardBackground }]}>
                <ThemedText style={[styles.detailedRatingsTitle]}>
                  Kriterien-Bewertungen
                </ThemedText>
                
                <View style={styles.criterionRow}>
                  <ThemedText style={styles.criterionLabel}>Qualität & Geschmack</ThemedText>
                  <View style={styles.criterionRightSide}>
                    <StarRatingDisplay 
                      rating={ratingStats.averageTaste || 0}
                      colors={colors}
                      size={14}
                      valueStyle={[styles.criterionValue, { color: colors.icon }]}
                    />
                  </View>
                </View>
                
                <View style={styles.criterionRow}>
                  <ThemedText style={styles.criterionLabel}>Preis-Leistung</ThemedText>
                  <View style={styles.criterionRightSide}>
                    <StarRatingDisplay 
                      rating={ratingStats.averagePrice || 0}
                      colors={colors}
                      size={14}
                      valueStyle={[styles.criterionValue, { color: colors.icon }]}
                    />
                  </View>
                </View>
                
                <View style={styles.criterionRow}>
                  <ThemedText style={styles.criterionLabel}>Inhaltsstoffe</ThemedText>
                  <View style={styles.criterionRightSide}>
                    <StarRatingDisplay 
                      rating={ratingStats.averageContent || 0}
                      colors={colors}
                      size={14}
                      valueStyle={[styles.criterionValue, { color: colors.icon }]}
                    />
                  </View>
                </View>
                
                <View style={styles.criterionRow}>
                  <ThemedText style={styles.criterionLabel}>Ähnlichkeit zu Marke</ThemedText>
                  <View style={styles.criterionRightSide}>
                    <StarRatingDisplay 
                      rating={ratingStats.averageSimilarity || 0}
                      colors={colors}
                      size={14}
                      valueStyle={[styles.criterionValue, { color: colors.icon }]}
                    />
                  </View>
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

            {/* Comments Section */}
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
                  {product?.name || 'Produkt'}
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

              {/* Ähnlichkeit nur für NoName-Produkte Stufe 3+ */}
              {product && product.stufe && parseInt(product.stufe) >= 3 && (
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
      
      {/* Shopping List FAB */}
      <TouchableOpacity 
        style={[styles.shoppingListFab, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/shopping-list')}
      >
        <IconSymbol name="cart.fill" size={20} color="white" />
      </TouchableOpacity>
    </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navigationContext: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 8,
  },
  navigationContextContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navigationContextText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  navigationContextProduct: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    flex: 1,
  },
  scrollView: {
    flex: 1,
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
  // Top action icons - Mobile UX optimiert (konsistent mit product-comparison)
  topActionIcons: {
    flexDirection: 'row',
    gap: 12,  // Mehr Abstand zwischen Buttons
    alignItems: 'center',
  },
  actionIconButton: {
    width: 44,        // Apple HIG: Minimum 44pt Touch-Target
    height: 44,       // Quadratisch für optimale Ergonomie
    borderRadius: 22, // Perfekt rund
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor wird dynamisch über colors.background gesetzt
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
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
    paddingVertical: 8,     // Erhöht von 1 auf 8 (viel höher)
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'transparent',
    gap: 6,
    height: 44,             // Erhöht von 30 auf 44 (konsistent mit actionIconButton)
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
  
  // New Styles from product-comparison
  horizontalDivider: {
    height: 1,
    marginVertical: 4,
    borderRadius: 1,
    opacity: 0.5,
    marginBottom: 12,
  },
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
    width: 44, // Etwas größer für bessere Lesbarkeit in der Karte
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingCircleText: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
  },
  ratingsContent: {
    flex: 1,
    gap: 0,
  },
  starsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: -3,
  },
  ratingsText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
  },
  ratingsCount: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
  },
  cartButtonGray: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  detailsButtonDirect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
    marginTop: 4,
    marginBottom: 8,
  },
  detailsTextDirect: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
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
  ratingCircleLarge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    // backgroundColor wird dynamisch durch getRatingCircleColor() gesetzt
  },
  ratingNumber: {
    fontSize: 24,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    lineHeight: 30,
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
    fontSize: 15,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 16,
    flexShrink: 0,
  },
  criterionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  criterionLabel: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
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
  
  // Community Comment Styles - Kompaktes Design
  commentsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
    gap: 1,
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

  // Bottom Sheet Styles - copied from product-comparison
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
    backgroundColor: 'rgba(0,0,0,0.3)',
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
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  bottomSheetSubtitle: {
    fontSize: 15,
    fontFamily: 'Nunito_600SemiBold',
  },
  bottomSheetContent: {
    flex: 1,
    paddingHorizontal: 20,
  },

  // Rating Form Styles - copied from product-comparison
  ratingForm: {
    paddingBottom: 20,
  },
  ratingFormTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 12,
    marginTop: 4,
  },
  starRating: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 6,
    paddingVertical: 4,
  },
  starRatingCompact: {
    justifyContent: 'flex-end', // Rechtsbündig für horizontales Layout
    marginBottom: 0,
    gap: 3,
    paddingVertical: 2,
  },
  starButton: {
    padding: 6,
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starButtonCompact: {
    padding: 3,
    minWidth: 24,
    minHeight: 24,
  },
  starIconLarge: {
    fontSize: 16,
    lineHeight: 28,
  },
  criterionRating: {
    marginBottom: 12,
  },
  criterionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
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
    padding: 12,
    minHeight: 80,
    marginBottom: 16,
    textAlignVertical: 'top',
    fontSize: 14,
  },
  submitButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  
  // Alte Toast-Container Styles entfernt - zentrale Toast-Library übernimmt
});