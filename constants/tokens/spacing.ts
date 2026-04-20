/**
 * Spacing tokens — 4 pt grid.
 * See docs/DESIGN_SYSTEM.md §4 for full spec.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

export type SpacingToken = keyof typeof spacing;

export const pagePadding = spacing.lg;
export const sectionGap = spacing['2xl'];
