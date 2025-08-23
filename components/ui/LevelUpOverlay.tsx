import { LEVELS } from '@/lib/types/achievements';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import ConfettiCannon from 'react-native-confetti-cannon';
import { IconSymbol } from './IconSymbol';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface LevelUpOverlayProps {
  visible: boolean;
  newLevel: number;
  oldLevel: number;
  onClose: () => void;
}

export const LevelUpOverlay: React.FC<LevelUpOverlayProps> = ({
  visible,
  newLevel,
  oldLevel,
  onClose,
}) => {
  const router = useRouter();
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const confettiRef = useRef<any>(null);
  const [showContent, setShowContent] = useState(false);

  const levelInfo = LEVELS.find(l => l.id === newLevel) || LEVELS[0];
  const oldLevelInfo = LEVELS.find(l => l.id === oldLevel) || LEVELS[0];

  useEffect(() => {
    if (visible) {
      setShowContent(true);
      
      // Start animations
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Trigger confetti after modal appears
        confettiRef.current?.start();
        
        // Haptic feedback pattern
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 200);
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light), 400);
      });

      // Rotate animation for the badge - nur 1x wackeln für 2 Sekunden
      Animated.sequence([
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: -1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(rotateAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-close after 10 seconds
      const timer = setTimeout(() => {
        handleClose();
      }, 10000);

      return () => clearTimeout(timer);
    } else {
      // Reset animations
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      rotateAnim.setValue(0);
      setShowContent(false);
    }
  }, [visible]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowContent(false);
      onClose();
    });
  };

  const handleNavigateToLevels = () => {
    handleClose();
    router.push('/achievements' as any);
  };

  if (!showContent) return null;

  const spin = rotateAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-5deg', '5deg'],
  });

  return (
    <Modal
      transparent
      visible={showContent}
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.7],
              }),
            },
          ]}
        />
        
        <Animated.View
          style={[
            styles.content,
            {
              opacity: fadeAnim,
              transform: [
                { scale: scaleAnim },
                { rotate: spin },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={[levelInfo.color, levelInfo.color + 'CC']}
            style={styles.card}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {/* Glowing Badge */}
            <View style={styles.badgeContainer}>
              <View style={[styles.glowEffect, { backgroundColor: levelInfo.color }]} />
              <View style={styles.badge}>
                <IconSymbol
                  name={levelInfo.icon}
                  size={60}
                  color="#FFF"
                />
              </View>
            </View>

            {/* Level Up Text */}
            <Text style={styles.title}>LEVEL UP!</Text>
            
            {/* Level Transition */}
            <View style={styles.levelTransition}>
              <View style={styles.levelBox}>
                <Text style={styles.levelNumber}>{oldLevel}</Text>
                <Text style={styles.levelName}>{oldLevelInfo.name}</Text>
              </View>
              
              <IconSymbol
                name="arrow.right"
                size={30}
                color="#FFF"
                style={{ marginHorizontal: 20 }}
              />
              
              <View style={[styles.levelBox, styles.newLevelBox]}>
                <Text style={[styles.levelNumber, styles.newLevel]}>{newLevel}</Text>
                <Text style={[styles.levelName, styles.newLevel]}>{levelInfo.name}</Text>
              </View>
            </View>

            {/* Description */}
            <Text style={styles.description}>{levelInfo.description}</Text>
            
            {/* Reward */}
            <View style={styles.rewardContainer}>
              <IconSymbol name="gift.fill" size={20} color="#FFFFFF" />
              <Text style={styles.reward}>{levelInfo.reward}</Text>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleNavigateToLevels}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Level-Übersicht</Text>
                <IconSymbol name="arrow.right" size={18} color="#FFF" />
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={handleClose}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryButtonText}>Weiter</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Confetti */}
        <ConfettiCannon
          ref={confettiRef}
          count={100}
          origin={{ x: SCREEN_WIDTH / 2, y: -10 }}
          autoStart={false}
          fadeOut
          fallSpeed={2500}
          colors={['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7']}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  content: {
    width: SCREEN_WIDTH * 0.9,
    maxWidth: 400,
  },
  card: {
    borderRadius: 24,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  badgeContainer: {
    position: 'relative',
    marginBottom: 20,
  },
  glowEffect: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    opacity: 0.3,
    top: -20,
    left: -20,
  },
  badge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFF',
  },
  title: {
    fontSize: 36,
    fontFamily: 'Nunito_900Black',
    color: '#FFF',
    marginBottom: 20,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  levelTransition: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  levelBox: {
    alignItems: 'center',
    opacity: 0.7,
  },
  newLevelBox: {
    opacity: 1,
    transform: [{ scale: 1.5 }], // Größer für bessere Betonung
  },
  levelNumber: {
    fontSize: 28,
    fontFamily: 'Nunito_900Black',
    color: '#FFF',
  },
  levelName: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: '#FFF',
    marginTop: 4,
  },
  newLevel: {
    textShadowColor: 'rgba(255, 215, 0, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  description: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: '#FFF',
    textAlign: 'center',
    marginBottom: 15,
    opacity: 0.9,
  },
  rewardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)', // Dunkler für besseren Kontrast
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)', // Subtiler Rahmen
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    marginBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  reward: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: '#FFFFFF', // Weißer Text für perfekte Lesbarkeit
    marginLeft: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  actions: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    color: '#333',
    marginRight: 8,
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    color: '#FFF',
    opacity: 0.8,
  },
});


