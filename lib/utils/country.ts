/**
 * Country detection helpers for the DACH region.
 *
 * Strategy (Onboarding-First-Run-Path):
 *   1) Device locale via expo-localization → wenn DACH-regionCode (DE/AT/CH)
 *      direkt nehmen.
 *   2) Hard default 'DE' (95 %+ unserer User).
 *
 * Bewusst KEIN IP-Geo-Lookup beim First-Run:
 *   - User hat noch keine Journey-Events (regionGuess.ts greift erst nach
 *     1-N existierenden Journeys, irrelevant für Onboarding-Step-1).
 *   - VPN/Carrier-NAT/Hotel-WLAN verfälscht IPs reproduzierbar — Locale
 *     ist näher am tatsächlichen User-Bezug.
 *   - Speed: Locale ist sync, kein Network-Hop.
 *
 * Country-Override bleibt im Onboarding/Profile möglich falls Detection
 * daneben liegt.
 */

import * as Localization from 'expo-localization';

export type DachCountry = 'DE' | 'AT' | 'CH';

const DACH_COUNTRIES: ReadonlyArray<DachCountry> = ['DE', 'AT', 'CH'];

function isDachCountry(value: unknown): value is DachCountry {
  return typeof value === 'string' && DACH_COUNTRIES.includes(value as DachCountry);
}

/**
 * Detect the user's likely DACH country, sync, no network.
 *
 * - Liest `regionCode` aus dem ersten Locale-Eintrag (das ist das
 *   primary-Locale — z.B. 'DE' für deutsches Handy in Wien, das User
 *   kommt aus Deutschland und ist auf Reise).
 * - Fällt auf 'DE' zurück wenn das nicht-DACH ist (Tourist mit FR/US-
 *   Locale in DACH-App). User kann später im Profil korrigieren.
 */
export function detectCountry(): DachCountry {
  try {
    const locales = Localization.getLocales();
    const region = locales[0]?.regionCode;
    if (isDachCountry(region)) return region;
  } catch {
    // expo-localization sollte nicht throwen, aber defensive
  }
  return 'DE';
}
