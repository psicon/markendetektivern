import { IconSymbol } from '@/components/ui/IconSymbol';
import { LocationPicker } from '@/components/ui/LocationPicker';
import { MarketSelector } from '@/components/ui/MarketSelector';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { db, storage } from '@/lib/firebase';
import { Discounter, FirestoreDocument } from '@/lib/types/firestore';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRouter } from 'expo-router';
import { updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface FormData {
  displayName: string;
  realName: string;
  email: string;
  birthDate: Date | null;
  gender: string;
  location: string;
  photoURL: string;
  favoriteMarket: FirestoreDocument<Discounter> | null;
}

export default function EditProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { theme } = useTheme();
  const colors = Colors[theme ?? 'light'];
  const { user, refreshUserProfile } = useAuth();
  
  // Helper function to get country flag emoji (copied from register.tsx)
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
    };
    return flagMap[country] || '🏳️';
  };
  
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showMarketSelector, setShowMarketSelector] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    displayName: user?.displayName || '',
    realName: '',
    email: user?.email || '',
    birthDate: null,
    gender: '',
    location: '',
    photoURL: user?.photoURL || '',
    favoriteMarket: null,
  });

  // Handle save function - defined early to be used in header
  const handleSave = async () => {
    if (!user) return;
    
    if (!formData.displayName.trim()) {
      Alert.alert('Fehler', 'Anzeigename ist ein Pflichtfeld.');
      return;
    }
    
    setLoading(true);
    try {
      // Update Firebase Auth profile
      await updateProfile(user, {
        displayName: formData.displayName,
        photoURL: formData.photoURL,
      });
      
      // Update Firestore user document (using existing schema + new real_name field)
      await updateDoc(doc(db, 'users', user.uid), {
        display_name: formData.displayName,
        real_name: formData.realName,
        photo_url: formData.photoURL,
        birthDate: formData.birthDate,
        gender: formData.gender,
        location: formData.location,
        favoriteMarket: formData.favoriteMarket?.id || null,
        favoriteMarketName: formData.favoriteMarket?.name || null,
        updatedAt: serverTimestamp(),
      });
      
      // Refresh user profile in AuthContext
      await refreshUserProfile();
      
      Alert.alert('Erfolg', 'Profil wurde aktualisiert', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Fehler', 'Profil konnte nicht aktualisiert werden');
    } finally {
      setLoading(false);
    }
  };

  // Set up header
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTitle: 'Profil bearbeiten',
      headerTitleStyle: {
        fontSize: 17,
        fontFamily: 'Nunito_600SemiBold',
        color: '#FFFFFF',
      },
      headerStyle: {
        backgroundColor: colors?.primary || '#42a968',
      },
      headerShadowVisible: false,
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginLeft: 0, paddingLeft: 0 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconSymbol name="chevron.left" size={24} color="#FFFFFF" />
            <Text style={{
              color: '#FFFFFF',
              fontSize: 17,
              fontFamily: 'Nunito_400Regular',
              marginLeft: 4,
            }}>
              Zurück
            </Text>
          </View>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <TouchableOpacity
          onPress={handleSave}
          disabled={loading}
          style={{ 
            marginRight: 0, 
            paddingRight: 0,
            opacity: loading ? 0.6 : 1.0 
          }}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <IconSymbol name="checkmark" size={24} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      ),
      headerBackVisible: false,
    });
  }, [navigation, colors?.primary, router, loading, handleSave]);

  // Load user data from Firestore
  useEffect(() => {
    loadUserData();
  }, [user]);

  const loadUserData = async () => {
    if (!user) return;
    
    try {
      // Load additional user data from Firestore
      const { getDoc } = await import('firebase/firestore');
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        
        // Load favorite market if available
        let favoriteMarketData = null;
        if (data.favoriteMarket && data.favoriteMarketName) {
          // Create market object from stored data
          favoriteMarketData = {
            id: data.favoriteMarket,
            name: data.favoriteMarketName,
            // We'll assume German market if no country info stored
            land: 'Deutschland'
          };
        }
        
        setFormData(prev => ({
          ...prev,
          displayName: data.display_name || user?.displayName || '',
          realName: data.real_name || '',
          birthDate: data.birthDate?.toDate() || null,
          gender: data.gender || '',
          location: data.location || '',
          favoriteMarket: favoriteMarketData,
        }));
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (status !== 'granted') {
      Alert.alert('Berechtigung erforderlich', 'Wir benötigen Zugriff auf deine Fotos, um dein Profilbild zu ändern.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      await uploadImage(result.assets[0].uri);
    }
  };

  const uploadImage = async (uri: string) => {
    if (!user) return;
    
    setUploading(true);
    try {
      // Convert image to blob
      const response = await fetch(uri);
      const blob = await response.blob();
      
      // Upload to Firebase Storage
      const storageRef = ref(storage, `profilePictures/${user.uid}`);
      await uploadBytes(storageRef, blob);
      
      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);
      
      // Update local state
      setFormData(prev => ({ ...prev, photoURL: downloadURL }));
      
      // Update Firebase Auth profile with new photo
      await updateProfile(user, {
        photoURL: downloadURL,
      });
      
      // Refresh user profile to show updated photo immediately
      await refreshUserProfile();
      
      Alert.alert('Erfolg', 'Profilbild wurde aktualisiert');
    } catch (error) {
      console.error('Error uploading image:', error);
      Alert.alert('Fehler', 'Profilbild konnte nicht hochgeladen werden');
    } finally {
      setUploading(false);
    }
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    
    if (event.type === 'set' && selectedDate) {
      setFormData(prev => ({ ...prev, birthDate: selectedDate }));
    }
  };

  // Fallback colors if theme is not loaded yet
  const safeColors = {
    background: colors?.background || '#f5f5f5',
    primary: colors?.primary || '#42a968',
    text: colors?.text || '#000000',
    icon: colors?.icon || '#9ca3af',
    cardBackground: colors?.cardBackground || '#ffffff',
  };

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView 
        style={[styles.container, { backgroundColor: safeColors.background }]}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'android' ? 20 : 0 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Picture Section */}
        <View style={styles.photoSection}>
          <TouchableOpacity 
            onPress={pickImage}
            disabled={uploading}
            style={styles.photoContainer}
          >
            <View style={[styles.avatar, { borderColor: safeColors.primary }]}>
              {formData.photoURL ? (
                <Image source={{ uri: formData.photoURL }} style={styles.avatarImage} />
              ) : (
                <IconSymbol name="person.circle.fill" size={80} color={safeColors.icon} />
              )}
              {uploading && (
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator color="#FFFFFF" />
                </View>
              )}
            </View>
            <Text style={[styles.changePhotoText, { color: safeColors.primary }]}>
              Foto ändern
            </Text>
          </TouchableOpacity>
        </View>

        {/* Form Section */}
        <View style={[styles.formSection, { backgroundColor: safeColors.cardBackground }]}>
          {/* Display Name Field */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: safeColors.text }]}>Anzeigename</Text>
            <View style={[styles.inputContainer, { 
              backgroundColor: theme === 'dark' ? '#2c2c2e' : '#f2f2f7' 
            }]}>
              <TextInput
                style={[styles.inputWithClear, { color: safeColors.text }]}
                value={formData.displayName}
                onChangeText={(text) => setFormData(prev => ({ ...prev, displayName: text }))}
                placeholder="Dein Anzeigename"
                placeholderTextColor={theme === 'dark' ? '#8e8e93' : '#c7c7cc'}
              />
              {formData.displayName.length > 0 && (
                <TouchableOpacity
                  onPress={() => setFormData(prev => ({ ...prev, displayName: '' }))}
                  style={styles.clearButton}
                >
                  <IconSymbol name="xmark.circle.fill" size={20} color={theme === 'dark' ? '#8e8e93' : '#c7c7cc'} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.helperText, { color: theme === 'dark' ? '#8e8e93' : '#6c6c70' }]}>
              Wird für Kommentare und Bewertungen verwendet
            </Text>
          </View>

          {/* Real Name Field */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: safeColors.text }]}>Richtiger Name</Text>
            <View style={[styles.inputContainer, { 
              backgroundColor: theme === 'dark' ? '#2c2c2e' : '#f2f2f7' 
            }]}>
              <TextInput
                style={[styles.inputWithClear, { color: safeColors.text }]}
                value={formData.realName}
                onChangeText={(text) => setFormData(prev => ({ ...prev, realName: text }))}
                placeholder="Dein vollständiger Name"
                placeholderTextColor={theme === 'dark' ? '#8e8e93' : '#c7c7cc'}
              />
              {formData.realName.length > 0 && (
                <TouchableOpacity
                  onPress={() => setFormData(prev => ({ ...prev, realName: '' }))}
                  style={styles.clearButton}
                >
                  <IconSymbol name="xmark.circle.fill" size={20} color={theme === 'dark' ? '#8e8e93' : '#c7c7cc'} />
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.helperText, { color: theme === 'dark' ? '#8e8e93' : '#6c6c70' }]}>
              Für persönliche Daten und Rechnungen
            </Text>
          </View>

          {/* Email Field (Read-only) */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: safeColors.text }]}>E-Mail</Text>
            <View style={[styles.input, styles.readOnlyInput, { 
              backgroundColor: theme === 'dark' ? '#1c1c1e' : '#e5e5ea' 
            }]}>
              <Text style={[styles.readOnlyText, { color: safeColors.text }]}>
                {formData.email}
              </Text>
            </View>
            <Text style={[styles.helperText, { color: theme === 'dark' ? '#8e8e93' : '#6c6c70' }]}>
              E-Mail-Adresse kann nicht geändert werden
            </Text>
          </View>
        </View>

        {/* Optional Fields Section */}
        <View style={[styles.formSection, { backgroundColor: safeColors.cardBackground, marginTop: 20 }]}>
          <Text style={[styles.sectionTitle, { color: safeColors.text }]}>
            Optionale Informationen
          </Text>
          
          {/* Birth Date */}
          <TouchableOpacity 
            style={styles.inputGroup}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={[styles.label, { color: safeColors.text }]}>Geburtsdatum</Text>
            <View style={[styles.input, styles.selectInput, { 
              backgroundColor: theme === 'dark' ? '#2c2c2e' : '#f2f2f7' 
            }]}>
              <Text style={[styles.selectText, { 
                color: formData.birthDate ? safeColors.text : (theme === 'dark' ? '#8e8e93' : '#c7c7cc')
              }]}>
                {formData.birthDate 
                  ? formData.birthDate.toLocaleDateString('de-DE')
                  : 'Datum auswählen'}
              </Text>
              <IconSymbol name="calendar" size={20} color={safeColors.icon} />
            </View>
          </TouchableOpacity>

          {/* Gender */}
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: safeColors.text }]}>Geschlecht</Text>
            <View style={styles.genderContainer}>
              {['Männlich', 'Weiblich', 'Divers'].map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.genderOption,
                    { 
                      backgroundColor: formData.gender === option 
                        ? safeColors.primary 
                        : (theme === 'dark' ? '#2c2c2e' : '#f2f2f7'),
                      borderColor: formData.gender === option 
                        ? safeColors.primary 
                        : (theme === 'dark' ? '#38383a' : '#e5e5ea'),
                    }
                  ]}
                  onPress={() => setFormData(prev => ({ ...prev, gender: option }))}
                >
                  <Text style={[
                    styles.genderText,
                    { 
                      color: formData.gender === option 
                        ? '#FFFFFF' 
                        : safeColors.text 
                    }
                  ]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Location */}
          <TouchableOpacity 
            style={styles.inputGroup}
            onPress={() => setShowLocationPicker(true)}
          >
            <Text style={[styles.label, { color: safeColors.text }]}>Einkaufsort</Text>
            <View style={[styles.input, styles.selectInput, { 
              backgroundColor: theme === 'dark' ? '#2c2c2e' : '#f2f2f7' 
            }]}>
              <Text style={[styles.selectText, { 
                color: formData.location ? safeColors.text : (theme === 'dark' ? '#8e8e93' : '#c7c7cc')
              }]}>
                {formData.location || 'Standort auswählen'}
              </Text>
              <IconSymbol name="location.fill" size={20} color={safeColors.icon} />
            </View>
            <Text style={[styles.helperText, { color: theme === 'dark' ? '#8e8e93' : '#6c6c70' }]}>
              Hilft uns, lokale Angebote und Märkte zu finden
            </Text>
          </TouchableOpacity>

          {/* Favorite Market - Sauber in bestehende Struktur integriert */}
          <TouchableOpacity 
            style={styles.inputGroup}
            onPress={() => setShowMarketSelector(true)}
          >
            <Text style={[styles.label, { color: safeColors.text }]}>Lieblingsmarkt</Text>
            <View style={[styles.input, styles.selectInput, { 
              backgroundColor: theme === 'dark' ? '#2c2c2e' : '#f2f2f7' 
            }]}>
              <Text style={[styles.selectText, { 
                color: formData.favoriteMarket ? safeColors.text : (theme === 'dark' ? '#8e8e93' : '#c7c7cc')
              }]}>
                {formData.favoriteMarket ? 
                  `${getCountryFlag(formData.favoriteMarket.land)} ${formData.favoriteMarket.name}` : 
                  'Markt auswählen'
                }
              </Text>
              <IconSymbol name="storefront" size={20} color={safeColors.icon} />
            </View>
            <Text style={[styles.helperText, { color: theme === 'dark' ? '#8e8e93' : '#6c6c70' }]}>
              Wo kaufst du am häufigsten ein?
            </Text>
          </TouchableOpacity>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: safeColors.primary }]}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.saveButtonText}>Änderungen speichern</Text>
          )}
        </TouchableOpacity>

        {/* Native Date Picker */}
        {showDatePicker && Platform.OS === 'android' && (
          <DateTimePicker
            value={formData.birthDate || new Date(2000, 0, 1)}
            mode="date"
            display="default"
            onChange={onDateChange}
            maximumDate={new Date()}
          />
        )}
        
        {/* iOS Date Picker Modal */}
        {showDatePicker && Platform.OS === 'ios' && (
          <Modal
            animationType="slide"
            transparent={true}
            visible={showDatePicker}
            onRequestClose={() => setShowDatePicker(false)}
          >
            <View style={styles.datePickerModal}>
              <TouchableOpacity 
                style={styles.datePickerBackdrop}
                activeOpacity={1}
                onPress={() => setShowDatePicker(false)}
              />
              <View style={[styles.datePickerContainer, { 
                backgroundColor: theme === 'dark' ? '#1c1c1e' : '#ffffff' 
              }]}>
                <View style={styles.datePickerHeader}>
                  <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                    <Text style={[styles.datePickerButton, { color: colors?.primary }]}>
                      Abbrechen
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                    <Text style={[styles.datePickerButton, { color: colors?.primary }]}>
                      Fertig
                    </Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={formData.birthDate || new Date(2000, 0, 1)}
                  mode="date"
                  display="spinner"
                  onChange={(event, selectedDate) => {
                    if (selectedDate) {
                      setFormData(prev => ({ ...prev, birthDate: selectedDate }));
                    }
                  }}
                  maximumDate={new Date()}
                  textColor={theme === 'dark' ? '#FFFFFF' : '#000000'}
                  locale="de_DE"
                />
              </View>
            </View>
          </Modal>
        )}

        {/* Location Picker Modal */}
        <LocationPicker
          visible={showLocationPicker}
          onClose={() => setShowLocationPicker(false)}
          onSelect={(locationData) => {
            setFormData(prev => ({ ...prev, location: locationData.address }));
            setShowLocationPicker(false);
          }}
          currentLocation={formData.location}
          placeholder="Einkaufsort oder Stadt suchen..."
        />

        {/* Market Selector Modal */}
        <MarketSelector
          visible={showMarketSelector}
          onClose={() => setShowMarketSelector(false)}
          onSelect={(market) => {
            setFormData(prev => ({ ...prev, favoriteMarket: market }));
            console.log(`✅ Favorite market selected: ${market.name} (${market.land})`);
          }}
          selectedMarketId={formData.favoriteMarket?.id}
          title="Lieblingsmarkt wählen"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  photoSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  photoContainer: {
    alignItems: 'center',
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 48,
  },
  changePhotoText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  formSection: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 8,
  },
  input: {
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  inputContainer: {
    height: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  inputWithClear: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  clearButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  readOnlyInput: {
    justifyContent: 'center',
  },
  readOnlyText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  helperText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    marginTop: 4,
  },
  selectInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    flex: 1,
  },
  genderContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  genderOption: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  genderText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
  },
  saveButton: {
    marginHorizontal: 16,
    marginVertical: 24,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  datePickerModal: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  datePickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  datePickerContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
  datePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  datePickerButton: {
    fontSize: 17,
    fontFamily: 'Nunito_600SemiBold',
  },
});