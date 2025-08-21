import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { CartToast } from '@/components/ui/CartToast';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { ShimmerSkeleton } from '@/components/ui/ShimmerSkeleton';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usePurchaseHistory } from '@/lib/hooks/usePurchaseHistory';
import { useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: screenWidth } = Dimensions.get('window');

// Skeleton Loader für Kaufhistorie (EXAKT wie Favoriten)
const PurchaseHistorySkeletonLoader = () => {
  const colors = Colors[useColorScheme() ?? 'light'];
  
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Tab Header Skeleton */}
      <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground }]}>
        <View style={[styles.tabHeader, { borderBottomColor: colors.border }]}>
          <ShimmerSkeleton width={100} height={20} borderRadius={4} />
          <ShimmerSkeleton width={100} height={20} borderRadius={4} />
        </View>
      </View>

      {/* Action Bar Skeleton */}
      <View style={[styles.actionBar, { backgroundColor: colors.cardBackground, borderTopColor: colors.border }]}>
        <View style={styles.actionBarContent}>
          <ShimmerSkeleton width={80} height={16} borderRadius={4} />
          <View style={styles.actionBarRight}>
            <ShimmerSkeleton width={120} height={36} borderRadius={18} />
          </View>
        </View>
      </View>

      {/* Product Cards Skeleton */}
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View key={index} style={[styles.productCard, { backgroundColor: colors.cardBackground }]}>
            <View style={styles.productContent}>
              <ShimmerSkeleton width={24} height={24} borderRadius={12} />
              <ShimmerSkeleton width={80} height={80} borderRadius={12} />
              <View style={styles.productInfo}>
                <ShimmerSkeleton width={120} height={16} borderRadius={4} />
                <ShimmerSkeleton width={160} height={20} borderRadius={4} />
                <View style={styles.marketInfo}>
                  <ShimmerSkeleton width={24} height={24} borderRadius={12} />
                  <ShimmerSkeleton width={100} height={14} borderRadius={4} />
                </View>
                <ShimmerSkeleton width={80} height={18} borderRadius={4} />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

export default function PurchaseHistoryScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user, userProfile } = useAuth();
  const { 
    purchases: purchasedProducts, 
    brandPurchases, 
    noNamePurchases, 
    loading, 
    error, 
    totalCount, 
    totalSavings 
  } = usePurchaseHistory();

  // UI State
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  // Filter State
  const [filterModal, setFilterModal] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'price'>('date');
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [availableMarkets, setAvailableMarkets] = useState<any[]>([]);

  // Tab State
  const [activeTab, setActiveTab] = useState(0);
  const [tabIndicatorPosition] = useState(new Animated.Value(0));
  const pagerRef = useRef<PagerView>(null);

  // Toast State
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [toastActionLabel, setToastActionLabel] = useState<string | undefined>(undefined);
  const [toastActionPress, setToastActionPress] = useState<(() => void) | undefined>(undefined);

  // Header Configuration (EXAKT wie Favoriten)
  useLayoutEffect(() => {
    navigation.setOptions({
      ...getNavigationHeaderOptions(colorScheme, 'Kaufhistorie'),
    });
  }, [navigation, colorScheme]);

  // Update loading state based on real data
  useEffect(() => {
    if (!loading && !hasLoadedOnce) {
      setHasLoadedOnce(true);
    }
    if (initialLoading && !loading) {
      setInitialLoading(false);
    }
  }, [loading, hasLoadedOnce, initialLoading]);

  // Extract available markets from purchased products
  useEffect(() => {
    const markets = purchasedProducts
      .filter(item => item.discounter)
      .map(item => item.discounter)
      .filter((market, index, self) => 
        index === self.findIndex(m => m.id === market.id)
      );
    setAvailableMarkets(markets);
  }, [purchasedProducts]);

  // Tab Functions (EXAKT wie Favoriten)
  const handleTabChange = (tabIndex: number) => {
    setActiveTab(tabIndex);
    pagerRef.current?.setPage(tabIndex);
    
    Animated.timing(tabIndicatorPosition, {
      toValue: tabIndex * (screenWidth / 2),
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const handlePageSelected = (event: any) => {
    const position = event.nativeEvent.position;
    setActiveTab(position);
    
    Animated.timing(tabIndicatorPosition, {
      toValue: position * (screenWidth / 2),
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  // Get Current Data based on Active Tab
  const getCurrentPurchases = () => {
    return activeTab === 0 ? brandPurchases : noNamePurchases;
  };

  // Render Product Card (EXAKT wie Favoriten)
  const renderProductCard = (item: any, index: number) => {
    // Eindeutige Key basierend auf ID + Index + purchasedAt für Duplikat-Vermeidung
    const uniqueKey = `${item.id}_${index}_${item.purchasedAt?.getTime() || 'unknown'}`;
    
    return (
      <TouchableOpacity
        key={uniqueKey}
        style={[styles.productCard, { backgroundColor: colors.cardBackground }]}
        onPress={() => {
          // Navigation zur Produktseite - KORREKTE LOGIK basierend auf Stufe
          if (item.type === 'markenprodukt') {
            // Markenprodukte: Immer zu product-comparison
            router.push(`/product-comparison/${item.id}?type=brand` as any);
          } else {
            // NoName-Produkte: Abhängig von Stufe
            const stufe = parseInt(item.stufe || item.originalCartData?.stufe || item.productData?.stufe || '3') || 3;
            if (stufe <= 2) {
              // Stufe 1,2: Zur speziellen NoName-Detailseite
              router.push(`/noname-detail/${item.id}` as any);
            } else {
              // Stufe 3+: Zum normalen Produktvergleich
              router.push(`/product-comparison/${item.id}?type=noname` as any);
            }
          }
        }}
        activeOpacity={0.7}
      >
        <View style={styles.productContent}>
          {/* Gekauft Icon */}
          <View style={styles.purchasedIcon}>
            <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />
          </View>

          {/* Product Image */}
          <ImageWithShimmer
            source={{ uri: item.bild }}
            style={styles.productImage}
            shimmerStyle={styles.productImage}
          />

          {/* Product Info EXAKT wie Favoriten */}
          <View style={styles.productInfo}>
            {/* MARKE mit Logo für Markenprodukte */}
            {item.hersteller?.name && (
              <View style={styles.brandRow}>
                {item.hersteller?.bild && (
                  <ImageWithShimmer
                    source={{ uri: item.hersteller.bild }}
                    style={styles.brandLogo}
                  />
                )}
                <Text style={[styles.brandName, { color: colors.primary }]} numberOfLines={1}>
                  {item.hersteller.name}
                </Text>
              </View>
            )}

            {/* HANDELSMARKE für NoName-Produkte */}
            {item.type === 'noname' && item.handelsmarke?.bezeichnung && (
              <Text style={[styles.brandName, { color: colors.primary }]} numberOfLines={1}>
                {item.handelsmarke.bezeichnung}
              </Text>
            )}

            <Text style={[styles.productName, { color: colors.text }]} numberOfLines={2}>
              {item.name || 'Unbekanntes Produkt'}
            </Text>

            {/* Discounter Info NUR für NoName-Produkte */}
            {item.type === 'noname' && item.discounter && (
              <View style={styles.marketInfo}>
                {item.discounter?.bild ? (
                  <ImageWithShimmer 
                    source={{ uri: item.discounter.bild }} 
                    style={styles.marketLogo} 
                  />
                ) : (
                  <View style={[styles.marketLogo, styles.marketLogoFallback, { backgroundColor: colors.border }]}>
                    <IconSymbol name="storefront" size={8} color={colors.icon} />
                  </View>
                )}
                {userProfile?.favoriteMarket === item.discounter?.id && (
                  <IconSymbol name="heart.fill" size={10} color={colors.primary} style={styles.favoriteMarketIcon} />
                )}
                <Text style={[styles.marketName, { color: colors.icon }]} numberOfLines={1}>
                  {item.discounter?.name || 'Unbekannt'}
                  {item.discounter?.land && ` (${item.discounter.land})`}
                </Text>
              </View>
            )}

            {/* Preis OHNE Ersparnis */}
            <View style={styles.priceRow}>
              <Text style={[styles.productPrice, { color: colors.primary }]}>
                €{item.preis?.toFixed(2) || '0.00'}
              </Text>
            </View>

            {/* Kaufdatum */}
            <Text style={[styles.purchaseDate, { color: colors.icon }]}>
              Gekauft: {item.purchasedAt.toLocaleDateString('de-DE')}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Show initial skeleton loader
  if (initialLoading && !hasLoadedOnce) {
    return <PurchaseHistorySkeletonLoader />;
  }

  // Show Error State
  if (error && !hasLoadedOnce) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.centerContent}>
          <IconSymbol name="exclamationmark.triangle" size={48} color={colors.error} />
          <ThemedText style={styles.errorText}>{error}</ThemedText>
          <TouchableOpacity 
            style={[styles.retryButton, { backgroundColor: colors.primary }]}
            onPress={() => {
              setHasLoadedOnce(false);
              setInitialLoading(true);
            }}
          >
            <ThemedText style={styles.retryButtonText}>Erneut versuchen</ThemedText>
          </TouchableOpacity>
        </View>
      </ThemedView>
    );
  }

  const currentData = getCurrentPurchases();
  const brandCount = brandPurchases.length;
  const noNameCount = noNamePurchases.length;

  return (
    <ThemedView style={styles.container}>
      {/* Tab Container */}
      <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground }]}>
        <View style={[styles.tabHeader, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 0 && { opacity: 1 }]}
            onPress={() => handleTabChange(0)}
          >
            <ThemedText style={[
              styles.tabText, 
              { color: activeTab === 0 ? colors.primary : colors.icon }
            ]}>
              Marken ({brandCount})
            </ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 1 && { opacity: 1 }]}
            onPress={() => handleTabChange(1)}
          >
            <ThemedText style={[
              styles.tabText,
              { color: activeTab === 1 ? colors.primary : colors.icon }
            ]}>
              NoNames ({noNameCount})
            </ThemedText>
          </TouchableOpacity>
        </View>

        {/* Tab Indicator */}
        <Animated.View
          style={[
            styles.tabIndicator,
            { 
              backgroundColor: colors.primary,
              transform: [{ translateX: tabIndicatorPosition }]
            }
          ]}
        />
      </View>

      {/* Content */}
      {totalCount === 0 && hasLoadedOnce ? (
        <View style={styles.centerContent}>
          <IconSymbol name="clock.badge.xmark" size={64} color={colors.icon} />
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>
            Noch keine Käufe
          </ThemedText>
          <ThemedText style={[styles.emptySubtitle, { color: colors.icon }]}>
            Deine gekauften Produkte erscheinen hier nach dem ersten Einkauf
          </ThemedText>
        </View>
      ) : (
        <PagerView
          ref={pagerRef}
          style={styles.pagerView}
          initialPage={0}
          onPageSelected={handlePageSelected}
        >
          {/* Marken Tab */}
          <View key="brands" style={styles.tabPage}>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {brandPurchases.map(renderProductCard)}
            </ScrollView>
          </View>

          {/* NoNames Tab */}
          <View key="nonames" style={styles.tabPage}>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {noNamePurchases.map(renderProductCard)}
            </ScrollView>
          </View>
        </PagerView>
      )}

      {/* Action Bar */}
      <View style={[styles.actionBar, { backgroundColor: colors.cardBackground, borderTopColor: colors.border }]}>
        <View style={styles.actionBarContent}>
          <ThemedText style={[styles.actionBarText, { color: colors.text }]}>
            {currentData.length} von {totalCount} Käufen
          </ThemedText>
          <View style={styles.actionBarRight}>
            <ThemedText style={[styles.actionBarSubText, { color: colors.icon }]}>
              Chronologisch sortiert
            </ThemedText>
          </View>
        </View>
      </View>

      {/* Toast */}
      <CartToast
        visible={showToast}
        message={toastMessage}
        type={toastType}
        onHide={() => setShowToast(false)}
        actionLabel={toastActionLabel}
        onActionPress={toastActionPress}
      />
    </ThemedView>
  );
}

// Styles (EXAKT wie Favoriten mit minimalen Anpassungen)
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tabHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    opacity: 0.6,
  },
  tabText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    width: screenWidth / 2,
    borderRadius: 1.5,
  },
  pagerView: {
    flex: 1,
  },
  tabPage: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 100 : 80,
  },
  productCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  productContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  purchasedIcon: {
    marginTop: 4,
  },
  productImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  productInfo: {
    flex: 1,
    gap: 4,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandLogo: {
    width: 18,
    height: 18,
    borderRadius: 2,
  },
  brandName: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  productName: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 20,
    marginTop: 2,
  },
  marketInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  marketLogo: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  marketLogoFallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoriteMarketIcon: {
    marginLeft: -2,
  },
  marketName: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  productPrice: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  savingsInline: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  purchaseDate: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
    marginTop: 4,
  },
  actionBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  actionBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionBarText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  actionBarRight: {
    alignItems: 'flex-end',
  },
  actionBarSubText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
  },
  savingsInline: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  errorText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  loadingText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    marginTop: 16,
  },
});
