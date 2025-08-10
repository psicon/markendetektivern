# Firebase Integration - MarkenDetektive

## Overview

Die App ist jetzt mit Firebase Firestore verbunden und lädt echte Produktdaten aus der Cloud-Datenbank.

## Implementierte Features

### 🔥 Firebase Setup
- Firebase SDK v9+ (Web SDK)
- Firestore Datenbank Verbindung
- TypeScript Support

### 📱 Startseite Integration
- **Enttarnte Produkte**: Lädt die letzten 10 NoName-Produkte aus der `produkte` Collection
- **Loading States**: Zeigt Loading-Spinner während Datenabfrage
- **Error Handling**: Behandelt Fehler bei der Datenabfrage graceful
- **Echte Produktdaten**: Name, Preis, Beschreibung, Stufe, Bilder

## Datei-Struktur

```
lib/
├── firebase.ts                 # Firebase App Konfiguration
├── types/firestore.ts         # TypeScript Interfaces für alle Collections
├── services/firestore.ts      # Firestore Service Klasse für Datenabfragen
└── README.md                  # Diese Dokumentation
```

## Usage

### FirestoreService

```typescript
import { FirestoreService } from '@/lib/services/firestore';

// Lade die neuesten enttarnten Produkte
const produkte = await FirestoreService.getLatestEnttarnteProdukte(10);

// Lade die neuesten Markenprodukte  
const markenProdukte = await FirestoreService.getLatestMarkenProdukte(10);

// Lade alle Kategorien
const kategorien = await FirestoreService.getKategorien();

// Lade Produktdetails mit populated references
const productDetails = await FirestoreService.getProductWithDetails(productId);
```

### TypeScript Interfaces

Alle Firestore Collections haben entsprechende TypeScript Interfaces:

```typescript
import { Produkte, MarkenProdukte, Kategorien, FirestoreDocument } from '@/lib/types/firestore';

// Mit Document ID
const produkt: FirestoreDocument<Produkte> = {
  id: 'doc-id',
  name: 'Produktname',
  preis: 2.99,
  // ... weitere Felder
};
```

## Schema Mapping

| Firestore Collection | TypeScript Interface | Verwendung |
|---------------------|---------------------|------------|
| `produkte` | `Produkte` | NoName-Produkte (Startseite) |
| `markenProdukte` | `MarkenProdukte` | Markenprodukte |
| `kategorien` | `Kategorien` | Produktkategorien |
| `discounter` | `Discounter` | Supermarkt-Ketten |
| `handelsmarken` | `Handelsmarken` | Eigenmarken |
| `hersteller_new` | `HerstellerNew` | Hersteller-Info |
| `packungstypen` | `Packungstypen` | Verpackungsarten |

## Optimierungen

### Performance
- **Pagination**: `limit()` für große Collections
- **Indexing**: Queries auf `created_at` (descending)
- **Lazy Loading**: Nur bei Bedarf laden
- **Caching**: Kategorien werden einmalig geladen

### Error Handling
- Try/catch für alle async Operationen
- Graceful Degradation bei Fehlern
- User-friendly Fehlermeldungen

## Next Steps

1. **Kategorien**: Echte Kategorien aus Firestore laden
2. **Search**: Suchfunktion mit Firestore implementieren  
3. **Caching**: React Query/SWR für bessere Performance
4. **Offline**: Firestore Offline Persistence aktivieren
5. **Real-time**: Live Updates mit `onSnapshot()`

## Sicherheit

- **Firebase Rules**: Implementierung steht noch aus
- **API Keys**: Konfiguration für Produktionsumgebung anpassen
- **Rate Limiting**: Bei hohem Traffic implementieren

---

*Implementiert: 10.8.2025*

