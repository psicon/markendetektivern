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
  unlockedCategory?: {
    id: string;
    name: string;
    imageUrl: string;
  };
  onClose: () => void;
}

// Lokale Level-Animation basierend auf Level-ID (keine Firebase-Abhängigkeit)
const getLevelLottieSource = (levelId: number) => {
  // Lottie loading - reduced logging
  
  try {
    // Direkte Zuordnung basierend auf Level-ID
    switch (levelId) {
      case 1:  return require('@/assets/lottie/level-1.json');   // Erste Schritte
      case 2:  return require('@/assets/lottie/level-2.json');   // Konfetti
      case 3:  return require('@/assets/lottie/level-3.json');   // Badge Pulse
      case 4:  return require('@/assets/lottie/level-4.json');   // Sparkles
      case 5:  return require('@/assets/lottie/level-5.json');   // Wave Effect
      case 6:  return require('@/assets/lottie/level-6.json');   // Medal Spin
      case 7:  return require('@/assets/lottie/level-7.json');   // Burst
      case 8:  return require('@/assets/lottie/level-8.json');   // Crown Shine
      case 9:  return require('@/assets/lottie/level-9.json');   // King Sparkle
      case 10: return require('@/assets/lottie/level-10.json');  // Fireworks
      
      default: 
        // Für höhere Level: Recycle die besten Animationen (statisch)
        const cycleLevel = ((levelId - 1) % 10) + 1;
        console.log(`🔄 Level ${levelId} -> Verwende Level ${cycleLevel} Animation`);
        switch (cycleLevel) {
          case 1: return require('@/assets/lottie/level-1.json');
          case 2: return require('@/assets/lottie/level-2.json');
          case 3: return require('@/assets/lottie/level-3.json');
          case 4: return require('@/assets/lottie/level-4.json');
          case 5: return require('@/assets/lottie/level-5.json');
          case 6: return require('@/assets/lottie/level-6.json');
          case 7: return require('@/assets/lottie/level-7.json');
          case 8: return require('@/assets/lottie/level-8.json');
          case 9: return require('@/assets/lottie/level-9.json');
          case 10: return require('@/assets/lottie/level-10.json');
          default: return require('@/assets/lottie/level-10.json'); // Ultimate Fallback
        }
    }
  } catch (error) {
    console.log(`⚠️ Level ${levelId} Lottie loading failed:`, error);
    return require('@/assets/lottie/level-1.json'); // Fallback
  }
};

export const LevelUpOverlay: React.FC<LevelUpOverlayProps> = ({
  visible,
  newLevel,
  oldLevel,
  unlockedCategory,
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
    
    if (syncLevels.length > 0) {
      setLevels(syncLevels);
    } else {
      // Fallback: Versuche Async-Loading
      achievementService.getAllLevels().then(loadedLevels => {
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
      // LevelUp overlay visible - reduced logging
      
      if (syncLevels.length > 0) {
        setLevels(syncLevels);
        setShowContent(true);
      } else {
        // Notfall: Versuche sofort nachzuladen
        achievementService.getAllLevels().then(loadedLevels => {
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
      // 📱 Periodic check will handle rating after overlay closes
      console.log('🎯 Level-Up closed - periodic check will handle rating');
    });
  };

  const handleNavigateToLevels = () => {
    handleClose();
    router.push('/achievements' as any);
  };

  // Early Returns - NACH allen Hooks!
  if (!showContent) {
    return null;
  }
  if (levels.length === 0) {
    console.log('❌ KRITISCH: LevelUpOverlay: levels.length=0, nicht gerendert!');
    return null;
  }


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

            {/* Große Lottie Animation (Icon oben entfernt) */}
            <View style={styles.lottieContainer}>
              <LottieView
                source={getLevelLottieSource(newLevel)}
                autoPlay
                loop={true}
                style={styles.lottieAnimationResponsive}
                onAnimationFinish={() => {
                  console.log(`✨ Level ${newLevel} Lottie-Animation wiederholt`);
                }}
              />
            </View>

            {/* Title */}
            <Text style={styles.levelTitle}>{levelInfo.name}!</Text>
            <Text style={styles.levelDescription}>{levelInfo.description}</Text>

            {/* Reward Section */}
            <View style={styles.rewardSection}>
              <Text style={styles.rewardLabel}>BELOHNUNG</Text>
              
              {/* Spezielle Kategorie-Freischaltung Anzeige */}
              {unlockedCategory ? (
                <View style={styles.categoryUnlockSection}>
                  <Text style={styles.categoryUnlockTitle}>NEUE KATEGORIE FREIGESCHALTET!</Text>
                  <View style={styles.categoryImageContainer}>
                    <Animated.Image 
                      source={{ uri: unlockedCategory.imageUrl }}
                      style={[
                        styles.categoryImage,
                        { transform: [{ scale: scaleAnim }] }
                      ]}
                    />
                  </View>
                  <Text style={styles.categoryName}>{unlockedCategory.name}</Text>
                  <View style={styles.rewardBox}>
                    <IconSymbol name="sparkles" size={18} color="white" />
                    <Text style={styles.rewardText}>Jetzt in Stöbern verfügbar!</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.rewardBox}>
                  <IconSymbol name="gift" size={18} color="white" />
                  <Text style={styles.rewardText}>{levelInfo.reward}</Text>
                </View>
              )}
            </View>

            {/* Level Icons Vergleich */}
            <View style={styles.levelComparison}>
              {/* Altes Level (kleiner, ausgeblichen) */}
              <View style={styles.oldLevelContainer}>
                <IconSymbol 
                  name={oldLevelInfo.icon as any}
                  size={32} 
                  color="rgba(255,255,255,0.5)"
                />
                <Text style={styles.oldLevelText}>Level {oldLevel}</Text>
              </View>
              
              <IconSymbol 
                name="arrow.right" 
                size={16} 
                color="rgba(255,255,255,0.8)" 
                style={{ marginHorizontal: 16 }}
              />
              
              {/* Neues Level (größer, hell) */}
              <View style={styles.newLevelContainer}>
                <IconSymbol 
                  name={levelInfo.icon as any}
                  size={48} 
                  color="white"
                />
                <Text style={styles.newLevelText}>Level {newLevel}</Text>
              </View>
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
                <Text style={styles.secondaryButtonText}>Weiter</Text>
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
    height: Math.min(SCREEN_WIDTH * 0.7, 220) + 20,
    marginVertical: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lottieAnimation: {
    width: 180,
    height: 180,
  },
  lottieAnimationLarge: {
    width: 200,
    height: 200,
  },
  lottieAnimationResponsive: {
    width: Math.min(SCREEN_WIDTH * 0.6, 220),
    height: Math.min(SCREEN_WIDTH * 0.6, 220),
  },
  levelComparison: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
  },
  oldLevelContainer: {
    alignItems: 'center',
  },
  newLevelContainer: {
    alignItems: 'center',
  },
  oldLevelText: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
    textAlign: 'center',
  },
  newLevelText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
    marginTop: 6,
    textAlign: 'center',
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
  // Kategorie-Freischaltung Styles
  categoryUnlockSection: {
    alignItems: 'center',
    width: '100%',
  },
  categoryUnlockTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFD700',
    letterSpacing: 0.5,
    marginBottom: 16,
    textAlign: 'center',
  },
  categoryImageContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 4,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  categoryImage: {
    width: '100%',
    height: '100%',
    borderRadius: 56,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  categoryName: {
    fontSize: 20,
    fontWeight: '700',
    color: 'white',
    marginBottom: 16,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
});