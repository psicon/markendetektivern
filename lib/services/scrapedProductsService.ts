import { db } from '@/lib/firebase';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import OpenFoodService, { OpenFoodProduct } from './openfood';

export interface ScrapedProduct {
  id: string;
  gtin: string;
  productName: string;
  brandName: string;
  cleanProductName: string;
  price?: number;
  itemSize?: string;
  images?: string[];
  thumbnails?: string[];
  ingredients?: string;
  allergens_gluten?: boolean;
  allergens_milk?: boolean;
  allergens_egg?: boolean;
  allergens_nuts?: boolean;
  allergens_soy?: boolean;
  isVegan?: boolean;
  isVegetarian?: boolean;
  isGlutenFree?: boolean;
  isLactoseFree?: boolean;
  nutrition_caloriesKcal?: string | null;
  nutrition_protein?: string | null;
  nutrition_totalFat?: string | null;
  nutrition_saturatedFat?: string | null;
  nutrition_totalCarbohydrates?: string | null;
  nutrition_sugar?: string | null;
  nutrition_salt?: string | null;
  nutrition_servingSize?: string | null;
  productCategory?: string;
  productDescription?: string;
  producer?: string;
  master_manufacturer_id?: {
    __ref__: string;
  };
  herstellerId?: {
    __ref__: string;
  };
  source?: string;
  other?: string;
}

export interface FallbackProduct {
  type: 'scraped' | 'openfood';
  data: ScrapedProduct | OpenFoodProduct;
  displayData: {
    id: string;
    name: string;
    brandName?: string;
    price?: number;
    priceFormatted?: string;
    imageUrl?: string;
    packSize?: string;
    ingredients?: string;
    nutrition?: {
      calories?: string;
      protein?: string;
      fat?: string;
      carbs?: string;
      sugar?: string;
      salt?: string;
      servingSize?: string;
    };
    allergens?: {
      gluten?: boolean;
      milk?: boolean;
      egg?: boolean;
      nuts?: boolean;
      soy?: boolean;
    };
    scores?: {
      nutriscore?: string;
      ecoscore?: string;
      nova?: string;
    };
    producer?: string;
    description?: string;
    category?: string;
  };
}

class ScrapedProductsService {
  /**
   * Sucht in scraped_products nach einem Produkt mit der gegebenen GTIN
   */
  static async searchScrapedProductByGTIN(gtin: string): Promise<ScrapedProduct | null> {
    try {
      console.log(`🔍 Searching scraped products for GTIN: ${gtin}`);
      
      const scrapedProductsRef = collection(db, 'scraped_products');
      const q = query(
        scrapedProductsRef, 
        where('gtin', '==', gtin),
        limit(1)
      );
      
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        const product = {
          id: doc.id,
          ...doc.data()
        } as ScrapedProduct;
        
        console.log(`✅ Found scraped product: ${product.productName}`);
        return product;
      }
      
      console.log(`❌ No scraped product found for GTIN: ${gtin}`);
      return null;
      
    } catch (error) {
      console.error('Error searching scraped products:', error);
      return null;
    }
  }

  /**
   * Konvertiert ein ScrapedProduct in das einheitliche FallbackProduct Format
   */
  static convertScrapedToFallbackProduct(scraped: ScrapedProduct): FallbackProduct {
    // Parse nutrition values (remove units)
    const parseNutritionValue = (value: string | null | undefined): string | undefined => {
      if (!value) return undefined;
      // Extract number from strings like "86 kcal", "1,6 g"
      const match = value.match(/[\d,\.]+/);
      return match ? match[0].replace(',', '.') : undefined;
    };

    // Extract image URL
    const imageUrl = scraped.images?.[0] || scraped.thumbnails?.[0] || undefined;

    // Format price
    const priceFormatted = scraped.price 
      ? `€ ${scraped.price.toFixed(2).replace('.', ',')}`
      : undefined;

    return {
      type: 'scraped',
      data: scraped,
      displayData: {
        id: scraped.id,
        name: scraped.cleanProductName || scraped.productName,
        brandName: scraped.brandName,
        price: scraped.price,
        priceFormatted,
        imageUrl,
        packSize: scraped.itemSize,
        ingredients: scraped.ingredients,
        nutrition: {
          calories: parseNutritionValue(scraped.nutrition_caloriesKcal),
          protein: parseNutritionValue(scraped.nutrition_protein),
          fat: parseNutritionValue(scraped.nutrition_totalFat),
          carbs: parseNutritionValue(scraped.nutrition_totalCarbohydrates),
          sugar: parseNutritionValue(scraped.nutrition_sugar),
          salt: parseNutritionValue(scraped.nutrition_salt),
          servingSize: scraped.nutrition_servingSize
        },
        allergens: {
          gluten: scraped.allergens_gluten,
          milk: scraped.allergens_milk,
          egg: scraped.allergens_egg,
          nuts: scraped.allergens_nuts,
          soy: scraped.allergens_soy
        },
        producer: scraped.producer,
        description: scraped.productDescription,
        category: scraped.productCategory
      }
    };
  }

  /**
   * Konvertiert ein OpenFoodProduct in das einheitliche FallbackProduct Format
   */
  static convertOpenFoodToFallbackProduct(openFood: OpenFoodProduct): FallbackProduct {
    // Extract main image
    const imageUrl = openFood.image_url || openFood.image_front_url || undefined;

    // Extract brand name from brands field
    const brandName = openFood.brands?.split(',')[0]?.trim();

    return {
      type: 'openfood',
      data: openFood,
      displayData: {
        id: openFood.code,
        name: openFood.product_name || `Produkt ${openFood.code}`,
        brandName,
        imageUrl,
        packSize: openFood.quantity,
        ingredients: openFood.ingredients_text,
        nutrition: {
          calories: openFood.nutriments?.['energy-kcal_100g']?.toString(),
          protein: openFood.nutriments?.proteins_100g?.toString(),
          fat: openFood.nutriments?.fat_100g?.toString(),
          carbs: openFood.nutriments?.carbohydrates_100g?.toString(),
          sugar: openFood.nutriments?.sugars_100g?.toString(),
          salt: openFood.nutriments?.salt_100g?.toString(),
          servingSize: '100g'
        },
        allergens: {
          gluten: openFood.allergens_tags?.includes('en:gluten'),
          milk: openFood.allergens_tags?.includes('en:milk'),
          egg: openFood.allergens_tags?.includes('en:eggs'),
          nuts: openFood.allergens_tags?.includes('en:nuts'),
          soy: openFood.allergens_tags?.includes('en:soybeans')
        },
        scores: {
          nutriscore: openFood.nutriscore_grade,
          ecoscore: openFood.ecoscore_grade,
          nova: openFood.nova_group?.toString()
        },
        producer: openFood.manufacturing_places,
        description: openFood.generic_name
      }
    };
  }

  /**
   * Sucht ein Produkt in allen Fallback-Quellen
   * Reihenfolge: 1. Scraped Products, 2. OpenFood API
   */
  static async searchFallbackProduct(ean: string): Promise<FallbackProduct | null> {
    try {
      console.log(`🔎 Starting fallback search for EAN: ${ean}`);
      
      // 1. Versuche scraped_products
      const scrapedProduct = await this.searchScrapedProductByGTIN(ean);
      if (scrapedProduct) {
        console.log(`✅ Found in scraped_products`);
        return this.convertScrapedToFallbackProduct(scrapedProduct);
      }
      
      // 2. Versuche OpenFood API
      console.log(`🌐 Trying OpenFood API...`);
      const openFoodProduct = await OpenFoodService.getProductByEAN(ean);
      if (openFoodProduct && openFoodProduct.found && openFoodProduct.product_name) {
        console.log(`✅ Found in OpenFood: ${openFoodProduct.product_name}`);
        return this.convertOpenFoodToFallbackProduct(openFoodProduct);
      }
      
      console.log(`❌ No fallback product found for EAN: ${ean}`);
      return null;
      
    } catch (error) {
      console.error('Error in fallback search:', error);
      return null;
    }
  }
}

export default ScrapedProductsService;
