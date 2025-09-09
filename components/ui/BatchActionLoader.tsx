import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    Modal,
    StyleSheet,
    Text,
    View
} from 'react-native';
import { IconSymbol } from './IconSymbol';

const { width } = Dimensions.get('window');

export interface BatchActionLoaderProps {
  visible: boolean;
  title: string;
  subtitle: string;
  icon: any;
  gradient: string[];
  progress?: number; // 0-1 für Progress Bar
  currentItem?: string; // Aktuell verarbeitetes Item
  totalItems?: number;
  processedItems?: number;
}

const BatchActionLoader: React.FC<BatchActionLoaderProps> = ({
  visible,
  title,
  subtitle,
  icon,
  gradient,
  progress,
  currentItem,
  totalItems,
  processedItems
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const scaleValue = React.useRef(new Animated.Value(0.8)).current;
  const progressValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (visible) {
      // Start scale animation when visible
      Animated.spring(scaleValue, {
        toValue: 1,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();
    } else {
      // Reset animations when hidden
      scaleValue.setValue(0.8);
      progressValue.setValue(0);
    }
  }, [visible]);

  React.useEffect(() => {
    if (progress !== undefined) {
      Animated.timing(progressValue, {
        toValue: progress,
        duration: 300,
        useNativeDriver: false,
      }).start();
    }
  }, [progress]);

  const progressWidth = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View 
          style={[
            styles.container,
            { 
              backgroundColor: colors.cardBackground,
              transform: [{ scale: scaleValue }]
            }
          ]}
        >
          {/* Header mit Gradient */}
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <IconSymbol name={icon} size={32} color="white" />
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </LinearGradient>

          {/* Content */}
          <View style={styles.content}>
            {/* Progress Info */}
            {totalItems && processedItems !== undefined && (
              <View style={styles.progressInfo}>
                <Text style={[styles.progressText, { color: colors.text }]}>
                  {processedItems} von {totalItems} Produkten
                </Text>
                {currentItem && (
                  <Text style={[styles.currentItemText, { color: colors.text + '80' }]} numberOfLines={1}>
                    {currentItem}
                  </Text>
                )}
              </View>
            )}

            {/* Progress Bar */}
            {progress !== undefined && (
              <View style={[styles.progressBarContainer, { backgroundColor: colors.border }]}>
                <Animated.View 
                  style={[
                    styles.progressBar,
                    { 
                      backgroundColor: gradient[0],
                      width: progressWidth
                    }
                  ]} 
                />
              </View>
            )}

            {/* Loading Spinner */}
            <View style={styles.spinnerContainer}>
              <ActivityIndicator size="large" color={gradient[0]} />
              <Text style={[styles.loadingText, { color: colors.text + '80' }]}>
                Bitte warten...
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  container: {
    width: width - 64,
    maxWidth: 320,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
  },
  content: {
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  progressInfo: {
    alignItems: 'center',
    marginBottom: 16,
  },
  progressText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
  },
  currentItemText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },
  progressBarContainer: {
    height: 6,
    borderRadius: 3,
    marginBottom: 20,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  spinnerContainer: {
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
  },
});

export default BatchActionLoader;
