/**
 * useShoppingSuggestions — Produktvorschläge für den Add-Custom-Item-
 * Modal in der Einkaufsliste.
 *
 * Verhalten:
 *   • Leer-Input (oder < 2 Zeichen): Top-Produkte aus der Kauf-
 *     historie des Users (most-purchased, dedupliziert nach Name).
 *     Wenn keine Kaufhistorie vorhanden ist (frischer User), gibt's
 *     einen kleinen statischen Fallback (Brot, Milch, …).
 *   • Input ≥ 2 Zeichen: 300 ms Debounce, dann Algolia-Suche
 *     (Marken- + NoName-Produkte). Ergebnisse werden in einem
 *     Module-Level-Cache gehalten und bei kommenden leeren-Input-
 *     Aufrufen mit-gemerged in die Top-Liste (User-Wunsch:
 *     "cache die Ergebnisse und mach daraus die Vorschläge in
 *     Zukunft").
 *
 * Lieblingsmarkt-Priorisierung:
 *   • Wenn userProfile.favoriteMarket gesetzt ist und ein
 *     Such-Treffer von genau diesem Markt ist, wird er an die
 *     Spitze sortiert.
 *   • Fallback: aus der Kaufhistorie der häufigste discounter.name.
 *
 * Kein Algolia-Roundtrip mehr nötig wenn Query bereits gecached.
 */

import { useAuth } from '@/lib/contexts/AuthContext';
import { AlgoliaService } from '@/lib/services/algolia';
import purchaseHistoryService, {
  PurchasedProduct,
} from '@/lib/services/purchaseHistoryService';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type ShoppingSuggestion = {
  key: string; // stable id
  name: string;
  type: 'brand' | 'noname';
  market?: {
    id: string;
    name: string;
    land?: string;
    bild?: string;
  };
  preis?: number;
  bild?: string;
  source: 'history' | 'algolia' | 'fallback';
};

// Module-Level Cache: query (lowercased) → Suggestions
// Persistiert über Modal-Open-Close, nicht über App-Restart. Reicht
// für den MVP, AsyncStorage-Persistenz kann später noch ergänzt
// werden falls's wirklich genutzt wird.
const searchCache = new Map<string, ShoppingSuggestion[]>();
const QUERY_CACHE_LIMIT = 50;

// Static fallback wenn User noch keine Kaufhistorie hat.
const FALLBACK_TOP: { name: string }[] = [
  { name: 'Brot' },
  { name: 'Milch' },
  { name: 'Butter' },
  { name: 'Eier' },
  { name: 'Käse' },
  { name: 'Joghurt' },
];

function normaliseName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Aggregiert Kauf-Einträge zu einer Top-Produkte-Liste:
 *   • Gruppierung nach normalisiertem Namen (case-insensitiv).
 *   • Anzahl-Count + jüngstes Kaufdatum als Tiebreaker.
 *   • Bevorzugung der häufigsten Variante (brand vs. noname) und
 *     des häufigsten Markts pro Name.
 */
function aggregateHistoryToTop(
  history: PurchasedProduct[],
  limit: number,
): ShoppingSuggestion[] {
  const buckets = new Map<
    string,
    {
      name: string;
      count: number;
      latest: number;
      brand: number;
      noname: number;
      markets: Map<string, { id: string; name: string; land?: string; bild?: string; count: number }>;
      sampleBild?: string;
    }
  >();

  for (const p of history) {
    const key = normaliseName(p.name);
    if (!key) continue;
    const bucket =
      buckets.get(key) ?? {
        name: p.name,
        count: 0,
        latest: 0,
        brand: 0,
        noname: 0,
        markets: new Map(),
        sampleBild: p.bild,
      };
    bucket.count += 1;
    const ts = p.purchasedAt instanceof Date ? p.purchasedAt.getTime() : 0;
    if (ts > bucket.latest) bucket.latest = ts;
    if (p.type === 'markenprodukt') bucket.brand += 1;
    else bucket.noname += 1;
    if (p.discounter?.id && p.discounter?.name) {
      const mk = bucket.markets.get(p.discounter.id) ?? {
        id: p.discounter.id,
        name: p.discounter.name,
        land: p.discounter.land,
        bild: p.discounter.bild,
        count: 0,
      };
      mk.count += 1;
      bucket.markets.set(p.discounter.id, mk);
    }
    if (!bucket.sampleBild && p.bild) bucket.sampleBild = p.bild;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.latest - a.latest;
    })
    .slice(0, limit)
    .map<ShoppingSuggestion>((b) => {
      const topMarket = Array.from(b.markets.values()).sort(
        (a, b2) => b2.count - a.count,
      )[0];
      // Wenn häufiger Marken- als NoName-Käufe → brand-Default
      const type: 'brand' | 'noname' = b.brand >= b.noname ? 'brand' : 'noname';
      return {
        key: `hist:${normaliseName(b.name)}`,
        name: b.name,
        type,
        market: type === 'noname' && topMarket
          ? { id: topMarket.id, name: topMarket.name, land: topMarket.land, bild: topMarket.bild }
          : undefined,
        source: 'history',
        bild: b.sampleBild,
      };
    });
}

/**
 * Sortiert Such-Ergebnisse so dass Lieblingsmarkt-Treffer oben sind.
 */
function reorderByFavorite(
  list: ShoppingSuggestion[],
  favoriteMarketId: string | null,
): ShoppingSuggestion[] {
  if (!favoriteMarketId) return list;
  const favs: ShoppingSuggestion[] = [];
  const rest: ShoppingSuggestion[] = [];
  for (const s of list) {
    if (s.market?.id === favoriteMarketId) favs.push(s);
    else rest.push(s);
  }
  return [...favs, ...rest];
}

interface AlgoliaHit {
  objectID?: string;
  name?: string;
  marke?: string;
  preis?: number;
  bild?: string;
  bildClean?: string;
  bildCleanRgb?: string;
  discounter?: { id?: string; name?: string; land?: string; bild?: string };
  handelsmarke?: { bezeichnung?: string };
  __index?: 'noname' | 'marken';
}

function mapAlgoliaToSuggestion(hit: AlgoliaHit): ShoppingSuggestion | null {
  if (!hit?.name) return null;
  const isNoname = hit.__index === 'noname' || !!hit.discounter?.id;
  const bild = hit.bildClean ?? hit.bildCleanRgb ?? hit.bild;
  return {
    key: `algolia:${hit.__index ?? 'x'}:${hit.objectID ?? hit.name}`,
    name: hit.name,
    type: isNoname ? 'noname' : 'brand',
    market:
      isNoname && hit.discounter?.id && hit.discounter?.name
        ? {
            id: hit.discounter.id,
            name: hit.discounter.name,
            land: hit.discounter.land,
            bild: hit.discounter.bild,
          }
        : undefined,
    preis: typeof hit.preis === 'number' ? hit.preis : undefined,
    bild: bild ?? undefined,
    source: 'algolia',
  };
}

export function useShoppingSuggestions(
  query: string,
  options?: { limit?: number },
): {
  suggestions: ShoppingSuggestion[];
  loading: boolean;
} {
  const limit = options?.limit ?? 8;
  const { user, userProfile } = useAuth();

  const [history, setHistory] = useState<PurchasedProduct[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [searchResults, setSearchResults] = useState<ShoppingSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  // Initial purchase-history-Load — einmal pro Modal-Mount.
  useEffect(() => {
    let alive = true;
    if (!user?.uid) {
      setHistory([]);
      setHistoryLoaded(true);
      return;
    }
    (async () => {
      try {
        const items = await purchaseHistoryService.getUserPurchaseHistory(user.uid);
        if (!alive) return;
        setHistory(items);
      } catch (e) {
        console.warn('useShoppingSuggestions: history load failed', e);
      } finally {
        if (alive) setHistoryLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  // Top-Liste aus Kaufhistorie (gemerged mit gecachten Algolia-
  // Hits, falls vorhanden — die werden so über Sessions zu
  // "Top-Vorschlägen" für den User).
  const topFromHistory = useMemo(() => {
    if (history.length > 0) {
      return aggregateHistoryToTop(history, limit);
    }
    return [];
  }, [history, limit]);

  const topMerged = useMemo<ShoppingSuggestion[]>(() => {
    // History first, dann cached Algolia-Treffer (unique by name).
    const seen = new Set<string>(topFromHistory.map((s) => normaliseName(s.name)));
    const cached: ShoppingSuggestion[] = [];
    for (const [, list] of searchCache) {
      for (const s of list) {
        const k = normaliseName(s.name);
        if (!seen.has(k)) {
          seen.add(k);
          cached.push(s);
          if (cached.length >= limit) break;
        }
      }
      if (cached.length >= limit) break;
    }
    const merged = [...topFromHistory, ...cached].slice(0, limit);
    if (merged.length === 0) {
      // Fallback wenn fresh user ohne history und ohne cache
      return FALLBACK_TOP.slice(0, limit).map<ShoppingSuggestion>((f) => ({
        key: `fallback:${f.name.toLowerCase()}`,
        name: f.name,
        type: 'brand',
        source: 'fallback',
      }));
    }
    return merged;
  }, [topFromHistory, limit]);

  // Lieblingsmarkt-Resolver: explizite User-Setting bevorzugt,
  // Fallback aus Kaufhistorie.
  const favoriteMarketId = useMemo<string | null>(() => {
    const explicit = (userProfile as any)?.favoriteMarket as string | undefined;
    if (explicit) return explicit;
    // Aus history: häufigster discounter.id
    const counts = new Map<string, number>();
    for (const p of history) {
      if (p.discounter?.id) {
        counts.set(p.discounter.id, (counts.get(p.discounter.id) ?? 0) + 1);
      }
    }
    let top: string | null = null;
    let max = 0;
    for (const [id, c] of counts) {
      if (c > max) {
        max = c;
        top = id;
      }
    }
    return top;
  }, [userProfile, history]);

  // Algolia-Search mit 300ms Debounce + Cache.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSearch = useCallback(
    async (q: string) => {
      const norm = q.trim().toLowerCase();
      if (norm.length < 2) {
        setSearchResults([]);
        setLoading(false);
        return;
      }
      // Cache-Hit?
      const cached = searchCache.get(norm);
      if (cached) {
        setSearchResults(reorderByFavorite(cached, favoriteMarketId));
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await AlgoliaService.searchAll(norm, 0, limit);
        const hits = (result?.hits ?? []) as AlgoliaHit[];
        const mapped: ShoppingSuggestion[] = [];
        for (const h of hits) {
          const s = mapAlgoliaToSuggestion(h);
          if (s) mapped.push(s);
        }
        // Cache vor reorder schreiben (cache ist neutral, reorder ist
        // pro User unterschiedlich).
        if (searchCache.size >= QUERY_CACHE_LIMIT) {
          // LRU-ish: ältesten Eintrag droppen
          const oldest = searchCache.keys().next().value;
          if (oldest !== undefined) searchCache.delete(oldest);
        }
        searchCache.set(norm, mapped);
        setSearchResults(reorderByFavorite(mapped, favoriteMarketId));
      } catch (e: any) {
        console.warn('useShoppingSuggestions: algolia search failed', e?.message);
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    },
    [limit, favoriteMarketId],
  );

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const norm = query.trim();
    if (norm.length < 2) {
      setSearchResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceTimer.current = setTimeout(() => {
      runSearch(norm);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, runSearch]);

  return {
    suggestions: query.trim().length >= 2 ? searchResults : topMerged,
    loading: loading || !historyLoaded,
  };
}
