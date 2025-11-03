# AdMob Samsung A13 5G Crash Fix

## Problem
- Null Pointer Dereference bei der Initialisierung von Google Mobile Ads
- Betrifft hauptsächlich Samsung A13 5G (SM-A136U, SM-A136B)
- Crash beim Start der App

## Implementierte Lösung

### 1. Defensive Initialisierung in `adMobService.ts`
- Platform-spezifische Initialisierung (iOS sofort, Android mit Delay)
- Device-Check für problematische Geräte mit `expo-device`
- Try-Catch mit non-critical Error Handling

### 2. Verzögerte Initialisierung in `_layout.tsx`
- 2 Sekunden Delay für Android
- Verhindert Race Conditions beim App-Start

### 3. Safe Banner Ad Component
- Neue Komponente: `components/ads/SafeBannerAd.tsx`
- Prüft ob AdMob verfügbar ist bevor Ads geladen werden
- Dynamischer Import der BannerAd Komponente

### 4. ProGuard Rules
- Verhindert Obfuskierung der Google Ads Klassen
- Wichtig für Release Builds

## Verwendung

Die bestehende `BannerAd` Komponente wurde bereits mit den Sicherheitschecks erweitert.
Keine Änderungen in der Verwendung notwendig!

```typescript
// Weiterhin verwenden wie bisher:
import { BannerAd } from '@/components/ads/BannerAd';

<BannerAd 
  style={{ marginHorizontal: 0 }}
  onAdLoaded={() => console.log('✅ Banner loaded')}
  onAdFailedToLoad={(error) => console.log('❌ Banner failed:', error)}
/>
```

## Testing

1. Teste auf Samsung A13 5G
2. Stelle sicher dass iOS weiterhin funktioniert
3. Prüfe andere Android Geräte

## Monitoring

Die Lösung loggt folgende Events:
- "⏭️ AdMob skipped for problematic device" - Wenn Device erkannt wurde
- "✅ Android AdMob mit Delay initialisiert" - Erfolgreiche Init
- "⚠️ Android AdMob init failed (non-critical)" - Fehler ohne Crash

## Fallback

Falls weiterhin Probleme:
1. Erhöhe Android Delay auf 5000ms
2. Füge weitere problematische Devices zur Liste hinzu
3. Als letzte Option: Deaktiviere Ads komplett für betroffene Geräte
