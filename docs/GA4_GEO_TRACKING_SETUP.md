# GA4 Geo-Tracking für Events einrichten

## Problem

Die Geo-Daten (Land, Stadt) werden von GA4 automatisch erfasst und erscheinen in der Live-Map, aber nicht bei den einzelnen Events.

## Ursache

GA4 erfasst Geo-Daten auf User-Ebene (über IP), aber diese werden nicht automatisch als Event-Dimensionen angezeigt.

## Lösung in GA4 (ohne Code-Änderungen!)

### 1. Geo-Dimensionen in Berichten aktivieren

**Berichte → Bibliothek → Deinen Bericht bearbeiten**

- Klicke auf "Dimensionen"
- Füge hinzu:
  - `Land`
  - `Region`
  - `Stadt`
  - `Land-ID`

### 2. Explorative Datenanalyse nutzen

**Berichte → Erkunden → Freiform**

1. **Dimensionen hinzufügen:**
   - Ereignisname
   - Land
   - Stadt
   - Region

2. **Metriken hinzufügen:**
   - Ereignisanzahl
   - Nutzer insgesamt

3. **Filter setzen:**
   - Ereignisname enthält "product_viewed" (oder andere)

### 3. Benutzerdefinierte Berichte erstellen

**Admin → Benutzerdefinierte Definitionen → Benutzerdefinierte Berichte**

Erstelle einen neuen Bericht:

- Name: "Events nach Standort"
- Dimensionen: Ereignisname, Land, Stadt
- Metriken: Ereignisse, Nutzer
- Filter: Nach Bedarf

### 4. Audiences mit Geo-Daten

**Admin → Audiences → Neue Zielgruppe**

Beispiel: "Deutsche Power-User"

- Bedingung 1: Land = Deutschland
- Bedingung 2: Ereignisanzahl > 50 in 30 Tagen

### 5. Warum sehe ich keine Städte?

GA4 wendet **Datenschwellenwerte** an:

- Städte werden nur angezeigt, wenn genug Nutzer vorhanden sind
- Kleine Städte werden zu "(not set)"
- Das ist eine Datenschutzmaßnahme

### 6. Sofort-Test

1. Gehe zu **Berichte → Echtzeit**
2. Scrolle nach unten zu "Nutzer nach Land"
3. Klicke auf ein Land
4. Du siehst die Events dieses Landes

### Alternative: BigQuery Export

Für detaillierte Geo-Analysen:

1. Aktiviere BigQuery Export
2. Dort sind Geo-Daten bei jedem Event verfügbar
3. Query Beispiel:

```sql
SELECT
  event_name,
  geo.country,
  geo.region,
  geo.city,
  COUNT(*) as event_count
FROM `your-project.analytics_123456789.events_*`
WHERE _TABLE_SUFFIX = FORMAT_DATE('%Y%m%d', CURRENT_DATE())
GROUP BY 1,2,3,4
ORDER BY event_count DESC
```

## Fazit

Die Geo-Daten werden bereits getrackt! Sie müssen nur in GA4 richtig angezeigt werden. Keine Code-Änderungen nötig.

