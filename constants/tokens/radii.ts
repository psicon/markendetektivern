/**
 * Border radius tokens.
 * See docs/DESIGN_SYSTEM.md §5 for full spec.
 */

export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 18,
  '2xl': 25,
  full: 9999,
} as const;

export type RadiiToken = keyof typeof radii;
