import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { FirestoreService } from '@/lib/services/firestore';
import { FirestoreDocument, Handelsmarken, Kategorien, Produkte } from '@/lib/types/firestore';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { top: insetTop } = useSafeAreaInsets();
  const headerPaddingTop = insetTop + 56;

  // Dynamische Höhenmessung für sauberen Scroll-Übergang unter der Mitte der Suchleiste
  const [headerHeight, setHeaderHeight] = useState(0);
  const [searchHeight, setSearchHeight] = useState(0);
  
  // Firestore State
  const [enttarnteProdukte, setEnttarnteProdukte] = useState<FirestoreDocument<Produkte>[]>([]);
  const [handelsmarken, setHandelsmarken] = useState<{[key: string]: string}>({});
  const [kategorien, setKategorien] = useState<FirestoreDocument<Kategorien>[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Icon-Mapping für Kategorien
  const getCategoryIcon = (bezeichnung: string): SymbolViewProps['name'] => {
    const iconMap: {[key: string]: SymbolViewProps['name']} = {
      'alkohol': 'wineglass',
      'alkoholfreie getränke': 'cup.and.saucer',
      'backwaren': 'birthday.cake',
      'fertigteig': 'birthday.cake',
      'butter': 'drop.fill',
      'margarine': 'drop.fill',
      'fleisch': 'fork.knife',
      'wurst': 'fork.knife',
      'fisch': 'fish',
      'meeresfrüchte': 'fish',
      'milch': 'drop.fill',
      'käse': 'square.grid.2x2',
      'joghurt': 'cup.and.saucer',
      'obst': 'leaf.fill',
      'gemüse': 'leaf.fill',
      'brot': 'birthday.cake',
      'getreide': 'grains',
      'süßwaren': 'heart.fill',
      'schokolade': 'heart.fill',
      'snacks': 'bag',
      'chips': 'bag',
      'tiefkühl': 'snowflake',
      'konserven': 'archivebox',
      'gewürze': 'sparkles',
      'öl': 'drop.fill',
      'essig': 'drop.fill',
      'baby': 'heart.circle',
      'haushalt': 'house.fill',
      'reinigung': 'sparkles',
      'hygiene': 'hand.wash',
      'kosmetik': 'sparkles',
      'tiernahrung': 'pawprint.fill',
      'drogerie': 'cross.case',
      'gesundheit': 'cross.case'
    };
    
    const key = bezeichnung.toLowerCase();
    for (const [searchKey, icon] of Object.entries(iconMap)) {
      if (key.includes(searchKey)) {
        return icon;
      }
    }
    return 'square.grid.2x2'; // Default icon
  };

  // Load data from Firestore
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setCategoriesLoading(true);
        setError(null);
        
        // Lade Kategorien und Produkte parallel
        const [kategorienData, produkteData] = await Promise.all([
          FirestoreService.getKategorien(),
          FirestoreService.getLatestEnttarnteProdukte(10)
        ]);
        
        console.log('Loaded kategorien:', kategorienData);
        // Sortiere Kategorien alphabetisch nach bezeichnung
        const sortedKategorien = kategorienData.sort((a, b) => 
          a.bezeichnung.localeCompare(b.bezeichnung, 'de')
        );
        setKategorien(sortedKategorien);
        setCategoriesLoading(false);
        
        console.log('Loaded produkte:', produkteData);
        setEnttarnteProdukte(produkteData);
        
        // Lade Handelsmarken für alle Produkte parallel
        const handelsmarkenMap: {[key: string]: string} = {};
        const handelsmarkenPromises = produkteData.map(async (product) => {
          if (product.handelsmarke) {
            try {
              const handelsmarke = await FirestoreService.getDocumentByReference<Handelsmarken>(product.handelsmarke);
              console.log(`Loaded handelsmarke for ${product.name}:`, handelsmarke);
              if (handelsmarke && handelsmarke.bezeichnung) {
                handelsmarkenMap[product.id] = handelsmarke.bezeichnung;
                console.log(`Set handelsmarke: ${handelsmarke.bezeichnung} for product: ${product.name}`);
              }
            } catch (err) {
              console.error(`Error loading handelsmarke for product ${product.id}:`, err);
            }
          }
        });
        
        await Promise.all(handelsmarkenPromises);
        setHandelsmarken(handelsmarkenMap);
        
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Fehler beim Laden der Daten');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Helper function to format price
  const formatPrice = (price: number) => {
    return `€ ${price.toFixed(2).replace('.', ',')}`;
  };

  // Helper function to get stufe display
  const getStufeDisplay = (stufe: string) => {
    return stufe ? `Stufe ${stufe}` : 'Unbekannt';
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Fixed Header */}
      <View style={[styles.fixedHeader, { backgroundColor: colors.background }]}> 
        <View style={[styles.header, { paddingTop: headerPaddingTop }]} onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
          <View style={styles.headerContent}>
            <View style={styles.titleWrap}>
              <View style={styles.titleRow}>
                <CustomIcon 
                  name="iconBlack" 
                  size={32} 
                  color={colors.primary}
                  style={{
                    alignSelf: 'flex-start',
                    marginTop: 0,
                  }}
                />
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
            {categoriesLoading ? (
              <View style={styles.categoriesLoadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <ThemedText style={[styles.categoriesLoadingText, { color: colors.icon }]}>Lade Kategorien...</ThemedText>
              </View>
            ) : (
              kategorien.map((kategorie, index) => (
                <TouchableOpacity key={kategorie.id} style={[styles.categoryChip, { backgroundColor: colors.cardBackground }]}>
                  {kategorie.bild && kategorie.bild.trim() !== '' && !failedImages.has(kategorie.id) ? (
                    <Image 
                      source={{ uri: kategorie.bild }} 
                      style={styles.categoryImage}
                      onError={() => {
                        console.log(`Failed to load image for category: ${kategorie.bezeichnung}`);
                        setFailedImages(prev => new Set([...prev, kategorie.id]));
                      }}
                    />
                  ) : (
                    <IconSymbol name={getCategoryIcon(kategorie.bezeichnung)} size={20} color={colors.primary} />
                  )}
                  <ThemedText style={styles.categoryText}>{kategorie.bezeichnung}</ThemedText>
                </TouchableOpacity>
              ))
            )}
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
          
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <ThemedText style={[styles.loadingText, { color: colors.icon }]}>Lade Produkte...</ThemedText>
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <ThemedText style={[styles.errorText, { color: colors.error || '#FF3B30' }]}>{error}</ThemedText>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 10, paddingRight: 12 }}
            >
              {enttarnteProdukte.map((product, index) => (
                <TouchableOpacity 
                  key={product.id} 
                  style={[styles.productCard, { backgroundColor: colors.cardBackground }]}
                  onPress={() => router.push(`/product-comparison/${product.id}`)}
                >
                  <View style={styles.productImageWrapper}>
                    {product.bild ? (
                      <Image source={{ uri: product.bild }} style={styles.productImageFile} />
                    ) : (
                      <View style={[styles.productImagePlaceholder, { backgroundColor: colors.border }]}>
                        <IconSymbol name="photo" size={24} color={colors.icon} />
                      </View>
                    )}
                    <View style={[styles.levelBadge, { backgroundColor: colors.success }]}>
                      <ThemedText style={styles.levelBadgeText}>{getStufeDisplay(product.stufe)}</ThemedText>
                    </View>
                  </View>
                  <View style={styles.productInfo}>
                    <ThemedText style={styles.productTitle} numberOfLines={2} ellipsizeMode="tail">{product.name}</ThemedText>
                    <ThemedText style={styles.productBrand} numberOfLines={1} ellipsizeMode="tail">
                      {handelsmarken[product.id] || 'NoName-Produkt'}
                    </ThemedText>
                    <ThemedText style={[styles.productPrice, { color: colors.primary }]}>{formatPrice(product.preis)}</ThemedText>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
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
    gap: 4,
    marginBottom: 4,
  },
  brandTitle: {
    fontSize: 28,
    fontFamily: 'Nunito_700Bold',
    lineHeight: 33,
    marginTop: 2,
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
    fontSize: 20,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 21,
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
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#00000010',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    gap: 12,
    height: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  scanButton: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#00000010',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    height: 48,
    width: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoriesSection: {
    paddingLeft: 12,
    marginBottom: 12,
    marginTop: 22, // +8pt Abstand unter Suchleiste
  },
  categoriesLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  categoriesLoadingText: {
    fontSize: 14,
    fontFamily: 'Lato_400Regular',
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
  categoryImage: {
    width: 20,
    height: 20,
    borderRadius: 4,
    resizeMode: 'cover',
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
  productImagePlaceholder: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    paddingHorizontal: 12,
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: 'Lato_400Regular',
  },
  errorContainer: {
    paddingHorizontal: 12,
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Lato_400Regular',
    textAlign: 'center',
  },
});
