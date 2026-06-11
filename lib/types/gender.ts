/**
 * Gender-Enum — Single Source of Truth über Onboarding, Register
 * und Edit-Profile.
 *
 * Vorher (T6 Pre-State):
 *   - Onboarding-Step-5: ['männlich', 'weiblich', 'nonbinary', 'anderes']
 *     → mapped via GENDER_USERDOC_MAP → 'Männlich' etc.
 *   - Register: hardcoded ['Männlich', 'Weiblich', 'Divers']
 *   - Edit-Profile: ['Männlich', 'Weiblich', 'Divers']
 *
 * Probleme:
 *   - 'nonbinary'/'anderes' in Onboarding wurde zu 'Divers' bzw.
 *     'Anderes' gemappt, aber Edit-Profile hatte keine 'Anderes'-Pill
 *     → User mit gender='Anderes' sah keine Selection in Edit-Profile.
 *   - Pill-Kategorien wurden inkonsistent verteilt.
 *
 * Jetzt:
 *   - 4 Werte als Enum-Strings (Capitalized, kompatibel mit dem
 *     historischen Edit-Profile-Schema).
 *   - Helper `genderOptions()` liefert die UI-Pills in stabiler
 *     Reihenfolge — direkt nutzbar in jedem Screen.
 *   - Helper `normalizeLegacyGender()` mapped alte Schreibweisen
 *     (lowercase 'männlich', 'nonbinary' etc.) auf das Canonical-Schema.
 */

/** Canonical Gender-Werte. Werden so in users/{uid}.gender gespeichert.
 *  'Divers' entfernt (ClickUp 86ca7x8ft, 2026-06-11) — Bestandsdaten
 *  mit 'Divers' werden via normalizeLegacyGender auf 'Anderes' gemappt. */
export const GENDER_VALUES = ['Männlich', 'Weiblich', 'Anderes'] as const;
export type Gender = (typeof GENDER_VALUES)[number];

/** UI-Pill-Spec (Label + Storage-Value sind hier gleich, aber wir
 *  geben uns die Flexibilität für künftige Übersetzungen). */
export interface GenderPillOption {
  value: Gender;
  label: string;
}

export const GENDER_PILL_OPTIONS: GenderPillOption[] = GENDER_VALUES.map((v) => ({
  value: v,
  label: v,
}));

/**
 * Normalisiert beliebige Eingaben auf den Canonical Gender-Wert.
 * Akzeptiert:
 *   - 'Männlich', 'männlich' → 'Männlich'
 *   - 'Weiblich', 'weiblich' → 'Weiblich'
 *   - 'Divers', 'divers', 'nonbinary' → 'Anderes' (Divers entfernt, 86ca7x8ft)
 *   - 'Anderes', 'anderes', 'other' → 'Anderes'
 *   - alles andere → null
 */
export function normalizeLegacyGender(input: unknown): Gender | null {
  if (typeof input !== 'string') return null;
  const lower = input.trim().toLowerCase();
  if (lower === 'männlich' || lower === 'maennlich' || lower === 'male' || lower === 'm') {
    return 'Männlich';
  }
  if (lower === 'weiblich' || lower === 'female' || lower === 'w' || lower === 'f') {
    return 'Weiblich';
  }
  if (lower === 'divers' || lower === 'nonbinary' || lower === 'non-binary' || lower === 'd') {
    return 'Anderes';
  }
  if (lower === 'anderes' || lower === 'other' || lower === 'sonstiges') {
    return 'Anderes';
  }
  return null;
}

/** Type-guard für Gender. */
export function isGender(v: unknown): v is Gender {
  return typeof v === 'string' && (GENDER_VALUES as readonly string[]).includes(v);
}
