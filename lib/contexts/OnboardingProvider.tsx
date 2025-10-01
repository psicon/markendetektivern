import React, { createContext, ReactNode, useContext, useState } from 'react';

// Onboarding Data Types
export interface OnboardingData {
  // Step 2: Country + Auth
  country?: 'DE' | 'AT' | 'CH';
  authChoice?: 'register' | 'login' | 'anonymous';
  
  // Step 3: Lieblingsmarkt
  favoriteMarket?: {
    id: string;
    name: string;
    logo?: string;
  };
  
  // Step 4: Akquisitionsquelle
  acquisitionSource?: string;
  acquisitionSourceOther?: string;
  
  // Step 5: Budget
  weeklyBudgetEur?: number;
  
  // Step 6: Prioritäten
  priorities?: string[];
  prioritiesOther?: string;
  
  // Berechnete Werte (Step 8)
  estimatedSavingsPercent?: number;
  estimatedSavingsEurWeek?: number;
  
  // Tracking
  startTime: number;
  currentStep: number;
  completedSteps: number[];
}

interface OnboardingContextType {
  data: OnboardingData;
  updateData: (updates: Partial<OnboardingData>) => void;
  nextStep: () => void;
  previousStep: () => void;
  goToStep: (step: number) => void;
  completeOnboarding: () => Promise<void>;
  isLoading: boolean;
  error?: string;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within OnboardingProvider');
  }
  return context;
};

interface OnboardingProviderProps {
  children: ReactNode;
}

export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({ children }) => {
  const [data, setData] = useState<OnboardingData>({
    startTime: Date.now(),
    currentStep: 1,
    completedSteps: []
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const updateData = (updates: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...updates }));
  };

  const nextStep = () => {
    setData(prev => ({
      ...prev,
      currentStep: prev.currentStep + 1,
      completedSteps: [...prev.completedSteps, prev.currentStep]
    }));
  };

  const previousStep = () => {
    setData(prev => ({
      ...prev,
      currentStep: Math.max(1, prev.currentStep - 1)
    }));
  };

  const goToStep = (step: number) => {
    setData(prev => ({ ...prev, currentStep: step }));
  };

  const completeOnboarding = async () => {
    setIsLoading(true);
    setError(undefined);
    
    try {
      // Berechne Ersparnisse basierend auf Budget
      const savingsPercent = 35; // 35% durchschnittliche NoName Ersparnis
      const savingsEurWeek = Math.round((data.weeklyBudgetEur || 0) * (savingsPercent / 100));
      
      const finalData = {
        ...data,
        estimatedSavingsPercent: savingsPercent,
        estimatedSavingsEurWeek: savingsEurWeek,
        completedAt: Date.now(),
        completedSteps: [...data.completedSteps, data.currentStep]
      };
      
      // Speichere in Firestore (onboardingResults Sammlung)
      await saveOnboardingResults(finalData);
      
      // Markiere Onboarding als abgeschlossen
      await markOnboardingCompleted();
      
      console.log('✅ Onboarding completed successfully');
      
    } catch (err) {
      console.error('❌ Error completing onboarding:', err);
      setError('Fehler beim Speichern der Daten');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <OnboardingContext.Provider
      value={{
        data,
        updateData,
        nextStep,
        previousStep,
        goToStep,
        completeOnboarding,
        isLoading,
        error
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};

// Helper Functions
async function saveOnboardingResults(data: OnboardingData) {
  try {
    // Dynamischer Import um Circular Dependencies zu vermeiden
    const { addDoc, collection } = await import('firebase/firestore');
    const { db } = await import('@/lib/firebase');
    const { auth } = await import('@/lib/firebase');
    
    // Hole aktuellen User
    const currentUser = auth.currentUser;
    const userId = currentUser?.uid || `anonymous_${Date.now()}`;
    
    const onboardingResult = {
      userId,
      country: data.country,
      favoriteMarket: data.favoriteMarket,
      acquisitionSource: data.acquisitionSource,
      acquisitionSourceOther: data.acquisitionSourceOther,
      weeklyBudgetEur: data.weeklyBudgetEur,
      priorities: data.priorities,
      prioritiesOther: data.prioritiesOther,
      estimatedSavingsPercent: data.estimatedSavingsPercent,
      estimatedSavingsEurWeek: data.estimatedSavingsEurWeek,
      
      // Metadata
      startTime: data.startTime,
      completedAt: Date.now(),
      totalDurationMs: Date.now() - data.startTime,
      completedSteps: data.completedSteps,
      version: 'v1',
      
      // Device Info (optional)
      platform: 'mobile',
      appVersion: '1.0.0' // TODO: Get from app.json
    };
    
    console.log('💾 Saving onboarding results:', onboardingResult);
    const docRef = await addDoc(collection(db, 'onboardingResults'), onboardingResult);
    console.log('✅ Onboarding results saved with ID:', docRef.id);
    
  } catch (error) {
    console.error('❌ Error saving onboarding results:', error);
    throw error;
  }
}

async function markOnboardingCompleted() {
  try {
    const { OnboardingService } = await import('@/lib/services/onboardingService');
    await OnboardingService.markOnboardingCompleted();
    console.log('✅ Onboarding marked as completed');
  } catch (error) {
    console.error('❌ Error marking onboarding as completed:', error);
    throw error;
  }
}
