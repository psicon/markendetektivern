/**
 * Produkt-Zutaten & -Nährwerte: zentrale Extraktions-/Normalisierungs-
 * Helper für unsere Firestore-`produkte` und -`markenProdukte`.
 *
 * Hintergrund (User-Vorgabe 2026-05-16):
 *
 *   • Das neue Schema kommt aus dem mediaingestor → reweapify-Pipeline:
 *       attr_ingredientStatement: 'Zucker, Glukosesirup, …'
 *       nutr_Energie_val:  395   nutr_Energie_unit:  'kcal'
 *       nutr_Fett_val:     7.4   nutr_Fett_unit:     'g'
 *       nutr_FettdavongesttigteFettsuren_val / _unit
 *       nutr_Kohlenhydrate_val / _unit
 *       nutr_KohlenhydratedavonZucker_val / _unit
 *       nutr_Eiwei_val:    4.2   nutr_Eiwei_unit:    'g'   (Eiweiß ohne ß)
 *       nutr_Ballaststoffe_val / _unit
 *       nutr_Salz_val / _unit
 *       nutr_serving_size: 100   nutr_serving_unit:  'g'
 *
 *   • Legacy-Schema (das bisher hier verwendet wurde) bleibt als
 *     Fallback erhalten: zutaten (string), naehrwerte: { brennwertKcal,
 *     fett, gesaettigteFettsaeuren, kohlenhydrate, zucker, eiweiss,
 *     salz }, moreInformation.zutaten.
 *
 *   • OpenFoodFacts kommt erst wenn beides leer ist — und dann müssen
 *     ALLE EANs (`EANs[]`, `EAN`, `gtin`) sequentiell probiert werden,
 *     beim 1. Treffer aufhören.
 *
 * Ein Produkt hat oft mehrere EANs (z.B. weil dasselbe Produkt unter
 * leicht verschiedenen GTINs verkauft wird oder Algolia mehrere
 * indexed hat).
 */

export interface NaehrwerteShape {
  brennwertKcal?: number;       // kcal per 100g
  fett?: number;                // g per 100g
  gesaettigteFettsaeuren?: number; // g
  kohlenhydrate?: number;       // g
  zucker?: number;              // g
  eiweiss?: number;             // g
  salz?: number;                // g
  ballaststoffe?: number;       // g  (nur im neuen Schema)
  servingSize?: number;         // 100 typischerweise
  servingUnit?: string;         // 'g' typischerweise
}

/** Extrahiert alle EAN-Kandidaten aus einem Produkt-Doc in der
 *  Reihenfolge in der sie probiert werden sollen.
 *  - bevorzugt explizit gepflegte `EAN` / `gtin` (Single)
 *  - dann das `EANs[]`-Array
 *  - dann case-Varianten (`ean`, `GTIN`, `eans[]`)
 *  - dedupliziert, filtert auf >= 8 Zeichen (kürzere sind keine EANs) */
export function extractEans(product: any): string[] {
  if (!product) return [];
  const raw: any[] = [];
  // Singles zuerst.
  raw.push(product.EAN, product.ean, product.gtin, product.GTIN);
  // Arrays.
  if (Array.isArray(product.EANs)) raw.push(...product.EANs);
  if (Array.isArray(product.eans)) raw.push(...product.eans);
  // moreInformation kann ebenfalls EANs tragen (Legacy-Pfad).
  raw.push(product.moreInformation?.EAN, product.moreInformation?.ean);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (v == null) continue;
    const s = typeof v === 'number' ? String(v) : String(v).trim();
    if (s.length < 8) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Liefert die Zutaten-String aus einem Produkt-Doc. Reihenfolge:
 *  neues Schema `attr_ingredientStatement` → Legacy `zutaten` →
 *  Legacy `moreInformation.zutaten`. Trim'd & cleaned. */
export function extractIngredients(product: any): string {
  if (!product) return '';
  const candidates: any[] = [
    product.attr_ingredientStatement,
    product.zutaten,
    product.ingredients,
    product.moreInformation?.zutaten,
  ];
  for (const c of candidates) {
    if (typeof c === 'string') {
      const cleaned = c.replace(/\s+/g, ' ').trim();
      if (cleaned.length > 0) return cleaned;
    }
  }
  return '';
}

/** Robust number parsing — neue Schema speichert val als number, aber
 *  alte Imports können string sein ("4,5" oder "4.5"). */
function toNum(v: any): number | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Konvertiert kJ → kcal (1 kcal = 4.184 kJ). */
function kjToKcal(kj: number): number {
  return Math.round(kj / 4.184);
}

/** Lest Naehrwerte aus dem NEUEN nutr_* Schema. Returnt null wenn
 *  kein einziges Feld gesetzt ist. */
function fromNutrFields(p: any): NaehrwerteShape | null {
  if (!p) return null;
  const out: NaehrwerteShape = {};

  const energie = toNum(p.nutr_Energie_val);
  if (energie != null) {
    const unit = String(p.nutr_Energie_unit ?? '').toLowerCase();
    out.brennwertKcal =
      unit === 'kj' || unit === 'kilojoule' ? kjToKcal(energie) : Math.round(energie);
  }
  const fett = toNum(p.nutr_Fett_val);
  if (fett != null) out.fett = fett;

  // Hinweis zur Tippfehler-Tolerance: Im Schema heißt das Feld
  // `nutr_FettdavongesttigteFettsuren_val` (ohne Umlaute, mit
  // Schreibfehler "gesttigte" statt "gesättigte"). Wir lesen auch
  // korrigierte Varianten falls die Pipeline später aufräumt.
  const ges =
    toNum(p.nutr_FettdavongesttigteFettsuren_val) ??
    toNum(p.nutr_FettdavongesaettigteFettsaeuren_val) ??
    toNum(p.nutr_FettdavongesaeattigteFettsaeuren_val);
  if (ges != null) out.gesaettigteFettsaeuren = ges;

  const carbs = toNum(p.nutr_Kohlenhydrate_val);
  if (carbs != null) out.kohlenhydrate = carbs;

  const zucker = toNum(p.nutr_KohlenhydratedavonZucker_val);
  if (zucker != null) out.zucker = zucker;

  const ew =
    toNum(p.nutr_Eiwei_val) ?? toNum(p.nutr_Eiweiss_val) ?? toNum(p.nutr_Eiweiß_val);
  if (ew != null) out.eiweiss = ew;

  const ballast = toNum(p.nutr_Ballaststoffe_val);
  if (ballast != null) out.ballaststoffe = ballast;

  const salz = toNum(p.nutr_Salz_val);
  if (salz != null) out.salz = salz;

  const servSize = toNum(p.nutr_serving_size);
  if (servSize != null) out.servingSize = servSize;
  if (typeof p.nutr_serving_unit === 'string') out.servingUnit = p.nutr_serving_unit;

  return Object.keys(out).length > 0 ? out : null;
}

/** Lest Naehrwerte aus dem LEGACY-Schema (naehrwerte / moreInformation). */
function fromLegacy(p: any): NaehrwerteShape | null {
  if (!p) return null;
  const n = p.naehrwerte ?? p.moreInformation ?? null;
  if (!n || typeof n !== 'object') return null;
  const out: NaehrwerteShape = {};
  const e = toNum(n.brennwertKcal ?? n.energie);
  if (e != null) out.brennwertKcal = e;
  const fett = toNum(n.fett);
  if (fett != null) out.fett = fett;
  const ges = toNum(n.gesaettigteFettsaeuren ?? n.gesaettigt);
  if (ges != null) out.gesaettigteFettsaeuren = ges;
  const k = toNum(n.kohlenhydrate);
  if (k != null) out.kohlenhydrate = k;
  const z = toNum(n.zucker);
  if (z != null) out.zucker = z;
  const ew = toNum(n.eiweiss ?? n.eiweis);
  if (ew != null) out.eiweiss = ew;
  const b = toNum(n.ballaststoffe);
  if (b != null) out.ballaststoffe = b;
  const salz = toNum(n.salz);
  if (salz != null) out.salz = salz;
  return Object.keys(out).length > 0 ? out : null;
}

/** Hauptfunktion: liefert die Naehrwerte aus dem Produkt. Bevorzugt
 *  neues nutr_*-Schema, dann legacy. Returnt null wenn nichts da ist. */
export function extractNaehrwerte(product: any): NaehrwerteShape | null {
  return fromNutrFields(product) ?? fromLegacy(product);
}

/**
 * Formatiert einen Nährwert-Zahlenwert für die Anzeige.
 * - Rundet auf max `decimals` Dezimalstellen (Default 2).
 * - Nutzt deutsche Locale (Komma als Dezimaltrennzeichen).
 * - Strippt trailing Nullen ("8,50" → "8,5", "8,00" → "8").
 *
 * Returns null für ungültige Inputs damit Caller "—" o.ä. rendern
 * können. ClickUp 86c9zf9q5: "bei nährwerten nur maximal 2 dezimal-
 * stellen erlauben (runden)" — vorher kamen rohe floats wie 8.347
 * direkt ans UI.
 */
export function formatNutritionValue(
  value: number | undefined | null,
  decimals = 2,
): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(value * factor) / factor;
  return rounded.toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** True wenn das Produkt verwendbare Zutaten hat (irgendein Format). */
export function hasIngredients(product: any): boolean {
  return extractIngredients(product).length > 0;
}

/** True wenn das Produkt mindestens einen Naehrwert-Wert hat. */
export function hasNaehrwerte(product: any): boolean {
  return extractNaehrwerte(product) !== null;
}

/** Klassifiziert die prozentuale Abweichung zwischen zwei Werten in
 *  drei Stufen — für UI-Color-Coding bei Naehrwert-Vergleichen:
 *    'none' → identisch / unter 2 % Diff / einer von beiden fehlt
 *    'warn' → 2 % ≤ Diff < 10 %  (gelb)
 *    'crit' → ≥ 10 %             (rot)
 *  Verwendet eine SYMMETRISCHE Diff-Definition (|a−b| / max(|a|,|b|))
 *  — keine Seite wird privilegiert.
 *
 *  Achtet auf Typen: strings/null/undefined/NaN ergeben 'none' (keine
 *  Färbung), nicht crash. Werte mit max=0 (beide null oder beide 0)
 *  ergeben 'none'. */
export function diffTier(
  a: number | null | undefined,
  b: number | null | undefined,
): 'none' | 'warn' | 'crit' {
  if (typeof a !== 'number' || typeof b !== 'number') return 'none';
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'none';
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return 'none';
  const pct = (Math.abs(a - b) / max) * 100;
  if (pct >= 10) return 'crit';
  if (pct >= 2) return 'warn';
  return 'none';
}

/** Merge zweier NaehrwerteShape-Objekte. `primary` gewinnt, `fallback`
 *  füllt nur fehlende Felder. Returnt zusätzlich ein per-Feld-flag
 *  ob das Feld aus dem Fallback kam — für UI-Caption ("Quelle: …"). */
export function mergeNaehrwerte(
  primary: NaehrwerteShape | null,
  fallback: NaehrwerteShape | null,
): { merged: NaehrwerteShape; usedFallback: boolean } {
  const out: NaehrwerteShape = {};
  let usedFallback = false;
  const keys: Array<keyof NaehrwerteShape> = [
    'brennwertKcal',
    'fett',
    'gesaettigteFettsaeuren',
    'kohlenhydrate',
    'zucker',
    'eiweiss',
    'ballaststoffe',
    'salz',
    'servingSize',
    'servingUnit',
  ];
  for (const k of keys) {
    const pv = primary?.[k];
    if (pv != null && pv !== '') {
      (out[k] as any) = pv;
    } else {
      const fv = fallback?.[k];
      if (fv != null && fv !== '') {
        (out[k] as any) = fv;
        usedFallback = true;
      }
    }
  }
  return { merged: out, usedFallback };
}
