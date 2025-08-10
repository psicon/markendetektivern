# MarkenDetektive Firestore Schema (Focused)

> **Vollständige Schemas der relevanten Collections für die App-Implementation**  
> Letzte Aktualisierung: 10.8.2025  
> Basierend auf Live-Datenbank-Analyse

---

## 📋 Collections Overview

| Collection | Documents | Fields | Subcollections | Purpose |
|------------|-----------|---------|----------------|---------|
| `abopreise` | 1 | 3 | 0 | Premium-Preise |
| `appSettings` | 1 | 5 | 0 | App-Konfiguration |
| `discounter` | 3+ | 6 | 0 | Supermarkt-Ketten |
| `handelsmarken` | 3+ | 2 | 0 | Eigenmarken |
| `hersteller` | 3+ | 98 | 0 | Hersteller-Daten |
| `hersteller_new` | 3+ | 9 | 0 | Neue Hersteller |
| `kategorien` | 3+ | 3 | 0 | Produktkategorien |
| `markenProdukte` | 3+ | 285 | 0 | Markenprodukte |
| `packungstypen` | 3+ | 2 | 0 | Verpackungsarten |
| `productRatings` | 3+ | 269 | 0 | Produktbewertungen |
| `produkte` | 3+ | 638 | 0 | NoName-Produkte |
| `users` | 3+ | 6 | 4 | Benutzerprofile |
| `vetnummern` | 3+ | 6 | 0 | Veterinärnummern |
| `vetnummernat` | 3+ | 5 | 0 | Nat. Vet-Nummern |

---

## 1. `abopreise` - Premium Subscription Prices

```typescript
interface Abopreise {
  monthly: number;               // Double
  yearly: number;                // Double  
  yearlyformonthly: number;      // Double
}
```

---

## 2. `appSettings` - Application Configuration

```typescript
interface AppSettings {
  contactEMail: string;                    // "info@markendetektive.de"
  freeScansPerDay: number;                 // 3
  minCumulativeUsageMinutes: number;       // 1
  ratePromptIntervalDays: number;          // 0
  scansCountBeforeFeedbackPrompt: number;  // 3
}
```

**Sample Data:**

```json
{
  "contactEMail": "info@markendetektive.de",
  "freeScansPerDay": 3,
  "minCumulativeUsageMinutes": 1,
  "ratePromptIntervalDays": 0,
  "scansCountBeforeFeedbackPrompt": 3
}
```

---

## 3. `discounter` - Supermarket Chains

```typescript
interface Discounter {
  land: string;        // String
  infos: string;       // String
  bild: string;        // Image Path
  name: string;        // String
  isFree: boolean;     // Boolean
  color: string;       // Color
}
```

---

## 4. `handelsmarken` - Private Label Brands

```typescript
interface Handelsmarken {
  bezeichnung: string;   // String
  bild: string;         // Image Path
  name: string;         // String
}
```

---

## 5. `hersteller` - Manufacturers

```typescript
interface Hersteller {
  bild: string;                              // Image Path
  adresse: string;                           // String
  identNummer: string;                       // String
  land: string;                              // String
  name: string;                              // String
  plz: string;                               // String
  stadt: string;                             // String
  infos: string;                             // String
  hersteller: DocumentReference;             // Doc Reference (hersteller_new)
  herstellerref: DocumentReference;          // Doc Reference (hersteller_new)
}
```

---

## 6. `hersteller_new` - New Manufacturer Format

```typescript
interface HerstellerNew {
  bild: string;           // Image Path
  adresse: string;        // String
  identNummer: string;    // String
  land: string;           // String
  name: string;           // String
  plz: string;            // String
  stadt: string;          // String
  herstellername: string; // String
}
```

---

## 7. `kategorien` - Product Categories

```typescript
interface Kategorien {
  bezeichnung: string;   // String
  bild: string;          // Image Path
  isFree: boolean;       // Boolean
}
```

---

## 8. `markenProdukte` - Brand Products

```typescript
interface MarkenProdukte {
  name: string;                              // String
  created_at: Date | FirebaseTimestamp;     // DateTime
  bild: string;                              // Image Path
  beschreibung: string;                      // String
  hersteller: DocumentReference;             // Doc Reference (hersteller)
  kategorie: DocumentReference;              // Doc Reference (kategorien)
  packSize: number;                          // Double
  packTyp: DocumentReference;               // Doc Reference (packungstypen)
  preis: number;                             // Double
  EAN: string;                               // String
  rating: number;                            // Double
  ratingCount: number;                       // Integer
  relatedProdukte: DocumentReference[];     // List < Doc Reference (produkte) >
  relatedProdukteIDs: string[];             // List < String >
  EANs: string[];                           // List < String >
  preisDatum: Date | FirebaseTimestamp;     // DateTime
  averageRatingOverall: number;             // Double
  averageRatingContent: number;             // Double
  averageRatingPriceValue: number;          // Double
  averageRatingSimilarity: number;          // Double
  averageRatingTasteFunction: number;       // Double
}
```

---

## 9. `packungstypen` - Package Types

```typescript
interface Packungstypen {
  typ: string;           // String
  typKurz: string;       // String
}
```

---

## 10. `productRatings` - Product Ratings

```typescript
interface ProductRatings {
  productID: DocumentReference;              // Doc Reference (produkte)
  userID: DocumentReference;                 // Doc Reference (users)
  brandProductID: DocumentReference;         // Doc Reference (markenProdukte)
  ratedate: Date | FirebaseTimestamp;        // DateTime
  updatedate: Date | FirebaseTimestamp;      // DateTime
  comment: string;                           // String
  ratingOverall: number;                     // Double
  ratingPriceValue: number;                  // Double
  ratingTasteFunction: number;               // Double
  ratingSimilarity: number;                  // Double
  ratingContent: number;                     // Double
}
```

---

## 11. `produkte` - NoName Products

```typescript
interface Produkte {
  name: string;                              // String
  created_at: Date | FirebaseTimestamp;     // DateTime
  bild: string;                              // Image Path
  beschreibung: string;                      // String
  kategorie: DocumentReference;              // Doc Reference (kategorien)
  packSize: number;                          // Double
  packTyp: DocumentReference;               // Doc Reference (packungstypen)
  preis: number;                             // Double
  EAN: string;                               // String
  rating: number;                            // Double
  ratingCount: number;                       // Integer
  handelsmarke: DocumentReference;           // Doc Reference (handelsmarken)
  discounter: DocumentReference;             // Doc Reference (discounter)
  markenProdukt: DocumentReference;          // Doc Reference (markenProdukte)
  EANs: string[];                           // List < String >
  preisDatum: Date | FirebaseTimestamp;     // DateTime
  same: boolean;                            // Boolean
  stufe: string;                            // String
  hersteller: DocumentReference;            // Doc Reference (hersteller_new)
  averageRatingOverall: number;             // Double
  averageRatingContent: number;             // Double
  averageRatingPriceValue: number;          // Double
  averageRatingSimilarity: number;          // Double
  averageRatingTasteFunction: number;       // Double
}
```

---

## 12. `users` - User Profiles

```typescript
interface Users {
  // Basis Benutzerinformationen
  uid?: string;                    // Firebase Auth UID
  email?: string;                  // E-Mail Adresse
  displayName?: string;            // Anzeigename
  
  // App-spezifische Daten
  premium?: boolean;               // Premium Status
  level?: number;                  // Aktuelles Level
  totalSavings?: number;           // Gesamtersparnis
  
  // Zeitstempel
  created_time?: Date | FirebaseTimestamp;
  lastLogin?: Date | FirebaseTimestamp;
}
```

**Subcollections:**

### `users/{uid}/einkaufswagen` - Shopping Cart

```typescript
interface Einkaufswagen {
  markenProdukt: DocumentReference;      // Reference to markenProdukte
  handelsmarkenProdukt: DocumentReference; // Reference to produkte  
  gekauft: boolean;                      // Purchase status
  timestamp: Date | FirebaseTimestamp;   // Added to cart time
  name: string;                          // Product name
  isMarke: boolean;                      // Is brand product?
}
```

### `users/{uid}/searchHistory` - Search History

```typescript
interface SearchHistory {
  searchItem: string;                    // Search term
  timestamp: Date | FirebaseTimestamp;   // Search time
}
```

### `users/{uid}/scanHistory` - Scan History  

```typescript
interface ScanHistory {
  EAN: string;                          // Scanned barcode
  markenProduktRef: DocumentReference;  // Reference to markenProdukte
  produktRef: DocumentReference;        // Reference to produkte
  isMarke: boolean;                     // Is brand product?
  timestamp: Date | FirebaseTimestamp;  // Scan time
}
```

### `users/{uid}/favorites` - Favorite Products

```typescript
interface Favorites {
  markenProdukt: DocumentReference;      // Reference to markenProdukte
  handelsmarkenProdukt: DocumentReference; // Reference to produkte
  gekauft: boolean;                      // Purchase status
  timestamp: Date | FirebaseTimestamp;   // Favorited time
  name: string;                          // Product name
  isMarke: boolean;                      // Is brand product?
}
```

---

## 13. `vetnummern` - Veterinary Numbers

```typescript
interface Vetnummern {
  bundesland: string;      // String
  name: string;            // String
  strasse: string;         // String
  ort: string;             // String
  nummer: string;          // String
  bemerkungen: string;     // String
}
```

---

## 14. `vetnummernat` - National Veterinary Numbers

```typescript
interface Vetnummernat {
  nummer: string;          // String
  name: string;            // String
  strasse: string;         // String
  ort: string;             // String
  bemerkungen: string;     // String
}
```

---

## 🔗 Collection Relationships

```mermaid
graph TD
    users[users] --> einkaufswagen[users/{uid}/einkaufswagen]
    users --> searchHistory[users/{uid}/searchHistory]
    users --> scanHistory[users/{uid}/scanHistory]
    users --> favorites[users/{uid}/favorites]
    
    einkaufswagen --> markenProdukte[markenProdukte]
    einkaufswagen --> produkte[produkte]
    favorites --> markenProdukte
    favorites --> produkte
    scanHistory --> markenProdukte
    scanHistory --> produkte
    
    kategorien[kategorien] --> produkte
    kategorien --> markenProdukte
    
    produkte --> productRatings[productRatings]
    markenProdukte --> productRatings
    
    hersteller[hersteller] --> produkte
    hersteller --> markenProdukte
    
    discounter[discounter] --> produkte
    discounter --> markenProdukte
    
    abopreise[abopreise] --> users
    appSettings[appSettings] --> users
```

---

## 🚀 Implementation Priority

### Phase 1: Basic App Structure

1. **`appSettings`** - App configuration
2. **`abopreise`** - Premium pricing
3. **`kategorien`** - Product categories
4. **`users`** - User management

### Phase 2: Product Data

1. **`discounter`** - Supermarket chains
2. **`hersteller_new`** - Manufacturer data
3. **`produkte`** - NoName products
4. **`markenProdukte`** - Brand products

### Phase 3: Advanced Features  

1. **`productRatings`** - Rating system
2. **`handelsmarken`** - Private labels
3. **`packungstypen`** - Package types
4. **`vetnummern`** - Veterinary data

---

## 📝 Notes for Implementation

### Complex Collections Warning

- **`produkte`** (638 fields) - Extremely complex, use pagination
- **`markenProdukte`** (285 fields) - Very complex, selective querying needed
- **`productRatings`** (269 fields) - Complex aggregation structure
- **`hersteller`** (98 fields) - Legacy format, prefer `hersteller_new`

### Query Optimization

- Use `where()` clauses to filter large collections
- Implement pagination for `produkte` and `markenProdukte`
- Cache `kategorien` and `discounter` (small, stable data)
- Index frequently queried fields (EAN, category, etc.)

### Data Sync Strategy

1. **Static Data** (kategorien, discounter) - Load once, cache
2. **User Data** (users, ratings) - Real-time sync
3. **Product Data** (produkte, markenProdukte) - Lazy loading with cache
4. **Settings** (appSettings, abopreise) - Load on app start

---

*Schema basiert auf Live-Firestore-Analyse vom 10.8.2025*
