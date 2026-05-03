import { DocumentReference, Timestamp } from 'firebase/firestore';

// Firestore TypeScript Interfaces basierend auf echtem Schema

export interface Produkte {
  name: string;
  created_at: Timestamp;
  bild: string;
  beschreibung: string;
  kategorie: DocumentReference;
  packSize: number;
  packTyp: DocumentReference;
  preis: number;
  EAN: string;
  rating: number;
  ratingCount: number;
  handelsmarke: DocumentReference;
  discounter: DocumentReference;
  markenProdukt: DocumentReference;
  EANs: string[];
  preisDatum: Timestamp;
  same: boolean;
  stufe: string;
  hersteller: DocumentReference;
  averageRatingOverall: number;
  averageRatingContent: number;
  averageRatingPriceValue: number;
  averageRatingSimilarity: number;
  averageRatingTasteFunction: number;
  // 🚀 NEUE FELDER: Serverseitige Ersparnis-Berechnung
  ersparnis?: number; // Ersparnis in Euro gegenüber Markenprodukt
  ersparnisProz?: number; // Ersparnis in Prozent gegenüber Markenprodukt
  // 🎨 Bild-Cleanup-Pipeline (cloud-functions/image-cleanup/).
  // Drei Storage-Varianten pro Produkt. Niemals direkt vom Client
  // gesetzt — nur Cloud Functions + Backfill schreiben hier rein.
  // Wenn alle drei undefined sind, fällt `getProductImage()` auf
  // das Original-`bild`-Feld zurück.
  bildClean?: string;       // App-WebP (≤512 px, schnellladend) — Default für alle UI
  bildCleanPng?: string;    // PNG ≤1024 px — gute Qualität für Detail-Hero
  bildCleanHq?: string;     // PNG ≤1600 px — Gemini near-raw, höchste Qualität
  bildCleanVersion?: number;
  bildCleanSource?: 'gemini' | 'heuristic-skip';
  bildCleanProcessedAt?: Timestamp;
  bildCleanError?: string;
  bildCleanErrorAt?: Timestamp;
}

export interface MarkenProdukte {
  name: string;
  created_at: Timestamp;
  bild: string;
  beschreibung: string;
  hersteller: DocumentReference;
  kategorie: DocumentReference;
  packSize: number;
  packTyp: DocumentReference;
  preis: number;
  EAN: string;
  rating: number;
  ratingCount: number;
  relatedProdukte: DocumentReference[];
  relatedProdukteIDs: string[];
  EANs: string[];
  preisDatum: Timestamp;
  averageRatingOverall: number;
  averageRatingContent: number;
  averageRatingPriceValue: number;
  averageRatingSimilarity: number;
  averageRatingTasteFunction: number;
  // 🎨 Bild-Cleanup-Pipeline (cloud-functions/image-cleanup/).
  // Identisch zu Produkte — siehe dort für Details.
  bildClean?: string;
  bildCleanPng?: string;
  bildCleanHq?: string;
  bildCleanVersion?: number;
  bildCleanSource?: 'gemini' | 'heuristic-skip';
  bildCleanProcessedAt?: Timestamp;
  bildCleanError?: string;
  bildCleanErrorAt?: Timestamp;
}

export interface Kategorien {
  bezeichnung: string;
  bild: string;
  isFree: boolean;
  getsFreeAtLevel?: number; // 0 = sofort verfügbar, 1-10 = bei diesem Level freigeschaltet
}

export interface Discounter {
  land: string;
  infos: string;
  bild: string;
  name: string;
  isFree: boolean;
  color: string;
}

export interface Handelsmarken {
  bezeichnung: string;
  bild: string;
  name: string;
}

export interface HerstellerNew {
  bild: string;
  adresse: string;
  identNummer: string;
  land: string;
  name: string;
  plz: string;
  stadt: string;
  herstellername: string;
}

export interface Packungstypen {
  typ: string;
  typKurz: string;
}

// Utility type for Firestore documents with ID
export type FirestoreDocument<T> = T & {
  id: string;
};

// Product with populated references for display
export interface ProductWithDetails extends Omit<Produkte, 'kategorie' | 'discounter' | 'handelsmarke' | 'hersteller' | 'markenProdukt'> {
  id: string;
  kategorie?: Kategorien;
  discounter?: Discounter;
  handelsmarke?: Handelsmarken;
  hersteller?: HerstellerNew;
  markenProdukt?: MarkenProdukte;
}

// MarkenProdukt with populated references for display
export interface MarkenProduktWithDetails extends Omit<MarkenProdukte, 'kategorie' | 'hersteller'> {
  id: string;
  kategorie?: Kategorien;
  hersteller?: HerstellerNew;
  marke?: { bezeichnung: string; id: string; bild: string | null }; // Für Fallback-Produkte
  zutaten?: string; // Für Fallback-Produkte
  nutriscore?: string; // Für Fallback-Produkte
  ecoscore?: string; // Für Fallback-Produkte
  nova?: string; // Für Fallback-Produkte
  naehrwerte?: {
    brennwertKcal: number;
    fett: number;
    gesaettigteFettsaeuren: number;
    kohlenhydrate: number;
    zucker: number;
    eiweiss: number;
    salz: number;
  };
  isFallback?: boolean; // Flag für Fallback-Produkte
  fallbackSource?: string; // 'scraped' oder 'openfood'
  originalData?: any; // Original Fallback-Daten
}

// Shopping Cart / Einkaufszettel types
export interface Einkaufswagen {
  // Bestehende DB-Produkte
  handelsmarkenProdukt?: DocumentReference; // Referenz zum NoName Produkt
  markenProdukt?: DocumentReference; // Referenz zum Markenprodukt
  
  // Neue Custom-Items (Freitext)
  customItem?: {
    name: string; // "Butter", "Milch", etc.
    type: 'brand' | 'noname'; // Produkttyp
    icon?: string; // MaterialCommunityIcons name, z.B. "bread-slice"
    marketId?: string; // Markt-ID (nur bei NoName)
    marketName?: string; // Markt-Name für Anzeige
    marketLand?: string; // Land des Marktes (für Flaggen)
    marketBild?: string; // Bild-URL des Marktes
  };
  
  gekauft: boolean; // Ob das Produkt bereits gekauft wurde
  timestamp: Timestamp;
  name: string; // Name des Produkts für schnelle Anzeige
}

export interface CartMarkenProduktData {
  markenProdukt: FirestoreDocument<MarkenProdukte>;
  produkte: FirestoreDocument<Produkte>[]; // NoName Alternativen
  einkaufswagenRef: string; // Referenz zum Einkaufswagen-Eintrag
}

export interface CartNoNameProduktData {
  produkt: FirestoreDocument<Produkte>;
  einkaufswagenRef: string;
  savings?: number; // Ersparnis gegenüber Markenprodukt
}

export interface ProductToConvert {
  produktRef: string; // Ausgewähltes NoName Produkt
  einkaufswagenRef: string; // Einkaufswagen-Eintrag
  markenProduktRef: string; // Original Markenprodukt
}
