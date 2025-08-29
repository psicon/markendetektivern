## 🎬 Lottie Animationen für MarkenDetektive

Diese Ordner enthält alle Lottie-Animationen für das Gamification-System.

### 📂 Benötigte Animationen (lokales System)

#### **Level-Up Animationen**
| Level | Datei | Stil |
|-------|-------|------|
| Level 1→2 | `level-1.json` | Erste Schritte (einfach) |
| Level 2→3 | `level-2.json` | Konfetti |
| Level 3→4 | `level-3.json` | Badge Pulse |
| Level 4→5 | `level-4.json` | Sparkle Effects |
| Level 5→6 | `level-5.json` | Wave Animation |
| Level 6→7 | `level-6.json` | Medal Spin |
| Level 7→8 | `level-7.json` | Burst Effect |
| Level 8→9 | `level-8.json` | Crown Shine |
| Level 9→10 | `level-9.json` | King Sparkle |
| Level 10+ | `level-10.json` | Fireworks (wiederverwenden für höhere Level) |

#### **Achievement Animationen**
| Achievement-Typ | Datei | Trigger |
|----------------|-------|---------|
| Erste Aktion | `first-scan.json` | `first_action_any` |
| Scanner-Profi | `scan-line.json` | `scan_product` |
| Vergleichsexperte | `bar-grow.json` | `view_comparison` |
| Einkaufszettel | `checkmark-rise.json` | `complete_shopping` |
| Bewertungsgeber | `chat-pop.json` | `rating_submit` |
| Streak (7+ Tage) | `streak-fire.json` | `daily_streak` (target >= 7) |
| Streak (2-6 Tage) | `streak-bonus.json` | `daily_streak` (target < 7) |
| Erste Umwandlung | `sparkle-short.json` | `conversion` |
| Favorites | `heart-bounce.json` | `favorites_add` |
| Suchmeister | `search-glow.json` | `search_product` |
| Sparen (100€+) | `savings-100.json` | `savings_total` (target >= 100) |
| Sparen (andere) | `piggy-fill.json` | `savings_total` (target < 100) |
| Fallback | `achievement-unlock.json` | Alle anderen |

#### **Toast Animationen**
| Toast-Typ | Datei | Verwendung |
|-----------|-------|------------|
| Punkte verdient | `points-earned.json` | Points Toast (>= 5 Punkte) |
| Streak Toast | `streak-bonus.json` | Streak-Benachrichtigung |

### 🔥 Neue Streak Animationen

#### **Streak Toast System**
- **streak-fire.json**: Für Streaks >= 7 Tage (Fortgeschritten+)
- **streak-bonus.json**: Für Streaks 2-6 Tage (Starter)
- **Automatisch**: Wird bei App-Start angezeigt wenn Streak >= 2 Tage

#### **Streak Tier System**
```typescript
const getStreakTier = (days: number): string => {
  if (days >= 28) return 'Legende 🏆';  // Gold Gradient
  if (days >= 21) return 'Meister ⭐';   // Purple Gradient
  if (days >= 14) return 'Experte 💪';   // Orange Gradient
  if (days >= 7) return 'Fortgeschritten 🎯'; // Green Gradient
  return 'Starter 🔥'; // Blue Gradient
};
```

### 🔧 Integration - VOLLSTÄNDIG LOKAL

#### **Intelligente lokale Zuordnung**
Alle Animationen werden automatisch basierend auf Typ/Level zugeordnet - **KEINE Firebase-Konfiguration nötig**:

```typescript
// Level-Up Animationen - basierend auf Level-ID
const getLevelLottieSource = (levelId: number) => {
  switch (levelId) {
    case 1: return require('@/assets/lottie/level-1.json');
    case 2: return require('@/assets/lottie/level-2.json');
    // ... automatische Zuordnung
  }
};

// Achievement Animationen - basierend auf Action-Type
const getAchievementLottieSource = (achievement) => {
  switch (achievement.trigger.action) {
    case 'first_action_any': return require('@/assets/lottie/first-scan.json');
    case 'scan_product': return require('@/assets/lottie/scan-line.json');
    case 'view_comparison': return require('@/assets/lottie/bar-grow.json');
    // ... automatische Zuordnung
  }
};

// Toast Animationen - basierend auf Toast-Type
const getToastLottieSource = (type) => {
  switch (type) {
    case 'points': return require('@/assets/lottie/points-earned.json');
    case 'streak': return require('@/assets/lottie/streak-bonus.json');
    // ... automatische Zuordnung
  }
};
```

#### **Vorteile des lokalen Systems:**
- ✅ **Einfacher zu warten** - Eine Stelle pro Animation
- ✅ **Typsicher** - Compile-Time Fehler bei fehlenden Files
- ✅ **Offline-fähig** - Keine Internet-Abhängigkeit
- ✅ **Performant** - Sofortige Ladezeit
- ✅ **Konsistent** - Keine doppelten Definitionen

### 🎨 Design Guidelines

#### **Streak Toast Design**
- **Größe**: 40x40px Lottie + Content
- **Position**: Top der App (unter Statusbar)
- **Dauer**: 4 Sekunden Auto-Hide
- **Farben**: Dynamischer Gradient basierend auf Tier
- **Animation**: Skalierung + Rotation für Emphasis

#### **Status der Assets**

**✅ Vorhanden:**
- `achievement-unlock.json` ✅
- `first-scan.json` ✅
- `level-1.json` bis `level-10.json` ✅
- `points-earned.json` ✅
- `streak-bonus.json` ✅
- `streak-fire.json` ✅

**❌ Noch zu erstellen:**
- `scan-line.json` ❌ (Scanner-Profi Achievement)
- `bar-grow.json` ❌ (Vergleichsexperte Achievement) 
- `checkmark-rise.json` ❌ (Einkaufszettel Achievement)
- `chat-pop.json` ❌ (Bewertungsgeber Achievement)
- `sparkle-short.json` ❌ (Umwandlung Achievement)
- `heart-bounce.json` ❌ (Favorites Achievement)
- `search-glow.json` ❌ (Suchmeister Achievement)
- `savings-100.json` ❌ (100€ Sparen Achievement)
- `piggy-fill.json` ❌ (Sparen Achievement)

#### **Austausch der Assets**
1. Ersetze die `.json` Dateien in diesem Ordner (Placeholder → echte Lottie)
2. Stelle sicher, dass Lottie-Format korrekt ist (After Effects Export)  
3. Teste die Animation in der App
4. **Kein Firebase-Update nötig** - alles automatisch!

### 🚀 Implementierungsdetails

#### **Integration in GamificationProvider**
```typescript
// Global zugänglich für AuthContext
global.showStreakToast(streakDays, bonusPoints);
```

#### **AuthContext Integration**
```typescript
// Bei App-Start nach checkDailyStreak()
setTimeout(() => checkStreakOnAppStart(user.uid), 1500);
```

#### **UI Components**
- `StreakToast.tsx` - Hauptkomponente
- `GamificationProvider.tsx` - State Management  
- `achievements.tsx` - Statische Streak-Anzeige
- `AuthContext.tsx` - App-Start Integration