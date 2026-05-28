# Push-Notifications — Operations Guide

Status: **Phase 1 (Quick-Win) implementiert** — manuelles Senden über
Firebase Console + Deep-Link-Routing + Image-Support.

## So sendest du eine Push-Nachricht

### 1. Firebase Console öffnen
🔗 https://console.firebase.google.com/project/markendetektive-895f7/messaging

→ "Erste Kampagne" / "Neue Kampagne" → **Firebase Notification Messages**

### 2. Notification-Inhalt

| Feld | Was |
|---|---|
| **Titel** | Max ~50 Zeichen, klare Aktion ("🎉 Cashback gutgeschrieben") |
| **Text** | Max ~200 Zeichen, konkret was passiert ist |
| **Notification-Bild** | (optional) HTTPS-URL, **1024×512 px**, JPG/PNG, max 1 MB |

### 3. Ziel auswählen
- **App: MarkenDetektive** (de.markendetektive)
- **Plattform: iOS + Android** (beide)
- **Audience: alle / Topic / einzelne Token** (siehe `pushTokens`-Collection)

### 4. Scheduling
- Sofort senden ODER für ein Datum schedulen
- Empfohlene Zeiten: Di-Do, 11-13 oder 18-20 Uhr (lokale Zeit)

### 5. ⚙️ **Erweiterte Optionen → Custom Data** — DEEP-LINK setzen
```
Key:   deepLink
Value: /noname-detail/abc123
```

Gültige Routes (Whitelist in `lib/services/pushDeepLinks.ts`):

| Route | Wozu |
|---|---|
| `/(tabs)` | Home |
| `/(tabs)/explore` | Stöbern |
| `/(tabs)/explore?query=Bier` | Stöbern mit Suchbegriff |
| `/(tabs)/rewards` | Belohnungen |
| `/(tabs)/rewards?campaign=ABC` | Belohnungen + Kampagnen-Highlight |
| `/noname-detail/{produktId}` | NoName-Produkt-Detail |
| `/product-comparison/{markenProduktId}` | Marken-Produkt-Vergleich |
| `/external-product/{ean}` | Externe Produkt-Lookup-Page |
| `/cashback/review/{bonId}` | Bon-Detail |
| `/achievements` | Achievements / Level |
| `/shopping-list` | Einkaufszettel |
| `/favorites` | Favoriten |
| `/history` | Historie |
| `/profile` | Profil |
| `/notification-settings` | Notification-Einstellungen |

→ Wenn `deepLink` fehlt oder ungültig: User landet auf der Home-Tab.

### 6. Senden + Audit
Klick auf **Veröffentlichen** → FCM sendet an alle Tokens. Status sichtbar
unter "Kampagnen" in der Firebase Console. Open-Rates kommen automatisch
in Firebase Analytics.

---

## Was technisch passiert (Quick-Reference)

```
Firebase Console
    │
    │ FCM-Send mit { notification, data: { deepLink } }
    ▼
Device (iOS/Android)
    │
    │ App im Foreground → Notification erscheint, kein automatisches Routing
    │ App im Background/Closed → Banner; Tap öffnet App
    ▼
expo-notifications.addNotificationResponseReceivedListener
    │
    │ pushNotificationService.handleNotificationResponse(response)
    ▼
extractDeepLink(data) → resolveDeepLink(path)
    │
    │ Whitelist-Check, dann router.push(path)
    ▼
expo-router navigiert zur Detail-Page
```

Cold-Start (App war vorher zu): `Notifications.getLastNotificationResponseAsync()`
wird beim Provider-Mount geholt und nach 500 ms (Router-Ready-Wait)
ausgeführt — siehe `PushNotificationProvider.useEffect`.

---

## Token-Verwaltung

Tokens werden bei jedem Login pro UID in zwei Collections gespeichert:

- `users/{uid}.pushToken` — single-token-shape `{ token, platform, deviceName, lastUpdated }`
- `pushTokens/{token}` — globale Token-Liste für Admin-Broadcasts, mit `active: bool`

Beim Disable-Toggle in `/notification-settings` wird `active: false` gesetzt.
Bei `INVALID_TOKEN`-Errors von FCM sollten wir auch `active: false`
setzen (TODO Phase 2).

---

## Bekannte Limitierungen (Quick-Win-Phase)

- **Kein Frequency-Capping** — manuelle Pushes liegen alle in der Hand
  des Senders. Selbstdisziplin: max 1 Marketing-Push pro Woche.
- **Keine Kategorien-Toggles** — der User kann nur Master-On/Off.
  Kommt in Phase 2.
- **Keine Quiet-Hours** — Pushes kommen jederzeit. Sender muss
  selbst auf vernünftige Uhrzeiten achten.
- **Kein Analytics** — Open-Rates nur via Firebase, kein In-App-Tracking.
- **iOS Rich-Images** brauchen einen neuen Build da `expo-notifications`
  als Config-Plugin neu in `app.json` ist. Nach dem nächsten EAS-Build
  funktionieren Bilder auf iOS automatisch via Notification Service
  Extension die das Plugin reinkonfiguriert.

---

## Phase-2-Roadmap

1. `notificationPreferencesService` — 4 Kategorie-Toggles + Quiet-Hours
2. FCM-Topic-Subscription-Manager (kategorie-basiert)
3. Cloud Functions für automatisierte Trigger:
   - `bon-status-trigger` (Firestore-onUpdate)
   - `payout-threshold-trigger` (Firestore-onUpdate)
   - `lifecycle-cron` (scheduled)
   - `price-drop-watcher` (Firestore-onUpdate markenProdukte)
4. Frequency-Cap via `notification_log`-Collection
5. Foreground-Suppress für Cashback-Pushes (in-app-Toast statt Banner)
6. Admin-Dashboard (Next.js auf Subdomain)
