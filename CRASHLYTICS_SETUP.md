# 🔥 Firebase Crashlytics Setup

## ✅ Was bereits implementiert ist

1. **Package installiert:** `@react-native-firebase/crashlytics`
2. **Plugin konfiguriert:** In `app.json`
3. **Code integriert:**
   - ErrorBoundary sendet Crashes
   - User ID wird getrackt
   - Custom Attributes (platform, version, anonymous)

---

## 🔧 Was du in Firebase Console machen musst

### **Schritt 1: Crashlytics aktivieren**

1. Gehe zu: <https://console.firebase.google.com/project/markendetektive-895f7>
2. Linke Sidebar → **Crashlytics**
3. Klicke auf **"Crashlytics aktivieren"**
4. Akzeptiere die Bedingungen

### **Schritt 2: Data Sharing Settings (Optional)**

1. In Crashlytics → Einstellungen
2. **Data Sharing**: Empfehlung: **Aktivieren**
   - Bessere Crash-Insights
   - Shared mit Google Analytics

---

## 📱 Was du tun musst

### **Nächster Build:**

```bash
# WICHTIG: EAS Build macht automatisch Prebuild!
# Kein manuelles Prebuild nötig!

# Production Build (Crashlytics wird automatisch konfiguriert)
eas build --platform android --profile production

# Nach Installation:
# Bei erstem Start: Crashlytics sendet erste Daten
# Nach 5 Minuten: Crashlytics Dashboard ist aktiv
```

### **⚠️ Gradle Plugin wurde automatisch hinzugefügt:**

✅ `android/build.gradle`: Firebase Crashlytics Gradle Plugin  
✅ `android/app/build.gradle`: Plugin applied  
✅ Build ID wird automatisch generiert  

**Kein manuelles Setup in Gradle nötig!**

### **Erwartete Console Logs:**

```
✅ Firebase Crashlytics initialized
✅ Error sent to Firebase Crashlytics (bei Crash)
```

---

## 🎯 Nach dem Release

### **Crashlytics Dashboard:**

1. **Crash-Free Users:** Sollte >99% sein
2. **Top Crashes:** Welche Fehler am häufigsten
3. **Affected Users:** Wie viele User betroffen
4. **Stack Traces:** Vollständige Fehler-Details

### **Nützliche Features:**

- **Alerts:** Email bei neuen Crashes
- **Velocity Alerts:** Warnung bei plötzlichem Anstieg
- **User Impact:** Wie viele User sind betroffen
- **Breadcrumbs:** Was tat der User vor dem Crash

---

## ⚠️ WICHTIG

### **Keine zusätzlichen IDs nötig:**

✅ Nutzt automatisch dein Firebase-Projekt  
✅ Kein API Key nötig  
✅ Kein zusätzliches Setup in Google Console  
✅ Funktioniert mit `google-services.json`  

### **Was getrackt wird:**

- ✅ Crashes (automatisch)
- ✅ Non-fatal Errors (manuell via `recordError`)
- ✅ Custom Logs (via `crashlytics().log()`)
- ✅ User ID
- ✅ Custom Attributes (Platform, Version, etc.)

### **Was NICHT getrackt wird:**

- ❌ Persönliche Daten (DSGVO-konform)
- ❌ Screen Content
- ❌ User Input

---

## 🚀 Das war's

Nach dem nächsten Build:

1. ✅ Crashlytics ist aktiv
2. ✅ Crashes erscheinen in Firebase Console
3. ✅ Du bekommst Email-Alerts bei Problemen

**Kein weiteres Setup nötig!** 🎯
