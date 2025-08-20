import { Colors } from '@/constants/Colors';
import { useTheme } from '@/lib/contexts/ThemeContext';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Modal,
    Platform,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IconSymbol } from './IconSymbol';

interface LocationData {
  address: string;
  latitude: number;
  longitude: number;
  city?: string;
  country?: string;
}

interface LocationPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (location: LocationData) => void;
  currentLocation?: string;
  placeholder?: string;
}

export const LocationPicker: React.FC<LocationPickerProps> = ({
  visible,
  onClose,
  onSelect,
  currentLocation,
  placeholder = 'Standort suchen...'
}) => {
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];
  
  const [region, setRegion] = useState<Region>({
    latitude: 48.1351, // München
    longitude: 11.5820,
    latitudeDelta: 0.5, // Zoom auf München und Umgebung
    longitudeDelta: 0.5,
  });
  
  const [markerPosition, setMarkerPosition] = useState({
    latitude: 48.1351, // München
    longitude: 11.5820,
  });
  
  const [searchText, setSearchText] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(null);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (visible) {
      requestLocationPermission();
      
      // Wenn bereits ein Ort gesetzt ist, lade ihn
      if (currentLocation) {
        setSearchText(currentLocation);
        setSelectedAddress(currentLocation);
        // Versuche den aktuellen Ort zu geocodieren und zu zentrieren
        searchLocation(currentLocation);
      } else {
        // Reset auf München Standard wenn kein Ort gesetzt
        setSearchText('');
        setSelectedAddress('');
        setRegion({
          latitude: 48.1351, // München
          longitude: 11.5820,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        });
        setMarkerPosition({
          latitude: 48.1351,
          longitude: 11.5820,
        });
      }
    }
  }, [visible, currentLocation]);

  // Live search with debouncing
  const handleSearchTextChange = (text: string) => {
    setSearchText(text);
    
    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Set new timeout for debounced search
    if (text.trim().length > 2) {
      const timeout = setTimeout(() => {
        searchLocation(text);
      }, 800); // 800ms delay
      setSearchTimeout(timeout);
    }
  };

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status === 'granted');
      
      if (status === 'granted') {
        getCurrentLocation();
      }
    } catch (error) {
      console.error('Error requesting location permission:', error);
      setLocationPermission(false);
    }
  };

  const getCurrentLocation = async () => {
    try {
      setLoading(true);
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      
      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      };
      
      setRegion(newRegion);
      setMarkerPosition({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      
      // Get address for current position
      await reverseGeocode(location.coords.latitude, location.coords.longitude);
    } catch (error) {
      console.error('Error getting current location:', error);
    } finally {
      setLoading(false);
    }
  };

  const reverseGeocode = async (latitude: number, longitude: number) => {
    try {
      const addresses = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });
      
      if (addresses.length > 0) {
        const address = addresses[0];
        const formattedAddress = [
          address.street,
          address.city,
          address.country
        ].filter(Boolean).join(', ');
        
        setSelectedAddress(formattedAddress);
      }
    } catch (error) {
      console.error('Error reverse geocoding:', error);
    }
  };

  const searchLocation = async (text: string) => {
    if (!text.trim()) return;
    
    try {
      setLoading(true);
      
      // Erweitere Suche um DACH-spezifische Begriffe
      const searchTerms = [
        text, // Original
        `${text}, Deutschland`,
        `${text}, Österreich`,
        `${text}, Schweiz`,
      ];
      
      let bestLocation = null;
      
      // Durchsuche alle Varianten und bevorzuge DACH-Region
      for (const searchTerm of searchTerms) {
        try {
          const geocoded = await Location.geocodeAsync(searchTerm);
          
          if (geocoded.length > 0) {
            const location = geocoded[0];
            
            // Prüfe ob in DACH-Region (Europa, grob)
            const isInDACH = 
              location.latitude >= 45.5 && location.latitude <= 55.5 && // Breitengrad
              location.longitude >= 5.5 && location.longitude <= 17.5;   // Längengrad
            
            if (isInDACH || !bestLocation) {
              bestLocation = location;
              if (isInDACH) break; // DACH-Treffer bevorzugen
            }
          }
        } catch (error) {
          continue; // Nächsten Suchterm versuchen
        }
      }
      
      if (bestLocation) {
        const newRegion = {
          latitude: bestLocation.latitude,
          longitude: bestLocation.longitude,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        };
        
        setRegion(newRegion);
        setMarkerPosition({
          latitude: bestLocation.latitude,
          longitude: bestLocation.longitude,
        });
        
        await reverseGeocode(bestLocation.latitude, bestLocation.longitude);
      }
    } catch (error) {
      console.error('Error geocoding:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleMapPress = async (event: any) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    
    setMarkerPosition({ latitude, longitude });
    await reverseGeocode(latitude, longitude);
  };

  const handleSelectLocation = () => {
    if (selectedAddress) {
      onSelect({
        address: selectedAddress,
        latitude: markerPosition.latitude,
        longitude: markerPosition.longitude,
      });
      onClose();
    }
  };

  const safeColors = {
    background: colors?.background || '#f5f5f5',
    primary: colors?.primary || '#42a968',
    text: colors?.text || '#000000',
    icon: colors?.icon || '#9ca3af',
    cardBackground: colors?.cardBackground || '#ffffff',
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
        {/* Bottom Sheet Handle - nur für iOS */}
        {Platform.OS === 'ios' && (
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>
        )}

        {/* Header */}
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onClose} style={styles.closeButtonLeft}>
            <IconSymbol name="xmark" size={24} color={safeColors.icon} />
          </TouchableOpacity>
          <View style={styles.titleSection}>
            <Text style={[styles.bottomSheetTitle, { color: safeColors.text }]}>
              Einkaufsort wählen
            </Text>
          </View>
          <TouchableOpacity 
            onPress={handleSelectLocation}
            disabled={!selectedAddress}
            style={[styles.selectButton, { opacity: selectedAddress ? 1 : 0.5 }]}
          >
            <Text style={[styles.selectButtonText, { color: safeColors.primary }]}>
              Wählen
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: safeColors.cardBackground }]}>
          <IconSymbol name="magnifyingglass" size={20} color={safeColors.icon} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: safeColors.text }]}
            placeholder={placeholder}
            placeholderTextColor={theme === 'dark' ? '#8e8e93' : '#c7c7cc'}
            value={searchText}
            onChangeText={handleSearchTextChange}
            returnKeyType="done"
            autoCapitalize="words"
            autoCorrect={false}
          />
          {searchText.length > 0 && !loading && (
            <TouchableOpacity
              onPress={() => {
                setSearchText('');
                setSelectedAddress('');
                // Reset auf München Standard
                setRegion({
                  latitude: 48.1351,
                  longitude: 11.5820,
                  latitudeDelta: 0.5,
                  longitudeDelta: 0.5,
                });
                setMarkerPosition({
                  latitude: 48.1351,
                  longitude: 11.5820,
                });
              }}
              style={styles.searchClearButton}
            >
              <IconSymbol name="xmark.circle.fill" size={20} color={theme === 'dark' ? '#8e8e93' : '#c7c7cc'} />
            </TouchableOpacity>
          )}
          {loading && (
            <ActivityIndicator size="small" color={safeColors.primary} style={styles.searchLoader} />
          )}
        </View>

        {/* Current Location Button */}
        {locationPermission && (
          <TouchableOpacity
            onPress={getCurrentLocation}
            style={[styles.currentLocationButton, { backgroundColor: safeColors.cardBackground }]}
          >
            <IconSymbol name="location.fill" size={22} color={safeColors.primary} />
            <Text style={[styles.currentLocationText, { color: safeColors.text }]}>
              Mein aktueller Standort
            </Text>
          </TouchableOpacity>
        )}

        {/* Helper Text */}
        <View style={styles.helperContainer}>
          <Text style={[styles.helperText, { color: safeColors.icon }]}>
            💡 Tippe auf die Karte oder gib eine Stadt ein - die Suche erfolgt automatisch
          </Text>
        </View>

        {/* Map */}
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            region={region}
            onPress={handleMapPress}
            showsUserLocation={locationPermission === true}
            showsMyLocationButton={false}
            provider={Platform.OS === 'android' ? 'google' : undefined}
          >
            <Marker
              coordinate={markerPosition}
              title="Dein Einkaufsort"
              description={selectedAddress}
              pinColor={safeColors.primary}
            />
          </MapView>
        </View>

        {/* Selected Address Display - under the map */}
        {selectedAddress ? (
          <View style={[styles.addressOverlay, { backgroundColor: safeColors.cardBackground }]}>
            <View style={styles.addressContent}>
              <IconSymbol name="mappin.circle.fill" size={28} color={safeColors.primary} />
              <Text style={[styles.addressText, { color: safeColors.text }]}>
                {selectedAddress}
              </Text>
            </View>
          </View>
        ) : (
          // Platzhalter für Layout-Konsistenz
          <View style={styles.addressPlaceholder} />
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative', // Für absolute positioning der Address-Card
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
    paddingVertical: 12,
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
  selectButton: {
    padding: 8,
  },
  selectButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 20,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 17,
    fontFamily: 'Nunito_500Medium',
    paddingVertical: 12,
  },
  searchLoader: {
    marginLeft: 8,
  },
  searchClearButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  currentLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    borderRadius: 16,
  },
  currentLocationText: {
    marginLeft: 12,
    fontSize: 17,
    fontFamily: 'Nunito_600SemiBold',
  },
  helperContainer: {
    marginHorizontal: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(66, 169, 104, 0.1)',
  },
  helperText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    textAlign: 'center',
    lineHeight: 18,
  },
  mapContainer: {
    flex: 1,
    marginHorizontal: 20,
    marginBottom: Platform.OS === 'ios' ? -60 : 10, // Kein Overlap auf Android
    borderRadius: 20,
    overflow: 'hidden', // Wichtig für Android
    elevation: Platform.OS === 'android' ? 5 : 10,
    zIndex: Platform.OS === 'ios' ? 10 : 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  map: {
    flex: 1,
    borderRadius: Platform.OS === 'ios' ? 20 : 0, // Android hat Probleme mit borderRadius bei MapView
  },
  addressOverlay: {
    marginHorizontal: 20,
    marginBottom: 30,
    borderRadius: 20,
    elevation: Platform.OS === 'android' ? 3 : 2,
    zIndex: Platform.OS === 'ios' ? 2 : 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  addressContent: {
    flexDirection: 'row',
    alignItems: Platform.OS === 'ios' ? 'flex-end' : 'center',
    padding: Platform.OS === 'ios' ? 24 : 20,
    paddingTop: Platform.OS === 'ios' ? 70 : 20, // Weniger Platz oben auf Android
    paddingBottom: Platform.OS === 'ios' ? 24 : 20,
    minHeight: Platform.OS === 'ios' ? 130 : 90, // Kleinere Höhe auf Android
  },
  addressText: {
    marginLeft: 16,
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    flex: 1,
    lineHeight: 24,
  },
  addressPlaceholder: {
    height: Platform.OS === 'ios' ? 130 : 90, // Gleiche Höhe wie addressContent
    marginHorizontal: 20,
    marginBottom: 30,
  },
});
