/**
 * Motion tokens — durations + easing.
 * See docs/DESIGN_SYSTEM.md §7 for full spec.
 */

import { Easing } from 'react-native';

export const motion = {
  fast: 120,
  default: 220,
  slow: 380,
} as const;

export type MotionToken = keyof typeof motion;

export const easing = {
  out: Easing.out(Easing.cubic),
  inOut: Easing.inOut(Easing.cubic),
  in: Easing.in(Easing.cubic),
};
