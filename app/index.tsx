import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/Colors';
import { OnboardingService } from '@/lib/services/onboardingService';

/**
 * App Entry Point - Bestimmt initiale Route basierend auf Onboarding Status
 */
export default function IndexScreen() {
  useEffect(() => {
    determineInitialRoute();
  }, []);

  const determineInitialRoute = async () => {
    try {
      console.log('🚀 App starting - checking onboarding status...');
      
      // Kurze Verzögerung für bessere UX (Splash Screen Zeit)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const isCompleted = await OnboardingService.isOnboardingCompleted();
      console.log('📍 Onboarding completed:', isCompleted);
      
      if (isCompleted) {
        router.replace('/(tabs)');
      } else {
        router.replace('/onboarding');
      }
      
    } catch (error) {
      console.error('❌ Error determining initial route:', error);
      // Fallback zu Main App
      router.replace('/(tabs)');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.loadingText}>MarkenDetektive</Text>
        <Text style={styles.subtext}>Wird geladen...</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.light.text,
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
    color: Colors.light.text,
    opacity: 0.6,
  },
});
