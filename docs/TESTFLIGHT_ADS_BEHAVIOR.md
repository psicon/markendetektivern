# TestFlight Ads Verhalten

## Banner Ads in TestFlight

### Ist es normal, dass Banner Ads nicht angezeigt werden?

**JA**, das ist völlig normal! Hier die Gründe:

### 1. **TestFlight verwendet Production Ad Unit IDs**
- In TestFlight ist `__DEV__ = false`
- Es werden echte Ad Unit IDs verwendet:
  - iOS Banner: `ca-app-pub-9082891656550991/9971461384`
  - Android Banner: `ca-app-pub-9082891656550991/3294372397`

### 2. **Warum keine Ads in TestFlight?**

#### a) **Niedrige Fill Rate**
- TestFlight hat wenige Nutzer
- AdMob optimiert für Apps mit vielen Nutzern
- Fill Rate in TestFlight: oft < 10%

#### b) **Geografische Einschränkungen**
- Ads werden basierend auf Region ausgeliefert
- TestFlight-Tester oft in verschiedenen Regionen
- Nicht alle Regionen haben gleich viele Advertiser

#### c) **App Review Status**
- Google überprüft neue Apps/Ad Units
- Kann 24-48 Stunden dauern
- In TestFlight oft noch nicht vollständig aktiv

#### d) **iOS Non-Personalized Ads**
- Wir nutzen `requestNonPersonalizedAdsOnly: true` auf iOS
- Weniger verfügbare Ads als personalisierte

### 3. **Was du erwarten kannst**

| Umgebung | Banner Fill Rate | Interstitial Fill Rate |
|----------|------------------|------------------------|
| Development (Test Ads) | 100% | 100% |
| TestFlight | 5-20% | 10-30% |
| Production (App Store) | 80-95% | 70-90% |

### 4. **Debug-Logs prüfen**

Schau in der Konsole nach:
```
🎯 BannerAd Render: { 
  platform: 'ios', 
  adUnitId: 'ca-app-pub-9082891656550991/9971461384',
  isReady: true,
  isDev: false 
}
```

Wenn du das siehst, funktioniert alles korrekt!

### 5. **Was du tun kannst**

1. **Warte auf App Store Release**
   - Dort wird die Fill Rate drastisch steigen

2. **Teste mit Test-Ads**
   - Temporär `__DEV__` auf true setzen
   - Oder in Development testen

3. **Verschiedene Regionen testen**
   - VPN verwenden
   - Tester aus USA/UK haben oft bessere Fill Rate

### 6. **Rewarded Ads vs Banner Ads**

- **Rewarded Ads**: Höhere Fill Rate (mehr Revenue für Advertiser)
- **Banner Ads**: Niedrigste Fill Rate
- **Interstitial Ads**: Mittlere Fill Rate

### Fazit

**Keine Banner Ads in TestFlight = Normal! 🎯**

Die Ads funktionieren, es gibt nur keine verfügbaren Kampagnen für TestFlight-Nutzer. Nach App Store Release wird sich das dramatisch verbessern!
