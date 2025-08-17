import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import WordPressService, { WordPressPost } from '@/lib/services/wordpress';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface NewsCardProps {
  post: WordPressPost;
  onPress: (url: string) => void;
  style?: any;
}

const { width: screenWidth } = Dimensions.get('window');
const cardWidth = screenWidth - 32; // 16px margin on each side

export function NewsCard({ post, onPress, style }: NewsCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [imageError, setImageError] = useState(false);

  const handlePress = () => {
    onPress(post.link);
  };

  const cleanTitle = WordPressService.cleanHtml(post.title.rendered);
  const cleanExcerpt = WordPressService.cleanHtml(post.excerpt.rendered);
  const formattedDate = WordPressService.formatDate(post.date);

  return (
    <TouchableOpacity 
      style={[styles.container, { backgroundColor: colors.cardBackground }, style]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      {/* Featured Image */}
      <View style={styles.imageContainer}>
        {post.featured_image_url && !imageError ? (
          <ImageWithShimmer
            source={{ uri: post.featured_image_url }}
            style={styles.image}
            fallbackIcon="newspaper"
            fallbackIconSize={32}
            resizeMode="cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: colors.border }]}>
            <IconSymbol name="newspaper" size={32} color={colors.icon} />
          </View>
        )}
        
        {/* Gradient Overlay für bessere Textlesbarkeit */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.7)']}
          style={styles.imageOverlay}
        />
        
        {/* Datum Badge */}
        <View style={styles.dateBadge}>
          <Text style={styles.dateText}>{formattedDate}</Text>
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <ThemedText style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {cleanTitle}
        </ThemedText>
        
        {cleanExcerpt && (
          <ThemedText style={[styles.excerpt, { color: colors.icon }]} numberOfLines={3}>
            {cleanExcerpt}
          </ThemedText>
        )}
        
        <View style={styles.footer}>
          <View style={styles.readMore}>
            <ThemedText style={[styles.readMoreText, { color: colors.primary }]}>
              Weiterlesen
            </ThemedText>
            <IconSymbol name="chevron.right" size={16} color={colors.primary} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 16,
  },
  imageContainer: {
    height: 200,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
  },
  dateBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  dateText: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'Nunito_600SemiBold',
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Nunito_700Bold',
    lineHeight: 24,
    marginBottom: 8,
  },
  excerpt: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 20,
    marginBottom: 12,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  readMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  readMoreText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
});

export default NewsCard;
