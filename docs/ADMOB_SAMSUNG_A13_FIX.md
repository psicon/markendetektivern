# Samsung Galaxy A13 5G AdMob Crash Fix

## Problem
Samsung Galaxy A13 5G (und A12) Geräte crashen mit einem `null pointer dereference: SIGSEGV` Error beim Initialisieren von AdMob.

```
#00 pc 0x4f4d32 libart.so
#15 pc 0x4903ba libreactnative.so
```

## Ursache
- Race Condition beim App-Start zwischen AdMob SDK und Google Play Services
- Spezifisch für Samsung A13 5G und A12 Geräte
- Native Crash in libart.so → nicht in JavaScript abfangbar

## Lösung

### 1. Verbesserter Device-Check
Der Device-Check wurde robuster gemacht:
- **Pattern Matching** statt exaktem String-Vergleich
- Prüft sowohl `Device.modelId` als auch `Device.modelName`
- Fallback zu "Skip Ads" wenn Device nicht erkannt werden kann (safer default)

```typescript
private async shouldSkipAdsForDevice(): Promise<boolean> {
  const modelId = Device.modelId;
  const modelName = Device.modelName;
  
  // Combine both for matching
  const deviceInfo = `${modelId || ''} ${modelName || ''}`.toUpperCase();
  
  // Patterns that match problematic devices
  const problematicPatterns = [
    'SM-A136',  // A13 5G (alle Varianten)
    'SM-A125',  // A12 (alle Varianten)
    'GALAXY A13', 
    'GALAXY A12'
  ];
  
  return problematicPatterns.some(pattern => 
    deviceInfo.includes(pattern.toUpperCase())
  );
}
```

### 2. Defensive Initialisierung (bereits vorhanden)
- Android: `InteractionManager.runAfterInteractions()` mit try-catch
- iOS: Direkte Initialisierung
- Try-catch um gesamte Init-Logik

### 3. Logs zur Diagnose
```
📱 Device Check: { modelId: 'SM-A136B', modelName: 'Galaxy A13 5G' }
⚠️ Problematic device detected - skipping AdMob
```

## Was passiert bei betroffenen Geräten?
- AdMob wird **NICHT** initialisiert
- **KEINE Ads** werden angezeigt
- App läuft **stabil** ohne Crashes
- Kein Revenue-Verlust auf anderen Geräten

## Testing
1. Logs überprüfen: Suche nach "📱 Device Check"
2. Bestätige dass bei A13 5G: "⚠️ Problematic device detected" erscheint
3. Bestätige keine Crashes mehr in Crashlytics für diese Geräte

## Betroffene Versionen
- **Problem**: Version 5.0.1 - 5.0.3
- **Fix**: Version 5.0.4+

