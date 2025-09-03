import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useAchievements } from '@/lib/hooks/useAchievements';
import { achievementService } from '@/lib/services/achievementService';
import { Level } from '@/lib/types/achievements';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

const { width: screenWidth } = Dimensions.get('window');

// Text Shimmer Component für Kategorie-Belohnungen (Best Practice)
const TextShimmer: React.FC<{ children: React.ReactNode; isShimmering: boolean }> = ({ 
  children, 
  isShimmering 
}) => {
  const [shimmerAnim] = useState(new Animated.Value(0));
  
  useEffect(() => {
    if (isShimmering) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: false, // Für opacity changes
          }),
          Animated.timing(shimmerAnim, {
            toValue: 0,
            duration: 1500,
            useNativeDriver: false,
          }),
        ])
      ).start();
    }
  }, [isShimmering, shimmerAnim]);

  const animatedStyle = isShimmering 
    ? {
        opacity: shimmerAnim.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0.6, 1, 0.6], // Deutlicherer Kontrast
        }),
        transform: [{
          scale: shimmerAnim.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [1, 1.02, 1], // Leichte Größenänderung
          })
        }]
      }
    : {};

  return (
    <Animated.View style={animatedStyle}>
      {children}
    </Animated.View>
  );
};

export default function AchievementsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const navigation = useNavigation();
  const router = useRouter();
  const { user, userProfile } = useAuth();
  const { 
    achievements, 
    userStats, 
    loading: achievementsLoading,
    getAchievementWithProgress,
    checkDailyStreak 
  } = useAchievements();

  // Header-Optionen sofort setzen mit useLayoutEffect
  useLayoutEffect(() => {
    navigation.setOptions({
      ...getNavigationHeaderOptions(colorScheme, 'Level & Errungenschaften'),
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setShowInfoSheet(true)}
          style={{ marginRight: 16 }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <IconSymbol name="info.circle" size={24} color="white" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colorScheme, colors]);

  // Animation values
  const [shimmerAnim] = useState(new Animated.Value(0));
  const [fadeAnim] = useState(new Animated.Value(0));
  
  // Gamification State
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(true);
  const [showInfoSheet, setShowInfoSheet] = useState(false);

  // Lade Levels aus Firebase
  useEffect(() => {
    const loadLevels = async () => {
      if (!user) {
        setLevelsLoading(false);
        return;
      }

      try {
        setLevelsLoading(true);
        const loadedLevels = await achievementService.getAllLevels();
        setLevels(loadedLevels);
      } catch (error) {
        console.error('Fehler beim Laden der Levels:', error);
      } finally {
        setLevelsLoading(false);
      }
    };

    loadLevels();
  }, [user]);

  useEffect(() => {
    // Shimmer animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2500,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Fade in animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  // Get real user data
  const currentSavings = userProfile?.totalSavings || 0;
  const currentPoints = userStats?.pointsTotal || userStats?.totalPoints || 0;
  const purchasedProducts = userProfile?.productsSaved || 0;
  // Verwende stats.currentLevel wenn vorhanden, sonst level aus userProfile, sonst berechne es
  // WICHTIG: Berechne Level basierend auf aktuellen Daten um "Popping" zu vermeiden
  const currentLevel = (() => {
    // Verwende userStats (über useAchievements geladen) als primäre Quelle
    if (userStats?.currentLevel) {
      return userStats.currentLevel;
    }
    
    // Fallback: stats aus userProfile
    if ((userProfile as any)?.stats?.currentLevel) {
      return (userProfile as any).stats.currentLevel;
    }
    
    // Fallback: legacy level
    if (userProfile?.level) {
      return userProfile.level;
    }
    
    // Letzte Option: Berechne Level basierend auf verfügbaren Daten
    const points = userStats?.pointsTotal || userStats?.totalPoints || (userProfile as any)?.stats?.pointsTotal || (userProfile as any)?.stats?.totalPoints || 0;
    const savings = userProfile?.totalSavings || (userProfile as any)?.stats?.savingsTotal || 0;
    
    for (let i = levels.length - 1; i >= 0; i--) {
      const level = levels[i];
      if (points >= level.pointsRequired && savings >= level.savingsRequired) {
        console.log(`🔄 Level berechnet: ${level.id} (${points} Punkte, €${savings} Ersparnis)`);
        return level.id;
      }
    }
    
    return 1;
  })();
  const currentStreak = userStats?.currentStreak || 0;
  
  // Get current level info
  const currentLevelInfo = levels.find(l => l.id === currentLevel) || levels[0];
  const nextLevel = levels.find(l => l.id === currentLevel + 1);
  
  // Calculate levels with unlock status
  const levelsWithStatus = levels.map(level => ({
    ...level,
    isActive: level.id === currentLevel,
    isUnlocked: level.id <= currentLevel || 
                (currentSavings >= level.savingsRequired && currentPoints >= level.pointsRequired),
    hasNewCategory: [4, 6, 8, 10].includes(level.id) // Kategorie-Level hervorheben
  }));
  
  // Helper function to get color based on points
  const getAchievementColor = (points: number, isCompleted: boolean) => {
    if (isCompleted) {
      // Completed achievements keep their difficulty color but slightly golden
      if (points <= 10) return '#4A90E2'; // Blau
      if (points <= 20) return '#7ED321'; // Grün
      if (points <= 25) return '#F5A623'; // Orange
      return '#D0021B'; // Rot
    } else {
      // Non-completed achievements use muted versions
      if (points <= 10) return '#B3D1F5'; // Helles Blau
      if (points <= 20) return '#C8E6C9'; // Helles Grün  
      if (points <= 25) return '#FFE0B2'; // Helles Orange
      return '#FFCDD2'; // Helles Rot
    }
  };

  // Process achievements with progress
  const processedAchievements = achievements && achievements.length > 0
    ? achievements
        .sort((a, b) => a.points - b.points) // Sortierung nach Punkten (aufsteigend)
        .map(achievement => {
          const withProgress = getAchievementWithProgress(achievement);
          return {
            ...withProgress,
            color: getAchievementColor(achievement.points, withProgress.isCompleted)
          };
        })
    : [];

  const ProgressBar = ({ progress, maxProgress, color }: { progress: number; maxProgress: number; color: string }) => {
    const percentage = Math.min(progress / maxProgress, 1);
    
    return (
      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBarBackground, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
          <View 
            style={[
              styles.progressBarFill, 
              { 
                backgroundColor: color,
                width: `${percentage * 100}%`,
              }
            ]} 
          />
        </View>
      </View>
    );
  };

  const shimmerTranslateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-screenWidth, screenWidth],
  });

  // Streak Helper Functions
  const getStreakGradient = (days: number) => {
    if (days >= 28) return ['#FFD700', '#FFA500']; // Gold
    if (days >= 21) return ['#9C27B0', '#673AB7']; // Purple
    if (days >= 14) return ['#FF6B35', '#FF4E00']; // Orange
    if (days >= 7) return ['#4CAF50', '#2E7D32']; // Green
    return ['#2196F3', '#1976D2']; // Blue
  };



  // Zeige Loading wenn Levels noch nicht geladen sind
  if (levelsLoading || levels.length === 0) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.tint} />
        <ThemedText style={{ marginTop: 16, color: colors.text }}>Lade Level-System...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>


      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >


        {/* Savings Card with Shimmer */}
        <Animated.View style={[styles.savingsCard, { opacity: fadeAnim }]}>
          <LinearGradient
            colors={['#FF9800', '#FF5722']}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 0 }}
            style={styles.gradientCard}
          >
            <View style={styles.savingsContent}>
              <View style={styles.savingsLeft}>
                <ThemedText style={styles.savingsLabel}>Deine Gesamtersparnis</ThemedText>
                <ThemedText style={styles.savingsAmount}>{`€ ${currentSavings.toFixed(2)}`}</ThemedText>
              </View>
              <View style={styles.savingsRight}>
                <TouchableOpacity style={styles.productsBadge} onPress={() => router.push('/purchase-history' as any)}>
                  <IconSymbol name="number" size={14} color={colors.warning} />
                  <ThemedText style={styles.productsBadgeText}>{`${purchasedProducts} gekaufte Produkte`}</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
            
            {/* Shimmer Effect */}
            <Animated.View 
              style={[
                styles.shimmerOverlay,
                {
                  transform: [{ translateX: shimmerTranslateX }],
                }
              ]}
            >
              <LinearGradient
                colors={['transparent', 'rgba(255, 255, 255, 0.23)', 'transparent']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.shimmerGradient}
              />
            </Animated.View>
          </LinearGradient>
        </Animated.View>

        {/* Current Level Card */}
        <Animated.View style={[styles.levelCard, { opacity: fadeAnim }]}>
          <LinearGradient
            colors={(() => {
              // Level-spezifische Farben (Gradient mit dunklerer Version)
              const baseColor = currentLevelInfo.color;
              switch(currentLevel) {
                case 1: return [baseColor, '#9E6B50']; // Braun
                case 2: return [baseColor, '#FF9800']; // Orange
                case 3: return [baseColor, '#4CAF50']; // Grün
                case 4: return [baseColor, '#FFC107']; // Gold
                case 5: return [baseColor, '#FF5252']; // Rot
                default: return [baseColor, '#9E6B50'];
              }
            })()}
            start={{ x: -1, y: 0.34 }}
            end={{ x: 1, y: -0.34 }}
            style={styles.gradientCard}
          >
            <View style={styles.levelHeader}>
              <View style={styles.levelIcon}>
              <IconSymbol name={currentLevelInfo.icon as any} size={30} color="white" />
              </View>
              <View style={styles.levelInfo}>
              <ThemedText style={styles.levelNumber}>{`Level ${currentLevel}`}</ThemedText>
              <ThemedText style={styles.levelName}>{currentLevelInfo.name}</ThemedText>
              <ThemedText style={styles.levelDescription}>{currentLevelInfo.description}</ThemedText>
              </View>
            </View>

            {/* Reward Badge */}
            <View style={styles.rewardBadge}>
              <IconSymbol name="gift" size={16} color="white" />
              <ThemedText style={styles.rewardText}>
                {`Belohnung: ${currentLevelInfo.reward}`}
              </ThemedText>
            </View>

            {/* Progress Section */}
            {nextLevel && (
            <View style={styles.progressSection}>
                <ThemedText style={styles.progressLabel}>{`Fortschritt zu Level ${nextLevel.id} (${nextLevel.name}):`}</ThemedText>
                
                {/* Zeige Ersparnis NUR wenn erforderlich */}
                {nextLevel.savingsRequired > 0 && (
                  <>
              <View style={styles.progressRow}>
                <ThemedText style={styles.progressText}>
                        {`€ ${currentSavings.toFixed(2)} / ${nextLevel.savingsRequired}€`}
                </ThemedText>
              </View>
                    <ProgressBar progress={currentSavings} maxProgress={nextLevel.savingsRequired} color="white" />
                  </>
                )}
              
              <View style={styles.pointsRow}>
                  <ThemedText style={styles.progressLabel}>Punkte:</ThemedText>
                  <ThemedText style={styles.progressText}>{`${currentPoints} / ${nextLevel.pointsRequired} Pkte.`}</ThemedText>
              </View>
                <ProgressBar progress={currentPoints} maxProgress={nextLevel.pointsRequired} color="white" />
              
              <ThemedText style={styles.remainingText}>
                  {nextLevel.savingsRequired > 0 
                    ? `Noch €${Math.max(0, nextLevel.savingsRequired - currentSavings).toFixed(2)} & ${Math.max(0, nextLevel.pointsRequired - currentPoints)} Punkte zum nächsten Level`
                    : `Noch ${Math.max(0, nextLevel.pointsRequired - currentPoints)} Punkte zum nächsten Level`
                  }
              </ThemedText>
            </View>
            )}
            {!nextLevel && (
              <View style={styles.progressSection}>
                <ThemedText style={[styles.progressLabel, {fontSize: 16, textAlign: 'center'}]}>🏆 Maximales Level erreicht! 🏆</ThemedText>
                <ThemedText style={[styles.remainingText, {textAlign: 'center'}]}>Du bist ein wahrer MarkenDetektiv!</ThemedText>
              </View>
            )}
          </LinearGradient>
        </Animated.View>

        {/* Streak Display - nutze levelListCard wie andere Level auch */}
        {currentStreak > 0 && (
          <Animated.View style={[
            styles.levelListCard, 
            { 
              opacity: fadeAnim,
              backgroundColor: colors.cardBackground,
              marginBottom: 16,
            }
          ]}>
            <View style={styles.levelListContent}>
              <View style={[styles.levelListIcon, { backgroundColor: getStreakGradient(currentStreak)[0] }]}>
                <IconSymbol name="flame.fill" size={20} color="white" />
              </View>
              
              <View style={styles.levelListInfo}>
                <View style={styles.levelListHeader}>
                  <ThemedText style={[styles.levelListName, { color: colors.text }]}>
                    {`${currentStreak} ${currentStreak === 1 ? 'Tag' : 'Tage'} Streak!`}
                  </ThemedText>
                </View>
                <ThemedText style={styles.levelListDescription}>
                  <Text>{currentStreak >= 7 ? 'Du bist richtig auf Feuer! 🎯' : 'Weiter so! 💪'}</Text>
                </ThemedText>
                <ThemedText style={styles.levelListDescription}>
                  <Text>{`${userStats?.freezeTokens || 0}❄️ Freeze-Token verfügbar`}</Text>
                </ThemedText>
              </View>

              <View style={styles.levelStatus}>
                <IconSymbol name="checkmark.circle.fill" size={24} color={getStreakGradient(currentStreak)[0]} />
              </View>
            </View>
            
          </Animated.View>
        )}

        {/* All Levels Section */}
        <ThemedText style={styles.sectionTitle}>Alle Level</ThemedText>
        
        {levelsWithStatus.map((level, index) => (
          <Animated.View 
            key={level.id} 
            style={[
              styles.levelListCard,
              { backgroundColor: colors.cardBackground },
              level.isActive && { borderColor: level.color, borderWidth: 2 },
              level.isUnlocked && !level.isActive && { 
                borderColor: colors.success + '40', 
                borderWidth: 1,
                backgroundColor: colors.success + '08'
              },
              !level.isUnlocked && level.hasNewCategory && {
                opacity: 0.95 // Besserer Kontrast für goldene Level
              },
              !level.isUnlocked && !level.hasNewCategory && { opacity: 0.75 } // Besserer Kontrast
            ]}
          >
            <View style={styles.levelListContent}>
              <View style={[
                styles.levelListIcon, 
                { 
                  backgroundColor: level.isUnlocked ? level.color : colors.border,
                  opacity: level.isUnlocked ? 1 : 0.5
                }
              ]}>
                <IconSymbol 
                  name={level.icon as any} 
                  size={20} 
                  color={level.isUnlocked ? 'white' : colors.icon} 
                />
              </View>
              
              <View style={styles.levelListInfo}>
                <View style={styles.levelListHeader}>
                  <ThemedText style={[
                    styles.levelListName, 
                    level.isActive && { color: colors.text, fontFamily: 'Nunito_700Bold' },
                    level.isUnlocked && !level.isActive && { color: colors.icon, fontFamily: 'Nunito' },
                    !level.isUnlocked && { opacity: 0.4 } // Besserer Kontrast - GLEICH für alle
                  ]}>
                    {`Level ${level.id} ${level.name}`}
                  </ThemedText>
                </View>
                <ThemedText style={[
                  styles.levelListDescription,
                  level.isUnlocked && !level.isActive && { color: colors.success + 'AA' },
                  !level.isUnlocked && { opacity: 0.6 } // Besserer Kontrast - GLEICH für alle
                ]}>
                  {level.description}
                </ThemedText>
                <View style={styles.rewardRow}>
                  <TextShimmer 
                    isShimmering={!level.isUnlocked}
                  >
                    <View style={styles.rewardContent}>
                      <IconSymbol 
                        name="gift" 
                        size={12} 
                        color={
                          level.isActive ? level.color : 
                          level.isUnlocked ? colors.success :
                          !level.isUnlocked ? '#FFD54F' : colors.icon
                        } 
                      />
                      <ThemedText style={[
                        styles.rewardRowText, 
                        level.isActive && { color: level.color },
                        level.isUnlocked && !level.isActive && { color: colors.success },
                        !level.isUnlocked && { 
                          fontFamily: 'Nunito_700Bold', // Fett für alle gesperrten Level
                          opacity: 0.9, 
                          color: colors.text // Dunkler + kontrastreicher
                        }
                      ]}>
                    {level.reward}
                  </ThemedText>
                    </View>
                  </TextShimmer>
                </View>
              </View>
              
              <View style={styles.levelStatus}>
                {level.isActive ? (
                  <IconSymbol name="star.fill" size={24} color={colors.warning} />
                ) : level.isUnlocked ? (
                  <IconSymbol name="checkmark.circle.fill" size={24} color={colors.success} />
                ) : (
                  <IconSymbol name="lock" size={24} color={colors.icon} />
                )}
              </View>
            </View>
          </Animated.View>
        ))}

        {/* STREAK-ANZEIGE ENTFERNT - War die Ursache für den Crash */}

        {/* Achievements Section */}
        <ThemedText style={[styles.sectionTitle, { marginTop: 15 }]}>Errungenschaften</ThemedText>
        
        {achievementsLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          processedAchievements.map((achievement, index) => (
          <View 
            key={achievement.id}
            style={[
              styles.achievementCard,
              { backgroundColor: colors.cardBackground },
              index === 0 && styles.firstAchievementCard,
              index === processedAchievements.length - 1 && styles.lastAchievementCard,
              achievement.isCompleted && { borderColor: colors.success, borderWidth: 2 }
            ]}
          >
            <View style={styles.achievementContent}>
              <View style={[
                styles.achievementIcon, 
                { backgroundColor: achievement.isCompleted ? colors.warning : achievement.color }
              ]}>
                <IconSymbol 
                  name={achievement.icon as any} 
                  size={20} 
                  color={achievement.isCompleted ? '#FFD700' : 'white'} 
                />
              </View>
              
              <View style={styles.achievementInfo}>
                <View style={styles.achievementHeader}>
                  <View style={styles.achievementTitleRow}>
                  <ThemedText style={styles.achievementName}>{achievement.name}</ThemedText>
                    {/* Schwierigkeitsanzeige */}
                    <View style={styles.difficultyIndicator}>
                      {achievement.points <= 10 && (
                        <ThemedText style={[styles.difficultyText, { color: '#4A90E2' }]}>EINFACH</ThemedText>
                      )}
                      {achievement.points > 10 && achievement.points <= 20 && (
                        <ThemedText style={[styles.difficultyText, { color: '#7ED321' }]}>MITTEL</ThemedText>
                      )}
                      {achievement.points > 20 && achievement.points <= 25 && (
                        <ThemedText style={[styles.difficultyText, { color: '#F5A623' }]}>SCHWER</ThemedText>
                      )}
                      {achievement.points > 25 && (
                        <ThemedText style={[styles.difficultyText, { color: '#D0021B' }]}>MEISTER</ThemedText>
                      )}
                    </View>
                  </View>
                  <View style={[styles.pointsBadge, { backgroundColor: achievement.color }]}>
                    <ThemedText style={[styles.pointsBadgeText, { 
                      color: achievement.isCompleted ? 'white' : 'rgba(0,0,0,0.7)' 
                    }]}>
                      + {achievement.points} Punkte
                    </ThemedText>
                  </View>
                </View>
                
                <ThemedText style={styles.achievementDescription}>
                  {achievement.description}
                </ThemedText>
                
                {!achievement.isCompleted && (
                  <>
                    <View style={styles.achievementProgressBar}>
                      <ProgressBar 
                        progress={achievement.progress} 
                        maxProgress={achievement.maxProgress} 
                        color={achievement.color} 
                      />
                    </View>
                    <View style={styles.progressTextRow}>
                      <ThemedText style={styles.progressValue}>
                        {`${achievement.progress}/${achievement.maxProgress}`}
                      </ThemedText>
                    </View>
                  </>
                )}
                
                {achievement.isCompleted && (
                  <View style={styles.completedBadge}>
                    <IconSymbol name="trophy.fill" size={28} color="#FFD700" />
                  </View>
                )}
              </View>
            </View>
            
            {index < processedAchievements.length - 1 && (
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
            )}
          </View>
        ))
        )}
      </ScrollView>
      
      {/* Info Sheet Modal - Natives iOS Sheet */}
      <Modal
        visible={showInfoSheet}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowInfoSheet(false)}
      >
        <View style={[styles.bottomSheetContainer, { backgroundColor: colors.background }]}>
          {/* Bottom Sheet Header */}
          <View style={styles.bottomSheetHeader}>
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>
            <View style={styles.headerRow}>
              <TouchableOpacity 
                style={styles.closeButtonLeft}
                onPress={() => setShowInfoSheet(false)}
              >
                <IconSymbol name="xmark" size={24} color={colors.icon} />
              </TouchableOpacity>
              <View style={styles.titleSection}>
                <ThemedText style={styles.bottomSheetTitle}>🎮 Level-System & Belohnungen</ThemedText>
                <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.primary }]}>
                  Sammle Punkte und schalte Kategorien frei
                </ThemedText>
              </View>
            </View>
          </View>
          
          <ScrollView 
            style={styles.bottomSheetContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Welcome Message */}
            <View style={[styles.welcomeCard, { backgroundColor: colors.cardBackground }]}>
              <ThemedText style={styles.welcomeTitle}>
                🕵️‍♂️ Willkommen in der Welt von MarkenDetektive 🕵️‍♀️
              </ThemedText>
              <ThemedText style={[styles.welcomeText, { color: colors.text }]}>
                Stell dir vor, MarkenDetektive ist nicht nur eine App, sondern ein{' '}
                <Text style={[styles.welcomeHighlight, { color: colors.primary }]}>Spiel, das nie endet</Text>.
              </ThemedText>
              <ThemedText style={[styles.welcomeText, { color: colors.text }]}>
                Das Ziel: <Text style={[styles.welcomeHighlight, { color: colors.primary }]}>Geld sparen, Spaß haben und Punkte sammeln</Text>, während du uns nebenbei hilfst, geheime Infos über Produkte zu sammeln und Licht ins Dunkel der Hersteller- und Markenverstrickungen zu bringen.
              </ThemedText>
            </View>

            {/* Level System Explanation */}
            <View style={styles.infoSection}>
              <View style={styles.infoSectionHeader}>
                <IconSymbol name="star.fill" size={20} color={colors.warning} />
                <ThemedText style={styles.sectionHeaderText}>Level & coole Titel</ThemedText>
              </View>
              <ThemedText style={styles.infoText}>
                Du sammelst Punkte für verschiedene Aktionen und steigst dadurch im Level auf. Je höher dein Level, desto cooler dein Titel - vom "Sparanfänger" zum "Einkaufsdetektiv"!
              </ThemedText>
            </View>
            
            {/* Categories unlock info */}
            <View style={styles.infoSection}>
              <View style={styles.infoSectionHeader}>
                <IconSymbol name="folder.fill" size={20} color={colors.primary} />
                <ThemedText style={styles.sectionHeaderText}>Kategorien freischalten</ThemedText>
              </View>
              <ThemedText style={styles.infoText}>
                Das Beste: Mit höheren Leveln schaltest du neue Produktkategorien frei! Dadurch findest du immer mehr verschiedene NoName-Alternativen.
              </ThemedText>
              <ThemedText style={[styles.infoText, { marginTop: 8, fontWeight: '600', color: colors.primary }]}>
                🔓 Je höher dein Level, desto mehr Produktbereiche werden verfügbar!
              </ThemedText>
            </View>
            
            {/* How to earn points */}
            <View style={styles.infoSection}>
              <View style={styles.infoSectionHeader}>
                <IconSymbol name="plus.circle.fill" size={20} color={colors.success} />
                <ThemedText style={styles.sectionHeaderText}>So sammelst du Punkte</ThemedText>
              </View>
              <View style={styles.pointsList}>
                <View style={styles.pointsItem}>
                  <IconSymbol name="camera.fill" size={16} color={colors.primary} />
                  <Text style={[styles.pointsText, { color: colors.text }]}>Produkt scannen: <Text style={styles.pointsValue}>+2 Punkte</Text></Text>
                </View>
                <View style={styles.pointsItem}>
                  <IconSymbol name="magnifyingglass" size={16} color={colors.primary} />
                  <Text style={[styles.pointsText, { color: colors.text }]}>Produkt suchen: <Text style={styles.pointsValue}>+1 Punkt</Text></Text>
                </View>
                <View style={styles.pointsItem}>
                  <IconSymbol name="chart.bar.fill" size={16} color={colors.primary} />
                  <Text style={[styles.pointsText, { color: colors.text }]}>Vergleich anschauen: <Text style={styles.pointsValue}>+3 Punkte</Text></Text>
                </View>
                <View style={styles.pointsItem}>
                  <IconSymbol name="list.bullet" size={16} color={colors.primary} />
                  <Text style={[styles.pointsText, { color: colors.text }]}>Einkaufszettel abschließen: <Text style={styles.pointsValue}>+5 Punkte</Text></Text>
                </View>
                <View style={styles.pointsItem}>
                  <IconSymbol name="star.fill" size={16} color={colors.warning} />
                  <Text style={[styles.pointsText, { color: colors.text }]}>Bewertung schreiben: <Text style={styles.pointsValue}>+2 Punkte</Text></Text>
                </View>
                <View style={styles.pointsItem}>
                  <IconSymbol name="trophy.fill" size={16} color={colors.warning} />
                  <Text style={[styles.pointsText, { color: colors.text }]}>Erste Aktion: <Text style={styles.pointsValue}>+10 Punkte</Text></Text>
                </View>
              </View>
            </View>
            
            {/* Achievements explanation */}
            <View style={styles.infoSection}>
              <View style={styles.infoSectionHeader}>
                <IconSymbol name="trophy.fill" size={20} color={colors.warning} />
                <ThemedText style={styles.sectionHeaderText}>Errungenschaften sammeln</ThemedText>
              </View>
              <ThemedText style={styles.infoText}>
                Errungenschaften sind besondere Herausforderungen. Du schaltest sie frei, indem du bestimmte Aufgaben erfüllst - zum Beispiel 5 Produkte scannen oder deinen ersten Einkaufszettel abschließen.
              </ThemedText>
              <ThemedText style={[styles.infoText, { marginTop: 8, fontWeight: '600', color: colors.primary }]}>
                💡 Tipp: Manche Achievements brauchen Zeit - scanne weiter, nutze die App regelmäßig und du wirst mehr freischalten!
              </ThemedText>
            </View>
            
            {/* Level progression with examples */}
            <View style={styles.infoSection}>
              <View style={styles.infoSectionHeader}>
                <IconSymbol name="chart.line.uptrend.xyaxis" size={20} color={colors.primary} />
                <ThemedText style={styles.sectionHeaderText}>Level-Aufstieg</ThemedText>
              </View>
              <ThemedText style={styles.infoText}>
                Die ersten Level sind schnell erreicht, aber später brauchst du mehr Punkte. Ab Level 4 musst du auch Geld sparen, um aufzusteigen!
              </ThemedText>
              <View style={styles.levelExample}>
                <Text style={[styles.levelText, { color: colors.text }]}>Level 1 → 2: 10 Punkte</Text>
                <Text style={[styles.levelText, { color: colors.text }]}>Level 2 → 3: 25 Punkte</Text>
                <Text style={[styles.levelText, { color: colors.text }]}>Level 3 → 4: 50 Punkte + 10€ sparen</Text>
                <Text style={[styles.levelText, { color: colors.text }]}>Level 4 → 5: 100 Punkte + 50€ sparen</Text>
              </View>
            </View>
            
            {/* Fair Play */}
            <View style={[styles.infoSection, { paddingBottom: 40 }]}>
              <View style={styles.infoSectionHeader}>
                <IconSymbol name="clock.fill" size={20} color={colors.secondary} />
                <ThemedText style={styles.sectionHeaderText}>Fair Play Limits</ThemedText>
              </View>
              <ThemedText style={styles.infoText}>
                Damit es fair bleibt, gibt es Tageslimits:
              </ThemedText>
              <View style={styles.limitsList}>
                <Text style={[styles.limitText, { color: colors.text }]}>• Max. 10 Scans pro Tag</Text>
                <Text style={[styles.limitText, { color: colors.text }]}>• Max. 10 Vergleiche pro Tag</Text>
                <Text style={[styles.limitText, { color: colors.text }]}>• Max. 5 Einkaufszettel pro Woche</Text>
              </View>
              <ThemedText style={[styles.infoText, { marginTop: 8, fontSize: 12, color: colors.icon }]}>
                So wird verhindert, dass jemand zu schnell durch die Level rast!
              </ThemedText>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 50,
  },

  // Savings Card
  savingsCard: {
    marginBottom: 12,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
    // KEIN overflow hier - Shadow muss sichtbar bleiben
  },
  gradientCard: {
    padding: 10,          // Reduziert von 12
    position: 'relative',
    borderRadius: 16,     // Abrundung für Gradient
    overflow: 'hidden',   // Gradient wird abgerundet
  },
  savingsContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  savingsLeft: {
    flex: 1,
  },
  savingsLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    lineHeight: 16,
  },
  savingsAmount: {
    color: 'white',
    fontSize: 23,
    fontWeight: '600',
    lineHeight: 26,
  },
  savingsRight: {
    alignItems: 'flex-end',
  },
  productsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 2,
  },
  productsBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF9800',
    lineHeight: 14,
  },
  shimmerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 100,
  },
  shimmerGradient: {
    flex: 1,
    width: '100%',
  },

  // Level Card
  levelCard: {
    marginBottom: 25,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,       // Reduziert von 12
    gap: 8,
  },
  levelIcon: {
    width: 61,
    height: 61,
    borderRadius: 30.5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelInfo: {
    flex: 1,
  },
  levelNumber: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 14,        // Reduziert von 16
    marginBottom: 2,       // Weniger Abstand
  },
  levelName: {
    color: 'white',
    fontSize: 22,          // Reduziert von 23
    fontWeight: '600',
    lineHeight: 24,        // Reduziert von 26
    marginBottom: 2,       // Weniger Abstand
  },
  levelDescription: {
    color: 'white',
    fontSize: 12,
    fontWeight: '300',
    lineHeight: 13,        // Reduziert von 14
  },
  rewardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 6,    // Reduziert von 8
    borderRadius: 6,
    marginBottom: 8,       // Reduziert von 12
    gap: 6,               // Reduziert von 8
  },
  rewardText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    lineHeight: 13,        // Reduziert von 14
  },
  progressSection: {
    gap: 4,               // Reduziert von 6
  },
  progressLabel: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 13,        // Reduziert von 14
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 13,        // Reduziert von 14
  },
  pointsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,          // Reduziert von 6
  },
  remainingText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '300',
    marginTop: 2,          // Reduziert von 3
    lineHeight: 13,        // Reduziert von 14
  },

  // Progress Bar
  progressBarContainer: {
    marginVertical: 4,     // Reduziert von 6
  },
  progressBarBackground: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 6,
  },

  // Section Title
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 10,
    lineHeight: 16,
  },

  // Level List Cards
  levelListCard: {
    borderRadius: 16,
    padding: 8,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  levelListContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    gap: 8,
    
  },
  levelListIcon: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelListInfo: {
    flex: 1,
  },
  levelListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  levelListName: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 16,
  },
  levelListDescription: {
    fontSize: 12,
    fontWeight: '300',
    opacity: 0.7,
    marginBottom: 2,
    lineHeight: 14,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rewardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  rewardRowText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 14,
  },
  levelStatus: {
    padding: 4,
  },

  // Achievement Cards
  achievementCard: {
    borderWidth: 2,
    borderColor: 'transparent',
  },
  firstAchievementCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  lastAchievementCard: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    marginBottom: 25,
  },
  achievementContent: {
    flexDirection: 'row',
    padding: 9,
    paddingTop: 11,
    gap: 8,
  },
  achievementIcon: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  achievementInfo: {
    flex: 1,
  },
  achievementHeader: {
    flexDirection: 'column',
    marginBottom: 4,
  },
  achievementTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  achievementName: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 16,
    flex: 1,
  },
  difficultyIndicator: {
    marginLeft: 8,
  },
  difficultyText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pointsBadge: {
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 14,
  },
  pointsBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
    lineHeight: 12,
  },
  achievementDescription: {
    fontSize: 12,
    fontWeight: '300',
    opacity: 0.7,
    marginBottom: 6,
    lineHeight: 14,
  },
  achievementProgressBar: {
    marginBottom: 3,
  },
  progressTextRow: {
    alignItems: 'flex-end',
  },
  progressValue: {
    fontSize: 12,
    fontWeight: '300',
    opacity: 0.7,
    lineHeight: 14,
  },
  completedBadge: {
    alignSelf: 'flex-end',
    marginTop: 8,
  },
  divider: {
    height: 1,
    marginHorizontal: 8,
  },

  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Native iOS Bottom Sheet Styles
  bottomSheetContainer: {
    flex: 1,
  },
  bottomSheetHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  handleContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  closeButtonLeft: {
    padding: 8,
    marginRight: 12,
    marginTop: -4,
  },
  titleSection: {
    flex: 1,
  },
  bottomSheetTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 2,
  },
  bottomSheetSubtitle: {
    fontSize: 14,
    opacity: 0.8,
  },
  bottomSheetContent: {
    flex: 1,
    paddingHorizontal: 20,
  },

  // Welcome Card Styles
  welcomeCard: {
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  welcomeTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'left',
    marginBottom: 12,
    lineHeight: 20,
  },
  welcomeText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
    opacity: 0.85,
  },
  welcomeHighlight: {
    fontWeight: '600',
  },

  infoSection: {
    paddingVertical: 16,
  },
  infoSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: '600',
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
  },
  pointsList: {
    gap: 8,
    marginTop: 8,
  },
  pointsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  pointsText: {
    fontSize: 14,
    flex: 1,
  },
  pointsValue: {
    fontWeight: '600',
    color: '#4CAF50',
  },
  limitsList: {
    marginTop: 8,
    paddingLeft: 8,
  },
  limitText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 2,
  },
  levelExample: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  levelText: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 2,
    fontFamily: 'monospace',
  },
});