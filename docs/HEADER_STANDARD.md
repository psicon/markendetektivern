# Header-Standard für MarkenDetektive App

## 📱 Einheitlicher Header-Style

Alle Seiten der MarkenDetektive App verwenden einen einheitlichen Header-Style basierend auf dem Design der Suchergebnisse-Seite.

## 🎯 Verwendung

### Für Stack.Screen Komponenten:
```typescript
import { getStackScreenHeaderOptions } from '@/constants/HeaderConfig';

<Stack.Screen
  options={getStackScreenHeaderOptions(colorScheme, 'Seitentitel')}
/>
```

### Für navigation.setOptions():
```typescript
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';

useLayoutEffect(() => {
  navigation.setOptions(getNavigationHeaderOptions(colorScheme, 'Seitentitel'));
}, [navigation, colorScheme]);
```

### Für navigation.setOptions() mit Custom Header-Left:
```typescript
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';

useLayoutEffect(() => {
  navigation.setOptions({
    ...getNavigationHeaderOptions(colorScheme, 'Seitentitel'),
    headerLeft: () => (
      <TouchableOpacity onPress={() => router.back()}>
        <IconSymbol name="chevron.left" size={24} color="white" />
      </TouchableOpacity>
    ),
  });
}, [navigation, colorScheme]);
```

## 🎨 Header-Eigenschaften

Der Standard-Header beinhaltet:

- **Hintergrundfarbe:** Primär-Grün (`colors.primary`)
- **Text-Farbe:** Weiß
- **Schriftart:** Nunito_600SemiBold
- **Schriftgröße:** 18px
- **Back-Button:** "Zurück" mit Nunito_400Regular
- **Animation:** slide_from_right

## ✅ Bereits implementiert auf:

- ✅ Suchergebnisse (`app/search-results.tsx`)
- ✅ Produktvergleich (`app/product-comparison/[id].tsx`)
- ✅ Einkaufszettel (`app/shopping-list.tsx`)
- ✅ Level & Errungenschaften (`app/achievements.tsx`)

## 🚀 Für neue Seiten:

1. Importiere die Header-Konfiguration:
   ```typescript
   import { getStackScreenHeaderOptions } from '@/constants/HeaderConfig';
   // oder
   import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
   ```

2. Verwende die entsprechende Funktion mit `colorScheme` und Titel

3. Für Custom Header-Elemente (z.B. headerLeft), verwende den Spread-Operator:
   ```typescript
   ...getNavigationHeaderOptions(colorScheme, 'Titel'),
   headerLeft: () => (/* Custom Element */)
   ```

## 🎯 Vorteile:

- **Konsistenz:** Alle Seiten haben den gleichen Look
- **Wartbarkeit:** Änderungen nur in einer Datei nötig
- **Theme-Support:** Automatische Anpassung an Light/Dark Mode
- **Einfache Verwendung:** Ein Import, eine Zeile Code

## 📝 Hinweise:

- Verwende immer `colorScheme` als Parameter für Theme-Unterstützung
- Für Custom Header-Elemente verwende den Spread-Operator
- Die Konfiguration ist in `/constants/HeaderConfig.ts` definiert
