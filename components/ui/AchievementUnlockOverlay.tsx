import { Achievement } from '@/lib/types/achievements';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import React, { useCallback, useEffect, useRef } from 'react';
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

interface AchievementUnlockOverlayProps {
  visible: boolean;
  achievement: Achievement | null;
  onClose: () => void;
  autoHide?: boolean;     // Versteckt Buttons und schließt automatisch
}

// Lottie Source Helper für Achievements
const getAchievementLottieSource = (animationName: string | undefined) => {
  if (!animationName) return null;
  
  console.log(`🎬 Loading Achievement Lottie: ${animationName}`);
  
  if (animationName.startsWith('http')) {
    return { uri: animationName };
  }
  
  try {
    switch (animationName) {
      case 'achievement-unlock':
        return require('@/assets/lottie/achievement-unlock.json');
      case 'first-scan':
        return require('@/assets/lottie/first-scan.json');
      case 'first-conversion':
        return require('@/assets/lottie/first-conversion.json');
      case 'streak-7':
        return require('@/assets/lottie/streak-7.json');
      case 'savings-100':
        return require('@/assets/lottie/savings-100.json');
      default:
        return require('@/assets/lottie/achievement-unlock.json'); // Default
    }
  } catch (error) {
    console.log(`⚠️ Achievement Lottie '${animationName}' nicht vorhanden:`, error);
    return null;
  }
};

export const AchievementUnlockOverlay: React.FC<AchievementUnlockOverlayProps> = ({
  visible,
  achievement,
  onClose,
  autoHide = false
}) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const confettiRef = useRef<ConfettiCannon>(null);

  useEffect(() => {
    if (visible && achievement) {
      console.log('🏆 Achievement Overlay getriggert:', achievement.name);
      
      // Haptic Feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Animations
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 5,
          useNativeDriver: true,
        }),
      ]).start();

      // Confetti nach kurzer Verzögerung
      setTimeout(() => {
        confettiRef.current?.start();
      }, 500);

      // Auto-close nur wenn nicht im autoHide Modus (dann übernimmt GamificationProvider die Kontrolle)
      if (!autoHide) {
        const timer = setTimeout(() => {
          handleClose();
        }, 4000);

        return () => clearTimeout(timer);
      }
    }
  }, [visible, achievement, autoHide, fadeAnim, scaleAnim, handleClose]);

  const handleClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  }, [fadeAnim, scaleAnim, onClose]);

  if (!visible || !achievement) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <TouchableOpacity 
          style={styles.backdrop} 
          activeOpacity={1}
          onPress={handleClose}
        />

        {/* Confetti Effect */}
        <ConfettiCannon
          ref={confettiRef}
          count={100}
          origin={{ x: SCREEN_WIDTH / 2, y: -10 }}
          autoStart={false}
          fadeOut={true}
          fallSpeed={3000}
          explosionSpeed={400}
        />

        <Animated.View 
          style={[
            styles.contentCard,
            {
              transform: [{ scale: scaleAnim }],
            }
          ]}
        >
          <LinearGradient
            colors={['#FFD700', '#FFA500']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientBackground}
          >
            {/* Close Button - nur wenn NICHT autoHide */}
            {!autoHide && (
              <TouchableOpacity 
                style={styles.closeButton}
                onPress={handleClose}
              >
                <IconSymbol name="xmark" size={16} color="rgba(255,255,255,0.9)" />
              </TouchableOpacity>
            )}

            {/* Achievement Icon */}
            <View style={styles.achievementBadge}>
              <View style={styles.iconContainer}>
                <IconSymbol 
                  name={achievement.icon as any} 
                  size={40} 
                  color="white" 
                />
              </View>
            </View>

            {/* Lottie Animation - Falls vorhanden */}
            {achievement.lottieAnimation && (
              <View style={styles.lottieContainer}>
                <LottieView
                  source={getAchievementLottieSource(achievement.lottieAnimation)}
                  autoPlay
                  loop={false}
                  style={styles.lottieAnimation}
                  onAnimationFinish={() => {
                    console.log(`✨ Achievement ${achievement.name} Lottie-Animation beendet`);
                  }}
                />
              </View>
            )}

            {/* Achievement Title */}
            <Text style={styles.achievementTitle}>🏆 Achievement freigeschaltet!</Text>
            <Text style={styles.achievementName}>{achievement.name}</Text>
            <Text style={styles.achievementDescription}>{achievement.description}</Text>

            {/* Points Reward */}
            <View style={styles.pointsSection}>
              <View style={styles.pointsBox}>
                <IconSymbol name="plus.circle.fill" size={18} color="white" />
                <Text style={styles.pointsText}>+{achievement.points} Punkte</Text>
              </View>
            </View>

            {/* Action Button - nur wenn NICHT autoHide */}
            {!autoHide && (
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={handleClose}
              >
                <Text style={styles.actionButtonText}>Fantastisch!</Text>
              </TouchableOpacity>
            )}

            {/* Auto-Hide Hinweis */}
            {autoHide && (
              <View style={styles.autoHideHint}>
                <Text style={styles.autoHideText}>Level-Up folgt gleich...</Text>
              </View>
            )}
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  contentCard: {
    width: SCREEN_WIDTH * 0.85,
    maxWidth: 340,
    borderRadius: 24,
    overflow: 'hidden',
  },
  gradientBackground: {
    paddingTop: 40,
    paddingBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  achievementBadge: {
    marginBottom: 16,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  lottieContainer: {
    width: '100%',
    height: 100,
    marginVertical: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottieAnimation: {
    width: 100,
    height: 100,
  },
  achievementTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
  },
  achievementName: {
    fontSize: 22,
    fontWeight: '800',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
  },
  achievementDescription: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
    lineHeight: 18,
  },
  pointsSection: {
    width: '100%',
    marginBottom: 24,
  },
  pointsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  pointsText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  actionButton: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 25,
    paddingVertical: 14,
    paddingHorizontal: 32,
    minWidth: 140,
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFA500',
    textAlign: 'center',
  },
  autoHideHint: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  autoHideText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
