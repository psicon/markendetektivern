import { IconSymbol } from '@/components/ui/IconSymbol';
import { ShimmerSkeleton } from '@/components/ui/ShimmerSkeleton';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import achievementService from '@/lib/services/achievementService';
import { Level } from '@/lib/types/achievements';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

interface LevelBadgeProps {
  level: number;
  size?: 'small' | 'medium' | 'large';
  showDescription?: boolean;
  showProgress?: boolean;
  currentSavings?: number;
  currentPoints?: number;
  style?: ViewStyle;
}

export function LevelBadge({ 
  level, 
  size = 'medium', 
  showDescription = true,
  showProgress = false,
  currentSavings = 0,
  currentPoints = 0,
  style 
}: LevelBadgeProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Größen-Konfiguration
  const sizes = {
    small: { icon: 20, fontSize: 12, padding: 8, height: 50 },
    medium: { icon: 24, fontSize: 14, padding: 12, height: 70 },
    large: { icon: 30, fontSize: 16, padding: 16, height: 90 }
  };
  
  const currentSize = sizes[size];
  
  useEffect(() => {
    // Lade Levels aus achievementService
    const loadLevels = async () => {
      try {
        const loadedLevels = await achievementService.getAllLevels();
        
        // 🔍 DEBUG: Level-Daten in LevelBadge
        console.log('🔍 LEVEL BADGE: Levels geladen:', loadedLevels.map(l => ({
          id: l.id,
          name: l.name,
          pointsRequired: l.pointsRequired,
          savingsRequired: l.savingsRequired
        })));
        
        setLevels(loadedLevels);
      } catch (error) {
        console.error('Fehler beim Laden der Levels:', error);
      } finally {
        setLoading(false);
      }
    };
    loadLevels();
  }, []);
  
  if (loading || levels.length === 0) {
    return (
      <View style={[styles.container, { minHeight: currentSize.height, padding: currentSize.padding }, style]}>
        {/* Shimmer für Level Badge */}
        <View style={styles.shimmerContainer}>
          <ShimmerSkeleton 
            width={currentSize.height} 
            height={currentSize.height * 0.6} 
            borderRadius={8}
          />
          {showDescription && (
            <View style={styles.shimmerTextContainer}>
              <ShimmerSkeleton 
                width={80} 
                height={currentSize.fontSize} 
                borderRadius={4}
              />
              {showProgress && (
                <View style={styles.shimmerProgressContainer}>
                  <ShimmerSkeleton 
                    width={120} 
                    height={8} 
                    borderRadius={4}
                  />
                  <ShimmerSkeleton 
                    width={60} 
                    height={currentSize.fontSize - 2} 
                    borderRadius={4}
                  />
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    );
  }
  
  const levelInfo = levels.find(l => l.id === level) || levels[0];
  const nextLevel = levels.find(l => l.id === level + 1);
  
  // Level-spezifische Farben für Gradient (aus levelInfo für Konsistenz)
  const getLevelGradient = () => {
    const baseColor = levelInfo.color;
    // Erstelle einen Gradient mit einer dunkleren Version der Farbe
    switch(level) {
      case 1: return [baseColor, '#9E6B50']; // Braun
      case 2: return [baseColor, '#FF9800']; // Orange
      case 3: return [baseColor, '#4CAF50']; // Grün
      case 4: return [baseColor, '#FFC107']; // Gold
      case 5: return [baseColor, '#FF5252']; // Rot
      default: return [baseColor, '#9E6B50'];
    }
  };
  
  // Fortschritt zum nächsten Level berechnen
  const calculateProgress = () => {
    if (!nextLevel) return 100;
    
    // 🔍 DEBUG: Welches Level wird als nextLevel verwendet?
    console.log('🔍 LEVEL BADGE DEBUG:', {
      currentLevel: level,
      nextLevelId: nextLevel.id,
      nextLevelName: nextLevel.name,
      nextLevelPointsRequired: nextLevel.pointsRequired,
      nextLevelSavingsRequired: nextLevel.savingsRequired,
      currentPoints,
      currentSavings
    });
    
    const pointsProgress = (currentPoints / nextLevel.pointsRequired) * 100;
    
    // Wenn keine Ersparnis erforderlich, nur Punkte-Progress verwenden
    if (nextLevel.savingsRequired === 0) {
      return Math.min(pointsProgress, 100);
    }
    
    const savingsProgress = (currentSavings / nextLevel.savingsRequired) * 100;
    return Math.min(savingsProgress, pointsProgress, 100);
  };
  
  return (
    <LinearGradient
      colors={getLevelGradient()}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.container, { minHeight: currentSize.height, padding: currentSize.padding }, style]}
    >
      <View style={styles.content}>
        <View style={[styles.iconContainer, { width: currentSize.icon + 16, height: currentSize.icon + 16 }]}>
          <IconSymbol 
            name={levelInfo.icon as any} 
            size={currentSize.icon} 
            color="white" 
          />
        </View>
        
        <View style={styles.textContainer}>
          <Text style={[styles.levelText, { fontSize: currentSize.fontSize }]}>
            Level {level}
          </Text>
          <Text style={[styles.levelName, { fontSize: currentSize.fontSize + 2 }]}>
            {levelInfo.name}
          </Text>
          {showDescription && (
            <Text style={[styles.levelDescription, { fontSize: currentSize.fontSize - 2 }]}>
              {levelInfo.description}
            </Text>
          )}
        </View>
        
        {level === 5 && (
          <View style={styles.starBadge}>
            <IconSymbol name="star.fill" size={16} color="#FFD700" />
          </View>
        )}
      </View>
      
      {showProgress && nextLevel && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill, 
                { width: `${calculateProgress()}%` }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>
            {nextLevel.savingsRequired > 0 ? (
              `${currentSavings.toFixed(2)} € / ${nextLevel.savingsRequired} € • ${currentPoints} / ${nextLevel.pointsRequired} Pkt.`
            ) : (
              `${currentPoints} / ${nextLevel.pointsRequired} Punkte`
            )}
          </Text>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  levelText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: 'Nunito_400Regular',
  },
  levelName: {
    color: 'white',
    fontFamily: 'Nunito_700Bold',
    marginBottom: 2,
  },
  levelDescription: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontFamily: 'Nunito_400Regular',
  },
  starBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 4,
  },
  progressContainer: {
    marginTop: 12,
  },
  progressBar: {
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 3,
  },
  progressText: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontFamily: 'Nunito_400Regular',
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  // Shimmer Loading Styles
  shimmerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shimmerTextContainer: {
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  shimmerProgressContainer: {
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
});
