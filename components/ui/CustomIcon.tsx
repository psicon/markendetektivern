import { Text, TextProps } from 'react-native';

export interface CustomIconProps extends Omit<TextProps, 'children'> {
  name: 'iconBlack' | 'premium' | 'cart' | 'search' | 'user' | 'home';
  size?: number;
  color?: string;
}

// Korrekte Unicode-Zeichen aus der SVG-Datei
const ICON_MAP = {
  iconBlack: '\ue900',    // &#xe900; aus SVG glyph-name="icon_black"  
  premium: '\ue901',      // &#xe901; aus SVG glyph-name="premium"
  cart: '\ue900',         // Fallback auf iconBlack
  search: '\ue900',       // Fallback auf iconBlack
  home: '\ue900',         // Fallback auf iconBlack
};

export function CustomIcon({ 
  name, 
  size = 24, 
  color = '#000', 
  style, 
  ...props 
}: CustomIconProps) {
  const iconCharacter = ICON_MAP[name];
  
  return (
    <Text
      {...props}
      style={[
        {
          fontFamily: 'MDAppIcons',  // Verwende Ihre Font
          fontSize: size,
          color,
          textAlign: 'center',
          lineHeight: size, // Exakte Größe ohne extra Spacing
          padding: 0,       // Keine Paddings
          margin: 0,        // Keine Margins
          includeFontPadding: false, // Android: Entfernt Font-Padding
        },
        style,
      ]}
    >
      {iconCharacter}
    </Text>
  );
}
