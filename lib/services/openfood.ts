/**
 * OpenFoodFacts API Service
 * Lädt Nährwerte und Zutaten basierend auf EAN
 */

export interface OpenFoodNutrition {
  energy_100g?: number;           // kJ pro 100g
  'energy-kcal_100g'?: number;    // kcal pro 100g
  fat_100g?: number;              // Fett pro 100g
  'saturated-fat_100g'?: number;  // Gesättigte Fettsäuren pro 100g
  carbohydrates_100g?: number;    // Kohlenhydrate pro 100g
  sugars_100g?: number;           // Zucker pro 100g
  fiber_100g?: number;            // Ballaststoffe pro 100g
  proteins_100g?: number;         // Protein pro 100g
  salt_100g?: number;             // Salz pro 100g
  sodium_100g?: number;           // Natrium pro 100g
}

export interface OpenFoodProduct {
  code: string;                   // EAN Code
  product_name?: string;          // Produktname
  brands?: string;                // Marken
  categories?: string;            // Kategorien
  ingredients_text_de?: string;   // Zutaten auf Deutsch
  ingredients_text?: string;      // Zutaten (Fallback)
  nutriments?: OpenFoodNutrition; // Nährwerte
  nutriscore_grade?: string;      // Nutri-Score (a-e)
  ecoscore_grade?: string;        // Eco-Score (a-e)
  nova_group?: number;            // NOVA Score (1-4)
  image_url?: string;             // Produktbild
  image_front_url?: string;       // Alternatives Produktbild
  quantity?: string;              // Packungsgröße
  allergens_tags?: string[];      // Allergene
  manufacturing_places?: string;  // Herstellungsorte
  generic_name?: string;          // Generischer Name
  found: boolean;                 // Wurde das Produkt gefunden?
}

class OpenFoodService {
  private static readonly BASE_URL = 'https://world.openfoodfacts.org/api/v0/product';
  private static readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 Stunden
  private static cache = new Map<string, { data: OpenFoodProduct, timestamp: number }>();

  /**
   * Lädt Produktdaten von OpenFoodFacts API
   */
  static async getProductByEAN(ean: string): Promise<OpenFoodProduct | null> {
    try {
      // Cache prüfen
      const cached = this.cache.get(ean);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_DURATION) {
        console.log(`🗄️ OpenFood Cache Hit für EAN: ${ean}`);
        return cached.data;
      }

      console.log(`🌍 Lade OpenFood Daten für EAN: ${ean}`);
      
      const response = await fetch(`${this.BASE_URL}/${ean}.json`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.status !== 1 || !result.product) {
        console.warn(`❌ OpenFood: Produkt nicht gefunden für EAN: ${ean}`);
        return {
          code: ean,
          found: false
        };
      }

      const product: OpenFoodProduct = {
        code: ean,
        product_name: result.product.product_name,
        brands: result.product.brands,
        categories: result.product.categories,
        ingredients_text_de: result.product.ingredients_text_de,
        ingredients_text: result.product.ingredients_text,
        nutriments: result.product.nutriments,
        nutriscore_grade: result.product.nutriscore_grade?.toUpperCase(),
        ecoscore_grade: result.product.ecoscore_grade?.toUpperCase(),
        nova_group: result.product.nova_group,
        image_url: result.product.image_url,
        image_front_url: result.product.image_front_url,
        quantity: result.product.quantity,
        allergens_tags: result.product.allergens_tags,
        manufacturing_places: result.product.manufacturing_places,
        generic_name: result.product.generic_name,
        found: true
      };

      // Debug Scores
      console.log(`🔍 OpenFood Scores for ${ean}:`, {
        nutriscore: result.product.nutriscore_grade,
        ecoscore: result.product.ecoscore_grade,
        nova: result.product.nova_group,
        formatted: {
          nutriscore: product.nutriscore_grade,
          ecoscore: product.ecoscore_grade,
          nova: product.nova_group
        }
      });

      // Cache speichern
      this.cache.set(ean, {
        data: product,
        timestamp: Date.now()
      });

      console.log(`✅ OpenFood Daten geladen für: ${product.product_name}`);
      return product;

    } catch (error) {
      console.error(`❌ Fehler beim Laden von OpenFood Daten für EAN ${ean}:`, error);
      return null;
    }
  }

  /**
   * Lädt Daten für mehrere EANs parallel
   */
  static async getProductsByEANs(eans: string[]): Promise<Map<string, OpenFoodProduct | null>> {
    console.log(`🌍 Lade OpenFood Daten für ${eans.length} EANs parallel`);
    
    const results = await Promise.allSettled(
      eans.map(async (ean) => ({
        ean,
        data: await this.getProductByEAN(ean)
      }))
    );

    const dataMap = new Map<string, OpenFoodProduct | null>();
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        dataMap.set(result.value.ean, result.value.data);
      } else {
        console.error(`❌ OpenFood Fehler für EAN ${eans[index]}:`, result.reason);
        dataMap.set(eans[index], null);
      }
    });

    return dataMap;
  }

  /**
   * Formatiert Nährwerte für die Anzeige
   */
  static formatNutrition(nutriments?: OpenFoodNutrition): Array<{label: string, value: string}> {
    if (!nutriments) return [];

    const nutrition = [];

    // 1. Energie - bevorzuge kcal, fallback auf kJ
    if (nutriments['energy-kcal_100g']) {
      nutrition.push({
        label: 'Energie',
        value: `${Math.round(nutriments['energy-kcal_100g'])} kcal`
      });
    } else if (nutriments.energy_100g) {
      // Konvertiere kJ zu kcal (1 kcal = 4.184 kJ)
      const kcal = Math.round(nutriments.energy_100g / 4.184);
      nutrition.push({
        label: 'Energie',
        value: `${kcal} kcal`
      });
    }

    // 2. Fett
    if (nutriments.fat_100g !== undefined) {
      nutrition.push({
        label: 'Fett',
        value: `${nutriments.fat_100g.toFixed(1)} g`
      });
    }

    // 3. Kohlenhydrate
    if (nutriments.carbohydrates_100g !== undefined) {
      nutrition.push({
        label: 'Kohlenhydrate',
        value: `${nutriments.carbohydrates_100g.toFixed(1)} g`
      });
    }

    // 4. Zucker
    if (nutriments.sugars_100g !== undefined) {
      nutrition.push({
        label: 'Zucker',
        value: `${nutriments.sugars_100g.toFixed(1)} g`
      });
    }

    return nutrition;
  }

  /**
   * Formatiert Zutaten für die Anzeige
   */
  static formatIngredients(openFoodProduct?: OpenFoodProduct): string {
    if (!openFoodProduct) return '';
    
    // Bevorzuge deutsche Zutaten, Fallback auf englische
    const ingredients = openFoodProduct.ingredients_text_de || openFoodProduct.ingredients_text;
    
    if (!ingredients) return '';
    
    // Bereinige und formatiere den Text
    return ingredients
      .replace(/\*/g, '') // Entferne Sterne
      .replace(/\s+/g, ' ') // Normalisiere Leerzeichen
      .trim();
  }

  /**
   * Cache löschen (für Testing/Debug)
   */
  static clearCache(): void {
    this.cache.clear();
    console.log('🗑️ OpenFood Cache geleert');
  }
}

export default OpenFoodService;
