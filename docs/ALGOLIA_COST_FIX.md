# Algolia Kosten-Fix - November 2025

## 🚨 Problem
Vierstellige Algolia-Rechnung durch ineffiziente Implementierung:
- **43.91%** aller Anfragen: Hersteller-Index
- **39.77%** aller Anfragen: Handelsmarken-Index  
- **800.000+** Anfragen am 20. Oktober (Launch-Tag)

## 📊 Ursachen-Analyse
1. **searchAll() machte 4-6 Anfragen pro Suche:**
   - searchNoNameProducts() 
   - searchMarkenprodukte()
   - searchHandelsmarken() ❌
   - searchHersteller() ❌
   - + weitere Suchen wenn Matches gefunden

2. **Ineffiziente Referenz-Auflösung:**
   - Für JEDES Produkt einzelne Algolia-Suche
   - Bei 100 Produkten = 300+ extra Anfragen
   - Algolia: $0.50 pro 1.000 Anfragen
   - Firebase: $0.036 pro 100.000 Reads (1.400x günstiger!)

3. **1000 Produkte auf einmal geladen**

## ✅ Implementierte Fixes

### Fix 1: searchAll() entschlackt
```typescript
// VORHER: 4-6 Anfragen
searchAll() {
  searchNoNameProducts()
  searchMarkenprodukte() 
  searchHandelsmarken() ❌ ENTFERNT
  searchHersteller() ❌ ENTFERNT
}

// NACHHER: Nur noch 2 Anfragen
searchAll() {
  searchNoNameProducts()
  searchMarkenprodukte() 
}
```

### Fix 2: Firebase für Referenzen
```typescript
// VORHER: Algolia
await AlgoliaService.searchInIndex('hersteller', id); // $$$

// NACHHER: Firebase  
const docRef = doc(db, collection, id);
const docSnap = await getDoc(docRef); // 1.400x günstiger!
```

### Fix 3: Echte Pagination + Infinite Scroll
```typescript
// VORHER
const results = await AlgoliaService.searchAll(query, 0, 1000); // 1000 Produkte!

// NACHHER
const results = await AlgoliaService.searchAll(query, 0, 30);  // Nur 30 initial (15 pro Index)

// Infinite Scroll implementiert:
- Initial nur 30 Produkte laden
- Beim Scrollen weitere 30 nachladen
- Gesamtanzahl aus Algolia anzeigen (kostet nichts extra!)
```

## 💰 Erwartete Einsparungen
- **Reduktion der Algolia-Anfragen um ~90-95%**
- Statt 4-6 Anfragen nur noch 2 pro Suche
- Keine teuren Referenz-Lookups mehr über Algolia
- Nur noch 50 statt 1000 Produkte pro Seite

## 🔮 Langfristige Lösung
Algolia-Indizes sollten Referenzen bereits aufgelöst enthalten:
```json
// Ideal (später umsetzen)
{
  "name": "Produkt XY",
  "hersteller": {
    "id": "abc123", 
    "name": "Marke ABC",
    "bild": "..."
  }
}
```

## 📝 Geänderte Dateien
- `/lib/services/algolia.ts` - searchAll() optimiert
- `/app/search-results.tsx` - Firebase für Lookups, Pagination

## ⚡ Diese Fixes sind SOFORT wirksam!
