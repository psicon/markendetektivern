import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

export default function AchievementsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const userProgress = {
    currentLevel: 1,
    totalSavings: 238.78,
    purchasedProducts: 23,
    points: 5,
    pointsToNextLevel: 80
  };

  const achievements = [
    {
      id: 'first_conversion',
      title: 'Erste Umwandlung',
      description: 'Wandle, im Einkaufszettel, ein Markenprodukt zu einem No-Name Produkt um',
      points: 5,
      completed: true,
      icon: '🔄',
      completedAt: new Date()
    },
    {
      id: 'shopping_master',
      title: 'Einkaufszettelmaster',
      description: '5 Einkaufszettel erstellen und leer shoppen',
      points: 5,
      completed: false,
      progress: 2,
      total: 5,
      icon: '🛍️'
    },
    {
      id: 'comparison_expert',
      title: 'Vergleichsexperte',
      description: '10 Produktvergleiche durchführen',
      points: 20,
      completed: false,
      progress: 10,
      total: 20,
      icon: '⚖️'
    },
    {
      id: 'feedback_giver',
      title: 'Feedbackgeber',
      description: 'Gib 20 Bewertungen für Produkte ab',
      points: 20,
      completed: false,
      progress: 15,
      total: 20,
      icon: '💬'
    },
    {
      id: 'referrer',
      title: 'Empfehler',
      description: 'Leite den Link zur App an 20 Freunde weiter',
      points: 20,
      completed: false,
      progress: 5,
      total: 20,
      icon: '📨'
    },
    {
      id: 'loyalty',
      title: 'Treu bleiben',
      description: 'Öffne die App an 30 Tagen in Folge',
      points: 30,
      completed: false,
      progress: 12,
      total: 30,
      icon: '💝'
    }
  ];

  const levels = [
    {
      level: 1,
      title: 'Sparanfänger',
      description: 'Der erste Schritt',
      minSavings: 0,
      minPoints: 0,
      reward: 'Zugang zu allen Grundfunktionen',
      current: true
    },
    {
      level: 2,
      title: 'Sparprofi',
      description: 'Ab 50 € Ersparnis & 5 Punkte',
      minSavings: 50,
      minPoints: 5,
      reward: 'Zugang zu 1 weiteren Kategorie',
      locked: true
    },
    {
      level: 3,
      title: 'Sparmeister',
      description: 'Ab 350 € Ersparnis & 25 Punkte',
      minSavings: 350,
      minPoints: 25,
      reward: 'Zugang zu 1 weiteren Kategorie',
      locked: true
    },
    {
      level: 4,
      title: 'Sparfuchs',
      description: 'Ab 750 € Ersparnis & 50 Punkte',
      minSavings: 750,
      minPoints: 50,
      reward: 'Zugang zu 2 weiteren Kategorien',
      locked: true
    },
    {
      level: 5,
      title: 'MarkenDetektiv',
      description: 'Ab 1.500 € Ersparnis & 80 Punkte',
      minSavings: 1500,
      minPoints: 80,
      reward: 'Zugang zu allen Kategorien',
      locked: true
    }
  ];

  const getProgressPercentage = (progress: number, total: number) => {
    return Math.min((progress / total) * 100, 100);
  };

  const getLevelIcon = (level: number) => {
    switch (level) {
      case 1: return '🐰';
      case 2: return '🏆';
      case 3: return '🥇';
      case 4: return '🦊';
      case 5: return '🔍';
      default: return '⭐';
    }
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen 
        options={{
          title: 'Level und Errungenschaften',
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }} 
      />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* User Progress Card */}
        <View style={styles.progressCard}>
          <View style={styles.progressContent}>
            <ThemedText style={styles.progressTitle}>Deine Gesamtersparnis</ThemedText>
            <ThemedText style={styles.progressAmount}>
              {userProgress.totalSavings.toFixed(2)} €
            </ThemedText>
          </View>
          <View style={styles.progressTag}>
            <ThemedText style={styles.progressTagText}>
              # {userProgress.purchasedProducts} gekaufte Produkte
            </ThemedText>
          </View>
        </View>

        {/* Current Level Card */}
        <View style={styles.currentLevelCard}>
          <View style={styles.currentLevelHeader}>
            <View style={styles.levelIcon}>
              <ThemedText style={styles.levelEmoji}>
                {getLevelIcon(userProgress.currentLevel)}
              </ThemedText>
            </View>
            <View style={styles.currentLevelInfo}>
              <ThemedText style={styles.currentLevelTitle}>
                Level {userProgress.currentLevel} Sparanfänger
              </ThemedText>
              <ThemedText style={styles.currentLevelDescription}>
                Der erste Schritt zu mehr Ersparnis
              </ThemedText>
            </View>
            <TouchableOpacity>
              <IconSymbol name="star.fill" size={24} color={colors.icon} />
            </TouchableOpacity>
          </View>

          <View style={[styles.rewardBadge, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
            <IconSymbol name="star.fill" size={16} color={colors.icon} />
            <ThemedText style={styles.rewardText}>
              Belohnung: Zugang zu allen Grundfunktionen
            </ThemedText>
          </View>

          <View style={styles.progressSection}>
            <ThemedText style={styles.progressLabel}>
              Fortschritt zu Level 2 (Sparprofi):
            </ThemedText>
            <ThemedText style={styles.progressStatus}>
              Bisher gespart: {userProgress.totalSavings.toFixed(2)} € / 50€
            </ThemedText>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View 
                style={[
                  styles.progressFill, 
                  { 
                    backgroundColor: colors.warning,
                    width: `${Math.min((userProgress.totalSavings / 50) * 100, 100)}%`
                  }
                ]} 
              />
            </View>
            <ThemedText style={styles.progressStatus}>
              Punkte aus Errungenschaften: {userProgress.points} / {userProgress.pointsToNextLevel} Pkte.
            </ThemedText>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View 
                style={[
                  styles.progressFill, 
                  { 
                    backgroundColor: colors.primary,
                    width: `${Math.min((userProgress.points / userProgress.pointsToNextLevel) * 100, 100)}%`
                  }
                ]} 
              />
            </View>
            <ThemedText style={styles.progressNote}>
              Noch {(50 - userProgress.totalSavings).toFixed(2)}€ & {userProgress.pointsToNextLevel - userProgress.points} Punkte zum nächsten Level
            </ThemedText>
          </View>
        </View>

        {/* All Levels Section */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Alle Level</ThemedText>
          
          {levels.map((level) => (
            <View 
              key={level.level} 
              style={[
                styles.levelCard, 
                { 
                  backgroundColor: level.current ? colors.warning + '20' : colors.cardBackground,
                  borderColor: level.current ? colors.warning : colors.border
                }
              ]}
            >
              <View style={styles.levelHeader}>
                <View style={[
                  styles.levelNumber, 
                  { backgroundColor: level.current ? colors.warning : colors.icon }
                ]}>
                  <ThemedText style={styles.levelNumberText}>
                    {getLevelIcon(level.level)}
                  </ThemedText>
                </View>
                <View style={styles.levelInfo}>
                  <ThemedText style={[
                    styles.levelTitle,
                    level.current && { color: colors.warning }
                  ]}>
                    Level {level.level} {level.title}
                  </ThemedText>
                  <ThemedText style={styles.levelDescription}>
                    {level.description}
                  </ThemedText>
                  <View style={[styles.rewardBadge, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <IconSymbol name="star.fill" size={12} color={colors.icon} />
                    <ThemedText style={[styles.rewardText, { fontSize: 12 }]}>
                      {level.reward}
                    </ThemedText>
                  </View>
                </View>
                {level.current && (
                  <View style={styles.currentBadge}>
                    <IconSymbol name="star.fill" size={16} color={colors.warning} />
                  </View>
                )}
                {level.locked && (
                  <IconSymbol name="star.fill" size={24} color={colors.icon} />
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Achievements Section */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Errungenschaften</ThemedText>
          
          {achievements.map((achievement) => (
            <View key={achievement.id} style={[styles.achievementCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.achievementHeader}>
                <View style={[
                  styles.achievementIcon,
                  { backgroundColor: achievement.completed ? colors.success + '20' : colors.border + '20' }
                ]}>
                  <ThemedText style={styles.achievementEmoji}>
                    {achievement.icon}
                  </ThemedText>
                </View>
                <View style={styles.achievementInfo}>
                  <View style={styles.achievementTitleRow}>
                    <ThemedText style={styles.achievementTitle}>
                      {achievement.title}
                    </ThemedText>
                    <View style={[
                      styles.pointsBadge,
                      { backgroundColor: achievement.completed ? colors.success : colors.warning }
                    ]}>
                      <ThemedText style={styles.pointsText}>
                        + {achievement.points} Punkte
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.achievementDescription}>
                    {achievement.description}
                  </ThemedText>
                  
                  {!achievement.completed && achievement.progress !== undefined && (
                    <View style={styles.achievementProgress}>
                      <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                        <View 
                          style={[
                            styles.progressFill, 
                            { 
                              backgroundColor: colors.success,
                              width: `${getProgressPercentage(achievement.progress, achievement.total)}%`
                            }
                          ]} 
                        />
                      </View>
                      <ThemedText style={styles.progressText}>
                        {achievement.progress}/{achievement.total}
                      </ThemedText>
                    </View>
                  )}
                </View>
                {achievement.completed && (
                  <IconSymbol name="star.fill" size={24} color={colors.success} />
                )}
              </View>
            </View>
          ))}
        </View>
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
  progressCard: {
    backgroundColor: '#ff9500',
    margin: 16,
    padding: 20,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressContent: {
    flex: 1,
  },
  progressTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  progressAmount: {
    color: 'white',
    fontSize: 32,
    fontWeight: 'bold',
  },
  progressTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  progressTagText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  currentLevelCard: {
    backgroundColor: '#C17B47',
    margin: 16,
    padding: 20,
    borderRadius: 16,
  },
  currentLevelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 16,
  },
  levelIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelEmoji: {
    fontSize: 24,
  },
  currentLevelInfo: {
    flex: 1,
  },
  currentLevelTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
    color: 'white',
  },
  currentLevelDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  rewardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16,
    gap: 6,
  },
  rewardText: {
    fontSize: 14,
    flex: 1,
  },
  progressSection: {
    gap: 8,
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  progressStatus: {
    fontSize: 14,
    opacity: 0.8,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressNote: {
    fontSize: 12,
    opacity: 0.7,
    fontStyle: 'italic',
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  levelCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  levelNumber: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelNumberText: {
    fontSize: 20,
  },
  levelInfo: {
    flex: 1,
  },
  levelTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  levelDescription: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 8,
  },
  currentBadge: {
    padding: 4,
  },
  achievementCard: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  achievementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  achievementIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  achievementEmoji: {
    fontSize: 24,
  },
  achievementInfo: {
    flex: 1,
  },
  achievementTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  achievementTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  pointsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pointsText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  achievementDescription: {
    fontSize: 14,
    opacity: 0.8,
    marginBottom: 12,
  },
  achievementProgress: {
    gap: 8,
  },
  progressText: {
    fontSize: 12,
    textAlign: 'right',
    opacity: 0.7,
  },
});
