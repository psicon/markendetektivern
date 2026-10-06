/**
 * Mehrfachbestätigung von Live-Barcode-Lesungen (reine Logik, testbar).
 *
 * Anlass (06.10.2026): Der Foto-Assistent übernahm die ERSTE Lesung, die
 * expo-camera meldete. Auf Android (ML Kit 17.3.0, je Kamerabild nur
 * `barcodes.first()`) waren 111 von 1.888 lesbaren Barcode-Fotos mit einer
 * falschen Nummer gespeichert (5,9 %, iPhone 0,5 %) — stets mit gültiger
 * Prüfziffer, das Foto Sekundenbruchteile später sauber lesbar. Google
 * empfiehlt selbst, eine Serie gleicher Werte abzuwarten.
 *
 * Regeln und warum sie so sind:
 *  - Gezählt wird JE NUMMER in einem gleitenden Fenster, nicht „hintereinander“.
 *    Bei zwei Codes im Bild (Regaletikett, Mehrfachpackung — mind. 2,1 % der
 *    Fotos) wechseln die Lesungen A, B, A, B; eine Serienregel bestätigte nie.
 *  - Ungültige Prüfziffer zählt nie.
 *  - Normal: 3 gleiche Lesungen. Risikoform (`istRisikoform`): 5.
 *  - expo-camera verwirft in JS ein Ereignis, das dem vorigen exakt gleicht
 *    (inkl. Eckpunkten) und < 500 ms später kommt. Bei ruhig gehaltenem Handy
 *    kommt dieselbe Nummer also höchstens etwa alle 0,5 s. Deshalb gilt auch:
 *    normal 2 Lesungen mit ≥ 600 ms Abstand, Risikoform 3 Lesungen über
 *    ≥ 1200 ms. Eine Fehllesung ist ein Einzelbild-Ereignis (Bewegung beim
 *    Heranführen); dieselbe falsche Nummer über mehr als eine halbe Sekunde
 *    wiederholt ist nicht das gemessene Fehlerbild. Ohne die Zeitregel bliebe
 *    eine Risikoform auf langsamen Geräten (≈ 1 Lesung/s) für immer offen.
 *  - Fenster 3 s: fünf Lesungen unter dem 500-ms-Filter brauchen ≥ 2 s.
 *  - Nicht eindeutig: Hat beim Erreichen der Schwelle eine ANDERE gültige
 *    Nummer im Fenster mindestens 2 Lesungen, sind zwei echte Codes im Bild.
 *    Welcher zum Produkt gehört, weiß nur der Nutzer → er entscheidet. Eine
 *    einzelne abweichende Lesung ist dagegen der typische Ausreißer und zählt
 *    nicht (Folge falsch, richtig, richtig, richtig ⇒ richtig).
 */

import { gleicheGtin, istGtinForm, istRisikoform, pruefzifferStimmt, vergleichsform } from './gtin';

export const BESTAETIGUNG_FENSTER_MS = 3000;
export const SCHWELLE_NORMAL = 3;
export const SCHWELLE_RISIKO = 5;
/** Zeitregel: so viele Lesungen genügen, wenn sie mind. `…_SPANNE_MS` auseinander liegen. */
export const ZEITREGEL_NORMAL = { lesungen: 2, spanneMs: 600 } as const;
export const ZEITREGEL_RISIKO = { lesungen: 3, spanneMs: 1200 } as const;
/** Ab so vielen Lesungen gilt eine zweite Nummer als echter zweiter Code im Bild. */
export const ZWEITER_CODE_AB = 2;

export type BestaetigungsStand =
  | { art: 'offen' }
  | { art: 'bestaetigt'; nummer: string }
  | { art: 'mehrdeutig'; nummern: string[] };

export interface Kandidat {
  /** Zuletzt gelesene Schreibweise (unverändert, wie vom Leser geliefert). */
  nummer: string;
  anzahl: number;
}

interface Lesung {
  roh: string;
  schluessel: string;
  t: number;
}

export interface BarcodeBestaetigung {
  /** Eine Live-Lesung einspeisen. `jetzt` in ms (Date.now()). */
  lesen(roh: string, jetzt: number): BestaetigungsStand;
  /** Gültige Nummern im Fenster, häufigste zuerst (bei Gleichstand die jüngste). */
  kandidaten(jetzt: number): Kandidat[];
  zuruecksetzen(): void;
}

function erreicht(lesungen: Lesung[], risiko: boolean): boolean {
  const schwelle = risiko ? SCHWELLE_RISIKO : SCHWELLE_NORMAL;
  if (lesungen.length >= schwelle) return true;
  const regel = risiko ? ZEITREGEL_RISIKO : ZEITREGEL_NORMAL;
  if (lesungen.length < regel.lesungen) return false;
  return lesungen[lesungen.length - 1].t - lesungen[0].t >= regel.spanneMs;
}

export function erstelleBarcodeBestaetigung(fensterMs = BESTAETIGUNG_FENSTER_MS): BarcodeBestaetigung {
  let lesungen: Lesung[] = [];

  const ausduennen = (jetzt: number) => {
    lesungen = lesungen.filter((l) => jetzt - l.t <= fensterMs);
  };

  const gruppen = (): Map<string, Lesung[]> => {
    const m = new Map<string, Lesung[]>();
    for (const l of lesungen) {
      const g = m.get(l.schluessel);
      if (g) g.push(l);
      else m.set(l.schluessel, [l]);
    }
    return m;
  };

  const kandidaten = (jetzt: number): Kandidat[] => {
    ausduennen(jetzt);
    return [...gruppen().values()]
      .map((g) => ({ nummer: g[g.length - 1].roh, anzahl: g.length, zuletzt: g[g.length - 1].t }))
      .sort((a, b) => b.anzahl - a.anzahl || b.zuletzt - a.zuletzt)
      .map(({ nummer, anzahl }) => ({ nummer, anzahl }));
  };

  return {
    lesen(rohEingabe, jetzt) {
      const roh = (rohEingabe ?? '').trim();
      ausduennen(jetzt);
      if (!pruefzifferStimmt(roh)) return { art: 'offen' };
      const schluessel = vergleichsform(roh);
      lesungen.push({ roh, schluessel, t: jetzt });

      const alle = gruppen();
      const eigene = alle.get(schluessel)!;
      if (!erreicht(eigene, istRisikoform(roh))) return { art: 'offen' };

      const weitere = kandidaten(jetzt).filter(
        (k) => !gleicheGtin(k.nummer, roh) && k.anzahl >= ZWEITER_CODE_AB,
      );
      if (weitere.length > 0) {
        return { art: 'mehrdeutig', nummern: [roh, ...weitere.map((k) => k.nummer)] };
      }
      return { art: 'bestaetigt', nummer: roh };
    },
    kandidaten,
    zuruecksetzen() {
      lesungen = [];
    },
  };
}

/**
 * Nur Nummern, die live mindestens zweimal kamen. Eine einzelne Lesung ist das
 * gemessene Fehlerbild und taugt weder als Vorschlag (lädt zum ungeprüften
 * Übernehmen ein) noch als Widerspruch gegen das Foto.
 */
export function belastbareKandidaten(kandidaten: Kandidat[]): string[] {
  return kandidaten.filter((k) => k.anzahl >= ZWEITER_CODE_AB).map((k) => k.nummer);
}

// ─── Entscheidung nach der Aufnahme ─────────────────────────────────────────

/**
 * Wie die Nummer zu einem fertigen EAN-Foto zustande kommt:
 *  - `bestaetigt`: Live-Lesung bestätigt, Foto automatisch ausgelöst.
 *  - `mehrdeutig`: zwei Codes im Bild, Nutzer wählt.
 *  - `ausloeser`:  Nutzer hat selbst ausgelöst, ohne bestätigte Nummer.
 *  - `eintippen`:  Nutzer hat „Nummer eintippen“ gewählt.
 *  - `galerie`:    Bild aus der Galerie.
 */
export type EanAnlass = 'bestaetigt' | 'mehrdeutig' | 'ausloeser' | 'eintippen' | 'galerie';

export type EanNachfrageGrund = 'abweichung' | 'mehrdeutig' | 'eintippen' | 'unlesbar';

export interface FotoLesung {
  /** Gültige Nummern (Prüfziffer stimmt) auf dem Foto, ohne Doppelte. */
  nummern: string[];
  /** Nachlesen technisch gescheitert (Fehler, Zeitgrenze) — keine Aussage übers Bild. */
  gescheitert: boolean;
}

export type EanEntscheidung =
  | { art: 'uebernehmen'; nummer: string }
  | { art: 'nachfragen'; grund: EanNachfrageGrund; vorschlag: string; vorschlaege: string[] };

function eindeutig(nummern: string[]): string[] {
  const aus: string[] = [];
  for (const n of nummern) {
    if (n && pruefzifferStimmt(n) && !aus.some((a) => gleicheGtin(a, n))) aus.push(n);
  }
  return aus;
}

/**
 * Entscheidet nach der Aufnahme, ob eine Nummer still übernommen wird oder der
 * Nutzer sie bestätigt. Grundsatz: nie OHNE Nummer speichern, wenn eine
 * Abweichung vorliegt (ohne Nummer lehnte der Server oft mit `ean_fehlt` ab),
 * und nie eine einzelne, unbestätigte Lesung still übernehmen, wenn eine
 * andere Quelle widerspricht.
 *
 * @param bestaetigt Live bestätigte Nummer (nur bei Anlass `bestaetigt`).
 * @param live       Belastbare Live-Kandidaten (`belastbareKandidaten`),
 *                   häufigste zuerst; bei `mehrdeutig` die mehrdeutigen Nummern.
 */
export function entscheideEan(args: {
  anlass: EanAnlass;
  bestaetigt?: string | null;
  foto: FotoLesung;
  live: string[];
}): EanEntscheidung {
  const { anlass, foto } = args;
  const fotoNummern = eindeutig(foto.nummern);
  const live = eindeutig(args.live);
  const vorschlaege = (erste: string[]) => eindeutig([...erste, ...fotoNummern, ...live]);

  if (anlass === 'bestaetigt' && args.bestaetigt) {
    const b = args.bestaetigt;
    // Nachlesen gescheitert oder Foto ohne lesbaren Code: bestätigte Nummer
    // behalten — der Server gleicht sie ohnehin gegen das Foto ab.
    if (foto.gescheitert || fotoNummern.length === 0) return { art: 'uebernehmen', nummer: b };
    if (fotoNummern.some((n) => gleicheGtin(n, b))) return { art: 'uebernehmen', nummer: b };
    // Foto liest eine ANDERE Nummer: zum Bestätigen zeigen, vorbefüllt mit
    // der Foto-Lesung (das schärfere Bild, und genau das prüft der Server).
    return {
      art: 'nachfragen',
      grund: 'abweichung',
      vorschlag: fotoNummern[0],
      vorschlaege: vorschlaege([fotoNummern[0], b]),
    };
  }

  if (anlass === 'mehrdeutig') {
    // Liest das Foto genau eine der mehrdeutigen Nummern, ist sie der beste
    // Vorschlag — entscheiden muss trotzdem der Nutzer.
    const treffer = fotoNummern.length === 1 && live.some((n) => gleicheGtin(n, fotoNummern[0]));
    const vorschlag = treffer ? fotoNummern[0] : '';
    return { art: 'nachfragen', grund: 'mehrdeutig', vorschlag, vorschlaege: vorschlaege(live) };
  }

  const bester = fotoNummern[0] ?? live[0] ?? '';
  if (anlass === 'eintippen') {
    return { art: 'nachfragen', grund: 'eintippen', vorschlag: bester, vorschlaege: vorschlaege([]) };
  }

  // `ausloeser` / `galerie`: Genau eine Nummer auf dem Foto und keine
  // widersprechende Live-Lesung → übernehmen (wie bisher beim Galeriebild;
  // eine Live-Lesung derselben Nummer ist eine zweite, unabhängige Quelle).
  if (fotoNummern.length === 1) {
    const f = fotoNummern[0];
    if (live.length === 0 || live.some((n) => gleicheGtin(n, f))) return { art: 'uebernehmen', nummer: f };
    return { art: 'nachfragen', grund: 'abweichung', vorschlag: f, vorschlaege: vorschlaege([f]) };
  }
  if (fotoNummern.length > 1) {
    return { art: 'nachfragen', grund: 'mehrdeutig', vorschlag: '', vorschlaege: vorschlaege([]) };
  }
  return { art: 'nachfragen', grund: 'unlesbar', vorschlag: bester, vorschlaege: vorschlaege([]) };
}

/**
 * Prüfung einer eingetippten Nummer; `null` = in Ordnung. Freundlich und ohne
 * Vorwurf (CLAUDE.md „Copy-Ton“) — ein Zahlendreher passiert jedem.
 */
export function eingabeHinweis(ziffern: string): string | null {
  if (!istGtinForm(ziffern)) {
    return 'Die Nummer unter dem Strichcode hat meist 13 Ziffern, manchmal 8 – magst du sie noch einmal vergleichen?';
  }
  if (!pruefzifferStimmt(ziffern)) {
    return 'Da hat sich wohl eine Ziffer vertauscht – vergleich die Nummer bitte noch einmal mit der unter dem Strichcode.';
  }
  return null;
}
