# AdMob iOS Match Rate Fix - KRITISCH

## Problem
Nach Version 5.0.2+ ist die AdMob Match Rate auf iOS drastisch eingebrochen:
- **Interstitial Ads**: Von ~92% auf 10-15% ❌
- **Banner Ads**: Von ~92% auf ~77% ⚠️

## Root Cause

### Was passiert ist:
1. In **5.0.1**: `requestNonPersonalizedAdsOnly: true` (iOS & Android)
2. Ab **5.0.2+**: `requestNonPersonalizedAdsOnly: false` (iOS)

### Warum das ein Problem ist:
- **iOS hat KEIN UMP (User Messaging Platform)** implementiert
- `consentService.initialize()` wird auf iOS nie aufgerufen
- Ohne Consent-Status aber mit `requestNonPersonalizedAdsOnly: false`:
  - AdMob behandelt die Anfrage als "personalized without consent"
  - AdMob **lehnt die Anfrage ab** (kein Fill)
  - Requests bleiben hoch, aber Impressions fallen → Match Rate kollabiert

### Code-Stellen:

**interstitialAdService.ts (FALSCH)**
```typescript
let adRequestOptions = { requestNonPersonalizedAdsOnly: false }; // iOS Default ❌
```

**BannerAd.tsx (FALSCH)**
```typescript
if (Platform.OS === 'ios') {
  return { requestNonPersonalizedAdsOnly: false }; ❌
}
```

## Lösung

### Für iOS MUSS gelten:
```typescript
// iOS: NON-Personalized Ads (kein UMP = kein Consent = non-personalized required)
if (Platform.OS === 'ios') {
  return { requestNonPersonalizedAdsOnly: true }; ✅
}
```

### Geänderte Dateien:
1. **lib/services/interstitialAdService.ts**
   - Zeile 66: `requestNonPersonalizedAdsOnly: true` (war `false`)

2. **components/ads/BannerAd.tsx**
   - Zeile 124: `requestNonPersonalizedAdsOnly: true` (war `false`)
   - Zeile 163: `requestNonPersonalizedAdsOnly: true` (war `false`)

### Android bleibt unverändert:
- Android verwendet weiterhin `consentService.getAdRequestOptions()`
- Dynamisch basierend auf User Consent
- UMP läuft korrekt auf Android

## Warum Interstitials stärker betroffen sind

**Interstitial Inventory** ist strenger bei Consent:
- `requestNonPersonalizedAdsOnly: false` + kein Consent = **komplette Ablehnung**
- Impressions fallen auf fast 0
- Match Rate: 10-15%

**Banner Inventory** ist toleranter:
- Bekommt noch etwas "generic fill"
- Match Rate fällt nur auf ~77%

## Erwartetes Ergebnis nach Fix

### iOS:
- ✅ Interstitial Match Rate: Zurück auf ~90%+
- ✅ Banner Match Rate: Zurück auf ~90%+
- ℹ️ Non-personalized Ads (weniger Revenue als personalized, aber besser als kein Fill)

### Android:
- ✅ Bleibt unverändert (bereits optimal mit UMP)
- ✅ Personalized Ads für User mit Consent
- ✅ Non-personalized Ads für User ohne Consent

## Langfristige Lösung

**UMP für iOS implementieren:**
1. User Messaging Platform auch auf iOS aktivieren
2. Consent-Dialog auch auf iOS anzeigen
3. Dann kann iOS auch personalized Ads nutzen (höherer CPM)
4. Aktuell ist das aber nicht umgesetzt

## Betroffene Versionen
- **Problem**: Version 5.0.2 - 5.0.3
- **Fix**: Version 5.0.4+

## Monitoring
Nach dem Deployment prüfen:
1. iOS Match Rate in AdMob Console
2. Logs: `📊 Interstitial Ad Request Options: { requestNonPersonalizedAdsOnly: true, platform: 'ios' }`
3. eCPM bleibt stabil (non-personalized ist niedriger, aber Fill ist wichtiger)

