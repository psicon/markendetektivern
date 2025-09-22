# Conversion Debug - Systematische Fehlersuche

## Problem
`undefined` Fehler bei JEDER Conversion, aber nur bei Conversions.

## Debug-Maßnahmen

### 1. Enhanced Error Logging:
```typescript
console.error('🐛 DEBUGGING - Journey data that failed:', JSON.stringify(journeyData, (key, value) => {
  if (value === undefined) {
    return `__UNDEFINED__${key}__`;
  }
  return value;
}, 2));
```

### 2. marketId Fix:
```typescript
// VORHER: Könnte undefined sein wenn discounter ein Objekt ist
marketId: (details?.toProduct?.discounter?.id || details?.toProduct?.discounter || '').toString()

// NACHHER: Robuste String-Konvertierung
marketId: String(details?.toProduct?.discounter?.id || details?.toProduct?.discounter?.name || details?.toProduct?.discounter || '')
```

### 3. Verdacht:
Das Problem liegt wahrscheinlich in:
- `converted_from` Actions mit vielen optionalen Feldern
- `discounter` Objekt-Struktur nicht korrekt gehandhabt
- `motivation` Objekt könnte undefined Felder haben

## Nächste Schritte:
1. Debug-Logs auswerten
2. Exakte undefined-Quelle identifizieren
3. Gezielter Fix
