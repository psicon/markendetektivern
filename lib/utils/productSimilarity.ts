/**
 * Namens-Ähnlichkeit von Produkten (Tokenisierung + Score).
 *
 * Hierher VERSCHOBEN aus `lib/services/firestore.ts` (nicht kopiert),
 * damit der Alternativen-Guard dieselbe Tokenisierung nutzt und es
 * keine zweite Wahrheit gibt (Drift-Regel aus CLAUDE.md). Reines
 * Modul: keine RN-/Firestore-Imports, damit es testbar bleibt.
 */

const PRODUCT_NAME_STOPWORDS = new Set([
  // Artikel + Bindewörter (deutsch)
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einer', 'einem', 'einen', 'eines',
  'mit', 'und', 'oder', 'für', 'aus', 'auf', 'in', 'im',
  'zu', 'zum', 'zur', 'an', 'am', 'auch',
  'von', 'vom', 'bei', 'beim', 'als',
  // Generische Marketing-Worte die in vielen Produktnamen
  // auftauchen ohne tatsächliche Produktinformation. Beim Stufe-3-
  // Vergleich helfen sie nicht und verzerren das Score.
  'beste', 'wahl', 'gut', 'gold', 'select', 'premium',
  'feinkost',
  // Generische Qualifizierer. KRITISCH fuer `hasStrongNameSignal`: das
  // Gate akzeptiert JEDEN exakten Token-Match, also machte ein geteiltes
  // "bio" aus "Bio Ziegenfrischkaese" und "Bio Speckknoedel" ein
  // vermeintlich hartes Signal — exakt die Klasse absurder Vorschlaege,
  // die der Guard verhindern soll. Keines dieser Worte benennt eine
  // Produktart, sie duerfen darum weder Gate noch Ranking tragen.
  'bio', 'öko', 'oeko', 'demeter', 'vegan', 'vegetarisch',
  'natur', 'naturell', 'classic', 'klassisch', 'original', 'traditionell',
  'neu', 'extra', 'plus', 'pur', 'mild', 'fein', 'zart', 'lecker',
  'family', 'familien', 'groß', 'gross', 'klein', 'mini', 'maxi',
  'packung', 'stück', 'stueck', 'portion', 'sorte', 'sorten',
  'regional', 'nachhaltig', 'hausgemacht', 'qualität', 'qualitaet',
]);

/**
 * Mengen-/Größenangaben ("400g", "1l", "6er", "250"). Zwei beliebige
 * Produkte teilen sich die Packungsgröße staendig — als exakter
 * Token-Match hat das `hasStrongNameSignal` faelschlich ausgeloest.
 * Bewusst eng: nur Ziffern plus optionale bekannte Einheit, damit
 * Namensbestandteile wie "7up" erhalten bleiben.
 */
const MEASUREMENT_TOKEN =
  /^\d+([.,]\d+)?(g|kg|mg|ml|cl|dl|l|st|stk|stueck|stück|er|x|prozent)?$/;

export { PRODUCT_NAME_STOPWORDS };

export function tokenizeProductName(
  name: string,
  handelsmarkeName?: string | null,
): string[] {
  if (!name) return [];
  const cleaned = String(name)
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Handelsmarken-Tokens entfernen — sonst matchen z.B. zwei "REWE
  // Beste Wahl"-Produkte sich gegenseitig nur über die Marke statt
  // über den Inhalt.
  const hmTokens = new Set<string>();
  if (handelsmarkeName) {
    String(handelsmarkeName)
      .toLowerCase()
      .replace(/[^a-zäöüß0-9\s-]/g, ' ')
      .replace(/-/g, ' ')
      .split(/\s+/)
      .forEach((t) => {
        if (t) hmTokens.add(t);
      });
  }
  return cleaned
    .split(' ')
    .filter(
      (t) =>
        t.length >= 3 &&
        !PRODUCT_NAME_STOPWORDS.has(t) &&
        !MEASUREMENT_TOKEN.test(t) &&
        !hmTokens.has(t),
    );
}

/**
 * Weiches RANKING-Score (nicht als Gate benutzen!). Exakter
 * Token-Match +2, Substring-Stem-Match +1.
 */
export function scoreNameSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let score = 0;
  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb) {
        score += 2; // exakter Token-Match (z.B. "toastbrot" == "toastbrot")
      } else if (ta.length >= 4 && tb.length >= 4) {
        // Substring-Stem-Match: "toast" inside "toastbrot",
        // "brot" inside "toastbrot". Mindest-Länge 4 vermeidet
        // dass "ml" / "kg" / "g" usw. Lärm produzieren.
        if (ta.includes(tb) || tb.includes(ta)) score += 1;
      }
    }
  }
  return score;
}

/**
 * HARTES Signal „das ist dieselbe Produktart" — als Gate gedacht,
 * strenger als `scoreNameSimilarity`.
 *
 * Zwei Wege: exakter Token-Match, oder Compound-Match, bei dem das
 * KÜRZERE Token mindestens 5 Zeichen hat und Präfix/Suffix des
 * längeren ist ("knöpfle" ⊂ "eierknöpfle" ✓).
 *
 * Die 5-Zeichen-Schwelle ist der Unterschied zum Ranking-Score: dort
 * genügen 4 Zeichen und beliebige Substring-Lage — damit gilt "käse"
 * ⊂ "butterkäse" als Treffer, was für ein Gate zu grob ist (jedes
 * Käseprodukt wäre Alternative zu jedem anderen). "frischkäse" ⊂
 * "ziegenfrischkäse" greift dagegen weiter.
 */
export function hasStrongNameSignal(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  for (const ta of a) {
    for (const tb of b) {
      if (ta === tb) return true;
      const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
      if (short.length >= 5 && (long.startsWith(short) || long.endsWith(short))) {
        return true;
      }
    }
  }
  return false;
}
