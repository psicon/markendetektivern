import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

/**
 * „Effektiv anonym" — die eine Gast-Definition der App (Audit 12.07.2026).
 *
 * Hintergrund: Die Session-Rettung (legacyRescueService) meldet Gäste, deren
 * 5.x-Session beim 6.0-Update verloren ging, per CUSTOM-TOKEN wieder an ihrer
 * alten UID an. Firebase setzt bei Custom-Token-Sign-ins `isAnonymous: false`,
 * obwohl das Konto ein Gast-Konto ohne jeden Provider ist. Jede Stelle, die
 * nur `user.isAnonymous` prüft, würde solche Gäste als registriert behandeln —
 * am gefährlichsten in linkOrSignIn/signUp: statt linkWithCredential (Daten
 * bleiben an der UID) liefe ein signInWithCredential (Daten weg — exakt der
 * Bug, den die Rettung repariert).
 *
 * Regel: Gast = `isAnonymous` ODER kein einziger echter Auth-Provider.
 * ('firebase' ist kein Provider — Registrierte tragen 'password',
 * 'google.com', 'apple.com', 'facebook.com' … in providerData.)
 */
export function isEffectivelyAnonymous(
  u: Pick<FirebaseAuthTypes.User, 'isAnonymous' | 'providerData'> | null | undefined,
): boolean {
  if (!u) return false;
  if (u.isAnonymous) return true;
  const providers = (u.providerData || []).filter(
    (p) => p && p.providerId && p.providerId !== 'firebase',
  );
  return providers.length === 0;
}
