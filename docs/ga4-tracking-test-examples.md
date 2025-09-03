# 📊 GA4 ANALYTICS - TEST EXAMPLES

## ✅ **SETUP ABGESCHLOSSEN:**
- ✅ Firebase Analytics aktiviert (`IS_ANALYTICS_ENABLED: true`)
- ✅ Packages installiert (`@react-native-firebase/analytics`, `@react-native-firebase/app`)
- ✅ iOS Pods installiert (Firebase 12.2.0, FirebaseAnalytics 12.2.0)
- ✅ AnalyticsProvider integriert
- ✅ Automatisches Screen-Tracking aktiviert

---

## 📱 **WAS BEREITS AUTOMATISCH GETRACKT WIRD:**

### **Navigation Events:**
```typescript
📊 GA4 Event: session_started
📊 GA4 Event: screen_viewed (home)
📊 GA4 Event: screen_left (dwell_time_ms: 4500)
📊 GA4 Event: tab_switched (from: home, to: explore)
```

### **Automatische Metadaten:**
```typescript
{
  uid: "xFNt9LKi...",           // User-ID (pseudonymisiert)
  session_id: "session_...",     // Eindeutige Session
  user_level: 2,                // Aktuelles Level
  screen_name: "explore",        // Aktueller Screen
  event_category: "navigation",   // Event-Typ
  timestamp: Date,               // Zeitstempel
  session_duration_ms: 45000     // Session-Länge
}
```

---

## 🎯 **USAGE EXAMPLES FÜR ENTWICKLER:**

### **Produktinteraktionen tracken:**
```typescript
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';

function ProductCard({ product }) {
  const analytics = useAnalytics();
  
  const handleProductClick = () => {
    analytics.trackProductView(product.id, 'noname', {
      source: 'category_list',
      position: 3,
      price: product.preis,
      category_id: product.kategorie?.id
    });
  };
}
```

### **Suchverhalten tracken:**
```typescript
function SearchComponent() {
  const analytics = useAnalytics();
  
  const handleSearch = (query: string, results: any[]) => {
    analytics.trackSearch(query, results.length, [
      'category:bio', 'market:aldi'
    ]);
    
    // Automatische Motivation-Detection:
    // "bio milch" → Inhalts-Motivation
    // "günstige milch" → Preis-Motivation
    // "coca cola" → Marken-Motivation
  };
}
```

### **Konversionen tracken:**
```typescript
function ShoppingListItem({ item }) {
  const analytics = useAnalytics();
  
  const handleMarkAsPurchased = () => {
    analytics.trackConversion('mark_purchased', item.product.id, {
      price: item.product.preis,
      savings_abs: item.savings,
      market_chain: item.product.discounter?.name,
      category_id: item.product.kategorie?.id
    });
  };
}
```

### **Filter & Sortierung tracken:**
```typescript
function FilterComponent() {
  const analytics = useAnalytics();
  
  const handleFilterApply = (type: string, value: string) => {
    analytics.trackFilter(type, value, 'explore');
    
    // Auto-Motivation-Signals:
    // sort: "price_asc" → Preis-Motivation +2  
    // filter: "market:aldi" → Markt-Motivation +1
  };
}
```

---

## 📈 **DASHBOARD-KPI MAPPING:**

### **KPIs (Top Cards):**
```sql
-- GA4 → BigQuery Queries
SELECT COUNT(DISTINCT user_id) as total_users FROM events WHERE event_name = 'session_started'
SELECT COUNT(*) as total_scans FROM events WHERE event_name = 'scan_product'  
SELECT COUNT(*) as total_purchases FROM events WHERE event_name = 'mark_purchased'
SELECT AVG(session_duration_ms)/1000/60 as avg_session_minutes FROM events WHERE event_name = 'session_started'
```

### **Conversion Funnel:**
```sql
WITH funnel AS (
  SELECT user_id,
    COUNT(CASE WHEN event_name = 'scan_product' THEN 1 END) as scans,
    COUNT(CASE WHEN event_name = 'product_viewed' THEN 1 END) as views,  
    COUNT(CASE WHEN event_name = 'compare_opened' THEN 1 END) as compares,
    COUNT(CASE WHEN event_name = 'add_to_cart' THEN 1 END) as carts,
    COUNT(CASE WHEN event_name = 'mark_purchased' THEN 1 END) as purchases
  FROM events GROUP BY user_id
)
SELECT 
  AVG(CASE WHEN scans > 0 THEN 1.0 ELSE 0 END) * 100 as scan_rate,
  AVG(CASE WHEN views > 0 THEN 1.0 ELSE 0 END) * 100 as view_rate,
  AVG(CASE WHEN compares > 0 THEN 1.0 ELSE 0 END) * 100 as compare_rate,
  AVG(CASE WHEN purchases > 0 THEN 1.0 ELSE 0 END) * 100 as purchase_rate
FROM funnel
```

### **Kaufmotiv-Verteilung:**
```sql
WITH motivation_scores AS (
  SELECT user_id, session_id,
    SUM(CASE WHEN event_name = 'filter_applied' AND param_value LIKE '%price%' THEN 2 ELSE 0 END) as price_score,
    SUM(CASE WHEN event_name = 'search_performed' AND search_query LIKE '%bio%' THEN 3 ELSE 0 END) as content_score,
    SUM(CASE WHEN event_name = 'search_performed' AND search_query REGEXP '[A-Z][a-z]+' THEN 3 ELSE 0 END) as brand_score
  FROM events WHERE event_name IN ('filter_applied', 'search_performed', 'sort_changed')
  GROUP BY user_id, session_id
),
primary_motivation AS (
  SELECT *,
    CASE 
      WHEN price_score >= content_score AND price_score >= brand_score THEN 'Preis'
      WHEN content_score >= brand_score THEN 'Inhalt' 
      ELSE 'Marke'
    END as motivation
  FROM motivation_scores
)
SELECT motivation, COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as percentage
FROM primary_motivation GROUP BY motivation
```

---

## 🔍 **TERMINAL LOGS ZEIGEN:**

```
✅ Firebase Analytics installiert
📊 Events werden erfasst und zu GA4 gesendet  
📈 Screen-Navigation automatisch getrackt
🎯 Session-Management läuft
```

**GA4-Tracking läuft! Dein Dashboard kann jetzt befüllt werden!** 🎉📊✨
