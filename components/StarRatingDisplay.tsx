import { ThemedText } from '@/components/ThemedText';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface StarRatingDisplayProps {
  rating: number;
  maxRating?: number;
  size?: number;
  colors: {
    warning: string;
    border: string;
  };
  showValue?: boolean;
  valueStyle?: any;
}

export const StarRatingDisplay: React.FC<StarRatingDisplayProps> = ({
  rating,
  maxRating = 5,
  size = 14,
  colors,
  showValue = true,
  valueStyle
}) => {
  const renderStar = (index: number) => {
    const starNumber = index + 1;
    const fillPercentage = Math.min(Math.max(rating - index, 0), 1);
    
    return (
      <View key={index} style={[styles.starContainer, { width: size, height: size }]}>
        {/* Background (empty) star */}
        <Text style={[styles.star, { fontSize: size, color: colors.border }]}>
          ★
        </Text>
        
        {/* Foreground (filled) star - clipped by width */}
        <View 
          style={[
            styles.filledStarContainer, 
            { 
              width: `${fillPercentage * 100}%`,
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              overflow: 'hidden'
            }
          ]}
        >
          <Text style={[styles.star, { fontSize: size, color: colors.warning }]}>
            ★
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {showValue && (
        <ThemedText style={[styles.valueText, valueStyle]}>
          {rating.toFixed(1)}
        </ThemedText>
      )}
      <View style={styles.starsContainer}>
        {Array.from({ length: maxRating }, (_, index) => renderStar(index))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 16,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 1,
    alignItems: 'center',
    height: 16,
  },
  starContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    height: 16,
  },
  filledStarContainer: {
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  star: {
    textAlign: 'center',
    includeFontPadding: false,
  },
  valueText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'left',
    lineHeight: 16,
    includeFontPadding: false,
    height: 16,
  },
});
