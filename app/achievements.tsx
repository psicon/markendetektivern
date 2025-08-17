import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import {
    Animated,
    Dimensions,
    ScrollView,
    StyleSheet,
    View
} from 'react-native';

const { width: screenWidth } = Dimensions.get('window');

export default function AchievementsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const navigation = useNavigation();
  const router = useRouter();

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

  const levels = [
    {
      id: 1,
      name: 'Sparanfänger',
      description: 'Der erste Schritt',
      savingsRequired: 0,
      pointsRequired: 0,
      reward: 'Zugang zu allen Grundfunktionen',
      color: '#BF8970',
      icon: 'pawprint',
      isActive: true,
      isUnlocked: true,
    },
    {
      id: 2,
      name: 'Sparprofi',
      description: 'Ab 50 € Ersparnis & 5 Punkte',
      savingsRequired: 50,
      pointsRequired: 5,
      reward: 'Zugang zu 1 weiteren Kategorie',
      color: '#FFB74D',
      icon: 'trophy',
      isActive: false,
      isUnlocked: false,
    },
    {
      id: 3,
      name: 'Sparmeister',
      description: 'Ab 350 € Ersparnis & 25 Punkte',
      savingsRequired: 350,
      pointsRequired: 25,
      reward: 'Zugang zu 1 weiteren Kategorie',
      color: '#81C784',
      icon: 'trophy.fill',
      isActive: false,
      isUnlocked: false,
    },
    {
      id: 4,
      name: 'Sparfuchs',
      description: 'Ab 750 € Ersparnis & 50 Punkte',
      savingsRequired: 750,
      pointsRequired: 50,
      reward: 'Zugang zu 2 weiteren Kategorien',
      color: '#FFD54F',
      icon: 'pawprint.fill',
      isActive: false,
      isUnlocked: false,
    },
    {
      id: 5,
      name: 'MarkenDetektiv',
      description: 'Ab 1.500 € Ersparnis & 80 Punkte',
      savingsRequired: 1500,
      pointsRequired: 80,
      reward: 'Zugang zu allen Kategorien',
      color: '#FF8A65',
      icon: 'star.fill',
      isActive: false,
      isUnlocked: false,
    },
  ];

  const achievements = [
    {
      id: 1,
      name: 'Erste Umwandlung',
      description: 'Wandle, im Einkaufszettel, ein Markenprodukt zu einem No-Name Produkt um',
      points: 5,
      progress: 1,
      maxProgress: 1,
      isCompleted: true,
      icon: 'wand.and.stars',
      color: colors.primary,
    },
    {
      id: 2,
      name: 'Einkaufszettelmaster',
      description: '5 Einkaufszettel erstellen und leer shoppen',
      points: 5,
      progress: 2,
      maxProgress: 5,
      isCompleted: false,
      icon: 'list.bullet',
      color: colors.primary,
    },
    {
      id: 3,
      name: 'Vergleichsexperte',
      description: '10 Produktvergleiche durchführen',
      points: 20,
      progress: 10,
      maxProgress: 20,
      isCompleted: false,
      icon: 'scale.3d',
      color: colors.warning,
    },
    {
      id: 4,
      name: 'Feedbackgeber',
      description: 'Gib 20 Bewertungen für Produkte ab',
      points: 20,
      progress: 15,
      maxProgress: 20,
      isCompleted: false,
      icon: 'bubble.left',
      color: colors.warning,
    },
    {
      id: 5,
      name: 'Empfehler',
      description: 'Leite den Link zur App an 20 Freunde weiter',
      points: 20,
      progress: 5,
      maxProgress: 20,
      isCompleted: false,
      icon: 'paperplane',
      color: colors.warning,
    },
    {
      id: 6,
      name: 'Treu bleiben',
      description: 'Öffne die App an 30 Tagen in Folge',
      points: 30,
      progress: 10,
      maxProgress: 30,
      isCompleted: false,
      icon: 'heart',
      color: colors.warning,
    },
  ];

  const currentSavings = 238.78;
  const currentPoints = 5;
  const purchasedProducts = 23;

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
                <View style={styles.productsBadge}>
                  <IconSymbol name="number" size={14} color={colors.warning} />
                  <ThemedText style={styles.productsBadgeText}>{purchasedProducts} gekaufte Produkte</ThemedText>
                </View>
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
            colors={['#BF8970', '#A1887F']}
            start={{ x: -1, y: 0.34 }}
            end={{ x: 1, y: -0.34 }}
            style={styles.gradientCard}
          >
            <View style={styles.levelHeader}>
              <View style={styles.levelIcon}>
                <IconSymbol name="pawprint" size={30} color="white" />
              </View>
              <View style={styles.levelInfo}>
                <ThemedText style={styles.levelNumber}>Level 1</ThemedText>
                <ThemedText style={styles.levelName}>Sparanfänger</ThemedText>
                <ThemedText style={styles.levelDescription}>Der erste Schritt zu mehr Ersparnis</ThemedText>
              </View>
            </View>

            {/* Reward Badge */}
            <View style={styles.rewardBadge}>
              <IconSymbol name="gift" size={16} color="white" />
              <ThemedText style={styles.rewardText}>
                Belohnung: Zugang zu allen Grundfunktionen
              </ThemedText>
            </View>

            {/* Progress Section */}
            <View style={styles.progressSection}>
              <ThemedText style={styles.progressLabel}>Fortschritt zu Level 2 (Sparprofi):</ThemedText>
              <View style={styles.progressRow}>
                <ThemedText style={styles.progressText}>
                  € {currentSavings.toFixed(2)} / 50€
                </ThemedText>
              </View>
              <ProgressBar progress={currentSavings} maxProgress={50} color="white" />
              
              <View style={styles.pointsRow}>
                <ThemedText style={styles.progressLabel}>Punkte aus Errungenschaften:</ThemedText>
                <ThemedText style={styles.progressText}>{currentPoints} / 80 Pkte.</ThemedText>
              </View>
              <ProgressBar progress={currentPoints} maxProgress={80} color="white" />
              
              <ThemedText style={styles.remainingText}>
                Noch €{(50 - currentSavings).toFixed(2)} & {80 - currentPoints} Punkte zum nächsten Level
              </ThemedText>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* All Levels Section */}
        <ThemedText style={styles.sectionTitle}>Alle Level</ThemedText>
        
        {levels.map((level, index) => (
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

        {/* Achievements Section */}
        <ThemedText style={styles.sectionTitle}>Errungenschaften</ThemedText>
        
        {achievements.map((achievement, index) => (
          <View 
            key={achievement.id}
            style={[
              styles.achievementCard,
              { backgroundColor: colors.cardBackground },
              index === 0 && styles.firstAchievementCard,
              index === achievements.length - 1 && styles.lastAchievementCard
            ]}
          >
            <View style={styles.achievementContent}>
              <View style={[styles.achievementIcon, { backgroundColor: achievement.color }]}>
                <IconSymbol name={achievement.icon as any} size={20} color="white" />
              </View>
              
              <View style={styles.achievementInfo}>
                <View style={styles.achievementHeader}>
                  <ThemedText style={styles.achievementName}>{achievement.name}</ThemedText>
                  <View style={[styles.pointsBadge, { backgroundColor: achievement.color }]}>
                    <ThemedText style={styles.pointsBadgeText}>+ {achievement.points} Punkte</ThemedText>
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
                    <IconSymbol name="checkmark.circle" size={24} color={colors.success} />
                  </View>
                )}
              </View>
            </View>
            
            {index < achievements.length - 1 && (
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
            )}
          </View>
        ))}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  achievementName: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 16,
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
});