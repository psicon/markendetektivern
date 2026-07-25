/**
 * Plausibilitäts-Guard für Produkt-Alternativen.
 *
 * ANLASS (echte Bewertungen, wörtlich): „Als passende Alternative zu SOS
 * Herpes Pflastern wird z.B. Bio Grüntee Matcha angezeigt", „Dörffler
 * Ragout Fin, Alternative (3) ja Klassik Geschirr Reiniger Tabs",
 * Frischkäse → „Speckknödel". Diese Treffer werden in Bewertungen
 * ZITIERT und kosten uns den Kernnutzen-Kredit.
 *
 * URSACHE (gemessen, nicht vermutet): die Discovery-Liste rankte nur
 * nach Namens-Score, ohne Mindestschwelle, mit `Math.random()` als
 * Tiebreaker — an echten Kategorie-Pools nachgerechnet hatten 43 % der
 * ausgelieferten Karten Score 0, waren also aus der Kategorie
 * gewürfelt.
 *
 * ZWEI MODI, weil die Datenlage unterschiedlich ist:
 *
 *  • `discovery` — algorithmisch erzeugte Vorschläge (Kategorie-Pool,
 *    Algolia-Suche). Hier gilt Beweislast UMGEKEHRT: es wird nur
 *    gezeigt, was sich positiv qualifiziert.
 *      accept ⇔ gemeinsame spezifische Subkategorie
 *               ODER (starkes Namens-Signal UND kompatible Domäne)
 *
 *  • `curated` — handgepflegte `markenProdukt`-Verknüpfungen. Die sind
 *    überwiegend korrekt; hier nur die groben Domänenbrüche abfangen,
 *    sonst würden richtige Links zerstört (belegt: ein korrektes
 *    Käse-Paar, dessen Marken-Seite fälschlich „Drogerie & Haushalt"
 *    als Legacy-Kategorie trägt).
 *      reject ⇔ Domänen inkompatibel UND keine Sub-Überschneidung
 *               UND kein Namens-Signal UND Legacy-Kategorien verschieden
 */

import {
  domainsCompatible,
  readTaxonomy,
  sharesSpecificSubCategory,
  type CatalogProfileLike,
} from './productTaxonomy';
import {
  hasStrongNameSignal,
  scoreNameSimilarity,
  tokenizeProductName,
} from './productSimilarity';

export type PlausibilityInput = {
  id?: string;
  name?: string | null;
  handelsmarkeName?: string | null;
  catalogProfile?: CatalogProfileLike;
  kategorieId?: string | null;
  stufe?: number | string | null;
  preis?: number | null;
};

export type PlausibilityReason =
  // akzeptiert
  | 'shared-subcategory'
  | 'name-signal'
  | 'no-profile'
  | 'legacy-category'
  // abgelehnt
  | 'domain-mismatch'
  | 'no-signal';

export type PlausibilityVerdict = {
  ok: boolean;
  reason: PlausibilityReason;
  /** Ranking-Score (Namens-Ähnlichkeit) — nur zum Sortieren. */
  score: number;
};

export function judgeAlternative(
  source: PlausibilityInput,
  candidate: PlausibilityInput,
  mode: 'discovery' | 'curated',
): PlausibilityVerdict {
  const ta = readTaxonomy(source);
  const tb = readTaxonomy(candidate);

  const tokensA = tokenizeProductName(source.name ?? '', source.handelsmarkeName);
  const tokensB = tokenizeProductName(
    candidate.name ?? '',
    candidate.handelsmarkeName,
  );
  const score = scoreNameSimilarity(tokensA, tokensB);

  const sharedSub = sharesSpecificSubCategory(ta, tb);
  const nameSignal = hasStrongNameSignal(tokensA, tokensB);
  const domainsOk = domainsCompatible(ta, tb);

  if (mode === 'curated') {
    // Nur den groben Bruch abfangen. Alles, was irgendein Signal hat,
    // bleibt — die Links sind redaktionelle Arbeit.
    if (domainsOk) return { ok: true, reason: 'no-profile', score };
    if (sharedSub) return { ok: true, reason: 'shared-subcategory', score };
    if (nameSignal) return { ok: true, reason: 'name-signal', score };
    if (
      source.kategorieId &&
      candidate.kategorieId &&
      source.kategorieId === candidate.kategorieId
    ) {
      // Menschliches Veto gegen KI-Fehlklassifikation im Profil.
      return { ok: true, reason: 'legacy-category', score };
    }
    return { ok: false, reason: 'domain-mismatch', score };
  }

  // discovery
  if (sharedSub) return { ok: true, reason: 'shared-subcategory', score };
  if (nameSignal && domainsOk) return { ok: true, reason: 'name-signal', score };
  if (!domainsOk) return { ok: false, reason: 'domain-mismatch', score };
  // Kompatible Domäne, aber weder Subkategorie noch Namens-Signal:
  // genau die 43-%-Würfelklasse. Fehlen BEIDEN Seiten die Profile,
  // bliebe nur Raten — dann lieber nichts zeigen als Unsinn.
  return { ok: false, reason: 'no-signal', score };
}

/**
 * Kandidaten filtern und deterministisch ranken.
 *
 * KEIN `Math.random()`-Tiebreaker mehr: bei Score-Gleichstand erzeugte
 * er den Eindruck „bei jedem Besuch neuer Unsinn" und machte die Liste
 * untestbar. Stattdessen stabil nach Score, Stufe, Preis, ID.
 */
export function rankAlternatives<T extends PlausibilityInput>(
  source: PlausibilityInput,
  candidates: readonly T[],
  limitCount: number,
  mode: 'discovery' | 'curated',
): T[] {
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(n) ? n : null;
  };

  const kept = candidates
    .map((item) => ({ item, verdict: judgeAlternative(source, item, mode) }))
    .filter((x) => x.verdict.ok);

  kept.sort((a, b) => {
    if (b.verdict.score !== a.verdict.score) return b.verdict.score - a.verdict.score;
    const sa = num(a.item.stufe) ?? 0;
    const sb = num(b.item.stufe) ?? 0;
    if (sb !== sa) return sb - sa; // höhere Stufe zuerst
    const pa = num(a.item.preis);
    const pb = num(b.item.preis);
    if (pa !== null && pb !== null && pa !== pb) return pa - pb; // billiger zuerst
    if (pa === null && pb !== null) return 1;
    if (pb === null && pa !== null) return -1;
    return String(a.item.id ?? '').localeCompare(String(b.item.id ?? ''));
  });

  return kept.slice(0, limitCount).map((x) => x.item);
}
