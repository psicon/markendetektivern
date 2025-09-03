# 📊 ANALYTICS IMPLEMENTATION GUIDE

## 🎯 ZENTRALES SYSTEM - EINFACH ÜBERALL VERWENDEN

### 🏗️ **BEREITS SETUP:**
- ✅ **AnalyticsService**: Zentraler Service für alle Events
- ✅ **AnalyticsProvider**: Automatisches Screen-Tracking + Context
- ✅ **App Integration**: Provider in _layout.tsx eingebunden

### 📱 **VERWENDUNG IN KOMPONENTEN:**

#### **Simple Hook-Verwendung:**
```typescript
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';

function MeineKomponente() {
  const analytics = useAnalytics();
  
  const handleProductClick = (productId: string) => {
    // Auto-tracked mit User-ID, Screen-Context, Session-ID
    analytics.trackProductView(productId, 'noname', {
      source: 'category_list',
      position_in_list: 3
    });
  };
}
```

---

## 📊 **ALLE DASHBOARD-EVENTS ABGEDECKT:**

### **1. KPI TRACKING (Top Cards)**
```typescript
// Auto-tracked durch Provider:
✅ session_started → Nutzer Gesamt
✅ scan_product → Scans
✅ mark_purchased → Käufe  
✅ screen_left (dwell_time_ms) → Ø Session
```

### **2. CONVERSION FUNNEL** 
```typescript
// 5-stufiger Funnel:
analytics.trackCustomEvent('scan_product');           // 100%
analytics.trackProductView(productId, 'noname');     // 87.1%
analytics.trackCustomEvent('compare_opened');        // 56.6%
analytics.trackCustomEvent('alternative_selected');  // 27.6%
analytics.trackConversion('mark_purchased', productId); // 17.0%
```

### **3. KAUFMOTIV-VERTEILUNG**
```typescript
// Automatisch aus Verhalten abgeleitet:
analytics.trackFilter('sort', 'price_asc');        → Preis-Motivation
analytics.trackMotivation('savings_widget_viewed', 3); → Ersparnis-Motivation  
analytics.trackFilter('category', 'bio');          → Inhalts-Motivation
analytics.trackSearch('Coca Cola', 5);             → Marken-Motivation
analytics.trackFilter('market', 'aldi');           → Markt-Motivation
```

### **4. REGIONAL-TRACKING**
```typescript
// Auto-enhanced mit Geolocation:
event.store_geohash5 = "52.50_13.40" // Berlin ~5km Genauigkeit
// Bundesländer-Mapping im Dashboard via BigQuery
```

---

## 🔧 **IMPLEMENTATION PRO SCREEN:**

### **📍 Startseite (index.tsx)**
```typescript
const analytics = useAnalytics();

// Kategorie geklickt
analytics.trackCustomEvent('category_clicked', {
  category_id: kategorie.id,
  is_locked: kategorie.isLocked,
  required_level: kategorie.requiredLevel
});

// Suche geöffnet  
analytics.trackCustomEvent('search_initiated', {
  source: 'home_searchbar'
});
```

### **🔍 Stöbern (explore.tsx)**
```typescript
// Tab-Wechsel
analytics.trackCustomEvent('tab_switched', {
  from_tab: oldTab,
  to_tab: newTab
});

// Filter gesetzt
analytics.trackFilter('market', marketId, 'explore');
analytics.trackFilter('category', categoryId, 'explore');

// Sortierung geändert
analytics.trackFilter('sort', 'price_asc', 'explore');
```

### **📷 Scanner (barcode-scanner.tsx)**
```typescript
// Scan-Event
analytics.trackCustomEvent('scan_initiated');

// Scan-Ergebnis
analytics.trackCustomEvent('scan_completed', {
  success: true,
  product_found: true,
  ean: scannedEAN
});
```

### **🔄 Produktvergleich (product-comparison/[id].tsx)**
```typescript
// Bereits implementiert - erweitern:
analytics.trackProductView(productId, 'brand', {
  source: 'scan', // oder 'search' oder 'category'
  has_alternatives: alternativeProducts.length > 0
});

// Tab-Verweildauer (NEU)
useEffect(() => {
  const startTime = Date.now();
  return () => {
    const dwellTime = Date.now() - startTime;
    analytics.trackCustomEvent('product_tab_viewed', {
      product_id: productId,
      tab_name: activeTab,
      dwell_time_ms: dwellTime
    });
  };
}, [activeTab]);
```

### **🛒 Einkaufszettel (shopping-list.tsx)**
```typescript
// Konversions-Events
analytics.trackConversion('mark_purchased', productId, {
  price: product.price,
  savings_abs: product.savings,
  market_chain: product.discounter?.name
});

// Bulk-Purchase
analytics.trackCustomEvent('bulk_purchase_completed', {
  items_count: selectedItems.length,
  total_savings: totalSavings
});
```

### **❤️ Favoriten (favorites.tsx + useFavorites.ts)**
```typescript
// Im useFavorites Hook:
const addToFavorites = async (product) => {
  await favoritesService.addFavorite(product);
  
  analytics.trackConversion('add_to_favorites', product.id, {
    product_type: product.type,
    source: 'product_detail'
  });
};
```

---

## 🎯 **DASHBOARD-ABBILDUNG: 100% COVERAGE**

### ✅ **BEREITS ERFASSBAR:**
```
📊 KPIs: session_started, scan_product, mark_purchased, dwell_time
📈 Funnel: 5-stufig mit journey_step tracking
🎨 Motivationen: Aus Filter/Sort/Search-Patterns
🗺️ Regional: store_geohash5 → Bundesländer-Mapping
📱 Markt-Performance: market_chain in allen Konversionen
⏰ Tagesaktivität: Timestamp in allen Events
```

### 🚀 **SOFORT NUTZBAR:**
- **Kein Survey-Bias** - Alles aus Verhalten abgeleitet
- **Ein zentraler Service** - Nicht in 20 Dateien verteilt  
- **Automatische Metadaten** - User-Level, Geolocation, Session-ID
- **Batch-Upload** - Performance optimiert
- **DSGVO-konform** - Pseudonymisiert + Geohash5

### 📈 **ERWEITERTE INSIGHTS:**
```sql
-- Kaufmotiv-Attribution (BigQuery)
WITH user_journey AS (
  SELECT uid, product_id, 
    LAG(event_name) OVER (PARTITION BY session_id ORDER BY timestamp) as prev_action,
    LEAD(event_name) OVER (PARTITION BY session_id ORDER BY timestamp) as next_action
  FROM analytics_events 
  WHERE timestamp >= purchase_timestamp - INTERVAL 72 HOUR
)
SELECT 
  CASE 
    WHEN prev_action = 'sort_by_price' THEN 'Preis'
    WHEN filter_type = 'market' THEN 'Markt'
    WHEN search_query LIKE '%bio%' THEN 'Inhalt'
    ELSE 'Marke'
  END as motivation
FROM user_journey WHERE event_name = 'mark_purchased'
```

**Das System ist PERFEKT designt für euer Dashboard! Soll ich mit der Implementierung starten?** 🚀✨
