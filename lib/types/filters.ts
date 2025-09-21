// Filter Types für erweiterte Produktfilter

export interface AllergenFilters {
  allergens_egg: boolean;
  allergens_fish: boolean;
  allergens_gluten: boolean;
  allergens_milk: boolean;
  allergens_mustard: boolean;
  allergens_nuts: boolean;
  allergens_peanuts: boolean;
  allergens_sesame: boolean;
  allergens_sulfites: boolean;
}

export interface NutritionRange {
  min?: number;
  max?: number;
}

export interface NutritionFilters {
  calories?: NutritionRange;
  saturatedFat?: NutritionRange;
  sugar?: NutritionRange;
  protein?: NutritionRange;
  carbohydrates?: NutritionRange;
  totalFat?: NutritionRange;
}

// Erweiterte Filter für NoName Produkte
export interface ExtendedNoNameFilters {
  categoryFilters: string[];
  discounterFilters: string[];
  stufeFilters: number[];
  priceMin?: number;
  priceMax?: number;
  markeFilter?: string;
  // Neue Filter
  allergenFilters: Partial<AllergenFilters>;
  nutritionFilters: NutritionFilters;
}

// Erweiterte Filter für Markenprodukte
export interface ExtendedMarkenproduktFilters {
  categoryFilters: string[];
  herstellerFilters: string[];
  priceMin?: number;
  priceMax?: number;
  // Neue Filter
  allergenFilters: Partial<AllergenFilters>;
  nutritionFilters: NutritionFilters;
}

// Helper Types
export const ALLERGEN_KEYS: (keyof AllergenFilters)[] = [
  'allergens_egg',
  'allergens_fish',
  'allergens_gluten',
  'allergens_milk',
  'allergens_mustard',
  'allergens_nuts',
  'allergens_peanuts',
  'allergens_sesame',
  'allergens_sulfites'
];

export const ALLERGEN_LABELS: Record<keyof AllergenFilters, string> = {
  allergens_egg: 'Ei',
  allergens_fish: 'Fisch',
  allergens_gluten: 'Gluten',
  allergens_milk: 'Milch',
  allergens_mustard: 'Senf',
  allergens_nuts: 'Nüsse',
  allergens_peanuts: 'Erdnüsse',
  allergens_sesame: 'Sesam',
  allergens_sulfites: 'Sulfite'
};

export const NUTRITION_LABELS: Record<keyof NutritionFilters, string> = {
  calories: 'Kalorien (kcal)',
  saturatedFat: 'Gesättigte Fettsäuren (g)',
  sugar: 'Zucker (g)',
  protein: 'Eiweiß (g)',
  carbohydrates: 'Kohlenhydrate (g)',
  totalFat: 'Fett (g)'
};
