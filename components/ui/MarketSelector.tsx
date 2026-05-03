import { Colors } from '@/constants/Colors';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { FirestoreService } from '@/lib/services/firestore';
import { Discounter, FirestoreDocument } from '@/lib/types/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Shimmer } from '@/components/design/Skeletons';
import { IconSymbol } from './IconSymbol';
import { ImageWithShimmer } from './ImageWithShimmer';

interface MarketSelectorProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (market: FirestoreDocument<Discounter>) => void;
  selectedMarketId?: string;
  title?: string;
}

export const MarketSelector: React.FC<MarketSelectorProps> = ({
  visible,
  onClose,
  onSelect,
  selectedMarketId,
  title = 'Lieblingsmarkt wählen'
}) => {
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];
  
  const [markets, setMarkets] = useState<FirestoreDocument<Discounter>[]>([]);
  const [loading, setLoading] = useState(true);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [selectedCountry, setSelectedCountry] = useState('Deutschland');
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Helper function to get country flag emoji (copied from explore.tsx)
  const getCountryFlag = (country: string): string => {
    const flagMap: {[key: string]: string} = {
      'Deutschland': '🇩🇪',
      'DE': '🇩🇪',
      'Schweiz': '🇨🇭',
      'CH': '🇨🇭',
      'Österreich': '🇦🇹',
      'AT': '🇦🇹',
      'Austria': '🇦🇹',
      'Switzerland': '🇨🇭',
      'Germany': '🇩🇪',
      'Alle Länder': '🌍',
    };
    
    return flagMap[country] || '🏳️';
  };

  // Normalize country names for filtering (copied from explore.tsx)
  const normalizeCountry = (country: string): string => {
    const countryMap: {[key: string]: string} = {
      'DE': 'Deutschland',
      'Germany': 'Deutschland', 
      'CH': 'Schweiz',
      'Switzerland': 'Schweiz',
      'AT': 'Österreich',
      'Austria': 'Österreich'
    };
    return countryMap[country] || country;
  };

  // Get available countries from markets
  const availableCountries = useMemo(() => {
    const uniqueCountries = new Set(
      markets.map(market => normalizeCountry(market.land))
    );
    return ['Alle Länder', ...Array.from(uniqueCountries).sort()];
  }, [markets]);

  // Filter markets by selected country
  const filteredMarkets = useMemo(() => {
    if (selectedCountry === 'Alle Länder') {
      return markets;
    }
    return markets.filter(market => normalizeCountry(market.land) === selectedCountry);
  }, [markets, selectedCountry]);

  // Handle country selection
  const handleCountrySelect = (country: string) => {
    setSelectedCountry(country);
    setShowFilterModal(false);
  };

  useEffect(() => {
    if (visible) {
      loadMarkets();
    }
  }, [visible]);

  const loadMarkets = async () => {
    try {
      setLoading(true);
      const discounterData = await FirestoreService.getDiscounter();
      
      // Sortiere Märkte alphabetisch nach Name
      const sortedMarkets = discounterData.sort((a, b) => 
        a.name.localeCompare(b.name, 'de')
      );
      
      setMarkets(sortedMarkets);
      console.log(`✅ Loaded ${sortedMarkets.length} markets for selector`);
      
    } catch (error) {
      console.error('Error loading markets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (market: FirestoreDocument<Discounter>) => {
    console.log(`✅ Market selected: ${market.name} (${market.land})`);
    onSelect(market);
    onClose();
  };

  const safeColors = {
    background: colors?.background || '#f5f5f5',
    primary: colors?.primary || '#42a968',
    text: colors?.text || '#000000',
    icon: colors?.icon || '#9ca3af',
    cardBackground: colors?.cardBackground || '#ffffff',
    border: colors?.border || '#e5e7eb',
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: safeColors.background }]} edges={['top', 'bottom']}>
        <StatusBar 
          barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} 
          backgroundColor={safeColors.background}
        />
        
        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onClose} style={styles.closeButtonLeft}>
            <IconSymbol name="xmark" size={24} color={safeColors.icon} />
          </TouchableOpacity>
          <View style={styles.titleSection}>
            <Text style={[styles.bottomSheetTitle, { color: safeColors.text }]}>
              {title}
            </Text>
          </View>
          <View style={styles.spacer} />
        </View>

        {/* Filter Header */}
        <View style={[styles.filterHeader, { backgroundColor: safeColors.cardBackground }]}>
          <TouchableOpacity 
            style={[styles.filterButton, { borderColor: safeColors.border }]}
            onPress={() => setShowFilterModal(true)}
          >
            <Text style={[styles.filterButtonText, { color: safeColors.text }]}>
              {getCountryFlag(selectedCountry)} {selectedCountry}
            </Text>
            <IconSymbol name="chevron.right" size={16} color={safeColors.icon} />
          </TouchableOpacity>
          
          <Text style={[styles.resultsCount, { color: safeColors.icon }]}>
            {filteredMarkets.length} {filteredMarkets.length === 1 ? 'Markt' : 'Märkte'}
          </Text>
        </View>

        {/* Content */}
        {loading ? (
          // Skeleton rows mirror the marketItem layout (48 px logo +
          // name line + country line). Replaces the centered
          // ActivityIndicator so the modal feels like the rest of
          // the app's loading states.
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            scrollEnabled={false}
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <View
                key={i}
                style={[
                  styles.marketItem,
                  {
                    backgroundColor: safeColors.cardBackground,
                    borderColor: safeColors.border,
                    borderWidth: 1,
                  },
                ]}
              >
                <Shimmer width={48} height={48} radius={8} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Shimmer width="60%" height={14} radius={4} />
                  <Shimmer width="40%" height={11} radius={3} />
                </View>
              </View>
            ))}
          </ScrollView>
        ) : (
          <ScrollView 
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {filteredMarkets.map((market) => (
              <TouchableOpacity
                key={market.id}
                style={[styles.marketItem, { 
                  backgroundColor: safeColors.cardBackground,
                  borderColor: selectedMarketId === market.id ? safeColors.primary : safeColors.border,
                  borderWidth: selectedMarketId === market.id ? 2 : 1,
                }]}
                onPress={() => handleSelect(market)}
              >
                <View style={styles.marketImageContainer}>
                  {market.bild && market.bild.trim() !== '' && !failedImages.has(market.id) ? (
                    <ImageWithShimmer
                      source={{ uri: market.bild }}
                      style={styles.marketImage}
                      fallbackIcon="storefront"
                      fallbackIconSize={32}
                      resizeMode="contain"
                      onError={() => {
                        console.log(`Failed to load image for market: ${market.name}`);
                        setFailedImages(prev => new Set([...prev, market.id]));
                      }}
                    />
                  ) : (
                    <View style={[styles.marketImageFallback, { backgroundColor: market.color || safeColors.icon }]}>
                      <IconSymbol name="storefront" size={32} color="white" />
                    </View>
                  )}
                </View>
                
                <View style={styles.marketInfo}>
                  <Text style={[styles.marketName, { color: safeColors.text }]}>
                    {market.name}
                  </Text>
                  <Text style={[styles.marketCountry, { color: safeColors.icon }]}>
                    {getCountryFlag(market.land)} {normalizeCountry(market.land)}
                  </Text>
                </View>
                
                {selectedMarketId === market.id && (
                  <View style={[styles.selectedBadge, { backgroundColor: safeColors.primary }]}>
                    <IconSymbol name="checkmark" size={16} color="white" />
                  </View>
                )}
                
                <IconSymbol name="chevron.right" size={16} color={safeColors.icon} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Country Filter Modal */}
      <Modal
        visible={showFilterModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={[styles.filterModalContainer, { backgroundColor: safeColors.background }]}>
          <View style={[styles.filterModalHeader, { borderBottomColor: safeColors.border }]}>
            <Text style={[styles.filterModalTitle, { color: safeColors.text }]}>Nach Land filtern</Text>
            <TouchableOpacity onPress={() => setShowFilterModal(false)}>
              <IconSymbol name="xmark" size={24} color={safeColors.icon} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.filterOptions}>
            {availableCountries.map((country) => (
              <TouchableOpacity
                key={country}
                style={[styles.filterOption, { 
                  backgroundColor: selectedCountry === country ? safeColors.primary : 'transparent' 
                }]}
                onPress={() => handleCountrySelect(country)}
              >
                <Text style={[styles.filterOptionText, { 
                  color: selectedCountry === country ? 'white' : safeColors.text 
                }]}>
                  {getCountryFlag(country)} {country}
                </Text>
                {selectedCountry === country && (
                  <IconSymbol name="checkmark" size={20} color="white" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
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
  bottomSheetTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
  },
  spacer: {
    width: 40, // Gleiche Breite wie closeButton für Symmetrie
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
  },
  filterButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  resultsCount: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 12,
  },
  marketItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 16,
  },
  marketImageContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
  },
  marketImage: {
    width: 48,
    height: 48,
  },
  marketImageFallback: {
    width: 48,
    height: 48,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  marketInfo: {
    flex: 1,
    gap: 4,
  },
  marketName: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 20,
  },
  marketCountry: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 16,
  },
  selectedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  
  // Filter Modal Styles
  filterModalContainer: {
    flex: 1,
  },
  filterModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  filterModalTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
  },
  filterOptions: {
    flex: 1,
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 0,
  },
  filterOptionText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
});
