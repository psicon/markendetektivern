# Rewarded Ads Implementierung

## Status: ✅ Implementiert mit echten Ad IDs

### Ad Unit IDs
- **iOS**: `ca-app-pub-9082891656550991/6734170596`
- **Android**: `ca-app-pub-9082891656550991/2930656956`

### Funktionsweise

1. **User Flow**:
   - User tippt auf gesperrte Kategorie
   - Modal öffnet sich mit "Werbung ansehen (24 Stunden)" Button
   - User tippt auf Button → Rewarded Ad wird geladen und angezeigt
   - Nach vollständigem Ansehen → Kategorie wird für 24h freigeschaltet
   - Toast-Nachricht bestätigt Freischaltung

2. **Technische Implementierung**:
   - `RewardedAdService` verwaltet Ad-Loading und Events
   - `CategoryAccessService` speichert temporäre Freischaltungen in AsyncStorage
   - UI zeigt Timer-Icon (🕐) statt Schloss für temporär freigeschaltete Kategorien

### Wichtige Hinweise

#### "Prämie erhalten" Button
- Dieser Button erscheint bei Test-Ads von Google
- Er ist Teil der Ad selbst, nicht unsere UI
- Der Reward wird automatisch nach vollständigem Ansehen vergeben
- User muss NICHT auf "Prämie erhalten" tippen

#### Test vs. Production
- Im Development-Modus werden Test-Ads angezeigt
- Test-Ads verhalten sich anders als echte Ads
- Production-Ads vergeben Rewards automatisch nach Ansehen

### Debugging

Konsolen-Ausgaben zur Fehlersuche:
```
📱 Loading rewarded ad...
✅ Rewarded ad loaded
🎯 showForCategory called for: [categoryId]
🎬 Showing rewarded ad for category: [categoryId]
📱 Rewarded ad opened
🎁 User earned reward: [reward]
✅ Processing reward for category: [categoryId]
🚪 Rewarded ad closed
```

### Bekannte Probleme & Lösungen

1. **Test-Ads reagieren nicht (X und Buttons funktionieren nicht)**
   - **Problem**: Google Test-Ads haben manchmal Touch-Event Probleme
   - **Lösung 1**: Setze `USE_TEST_ADS = false` in `rewardedAdService.ts` (nutzt echte Ads auch im Dev)
   - **Lösung 2**: Warte 30 Sekunden - es gibt einen automatischen Timeout
   - **Lösung 3**: In der Chrome Dev Console: `window.rewardedAdService?.simulateRewardForTesting()` (nur Dev!)

2. **"Prämie erhalten" Button macht nichts**
   - Normal bei Test-Ads, Reward sollte automatisch kommen
   - Bei echten Ads gibt es diesen Button nicht

3. **App friert nach Freischaltung ein** ✅ BEHOBEN
   - **Problem**: UI wurde nicht aktualisiert nach temporärer Freischaltung
   - **Lösung**: `onUnlockSuccess` Callback lädt Kategorien neu

4. **"Werbung nicht verfügbar" bei schnellem Tippen** ✅ BEHOBEN
   - **Problem**: Ad war noch nicht geladen
   - **Lösung**: 
     - Automatisches Warten bis zu 5 Sekunden auf Ad-Load
     - Proaktives Vorladen beim Modal-Öffnen
     - Automatische Wiederholversuche (3x)
     - Besserer Loading-State ("Werbung wird geladen...")

5. **Erste Ad lädt langsam**
   - Nach App-Start dauert erste Ad länger
   - Danach werden Ads automatisch vorgeladen

6. **iOS Consent**
   - Keine UMP auf iOS, daher immer non-personalized ads

### Optimierungen

1. **Auto-Retry**: Bei Ladefehler werden automatisch 3 Versuche gemacht
2. **Preloading**: Ads werden vorgeladen wenn Modal geöffnet wird
3. **Waiting Logic**: Wartet bis zu 5 Sekunden auf Ad-Load
4. **Better UX**: "Werbung wird geladen..." Text während des Wartens

### Analytics Events

- `rewarded_ad_started`: User startet Ad
- `rewarded_ad_completed`: User hat Reward erhalten
- Beide mit `category_id` Parameter

### AsyncStorage Schema

```json
{
  "temporary_category_unlocks": {
    "[categoryId]": {
      "unlockedAt": 1701234567890,
      "expiresAt": 1701320967890
    }
  }
}
```
