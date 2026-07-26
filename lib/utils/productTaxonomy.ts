/**
 * Produkt-Taxonomie — Ober-Domänen und Subkategorien aus dem
 * `catalogProfile` der Katalog-Docs.
 *
 * WOZU: Alternativen-Vorschläge dürfen keine Domänengrenze reißen.
 * Aus echten Bewertungen: „Als passende Alternative zu SOS Herpes
 * Pflastern wird Bio Grüntee Matcha angezeigt", „Frischkäse →
 * Speckknödel". Solche Treffer zerstören das Kernvertrauen der App.
 *
 * WARUM NICHT DIE LEGACY-`kategorie`: die ist bereits als
 * Query-Bedingung aktiv und hat die Reviews NICHT verhindert — 21
 * Kategorien für ~7300 Produkte, „Drogerie & Haushalt" enthält
 * Blasenpflaster, Magentabletten, Geschirr-Reiniger und Batterien als
 * wechselseitig „gültige" Kandidaten. Zusätzlich ist sie teils falsch
 * gepflegt (ein korrekt verknüpftes Käse-Paar hat auf der Marken-Seite
 * „Drogerie & Haushalt"). `catalogProfile` ist deutlich robuster und
 * liegt auf 99,8 % der Docs — wurde im App-Code bisher aber nirgends
 * gelesen (dormantes Asset).
 */

export type ProductDomain = 'food' | 'nonfood' | 'pet' | 'baby';

export type CatalogProfileLike =
  | {
      derivedMainCategoryIds?: string[] | null;
      subCategories?: Array<{ id?: string | null; confidence?: number | null }> | null;
    }
  | null
  | undefined;

export type TaxonomyFacts = {
  domains: ProductDomain[];
  /** Subkategorie-IDs OHNE die unspezifischen Hub-IDs. */
  subIds: string[];
  /** Höchste Confidence zuerst — für Debug/Ranking, nicht fürs Gate. */
  primarySubId: string | null;
};

/**
 * Die 18 Slugs aus `taxonomyMainCategories` (live gelesen 2026-07-25).
 * Neue Slugs müssen hier ergänzt werden — fehlt einer, gilt er als
 * unbekannt und das Gate öffnet (fail-open), verschluckt also keine
 * Produkte, ist dann aber auch wirkungslos.
 */
export const MAIN_CATEGORY_DOMAIN: Readonly<Record<string, ProductDomain>> = {
  alkohol: 'food',
  'baby-und-kind': 'baby',
  'brot-und-backwaren': 'food',
  'butter-und-milch-und-joghurt': 'food',
  drogerie: 'nonfood',
  'fisch-und-meeresfruechte': 'food',
  'fleisch-und-wurst': 'food',
  'fruehstueck-und-kaffee': 'food',
  getraenke: 'food',
  haushalt: 'nonfood',
  kaese: 'food',
  'kuehlregal-und-schnelle-kueche': 'food',
  'oele-saucen-und-gewuerze': 'food',
  'snacks-und-suesses': 'food',
  tierbedarf: 'pet',
  tk: 'food',
  'vegetarisch-und-vegan': 'food',
  'vorratsschrank-kochen-und-backen': 'food',
};

/**
 * Kompatibilitäts-MATRIX, nicht Mengengleichheit: Babyartikel grenzen
 * legitim an beides (Babynahrung ↔ food, Windeln ↔ nonfood), Tierbedarf
 * an nichts (Katzenfutter ist keine Alternative zu Entenbrust — genau
 * dieser Fehltreffer war messbar in den Daten).
 */
export const DOMAIN_COMPATIBILITY: Readonly<
  Record<ProductDomain, readonly ProductDomain[]>
> = {
  food: ['food', 'baby'],
  nonfood: ['nonfood', 'baby'],
  baby: ['baby', 'food', 'nonfood'],
  pet: ['pet'],
};

/**
 * Subkategorien, die quer durch den Katalog liegen und deshalb als
 * Übereinstimmung nichts aussagen. Ohne diese Ausschlussliste winkt
 * z.B. `convenience` (700+ Produkte) halbe Fertiggericht-Welten durch —
 * inklusive „Frischkäse → Speckknödel".
 */
export const HUB_SUBCATEGORY_IDS: ReadonlySet<string> = new Set([
  'convenience',
  'sonstige',
  'others',
  'spezialitaeten',
  'fix-und-fertigprodukte',
  'backen-und-kochen',
]);

/** Liest die Taxonomie-Fakten aus einem (Roh-)Katalog-Doc. */
export function readTaxonomy(
  docLike: { catalogProfile?: CatalogProfileLike } | null | undefined,
): TaxonomyFacts {
  const profile = docLike?.catalogProfile;
  const mains = Array.isArray(profile?.derivedMainCategoryIds)
    ? profile!.derivedMainCategoryIds!
    : [];

  const domains: ProductDomain[] = [];
  for (const m of mains) {
    const d = MAIN_CATEGORY_DOMAIN[String(m ?? '').trim()];
    if (d && !domains.includes(d)) domains.push(d);
  }

  const rawSubs = Array.isArray(profile?.subCategories) ? profile!.subCategories! : [];
  const subIds: string[] = [];
  let primary: { id: string; c: number } | null = null;
  for (const s of rawSubs) {
    const id = String(s?.id ?? '').trim();
    if (!id) continue;
    const c = typeof s?.confidence === 'number' ? s.confidence : 0;
    if (!primary || c > primary.c) primary = { id, c };
    if (HUB_SUBCATEGORY_IDS.has(id)) continue;
    if (!subIds.includes(id)) subIds.push(id);
  }

  return { domains, subIds, primarySubId: primary?.id ?? null };
}

/**
 * Dürfen diese zwei Produkte überhaupt zueinander vorgeschlagen werden?
 *
 * FAIL-OPEN: kennt eine Seite keine einzige Domäne (leeres oder
 * fehlendes Profil — kommt real vor), erlaubt die Funktion den Treffer.
 * Ein hartes Blocken würde Produkte lautlos aus allen Listen entfernen,
 * und lautlos ist der schlimmere Fehler.
 */
export function domainsCompatible(a: TaxonomyFacts, b: TaxonomyFacts): boolean {
  if (a.domains.length === 0 || b.domains.length === 0) return true;
  for (const da of a.domains) {
    const allowed = DOMAIN_COMPATIBILITY[da] ?? [];
    for (const dbb of b.domains) {
      if (allowed.includes(dbb)) return true;
    }
  }
  return false;
}

/** Teilen die beiden eine SPEZIFISCHE (nicht-Hub-)Subkategorie? */
export function sharesSpecificSubCategory(
  a: TaxonomyFacts,
  b: TaxonomyFacts,
): boolean {
  if (a.subIds.length === 0 || b.subIds.length === 0) return false;
  return a.subIds.some((id) => b.subIds.includes(id));
}

/**
 * Domäne aus Freitext (Kategorie-Pfad oder Produktname) — nur für
 * gescannte Fremdprodukte, die kein `catalogProfile` haben. Bewusst
 * konservativ: erkennt es nichts, kommt `null` (⇒ fail-open).
 */
export function domainFromFreeText(text?: string | null): ProductDomain | null {
  const t = String(text ?? '').toLowerCase();
  if (!t.trim()) return null;
  const has = (...needles: string[]) => needles.some((n) => t.includes(n));

  if (has('tierbedarf', 'tiernahrung', 'hundefutter', 'katzenfutter', 'haustier'))
    return 'pet';
  if (has('babynahrung', 'babykost', 'windel', 'baby', 'kleinkind')) return 'baby';

  // Substring-Matching ist hier ABSICHT — deutsche Komposita ("Vollwaschmittel",
  // "Bio-Tiefkühlgemüse") wuerden an Wortgrenzen scheitern. Der Preis dafuer:
  // kurze Staemme duerfen NICHT nackt in der Liste stehen. 'creme' matchte in
  // "SchokoladenCREMEs" / "EisCREME" / "FrischkaeseCREME", 'deo' in "RoDEO" —
  // beides schob Lebensmittel nach nonfood, worauf der Guard passende
  // Alternativen verwarf und stattdessen Drogerie-Artikel durchliess.
  // Darum: mehrdeutige Staemme nur noch als eindeutige Komposita.
  // EXKLUSIV: Stämme, die auch als Kompositum-Bestandteil niemals ein
  // Lebensmittel bezeichnen. Die duerfen sofort entscheiden.
  if (
    has(
      'drogerie', 'kosmetik', 'körperpflege', 'koerperpflege', 'zahnpflege',
      'zahnpasta', 'zahncreme', 'mundspülung', 'mundspuelung', 'shampoo',
      'duschgel', 'sonnenschutz', 'sonnencreme', 'pflaster', 'apotheke',
      'arznei', 'spülmittel', 'spuelmittel', 'waschmittel', 'weichspüler',
      'weichspueler', 'müllbeutel', 'muellbeutel', 'batterie',
      'toilettenpapier', 'küchenrolle', 'kuechenrolle', 'rasier',
      'handcreme', 'gesichtscreme', 'hautcreme', 'tagescreme', 'nachtcreme',
      'rasiercreme', 'fußcreme', 'fusscreme', 'wundcreme', 'bodylotion',
      'deodorant', 'deospray', 'deoroller', 'deostick',
    )
  )
    return 'nonfood';

  // MEHRDEUTIG: taucht auch in Lebensmittel-Komposita auf
  // ("HAUSHALTszucker", "ReinigungsMILCH").
  const nonfoodWeak = has(
    'haushalt', 'hygiene', 'reinig', 'putz', 'seife', 'medizin',
    'nahrungsergänzung', 'nahrungsergaenzung',
  );
  const food = has(
    'lebensmittel', 'getränk', 'getraenk', 'obst', 'gemüse', 'gemuese',
    'fleisch', 'wurst', 'käse', 'kaese', 'milch', 'joghurt', 'brot',
    'backwaren', 'süß', 'suess', 'snack', 'kaffee', 'tee', 'schokolade',
    'nudeln', 'pasta', 'reis', 'konserve', 'tiefkühl', 'tiefkuehl',
    'aufstrich', 'nougat', 'sahne', 'quark', 'butter', 'pudding', 'dessert',
    'eiscreme', 'speiseeis', 'müsli', 'muesli', 'saft', 'gewürz', 'gewuerz',
    'fisch', 'suppe', 'soße', 'sosse', 'marmelade', 'honig', 'schoko',
    'zucker', 'mehl',
  );

  // Beide Welten getroffen ⇒ Domaene nicht sicher bestimmbar. Dann lieber
  // null: null ist fail-open (domainsCompatible laesst durch), eine falsch
  // geratene Domaene verwirft dagegen legitime Alternativen.
  if (nonfoodWeak && food) return null;
  if (nonfoodWeak) return 'nonfood';
  if (food) return 'food';
  return null;
}
