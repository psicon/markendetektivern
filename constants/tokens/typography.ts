/**
 * Typography tokens — Nunito variable font.
 * See docs/DESIGN_SYSTEM.md §3 for full spec.
 *
 * ─── WICHTIG: Android-Font-Loading ───────────────────────────────
 *
 * React Native + Android wendet fontWeight NICHT auf custom fonts
 * an. Wenn man `fontFamily: 'Nunito'` + `fontWeight: '700'` setzt,
 * sucht Android nach einer Font namens "Nunito" und fällt — wenn
 * keine existiert — auf System-Default zurück. fontWeight wird
 * komplett ignoriert wenn fontFamily ein custom name ist.
 *
 * Nur die expliziten Varianten `Nunito_400Regular`, `Nunito_500Medium`,
 * `Nunito_600SemiBold`, `Nunito_700Bold` sind via
 * @expo-google-fonts/nunito geladen.
 *
 * Lösungen die wir hier anbieten:
 *
 *   • `fontFamily = 'Nunito'` bleibt als String exportiert. Die ~440
 *     existing Callsites `{ fontFamily, fontWeight: X }` werden von
 *     einem GLOBAL Text/TextInput render-Patch in `app/_layout.tsx`
 *     auf Android in `Nunito_XXX` upgegradet (iOS resolvet 'Nunito'
 *     + weight nativ korrekt).
 *
 *   • Zusätzlich exportieren wir `nunitoFont(weight)` als Helper und
 *     die expliziten Varianten als Konstanten (`NUNITO_BOLD` etc.).
 *     Code der absolute Kontrolle braucht (SVG, Skia, oder die
 *     cashback-Screens die `fontFamily.heading`/`.body` historisch
 *     verwendet haben) nutzt diese direkt.
 */

import type { TextStyle } from 'react-native';

// Explizit geladene Nunito-Varianten (FontLoader.tsx).
export const NUNITO_REGULAR = 'Nunito_400Regular';
export const NUNITO_MEDIUM = 'Nunito_500Medium';
export const NUNITO_SEMIBOLD = 'Nunito_600SemiBold';
export const NUNITO_BOLD = 'Nunito_700Bold';

/**
 * Resolvet einen fontWeight in den explizit geladenen Nunito-Family-
 * Namen. Plattform-unabhängig — die explizite Variante funktioniert
 * sowohl auf iOS als auch Android.
 */
export function nunitoFont(weight?: TextStyle['fontWeight']): string {
  const w = String(weight ?? '');
  if (w === 'bold' || w === '700' || w === '800' || w === '900') return NUNITO_BOLD;
  if (w === '600') return NUNITO_SEMIBOLD;
  if (w === '500') return NUNITO_MEDIUM;
  return NUNITO_REGULAR;
}

export const fontFamily = 'Nunito';

// Convenience-Map für screens die fontFamily.heading / .body etc.
// erwarten (historisches Pattern aus den cashback-Screens). Liefert
// die explizite Nunito-Variante → funktioniert iOS + Android.
export const fontFamilyVariants = {
  regular: NUNITO_REGULAR,
  medium: NUNITO_MEDIUM,
  semibold: NUNITO_SEMIBOLD,
  bold: NUNITO_BOLD,
  heading: NUNITO_BOLD,
  body: NUNITO_REGULAR,
} as const;

export const fontWeight = {
  extraLight: '200',
  light: '300',
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extraBold: '800',
  black: '900',
} as const satisfies Record<string, TextStyle['fontWeight']>;

type TypeScaleEntry = {
  fontFamily: string;
  fontWeight: TextStyle['fontWeight'];
  fontSize: number;
  lineHeight: number;
};

// typeScale nutzt die explizite Variante (NUNITO_XXX) damit die
// Sizes auf Android UND iOS identisch korrekt rendern, ohne auf
// den Text.render-Patch angewiesen zu sein.
export const typeScale = {
  display: {
    fontFamily: NUNITO_BOLD,
    fontWeight: fontWeight.extraBold,
    fontSize: 32,
    lineHeight: 38,
  },
  h1: {
    fontFamily: NUNITO_BOLD,
    fontWeight: fontWeight.bold,
    fontSize: 28,
    lineHeight: 34,
  },
  h2: {
    fontFamily: NUNITO_BOLD,
    fontWeight: fontWeight.bold,
    fontSize: 22,
    lineHeight: 28,
  },
  h3: {
    fontFamily: NUNITO_BOLD,
    fontWeight: fontWeight.bold,
    fontSize: 18,
    lineHeight: 24,
  },
  title: {
    fontFamily: NUNITO_BOLD,
    fontWeight: fontWeight.bold,
    fontSize: 16,
    lineHeight: 22,
  },
  body: {
    fontFamily: NUNITO_REGULAR,
    fontWeight: fontWeight.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontFamily: NUNITO_MEDIUM,
    fontWeight: fontWeight.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  label: {
    fontFamily: NUNITO_MEDIUM,
    fontWeight: fontWeight.medium,
    fontSize: 11,
    lineHeight: 14,
  },
  priceBig: {
    fontFamily: NUNITO_BOLD,
    fontWeight: fontWeight.extraBold,
    fontSize: 40,
    lineHeight: 46,
  },
} as const satisfies Record<string, TypeScaleEntry>;

export type TypeScaleName = keyof typeof typeScale;
