import NewsCard from '@/components/NewsCard';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { LockedCategoryModal } from '@/components/ui/LockedCategoryModal';
import { SearchBottomSheet } from '@/components/ui/SearchBottomSheet';
import { CategorySkeleton, NewsCardSkeleton, ProductCardSkeleton } from '@/components/ui/ShimmerSkeleton';
import { getStufenColor } from '@/constants/AppTexts';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { achievementService } from '@/lib/services/achievementService';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
import { FirestoreService } from '@/lib/services/firestore';
import searchHistoryService from '@/lib/services/searchHistoryService';
import WordPressService, { WordPressPost } from '@/lib/services/wordpress';
import { Level } from '@/lib/types/achievements';
import { FirestoreDocument, Handelsmarken, Kategorien, Produkte } from '@/lib/types/firestore';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolViewProps } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { top: insetTop } = useSafeAreaInsets();
  const { user, userProfile } = useAuth();
  // Reduziere den oberen Safe Area Abstand um 35%
  const reducedTopInset = insetTop * 0.65;
  const headerPaddingTop = reducedTopInset + 56;

  // Dynamische Höhenmessung für sauberen Scroll-Übergang unter der Mitte der Suchleiste
  const [headerHeight, setHeaderHeight] = useState(0);
  const [searchHeight, setSearchHeight] = useState(0);
  
  // Search Bottom Sheet State
  const [showSearchSheet, setShowSearchSheet] = useState(false);
  const [searchBarPosition, setSearchBarPosition] = useState({ y: 0, height: 0 });
  
  // Locked Category Modal State
  const [lockedCategoryModal, setLockedCategoryModal] = useState<{
    visible: boolean;
    category: FirestoreDocument<Kategorien> | null;
  }>({ visible: false, category: null });

  // Firestore State
  const [enttarnteProdukte, setEnttarnteProdukte] = useState<FirestoreDocument<Produkte>[]>([]);
  const [handelsmarken, setHandelsmarken] = useState<{[key: string]: string}>({});
  const [kategorien, setKategorien] = useState<FirestoreDocument<Kategorien>[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  
  // Gamification State
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(true);
  
  // WordPress News State
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsPosts, setNewsPosts] = useState<WordPressPost[]>([]);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsLoadingMore, setNewsLoadingMore] = useState(false);
  const [newsHasMore, setNewsHasMore] = useState(true);
  const [newsPage, setNewsPage] = useState(1);

  // Icon-Mapping für Kategorien
  // Handle Search Function
  const handleSearch = async (term: string) => {
    if (!term || term.trim().length === 0) return;
    
    // Speichere in History
    if (user?.uid) {
      await searchHistoryService.saveSearchTerm(user.uid, term);
    }
    
    // Navigiere zu Suchergebnissen
    router.push(`/search-results?query=${encodeURIComponent(term)}` as any);
  };

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
      'getreide': 'leaf.fill',
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
      'hygiene': 'sparkles',
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

  // Load Gamification Levels (nur wenn User authentifiziert ist)
  useEffect(() => {
    const loadLevels = async () => {
      if (!user) {
        // Kein User = keine Levels laden (spart Kosten)
        setLevelsLoading(false);
        return;
      }

      try {
        setLevelsLoading(true);
        const loadedLevels = await achievementService.getAllLevels();
        setLevels(loadedLevels);
      } catch (error) {
        console.error('Fehler beim Laden der Levels:', error);
        // Keine lokalen Fallbacks! Zeige Loading oder Error
      } finally {
        setLevelsLoading(false);
      }
    };

    loadLevels();
  }, [user]); // Nur neu laden wenn User sich ändert

  // Load data from Firestore
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setCategoriesLoading(true);
        setError(null);
        
        // User Level für Kategorie-Zugriff
        const userLevel = userProfile?.stats?.currentLevel || userProfile?.level || 1;
        
        // Lade Kategorien und Produkte parallel
        const [kategorienWithAccess, produkteData] = await Promise.all([
          categoryAccessService.getAllCategoriesWithAccess(userLevel),
          FirestoreService.getLatestEnttarnteProdukte(10)
        ]);
        
        // Kategorien sind bereits sortiert vom Service
        setKategorien(kategorienWithAccess);
        setCategoriesLoading(false);
        

        setEnttarnteProdukte(produkteData);
        
        // Lade Handelsmarken für alle Produkte parallel
        const handelsmarkenMap: {[key: string]: string} = {};
        const handelsmarkenPromises = produkteData.map(async (product) => {
          if (product.handelsmarke) {
            try {
              const handelsmarke = await FirestoreService.getDocumentByReference<Handelsmarken>(product.handelsmarke);

              if (handelsmarke && handelsmarke.bezeichnung) {
                handelsmarkenMap[product.id] = handelsmarke.bezeichnung;

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
  }, [userProfile]);

  // Helper function to format price
  const formatPrice = (price: number) => {
    return `€ ${price.toFixed(2).replace('.', ',')}`;
  };

  // Helper function to get stufe display
  const getStufeDisplay = (stufe: string) => {
    return stufe ? `Stufe ${stufe}` : 'Unbekannt';
  };

  // WordPress News laden (initial)
  const loadNews = async (reset: boolean = true) => {
    try {
      if (reset) {
        setNewsLoading(true);
        setNewsError(null);
        setNewsPage(1);
        setNewsHasMore(true);
      }
      
      const wordpressService = new WordPressService();
      const response = await wordpressService.getLatestPosts(3); // Lade 3 neueste Posts
      
      if (reset) {
        setNewsPosts(response.posts);
      } else {
        setNewsPosts(prev => [...prev, ...response.posts]);
      }
      
      // Prüfe ob mehr Posts verfügbar sind
      setNewsHasMore(response.posts.length === 3 && response.totalPages > 1);
      

    } catch (error) {
      console.error('❌ Error loading news:', error);
      setNewsError('Neuigkeiten konnten nicht geladen werden');
    } finally {
      setNewsLoading(false);
    }
  };

  // Weitere News laden (pagination)
  const loadMoreNews = async () => {
    if (newsLoadingMore || !newsHasMore) return;
    
    try {
      setNewsLoadingMore(true);
      const nextPage = newsPage + 1;
      
      const wordpressService = new WordPressService();
      const response = await wordpressService.getLatestPostsPaginated(3, nextPage);
      
      if (response.posts.length > 0) {
        setNewsPosts(prev => [...prev, ...response.posts]);
        setNewsPage(nextPage);
        
        // Prüfe ob noch mehr Posts verfügbar sind
        setNewsHasMore(nextPage < response.totalPages);
        

      } else {
        setNewsHasMore(false);

      }
    } catch (error) {
      console.error('❌ Error loading more news:', error);
    } finally {
      setNewsLoadingMore(false);
    }
  };

  // InApp Browser für News öffnen
  const openNewsArticle = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
        controlsColor: colors.primary,
      });
    } catch (error) {
      console.error('❌ Error opening article:', error);
    }
  };

  // News laden beim Component Mount
  useEffect(() => {
    loadNews();
  }, []);

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
                <ThemedText 
                  style={[styles.brandTitle, { color: colors.primary }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit={true}
                  minimumFontScale={0.8}
                >
                  MarkenDetektive
        </ThemedText>
              </View>
              <ThemedText style={[styles.subtitle]}>NoNames enttarnen,{"\n"}clever sparen!</ThemedText>
            </View>
            <TouchableOpacity 
              style={[styles.profileButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                // Navigation basierend auf Login-Status
                if (user) {
                  router.push('/profile');
                } else {
                  router.push('/auth/welcome');
                }
              }}
            >
              <IconSymbol name="person.circle" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>
        
        {/* Search Bar */}
        <View 
          style={styles.searchSection} 
          onLayout={(e) => {
            const layout = e.nativeEvent.layout;
            setSearchHeight(layout.height);
            // Berechne die absolute Position für das Bottom Sheet
            setSearchBarPosition({ 
              y: headerPaddingTop + layout.y, 
              height: layout.height 
            });
          }}
        >
          <TouchableOpacity 
            style={[styles.searchContainer, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}
            activeOpacity={0.7}
            onPress={() => setShowSearchSheet(true)}
          >
            <IconSymbol name="magnifyingglass" size={20} color={colors.icon} />
            <View style={styles.searchInput}>
              <ThemedText style={[styles.searchPlaceholder, { color: colors.icon }]}>
                Produkte suchen ...
              </ThemedText>
            </View>
          </TouchableOpacity>
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
              <>
                {Array.from({ length: 6 }).map((_, index) => (
                  <CategorySkeleton key={`category-skeleton-${index}`} />
                ))}
              </>
            ) : (
              kategorien.map((kategorie, index) => (
                <TouchableOpacity 
                  key={kategorie.id} 
                  style={[
                    styles.categoryChip, 
                    { 
                      backgroundColor: colors.cardBackground,
                      opacity: kategorie.isLocked ? 0.6 : 1
                    }
                  ]}
                  onPress={() => {
                    if (kategorie.isLocked) {
                      // Zeige gesperrte Kategorie Modal
                      setLockedCategoryModal({
                        visible: true,
                        category: kategorie
                      });
                    } else {
                      // Navigate to explore tab with NoName products and category filter
                      router.push({
                        pathname: '/(tabs)/explore',
                        params: {
                          tab: 'nonames',
                          categoryFilter: kategorie.id,
                          categoryName: kategorie.bezeichnung
                        }
                      });
                    }
                  }}
                >
                  <View style={styles.categoryImageContainer}>
                    {kategorie.bild && kategorie.bild.trim() !== '' && !failedImages.has(kategorie.id) ? (
                      <ImageWithShimmer
                        source={{ uri: kategorie.bild }}
                        style={[
                          styles.categoryImage,
                          kategorie.isLocked && styles.categoryImageLocked
                        ]}
                        fallbackIcon="square.grid.2x2"
                        fallbackIconSize={24}
                        resizeMode="cover"
                        onError={() => {
                          console.log(`Failed to load image for category: ${kategorie.bezeichnung}`);
                          setFailedImages(prev => new Set([...prev, kategorie.id]));
                        }}
                      />
                    ) : (
                      <IconSymbol 
                        name={getCategoryIcon(kategorie.bezeichnung)} 
                        size={20} 
                        color={kategorie.isLocked ? colors.icon : colors.primary} 
                      />
                    )}
                    {kategorie.isLocked && (
                      <View style={styles.categoryLockBadge}>
                        <IconSymbol name="lock" size={12} color="white" />
                      </View>
                    )}
                  </View>
                  <ThemedText style={[
                    styles.categoryText, 
                    { color: kategorie.isLocked ? colors.icon : colors.text }
                  ]}>
                    {kategorie.bezeichnung}
                  </ThemedText>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>

        {/* Level Card - Mit echten Firestore Daten */}
        {(() => {
          // Zeige Shimmer wenn Levels noch laden
          if (levelsLoading || levels.length === 0) {
            return (
              <View style={[styles.levelCard, { backgroundColor: colors.cardBackground, justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator size="small" color={colors.tint} />
                <ThemedText style={[styles.levelSubtitle, { marginTop: 8 }]}>Lade Level-Daten...</ThemedText>
              </View>
            );
          }

          // Get actual level data
          const level = (userProfile as any)?.stats?.currentLevel || userProfile?.level || 1;
          const currentPoints = (userProfile as any)?.stats?.pointsTotal || (userProfile as any)?.stats?.totalPoints || 0;
          const currentSavings = userProfile?.totalSavings || 0;
          
          const levelInfo = levels.find(l => l.id === level) || levels[0];
          const nextLevel = levels.find(l => l.id === level + 1);
          
          // Level-spezifische Farben (Gradient mit dunklerer Version)
          const getLevelGradient = () => {
            const baseColor = levelInfo.color;
            switch(level) {
              case 1: return [baseColor, '#9E6B50']; // Braun
              case 2: return [baseColor, '#FF9800']; // Orange
              case 3: return [baseColor, '#4CAF50']; // Grün
              case 4: return [baseColor, '#FFC107']; // Gold
              case 5: return [baseColor, '#FF5252']; // Rot
              default: return [baseColor, '#9E6B50'];
            }
          };
          
          // Berechne Fortschritt zum nächsten Level
          const remainingSavings = nextLevel ? Math.max(0, nextLevel.savingsRequired - currentSavings) : 0;
          const remainingPoints = nextLevel ? Math.max(0, nextLevel.pointsRequired - currentPoints) : 0;
          
          return (
            <LinearGradient
              colors={getLevelGradient()}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.levelCard}
            >
              <TouchableOpacity 
                style={styles.levelContent}
                onPress={() => router.push('/achievements')}
              >
                <View style={styles.levelIcon}>
                  <IconSymbol name={levelInfo.icon as any} size={16} color="white" />
                </View>
                <View style={styles.levelText}>
                  <ThemedText style={styles.levelTitle}>Level {level} {levelInfo.name}</ThemedText>
                  <ThemedText style={styles.levelSubtitle}>
                    {nextLevel 
                      ? `${remainingSavings.toFixed(2)} € Ersparnis & ${remainingPoints} Punkte zum Aufstieg`
                      : 'Maximales Level erreicht!'
                    }
                  </ThemedText>
                </View>
                <IconSymbol name="info.circle" size={18} color="white" />
              </TouchableOpacity>
            </LinearGradient>
          );
        })()}

        {/* Neu für dich enttarnt */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Neu für dich enttarnt</ThemedText>
          
          {loading ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 10, paddingRight: 12 }}
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <ProductCardSkeleton key={`product-skeleton-${index}`} />
              ))}
            </ScrollView>
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
                  onPress={() => {
                    const stufe = parseInt(product.stufe) || 1;
                    if (stufe <= 2) {
                      // Stufe 1 und 2: Zur speziellen NoName-Detailseite
                      router.push(`/noname-detail/${product.id}` as any);
                    } else {
                      // Stufe 3+: Zum normalen Produktvergleich
                      router.push(`/product-comparison/${product.id}?type=noname` as any);
                    }
                  }}
                >
                  <View style={styles.productImageWrapper}>
                    {product.bild ? (
                      <ImageWithShimmer
                        source={{ uri: product.bild }}
                        style={styles.productImageFile}
                        fallbackIcon="photo"
                        fallbackIconSize={24}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.productImagePlaceholder, { backgroundColor: colors.border }]}>
                        <IconSymbol name="photo" size={24} color={colors.icon} />
                      </View>
                    )}
                    
                    {/* Sponsored Badge - nur für erstes Produkt */}
                    {index === 0 && (
                      <View style={styles.sponsoredBadge}>
                        <ThemedText style={styles.sponsoredText}>Sponsored</ThemedText>
                      </View>
                    )}
                    
                    <View style={[styles.levelBadge, { backgroundColor: getStufenColor(parseInt(product.stufe) || 1) }]}>
                      <IconSymbol name="chart.bar" size={10} color="white" />
                      <ThemedText style={styles.levelBadgeText}>Stufe {product.stufe}</ThemedText>
                    </View>
                  </View>
                  <View style={styles.productInfo}>
                    <View style={styles.productTitleContainer}>
                      <ThemedText style={styles.productTitle} numberOfLines={2} ellipsizeMode="tail">{product.name}</ThemedText>
                    </View>
                    <View style={styles.brandPriceRow}>
                      <ThemedText style={styles.productBrand} numberOfLines={1} ellipsizeMode="tail">
                        {handelsmarken[product.id] || 'NoName-Produkt'}
                      </ThemedText>
                      <ThemedText style={[styles.productPrice, { color: colors.primary }]}>{formatPrice(product.preis)}</ThemedText>
                </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
          )}
        </View>

        {/* Neuigkeiten */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Neuigkeiten</ThemedText>
          
          {newsLoading ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 10, paddingRight: 12 }}
            >
              {Array.from({ length: 3 }).map((_, index) => (
                <NewsCardSkeleton key={`news-skeleton-${index}`} />
              ))}
            </ScrollView>
          ) : newsError ? (
            <View style={styles.errorContainer}>
              <ThemedText style={[styles.errorText, { color: colors.error }]}>
                {newsError}
              </ThemedText>
            </View>
          ) : newsPosts.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 10, paddingRight: 12 }}
              onScroll={({ nativeEvent }) => {
                const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
                const isCloseToEnd = layoutMeasurement.width + contentOffset.x >= contentSize.width - 100;
                
                if (isCloseToEnd && newsHasMore && !newsLoadingMore) {
                  loadMoreNews();
                }
              }}
              scrollEventThrottle={400}
            >
                            {newsPosts.map((post) => (
                <NewsCard
                  key={post.id}
                  post={post}
                  onPress={openNewsArticle}
                  style={{ marginLeft: 12, marginRight: 3, width: 280 }}
                />
              ))}
              
              {/* Loading More Indicator */}
              {newsLoadingMore && (
                <View style={[styles.newsLoadingMore, { backgroundColor: colors.cardBackground }]}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <ThemedText style={[styles.newsLoadingText, { color: colors.icon }]}>
                    Lade weitere...
                  </ThemedText>
                </View>
              )}
          </ScrollView>
          ) : (
            <View style={styles.errorContainer}>
              <ThemedText style={[styles.errorText, { color: colors.icon }]}>
                Keine Neuigkeiten verfügbar
              </ThemedText>
            </View>
          )}
        </View>
        
        {/* Extra Spacing for Tab Bar */}
        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/shopping-list')}
      >
        <IconSymbol name="cart.fill" size={20} color="white" />
      </TouchableOpacity>
      
      {/* Search Bottom Sheet */}
      <SearchBottomSheet
        visible={showSearchSheet}
        onClose={() => setShowSearchSheet(false)}
        searchBarY={searchBarPosition.y}
        searchBarHeight={searchBarPosition.height}
        colors={colors}
        onSearch={handleSearch}
      />
      
      {/* Locked Category Modal */}
      {lockedCategoryModal.category && (
        <LockedCategoryModal
          visible={lockedCategoryModal.visible}
          categoryName={lockedCategoryModal.category.bezeichnung}
          categoryImage={lockedCategoryModal.category.bild}
          requiredLevel={lockedCategoryModal.category.requiredLevel || 1}
          currentLevel={userProfile?.stats?.currentLevel || userProfile?.level || 1}
          onClose={() => setLockedCategoryModal({ visible: false, category: null })}
          onNavigateToLevels={() => {
            setLockedCategoryModal({ visible: false, category: null });
            router.push('/achievements' as any);
          }}
        />
      )}
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
    flex: 1,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    flexShrink: 1,
  },
  brandTitle: {
    fontSize: 26,
    fontFamily: 'Nunito_700Bold',
    lineHeight: 30,
    marginTop: 2,
    flexShrink: 1,
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
    paddingBottom: Platform.OS === 'ios' ? 120 : 20, // Platz für TabBar
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
    fontFamily: 'Nunito_400Regular',
  },
  searchPlaceholder: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
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
  categoryImageContainer: {
    position: 'relative',
    width: 20,
    height: 20,
  },
  categoryImage: {
    width: 20,
    height: 20,
    borderRadius: 4,
    resizeMode: 'cover',
  },
  categoryImageLocked: {
    opacity: 0.5,
  },
  categoryLockBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
  },
  levelCard: {
    marginHorizontal: 12,
    padding: 10,
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
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
    marginBottom: 0,
    lineHeight: 18,
  },
  levelSubtitle: {
    fontSize: 11,

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
    marginBottom: 11, // Reduziert von 20 auf 19 (5% weniger)
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
    paddingHorizontal: 10,
  },
  productCard: {
    width: 170, // Reduziert von 180 auf 162 (10% schmäler)
    paddingHorizontal: 11, // Reduziert von 12 auf 11 (ca. 1px weniger)
    paddingBottom: 8, // Reduziert von 12 auf 8
    paddingTop: 0, // Kein Padding oben für vollflächiges Bild
    marginLeft: 12,
     // Reduziert von 3 auf 2 (1px weniger Abstand)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    borderRadius: 16,
    elevation: 2,
    justifyContent: 'flex-start',
    height: 200, // Reduziert von 210 auf 200
  },
  productImageWrapper: {
    marginLeft: -11,  // Übergeht das horizontale Padding (angepasst von -12 auf -11)
    marginRight: -11, // Übergeht das horizontale Padding (angepasst von -12 auf -11)
    marginBottom: 2,
    position: 'relative',
    height: 120,
    overflow: 'hidden',
    borderTopLeftRadius: 16, // Gleich dem Card-Radius
    borderTopRightRadius: 16, // Gleich dem Card-Radius
  },
  productImageFile: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  productImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 16, // Gleich dem Card-Radius
    borderTopRightRadius: 16, // Gleich dem Card-Radius
  },
  levelBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    paddingHorizontal: 6,
    paddingVertical: 0,
    borderRadius: 10,
    backgroundColor: '#42a968',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  levelBadgeText: {
    fontSize: 9,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  productInfo: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 5, // Reduziert von 6 auf 5 (ca. 1px weniger)
    paddingBottom: 6,
  },
  productTitleContainer: {
    height: 36, // Reduziert von 40 auf 36
    justifyContent: 'flex-end', // Text an untere Kante
    marginBottom: 2, // Reduziert von 4 auf 2
  },
  brandPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  productTitle: {
    fontSize: 14, // Reduziert von 16 auf 14 (2 Größen kleiner)
    fontFamily: 'Nunito_700Bold',
    lineHeight: 16, // Angepasst von 18 auf 16
    textAlignVertical: 'bottom',
  },
  productBrand: {
    fontSize: 12,
    opacity: 0.7,
    flex: 2, // Nimmt 2/3 der verfügbaren Breite
    lineHeight: 14,
  },
  productPrice: {
    fontSize: 14, // Reduziert von 20 auf 14 (gleiche Größe wie Titel)
    fontFamily: 'Nunito_700Bold',
    flex: 1, // Nimmt 1/3 der verfügbaren Breite
    textAlign: 'right',
  },
  newsCard: {
    width: 180,
    padding: 12,
    borderRadius: 16,
    alignItems: 'center',
    marginLeft: 12,
    marginRight: 3,
    shadowColor: '#000',           // Shadow Color: schwarz
    shadowOffset: { 
      width: 0,                    // Offset X: 0.0
      height: 2                    // Offset Y: 2.0
    },
    shadowOpacity: 0.09,           // 9% Transparenz (sehr subtil!)
    shadowRadius: 2,               // Blur: 2.0
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
    fontFamily: 'Nunito_500Medium',
    fontWeight: '600', // Angepasst für bessere Lesbarkeit
    textAlign: 'center',
    lineHeight: 16,   // Kompakter wie in Alle Level
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
  loadingContainer: {
    paddingHorizontal: 12,
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,

  },
  errorContainer: {
    paddingHorizontal: 12,
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  newsLoadingMore: {
    width: 120,
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    marginRight: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
  },
  newsLoadingText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    marginTop: 8,
    textAlign: 'center',
  },
  
  // Sponsored Badge - unauffällig oben links
  sponsoredBadge: {
    position: 'absolute',
    top: 5,
    left: 5,
    backgroundColor: 'rgba(0, 0, 0, 0.49)',
    paddingHorizontal: 6,
    paddingVertical: 0,
    borderRadius: 10,
    zIndex: 2,
  },
  sponsoredText: {
    fontSize: 9,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.1,
  },
});
