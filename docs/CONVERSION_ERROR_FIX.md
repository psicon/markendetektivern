# Conversion Error Fix - undefined in Firestore

## Problem
Bei der Produkt-Conversion (Marke → NoName) trat folgender Fehler auf:
```
FirebaseError: Function updateDoc() called with invalid data. 
Unsupported field value: undefined
```

## Ursache
Das `converted` Array war nicht initialisiert:
- In `startJourney()` wurde `converted: []` nicht gesetzt
- In `loadActiveJourney()` wurde `converted` nicht aus Firestore geladen
- `trackProductConversion()` versuchte auf `this.currentJourney.converted.push()` zuzugreifen

## Lösung

### 1. In `startJourney()`:
```typescript
this.currentJourney = {
  journeyId,
  startTime: Date.now(),
  discoveryMethod,
  screenName,
  activeFilters: activeFilters || {},
  viewedProducts: [],
  converted: [] // NEU: Initialisiere converted Array
};
```

### 2. In `loadActiveJourney()`:
```typescript
this.currentJourney = {
  // ... andere Felder
  converted: data.converted || [], // NEU: Lade converted Array
  // ... weitere Felder
};
```

## Resultat
- Keine `undefined` Fehler mehr bei Conversions
- Das `converted` Array wird korrekt initialisiert und persistiert
- Conversion-Tracking funktioniert vollständig
