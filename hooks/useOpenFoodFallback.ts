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
 * Multi-EAN-Support (User-Vorgabe 2026-05-16): pro Produkt werden
 * ALLE bekannten EANs (`EANs[]`, `EAN`, `gtin`, …) sequentiell
 * probiert — 1. Treffer wins, keine weiteren Requests danach.
 */

import { useEffect, useState } from 'react';

import OpenFoodService, { type OpenFoodProduct } from '@/lib/services/openfood';
import type { NaehrwerteShape } from '@/lib/utils/productNutrition';

export interface OpenFoodFallbackProductInput {
  /** Alle EAN-Kandidaten in Reihenfolge. Leere Strings / Nullen
   *  werden ignoriert. */
  eans: string[];
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
  if (!input.eans || input.eans.length === 0) return false;
  return !input.hasZutaten || !input.hasNaehrwerte;
}

export function useOpenFoodFallback(
  args: UseOpenFoodFallbackArgs,
): UseOpenFoodFallbackReturn {
  const { brand, noname } = args;
  // Wir flatten die EAN-Liste in einen stabilen Key — sonst feuert die
  // useEffect bei jedem Render neu (Array-Identität wechselt).
  const brandKey = (brand?.eans ?? []).join(',');
  const nonameKey = (noname?.eans ?? []).join(',');
  const brandNeed = needsFetch(brand);
  const nonameNeed = needsFetch(noname);

  const [state, setState] = useState<UseOpenFoodFallbackReturn>({
    brand: null,
    noname: null,
    loading: false,
  });

  useEffect(() => {
    if (!brandNeed && !nonameNeed) {
      setState({ brand: null, noname: null, loading: false });
      return;
    }

    let alive = true;
    setState((prev) => ({ ...prev, loading: true }));

    // Multi-EAN: parallel pro Produkt (Brand + Noname zusammen), aber
    // pro Produkt SEQUENTIELL durch die EAN-Liste — 1. Treffer wins.
    const brandPromise: Promise<OpenFoodProduct | null> = brandNeed && brand?.eans?.length
      ? OpenFoodService.getProductByFirstEAN(brand.eans)
      : Promise.resolve(null);
    const nonamePromise: Promise<OpenFoodProduct | null> = nonameNeed && noname?.eans?.length
      ? OpenFoodService.getProductByFirstEAN(noname.eans)
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
    // Deps bewusst auf primitive Werte. Object-Identität würde bei
    // jedem Render einen neuen Run triggern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandKey, nonameKey, brandNeed, nonameNeed]);

  return state;
}
