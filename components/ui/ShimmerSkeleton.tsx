import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, View, ViewStyle } from 'react-native';

interface ShimmerSkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
  children?: React.ReactNode;
}

export function ShimmerSkeleton({ 
  width = '100%', 
  height = 20, 
  borderRadius = 8,
  style,
  children 
}: ShimmerSkeletonProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const shimmerAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(animatedValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );

    shimmerAnimation.start();

    return () => shimmerAnimation.stop();
  }, [animatedValue]);

  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 100],
  });

  const shimmerColors = colorScheme === 'dark' 
    ? ['#2a2a2a', '#3a3a3a', '#2a2a2a']
    : ['#f0f0f0', '#e0e0e0', '#f0f0f0'];

  return (
    <View 
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.cardBackground,
          overflow: 'hidden',
        },
        style
      ]}
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          transform: [{ translateX }],
        }}
      >
        <LinearGradient
          colors={shimmerColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            flex: 1,
            width: '200%',
          }}
        />
      </Animated.View>
      {children}
    </View>
  );
}

// Vorgefertigte Skeleton-Komponenten
export function CategorySkeleton() {
  return (
    <View style={{ marginLeft: 12, marginRight: 3, alignItems: 'center' }}>
      <ShimmerSkeleton 
        width={60} 
        height={60} 
        borderRadius={30}
        style={{ marginBottom: 8 }}
      />
      <ShimmerSkeleton 
        width={50} 
        height={12} 
        borderRadius={6}
      />
    </View>
  );
}

export function ProductCardSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  return (
    <View style={{
      width: 170,
      backgroundColor: colors.cardBackground,
      borderRadius: 16,
      marginLeft: 12,
      marginRight: 3,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.09,
      shadowRadius: 2,
      elevation: 2,
      overflow: 'hidden',
    }}>
      {/* Produktbild */}
      <ShimmerSkeleton 
        width="100%" 
        height={120} 
        borderRadius={0}
        style={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      />
      
      {/* Content Bereich */}
      <View style={{ padding: 11, paddingTop: 8 }}>
        {/* Handelsmarke */}
        <ShimmerSkeleton 
          width="60%" 
          height={10} 
          borderRadius={5}
          style={{ marginBottom: 6 }}
        />
        
        {/* Produktname */}
        <ShimmerSkeleton 
          width="90%" 
          height={14} 
          borderRadius={7}
          style={{ marginBottom: 4 }}
        />
        <ShimmerSkeleton 
          width="70%" 
          height={14} 
          borderRadius={7}
          style={{ marginBottom: 8 }}
        />
        
        {/* Preis und Marke */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <ShimmerSkeleton 
            width="40%" 
            height={12} 
            borderRadius={6}
          />
          <ShimmerSkeleton 
            width="30%" 
            height={14} 
            borderRadius={7}
          />
        </View>
      </View>
    </View>
  );
}

export function NewsCardSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  return (
    <View style={{
      width: 280,
      backgroundColor: colors.cardBackground,
      borderRadius: 16,
      marginLeft: 12,
      marginRight: 3,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.09,
      shadowRadius: 2,
      elevation: 2,
      overflow: 'hidden',
    }}>
      {/* Featured Image */}
      <ShimmerSkeleton 
        width="100%" 
        height={140} 
        borderRadius={0}
        style={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      />
      
      {/* Content */}
      <View style={{ padding: 16 }}>
        {/* Datum */}
        <ShimmerSkeleton 
          width="30%" 
          height={10} 
          borderRadius={5}
          style={{ marginBottom: 8 }}
        />
        
        {/* Titel */}
        <ShimmerSkeleton 
          width="100%" 
          height={16} 
          borderRadius={8}
          style={{ marginBottom: 4 }}
        />
        <ShimmerSkeleton 
          width="80%" 
          height={16} 
          borderRadius={8}
          style={{ marginBottom: 12 }}
        />
        
        {/* Excerpt */}
        <ShimmerSkeleton 
          width="100%" 
          height={12} 
          borderRadius={6}
          style={{ marginBottom: 3 }}
        />
        <ShimmerSkeleton 
          width="90%" 
          height={12} 
          borderRadius={6}
          style={{ marginBottom: 3 }}
        />
        <ShimmerSkeleton 
          width="60%" 
          height={12} 
          borderRadius={6}
          style={{ marginBottom: 12 }}
        />
        
        {/* Button */}
        <ShimmerSkeleton 
          width="40%" 
          height={14} 
          borderRadius={7}
        />
      </View>
    </View>
  );
}

// Skeleton für Explore-Seite (Märkte/Kategorien/Marken Listen)
export function ListItemSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 16,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    }}>
      {/* Logo/Icon */}
      <ShimmerSkeleton 
        width={60} 
        height={60} 
        borderRadius={12}
        style={{ marginRight: 16 }}
      />
      
      {/* Content */}
      <View style={{ flex: 1 }}>
        <ShimmerSkeleton 
          width="80%" 
          height={16} 
          borderRadius={8}
          style={{ marginBottom: 4 }}
        />
        <ShimmerSkeleton 
          width="60%" 
          height={12} 
          borderRadius={6}
          style={{ marginBottom: 8 }}
        />
        <ShimmerSkeleton 
          width="90%" 
          height={12} 
          borderRadius={6}
        />
      </View>
      
      {/* Chevron */}
      <ShimmerSkeleton 
        width={16} 
        height={16} 
        borderRadius={8}
      />
    </View>
  );
}

// Skeleton für Produktvergleich-Seite
export function ProductComparisonSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  return (
    <View style={{
      backgroundColor: colors.cardBackground,
      borderRadius: 16,
      padding: 16,
      marginHorizontal: 16,
      marginBottom: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.09,
      shadowRadius: 2,
      elevation: 2,
    }}>
      {/* Chips Row */}
      <View style={{ flexDirection: 'row', marginBottom: 16, gap: 8 }}>
        <ShimmerSkeleton width={100} height={28} borderRadius={14} />
        <ShimmerSkeleton width={80} height={28} borderRadius={14} />
      </View>

      {/* Product Row */}
      <View style={{ flexDirection: 'row', marginBottom: 16 }}>
        {/* Product Image */}
        <ShimmerSkeleton 
          width={80} 
          height={80} 
          borderRadius={12}
          style={{ marginRight: 16 }}
        />
        
        {/* Product Info */}
        <View style={{ flex: 1 }}>
          <ShimmerSkeleton 
            width="70%" 
            height={16} 
            borderRadius={8}
            style={{ marginBottom: 8 }}
          />
          <ShimmerSkeleton 
            width="90%" 
            height={20} 
            borderRadius={10}
            style={{ marginBottom: 12 }}
          />
          
          {/* Rating Row */}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <ShimmerSkeleton width={40} height={16} borderRadius={8} />
            <ShimmerSkeleton width={100} height={16} borderRadius={8} />
            <ShimmerSkeleton width={50} height={16} borderRadius={8} />
          </View>
        </View>
        
        {/* Price Section */}
        <View style={{ alignItems: 'flex-end', minWidth: 80 }}>
          <ShimmerSkeleton 
            width="100%" 
            height={24} 
            borderRadius={12}
            style={{ marginBottom: 4 }}
          />
          <ShimmerSkeleton 
            width="80%" 
            height={16} 
            borderRadius={8}
          />
        </View>
      </View>

      {/* Action Buttons */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <ShimmerSkeleton 
          width="75%" 
          height={44} 
          borderRadius={12}
        />
        <ShimmerSkeleton 
          width={44} 
          height={44} 
          borderRadius={12}
        />
      </View>
    </View>
  );
}

// Skeleton für Loading Footer (Infinite Scroll)
export function LoadingFooterSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 20,
      gap: 12,
    }}>
      <ShimmerSkeleton 
        width={40} 
        height={40} 
        borderRadius={20}
      />
      <ShimmerSkeleton 
        width={150} 
        height={16} 
        borderRadius={8}
      />
    </View>
  );
}

// Skeleton für Rating/Comment Sections
export function RatingOverviewSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      {/* Overall Rating Section */}
      <View style={{
        backgroundColor: colors.cardBackground,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        alignItems: 'center',
      }}>
        {/* Big Rating Circle */}
        <ShimmerSkeleton 
          width={80} 
          height={80} 
          borderRadius={40}
          style={{ marginBottom: 12 }}
        />
        
        {/* Rating Text */}
        <ShimmerSkeleton 
          width={180} 
          height={16} 
          borderRadius={8}
          style={{ marginBottom: 8 }}
        />
        
        {/* Stars */}
        <View style={{ flexDirection: 'row', gap: 4, marginBottom: 8 }}>
          {[1,2,3,4,5].map((i) => (
            <ShimmerSkeleton key={i} width={20} height={20} borderRadius={10} />
          ))}
        </View>
        
        {/* Count */}
        <ShimmerSkeleton 
          width={120} 
          height={14} 
          borderRadius={7}
        />
      </View>

      {/* Criteria Ratings */}
      <View style={{
        backgroundColor: colors.cardBackground,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
      }}>
        {/* Header */}
        <ShimmerSkeleton 
          width={160} 
          height={18} 
          borderRadius={9}
          style={{ marginBottom: 16 }}
        />
        
        {/* 4 Criteria Rows */}
        {[1,2,3,4].map((i) => (
          <View key={i} style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: i === 4 ? 0 : 12,
          }}>
            <ShimmerSkeleton 
              width={120} 
              height={16} 
              borderRadius={8}
            />
            
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ShimmerSkeleton width={30} height={14} borderRadius={7} />
              <View style={{ flexDirection: 'row', gap: 2 }}>
                {[1,2,3,4,5].map((star) => (
                  <ShimmerSkeleton key={star} width={14} height={14} borderRadius={7} />
                ))}
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function CommentSkeleton() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  return (
    <View style={{
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    }}>
      {/* Header with avatar + user info */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
      }}>
        {/* Avatar */}
        <ShimmerSkeleton 
          width={40} 
          height={40} 
          borderRadius={20}
          style={{ marginRight: 12 }}
        />
        
        {/* User Info */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ShimmerSkeleton width={80} height={16} borderRadius={8} />
            <ShimmerSkeleton width={60} height={18} borderRadius={9} />
          </View>
          <ShimmerSkeleton 
            width={100} 
            height={12} 
            borderRadius={6}
            style={{ marginTop: 4 }}
          />
        </View>
      </View>
      
      {/* Rating Stars */}
      <View style={{
        flexDirection: 'row', 
        alignItems: 'center', 
        gap: 4,
        marginBottom: 12,
      }}>
        {[1,2,3,4,5].map((i) => (
          <ShimmerSkeleton key={i} width={16} height={16} borderRadius={8} />
        ))}
      </View>
      
      {/* Comment Text */}
      <ShimmerSkeleton 
        width="100%" 
        height={14} 
        borderRadius={7}
        style={{ marginBottom: 4 }}
      />
      <ShimmerSkeleton 
        width="85%" 
        height={14} 
        borderRadius={7}
        style={{ marginBottom: 4 }}
      />
      <ShimmerSkeleton 
        width="60%" 
        height={14} 
        borderRadius={7}
      />
    </View>
  );
}

export function CommentsHeaderSkeleton() {
  return (
    <View style={{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 8,
      marginBottom: 8,
    }}>
      <ShimmerSkeleton width={120} height={18} borderRadius={9} />
      <ShimmerSkeleton width={24} height={20} borderRadius={10} />
    </View>
  );
}
