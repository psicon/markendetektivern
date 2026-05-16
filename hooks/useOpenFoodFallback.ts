/**
 * useOpenFoodFallback
 *
 * Lädt OpenFoodFacts-Daten als Fallback für Zutaten und Nährwerte
 * wenn die Firestore-Produkt-Daten diese Felder nicht haben.
 *
 * Verwendung im product-comparison-Screen (Stufe 3/4/5) und im
 * noname-detail-Screen (Stufe 1/2). Der Hook ist klein, network-
 * konservativ (nur fetchen wenn wirklich nötig) und race-safe
 * (späterer `picked`-Wechsel verwirft veraltete Responses).
 *
 * API:
 *   useOpenFoodFallback({
 *     brand: { ean, hasZutaten, hasNaehrwerte },
 *     noname: { ean, hasZutaten, hasNaehrwerte },
 *   })
 *
 * Returnt:
 *   {
 *     brand:  { zutaten?: string, naehrwerte?: NaehrwerteShape } | null,
 *     noname: { zutaten?: string, naehrwerte?: NaehrwerteShape } | null,
 *     loading: boolean,
 *   }
 *
 * `null` bedeutet "OpenFood hat kein Produkt zu dieser EAN" oder
 * "kein Fallback nötig" (Firestore hat die Daten schon, EAN fehlt,
 * oder es wurde gar nicht gefetcht).
 */

import { useEffect, useState } from 'react';

import OpenFoodService, {
  type NaehrwerteShape,
  type OpenFoodProduct,
} from '@/lib/services/openfood';

export interface OpenFoodFallbackProductInput {
  /** EAN oder undefined wenn Produkt keine EAN hat. */
  ean?: string | null;
  /** True wenn Firestore-Zutaten bereits gesetzt sind — dann kein
   *  Fallback nötig. */
  hasZutaten: boolean;
  /** True wenn Firestore-Naehrwerte bereits gesetzt sind. */
  hasNaehrwerte: boolean;
}

export interface OpenFoodFallbackResult {
  zutaten?: string;
  naehrwerte?: NaehrwerteShape;
}

interface UseOpenFoodFallbackArgs {
  brand?: OpenFoodFallbackProductInput | null;
  noname?: OpenFoodFallbackProductInput | null;
}

interface UseOpenFoodFallbackReturn {
  brand: OpenFoodFallbackResult | null;
  noname: OpenFoodFallbackResult | null;
  loading: boolean;
}

function buildFallback(
  input: OpenFoodFallbackProductInput | null | undefined,
  product: OpenFoodProduct | null,
): OpenFoodFallbackResult | null {
  if (!input || !product || !product.found) return null;
  const out: OpenFoodFallbackResult = {};
  if (!input.hasZutaten) {
    const z = OpenFoodService.formatIngredients(product);
    if (z) out.zutaten = z;
  }
  if (!input.hasNaehrwerte) {
    const n = OpenFoodService.toNaehrwerteShape(product);
    if (n) out.naehrwerte = n;
  }
  return Object.keys(out).length === 0 ? null : out;
}

function needsFetch(input?: OpenFoodFallbackProductInput | null): boolean {
  if (!input) return false;
  if (!input.ean) return false;
  return !input.hasZutaten || !input.hasNaehrwerte;
}

export function useOpenFoodFallback(
  args: UseOpenFoodFallbackArgs,
): UseOpenFoodFallbackReturn {
  const { brand, noname } = args;
  const brandEan = brand?.ean ?? null;
  const nonameEan = noname?.ean ?? null;
  const brandNeed = needsFetch(brand);
  const nonameNeed = needsFetch(noname);

  const [state, setState] = useState<UseOpenFoodFallbackReturn>({
    brand: null,
    noname: null,
    loading: false,
  });

  useEffect(() => {
    // Nichts zu tun.
    if (!brandNeed && !nonameNeed) {
      setState({ brand: null, noname: null, loading: false });
      return;
    }

    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));

    // Parallel — beide EANs gleichzeitig fetchen. OpenFoodService
    // hat Inflight-Dedup + 2-Tier-Cache, also kein Sorgen ums
    // Round-Trip-Mehr-Volumen.
    const brandPromise: Promise<OpenFoodProduct | null> = brandNeed && brandEan
      ? OpenFoodService.getProductByEAN(brandEan)
      : Promise.resolve(null);
    const nonamePromise: Promise<OpenFoodProduct | null> = nonameNeed && nonameEan
      ? OpenFoodService.getProductByEAN(nonameEan)
      : Promise.resolve(null);

    Promise.all([brandPromise, nonamePromise])
      .then(([b, n]) => {
        if (!alive) return;
        setState({
          brand: buildFallback(brand, b),
          noname: buildFallback(noname, n),
          loading: false,
        });
      })
      .catch((e) => {
        if (!alive) return;
        console.warn('useOpenFoodFallback: fetch failed', e);
        setState({ brand: null, noname: null, loading: false });
      });

    return () => {
      alive = false;
    };
    // Dependencies bewusst auf primitive Werte — input-Objects können
    // bei jedem Render neu sein (inline-Object), das würde sonst eine
    // Endlos-Loop erzeugen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandEan, nonameEan, brandNeed, nonameNeed]);

  return state;
}
