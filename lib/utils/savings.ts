// Shared Savings-Calculation für die App. Zentral damit
// product-comparison + shopping-list + favorites etc. die gleichen
// Zahlen anzeigen (vorher gab's drei verschiedene Implementierungen
// die auf unterschiedlichen Annahmen rechneten — Markenprodukt =
// 0,79€/150g vs NoName 1,19€/400g produzierte je nach Stelle "+51%"
// Markup oder "−44%" Ersparnis).
//
// ─── Drei-Stufen-Resolver ───────────────────────────────────────
//
//   1. **Firestore-precomputed**: wenn das NoName-Produkt-Doc die
//      Felder `ersparnis` (€) UND `ersparnisProz` (%) gesetzt hat,
//      sind das die admin-kuratierten Werte. Vorrang vor allem
//      anderen.
//   2. **Per-Pack-Unit** (per gram, per ml, etc.): wenn beide
//      Produkte `packSize` haben, ist `preis / packSize` der
//      Stückpreis. Vergleich davon ist die ehrliche Antwort
//      ("ist NoName pro Gramm günstiger?"). Wir setzen voraus dass
//      die Pack-Units kompatibel sind — bei direkten Alternativen
//      vom selben Hersteller ist das praktisch immer so
//      (beide in g oder beide in ml).
//   3. **Absolute** (preis-vs-preis): Fallback wenn kein packSize
//      vorhanden ist. Naiv, kann irreführend sein bei
//      unterschiedlichen Pack-Größen, aber besser als nichts.
//
// ─── Rückgabewert ──────────────────────────────────────────────
//
// `eur`: positiver Betrag in € den der User pro NoName-Pack spart.
//        Bei negativem Wert (NoName teurer per Unit) → 0
//        ausgegeben — Markups blenden wir aus, damit das UI
//        konsistent als "Sparen"-Indikator funktioniert.
// `pct`: positive Prozent-Ersparnis (0-100). Bei Markup → 0.
// `kind`: Welche Methode wurde verwendet — relevant für Debug/
//         Telemetrie, nicht für UI.

export type SavingsResult = {
  eur: number;
  pct: number;
  kind: 'precomputed' | 'per-unit' | 'absolute' | 'none';
};

type WithPriceAndSize = {
  preis?: number;
  packSize?: number;
  ersparnis?: number;
  ersparnisProz?: number;
};

const ZERO: SavingsResult = { eur: 0, pct: 0, kind: 'none' };

export function calculateSavings(
  brand: WithPriceAndSize | null | undefined,
  noname: WithPriceAndSize | null | undefined,
): SavingsResult {
  if (!brand || !noname) return ZERO;

  // Stufe 1: Firestore-precomputed
  if (
    typeof noname.ersparnis === 'number' &&
    typeof noname.ersparnisProz === 'number' &&
    noname.ersparnis > 0 &&
    noname.ersparnisProz > 0
  ) {
    return {
      eur: noname.ersparnis,
      pct: Math.max(0, Math.round(noname.ersparnisProz)),
      kind: 'precomputed',
    };
  }

  const brandPrice = brand.preis;
  const nonamePrice = noname.preis;
  if (
    typeof brandPrice !== 'number' ||
    typeof nonamePrice !== 'number' ||
    brandPrice <= 0 ||
    nonamePrice <= 0
  ) {
    return ZERO;
  }

  // Stufe 2: Per-Pack-Unit (z.B. per Gramm).
  //
  // packSize muss bei BEIDEN Produkten gesetzt sein. Wir gehen
  // davon aus dass die Pack-Units kompatibel sind (beide in g, beide
  // in ml, etc.) — bei alternierenden Produkten vom selben Hersteller
  // ist das praktisch immer der Fall. Wenn nicht, fällt das Ergebnis
  // u.U. unsinnig aus (verglichen 100g mit 1000ml), aber die
  // Kategorie-Logik der App stellt sicher dass Vergleichs-Paare
  // dieselbe Kategorie haben → fast nie ein Issue.
  const brandPackSize = brand.packSize;
  const nonamePackSize = noname.packSize;
  if (
    typeof brandPackSize === 'number' &&
    typeof nonamePackSize === 'number' &&
    brandPackSize > 0 &&
    nonamePackSize > 0
  ) {
    const brandPerUnit = brandPrice / brandPackSize;
    const nonamePerUnit = nonamePrice / nonamePackSize;
    if (nonamePerUnit < brandPerUnit) {
      // Ersparnis pro NoName-Pack: was ein gleich-großer Brand-
      // Pack KOSTEN würde MINUS was der NoName-Pack tatsächlich
      // kostet. Das ist die ehrlichste "absolute Ersparnis"-Zahl
      // die der User wirklich beim Kauf in € spart.
      const eqBrandPriceForNonameSize = brandPerUnit * nonamePackSize;
      const eur = Math.max(0, eqBrandPriceForNonameSize - nonamePrice);
      const pct = Math.round(
        ((brandPerUnit - nonamePerUnit) / brandPerUnit) * 100,
      );
      return { eur, pct: Math.max(0, pct), kind: 'per-unit' };
    }
    // NoName ist per-unit teurer → keine Ersparnis darstellen.
    return ZERO;
  }

  // Stufe 3: Absolute Preis-Differenz (Fallback ohne packSize-Info).
  if (nonamePrice < brandPrice) {
    const eur = brandPrice - nonamePrice;
    const pct = Math.round((eur / brandPrice) * 100);
    return { eur, pct: Math.max(0, pct), kind: 'absolute' };
  }
  return ZERO;
}

/**
 * Convenience-Wrapper: liefert nur den Prozent-Wert (für die
 * Discount-Pill auf den NoName-Cards). Returns 0 bei keiner
 * Ersparnis — Caller kann den Badge dann ausblenden.
 */
export function calculateSavingsPercent(
  brand: WithPriceAndSize | null | undefined,
  noname: WithPriceAndSize | null | undefined,
): number {
  return calculateSavings(brand, noname).pct;
}
