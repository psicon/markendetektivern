import { IconSymbol } from '@/components/ui/IconSymbol';
import * as Haptics from 'expo-haptics';
import LottieView from 'lottie-react-native';
import React, { useCallback, useEffect, useRef } from 'react';
import {
    Animated,
    Dimensions,
    StyleSheet,
    Text,
    View
} from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PointsToastProps {
  points: number;
  message?: string;
  visible: boolean;
  onHide: () => void;
  type?: 'points' | 'streak' | 'achievement' | 'level';
}

// Lottie Source Helper - Gleiche Funktion wie in LevelUpOverlay
const getLottieSource = (animationName: string) => {
  try {
    switch (animationName) {
      case 'points-earned':
        return require('@/assets/lottie/points-earned.json');
      case 'streak-bonus':
        return require('@/assets/lottie/streak-bonus.json');
      case 'achievement-unlock':
        return require('@/assets/lottie/achievement-unlock.json');
      default:
        console.log(`⚠️ Toast Lottie '${animationName}' nicht gefunden`);
        return null;
    }
  } catch (error) {
    console.log(`⚠️ Toast Lottie-File '${animationName}' nicht vorhanden:`, error);
    return null;
  }
};

export const PointsToast: React.FC<PointsToastProps> = ({
  points,
  message,
  visible,
  onHide,
  type = 'points'
}) => {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  const animateOut = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onHide();
    });
  }, [translateY, opacity, onHide]);

  useEffect(() => {
    if (visible) {
      // Trigger Haptic Feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Animate In
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 50, // Position vom Top
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          tension: 50,
          friction: 5,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-hide nach 2.5 Sekunden
      const timer = setTimeout(() => {
        animateOut();
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, [visible, translateY, opacity, scale, animateOut]);

  if (!visible) return null;

  const getToastStyle = () => {
    switch (type) {
      case 'streak':
        return [styles.toastContainer, styles.streakToast];
      case 'achievement':
        return [styles.toastContainer, styles.achievementToast];
      case 'level':
        return [styles.toastContainer, styles.levelToast];
      default:
        return [styles.toastContainer, styles.pointsToast];
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'streak':
        return <IconSymbol name="flame.fill" size={20} color="white" />;
      case 'achievement':
        return <IconSymbol name="trophy.fill" size={20} color="white" />;
      case 'level':
        return <IconSymbol name="star.fill" size={20} color="white" />;
      default:
        return <IconSymbol name="plus.circle.fill" size={20} color="white" />;
    }
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [
            { translateY },
            { scale }
          ],
          opacity,
        },
      ]}
      pointerEvents="none"
    >
      <View style={getToastStyle()}>
        {/* Icon oder Mini-Lottie */}
        <View style={styles.iconContainer}>
          {type === 'points' && points >= 5 ? (
            // Zeige Lottie für große Punkte-Vergabe (falls vorhanden)
            <LottieView
              source={getLottieSource('points-earned')}
              autoPlay
              loop={false}
              style={styles.lottieIcon}
            />
          ) : (
            getIcon()
          )}
        </View>

        {/* Punkte und Message */}
        <View style={styles.textContainer}>
          <Text style={styles.pointsText}>+{points} Punkte</Text>
          {message && (
            <Text style={styles.messageText}>{message}</Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  toastContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    maxWidth: SCREEN_WIDTH - 48,
  },
  pointsToast: {
    backgroundColor: '#4CAF50',
  },
  streakToast: {
    backgroundColor: '#FF6B35',
  },
  achievementToast: {
    backgroundColor: '#FFD700',
  },
  levelToast: {
    backgroundColor: '#9C27B0',
  },
  iconContainer: {
    marginRight: 10,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottieIcon: {
    width: 32,
    height: 32,
  },
  textContainer: {
    flex: 1,
  },
  pointsText: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
  messageText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
    marginTop: 2,
  },
});
