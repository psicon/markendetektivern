import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Platform, TouchableOpacity, View } from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';

function CustomTabBarButton({ children, onPress }: any) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  return (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <TouchableOpacity
        style={{
          top: -25,
          justifyContent: 'center',
          alignItems: 'center',
          width: 70,
          height: 70,
          borderRadius: 35,
          backgroundColor: colors.primary,
          elevation: 10,
          shadowColor: colorScheme === 'dark' ? colors.primary : '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: colorScheme === 'dark' ? 0.4 : 0.25,
          shadowRadius: 6,
          borderWidth: 3,
          borderColor: Colors[colorScheme ?? 'light'].background,
        }}
        onPress={onPress}
      >
        {children}
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { user, loading } = useAuth();
  const router = useRouter();

  // Temporarily disabled for testing - uncomment to enable auth guard
  // useEffect(() => {
  //   if (!loading && !user) {
  //     router.replace('/auth/welcome');
  //   }
  // }, [user, loading, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors[colorScheme ?? 'light'].background }}>
        <ActivityIndicator size="large" color={Colors[colorScheme ?? 'light'].primary} />
      </View>
    );
  }

  // Temporarily allow access without authentication for testing
  // if (!user) {
  //   return null; // Will redirect to welcome screen
  // }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        headerTitleStyle: {
          fontFamily: 'Nunito_600SemiBold',
        },
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: Platform.OS === 'ios' ? 90 : 80,
          backgroundColor: Colors[colorScheme ?? 'light'].cardBackground,
          borderTopLeftRadius: 25,
          borderTopRightRadius: 25,
          borderTopWidth: 0,
          paddingHorizontal: 10,
          paddingTop: 10,
          shadowColor: colorScheme === 'dark' ? '#000' : '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.15,
          shadowRadius: 12,
          elevation: 20,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
          tabBarLabelStyle: { 
            fontSize: 11,

            marginTop: 2,
          },
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Stöbern',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol 
              size={28} 
              name="magnifyingglass" 
              color={focused ? 'white' : 'white'}
            />
          ),
          tabBarButton: (props) => <CustomTabBarButton {...props} />,
          tabBarLabelStyle: { display: 'none' },
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'Mehr',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="line.3.horizontal" color={color} />,
          tabBarLabelStyle: { 
            fontSize: 11,

            marginTop: 2,
          },
        }}
      />
    </Tabs>
  );
}
