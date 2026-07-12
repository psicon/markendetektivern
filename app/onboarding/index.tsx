// Onboarding-Screen.
//
// T8 (2026-05-22): dynamic `await import(...)` für Firebase, AsyncStorage
// und Services raus — statische Imports oben. War nur historisch
// nötig wegen einer angenommenen Circular-Import-Sorge mit dem
// (ehemals existierenden) OnboardingProvider — Provider ist in T8
// gelöscht, das Pattern braucht's nicht mehr.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from '@react-native-firebase/firestore';
import { markAppContentReady } from '@/lib/utils/appReady';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomIcon } from '@/components/ui/CustomIcon';
import { OnboardingButton } from '@/components/ui/OnboardingButton';
import { OnboardingProgressBar } from '@/components/onboarding/OnboardingProgressBar';
import { OnboardingSkipPill } from '@/components/onboarding/OnboardingSkipPill';
import { Colors } from '@/constants/Colors';
import { auth as authMod, db } from '@/lib/firebase';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { FirestoreService } from '@/lib/services/firestore';
import journeyTrackingService from '@/lib/services/journeyTrackingService';
import { OnboardingService } from '@/lib/services/onboardingService';
import { revenueCatService } from '@/lib/services/revenueCatService';
import { detectCountry, type DachCountry } from '@/lib/utils/country';

const { width } = Dimensions.get('window');
// SE-Klasse (Höhe < 700): Climax-Step bekommt kompakte Maße, damit
// Jahresersparnis-Card + Auth-CTAs ohne Scrollen sichtbar sind.
// Alle größeren Screens bleiben unverändert (User-Vorgabe 2026-06-11).
const IS_SMALL_SCREEN = Dimensions.get('window').height < 700;

// Flow Variante B (User-Decision 2026-05-22):
//   Step 1 = Hero (ohne ProgressBar, "Los geht's"-Button)
//   Step 2 = Märkte
//   Step 3 = Wocheneinkauf (€)
//   Step 4 = Was ist dir wichtig?
//   Step 5 = Loading (Labor-Illusion)
//   Step 6 = Climax + Auth-Hebel
//
// Demographics (Alter + Geschlecht) ist NICHT mehr im Funnel — wird
// post-Climax als opt-in Bottom-Sheet abgefragt (siehe T3, ClickUp
// 86c9zc61y). Akquisitionsquelle ebenfalls raus — wird durch
// Attribution-API erkannt (T4, ClickUp 86c9zbxy7).
//
// ProgressBar zeigt "X von 4" weil die echten Frage-Steps 2-5 sind
// (Hero hat keine, Loading-Step zeigt "Almost done"-Look).
const TOTAL_STEPS = 6;

const COUNTRIES = [
  { code: 'DE', name: 'Deutschland', flag: '🇩🇪' },
  { code: 'AT', name: 'Österreich', flag: '🇦🇹' },
  { code: 'CH', name: 'Schweiz', flag: '🇨🇭' },
] as const;

// Demographics-Konstanten (GENDER_OPTIONS, GENDER_USERDOC_MAP, AGE_*,
// ageBucketFromAge) wurden in T2 entfernt — Demographics ist jetzt
// post-Climax als opt-in Bottom-Sheet (T3). Die Logik wandert nach
// `components/onboarding/DemographicsPromptSheet.tsx`.
//
// ACQUISITION_SOURCES ebenfalls entfernt — Attribution kommt aus
// nativen APIs (T4: iOS AdServices + Android Install-Referrer).

const PRIORITIES = [
  { id: 'preis', name: 'Preis', icon: '💰' },
  { id: 'inhaltsstoffe', name: 'Inhaltsstoffe', icon: '🧪' },
  { id: 'qualität', name: 'Qualität', icon: '⭐' },
  { id: 'marke', name: 'Marke', icon: '🏷️' },
  { id: 'marktnähe', name: 'Marktnähe', icon: '📍' },
  { id: 'anderes', name: 'Anderes', icon: '💭' },
];

// PulsingAgeHint-Komponente + Style-Block entfernt in T2 — gehörte
// zum Alter-Slider-Step. Demographics-Flow lebt jetzt im
// DemographicsPromptSheet (T3).

export default function OnboardingScreen() {
  // Splash-Overlay ausblenden sobald dieser Screen steht (s. lib/utils/appReady).
  useEffect(() => {
    markAppContentReady();
  }, []);
  const { signInAnonymously, refreshUserProfile: refreshAuthUserProfile } = useAuth();
  const { presentPaywallIfNeeded, presentPaywall, isPremium, refreshPremiumStatus } = useRevenueCat();
  const colorScheme = useColorScheme();
  
  // Dynamic styles based on color scheme - MUSS VOR useState sein!
  const styles = createStyles(colorScheme);
  
  // State — bewusst flat statt useReducer weil Flow inzwischen
  // schlank ist (4 Frage-Steps). Wenn der Monolith-Refactor (T9)
  // angegangen wird, sollte das ein useReducer werden gemäß
  // CLAUDE.md Best-Practices.
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
  const [budget, setBudget] = useState(100);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [prioritiesOther, setPrioritiesOther] = useState('');
  // Demographics + Akquisition State entfernt in T2 — sind aus dem
  // Funnel raus (T3 Bottom-Sheet bzw. T4 Attribution-API).
  const [loadingProgress] = useState(new Animated.Value(0));
  const [loadingMessage, setLoadingMessage] = useState('🕵️ Die MarkenDetektive beginnen ihre Recherche...');
  // 2.2b (Stufe 2): echte Alternativen-Zahl statt Fake-"Analyse". Wird im
  // Loading-Step aus der echten produkte-Zählung der gewählten Märkte gefüllt.
  const [realAltCount, setRealAltCount] = useState<number | null>(null);
  const [countMarketLabel, setCountMarketLabel] = useState('');
  const [slideAnimation] = useState(new Animated.Value(1)); // Für Slide-Animationen
  const [backgroundOpacity] = useState(new Animated.Value(1)); // Für Background Fade
  const [sessionId] = useState(`session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`); // Persistente Session-ID
  const confettiRef = useRef<ConfettiCannon>(null); // Für Konfetti-Effekt
  const marketsListRef = useRef<FlatList<any>>(null); // Für scrollToEnd bei 'Anderer'

  /**
   * Liefert den ersten "echten" Markt aus selectedMarkets (kein
   * `isOther`-Custom-Eintrag). Wird für primaryMarket /
   * favoriteMarket-Zuweisung verwendet — das User-Doc-Schema
   * erwartet eine echte Discounter-ID + -Namen. Wenn der User
   * NUR "Anderer" gewählt hat → undefined (kein primary, kein
   * Crash später in der App die favoriteMarket=ID erwartet).
   */
  const firstRealMarket = selectedMarkets.find((m) => !m.isOther);

  // Premium Check beim Onboarding Start
  useEffect(() => {
    const initializeAndCheckPremium = async () => {
      console.log('🚀 Onboarding gestartet - initialisiere RevenueCat...');
      
      try {
        // Stelle sicher dass RevenueCat initialisiert ist
        
        
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
    
    // Konfetti + Haptik für Climax (Step 6)
    if (currentStep === 6) {
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
    if (currentStep === 5) {
      // Loading Animation
      Animated.timing(loadingProgress, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: false,
      }).start();

      // Auto-advance zum Climax
      const timer = setTimeout(() => {
        setCurrentStep(6);
      }, 3000);

      // 2.2b: ECHTE Alternativen-Zahl statt Fake-"deine Produkte werden
      // analysiert". Zählt NoName-Produkte (produkte-Collection, öffentlich
      // lesbar) für die gewählten echten Märkte via getCountFromServer (billig,
      // 1 Read/Markt). Kommt i.d.R. innerhalb der 3s-Animation zurück; wenn
      // nicht, bleibt es bei der generischen Message (keine erfundene Zahl).
      const realMarkets = selectedMarkets.filter((m) => !m.isOther && m?.id);
      let cancelledCount = false;
      if (realMarkets.length > 0) {
        setCountMarketLabel(
          realMarkets
            .map((m) => m.name)
            .filter(Boolean)
            .slice(0, 3)
            .join(' & '),
        );
        (async () => {
          try {
            const counts = await Promise.all(
              realMarkets.map((m) =>
                FirestoreService.getProductCountByDiscounter(m.id).catch(() => 0),
              ),
            );
            if (cancelledCount) return;
            const total = counts.reduce((a, b) => a + b, 0);
            if (total > 0) setRealAltCount(total);
          } catch {
            /* Fallback: generische Message bleibt, keine erfundene Zahl */
          }
        })();
      }

      // Loading Messages — ehrlich formuliert (keine "deine Produkte werden
      // analysiert"-Behauptung, die es nicht gibt).
      const messages = [
        '🕵️ Die MarkenDetektive machen sich an die Arbeit...',
        '🔍 Wir durchsuchen unsere Alternativen-Datenbank...',
        '💰 Dein persönliches Sparpotenzial wird eingerichtet...',
        '🎯 Dein App-Erlebnis wird vorbereitet...',
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
        cancelledCount = true;
        clearTimeout(timer);
        clearInterval(messageInterval);
      };
    }
  }, [currentStep, loadingProgress, selectedMarkets]);

  // Lade Märkte aus Firestore
  const loadMarkets = async () => {
    try {
      
      
      
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
  // Step-Reihenfolge (T2 Variante B):
  //   1 = Hero (kein Tracking — noch nichts beantwortet)
  //   2 = Märkte           (favoriteMarkets, primaryMarket)
  //   3 = Wocheneinkauf €  (weeklyBudgetEur)
  //   4 = Prioritäten      (priorities)
  //   5 = Loading          (kein eigenes Tracking)
  //   6 = Climax           (kein Tracking — completeOnboarding regelt das)
  //
  // country wird IMMER mitgesendet weil's aus Device-Locale stammt
  // (auch wenn User auf Step 2 noch nicht aktiv geändert hat).
  const trackCurrentStep = async () => {
    // Nur tracken wenn der User mindestens einen Step abgeschlossen hat.
    if (currentStep <= 1) return;

    try {
      
      const auth = authMod;

      const userId = auth.currentUser?.uid || 'anonymous';

      const stepData: any = {
        userId,
        sessionId,
        currentStep,
        status: 'in_progress',
        lastUpdateTime: serverTimestamp(),
        country, // immer aus Locale-Detection oder User-Override
        version: 'v3', // T2: Variante B (5 Steps, ohne Demographics+Akquisition)
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
        // primaryMarket nur dann setzen wenn's einen ECHTEN Discounter
        // in der Auswahl gibt — 'isOther'/Anderer ist kein gültiger
        // Lieblingsmarkt (keine ID, kein Logo). Fallback: erster real.
        if (firstRealMarket) {
          stepData.primaryMarket = firstRealMarket.name;
        }
        if (marketOther) stepData.marketOther = marketOther;
      }
      if (currentStep >= 3) stepData.weeklyBudgetEur = budget;
      if (currentStep >= 4 && priorities.length > 0) {
        stepData.priorities = priorities;
        if (prioritiesOther) stepData.prioritiesOther = prioritiesOther;
      }

      await setDoc(doc(db, 'onboardingResultsV5', sessionId), stepData);
      console.log('📊 Step tracking saved for step:', currentStep);
    } catch (error) {
      console.error('❌ Step tracking error:', error);
    }
  };

  const nextStep = async () => {
    if (currentStep < TOTAL_STEPS) {
      // Auf "Los geht's"-Tap (Step 1 → 2): SOFORT anonyme UUID
      // erzeugen falls noch keiner da ist + Onboarding-Status auf
      // 'in_progress' setzen.
      if (currentStep === 1) {
        // Audit 12.07.2026: NICHT auf Netz warten — der blockierende
        // signInAnonymously-Await ließ den CTA auf schlechtem Netz
        // sekundenlang tot wirken (Einstiegs-Drop). Der Boot-Auto-Anon
        // (AuthContext, +1 s) hat den User ohnehin fast immer schon;
        // das hier ist nur der Fallback, und das Step-Tracking hat für
        // die Rest-Lücke den userId-Fallback 'anonymous'.
        void (async () => {
          try {
            const auth = authMod;
            if (!auth.currentUser) {
              await signInAnonymously();
              console.log('✅ Anon-UUID auto-erzeugt am Onboarding-Start');
            }
          } catch (e) {
            console.warn('⚠️ Anon-Auto-Login fehlgeschlagen:', e);
            // Non-fatal — userId fällt auf "anonymous" zurück im Tracking
          }
          // Status-Übergang pending → in_progress (Service als SoT).
          try {
            await OnboardingService.markStarted();
          } catch (e) {
            console.warn('⚠️ markStarted failed:', e);
          }
        })();
      }

      // Tracking beim Weiterklicken (nicht bei jeder Auswahl).
      await trackCurrentStep();

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

  // skipDemographicsStep entfernt in T2 — Demographics-Step ist
  // raus aus dem Funnel (T3 Bottom-Sheet).

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
    const auth = authMod;
    if (!auth.currentUser) {
      try {
        await signInAnonymously();
      } catch (error) {
        console.error('❌ Anonymous sign in failed:', error);
      }
    }
    
    // Speichere Skip/Abandon
    try {
      
      const auth = authMod;
      
      await setDoc(doc(db, 'onboardingResultsV5', sessionId), {
        userId: auth.currentUser?.uid || 'anonymous',
        sessionId,
        status: 'abandoned',
        abandonedAtStep: currentStep,
        abandonReason: 'later_button',
        currentStep,
        lastUpdateTime: serverTimestamp(),
        completedAt: serverTimestamp(),
        // Behalte bereits gesammelte Daten (Demographics+Acquisition
        // ist nicht mehr im Funnel — Variante B).
        country,
        ...(selectedMarkets.length > 0 && {
          favoriteMarkets: selectedMarkets.map(m => m.name),
          ...(firstRealMarket && { primaryMarket: firstRealMarket.name }),
        }),
        ...(marketOther && { marketOther }),
        ...(budget && { weeklyBudgetEur: budget }),
        ...(priorities.length > 0 && { priorities }),
        ...(prioritiesOther && { prioritiesOther }),
        version: 'v3',
        platform: 'mobile',
      });

      console.log('📊 Abandon tracked at step:', currentStep);
    } catch (error) {
      console.error('❌ Skip tracking error:', error);
    }

    // Onboarding-Status via Service (Single Source of Truth).
    // Hero-Skip (Step 1) = skipped_early (keine Daten erfasst),
    // Skip aus späterem Step = skipped_mid (Teil-Daten erfasst).
    if (currentStep === 1) {
      await OnboardingService.markSkippedEarly();
    } else {
      await OnboardingService.markSkippedMid();
    }

    // ClickUp 86cad6cy5 (6.19/6.20): per-UID-Marker ans User-Doc, dass DIESE
    // Identität den Onboarding-Flow durchlaufen hat (auch bei Skip) — damit das
    // Demografie-Sheet auf Home greift, aber NICHT nach Logout/Account-Löschen
    // (frische Anon-UID hat das Feld nicht). Non-fatal.
    try {
      const skipUid = authMod.currentUser?.uid;
      if (skipUid) {
        await setDoc(
          doc(db, 'users', skipUid),
          { onboardingCompletedAt: serverTimestamp() },
          { merge: true },
        );
      }
    } catch (e) {
      console.warn('⚠️ skip onboardingCompletedAt write failed:', e);
    }

    // KEIN pending_onboarding_paywall bei Skip (T2 Variante B):
    // User der das Onboarding wegwischt soll NICHT sofort eine
    // Paywall sehen — kostenlos-erst-ausprobieren. Paywall greift
    // nur im Climax-Auth-Pfad.

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

      // Paywall darf nach Auth-Erfolg auf /(tabs) triggern — aber nur für
      // Nicht-Premium-User (Premium-Boot-Fix 2026-07: der Status wurde beim
      // Onboarding-Mount ermittelt; Premium-Usern das Flag gar nicht erst
      // setzen, der Home-Effect prüft zusätzlich frisch).
      if (!isPremiumUser) {
        try {
          await AsyncStorage.setItem('pending_onboarding_paywall', '1');
        } catch (e) {
          console.warn('⚠️ pending_onboarding_paywall set failed:', e);
        }
      }

      // T5: ?from=onboarding-Param damit Welcome den Back-Button
      // ausblendet (sonst Sackgasse zurück zu Step 6).
      router.replace('/auth/welcome?from=onboarding' as any);
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
      version: 'v3', // T2 Variante B
      platform: 'mobile',
    };

    // Optional fields (Demographics + Akquisition raus — T2)
    if (selectedMarkets.length > 0) {
      completionData.favoriteMarkets = selectedMarkets.map(market => {
        if (market.isOther) {
          return { id: 'other', name: marketOther, isCustom: true };
        }
        return market;
      });
      // primaryMarket: nur echter Discounter — kein 'other'-Fake, der
      // hat keine echte ID und würde später z.B. das Favoriten-Heart
      // im Markets-Screen leerlaufen lassen oder einen Crash bei
      // Doc-Lookups triggern.
      if (firstRealMarket) {
        completionData.primaryMarket = firstRealMarket;
      }
    }
    if (priorities.includes('anderes') && prioritiesOther.trim() !== '') {
      completionData.prioritiesOther = prioritiesOther;
    }

    await setDoc(doc(db, 'onboardingResultsV5', sessionId), completionData);

    // User-Doc Mirror.
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
        if (priorities.includes('anderes') && prioritiesOther.trim() !== '') {
          userPrefs.prioritiesOther = prioritiesOther;
        }
        await setDoc(doc(db, 'users', uid), userPrefs, { merge: true });
        console.log('✅ Onboarding answers mirrored to users/' + uid);
        // Läuft bereits eine Journey, bekommt sie den frisch gesetzten
        // Markt sofort in ihren consumerProfile-Snapshot — der Start-
        // Snapshot entstand VOR dem Onboarding (Audit 12.07.2026).
        journeyTrackingService.refreshConsumerProfile();
      }
    } catch (mirrorErr) {
      console.warn('⚠️ Failed to mirror onboarding answers:', mirrorErr);
    }

    // Onboarding-Status via Service (Single Source of Truth).
    await OnboardingService.markCompleted();

    // T3: Demographics-Bottom-Sheet beim ersten App-Mount triggern.
    // Wird in (tabs)/index.tsx gelesen + entfernt nach Anzeige.
    try {
      
      await AsyncStorage.setItem('pending_demographics_prompt', '1');
    } catch (e) {
      console.warn('⚠️ pending_demographics_prompt set failed:', e);
    }

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
      
      
      const auth = authMod;
      
      // Vervollständige die Session (Variante B — ohne Demographics
      // und ohne Akquisition; beides post-Onboarding behandelt).
      const completionData: any = {
        userId: auth.currentUser?.uid || 'anonymous',
        sessionId,
        status: 'completed',
        currentStep: TOTAL_STEPS, // = 6 (Variante B)
        lastUpdateTime: serverTimestamp(),
        completedAt: serverTimestamp(),
        country,
        weeklyBudgetEur: budget,
        priorities,
        estimatedSavingsPercent: 35,
        estimatedSavingsEurWeek: Math.round(budget * 0.35),
        version: 'v3',
        platform: 'mobile',
      };

      // Optional fields
      if (selectedMarkets.length > 0) {
        completionData.favoriteMarkets = selectedMarkets.map(market => {
          if (market.isOther) {
            return { id: 'other', name: marketOther, isCustom: true };
          }
          return market;
        });
        if (firstRealMarket) {
          completionData.primaryMarket = firstRealMarket;
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
            // gar nichts an.
            const primary = completionData.primaryMarket;
            if (primary?.id) {
              userPrefs.favoriteMarket = primary.id;
              userPrefs.favoriteMarketName = primary.name ?? '';
            }
            userPrefs.primaryMarket = primary;
          }
          if (priorities.includes('anderes') && prioritiesOther.trim() !== '') {
            userPrefs.prioritiesOther = prioritiesOther;
          }
          // Demographics + Akquisition aus T2 raus — werden post-
          // Onboarding gehandhabt (T3 Bottom-Sheet, T4 Attribution).

          // Merge so we don't clobber unrelated fields on the user
          // doc (level, points, displayName, photo_url, …).
          await setDoc(doc(db, 'users', uid), userPrefs, { merge: true });
          console.log('✅ Onboarding answers mirrored to users/' + uid);
          // Läuft bereits eine Journey, bekommt sie den frisch gesetzten
          // Markt sofort in ihren consumerProfile-Snapshot — der Start-
          // Snapshot entstand VOR dem Onboarding (Audit 12.07.2026).
          journeyTrackingService.refreshConsumerProfile();
        }
      } catch (mirrorErr) {
        console.warn('⚠️ Failed to mirror onboarding answers to user doc:', mirrorErr);
      }

      // Onboarding-Status via Service (Single Source of Truth).
      await OnboardingService.markCompleted();

      // T3: Demographics-Bottom-Sheet beim ersten App-Mount triggern.
      try {
        
        await AsyncStorage.setItem('pending_demographics_prompt', '1');
      } catch (e) {
        console.warn('⚠️ pending_demographics_prompt set failed:', e);
      }

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

      // ClickUp 86cacp9hy (1.11): restorePurchases()/isPremium()/Paywall NICHT
      // mehr im kritischen Navigations-Pfad — das war der StoreKit-Cold-Start
      // (>10s beim ersten Mal; ~2s beim zweiten, weil dann gecached). Wie der
      // Auth-Pfad (completeOnboardingForAuth) nur das Flag setzen + sofort
      // navigieren; app/(tabs)/index.tsx präsentiert die Onboarding-Paywall
      // danach auf Home (inkl. refreshPremiumStatus + RevenueCat-Init-Warten +
      // presentPaywall). Die Mirror-Writes oben bleiben awaited (Firestore
      // offline-first, schnell) — nur der StoreKit-Roundtrip fällt aus dem
      // Boot-Pfad. Premium-Boot-Fix 2026-07: Flag nur für Nicht-Premium-User
      // setzen (Status wurde beim Onboarding-Mount ermittelt).
      if (!isPremiumUser) {
        try {
          await AsyncStorage.setItem('pending_onboarding_paywall', '1');
        } catch (e) {
          console.warn('⚠️ pending_onboarding_paywall set failed:', e);
        }
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

  // T9 (2026-05-22): ProgressBar + SkipPill in eigene Komponenten
  // ausgelagert (components/onboarding/). Hier nur noch die
  // currentStep+denominator-Brücke.
  const PROGRESS_DENOM = TOTAL_STEPS - 2;
  const renderProgressBar = () => (
    <OnboardingProgressBar currentStep={currentStep} denominator={PROGRESS_DENOM} />
  );
  const renderSkipPill = (label: string, onPress: () => void) => (
    <OnboardingSkipPill label={label} onPress={onPress} />
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
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
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
            <Text style={[styles.stepTitle, IS_SMALL_SCREEN && { fontSize: 22, marginBottom: 6 }]}>Wo kaufst du am liebsten ein?</Text>
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
             <Text style={[styles.counter, IS_SMALL_SCREEN && { marginBottom: 4 }]}>{selectedMarkets.length}/3 ausgewählt</Text>
             {/* Hinweis dass der ERSTE ausgewählte Markt zum Lieblingsmarkt
                 wird. Sichtbar erst nachdem mindestens ein Markt
                 selektiert ist — sonst zeigt der Satz ins Leere. Der
                 Code unten setzt zusätzlich ein gold-Heart-Badge auf
                 selectedMarkets[0], sodass der Zusammenhang
                 "erster = Liebling" auch visuell verankert ist. */}
             {firstRealMarket ? (
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
              ref={marketsListRef}
              data={markets}
              numColumns={2}
              keyExtractor={(item) => item.id}
              // ClickUp 86cacp9ar (1.6/1.8) — echter Layout-Fix: Die FlatList ist
              // das EINZIGE flexible Kind in mainContent. Ohne flex frisst der
              // Keyboard-Druck (via KeyboardAvoidingView 'padding') die ganze
              // Listenhöhe → auf kleinen Displays kollabiert sie auf ~0 und es ist
              // KEINE Kachel mehr wählbar. flex:1 lässt sie eine echte (scrollbare)
              // Höhe behalten; paddingBottom gibt der zuletzt angehängten
              // "Anderer"-Kachel Scroll-Runway. automaticallyAdjustKeyboardInsets
              // ENTFERNT — kämpfte mit dem padding-KeyboardAvoidingView (der den
              // Input bereits über die Tastatur schiebt). keyboardShouldPersistTaps
              // bleibt, damit ein Tile-Tap nicht erst das Keyboard schließt.
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = selectedMarkets.some(m => m.id === item.id);
                const isDisabled = !isSelected && selectedMarkets.length >= 3;
                // Lieblingsmarkt = ERSTER NICHT-isOther im Array.
                // Wenn User zuerst "Anderer" und dann "Aldi" wählt,
                // bekommt Aldi das Heart (firstRealMarket), nicht
                // Anderer. Das verhindert kaputte favoriteMarket-
                // Refs ('other'-ID hat kein echtes Discounter-Doc).
                const isPrimary =
                  isSelected &&
                  !item.isOther &&
                  firstRealMarket?.id === item.id;

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
                        // Wenn 'Anderer' frisch hinzugefügt wird:
                        // FlatList nach unten scrollen damit das gleich
                        // unter dem letzten Item erscheinende TextInput
                        // im sichtbaren Bereich ist (sonst klebt's
                        // unter der Liste off-screen).
                        if (item.isOther) {
                          setTimeout(() => {
                            marketsListRef.current?.scrollToEnd({ animated: true });
                          }, 50);
                        }
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
              <View style={[styles.textInputContainer, IS_SMALL_SCREEN && { marginTop: 12, marginBottom: 12 }]}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Welcher Markt ist das?"
                  value={marketOther}
                  onChangeText={setMarketOther}
                  maxLength={50}
                  // Auto-Focus: User hat 'Anderer' gewählt → wir mounten
                  // jetzt erst diesen TextInput, Auto-Focus öffnet
                  // sofort die Tastatur. iOS scrollt dann via
                  // FlatList-automaticallyAdjustKeyboardInsets das
                  // Input in den sichtbaren Bereich.
                  autoFocus
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
        </KeyboardAvoidingView>
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
          

          {renderSkipPill('Onboarding überspringen', skipOnboarding)}
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
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
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
            <Text style={[styles.stepTitle, IS_SMALL_SCREEN && { fontSize: 22, marginBottom: 6 }]}>Was ist dir beim Einkauf wichtig?</Text>
            <Text style={styles.subtitle}>Wähle bis zu 3 Aspekte</Text>
            <Text style={[styles.counter, IS_SMALL_SCREEN && { marginBottom: 4 }]}>{priorities.length}/3 ausgewählt</Text>
            
            <FlatList
              data={PRIORITIES}
              numColumns={2}
              keyExtractor={(item) => item.id}
              // ClickUp 86cacp9ar (1.8) — echter Layout-Fix (analog Markt-Step):
              // flex:1 verhindert den Kollaps der Liste bei offener Tastatur;
              // paddingBottom gibt der "Anderes"-Kachel Scroll-Runway;
              // automaticallyAdjustKeyboardInsets entfernt (kämpfte mit der KAV).
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
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
              <View style={[styles.textInputContainer, IS_SMALL_SCREEN && { marginTop: 12, marginBottom: 12 }]}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Was ist dir sonst noch wichtig?"
                  value={prioritiesOther}
                  onChangeText={setPrioritiesOther}
                  maxLength={50}
                  autoFocus
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
        </KeyboardAvoidingView>
      </SafeAreaView>
      </>
    );
  }


  // Step 5: Loading (Labor-Illusion behält ihren Wert).
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

            {/* 2.2b: ECHTE Zahl statt Fake-Analyse — nur wenn die Zählung
                zurückkam (sonst keine erfundene Zahl). */}
            {realAltCount != null ? (
              <Text
                style={{
                  fontFamily: 'Nunito_700Bold',
                  fontSize: 15,
                  lineHeight: 21,
                  textAlign: 'center',
                  marginTop: 4,
                  paddingHorizontal: 24,
                  color: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
                }}
              >
                {countMarketLabel
                  ? `Bei ${countMarketLabel} kennen wir schon ${realAltCount.toLocaleString('de-DE')} Alternativen für dich!`
                  : `Wir kennen schon ${realAltCount.toLocaleString('de-DE')} Alternativen für dich!`}
              </Text>
            ) : null}

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

  // Step 6: Climax — Sparpotenzial + Auth-Hebel.
  if (currentStep === 6) {
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
              <View
                style={[
                  styles.savingsHero,
                  IS_SMALL_SCREEN && { marginTop: 2, marginBottom: 10 },
                ]}
              >
                <LottieView
                  source={require('@/assets/lottie/money.json')}
                  autoPlay
                  loop={false}
                  style={[
                    styles.moneyLottie,
                    IS_SMALL_SCREEN && { width: 84, height: 84, marginBottom: 8 },
                  ]}
                />
                <Text
                  style={[
                    styles.savingsHeroTitle,
                    IS_SMALL_SCREEN && { fontSize: 22, marginBottom: 4 },
                  ]}
                >
                  Dein Sparpotenzial!
                </Text>
                <Text
                  style={[
                    styles.savingsHeroSubtitle,
                    IS_SMALL_SCREEN && { fontSize: 13 },
                  ]}
                >
                  Basierend auf deinem Wocheneinkauf von {budget}€
                </Text>
              </View>

              {/* T17.16 (CU 86ca037m8): Monats-/Wochen-Cards entfernt —
                  waren redundant zur Subline und drückten auf kleinen
                  Displays (iPhone SE) Cards + CTAs unter den Fold.
                  Weekly-Info wandert inline in den Subtext. */}
              <View
                style={[
                  styles.yearlyHighlight,
                  IS_SMALL_SCREEN && { padding: 14, marginBottom: 10 },
                ]}
              >
                <Text style={styles.yearlyLabel}>🏆 Dein Jahres-Sparpotenzial</Text>
                <Text style={[styles.yearlySubtext, { marginBottom: 2 }]}>bis zu</Text>
                <Text
                  style={[
                    styles.yearlyAmount,
                    IS_SMALL_SCREEN && { fontSize: 36, marginBottom: 4 },
                  ]}
                >
                  {yearlySavings.toLocaleString('de-DE')} €
                </Text>
                <Text style={styles.yearlySubtext}>
                  {monthlySavings.toLocaleString('de-DE')} €/Monat · {weeklySavings.toLocaleString('de-DE')} €/Woche
                </Text>
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
              <Text
                style={[
                  styles.climaxAuthSubline,
                  IS_SMALL_SCREEN && { marginBottom: 10 },
                ]}
              >
                Erstelle ein Profil, damit deine Antworten + Punkte
                geräteübergreifend bleiben.
              </Text>
              <OnboardingButton
                title="👉  Profil sichern & App starten"
                onPress={completeOnboardingForAuth}
                loading={isLoading}
              />
              <TouchableOpacity
                style={[
                  styles.climaxGuestLink,
                  IS_SMALL_SCREEN && { marginTop: 6, paddingVertical: 5 },
                ]}
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
  // Bewusst dezent gehalten — kein Brand-Tint, neutrale Surface.
  // Aber jetzt minimal sichtbarer als vorher (User-Feedback: war
  // zu "versteckt"): leicht stärkere bg + Border + Text-Opacity 0.8.
  skipPillRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 4,
    marginTop: -4,
    marginBottom: 8,
  },
  skipPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)',
    borderWidth: 1,
    borderColor: colorScheme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
  },
  skipPillText: {
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
    color: colorScheme === 'dark' ? Colors.dark.text : Colors.light.text,
    opacity: 0.8,
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
  // Demographics-Step-Styles (ageDisplay, genderPill etc.) entfernt
  // in T2 — Demographics ist post-Climax via Bottom-Sheet (T3).
  // ─── Climax (Step 6) Auth-CTAs ─────────────────────────────────────
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
  
  // T17.16: monthlyContainer/-Card/-Amount/-Label/-Separator
  // Styles entfernt (Cards waren redundant, siehe Climax-Render).

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
