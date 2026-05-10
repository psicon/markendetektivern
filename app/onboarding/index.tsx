// Simple Onboarding ohne Hooks-Probleme
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import LottieView from 'lottie-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  ImageBackground,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle
} from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomIcon } from '@/components/ui/CustomIcon';
import { OnboardingButton } from '@/components/ui/OnboardingButton';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { remoteConfigService } from '@/lib/services/remoteConfigService';
import { detectCountry, type DachCountry } from '@/lib/utils/country';

const { width } = Dimensions.get('window');

// Total = 7 sichtbare Schritte (Hero + 6 Frage-Steps).
// Step 1 ist der Hero — ohne ProgressBar. Step 7 ist Loading (kurz),
// Step 8 ist der Climax. Wir zeigen "X von 6" auf dem ProgressBar.
const TOTAL_STEPS = 8;

const COUNTRIES = [
  { code: 'DE', name: 'Deutschland', flag: '🇩🇪' },
  { code: 'AT', name: 'Österreich', flag: '🇦🇹' },
  { code: 'CH', name: 'Schweiz', flag: '🇨🇭' },
] as const;

// Gender-Optionen — User-facing 4 Pills (Männlich/Weiblich/Non-binär/
// Anderes). Storage: stable lowercase-ID. User-Doc-Mirror mapped die
// IDs aufs aktuelle edit-profile-Schema (capitalized) damit Edit-
// Profile-UI die richtige Pille als selektiert rendert.
const GENDER_OPTIONS = [
  { id: 'männlich', name: 'Männlich' },
  { id: 'weiblich', name: 'Weiblich' },
  { id: 'nonbinary', name: 'Non-binär' },
  { id: 'anderes', name: 'Anderes' },
] as const;

// Mapping ID → User-Doc-Wert (kompatibel mit edit-profile.tsx
// GENDER_OPTIONS = ['Männlich', 'Weiblich', 'Divers']).
// 'Anderes' ist NEU (edit-profile-UI rendert das noch nicht — aber
// das Feld ist im User-Doc auswertbar fürs Dashboard).
const GENDER_USERDOC_MAP: Record<string, string> = {
  männlich: 'Männlich',
  weiblich: 'Weiblich',
  nonbinary: 'Divers',
  anderes: 'Anderes',
};

// Alters-Range für den Slider — Onboarding sammelt Integer-Alter
// (Dashboard-friendly), Edit-Profile pflegt birthDate für genauere
// Auswertung später.
const AGE_MIN = 16;
const AGE_MAX = 80;
const AGE_DEFAULT = 30;

const ACQUISITION_SOURCES = [
  { id: 'instagram', name: 'Instagram', icon: '📸' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵' },
  { id: 'youtube', name: 'YouTube', icon: '📺' },
  { id: 'facebook', name: 'Facebook', icon: '👥' },
  { id: 'friends', name: 'Freunde/Familie', icon: '👫' },
  { id: 'google', name: 'Google', icon: '🔍' },
  { id: 'appstore', name: 'App Store', icon: '📱' },
  { id: 'sonstiges', name: 'Sonstiges', icon: '💭' },
];

const PRIORITIES = [
  { id: 'preis', name: 'Preis', icon: '💰' },
  { id: 'inhaltsstoffe', name: 'Inhaltsstoffe', icon: '🧪' },
  { id: 'qualität', name: 'Qualität', icon: '⭐' },
  { id: 'marke', name: 'Marke', icon: '🏷️' },
  { id: 'marktnähe', name: 'Marktnähe', icon: '📍' },
  { id: 'anderes', name: 'Anderes', icon: '💭' },
];

export default function OnboardingScreen() {
  const { signInAnonymously, refreshUserProfile: refreshAuthUserProfile } = useAuth();
  const { presentPaywallIfNeeded, presentPaywall, isPremium, refreshPremiumStatus } = useRevenueCat();
  const colorScheme = useColorScheme();
  
  // Dynamic styles based on color scheme - MUSS VOR useState sein!
  const styles = createStyles(colorScheme);
  
  // ALLE useState IMMER (keine conditionals!)
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [premiumStatusChecked, setPremiumStatusChecked] = useState(false);
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  // Country aus Device-Locale vorbelegt (DE/AT/CH, fallback DE).
  // User kann's auf Step 2 (Märkte) per Country-Pill ändern falls
  // Detection daneben liegt.
  const [country, setCountry] = useState<DachCountry>(() => detectCountry());
  const [markets, setMarkets] = useState<any[]>([]);
  const [selectedMarkets, setSelectedMarkets] = useState<any[]>([]);
  const [marketOther, setMarketOther] = useState('');
  const [acquisitionSource, setAcquisitionSource] = useState('');
  const [acquisitionOther, setAcquisitionOther] = useState('');
  const [budget, setBudget] = useState(100);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [prioritiesOther, setPrioritiesOther] = useState('');
  // Demographics (NEU in Step 5). 'skipped' bedeutet User hat
  // den Step explizit übersprungen — wird in Firestore vermerkt
  // damit wir Skip-Rates auswerten können.
  const [age, setAge] = useState<number>(AGE_DEFAULT);
  const [ageSkipped, setAgeSkipped] = useState(false);
  const [gender, setGender] = useState<string>('');
  const [genderOther, setGenderOther] = useState('');
  const [loadingProgress] = useState(new Animated.Value(0));
  const [loadingMessage, setLoadingMessage] = useState('🕵️ Die MarkenDetektive beginnen ihre Recherche...');
  const [slideAnimation] = useState(new Animated.Value(1)); // Für Slide-Animationen
  const [backgroundOpacity] = useState(new Animated.Value(1)); // Für Background Fade
  const [sessionId] = useState(`session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`); // Persistente Session-ID
  const confettiRef = useRef<ConfettiCannon>(null); // Für Konfetti-Effekt

  // Premium Check beim Onboarding Start
  useEffect(() => {
    const initializeAndCheckPremium = async () => {
      console.log('🚀 Onboarding gestartet - initialisiere RevenueCat...');
      
      try {
        // Stelle sicher dass RevenueCat initialisiert ist
        const { revenueCatService } = await import('@/lib/services/revenueCatService');
        
        // Warte bis RevenueCat ready ist
        let retries = 0;
        while (!revenueCatService.isInitialized && retries < 20) {
          console.log('⏳ Warte auf RevenueCat Initialisierung...', retries);
          await new Promise(resolve => setTimeout(resolve, 100));
          retries++;
        }
        
        // Käufe wiederherstellen
        console.log('🔄 Stelle Käufe wieder her...');
        await revenueCatService.restorePurchases();
        
        // Premium Status prüfen
        const isPremiumNow = await revenueCatService.isPremium();
        console.log('✅ Onboarding Premium Check:', isPremiumNow ? 'PREMIUM AKTIV' : 'Kein Premium');
        
        // Status speichern für späteren Gebrauch
        setIsPremiumUser(isPremiumNow);
        setPremiumStatusChecked(true);
        
        // UI aktualisieren
        await refreshPremiumStatus();
        
      } catch (error) {
        console.error('❌ Fehler beim Premium Check:', error);
        setPremiumStatusChecked(true); // Auch bei Fehler weitermachen
      }
    };
    
    initializeAndCheckPremium();
  }, []);

  // ALLE useEffects IMMER (keine conditionals!)
  useEffect(() => {
    console.log(`📊 Onboarding: Step ${currentStep} viewed`);
    
    // Konfetti + Haptik für Savings-Seite (Step 8)
    if (currentStep === 8) {
      // Haptisches Feedback wie bei Achievements
      setTimeout(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Konfetti nach kurzer Verzögerung
        setTimeout(() => {
          confettiRef.current?.start();
        }, 300);
      }, 600); // Nach Slide-Animation
    }
    
    // Echte Slide-in Animation (von rechts)
    slideAnimation.setValue(width); // Start außerhalb des Screens
    Animated.timing(slideAnimation, {
      toValue: 0, // Slide zur normalen Position
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [currentStep, slideAnimation]);

  useEffect(() => {
    loadMarkets();
  }, [country]);

  useEffect(() => {
    if (currentStep === 7) {
      // Loading Animation
      Animated.timing(loadingProgress, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: false,
      }).start();

      // Auto-advance
      const timer = setTimeout(() => {
        setCurrentStep(8);
      }, 3000);

      // Loading Messages
      const messages = [
        '🕵️ Die MarkenDetektive beginnen ihre Recherche...',
        '🔍 Deine Lieblingsprodukte werden analysiert...',
        '💰 Die Buchhaltung errechnet dein Sparpotential...',
        '🎯 Dein persönliches App-Erlebnis wird optimiert...',
        '✨ Fast geschafft - noch einen Moment...'
      ];
      
      let messageIndex = 0;
      const messageInterval = setInterval(() => {
        if (messageIndex < messages.length - 1) {
          messageIndex++;
          setLoadingMessage(messages[messageIndex]);
        }
      }, 1200);

      return () => {
        clearTimeout(timer);
        clearInterval(messageInterval);
      };
    }
  }, [currentStep, loadingProgress]);

  // Lade Märkte aus Firestore
  const loadMarkets = async () => {
    try {
      const { collection, getDocs, query, where } = await import('@react-native-firebase/firestore');
      const { db } = await import('@/lib/firebase');
      
      console.log('🔍 Loading markets for country:', country);
      
      // Korrekte Query: "land" nicht "countries"
      const discounterRef = collection(db, 'discounter');
      const q = query(discounterRef, where('land', '==', country));
      const snapshot = await getDocs(q);
      
      console.log('📊 Firestore query result:', snapshot.size, 'documents');
      
      const loadedMarkets = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sortiere: isFree zuerst
      loadedMarkets.sort((a, b) => {
        if (a.isFree && !b.isFree) return -1;
        if (!a.isFree && b.isFree) return 1;
        return a.name.localeCompare(b.name);
      });
      
      // Füge "Anderer" hinzu
      loadedMarkets.push({
        id: 'other',
        name: 'Anderer',
        logo: '💭',
        isOther: true
      });
      
      setMarkets(loadedMarkets);
      console.log('✅ Märkte geladen für', country, ':', loadedMarkets.length);
      
    } catch (error) {
      console.error('❌ Error loading markets:', error);
      setMarkets([
        { id: 'other', name: 'Anderer', logo: '💭', isOther: true }
      ]);
    }
  };

  // Tracking-Funktion (nur beim Weiterklicken aufgerufen).
  //
  // Step-Reihenfolge (post-redesign):
  //   1 = Hero (kein Tracking — User hat noch nichts beantwortet)
  //   2 = Märkte           (favoriteMarkets, primaryMarket)
  //   3 = Wocheneinkauf €  (weeklyBudgetEur)
  //   4 = Prioritäten      (priorities)
  //   5 = Alter+Geschlecht (age, gender, ageSkipped)
  //   6 = Wie gehört       (acquisitionSource)
  //   7 = Loading          (kein eigenes Tracking)
  //   8 = Climax           (kein Tracking — completeOnboarding regelt das)
  //
  // country wird IMMER mitgesendet weil's aus Device-Locale stammt
  // (auch wenn User auf Step 2 noch nicht aktiv geändert hat).
  //
  // `overrideAgeSkipped`: explizites Flag für State-Race in
  // skipDemographicsStep — setState ist async, der direkt danach
  // gerufene nextStep-→-trackCurrentStep-Pfad liest sonst noch
  // den alten ageSkipped-Wert aus dem Render-Closure.
  // STRICT-true-Check: viele onPress-Handler reichen das React-
  // Press-Event als 1. Arg durch (truthy-Object) — das würde sonst
  // überall demographicsSkipped triggern.
  const trackCurrentStep = async (overrideAgeSkipped?: boolean) => {
    const effectiveAgeSkipped = overrideAgeSkipped === true ? true : ageSkipped;
    // Nur tracken wenn der User mindestens einen Step abgeschlossen hat.
    if (currentStep <= 1) return;

    try {
      const { setDoc, doc, serverTimestamp } = await import('@react-native-firebase/firestore');
      const { db, auth } = await import('@/lib/firebase');

      const userId = auth.currentUser?.uid || 'anonymous';

      const stepData: any = {
        userId,
        sessionId,
        currentStep,
        status: 'in_progress',
        lastUpdateTime: serverTimestamp(),
        country, // immer aus Locale-Detection oder User-Override
        version: 'v2', // schema-version geupgraded (age+gender, no auth-step)
        platform: 'mobile',
      };

      // startTime beim ersten echten Step (= 2 = Märkte).
      if (currentStep === 2) {
        stepData.startTime = serverTimestamp();
      }

      // Schritt-akkumulative Daten — alles was bis hierhin
      // beantwortet wurde wird mitgesendet.
      if (currentStep >= 2 && selectedMarkets.length > 0) {
        stepData.favoriteMarkets = selectedMarkets.map(m => m.name);
        stepData.primaryMarket = selectedMarkets[0]?.name;
        if (marketOther) stepData.marketOther = marketOther;
      }
      if (currentStep >= 3) stepData.weeklyBudgetEur = budget;
      if (currentStep >= 4 && priorities.length > 0) {
        stepData.priorities = priorities;
        if (prioritiesOther) stepData.prioritiesOther = prioritiesOther;
      }
      if (currentStep >= 5) {
        // Demographics. effectiveAgeSkipped=true → User hat den Step
        // bewusst übersprungen, wir vermerken das (für Skip-Rate-
        // Analyse).
        if (effectiveAgeSkipped) {
          stepData.demographicsSkipped = true;
        } else {
          stepData.age = age;
          if (gender) stepData.gender = gender;
          if (gender === 'anderes' && genderOther.trim()) {
            stepData.genderOther = genderOther.trim();
          }
        }
      }
      if (currentStep >= 6 && acquisitionSource) {
        stepData.acquisitionSource = acquisitionSource;
        if (acquisitionOther) stepData.acquisitionOther = acquisitionOther;
      }

      await setDoc(doc(db, 'onboardingResultsV5', sessionId), stepData);
      console.log('📊 Step tracking saved for step:', currentStep);
    } catch (error) {
      console.error('❌ Step tracking error:', error);
    }
  };

  const nextStep = async (overrideAgeSkipped?: boolean) => {
    if (currentStep < TOTAL_STEPS) {
      // Auf "Los geht's"-Tap (Step 1 → 2): SOFORT anonyme UUID
      // erzeugen falls noch keiner da ist. Damit hängen alle
      // folgenden Onboarding-Antworten an einer stabilen UID
      // (Step 0 "invisible UUID-Generierung" aus dem ClickUp-Task).
      // Falls AuthContext schon einen Anon-User aufgesetzt hat
      // (Auto-Anon-Login beim App-Boot), ist das ein No-op.
      if (currentStep === 1) {
        try {
          const { auth } = await import('@/lib/firebase');
          if (!auth.currentUser) {
            await signInAnonymously();
            console.log('✅ Anon-UUID auto-erzeugt am Onboarding-Start');
          }
        } catch (e) {
          console.warn('⚠️ Anon-Auto-Login fehlgeschlagen:', e);
          // Non-fatal — userId fällt auf "anonymous" zurück im Tracking
        }
      }

      // Tracking beim Weiterklicken (nicht bei jeder Auswahl).
      // overrideAgeSkipped: aus skipDemographicsStep weitergegeben
      // damit der State-Race (setAgeSkipped → nextStep im selben
      // Tick) nicht zu falscher Tracking-Schreibung führt.
      // STRICT-true-Check unten in trackCurrentStep filtert
      // zugleich React-Press-Events raus die als overrideAgeSkipped
      // durchgereicht würden (onPress={nextStep}-Pattern).
      await trackCurrentStep(overrideAgeSkipped === true ? true : undefined);

      // Spezielle Animation für Übergang von Hero (Step 1) zu Step 2
      if (currentStep === 1) {
        // Background fade out parallel zur Slide-Animation
        Animated.parallel([
          Animated.timing(backgroundOpacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnimation, {
            toValue: -width,
            duration: 400,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setCurrentStep(currentStep + 1);
        });
      } else {
        // Normale Slide-Animation für alle anderen Steps
        Animated.timing(slideAnimation, {
          toValue: -width,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setCurrentStep(currentStep + 1);
        });
      }
    }
  };

  /**
   * Step 5 (Alter+Geschlecht) explicit-skip:
   * setzt ageSkipped=true und springt direkt zu Step 6.
   * `overrideAgeSkipped`-Parameter umgeht den setState-Race
   * (siehe nextStep + trackCurrentStep) — sonst würde
   * trackCurrentStep noch den alten ageSkipped=false-Wert lesen
   * und age/gender statt demographicsSkipped schreiben.
   */
  const skipDemographicsStep = () => {
    setAgeSkipped(true);
    nextStep(true);
  };

  const previousStep = () => {
    if (currentStep > 1) {
      // Spezielle Animation für Rückkehr zu Hero (Step 1)
      if (currentStep === 2) {
        // Background fade in parallel zur Slide-Animation
        Animated.parallel([
          Animated.timing(backgroundOpacity, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(slideAnimation, {
            toValue: width,
            duration: 400,
            useNativeDriver: true,
          })
        ]).start(() => {
          setCurrentStep(currentStep - 1);
        });
      } else {
        // Normale Slide-Animation für alle anderen Steps
        Animated.timing(slideAnimation, {
          toValue: width,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setCurrentStep(currentStep - 1);
        });
      }
    }
  };

  const skipOnboarding = async () => {
    // Zeige sofort Ladebildschirm
    setIsLoading(true);
    setLoadingStatus('Lade ersten Start...');
    
    // Fade out animation für Skip vom Hero Screen
    if (currentStep === 1) {
      Animated.timing(backgroundOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
    
    // Auth sollte bereits automatisch erfolgt sein durch AuthContext
    // Aber sicherheitshalber prüfen ob User existiert
    const { auth } = await import('@/lib/firebase');
    if (!auth.currentUser) {
      try {
        await signInAnonymously();
      } catch (error) {
        console.error('❌ Anonymous sign in failed:', error);
      }
    }
    
    // Speichere Skip/Abandon
    try {
      const { setDoc, doc, serverTimestamp } = await import('@react-native-firebase/firestore');
      const { db, auth } = await import('@/lib/firebase');
      
      await setDoc(doc(db, 'onboardingResultsV5', sessionId), {
        userId: auth.currentUser?.uid || 'anonymous',
        sessionId,
        status: 'abandoned',
        abandonedAtStep: currentStep,
        abandonReason: 'later_button',
        currentStep,
        lastUpdateTime: serverTimestamp(),
        completedAt: serverTimestamp(),
        // Behalte bereits gesammelte Daten
        country, // immer aus Locale-Detection oder User-Override
        ...(selectedMarkets.length > 0 && {
          favoriteMarkets: selectedMarkets.map(m => m.name),
          primaryMarket: selectedMarkets[0]?.name,
        }),
        ...(marketOther && { marketOther }),
        ...(acquisitionSource && { acquisitionSource }),
        ...(acquisitionOther && { acquisitionOther }),
        ...(budget && { weeklyBudgetEur: budget }),
        ...(priorities.length > 0 && { priorities }),
        ...(prioritiesOther && { prioritiesOther }),
        // Demographics nur wenn der User Step 5 schon gesehen hat.
        ...(currentStep > 5 && !ageSkipped && {
          age,
          ...(gender && { gender }),
          ...(gender === 'anderes' && genderOther.trim() && {
            genderOther: genderOther.trim(),
          }),
        }),
        ...(currentStep > 5 && ageSkipped && { demographicsSkipped: true }),
        version: 'v2',
        platform: 'mobile',
      });
      
      console.log('📊 Abandon tracked at step:', currentStep);
    } catch (error) {
      console.error('❌ Skip tracking error:', error);
    }
    
    const AsyncStorage = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.default.setItem('onboarding_v1_skipped', 'true');
    
    // Pending-Paywall-Flag setzen; tatsächliche Präsentation erfolgt sicher in der Home-Seite
    try {
      await AsyncStorage.default.setItem('pending_onboarding_paywall', '1');
    } catch (e) {
      console.warn('⚠️ Konnte Pending-Paywall-Flag nicht setzen:', e);
    }
    
    // WICHTIG: Premium Status Force-Refresh VOR Navigation!
    try {
      await refreshPremiumStatus();
    } catch (error) {
      console.warn('⚠️ Premium Status Refresh fehlgeschlagen:', error);
    }

    // Navigation zur App
    router.replace('/(tabs)');
  };

  /**
   * Climax-Path "Profil sichern & App starten":
   * - Speichert Onboarding-Antworten (Firestore-Session + User-Doc-
   *   Mirror) genau wie completeOnboarding.
   * - Setzt pending_onboarding_paywall=1 statt die Paywall hier zu
   *   triggern — die wird nach Auth + Tab-Bar-Mount gezeigt
   *   (app/(tabs)/index.tsx liest das Flag).
   * - Routet auf /auth/welcome — wenn der User dort Apple/Google/
   *   Email wählt, linkt AuthContext.linkOrSignIn den Anon-Account
   *   automatisch (Phase 1) → UID + alle Onboarding-Antworten
   *   bleiben erhalten.
   */
  const completeOnboardingForAuth = async () => {
    setIsLoading(true);
    try {
      // Daten persistieren — gleiche Logik wie completeOnboarding's
      // Save-Phase (Firestore-Session + User-Doc-Mirror), aber ohne
      // Paywall-Präsentation und ohne /(tabs)-Navigation.
      await persistOnboardingResults();

      // Paywall darf nach Auth-Erfolg auf /(tabs) triggern.
      try {
        const AsyncStorage = await import('@react-native-async-storage/async-storage');
        await AsyncStorage.default.setItem('pending_onboarding_paywall', '1');
      } catch (e) {
        console.warn('⚠️ pending_onboarding_paywall set failed:', e);
      }

      router.replace('/auth/welcome');
    } catch (error) {
      console.error('❌ completeOnboardingForAuth error:', error);
      Alert.alert('Fehler', 'Onboarding konnte nicht abgeschlossen werden');
      router.replace('/(tabs)');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Helper: persistiert Antworten in Firestore (Session-Doc) + ans
   * users/{uid}-Doc als Mirror, plus AsyncStorage-Flag. Wird sowohl
   * von completeOnboarding (Guest-Path) als auch von
   * completeOnboardingForAuth (Auth-Path) benutzt.
   *
   * Kein Loading-Toggle, keine Navigation, keine Paywall — das
   * regelt der Caller.
   */
  const persistOnboardingResults = async () => {
    const { setDoc, doc, serverTimestamp } = await import('@react-native-firebase/firestore');
    const { db, auth: authMod } = await import('@/lib/firebase');

    // Anon-UUID securen falls noch nicht vorhanden (idempotent).
    if (!authMod.currentUser) {
      await signInAnonymously();
    }

    const completionData: any = {
      userId: authMod.currentUser?.uid || 'anonymous',
      sessionId,
      status: 'completed',
      currentStep: TOTAL_STEPS,
      lastUpdateTime: serverTimestamp(),
      completedAt: serverTimestamp(),
      country,
      weeklyBudgetEur: budget,
      priorities,
      estimatedSavingsPercent: 35,
      estimatedSavingsEurWeek: Math.round(budget * 0.35),
      version: 'v2',
      platform: 'mobile',
    };

    // Demographics
    if (ageSkipped) {
      completionData.demographicsSkipped = true;
    } else {
      completionData.age = age;
      if (gender) completionData.gender = gender;
      if (gender === 'anderes' && genderOther.trim()) {
        completionData.genderOther = genderOther.trim();
      }
    }

    // Optional fields
    if (selectedMarkets.length > 0) {
      completionData.favoriteMarkets = selectedMarkets.map(market => {
        if (market.isOther) {
          return { id: 'other', name: marketOther, isCustom: true };
        }
        return market;
      });
      completionData.primaryMarket = selectedMarkets[0];
    }
    if (acquisitionSource && acquisitionSource !== '') {
      completionData.acquisitionSource = acquisitionSource;
      if (acquisitionSource === 'sonstiges' && acquisitionOther.trim() !== '') {
        completionData.acquisitionOther = acquisitionOther;
      }
    }
    if (priorities.includes('anderes') && prioritiesOther.trim() !== '') {
      completionData.prioritiesOther = prioritiesOther;
    }

    await setDoc(doc(db, 'onboardingResultsV5', sessionId), completionData);

    // User-Doc Mirror (gleiche Felder wie unten in completeOnboarding).
    try {
      const uid = authMod.currentUser?.uid;
      if (uid) {
        const userPrefs: any = {
          country,
          weeklyBudgetEur: budget,
          priorities,
          onboardingCompletedAt: serverTimestamp(),
        };
        if (selectedMarkets.length > 0) {
          userPrefs.favoriteMarkets = completionData.favoriteMarkets;
          const primary = completionData.primaryMarket;
          if (primary?.id) {
            userPrefs.favoriteMarket = primary.id;
            userPrefs.favoriteMarketName = primary.name ?? '';
          }
          userPrefs.primaryMarket = primary;
        }
        if (acquisitionSource) {
          userPrefs.acquisitionSource = acquisitionSource;
          if (acquisitionSource === 'sonstiges' && acquisitionOther.trim() !== '') {
            userPrefs.acquisitionOther = acquisitionOther;
          }
        }
        if (priorities.includes('anderes') && prioritiesOther.trim() !== '') {
          userPrefs.prioritiesOther = prioritiesOther;
        }
        if (!ageSkipped) {
          userPrefs.age = age;
          if (gender) {
            userPrefs.gender = GENDER_USERDOC_MAP[gender] ?? gender;
            if (gender === 'anderes' && genderOther.trim() !== '') {
              userPrefs.genderOther = genderOther.trim();
            }
          }
        }
        await setDoc(doc(db, 'users', uid), userPrefs, { merge: true });
        console.log('✅ Onboarding answers mirrored to users/' + uid);
      }
    } catch (mirrorErr) {
      console.warn('⚠️ Failed to mirror onboarding answers:', mirrorErr);
    }

    const AsyncStorage = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.default.setItem('onboarding_v1_completed', 'true');

    // KRITISCH: AuthContext.userProfile refreshen sodass die
    // frisch-gemirrorten Felder (favoriteMarket, age, gender,
    // weeklyBudgetEur, …) sofort im UI auftauchen — auch bei
    // anon-Usern. Ohne Refresh zeigt das Profil stale Daten weil
    // AuthContext nur via onAuthStateChanged refresht (was bei
    // schon-existierendem Anon-User nicht feuert).
    try {
      await refreshAuthUserProfile();
    } catch (refreshErr) {
      console.warn('⚠️ refreshUserProfile post-onboarding failed:', refreshErr);
    }

    console.log('✅ Onboarding completed with session:', sessionId);
  };

  const completeOnboarding = async () => {
    setIsLoading(true);

    try {
      await signInAnonymously();
      
      const { setDoc, doc, serverTimestamp } = await import('@react-native-firebase/firestore');
      const { db, auth } = await import('@/lib/firebase');
      
      // Vervollständige die Session
      const completionData: any = {
        userId: auth.currentUser?.uid || 'anonymous',
        sessionId,
        status: 'completed',
        currentStep: TOTAL_STEPS, // = 8
        lastUpdateTime: serverTimestamp(),
        completedAt: serverTimestamp(),
        country,
        weeklyBudgetEur: budget,
        priorities,
        estimatedSavingsPercent: 35,
        estimatedSavingsEurWeek: Math.round(budget * 0.35),
        version: 'v2',
        platform: 'mobile',
      };

      // Demographics: nur wenn nicht übersprungen.
      if (ageSkipped) {
        completionData.demographicsSkipped = true;
      } else {
        completionData.age = age;
        if (gender) completionData.gender = gender;
        if (gender === 'anderes' && genderOther.trim()) {
          completionData.genderOther = genderOther.trim();
        }
      }
      
      // Nur definierte optionale Felder hinzufügen
      if (selectedMarkets.length > 0) {
        completionData.favoriteMarkets = selectedMarkets.map(market => {
          if (market.isOther) {
            return { id: 'other', name: marketOther, isCustom: true };
          }
          return market;
        });
        // Hauptmarkt (erster ausgewählter)
        completionData.primaryMarket = selectedMarkets[0];
      }
      
      if (acquisitionSource && acquisitionSource !== '') {
        completionData.acquisitionSource = acquisitionSource;
        if (acquisitionSource === 'sonstiges' && acquisitionOther.trim() !== '') {
          completionData.acquisitionOther = acquisitionOther;
        }
      }
      
      if (priorities.includes('anderes') && prioritiesOther.trim() !== '') {
        completionData.prioritiesOther = prioritiesOther;
      }
      
      // Vervollständige die Session statt neues Dokument
      await setDoc(doc(db, 'onboardingResultsV5', sessionId), completionData);

      // ─── ALSO mirror the answers onto the user document ───
      //
      // The session doc in `onboardingResultsV5` is for analytics
      // / aggregation; the per-user mirror lives on `users/{uid}`
      // so screens like Profil, Belohnungen, Einkaufsliste-Filter
      // etc. can read the user's preferences directly without a
      // session-by-session lookup. Stored fields:
      //   • country               'DE' | 'AT' | 'CH'
      //   • favoriteMarkets       full market objects (with id)
      //   • primaryMarket         the first selected market — used
      //                            by the Favoriten card to flag
      //                            "this is YOUR shop"
      //   • weeklyBudgetEur       weekly grocery budget (number)
      //   • priorities            string[] selected priorities
      //   • acquisitionSource     marketing attribution
      //   • onboardingCompletedAt server timestamp
      //
      // Wrapped in try/catch so a failure here doesn't block the
      // user from finishing onboarding (the session doc above is
      // the authoritative copy for our analytics).
      try {
        const uid = auth.currentUser?.uid;
        if (uid) {
          const userPrefs: any = {
            country,
            weeklyBudgetEur: budget,
            priorities,
            onboardingCompletedAt: serverTimestamp(),
          };
          if (selectedMarkets.length > 0) {
            userPrefs.favoriteMarkets = completionData.favoriteMarkets;
            // `favoriteMarket` (singular, just the ID) is what the
            // Favorites screen reads to flag the heart-icon next
            // to the user's primary shop on each card.
            //
            // `favoriteMarketName` MUSS parallel mitgeschrieben werden
            // — sonst zeigt die Profil-Stat-Card "Dein Lieblingsmarkt"
            // gar nichts an (sie liest direkt den Namen-String, nicht
            // die ID). Bug-Fix: vor dieser Änderung war das Feld
            // ausschließlich vom Edit-Profil-Screen aus gesetzt
            // worden, sprich nur User die manuell die Profil-Maske
            // geöffnet hatten sahen ihren Lieblingsmarkt im Profil
            // tatsächlich.
            const primary = completionData.primaryMarket;
            if (primary?.id) {
              userPrefs.favoriteMarket = primary.id;
              userPrefs.favoriteMarketName = primary.name ?? '';
            }
            userPrefs.primaryMarket = primary;
          }
          if (acquisitionSource) {
            userPrefs.acquisitionSource = acquisitionSource;
            if (acquisitionSource === 'sonstiges' && acquisitionOther.trim() !== '') {
              userPrefs.acquisitionOther = acquisitionOther;
            }
          }
          if (priorities.includes('anderes') && prioritiesOther.trim() !== '') {
            userPrefs.prioritiesOther = prioritiesOther;
          }

          // Demographics ins User-Doc spiegeln (gleiche Felder wie
          // app/edit-profile.tsx schreibt — gender als Text, plus
          // ein Integer-age für Dashboard-Auswertung). birthDate
          // bleibt leer; Edit-Profile kann das später feiner setzen.
          if (!ageSkipped) {
            userPrefs.age = age;
            if (gender) {
              // Edit-Profile schreibt 'männlich' / 'weiblich' / 'divers'.
              // Wir mappen 'nonbinary' → 'divers' für Konsistenz mit
              // dem Edit-Profile-Schema.
              userPrefs.gender = GENDER_USERDOC_MAP[gender] ?? gender;
              if (gender === 'anderes' && genderOther.trim() !== '') {
                userPrefs.genderOther = genderOther.trim();
              }
            }
          }
          // Merge so we don't clobber unrelated fields on the user
          // doc (level, points, displayName, photo_url, …).
          await setDoc(doc(db, 'users', uid), userPrefs, { merge: true });
          console.log('✅ Onboarding answers mirrored to users/' + uid);
        }
      } catch (mirrorErr) {
        console.warn('⚠️ Failed to mirror onboarding answers to user doc:', mirrorErr);
      }

      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.default.setItem('onboarding_v1_completed', 'true');

      // KRITISCH: AuthContext.userProfile refreshen — siehe
      // persistOnboardingResults für die ausführliche Begründung.
      // Ohne diesen Refresh zeigt das Profil bei Anon-Usern stale
      // Daten (kein favoriteMarket etc.).
      try {
        await refreshAuthUserProfile();
      } catch (refreshErr) {
        console.warn('⚠️ refreshUserProfile post-onboarding failed:', refreshErr);
      }

      console.log('✅ Onboarding completed with session:', sessionId);

      // Verwende bereits gecheckte Premium-Status wenn verfügbar
      let currentPremiumStatus = isPremiumUser;
      
      // Nur neu prüfen wenn noch nicht gecheckt wurde
      if (!premiumStatusChecked) {
        console.log('🔄 Prüfe Premium Status direkt bei RevenueCat...');
        
        // Erst Käufe wiederherstellen
        try {
          const { revenueCatService } = await import('@/lib/services/revenueCatService');
          await revenueCatService.restorePurchases();
          console.log('✅ Käufe wiederhergestellt');
          
          // Dann direkt Premium Status prüfen
          currentPremiumStatus = await revenueCatService.isPremium();
          console.log('🛒 Premium Status von RevenueCat:', currentPremiumStatus);
        } catch (e) {
          console.log('⚠️ Konnte Käufe nicht wiederherstellen:', e);
        }
      } else {
        console.log('🛒 Verwende bereits geprüften Premium Status:', currentPremiumStatus);
      }
      
      // Remote Config prüfen für Paywall
      const shouldShowPaywall = await remoteConfigService.shouldShowOnboardingPaywall();
      
      console.log('🛒 Paywall Entscheidung:', { 
        shouldShowPaywall, 
        isPremium: currentPremiumStatus,
        willShowPaywall: shouldShowPaywall && !currentPremiumStatus 
      });
      
      // NUR Paywall zeigen wenn Remote Config JA sagt UND User KEIN Premium hat
      if (shouldShowPaywall && !currentPremiumStatus) {
        console.log('🛒 Zeige Onboarding Paywall (User hat kein Premium)');
        try {
          const paywallResult = await presentPaywall('onboarding');
          console.log('🛒 Paywall result:', paywallResult.result);
        } catch (error) {
          console.error('❌ Paywall error:', error);
          // App soll trotzdem weiterlaufen
        }
      } else {
        if (currentPremiumStatus) {
          console.log('✅ User hat bereits Premium - keine Paywall!');
        } else {
          console.log('🛒 Remote Config: Paywall deaktiviert');
        }
      }
      
      // WICHTIG: Premium Status Force-Refresh VOR Navigation!
      try {
        await refreshPremiumStatus();
      } catch (error) {
        console.warn('⚠️ Premium Status Refresh fehlgeschlagen:', error);
      }
      
      // Zur App navigieren
      router.replace('/(tabs)');
      
    } catch (error) {
      console.error('❌ Onboarding error:', error);
      Alert.alert('Fehler', 'Onboarding konnte nicht abgeschlossen werden');
      // Fallback zur App auch bei Fehlern
      router.replace('/(tabs)');
    } finally {
      setIsLoading(false);
    }
  };

  // Progress läuft von Step 2 (Märkte = "1 von 6") bis Step 7 (Loading-
  // Eintritt = "6 von 6"). Step 1 ist Hero (kein Progress) + Step 8 ist
  // Climax (kein Progress mehr — Confetti spricht für sich).
  const PROGRESS_DENOM = TOTAL_STEPS - 2; // = 6 sichtbare Frage-Schritte
  const renderProgressBar = () => (
    <View style={styles.progressContainer}>
      <View style={styles.progressBar}>
        <View
          style={[
            styles.progressFill,
            {
              width:
                Math.min(
                  ((currentStep - 1) / PROGRESS_DENOM) * 100,
                  100,
                ) + '%',
            },
          ]}
        />
      </View>
      <Text style={styles.progressText}>
        {Math.min(currentStep - 1, PROGRESS_DENOM)} von {PROGRESS_DENOM}
      </Text>
    </View>
  );

  /**
   * Compact Skip-Pill — eigene Row, rechtsbündig, sitzt UNTER der
   * ProgressBar.
   * Wird auf Step 2 (Märkte — 'Onboarding überspringen' → direkt
   * in die App) und Step 5 (Alter+Geschlecht — 'Schritt
   * überspringen' → demographics skip + nächster Step) verwendet.
   *
   * Vorher: position absolute oben rechts → kollidierte mit
   * Status-Bar / Dynamic-Island bzw. mit der ProgressBar-Row.
   * Jetzt: normale Flow-Row, kein Z-index-Konflikt.
   */
  const renderSkipPill = (label: string, onPress: () => void) => (
    <View style={styles.skipPillRow}>
      <TouchableOpacity
        style={styles.skipPill}
        onPress={onPress}
        activeOpacity={0.7}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
        <Text style={styles.skipPillText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );

  // Loading Screen
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colorScheme === 'dark' ? Colors.dark.background : Colors.light.background }]}>
        <View style={styles.loadingContent}>
          <ActivityIndicator size="large" color={colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint} />
          <Text style={[styles.loadingMessage, { color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text, marginTop: 20 }]}>
            {loadingStatus || 'App wird das erste Mal gestartet...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Step 1: Hero
  if (currentStep === 1) {
    return (
      <>
        <StatusBar hidden={true} />
        <Animated.View style={[styles.heroBackground, { opacity: backgroundOpacity }]}>
          <ImageBackground
            source={require('@/assets/images/background.jpg')}
            style={styles.heroBackground}
            resizeMode="cover"
          >
          <LinearGradient
            colors={[
              'rgba(0, 0, 0, 0.1)', // Oben: Fast transparent (10%)
              'rgba(0, 0, 0, 0.3)', // Mitte: Leicht dunkler (20%)
              'rgba(0, 0, 0, 0.9)'  // Unten: Dunkler für Button-Bereich (50%)
            ]}
            style={styles.heroGradient}
            locations={[0, 0.7, 1]} // Gradient-Verteilung
          />
          
          <SafeAreaView style={styles.heroContainer}>
            <Animated.View 
              style={[
                styles.heroContent,
                {
                  transform: [{
                    translateX: slideAnimation, // Direkte Translation: width → 0
                  }],
                }
              ]}
            >
              <View style={styles.heroLogoSection}>
                <View style={styles.logoContainer}>
                  <CustomIcon 
                    name="iconBlack" 
                    size={140} 
                    color="white"
                    style={Platform.OS === 'ios' ? styles.logoWithShadow : {}}
                  />
                  <Text style={styles.heroBrandTitle}>MarkenDetektive</Text>
                  <Text style={styles.heroBrandSubtitle}>NoNames enttarnen, clever sparen!</Text>
                </View>
              </View>
              
           

              <View style={styles.heroButtonContainer}>
                {/* Hero hat NUR den Primary-CTA. Skip-Option ist
                    auf dem nächsten Step (Märkte) als dezente Pill
                    oben rechts — so will's der ClickUp-Task. */}
                <TouchableOpacity style={styles.heroPrimaryButton} onPress={nextStep}>
                  <Text style={styles.heroPrimaryButtonText}>Los geht's! 🚀</Text>
                </TouchableOpacity>

                <Text style={styles.heroBottomText}>Wir zeigen dir, wer dahinter steckt!</Text>
              </View>
            </Animated.View>
          </SafeAreaView>
          </ImageBackground>
        </Animated.View>
      </>
    );
  }

  // Step 2: Märkte (vorher Step 3 — Land+Auth-Step ist weg, country
  // kommt jetzt aus detectCountry() mit Pill-Override hier inline).
  if (currentStep === 2) {
    return (
      <>
        <StatusBar hidden={false} />
        <SafeAreaView style={styles.container}>
        <Animated.View
          style={[
            styles.content,
            {
              transform: [{
                translateX: slideAnimation, // Direkte Translation: width → 0
              }],
            }
          ]}
        >
          {renderProgressBar()}
          {renderSkipPill('Onboarding überspringen', skipOnboarding)}


          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wo kaufst du am liebsten ein?</Text>
             {/* Country-Toggle (Pills): wir haben das Land aus der
                 Device-Locale vorbelegt (DE/AT/CH), aber falls's
                 daneben liegt kann der User hier kompakt korrigieren.
                 Die explizite Länderauswahl als eigener Step ist
                 eingespart. */}
             <View style={styles.countryToggleRow}>
               {COUNTRIES.map(c => (
                 <TouchableOpacity
                   key={c.code}
                   style={[
                     styles.countryTogglePill,
                     country === c.code && styles.countryTogglePillActive,
                   ]}
                   onPress={() => setCountry(c.code as DachCountry)}
                   activeOpacity={0.7}
                 >
                   <Text style={styles.countryToggleFlag}>{c.flag}</Text>
                   <Text style={styles.countryToggleText}>{c.name}</Text>
                 </TouchableOpacity>
               ))}
             </View>
             <Text style={styles.counter}>{selectedMarkets.length}/3 ausgewählt</Text>
             {/* Hinweis dass der ERSTE ausgewählte Markt zum Lieblingsmarkt
                 wird. Sichtbar erst nachdem mindestens ein Markt
                 selektiert ist — sonst zeigt der Satz ins Leere. Der
                 Code unten setzt zusätzlich ein gold-Heart-Badge auf
                 selectedMarkets[0], sodass der Zusammenhang
                 "erster = Liebling" auch visuell verankert ist. */}
             {selectedMarkets.length > 0 ? (
               <View style={styles.primaryMarketHintRow}>
                 <MaterialCommunityIcons
                   name="heart"
                   size={13}
                   color={Colors.light.tint}
                   style={{ marginRight: 6 }}
                 />
                 <Text style={styles.primaryMarketHint}>
                   Dein zuerst gewählter Markt wird zu deinem Lieblingsmarkt
                 </Text>
               </View>
             ) : null}

            <FlatList
              data={markets}
              numColumns={2}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = selectedMarkets.some(m => m.id === item.id);
                const isDisabled = !isSelected && selectedMarkets.length >= 3;
                // Lieblingsmarkt = der ERSTE im Array. Wenn der User
                // den deselektiert und einen anderen wählt, wandert
                // das Heart-Badge automatisch mit, weil
                // selectedMarkets[0] sich ändert.
                const isPrimary = isSelected && selectedMarkets[0]?.id === item.id;

                return (
                  <TouchableOpacity
                    style={[
                      styles.marketOption,
                      isSelected && styles.optionSelected,
                      isDisabled && styles.optionDisabled
                    ]}
                    onPress={() => {
                      if (isSelected) {
                        setSelectedMarkets(selectedMarkets.filter(m => m.id !== item.id));
                        if (item.isOther) {
                          setMarketOther('');
                        }
                      } else if (selectedMarkets.length < 3) {
                        setSelectedMarkets([...selectedMarkets, item]);
                      }
                    }}
                    disabled={isDisabled}
                  >
                    {item.bild ? (
                      <Image source={{ uri: item.bild }} style={styles.marketLogo} />
                    ) : (
                      <Text style={styles.optionIcon}>{item.logo || '🛒'}</Text>
                    )}
                    <Text
                      style={[
                        styles.marketText,
                        isSelected && styles.optionTextSelected,
                        isDisabled && styles.optionTextDisabled
                      ]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {/* Selected-Indikator: für den primary-Markt
                        ein Heart-Badge (visuelle Doppelaufgabe:
                        "ausgewählt" UND "Liebling"), für alle
                        weiteren Selected-Tiles der bisherige
                        Checkmark. Ein Tile bekommt also genau EINE
                        Auszeichnung — niemals beide gleichzeitig —
                        damit's nicht doppelt-tagged wirkt. */}
                    {isPrimary ? (
                      <View style={styles.primaryHeartBadge}>
                        <MaterialCommunityIcons name="heart" size={14} color="#fff" />
                      </View>
                    ) : isSelected ? (
                      <Text style={styles.checkmark}>✓</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />

            {selectedMarkets.some(m => m.isOther) && (
              <View style={styles.textInputContainer}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Welcher Markt ist das?"
                  value={marketOther}
                  onChangeText={setMarketOther}
                  maxLength={50}
                  placeholderTextColor={colorScheme === 'dark' ? Colors.dark.text + '80' : Colors.light.text + '80'}
                />
              </View>
            )}
          </View>

          <View style={styles.buttonContainer}>
            <OnboardingButton 
              title="Weiter" 
              onPress={nextStep}
              disabled={
                selectedMarkets.length === 0 || 
                (selectedMarkets.some(m => m.isOther) && marketOther.trim() === '')
              }
            />
          </View>
        </Animated.View>
      </SafeAreaView>
      </>
    );
  }

  // Step 6: Akquisition (vorher Step 4 — psychologisch ans Ende
  // verschoben, weil's eine egoistische Frage des Unternehmens ist).
  if (currentStep === 6) {
    return (
      <>
        <StatusBar hidden={false} />
        <SafeAreaView style={styles.container}>
        <Animated.View 
          style={[
            styles.content,
            {
              transform: [{
                translateX: slideAnimation, // Direkte Translation: width → 0
              }],
            }
          ]}
        >
          {renderProgressBar()}
          

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wie hast du von uns gehört?</Text>
            
            <FlatList
              data={ACQUISITION_SOURCES}
              numColumns={2}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.marketOption, acquisitionSource === item.id && styles.optionSelected]}
                  onPress={() => setAcquisitionSource(item.id)}
                >
                  <Text style={styles.marketIcon}>{item.icon}</Text>
                  <Text 
                    style={[styles.marketText, acquisitionSource === item.id && styles.optionTextSelected]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {item.name}
                  </Text>
                  {acquisitionSource === item.id && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              )}
            />

            {acquisitionSource === 'sonstiges' && (
              <View style={styles.textInputContainer}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Woher genau?"
                  value={acquisitionOther}
                  onChangeText={setAcquisitionOther}
                  maxLength={50}
                  placeholderTextColor={colorScheme === 'dark' ? Colors.dark.text + '80' : Colors.light.text + '80'}
                />
              </View>
            )}
          </View>

          <View style={styles.buttonContainer}>
            <OnboardingButton 
              title="Weiter" 
              onPress={nextStep}
              disabled={acquisitionSource === 'sonstiges' && acquisitionOther.trim() === ''}
            />
          </View>
        </Animated.View>
      </SafeAreaView>
      </>
    );
  }

  // Step 3: Wocheneinkauf in € (vorher Step 5).
  if (currentStep === 3) {
    return (
      <>
        <StatusBar hidden={false} />
        <SafeAreaView style={styles.container}>
        <Animated.View 
          style={[
            styles.content,
            {
              transform: [{
                translateX: slideAnimation, // Direkte Translation: width → 0
              }],
            }
          ]}
        >
          {renderProgressBar()}
          

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wieviel gibst du wöchentlich für deinen Einkauf aus?</Text>
            <Text style={styles.subtitle}>Das hilft uns, dein persönliches Sparpotenzial zu berechnen.</Text>
            
            <View style={styles.budgetContainer}>
              <Text style={styles.budgetValue}>{budget}€</Text>
              <Text style={styles.budgetLabel}>pro Woche</Text>
            </View>

            <Slider
              style={styles.slider}
              minimumValue={25}
              maximumValue={500}
              value={budget}
              onValueChange={(value) => {
                const roundedValue = Math.round(value);
                if (roundedValue !== budget) {
                  // Haptisches Feedback nur bei Änderung
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setBudget(roundedValue);
                }
              }}
              minimumTrackTintColor={colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint}
              maximumTrackTintColor={colorScheme === 'dark' ? Colors.dark.border : Colors.light.tabIconDefault}
              step={5}
            />
            
            <View style={styles.sliderLabels}>
              <Text style={styles.sliderLabel}>25€</Text>
              <Text style={styles.sliderLabel}>500€</Text>
            </View>
          </View>

          <View style={styles.buttonContainer}>
            <OnboardingButton title="Weiter" onPress={nextStep} />
          </View>
        </Animated.View>
      </SafeAreaView>
      </>
    );
  }

  // Step 4: Prioritäten (vorher Step 6).
  if (currentStep === 4) {
    return (
      <>
        <StatusBar hidden={false} />
        <SafeAreaView style={styles.container}>
        <Animated.View 
          style={[
            styles.content,
            {
              transform: [{
                translateX: slideAnimation, // Direkte Translation: width → 0
              }],
            }
          ]}
        >
          {renderProgressBar()}
          

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Was ist dir beim Einkauf wichtig?</Text>
            <Text style={styles.subtitle}>Wähle bis zu 3 Aspekte</Text>
            <Text style={styles.counter}>{priorities.length}/3 ausgewählt</Text>
            
            <FlatList
              data={PRIORITIES}
              numColumns={2}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = priorities.includes(item.id);
                const isDisabled = !isSelected && priorities.length >= 3;
                
                return (
                  <TouchableOpacity
                    style={[
                      styles.marketOption,
                      isSelected && styles.optionSelected,
                      isDisabled && styles.optionDisabled
                    ]}
                    onPress={() => {
                      if (isSelected) {
                        setPriorities(priorities.filter(p => p !== item.id));
                        if (item.id === 'anderes') {
                          setPrioritiesOther('');
                        }
                      } else if (priorities.length < 3) {
                        setPriorities([...priorities, item.id]);
                      }
                    }}
                    disabled={isDisabled}
                  >
                    <Text style={styles.marketIcon}>{item.icon}</Text>
                    <Text style={[
                      styles.marketText,
                      isSelected && styles.optionTextSelected,
                      isDisabled && styles.optionTextDisabled
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    >
                      {item.name}
                    </Text>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              }}
            />

            {priorities.includes('anderes') && (
              <View style={styles.textInputContainer}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Was ist dir sonst noch wichtig?"
                  value={prioritiesOther}
                  onChangeText={setPrioritiesOther}
                  maxLength={50}
                  placeholderTextColor={colorScheme === 'dark' ? Colors.dark.text + '80' : Colors.light.text + '80'}
                />
              </View>
            )}
          </View>

          <View style={styles.buttonContainer}>
            <OnboardingButton 
              title="Weiter" 
              onPress={nextStep}
              disabled={
                priorities.length === 0 || 
                (priorities.includes('anderes') && prioritiesOther.trim() === '')
              }
            />
          </View>
        </Animated.View>
      </SafeAreaView>
      </>
    );
  }

  // Step 5: Alter + Geschlecht (NEU im Redesign).
  //
  // Psychologie-Position: User hat bereits 3 Steps (Märkte/Budget/
  // Prioritäten) ausgefüllt → Sunk-Cost-Fallacy macht ihn weniger
  // abbruchfreudig. Plus: Wording verspricht direkten Mehrwert
  // ("für maßgeschneiderte Alternativen / Vergleich mit deiner
  // Zielgruppe") statt trockener Demographic-Abfrage.
  //
  // Der "Schritt überspringen"-Pill oben rechts ist EXTREM wichtig
  // (User-Wunsch im ClickUp-Task) — wer sein Alter / Geschlecht
  // nicht teilen will bleibt im Funnel ohne Bauchschmerzen.
  if (currentStep === 5) {
    return (
      <>
        <StatusBar hidden={false} />
        <SafeAreaView style={styles.container}>
          <Animated.View
            style={[
              styles.content,
              {
                transform: [{
                  translateX: slideAnimation,
                }],
              },
            ]}
          >
            {renderProgressBar()}
            {renderSkipPill('Schritt überspringen', skipDemographicsStep)}

            <ScrollView
              style={styles.innerScrollView}
              contentContainerStyle={styles.innerScrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.mainContent}>
                <Text style={styles.stepTitle}>Wie alt bist du?</Text>
                <Text style={styles.subtitle}>
                  Für maßgeschneiderte Alternativen — vergleiche
                  deine Favoriten mit Leuten aus deiner Zielgruppe.
                </Text>

                {/* Alter — Slider mit groß angezeigtem Wert (gleiches
                    Pattern wie der Wocheneinkauf-Slider). Default 30,
                    Range 16-80. */}
                <View style={styles.ageDisplayContainer}>
                  <Text style={styles.ageDisplay}>{age}</Text>
                  <Text style={styles.ageDisplayLabel}>Jahre</Text>
                </View>
                <Slider
                  style={styles.ageSlider}
                  minimumValue={AGE_MIN}
                  maximumValue={AGE_MAX}
                  value={age}
                  step={1}
                  onValueChange={(v) => {
                    setAge(Math.round(v));
                    if (ageSkipped) setAgeSkipped(false);
                  }}
                  minimumTrackTintColor={Colors.light.tint}
                  maximumTrackTintColor={
                    colorScheme === 'dark'
                      ? 'rgba(255,255,255,0.2)'
                      : 'rgba(0,0,0,0.15)'
                  }
                  thumbTintColor={Colors.light.tint}
                />
                <View style={styles.ageSliderLabels}>
                  <Text style={styles.ageSliderLabel}>{AGE_MIN}</Text>
                  <Text style={styles.ageSliderLabel}>{AGE_MAX}+</Text>
                </View>

                {/* Geschlecht — 4 Pills mit Custom-Input bei "Anderes". */}
                <Text
                  style={[
                    styles.stepTitle,
                    { fontSize: 22, marginTop: 32, marginBottom: 12 },
                  ]}
                >
                  Geschlecht
                </Text>
                <View style={styles.genderRow}>
                  {GENDER_OPTIONS.map((opt) => {
                    const active = gender === opt.id;
                    return (
                      <TouchableOpacity
                        key={opt.id}
                        style={[
                          styles.genderPill,
                          active && styles.genderPillActive,
                        ]}
                        onPress={() => {
                          setGender(opt.id);
                          if (ageSkipped) setAgeSkipped(false);
                          if (opt.id !== 'anderes') setGenderOther('');
                        }}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.genderPillText,
                            active && styles.genderPillTextActive,
                          ]}
                        >
                          {opt.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {gender === 'anderes' && (
                  <TextInput
                    style={styles.genderOtherInput}
                    placeholder="Wie möchtest du dich beschreiben? (optional)"
                    placeholderTextColor={
                      colorScheme === 'dark'
                        ? Colors.dark.text + '70'
                        : Colors.light.text + '70'
                    }
                    value={genderOther}
                    onChangeText={setGenderOther}
                    maxLength={40}
                  />
                )}
              </View>
            </ScrollView>

            <View style={styles.buttonContainer}>
              {/* Weiter erst aktiv wenn Geschlecht gewählt wurde
                  (User-Wunsch). Wer Demographics gar nicht teilen
                  will → 'Schritt überspringen'-Pill oben rechts.
                  Bei 'Anderes' zusätzlich genderOther optional —
                  Custom-Text ist nice-to-have, nicht required. */}
              <OnboardingButton
                title="Weiter"
                onPress={nextStep}
                disabled={!gender}
              />
            </View>
          </Animated.View>
        </SafeAreaView>
      </>
    );
  }

  // Step 7: Loading
  if (currentStep === 7) {
    return (
      <>
        <StatusBar hidden={false} />
        <SafeAreaView style={styles.container}>
        <Animated.View 
          style={[
            styles.content,
            {
              transform: [{
                translateX: slideAnimation, // Direkte Translation: width → 0
              }],
            }
          ]}
        >
          {renderProgressBar()}
          
          <View style={styles.loadingContent}>
            <LottieView
              source={require('@/assets/lottie/sandyloader.json')}
              autoPlay
              loop={true}
              style={styles.sandyLoaderLottie}
            />
            <Text style={styles.title}>MarkenDetektive am Werk</Text>
            <Text style={styles.subtitle}>Wir optimieren dein App-Erlebnis</Text>
            
            <View style={styles.loadingMessageContainer}>
              <Text style={styles.loadingMessage}>{loadingMessage}</Text>
            </View>
            
            <View style={styles.loadingBarContainer}>
              <Animated.View
                style={[
                  styles.loadingBar,
                  {
                    width: loadingProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>
      </>
    );
  }

  // Step 8: Savings Chart - Komplett neu mit Animationen
  if (currentStep === 8) {
    const weeklySavings = Math.round(budget * 0.35);
    const monthlySavings = Math.round(weeklySavings * 4.33); // 52 Wochen / 12 Monate = 4.33
    const yearlySavings = weeklySavings * 52;
    
    return (
      <>
        <StatusBar hidden={false} />
        <SafeAreaView style={styles.savingsContainer}>
          {/* Konfetti-Effekt */}
          <ConfettiCannon
            ref={confettiRef}
            count={150}
            origin={{ x: width / 2, y: -10 }}
            autoStart={false}
            fadeOut={true}
            fallSpeed={3000}
            explosionSpeed={400}
            colors={[Colors.light.tint, '#FFD700', '#FFA500', '#FF6B6B', '#4ECDC4']}
          />
          
          <Animated.View 
            style={[
              styles.savingsContent,
              {
                transform: [{
                  translateX: slideAnimation,
                }],
              }
            ]}
          >
            {renderProgressBar()}

            <ScrollView 
              style={styles.savingsScrollView}
              contentContainerStyle={styles.savingsScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Hero Section mit Lottie Animation */}
              <View style={styles.savingsHero}>
                <LottieView
                  source={require('@/assets/lottie/money.json')}
                  autoPlay
                  loop={false}
                  style={styles.moneyLottie}
                />
                <Text style={styles.savingsHeroTitle}>Dein Sparpotenzial!</Text>
                <Text style={styles.savingsHeroSubtitle}>
                  Basierend auf deinem Wocheneinkauf von {budget}€
                </Text>
              </View>

              {/* Hauptfokus: Jahresersparnis (größter Impact) */}
              <View style={styles.yearlyHighlight}>
                <Text style={styles.yearlyLabel}>🏆 Deine Jahresersparnis</Text>
                <Text style={styles.yearlyAmount}>{yearlySavings}€</Text>
                <Text style={styles.yearlySubtext}>
                  Das sind {monthlySavings}€ jeden Monat!
                </Text>
              </View>

              {/* Sekundärer Fokus: Monats- und Wochenersparnis */}
              <View style={styles.monthlyContainer}>
                <View style={styles.monthlyCard}>
                  <Text style={styles.monthlyAmount}>{monthlySavings}€</Text>
                  <Text style={styles.monthlyLabel}>pro Monat</Text>
                </View>
                <View style={styles.monthlySeparator} />
                <View style={styles.monthlyCard}>
                  <Text style={styles.monthlyAmount}>{weeklySavings}€</Text>
                  <Text style={styles.monthlyLabel}>pro Woche</Text>
                </View>
              </View>

            </ScrollView>

            {/* ─── Climax-Auth-CTAs ──────────────────────────────────
                Vorher: nur "Fantastisch! Weiter" → führte auf einen
                separaten Step 9 mit "App starten"-Button. Der Step 9
                ist eliminiert (User-Wunsch im ClickUp-Task).

                Jetzt direkt auf der Climax-Seite: zwei CTAs.
                Primary (groß, brand-grün): "Profil sichern & App
                starten" → öffnet Auth-Sheet (login.tsx). Apple/
                Google/Email-Login linkt automatisch via
                linkOrSignIn (Phase 1) → die anonymen Onboarding-
                Antworten + UID bleiben erhalten.
                Secondary (dezenter Text-Link): "Als Gast
                fortfahren" → speichert Onboarding (anon-User), ab
                in die App. User kann später aus dem Profil heraus
                ein Konto anlegen, Daten bleiben erhalten (Phase 1
                liefert das mit). */}
            <View style={[styles.buttonContainer, styles.climaxAuthSection]}>
              <Text style={styles.climaxAuthHeadline}>
                Sichere dein Sparpotenzial
              </Text>
              <Text style={styles.climaxAuthSubline}>
                Erstelle ein Profil, damit deine Antworten + Punkte
                geräteübergreifend bleiben.
              </Text>
              <OnboardingButton
                title="👉  Profil sichern & App starten"
                onPress={completeOnboardingForAuth}
                loading={isLoading}
              />
              <TouchableOpacity
                style={styles.climaxGuestLink}
                onPress={completeOnboarding}
                disabled={isLoading}
              >
                <Text style={styles.climaxGuestLinkText}>
                  Als Gast fortfahren
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </SafeAreaView>
      </>
    );
  }

  // Fallback: sollte nie greifen (Step 1-8 decken alles ab) — bloß
  // ein Safety-Net falls currentStep mal außerhalb der Range landet.
  // Vorher war hier ein eigenständiger "App starten"-Step 9 — der ist
  // ins Climax (Step 8) gewandert.
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.completionContent}>
          <ActivityIndicator size="large" color={Colors.light.tint} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colorScheme: 'light' | 'dark') => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.background : '#f8f9fa',
  },
  // ─── Skip-Pill (eigene Row unter der ProgressBar) ──────────────────
  skipPillRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 4,
    marginTop: -4, // näher an der ProgressBar (war 20 unten)
    marginBottom: 8,
  },
  skipPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
  },
  skipPillText: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.6,
    letterSpacing: 0.2,
  },
  // ─── Country-Toggle (kompakt auf Step 2 Märkte) ────────────────────
  countryToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    justifyContent: 'center',
  },
  countryTogglePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  countryTogglePillActive: {
    backgroundColor: colorScheme === 'dark'
      ? 'rgba(76,175,80,0.18)'
      : 'rgba(76,175,80,0.10)',
    borderColor: Colors.light.tint,
  },
  countryToggleFlag: {
    fontSize: 16,
  },
  countryToggleText: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
  },
  // ─── Demographics (Step 5: Alter + Geschlecht) ─────────────────────
  ageDisplayContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  ageDisplay: {
    fontSize: 56,
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
    letterSpacing: -1,
  },
  ageDisplayLabel: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.6,
    marginTop: 4,
  },
  ageSlider: {
    width: '100%',
    height: 40,
    marginTop: 8,
  },
  ageSliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  ageSliderLabel: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.5,
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 24,
  },
  genderPill: {
    flex: 1,
    minWidth: '45%',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.cardBackground : '#ffffff',
    borderWidth: 1.5,
    borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderPillActive: {
    borderColor: Colors.light.tint,
    backgroundColor: colorScheme === 'dark'
      ? 'rgba(76,175,80,0.16)'
      : 'rgba(76,175,80,0.08)',
  },
  genderPillText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
  },
  genderPillTextActive: {
    color: Colors.light.tint,
    fontFamily: 'Nunito_700Bold',
  },
  genderOtherInput: {
    marginTop: 14,
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    backgroundColor: colorScheme === 'dark' ? Colors.dark.cardBackground : '#ffffff',
    borderWidth: 1,
    borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
  },
  // ─── Climax (Step 8) Auth-CTAs ─────────────────────────────────────
  climaxAuthSection: {
    marginTop: 8,
    paddingHorizontal: 4,
  },
  climaxAuthHeadline: {
    fontSize: 17,
    fontFamily: 'Nunito_700Bold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  climaxAuthSubline: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.65,
    textAlign: 'center',
    marginBottom: 16,
  },
  climaxGuestLink: {
    marginTop: 14,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  climaxGuestLinkText: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.55,
    textDecorationLine: 'underline',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    minHeight: Dimensions.get('window').height - 100,
  },
  innerScrollView: {
    flex: 1,
  },
  innerScrollContent: {
    flexGrow: 1,
    paddingBottom: 280, // Genug Platz für die fixierten Buttons
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 30, // Mehr Platz ohne Zurück-Button
  },
  progressContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  progressBar: {
    width: '100%',
    height: 6, // Dicker für bessere Sichtbarkeit
    backgroundColor: '#e0e0e0', // Hellgrauer Hintergrund
    borderRadius: 3,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    borderRadius: 3,
    ...Platform.select({
      ios: {
        shadowColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  progressText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.6,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 20,
  },
  backButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.tint,
  },
  // Hero Screen Styles (mit Hintergrundbild)
  heroBackground: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContainer: {
    flex: 1,
  },
  heroContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40, // Weniger Top-Padding
  },
  heroLogoSection: {
    alignItems: 'center',
    marginTop: 18, // 60 → 48 (20% nach oben)
    marginBottom: 14, // 80 → 64 (20% weniger)
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoWithShadow: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.6,
      shadowRadius: 8,
    },
    android: {
      elevation: 0, // Kein Elevation auf Android - verhindert Abschneiden
    },
  }) as ViewStyle,
  heroBrandTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    marginTop: 6,
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.8)', // Stärkerer Schatten
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  heroBrandSubtitle: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: 'white',
    opacity: 0.95,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.6)', // Stärkerer Schatten
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  heroValueSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  heroSubtitle: {
    fontSize: 20,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
    textAlign: 'center',
    lineHeight: 30,
    textShadowColor: 'rgba(0, 0, 0, 0.8)', // Stärkerer Schatten
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  heroButtonContainer: {
    gap: 20,
    paddingBottom: 40,
    marginTop: 'auto',
  },
  heroPrimaryButton: {
    backgroundColor: Colors.light.tint,
    paddingVertical: 20, // Größer nur für Hero
    paddingHorizontal: 40, // Breiter nur für Hero
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 60, // Höher nur für Hero
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  heroPrimaryButtonText: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  heroSecondaryButton: {
    backgroundColor: Platform.OS === 'ios' ? '#FFFFFF26' : '#3d3d3d', // Hex statt rgba
    borderWidth: 2,
    borderColor: '#FFFFFF99', // Hex statt rgba
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  heroSecondaryButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: 'white',
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  heroBottomText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: 'white',
    textAlign: 'center',
    opacity: 0.9,
    marginTop: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.6)', // Stärkerer Schatten
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  // Normale Screens (ohne Hintergrundbild)
  brandTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
    marginTop: 16,
    marginBottom: 8,
  },
  brandSubtitle: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.text,
    opacity: 0.7,
    textAlign: 'center',
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 17,
    fontFamily: 'Nunito_500Medium',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: 10,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: colorScheme === 'dark' ? Colors.dark.text : '#1a1a1a',
    marginBottom: 10,
    textAlign: 'center',
    lineHeight: 32,
  },
  mainContent: {
    flex: 1,
  },
  authSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.background : '#f8f9fa',
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
  },
  authTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'Nunito_600SemiBold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  authSubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  authInfoText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
    opacity: 0.5,
    marginTop: 12,
  },
  countryLayout: {
    gap: 12,
    marginBottom: 40,
  },
  countryMain: {
    padding: 32,
    borderRadius: 16,
    backgroundColor: colorScheme === 'dark' ? '#2C2C2C' : '#FFFFFF', // Solide Farben
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colorScheme === 'dark' ? '#444444' : '#E0E0E0', // Solide Farben
    minHeight: 140,
    justifyContent: 'center',
    marginHorizontal: 6,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 0, // Kein Schatten auf Android
      },
    }),
  },
  countryMainFlag: {
    fontSize: 32, // Größere Flagge
    marginBottom: 12,
  },
  countryMainText: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
  },
  countrySecondary: {
    flexDirection: 'row',
    gap: 12,
  },
  countrySmall: {
    flex: 1,
    padding: 20,
    borderRadius: 16,
    backgroundColor: colorScheme === 'dark' ? '#2C2C2C' : '#FFFFFF', // Solide Farben
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colorScheme === 'dark' ? '#444444' : '#E0E0E0', // Solide Farben
    minHeight: 100,
    justifyContent: 'center',
    margin: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 0, // Kein Schatten auf Android
      },
    }),
  },
  countrySmallFlag: {
    fontSize: 24,
    marginBottom: 8,
  },
  countrySmallText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
  },
  optionSelected: {
    backgroundColor: colorScheme === 'dark' ? '#3A5F4F' : '#E8F5E9', // Solide Farben
    borderColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    borderWidth: 2,
    ...Platform.select({
      ios: {
        shadowColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
        shadowOpacity: 0.3,
      },
      android: {},
    }),
  },
  optionDisabled: {
    opacity: 0.3,
  },
  optionTextSelected: {
    color: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    fontFamily: 'Nunito_700Bold',
  },
  optionTextDisabled: {
    opacity: 0.5,
  },
  marketOption: {
    flex: 1,
    margin: 6,
    padding: 17,
    borderRadius: 16,
    backgroundColor: colorScheme === 'dark' ? '#2C2C2C' : '#FFFFFF', // Solide Farben
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colorScheme === 'dark' ? '#444444' : '#E0E0E0', // Solide Farben
    minHeight: 110,
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 0, // Kein Schatten auf Android
      },
    }),
  },
  marketLogo: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginBottom: 12,
    resizeMode: 'contain', // Verhindert Abschneiden
  },
  marketIcon: {
    fontSize: 28,
    marginBottom: 12,
  },
  marketText: {
    fontSize: 15,
    fontFamily: 'Nunito_600SemiBold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
  },
  checkmark: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    color: 'white',
    fontSize: 12,
    fontFamily: 'Nunito_700Bold',
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    lineHeight: 20,
    overflow: 'hidden',
  },
  textInputContainer: {
    marginTop: 24, // Mehr Abstand oben
    marginBottom: 24, // Mehr Abstand zum Button
  },
  textInput: {
    height: 48,
    borderRadius: 18,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.cardBackground : 'white',
    paddingHorizontal: 16,
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    borderWidth: 1,
    borderColor: colorScheme === 'dark' ? Colors.dark.border : '#00000010',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  budgetContainer: {
    alignItems: 'center',
    marginVertical: 40,
  },
  budgetValue: {
    fontSize: 48,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    marginBottom: 8,
  },
  budgetLabel: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.7,
  },
  slider: {
    width: '100%',
    height: 80,
    marginBottom: 20,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  sliderLabel: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.6,
  },
  counter: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: Colors.light.tint,
    textAlign: 'center',
    marginBottom: 8,
  },
  primaryMarketHintRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 24,
  },
  primaryMarketHint: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.7,
    textAlign: 'center',
  },
  // Gold-tönend, klar abgesetzt vom primary-Tint Checkmark der
  // Standard-Selected-Tiles. Macht den Lieblingsmarkt-Status
  // unverkennbar — Form (Heart vs. Check) UND Farbe (gold vs.
  // primary) differenzieren.
  primaryHeartBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E91E63',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.18,
        shadowRadius: 2,
      },
      android: { elevation: 2 },
    }),
  },
  checkmark: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: Colors.light.tint,
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: 'center',
    lineHeight: 24,
  },
  loadingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  loadingMessageContainer: {
    marginVertical: 30,
    minHeight: 60,
    justifyContent: 'center',
  },
  loadingMessage: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.tint,
    textAlign: 'center',
  },
  loadingBarContainer: {
    width: '80%',
    height: 10, // Dicker für bessere Sichtbarkeit
    backgroundColor: '#e0e0e0', // Hellgrauer Hintergrund
    borderRadius: 5,
    marginTop: 40,
    overflow: 'hidden',
  },
  loadingBar: {
    height: '100%',
    backgroundColor: Colors.light.tint, // Primary Green
    borderRadius: 5,
    shadowColor: Colors.light.tint,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 3,
  },
  // Savings Chart Styles (komplett neu)
  savingsHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  savingsIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  savingsVisualization: {
    flex: 1,
    justifyContent: 'center',
  },
  comparisonContainer: {
    marginBottom: 30,
  },
  comparisonItem: {
    marginBottom: 16,
  },
  comparisonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  comparisonIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  comparisonTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: Colors.light.text,
  },
  priceBar: {
    height: 50,
    backgroundColor: Colors.light.tabIconDefault + '40',
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  priceBarFill: {
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  brandBar: {
    backgroundColor: Colors.light.text + '20',
  },
  noNameBar: {
    backgroundColor: Colors.light.tint,
  },
  priceBarText: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
  },
  vsContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  vsText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: Colors.light.text,
    opacity: 0.6,
    backgroundColor: Colors.light.tabIconDefault,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  savingsCard: {
    backgroundColor: Colors.light.tint + '10',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.light.tint + '30',
    marginBottom: 20,
  },
  savingsCardTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.text,
    opacity: 0.8,
    marginBottom: 8,
  },
  savingsCardAmount: {
    fontSize: 40,
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
    marginBottom: 4,
  },
  savingsCardSubtext: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    opacity: 0.7,
    marginBottom: 20,
  },
  projectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  projectionItem: {
    flex: 1,
    alignItems: 'center',
  },
  projectionDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.light.tint + '40',
    marginHorizontal: 20,
  },
  projectionAmount: {
    fontSize: 20,
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
    marginBottom: 4,
  },
  projectionLabel: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    opacity: 0.7,
  },
  disclaimerText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    opacity: 0.5,
    textAlign: 'center',
    lineHeight: 16,
  },
  completionContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  buttonContainer: {
    gap: 12,
    paddingBottom: 20,
    marginTop: 'auto',
  },
  bottomText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    textAlign: 'center',
    opacity: 0.5,
    marginTop: 12,
  },
  
  // Neue Savings Page Styles
  savingsContainer: {
    flex: 1,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.background : '#f8f9fa',
  },
  savingsContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 30, // Mehr Platz ohne Zurück-Button
  },
  savingsScrollView: {
    flex: 1,
  },
  savingsScrollContent: {
    paddingBottom: 20,
  },
  savingsHero: {
    alignItems: 'center',
    marginBottom: 20, // Etwas mehr Abstand zur Lottie
    marginTop: 10,
  },
  moneyLottie: {
    width: 120,
    height: 120,
    marginBottom: 16,
    backgroundColor: colorScheme === 'dark' ? '#333333' : 'transparent', // Hellgrau nur im Dark Mode
    borderRadius: 12,
  },
  sandyLoaderLottie: {
    width: 100,
    height: 100,
    marginBottom: 20,
    backgroundColor: colorScheme === 'dark' ? '#333333' : 'transparent', // Hellgrau nur im Dark Mode
    borderRadius: 12,
  },
  savingsHeroIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  savingsHeroTitle: {
    fontSize: 26,
    fontFamily: 'Nunito_700Bold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  savingsHeroSubtitle: {
    fontSize: 15,
    fontFamily: 'Nunito_400Regular',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.7,
    textAlign: 'center',
  },
  
  // Jahresersparnis - Hauptfokus
  yearlyHighlight: {
    backgroundColor: colorScheme === 'dark' ? Colors.dark.cardBackground : 'white',
    borderRadius: 18,
    padding: 24,
    marginBottom: 20,
    marginHorizontal: 4,
    alignItems: 'center',
    shadowColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: colorScheme === 'dark' ? 0.2 : 0.12,
    shadowRadius: 8,
    elevation: 6,
    borderWidth: 2,
    borderColor: colorScheme === 'dark' ? Colors.dark.tint + '20' : Colors.light.tint + '20',
  },
  yearlyLabel: {
    fontSize: 17,
    fontFamily: 'Nunito_600SemiBold',
    color: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    marginBottom: 8,
    textAlign: 'center',
  },
  yearlyAmount: {
    fontSize: 44,
    fontFamily: 'Nunito_700Bold',
    color: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    marginBottom: 6,
  },
  yearlySubtext: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
    opacity: 0.8,
  },
  
  // Monats- und Wochenersparnis
  monthlyContainer: {
    flexDirection: 'row',
    marginBottom: 16, // Mehr Platz für Schatten
    marginHorizontal: 4, // Seitlicher Platz für Schatten
    gap: 12, // Mehr Gap zwischen Cards
  },
  monthlyCard: {
    flex: 1,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.cardBackground : 'white',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  monthlyAmount: {
    fontSize: 22,
    fontFamily: 'Nunito_700Bold',
    color: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    marginBottom: 3,
  },
  monthlyLabel: {
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.7,
  },
  monthlySeparator: {
    width: 2,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.border : Colors.light.tabIconDefault + '30',
    marginVertical: 8,
  },
  
  // Kompakte Vergleichsvisualisierung
  comparisonMini: {
    backgroundColor: 'white',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  comparisonMiniTitle: {
    fontSize: 15,
    fontFamily: 'Nunito_600SemiBold',
    color: Colors.light.text,
    marginBottom: 12,
    textAlign: 'center',
  },
  comparisonBars: {
    gap: 10,
    marginBottom: 12,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  barLabel: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.text,
    width: 120,
  },
  barContainer: {
    flex: 1,
    height: 28,
    backgroundColor: '#f0f0f0',
    borderRadius: 14,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandBar: {
    backgroundColor: '#e0e0e0',
  },
  noNameBar: {
    backgroundColor: Colors.light.tint,
  },
  barValue: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: 'white',
  },
  savingsBadge: {
    backgroundColor: Colors.light.tint + '15',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  savingsBadgeText: {
    fontSize: 15,
    fontFamily: 'Nunito_600SemiBold',
    color: Colors.light.tint,
  },
  
  // Fehlende Basis-Styles
  title: {
    fontSize: 24,
    fontFamily: 'Nunito_700Bold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    marginBottom: 10,
    textAlign: 'center',
    lineHeight: 32,
  },
  mainContent: {
    flex: 1,
  },
  loadingContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  loadingMessageContainer: {
    marginVertical: 40,
    alignItems: 'center',
  },
  loadingMessage: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    textAlign: 'center',
    opacity: 0.8,
  },
  loadingBarContainer: {
    width: '80%',
    height: 6,
    backgroundColor: colorScheme === 'dark' ? Colors.dark.border : '#e0e0e0',
    borderRadius: 3,
    marginTop: 20,
    overflow: 'hidden',
  },
  loadingBar: {
    height: '100%',
    backgroundColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    borderRadius: 3,
  },
});
