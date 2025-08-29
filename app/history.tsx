import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { ShimmerSkeleton } from '@/components/ui/ShimmerSkeleton';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { searchHistoryService } from '@/lib/services/searchHistoryService';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import PagerView from 'react-native-pager-view';
// import { ScanHistoryItem, scanHistoryService } from '@/lib/services/scanHistoryService';
// TODO: scanHistoryService muss noch implementiert werden
interface ScanHistoryItem {
  id?: string;
  ean: string;
  productId: string;
  productName: string;
  productImage?: string;
  productType: 'noname' | 'markenprodukt';
  brandName?: string;
  brandImage?: string;
  price?: number;
  timestamp?: Date;
}
const scanHistoryService = {
  subscribeToScanHistory: (userId: string, limit: number, callback: (items: ScanHistoryItem[]) => void) => {
    return () => {};
  },
  getRecentScans: async (userId: string, limit: number): Promise<ScanHistoryItem[]> => {
    return [];
  }
};

const { width } = Dimensions.get('window');

// Search History Interface
interface SearchHistoryItem {
  id?: string;
  searchTerm: string;
  timestamp: any;
  resultCount?: number;
}

// Skeleton Loader
const HistorySkeletonLoader = () => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const SkeletonItem = () => (
    <View style={[styles.historyCard, { backgroundColor: colors.cardBackground }]}>
      <View style={styles.historyIconContainer}>
        <ShimmerSkeleton width={40} height={40} borderRadius={20} />
      </View>
      <View style={styles.historyInfo}>
        <ShimmerSkeleton width={150} height={14} borderRadius={4} />
        <ShimmerSkeleton width={100} height={12} borderRadius={3} style={{ marginTop: 4 }} />
      </View>
      <View style={styles.historyTimestamp}>
        <ShimmerSkeleton width={60} height={10} borderRadius={2} />
      </View>
    </View>
  );

  return (
    <View style={styles.skeletonContainer}>
      {Array.from({ length: 8 }, (_, index) => (
        <SkeletonItem key={index} />
      ))}
    </View>
  );
};

export default function HistoryScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const navigation = useNavigation();
  const router = useRouter();
  const { user } = useAuth();
  
  // Tab State
  const [activeTab, setActiveTab] = useState<'search' | 'scan'>('search');
  const pagerRef = useRef<PagerView>(null);
  const tabIndicatorAnimation = useRef(new Animated.Value(0)).current;

  // Data State
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [isLoadingSearch, setIsLoadingSearch] = useState(true);
  const [isLoadingScan, setIsLoadingScan] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Header Setup
  useLayoutEffect(() => {
    navigation.setOptions(getNavigationHeaderOptions(colorScheme, 'Such- & Scanverlauf'));
  }, [colorScheme, navigation]);

  // Load Data
  const loadSearchHistory = useCallback(async () => {
    if (!user?.uid) {
      setIsLoadingSearch(false);
      return;
    }

    try {
      setIsLoadingSearch(true);
      const searches = await searchHistoryService.getRecentSearches(user.uid, 50);
      setSearchHistory(searches);
    } catch (error) {
      console.error('Fehler beim Laden der Suchhistorie:', error);
    } finally {
      setIsLoadingSearch(false);
    }
  }, [user?.uid]);

  const loadScanHistory = useCallback(async () => {
    if (!user?.uid) {
      setIsLoadingScan(false);
      return;
    }

    try {
      setIsLoadingScan(true);
      const scans = await scanHistoryService.getRecentScans(user.uid, 50);
      setScanHistory(scans);
    } catch (error) {
      console.error('Fehler beim Laden der Scanhistorie:', error);
    } finally {
      setIsLoadingScan(false);
    }
  }, [user?.uid]);

  // Focus Effect
  useFocusEffect(
    useCallback(() => {
      loadSearchHistory();
      loadScanHistory();
    }, [loadSearchHistory, loadScanHistory])
  );

  // Refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      loadSearchHistory(),
      loadScanHistory()
    ]);
    setRefreshing(false);
  }, [loadSearchHistory, loadScanHistory]);

  // Tab Change
  const handleTabChange = (tab: 'search' | 'scan') => {
    const pageIndex = tab === 'search' ? 0 : 1;
    setActiveTab(tab);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Animate tab indicator
    Animated.timing(tabIndicatorAnimation, {
      toValue: pageIndex,
      duration: 250,
      useNativeDriver: true,
    }).start();
    
    // Switch page
    pagerRef.current?.setPage(pageIndex);
  };

  // Clear History Functions
  const clearSearchHistory = async () => {
    if (!user?.uid) return;
    try {
      await searchHistoryService.markAllAsDeleted(user.uid);
      setSearchHistory([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Fehler beim Löschen der Suchhistorie:', error);
    }
  };

  const clearScanHistory = async () => {
    if (!user?.uid) return;
    try {
      // TODO: scanHistoryService.markAllAsDeleted implementieren
      setScanHistory([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('Fehler beim Löschen der Scanhistorie:', error);
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return '';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) {
      return 'Gerade eben';
    } else if (diffHours < 24) {
      return `vor ${diffHours}h`;
    } else if (diffDays < 7) {
      return `vor ${diffDays}d`;
    } else {
      return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    }
  };

  // Render Search History Item
  const renderSearchItem = (item: SearchHistoryItem) => (
    <TouchableOpacity
      key={item.id || item.searchTerm}
      style={[styles.historyCard, { backgroundColor: colors.cardBackground }]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push(`/search?query=${encodeURIComponent(item.searchTerm)}`);
      }}
      activeOpacity={0.7}
    >
      <View style={[styles.historyIconContainer, { backgroundColor: colors.primary + '15' }]}>
        <IconSymbol name="magnifyingglass" size={20} color={colors.primary} />
      </View>
      <View style={styles.historyInfo}>
        <Text style={[styles.historyTitle, { color: colors.text }]} numberOfLines={1}>
          {item.searchTerm}
        </Text>
        <Text style={[styles.historySubtitle, { color: colors.icon }]}>
          {item.resultCount ? `${item.resultCount} Ergebnisse` : 'Suchbegriff'}
        </Text>
      </View>
      <View style={styles.historyTimestamp}>
        <Text style={[styles.historyTime, { color: colors.icon }]}>
          {formatTimestamp(item.timestamp)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  // Render Scan History Item
  const renderScanItem = (item: ScanHistoryItem) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.historyCard, { backgroundColor: colors.cardBackground }]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const route = item.productType === 'noname' 
          ? `/product-comparison/${item.productId}?type=noname`
          : `/product-comparison/${item.productId}?type=brand`;
        router.push(route as any);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.historyImageContainer}>
        {item.productImage ? (
          <ImageWithShimmer
            source={{ uri: item.productImage }}
            style={styles.historyImage}
            shimmerStyle={styles.historyImageShimmer}
          />
        ) : (
          <View style={[styles.historyImagePlaceholder, { backgroundColor: colors.background }]}>
            <IconSymbol name="barcode" size={20} color={colors.icon} />
          </View>
        )}
      </View>
      <View style={styles.historyInfo}>
        {/* Brand/Handelsmarke */}
        {item.brandName && (
          <View style={styles.historyBrand}>
            {item.brandImage && (
              <ImageWithShimmer 
                source={{ uri: item.brandImage }} 
                style={styles.historyBrandImage}
                shimmerStyle={styles.historyBrandImageShimmer}
              />
            )}
            <Text style={[styles.historyBrandName, { color: colors.icon }]} numberOfLines={1}>
              {item.brandName}
            </Text>
          </View>
        )}
        <Text style={[styles.historyTitle, { color: colors.text }]} numberOfLines={2}>
          {item.productName}
        </Text>
      </View>
      <View style={styles.historyTimestamp}>
        <Text style={[styles.historyTime, { color: colors.icon }]}>
          {formatTimestamp(item.timestamp)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  // Empty State
  const renderEmptyState = (type: 'search' | 'scan') => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIconContainer, { backgroundColor: colors.background }]}>
        <IconSymbol 
          name={type === 'search' ? "magnifyingglass" : "barcode"} 
          size={48} 
          color={colors.icon} 
        />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        {type === 'search' ? 'Noch keine Suchen' : 'Noch keine Scans'}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.icon }]}>
        {type === 'search' 
          ? 'Deine Suchbegriffe werden hier angezeigt'
          : 'Deine gescannten Produkte werden hier angezeigt'
        }
      </Text>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      {/* Tab Header */}
      <View style={[styles.tabHeader, { backgroundColor: colors.cardBackground, borderBottomColor: colors.border }]}>
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'search' && styles.activeTabButton]}
            onPress={() => handleTabChange('search')}
          >
            <IconSymbol 
              name="magnifyingglass" 
              size={20} 
              color={activeTab === 'search' ? colors.primary : colors.icon} 
            />
            <Text style={[
              styles.tabText, 
              { color: activeTab === 'search' ? colors.primary : colors.icon }
            ]}>
              Suchverlauf
            </Text>
            <View style={styles.tabBadge}>
              <Text style={[styles.tabBadgeText, { color: colors.icon }]}>
                {searchHistory.length}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'scan' && styles.activeTabButton]}
            onPress={() => handleTabChange('scan')}
          >
            <IconSymbol 
              name="barcode" 
              size={20} 
              color={activeTab === 'scan' ? colors.primary : colors.icon} 
            />
            <Text style={[
              styles.tabText, 
              { color: activeTab === 'scan' ? colors.primary : colors.icon }
            ]}>
              Scanverlauf
            </Text>
            <View style={styles.tabBadge}>
              <Text style={[styles.tabBadgeText, { color: colors.icon }]}>
                {scanHistory.length}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Tab Indicator */}
        <Animated.View
          style={[
            styles.tabIndicator,
            { backgroundColor: colors.primary },
            {
              transform: [{
                translateX: tabIndicatorAnimation.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, width / 2]
                })
              }]
            }
          ]}
        />
      </View>

      {/* Content */}
      <PagerView
        ref={pagerRef}
        style={styles.pagerView}
        initialPage={0}
        onPageSelected={(e) => {
          const tab = e.nativeEvent.position === 0 ? 'search' : 'scan';
          if (tab !== activeTab) {
            setActiveTab(tab);
            Animated.timing(tabIndicatorAnimation, {
              toValue: e.nativeEvent.position,
              duration: 250,
              useNativeDriver: true,
            }).start();
          }
        }}
      >
        {/* Search History Tab */}
        <View key="search" style={styles.tabContent}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {/* Clear Button */}
            {searchHistory.length > 0 && (
              <View style={styles.clearContainer}>
                <TouchableOpacity
                  style={[styles.clearButton, { borderColor: colors.border }]}
                  onPress={clearSearchHistory}
                >
                  <IconSymbol name="trash" size={16} color={colors.error} />
                  <Text style={[styles.clearText, { color: colors.error }]}>
                    Suchverlauf löschen
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {isLoadingSearch ? (
              <HistorySkeletonLoader />
            ) : searchHistory.length === 0 ? (
              renderEmptyState('search')
            ) : (
              <View style={styles.historyList}>
                {searchHistory.map(renderSearchItem)}
              </View>
            )}
          </ScrollView>
        </View>

        {/* Scan History Tab */}
        <View key="scan" style={styles.tabContent}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {/* Clear Button */}
            {scanHistory.length > 0 && (
              <View style={styles.clearContainer}>
                <TouchableOpacity
                  style={[styles.clearButton, { borderColor: colors.border }]}
                  onPress={clearScanHistory}
                >
                  <IconSymbol name="trash" size={16} color={colors.error} />
                  <Text style={[styles.clearText, { color: colors.error }]}>
                    Scanverlauf löschen
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {isLoadingScan ? (
              <HistorySkeletonLoader />
            ) : scanHistory.length === 0 ? (
              renderEmptyState('scan')
            ) : (
              <View style={styles.historyList}>
                {scanHistory.map(renderScanItem)}
              </View>
            )}
          </ScrollView>
        </View>
      </PagerView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Tab Header
  tabHeader: {
    paddingTop: 16,
    paddingBottom: 0,
    borderBottomWidth: 1,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  activeTabButton: {
    // Active state handled by colors
  },
  tabText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  tabBadge: {
    backgroundColor: 'transparent',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tabBadgeText: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  tabIndicator: {
    height: 3,
    width: width / 2,
    borderRadius: 1.5,
    marginTop: 8,
  },

  // Content
  pagerView: {
    flex: 1,
  },
  tabContent: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 20,
  },

  // Clear Button
  clearContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 8,
    gap: 6,
  },
  clearText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
  },

  // History List
  historyList: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 12,
    borderRadius: 12,
    gap: 12,
  },
  historyIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyImageContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden',
  },
  historyImage: {
    width: 40,
    height: 40,
  },
  historyImageShimmer: {
    width: 40,
    height: 40,
  },
  historyImagePlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyInfo: {
    flex: 1,
    gap: 2,
  },
  historyBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  historyBrandImage: {
    width: 12,
    height: 12,
  },
  historyBrandImageShimmer: {
    width: 12,
    height: 12,
  },
  historyBrandName: {
    fontSize: 11,
    fontFamily: 'Nunito_500Medium',
  },
  historyTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  historySubtitle: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
  },
  historyTimestamp: {
    alignItems: 'flex-end',
  },
  historyTime: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },

  // Skeleton
  skeletonContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
});
