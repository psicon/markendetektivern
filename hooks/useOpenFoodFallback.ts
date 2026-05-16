/**
 * useOpenFoodFallback
 *
 * Lädt OpenFoodFacts-Daten als Fallback für Zutaten und Nährwerte
 * wenn die Firestore-Produkt-Daten diese Felder nicht haben.
 *
 * Verwendung im product-comparison-Screen (Stufe 3/4/5) und im
 * noname-detail-Screen (Stufe 1/2). Network-konservativ: lädt NUR
 * für das aktuell ausgewählte (`picked`) Produkt, nicht für alle
 * Alternativen. Bei Picked-Switch wird die neue Alternative
 * im Hintergrund nachgeladen — die vorherige Brand-Daten bleiben
 * stabil sichtbar (kein Flash auf der Brand-Seite).
 *
 * Multi-EAN-Support: pro Produkt werden ALLE bekannten EANs
 * (`EANs[]`, `EAN`, `gtin`, …) sequentiell probiert — 1. Treffer
 * wins. Per-Slot-Key-Tracking verhindert stale-data-Flash: wenn
 * picked wechselt, returnt der Hook für die Noname-Seite NULL bis
 * die neue Fetch resolved (statt die alten OpenFood-Daten weiter
 * anzuzeigen).
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

/** Slot mit Key — Daten werden nur gerendert wenn key matched die
 *  aktuelle EAN-Liste. Verhindert stale-data-Flash beim Switchen. */
type Slot = { key: string; data: OpenFoodFallbackResult | null } | null;

interface InternalState {
  brand: Slot;
  noname: Slot;
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
  // EANs joined zu stabilem Key. Object-Identität wechselt bei jedem
  // Render, primitive Keys nicht — deshalb sind das die useEffect-Deps.
  const brandKey = (brand?.eans ?? []).join(',');
  const nonameKey = (noname?.eans ?? []).join(',');
  const brandNeed = needsFetch(brand);
  const nonameNeed = needsFetch(noname);

  const [state, setState] = useState<InternalState>({
    brand: null,
    noname: null,
    loading: false,
  });

  useEffect(() => {
    // Wenn keine Seite was braucht → state komplett resetten.
    if (!brandNeed && !nonameNeed) {
      setState({ brand: null, noname: null, loading: false });
      return;
    }

    let alive = true;
    setState((prev) => ({
      // Brand-slot: nur wenn brandNeed (sonst kein OpenFood nötig)
      // UND vorhandener slot zum aktuellen brandKey passt — sonst
      // null (wird gleich nachgeladen).
      brand:
        brandNeed && prev.brand?.key === brandKey ? prev.brand : null,
      noname:
        nonameNeed && prev.noname?.key === nonameKey ? prev.noname : null,
      loading: true,
    }));

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
        setState((prev) => ({
          // Brand nur überschreiben wenn wir tatsächlich fetched
          // haben (brandNeed=true). Sonst prev.brand behalten —
          // das stabilisiert die Brand-Seite über Picked-Switches
          // hinweg.
          brand: brandNeed
            ? { key: brandKey, data: buildFallback(brand, b) }
            : prev.brand,
          noname: nonameNeed
            ? { key: nonameKey, data: buildFallback(noname, n) }
            : prev.noname,
          loading: false,
        }));
      })
      .catch((e) => {
        if (!alive) return;
        console.warn('useOpenFoodFallback: fetch failed', e);
        setState((prev) => ({ ...prev, loading: false }));
      });

    return () => {
      alive = false;
    };
    // Deps bewusst auf primitive Werte. Object-Identität würde bei
    // jedem Render einen neuen Run triggern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandKey, nonameKey, brandNeed, nonameNeed]);

  // Per-Slot-Key-Check: state.brand/noname werden NUR rendered wenn
  // ihr key zur aktuellen EAN-Liste passt. Bei Picked-Switch ist
  // state.noname.key noch der alte → wir returnen null, das UI
  // zeigt '—' / Shimmer statt stale-Data der vorherigen Alternative.
  // Brand-Side bleibt stabil weil brandKey sich nicht ändert wenn
  // nur picked wechselt.
  const safeBrand =
    state.brand && state.brand.key === brandKey ? state.brand.data : null;
  const safeNoname =
    state.noname && state.noname.key === nonameKey ? state.noname.data : null;

  // Loading umfasst auch das "wir-werden-gleich-fetchen"-Fenster
  // ZWISCHEN dem Render mit neuem Picked und dem useEffect-Run der
  // state.loading=true setzt. Ohne diese Berechnung sähe der Consumer
  // einen Frame mit (loading=false, kein data) → Container würde
  // unmounten + sofort wieder remounten → POP.
  //
  // Wir flaggen als loading sobald eine Seite eine Fetch braucht und
  // der entsprechende Slot noch nicht (oder mit veraltetem Key)
  // gefüllt ist. Effektiv: solange der Hook nicht bestätigt hat dass
  // der aktuelle Key fertig verarbeitet wurde, sind wir "loading".
  const brandPending =
    brandNeed && (state.brand === null || state.brand.key !== brandKey);
  const nonamePending =
    nonameNeed && (state.noname === null || state.noname.key !== nonameKey);
  const loading = state.loading || brandPending || nonamePending;

  return { brand: safeBrand, noname: safeNoname, loading };
}
