/**
 * Status + Grund einer Produktfoto-Einreichung (crowd_uploads) in Nutzer-
 * Sprache — 86cbam5ep („die Menschen müssen draus lernen").
 *
 * Quelle der Gründe: `holdReasons: string[]` (maschinenlesbare Codes aus der
 * Freigaberunde, ggf. mit Suffix `fotos_unpassend: <Grund>`) und
 * `rejectReason` (derselbe Code-Vorrat). Der Suffix / `reviewNote` ist interner
 * Freitext (Vision-Rohtext) und wird NIE angezeigt.
 *
 * Copy-Ton (CLAUDE.md): positiv, vorwärts gewandt — was der Nutzer beim
 * nächsten Mal tun kann, nie was er falsch gemacht hat.
 */

export interface SubmissionStatusCopy {
  /** Kurzlabel für den Chip in der Liste. */
  label: string;
  /** Überschrift der Status-Karte im Detail. */
  headline: string;
  /** Erklärung + nächster Schritt. */
  body: string;
  /** Visuelle Tönung. */
  tone: 'ok' | 'pending' | 'held' | 'info';
  icon: string;
}

interface SubmissionLike {
  status?: string | null;
  holdReasons?: string[] | null;
  rejectReason?: string | null;
  campaignId?: string | null;
  rewardSkipped?: boolean | null;
}

const REASON_COPY: Record<string, { headline: string; body: string }> = {
  ean_fehlt: {
    headline: 'Der Strichcode war nicht lesbar',
    body: 'Beim nächsten Produkt den EAN-Code scharf und komplett in den Rahmen halten — dann zählt es.',
  },
  kein_produktname: {
    headline: 'Der Produktname war nicht erkennbar',
    body: 'Ein Foto der Vorderseite mit gut lesbarem Namen reicht beim nächsten Mal völlig.',
  },
  produkt_bereits_verguetet: {
    headline: 'Dieses Produkt war schon im Katalog',
    body: 'Jedes Produkt zählt einmal — such dir gern ein neues aus dem Regal, das noch fehlt.',
  },
  doppelt_eingereicht: {
    headline: 'Dieses Produkt hattest du schon eingereicht',
    body: 'Wir zählen jedes Produkt einmal. Ein anderes Produkt bringt beim nächsten Mal wieder etwas.',
  },
  bilder_wiederverwendet: {
    headline: 'Ein Foto war schon bei einer anderen Einreichung dabei',
    body: 'Für jedes Produkt frische Fotos machen — dann zählt der Datensatz.',
  },
  fotos_unpassend: {
    headline: 'Ein Foto passte nicht zum Schritt',
    body: 'Zum Beispiel das Regal statt des Preisschilds. Beim nächsten Mal einfach auf die Vorgabe im jeweiligen Schritt achten.',
  },
};

const DEFAULT_HELD = {
  headline: 'Diese Einreichung konnte nicht gezählt werden',
  body: 'Beim nächsten Produkt: alle Ansichten scharf, EAN und Preis gut lesbar — dann klappt es.',
};

/** Erster maschinenlesbarer Grund-Code (ohne Freitext-Suffix). */
export function primaryReasonCode(entry: SubmissionLike): string | null {
  const fromHold = Array.isArray(entry.holdReasons)
    ? entry.holdReasons.map((h) => String(h).split(':')[0].trim()).find((c) => c.length > 0)
    : null;
  const fromReject = entry.rejectReason ? String(entry.rejectReason).split(':')[0].trim() : null;
  return fromHold || fromReject || null;
}

export function describeSubmission(entry: SubmissionLike): SubmissionStatusCopy {
  const status = entry.status ?? 'pending';
  const code = primaryReasonCode(entry);

  if (status === 'approved') {
    const body = entry.rewardSkipped
      ? 'Dein Datensatz ist im Katalog. Für eine Vergütung braucht die Aktion beim nächsten Mal deinen Standort im Orts-Schritt.'
      : entry.campaignId
        ? 'Dein Datensatz ist im Katalog, die Vergütung liegt in deinem Cashback-Guthaben.'
        : 'Dein Datensatz ist im Katalog und hilft allen beim Vergleichen.';
    return { label: 'Angenommen', headline: 'Angenommen — danke!', body, tone: 'ok', icon: 'check-circle' };
  }

  if (status === 'rejected' || code) {
    const reason = (code && REASON_COPY[code]) || DEFAULT_HELD;
    return {
      label: status === 'rejected' ? 'Nicht gezählt' : 'Zurückgestellt',
      headline: reason.headline,
      body: reason.body,
      tone: 'held',
      icon: 'information-outline',
    };
  }

  return {
    label: 'Wird geprüft',
    headline: 'Wird geprüft',
    body: 'Deine Einreichung ist da und wird geprüft — das kann ein bisschen dauern. Danke für deine Geduld, du hilfst, den Katalog zu vervollständigen.',
    tone: 'pending',
    icon: 'progress-clock',
  };
}
