import { Asset } from 'expo-asset';
import { Image } from 'react-native';

// Preload critical images to improve loading performance
export const preloadImages = async () => {
  try {
    // Kritische Vollbild-Hintergruende, die DIREKT nach dem Boot-Screen
    // gerendert werden: background.jpg = Onboarding-Hero + alle 5
    // Auth-Screens; table-optimized.jpg = Home-Hintergrund.
    // ClickUp 86cacp9ku (1.1): background.jpg war NICHT vorgewaermt →
    // beim Handoff Boot → Onboarding/Auth fehlte das Bild fuer 1 Frame
    // ("Hintergrundbild fehlt", intermittierend). preloadImages() wird
    // vom FontLoader ge-awaitet, bevor die Children freigegeben werden,
    // d.h. beide Assets sind dann garantiert dekodiert.
    const modules = [
      require('@/assets/images/table-optimized.jpg'),
      require('@/assets/images/background.jpg'),
    ];

    // In den Asset-Cache dekodieren …
    await Promise.all(modules.map((m) => Asset.fromModule(m).downloadAsync()));

    // … und zusaetzlich via RN-Image vorhalten (sofort verfuegbar).
    modules.forEach((m) => {
      const src = Image.resolveAssetSource(m);
      if (src?.uri) Image.prefetch(src.uri);
    });

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
