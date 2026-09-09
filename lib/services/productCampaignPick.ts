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
 * Die Voreinstellung, wenn der Nutzer nicht selbst gewählt hat: die Aktion mit
 * der NIEDRIGSTEN Vergütung (User-Vorgabe 09.09.2026).
 *
 * Vorher gewann die erste der Liste, also die mit dem frühesten Enddatum — das
 * ist beim Geld ein Zufallsergebnis. Laufen zwei Aktionen parallel (etwa
 * „Milchprodukte 0,16 €" neben „Produkt-Fotos 0,12 €"), kostet jede
 * Einreichung, die stumm in die teurere fällt, die Differenz. Bei mehreren
 * tausend Datensätzen im Monat ist das der Unterschied zwischen tragbar und
 * nicht tragbar.
 *
 * Wer die höher vergütete Aktion will, wählt sie weiterhin ausdrücklich aus —
 * die Liste zeigt alle mit ihrem Betrag. Es verschwindet nichts, es wird nur
 * nicht mehr ungefragt das Teuerste genommen.
 *
 * ZWEI FEINHEITEN, die keine Willkür sind:
 *
 *  1. Eine Aktion OHNE Betrag (0 ct) ist nicht „die günstigste", sondern gar
 *     keine Vergütung. Sie wird nur genommen, wenn keine einzige zahlt — sonst
 *     sammelte jemand ungefragt umsonst, während nebenan eine zahlende Aktion
 *     läuft. Der Server filtert 0-Aktionen ohnehin heraus
 *     (crowd-upload-reward/src/campaignFallback.js).
 *  2. Bei gleichem Betrag bleibt die bisherige Reihenfolge (frühestes Ende
 *     zuerst). Ohne diesen Gleichstand-Entscheid wäre die Auswahl von der
 *     Sortierung der Datenbankabfrage abhängig und damit nicht vorhersagbar.
 */
export function guenstigsteAktion(list: ActiveProductCampaign[]): ActiveProductCampaign | null {
  if (!list.length) return null;
  const zahlend = list.filter((c) => c.rewardCents > 0);
  const menge = zahlend.length ? zahlend : list;
  // `reduce` statt `sort`: die Eingabeliste bleibt unangetastet (der Aufrufer
  // zeigt sie in seiner eigenen Reihenfolge an), und der erste Treffer gewinnt
  // bei Gleichstand — das ist genau die frühere Reihenfolge.
  return menge.reduce((beste, c) => (c.rewardCents < beste.rewardCents ? c : beste));
}

/**
 * Wählt die Aktion, für die erfasst wird: die vom Nutzer gewählte, sofern sie
 * noch läuft — sonst die günstigste (siehe {@link guenstigsteAktion}).
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
  return guenstigsteAktion(list);
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
