import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet } from 'react-native';

const { width, height } = Dimensions.get('window');

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
      
      <ThemedView style={styles.content}>
        {/* Logo/Icon */}
        <Animated.View
          style={[
            styles.logoContainer,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        >
          <CustomIcon 
            name="iconBlack" 
            size={100} 
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
          <ThemedText style={styles.appName}>
            MarkenDetektive
          </ThemedText>
          <ThemedText style={styles.tagline}>
            Wir zeigen dir, wer dahinter steckt!
          </ThemedText>
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
      </ThemedView>
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
  content: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Math.max(20, width * 0.05), // Responsive Padding
    paddingVertical: Math.max(40, height * 0.05), // Responsive Vertical Padding
  },
  logoContainer: {
    marginBottom: 40,
    alignItems: 'center',
    justifyContent: 'center',
    width: Math.min(160, width * 0.4), // Responsive Container-Größe
    height: Math.min(160, width * 0.4),
    borderRadius: Math.min(80, width * 0.2),
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 15,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 60,
    paddingHorizontal: 20,
    maxWidth: width - 40, // Verhindert Abschneiden
  },
  appName: {
    fontSize: Math.min(34, width * 0.085), // Etwas kleinere Font-Größe für längeren Namen
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    lineHeight: Math.min(42, width * 0.105), // Angepasste Line-Height
    flexWrap: 'wrap', // Ermöglicht Umbruch falls nötig
  },
  tagline: {
    fontSize: Math.min(16, width * 0.045), // Responsive Font-Größe
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    lineHeight: Math.min(22, width * 0.055), // Responsive Line-Height
    maxWidth: width - 80, // Extra Schutz vor Abschneiden
  },
  loadingContainer: {
    position: 'absolute',
    bottom: Math.max(80, height * 0.1), // Responsive Bottom-Position
    alignItems: 'center',
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
});
