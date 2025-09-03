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
  style?: ViewStyle;
}

export function LevelBadge({ 
  level, 
  size = 'medium', 
  showDescription = true,
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
        
        {/* Chevron Right - Indicates tappable */}
        <View style={styles.chevronContainer}>
          <IconSymbol name="chevron.right" size={20} color="rgba(255, 255, 255, 0.7)" />
        </View>
        
        {level === 5 && (
          <View style={styles.starBadge}>
            <IconSymbol name="star.fill" size={16} color="#FFD700" />
          </View>
        )}
      </View>

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
  chevronContainer: {
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  starBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 4,
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
});
