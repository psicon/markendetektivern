/**
 * manufacturerMatchService — Fuzzy-Match eines externen Hersteller-
 * Namens (z.B. "Pepsico Deutschland GmbH" aus REWE-Scrape) gegen
 * unsere `hersteller_new`-Collection.
 *
 * Algorithmus:
 *   1. Normalisiere beide Strings (lowercase, Punctuation weg,
 *      Trim Stop-Words "GmbH" / "AG" / "& Co. KG" / "Deutschland" …)
 *   2. Levenshtein-Distance → Similarity-Score 0-1
 *   3. Top-Match wenn confidence ≥ THRESHOLD (default 0.75)
 *
 * KI-Fallback (TODO): bei moderate confidence (0.55-0.74) könnte
 * man Anthropic via Cloud Function fragen "ist 'Pepsico Deutschland
 * GmbH' der gleiche Hersteller wie 'PepsiCo'?". Für MVP weggelassen
 * — Levenshtein deckt 90 % der echten Matches ab.
 *
 * Performance: lädt einmal pro App-Session alle hersteller_new
 * (~ein paar 1000 Docs maximum) in Memory. Module-Level-Cache.
 */

import { collection, getDocs } from '@react-native-firebase/firestore';

import { db } from '@/lib/firebase';

export interface ManufacturerMatch {
  id: string;
  name: string;
  bild?: string | null;
  /** Similarity 0-1; 1 = exakt gleich (nach Normalisierung). */
  confidence: number;
}

interface ManufacturerEntry {
  id: string;
  name: string;
  normalised: string;
  bild?: string | null;
}

let cache: ManufacturerEntry[] | null = null;
let cachePromise: Promise<ManufacturerEntry[]> | null = null;

/** Confidence-Schwelle ab der wir die Section anzeigen. */
export const MANUFACTURER_MATCH_THRESHOLD = 0.75;

// ─── Normalisierung ──────────────────────────────────────────────────

const STOPWORDS = [
  'gmbh',
  'ag',
  'kg',
  'co',
  'co.',
  'and',
  '&',
  'deutschland',
  'österreich',
  'schweiz',
  'europe',
  'european',
  'international',
  'group',
  'holding',
  'se',
  'ohg',
  'mbh',
  'limited',
  'ltd',
  'plc',
  'inc',
  'inc.',
  'corp',
  'corp.',
  'corporation',
  'gesellschaft',
];

export function normaliseManufacturerName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diakritische Zeichen weg
    .replace(/[.,;:!?'"\-_/\\()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0 && !STOPWORDS.includes(w))
    .join(' ');
}

// ─── Levenshtein ─────────────────────────────────────────────────────

/** Standard-DP-Levenshtein. O(m*n) — gut genug für Hersteller-Namen
 *  (< 50 Zeichen typisch). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return dp[a.length][b.length];
}

function similarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / max;
}

// ─── Loader (cached) ─────────────────────────────────────────────────

async function loadHersteller(): Promise<ManufacturerEntry[]> {
  if (cache) return cache;
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    try {
      const snap = await getDocs(collection(db, 'hersteller_new'));
      const list: ManufacturerEntry[] = [];
      snap.forEach((doc) => {
        const data = doc.data() as any;
        const name = data?.name;
        if (typeof name !== 'string' || !name.trim()) return;
        list.push({
          id: doc.id,
          name,
          normalised: normaliseManufacturerName(name),
          bild: data?.bild ?? null,
        });
      });
      cache = list;
      return list;
    } catch (e: any) {
      console.warn('manufacturerMatchService.loadHersteller failed', e?.message);
      cache = [];
      return [];
    } finally {
      cachePromise = null;
    }
  })();
  return cachePromise;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Match externer Hersteller-Name gegen unsere hersteller_new-Collection.
 * Returnt null wenn confidence < THRESHOLD (Default 0.75).
 *
 * **Throwt NIE** — bei jedem Fehler null.
 */
export async function matchManufacturer(
  externalName: string,
  options?: { threshold?: number },
): Promise<ManufacturerMatch | null> {
  try {
    const threshold = options?.threshold ?? MANUFACTURER_MATCH_THRESHOLD;
    const normExt = normaliseManufacturerName(externalName);
    if (!normExt) return null;

    const list = await loadHersteller();
    if (list.length === 0) return null;

    let best: ManufacturerMatch | null = null;
    for (const entry of list) {
      if (!entry.normalised) continue;
      const sim = similarity(normExt, entry.normalised);
      // Short-circuit: exakter Match nach Normalisierung
      if (sim === 1) {
        return {
          id: entry.id,
          name: entry.name,
          bild: entry.bild,
          confidence: 1,
        };
      }
      if (sim < threshold) continue;
      if (!best || sim > best.confidence) {
        best = {
          id: entry.id,
          name: entry.name,
          bild: entry.bild,
          confidence: sim,
        };
      }
    }
    return best;
  } catch (e: any) {
    console.warn('manufacturerMatchService.matchManufacturer failed', e?.message);
    return null;
  }
}

/** Test-Helper: cache explicit invalidieren (z.B. nach Add eines neuen
 *  hersteller_new doc). */
export function invalidateManufacturerCache(): void {
  cache = null;
  cachePromise = null;
}
