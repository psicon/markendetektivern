/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

const tintColorLight = '#0d8575';
const tintColorDark = '#42a968';

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
    text: '#ECEDEE',
    background: '#1c1c1e',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    primary: '#42a968',
    secondary: '#0d8575',
    success: '#42a968',
    warning: '#ff9500',
    error: '#ff453a',
    cardBackground: '#2c2c2e',
    border: '#38383a',
  },
};
