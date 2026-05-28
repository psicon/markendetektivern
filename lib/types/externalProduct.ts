/**
 * external_products — zentraler Cache für EAN-Lookups die NICHT in
 * unserer kuratierte Produkt-DB sind (Markenprodukte / NoNames).
 *
 * Quellen (in Cascade-Reihenfolge, siehe ExternalProductService):
 *   1. `rewe`     — aus der bestehenden scraped_products-Collection
 *                   (gefüttert via reweapify-Pipeline). Bleibt
 *                   Source-of-Truth für REWE-Daten; external_products
 *                   schreibt eine normalisierte Kopie zurück, damit
 *                   Multi-Source-Lookup uniform läuft.
 *   2. `globus`   — neue Cloud Function (T3), scrapet Globus-Webshop.
 *   3. `openfood` — OpenFoodFacts API.
 *   4. Erweiterbar: `edeka`, `kaufland`, … (registriert in
 *      `EXTERNAL_SOURCES_ORDER`).
 *
 * Schema lehnt sich am reweapify-Format aus CLAUDE.md (Nutrition /
 * Zutaten Schema) an — wir reuse die `nutr_*` und
 * `attr_ingredientStatement`-Felder damit Detail-Pages denselben
 * Reader (extractNaehrwerte, extractIngredients) verwenden können.
 */

import type { Timestamp } from '@react-native-firebase/firestore';

export type ExternalProductSource = 'rewe' | 'globus' | 'openfood' | string;

/** Wie alt darf ein cached Eintrag sein bevor wir frisch fetchen. */
export const EXTERNAL_CACHE_MAX_AGE_MS = 4 * 7 * 24 * 60 * 60 * 1000; // 4 Wochen

/**
 * Doc-Schema in der `external_products` Collection.
 * Doc-Id = EAN (normalisiert, nur Ziffern).
 */
export interface ExternalProductDoc {
  /** EAN, gleich der doc-id. Redundant gespeichert für Queries. */
  ean: string;

  /** Welche Quelle den Treffer geliefert hat. */
  source: ExternalProductSource;

  /** Wann der Datensatz das letzte Mal aus der Source gefetched wurde. */
  cachedAt: Timestamp;

  // ─── Basis-Felder ────────────────────────────────────────────────
  productName: string;
  brandName?: string;
  manufacturerName?: string;
  manufacturerRef?: { __ref__: string }; // Optional: Firestore-Ref auf hersteller-doc wenn matchbar
  imageUrl?: string;

  // ─── Preis / Pack (Shop-spezifisch) ──────────────────────────────
  /** Preis in EUR (float). Optional — OpenFood hat z.B. keinen Preis. */
  price?: number;
  /** Packungsgröße als String, z.B. "500g", "1L", "6×0,33L". */
  packSize?: string;
  /** Kategorie als String (Source-spezifisch). Wird für Alternative-
   * Matching genutzt (T6). */
  category?: string;
  /** Optionale URL zur Source-Produkt-Page (für "Quelle anzeigen"). */
  sourceUrl?: string;

  // ─── Nährwerte (reweapify-Schema-konform) ─────────────────────────
  // Alle Felder optional — wir schreiben nur was die Source liefert.
  // Doc lebt mit unvollständigen Daten, UI-Reader fallback'n auf "—".
  nutr_Energie_val?: number;
  nutr_Energie_unit?: 'kcal' | 'kJ';
  nutr_Fett_val?: number;
  nutr_Fett_unit?: 'g';
  nutr_FettdavongesttigteFettsuren_val?: number;
  nutr_FettdavongesttigteFettsuren_unit?: 'g';
  nutr_Kohlenhydrate_val?: number;
  nutr_Kohlenhydrate_unit?: 'g';
  nutr_KohlenhydratedavonZucker_val?: number;
  nutr_KohlenhydratedavonZucker_unit?: 'g';
  nutr_Ballaststoffe_val?: number;
  nutr_Ballaststoffe_unit?: 'g';
  nutr_Eiwei_val?: number; // sic — reweapify-Tippfehler, kompatibel
  nutr_Eiwei_unit?: 'g';
  nutr_Salz_val?: number;
  nutr_Salz_unit?: 'g';
  nutr_serving_size?: number;
  nutr_serving_unit?: 'g';

  // ─── Zutaten / Allergene ─────────────────────────────────────────
  attr_ingredientStatement?: string;

  allergen_gluten?: boolean;
  allergen_milk?: boolean;
  allergen_egg?: boolean;
  allergen_nuts?: boolean;
  allergen_soy?: boolean;

  // ─── Lifestyle-Flags (OpenFood-Stil) ─────────────────────────────
  isVegan?: boolean;
  isVegetarian?: boolean;
  isGlutenFree?: boolean;
  isLactoseFree?: boolean;

  // ─── Public Scores (OpenFood) ────────────────────────────────────
  scoreNutri?: string;  // 'a' | 'b' | 'c' | 'd' | 'e'
  scoreEco?: string;
  scoreNova?: string;   // '1' | '2' | '3' | '4'

  // ─── Beschreibung / Sonst ────────────────────────────────────────
  productDescription?: string;

  // ─── Debug / Audit ───────────────────────────────────────────────
  /** Roh-Daten der Source — für Debugging und spätere Re-Normalisierung. */
  raw?: unknown;
}

/** Resultat von `ExternalProductService.lookupByEAN`. */
export interface ExternalLookupResult {
  product: ExternalProductDoc;
  /** true wenn aus Cache gelesen (kein Source-Request gemacht). */
  fromCache: boolean;
  /** true wenn cached aber stale war und Refresh erfolgte. */
  refreshed: boolean;
}
