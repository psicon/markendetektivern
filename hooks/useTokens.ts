/**
 * Theme-aware token accessor. Returns the active token set based on the
 * current color scheme. Use this in screens/components to access theme
 * tokens (`tokens.theme.bg`, `tokens.shadows.md`, etc.) without having
 * to branch on light/dark.
 *
 * Brand tokens (`tokens.brand`) and scale tokens (spacing/radii/type)
 * don't theme-swap — they're the same object regardless of scheme.
 */

import { useMemo } from 'react';
import {
  brand,
  easing,
  motion,
  radii,
  shadowsDark,
  shadowsLight,
  spacing,
  stufen,
  stufenLabels,
  themeDark,
  themeLight,
  typeScale,
} from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';

export function useTokens() {
  const scheme = useColorScheme() ?? 'light';
  const isDark = scheme === 'dark';

  return useMemo(
    () => ({
      scheme,
      isDark,
      brand,
      theme: isDark ? themeDark : themeLight,
      shadows: isDark ? shadowsDark : shadowsLight,
      type: typeScale,
      spacing,
      radii,
      motion,
      easing,
      stufen,
      stufenLabels,
    }),
    [scheme, isDark],
  );
}

export type Tokens = ReturnType<typeof useTokens>;
