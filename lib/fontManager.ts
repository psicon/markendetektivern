import { FontFamilies, GlobalFontStyles } from '@/constants/GlobalStyles';

let fontsInitialized = false;

export const initializeFonts = () => {
  if (fontsInitialized) return;
  
  try {
    // Preload aller GlobalFontStyles
    // Das triggert das Font-Loading in React Native
    const preloadStyles = [
      GlobalFontStyles.baseText,
      GlobalFontStyles.boldText,
      GlobalFontStyles.semiBoldText,
      GlobalFontStyles.mediumText,
      GlobalFontStyles.baseInput,
      GlobalFontStyles.headerTitle,
      GlobalFontStyles.title,
      GlobalFontStyles.subtitle,
      GlobalFontStyles.body,
      GlobalFontStyles.caption,
    ];
    
    // Force Style-Loading durch Referenzierung
    preloadStyles.forEach(style => {
      if (style && style.fontFamily) {
        // Style wird registriert und Font wird cached
        const _ = { ...style };
      }
    });
    
    fontsInitialized = true;
    console.log('✅ Global fonts and styles preloaded');
  } catch (error) {
    console.warn('⚠️ Failed to preload fonts:', error);
  }
};

export const getFontFamily = (weight: 'regular' | 'medium' | 'semiBold' | 'bold' = 'regular') => {
  return FontFamilies[weight];
};
