import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { LocationPicker } from '@/components/ui/LocationPicker';
import { MarketSelector } from '@/components/ui/MarketSelector';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { Discounter, FirestoreDocument } from '@/lib/types/firestore';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { signUp, signInWithGoogle, signInWithApple } = useAuth();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  
  // Prüfe ob wir von innerhalb der App kommen (z.B. anonymous user upgrade)
  const canGoBack = params.from === 'app';

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
    };
    
    return flagMap[country] || '🏳️';
  };

  // Normalize country names for display
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

  const [formData, setFormData] = useState({
    username: '',
    realName: '',
    email: '',
    password: '',
    confirmPassword: '',
    birthDate: null as Date | null,
    gender: '',
    location: '',
    favoriteMarket: null as FirestoreDocument<Discounter> | null
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showMarketSelector, setShowMarketSelector] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{[key: string]: boolean}>({});

  const onDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    
    if (event.type === 'set' && selectedDate) {
      setFormData(prev => ({ ...prev, birthDate: selectedDate }));
    }
  };



  const handleRegister = async () => {
    // Reset validation errors
    const errors: {[key: string]: boolean} = {};
    
    // Check required fields
    if (!formData.username.trim()) errors.username = true;
    if (!formData.email.trim()) errors.email = true;
    if (!formData.password) errors.password = true;
    if (!formData.confirmPassword) errors.confirmPassword = true;
    if (!formData.favoriteMarket) errors.favoriteMarket = true; // Lieblingsmarkt ist Pflichtfeld!
    if (!acceptTerms) errors.terms = true;
    
    // Set validation errors
    setValidationErrors(errors);
    
    // If there are any errors, show alert and return
    if (Object.keys(errors).length > 0) {
      Alert.alert('Fehler', 'Bitte fülle alle Pflichtfelder aus.');
      // Scroll to top to show the error fields
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setValidationErrors({ confirmPassword: true });
      Alert.alert('Fehler', 'Die Passwörter stimmen nicht überein.');
      return;
    }

    if (formData.password.length < 6) {
      setValidationErrors({ password: true });
      Alert.alert('Fehler', 'Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }

    setLoading(true);

    try {
      await signUp(formData.email, formData.password, formData.username, {
        realName: formData.realName,
        birthDate: formData.birthDate,
        gender: formData.gender,
        location: formData.location,
        favoriteMarket: formData.favoriteMarket?.id,
        favoriteMarketName: formData.favoriteMarket?.name
      });
      Alert.alert('Erfolg', 'Account erfolgreich erstellt!', [
        { text: 'OK', onPress: () => router.replace('/(tabs)') }
      ]);
    } catch (error: any) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Registration error:', error);
      }
      
      let errorMessage = 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.';
      let errorTitle = 'Registrierung fehlgeschlagen';
      
      // Detaillierte Firebase Auth Error Codes
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorTitle = 'E-Mail bereits vergeben';
          errorMessage = 'Diese E-Mail-Adresse wird bereits verwendet. Bitte verwende eine andere E-Mail-Adresse oder melde dich mit dem bestehenden Account an.';
          break;
        case 'auth/weak-password':
          errorTitle = 'Passwort zu schwach';
          errorMessage = 'Das Passwort muss mindestens 6 Zeichen lang sein. Bitte wähle ein stärkeres Passwort.';
          break;
        case 'auth/invalid-email':
          errorTitle = 'Ungültige E-Mail';
          errorMessage = 'Die eingegebene E-Mail-Adresse ist ungültig. Bitte überprüfe das Format.';
          break;
        case 'auth/operation-not-allowed':
          errorTitle = 'Registrierung deaktiviert';
          errorMessage = 'Die Registrierung ist derzeit deaktiviert. Bitte kontaktiere den Support.';
          break;
        case 'auth/network-request-failed':
          errorTitle = 'Netzwerkfehler';
          errorMessage = 'Keine Internetverbindung. Bitte überprüfe deine Verbindung und versuche es erneut.';
          break;
        default:
          if (__DEV__) {
            errorMessage += `\n\nFehlercode: ${error.code}`;
          }
          break;
      }
      
      Alert.alert(errorTitle, errorMessage, [
        {
          text: 'OK',
          style: 'default'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      await signInWithGoogle();
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      Alert.alert('Google Anmeldung fehlgeschlagen', error.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);
      await signInWithApple();
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Apple Sign-In error:', error);
      Alert.alert('Apple Anmeldung fehlgeschlagen', error.message || 'Ein Fehler ist aufgetreten');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView 
        ref={scrollViewRef}
        style={styles.scrollView} 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
          {canGoBack && (
            <TouchableOpacity 
              style={styles.backButtonWithText}
              onPress={() => router.back()}
            >
              <IconSymbol name="chevron.left" size={20} color={colors.text} />
              <ThemedText style={[styles.backButtonText, { color: colors.text }]}>Zurück</ThemedText>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.content}>
          <View style={styles.titleContainer}>
            <ThemedText style={styles.title}>Jetzt registrieren</ThemedText>
            <ThemedText style={styles.subtitle}>
              und herausfinden, wer dahintersteckt.
            </ThemedText>
          </View>

          {/* Social Login Buttons First - Best Practice! */}
          <View style={styles.socialSection}>
            {Platform.OS === 'ios' && (
              <TouchableOpacity 
                style={[styles.socialButton, styles.appleButton]}
                onPress={handleAppleSignIn}
                disabled={loading}
              >
                <IconSymbol name="apple.logo" size={20} color="white" />
                <ThemedText style={styles.appleButtonText}>Mit Apple registrieren</ThemedText>
              </TouchableOpacity>
            )}
            
            {Platform.OS === 'android' && (
              <TouchableOpacity 
                style={[styles.socialButton, styles.googleButton]}
                onPress={handleGoogleSignIn}
                disabled={loading}
              >
                <View style={styles.googleIconContainer}>
                  <IconSymbol name="g.circle.fill" size={20} color="#4285f4" />
                </View>
                <ThemedText style={styles.googleButtonText}>Mit Google registrieren</ThemedText>
              </TouchableOpacity>
            )}

            {/* Or Divider */}
            <View style={styles.dividerContainer}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <ThemedText style={[styles.dividerText, { color: colors.icon }]}>oder mit E-Mail Adresse registrieren:</ThemedText>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Username with Clear Button */}
            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Anzeigename *</ThemedText>
              <View style={[styles.inputWithClearContainer, { 
                borderColor: validationErrors.username ? '#FF3B30' : colors.border, 
                backgroundColor: colors.cardBackground,
                borderWidth: validationErrors.username ? 2 : 1
              }]}>
                <TextInput
                  style={[styles.inputWithClear, { color: colors.text }]}
                  placeholder="Dein Anzeigename"
                  placeholderTextColor={colors.icon}
                  value={formData.username}
                  onChangeText={(text) => {
                    setFormData(prev => ({ ...prev, username: text }));
                    if (validationErrors.username) {
                      setValidationErrors(prev => ({ ...prev, username: false }));
                    }
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {formData.username.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setFormData(prev => ({ ...prev, username: '' }))}
                    style={styles.clearButton}
                  >
                    <IconSymbol name="xmark.circle.fill" size={20} color={colors.icon} />
                  </TouchableOpacity>
                )}
              </View>
              {validationErrors.username ? (
                <ThemedText style={[styles.errorText, { color: '#FF3B30' }]}>
                  Pflichtfeld - bitte ausfüllen
                </ThemedText>
              ) : (
                <ThemedText style={[styles.helperText, { color: colors.icon }]}>
                  Wird für Kommentare und Bewertungen verwendet
                </ThemedText>
              )}
            </View>

            {/* Real Name with Clear Button */}
            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Richtiger Name</ThemedText>
              <View style={[styles.inputWithClearContainer, { 
                borderColor: colors.border, 
                backgroundColor: colors.cardBackground 
              }]}>
                <TextInput
                  style={[styles.inputWithClear, { color: colors.text }]}
                  placeholder="Dein vollständiger Name"
                  placeholderTextColor={colors.icon}
                  value={formData.realName}
                  onChangeText={(text) => setFormData(prev => ({ ...prev, realName: text }))}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
                {formData.realName.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setFormData(prev => ({ ...prev, realName: '' }))}
                    style={styles.clearButton}
                  >
                    <IconSymbol name="xmark.circle.fill" size={20} color={colors.icon} />
                  </TouchableOpacity>
                )}
              </View>
              <ThemedText style={[styles.helperText, { color: colors.icon }]}>
                Für persönliche Daten und Rechnungen
              </ThemedText>
            </View>

            {/* Email */}
            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>E-Mail *</ThemedText>
              <TextInput
                style={[styles.input, { 
                  borderColor: validationErrors.email ? '#FF3B30' : colors.border, 
                  backgroundColor: colors.cardBackground,
                  color: colors.text,
                  borderWidth: validationErrors.email ? 2 : 1
                }]}
                placeholder="deine@email.de"
                placeholderTextColor={colors.icon}
                value={formData.email}
                onChangeText={(text) => {
                  setFormData(prev => ({ ...prev, email: text }));
                  if (validationErrors.email) {
                    setValidationErrors(prev => ({ ...prev, email: false }));
                  }
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {validationErrors.email && (
                <ThemedText style={[styles.errorText, { color: '#FF3B30' }]}>
                  Pflichtfeld - bitte ausfüllen
                </ThemedText>
              )}
            </View>

            {/* Password */}
            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Passwort *</ThemedText>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[styles.passwordInput, { 
                    borderColor: validationErrors.password ? '#FF3B30' : colors.border, 
                    backgroundColor: colors.cardBackground,
                    color: colors.text,
                    borderWidth: validationErrors.password ? 2 : 1
                  }]}
                  placeholder="Mindestens 6 Zeichen"
                  placeholderTextColor={colors.icon}
                  value={formData.password}
                  onChangeText={(text) => {
                    setFormData(prev => ({ ...prev, password: text }));
                    if (validationErrors.password) {
                      setValidationErrors(prev => ({ ...prev, password: false }));
                    }
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <IconSymbol 
                    name={showPassword ? "eye.slash" : "eye"} 
                    size={20} 
                    color={colors.icon} 
                  />
                </TouchableOpacity>
              </View>
              {validationErrors.password && (
                <ThemedText style={[styles.errorText, { color: '#FF3B30' }]}>
                  Pflichtfeld - mindestens 6 Zeichen
                </ThemedText>
              )}
            </View>

            {/* Confirm Password */}
            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Passwort bestätigen *</ThemedText>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[styles.passwordInput, { 
                    borderColor: validationErrors.confirmPassword ? '#FF3B30' : colors.border, 
                    backgroundColor: colors.cardBackground,
                    color: colors.text,
                    borderWidth: validationErrors.confirmPassword ? 2 : 1
                  }]}
                  placeholder="Passwort wiederholen"
                  placeholderTextColor={colors.icon}
                  value={formData.confirmPassword}
                  onChangeText={(text) => {
                    setFormData(prev => ({ ...prev, confirmPassword: text }));
                    if (validationErrors.confirmPassword) {
                      setValidationErrors(prev => ({ ...prev, confirmPassword: false }));
                    }
                  }}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  <IconSymbol 
                    name={showConfirmPassword ? "eye.slash" : "eye"} 
                    size={20} 
                    color={colors.icon} 
                  />
                </TouchableOpacity>
              </View>
              {validationErrors.confirmPassword && (
                <ThemedText style={[styles.errorText, { color: '#FF3B30' }]}>
                  Passwörter stimmen nicht überein
                </ThemedText>
              )}
            </View>

            {/* Optional Section Header */}
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>Optionale Informationen</ThemedText>
              <ThemedText style={[styles.sectionSubtitle, { color: colors.icon }]}>
                Du kannst diese auch später in deinem Profil hinzufügen
              </ThemedText>
            </View>

            {/* Birth Date */}
            <TouchableOpacity 
              style={styles.inputContainer}
              onPress={() => setShowDatePicker(true)}
            >
              <ThemedText style={styles.label}>Geburtsdatum</ThemedText>
              <View style={[styles.selectInput, { 
                borderColor: colors.border, 
                backgroundColor: colors.cardBackground 
              }]}>
                <Text style={[styles.selectText, { 
                  color: formData.birthDate ? colors.text : colors.icon
                }]}>
                  {formData.birthDate 
                    ? formData.birthDate.toLocaleDateString('de-DE')
                    : 'Datum auswählen'}
                </Text>
                <IconSymbol name="calendar" size={20} color={colors.icon} />
              </View>
            </TouchableOpacity>

            {/* Gender */}
            <View style={styles.inputContainer}>
              <ThemedText style={styles.label}>Geschlecht</ThemedText>
              <View style={styles.genderContainer}>
                {['Männlich', 'Weiblich', 'Divers'].map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.genderOption,
                      { 
                        backgroundColor: formData.gender === option 
                          ? colors.primary 
                          : colors.cardBackground,
                        borderColor: formData.gender === option 
                          ? colors.primary 
                          : colors.border,
                      }
                    ]}
                    onPress={() => setFormData(prev => ({ ...prev, gender: option }))}
                  >
                    <Text style={[
                      styles.genderText,
                      { 
                        color: formData.gender === option 
                          ? '#FFFFFF' 
                          : colors.text 
                      }
                    ]}>
                      {option}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Location */}
            {/* Favorite Market Field - REQUIRED */}
            <TouchableOpacity 
              style={styles.inputContainer}
              onPress={() => {
                setShowMarketSelector(true);
                // Clear validation error when user starts interacting
                if (validationErrors.favoriteMarket) {
                  setValidationErrors(prev => ({ ...prev, favoriteMarket: false }));
                }
              }}
            >
              <ThemedText style={styles.label}>Lieblingsmarkt *</ThemedText>
              <View style={[styles.selectInput, { 
                borderColor: validationErrors.favoriteMarket ? '#ff3b30' : colors.border,
                borderWidth: validationErrors.favoriteMarket ? 2 : 1,
                backgroundColor: colors.cardBackground 
              }]}>
                <Text style={[styles.selectText, { 
                  color: formData.favoriteMarket ? colors.text : colors.icon
                }]}>
                  {formData.favoriteMarket ? 
                    `${formData.favoriteMarket.name} ${getCountryFlag(formData.favoriteMarket.land)} ${normalizeCountry(formData.favoriteMarket.land)}` : 
                    'Markt auswählen'
                  }
                </Text>
                <IconSymbol name="storefront" size={20} color={colors.icon} />
              </View>
              {validationErrors.favoriteMarket && (
                <ThemedText style={[styles.errorText, { color: '#ff3b30' }]}>
                  Bitte wähle deinen Lieblingsmarkt aus
                </ThemedText>
              )}
              <ThemedText style={[styles.helperText, { color: colors.icon }]}>
                Wo kaufst du am häufigsten ein?
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.inputContainer}
              onPress={() => setShowLocationPicker(true)}
            >
              <ThemedText style={styles.label}>Einkaufsort</ThemedText>
              <View style={[styles.selectInput, { 
                borderColor: colors.border, 
                backgroundColor: colors.cardBackground 
              }]}>
                <Text style={[styles.selectText, { 
                  color: formData.location ? colors.text : colors.icon
                }]}>
                  {formData.location || 'Standort auswählen'}
                </Text>
                <IconSymbol name="location.fill" size={20} color={colors.icon} />
              </View>
              <ThemedText style={[styles.helperText, { color: colors.icon }]}>
                Hilft uns, lokale Angebote und Märkte zu finden
              </ThemedText>
            </TouchableOpacity>

            {/* Terms Checkbox */}
            <TouchableOpacity 
              style={styles.checkboxContainer}
              onPress={() => {
                setAcceptTerms(!acceptTerms);
                if (validationErrors.terms) {
                  setValidationErrors(prev => ({ ...prev, terms: false }));
                }
              }}
            >
              <View style={[
                styles.checkbox, 
                { 
                  borderColor: validationErrors.terms ? '#FF3B30' : colors.border,
                  borderWidth: validationErrors.terms ? 2 : 2
                },
                acceptTerms && { backgroundColor: colors.primary, borderColor: colors.primary }
              ]}>
                {acceptTerms && (
                  <IconSymbol name="checkmark" size={14} color="white" />
                )}
              </View>
              <ThemedText style={[
                styles.checkboxText,
                validationErrors.terms && { color: '#FF3B30' }
              ]}>
                Ich akzeptiere AGB und Nutzungsbestimmungen *
              </ThemedText>
            </TouchableOpacity>
            {validationErrors.terms && (
              <ThemedText style={[styles.errorText, { color: '#FF3B30', marginTop: -10, marginBottom: 10 }]}>
                Bitte akzeptiere die AGB und Nutzungsbestimmungen
              </ThemedText>
            )}

            {/* Register Button */}
            <TouchableOpacity 
              style={[
                styles.registerButton, 
                { backgroundColor: colors.primary },
                loading && { opacity: 0.7 }
              ]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <ThemedText style={styles.registerButtonText}>Benutzer erstellen</ThemedText>
              )}
            </TouchableOpacity>

            
            
            {/* Bottom Spacing */}
            <View style={{ height: 40 }} />
          </View>
        </View>
      </ScrollView>

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
              backgroundColor: colorScheme === 'dark' ? '#1c1c1e' : '#ffffff' 
            }]}>
              <View style={styles.datePickerHeader}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={[styles.datePickerButton, { color: colors.primary }]}>
                    Abbrechen
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={[styles.datePickerButton, { color: colors.primary }]}>
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
                textColor={colorScheme === 'dark' ? '#FFFFFF' : '#000000'}
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -10,
  },
  backButtonWithText: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginLeft: -12,
    borderRadius: 20,
    gap: 6,
  },
  backButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  titleContainer: {
    marginBottom: 30,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 8,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.7,
    lineHeight: 22,
  },
  socialSection: {
    marginBottom: 30,
    gap: 16,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 12,
    borderWidth: 1,
  },
  appleButton: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  appleButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  googleButton: {
    backgroundColor: 'white',
    borderColor: '#dadce0',
  },
  googleIconContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleButtonText: {
    color: '#3c4043',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    gap: 16,
  },
  dividerLine: {
    flex: 1,
    marginBottom: 20,
    marginTop: 20,
    height: 1,
  },
  dividerText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    marginBottom: 20,
    marginTop: 20,
  },
  form: {
    gap: 20,
  },
  inputContainer: {
    // marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 8,
  },
  helperText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  inputWithClearContainer: {
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  inputWithClear: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  clearButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingRight: 50,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  eyeButton: {
    position: 'absolute',
    right: 16,
    top: 18,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    flex: 1,
  },
  registerButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  registerButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  socialSection: {
    width: '100%',
    alignItems: 'center',
    marginTop: 30,
    gap: 16,
  },
  orText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.7,
    marginBottom: 4,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: 'white',
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  socialButtonDark: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#000',
    gap: 12,
  },
  googleIconContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  googleIcon: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: '#4285F4',
    textAlign: 'center',
  },
  socialButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: '#333',
  },
  socialButtonTextDark: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  selectInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
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
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  genderText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
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
