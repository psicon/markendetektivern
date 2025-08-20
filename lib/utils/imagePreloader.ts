import { Asset } from 'expo-asset';
import { Image } from 'react-native';

// Preload critical images to improve loading performance
export const preloadImages = async () => {
  try {
    // Preload the main background image
    const tableImage = Asset.fromModule(require('@/assets/images/table-optimized.jpg'));
    
    // Start preloading
    await tableImage.downloadAsync();
    
    // Also preload with React Native Image for immediate availability
    Image.prefetch(Image.resolveAssetSource(require('@/assets/images/table-optimized.jpg')).uri);
    
    console.log('✅ Images preloaded successfully');
  } catch (error) {
    console.log('⚠️ Image preloading failed:', error);
  }
};

// Function to check if an image is already cached
export const isImageCached = async (imageSource: any) => {
  try {
    const asset = Asset.fromModule(imageSource);
    return asset.downloaded;
  } catch {
    return false;
  }
};
