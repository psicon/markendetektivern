// lib/utils/categoryClassification.ts
//
// Hilfsfunktionen um Kategorien als Lebensmittel oder Non-Food zu
// klassifizieren. Wird auf den Produkt-Detail-Seiten genutzt um
// Inhaltsstoffe / Nährwerte korrekt auszublenden für Produkte, bei
// denen diese Konzepte nicht zutreffen (z.B. Reinigungsmittel,
// Kosmetik, Tiernahrung, Gartenbedarf).
//
// Quelle der Wahrheit ist der Kategorie-Name (Firestore
// `kategorien.bezeichnung`). Eine eigene Flag-Spalte wäre robuster,
// aber die paar Schlüsselbegriffe decken den Bestand zuverlässig ab.
// Wenn neue Non-Food-Kategorien dazukommen, hier ergänzen.

const NON_FOOD_KEYWORDS = [
  'drogerie',
  'haushalt',
  'kosmetik',
  'körperpflege',
  'koerperpflege',
  'mundhygiene',
  'reinigung',
  'wasch',
  'putz',
  'garten',
  'tierfutter',
  'tiernahrung',
  'tierbedarf',
  'baby-pflege',
  'babypflege',
  'hygiene',
  'non-food',
  'nonfood',
];

/**
 * `true` wenn die Kategorie keine Nährwerte / Zutaten haben sollte
 * (Drogerie, Haushalt, Kosmetik, …). Bei Lebensmitteln `false`.
 *
 * Case-insensitive Substring-Match auf einer kuratierten Wortliste.
 * `null`/`undefined`/leerer String → `false` (default zu Lebensmittel,
 * damit ein fehlender Kategorie-String die Tabs nicht versehentlich
 * unterdrückt).
 */
export function isNonFoodCategory(
  bezeichnung: string | null | undefined,
): boolean {
  if (!bezeichnung) return false;
  const lower = String(bezeichnung).toLowerCase();
  return NON_FOOD_KEYWORDS.some((kw) => lower.includes(kw));
}
