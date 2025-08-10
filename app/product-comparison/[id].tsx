import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
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

export default function ProductComparisonScreen() {
  const { id } = useLocalSearchParams();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [showProductDetails, setShowProductDetails] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);

  // Mock data - exakt wie im Screenshot
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
              <ThemedText style={styles.chipText}>Markenprodukt</ThemedText>
            </View>
            <ThemedText style={[styles.categoryText, { color: colors.icon }]}>
              {brandProduct.category}
            </ThemedText>
            <View style={styles.spacer} />
            <TouchableOpacity>
              <IconSymbol name="heart.fill" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>

          {/* Product Row */}
          <View style={styles.productRow}>
            {/* Product Image */}
            <View style={styles.productImageContainer}>
              <Image 
                source={brandProduct.image}
                style={styles.productImage}
              />
            </View>

            {/* Product Info */}
            <View style={styles.productInfo}>
              <ThemedText style={[styles.brandText, { color: colors.primary }]}>
                {brandProduct.brand}
              </ThemedText>
              <ThemedText style={styles.productTitle}>
                {brandProduct.name}
              </ThemedText>
              <View style={styles.priceRow}>
                <ThemedText style={[styles.priceText, { color: colors.error }]}>
                  € {brandProduct.price.toFixed(2)}
                </ThemedText>
                <ThemedText style={[styles.weightText, { color: colors.icon }]}>
                  {brandProduct.weight}
                </ThemedText>
              </View>
              <View style={styles.ratingRow}>
                <ThemedText style={[styles.ratingValue, { color: colors.warning }]}>
                  {brandProduct.rating.toFixed(1)}
                </ThemedText>
                <View style={styles.starsContainer}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <ThemedText 
                      key={star} 
                      style={[styles.starIcon, { color: star <= brandProduct.rating ? colors.warning : colors.border }]}
                    >
                      ★
                    </ThemedText>
                  ))}
                </View>
                <ThemedText style={[styles.reviewsText, { color: colors.icon }]}>
                  ({brandProduct.reviews})
                </ThemedText>
              </View>
              <View style={styles.scoresRow}>
                <ScoreImage type="nutri" value={brandProduct.nutriscore} />
                <ScoreImage type="eco" value={brandProduct.ecoscore} />
                <ScoreImage type="nova" value={brandProduct.nova} />
              </View>
            </View>

            {/* Price Section */}
            <View style={styles.priceSection}>
              <ThemedText style={[styles.mainPrice, { color: colors.error }]}>
                € {brandProduct.price.toFixed(2)}
              </ThemedText>
              <ThemedText style={[styles.mainWeight, { color: colors.icon }]}>
                {brandProduct.weight}
              </ThemedText>
            </View>
          </View>

          {/* Details Button with Cart */}
          <TouchableOpacity 
            style={[styles.detailsRow, { borderColor: colors.primary }]}
            onPress={() => setShowProductDetails(true)}
          >
            <IconSymbol name="info.circle" size={20} color={colors.primary} />
            <ThemedText style={[styles.detailsText, { color: colors.primary }]}>
              Details
            </ThemedText>
            <TouchableOpacity style={[styles.cartButtonLarge, { backgroundColor: colors.primary }]}>
              <IconSymbol name="cart" size={20} color="white" />
            </TouchableOpacity>
          </TouchableOpacity>
        </View>

        {/* Alternatives Section */}
        <View style={styles.alternativesContainer}>
          <ThemedText style={styles.alternativesTitle}>
            No-Name Alternativen vom gleichen Hersteller
          </ThemedText>

          {alternatives.map((product, index) => (
            <View key={product.id} style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
              {/* Alternative Chips Row */}
              <View style={styles.chipsRow}>
                <View style={[styles.marketChip, { backgroundColor: colors.error }]}>
                  <IconSymbol name="house.fill" size={12} color="white" />
                  <ThemedText style={styles.chipText}>
                    {product.market.split(' ')[0]}
                  </ThemedText>
                </View>
                <ThemedText style={[styles.categoryText, { color: colors.icon }]}>
                  {product.category}
                </ThemedText>
                <View style={styles.spacer} />
                <View style={[styles.stageChip, { backgroundColor: getSimilarityColor(product.similarityLevel) }]}>
                  <IconSymbol name="star.fill" size={12} color="white" />
                  <ThemedText style={styles.chipText}>
                    Stufe {product.similarityLevel}
                  </ThemedText>
                </View>
              </View>

              {/* Product Row */}
              <View style={styles.productRow}>
                {/* Product Image */}
                <View style={styles.productImageContainer}>
                  <Image 
                    source={product.image}
                    style={styles.productImage}
                  />
                </View>

                {/* Product Info */}
                <View style={styles.productInfo}>
                  <ThemedText style={[styles.brandText, { color: colors.primary }]}>
                    {product.brand}
                  </ThemedText>
                  <ThemedText style={styles.productTitle}>
                    {product.name}
                  </ThemedText>
                  <View style={styles.discountRow}>
                    <IconSymbol name="star.fill" size={14} color={colors.success} />
                    <ThemedText style={[styles.discountValue, { color: colors.success }]}>
                      {product.discount}%
                    </ThemedText>
                  </View>
                  <View style={styles.ratingRow}>
                    <ThemedText style={[styles.ratingValue, { color: colors.warning }]}>
                      {product.rating.toFixed(1)}
                    </ThemedText>
                    <View style={styles.starsContainer}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <ThemedText 
                          key={star} 
                          style={[styles.starIcon, { color: star <= product.rating ? colors.warning : colors.border }]}
                        >
                          ★
                        </ThemedText>
                      ))}
                    </View>
                    <ThemedText style={[styles.reviewsText, { color: colors.icon }]}>
                      ({product.reviews})
                    </ThemedText>
                  </View>
                  <View style={styles.scoresRow}>
                    <ScoreImage type="nutri" value={product.nutriscore} />
                    <ScoreImage type="eco" value={product.ecoscore} />
                    <ScoreImage type="nova" value={product.nova} />
                  </View>
                </View>

                {/* Price Section */}
                <View style={styles.priceSection}>
                  <ThemedText style={[styles.mainPrice, { color: colors.success }]}>
                    € {product.price.toFixed(2)}
                  </ThemedText>
                  <ThemedText style={[styles.mainWeight, { color: colors.icon }]}>
                    {product.weight}
                  </ThemedText>
                </View>
              </View>

              {/* Regional Info for first item */}
              {index === 0 && (
                <View style={styles.regionalSection}>
                  <View style={styles.regionalHeader}>
                    <IconSymbol name="location" size={16} color={colors.primary} />
                    <ThemedText style={[styles.regionalTitle, { color: colors.primary }]}>
                      Regionale Produktinformation
                    </ThemedText>
                    <IconSymbol name="chevron.down" size={16} color={colors.icon} />
                  </View>
                </View>
              )}

              {/* Details Button with Cart */}
              <TouchableOpacity 
                style={[styles.detailsRow, { borderColor: colors.primary }]}
                onPress={() => setShowProductDetails(true)}
              >
                <IconSymbol name="info.circle" size={20} color={colors.primary} />
                <ThemedText style={[styles.detailsText, { color: colors.primary }]}>
                  Details
                </ThemedText>
                <TouchableOpacity style={[styles.cartButtonLarge, { backgroundColor: colors.primary }]}>
                  <IconSymbol name="cart" size={20} color="white" />
                </TouchableOpacity>
              </TouchableOpacity>
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
                <ThemedText style={styles.bottomSheetTitle}>{brandProduct.brand}</ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.primary }]}>
                  {brandProduct.name}
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
            {/* Similarity Section */}
            <View style={[styles.similarityCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.similarityHeader}>
                <View style={[styles.similarityBadge, { backgroundColor: getSimilarityColor(4) }]}>
                  <ThemedText style={styles.similarityNumber}>4</ThemedText>
                </View>
                <View style={styles.similarityTextContainer}>
                  <ThemedText style={styles.similarityTitle}>Stufe 4</ThemedText>
                  <ThemedText style={[styles.similarityDescription, { color: colors.icon }]}>
                    Dieser Hersteller stellt sowohl das NoName-Produkt als auch das Markenprodukt her, 
                    die sich in Nährwerten und Zutaten weniger als 10% unterscheiden.
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Manufacturer Info Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="building.2" size={16} color={colors.primary} />
                <ThemedText style={styles.sectionTitleText}>Herstellerinformationen</ThemedText>
              </View>
              <View style={styles.infoGrid}>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Hersteller:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>{brandProduct.manufacturer}</ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Ort:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>{brandProduct.location}</ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Infos:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}></ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Marken:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}></ThemedText>
                </View>
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
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>400.0 g</ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Zutaten:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>{brandProduct.ingredients}</ThemedText>
                </View>
              </View>
            </View>

            {/* Nutrition Info Card */}
            <View style={[styles.infoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.sectionHeader}>
                <IconSymbol name="leaf" size={16} color={colors.primary} />
                <ThemedText style={styles.sectionTitleText}>Nährwerte</ThemedText>
              </View>
              <View style={styles.infoGrid}>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Energie:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>137 null</ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Fett:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>8 g</ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Kohlenhydrate:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>0.7 g</ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>davon Zucker:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>0.5 g</ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Eiweiß:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>15.4 g</ThemedText>
                </View>
                <View style={styles.infoRow}>
                  <ThemedText style={styles.infoLabel}>Salz:</ThemedText>
                  <ThemedText style={[styles.infoValue, { color: colors.icon }]}>0.03 g</ThemedText>
                </View>
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
  scrollContent: {
    paddingBottom: 24,
  },

  // Product Card (shared by main and alternatives)
  productCard: {
    margin: 16,
    marginBottom: 8,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  // Chips Row
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  brandChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  marketChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  stageChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '600',
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
    marginBottom: 16,
    gap: 12,
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

  // Product Info
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

  // Details Row with Cart
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'transparent',
    gap: 8,
  },
  detailsText: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  cartButtonLarge: {
    width: 40,
    height: 24,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Alternatives Section
  alternativesContainer: {
    paddingHorizontal: 12,
  },
  alternativesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 8,
  },

  // Regional Info
  regionalSection: {
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  regionalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  regionalTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
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
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
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
  },
  similarityTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  similarityDescription: {
    fontSize: 14,
    lineHeight: 20,
  },

  // Info Cards
  infoCard: {
    borderRadius: 16,
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
    marginBottom: 12,
    gap: 8,
  },
  sectionTitleText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoGrid: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '500',
    width: 120,
    flexShrink: 0,
  },
  infoValue: {
    fontSize: 14,
    flex: 1,
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
});