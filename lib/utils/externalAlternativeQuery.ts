/**
 * Alternativen-Suche für GESCANNTE FREMDPRODUKTE (nicht im Katalog).
 *
 * Hierher extrahiert aus `app/external-product/[ean].tsx` — dort war die
 * Logik inline und damit untestbar (`jest` scannt nur `lib/`).
 *
 * ANLASS: Die alte Kaskade erzeugte die in Bewertungen zitierten
 * Absurditäten. Live gegen den Produktions-Index reproduziert:
 *   „Garnier Mineral Deo Roll-On"  → über Token „mineral" → 6× Mineralwasser
 *   „Elmex Kinder-Zahnpasta"       → über Token „kinder"  → Apfelsaft, Nektar
 *   „Scholl Fußschutz Spray"       → über Token „spray"   → Haarspray
 *   „NIVEA Sun Schutz & Pflege"    → über Token „schutz"  → Mundspülung
 *
 * URSACHE, zwei Teile:
 *  1. Ein Query pro EINZELWORT (≥4 Zeichen), und das ERSTE Wort mit
 *     irgendeinem Treffer „gewann" — unabhängig davon, ob die Treffer
 *     zur Produktart passten. Kurze Allerwelts-Tokens („mineral",
 *     „kinder", „active", „spray") gewinnen dabei systematisch gegen das
 *     eigentliche Produktwort.
 *  2. Ein „Last Resort", der am Ende den vollen Originalnamen INKLUSIVE
 *     Markenname suchte — reines Rauschen.
 *
 * LÖSUNG, zwei bewusst getrennte Ebenen:
 *  • RETRIEVAL (`buildAlternativeQueries`): spezifischere Tokens zuerst
 *    (längstes Wort = meist das Produktart-Compound wie
 *    „joghurtalternative", „zahnpasta", „fußschutz"), generische Wörter
 *    als Query-Token gesperrt, Last-Resort weg, Anzahl gedeckelt.
 *  • PRECISION (`filterExternalAlternatives`): jeder Treffer muss den
 *    Plausibilitäts-Guard passieren. Das ist die tragende Schicht — ein
 *    Query darf nur „gewinnen", wenn er PLAUSIBLE Treffer liefert, nicht
 *    schon wenn er irgendwelche liefert.
 *
 * Warum die Einzelwort-Stufe NICHT einfach entfällt: der Algolia-Index
 * läuft mit `removeWordsIfNoResults: 'none'`, ein mehrwortiger Query
 * verlangt also ALLE Wörter. Ohne Einzelwort-Stufe fänden wir für
 * längere Produktnamen praktisch nie etwas — wir hätten „Unsinn" gegen
 * „leer" getauscht.
 */

import {
  judgeAlternative,
  rankAlternatives,
  type PlausibilityInput,
} from './alternativePlausibility';
import {
  domainFromFreeText,
  domainsCompatible,
  readTaxonomy,
} from './productTaxonomy';
import {
  hasStrongNameSignal,
  scoreNameSimilarity,
  tokenizeProductName,
} from './productSimilarity';

/**
 * Generische Wörter ohne Produktart-Bedeutung.
 *
 * Zusätzlich zur ursprünglichen Liste jetzt die Token, die die
 * Fehltreffer nachweislich erzeugt haben: sie beschreiben Eigenschaft,
 * Zielgruppe oder Darreichungsform — und sind gleichzeitig als
 * eigenständige Produktnamen verbreitet (Mineralwasser,
 * Kinderschokolade, Active Drink, Haarspray …).
 */
export const EXTERNAL_QUERY_STOPWORDS: ReadonlySet<string> = new Set([
  'mit', 'ohne', 'und', 'oder', 'aus', 'für', 'fur', 'im', 'in', 'der', 'die', 'das',
  'vegan', 'vegetarisch', 'natur', 'classic', 'original', 'light', 'mini',
  'plus', 'extra', 'pur', 'pure', 'fein', 'feine', 'frisch', 'echt',
  'g', 'kg', 'ml', 'l', 'cl', 'stk', 'stück', 'st',
  'bio', 'eco', 'premium', 'soft', 'hart', 'cremig',
  // ─── 2026-07 ergänzt: belegte Fehltreffer-Generatoren ───
  'mineral',          // → Mineralwasser
  'kinder',           // → Kinder-Süßwaren, Kindersäfte
  'active', 'activ',  // → Active Drink, Activ-Schorle, Active Kaugummi
  'spray',            // → Haarspray, Sonnenspray
  'schutz',           // → Insektenschutz, Zahnfleischschutz
  'sensitive', 'sensitiv', 'intensive', 'intensiv',
  'complete', 'komplett', 'total', 'fresh', 'frische',
  'protect', 'care', 'clean', 'power', 'energy',
  // Darreichungsform / Verpackung — nie die Produktart
  'gel', 'creme', 'cream', 'lotion', 'balsam',
  'roll', 'stick', 'pumpe', 'flasche', 'dose', 'packung', 'beutel',
  'family', 'familie', 'value', 'vorteilspack', 'doppelpack',
]);

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Markenwörter + Packungsgrößen aus dem Namen entfernen — Marken tauchen
 * in Eigenmarken-Namen praktisch nie auf, würden also jede Suche
 * blockieren.
 */
export function stripBrandFromName(raw: string, brand?: string | null): string {
  let s = String(raw ?? '').toLowerCase();
  if (brand) {
    const brandWords = String(brand)
      .toLowerCase()
      .split(/[,\s]+/)
      .filter((w) => w.length >= 3);
    for (const bw of brandWords) {
      s = s.replace(new RegExp(`\\b${escapeRegex(bw)}\\b`, 'gi'), ' ');
    }
  }
  // Pack-Size-Suffixe ("400g", "1l", "6×0,5l") wegnehmen
  s = s.replace(/\b\d+\s*[×x]?\s*\d*\s*(g|kg|ml|l|cl|stk|stück|st)\b/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Signifikante Wörter (≥4 Zeichen, keine Stopwords, nicht numerisch). */
export function significantWords(s: string): string[] {
  return String(s ?? '')
    .toLowerCase()
    .split(/[\s,;:\-_/()]+/)
    .map((w) => w.trim())
    .filter(
      (w) => w.length >= 4 && !EXTERNAL_QUERY_STOPWORDS.has(w) && !/^\d/.test(w),
    );
}

/** Wie viele Einzelwort-Queries maximal versucht werden. */
export const MAX_WORD_QUERIES = 3;

/**
 * Kategorie-Segmente, die zu breit sind, um als Query zu taugen — sie
 * wuerden praktisch den halben Katalog als "thematisch passend"
 * ausweisen.
 */
export const BROAD_CATEGORY_SEGMENTS: ReadonlySet<string> = new Set([
  'lebensmittel', 'drogerie', 'haushalt', 'sonstiges', 'sonstige',
  'produkte', 'alle', 'shop', 'angebote', 'food', 'nonfood', 'non-food',
]);

/**
 * Ein Query plus die Info, WORAUS er entstand.
 *
 * Das ist nicht Kosmetik: der Pruef-Maßstab haengt davon ab.
 * - `name`: der Query kommt aus dem Produktnamen → ein Treffer muss ein
 *   Namens-Signal haben, sonst ist er geraten.
 * - `category`: der Query IST die Kategorie → Treffer sind per
 *   Konstruktion thematisch passend, ein zusaetzliches Namens-Signal
 *   waere die falsche Huerde. Real gemessen: „Haribo Goldbaeren" fand so
 *   nichts, obwohl Fruchtgummi genau richtig ist; „Zahnpasta" scheiterte
 *   daran, dass Eigenmarken „Zahncreme" heissen.
 */
export type AlternativeQuery = { q: string; kind: 'name' | 'category' };

/**
 * Query-Kaskade, in Reihenfolge der Spezifität.
 *
 * 1. Markenfreier Gesamtname (präzisester Treffer, wenn er greift)
 * 2. Einzelne Produktwörter — LÄNGSTES ZUERST. Das lange Compound ist
 *    fast immer die Produktart („joghurtalternative", „zahnpasta"),
 *    während die kurzen Tokens die Fehltreffer erzeugten. Gedeckelt.
 * 3. Letztes Segment der Quell-Kategorie (grob, aber thematisch).
 *
 * KEIN Last-Resort mit dem markenhaltigen Originalnamen mehr.
 */
export function buildAlternativeQueries(input: {
  productName?: string | null;
  brandName?: string | null;
  category?: string | null;
}): AlternativeQuery[] {
  const name = String(input.productName ?? '').trim();
  if (!name) return [];

  const queries: AlternativeQuery[] = [];
  const push = (q: string | null | undefined, kind: 'name' | 'category') => {
    const v = String(q ?? '').trim();
    if (v.length >= 3 && !queries.some((x) => x.q === v)) queries.push({ q: v, kind });
  };

  const brandStripped = stripBrandFromName(name, input.brandName);
  if (brandStripped && brandStripped !== name.toLowerCase()) push(brandStripped, 'name');

  const words = significantWords(brandStripped || name)
    // Längstes zuerst; bei Gleichstand die ursprüngliche Reihenfolge
    // (stabil, damit die Query-Liste testbar bleibt).
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w.length - a.w.length || a.i - b.i)
    .slice(0, MAX_WORD_QUERIES)
    .map((x) => x.w);
  words.forEach((w) => push(w, 'name'));

  const lastCat = String(input.category ?? '')
    .split(/[›>,|/]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .pop();
  if (lastCat && lastCat.length >= 3 && !BROAD_CATEGORY_SEGMENTS.has(lastCat.toLowerCase())) {
    push(lastCat, 'category');
  }

  return queries;
}

/**
 * Ein repräsentativer Main-Category-Slug pro Domäne — nur dazu da, die
 * geschätzte Domäne in dieselbe Guard-Struktur zu bringen, die der
 * Katalog nutzt. Bewusst OHNE Sub-Signal (die Schätzung ist zu grob).
 */
const DOMAIN_PROBE_MAIN: Record<'food' | 'nonfood' | 'pet' | 'baby', string> = {
  food: 'vorratsschrank-kochen-und-backen',
  nonfood: 'drogerie',
  pet: 'tierbedarf',
  baby: 'baby-und-kind',
};

/**
 * Generische Wörter aus einem Namen entfernen, BEVOR der Guard urteilt.
 *
 * Warum nur auf diesem Pfad: einem Fremdprodukt fehlen Subkategorien,
 * der Guard kann hier also nur über das Namens-Signal entscheiden — und
 * das darf dann nicht an Darreichungsform-Wörtern hängen. Ohne diesen
 * Schritt gilt „Scholl Fußschutz SPRAY" → „HaarSPRAY" als starkes Signal
 * (5-Zeichen-Suffix, gleiche Domäne) und der Fehltreffer bliebe stehen.
 * Mit dem Schritt bleibt links „fußschutz", rechts „haarspray" — kein
 * Signal, korrekt verworfen.
 *
 * Legitime Treffer überleben, weil ihr Signal auf der PRODUKTART liegt:
 * „Joghurtalternative Soja" ↔ „Soja-Joghurt" matcht über „soja".
 */
export function stripGenericWords(name?: string | null): string {
  return String(name ?? '')
    .split(/[\s,;:\-_/()]+/)
    .filter((w) => {
      const t = w.trim().toLowerCase();
      return t.length > 0 && !EXTERNAL_QUERY_STOPWORDS.has(t);
    })
    .join(' ')
    .trim();
}

/**
 * Quell-„Profil" für ein Fremdprodukt. Es hat kein `catalogProfile`,
 * also wird die Domäne aus Kategorie-Freitext und Name geschätzt —
 * Kategorie zuerst, weil sie verlässlicher ist.
 */
export function externalSourceAsPlausibilityInput(input: {
  productName?: string | null;
  brandName?: string | null;
  category?: string | null;
}): PlausibilityInput {
  const domainHint =
    domainFromFreeText(input.category) ?? domainFromFreeText(input.productName);
  return {
    name: stripGenericWords(
      stripBrandFromName(String(input.productName ?? ''), input.brandName),
    ),
    handelsmarkeName: null,
    // Kein Hint ⇒ kein Profil ⇒ fail-open; dann entscheidet allein das
    // Namens-Signal (das durch stripGenericWords bereits streng ist).
    catalogProfile: domainHint
      ? { derivedMainCategoryIds: [DOMAIN_PROBE_MAIN[domainHint]], subCategories: [] }
      : null,
  };
}

/**
 * BILLIGER Vorfilter, der OHNE Firestore-Read arbeitet.
 *
 * Warum das nichts verliert (wichtig, nicht wegoptimieren):
 * `judgeAlternative` akzeptiert auf zwei Wegen — gemeinsame spezifische
 * Subkategorie ODER Namens-Signal bei kompatibler Domäne. Ein
 * Fremdprodukt hat aber NIE Subkategorien (`externalSourceAsPlausibility
 * Input` setzt sie leer bzw. gar kein Profil), und
 * `sharesSpecificSubCategory` gibt bei einer leeren Seite immer `false`
 * zurück. Auf DIESEM Pfad ist das Namens-Signal also notwendige
 * Bedingung — wer es nicht hat, wird ohnehin verworfen.
 *
 * Nutzen: die Anreicherung (ein Firestore-Read pro Treffer, nur dafür
 * gebraucht, um das `catalogProfile` für den Domänen-Check zu holen)
 * läuft nur noch für die Kandidaten, die überhaupt eine Chance haben.
 * Statt bis zu 12 Reads pro Query typischerweise 0–3.
 */
export function preFilterByNameSignal<T extends { name?: string | null }>(
  source: {
    productName?: string | null;
    brandName?: string | null;
  },
  candidates: readonly T[],
): T[] {
  const srcTokens = tokenizeProductName(
    stripGenericWords(
      stripBrandFromName(String(source.productName ?? ''), source.brandName),
    ),
  );
  if (srcTokens.length === 0) return [];
  return candidates.filter((c) =>
    hasStrongNameSignal(srcTokens, tokenizeProductName(stripGenericWords(c.name))),
  );
}

/**
 * Kandidaten eines Fremdprodukt-Queries filtern und ranken.
 *
 * Die Kandidaten sollten VORHER angereichert sein (Firestore-Doc), sonst
 * fehlt ihr `catalogProfile` und es entscheidet nur das Namens-Signal.
 *
 * Beurteilt wird auf einer KOPIE mit bereinigtem Namen; zurückgegeben
 * werden die Original-Objekte (die UI braucht den echten Namen).
 */
export function filterExternalAlternatives<T extends PlausibilityInput>(
  source: {
    productName?: string | null;
    brandName?: string | null;
    category?: string | null;
  },
  candidates: readonly T[],
  limitCount: number,
): T[] {
  const src = externalSourceAsPlausibilityInput(source);
  type Wrapped = PlausibilityInput & { __orig: T };
  const wrapped: Wrapped[] = candidates.map((c) => ({
    ...c,
    name: stripGenericWords(c.name),
    __orig: c,
  }));
  return rankAlternatives(src, wrapped, limitCount, 'discovery').map((w) => w.__orig);
}

/** Einzelurteil — für Debug/Tests. */
export function judgeExternalAlternative<T extends PlausibilityInput>(
  source: {
    productName?: string | null;
    brandName?: string | null;
    category?: string | null;
  },
  candidate: T,
) {
  return judgeAlternative(
    externalSourceAsPlausibilityInput(source),
    { ...candidate, name: stripGenericWords(candidate.name) },
    'discovery',
  );
}

/**
 * Filter für die KATEGORIE-Stufe: akzeptiert auf Domänen-Kompatibilität
 * allein, ohne Namens-Signal.
 *
 * Begründung (an echten Daten gemessen): kommt der Query aus der
 * Kategorie des gescannten Produkts, sind die Treffer per Konstruktion
 * thematisch passend. Ein zusätzliches Namens-Signal zu verlangen
 * scheitert dann an bloßen Vokabular-Unterschieden — „Zahnpasta" findet
 * die Eigenmarken-„Zahncreme" nicht, „Goldbären" nicht das
 * „Fruchtgummi". Beides sind genau die Alternativen, die der Nutzer
 * sucht.
 *
 * SICHERHEITSBEDINGUNG: Das darf nur laufen, wenn die Quell-Domäne
 * BEKANNT ist. Ohne Domäne wäre „nur Domäne prüfen" gleichbedeutend mit
 * „alles akzeptieren" (fail-open) — dann würde die Kategorie-Stufe genau
 * den Müll zurückbringen, den wir gerade abgestellt haben. Der Aufrufer
 * prüft das über `hasKnownDomain`.
 */
export function filterExternalByDomainOnly<T extends PlausibilityInput>(
  source: {
    productName?: string | null;
    brandName?: string | null;
    category?: string | null;
  },
  candidates: readonly T[],
  limitCount: number,
): T[] {
  const src = externalSourceAsPlausibilityInput(source);
  const srcFacts = readTaxonomy(src);
  if (srcFacts.domains.length === 0) return []; // kein Blindflug

  const srcTokens = tokenizeProductName(src.name ?? '');
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : null;
  };

  // Domäne ist das GATE, der Namens-Score nur die REIHENFOLGE. Ohne das
  // Sortieren kam bei „Zahnpasta" die Zahnbürste vor der Zahncreme —
  // beides in der Kategorie, aber nur eines ist die Alternative.
  return candidates
    .filter((c) => domainsCompatible(srcFacts, readTaxonomy(c)))
    .map((c) => ({
      c,
      score: scoreNameSimilarity(srcTokens, tokenizeProductName(stripGenericWords(c.name))),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const sa = num(a.c.stufe) ?? 0;
      const sb = num(b.c.stufe) ?? 0;
      if (sb !== sa) return sb - sa;
      const pa = num(a.c.preis);
      const pb = num(b.c.preis);
      if (pa !== null && pb !== null && pa !== pb) return pa - pb;
      return String(a.c.id ?? '').localeCompare(String(b.c.id ?? ''));
    })
    .slice(0, limitCount)
    .map((x) => x.c);
}

/** Ist die Quell-Domäne überhaupt bestimmbar? (Gate für die Kategorie-Stufe.) */
export function hasKnownDomain(source: {
  productName?: string | null;
  category?: string | null;
}): boolean {
  return (
    (domainFromFreeText(source.category) ?? domainFromFreeText(source.productName)) !==
    null
  );
}
