import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Dimensions,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { IconSymbol } from './IconSymbol';
import { ImageWithShimmer } from './ImageWithShimmer';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LockedCategoryModalProps {
  visible: boolean;
  categoryName: string;
  categoryImage?: string;
  requiredLevel: number;
  currentLevel: number;
  onClose: () => void;
  onNavigateToLevels: () => void;
}

export const LockedCategoryModal: React.FC<LockedCategoryModalProps> = ({
  visible,
  categoryName,
  categoryImage,
  requiredLevel,
  currentLevel,
  onClose,
  onNavigateToLevels,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const levelsToGo = requiredLevel - currentLevel;
  
  // Shimmer Animation für Premium-Button
  const shimmerAnimatedValue = useRef(new Animated.Value(0)).current;
  
  useEffect(() => {
    const shimmerAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnimatedValue, {
          toValue: 1,
          duration: 2100,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnimatedValue, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    
    shimmerAnimation.start();
    
    return () => shimmerAnimation.stop();
  }, [shimmerAnimatedValue]);
  
  const shimmerTranslateX = shimmerAnimatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 400], // Shimmer bewegt sich über den Button
  });
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <TouchableOpacity 
          style={styles.backdrop} 
          activeOpacity={1}
          onPress={onClose}
        />
        
        <Animated.View style={[
          styles.contentCard,
          { backgroundColor: colors.cardBackground }
        ]}>
          {/* Close Button */}
          <TouchableOpacity 
            style={styles.closeButton}
            onPress={onClose}
          >
            <IconSymbol name="xmark" size={20} color={colors.icon} />
          </TouchableOpacity>
          
          {/* Lock Animation */}
          <View style={styles.lockContainer}>
            <LottieView
              source={require('@/assets/lottie/lock.json')}
              autoPlay
              loop={false}
              style={styles.lockAnimation}
            />
          </View>
          
          {/* Category Info */}
          <View style={styles.categoryInfoContainer}>
            {categoryImage ? (
              <ImageWithShimmer
                source={{ uri: categoryImage }}
                style={styles.categoryImage}
                fallbackIcon="square.grid.2x2"
                fallbackIconSize={40}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.categoryImagePlaceholder, { backgroundColor: colors.border }]}>
                <IconSymbol name="square.grid.2x2" size={40} color={colors.icon} />
              </View>
            )}
            
            <Text style={[styles.categoryName, { color: colors.text }]}>
              {categoryName}
            </Text>
          </View>
          
          {/* Lock Message */}
          <Text style={[styles.lockTitle, { color: colors.text }]}>
            Noch nicht freigeschaltet
          </Text>
          
          <Text style={[styles.lockMessage, { color: colors.icon }]}>
            Diese Kategorie wird bei{' '}
            <Text style={{ fontFamily: 'Nunito_700Bold', color: colors.primary }}>
              Level {requiredLevel}
            </Text>{' '}
            freigeschaltet.
          </Text>
          
          {/* Progress Info */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <LinearGradient
                colors={['#4CAF50', '#66BB6A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.progressFill,
                  { width: `${(currentLevel / requiredLevel) * 100}%` }
                ]}
              />
            </View>
            
            <Text style={[styles.progressText, { color: colors.icon }]}>
              Du bist auf Level {currentLevel} 
            </Text>
          </View>
          
          {/* Motivational Message */}
          <View style={[styles.motivationBox, { backgroundColor: colors.primary + '15' }]}>
            <IconSymbol name="sparkles" size={20} color={colors.primary} />
            <Text style={[styles.motivationText, { color: colors.text }]}>
              Sammle Punkte durch Stöbern, Vergleichen und Einkaufen!
            </Text>
          </View>
          
          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity 
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={onNavigateToLevels}
            >
              <Text style={styles.primaryButtonText}>

 
                Level & Errungenschaften
              </Text>
            </TouchableOpacity>
            
            {/* Premium Button */}
            <TouchableOpacity 
              style={styles.premiumButtonContainer}
              onPress={() => {
                // TODO: Premium-Funktionalität implementieren
                console.log('Premium-Freischaltung für Kategorie:', categoryName);
                onClose(); // Temporär - später durch Premium-Flow ersetzen
              }}
            >
              <LinearGradient
                colors={['#FFD700', '#FFA000']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.premiumButton}
              >
                <View style={styles.premiumButtonContent}>
                  <IconSymbol name="crown.fill" size={18} color="#8B4513" />
                  <Text style={styles.premiumButtonText}>
                    Jetzt sofort freischalten
                  </Text>
                </View>
                
                {/* Shimmer Overlay */}
                <Animated.View 
                  style={[
                    styles.shimmerOverlay,
                    {
                      transform: [{ translateX: shimmerTranslateX }],
                    }
                  ]}
                >
                  <LinearGradient
                    colors={['transparent', 'rgba(221, 238, 70, 0.12)', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.shimmerGradient}
                  />
                </Animated.View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
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
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  contentCard: {
    width: SCREEN_WIDTH * 0.9,
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  lockContainer: {
    width: 80,
    height: 80,
    marginBottom: 20,
  },
  lockAnimation: {
    width: '100%',
    height: '100%',
  },
  categoryInfoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  categoryImage: {
    width: 80,
    height: 80,
    borderRadius: 16,
    marginBottom: 12,
  },
  categoryImagePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 16,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: {
    fontSize: 22,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
  },
  lockTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 8,
  },
  lockMessage: {
    fontSize: 16,
    fontFamily: 'Nunito',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 20,
  },
  progressBar: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 14,
    fontFamily: 'Nunito',
    textAlign: 'center',
  },
  motivationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 24,
    gap: 8,
  },
  motivationText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
  },
  // Premium Button Styles
  premiumButtonContainer: {
    borderRadius: 12,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  premiumButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 215, 0, 0.3)',
    overflow: 'hidden', // Wichtig für Shimmer-Effekt
    position: 'relative',
  },
  premiumButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  premiumButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.text,
    textAlign: 'center',
    flex: 1,
    lineHeight: 18,
    textShadowColor: 'rgba(255,255,255,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    
  },
  // Shimmer Effect Styles
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
    width: 100,
  },
});
