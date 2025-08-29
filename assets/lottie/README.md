# 🎬 Lottie Animations für MarkenDetektive

Dieses Verzeichnis enthält alle Lottie-Animationen für das Gamification-System.

## 📁 **WICHTIG: Wie Lottie-Animationen funktionieren**

### 1. **Firebase-Integration**
Die Animation-Namen werden in Firestore gespeichert:
- **Levels**: `lottieAnimation` Feld in `/gamification/levels/items/{levelId}`
- **Achievements**: `lottieAnimation` Feld in `/achievements/{achievementId}`

### 2. **Lokale Files vs. URLs**
```javascript
// Firestore Beispiele:
lottieAnimation: "level-1"           // → lädt level-1.json
lottieAnimation: "achievement-unlock" // → lädt achievement-unlock.json  
lottieAnimation: "https://..."       // → lädt von URL
```

## 📂 **VERFÜGBARE PLACEHOLDER**
✅ **Bereits vorhanden:**
- `points-earned.json` → Punkte-Toast (≥10 Punkte)
- `achievement-unlock.json` → Standard Achievement
- `first-scan.json` → Erster Produktscan

## 🎯 **BENÖTIGTE ANIMATIONEN**

### Level-Up Animationen (10 Stück)
- `level-1.json` → Sparanfänger
- `level-2.json` → Erster Schritt  
- `level-3.json` → Sparfuchsmaestro
- `level-4.json` → Preisjäger
- `level-5.json` → Einkaufsdetektiv
- `level-6.json` → Clever Shopper
- `level-7.json` → Marken-Insider
- `level-8.json` → Deal Hunter
- `level-9.json` → Profi-Sparer
- `level-10.json` → Regal-Detektiv

### Achievement Animationen
- `first-conversion.json` → Erste Umwandlung
- `streak-7.json` → 7 Tage Streak
- `savings-100.json` → 100€ gespart
- `shopping-master.json` → Einkaufs-Profi
- `rate-expert.json` → Bewertungs-Experte

### Bonus Animationen
- `streak-bonus.json` → Streak Bonus Toast
- `daily-mission.json` → Tägliche Mission
- `category-unlock.json` → Neue Kategorie

## 🔗 **LOTTIE QUELLEN**
- **LottieFiles**: https://lottiefiles.com (kostenlos)
- **LordIcon**: https://lordicon.com (premium)
- **Iconscout**: https://iconscout.com/lottie

## ⚙️ **INTEGRATION HINZUFÜGEN**

### 1. Animation-File hinzufügen
```bash
# Platziere deine .json Datei hier:
assets/lottie/my-animation.json
```

### 2. Firebase-Dokument aktualisieren
```javascript
// Firestore → /gamification/levels/items/1
{
  "lottieAnimation": "my-animation"
}
```

### 3. Code erweitern (falls neuer Name)
```typescript
// components/ui/LevelUpOverlay.tsx → getLottieSource()
case 'my-animation':
  return require('@/assets/lottie/my-animation.json');
```

## 🎨 **DESIGN GUIDELINES**
- **Größe**: 120x120px optimal
- **Dauer**: 1-3 Sekunden für Level-Ups, 0.5-1.5s für Toasts
- **Format**: JSON (Lottie), nicht GIF oder MP4
- **Farben**: Gold/Orange für Level-Ups, Grün für Erfolge
- **Stil**: Consistent mit App-Design

