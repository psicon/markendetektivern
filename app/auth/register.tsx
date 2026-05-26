import { ThemedText } from '@/components/ThemedText';
import { AuthMethodButtons } from '@/components/auth/AuthMethodButtons';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LocationPicker } from '@/components/ui/LocationPicker';
import { MarketSelector } from '@/components/ui/MarketSelector';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { OnboardingService } from '@/lib/services/onboardingService';
import { GENDER_PILL_OPTIONS, normalizeLegacyGender, type Gender } from '@/lib/types/gender';
import { approximateBirthDateFromAge } from '@/lib/utils/age';
import {
  showInfoToast,
  showRetryableErrorToast,
} from '@/lib/services/ui/toast';
import { Discounter, FirestoreDocument } from '@/lib/types/firestore';
import { isExpoGo } from '@/lib/utils/platform';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    Dimensions,
    ImageBackground,
    KeyboardAvoidingView,
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
  const { signUp, signInWithGoogle, signInWithApple, user, userProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const screenHeight = Dimensions.get('window').height;
  const isSmallDevice = screenHeight < 700;
  
  // Image loading state and animation
  const [imageLoaded, setImageLoaded] = useState(false);
  const fadeAnim = useState(new Animated.Value(0))[0];

  const handleImageLoad = () => {
    setImageLoaded(true);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };
  
  // Prüfe ob wir von innerhalb der App kommen (z.B. anonymous user upgrade)
  const canGoBack = params.from === 'app';

  // Helper function to get country flag emoji
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
    gender: '' as Gender | '',
    location: '',
    favoriteMarket: null as FirestoreDocument<Discounter> | null
  });
  const [prefilledFields, setPrefilledFields] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // T10 v3: 3 Buttons sind immer sichtbar. Email-Button toggelt die
  // Form auf (collapse-Pattern). So bleibt Login-Link oben sichtbar,
  // Email-Form ist auf Wunsch da, andere Provider direkt verfügbar.
  const [showEmailForm, setShowEmailForm] = useState(false);

  // ─── Pre-Fill aus userProfile (T6, ClickUp 86c9zbw9e) ───────
  // Wenn der User vom Onboarding-Climax aus zu Register kommt,
  // sind seine Antworten bereits in users/{uid} gemirrored. Wir
  // ziehen die Felder ins Form damit nichts doppelt abgefragt wird.
  // - country/location: aus userProfile.guessedCity etc.
  // - favoriteMarket: aus userProfile.favoriteMarket (+ Name)
  // - gender: aus userProfile.gender (normalize legacy values)
  // - birthDate: aus userProfile.birthDate falls da, ODER
  //   aus userProfile.age (Onboarding-Demographics-Sheet
  //   schreibt nur age — wir machen daraus einen approximativen
  //   1. Januar-Stamp damit der DatePicker einen Default hat).
  React.useEffect(() => {
    if (!userProfile) return;
    const p = userProfile as any;
    const prefilled = new Set<string>();

    setFormData((prev) => {
      const next = { ...prev };

      // Names — username/realName erst pre-fillen wenn leer
      if (!next.username && p.display_name) {
        next.username = p.display_name;
        prefilled.add('username');
      }
      if (!next.realName && p.real_name) {
        next.realName = p.real_name;
        prefilled.add('realName');
      }
      // Email — userProfile hat ggf. eine
      if (!next.email && p.email) {
        next.email = p.email;
        prefilled.add('email');
      }
      // Gender mit Legacy-Normalisierung
      if (!next.gender && p.gender) {
        const g = normalizeLegacyGender(p.gender);
        if (g) {
          next.gender = g;
          prefilled.add('gender');
        }
      }
      // birthDate direkt oder via age
      if (!next.birthDate) {
        if (p.birthDate?.toDate) {
          next.birthDate = p.birthDate.toDate();
          prefilled.add('birthDate');
        } else if (p.birthDate instanceof Date) {
          next.birthDate = p.birthDate;
          prefilled.add('birthDate');
        } else if (typeof p.age === 'number' && p.age > 0) {
          next.birthDate = approximateBirthDateFromAge(p.age);
          prefilled.add('birthDate');
        }
      }
      // location
      if (!next.location && (p.city || p.bundesland)) {
        next.location = p.city || p.bundesland;
        prefilled.add('location');
      }
      // favoriteMarket
      if (!next.favoriteMarket && p.favoriteMarket && p.favoriteMarketName) {
        next.favoriteMarket = {
          id: p.favoriteMarket,
          name: p.favoriteMarketName,
          land: p.country ?? 'DE',
        } as FirestoreDocument<Discounter>;
        prefilled.add('favoriteMarket');
      }

      return next;
    });

    if (prefilled.size > 0) setPrefilledFields(prefilled);
  }, [userProfile]);
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

  const openTermsOfService = async () => {
    try {
      await WebBrowser.openBrowserAsync('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/');
    } catch (error) {
      console.error('Error opening Terms of Service:', error);
    }
  };

  const openPrivacyPolicy = async () => {
    try {
      await WebBrowser.openBrowserAsync('https://www.markendetektive.de/datenschutzerklaerung-haftungsausschluss/');
    } catch (error) {
      console.error('Error opening Privacy Policy:', error);
    }
  };

  const handleRegister = async () => {
    // Reset validation errors
    setValidationErrors({});
    
    // Validate required fields
    const errors: {[key: string]: boolean} = {};
    if (!formData.username.trim()) errors.username = true;
    if (!formData.email.trim()) errors.email = true;
    if (!formData.password) errors.password = true;
    if (!acceptTerms) errors.terms = true;
    
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      showInfoToast(
        'Bitte fülle alle Pflichtfelder aus und akzeptiere die Nutzungsbedingungen.',
        'error',
        colorScheme ?? 'light',
      );
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      showInfoToast(
        'Die Passwörter stimmen nicht überein.',
        'error',
        colorScheme ?? 'light',
      );
      return;
    }

    if (formData.password.length < 6) {
      showInfoToast(
        'Das Passwort muss mindestens 6 Zeichen lang sein.',
        'error',
        colorScheme ?? 'light',
      );
      return;
    }

    try {
      setLoading(true);
      
      await signUp(
        formData.email,
        formData.password,
        formData.username,
        {
          realName: formData.realName || undefined,
          birthDate: formData.birthDate || undefined,
          gender: formData.gender || undefined,
          location: formData.location || undefined,
          favoriteMarket: formData.favoriteMarket?.id || undefined,
          favoriteMarketName: formData.favoriteMarket?.name || undefined
        }
      );

      // T5: Onboarding-Status auf 'completed' setzen falls noch nicht
      // (Re-Start-Bug B1: ohne dies würde der User beim nächsten
      // App-Boot wieder in /onboarding landen).
      try { await OnboardingService.markCompleted(); } catch {}

      router.replace('/(tabs)');
    } catch (error: any) {
      // Anon-User hat den 'Konto wechseln'-Confirm abgebrochen
      // (Email gehört bereits einem anderen Account) — kein Fehler,
      // Form offen lassen.
      if (error?.code === 'auth/cancelled') {
        return;
      }

      if (__DEV__) {
        console.error('Registration error:', error);
      }

      // Network = retry-toast, alles andere = info-toast (User
      // muss Eingabe ändern, kein blanker Retry).
      const isTransient = error.code === 'auth/network-request-failed';
      let errorMessage =
        'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.';
      switch (error.code) {
        case 'auth/email-already-in-use':
          errorMessage =
            'Diese E-Mail-Adresse wird bereits verwendet. Bitte andere E-Mail oder beim bestehenden Account anmelden.';
          break;
        case 'auth/weak-password':
          errorMessage =
            'Passwort zu schwach. Bitte ein stärkeres mit mindestens 6 Zeichen wählen.';
          break;
        case 'auth/invalid-email':
          errorMessage = 'Ungültige E-Mail-Adresse.';
          break;
        case 'auth/operation-not-allowed':
          errorMessage =
            'Registrierung derzeit deaktiviert. Bitte Support kontaktieren.';
          break;
        case 'auth/network-request-failed':
          errorMessage = 'Keine Internetverbindung. Bitte Verbindung prüfen.';
          break;
      }

      if (isTransient) {
        showRetryableErrorToast(errorMessage, () => {
          void handleRegister();
        }, { colorScheme: colorScheme ?? 'light' });
      } else {
        showInfoToast(errorMessage, 'error', colorScheme ?? 'light');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      await signInWithGoogle();
      try { await OnboardingService.markCompleted(); } catch {}
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      showRetryableErrorToast(
        `Google-Anmeldung fehlgeschlagen: ${error.message || 'Bitte erneut versuchen.'}`,
        () => {
          void handleGoogleSignIn();
        },
        { colorScheme: colorScheme ?? 'light' },
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);
      // Check if running in Expo Go
      if (isExpoGo()) {
        // Dev-Hinweis bleibt als Alert (Build-Type-Switch erforderlich,
        // User muss explizit lesen + bestätigen).
        Alert.alert(
          'Nicht verfügbar in Expo Go',
          'Apple Sign-In funktioniert nur in der TestFlight oder App Store Version. Bitte nutze Email/Passwort für die Entwicklung.',
          [{ text: 'OK' }]
        );
        return;
      }
      await signInWithApple();
      try { await OnboardingService.markCompleted(); } catch {}
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Apple Sign-In error:', error);
      showRetryableErrorToast(
        `Apple-Anmeldung fehlgeschlagen: ${error.message || 'Bitte erneut versuchen.'}`,
        () => {
          void handleAppleSignIn();
        },
        { colorScheme: colorScheme ?? 'light' },
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        {/* Static background while image loads */}
        <View style={[styles.background, { backgroundColor: colorScheme === 'dark' ? '#000000' : '#f5f5f5' }]} />
        
        {/* Animated ImageBackground */}
        <Animated.View style={[styles.imageContainer, { opacity: fadeAnim }]}>
          <ImageBackground 
            source={require("@/assets/images/background.jpg")}
            style={styles.background}
            
            onLoad={handleImageLoad}
          />
        
        {/* T7: Gleicher Gradient wie Onboarding-Step-1-Hero. */}
        <LinearGradient
          colors={[
            'rgba(0, 0, 0, 0.1)',
            'rgba(0, 0, 0, 0.3)',
            'rgba(0, 0, 0, 0.9)',
          ]}
          locations={[0, 0.7, 1]}
          style={[styles.overlay, { paddingTop: insets.top + 56 }]}
        >
          {/* Back Button — design-system arrow-left in a 40×40
              round translucent-white pill. */}
          <TouchableOpacity
            style={styles.backButtonRound}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color="white" />
          </TouchableOpacity>

          {/* T10 v4: kompakter Logo-Block — kein Title-Overlap mehr. */}
          <View style={[styles.logoContainer, isSmallDevice && styles.logoContainerSmall]}>
            <CustomIcon
              name="iconBlack"
              size={isSmallDevice ? 40 : 52}
              color="white"
              style={styles.logoIcon}
            />
            <ThemedText style={[styles.logoText, isSmallDevice && styles.logoTextSmall]}>
              MarkenDetektive
            </ThemedText>
          </View>

          <KeyboardAvoidingView 
            style={styles.keyboardView}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView 
              ref={scrollViewRef}
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* T10 v4 (2026-05-22): kompakter Title-Block (kein
                  Subtitle), Buttons sichtbar, Email-Toggle → Form,
                  Cross-Link nur EINMAL unter den Buttons. */}
              <View style={styles.titleSection}>
                <ThemedText style={[styles.title, isSmallDevice && styles.titleSmall]}>
                  Jetzt registrieren
                </ThemedText>
              </View>

              {/* 3 (4) Buttons: Apple/Google + Email + Facebook.
                  Email klappt die Form-Felder auf. */}
              <AuthMethodButtons
                mode="register"
                onApple={handleAppleSignIn}
                onGoogle={handleGoogleSignIn}
                onEmail={() => {
                  setShowEmailForm(true);
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: true });
                  }, 50);
                }}
                busy={loading}
                colorScheme={colorScheme}
              />

              {/* Login-Cross-Link DIREKT unter den Buttons — sichtbar,
                  prominent, nur EINMAL (kein Duplikat unten). */}
              <View style={styles.crossLinkBox}>
                <View style={styles.crossLinkDivider} />
                <View style={styles.crossLinkRow}>
                  <ThemedText style={styles.crossLinkText}>Schon registriert? </ThemedText>
                  <TouchableOpacity onPress={() => router.replace('/auth/login')} hitSlop={8}>
                    <ThemedText style={styles.crossLinkLink}>Hier einloggen</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Form Fields — nur sichtbar wenn User "Mit E-Mail" tappt */}
              {showEmailForm && (
              <>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>E-Mail-Registrierung</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.formContainer}>
                {/* Username */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>Anzeigename *</ThemedText>
                  <TextInput
                    style={[
                      styles.input, 
                      validationErrors.username && styles.inputError,
                      isSmallDevice && styles.inputSmall
                    ]}
                    placeholder="Dein Anzeigename"
                    placeholderTextColor="rgba(0,0,0,0.4)"
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
                  <ThemedText style={styles.fieldHelp}>
                    Wird für Kommentare und Bewertungen verwendet
                  </ThemedText>
                </View>

                {/* Real Name */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>Richtiger Name</ThemedText>
                  <TextInput
                    style={[styles.input, isSmallDevice && styles.inputSmall]}
                    placeholder="Dein vollständiger Name"
                    placeholderTextColor="rgba(0,0,0,0.4)"
                    value={formData.realName}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, realName: text }))}
                    autoCapitalize="words"
                  />
                  <ThemedText style={styles.fieldHelp}>
                    Für persönliche Daten und Rechnungen
                  </ThemedText>
                </View>

                {/* Email */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>E-Mail *</ThemedText>
                  <TextInput
                    style={[
                      styles.input, 
                      validationErrors.email && styles.inputError,
                      isSmallDevice && styles.inputSmall
                    ]}
                    placeholder="deine@email.de"
                    placeholderTextColor="rgba(0,0,0,0.4)"
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
                </View>

                {/* Password */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>Passwort *</ThemedText>
                  <View style={styles.passwordContainer}>
                    <TextInput
                      style={[
                        styles.passwordInput, 
                        validationErrors.password && styles.inputError,
                        isSmallDevice && styles.inputSmall
                      ]}
                      placeholder="Mindestens 6 Zeichen"
                      placeholderTextColor="rgba(0,0,0,0.4)"
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
                        color="rgba(0,0,0,0.5)" 
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Confirm Password */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>Passwort bestätigen</ThemedText>
                  <View style={styles.passwordContainer}>
                    <TextInput
                      style={[styles.passwordInput, isSmallDevice && styles.inputSmall]}
                      placeholder="Passwort wiederholen"
                      placeholderTextColor="rgba(0,0,0,0.4)"
                      value={formData.confirmPassword}
                      onChangeText={(text) => setFormData(prev => ({ ...prev, confirmPassword: text }))}
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
                        color="rgba(0,0,0,0.5)" 
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Birth Date */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>Geburtsdatum</ThemedText>
                  <TouchableOpacity 
                    style={[styles.input, isSmallDevice && styles.inputSmall]}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <ThemedText style={styles.selectText}>
                      {formData.birthDate 
                        ? formData.birthDate.toLocaleDateString('de-DE')
                        : 'Datum auswählen'
                      }
                    </ThemedText>
                    <IconSymbol name="calendar" size={20} color="rgba(0,0,0,0.5)" />
                  </TouchableOpacity>
                </View>

                {/* Gender — 4 Pills (Enum aus lib/types/gender.ts) */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>
                    Geschlecht
                    {prefilledFields.has('gender') && (
                      <ThemedText style={styles.prefilledHint}>  ✓ aus Onboarding</ThemedText>
                    )}
                  </ThemedText>
                  <View style={styles.genderContainer}>
                    {GENDER_PILL_OPTIONS.map((opt) => (
                      <TouchableOpacity
                        key={opt.value}
                        style={[
                          styles.genderButton,
                          formData.gender === opt.value && styles.genderButtonActive
                        ]}
                        onPress={() => setFormData(prev => ({ ...prev, gender: opt.value }))}
                      >
                        <ThemedText style={[
                          styles.genderButtonText,
                          formData.gender === opt.value && styles.genderButtonTextActive
                        ]}>
                          {opt.label}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Location */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>Standort</ThemedText>
                  <TouchableOpacity 
                    style={[styles.input, isSmallDevice && styles.inputSmall]}
                    onPress={() => setShowLocationPicker(true)}
                  >
                    <ThemedText style={styles.selectText}>
                      {formData.location || 'Standort wählen'}
                    </ThemedText>
                    <IconSymbol name="location" size={20} color="rgba(0,0,0,0.5)" />
                  </TouchableOpacity>
                </View>

                {/* Favorite Market */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>Lieblingsmarkt</ThemedText>
                  <TouchableOpacity 
                    style={[styles.input, isSmallDevice && styles.inputSmall]}
                    onPress={() => setShowMarketSelector(true)}
                  >
                    <ThemedText style={styles.selectText}>
                      {formData.favoriteMarket 
                        ? `${getCountryFlag(formData.favoriteMarket.land)} ${formData.favoriteMarket.name}`
                        : 'Markt auswählen'
                      }
                    </ThemedText>
                    <IconSymbol name="storefront" size={20} color="rgba(0,0,0,0.5)" />
                  </TouchableOpacity>
                </View>

                {/* Terms */}
                <TouchableOpacity 
                  style={styles.termsContainer}
                  onPress={() => setAcceptTerms(!acceptTerms)}
                >
                  <View style={[styles.checkbox, acceptTerms && styles.checkboxActive]}>
                    {acceptTerms && <IconSymbol name="checkmark" size={16} color="white" />}
                  </View>
                  <ThemedText style={[styles.termsText, validationErrors.terms && styles.termsTextError]}>
                    Ich stimme den{' '}
                    <ThemedText 
                      style={styles.termsLink}
                      onPress={openTermsOfService}
                    >
                      Nutzungsbedingungen
                    </ThemedText>
                    {' '}und der{' '}
                    <ThemedText 
                      style={styles.termsLink}
                      onPress={openPrivacyPolicy}
                    >
                      Datenschutzerklärung
                    </ThemedText>
                    {' '}zu
                  </ThemedText>
                </TouchableOpacity>

                {/* Register Button */}
                <TouchableOpacity
                  style={[styles.registerButton, { backgroundColor: colors.primary }, loading && { opacity: 0.7 }]}
                  onPress={handleRegister}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <IconSymbol name="person.badge.plus" size={20} color="white" />
                      <ThemedText style={styles.registerButtonText}>Registrieren</ThemedText>
                    </>
                  )}
                </TouchableOpacity>
              </View>
              </>
              )}
              {/* T10 v4: Doppel-Cross-Link unten ENTFERNT. Es gibt
                  nur EINEN Link, direkt unter den Buttons (oben). */}
            </ScrollView>
          </KeyboardAvoidingView>
        </LinearGradient>
        </Animated.View>
      </View>

      {/* Date Picker Modal */}
      {showDatePicker && (
        <DateTimePicker
          value={formData.birthDate || new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onDateChange}
          maximumDate={new Date()}
          minimumDate={new Date(1900, 0, 1)}
        />
      )}

      {/* Location Picker Modal */}
      <LocationPicker
        visible={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        onSelect={(location) => {
          setFormData(prev => ({ ...prev, location: location.address || location.city || '' }));
          setShowLocationPicker(false);
        }}
        currentLocation={formData.location}
      />

      {/* Market Selector Modal */}
      <MarketSelector
        visible={showMarketSelector}
        onClose={() => setShowMarketSelector(false)}
        onSelect={(market) => {
          setFormData(prev => ({ ...prev, favoriteMarket: market }));
          setShowMarketSelector(false);
          console.log(`✅ Favorite market selected: ${market.name} (${market.land})`);
        }}
        selectedMarketId={formData.favoriteMarket?.id}
        title="Lieblingsmarkt wählen"
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  imageContainer: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    paddingHorizontal: 24,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  backButtonWithText: {
    position: 'absolute',
    top: 60,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
    zIndex: 10,
  },
  // Design-system back-button: 40×40 round, translucent-white bg.
  backButtonRound: {
    position: 'absolute',
    top: 60,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 10,
  },
  backButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: 'white',
  },
  // T10 v4: kompakter Logo + Title (kein Overlap mehr, kein Subtitle).
  logoContainer: {
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
    marginBottom: 12,
  },
  logoIcon: {
    marginBottom: 0,
  },
  logoText: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  titleSection: {
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 26,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  // subtitle entfernt — bewusst raus.
  // T10 v4: Cross-Link unter den Buttons — prominent, einmalig.
  crossLinkBox: {
    marginTop: 18,
    marginBottom: 8,
    alignItems: 'center',
  },
  crossLinkDivider: {
    width: 80,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 12,
  },
  crossLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crossLinkText: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.85)',
  },
  crossLinkLink: {
    fontSize: 15,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textDecorationLine: 'underline',
  },
  socialSection: {
    marginBottom: 16,
    gap: 12,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'white',
    gap: 12,
  },
  appleButton: {
    backgroundColor: '#000',
  },
  appleButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  googleIconContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
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
  orText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginBottom: 20,
  },
  formContainer: {
    gap: 16,
  },
  inputContainer: {
    width: '100%',
  },
  label: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 8,
  },
  // T6: Subtiler Hinweis bei aus dem Onboarding/userProfile vor-
  // befüllten Feldern. Wird inline neben dem Label gerendert.
  prefilledHint: {
    fontSize: 11,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(76, 175, 80, 0.9)',
  },
  // T10: Solid weiße Card-Look-Inputs (vorher rgba 0.1-Transparenz
  // auf Foto-Background → schlecht lesbar). Dark Text auf hellem
  // BG = klassischer Auth-Form-Look (Apple/Strava/Headspace).
  input: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: '#1c1c1e',
    backgroundColor: 'rgba(255,255,255,0.96)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputError: {
    borderColor: '#FF3B30',
    borderWidth: 2,
  },
  passwordContainer: {
    position: 'relative',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingRight: 50,
    fontSize: 16,
    color: '#1c1c1e',
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  // T10: Divider zwischen Social-Buttons und Email-Form.
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 18,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  dividerText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.2,
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
  fieldHelp: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255, 255, 255, 0.65)',
    marginTop: 4,
  },
  selectText: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    color: '#1c1c1e',
  },
  // T10 v2: Gender-Pills auf gleichen Style wie
  // DemographicsPromptSheet (T3). 2-Spalten-Grid via flexWrap+minWidth
  // verhindert das Wort-Umbruch-Problem bei 4 Pills in einer Reihe.
  genderContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  genderButton: {
    flex: 1,
    minWidth: '45%',
    minHeight: 46,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.06)',
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderButtonActive: {
    backgroundColor: 'rgba(76,175,80,0.10)',
    borderColor: '#4CAF50',
  },
  genderButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: '#1c1c1e',
  },
  genderButtonTextActive: {
    color: '#4CAF50',
    fontFamily: 'Nunito_700Bold',
  },
  // T10 v2: prominenter Login-Cross-Link direkt nach dem Title
  topLoginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginBottom: 24,
    gap: 6,
  },
  topLoginText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.85)',
  },
  topLoginLink: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textDecorationLine: 'underline',
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    gap: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  checkboxActive: {
    backgroundColor: '#00C853',
    borderColor: '#00C853',
  },
  termsText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 18,
  },
  termsTextError: {
    color: '#FF3B30',
  },
  termsLink: {
    textDecorationLine: 'underline',
    fontFamily: 'Nunito_500Medium',
    color: 'white',
    fontSize: 13,
  },
  registerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    marginTop: 20,
    gap: 12,
  },
  registerButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  // T10: prominent Cross-Link nach unten — eigene divider line +
  // Row, "Hier einloggen" als Underline + Bold sichtbar.
  loginSection: {
    marginTop: 24,
    paddingTop: 16,
    alignItems: 'center',
  },
  loginDividerLine: {
    width: 60,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: 16,
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loginText: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255, 255, 255, 0.85)',
  },
  loginLinkBold: {
    fontSize: 15,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
    textDecorationLine: 'underline',
  },
  loginLink: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  // Small device styles
  logoContainerSmall: {
    marginTop: 20,
    gap: 3,
    marginBottom: 15,
  },
  logoTextSmall: {
    fontSize: 24,
  },
  titleSmall: {
    fontSize: 22,
    marginBottom: 6,
  },
  subtitleSmall: {
    fontSize: 14,
  },
  inputSmall: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  }
});