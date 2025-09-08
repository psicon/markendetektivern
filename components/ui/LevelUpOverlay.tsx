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
  const categoryShimmerAnim = useRef(new Animated.Value(0)).current;
  const categoryFadeAnim = useRef(new Animated.Value(0)).current;
  const foregroundLottieOpacity = useRef(new Animated.Value(0)).current;
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
      
      // Reset alle Animationen bevor wir starten
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      rotateAnim.setValue(0);
      categoryShimmerAnim.setValue(0);
      categoryFadeAnim.setValue(0);
      foregroundLottieOpacity.setValue(0);
      
      // Lottie ÜBER Kategorie (1x Animation dann ausblenden)
      if (unlockedCategory) {
        // Lottie sofort einblenden und animieren
        Animated.sequence([
          Animated.timing(foregroundLottieOpacity, {
            toValue: 0.9,
            duration: 300,
            useNativeDriver: true
          }),
          Animated.delay(2000), // 2 Sekunden Lottie-Animation
          Animated.timing(foregroundLottieOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true
          })
        ]).start(() => {
          // Nach Lottie-Ausblendung: Kategorie soft einblenden
          Animated.parallel([
            Animated.timing(categoryFadeAnim, {
              toValue: 1,
              duration: 800,
              useNativeDriver: true
            }),
            // Kategorie-Shimmer (kontinuierlich, kein Drehen!)
            Animated.loop(
              Animated.sequence([
                Animated.timing(categoryShimmerAnim, {
                  toValue: 1,
                  duration: 1200,
                  useNativeDriver: true
                }),
                Animated.timing(categoryShimmerAnim, {
                  toValue: 0,
                  duration: 1200,
                  useNativeDriver: true
                })
              ])
            )
          ]).start();
        });
      }

      // Start main content animations
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

      // KEIN Auto-close - User muss manuell schließen!
      // const timer = setTimeout(() => {
      //   handleClose();
      // }, 10000);

      // return () => clearTimeout(timer);
    } else {
      // Reset all animations
      scaleAnim.setValue(0);
      fadeAnim.setValue(0);
      rotateAnim.setValue(0);
      categoryShimmerAnim.setValue(0);
      categoryFadeAnim.setValue(0);
      foregroundLottieOpacity.setValue(0);
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

  // Animationen für Kategorie (nur Shimmer, kein Drehen)
  const categoryShimmerOpacity = categoryShimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.8, 1.0, 0.8],
  });

  const categoryShimmerScale = categoryShimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1.0, 1.05, 1.0],
  });

  const getLevelGradient = (): [string, string] => {
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

            {/* Title */}
            <Text style={styles.levelTitle}>{levelInfo.name}!</Text>
            <Text style={styles.levelDescription}>{levelInfo.description}</Text>

            {/* HAUPTINHALT: Kategorie-Freischaltung oder Standard-Belohnung */}
            <View style={styles.mainContentSection}>
              {unlockedCategory ? (
                <View style={styles.categoryUnlockSection}>
                  <View style={styles.categoryRevealContainer}>
                    {/* Lottie ÜBER alles (1x Animation, dann ausblenden) */}
                    <Animated.View 
                      style={[
                        styles.foregroundLottieContainer,
                        { opacity: foregroundLottieOpacity }
                      ]}
                      pointerEvents="none"
                    >
                      <LottieView
                        source={require('@/assets/lottie/lvlup.json')}
                        autoPlay
                        loop={false}
                        style={styles.foregroundLottie}
                      />
                    </Animated.View>

                    {/* Alles zeitgleich einblenden (Titel + Kategorie-Bild + Name) */}
                    <Animated.View 
                      style={[
                        styles.categoryContentContainer, 
                        { opacity: categoryFadeAnim }
                      ]}
                    >
                      <Text style={styles.categoryUnlockTitle}>NEUE KATEGORIE FREIGESCHALTET!</Text>
                      
                      <View style={styles.categoryImageContainer}>
                        <Animated.Image 
                          source={{ uri: unlockedCategory.imageUrl }}
                          style={[
                            styles.categoryImage,
                            { 
                              transform: [
                                { scale: categoryShimmerScale }
                              ],
                              opacity: categoryShimmerOpacity
                            }
                          ]}
                        />
                      </View>
                      
                      <Text style={styles.categoryName}>{unlockedCategory.name}</Text>
                      <View style={styles.rewardBox}>
                    <IconSymbol name="sparkles" size={18} color="white" />
                    <Text style={styles.rewardText}>Jetzt in Stöbern verfügbar!</Text>
                  </View>
                    </Animated.View>
                  </View>
                  
                 
                </View>
              ) : (
                <View style={styles.standardRewardSection}>
                  <View style={styles.rewardBox}>
                    <IconSymbol name="gift" size={18} color="white" />
                    <Text style={styles.rewardText}>{levelInfo.reward}</Text>
                  </View>
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
    maxWidth: 340,
    maxHeight: SCREEN_HEIGHT * 0.75,
    borderRadius: 24,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    zIndex: 2,
  },
  gradientBackground: {
    padding: 20,
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
    marginBottom: 12,
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
    marginTop: 8,
    textAlign: 'center',
  },
  levelDescription: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  
  // Hauptinhalt Section (kompakt für kleine Screens)
  mainContentSection: {
    width: '100%',
    alignItems: 'center',
    marginVertical: 12,
    zIndex: 2,
  },
  standardRewardSection: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  
  levelComparison: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
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
    marginBottom: 8,
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
    color: 'rgba(255,255,255,0.9)',
  },
  progressInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
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
    color: 'white',
    letterSpacing: 0.5,
    marginBottom: 12,
    textAlign: 'center',
  },
  // Kategorie Reveal Container (für Lottie + Kategorie Overlay)
  categoryRevealContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    
  },
  
  // Lottie ÜBER kompletten Category-Content
  foregroundLottieContainer: {
    position: 'absolute',
    top: -20,
    left: -20,
    right: -20,
    bottom: -50,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  foregroundLottie: {
    width: 290,
    height: 290,
  },
  
  // Container für alles was zeitgleich eingeblendet wird
  categoryContentContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  categoryImageContainer: {
    width: 115, // 15% größer als 100px
    height: 115,
    borderRadius: 57.5, // Rund bleiben
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 15,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  categoryImage: {
    width: '100%',
    height: '100%',
    borderRadius: 53.5, // Angepasst für 115px Container
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  categoryName: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
    marginBottom: 10,
    marginTop: 8,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },

});