# 🎯 Journey Tracking V2 - Anforderungen

## Problemanalyse
Das aktuelle Journey-System ist "überkandidelt" und erkennt nicht die echte User-Intention:
- Filter-basierte Motivation ist naiv (User kann ohne Filter das günstigste Produkt wählen)
- Inkonsistente Motivation bei gleichen Actions (addedToCart vs purchased)
- Überflüssige Daten-Explosion (motivationSignals, filterHistory, etc.)
- Echte User-Entscheidungen werden ignoriert

## 🎯 Kernziele

### 1. ECHTE User-Intention erkennen
- **Preis-Intention:** User wählt günstigstes Produkt aus Alternativen
- **Content-Intention:** User zahlt MEHR für Bio/Vegan/Laktosefrei
- **Marken-Intention:** User sucht "Milka" und wählt Milka (trotz teurerer Alternative)
- **Ersparnis-Intention:** User scannt Marke → wählt NoName Alternative

### 2. Übersichtliche DB-Struktur
- Flache Struktur statt verschachtelter Arrays
- Aggregierbare Metriken
- Klare, auswertbare Felder

### 3. Session = Journey
- Journey bleibt am gleichen Tag aktiv (nicht 30min Timeout)
- Journey endet nur bei: App schließen, Mitternacht, Logout, "Alle gekauft"
- JourneyID wird bereits im Warenkorb gespeichert ✅
- Bei Purchase/Delete: Update der ursprünglichen Journey

## 🧠 Intention-Erkennungs-Logik

### A) Preis-Intention (Confidence: 0.9)
```
- User wählt günstigstes Produkt aus 3+ Alternativen
- User konvertiert Marke → NoName (Ersparnis > 0.50€)
- User nutzt Preis-Sortierung und wählt Top 3
- User sucht explizit "günstig", "billig", "angebot"
```

### B) Content-Intention (Confidence: 0.8)
```
- User zahlt MEHR für Bio/Vegan/Laktosefrei
- User filtert nach Allergenen/Nährwerten
- User sucht "bio milch", "vegan schokolade"
- User scrollt zu Nährwert-Tabelle vor Kauf
```

### C) Marken-Intention (Confidence: 0.95)
```
- User sucht explizit "Milka", "Nutella"
- User wählt Marke trotz günstigerer Alternative
- User hat >50% gleiche Marke in Favoriten
- User scannt Marke und kauft sie (keine Alternative gewählt)
```

### D) Ersparnis-Intention (Confidence: 0.9)
```
- User scannt Marke → wählt NoName Alternative
- User nutzt "Alle umwandeln" Feature
- User kommt über Angebots-Widget
- Ersparnis > 30% des Originalpreises
```

## 💾 Neue DB-Struktur

### Journey-Dokument (Vereinfacht)
```typescript
interface Journey {
  // Basis
  journeyId: string;
  userId: string;
  sessionId: string;
  startTime: timestamp;
  endTime?: timestamp;
  status: 'active' | 'paused' | 'completed';
  
  // User Context
  location: {
    city: string;
    region: string;
    geohash5: string;
  };
  
  // Produkt-Interaktionen (flach, zeitlich sortiert)
  products: {
    [productId]: {
      // Timeline
      viewed?: timestamp;
      compared?: timestamp;
      addedToCart?: timestamp;
      purchased?: timestamp;
      removed?: timestamp;
      
      // Intention (beim Add-to-Cart erkannt)
      intention: {
        primary: 'price' | 'content' | 'brand' | 'savings' | 'exploration';
        confidence: number;
        reason: string;
        confirmed?: boolean; // true wenn gekauft, false wenn gelöscht
      };
      
      // Kontext für Intention
      context: {
        source: 'search' | 'scan' | 'browse' | 'comparison';
        searchTerm?: string;
        scannedProductId?: string;
        alternativesCount: number;
        priceRank?: number;
        wasChepeast: boolean;
        price: number;
        savings?: number;
      };
    }
  };
  
  // Zusammenfassung
  summary: {
    productsViewed: number;
    productsCompared: number;
    productsPurchased: number;
    totalSavings: number;
    dominantIntention: string;
    conversionRate: number;
  };
}
```

## 🛠️ Implementierungs-Phasen

### Phase 1: Intention-Tracking (1-2h)
- `detectIntention()` Logik implementieren
- Context-Gathering bei Add-to-Cart
- Intention in Shopping Cart Item speichern
- Alte Journey-Struktur bleibt unverändert

### Phase 2: Journey-Vereinfachung (2-3h)
- Neue simplified Journey-Struktur parallel
- Migration der wichtigsten Felder
- Beide Systeme laufen parallel

### Phase 3: Session-Lifecycle (1h)
- Same-Day Journey Logic
- AsyncStorage für Journey-ID Persistierung
- Pause/Resume Handling

### Phase 4: Cleanup (1h)
- Altes System entfernen
- UI auf neue Struktur
- Analytics anpassen

## 🎯 Quick Win Alternative (30min)
Minimaler Start - nur beim Add-to-Cart:
1. Erkenne ob günstigstes Produkt gewählt
2. Speichere `chosenBecause: 'price' | 'brand' | 'unknown'`
3. Rest später ausbauen

## 📊 Erwartete Analytics-Verbesserungen

### Pro User
- Durchschnittliche Savings pro Journey
- Häufigste echte Intention (nicht Filter-basiert)
- Conversion-Rate nach Source (search/scan/browse)
- Markentreue-Score

### Pro Produkt  
- Wie oft viewed vs purchased
- Hauptgrund für Kauf/Nicht-Kauf
- Vergleich mit welchen Alternativen

### Pro Region
- Beliebte Produktkategorien nach echter Intention
- Preis-Sensitivität (wie oft günstigstes gewählt)
- Bio-Präferenz (Bereitschaft mehr zu zahlen)

## 🔄 Journey-Lifecycle Details

### Journey ENDET nur bei:
1. User schließt App komplett (nicht nur Background)
2. Mitternacht (neuer Tag = neue Journey)
3. User loggt aus / wechselt Account
4. "Alle als gekauft" wurde ausgeführt

### Journey PAUSIERT bei:
- App geht in Background → Journey bleibt erhalten
- Screen Lock → Journey bleibt erhalten
- Längere Inaktivität → Status: "paused", aber gleiche Journey!

### Journey FORTSETZUNG:
- App wieder geöffnet → Gleiche Journey läuft weiter
- JourneyID bleibt in AsyncStorage/SecureStore

## ✅ Bereits implementiert
- JourneyID wird im Shopping Cart gespeichert
- Purchase/Delete Updates verwenden gespeicherte JourneyID
- Performance-Optimierungen (Non-blocking Tracking)

---
*Dokumentiert am: 2025-09-29*
*Status: Anforderungen definiert, bereit für Implementierung*
