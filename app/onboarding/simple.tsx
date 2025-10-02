// Simple Onboarding ohne Hooks-Probleme
import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Animated,
    Dimensions,
    FlatList,
    Image,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomIcon } from '@/components/ui/CustomIcon';
import { OnboardingButton } from '@/components/ui/OnboardingButton';
import { Colors } from '@/constants/Colors';
import { useAuth } from '@/lib/contexts/AuthContext';

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
  { id: 'anderes', name: 'Anderes', icon: '💭' },
];

export default function OnboardingScreen() {
  const { signInAnonymously } = useAuth();
  
  // ALLE useState IMMER (keine conditionals!)
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [country, setCountry] = useState<'DE' | 'AT' | 'CH'>('DE');
  const [markets, setMarkets] = useState<any[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<any>(null);
  const [marketOther, setMarketOther] = useState('');
  const [acquisitionSource, setAcquisitionSource] = useState('');
  const [acquisitionOther, setAcquisitionOther] = useState('');
  const [budget, setBudget] = useState(100);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [prioritiesOther, setPrioritiesOther] = useState('');
  const [loadingProgress] = useState(new Animated.Value(0));
  const [loadingMessage, setLoadingMessage] = useState('🕵️ Die Detektive beginnen ihre Recherche...');

  // ALLE useEffects IMMER (keine conditionals!)
  useEffect(() => {
    console.log(`📊 Onboarding: Step ${currentStep} viewed`);
  }, [currentStep]);

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
      }, 600);

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

  const nextStep = () => {
    if (currentStep < 9) {
      setCurrentStep(currentStep + 1);
    }
  };

  const previousStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const skipOnboarding = async () => {
    // Speichere Skip
    try {
      const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
      const { db, auth } = await import('@/lib/firebase');
      
      await addDoc(collection(db, 'onboardingResultsV5'), {
        userId: auth.currentUser?.uid || 'anonymous',
        status: 'skipped',
        skippedAtStep: currentStep,
        startTime: serverTimestamp(),
        completedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('❌ Skip tracking error:', error);
    }
    
    router.replace('/(tabs)');
  };

  const completeOnboarding = async () => {
    setIsLoading(true);
    
    try {
      await signInAnonymously();
      
      const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
      const { db, auth } = await import('@/lib/firebase');
      
      const onboardingData = {
        userId: auth.currentUser?.uid || 'anonymous',
        status: 'completed',
        country,
        favoriteMarket: selectedMarket?.isOther 
          ? { id: 'other', name: marketOther, isCustom: true }
          : selectedMarket,
        acquisitionSource,
        acquisitionOther: acquisitionSource === 'sonstiges' ? acquisitionOther : undefined,
        weeklyBudgetEur: budget,
        priorities,
        prioritiesOther: priorities.includes('anderes') ? prioritiesOther : undefined,
        estimatedSavingsPercent: 35,
        estimatedSavingsEurWeek: Math.round(budget * 0.35),
        startTime: serverTimestamp(),
        completedAt: serverTimestamp(),
        version: 'v1'
      };
      
      // Filtere undefined values
      const cleanData: any = {};
      Object.keys(onboardingData).forEach(key => {
        if (onboardingData[key] !== undefined) {
          cleanData[key] = onboardingData[key];
        }
      });
      
      await addDoc(collection(db, 'onboardingResultsV5'), cleanData);
      
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.default.setItem('onboarding_v1_completed', 'true');
      
      console.log('✅ Onboarding completed');
      router.replace('/(tabs)');
      
    } catch (error) {
      console.error('❌ Onboarding error:', error);
      Alert.alert('Fehler', 'Onboarding konnte nicht abgeschlossen werden');
    } finally {
      setIsLoading(false);
    }
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
            <View style={styles.logoContainer}>
              <CustomIcon 
                name="iconBlack" 
                size={80} 
                color={Colors.light.tint}
              />
              <Text style={styles.brandTitle}>MarkenDetektive</Text>
              <Text style={styles.brandSubtitle}>NoNames enttarnen, clever sparen!</Text>
            </View>
            
            <Text style={styles.subtitle}>
              Spare über 1.200€ im Jahr und erfahre welche Marken hinter NoName Produkten stecken
            </Text>
          </View>

          <View style={styles.buttonContainer}>
            <OnboardingButton title="Los geht's! 🚀" onPress={nextStep} />
            <OnboardingButton title="Später" onPress={skipOnboarding} variant="secondary" />
            
            <Text style={styles.bottomText}>Dauert nur 2 Minuten • Jederzeit überspringbar</Text>
          </View>
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

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wähle dein Land</Text>
            
            <View style={styles.countryGrid}>
              {COUNTRIES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[styles.option, country === c.code && styles.optionSelected]}
                  onPress={() => setCountry(c.code)}
                >
                  <Text style={styles.optionIcon}>{c.flag}</Text>
                  <Text 
                    style={[styles.optionText, country === c.code && styles.optionTextSelected]}
                    numberOfLines={1}
                  >
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
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
        </View>
      </SafeAreaView>
    );
  }

  // Step 3: Märkte
  if (currentStep === 3) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <TouchableOpacity style={styles.backButton} onPress={previousStep}>
            <Text style={styles.backButtonText}>← Zurück</Text>
          </TouchableOpacity>

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wo kaufst du normalerweise ein?</Text>
            
            <FlatList
              data={markets}
              numColumns={2}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.marketOption, selectedMarket?.id === item.id && styles.optionSelected]}
                  onPress={() => setSelectedMarket(item)}
                >
                  {item.bild ? (
                    <Image source={{ uri: item.bild }} style={styles.marketLogo} />
                  ) : (
                    <Text style={styles.optionIcon}>{item.logo || '🛒'}</Text>
                  )}
                  <Text 
                    style={[styles.optionText, selectedMarket?.id === item.id && styles.optionTextSelected]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              )}
            />

            {selectedMarket?.isOther && (
              <View style={styles.textInputContainer}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Welcher Markt ist das?"
                  value={marketOther}
                  onChangeText={setMarketOther}
                  maxLength={50}
                  placeholderTextColor={Colors.light.text + '80'}
                />
              </View>
            )}
          </View>

          <View style={styles.buttonContainer}>
            <OnboardingButton 
              title="Weiter" 
              onPress={nextStep}
              disabled={!selectedMarket || (selectedMarket?.isOther && marketOther.trim() === '')}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Step 4: Akquisition
  if (currentStep === 4) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <TouchableOpacity style={styles.backButton} onPress={previousStep}>
            <Text style={styles.backButtonText}>← Zurück</Text>
          </TouchableOpacity>

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wie hast du von uns gehört?</Text>
            
            <FlatList
              data={ACQUISITION_SOURCES}
              numColumns={2}
              keyExtractor={(item) => item.id}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, acquisitionSource === item.id && styles.optionSelected]}
                  onPress={() => setAcquisitionSource(item.id)}
                >
                  <Text style={styles.optionIcon}>{item.icon}</Text>
                  <Text 
                    style={[styles.optionText, acquisitionSource === item.id && styles.optionTextSelected]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
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
                  placeholderTextColor={Colors.light.text + '80'}
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
            <OnboardingButton title="Überspringen" onPress={nextStep} variant="secondary" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Step 5: Budget
  if (currentStep === 5) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {renderProgressBar()}
          
          <TouchableOpacity style={styles.backButton} onPress={previousStep}>
            <Text style={styles.backButtonText}>← Zurück</Text>
          </TouchableOpacity>

          <View style={styles.mainContent}>
            <Text style={styles.stepTitle}>Wieviel gibst du wöchentlich für deinen/euren Einkauf aus?</Text>
            <Text style={styles.subtitle}>Das hilft uns, dein Sparpotential zu berechnen</Text>
            
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
              minimumTrackTintColor={Colors.light.tint}
              maximumTrackTintColor={Colors.light.tabIconDefault}
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
                      styles.option,
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

            {priorities.includes('anderes') && (
              <View style={styles.textInputContainer}>
                <TextInput
                  style={styles.textInput}
                  placeholder="Was ist dir sonst noch wichtig?"
                  value={prioritiesOther}
                  onChangeText={setPrioritiesOther}
                  maxLength={50}
                  placeholderTextColor={Colors.light.text + '80'}
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
            <Text style={styles.loadingIcon}>🕵️</Text>
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
          
          <View style={styles.mainContent}>
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
          </View>

          <View style={styles.buttonContainer}>
            <OnboardingButton title="Fantastisch! Weiter" onPress={nextStep} />
          </View>
        </View>
      </SafeAreaView>
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
    marginBottom: 20,
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
    fontFamily: 'Nunito_400Regular',
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
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.tint,
  },
  heroContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
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
    fontSize: 28,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    textAlign: 'center',
    opacity: 0.8,
    lineHeight: 24,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.text,
    marginBottom: 20,
    textAlign: 'center',
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
    color: Colors.light.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  authSubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  authInfoText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    textAlign: 'center',
    opacity: 0.5,
    marginTop: 12,
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
    backgroundColor: Colors.light.background + 'CC',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.light.tabIconDefault + '40',
    minHeight: 80,
    justifyContent: 'center',
    margin: 6,
  },
  optionSelected: {
    backgroundColor: Colors.light.tint + '20',
    borderColor: Colors.light.tint,
  },
  optionDisabled: {
    opacity: 0.3,
  },
  optionIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  optionText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.text,
    textAlign: 'center',
  },
  optionTextSelected: {
    color: Colors.light.tint,
    fontWeight: 'bold',
  },
  optionTextDisabled: {
    opacity: 0.5,
  },
  marketOption: {
    flex: 1,
    margin: 6,
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.background + 'CC',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.light.tabIconDefault + '40',
    minHeight: 100,
    justifyContent: 'center',
  },
  marketLogo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginBottom: 8,
  },
  textInputContainer: {
    marginTop: 20,
  },
  textInput: {
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.light.tabIconDefault,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    borderWidth: 2,
    borderColor: Colors.light.tint + '40',
  },
  budgetContainer: {
    alignItems: 'center',
    marginVertical: 40,
  },
  budgetValue: {
    fontSize: 48,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
    marginBottom: 8,
  },
  budgetLabel: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
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
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
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
    top: 8,
    right: 8,
    color: Colors.light.tint,
    fontSize: 16,
    fontWeight: 'bold',
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
    alignItems: 'center',
    marginVertical: 40,
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
    fontFamily: 'Nunito_500Medium',
    color: Colors.light.text,
  },
  chartValue: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'Nunito_600SemiBold',
    color: Colors.light.text,
  },
  chartValueSavings: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'Nunito_600SemiBold',
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
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.tint,
  },
  savingsText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: Colors.light.text,
    opacity: 0.7,
  },
  projectionText: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    color: Colors.light.text,
    textAlign: 'center',
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
});
