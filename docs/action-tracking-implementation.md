# 📊 ACTION TRACKING IMPLEMENTATION PLAN
## Phase 4 - Vollständige Übersicht

### 🎯 VERFÜGBARE ACTIONS (aus /gamification/actions)

| Action | Punkte | Anti-Abuse | Beschreibung |
|--------|--------|------------|--------------|
| `first_action_any` | 10 | oneTime: true | Erste Aktion (Scan/Suche/Vergleich) |
| `scan_product` | 2 | dailyCap: 10, dedupeWindowSec: 10 | Produkt scannen |
| `view_comparison` | 3 | dailyCap: 10, dedupeWindowSec: 10 | Produktvergleich ansehen |
| `search_product` | 1 | dailyCap: 10, dedupeWindowSec: 5 | Produkt suchen |
| `complete_shopping` | 5 | weeklyCap: 5 | Einkaufszettel abschließen |
| `submit_rating` | 2 | dailyCap: 5, minTextLength: 20 | Bewertung abgeben |
| `mission_daily_done` | 5 | dailyCap: 1 | Tägliche Mission |
| `mission_weekly_done` | 15 | weeklyCap: 1 | Wöchentliche Mission |

### 📍 ZUSÄTZLICHE ACHIEVEMENT ACTIONS (nicht in points config)
- `convert_product` - Für "Erste Umwandlung" Achievement
- `save_product` - Für "Sammler" Achievement
- `daily_streak` - Für "Treu bleiben" Achievement

---

## 📁 FILES ZU ÄNDERN:

### 1️⃣ **app/barcode-scanner.tsx**
- **Action:** `scan_product`
- **Wann:** Nach erfolgreichem Scan
- **Zusätzlich:** Check für `first_action_any`

### 2️⃣ **app/product-comparison/[id].tsx**
- **Action:** `view_comparison`
- **Wann:** Beim Laden der Vergleichsseite (useEffect)
- **Zusätzlich:** Check für `first_action_any`
- **Status:** ✅ BEREITS IMPLEMENTIERT (Zeile 1795)

### 3️⃣ **app/search-results.tsx** & **components/ui/SearchBottomSheet.tsx**
- **Action:** `search_product`
- **Wann:** Bei Suche ausführen
- **Zusätzlich:** Check für `first_action_any`

### 4️⃣ **app/shopping-list.tsx**
- **Action:** `complete_shopping`
- **Wann:** "Alle als gekauft markieren"
- **Action:** `convert_product`
- **Wann:** Produkt umwandeln (NoName zu Marke)

### 5️⃣ **app/rating/[productId].tsx**
- **Action:** `submit_rating`
- **Wann:** Nach erfolgreichem Submit der Bewertung
- **Anti-Abuse:** minTextLength: 20 prüfen

### 6️⃣ **app/favorites.tsx** & **components/ui/SaveButton.tsx**
- **Action:** `save_product`
- **Wann:** Produkt zu Favoriten hinzufügen

### 7️⃣ **lib/contexts/AuthContext.tsx** oder **App Start**
- **Action:** `daily_streak`
- **Wann:** Bei App-Start/Login (1x pro Tag)

### 8️⃣ **Missions System** (falls vorhanden)
- **Action:** `mission_daily_done`
- **Action:** `mission_weekly_done`
- **Wann:** Mission abgeschlossen

---

## ⚙️ IMPLEMENTATION PATTERN:

```typescript
import { achievementService } from '@/lib/services/achievementService';

// In der Komponente:
const trackAction = async () => {
  if (!user) return;
  
  try {
    await achievementService.trackAction(
      user.uid, 
      'action_name',
      { 
        // Optional metadata
        productId: '...',
        ean: '...'
      }
    );
  } catch (error) {
    console.error('Error tracking action:', error);
  }
};
```

---

## 🔍 ANTI-ABUSE CHECKS:

1. **Dedupe Window**: Gleiche Action nicht 2x innerhalb von X Sekunden
2. **Daily/Weekly Caps**: Max Punkte pro Tag/Woche
3. **One-Time Actions**: Nur 1x pro User (first_action_any)
4. **Min Text Length**: Bewertungen müssen min. 20 Zeichen haben

---

## ✅ CHECKLIST:

- [ ] Barcode Scanner
- [ ] Product Comparison (bereits teilweise)
- [ ] Search (SearchBottomSheet + search-results)
- [ ] Shopping List (complete + convert)
- [ ] Rating Submit
- [ ] Favorites/Save
- [ ] Daily Streak
- [ ] Missions (falls vorhanden)
- [ ] First Action Check überall
- [ ] Test alle Actions
