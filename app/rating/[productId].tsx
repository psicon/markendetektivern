import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

export default function RatingScreen() {
  const { productId } = useLocalSearchParams();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const [overallRating, setOverallRating] = useState(0);
  const [tasteRating, setTasteRating] = useState(0);
  const [priceRating, setPriceRating] = useState(0);
  const [ingredientsRating, setIngredientsRating] = useState(0);
  const [comment, setComment] = useState('');

  // Mock product data
  const product = {
    name: 'Bio Tofu Natur',
    brand: 'Berief',
    image: '🟦',
    category: 'Veggie und Vegan'
  };

  const existingRatings = {
    overall: 0,
    count: 0,
    categories: {
      taste: 0,
      price: 0,
      ingredients: 0
    }
  };

  const comments = [
    // Leer, da keine Bewertungen vorhanden
  ];

  const renderStars = (rating: number, onPress: (star: number) => void, size: number = 32) => {
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity key={star} onPress={() => onPress(star)}>
            <IconSymbol
              name="star.fill"
              size={size}
              color={star <= rating ? colors.warning : colors.border}
            />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const handleSaveRating = () => {
    // Hier würde die Bewertung gespeichert werden
    console.log('Saving rating:', {
      productId,
      overall: overallRating,
      taste: tasteRating,
      price: priceRating,
      ingredients: ingredientsRating,
      comment
    });
    router.back();
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen 
        options={{
          title: 'Bewertung abgeben (Markenprodukt)',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: 'white',
          headerTitleStyle: { color: 'white', fontWeight: '600' },
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

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Product Header */}
        <View style={[styles.productHeader, { backgroundColor: colors.cardBackground }]}>
          <View style={styles.productInfo}>
            <View style={styles.productImage}>
              <ThemedText style={styles.productEmoji}>{product.image}</ThemedText>
            </View>
            <View style={styles.productDetails}>
              <ThemedText style={[styles.brandName, { color: colors.primary }]}>
                {product.brand}
              </ThemedText>
              <ThemedText style={styles.productName}>
                {product.name}
              </ThemedText>
            </View>
            <TouchableOpacity>
              <IconSymbol name="chevron.right" size={24} color={colors.icon} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Rating Form */}
        <View style={styles.ratingForm}>
          <ThemedText style={styles.formTitle}>
            Deine Gesamtbewertung
          </ThemedText>
          
          <View style={styles.ratingSection}>
            {renderStars(overallRating, setOverallRating, 40)}
          </View>

          <ThemedText style={styles.sectionTitle}>
            Detail-Bewertung nach Kriterien (optional)
          </ThemedText>

          {/* Taste Rating */}
          <View style={styles.criteriaSection}>
            <ThemedText style={styles.criteriaLabel}>
              Geschmack bzw. Funktion/Wirkung
            </ThemedText>
            {renderStars(tasteRating, setTasteRating)}
          </View>

          {/* Price Rating */}
          <View style={styles.criteriaSection}>
            <ThemedText style={styles.criteriaLabel}>
              Preis-Leistungsgefühl
            </ThemedText>
            {renderStars(priceRating, setPriceRating)}
          </View>

          {/* Ingredients Rating */}
          <View style={styles.criteriaSection}>
            <ThemedText style={styles.criteriaLabel}>
              Deine Bewertung der Inhaltsstoffe
            </ThemedText>
            {renderStars(ingredientsRating, setIngredientsRating)}
          </View>

          {/* Comment Section */}
          <View style={styles.commentSection}>
            <ThemedText style={styles.commentTitle}>
              Dein Kommentar (optional)
            </ThemedText>
            <TextInput
              style={[styles.commentInput, { 
                backgroundColor: colors.cardBackground,
                borderColor: colors.border,
                color: colors.text
              }]}
              placeholder="Teile deine Erfahrungen mit diesem Produkt..."
              placeholderTextColor={colors.icon}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              value={comment}
              onChangeText={setComment}
            />
          </View>

          {/* Save Button */}
          <TouchableOpacity 
            style={[styles.saveButton, { 
              backgroundColor: overallRating > 0 ? colors.primary : colors.border 
            }]}
            onPress={handleSaveRating}
            disabled={overallRating === 0}
          >
            <ThemedText style={[styles.saveButtonText, { 
              color: overallRating > 0 ? 'white' : colors.icon 
            }]}>
              Bewertung speichern
            </ThemedText>
          </TouchableOpacity>
        </View>

        {/* Existing Ratings Section */}
        <View style={styles.existingRatings}>
          <ThemedText style={styles.sectionTitle}>
            Bewertungen
          </ThemedText>
          <ThemedText style={[styles.brandName, { color: colors.primary, marginBottom: 24 }]}>
            {product.name}
          </ThemedText>

          {/* Overall Rating Display */}
          <View style={[styles.overallRatingCard, { backgroundColor: colors.cardBackground }]}>
            <View style={styles.ratingCircle}>
              <ThemedText style={styles.ratingNumber}>
                {existingRatings.overall}
              </ThemedText>
            </View>
            <View style={styles.ratingInfo}>
              <ThemedText style={styles.ratingTitle}>
                Allgemeine Bewertung
              </ThemedText>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <IconSymbol
                    key={star}
                    name="star.fill"
                    size={20}
                    color={colors.border}
                  />
                ))}
              </View>
              <ThemedText style={styles.ratingSubtitle}>
                Basierend auf {existingRatings.count} Bewertungen
              </ThemedText>
            </View>
          </View>

          {/* Category Ratings */}
          <View style={styles.categoryRatings}>
            <ThemedText style={styles.categoryTitle}>
              Bewertung nach Kriterien
            </ThemedText>
            
            <View style={styles.categoryRow}>
              <ThemedText style={styles.categoryName}>
                Geschmack/
              </ThemedText>
              <ThemedText style={styles.categoryCount}>0</ThemedText>
            </View>
            <View style={styles.categoryRow}>
              <ThemedText style={styles.categoryName}>
                Wirkung/Funktion
              </ThemedText>
            </View>
            <View style={styles.categoryRow}>
              <ThemedText style={styles.categoryName}>
                Preis-Leistung
              </ThemedText>
              <ThemedText style={styles.categoryCount}>0</ThemedText>
            </View>
            <View style={styles.categoryRow}>
              <ThemedText style={styles.categoryName}>
                Inhaltsstoffe
              </ThemedText>
              <ThemedText style={styles.categoryCount}>0</ThemedText>
            </View>
          </View>

          {/* Add Rating Button */}
          <TouchableOpacity 
            style={[styles.addRatingButton, { backgroundColor: colors.primary }]}
          >
            <IconSymbol name="star.fill" size={20} color="white" />
            <ThemedText style={styles.addRatingText}>
              Bewertung abgeben
            </ThemedText>
          </TouchableOpacity>

          {/* Comments Section */}
          <View style={styles.commentsSection}>
            <ThemedText style={styles.commentsTitle}>
              Neueste Kommentare
            </ThemedText>
            
            <View style={styles.emptyComments}>
              <ThemedText style={styles.emptyText}>
                Oh, hier ist noch nichts!
              </ThemedText>
            </View>
          </View>
        </View>
      </ScrollView>
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
  productHeader: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
  },
  productInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  productImage: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productEmoji: {
    fontSize: 40,
  },
  productDetails: {
    flex: 1,
  },
  brandName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  productName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  ratingForm: {
    padding: 20,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  ratingSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  criteriaSection: {
    marginBottom: 24,
  },
  criteriaLabel: {
    fontSize: 16,
    marginBottom: 12,
    opacity: 0.8,
  },
  commentSection: {
    marginBottom: 32,
  },
  commentTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  commentInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    minHeight: 100,
  },
  saveButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 32,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  existingRatings: {
    padding: 20,
  },
  overallRatingCard: {
    flexDirection: 'row',
    padding: 20,
    borderRadius: 16,
    marginBottom: 24,
    gap: 16,
  },
  ratingCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#666',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  ratingInfo: {
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
    marginBottom: 8,
  },
  ratingSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  categoryRatings: {
    marginBottom: 24,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  categoryName: {
    fontSize: 14,
  },
  categoryCount: {
    fontSize: 14,
    fontWeight: '600',
  },
  addRatingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    gap: 8,
  },
  addRatingText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  commentsSection: {
    marginTop: 20,
  },
  commentsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  emptyComments: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    opacity: 0.7,
    textAlign: 'center',
  },
});

