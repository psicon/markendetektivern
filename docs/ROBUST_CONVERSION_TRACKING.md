# Robustes Conversion Tracking

## Problem
Bei existierenden Journeys (aus älteren App-Versionen) fehlte das `converted` Array, was zu `undefined` Fehlern führte.

## Lösung

### 1. Defensive Programmierung in `trackProductConversion()`:
```typescript
// Stelle sicher, dass converted Array existiert (für ältere Journeys)
if (!this.currentJourney.converted) {
  this.currentJourney.converted = [];
}
```

### 2. Array-Initialisierung beim Journey-Laden:
```typescript
// Stelle sicher, dass alle Arrays initialisiert sind (für ältere Journeys)
if (!this.currentJourney.viewedProducts) this.currentJourney.viewedProducts = [];
if (!this.currentJourney.converted) this.currentJourney.converted = [];
if (!this.currentJourney.filterHistory) this.currentJourney.filterHistory = [];
```

## Vorteile
- Backward-Kompatibilität mit älteren Journeys
- Keine Crashes bei fehlenden Arrays
- Robustes Tracking auch bei Schema-Änderungen

## Best Practice
Immer defensive programmieren bei optionalen Arrays:
```typescript
// Schlecht
this.array.push(item);

// Gut
if (!this.array) this.array = [];
this.array.push(item);
```
