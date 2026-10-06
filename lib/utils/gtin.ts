/**
 * GTIN-Helfer für die App (EAN-8, UPC-A/EAN-12, EAN-13, GTIN-14).
 *
 * Anlass (06.10.2026): Android übernahm im Foto-Assistenten die erste
 * Barcode-Lesung ungeprüft — 5,9 % der lesbaren Barcode-Fotos trugen eine
 * falsche Nummer. Diese Helfer sind die Grundlage der Mehrfachbestätigung
 * (`barcodeBestaetigung.ts`) und der Prüfung der eingetippten Nummer.
 *
 * Wichtig: `vergleichsform` dient NUR dem Vergleich. Gespeichert und
 * abgefragt wird weiter die Nummer so, wie sie gelesen bzw. eingetippt wurde
 * — die Katalogsuche (`FirestoreService.searchProductsByEAN`) fragt exakt
 * diese Schreibweise ab, eine stille Umformung änderte deren Treffer.
 */

const GUELTIGE_LAENGEN = new Set([8, 12, 13, 14]);

/** Nur Ziffern, Länge 8/12/13/14. Sagt nichts über die Prüfziffer. */
export function istGtinForm(code: string): boolean {
  const d = (code ?? '').trim();
  return /^\d+$/.test(d) && GUELTIGE_LAENGEN.has(d.length);
}

/**
 * GS1-Prüfziffer (Modulo 10, Gewichte 3/1 von rechts, die Prüfziffer selbst
 * ausgenommen). Gilt für alle GTIN-Längen gleich.
 */
export function pruefzifferStimmt(code: string): boolean {
  const d = (code ?? '').trim();
  if (!istGtinForm(d)) return false;
  let summe = 0;
  for (let i = d.length - 2, gewicht = 3; i >= 0; i--, gewicht = gewicht === 3 ? 1 : 3) {
    summe += Number(d[i]) * gewicht;
  }
  return (10 - (summe % 10)) % 10 === Number(d[d.length - 1]);
}

/**
 * Einheitliche Form NUR für den Vergleich: UPC-A (12) = EAN-13 mit führender 0,
 * GTIN-14 mit führender 0 = EAN-13. Nötig, weil expo-camera auf dem iPhone die
 * führende 0 eines EAN-13 streicht, Apple Vision und ML Kit sie aber liefern.
 */
export function vergleichsform(code: string): string {
  const d = (code ?? '').trim();
  if (d.length === 12) return `0${d}`;
  if (d.length === 14 && d.startsWith('0')) return d.slice(1);
  return d;
}

/** Dieselbe Nummer, unabhängig von 12/13/14-stelliger Schreibweise. */
export function gleicheGtin(a: string, b: string): boolean {
  return vergleichsform(a) === vergleichsform(b);
}

/**
 * Vergebene GS1-Länderpräfixe (3-stellig, GTIN-13) ab 140, Stand GS1-Liste
 * 2024. Dieselbe Liste wie in der Untersuchung vom 06.10.2026 (dort
 * „nicht vergebenes Präfix“). Ungenauigkeiten kosten nur Tempo, nie eine
 * Nummer: ein fälschlich als „nicht vergeben“ gewertetes Präfix verlangt
 * lediglich mehr gleiche Lesungen.
 */
const VERGEBEN: ReadonlyArray<readonly [number, number]> = [
  [200, 299], // Ladencodes / lose Ware (gültig, Entscheidung 20.09.2026)
  [300, 380], [383, 383], [385, 385], [387, 387], [389, 390],
  [400, 440], [450, 471], [474, 509],
  [520, 521], [528, 531], [535, 535], [539, 549], [560, 560], [569, 579],
  [590, 590], [594, 594], [599, 601], [603, 604], [608, 609], [611, 611],
  [613, 613], [615, 631], [640, 649], [680, 681], [690, 709], [729, 746],
  [750, 750], [754, 755], [759, 771], [773, 773], [775, 775], [777, 780],
  [784, 784], [786, 786], [789, 790], [800, 850], [858, 860], [865, 865],
  [867, 881], [883, 885], [888, 888], [890, 890], [893, 894], [896, 896],
  [899, 919], [930, 951], [955, 955], [958, 958], [960, 969], [977, 999],
];

function praefixVergeben(p: number): boolean {
  return VERGEBEN.some(([von, bis]) => p >= von && p <= bis);
}

/**
 * Formen, unter denen in den Felddaten fast nur Fehllesungen vorkamen und die
 * deshalb MEHR gleiche Lesungen brauchen (gemessen 06.10.2026: 36 von 36
 * gespeicherten 12-stelligen Android-Nummern waren falsch; unter den
 * bestätigten Nummern hatte 0,1 % dieses Muster):
 *  - 12-stellig (UPC-A — in Deutschland praktisch nicht im Handel),
 *  - 8-stellig (EAN-8: echt bei Eigenmarken, aber auch Teil-Lesung eines EAN-13),
 *  - Präfix 000–139 (USA/Kanada, Coupons, interne 02/04-Codes),
 *  - nicht vergebenes Präfix.
 * „Risiko“ heißt nie „ungültig“ — die Nummer wird nur strenger bestätigt.
 */
export function istRisikoform(code: string): boolean {
  const d = (code ?? '').trim();
  if (d.length === 8 || d.length === 12) return true;
  const f = vergleichsform(d);
  if (f.length !== 13) return false;
  const p = Number(f.slice(0, 3));
  if (p <= 139) return true;
  return !praefixVergeben(p);
}
