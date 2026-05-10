/**
 * Country detection helpers for the DACH region.
 *
 * Strategy (Onboarding-First-Run-Path):
 *   1) Device locale via `Intl.DateTimeFormat().resolvedOptions().locale`
 *      (Hermes-built-in, kein Native-Module nötig) → Region-Code
 *      extrahieren → wenn DACH (DE/AT/CH) nehmen.
 *   2) Fallback via `NativeModules.SettingsManager.settings.AppleLocale`
 *      (iOS) bzw. `NativeModules.I18nManager.localeIdentifier`
 *      (Android) — falls Intl in einem alten Hermes-Build fehlt.
 *   3) Hard default 'DE' (95 %+ unserer User).
 *
 * Bewusst KEIN expo-localization:
 *   - Würde Native-Module-Linking erfordern → neuen Dev-Client-
 *     Build pro Phase. Für ein einfaches Region-Lookup zu schwer.
 *   - Intl.DateTimeFormat liefert dasselbe mit Zero-Native-Cost.
 *
 * Bewusst KEIN IP-Geo-Lookup beim First-Run:
 *   - User hat noch keine Journey-Events.
 *   - VPN/Carrier-NAT/Hotel-WLAN verfälscht IPs reproduzierbar.
 *   - Speed: Locale ist sync, kein Network-Hop.
 */

import { NativeModules, Platform } from 'react-native';

export type DachCountry = 'DE' | 'AT' | 'CH';

const DACH_COUNTRIES: ReadonlyArray<DachCountry> = ['DE', 'AT', 'CH'];

function isDachCountry(value: unknown): value is DachCountry {
  return typeof value === 'string' && DACH_COUNTRIES.includes(value as DachCountry);
}

/**
 * Versucht die Region (z.B. 'DE') aus einem Locale-Tag (z.B. 'de-DE'
 * oder 'de_DE') zu extrahieren. Akzeptiert Bindestrich + Underscore.
 */
function extractRegion(localeTag: string | undefined | null): string | null {
  if (!localeTag) return null;
  // BCP-47 'de-DE' oder POSIX 'de_DE' → 'DE'
  const parts = localeTag.split(/[-_]/);
  // Region-Code ist üblicherweise das 2. Segment, 2-Letter-uppercase.
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts[i]?.toUpperCase();
    if (candidate && /^[A-Z]{2}$/.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Detect the user's likely DACH country, sync, no native modules.
 *
 * - Erst Intl.DateTimeFormat (Hermes-built-in).
 * - Fallback: RN-NativeModules SettingsManager (iOS) /
 *   I18nManager (Android) für sehr alte Engines wo Intl fehlt.
 * - Final fallback: 'DE'.
 */
export function detectCountry(): DachCountry {
  // 1) Intl.DateTimeFormat — funktioniert in modern Hermes.
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      const tag = Intl.DateTimeFormat().resolvedOptions().locale;
      const region = extractRegion(tag);
      if (isDachCountry(region)) return region;
    }
  } catch {
    // Hermes-Edge-Case → next strategy
  }

  // 2) RN-NativeModules-Fallback.
  try {
    if (Platform.OS === 'ios') {
      const settings: any = NativeModules.SettingsManager?.settings;
      const apple = settings?.AppleLocale ?? settings?.AppleLanguages?.[0];
      const region = extractRegion(typeof apple === 'string' ? apple : null);
      if (isDachCountry(region)) return region;
    } else if (Platform.OS === 'android') {
      const id: string | undefined = NativeModules.I18nManager?.localeIdentifier;
      const region = extractRegion(id);
      if (isDachCountry(region)) return region;
    }
  } catch {
    // ignore
  }

  // 3) Hard default
  return 'DE';
}
