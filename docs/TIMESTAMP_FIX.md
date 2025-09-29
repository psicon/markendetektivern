# Firestore serverTimestamp() in Arrays - Fix

## Problem
Firestore unterstützt `serverTimestamp()` nicht innerhalb von Arrays. Dies führt zu dem Fehler:
```
FirebaseError: Function updateDoc() called with invalid data. serverTimestamp() is not currently supported inside arrays
```

## Lösung
Verwende `Date.now()` für Timestamps in Arrays, aber weiterhin `serverTimestamp()` für Top-Level-Felder.

### Geänderte Felder:
1. **filterHistory.timestamp** - `Date.now()`
2. **viewedProducts.timestamp** - `Date.now()` 
3. **viewedProducts.actions.timestamp** - `Date.now()`

### Unveränderte Felder (Top-Level):
- **startedAt** - `serverTimestamp()`
- **lastUpdated** - `serverTimestamp()`
- **completedAt** - `serverTimestamp()`

## Grund
Firestore kann `serverTimestamp()` nur für direkte Dokument-Felder auflösen, nicht für Felder innerhalb von Arrays. Dies ist eine bekannte Limitation von Firestore.

## Alternative
Falls Server-Timestamps in Arrays benötigt werden, müsste man:
1. Arrays als Sub-Collections implementieren
2. Oder einen Cloud Function Trigger verwenden, der nach dem Schreiben die Timestamps aktualisiert


