# 🛒 RevenueCat Testing Guide

## 📱 Development Build Testing

### **1. Paywall nach Onboarding testen:**
```
1. Firebase Remote Config → showonboardingpaywall: true setzen
2. Onboarding komplett durchlaufen
3. Am Ende sollte native RevenueCat Paywall erscheinen
4. Echte Produkte werden angezeigt
```

### **2. Manuelle Paywall testen:**
```typescript
// In beliebiger Komponente:
const { presentPaywall, presentPaywallIfNeeded, isPremium } = useRevenueCat();

// Paywall immer zeigen:
await presentPaywall();

// Paywall nur wenn nicht Premium:
await presentPaywallIfNeeded();

// Premium Status prüfen:
console.log('Premium Status:', isPremium);
```

### **3. Verfügbare Produkte:**
- **Weekly:** `$rc_weekly`
- **Monthly:** `$rc_monthly` 
- **Annual:** `$rc_annual`
- **Yearly Offer:** `premiumyearly` (Spezialangebot)
- **Lifetime:** `$rc_lifetime`

### **4. Testing in Development Build:**
```
1. Development Build auf iPhone installieren
2. Onboarding durchlaufen
3. Logs checken für RevenueCat Fehler
4. Paywall sollte native erscheinen
5. Test-Käufe durchführen (Sandbox)
```

## 🔍 **Debugging:**

### **Logs zu beachten:**
```
✅ RevenueCat initialized successfully
🛒 Premium Status: false/true
🛒 Paywall result: purchased/cancelled/error
```

### **Bei Fehlern:**
- App crasht NICHT (Safe Fallback)
- Logs zeigen detaillierte Fehlerinfo
- Mock-Mode wird automatisch aktiviert

## 🎯 **Erwartetes Verhalten:**

**Development Build:**
- Native RevenueCat läuft
- Echte Paywalls werden angezeigt
- Sandbox-Käufe funktionieren

**Expo Go:**
- Mock-Mode läuft
- Keine echten Käufe
- Flow-Testing möglich
