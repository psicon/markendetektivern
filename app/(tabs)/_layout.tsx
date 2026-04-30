import { Tabs, useRouter, useSegments } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/HapticTab';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';

function CustomTabBarButton({ children, onPress, accessibilityState }: any) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const segments = useSegments();
  const selected = segments[1] === 'explore';
  const insets = useSafeAreaInsets();
  
  return (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-start',
    }}>
      <TouchableOpacity
        style={{
          top: Platform.OS === 'ios' ? -36 : -24,
          justifyContent: 'center',
          alignItems: 'center',
          width: Platform.OS === 'ios' ? 70 : 56,
          height: Platform.OS === 'ios' ? 70 : 56,
          borderRadius: Platform.OS === 'ios' ? 35 : 28,
          backgroundColor: colors.primary,
          elevation: Platform.OS === 'ios' ? 0 : 6,
          shadowColor: colorScheme === 'dark' ? colors.primary : '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: Platform.OS === 'ios' ? (colorScheme === 'dark' ? 0.4 : 0.25) : 0,
          shadowRadius: Platform.OS === 'ios' ? 6 : 0,
          borderWidth: 3,
          borderColor: selected ? colors.secondary : Colors[colorScheme ?? 'light'].background,
        }}
        onPress={onPress}
      >
        <CustomIcon 
          name="iconBlack" 
          size={Platform.OS === 'ios' ? 42 : 36} 
          color="white"
        />
      </TouchableOpacity>
      <Text style={{
        marginTop: Platform.OS === 'ios' ? -33 : -20,
        fontSize: 11,
        fontFamily: 'Nunito_500Medium',
        color: selected ? colors.primary : colors.tabIconDefault,
      }}>
        Stöbern
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { user, loading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  // Tab Bar ausblenden wenn Keyboard sichtbar (iOS + Android)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const keyboardShow = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const keyboardHide = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      keyboardShow.remove();
      keyboardHide.remove();
    };
  }, []);

  // Escape-hatch — if auth resolved (loading done) but the user
  // is null, the auto-anonymous-login refused (e.g. registered
  // backup exists in AsyncStorage and Firebase didn't restore the
  // session). Without an explicit redirect the tab layout would
  // render a blank background forever. Push the user to the
  // welcome screen so they can log in, register, or skip to
  // anonymous mode — anything but stuck.
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth/welcome' as any);
    }
  }, [loading, user, router]);

  // Auto-anonymous login typically resolves in <300 ms. We
  // deliberately do NOT show a centered ActivityIndicator here —
  // it flashes as a "spinner on the homepage" because the native
  // splash has just faded and the user expects content. Instead,
  // render a quiet themed background while we wait. If the wait
  // is short (the hot path), this is invisible — first paint is
  // the actual home tab. If the wait is long, the user sees a
  // calm coloured screen, not a noisy spinner.
  if (loading || !user) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors[colorScheme ?? 'light'].background,
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      enabled={Platform.OS === 'ios'}
    >
      <Tabs
        screenOptions={{
        // Lazy mount — nur Home rendert beim App-Start. Stöbern und
        // Rewards mounten erst beim ersten Tap des jeweiligen Tabs.
        //
        // Hintergrund: `lazy: false` warmte zwar den JSX-Tree
        // vor (kürzerer Tab-Switch-Lag beim ersten Tap), feuerte
        // aber AUCH alle useEffects der inaktiven Tabs sofort —
        // das waren ~1.000+ zusätzliche Firestore-Reads pro Cold-
        // Start für User die andere Tabs nie besuchten. Plus: Home
        // konkurrierte beim Mount mit Stöbern/Rewards um Firestore-
        // Reads und JS-Thread-Zeit.
        //
        // Mit `lazy: true` rendert Home schnell, andere Tabs lazy.
        // Skeletons in jeder Section federn den ~100-200ms-JSX-
        // Mount-Lag beim ersten Stöbern-Tap visuell ab — der User
        // sieht sofort Shimmer, dann Daten.
        lazy: true,
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tabIconSelected,
        tabBarInactiveTintColor: Colors[colorScheme ?? 'light'].tabIconDefault,
        headerShown: false,
        headerTitleStyle: {
          fontFamily: 'Nunito_600SemiBold',
        },
        tabBarButton: HapticTab,
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 90,
            backgroundColor: Colors[colorScheme ?? 'light'].cardBackground,
            borderTopLeftRadius: 25,
            borderTopRightRadius: 25,
            borderTopWidth: 0,
            paddingHorizontal: 10,
            paddingTop: 10,
            paddingBottom: insets.bottom,
            shadowColor: colorScheme === 'dark' ? '#000' : '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.15,
            shadowRadius: 12,
            display: isKeyboardVisible ? 'none' : 'flex', // Tab Bar ausblenden bei Keyboard
          },
          android: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 62 + insets.bottom,
            backgroundColor: Colors[colorScheme ?? 'light'].cardBackground,
            borderTopLeftRadius: 25,
            borderTopRightRadius: 25,
            borderTopWidth: 0,
            paddingHorizontal: 10,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 8),
            elevation: 0,
            display: isKeyboardVisible ? 'none' : 'flex', // Tab Bar auch auf Android ausblenden
          },
        }),
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: 'Nunito_500Medium',
          marginTop: 2,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Stöbern',
          tabBarButton: (props) => <CustomTabBarButton {...props} />,
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={24}
              name={focused ? 'trophy.fill' : 'trophy'}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
    </KeyboardAvoidingView>
  );
}
