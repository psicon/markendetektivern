/**
 * Analytics Types für Journey-Tracking
 * 
 * Diese Typen definieren die Struktur für das Tracking von User-Journeys
 * und deren Auswertbarkeit bzgl. Motivationen (Preis, Marke, Inhaltsstoffe)
 */

export interface MotivationAnalysis {
  userId: string;
  period: {
    start: Date;
    end: Date;
  };
  
  // Hauptmotivation des Users
  primaryMotivation: 'price' | 'brand' | 'content' | 'market_loyalty' | 'exploration';
  
  // Detaillierte Motivation-Scores (0-100)
  motivationScores: {
    price: number;      // Basierend auf Preis-Filtern, Sortierung, gewählten Stufen
    brand: number;      // Basierend auf Marken-Suche, Hersteller-Filtern
    content: number;    // Basierend auf Allergen-, Nährwert-Filtern
    market: number;     // Basierend auf Markt-Treue
  };
  
  // Conversion-Raten nach Motivation
  conversionRates: {
    overall: number;
    byMotivation: {
      price: { views: number; conversions: number; rate: number };
      brand: { views: number; conversions: number; rate: number };
      content: { views: number; conversions: number; rate: number };
      market: { views: number; conversions: number; rate: number };
    };
  };
  
  // Durchschnittliche Ersparnis
  savingsBehavior: {
    averageSavingsPerProduct: number;
    totalSavings: number;
    choosesHighestSavings: boolean; // True wenn > 70% höchste Ersparnis wählt
    priceRangePreference: {
      low: number;    // % Produkte unter 2€
      medium: number; // % Produkte 2-5€
      high: number;   // % Produkte über 5€
    };
  };
  
  // Filter-Verhalten
  filterBehavior: {
    averageFiltersPerJourney: number;
    mostUsedFilterTypes: string[];
    filterComplexity: 'simple' | 'moderate' | 'complex';
    abandonsWithHighComplexity: boolean;
  };
  
  // Produkt-Präferenzen
  productPreferences: {
    noNameRatio: number;      // % NoName vs Marken
    topCategories: string[];
    topBrands: string[];
    allergenAvoidance: string[];
  };
}

export interface JourneyAnalytics {
  journeyId: string;
  
  // Journey-Zusammenfassung
  summary: {
    duration: number;
    screens: string[];
    totalProducts: number;
    convertedProducts: number;
    motivation: string;
    outcome: 'purchased' | 'abandoned' | 'in_cart';
  };
  
  // Filter-Journey
  filterJourney: {
    startFilters: any;
    endFilters: any;
    changes: number;
    complexity: number;
  };
  
  // Produkt-Vergleiche
  comparisons: {
    productId: string;
    comparedWith: string[];
    chosenBecause: 'price' | 'brand' | 'content' | 'availability';
    savingsVsAlternatives: number;
  }[];
  
  // Conversion-Funnel
  funnel: {
    viewed: number;
    addedToCart: number;
    purchased: number;
    abandoned: number;
  };
}

export interface AggregatedAnalytics {
  // Globale Metriken
  global: {
    totalJourneys: number;
    completedJourneys: number;
    averageJourneyDuration: number;
    conversionRate: number;
  };
  
  // Motivations-Verteilung
  motivationDistribution: {
    price: number;      // % der Journeys
    brand: number;
    content: number;
    market: number;
    exploration: number;
  };
  
  // Filter-Effektivität
  filterEffectiveness: {
    [filterType: string]: {
      usage: number;
      conversionRate: number;
      averageProductsViewed: number;
    };
  };
  
  // Zeitbasierte Trends
  trends: {
    daily: {
      date: Date;
      journeys: number;
      conversions: number;
      primaryMotivation: string;
    }[];
  };
}
