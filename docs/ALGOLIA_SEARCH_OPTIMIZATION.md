# Algolia Search Optimization

## Übersicht

Die Suchergebnisse in der App nutzen Algolia für eine optimale Sucherfahrung. Die Ergebnisse werden nach **Relevanz** sortiert, nicht alphabetisch.

## Wichtige Änderungen

### 1. Entfernte alphabetische Sortierung

Die Suchergebnisse wurden vorher nach dem Namen sortiert, was die Algolia-Relevanz-Sortierung überschrieben hat:

```typescript
// VORHER - Falsch:
filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));

// NACHHER - Richtig:
// KEINE Sortierung - behalte Algolia Relevanz-Reihenfolge
return filtered;
```

### 2. Algolia Ranking Strategy

Algolia sortiert die Ergebnisse automatisch nach:
1. **Textuelle Relevanz** - Wie gut passt der Suchbegriff?
2. **Typo-Toleranz** - Tippfehler werden berücksichtigt
3. **Proximity** - Wörter die näher beieinander stehen
4. **Custom Ranking** - z.B. Beliebtheit, Aktualität

## Best Practices für Algolia

### Searchable Attributes (sollten in Algolia konfiguriert sein):
- `name` (höchste Priorität)
- `produktName`
- `handelsmarke.name`
- `hersteller.name`
- `kategorie.bezeichnung`

### Custom Ranking (empfohlen):
- Stufe (für NoName Produkte)
- Preis
- Beliebtheit/Verkaufszahlen (wenn verfügbar)

## Vorteile der Relevanz-Sortierung

1. **Bessere User Experience**: User finden schneller was sie suchen
2. **Intelligente Suche**: Berücksichtigt Tippfehler und Synonyme
3. **Kontextuelle Ergebnisse**: Relevanteste Produkte zuerst
4. **Professionelle Suche**: Wie bei großen E-Commerce-Plattformen

## Testing

Um sicherzustellen, dass die Relevanz-Sortierung funktioniert:

1. Suche nach "Milch" - Milchprodukte sollten vor "Milchschokolade" erscheinen
2. Suche nach "Cola" - Coca-Cola sollte vor anderen Cola-Produkten erscheinen
3. Suche mit Tippfehler "Jogurt" - sollte trotzdem "Joghurt" finden

## Weitere Optimierungen

Falls die Relevanz noch verbessert werden soll:

1. **Synonyme konfigurieren** in Algolia Dashboard:
   - "Jogurt" → "Joghurt"
   - "Keks" → "Kekse"
   - etc.

2. **Query Rules** für spezielle Suchbegriffe:
   - "Bio" → Bio-Produkte priorisieren
   - "Günstig" → Nach Preis sortieren

3. **Analytics** aktivieren um häufige Suchbegriffe zu identifizieren
