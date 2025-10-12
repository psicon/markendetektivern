import { CustomIcon } from '@/components/ui/CustomIcon';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');
const SCREEN_HEIGHT = Dimensions.get('window').height;
const SCREEN_WIDTH = Dimensions.get('window').width;
const isSmallDevice = SCREEN_HEIGHT < 700;
const isAndroid = Platform.OS === 'android';

interface SplashScreenProps {
  onAnimationComplete?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onAnimationComplete }) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const logoScale = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const backgroundOpacity = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    // Pulsations-Animation für Loading-Punkt
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.2,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );

    // Splash-Animation-Sequenz
    const splashSequence = Animated.sequence([
      // 1. Logo erscheint mit Scale-Animation
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),
      
      // 2. Text erscheint nach kurzer Verzögerung
      Animated.timing(textOpacity, {
        toValue: 1,
        duration: 600,
        delay: 200,
        useNativeDriver: true,
      }),
      
      // 3. Kurz halten
      Animated.delay(800),
      
      // 4. Fade-out
      Animated.timing(backgroundOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]);

    // Starte Pulsations-Animation sofort
    pulseAnimation.start();

    splashSequence.start(() => {
      onAnimationComplete?.();
    });

    // Backup-Timer für den Fall, dass die Animation hängt
    const timeout = setTimeout(() => {
      onAnimationComplete?.();
    }, 4000);

    return () => {
      clearTimeout(timeout);
      splashSequence.stop();
      pulseAnimation.stop();
    };
  }, [logoScale, logoOpacity, textOpacity, backgroundOpacity, pulseAnim, onAnimationComplete]);

  // Android: Einfacher, zentrierter Screen ohne SafeAreaView
  if (isAndroid) {
    return (
      <Animated.View 
        style={[
          styles.container,
          { opacity: backgroundOpacity }
        ]}
      >
        <LinearGradient
          colors={[colors.primary, colors.secondary || colors.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        
        <View style={styles.androidContent}>
          {/* Logo */}
          <Animated.View
            style={[
              styles.androidLogoWrapper,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <CustomIcon 
              name="iconBlack" 
              size={60} 
              color="white"
            />
          </Animated.View>
   
          {/* Text - Einfach und sicher */}
          <Animated.View
            style={[
              styles.androidTextContainer,
              { opacity: textOpacity },
            ]}
          >
            <Text style={styles.androidAppName}>
              MarkenDetektive
            </Text>
            <Text style={styles.androidTagline}>
              Wir zeigen dir,{'\n'}wer dahinter steckt!
            </Text>
          </Animated.View>

          {/* Loading Indicator */}
          <Animated.View
            style={[
              styles.androidLoadingContainer,
              { opacity: textOpacity },
            ]}
          >
            <Animated.View
              style={[
                styles.loadingDot,
                {
                  transform: [{ scale: pulseAnim }],
                  opacity: textOpacity,
                },
              ]}
            />
          </Animated.View>
        </View>
      </Animated.View>
    );
  }

  // iOS: Original Screen
  return (
    <Animated.View 
      style={[
        styles.container,
        { opacity: backgroundOpacity }
      ]}
    >
      <LinearGradient
        colors={[colors.primary, colors.secondary || colors.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.content}>
          {/* Logo/Icon mit Animation */}
          <Animated.View
            style={[
              styles.logoWrapper,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <CustomIcon 
              name="iconBlack" 
              size={isSmallDevice ? 60 : 70} 
              color="white"
            />
          </Animated.View>
   
          {/* App Name */}
          <Animated.View
            style={[
              styles.textContainer,
              { opacity: textOpacity },
            ]}
          >
            <Text style={styles.appName}>
              MarkenDetektive
            </Text>
            <Text style={styles.tagline}>
              Wir zeigen dir, wer dahinter steckt!
            </Text>
          </Animated.View>

          {/* Loading Indicator */}
          <Animated.View
            style={[
              styles.loadingContainer,
              { opacity: textOpacity },
            ]}
          >
            <Animated.View
              style={[
                styles.loadingDot,
                {
                  transform: [
                    {
                      scale: pulseAnim,
                    },
                  ],
                  opacity: textOpacity,
                },
              ]}
            />
          </Animated.View>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: isAndroid ? 32 : 20,
    paddingVertical: isAndroid ? 40 : 20,
  },
  logoWrapper: {
    marginBottom: isAndroid ? 16 : 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: isAndroid ? 20 : 10,
    maxWidth: isAndroid ? Math.min(280, SCREEN_WIDTH - 64) : 400,
  },
  appName: {
    fontSize: isAndroid 
      ? (isSmallDevice ? 20 : 24) 
      : (isSmallDevice ? 24 : 28),
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: isAndroid ? 6 : 8,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    ...(isAndroid && {
      includeFontPadding: false,
      textAlignVertical: 'center',
    }),
  },
  tagline: {
    fontSize: isAndroid 
      ? (isSmallDevice ? 12 : 14) 
      : (isSmallDevice ? 14 : 16),
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    lineHeight: isAndroid 
      ? (isSmallDevice ? 16 : 18) 
      : (isSmallDevice ? 20 : 22),
    paddingHorizontal: isAndroid ? 4 : 0,
    ...(isAndroid && {
      includeFontPadding: false,
      textAlignVertical: 'center',
    }),
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 60,
    alignItems: 'center',
    alignSelf: 'center',
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  
  // Android-spezifische Styles - einfach und bombensicher
  androidContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  androidLogoWrapper: {
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidTextContainer: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 260,
  },
  androidAppName: {
    fontSize: 22,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 12, 
    includeFontPadding: false,
  },
  androidTagline: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255, 255, 255, 0.95)',
    textAlign: 'center', 
    lineHeight: 18,
    includeFontPadding: false,
  },
  androidLoadingContainer: {
    position: 'absolute',
    bottom: 80,
    alignItems: 'center',
    alignSelf: 'center',
  },
});
