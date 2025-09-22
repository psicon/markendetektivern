# Journey Lifecycle Fix - Dokumentation

## Problem
1. **Journey wird nach Purchase beendet** - Das war falsch, da User weiter einkaufen können
2. **Undefined activeFilters** - Verursachte Firestore-Fehler
3. **"Alle als gekauft markieren"** - Actions wurden nicht korrekt getrackt

## Lösung

### 1. Journey Lifecycle korrigiert
```typescript
// ENTFERNT in trackPurchase:
// this.completeJourney('purchase');

// Journey läuft weiter bis:
// - App wird geschlossen
// - Längere Inaktivität
// - User startet explizit neue Journey
```

### 2. ActiveFilters immer initialisiert
```typescript
// In startJourney:
this.currentJourney = {
  journeyId,
  startTime: Date.now(),
  discoveryMethod,
  screenName,
  activeFilters: activeFilters || {}, // Nie undefined!
  viewedProducts: []
};
```

### 3. Bulk Purchase Tracking gefixt
```typescript
// Problem: productData war DocumentReference, nicht das Produkt selbst
// Alt:
const productData = cartData.markenProdukt || cartData.handelsmarkenProdukt;
productId: productData.id, // undefined!

// Neu:
if (cartData.markenProdukt) {
  const productRef = cartData.markenProdukt;
  productId = productRef.id || '';
  productType = 'brand';
  productName = cartData.name || 'Markenprodukt';
}
```

## Journey mit späteren Aktionen

### Tag 1: Produkt hinzufügen
```json
{
  "gekauft": false,
  "timestamp": "2025-01-15T10:00:00Z",
  "name": "Milka Schokolade",
  "journeyId": "journey_1758459726225_cte4vbie3", // ← Wichtig!
  "priceAtTime": 2.99,
  "savingsAtTime": 0.72
}
```

### Tag 5: Produkt gekauft markieren
```typescript
// Die ORIGINAL Journey wird aktualisiert:
if (cartData.journeyId) {
  await journeyTrackingService.trackPurchaseInSpecificJourney(
    cartData.journeyId, // Original Journey!
    [{...}],
    finalSavings,
    userId
  );
}
```

### Resultat
- Jedes Produkt behält seine Original-Journey
- Aktionen werden in der richtigen Journey getrackt
- Keine neuen Journeys bei späteren Aktionen
- Vollständige User Journey über Tage hinweg

## Wichtige Punkte
1. **journeyId** wird im Einkaufszettel gespeichert
2. **trackPurchaseInSpecificJourney** aktualisiert alte Journeys
3. **Bulk-Aktionen** rufen einzeln `markAsPurchased` auf
4. **DocumentReference.id** muss korrekt extrahiert werden