import { achievementService } from '@/lib/services/achievementService';
import { Level } from '@/lib/types/achievements';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import LottieView from 'lottie-react-native';
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

// Lottie Source Helper - Unterstützt lokale Files und URLs
const getLottieSource = (animationName: string) => {
  console.log(`🎬 Loading Lottie: ${animationName}`);
  
  // Falls es eine URL ist
  if (animationName.startsWith('http')) {
    return { uri: animationName };
  }
  
  // Versuche lokale Dateien zu laden (mit Try-Catch für existierende Files)
  try {
    switch (animationName) {
      case 'level-1':
        return require('@/assets/lottie/level-1.json');
      case 'level-2':
        return require('@/assets/lottie/level-2.json');
      case 'level-3':
        return require('@/assets/lottie/level-3.json');
      case 'level-4':
        return require('@/assets/lottie/level-4.json');
      case 'level-5':
        return require('@/assets/lottie/level-5.json');
      case 'level-6':
        return require('@/assets/lottie/level-6.json');
      case 'level-7':
        return require('@/assets/lottie/level-7.json');
      case 'level-8':
        return require('@/assets/lottie/level-8.json');
      case 'level-9':
        return require('@/assets/lottie/level-9.json');
      case 'level-10':
        return require('@/assets/lottie/level-10.json');
      case 'points-earned':
        return require('@/assets/lottie/points-earned.json');
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
        console.log(`⚠️ Lottie-Animation '${animationName}' nicht gefunden, verwende Fallback`);
        return require('@/assets/lottie/points-earned.json'); // Fallback
    }
  } catch (error) {
    console.log(`⚠️ Lottie-File '${animationName}' nicht vorhanden:`, error);
    return null; // Kein Animation wenn File fehlt
  }
};

export const LevelUpOverlay: React.FC<LevelUpOverlayProps> = ({
  visible,
  newLevel,
  oldLevel,
  onClose,
}) => {
  const router = useRouter();
  
  // States und Refs
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const confettiRef = useRef<any>(null);
  const [showContent, setShowContent] = useState(false);
  const [levels, setLevels] = useState<Level[]>([]);

  // Lade Levels beim Mount - SOFORT SYNC
  useEffect(() => {
    // 🚀 DIREKTER SYNC-ZUGRIFF - Kein Async Loading!
    const syncLevels = achievementService.getAllLevelsSync();
    console.log('🚀 LevelUpOverlay: Sync-Levels sofort:', syncLevels.length);
    
    if (syncLevels.length > 0) {
      setLevels(syncLevels);
    } else {
      // Fallback: Versuche Async-Loading
      console.log('🔄 LevelUpOverlay: Sync leer - versuche Async...');
      achievementService.getAllLevels().then(loadedLevels => {
        console.log('🎯 LevelUpOverlay: Async-Levels geladen:', loadedLevels.length);
        setLevels(loadedLevels);
      }).catch(error => {
        console.error('❌ LevelUpOverlay: Async loading failed:', error);
      });
    }
  }, []);

  // Animations Effect + Level Reload bei jedem Trigger
  useEffect(() => {
    if (visible) {
      // 🚀 BEI JEDEM LEVEL-UP: Levels neu laden!
      const syncLevels = achievementService.getAllLevelsSync();
      console.log('🚀 LevelUpOverlay VISIBLE: Sync-Levels reload:', syncLevels.length);
      
      if (syncLevels.length > 0) {
        setLevels(syncLevels);
        setShowContent(true);
      } else {
        console.log('❌ KRITISCH: Keine Levels verfügbar beim Level-Up!');
        // Notfall: Versuche sofort nachzuladen
        achievementService.getAllLevels().then(loadedLevels => {
          console.log('🎯 LevelUpOverlay NOTFALL: Levels geladen:', loadedLevels.length);
          setLevels(loadedLevels);
          setShowContent(true);
        });
        return; // Warte auf Levels
      }
      
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

      // KEIN Auto-close - User muss manuell schließen!
      // const timer = setTimeout(() => {
      //   handleClose();
      // }, 10000);

      // return () => clearTimeout(timer);
    } else {
      // Reset animations
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      rotateAnim.setValue(0);
      setShowContent(false);
    }
  }, [visible]);

  // Callback Functions
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

  // Early Returns - NACH allen Hooks!
  if (!showContent) {
    console.log('🔍 LevelUpOverlay: showContent=false, nicht gerendert');
    return null;
  }
  if (levels.length === 0) {
    console.log('❌ KRITISCH: LevelUpOverlay: levels.length=0, nicht gerendert!');
    return null;
  }
  
  console.log('✅ LevelUpOverlay: Rendering mit', levels.length, 'Levels');

  // Computed Values
  const levelInfo = levels.find(l => l.id === newLevel) || levels[0];
  const oldLevelInfo = levels.find(l => l.id === oldLevel) || levels[0];
  
  const spin = rotateAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ['-5deg', '5deg'],
  });

  const getLevelGradient = () => {
    const baseColor = levelInfo.color;
    switch(newLevel) {
      case 1: return [baseColor, '#9E6B50'];
      case 2: return [baseColor, '#FF9800'];
      case 3: return [baseColor, '#4CAF50'];
      case 4: return [baseColor, '#FFC107'];
      case 5: return [baseColor, '#FF5252'];
      case 6: return [baseColor, '#03A9F4'];
      case 7: return [baseColor, '#9C27B0'];
      case 8: return [baseColor, '#FF9800'];
      case 9: return [baseColor, '#FF6F00'];
      case 10: return [baseColor, '#F44336'];
      default: return [baseColor, '#9E6B50'];
    }
  };

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
          count={80}
          origin={{ x: SCREEN_WIDTH / 2, y: -10 }}
          autoStart={false}
          fadeOut={true}
          fallSpeed={3000}
          explosionSpeed={350}
        />

        <Animated.View 
          style={[
            styles.contentCard,
            {
              transform: [
                { scale: scaleAnim },
                { rotate: spin }
              ],
            }
          ]}
        >
          <LinearGradient
            colors={getLevelGradient()}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientBackground}
          >
            {/* Close Button */}
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={handleClose}
            >
              <IconSymbol name="xmark" size={16} color="rgba(255,255,255,0.9)" />
            </TouchableOpacity>

            {/* Level Badge */}
            <View style={styles.levelBadge}>
              <View style={styles.levelIconContainer}>
                <IconSymbol 
                  name={levelInfo.icon as any} 
                  size={40} 
                  color="white" 
                />
              </View>
              <Text style={styles.levelNumber}>Level {newLevel}</Text>
            </View>

            {/* Lottie Animation - Dynamisch aus Firebase */}
            {levelInfo.lottieAnimation && (
              <View style={styles.lottieContainer}>
                <LottieView
                  source={getLottieSource(levelInfo.lottieAnimation)}
                  autoPlay
                  loop={false}
                  style={styles.lottieAnimation}
                  onAnimationFinish={() => {
                    console.log(`✨ Level ${newLevel} Lottie-Animation beendet`);
                  }}
                />
              </View>
            )}

            {/* Title */}
            <Text style={styles.levelTitle}>{levelInfo.name}!</Text>
            <Text style={styles.levelDescription}>{levelInfo.description}</Text>

            {/* Reward Section */}
            <View style={styles.rewardSection}>
              <Text style={styles.rewardLabel}>BELOHNUNG</Text>
              <View style={styles.rewardBox}>
                <IconSymbol name="gift" size={18} color="white" />
                <Text style={styles.rewardText}>{levelInfo.reward}</Text>
              </View>
            </View>

            {/* Progress Info */}
            <View style={styles.progressInfo}>
              <Text style={styles.progressText}>
                Du warst {oldLevel === 1 ? 'Neuling' : oldLevelInfo.name}
              </Text>
              <IconSymbol 
                name="arrow.right" 
                size={14} 
                color="rgba(255,255,255,0.8)" 
                style={{ marginHorizontal: 8 }}
              />
              <Text style={styles.progressText}>
                Jetzt {levelInfo.name}
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity 
                style={styles.primaryButton}
                onPress={handleNavigateToLevels}
              >
                <Text style={styles.primaryButtonText}>Level ansehen</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.secondaryButton}
                onPress={handleClose}
              >
                <Text style={styles.secondaryButtonText}>Weiter spielen</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  contentCard: {
    width: SCREEN_WIDTH * 0.85,
    maxWidth: 350,
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  gradientBackground: {
    padding: 24,
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  levelBadge: {
    alignItems: 'center',
    marginBottom: 16,
  },
  levelIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  levelNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
    opacity: 0.9,
  },
  levelTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: 'white',
    marginBottom: 8,
    textAlign: 'center',
  },
  levelDescription: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  lottieContainer: {
    width: '100%',
    height: 180,
    marginVertical: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottieAnimation: {
    width: 180,
    height: 180,
  },
  rewardSection: {
    width: '100%',
    marginBottom: 20,
  },
  rewardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1,
    marginBottom: 8,
    textAlign: 'center',
  },
  rewardBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  rewardText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  progressInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  progressText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  buttonContainer: {
    width: '100%',
    gap: 10,
  },
  primaryButton: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
});