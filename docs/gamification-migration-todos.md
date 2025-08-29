# GAMIFICATION SYSTEM MIGRATION - DETAILLIERTE TODO-LISTE

## 📊 ÜBERSICHT

Migration von lokalem Basis-Gamification zu erweitertem Firebase-basierten System mit Anti-Abuse, Lottie-Animationen und fortgeschrittener Streak-Logik.

---

## 🔥 PHASE 1: FIRESTORE STRUKTUR

### 1.1 Collections & Dokumente erstellen

- [ ] Collection `/gamification/config/levels` mit 10 Level-Dokumenten
- [ ] Collection `/gamification/config/actions` mit Action-Mapping
- [ ] Collection `/gamification/config/streaks` mit Streak-Konfiguration  
- [ ] Bestehende `/achievements` Collection erweitern um lottieAnimation

### 1.2 User-Dokument erweitern

- [ ] `/users/{uid}/stats` erweitern um:
  - `pointsTotal` (ersetzt totalPoints)
  - `savingsTotal` (existiert als totalSavings)
  - `currentLevel` (existiert)
  - `freezeTokens` (neu)
  - `lastStreakActiveDayDate` (neu)
  - `streakTier` (neu)
  
- [ ] Neue Subcollection `/users/{uid}/ledger` für Punkte-Transaktionen:

  ```
  {
    timestamp: Date,
    action: string,
    points: number,
    metadata: {},
    isDedupe: boolean
  }
  ```

---

## 🎯 PHASE 2: TYPE DEFINITIONS ANPASSEN

### 2.1 lib/types/achievements.ts

- [ ] `Level` Interface erweitern:
  - `lottieAnimation: string`
  - Anpassung der pointsRequired/savingsRequired Werte
  
- [ ] Neue Interfaces hinzufügen:

  ```typescript
  interface GameAction {
    points: number;
    oneTime?: boolean;
    dailyCap?: number;
    weeklyCap?: number;
    dedupeWindowSec?: number;
    minTextLength?: number;
    notes?: string;
  }
  
  interface StreakConfig {
    activeEvents: string[];
    tiers: StreakTier[];
    freeze: FreezeConfig;
  }
  
  interface StreakTier {
    minDays: number;
    maxDays: number; 
    dailyBonusPoints: number;
  }
  ```

- [ ] `Achievement` Interface erweitern:
  - `lottieAnimation?: string`

- [ ] `UserStats` Interface erweitern für neue Felder

---

## 🔧 PHASE 3: ACHIEVEMENT SERVICE REFACTORING

### 3.1 lib/services/achievementService.ts - Core Functions

#### Neue Funktionen implementieren

- [ ] `async loadGameConfig()`: Lädt levels, actions, streaks aus Firestore
- [ ] `async awardPoints(eventKey, userId, metadata)`:
  - Prüft action config (oneTime, caps, dedupe)
  - Schreibt in ledger
  - Updated pointsTotal
  - Prüft Level-Up
  
- [ ] `async checkAntiAbuse(userId, eventKey, metadata)`:
  - Daily/Weekly Cap Check
  - Dedupe Window Check (via ledger)
  - Min Text Length Check (für ratings)
  
- [ ] `async checkFirstAction(userId, actionType)`:
  - Prüft ob erste Action überhaupt
  - Vergibt einmalig 10 Bonus-Punkte

#### Bestehende Funktionen anpassen

- [ ] `trackAction()`:
  - Ruft neu `awardPoints()` auf
  - Behält Achievement-Tracking bei
  - Integriert first_action_any Check

- [ ] `checkDailyStreak()`:
  - Erweitert um Tier-System
  - Freeze-Token Verwaltung
  - Bonus-Punkte basierend auf Tier
  - Prüft activeEvents aus config

- [ ] `checkAndUpdateLevel()`:
  - Nutzt Firebase levels statt lokale LEVELS
  - Prüft BEIDE Bedingungen (points + savings)
  - Triggert Lottie-Animation Event

- [ ] `updateUserStats()`:
  - Erweitert um neue Stats-Felder
  - Bei savingsAdd: Prüft Savings-Achievements (100€, 500€ etc)

### 3.2 Action-Tracking Integration

#### Bestehende Aktionen mappen

- [ ] `convert_product` → bleibt + `awardPoints()`
- [ ] `complete_shopping` → bleibt + `awardPoints()`
- [ ] `view_comparison` → bleibt + `awardPoints()`
- [ ] `submit_rating` → bleibt + `awardPoints()` + minTextLength
- [ ] `scan_product` → bleibt + `awardPoints()`
- [ ] `search_product` → bleibt + `awardPoints()`
- [ ] `save_product` → bleibt (kein awardPoints in v1)

#### Neue Actions hinzufügen

- [ ] `first_action_any` → 10 Punkte einmalig
- [ ] `mission_daily_done` → 5 Punkte (später)
- [ ] `mission_weekly_done` → 15 Punkte (später)

---

## 📍 PHASE 4: ACTION TRACKING EINBAUEN

### 4.1 Scanner (app/barcode-scanner.tsx)

- [ ] Nach erfolgreichem Scan: `achievementService.trackAction('scan_product')`
- [ ] Anti-Abuse: 10 Sekunden Dedupe auf gleiche Barcode

### 4.2 Suche (components/ui/SearchBar.tsx + SearchBottomSheet.tsx)  

- [ ] Bei Suche ausführen: `achievementService.trackAction('search_product')`
- [ ] Anti-Abuse: 5 Sekunden Dedupe auf gleichen Suchbegriff

### 4.3 Produktvergleich (app/product-comparison/[id].tsx)

- [ ] Bei View: `achievementService.trackAction('view_comparison')`
- [ ] Anti-Abuse: 10 Sekunden Dedupe auf gleiche Produkt-ID

### 4.4 Einkaufszettel (app/shopping-list.tsx)

- [ ] Bei "Alle als gekauft": `achievementService.trackAction('complete_shopping')`
- [ ] Anti-Abuse: Weekly Cap 5

### 4.5 Bewertungen (app/rating/[productId].tsx - wenn vorhanden)

- [ ] Bei Submit: `achievementService.trackAction('submit_rating')`
- [ ] Anti-Abuse: minTextLength 20 Zeichen

### 4.6 Produktumwandlung (app/shopping-list.tsx)

- [ ] Bei Convert: Bleibt wie gehabt (bereits implementiert)

---

## 🎨 PHASE 5: UI ANPASSUNGEN

## Wichtige Regel: es müssen die alten aktuellen UI Designs genutzt und angepasst werden. Außer für Level und Errungenschaften Listen: Diese dürfen neu gestaltet werden. Popups, Cards etc. müssen beibehalten werden

### 5.1 Lottie Integration

- [ ] Lottie-React-Native installieren (expo-lottie)
- [ ] Achte auf lottieAnimation field in achievements und levels in firestore gamification sammlung
- [ ] Animation Assets in assets/lottie vorbereiten

Der User muss dann in der Lage sein die lotties für Levels und Achievements im Ordner zu platzieren und austauschen zu können.  

### 5.2 Level-Up Overlay (components/ui/LevelUpOverlay.tsx)

- [ ] Erweitern um lottieAnimation prop
- [ ] Dynamisch Animation aus Level-Config laden
- [ ] Unterschiedliche Animationen je nach Level

### 5.3 Points Toast Component (neu)

- [ ] Kleines Toast für Punkte-Vergabe
- [ ] "+X Punkte" Animation
- [ ] Optional mit Mini-Lottie

### 5.4 Achievement Screen (app/achievements.tsx)  

- [ ] Streak-Freeze anzeigen
- [ ] Streak-Tier visualisieren
- [ ] Daily/Weekly Caps Status
- [ ] Ledger/Historie (optional)

### 5.5 Profil Screen

- [ ] Neues Level-System darstellen (1-10)
- [ ] Streak-Tier Badge
- [ ] Gesamtpunkte prominent

---

## 🔒 PHASE 6: ANTI-ABUSE IMPLEMENTIERUNG

### 6.1 Server-Side (Cloud Functions empfohlen)

- [ ] Cloud Function `awardPoints`:
  - Transaktionale Ledger-Schreibung
  - Cap-Enforcement
  - Dedupe-Logic
  - Atomic Counter Updates

### 6.2 Client-Side Optimistic Updates

- [ ] Lokaler Cache für Caps
- [ ] Optimistische Punkte-Anzeige
- [ ] Rollback bei Server-Rejection

---

## 🧪 PHASE 7: MIGRATION & TESTING

### 7.1 Datenmigration (NICHT BENÖTIGT!!!!)

entfällt

### 7.2 Firestore Security Rules

- [ ] Rules für /gamification/config (read-only)
- [ ] Rules für /users/{uid}/ledger (append-only)
- [ ] Rules für Stats-Updates (server-only ideal)

### 7.3 Testing Checkliste

- [ ] First Action Bonus (10 Punkte → Level 2)
- [ ] Daily Caps funktionieren
- [ ] Dedupe Window verhindert Spam
- [ ] Streak erhöht sich korrekt
- [ ] Freeze-Token werden vergeben/genutzt
- [ ] Level-Up bei points UND savings
- [ ] Lottie-Animationen laden

---

## 📝 PHASE 8: KONFIGURATION IN FIRESTORE

### 8.1 Initial Data Upload

- [ ] 10 Level-Dokumente erstellen
- [ ] Actions-Config hochladen
- [ ] Streaks-Config hochladen
- [ ] Achievements mit lottieAnimation erweitern

---

## ⚡ KRITISCHE PUNKTE

1. **Rückwärtskompatibilität**: Bestehende User-Daten gibt es keine da wir im Test Ssin
2. **Performance**: Ledger kann groß werden → Pagination/Archivierung planen
3. **Offline-Support**: Optimistic Updates + Queue für Offline-Actions
4. **Race Conditions**: Transaktionen für alle Counter-Updates
5. **Testing**: Umfassende Tests für Anti-Abuse notwendig

---

## 🚀 DEPLOYMENT REIHENFOLGE

1. Firestore Structure + Security Rules
2. Type Definitions
3. Achievement Service Core
4. Action Tracking Integration
5. UI Components
6. Migration Script
7. Testing
8. Go-Live

---

## GESCHÄTZTER AUFWAND

- Phase 1-2: 2-3 Stunden (Setup)
- Phase 3-4: 4-5 Stunden (Core Logic)
- Phase 5: 3-4 Stunden (UI)
- Phase 6: 2-3 Stunden (Anti-Abuse)
- Phase 7-8: 2-3 Stunden (Migration/Testing)

**GESAMT: ~16-20 Stunden**
