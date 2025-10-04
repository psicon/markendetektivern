# 🛒 RevenueCat Paywall Setup Guide

## 📋 **RevenueCat Dashboard Setup**

### **1. Offerings erstellen:**
```
RevenueCat Dashboard → Offerings:

├── "Premium" (Standard/Default)
│   ├── Produkte: Monthly, Annual, Lifetime
│   └── Standard Paywall Design
│
├── "Onboarding" (Nach Onboarding)
│   ├── Produkte: Monthly, Annual (fokussiert)
│   └── Willkommens-Design mit Onboarding-Benefits
│
├── "CategoryUnlock" (Gesperrte Kategorien)
│   ├── Produkte: Monthly, Annual
│   └── Feature-Gate Design mit "Sofort freischalten"
│
└── "ProfileUpgrade" (More Tab)
    ├── Produkte: All (Weekly, Monthly, Annual, Lifetime)
    └── Upgrade-Design mit allen Optionen
```

### **2. Paywalls designen:**
```
RevenueCat Dashboard → Paywalls:

├── Standard Paywall → "Premium" Offering
├── Onboarding Paywall → "Onboarding" Offering  
├── Feature Gate Paywall → "CategoryUnlock" Offering
└── Upgrade Paywall → "ProfileUpgrade" Offering
```

## 🎯 **Code Usage**

### **Automatische Kontext-Auswahl:**
```typescript
const { presentPaywall } = useRevenueCat();

// Automatisch richtige Paywall basierend auf Kontext:
await presentPaywall('onboarding');        // → "Onboarding" Offering
await presentPaywall('category_unlock');   // → "CategoryUnlock" Offering  
await presentPaywall('profile_upgrade');   // → "ProfileUpgrade" Offering
await presentPaywall('feature_gate');      // → "Premium" Offering
```

### **Helper-Funktionen (Empfohlen):**
```typescript
const { 
  showOnboardingPaywall,
  showCategoryUnlockPaywall, 
  showProfileUpgradePaywall,
  showFeatureGatePaywall 
} = useRevenueCat();

// Spezifische Paywalls:
await showOnboardingPaywall();        // Nach Onboarding
await showCategoryUnlockPaywall();    // Gesperrte Kategorie
await showProfileUpgradePaywall();    // More Tab Button
await showFeatureGatePaywall();       // Allgemeine Features
```

### **Manuelle Offering-Auswahl:**
```typescript
const { presentPaywall } = useRevenueCat();

// Spezifisches Offering erzwingen:
await presentPaywall('custom_context', 'SpecialOffering');
```

## 📍 **Aktuelle Implementierung**

### **Onboarding (nach Completion):**
```typescript
// app/onboarding/index.tsx
const result = await presentPaywall('onboarding');
// → Zeigt "Onboarding" Offering
```

### **Gesperrte Kategorie:**
```typescript
// components/ui/LockedCategoryModal.tsx
const result = await presentPaywall('category_unlock');
// → Zeigt "CategoryUnlock" Offering
```

### **More Tab Premium Button:**
```typescript
// app/(tabs)/more.tsx
const result = await presentPaywall('profile_upgrade');
// → Zeigt "ProfileUpgrade" Offering
```

## 🔧 **Konfiguration**

### **Offering-Mapping:**
```typescript
// lib/config/revenueCatConfig.ts
PAYWALL_CONTEXTS: {
  ONBOARDING: 'Onboarding',        // Nach Onboarding
  CATEGORY_UNLOCK: 'CategoryUnlock', // Gesperrte Kategorie
  PROFILE_UPGRADE: 'ProfileUpgrade', // More Tab
  FEATURE_GATE: 'Premium',         // Standard
  DEFAULT: 'Premium',              // Fallback
}
```

## 🎨 **Design-Empfehlungen**

### **Onboarding Paywall:**
- **Fokus:** Willkommen & Benefits
- **Produkte:** Monthly + Annual (einfach)
- **CTA:** "Jetzt starten"

### **Category Unlock Paywall:**
- **Fokus:** Sofortige Freischaltung
- **Produkte:** Monthly + Annual
- **CTA:** "Sofort freischalten"

### **Profile Upgrade Paywall:**
- **Fokus:** Alle Optionen & Vergleich
- **Produkte:** Weekly, Monthly, Annual, Lifetime
- **CTA:** "Premium werden"

### **Feature Gate Paywall:**
- **Fokus:** Standard Premium-Features
- **Produkte:** Monthly + Annual + Lifetime
- **CTA:** "Premium freischalten"

## 📊 **Testing**

### **Development Build:**
```bash
# 1. Offerings im RevenueCat Dashboard erstellen
# 2. Paywalls designen und zuweisen
# 3. App testen:

# Onboarding durchlaufen → "Onboarding" Paywall
# Gesperrte Kategorie tippen → "CategoryUnlock" Paywall  
# More Tab Premium Button → "ProfileUpgrade" Paywall
```

### **Debug Logs:**
```
🛒 RevenueCat: Presenting paywall...
{
  context: 'onboarding',
  offering: 'Onboarding',
  autoSelected: true
}
🛒 Paywall result: purchased Context: onboarding Offering: Onboarding
```

## ⚡ **Quick Start**

1. **RevenueCat Dashboard:** 4 Offerings erstellen
2. **Paywalls designen:** Jedes Offering eigene Paywall
3. **Code verwenden:** `showOnboardingPaywall()` etc.
4. **Testen:** Development Build mit echten Paywalls

**Fertig!** 🎉 Jeder Kontext zeigt automatisch die richtige Paywall.
