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

// Responsive Breakpoints
const isSmallDevice = SCREEN_HEIGHT < 700;

interface AchievementUnlockOverlayProps {
  visible: boolean;
  achievement: Achievement | null;
  onClose: () => void;
  autoHide?: boolean;     // Versteckt Buttons und schließt automatisch
}

// Intelligente lokale Lottie-Zuordnung basierend auf Achievement-Eigenschaften
const getAchievementLottieSource = (achievement: Achievement) => {
  // Achievement Lottie loading - reduced logging
  
  try {
    // Intelligente Zuordnung basierend auf Action-Type (mit vorhandenen Files)
    switch (achievement.trigger.action) {
      case 'first_action_any':
        return require('@/assets/lottie/rocket.json');
       
      case 'daily_streak':
        if (achievement.trigger.target >= 7) {
          return require('@/assets/lottie/streak-fire.json');
        }
        
        return require('@/assets/lottie/streak-bonus.json');
        
      // Für alle anderen: Verwende den Fallback (bis spezifische Animationen erstellt sind)
      case 'scan_product':
        return require('@/assets/lottie/scanner-line.json');  
      case 'view_comparison': 
        return require('@/assets/lottie/comparison.json');
      case 'complete_shopping':
        return require('@/assets/lottie/task.json');
      case 'search_product':
        return require('@/assets/lottie/search.json');
      case 'submit_rating':
        return require('@/assets/lottie/ratingsthumbsup.json');
      case 'create_list':
        return require('@/assets/lottie/task.json');
      case 'convert_product':
        return require('@/assets/lottie/swap.json');
      case 'share_app':
        return require('@/assets/lottie/review.json');
      case 'submit_product':
        return require('@/assets/lottie/favorites.json');
      case 'save_product':
        return require('@/assets/lottie/favorites2.json');
      case 'mission_daily_done':
        return require('@/assets/lottie/mission-daily.json');
      case 'mission_weekly_done':
        return require('@/assets/lottie/mission-weekly.json');
      case 'savings_total':
        return require('@/assets/lottie/savings.json');
      default:
        return require('@/assets/lottie/confetti.json');
    }
  } catch (error) {
    console.log(`⚠️ Achievement Lottie loading failed for ${achievement.name}:`, error);
    return require('@/assets/lottie/achievement-unlock.json'); // Fallback
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

  useEffect(() => {
    if (visible && achievement) {
      // Achievement overlay triggered - reduced logging
      
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

      // Kein Auto-close mehr - User muss selbst wegklicken
    }
  }, [visible, achievement?.id, autoHide, fadeAnim, scaleAnim, handleClose]);

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

            {/* Große responsive Lottie Animation (Icon entfernt) */}
            <View style={styles.lottieContainer}>
              <LottieView
                source={getAchievementLottieSource(achievement)}
                autoPlay
                loop={true}
                style={styles.lottieAnimationResponsive}
                onAnimationFinish={() => {
                  console.log(`✨ Achievement ${achievement.name} Lottie-Animation wiederholt`);
                }}
              />
            </View>

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
              <View style={styles.buttonContainer}>
                <TouchableOpacity 
                  style={styles.actionButton}
                  onPress={handleClose}
                >
                  <Text style={styles.actionButtonText}>Weiter</Text>
                </TouchableOpacity>
              </View>
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
    paddingTop: isSmallDevice ? 30 : 40,
    paddingBottom: isSmallDevice ? 16 : 24,
    paddingHorizontal: isSmallDevice ? 16 : 24,
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
    height: isSmallDevice ? 120 : Math.min(SCREEN_WIDTH * 0.65, 240) + 20,
    marginVertical: isSmallDevice ? 10 : 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottieAnimation: {
    width: 100,
    height: 100,
  },
  lottieAnimationLarge: {
    width: 150,
    height: 150,
  },
  lottieAnimationResponsive: {
    width: Math.min(SCREEN_WIDTH * 0.65, 240),
    height: Math.min(SCREEN_WIDTH * 0.65, 240),
  },
  lottieAnimationSmall: {
    width: 100,
    height: 100,
  },
  achievementTitle: {
    fontSize: isSmallDevice ? 14 : 16,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
    marginBottom: isSmallDevice ? 4 : 8,
  },
  achievementName: {
    fontSize: isSmallDevice ? 18 : 22,
    fontWeight: '800',
    color: 'white',
    textAlign: 'center',
    marginBottom: isSmallDevice ? 4 : 8,
  },
  achievementDescription: {
    fontSize: isSmallDevice ? 12 : 14,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginBottom: isSmallDevice ? 16 : 24,
    paddingHorizontal: isSmallDevice ? 8 : 16,
    lineHeight: isSmallDevice ? 16 : 18,
  },
  pointsSection: {
    width: '100%',
    marginBottom: 12,
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
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
  },
  buttonContainer: {
    width: '100%',
    gap: 10,
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

export default AchievementUnlockOverlay;
