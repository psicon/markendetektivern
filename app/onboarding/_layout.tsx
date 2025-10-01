import { Stack } from 'expo-router';
import React from 'react';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: false, // Verhindere Zurück-Gesten im Onboarding
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
