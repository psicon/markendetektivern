/**
 * Shadow tokens — cross-platform (iOS + Android).
 * See docs/DESIGN_SYSTEM.md §6 for full spec.
 *
 * iOS uses shadow*; Android uses elevation. Both emitted so RN renders
 * consistently across platforms.
 */

import type { ViewStyle } from 'react-native';

type Shadow = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

const BLACK = '#191c1d';
const PRIMARY = '#0d8575';

export const shadowsLight = {
  sm: {
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  lg: {
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  fab: {
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
} as const satisfies Record<string, Shadow>;

// Dark mode: halve opacity so shadows don't visually dominate on dark bg.
export const shadowsDark: typeof shadowsLight = {
  sm: { ...shadowsLight.sm, shadowOpacity: 0.02 },
  md: { ...shadowsLight.md, shadowOpacity: 0.04 },
  lg: { ...shadowsLight.lg, shadowOpacity: 0.06 },
  fab: { ...shadowsLight.fab, shadowOpacity: 0.24 },
};

export type ShadowToken = keyof typeof shadowsLight;
