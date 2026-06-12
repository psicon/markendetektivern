import { ThemedText } from '@/components/ThemedText';
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
import { ageFromBirthDate, ageBucketFromAge, currentAgeFromReported } from '@/lib/utils/age';
import { AgePicker } from '@/components/ui/AgePicker';
import {
  showInfoToast,
  showRetryableErrorToast,
} from '@/lib/services/ui/toast';
import { Discounter, FirestoreDocument } from '@/lib/types/firestore';
import { isExpoGo } from '@/lib/utils/platform';
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

  // T11.3: Identifier-First-Flow gibt die Email per Query-Param rein.
  // Initial state bekommt sie direkt — vermeidet 1-Frame-Lücke ggü.
  // useEffect-Prefill.
  const prefilledEmailFromQuery =
    typeof params.email === 'string' ? params.email : undefined;

  const [formData, setFormData] = useState({
    username: '',
    realName: '',
    email: prefilledEmailFromQuery ?? '',
    password: '',
    confirmPassword: '',
    // T12.3: birthDate ersetzt durch Integer-Age (Slider).
    age: null as number | null,
    gender: '' as Gender | '',
    location: '',
    favoriteMarket: null as FirestoreDocument<Discounter> | null
  });
  const [prefilledFields, setPrefilledFields] = useState<Set<string>>(() => {
    // T11.3: Wenn die Email per Query-Param reinkam (Identifier-First-
    // Flow), markieren wir sie als prefilled damit der "aus Register"-
    // Hint angezeigt wird.
    const s = new Set<string>();
    if (prefilledEmailFromQuery) s.add('email');
    return s;
  });
  const [loading, setLoading] = useState(false);

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
      // T12.3: Age direkt aus dem User-Doc. Falls Legacy-Pfad
      // (alte User mit birthDate aber ohne age) → ageFromBirthDate.
      if (next.age === null) {
        if (typeof p.age === 'number' && p.age > 0) {
          if (typeof p.ageReportedYear === 'number') {
            next.age = currentAgeFromReported(p.age, p.ageReportedYear);
          } else {
            next.age = p.age;
          }
          prefilled.add('age');
        } else if (p.birthDate?.toDate) {
          const fromDob = ageFromBirthDate(p.birthDate.toDate());
          if (fromDob) {
            next.age = fromDob;
            prefilled.add('age');
          }
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
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showMarketSelector, setShowMarketSelector] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{[key: string]: boolean}>({});

  // T12.3: onDateChange + showDatePicker entfernt — Alter wird
  // jetzt via AgePicker erfasst.

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
          // T12.3: age (Integer) statt birthDate. AuthContext schreibt
          // age/ageBucket/ageReportedAt/ageReportedYear ans User-Doc.
          age: typeof formData.age === 'number' ? formData.age : undefined,
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

      // T11.3: Duplicate-Case → automatische Weiterleitung zu Login
      // mit prefilled Email. UX-Best-Practice (Linear/Slack/Notion):
      // User soll nicht selber rätseln müssen "wie komme ich zum
      // Login", die App routet ihn direkt + Toast erklärt warum.
      if (error.code === 'auth/email-already-in-use') {
        showInfoToast(
          'Du hast bereits einen Account — bitte einloggen.',
          'info',
          colorScheme ?? 'light',
        );
        router.replace({
          pathname: '/auth/login',
          params: { email: formData.email.trim().toLowerCase() },
        } as any);
        return;
      }

      // Network = retry-toast, alles andere = info-toast (User
      // muss Eingabe ändern, kein blanker Retry).
      const isTransient = error.code === 'auth/network-request-failed';
      let errorMessage =
        'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es später erneut.';
      switch (error.code) {
        case 'auth/email-already-in-use':
          // unreachable — siehe Early-Return oben
          errorMessage =
            'Diese E-Mail-Adresse wird bereits verwendet. Bitte beim bestehenden Account anmelden.';
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
      const ok = await signInWithGoogle();
      if (!ok) return; // Abbruch = kein Login (86ca7x9ep)
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
      const ok = await signInWithApple();
      if (!ok) return; // Abbruch = kein Login (86ca7x9ep)
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
        
        {/* T14.8: Identisch zu register.tsx + login.tsx — kräftigerer
            schwarzer Gradient für konsistente Lesbarkeit aller Form-
            Labels gegen das Foto-Background. */}
        <LinearGradient
          colors={[
            'rgba(0, 0, 0, 0.15)',
            'rgba(0, 0, 0, 0.45)',
            'rgba(0, 0, 0, 0.92)',
          ]}
          locations={[0, 0.5, 1]}
          style={[styles.overlay, { paddingTop: insets.top + 56 }]}
        >
          {/* Back Button — design-system arrow-left in a 40×40
              round translucent-white pill. Bleibt fix oben damit
              er immer erreichbar ist während User scrollt. */}
          <TouchableOpacity
            style={styles.backButtonRound}
            onPress={() => router.back()}
            hitSlop={8}
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color="white" />
          </TouchableOpacity>

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
              {/* T11: Logo-Block scrollt mit dem Form mit damit auf
                  kleinen Devices ohne Tastatur-Overlap genug Platz für
                  die Felder bleibt. User-Wunsch: "Header wegscrollen
                  wenn ich nach unten scrolle, kostet zu viel Platz".
                  Back-Button bleibt absolute-positioned damit er
                  immer erreichbar ist. */}
              <View style={[styles.logoContainerScroll, isSmallDevice && styles.logoContainerScrollSmall]}>
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

              {/* T10 v8: Title weg — der User hat "Mit E-Mail
                  registrieren" aktiv im Hub gewählt, weiß was
                  hier passiert. Form startet direkt. */}
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

                {/* T12.3: Alter via AgePicker statt Datums-Picker.
                    Hint "✓ aus Onboarding" wenn vorbefüllt. */}
                <View style={styles.inputContainer}>
                  <ThemedText style={styles.label}>
                    Alter
                    {prefilledFields.has('age') && (
                      <ThemedText style={styles.prefilledHint}>  ✓ aus Onboarding</ThemedText>
                    )}
                  </ThemedText>
                  <View style={styles.agePickerWrapper}>
                    <AgePicker
                      value={formData.age}
                      onChange={(n) => setFormData((prev) => ({ ...prev, age: n }))}
                      tintColor="#0d8575"
                      textColor="#1c1c1e"
                    />
                  </View>
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

              {/* Login-Cross-Link am unteren Rand der Form-Page */}
              <View style={styles.crossLinkBox}>
                <View style={styles.crossLinkDivider} />
                <View style={styles.crossLinkRow}>
                  <ThemedText style={styles.crossLinkText}>Schon registriert? </ThemedText>
                  <TouchableOpacity onPress={() => router.replace('/auth/login')} hitSlop={8}>
                    <ThemedText style={styles.crossLinkLink}>Hier einloggen</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </LinearGradient>
        </Animated.View>
      </View>

      {/* T12.3: DateTimePicker entfernt — Alter via AgePicker inline. */}

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
  // T10 v9: gleiche Y-Position wie register.tsx + login.tsx +
  // welcome.tsx — Logo wandert nicht zwischen den Auth-Pages.
  logoContainer: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 20,
    gap: 4,
  },
  // T11: Logo-Block ist jetzt erstes Element IN der ScrollView damit
  // er beim Scroll-Down mit-wegscrollt (Form bekommt mehr Platz).
  // Kein marginTop weil paddingTop des Overlays (insets.top+56) bereits
  // genug Atemraum nach oben gibt; kompakteres marginBottom als der
  // fixed-Header weil zusammen mit dem Form gescrollt wird.
  logoContainerScroll: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 18,
    gap: 4,
  },
  logoContainerScrollSmall: {
    marginTop: 2,
    marginBottom: 12,
    gap: 2,
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
  // T12.3: AgePicker-Wrapper auf dem dunklen Auth-Background. Heller
  // Surface-Card mit Padding macht den Slider gut sichtbar.
  agePickerWrapper: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
    color: '#0d8575',
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
  // T10 v6: Sauberes 2-Spalten-Grid für die 4 Pills.
  // Vorher: flex:1 + minWidth:45% führte zu unterschiedlichen Pill-
  // Größen (Pills im 2. Row wurden breiter weil sie alleine eine
  // Row hatten, plus "Männlich" wurde mal größer mal kleiner je
  // nach Wrap-Verhalten). Jetzt: fixed width: 48% + gap:8 + flexWrap.
  // 2 columns garantiert, alle 4 Pills identisch in Größe.
  genderContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genderButton: {
    width: '48.5%',
    height: 50,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.06)',
    backgroundColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // T10 v8: Active-State im Brand-Grün (Colors.light.primary
  // #0d8575). Vorher Material-Grün #4CAF50 — das passt nicht zur
  // App-Identität.
  genderButtonActive: {
    backgroundColor: '#0d8575',
    borderColor: '#0d8575',
  },
  genderButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: '#1c1c1e',
  },
  genderButtonTextActive: {
    color: '#fff',
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