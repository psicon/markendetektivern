// Utility functions für das Parsen von Nährwertangaben

export interface ParsedNutrition {
  calories?: number;
  saturatedFat?: number;
  sugar?: number;
  protein?: number;
  carbohydrates?: number;
  totalFat?: number;
}

/**
 * Extrahiert numerischen Wert aus Nährwertstring
 * Beispiele: "87 kcal" -> 87, "14,5 g" -> 14.5, "<0,1 g" -> 0.1
 */
export function parseNutritionValue(value: string | undefined): number | undefined {
  if (!value || typeof value !== 'string') return undefined;
  
  // Entferne führende/nachfolgende Leerzeichen
  const trimmed = value.trim();
  
  // Ersetze Komma durch Punkt für Dezimalzahlen
  const normalized = trimmed.replace(',', '.');
  
  // Verschiedene Muster für Nährwertangaben
  const patterns = [
    // Standard: "87 kcal" oder "14.5 g"
    /^([\d.]+)\s*(?:kcal|g|mg)?$/i,
    // Mit < oder >: "<0.1 g"
    /^[<>]?\s*([\d.]+)\s*(?:kcal|g|mg)?$/i,
    // Range: "10-15 g" (nehme den Mittelwert)
    /^([\d.]+)\s*-\s*([\d.]+)\s*(?:kcal|g|mg)?$/i
  ];
  
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      if (match[2]) {
        // Range gefunden, nehme Mittelwert
        const min = parseFloat(match[1]);
        const max = parseFloat(match[2]);
        return (min + max) / 2;
      }
      return parseFloat(match[1]);
    }
  }
  
  return undefined;
}

/**
 * Parst alle Nährwertangaben aus einem moreInformation Objekt
 */
export function parseProductNutrition(moreInformation: any): ParsedNutrition {
  if (!moreInformation || typeof moreInformation !== 'object') {
    return {};
  }
  
  return {
    calories: parseNutritionValue(moreInformation.nutrition_caloriesKcal),
    saturatedFat: parseNutritionValue(moreInformation.nutrition_saturatedFat),
    sugar: parseNutritionValue(moreInformation.nutrition_sugar),
    protein: parseNutritionValue(moreInformation.nutrition_protein),
    carbohydrates: parseNutritionValue(moreInformation.nutrition_totalCarbohydrates),
    totalFat: parseNutritionValue(moreInformation.nutrition_totalFat)
  };
}

/**
 * Prüft ob ein Produkt die Nährwertfilter erfüllt
 */
export function matchesNutritionFilter(
  nutrition: ParsedNutrition,
  filter: { min?: number; max?: number } | undefined
): boolean {
  if (!filter || (filter.min === undefined && filter.max === undefined)) {
    return true;
  }
  
  // Wenn der Nährwert nicht vorhanden ist, schließe das Produkt aus
  const value = Object.values(nutrition)[0];
  if (value === undefined) {
    return false;
  }
  
  if (filter.min !== undefined && value < filter.min) {
    return false;
  }
  
  if (filter.max !== undefined && value > filter.max) {
    return false;
  }
  
  return true;
}

/**
 * Optimierte Funktion für Firestore Compound Queries
 * Erstellt Index-freundliche Queries für Nährwertbereiche
 */
export function createNutritionIndexFields(moreInformation: any): Record<string, number | null> {
  const nutrition = parseProductNutrition(moreInformation);
  
  return {
    // Indexierte Felder für effiziente Range-Queries
    nutrition_calories_index: nutrition.calories ?? null,
    nutrition_saturatedFat_index: nutrition.saturatedFat ?? null,
    nutrition_sugar_index: nutrition.sugar ?? null,
    nutrition_protein_index: nutrition.protein ?? null,
    nutrition_carbohydrates_index: nutrition.carbohydrates ?? null,
    nutrition_totalFat_index: nutrition.totalFat ?? null
  };
}
