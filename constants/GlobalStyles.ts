import { StyleSheet } from 'react-native';

// Export für einfache Verwendung
export const FontFamilies = {
  regular: 'Nunito_400Regular',
  medium: 'Nunito_500Medium',
  semiBold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
} as const;

// Globale Basis-Styles für konsistente Schriftarten
export const GlobalFontStyles = StyleSheet.create({
  // Basis-Textstile mit Nunito
  baseText: {
    fontFamily: FontFamilies.regular,
  },
  
  boldText: {
    fontFamily: FontFamilies.bold,
  },
  
  semiBoldText: {
    fontFamily: FontFamilies.semiBold,
  },
  
  mediumText: {
    fontFamily: FontFamilies.medium,
  },
  
  // TextInput Basis-Style
  baseInput: {
    fontFamily: FontFamilies.regular,
    fontSize: 16,
  },
  
  // Navigation Header Style
  headerTitle: {
    fontFamily: FontFamilies.semiBold,
    fontSize: 17,
  },
  
  // Häufig verwendete Kombinationen preloaden
  title: {
    fontFamily: FontFamilies.bold,
    fontSize: 24,
  },
  
  subtitle: {
    fontFamily: FontFamilies.semiBold,
    fontSize: 18,
  },
  
  body: {
    fontFamily: FontFamilies.regular,
    fontSize: 16,
  },
  
  caption: {
    fontFamily: FontFamilies.regular,
    fontSize: 12,
  },
});
