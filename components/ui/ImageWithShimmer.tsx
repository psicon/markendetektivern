import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import React, { useState } from 'react';
import { Animated, ImageStyle, StyleSheet, View, ViewStyle } from 'react-native';
import { IconSymbol } from './IconSymbol';
import { ShimmerSkeleton } from './ShimmerSkeleton';

interface ImageWithShimmerProps {
  source: { uri: string } | number;
  style?: ImageStyle;
  containerStyle?: ViewStyle;
  shimmerStyle?: ViewStyle;
  fallbackIcon?: string;
  fallbackIconSize?: number;
  onError?: () => void;
  onLoad?: () => void;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
}

export const ImageWithShimmer: React.FC<ImageWithShimmerProps> = ({
  source,
  style,
  containerStyle,
  shimmerStyle,
  fallbackIcon = 'photo',
  fallbackIconSize = 24,
  onError,
  onLoad,
  resizeMode = 'cover',
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));

  const handleLoad = () => {
    setLoading(false);
    // Sanftes Einblenden
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
    onLoad?.();
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
    onError?.();
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {/* Shimmer Loader - exakt gleiche Position wie Bild */}
      {loading && (
        <ShimmerSkeleton style={[style, styles.absolutePosition]} />
      )}
      
      {/* Fallback Icon bei Fehler */}
      {error && (
        <View style={[styles.fallbackContainer, style, { backgroundColor: colors.cardBackground }]}>
          <IconSymbol 
            name={fallbackIcon} 
            size={fallbackIconSize} 
            color={colors.icon} 
          />
        </View>
      )}
      
      {/* Actual Image */}
      {!error && (
        <Animated.Image
          source={source}
          style={[
            style,
            {
              opacity: fadeAnim,
            }
          ]}
          onLoad={handleLoad}
          onError={handleError}
          resizeMode={resizeMode}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  absolutePosition: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  fallbackContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
});
