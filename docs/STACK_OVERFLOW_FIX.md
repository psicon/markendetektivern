# Stack Overflow Fix - Zirkuläre Referenzen

## Problem
Die `removeUndefinedValues` Funktion verursachte einen Stack Overflow durch zirkuläre Referenzen in Firestore DocumentReferences.

## Ursache
Firestore DocumentReferences enthalten interne zirkuläre Referenzen, die bei rekursiver Durchsuchung zu einer Endlosschleife führten.

## Lösung

### 1. DocumentReference Detection:
```typescript
// FIRESTORE DocumentReference - NICHT rekursiv durchsuchen!
if (obj && typeof obj === 'object' && obj.constructor && obj.constructor.name === 'DocumentReference') {
  return obj; // DocumentReference direkt zurückgeben
}
```

### 2. Circular Reference Protection:
```typescript
private removeUndefinedValues(obj: any, seen = new WeakSet()): any {
  // Zirkuläre Referenz vermeiden
  if (seen.has(obj)) {
    return {}; // Leeres Objekt bei zirkulärer Referenz
  }
  seen.add(obj);
  
  // ... Verarbeitung ...
  
  seen.delete(obj); // Nach Verarbeitung wieder entfernen
}
```

## Resultat
- Keine Stack Overflow Fehler mehr
- DocumentReferences bleiben intakt
- Zirkuläre Referenzen werden sicher behandelt
- undefined Werte werden trotzdem eliminiert


