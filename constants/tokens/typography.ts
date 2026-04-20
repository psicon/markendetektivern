/**
 * Typography tokens — Nunito variable font.
 * See docs/DESIGN_SYSTEM.md §3 for full spec.
 */

import type { TextStyle } from 'react-native';

export const fontFamily = 'Nunito';

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
  fontFamily: typeof fontFamily;
  fontWeight: TextStyle['fontWeight'];
  fontSize: number;
  lineHeight: number;
};

export const typeScale = {
  display: {
    fontFamily,
    fontWeight: fontWeight.extraBold,
    fontSize: 32,
    lineHeight: 38,
  },
  h1: {
    fontFamily,
    fontWeight: fontWeight.bold,
    fontSize: 28,
    lineHeight: 34,
  },
  h2: {
    fontFamily,
    fontWeight: fontWeight.bold,
    fontSize: 22,
    lineHeight: 28,
  },
  h3: {
    fontFamily,
    fontWeight: fontWeight.bold,
    fontSize: 18,
    lineHeight: 24,
  },
  title: {
    fontFamily,
    fontWeight: fontWeight.bold,
    fontSize: 16,
    lineHeight: 22,
  },
  body: {
    fontFamily,
    fontWeight: fontWeight.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontFamily,
    fontWeight: fontWeight.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  label: {
    fontFamily,
    fontWeight: fontWeight.medium,
    fontSize: 11,
    lineHeight: 14,
  },
  priceBig: {
    fontFamily,
    fontWeight: fontWeight.extraBold,
    fontSize: 40,
    lineHeight: 46,
  },
} as const satisfies Record<string, TypeScaleEntry>;

export type TypeScaleName = keyof typeof typeScale;
