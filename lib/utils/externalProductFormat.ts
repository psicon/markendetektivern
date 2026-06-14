/**
 * Pure Formatter-/Normalisierungs-Helfer für die External-Product-Seite.
 *
 * Aus `app/external-product/[ean].tsx` extrahiert, damit sie ohne RN-/Expo-
 * Runtime unit-testbar sind (der Screen importiert RN-Module). Reine
 * Funktionen, keine Seiteneffekte.
 */

/** Preis (EUR) als deutsches Label, z.B. 1.49 → "1,49 €". null bei Nicht-Zahl. */
export function formatPrice(eur?: number): string | null {
  if (typeof eur !== 'number') return null;
  return `${eur.toFixed(2).replace('.', ',')} €`;
}

/** Nährwert-Zahl mit optionaler Einheit, z.B. (12.5,'g') → "12,5 g". Ganze
 *  Zahlen ohne Dezimalstelle. null bei Nicht-Zahl. */
export function formatNum(v?: number, unit?: string): string | null {
  if (typeof v !== 'number') return null;
  const fixed = v % 1 === 0 ? v.toString() : v.toFixed(1).replace('.', ',');
  return `${fixed}${unit ? ` ${unit}` : ''}`;
}

/**
 * Pack-Label + Grundpreis — 1:1 aus Stöbern (explore.tsx formatPack), damit
 * die Alternativen-Cards exakt wie das Stöbern-/Home-Grid aussehen.
 *   size=170, unit='g',  price=0.99 → ('170g',  '5,82€/kg')
 *   size=1.5, unit='l',  price=0.55 → ('1.5l',  '0,37€/L')
 *   size=25,  unit='Stk',price=1.19 → ('25 Stk','0,05€/Stk.')
 */
export function formatPack(
  size?: number,
  unit?: string,
  price?: number,
): { sizeLabel: string | null; unitPriceLabel: string | null } {
  if (!size || !unit) return { sizeLabel: null, unitPriceLabel: null };
  const u = unit.toLowerCase().replace(/\.$/, '');
  const isStk = u === 'stk' || u === 'stück';
  const sizeLabel = isStk ? `${size} ${unit}` : `${size}${unit}`;
  let unitPriceLabel: string | null = null;
  if (price && price > 0) {
    if (u === 'g') unitPriceLabel = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/kg`;
    else if (u === 'kg') unitPriceLabel = `${(price / size).toFixed(2).replace('.', ',')}€/kg`;
    else if (u === 'ml') unitPriceLabel = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/L`;
    else if (u === 'l') unitPriceLabel = `${(price / size).toFixed(2).replace('.', ',')}€/L`;
    else if (isStk) unitPriceLabel = `${(price / size).toFixed(2).replace('.', ',')}€/Stk.`;
  }
  return { sizeLabel, unitPriceLabel };
}

/**
 * OpenFood liefert für Nutri-/Eco-Score teils 'not-applicable', 'unknown'
 * oder leere Strings statt einer echten Note. Das ist KEINE Bewertung →
 * solche Badges weglassen, statt 'NOT-APPLICABLE' anzuzeigen.
 * Gültig: a–e (kind='letter') bzw. 1–4 (kind='nova'). Sonst null.
 */
export function normalizeGrade(
  raw: string | undefined,
  kind: 'letter' | 'nova',
): string | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v || v.includes('not') || v.includes('unknown') || v === 'na' || v === 'n/a') {
    return null;
  }
  if (kind === 'letter') {
    const c = v.charAt(0);
    return ['a', 'b', 'c', 'd', 'e'].includes(c) ? c.toUpperCase() : null;
  }
  const n = v.replace(/[^1-4]/g, '').charAt(0);
  return ['1', '2', '3', '4'].includes(n) ? n : null;
}
