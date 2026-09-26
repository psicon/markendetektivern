import { showInfoToast } from '@/lib/services/ui/toast';

/**
 * Die zwei erwarteten „Fehler" beim Wechsel in ein bestehendes Konto
 * (lib/services/kontoWechsel.ts) — beide sind kein Defekt:
 *
 * - 'auth/cancelled': Nutzer hat im Dialog abgebrochen → still bleiben.
 * - 'auth/konto-umzug-offline': Gast mit Einreichungen, aber keine
 *   Verbindung für die Mitnahme → kurzer freundlicher Hinweis.
 *
 * Der Text steht hier fest und wird NICHT aus error.message genommen: der
 * Facebook-Weg in AuthContext schreibt die Meldung für die TestFlight-
 * Diagnose um ("<code>: <message> | [FB-Debug] …").
 *
 * Liefert true, wenn der Fehler damit erledigt ist — dann kein Alert,
 * kein console.error (sonst rotes Dev-Overlay für einen erwarteten Fall).
 */
export function erwarteterAuthFehler(
  error: any,
  scheme: 'light' | 'dark' | null | undefined,
): boolean {
  if (error?.code === 'auth/cancelled') return true;
  if (error?.code === 'auth/konto-umzug-offline') {
    showInfoToast(
      'Für die Mitnahme deiner Einreichungen brauchen wir kurz Internet – bitte gleich nochmal versuchen.',
      'info',
      scheme ?? 'light',
    );
    return true;
  }
  return false;
}
