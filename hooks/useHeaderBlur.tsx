import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Platform, TouchableOpacity } from 'react-native';

interface HeaderBlurOptions {
  title: string;
  showBackButton?: boolean;
  customBackgroundColor?: string;
}

export const useHeaderBlur = ({ 
  title, 
  showBackButton = true, 
  customBackgroundColor 
}: HeaderBlurOptions) => {
  const navigation = useNavigation();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const [scrollY, setScrollY] = useState(0);
  const [headerBlurred, setHeaderBlurred] = useState(false);

  const primaryColor = customBackgroundColor || colors.primary;

  // Konvertiere Hex zu RGBA für Blur-Effekt
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Header-Optionen mit dynamischem Blur
  const updateHeaderOptions = (isBlurred: boolean) => {
    const baseOptions: any = {
      title,
      headerStyle: { 
        backgroundColor: isBlurred 
          ? (Platform.OS === 'ios' ? 'transparent' : hexToRgba(primaryColor, 0.85))
          : primaryColor,
      },
      headerTintColor: 'white',
      headerTitleStyle: { 
        color: 'white',
        fontFamily: 'Nunito_600SemiBold',
        fontSize: 17
      },
      headerShadowVisible: isBlurred,
      headerBackVisible: false,
      gestureEnabled: true,
      animation: 'slide_from_right',
    };

    // iOS Blur-Effekt
    if (Platform.OS === 'ios' && isBlurred) {
      baseOptions.headerTransparent = true;
      baseOptions.headerBlurEffect = 'regular';
    }

    // Back-Button
    if (showBackButton) {
      const backButton = () => (
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
      );
      baseOptions.headerLeft = backButton;
    }

    navigation.setOptions(baseOptions);
  };

  // Header-Optionen sofort setzen
  useLayoutEffect(() => {
    updateHeaderOptions(false);
  }, [navigation, router, primaryColor]);

  // Header-Blur basierend auf Scroll-Position
  useEffect(() => {
    const shouldBlur = scrollY > 50;
    if (shouldBlur !== headerBlurred) {
      setHeaderBlurred(shouldBlur);
      updateHeaderOptions(shouldBlur);
    }
  }, [scrollY, headerBlurred]);

  // Scroll-Handler für ScrollView
  const handleScroll = (event: any) => {
    setScrollY(event.nativeEvent.contentOffset.y);
  };

  return {
    handleScroll,
    scrollEventThrottle: 16,
    scrollY,
    headerBlurred,
  };
};