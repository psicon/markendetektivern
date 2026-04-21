/**
 * Color tokens — source of truth for all colors used in the new design.
 * See docs/DESIGN_SYSTEM.md §2 for full spec.
 *
 * Two groups:
 *  - `brand` : constants, never theme-swap (md.*)
 *  - `theme` : swap light ↔ dark (th.*), access via useTokens()
 */

export const brand = {
  primary: '#0d8575',
  primaryDark: '#0a6560',
  secondary: '#42a968',
  accent: '#f5720e',
  accentSoft: '#fff3eb',
  error: '#d32f2f',
  success: '#2e7d32',
  warning: '#f57c00',
} as const;

export type BrandColor = keyof typeof brand;

export const themeLight = {
  bg: '#f5f7f8',
  surface: '#ffffff',
  surfaceAlt: '#f0f4f5',
  border: 'rgba(25,28,29,0.08)',
  borderStrong: 'rgba(25,28,29,0.16)',
  text: '#191c1d',
  textSub: '#5c6769',
  textMuted: '#8fa1a5',
  primary: '#0d8575',
  primaryContainer: '#e0f5f1',
  onPrimary: '#ffffff',
  accent: '#f5720e',
  accentContainer: '#fff3eb',
  onAccent: '#ffffff',
  overlay: 'rgba(25,28,29,0.48)',
  shimmer1: '#e8eced',
  shimmer2: '#f5f7f8',
} as const;

export const themeDark: typeof themeLight = {
  bg: '#0f1214',
  surface: '#1a1f23',
  surfaceAlt: '#242b30',
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  text: '#e8eced',
  textSub: '#8a9699',
  textMuted: '#5c6769',
  primary: '#14b39a',
  primaryContainer: '#0d3530',
  onPrimary: '#ffffff',
  accent: '#ff8a3d',
  accentContainer: '#3d2010',
  onAccent: '#ffffff',
  overlay: 'rgba(0,0,0,0.64)',
  shimmer1: '#1a1f23',
  shimmer2: '#242b30',
};

export type ThemeColor = keyof typeof themeLight;

export const stufen = {
  1: '#ef2d1a', // Sehr ähnlich (red)
  2: '#f5720e', // Ähnlich (orange)
  3: '#fbc801', // Teilweise ähnlich (yellow)
  4: '#73c928', // Wenig ähnlich (light green)
  5: '#0d8575', // Kaum ähnlich (petrol)
} as const;

export type StufenLevel = keyof typeof stufen;

export const stufenLabels: Record<StufenLevel, string> = {
  1: 'Sehr ähnlich',
  2: 'Ähnlich',
  3: 'Teilweise ähnlich',
  4: 'Wenig ähnlich',
  5: 'Kaum ähnlich',
};
