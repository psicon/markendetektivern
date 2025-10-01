import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnboardingButton } from '@/components/ui/OnboardingButton';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/contexts/AuthContext';
import { OnboardingTrackingService } from '@/lib/services/onboardingTrackingService';

const { width } = Dimensions.get('window');

// Onboarding Data
const COUNTRIES = [
  { code: 'DE', name: 'Deutschland', flag: '🇩🇪' },
  { code: 'AT', name: 'Österreich', flag: '🇦🇹' },
  { code: 'CH', name: 'Schweiz', flag: '🇨🇭' },
] as const;

const MARKETS = [
  { id: 'aldi-sued', name: 'Aldi Süd', logo: '🛒' },
  { id: 'lidl', name: 'Lidl', logo: '🛒' },
  { id: 'rewe', name: 'REWE', logo: '🛒' },
  { id: 'edeka', name: 'EDEKA', logo: '🛒' },
  { id: 'penny', name: 'Penny', logo: '🛒' },
  { id: 'kaufland', name: 'Kaufland', logo: '🛒' },
];

const ACQUISITION_SOURCES = [
  { id: 'instagram', name: 'Instagram', icon: '📸' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵' },
  { id: 'friends', name: 'Freunde/Familie', icon: '👫' },
  { id: 'google', name: 'Google', icon: '🔍' },
  { id: 'appstore', name: 'App Store', icon: '📱' },
  { id: 'other', name: 'Anderes', icon: '💭' },
];

const PRIORITIES = [
  { id: 'preis', name: 'Preis', icon: '💰' },
  { id: 'inhaltsstoffe', name: 'Inhaltsstoffe', icon: '🧪' },
  { id: 'qualität', name: 'Qualität', icon: '⭐' },
  { id: 'marke', name: 'Marke', icon: '🏷️' },
  { id: 'anderes', name: 'Anderes', icon: '💭' },
];

export default function OnboardingScreen() {
  const { signInAnonymously } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  
  // Onboarding Data
  const [country, setCountry] = useState<'DE' | 'AT' | 'CH'>('DE');
  const [selectedMarket, setSelectedMarket] = useState<typeof MARKETS[0] | null>(null);
  const [acquisitionSource, setAcquisitionSource] = useState<string>('');
  const [acquisitionOther, setAcquisitionOther] = useState<string>('');
  const [budget, setBudget] = useState(100);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [prioritiesOther, setPrioritiesOther] = useState<string>('');
  const [loadingProgress] = useState(new Animated.Value(0));

  // ALLE useEffects IMMER aufrufen (Rules of Hooks)
  useEffect(() => {
    console.log(`📊 Onboarding: Step ${currentStep} viewed`);
    
    // Track Step Progress
    OnboardingTrackingService.updateStep(currentStep);
  }, [currentStep]);

  // Initialize Session beim ersten Load
  useEffect(() => {
    OnboardingTrackingService.initializeSession();
  }, []);

  // Loading Animation Effect (IMMER aufrufen)
  useEffect(() => {
    if (currentStep === 7) {
      // Auto-advance nach 3 Sekunden
      const timer = setTimeout(() => {
        setCurrentStep(8);
      }, 3000);
      
      // Progress Animation
      Animated.timing(loadingProgress, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: false,
      }).start();
      
      return () => clearTimeout(timer);
    }
  }, [currentStep, loadingProgress]);

  // App Close Detection (IMMER aufrufen)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        // User verlässt App während Onboarding
        if (currentStep > 1 && currentStep < 9) {
          OnboardingTrackingService.trackSkip(currentStep, 'app_closed');
        }
      }
    };

    const { AppState } = require('react-native');
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => subscription?.remove();
  }, [currentStep]);

  const nextStep = async () => {
    if (currentStep < 9) {
      setCurrentStep(currentStep + 1);
      // Update Step ohne Daten (einfacher)
      await OnboardingTrackingService.updateStep(currentStep + 1);
    }
  };

  const nextStepWithData = async (stepData: any) => {
    if (currentStep < 9) {
      setCurrentStep(currentStep + 1);
      // Update Step mit spezifischen Daten
      await OnboardingTrackingService.updateStep(currentStep + 1, stepData);
    }
  };

  const previousStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const completeOnboarding = async () => {
    setIsLoading(true);
    
    try {
      // Erstelle anonymen User falls nicht vorhanden
      await signInAnonymously();
      
      // Speichere Onboarding-Daten
      const onboardingData = {
        country,
        favoriteMarket: selectedMarket,
        acquisitionSource,
        weeklyBudgetEur: budget,
        priorities,
        estimatedSavingsPercent: 35,
        estimatedSavingsEurWeek: Math.round(budget * 0.35),
        completedAt: Date.now(),
        version: 'v1'
      };
      
        // Track Completion (wird automatisch in onboardingResultsV5 gespeichert)
        const { auth } = await import('@/lib/firebase');
        const userId = auth.currentUser?.uid || 'anonymous';
        await OnboardingTrackingService.trackCompletion(onboardingData, userId);
      
      // Markiere als abgeschlossen
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.default.setItem('onboarding_v1_completed', 'true');
      
      console.log('✅ Onboarding completed');
      
      // Navigate to main app
      router.replace('/(tabs)');
      
    } catch (error) {
      console.error('❌ Onboarding completion error:', error);
      Alert.alert('Fehler', 'Onboarding konnte nicht abgeschlossen werden');
    } finally {
      setIsLoading(false);
    }
  };

  const skipOnboarding = async () => {
    // Track Skip
    await OnboardingTrackingService.trackSkip(currentStep, 'later_button');
    router.replace('/(tabs)');
  };

  const renderProgressBar = () => (
    <View style={styles.progressContainer}>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(currentStep / 9) * 100}%` }]} />
      </View>
      <Text style={styles.progressText}>{currentStep} von 9</Text>
    </View>
  );

  // Step 1: Hero
  if (currentStep === 1) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <View style={styles.heroContent}>
            <Text style={styles.heroIcon}>🏪</Text>
            <Text style={styles.title}>Wir zeigen dir, wer dahinter steckt!</Text>
            <Text style={styles.subtitle}>
              Spare bis zu 100€ im Monat und erfahre wer hinter den NoName Produkten steckt
            </Text>
          </View>

          <View style={styles.buttonContainer}>
            <OnboardingButton title="Los geht's! 🚀" onPress={nextStep} />
            <OnboardingButton title="Später" onPress={skipOnboarding} variant="secondary" />
          </View>
          
          <Text style={styles.bottomText}>Dauert nur 2 Minuten • Jederzeit überspringbar</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Step 2: Country + Auth
  if (currentStep === 2) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <TouchableOpacity style={styles.backButton} onPress={previousStep}>
            <Text style={styles.backButtonText}>← Zurück</Text>
          </TouchableOpacity>

          <Text style={styles.stepTitle}>Wähle dein Land</Text>
          
          <View style={styles.countryGrid}>
            {COUNTRIES.map((c) => (
              <TouchableOpacity
                key={c.code}
                style={[styles.option, country === c.code && styles.optionSelected]}
                onPress={() => setCountry(c.code)}
              >
                <Text style={styles.optionIcon}>{c.flag}</Text>
                <Text style={[styles.optionText, country === c.code && styles.optionTextSelected]}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.stepTitle}>Wie möchtest du fortfahren?</Text>
          
          <View style={styles.buttonContainer}>
             <OnboardingButton 
               title="Ohne Account fortfahren" 
               onPress={async () => {
                 await signInAnonymously();
                 await nextStepWithData({ country, authChoice: 'anonymous' });
               }}
               loading={isLoading}
             />
             <OnboardingButton title="Registrieren" onPress={() => router.push('/auth/register')} variant="secondary" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Step 3: Markt
  if (currentStep === 3) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <TouchableOpacity style={styles.backButton} onPress={previousStep}>
            <Text style={styles.backButtonText}>← Zurück</Text>
          </TouchableOpacity>

          <Text style={styles.stepTitle}>Wo kaufst du normalerweise ein?</Text>
          
          <FlatList
            data={MARKETS}
            numColumns={2}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.marketOption, selectedMarket?.id === item.id && styles.optionSelected]}
                onPress={() => setSelectedMarket(item)}
              >
                <Text style={styles.optionIcon}>{item.logo}</Text>
                <Text style={[styles.optionText, selectedMarket?.id === item.id && styles.optionTextSelected]}>
                  {item.name}
                </Text>
              </TouchableOpacity>
            )}
          />

           <OnboardingButton 
             title="Weiter" 
             onPress={() => nextStepWithData({ favoriteMarket: selectedMarket })}
             disabled={!selectedMarket}
           />
        </View>
      </SafeAreaView>
    );
  }

  // Step 4: Akquisition (skippable)
  if (currentStep === 4) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <TouchableOpacity style={styles.backButton} onPress={previousStep}>
            <Text style={styles.backButtonText}>← Zurück</Text>
          </TouchableOpacity>

          <Text style={styles.stepTitle}>Wie hast du von uns gehört?</Text>
          
          <FlatList
            data={ACQUISITION_SOURCES}
            numColumns={2}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.option, acquisitionSource === item.id && styles.optionSelected]}
                onPress={() => {
                  setAcquisitionSource(item.id);
                  if (item.id === 'other') {
                    // Show text input for "Anderes"
                  }
                }}
              >
                <Text style={styles.optionIcon}>{item.icon}</Text>
                <Text style={[styles.optionText, acquisitionSource === item.id && styles.optionTextSelected]}>
                  {item.name}
                </Text>
              </TouchableOpacity>
            )}
          />

          <View style={styles.buttonContainer}>
            <OnboardingButton title="Weiter" onPress={() => nextStepWithData({ acquisitionSource })} />
            <OnboardingButton title="Überspringen" onPress={() => nextStepWithData({ acquisitionSource: 'skipped' })} variant="secondary" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Step 5: Budget
  if (currentStep === 5) {
    const estimatedSavings = Math.round(budget * 0.35);
    
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <TouchableOpacity style={styles.backButton} onPress={previousStep}>
            <Text style={styles.backButtonText}>← Zurück</Text>
          </TouchableOpacity>

          <Text style={styles.stepTitle}>Wieviel gibst du wöchentlich aus?</Text>
          
          <View style={styles.budgetContainer}>
            <Text style={styles.budgetValue}>{budget}€</Text>
            <Text style={styles.budgetLabel}>pro Woche</Text>
            
            <View style={styles.savingsPreview}>
              <Text style={styles.savingsValue}>≈ {estimatedSavings}€</Text>
              <Text style={styles.savingsLabel}>Ersparnis möglich</Text>
            </View>
          </View>

          <Slider
            style={styles.slider}
            minimumValue={25}
            maximumValue={500}
            value={budget}
            onValueChange={(value) => setBudget(Math.round(value))}
            minimumTrackTintColor={Colors.light.tint}
            maximumTrackTintColor={Colors.light.tabIconDefault}
            step={5}
          />
          
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>25€</Text>
            <Text style={styles.sliderLabel}>500€</Text>
          </View>

          <OnboardingButton title="Weiter" onPress={() => nextStepWithData({ weeklyBudgetEur: budget })} />
        </View>
      </SafeAreaView>
    );
  }

  // Step 6: Prioritäten
  if (currentStep === 6) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <TouchableOpacity style={styles.backButton} onPress={previousStep}>
            <Text style={styles.backButtonText}>← Zurück</Text>
          </TouchableOpacity>

          <Text style={styles.stepTitle}>Was ist dir wichtig?</Text>
          <Text style={styles.subtitle}>Wähle bis zu 3 Aspekte</Text>
          <Text style={styles.counter}>{priorities.length}/3 ausgewählt</Text>
          
          <FlatList
            data={PRIORITIES}
            numColumns={2}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const isSelected = priorities.includes(item.id);
              const isDisabled = !isSelected && priorities.length >= 3;
              
              return (
                <TouchableOpacity
                  style={[
                    styles.option,
                    isSelected && styles.optionSelected,
                    isDisabled && styles.optionDisabled
                  ]}
                  onPress={() => {
                    if (isSelected) {
                      setPriorities(priorities.filter(p => p !== item.id));
                    } else if (priorities.length < 3) {
                      setPriorities([...priorities, item.id]);
                    }
                  }}
                  disabled={isDisabled}
                >
                  <Text style={styles.optionIcon}>{item.icon}</Text>
                  <Text style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                    isDisabled && styles.optionTextDisabled
                  ]}>
                    {item.name}
                  </Text>
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            }}
          />

          <OnboardingButton 
            title="Weiter" 
            onPress={() => nextStepWithData({ priorities, prioritiesOther })}
            disabled={priorities.length === 0}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Step 7: Loading
  if (currentStep === 7) {

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <View style={styles.loadingContent}>
            <Text style={styles.loadingIcon}>⚡</Text>
            <Text style={styles.title}>Wir optimieren dein persönliches App-Erlebnis</Text>
            <Text style={styles.subtitle}>Einen Augenblick Geduld...</Text>
            
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
        </View>
      </SafeAreaView>
    );
  }

  // Step 8: Savings Chart
  if (currentStep === 8) {
    const weeklySavings = Math.round(budget * 0.35);
    const monthlySavings = weeklySavings * 4;
    
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <Text style={styles.title}>Dein Sparpotential! 💰</Text>
          <Text style={styles.subtitle}>Basierend auf {budget}€ Wocheneinkauf</Text>
          
          <View style={styles.savingsChart}>
            <View style={styles.chartRow}>
              <Text style={styles.chartLabel}>Aktuell:</Text>
              <Text style={styles.chartValue}>{budget}€</Text>
            </View>
            <View style={styles.chartRow}>
              <Text style={styles.chartLabel}>Mit NoNames:</Text>
              <Text style={styles.chartValueSavings}>{budget - weeklySavings}€</Text>
            </View>
            
            <View style={styles.savingsHighlight}>
              <Text style={styles.savingsAmount}>-{weeklySavings}€</Text>
              <Text style={styles.savingsText}>pro Woche gespart</Text>
            </View>
            
            <Text style={styles.projectionText}>
              Das sind {monthlySavings}€ pro Monat! 🎉
            </Text>
          </View>

          <OnboardingButton title="Fantastisch! Weiter" onPress={nextStep} />
        </View>
      </SafeAreaView>
    );
  }

  // Step 9: Paywall/Completion
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

        <OnboardingButton 
          title="App starten" 
          onPress={completeOnboarding}
          loading={isLoading}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  progressContainer: {
    alignItems: 'center',
    marginBottom: 30,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: Colors.light.tabIconDefault,
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.light.tint,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: Colors.light.text,
    opacity: 0.6,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 20,
  },
  backButtonText: {
    fontSize: 16,
    color: Colors.light.tint,
  },
  heroContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.light.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.light.text,
    textAlign: 'center',
    opacity: 0.8,
    lineHeight: 24,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  counter: {
    fontSize: 16,
    color: Colors.light.tint,
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '600',
  },
  countryGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 40,
  },
  option: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.tabIconDefault,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 80,
    justifyContent: 'center',
    margin: 6,
  },
  optionSelected: {
    backgroundColor: Colors.light.tint + '20',
    borderColor: Colors.light.tint,
  },
  optionDisabled: {
    opacity: 0.4,
  },
  optionIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  optionText: {
    fontSize: 14,
    color: Colors.light.text,
    fontWeight: '500',
    textAlign: 'center',
  },
  optionTextSelected: {
    color: Colors.light.tint,
    fontWeight: 'bold',
  },
  optionTextDisabled: {
    opacity: 0.5,
  },
  checkmark: {
    position: 'absolute',
    top: 8,
    right: 8,
    color: Colors.light.tint,
    fontSize: 16,
    fontWeight: 'bold',
  },
  marketOption: {
    flex: 1,
    margin: 6,
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.tabIconDefault,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 80,
    justifyContent: 'center',
  },
  budgetContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  budgetValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: Colors.light.tint,
    marginBottom: 8,
  },
  budgetLabel: {
    fontSize: 16,
    color: Colors.light.text,
    opacity: 0.7,
    marginBottom: 20,
  },
  savingsPreview: {
    alignItems: 'center',
    padding: 16,
    backgroundColor: Colors.light.tint + '10',
    borderRadius: 12,
  },
  savingsValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.light.tint,
  },
  savingsLabel: {
    fontSize: 12,
    color: Colors.light.text,
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
    color: Colors.light.text,
    opacity: 0.6,
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
  loadingBarContainer: {
    width: '80%',
    height: 8,
    backgroundColor: Colors.light.tabIconDefault,
    borderRadius: 4,
    marginTop: 40,
    overflow: 'hidden',
  },
  loadingBar: {
    height: '100%',
    backgroundColor: Colors.light.tint,
    borderRadius: 4,
  },
  savingsChart: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginBottom: 8,
    backgroundColor: Colors.light.tabIconDefault,
    borderRadius: 8,
  },
  chartLabel: {
    fontSize: 16,
    color: Colors.light.text,
  },
  chartValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.light.text,
  },
  chartValueSavings: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.light.tint,
  },
  savingsHighlight: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: Colors.light.tint + '10',
    borderRadius: 16,
    marginVertical: 24,
    borderWidth: 2,
    borderColor: Colors.light.tint + '30',
  },
  savingsAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Colors.light.tint,
  },
  savingsText: {
    fontSize: 14,
    color: Colors.light.text,
    opacity: 0.7,
  },
  projectionText: {
    fontSize: 18,
    color: Colors.light.text,
    textAlign: 'center',
    fontWeight: '600',
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
    marginBottom: 20,
  },
  bottomText: {
    fontSize: 12,
    color: Colors.light.text,
    textAlign: 'center',
    opacity: 0.5,
    marginBottom: 20,
  },
});
