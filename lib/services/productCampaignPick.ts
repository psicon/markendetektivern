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
