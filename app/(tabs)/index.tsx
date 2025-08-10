import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { top: insetTop } = useSafeAreaInsets();
  const headerPaddingTop = insetTop + 56;

  // Dynamische Höhenmessung für sauberen Scroll-Übergang unter der Mitte der Suchleiste
  const [headerHeight, setHeaderHeight] = useState(0);
  const [searchHeight, setSearchHeight] = useState(0);

  type Category = { icon: SymbolViewProps['name']; title: string; color: string };
  const categories: Category[] = [
    { icon: 'house.fill', title: 'Alkohol', color: colors.primary },
    { icon: 'cart', title: 'Backwaren / Fertigteig', color: colors.primary },
    { icon: 'heart.fill', title: 'Butter, Margarine etc.', color: colors.primary },
  ];

  const featuredProducts = [
    {
      title: 'ECO Spülbalsam Aloe Vera',
      brand: 'natürlich',
      price: '€ 0,95',
      level: 'Stufe 4',
      image: require('@/assets/images/react-logo.png'),
    },
    {
      title: 'Bio Gewürzgurken',
      brand: 'K-Bio',
      price: '€ 2,19',
      level: 'Stufe 3',
      image: require('@/assets/images/react-logo.png'),
    },
    {
      title: 'Pils Alkoholfrei',
      brand: 'Turmbräu',
      price: '€ 0,55',
      level: 'Stufe 4',
      image: require('@/assets/images/react-logo.png'),
    },
  ];

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Fixed Header */}
      <View style={[styles.fixedHeader, { backgroundColor: colors.background }]}> 
        <View style={[styles.header, { paddingTop: headerPaddingTop }]} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={styles.headerContent}>
            <View style={styles.titleWrap}>
              <View style={styles.titleRow}>
                <IconSymbol name="cart" size={20} color={colors.primary} />
                <ThemedText style={[styles.brandTitle, { color: colors.primary }]}>MarkenDetektive</ThemedText>
              </View>
              <ThemedText style={[styles.subtitle]}>NoNames enttarnen,{"\n"}clever sparen!</ThemedText>
            </View>
            <TouchableOpacity style={[styles.profileButton, { backgroundColor: colors.primary }]}>
              <IconSymbol name="person.circle" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Search Bar */}
        <View style={styles.searchSection} onLayout={(e) => setSearchHeight(e.nativeEvent.layout.height)}>
          <View style={[styles.searchContainer, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <IconSymbol name="magnifyingglass" size={20} color={colors.icon} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Produkte suchen ..."
              placeholderTextColor={colors.icon}
            />
          </View>
          <TouchableOpacity 
            style={[styles.scanButton, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
            onPress={() => router.push('/barcode-scanner')}
          >
            <IconSymbol name="barcode" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
        
        {/* Kein Overlay nötig – Schatten der Suchleiste übernimmt den Übergang */}
      </View>

      {/* Scrollable Content */}
          <ScrollView 
        style={[styles.scrollView, { marginTop: Math.max(0, headerHeight + searchHeight * 0.5) }]} 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* Categories */}
        <View style={styles.categoriesSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 6, paddingRight: 12 }}
          >
            {categories.map((category, index) => (
              <TouchableOpacity key={index} style={[styles.categoryChip, { backgroundColor: colors.cardBackground }]}>
                <IconSymbol name={category.icon} size={20} color={category.color} />
                <ThemedText style={styles.categoryText}>{category.title}</ThemedText>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Level Card */}
        <LinearGradient
          colors={['#BF8970', '#97a1887f']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.levelCard}
        >
          <TouchableOpacity 
            style={styles.levelContent}
            onPress={() => router.push('/achievements')}
          >
            <View style={styles.levelIcon}>
              <IconSymbol name="star.fill" size={16} color="white" />
            </View>
            <View style={styles.levelText}>
              <ThemedText style={styles.levelTitle}>Level 1 Sparanfänger</ThemedText>
              <ThemedText style={styles.levelSubtitle}>25,00 € Ersparnis & 5 Punkte zum Aufstieg</ThemedText>
            </View>
            <View style={styles.levelInfoIcon}>
              <ThemedText style={{ 
                color: 'white', 
                fontSize: 10, 
                fontWeight: 'bold',
                fontFamily: 'Nunito_700Bold',
                textAlign: 'center',
                lineHeight: 8
              }}>i</ThemedText>
            </View>
          </TouchableOpacity>
        </LinearGradient>

        {/* Neu für dich enttarnt */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Neu für dich enttarnt</ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 10, paddingRight: 12 }}
          >
            {featuredProducts.map((product, index) => (
              <TouchableOpacity 
                key={index} 
                style={[styles.productCard, { backgroundColor: colors.cardBackground }]}
                onPress={() => router.push(`/product-comparison/${index + 1}`)}
              >
                <View style={styles.productImageWrapper}>
                  <Image source={product.image} style={styles.productImageFile} />
                  <View style={[styles.levelBadge, { backgroundColor: colors.success }]}>
                    <ThemedText style={styles.levelBadgeText}>{product.level}</ThemedText>
                  </View>
                </View>
                <View style={styles.productInfo}>
                  <ThemedText style={styles.productTitle} numberOfLines={2} ellipsizeMode="tail">{product.title}</ThemedText>
                  <ThemedText style={styles.productBrand} numberOfLines={1} ellipsizeMode="tail">{product.brand}</ThemedText>
                  <ThemedText style={[styles.productPrice, { color: colors.primary }]}>{product.price}</ThemedText>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Neuigkeiten */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Neuigkeiten</ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 10, paddingRight: 12 }}
          >
            <TouchableOpacity style={[styles.newsCard, { backgroundColor: colors.cardBackground }]}>
              <Image source={require('@/assets/images/react-logo.png')} style={styles.newsImageFile} />
              <ThemedText style={styles.newsTitle}>Marmeladungen</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.newsCard, { backgroundColor: colors.cardBackground }]}>
              <Image source={require('@/assets/images/react-logo.png')} style={styles.newsImageFile} />
              <ThemedText style={styles.newsTitle}>Ist die Schokolade echt?</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.newsCard, { backgroundColor: colors.cardBackground }]}>
              <Image source={require('@/assets/images/react-logo.png')} style={styles.newsImageFile} />
              <ThemedText style={styles.newsTitle}>Neue Deals</ThemedText>
            </TouchableOpacity>
          </ScrollView>
        </View>
        
        {/* Extra Spacing for Tab Bar */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/shopping-list')}
      >
        <IconSymbol name="cart" size={20} color="white" />
      </TouchableOpacity>
      </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fixedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingBottom: 0,
    // Kein Container-Schatten, damit kein graues Band entsteht
    elevation: 0,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    overflow: 'visible',
  },
  header: {
    
    paddingBottom: 16,
    paddingHorizontal: 12,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  titleWrap: {
    flexShrink: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  brandTitle: {
    fontSize: 24,
    fontFamily: 'Nunito_700Bold',
    lineHeight: 28,
  },
  profileButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 12,
  },
  subtitle: {
    fontSize: 17,
    fontFamily: 'Nunito_700Bold',
    opacity: 0.9,
    lineHeight: 22,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16, // Etwas Abstand, damit Kategorien initial nicht vom Schatten überlagert werden
    paddingBottom: 24,
  },
  searchSection: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 0,
    gap: 12,
    zIndex: 10,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#00000010',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  scanButton: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00000010',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  categoriesSection: {
    paddingLeft: 12,
    marginBottom: 12,
    marginTop: 22, // +8pt Abstand unter Suchleiste
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 10,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  categoryText: {
    fontSize: 14,
    fontFamily: 'Lato_500Medium',
  },
  levelCard: {
    marginHorizontal: 12,
    padding: 10,
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  levelContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  levelIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelText: {
    flex: 1,
  },
  levelTitle: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
    marginBottom: 1,
    lineHeight: 18,
  },
  levelSubtitle: {
    fontSize: 11,
    fontFamily: 'Lato_400Regular',
    color: 'rgba(255, 255, 255, 0.8)',
    flexShrink: 1,
    lineHeight: 12,
   },
  levelInfoIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    textAlign: 'center',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_700SemiBold',
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  productCard: {
    width: 150,
    padding: 12,
    borderRadius: 16,
    marginLeft: 12,
    marginRight: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    justifyContent: 'flex-start',
    height: 228,
  },
  productImageWrapper: {
    alignItems: 'center',
    marginBottom: 12,
    position: 'relative',
    height: 95,
    justifyContent: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  productImageFile: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  levelBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#42a968',
  },
  levelBadgeText: {
    fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  productInfo: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  productTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    minHeight: 40,
    lineHeight: 20,
  },
  productBrand: {
    fontSize: 12,
    fontFamily: 'Lato_400Regular',
    opacity: 0.7,
    marginBottom: 8,
    minHeight: 16,
    lineHeight: 16,
  },
  productPrice: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  newsCard: {
    width: 180,
    padding: 12,
    borderRadius: 16,
    alignItems: 'center',
    marginLeft: 12,
    marginRight: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  newsImageFile: {
    width: 130,
    height: 85,
    borderRadius: 12,
    marginBottom: 8,
  },
  newsTitle: {
    fontSize: 14,
    fontFamily: 'Lato_500Medium',
    textAlign: 'center',
  },
  fab: {
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
});
