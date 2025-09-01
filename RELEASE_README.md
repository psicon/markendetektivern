# 🚀 MarkenDetektive Release Guide

## 📱 RELEASE-ÜBERSICHT

### **🎯 App-Konfiguration:**
- **Bundle ID:** `de.markendetektive`
- **App Name:** `MarkenDetektive`  
- **Current Version:** `4.5.0`
- **Build Number:** `800`
- **Apple Team:** StuByte FlexCo (MZD2N2F887)

---

## 🔧 **RELEASE-TYPEN**

### **1️⃣ DEVELOPMENT (Schnelles Testing)**
```bash
# Expo Go (sofortiges Testing):
npm start
# → QR-Code scannen
# → Sofort testbar auf iPhone/Android
# → Alle Features außer Google/Apple Auth

# Development Build (native Features):
eas build --platform ios --profile development
# → Installierbare iPhone App
# → Alle Features inkl. Google/Apple Auth & nativer Scanner
```

### **2️⃣ INTERNAL TESTING (Beta-Team)**
```bash
# Preview Build:
eas build --platform ios --profile preview
# → Internal Distribution (7 Tage gültig)
# → Per QR-Code installierbar
# → Kein App Store Review nötig

# TestFlight (empfohlen):
eas build --platform ios --profile production
eas submit --platform ios --latest
# → TestFlight Beta
# → Bis zu 100 interne Tester
# → Beta Review (1-24h)
```

### **3️⃣ PUBLIC RELEASE (App Store)**
```bash
# Production Build + Submit:
eas build --platform ios --profile production
eas submit --platform ios --latest
# → TestFlight → App Store Connect
# → App Store Review (1-7 Tage)
# → Öffentlicher Release
```

---

## 📋 **SCHRITT-FÜR-SCHRITT ANLEITUNG**

### **🎯 TESTFLIGHT RELEASE (Empfohlen für Updates)**

#### **Schritt 1: Version erhöhen**
```bash
# In app.json:
"version": "4.6.0"  # Neue Version

# In ios/markendetektivern/Info.plist:
<key>CFBundleShortVersionString</key>
<string>4.6.0</string>

<key>CFBundleVersion</key>  
<string>801</string>         # Build Number erhöhen
```

#### **Schritt 2: Build erstellen**
```bash
# Git commit (wichtig!):
git add .
git commit -m "Release 4.6.0"

# EAS Production Build:
eas build --platform ios --profile production --non-interactive

# ⏱️ Wartezeit: 10-15 Minuten
```

#### **Schritt 3: Zu TestFlight hochladen**
```bash
# Automatischer Upload:
eas submit --platform ios --latest

# ⏱️ Wartezeit: 
# - Upload: 2-5 Minuten
# - Processing: 10-30 Minuten  
# - Beta Review: 1-24 Stunden (nur bei erster Submission)
```

#### **Schritt 4: TestFlight freigeben**
```bash
# 1. App Store Connect öffnen
# 2. TestFlight → MarkenDetektive
# 3. Build 801 → "Testen" aktivieren
# 4. Tester hinzufügen/E-Mails versenden
```

---

### **⚡ SCHNELLE UPDATES (OTA)**

**Für Code-Changes OHNE native Änderungen:**

```bash
# Expo Updates (Over-The-Air):
npx expo publish --channel production

# Vorteile:
✅ Sofortige Updates (< 1 Minute)
✅ Kein neuer Build nötig
✅ Kein App Store Review
✅ User bekommen Update automatisch

# Limitierungen:
❌ Keine nativen Module-Änderungen
❌ Keine neuen Dependencies  
❌ Keine Info.plist Änderungen
```

---

### **🛠️ DEVELOPMENT WORKFLOW**

#### **💻 Lokale Entwicklung:**
```bash
# 1. Expo Go (schnell):
npm start
# → QR-Code → Sofort testbar

# 2. iOS Simulator:
npm run ios  
# → Lokaler Build im Simulator

# 3. Development Build (iPhone):
eas build --platform ios --profile development
# → Native Features testbar
```

#### **🧪 Testing Workflow:**
```bash
# 1. Feature entwickeln:
npm start  # Expo Go Testing

# 2. Native Features testen:
eas build --platform ios --profile development

# 3. Release vorbereiten:
eas build --platform ios --profile production
```

---

## 🎨 **ASSET-MANAGEMENT**

### **📱 App Icon aktualisieren:**
```bash
# 1. Neue icon.png (1024x1024, RGB ohne Alpha) nach assets/images/
# 2. iOS Icons regenerieren:
cd ios/markendetektivern/Images.xcassets/AppIcon.appiconset
cp ../../../../assets/images/icon.png App-Icon-1024x1024@1x.png

# 3. Alle Größen generieren:
sips -z 40 40 App-Icon-1024x1024@1x.png --out App-Icon-20x20@2x.png
sips -z 60 60 App-Icon-1024x1024@1x.png --out App-Icon-20x20@3x.png
sips -z 58 58 App-Icon-1024x1024@1x.png --out App-Icon-29x29@2x.png
sips -z 87 87 App-Icon-1024x1024@1x.png --out App-Icon-29x29@3x.png
sips -z 80 80 App-Icon-1024x1024@1x.png --out App-Icon-40x40@2x.png
sips -z 120 120 App-Icon-1024x1024@1x.png --out App-Icon-40x40@3x.png
sips -z 120 120 App-Icon-1024x1024@1x.png --out App-Icon-60x60@2x.png
sips -z 180 180 App-Icon-1024x1024@1x.png --out App-Icon-60x60@3x.png
sips -z 152 152 App-Icon-1024x1024@1x.png --out App-Icon-76x76@2x.png
sips -z 167 167 App-Icon-1024x1024@1x.png --out App-Icon-83.5x83.5@2x.png

# 4. Alpha Channel entfernen:
for file in *.png; do sips -s format png "$file" --out "${file%.png}-temp.png" && mv "${file%.png}-temp.png" "$file"; done
```

### **🎨 Splash Screen aktualisieren:**
```bash
# Neue splash1.png nach assets/images/
# Automatisch von EAS übernommen
```

---

## ⚙️ **KONFIGURATION**

### **🔧 EAS Build Profiles:**

#### **eas.json:**
```json
{
  "cli": {
    "appVersionSource": "local"  // Wichtig für Build-Nummern!
  },
  "build": {
    "development": {
      "distribution": "internal"   // Installierbar via QR
    },
    "preview": {
      "distribution": "internal"   // 7 Tage gültig
    },
    "production": {
      "autoIncrement": false      // Manual control über Build-Nummern
    }
  }
}
```

### **📱 Bundle ID & Versionen:**

#### **app.json:**
```json
{
  "expo": {
    "name": "MarkenDetektive",
    "version": "4.5.0",          // App Version
    "ios": {
      "bundleIdentifier": "de.markendetektive"
    },
    "android": {
      "package": "de.markendetektive"  
    }
  }
}
```

#### **ios/markendetektivern/Info.plist:**
```xml
<key>CFBundleShortVersionString</key>
<string>4.5.0</string>          <!-- App Version -->

<key>CFBundleVersion</key>
<string>800</string>            <!-- Build Number -->
```

---

## 🚨 **TROUBLESHOOTING**

### **❌ Häufige Probleme:**

#### **Icon-Validation Fehler:**
```bash
# Problem: "Alpha channel not allowed"
# Lösung: Icon ohne Transparenz konvertieren
sips -s format png icon.png --out icon-rgb.png

# Problem: "Missing iPad icons"  
# Lösung: iPad Icons hinzufügen (152x152, 167x167)
```

#### **Build-Nummer Konflikte:**
```bash
# Problem: EAS ignoriert lokale Build-Nummer
# Lösung: "appVersionSource": "local" in eas.json

# Problem: Build-Nummer zu niedrig
# Lösung: Info.plist CFBundleVersion erhöhen
```

#### **Native Module Fehler:**
```bash
# Problem: "Module not found" in Expo Go
# Lösung: Development Build verwenden
eas build --platform ios --profile development
```

---

## 📊 **RELEASE-CHECKLIST**

### **✅ Vor jedem Release:**

- [ ] **Version erhöht** (app.json + Info.plist)
- [ ] **Build-Nummer erhöht** (Info.plist) 
- [ ] **Git committed** (EAS braucht Git)
- [ ] **Assets aktualisiert** (Icon ohne Alpha, Splash)
- [ ] **Features getestet** (Expo Go + Development Build)
- [ ] **Firebase Config** aktualisiert (falls nötig)

### **✅ Nach dem Release:**

- [ ] **TestFlight getestet** (alle Funktionen)
- [ ] **Crash-Reports geprüft** (Firebase/App Store Connect)
- [ ] **User-Feedback** gesammelt
- [ ] **Analytics geprüft** (neue Features)
- [ ] **Next Version geplant**

---

## 📞 **SUPPORT**

### **🔗 Wichtige Links:**
- **EAS Dashboard:** https://expo.dev/accounts/patze1411/projects/markendetektive
- **App Store Connect:** https://appstoreconnect.apple.com/
- **Firebase Console:** https://console.firebase.google.com/
- **Expo Documentation:** https://docs.expo.dev/

### **🆘 Bei Problemen:**
1. **EAS Build Logs** prüfen (Link in Build-Ausgabe)
2. **Expo Discord** Community fragen
3. **Apple Developer Forums** für App Store Probleme  
4. **Firebase Support** für Backend-Issues

---

## 🎉 **AKTUELLE FEATURES (v4.5.0)**

### **✅ Implementiert:**
- 🎮 **Gamification System** (Achievements, Levels, Streaks)
- 🍞 **Toast-Benachrichtigungen** (konfigurierbare Zeiten)
- 📱 **Hybrid Barcode Scanner** (Expo Go + Native iOS)
- 🔐 **Google & Apple Sign-In** (Production Builds)
- 🎨 **Onboarding-Animationen** (Card Selection Hints)
- 💾 **Anti-Abuse System** (LocalStorage-basiert)
- 📊 **User Level Comments** (Live-Loading)
- 🎯 **Platform-spezifische UI** (iOS/Android optimiert)

### **🔄 Hybrid-Systeme:**
- **Scanner:** expo-camera (Expo Go) ↔ AVFoundation (iOS Native)
- **Auth:** Email/Password (überall) + Google/Apple (Production)
- **Toasts:** Zentral konfigurierbar mit Platform-Themes

---

*Letzte Aktualisierung: 1. September 2025 - Build 800*
