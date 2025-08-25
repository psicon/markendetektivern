import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { TouchableOpacity } from 'react-native';

// Hook für statische Header-Optionen die Font-Flashing vermeiden
export const useStaticHeaderOptions = (title: string) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();

  return useMemo(() => ({
    title,
    headerStyle: { 
      backgroundColor: colors.primary,
    },
    headerTintColor: 'white',
    headerTitleStyle: { 
      color: 'white',
      fontFamily: 'Nunito_600SemiBold',
      fontSize: 17
    },
    headerShadowVisible: false,
    headerBackVisible: false,
    gestureEnabled: true,
    animation: 'slide_from_right' as const,
    headerLeft: () => (
      <TouchableOpacity 
        onPress={() => router.back()}
        style={{ 
          paddingLeft: 0, 
          paddingRight: 8, 
          paddingVertical: 8 
        }}
      >
        <IconSymbol name="chevron.left" size={24} color="white" />
      </TouchableOpacity>
    ),
  }), [title, colors.primary, router]);
};
