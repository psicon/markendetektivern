// Simple Onboarding ohne Hooks-Probleme
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import LottieView from 'lottie-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  ImageBackground,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
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

const { width } = Dimensions.get('window');

const COUNTRIES = [
  { code: 'DE', name: 'Deutschland', flag: '🇩🇪' },
  { code: 'AT', name: 'Österreich', flag: '🇦🇹' },
  { code: 'CH', name: 'Schweiz', flag: '🇨🇭' },
] as const;

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
  const { signInAnonymously } = useAuth();
  const { presentPaywallIfNeeded, presentPaywall, isPremium, refreshPremiumStatus } = useRevenueCat();
  const colorScheme = useColorScheme();
  
  // Dynamic styles based on color scheme - MUSS VOR useState sein!
  const styles = createStyles(colorScheme);
  
  // ALLE useState IMMER (keine conditionals!)
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [country, setCountry] = useState<'DE' | 'AT' | 'CH'>('DE');
  const [markets, setMarkets] = useState<any[]>([]);
  const [selectedMarkets, setSelectedMarkets] = useState<any[]>([]);
  const [marketOther, setMarketOther] = useState('');
  const [acquisitionSource, setAcquisitionSource] = useState('');
  const [acquisitionOther, setAcquisitionOther] = useState('');
  const [budget, setBudget] = useState(100);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [prioritiesOther, setPrioritiesOther] = useState('');
  const [loadingProgress] = useState(new Animated.Value(0));
  const [loadingMessage, setLoadingMessage] = useState('🕵️ Die Detektive beginnen ihre Recherche...');
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
        
        // UI aktualisieren
        await refreshPremiumStatus();
        
      } catch (error) {
        console.error('❌ Fehler beim Premium Check:', error);
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
        '🕵️ Die Detektive beginnen ihre Recherche...',
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
      const { collection, getDocs, query, where } = await import('firebase/firestore');
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

  // Tracking-Funktion (nur beim Weiterklicken aufgerufen)
  const trackCurrentStep = async () => {
    // Nur tracken wenn nicht Step 1 (Hero)
    if (currentStep <= 1) return;
    
    try {
      const { setDoc, doc, serverTimestamp } = await import('firebase/firestore');
      const { db, auth } = await import('@/lib/firebase');
      
      const userId = auth.currentUser?.uid || 'anonymous';
      
      // Sammle aktuelle Daten
      const stepData: any = {
        userId,
        sessionId,
        currentStep,
        status: 'in_progress',
        lastUpdateTime: serverTimestamp(),
        version: 'v1',
        platform: 'mobile'
      };
      
      // Nur beim ersten echten Step startTime setzen
      if (currentStep === 2) {
        stepData.startTime = serverTimestamp();
      }
      
      // Füge Step-spezifische Daten hinzu
      if (currentStep >= 2) stepData.country = country;
      if (currentStep >= 3 && selectedMarkets.length > 0) {
        stepData.favoriteMarkets = selectedMarkets.map(m => m.name);
        stepData.primaryMarket = selectedMarkets[0]?.name;
        if (marketOther) stepData.marketOther = marketOther;
      }
      if (currentStep >= 4 && acquisitionSource) {
        stepData.acquisitionSource = acquisitionSource;
        if (acquisitionOther) stepData.acquisitionOther = acquisitionOther;
      }
      if (currentStep >= 5) stepData.weeklyBudgetEur = budget;
      if (currentStep >= 6 && priorities.length > 0) {
        stepData.priorities = priorities;
        if (prioritiesOther) stepData.prioritiesOther = prioritiesOther;
      }
      
      // Speichere in Firestore mit eindeutiger Session-ID
      await setDoc(doc(db, 'onboardingResultsV5', sessionId), stepData);
      
      console.log('📊 Step tracking saved for step:', currentStep);
    } catch (error) {
      console.error('❌ Step tracking error:', error);
    }
  };

  const nextStep = async () => {
    if (currentStep < 9) {
      // Tracking beim Weiterklicken (nicht bei jeder Auswahl)
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
          })
        ]).start(() => {
          setCurrentStep(currentStep + 1);
          // Neuer Step wird automatisch von rechts einsliden (useEffect)
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
    // Fade out animation für Skip vom Hero Screen
    if (currentStep === 1) {
      Animated.timing(backgroundOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
    
    // Speichere Skip/Abandon
    try {
      const { setDoc, doc, serverTimestamp } = await import('firebase/firestore');
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
        ...(country && { country }),
        ...(selectedMarkets.length > 0 && { 
          favoriteMarkets: selectedMarkets.map(m => m.name),
          primaryMarket: selectedMarkets[0]?.name 
        }),
        ...(marketOther && { marketOther }),
        ...(acquisitionSource && { acquisitionSource }),
        ...(acquisitionOther && { acquisitionOther }),
        ...(budget && { weeklyBudgetEur: budget }),
        ...(priorities.length > 0 && { priorities }),
        ...(prioritiesOther && { prioritiesOther }),
        version: 'v1',
        platform: 'mobile'
      });
      
      console.log('📊 Abandon tracked at step:', currentStep);
    } catch (error) {
      console.error('❌ Skip tracking error:', error);
    }
    
    const AsyncStorage = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.default.setItem('onboarding_v1_skipped', 'true'); // GEÄNDERT: skipped statt completed
    
    // WICHTIG: Käufe wiederherstellen und Premium Status prüfen!
    console.log('🔄 Stelle Käufe wieder her und prüfe Premium Status (Skip)...');
    
    // Erst Käufe wiederherstellen
    try {
      const { revenueCatService } = await import('@/lib/services/revenueCatService');
      await revenueCatService.restorePurchases();
      console.log('✅ Käufe wiederhergestellt (Skip)');
    } catch (e) {
      console.log('⚠️ Konnte Käufe nicht wiederherstellen (Skip):', e);
    }
    
    // Dann Premium Status direkt von RevenueCat abfragen
    const { revenueCatService } = await import('@/lib/services/revenueCatService');
    const currentPremiumStatus = await revenueCatService.isPremium();
    
    console.log('🛒 Premium Status beim Skip:', currentPremiumStatus);
    
    // Remote Config prüfen
    const shouldShowPaywall = await remoteConfigService.shouldShowOnboardingPaywall();
    
    console.log('🛒 Skip Paywall Entscheidung:', { 
      shouldShowPaywall, 
      isPremium: currentPremiumStatus,
      willShowPaywall: shouldShowPaywall && !currentPremiumStatus 
    });
    
    // NUR Paywall zeigen wenn Remote Config JA sagt UND User KEIN Premium hat
    if (shouldShowPaywall && !currentPremiumStatus) {
      console.log('🛒 Zeige Paywall nach Skip (User hat kein Premium)');
      try {
        const paywallResult = await presentPaywall('onboarding');
        console.log('🛒 Skip Paywall result:', paywallResult.result);
      } catch (error) {
        console.error('❌ Skip Paywall error:', error);
      }
    } else {
      if (currentPremiumStatus) {
        console.log('✅ User hat Premium - keine Paywall nach Skip!');
      } else {
        console.log('🛒 Remote Config: Paywall nach Skip deaktiviert');
      }
    }
    
    router.replace('/(tabs)');
  };

  const completeOnboarding = async () => {
    setIsLoading(true);
    
    try {
      await signInAnonymously();
      
      const { setDoc, doc, serverTimestamp } = await import('firebase/firestore');
      const { db, auth } = await import('@/lib/firebase');
      
      // Vervollständige die Session
      const completionData: any = {
        userId: auth.currentUser?.uid || 'anonymous',
        sessionId,
        status: 'completed',
        currentStep: 9,
        lastUpdateTime: serverTimestamp(),
        completedAt: serverTimestamp(),
        country,
        weeklyBudgetEur: budget,
        priorities,
        estimatedSavingsPercent: 35,
        estimatedSavingsEurWeek: Math.round(budget * 0.35),
        version: 'v1',
        platform: 'mobile'
      };
      
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
      
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.default.setItem('onboarding_v1_completed', 'true');
      
      console.log('✅ Onboarding completed with session:', sessionId);
      
      // WICHTIG: Premium Status DIREKT von RevenueCat abfragen!
      console.log('🔄 Prüfe Premium Status direkt bei RevenueCat...');
      
      // Erst Käufe wiederherstellen
      try {
        const { revenueCatService } = await import('@/lib/services/revenueCatService');
        await revenueCatService.restorePurchases();
        console.log('✅ Käufe wiederhergestellt');
      } catch (e) {
        console.log('⚠️ Konnte Käufe nicht wiederherstellen:', e);
      }
      
      // Dann direkt Premium Status prüfen
      const { revenueCatService } = await import('@/lib/services/revenueCatService');
      const currentPremiumStatus = await revenueCatService.isPremium();
      
      console.log('🛒 Premium Status von RevenueCat:', currentPremiumStatus);
      
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

  const renderProgressBar = () => (
    <View style={styles.progressContainer}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: ((currentStep - 1) / 8) * 100 + '%' }]} />
      </View>
      <Text style={styles.progressText}>{currentStep - 1} von 8</Text>
    </View>
  );

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
                  <View style={styles.logoWithShadow}>
                    <CustomIcon 
                      name="iconBlack" 
                      size={140} 
                      color="white"
                    />
                  </View>
                  <Text style={styles.heroBrandTitle}>MarkenDetektive</Text>
                  <Text style={styles.heroBrandSubtitle}>NoNames enttarnen, clever sparen!</Text>
                </View>
              </View>
              
           

              <View style={styles.heroButtonContainer}>
                <TouchableOpacity style={styles.heroPrimaryButton} onPress={nextStep}>
                  <Text style={styles.heroPrimaryButtonText}>Los geht's! 🚀</Text>
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.heroSecondaryButton} onPress={skipOnboarding}>
                  <Text style={styles.heroSecondaryButtonText}>Später</Text>
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

  // Step 2: Country + Auth
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
          

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wähle dein Land</Text>
            
            <View style={styles.countryLayout}>
              {/* Deutschland - Hauptauswahl (volle Breite) */}
              <TouchableOpacity
                style={[styles.countryMain, country === 'DE' && styles.optionSelected]}
                onPress={() => setCountry('DE')}
              >
                <Text style={styles.countryMainFlag}>🇩🇪</Text>
                <Text 
                  style={[styles.countryMainText, country === 'DE' && styles.optionTextSelected]}
                >
                  Deutschland
                </Text>
                {country === 'DE' && <Text style={styles.checkmark}>✓</Text>}
              </TouchableOpacity>
              
              {/* Schweiz & Österreich - Nebenauswahl (Schweiz links) */}
              <View style={styles.countrySecondary}>
                <TouchableOpacity
                  style={[styles.countrySmall, country === 'CH' && styles.optionSelected]}
                  onPress={() => setCountry('CH')}
                >
                  <Text style={styles.countrySmallFlag}>🇨🇭</Text>
                  <Text 
                    style={[styles.countrySmallText, country === 'CH' && styles.optionTextSelected]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    Schweiz
                  </Text>
                  {country === 'CH' && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.countrySmall, country === 'AT' && styles.optionSelected]}
                  onPress={() => setCountry('AT')}
                >
                  <Text style={styles.countrySmallFlag}>🇦🇹</Text>
                  <Text 
                    style={[styles.countrySmallText, country === 'AT' && styles.optionTextSelected]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    Österreich
                  </Text>
                  {country === 'AT' && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.authSection}>
            <Text style={styles.authTitle}>Wie möchtest du fortfahren?</Text>
            <Text style={styles.authSubtitle}>
              Erstelle ein Konto für die beste Erfahrung oder fahre ohne Registrierung fort
            </Text>
            
            <View style={styles.buttonContainer}>
              <OnboardingButton 
                title="Ohne Account fortfahren" 
                onPress={async () => {
                  await signInAnonymously();
                  nextStep();
                }}
                loading={isLoading}
              />
              <OnboardingButton 
                title="Registrieren/Login" 
                onPress={() => router.push('/auth/login')} 
                variant="secondary" 
              />
              
              <Text style={styles.authInfoText}>
                Du kannst später jederzeit ein Konto erstellen
              </Text>
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>
      </>
    );
  }

  // Step 3: Märkte
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
            <Text style={styles.stepTitle}>Wo kaufst du am liebsten ein?</Text>
            <Text style={styles.subtitle}>Wähle 1-3 Märkte aus</Text>
            <Text style={styles.counter}>{selectedMarkets.length}/3 ausgewählt</Text>
            
            <FlatList
              data={markets}
              numColumns={2}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = selectedMarkets.some(m => m.id === item.id);
                const isDisabled = !isSelected && selectedMarkets.length >= 3;
                
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
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
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

  // Step 4: Akquisition
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

  // Step 5: Budget
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
          

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wieviel gibst du wöchentlich für deinen/euren Einkauf aus?</Text>
            <Text style={styles.subtitle}>Das hilft uns, dein Sparpotential zu berechnen.</Text>
            
            <View style={styles.budgetContainer}>
              <Text style={styles.budgetValue}>{budget}€</Text>
              <Text style={styles.budgetLabel}>pro Woche</Text>
            </View>

            <Slider
              style={styles.slider}
              minimumValue={25}
              maximumValue={500}
              value={budget}
              onValueChange={(value) => setBudget(Math.round(value))}
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

  // Step 6: Prioritäten
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
            <Text style={styles.stepTitle}>Was ist dir wichtig?</Text>
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
                <Text style={styles.savingsHeroTitle}>Dein Sparpotential!</Text>
                <Text style={styles.savingsHeroSubtitle}>
                  Basierend auf {budget}€ Wocheneinkauf
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

            <View style={styles.buttonContainer}>
              <OnboardingButton title="Fantastisch! Weiter" onPress={nextStep} />
            </View>
          </Animated.View>
        </SafeAreaView>
      </>
    );
  }

  // Step 9: Completion
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {renderProgressBar()}
        
        <View style={styles.completionContent}>
          <Text style={styles.completionIcon}>🎉</Text>
          <Text style={styles.title}>Alles bereit!</Text>
          <Text style={styles.subtitle}>
            Deine App ist jetzt personalisiert und bereit zum Sparen
          </Text>
        </View>

        <View style={styles.buttonContainer}>
          <OnboardingButton 
            title="App starten" 
            onPress={completeOnboarding}
            loading={isLoading}
          />
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
    shadowColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
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
  logoWithShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 8,
  },
  heroBrandTitle: {
    fontSize: 38,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    marginTop: 4,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
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
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
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
    color: '#4a4a4a',
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
    marginTop: 'auto',
    paddingBottom: 20,
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
    backgroundColor: colorScheme === 'dark' ? Colors.dark.cardBackground : 'white',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colorScheme === 'dark' ? Colors.dark.border : Colors.light.tabIconDefault + '60',
    minHeight: 140,
    justifyContent: 'center',
    marginHorizontal: 6,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    backgroundColor: colorScheme === 'dark' ? Colors.dark.cardBackground : 'white',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colorScheme === 'dark' ? Colors.dark.border : Colors.light.tabIconDefault + '60',
    minHeight: 100,
    justifyContent: 'center',
    margin: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    backgroundColor: colorScheme === 'dark' ? Colors.dark.tint + '15' : Colors.light.tint + '15',
    borderColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    borderWidth: 2,
    shadowColor: colorScheme === 'dark' ? Colors.dark.tint : Colors.light.tint,
    shadowOpacity: 0.3,
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
    backgroundColor: colorScheme === 'dark' ? Colors.dark.cardBackground : 'white',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colorScheme === 'dark' ? Colors.dark.border : Colors.light.tabIconDefault + '60',
    minHeight: 110,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    height: 40,
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
    marginBottom: 20,
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
  completionContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
});
