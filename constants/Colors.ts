/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

const tintColorLight = '#0d8575';
// Im Dark-Theme das gleiche Brand-Petrol verwenden statt eines
// helleren Mint — konsistente Brand-Farbe in beiden Modi (User-Vorgabe).
const tintColorDark = '#0d8575';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#f5f5f5',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
    primary: '#0d8575',
    secondary: '#42a968',
    success: '#42a968',
    warning: '#ff9500',
    error: '#ff3b30',
    cardBackground: '#ffffff',
    border: '#e1e8ed',
  },
  dark: {
    text: '#FFFFFF',
    background: '#000000',
    tint: tintColorDark,
    icon: '#FFFFFF',
    tabIconDefault: '#FFFFFF',
    tabIconSelected: tintColorDark,
    // Brand-Konsistenz: primary = Petrol in beiden Modi
    primary: '#0d8575',
    secondary: '#42a968',
    success: '#42a968',
    warning: '#ff9500',
    error: '#ff453a',
    cardBackground: '#1c1c1e',
    border: '#38383a',
  },
};
