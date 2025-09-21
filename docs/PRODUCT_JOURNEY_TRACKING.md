# Produktzentrierte Journey-Tracking Struktur

## Übersicht

Die Journey-Tracking-Struktur wurde erweitert, um eine **produktzentrierte Sicht** zu ermöglichen. Jedes Produkt in `viewedProducts` enthält nun seine komplette Journey mit allen Aktionen.

## Erweiterte Struktur in `viewedProducts`

```typescript
viewedProducts: {
  // Basis-Informationen
  productId: string;
  productType: 'brand' | 'noname';
  productName: string;
  timestamp: number;
  position?: number;
  fromScreen: string;
  
  // NEU: Discovery Context - wie wurde das Produkt gefunden
  discoveryContext: {
    method: 'browse' | 'search' | 'scan' | 'category' | 'favorites' | 'repurchase' | 'comparison';
    searchQuery?: string;
    activeFiltersSnapshot?: any; // Filter zum Zeitpunkt der Entdeckung
    comparedWithProducts?: { // Bei Vergleichsansicht
      productId: string;
      productName: string;
      productType: 'brand' | 'noname';
    }[];
  };
  
    // NEU: Alle Aktionen mit diesem Produkt
    actions?: {
      timestamp: number;
      type: 'viewed' | 'addedToCart' | 'removedFromCart' | 'addedToFavorites' | 
            'removedFromFavorites' | 'purchased' | 'converted' | 'compared';
      
      // NEU: Produkt-Details direkt in jeder Action!
      productId: string;
      productName: string;
      productType: 'brand' | 'noname';
      productRef?: DocumentReference; // Echte Firestore Referenz
      
      fromScreen?: string;
      fromFilters?: any;
      price?: number;
      savings?: number;
      comparedProducts?: any[];
      
      // NEU: Motivation für diese Action
      motivationSignals?: {
        priceMotivation: number;     // 0-1
        brandMotivation: number;     // 0-1
        contentMotivation: number;   // 0-1
        savingsMotivation: number;   // 0-1
        reason?: string;
      };
      
      // NEU: Bei Aktionen aus Vergleichsansicht - welches Produkt war Kontext?
      comparisonContext?: {
        mainProductId: string; // Das Hauptprodukt der Vergleichsansicht
        mainProductName: string;
        mainProductType: 'brand' | 'noname';
        actionProduct?: { // Falls die Aktion ein anderes Produkt betrifft
          productId: string;
          productName: string;
          productType: 'brand' | 'noname';
        };
      };
      
      // Für Conversions
      toProductId?: string;
      toProductName?: string;
      market?: string;
      // Für View-Actions
      viewDuration?: number;
    }[];
  
  // NEU: Finaler Status
  finalStatus?: {
    wasAddedToCart: boolean;
    wasAddedToFavorites: boolean;
    wasPurchased: boolean;
    wasConverted: boolean;
    finalPrice?: number;
    finalSavings?: number;
    totalInteractions: number; // Anzahl aller Interaktionen
  };
  
  // NEU: Comparison Result (falls Vergleichsansicht)
  comparisonResult?: {
    viewDuration: number; // Sekunden auf der Seite
    productsCompared: number; // Anzahl Alternativen
    selectedProduct?: string; // Was wurde gewählt
    abandonmentReason?: 'price_too_high' | 'no_suitable_alternative' | 'just_browsing' | 'app_closed';
    priceRange: { min: number; max: number };
    savingsRange: { min: number; max: number };
  };
}[]
```

## Beispiel einer kompletten Produkt-Journey

### Beispiel 1: Normale Produkt-Journey

```json
{
  "productId": "XMPDOjmoDjfdFNepkfuG",
  "productType": "noname",
  "productName": "Alpenmilch Schokolade",
  "timestamp": 1758446318000,
  "position": 2,
  "fromScreen": "search-results",
  "discoveryContext": {
    "method": "search",
    "searchQuery": "schokolade",
    "activeFiltersSnapshot": {
      "searchQuery": "schokolade",
      "markets": [],
      "categories": []
    }
  },
  "actions": [
    {
      "timestamp": 1758446318000,
      "type": "viewed",
      "productId": "XMPDOjmoDjfdFNepkfuG",
      "productName": "Alpenmilch Schokolade",
      "productType": "noname",
      "fromScreen": "search-results",
      "fromFilters": { "searchQuery": "schokolade" }
    },
    {
      "timestamp": 1758446320000,
      "type": "addedToCart",
      "productId": "XMPDOjmoDjfdFNepkfuG",
      "productName": "Alpenmilch Schokolade",
      "productType": "noname",
      "fromFilters": { "searchQuery": "schokolade" },
      "price": 1.19,
      "savings": 0.70,
      "comparedProducts": [
        { "productId": "abc123", "productName": "Milka", "price": 1.89, "savings": 0 }
      ]
    },
    {
      "timestamp": 1758446330000,
      "type": "purchased",
      "productId": "XMPDOjmoDjfdFNepkfuG",
      "productName": "Alpenmilch Schokolade", 
      "productType": "noname",
      "price": 1.19,
      "savings": 0.70
    }
  ],
  "finalStatus": {
    "wasAddedToCart": true,
    "wasAddedToFavorites": false,
    "wasPurchased": true,
    "wasConverted": false,
    "finalPrice": 1.19,
    "finalSavings": 0.70,
    "totalInteractions": 3
  }
}
```

### Beispiel 2: Journey mit Vergleichskontext

```json
{
  "productId": "Sqsp0MMikvTN3IXBalL9",
  "productType": "noname",
  "productName": "Geflügel Bierschinken",
  "actions": [
    {
      "timestamp": 1758449268903,
      "type": "addedToFavorites",
      "productId": "Sqsp0MMikvTN3IXBalL9",
      "productName": "Geflügel Bierschinken",
      "productType": "noname",
      "fromFilters": { "searchQuery": "Bier" },
      "price": 1.99,
      "savings": 0,
      "comparisonContext": {
        "mainProductId": "Milka123",
        "mainProductName": "Milka Alpenmilch",
        "mainProductType": "brand",
        "actionProduct": {
          "productId": "Sqsp0MMikvTN3IXBalL9",
          "productName": "Geflügel Bierschinken",
          "productType": "noname"
        }
      }
    }
  ]
}
```

In diesem Beispiel wurde "Geflügel Bierschinken" zu den Favoriten hinzugefügt, während der User eigentlich "Milka Alpenmilch" angeschaut hat. Der `comparisonContext` zeigt klar:

- **Hauptprodukt**: Milka Alpenmilch (brand)
- **Aktion betrifft**: Geflügel Bierschinken (noname)

## Vorteile der neuen Struktur

1. **Klarheit**: Alle Aktionen eines Produkts sind an einem Ort
2. **Nachvollziehbarkeit**: Chronologische Reihenfolge aller Interaktionen
3. **Vollständigkeit**: Finaler Status zeigt den Endpunkt der Produkt-Journey
4. **Analyse**: Einfache Auswertung pro Produkt möglich

## Tracking-Flow

```
1. User sucht "schokolade"
   → searchQuery wird in activeFilters gespeichert
   
2. User sieht Produkt in Suchergebnissen
   → trackProductView() erstellt Eintrag in viewedProducts
   
3. User fügt zum Warenkorb hinzu
   → trackAddToCart() fügt Aktion zu viewedProducts[].actions hinzu
   → finalStatus.wasAddedToCart = true
   
4. User navigiert zu Stöbern und filtert
   → activeFilters werden aktualisiert
   
5. User fügt weiteres Produkt hinzu
   → Neues Produkt in viewedProducts mit eigener Journey
   
6. User kauft alle Produkte
   → trackPurchase() updated alle gekauften Produkte
   → finalStatus.wasPurchased = true für jedes Produkt
```

## Firestore-Struktur

Die erweiterte `viewedProducts` Struktur wird vollständig in Firestore gespeichert:

```
users/
  {userId}/
    journeys/
      {journeyId}/
        - viewedProducts: Array mit kompletter Produkt-Journey
        - activeFilters: Aktuelle Filter-Einstellungen
        - addedToCart: Array (für Kompatibilität)
        - addedToFavorites: Array (für Kompatibilität)
        - purchased: Finale Kauf-Information
```

## Migration

Die bestehenden Arrays (`addedToCart`, `addedToFavorites`, etc.) bleiben für Backward-Compatibility erhalten. Neue Analysen sollten aber auf `viewedProducts` basieren, da dort die vollständige Journey enthalten ist.
