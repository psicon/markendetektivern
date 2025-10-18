# 📊 GA4 AUSWERTUNGS-GUIDE
## Wie du ALLES sauber auswerten kannst

---

## 🎯 **1. SCAN & SEARCH AUSWERTUNG**

### **A) Scan-Events:**

**Getrackte Events:**
```
Event: scan_successful
Event: scan_failed
```

**Parameter (automatisch als Dimensionen verfügbar):**
- `ean_code` → Welche Barcodes werden gescannt?
- `product_found` → true/false (Erfolgsrate)
- `product_type` → "brand" oder "noname"
- `product_id` → Welches Produkt
- `product_name` → Name des Produkts
- `total_scans_in_journey` → Wie viele Scans pro Session
- `is_fallback` → War es ein Fallback-Produkt (scraped/openfood)?
- `fallback_source` → "scraped" oder "openfood"

**GA4 Berichte erstellen:**

1. **Scan Success Rate:**
   - Gehe zu: GA4 → Erkunden → "Leere Datensuche erstellen"
   - Dimensionen: `event_name`
   - Messwert: Ereignisse (Anzahl)
   - Filter: `event_name` = "scan_successful" ODER "scan_failed"
   - **Ergebnis:** % erfolgreiche Scans

2. **Top gescannte Produkte:**
   - Dimensionen: `product_name`, `product_type`
   - Messwert: Ereignisse
   - Filter: `event_name` = "scan_successful"
   - Sortieren: Nach Ereignissen absteigend

3. **Fallback-Nutzung:**
   - Dimensionen: `fallback_source`, `is_fallback`
   - Messwert: Ereignisse
   - Filter: `is_fallback` = "true"

---

### **B) Search-Events:**

**Getrackte Events:**
```
Event: search_performed
Event: search_query_tracked
```

**Parameter:**
- `search_query` → Was wurde gesucht?
- `results_count` → Wie viele Ergebnisse?
- `filters_active` → Welche Filter aktiv? (Array)
- `total_searches_in_journey` → Anzahl Suchen pro Session

**GA4 Berichte erstellen:**

1. **Top Suchbegriffe:**
   - Dimensionen: `search_query`
   - Messwert: Ereignisse
   - Filter: `event_name` = "search_performed"
   - **Nutzen:** Was suchen User am häufigsten?

2. **Null-Result Searches:**
   - Dimensionen: `search_query`
   - Messwert: Ereignisse
   - Filter: `results_count` = 0
   - **Nutzen:** Welche Produkte fehlen in der DB?

3. **Search-to-Conversion Rate:**
   - Trichter erstellen:
     1. `search_performed`
     2. `product_viewed`
     3. `add_to_cart`
     4. `mark_purchased`

---

## 🏆 **2. GAMIFICATION AUSWERTUNG**

### **User Ledger Daten:**

**Firestore Path:**
```
/users/{userId}/ledger/{entryId}
```

**Struktur:**
```typescript
{
  action: "scan_product",      // Welche Action
  points: 2,                    // Vergebene Punkte
  timestamp: Timestamp,         // Wann
  metadata: {
    productId: "abc123",        // Bei Scan/View
    searchTerm: "Coca Cola",    // Bei Search
    commentLength: 45,          // Bei Rating
  }
}
```

**BigQuery Auswertung:**

```sql
-- Top Actions pro User
SELECT 
  action,
  COUNT(*) as action_count,
  SUM(points) as total_points
FROM `your-project.firestore.users_ledger`
GROUP BY action
ORDER BY action_count DESC

-- Aktivste Zeiten (Wann scannen User?)
SELECT 
  EXTRACT(HOUR FROM timestamp) as hour_of_day,
  action,
  COUNT(*) as count
FROM `your-project.firestore.users_ledger`
WHERE action = 'scan_product'
GROUP BY hour_of_day, action
ORDER BY hour_of_day

-- Power Users (Top 10)
SELECT 
  user_id,
  COUNT(*) as total_actions,
  SUM(points) as total_points
FROM `your-project.firestore.users_ledger`
GROUP BY user_id
ORDER BY total_points DESC
LIMIT 10
```

---

## 🛒 **3. USER JOURNEY AUSWERTUNG**

### **Journey Tracking:**

**Firestore Path:**
```
/user_journeys/{journeyId}
```

**Was wird getrackt:**
- `journeyType` → "scan", "search", "browse"
- `scannedcodes[]` → Alle gescannten EANs mit Ergebnis
- `searchedproducts[]` → Alle Suchbegriffe
- `viewedProducts[]` → Angesehene Produkte (ID, Name, Typ)
- `addedToCart[]` → Zum Warenkorb hinzugefügt
- `purchased[]` → Gekaufte Produkte
- `filters` → Gesetzte Filter

**BigQuery Auswertung:**

```sql
-- Conversion Funnel: Scan → View → Cart → Purchase
SELECT 
  COUNT(DISTINCT journey_id) as total_journeys,
  COUNT(DISTINCT CASE WHEN scanned_codes IS NOT NULL THEN journey_id END) as scanned,
  COUNT(DISTINCT CASE WHEN viewed_products IS NOT NULL THEN journey_id END) as viewed,
  COUNT(DISTINCT CASE WHEN added_to_cart IS NOT NULL THEN journey_id END) as added,
  COUNT(DISTINCT CASE WHEN purchased IS NOT NULL THEN journey_id END) as purchased
FROM `your-project.firestore.user_journeys`
WHERE journey_type = 'scan'

-- Durchschnittliche Scans bis zum Kauf
SELECT 
  AVG(ARRAY_LENGTH(scanned_codes)) as avg_scans_per_journey,
  AVG(ARRAY_LENGTH(viewed_products)) as avg_views_per_journey
FROM `your-project.firestore.user_journeys`
WHERE purchased IS NOT NULL
```

---

## 💡 **4. MOTIVATIONS-ANALYSE**

### **Automatisch getrackte Signale:**

**GA4 Events:**
```
Event: motivation_signal_detected
```

**Parameter:**
- `signal_type` → z.B. "sort_by_price", "bio_filter_applied", "brand_searched"
- `strength` → 1-5 (wie stark das Signal)
- `market_chain` → Welcher Markt
- `category_id` → Welche Kategorie

**5 Haupt-Motivationen:**

1. **PREIS** → `sort_by_price`, `price_filter_applied`
2. **ERSPARNIS** → `savings_widget_viewed`, `high_savings_conversion`
3. **INHALT** → `bio_filter_applied`, `vegan_filter_applied`, `nutrition_tab_viewed`
4. **MARKE** → `brand_searched`, `brand_favorited_despite_high_price`
5. **MARKT** → `market_filter_applied`, `store_loyalty_detected`

**GA4 Bericht:**

1. **Top Motivationen:**
   - Dimensionen: `signal_type`
   - Messwert: Ereignisse, `strength` (Durchschnitt)
   - Filter: `event_name` = "motivation_signal_detected"

2. **Motivation pro Region:**
   - Dimensionen: `store_geohash5`, `signal_type`
   - Messwert: Ereignisse
   - **Nutzen:** Welche Motivation in welcher Region dominiert?

---

## 📈 **5. FERTIGE GA4 DASHBOARDS**

### **Dashboard 1: SCAN PERFORMANCE**

**Messwerte:**
- Total Scans: `scan_successful` + `scan_failed`
- Success Rate: `scan_successful / (scan_successful + scan_failed)`
- Avg Scans per Session: `total_scans_in_journey` (Durchschnitt)
- Fallback Usage: `is_fallback = true` (%)

**Dimensionen:**
- Datum
- `product_type` (Brand vs NoName)
- `fallback_source` (scraped vs openfood)

---

### **Dashboard 2: SEARCH INSIGHTS**

**Messwerte:**
- Total Searches
- Avg Results per Search: `results_count` (Durchschnitt)
- Zero-Result Searches: `results_count = 0` (%)

**Dimensionen:**
- `search_query` (Top 20)
- Datum
- `filters_active`

**Top-Insights:**
1. "Welche Suchbegriffe haben 0 Ergebnisse?" → DB erweitern!
2. "Nach was wird am häufigsten gesucht?" → Featured Categories
3. "Welche Filter werden zusammen verwendet?" → UX Optimierung

---

### **Dashboard 3: CONVERSION FUNNEL**

**Trichter-Schritte:**
1. `scan_successful` ODER `search_performed` → 100%
2. `product_viewed` → ~80%
3. `comparison_opened` → ~60%
4. `add_to_cart` → ~40%
5. `mark_purchased` → ~20%

**Messwerte pro Schritt:**
- Nutzer (eindeutig)
- Abbruchrate
- Durchschnittliche Zeit bis nächster Schritt

---

### **Dashboard 4: GAMIFICATION HEALTH**

**Aus User Ledger (BigQuery):**

**Queries:**
```sql
-- Daily Active Users (DAU)
SELECT 
  DATE(timestamp) as date,
  COUNT(DISTINCT user_id) as dau
FROM `firestore.users_ledger`
GROUP BY date
ORDER BY date DESC

-- Engagement Rate
SELECT 
  DATE(timestamp) as date,
  COUNT(*) as total_actions,
  COUNT(DISTINCT user_id) as active_users,
  COUNT(*) / COUNT(DISTINCT user_id) as actions_per_user
FROM `firestore.users_ledger`
GROUP BY date

-- Top Actions (Was machen User am meisten?)
SELECT 
  action,
  COUNT(*) as count,
  COUNT(DISTINCT user_id) as unique_users,
  AVG(points) as avg_points
FROM `firestore.users_ledger`
GROUP BY action
ORDER BY count DESC
```

---

## 🔧 **6. SETUP IN GA4**

### **WICHTIG: KEINE Custom Dimensions nötig!** ✅

**GA4 indexiert automatisch:**
- ✅ Alle Event-Parameter (bis zu 50)
- ✅ Numerische Werte → als Metriken
- ✅ Text-Werte → als Dimensionen

### **Warten auf Indexierung:**
- **24-48 Stunden** nach ersten Events
- Dann verfügbar in: Berichte → Erkunden

### **Überprüfen ob indexiert:**
1. GA4 → Einstellungen → Benutzerdefinierte Definitionen
2. Schau unter "Benutzerdefinierte Messwerte" und "Benutzerdefinierte Dimensionen"
3. **Sollte automatisch da sein!**

---

## 📱 **7. BIGQUERY EXPORT SETUP**

### **Für erweiterte Analysen:**

**Aktivieren:**
1. GA4 → Admin → BigQuery-Verknüpfungen
2. "Link erstellen"
3. Projekt auswählen
4. Streaming: **JA** (Realtime-Daten!)
5. Täglicher Export: **JA**

**BigQuery Tables:**
```
your-project.analytics_XXXXXX.events_YYYYMMDD  // Tägliche Events
your-project.analytics_XXXXXX.events_intraday_YYYYMMDD  // Streaming
```

### **Firestore → BigQuery:**

**Zusätzlich für Ledger-Daten:**
1. Firestore → Einstellungen
2. "Nach BigQuery exportieren"
3. Collections auswählen: `users/{userId}/ledger`
4. **Kosten:** ~$0.01 pro GB

---

## 🎨 **8. LOOKER STUDIO DASHBOARDS**

### **Kostenlose Visualisierung:**

**Datenquellen verbinden:**
1. Looker Studio → looker.google.com/studio
2. "Datenquelle erstellen"
3. Connector: **Google Analytics 4** UND **BigQuery**
4. Properties auswählen

### **Vorgefertigte Charts:**

**Scan Performance Chart:**
- **Typ:** Zeitreihen-Diagramm
- **Messwert:** Anzahl Scans
- **Dimensionen:** Datum, `product_found`
- **Filter:** `event_name` = "scan_successful" OR "scan_failed"

**Search Insights Tabelle:**
- **Typ:** Tabelle
- **Dimensionen:** `search_query`, `results_count`
- **Messwert:** Ereignisse, `results_count` (Durchschnitt)
- **Sortierung:** Nach Ereignissen

**Motivation Heatmap:**
- **Typ:** Geo-Karte
- **Dimensionen:** `store_geohash5`, `signal_type`
- **Messwert:** `strength` (Durchschnitt)
- **Nutzen:** Welche Motivation wo am stärksten?

---

## 🔍 **9. SPEZIFISCHE ANALYSEN**

### **"Welche Scans führen zu Käufen?"**

**BigQuery Query:**
```sql
WITH scans AS (
  SELECT 
    user_pseudo_id,
    event_timestamp,
    event_params.value.string_value as ean_code
  FROM `analytics_XXXXX.events_*`
  WHERE event_name = 'scan_successful'
),
purchases AS (
  SELECT 
    user_pseudo_id,
    event_timestamp,
    event_params.value.string_value as product_id
  FROM `analytics_XXXXX.events_*`
  WHERE event_name = 'mark_purchased'
)
SELECT 
  s.ean_code,
  COUNT(DISTINCT s.user_pseudo_id) as scans,
  COUNT(DISTINCT p.user_pseudo_id) as purchases,
  COUNT(DISTINCT p.user_pseudo_id) / COUNT(DISTINCT s.user_pseudo_id) as conversion_rate
FROM scans s
LEFT JOIN purchases p 
  ON s.user_pseudo_id = p.user_pseudo_id
  AND p.event_timestamp > s.event_timestamp
  AND p.event_timestamp < s.event_timestamp + 3600000000  -- 1h window
GROUP BY s.ean_code
ORDER BY conversion_rate DESC
LIMIT 20
```

---

### **"Welche Suchbegriffe führen zu Null-Ergebnissen?"**

**GA4 Bericht:**
- Dimensionen: `search_query`
- Messwert: Ereignisse
- Filter: `results_count` = 0
- Sortierung: Nach Ereignissen absteigend

**Nutzen:** Diese Produkte in DB aufnehmen!

---

### **"Wie lange dauert die User Journey?"**

**BigQuery Query:**
```sql
SELECT 
  journey_type,
  AVG(session_duration_ms) / 1000 as avg_duration_seconds,
  PERCENTILE_CONT(session_duration_ms, 0.5) OVER() / 1000 as median_duration_seconds
FROM `firestore.user_journeys`
GROUP BY journey_type
```

---

## 📊 **10. WICHTIGSTE KPIs FÜR DEIN DASHBOARD**

### **A) Product Discovery:**
```
1. Scan Success Rate: scan_successful / (scan_successful + scan_failed)
2. Avg Scans per Session: AVG(total_scans_in_journey)
3. Search-to-View Conversion: product_viewed / search_performed
4. Top gescannte Kategorien: GROUP BY category_id
```

### **B) Engagement:**
```
1. DAU: COUNT(DISTINCT user_id) per day (aus Ledger)
2. Aktionen pro User: COUNT(actions) / COUNT(DISTINCT user_id)
3. Wiederkehrende User: Users mit actions an >3 Tagen
4. Retention (7-Day): % User die nach 7 Tagen zurückkommen
```

### **C) Conversion:**
```
1. Scan-to-Purchase: mark_purchased / scan_successful
2. Search-to-Purchase: mark_purchased / search_performed
3. Browse-to-Purchase: mark_purchased WHERE source = 'browse'
4. Avg Time to Purchase: Zeit von scan_successful → mark_purchased
```

### **D) Monetization (für B2B):**
```
1. Regional Savings: SUM(savings_abs) GROUP BY store_geohash5
2. Top Kategorien by Savings: SUM(savings_abs) GROUP BY category_id
3. Market Share: COUNT(conversions) GROUP BY market_chain
4. Premium Conversion: COUNT(users WHERE isPremium) / COUNT(total_users)
```

---

## 🚀 **11. SCHNELLSTART - ERSTE 3 BERICHTE**

### **Bericht 1: "Scan Dashboard"**
1. GA4 → Erkunden → Neu
2. Dimensionen: `event_name`, `product_found`
3. Messwert: Ereignisse
4. Zeitraum: Letzte 7 Tage
5. **Fertig!**

### **Bericht 2: "Top Suchbegriffe"**
1. Dimensionen: `search_query`
2. Messwert: Ereignisse, `results_count` (Durchschnitt)
3. Filter: `event_name` = "search_performed"
4. Sortierung: Top 20
5. **Fertig!**

### **Bericht 3: "Conversion Funnel"**
1. GA4 → Erkunden → "Trichter-Datensuche"
2. Schritte:
   - Schritt 1: `scan_successful`
   - Schritt 2: `product_viewed`
   - Schritt 3: `add_to_cart`
   - Schritt 4: `mark_purchased`
3. **Fertig!**

---

## ⚡ **12. ECHTZEIT-MONITORING**

### **GA4 Realtime:**
- GA4 → Berichte → Echtzeit
- Zeigt **letzte 30 Minuten**
- Siehst du sofort:
  - Aktive User
  - Top Events
  - Top Screens

### **Firestore Ledger (Live):**
```javascript
// Firebase Console → Firestore → users/{userId}/ledger
// Siehst du SOFORT alle Actions in Echtzeit!
```

---

## 🎯 **ZUSAMMENFASSUNG:**

**WAS DU BRAUCHST:**
1. ✅ **GA4 Property** → Hast du schon
2. ✅ **Events werden getrackt** → Läuft bereits
3. ⏳ **24-48h warten** → Parameter werden indexiert
4. 📊 **Berichte erstellen** → In GA4 "Erkunden"
5. 🚀 **BigQuery (optional)** → Für erweiterte SQL-Analysen

**KEINE Custom Dimensions nötig!** GA4 macht alles automatisch! 🎉

---

**Willst du, dass ich dir konkrete GA4 Berichte als Screenshots/Anleitung erstelle?**

