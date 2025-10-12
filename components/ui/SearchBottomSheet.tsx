import { useAuth } from '@/lib/contexts/AuthContext';
import searchHistoryService, { PopularSearch, SearchHistoryItem } from '@/lib/services/searchHistoryService';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Keyboard,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconSymbol } from './IconSymbol';
import { ImageWithShimmer } from './ImageWithShimmer';
import { ShimmerSkeleton } from './ShimmerSkeleton';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface SearchBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  searchBarY: number;
  searchBarHeight: number;
  colors: any;
  onSearch: (term: string) => void;
}

export const SearchBottomSheet: React.FC<SearchBottomSheetProps> = ({
  visible,
  onClose,
  searchBarY,
  searchBarHeight,
  colors,
  onSearch,
}) => {
  const router = useRouter();
  const { user } = useAuth();
  const { bottom: insetBottom } = useSafeAreaInsets();
  
  const slideAnim = useRef(new Animated.Value(0)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const contentScale = useRef(new Animated.Value(0.98)).current;
  const panY = useRef(new Animated.Value(0)).current;
  
  // Loading State für bessere UX
  const [isSearching, setIsSearching] = useState(false);
  
  // Minimum Zeichen Warnung
  const [showMinCharWarning, setShowMinCharWarning] = useState(false);
  
  const [recentSearches, setRecentSearches] = useState<SearchHistoryItem[]>([]);
  const [popularSearches, setPopularSearches] = useState<PopularSearch[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [isLoadingPopular, setIsLoadingPopular] = useState(false);
  const [searchText, setSearchText] = useState('');
  
  // TextInput Reference für Keyboard-Management
  const searchInputRef = useRef<TextInput>(null);
  
  // Sheet beginnt DIREKT unter dem Suchfeld, nicht darüber
  const sheetTop = searchBarY + searchBarHeight - 170;
  const sheetHeight = SCREEN_HEIGHT - sheetTop;
  
  // Pan Responder für Swipe-to-dismiss
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        return Math.abs(gestureState.dy) > 5 && gestureState.dy > 0;
      },
      onPanResponderGrant: () => {
        panY.setValue(0);
      },
      onPanResponderMove: (evt, gestureState) => {
        if (gestureState.dy > 0) {
          panY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 100 || gestureState.vy > 0.5) {
          // Schneller Swipe oder weit genug gezogen → Schließen mit Animation
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Keyboard.dismiss();
          handleClose();
        } else {
          // Zurück zur Ursprungsposition
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;
  
  useEffect(() => {
    if (visible) {
      // SOFORT: Animation starten (kein Laden blockiert das UI)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 1,
          damping: 25,
          stiffness: 350,
          mass: 0.7,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(contentScale, {
          toValue: 1,
          damping: 20,
          stiffness: 250,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Nach Animation: Fokussiere das Suchfeld und öffne Tastatur
        setTimeout(() => {
          searchInputRef.current?.focus();
        }, 100);
      });

      // PARALLEL: Daten stufenweise laden (blockiert UI nicht)
      loadRecentSearches();
      loadPopularProducts();
    } else {
      // Reset animations und Tastatur schließen
      slideAnim.setValue(0);
      backdropAnim.setValue(0);
      contentScale.setValue(0.98);
      panY.setValue(0); // Reset pan gesture
      Keyboard.dismiss(); // Tastatur schließen beim Ausblenden
      setSearchText(''); // Suchtext zurücksetzen für nächstes Mal
    }
  }, [visible]);
  
  // Stufenweises Laden für sofortige UX
  const loadRecentSearches = async () => {
    if (!user?.uid) return;
    
    setIsLoadingRecent(true);
    try {
      const recent = await searchHistoryService.getRecentSearches(user.uid, 10);
      setRecentSearches(recent);
    } catch (error) {
      console.error('Fehler beim Laden der Suchhistorie:', error);
    } finally {
      setIsLoadingRecent(false);
    }
  };

  const loadPopularProducts = async () => {
    setIsLoadingPopular(true);
    try {
      const popular = await searchHistoryService.getPopularProducts();
      setPopularSearches(popular);
    } catch (error) {
      console.error('Fehler beim Laden beliebter Produkte:', error);
    } finally {
      setIsLoadingPopular(false);
    }
  };
  
  // Elegant schließen mit Animation
  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(contentScale, {
        toValue: 0.95,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  }, [onClose]);
  
  // Validierung für Mindestzeichen
  const validateAndSearch = useCallback(async (term: string) => {
    const trimmedTerm = term.trim();
    
    if (trimmedTerm.length < 3) {
      // Zeige Warnung
      setShowMinCharWarning(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      
      // Verstecke Warnung nach 3 Sekunden
      setTimeout(() => {
        setShowMinCharWarning(false);
      }, 3000);
      
      return;
    }
    
    // Verstecke Warnung falls sichtbar
    setShowMinCharWarning(false);
    
    // Starte Suche
    await handleSearchTerm(trimmedTerm);
  }, []);
  
  const handleSearchTerm = useCallback(async (term: string) => {
    if (isSearching) return; // Verhindere mehrfache Aufrufe
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Tastatur schließen
    Keyboard.dismiss();
    
    // Zeige Loading State
    setIsSearching(true);
    
    try {
      // Starte Navigation (async)
      await onSearch(term);
      
      // Warte kurz für bessere UX
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Schließe Sheet erst NACH erfolgreicher Navigation
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        onClose();
        setIsSearching(false);
      });
      
    } catch (error) {
      console.error('Search navigation failed:', error);
      setIsSearching(false);
    }
  }, [onSearch, onClose, isSearching]);
  
  const handleDeleteSearchItem = async (itemId: string) => {
    if (!user?.uid || !itemId) return;
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await searchHistoryService.deleteSearchItem(user.uid, itemId);
    
    // Aktualisiere Liste
    const updated = recentSearches.filter(item => item.id !== itemId);
    setRecentSearches(updated);
  };
  
  const handleClearHistory = async () => {
    if (!user?.uid) return;
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await searchHistoryService.markAllAsDeleted(user.uid);
    setRecentSearches([]);
  };
  
  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });
  
  // Render nur wenn visible oder während Animation
  if (!visible) return null;
  
  return (
    <>
      {/* Backdrop */}
      <Animated.View
        style={[
          styles.backdrop,
          {
            opacity: backdropAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.5],
            }),
          },
        ]}
      >
        <TouchableWithoutFeedback onPress={handleClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      </Animated.View>
      
      {/* Bottom Sheet mit Swipe-to-dismiss */}
      <Animated.View
        style={[
          styles.sheet,
          {
            top: sheetTop,
            height: sheetHeight,
            backgroundColor: colors.background,
            transform: [
              { 
                translateY: Animated.add(
                  translateY,
                  panY
                )
              },
              { scale: contentScale },
            ],
            opacity: slideAnim,
          },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Kompakter Header */}
        <View style={[styles.header, { backgroundColor: colors.background }]}>
          {/* Pull Indicator - Interaktiv */}
          <TouchableOpacity 
            style={styles.pullIndicatorArea}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <View style={[styles.pullIndicator, { backgroundColor: colors.icon + '30' }]} />
          </TouchableOpacity>
          
          {/* Search Bar - 1:1 wie Startseite */}
          <View style={styles.searchSection}>
            <View style={[
              styles.searchFieldContainer, 
              { 
                backgroundColor: colors.cardBackground, 
                borderColor: showMinCharWarning ? '#ff3b30' : colors.border,
                borderWidth: showMinCharWarning ? 2 : 1
              }
            ]}>
              <IconSymbol 
                name="magnifyingglass" 
                size={20} 
                color={showMinCharWarning ? '#ff3b30' : colors.icon} 
              />
                          <TextInput
              ref={searchInputRef}
              style={[styles.searchField, { color: colors.text }]}
              placeholder={isSearching ? "Suche läuft..." : "Produkte suchen ..."}
              placeholderTextColor={colors.icon}
              value={searchText}
              onChangeText={setSearchText}
              returnKeyType="search"
              editable={!isSearching}
              onSubmitEditing={(e) => {
                const term = e.nativeEvent.text.trim();
                if (term && !isSearching) {
                  validateAndSearch(term);
                }
              }}
            />
              {isSearching ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : searchText.length > 0 ? (
                <TouchableOpacity onPress={() => setSearchText('')}>
                  <IconSymbol name="xmark.circle.fill" size={18} color={colors.icon + '80'} />
                </TouchableOpacity>
              ) : null}
            </View>
            
            {/* Search Button - 1:1 wie Scanbutton */}
            <TouchableOpacity 
              style={[
                styles.searchButton, 
                { 
                  backgroundColor: colors.cardBackground, 
                  borderColor: colors.border,
                  opacity: isSearching ? 0.6 : 1
                }
              ]}
              onPress={() => {
                const term = searchText.trim();
                if (term && !isSearching) {
                  validateAndSearch(term);
                }
              }}
              disabled={isSearching}
            >
              {isSearching ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <IconSymbol name="magnifyingglass" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
          </View>
          
          {/* Minimum Zeichen Warnung */}
          {showMinCharWarning && (
            <Animated.View 
              style={[styles.warningContainer, { backgroundColor: '#ff3b30' + '15' }]}
              entering={undefined}
            >
              <IconSymbol name="exclamationmark.triangle.fill" size={16} color="#ff3b30" />
              <Text style={[styles.warningText, { color: '#ff3b30' }]}>
                Mindestens 3 Zeichen für die Suche eingeben
              </Text>
            </Animated.View>
          )}
        </View>
        
        {/* Content */}
        <ScrollView
          style={[styles.content, { opacity: isSearching ? 0.5 : 1 }]}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: insetBottom + 20 }
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!isSearching}
        >
          {/* Letzte Suchen - Laden dynamisch */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Zuletzt gesucht
              </Text>
              {recentSearches.length > 0 && (
                <TouchableOpacity onPress={handleClearHistory}>
                  <Text style={[styles.clearButton, { color: colors.primary }]}>
                    Löschen
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            
            {isLoadingRecent ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.loadingText, { color: colors.icon }]}>
                  Lade Geschichte...
                </Text>
              </View>
            ) : recentSearches.length > 0 ? (
              <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentScrollContent}
                style={styles.recentScrollView}
              >
                {recentSearches.slice(0, 10).map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.recentChip, { backgroundColor: colors.cardBackground }]}
                    onPress={() => !isSearching && handleSearchTerm(item.searchTerm)}
                    activeOpacity={isSearching ? 1 : 0.6}
                  >
                    <IconSymbol name="clock" size={14} color={colors.icon} />
                    <Text style={[styles.recentChipText, { color: colors.text }]} numberOfLines={1}>
                      {item.searchTerm}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleDeleteSearchItem(item.id!)}
                      hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                    >
                      <IconSymbol name="xmark.circle" size={14} color={colors.icon + '60'} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <Text style={[styles.emptyText, { color: colors.icon }]}>
                Noch keine Suchen
              </Text>
            )}
          </View>
              
          {/* Best bewertete NoName-Produkte - Laden dynamisch */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Top NoName-Produkte
              </Text>
              <View style={styles.trendingBadge}>
                <IconSymbol name="star.fill" size={12} color="#FFD700" />
                <Text style={[styles.trendingText, { color: colors.text }] }>Top Rated</Text>
              </View>
            </View>
            
            {isLoadingPopular ? (
              <View style={styles.popularGrid}>
                {/* 6 Shimmer-Skeletons für Produktkarten */}
                {[...Array(6)].map((_, index) => (
                  <View key={`skeleton-${index}`} style={[styles.popularCard, { backgroundColor: colors.cardBackground }]}>
                    <ShimmerSkeleton width={24} height={24} borderRadius={6} />
                    <View style={styles.popularInfo}>
                      <ShimmerSkeleton width={100} height={13} borderRadius={4} />
                      <ShimmerSkeleton width={70} height={11} borderRadius={3} style={{ marginTop: 3 }} />
                    </View>
                    <ShimmerSkeleton width={30} height={20} borderRadius={6} />
                  </View>
                ))}
              </View>
            ) : popularSearches.length > 0 ? (
              <View style={styles.popularGrid}>
                {popularSearches.slice(0, 6).map((item, index) => (
                  <TouchableOpacity
                    key={item.id || item.term}
                    style={[styles.popularCard, { backgroundColor: colors.cardBackground }]}
                    onPress={() => {
                      if (item.isRealProduct && item.id) {
                        // Navigiere direkt zum NoName-Produkt
                        Keyboard.dismiss();
                        handleClose();
                        router.push(`/product-comparison/${item.id}?type=noname` as any);
                      } else {
                        // Normale Suche
                        if (!isSearching) {
                          handleSearchTerm(item.term);
                        }
                      }
                    }}
                    activeOpacity={0.6}
                  >
                 
                    
                    {/* Echtes Produktbild oder Emoji-Fallback */}
                    {item.isRealProduct && item.productImage ? (
                      <ImageWithShimmer
                        source={{ uri: item.productImage }}
                        style={styles.popularProductImage}
                        fallbackIcon="cube.box"
                        fallbackIconSize={16}
                        resizeMode="cover"
                      />
                    ) : (
                      <Text style={styles.popularEmoji}>{item.icon}</Text>
                    )}
                    
                    <View style={styles.popularInfo}>
                      <Text style={[styles.popularName, { color: colors.text }]} numberOfLines={1}>
                        {item.productName || item.term}
                      </Text>
                      <Text style={[styles.popularCat, { color: colors.icon }]} numberOfLines={1}>
                        {item.category}
                      </Text>
                    </View>
                    
                    {/* Rating mit Count in Klammern */}
                    {item.isRealProduct && item.averageRating !== undefined && item.averageRating > 0 ? (
                      <View style={styles.ratingBadge}>
                        <IconSymbol name="star.fill" size={9} color="#FFD700" />
                        <View style={styles.ratingInfo}>
                          <Text style={[styles.ratingText, { color: colors.text }]}>
                            {item.averageRating.toFixed(1)}
                          </Text>
                          <Text style={[styles.ratingCount, { color: colors.icon }]}>
                            ({item.count || 0})
                          </Text>
                        </View>
                      </View>
                    ) : (
                      <Text style={[styles.popularRankSmall, { color: colors.primary }]}>
                        #{index + 1}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={[styles.emptyText, { color: colors.icon }]}>
                Lade Top-Produkte...
              </Text>
            )}
          </View>
              
          {/* Quick Actions - Kompakt */}
          <View style={styles.quickActions}>
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: colors.primary + '10' }]}
                  onPress={() => {
                    handleClose();
                    router.push('/barcode-scanner' as any);
                  }}
                >
                  <IconSymbol name="barcode" size={16} color={colors.primary} />
                  <Text style={[styles.quickActionText, { color: colors.primary }]}>
                    Scanner
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.quickAction, { backgroundColor: colors.success + '10' }]}
                  onPress={() => {
                    handleClose();
                    // Navigation zur Stöbern-Seite mit Kategorien-Tab
                    router.push('/(tabs)/explore?tab=Kategorien' as any);
                  }}
                >
                  <IconSymbol name="square.grid.2x2" size={16} color={colors.success} />
                  <Text style={[styles.quickActionText, { color: colors.success }]}>
                    Kategorien
                  </Text>
                </TouchableOpacity>
              </View>
        </ScrollView>
        
        {/* Loading Overlay */}
        {isSearching && (
          <View style={styles.loadingOverlay}>
            <View style={[styles.loadingCard, { backgroundColor: colors.cardBackground }]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.text }]}>
                Suche gestartet...
              </Text>
            </View>
          </View>
        )}
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 998,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 999,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 16,
    overflow: 'hidden',
  },
  header: {
    paddingTop: 8,
    paddingBottom: 12,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  pullIndicatorArea: {
    paddingVertical: 8,
    paddingHorizontal: 40,
    alignItems: 'center',
  },
  pullIndicator: {
    width: 32,
    height: 3,
    borderRadius: 2,
    marginBottom: 4,
  },
  // Search Section - Layout wie Startseite (1pt weniger Padding)
  searchSection: {
    flexDirection: 'row',
    paddingHorizontal: 15, // 1pt weniger für mehr Content-Platz
    gap: 12,
  },
  // Search Container - 1:1 wie Startseite
  searchFieldContainer: {
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
  // Search Input - 1:1 wie Startseite
  searchField: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    paddingVertical: 0,
    ...Platform.select({
      android: {
        textAlignVertical: 'center',
        includeFontPadding: false,
      },
    }),
  },
  // Search Button - 1:1 wie Scanbutton
  searchButton: {
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
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingTop: 4,
    paddingBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 150,
  },
  section: {
    paddingHorizontal: 15, // 1pt weniger für mehr Content-Platz
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
  },
  clearButton: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  // Loading State für "Zuletzt gesucht"
  sectionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
  },
  emptyText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    paddingVertical: 12,
  },
  // Horizontal scrollbare Chips für letzte Suchen
  recentScrollView: {
    marginHorizontal: -15, // Kompensiert section padding
  },
  recentScrollContent: {
    paddingHorizontal: 15,
    gap: 8,
  },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
    minWidth: 80, // Mindestbreite für lesbare Chips
  },
  recentChipText: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
    maxWidth: 120, // Begrenzt sehr lange Suchbegriffe
  },
  // 2-Spalten Grid für beliebte Produkte
  popularGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  popularCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    gap: 10,
    width: '48.5%',
  },
  popularEmoji: {
    fontSize: 20,
  },
  // Echtes Produktbild
  popularProductImage: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  popularInfo: {
    flex: 1,
  },
  popularName: {
    fontSize: 13,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 16,
  },
  popularCat: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 14,
  },
  popularRankSmall: {
    fontSize: 11,
    fontFamily: 'Nunito_700Bold',
  },
  // Rating Badge für echte Produkte
  ratingBadge: {
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 3,
    backgroundColor: 'rgba(255, 215, 0, 0.15)',
    borderRadius: 6,
    minWidth: 32,
  },
  ratingInfo: {
    alignItems: 'center',
    gap: 1,
  },
  ratingText: {
    fontSize: 10,
    fontFamily: 'Nunito_700Bold',
    lineHeight: 11,
  },
  ratingCount: {
    fontSize: 7,
    fontFamily: 'Nunito_500Medium',
    lineHeight: 8,
    opacity: 0.8,
  },
  trendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(255, 215, 0, 0.15)', // Gold für Top Rated
    borderRadius: 8,
  },
  trendingText: {
    fontSize: 11,
    fontFamily: 'Nunito_600SemiBold',
    

  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 15, // 1pt weniger für mehr Content-Platz
    marginTop: 4,
  },
  quickAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 10,
  },
  quickActionText: {
    fontSize: 13,
    fontFamily: 'Nunito_600SemiBold',
  },
  
  // Sponsored Badge für SearchSheet - extra kompakt
  searchSponsoredBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.49)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    zIndex: 3,
  },
  searchSponsoredText: {
    fontSize: 7,
    fontFamily: 'Nunito_600SemiBold',
    color: 'rgba(255,255,255,0.95)',
    letterSpacing: 0.1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.1)',
    zIndex: 1000,
  },
  loadingCard: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'center',
  },
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#ff3b30',
  },
  warningText: {
    marginLeft: 8,
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
  },
});




