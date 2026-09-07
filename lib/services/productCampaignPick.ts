/**
 * Auswahl der Produktfoto-Aktion — reine Logik, ohne Firebase/Storage, damit
 * sie testbar bleibt (User-Wunsch 05.09.2026: laufen mehrere Produktaktionen,
 * soll der Nutzer WÄHLEN, für welche er erfasst — bisher gewann stumm die
 * oberste, also die mit dem frühesten Enddatum).
 */

export interface ActiveProductCampaign {
  campaignId: string;
  rewardCents: number;
  /** Anzeigename der Aktion (aus `cashback_campaigns.title`), Fallback = ID. */
  title: string;
}

/**
 * Wählt die Aktion, für die erfasst wird: die vom Nutzer gewählte, sofern sie
 * noch läuft — sonst die erste der Liste (= früheste Enddatum, wie bisher).
 * Eine gespeicherte Wahl, die nicht mehr aktiv ist, wird ignoriert, nie
 * „repariert": das macht der Aufrufer, wenn er die Liste anzeigt.
 */
export function pickProductCampaign(
  list: ActiveProductCampaign[],
  chosenId: string | null | undefined,
): ActiveProductCampaign | null {
  if (!list.length) return null;
  if (chosenId) {
    const chosen = list.find((c) => c.campaignId === chosenId);
    if (chosen) return chosen;
  }
  return list[0];
}

/**
 * Woher das Aktionskennzeichen einer Einreichung stammt (86cbet2nw).
 *
 * Der entscheidende Unterschied ist der zwischen `null` und `undefined`:
 *  - `null`        = der Server wurde erreicht, es läuft wirklich keine Aktion.
 *  - `undefined`   = wir konnten nicht nachsehen (offline, Timeout, Lesefehler).
 *
 * Bis September 2026 waren beide Fälle im Client dasselbe: jede Fehlerbehandlung
 * endete in `[]` und damit in `campaignId: null` am Dokument. Der Server bricht
 * dann still ab, und niemandem fällt der ausbleibende Betrag auf. Genau daran
 * hingen 58 unvergütete Einreichungen aus Juli und August.
 */
export type CampaignResolveState = 'live' | 'gemerkt' | 'keine_aktion' | 'nicht_ermittelbar';

export interface SubmitCampaignResolution {
  campaign: ActiveProductCampaign | null;
  state: CampaignResolveState;
}

/**
 * Entscheidet, mit welcher Aktion eingereicht wird.
 *
 * @param live    frisch aufgelöst: Aktion, `null` (keine läuft) oder
 *                `undefined` (konnte nicht nachsehen).
 * @param gemerkt der beim Öffnen des Wizards aufgelöste Stand, als Rückfall.
 */
export function resolveSubmitCampaign(
  live: ActiveProductCampaign | null | undefined,
  gemerkt: ActiveProductCampaign | null | undefined,
): SubmitCampaignResolution {
  if (live) return { campaign: live, state: 'live' };
  // Eine frische Auskunft „es läuft keine" gewinnt gegen einen alten Stand:
  // sonst würde für eine ausgelaufene Aktion eingereicht.
  if (live === null) return { campaign: null, state: 'keine_aktion' };
  if (gemerkt) return { campaign: gemerkt, state: 'gemerkt' };
  return { campaign: null, state: 'nicht_ermittelbar' };
}
