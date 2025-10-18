# 🚨 GA4 FEHLENDE PARAMETER ANALYSE
## Welche wichtigen Parameter werden NICHT an GA4 gesendet

---

## ❌ **AKTUELL GEFILTERTE PARAMETER**

### **Whitelist in `analyticsService.ts` (Zeile 287-310):**

```typescript
// ✅ WERDEN GESENDET:
screen_name            ✅
event_category         ✅
product_id            ✅
product_type          ✅
category_id           ✅
market_chain          ✅
price                 ✅
savings_abs           ✅
savings_pct           ✅
sort_by               ✅
dwell_time_ms         ✅
store_geohash5        ✅
user_level            ✅
session_duration_ms   ✅
journey_step          ✅

// ❌ FEHLEN (werden getrackt, aber nicht an GA4 gesendet):
ean_code              ❌ WICHTIG für Scan-Analyse!
product_found         ❌ WICHTIG für Success Rate!
product_name          ❌ Für lesbare Reports!
search_query          ❌ KRITISCH für Search-Insights!
results_count         ❌ Für Null-Result Analyse!
is_fallback           ❌ Für Fallback-Nutzung!
fallback_source       ❌ (scraped vs openfood)
total_scans_in_journey    ❌ Engagement-Metrik!
total_searches_in_journey ❌ Engagement-Metrik!
journey_id            ❌ Für Journey-Verknüpfung!
filter_type           ❌ Welcher Filter?
filter_value          ❌ Welcher Wert?
filters_active        ❌ Array von aktiven Filtern!
conversion_type       ❌ add_to_cart vs mark_purchased!
source                ❌ scan vs search vs browse!
brand_id              ❌ Für Brand-Analyse!
tab_name              ❌ Für Tab-Analyse!
from_screen           ❌ Für Pfadanalyse!
to_screen             ❌ Für Pfadanalyse!
```

---

## 🔥 **KRITISCHE FEHLENDE PARAMETER**

### **1. SCAN EVENTS:**

**Event:** `scan_successful`, `scan_failed`

| Parameter | Status | Impact | Nutzen |
|-----------|--------|--------|--------|
| `ean_code` | ❌ FEHLT | 🔴 HOCH | Welche Produkte werden gescannt? |
| `product_found` | ❌ FEHLT | 🔴 HOCH | Success Rate berechnen! |
| `product_name` | ❌ FEHLT | 🟡 MITTEL | Lesbare Reports |
| `is_fallback` | ❌ FEHLT | 🟡 MITTEL | Fallback-Nutzung messen |
| `fallback_source` | ❌ FEHLT | 🟡 MITTEL | scraped vs openfood |
| `total_scans_in_journey` | ❌ FEHLT | 🟡 MITTEL | Scans pro Session |

**OHNE diese Parameter:**
- ❌ Kannst du NICHT sehen welche EANs gescannt werden
- ❌ Kannst du NICHT die Success Rate berechnen
- ❌ Kannst du NICHT Fallback-Nutzung messen

---

### **2. SEARCH EVENTS:**

**Event:** `search_performed`, `search_query_tracked`

| Parameter | Status | Impact | Nutzen |
|-----------|--------|--------|--------|
| `search_query` | ❌ FEHLT | 🔴 KRITISCH | Was wird gesucht? |
| `results_count` | ❌ FEHLT | 🔴 HOCH | Null-Results finden! |
| `total_searches_in_journey` | ❌ FEHLT | 🟡 MITTEL | Searches pro Session |

**OHNE diese Parameter:**
- ❌ Kannst du NICHT sehen was User suchen
- ❌ Kannst du NICHT Null-Result Searches finden
- ❌ Kannst du NICHT Search-Performance messen

---

### **3. NAVIGATION / PFADANALYSE:**

**Event:** `screen_viewed`, `screen_left`, `tab_switched`

| Parameter | Status | Impact | Nutzen |
|-----------|--------|--------|--------|
| `from_screen` | ❌ FEHLT | 🔴 HOCH | Woher kommt User? |
| `to_screen` | ❌ FEHLT | 🔴 HOCH | Wohin geht User? |
| `tab_name` | ❌ FEHLT | 🟡 MITTEL | Welcher Tab aktiv? |

**OHNE diese Parameter:**
- ❌ **KEINE Pfadanalyse möglich!**
- ❌ Kannst du NICHT sehen: Home → Scanner → Product → Cart
- ❌ GA4 "User Flow" Bericht funktioniert nicht!

**Aktuell wird nur getrackt:**
- ✅ `screen_name` → "product_comparison_id"
- ✅ `dwell_time_ms` → Wie lange auf Screen

**ABER:** Keine Verknüpfung zwischen Screens!

---

### **4. FILTER & JOURNEY:**

**Event:** `filter_applied`, `journey_started`

| Parameter | Status | Impact | Nutzen |
|-----------|--------|--------|--------|
| `filter_type` | ❌ FEHLT | 🟡 MITTEL | market vs category vs brand |
| `filter_value` | ❌ FEHLT | 🟡 MITTEL | Welcher Wert? |
| `filters_active` | ❌ FEHLT | 🟡 MITTEL | Array von Filtern |
| `journey_id` | ❌ FEHLT | 🔴 HOCH | Journey verknüpfen! |

**OHNE diese Parameter:**
- ❌ Kannst du NICHT sehen welche Filter kombiniert werden
- ❌ Kannst du NICHT Journey-Events verknüpfen

---

### **5. CONVERSIONS:**

**Event:** `add_to_cart`, `mark_purchased`, `add_to_favorites`

| Parameter | Status | Impact | Nutzen |
|-----------|--------|--------|--------|
| `source` | ❌ FEHLT | 🔴 HOCH | scan vs search vs browse |
| `brand_id` | ❌ FEHLT | 🟡 MITTEL | Welche Marke? |
| `conversion_type` | ❌ FEHLT | 🟡 MITTEL | Typ der Conversion |

**OHNE diese Parameter:**
- ❌ Kannst du NICHT sehen: "Scans führen zu mehr Käufen als Suche"
- ❌ Kannst du NICHT Source-Attribution machen

---

## 📊 **WAS KANNST DU AKTUELL AUSWERTEN?**

### **✅ FUNKTIONIERT:**
- Gesamte Event-Anzahl (scan_successful, search_performed, etc.)
- Active Users
- Screen Views (welche Screens)
- Dwell Time pro Screen
- Product Type (brand vs noname)
- Category IDs
- Market Chain
- Price & Savings (Metriken)
- User Level
- Session Duration

### **❌ FUNKTIONIERT NICHT:**
- **Welche EANs** werden gescannt?
- **Was** wird gesucht?
- **Scan Success Rate** (product_found fehlt!)
- **Null-Result Searches** (results_count fehlt!)
- **User Flow / Pfadanalyse** (from_screen/to_screen fehlen!)
- **Journey-Verknüpfung** (journey_id fehlt!)
- **Filter-Kombinationen** (filter_type/value fehlen!)
- **Source-Attribution** (source fehlt!)

---

## 🎯 **EMPFOHLENE PARAMETER ZU ERGÄNZEN**

### **PRIO 1 - KRITISCH (ohne diese ist GA4 fast nutzlos):**

```typescript
// Scan Events
if (event.ean_code) ga4Params.ean_code = event.ean_code;
if (event.product_found !== undefined) ga4Params.product_found = event.product_found;
if (event.product_name) ga4Params.product_name = event.product_name;

// Search Events
if (event.search_query) ga4Params.search_query = event.search_query;
if (event.results_count !== undefined) ga4Params.results_count = event.results_count;

// Navigation (für Pfadanalyse!)
if (event.from_screen) ga4Params.from_screen = event.from_screen;
if (event.to_screen) ga4Params.to_screen = event.to_screen;

// Journey
if (event.journey_id) ga4Params.journey_id = event.journey_id;
if (event.source) ga4Params.source = event.source;
```

### **PRIO 2 - WICHTIG:**

```typescript
// Filter
if (event.filter_type) ga4Params.filter_type = event.filter_type;
if (event.filter_value) ga4Params.filter_value = event.filter_value;
if (event.filters_active) ga4Params.filters_active = JSON.stringify(event.filters_active);

// Fallback
if (event.is_fallback !== undefined) ga4Params.is_fallback = event.is_fallback;
if (event.fallback_source) ga4Params.fallback_source = event.fallback_source;

// Engagement
if (event.total_scans_in_journey) ga4Params.total_scans_in_journey = event.total_scans_in_journey;
if (event.total_searches_in_journey) ga4Params.total_searches_in_journey = event.total_searches_in_journey;

// Brand
if (event.brand_id) ga4Params.brand_id = event.brand_id;
if (event.brand_name) ga4Params.brand_name = event.brand_name;

// Tab
if (event.tab_name) ga4Params.tab_name = event.tab_name;
```

---

## 🔧 **SCREEN NAVIGATION FÜR PFADANALYSE**

### **Aktuell:**
```typescript
// Zeile 103-108: screen_left Event
analyticsService.trackEvent({
  event_name: 'screen_left',
  event_category: 'navigation',
  screen_name: lastScreenRef.current,  // ✅ Alter Screen
  dwell_time_ms: dwellTime             // ✅ Verweildauer
}, user?.uid);
```

**❌ PROBLEM:** Kein `to_screen` Parameter!

### **Sollte sein:**
```typescript
analyticsService.trackEvent({
  event_name: 'screen_transition',     // Besserer Name
  event_category: 'navigation',
  from_screen: lastScreenRef.current,  // ✅ Von wo
  to_screen: screenName,               // ✅ Nach wo
  dwell_time_ms: dwellTime            // ✅ Zeit auf altem Screen
}, user?.uid);
```

**DANN kannst du in GA4:**
- Sankey-Diagramme erstellen (User Flow)
- Path Analysis: Welche Wege nehmen User?
- Drop-off Points: Wo verlassen User die App?

---

## 📱 **WAS DU AKTUELL IN GA4 SIEHST:**

**Berichte → Engagement → Ereignisse:**
```
scan_successful: 1.234 Events
  ✅ screen_name
  ✅ event_category
  ✅ product_id
  ✅ product_type
  ❌ ean_code         → FEHLT!
  ❌ product_found    → FEHLT!
  ❌ product_name     → FEHLT!
```

**Berichte → Nutzer → Explorative Pfadanalyse:**
```
❌ "Keine Daten verfügbar"
Grund: from_screen/to_screen fehlen!
```

---

## 🎯 **ZUSAMMENFASSUNG:**

**Von ~30 getrackten Parametern kommen nur ~15 in GA4 an!**

**Fehlende kritische Daten:**
1. 🔴 **Scan-Details** (ean_code, product_found)
2. 🔴 **Search-Details** (search_query, results_count)
3. 🔴 **Pfadanalyse** (from_screen, to_screen)
4. 🟡 **Journey-Linking** (journey_id, source)
5. 🟡 **Filter-Details** (filter_type, filter_value)

---

## 💡 **EMPFEHLUNG:**

**ERWEITERE die Whitelist in `analyticsService.ts` um:**
- Alle PRIO 1 Parameter (kritisch!)
- PRIO 2 Parameter (nice to have)

**DANN hast du:**
- ✅ Komplette Scan-Analyse
- ✅ Komplette Search-Analyse
- ✅ User Flow / Pfadanalyse
- ✅ Source-Attribution
- ✅ Filter-Kombinationen

---

**Soll ich das jetzt fixen? Es sind nur ~20 Zeilen Code hinzuzufügen!**

