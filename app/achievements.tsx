import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useAchievements } from '@/lib/hooks/useAchievements';
import { LEVELS } from '@/lib/types/achievements';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View
} from 'react-native';

const { width: screenWidth } = Dimensions.get('window');

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
    navigation.setOptions(getNavigationHeaderOptions(colorScheme, 'Level & Errungenschaften'));
  }, [navigation, colorScheme]);

  // Animation values
  const [shimmerAnim] = useState(new Animated.Value(0));
  const [fadeAnim] = useState(new Animated.Value(0));

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
  const currentPoints = userStats?.totalPoints || 0;
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
    const points = userStats?.totalPoints || (userProfile as any)?.stats?.totalPoints || 0;
    const savings = userProfile?.totalSavings || 0;
    
    for (let i = LEVELS.length - 1; i >= 0; i--) {
      const level = LEVELS[i];
      if (points >= level.pointsRequired && savings >= level.savingsRequired) {
        console.log(`🔄 Level berechnet: ${level.id} (${points} Punkte, €${savings} Ersparnis)`);
        return level.id;
      }
    }
    
    return 1;
  })();
  const currentStreak = userStats?.currentStreak || 0;
  
  // Get current level info
  const currentLevelInfo = LEVELS.find(l => l.id === currentLevel) || LEVELS[0];
  const nextLevel = LEVELS.find(l => l.id === currentLevel + 1);
  
  // Calculate levels with unlock status
  const levelsWithStatus = LEVELS.map(level => ({
    ...level,
    isActive: level.id === currentLevel,
    isUnlocked: level.id <= currentLevel || 
                (currentSavings >= level.savingsRequired && currentPoints >= level.pointsRequired)
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
    const [progressAnim] = useState(new Animated.Value(0));
    const percentage = Math.min(progress / maxProgress, 1);
    
    useEffect(() => {
      // Animate progress bar with delay
      setTimeout(() => {
        Animated.timing(progressAnim, {
          toValue: percentage,
          duration: 1500,
          useNativeDriver: false,
        }).start();
      }, 800);
    }, [percentage]);

    const animatedWidth = progressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', `${percentage * 100}%`],
    });
    
    return (
      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBarBackground, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
          <Animated.View 
            style={[
              styles.progressBarFill, 
              { 
                width: animatedWidth, 
                backgroundColor: color 
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
                <ThemedText style={styles.savingsAmount}>€ {currentSavings.toFixed(2)}</ThemedText>
              </View>
              <View style={styles.savingsRight}>
                <TouchableOpacity style={styles.productsBadge} onPress={() => router.push('/purchase-history' as any)}>
                  <IconSymbol name="number" size={14} color={colors.warning} />
                  <ThemedText style={styles.productsBadgeText}>{purchasedProducts} gekaufte Produkte</ThemedText>
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
              <ThemedText style={styles.levelNumber}>Level {currentLevel}</ThemedText>
              <ThemedText style={styles.levelName}>{currentLevelInfo.name}</ThemedText>
              <ThemedText style={styles.levelDescription}>{currentLevelInfo.description}</ThemedText>
            </View>
            </View>

            {/* Reward Badge */}
            <View style={styles.rewardBadge}>
              <IconSymbol name="gift" size={16} color="white" />
              <ThemedText style={styles.rewardText}>
                Belohnung: {currentLevelInfo.reward}
              </ThemedText>
            </View>

            {/* Progress Section */}
            {nextLevel && (
              <View style={styles.progressSection}>
                <ThemedText style={styles.progressLabel}>Fortschritt zu Level {nextLevel.id} ({nextLevel.name}):</ThemedText>
                <View style={styles.progressRow}>
                  <ThemedText style={styles.progressText}>
                    € {currentSavings.toFixed(2)} / {nextLevel.savingsRequired}€
                  </ThemedText>
                </View>
                <ProgressBar progress={currentSavings} maxProgress={nextLevel.savingsRequired} color="white" />
                
                <View style={styles.pointsRow}>
                  <ThemedText style={styles.progressLabel}>Punkte aus Errungenschaften:</ThemedText>
                  <ThemedText style={styles.progressText}>{currentPoints} / {nextLevel.pointsRequired} Pkte.</ThemedText>
                </View>
                <ProgressBar progress={currentPoints} maxProgress={nextLevel.pointsRequired} color="white" />
                
                <ThemedText style={styles.remainingText}>
                  Noch €{Math.max(0, nextLevel.savingsRequired - currentSavings).toFixed(2)} & {Math.max(0, nextLevel.pointsRequired - currentPoints)} Punkte zum nächsten Level
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

        {/* All Levels Section */}
        <ThemedText style={styles.sectionTitle}>Alle Level</ThemedText>
        
        {levelsWithStatus.map((level, index) => (
          <Animated.View 
            key={level.id} 
            style={[
              styles.levelListCard,
              { backgroundColor: colors.cardBackground },
              level.isActive && { borderColor: level.color, borderWidth: 2 }
            ]}
          >
            <View style={styles.levelListContent}>
              <View style={[styles.levelListIcon, { backgroundColor: level.color }]}>
                <IconSymbol 
                  name={level.icon as any} 
                  size={20} 
                  color={level.isActive ? 'white' : colors.icon} 
                />
              </View>
              
              <View style={styles.levelListInfo}>
                <View style={styles.levelListHeader}>
                  <ThemedText style={[styles.levelListName, level.isActive && { color: level.color }]}>
                    Level {level.id} {level.name}
                  </ThemedText>
                </View>
                <ThemedText style={styles.levelListDescription}>
                  {level.description}
                </ThemedText>
                <View style={styles.rewardRow}>
                  <IconSymbol name="gift" size={12} color={level.isActive ? level.color : colors.icon} />
                  <ThemedText style={[styles.rewardRowText, level.isActive && { color: level.color }]}>
                    {level.reward}
                  </ThemedText>
                </View>
              </View>
              
              <View style={styles.levelStatus}>
                {level.isActive ? (
                  <IconSymbol name="star.fill" size={24} color={colors.warning} />
                ) : (
                  <IconSymbol name="lock" size={24} color={colors.icon} />
                )}
              </View>
            </View>
          </Animated.View>
        ))}

        {/* Current Streak Display */}
        {currentStreak > 0 && (
          <View style={[styles.streakCard, { backgroundColor: colors.cardBackground }]}>
            <LinearGradient
              colors={['#FF2D55', '#FF6B6B']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.streakGradient}
            >
              <IconSymbol name="flame.fill" size={24} color="white" />
              <ThemedText style={styles.streakText}>
                {currentStreak} Tage Streak! {currentStreak >= 30 ? '🏆' : 'Weiter so!'}
              </ThemedText>
            </LinearGradient>
          </View>
        )}
        
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
                        {achievement.progress}/{achievement.maxProgress}
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
  streakCard: {
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
  },
  streakGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
  streakText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});