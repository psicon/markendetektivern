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
- **Audience: alle / Topic / einzelne Token** — Einzeltest: „Testnachricht
  senden" mit dem FCM-Token aus `users/{uid}/fcmTokens/*`, Feld `token`
  (NICHT die Dokument-ID, NICHT `pushTokens` — dort liegen Expo-Token, die die
  Console nicht annimmt). Der Store-Build zeigt den Token nirgends an; lesen
  per Admin-SDK oder Firebase Console.

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
| `/cashback/pending/{bonId}` | Bon-Detail (Ziel der Cashback-Push) |
| `/achievements` | Achievements / Level |
| `/shopping-list` | Einkaufszettel |
| `/favorites` | Favoriten |
| `/history` | Historie |
| `/profile` | Profil |
| `/notification-settings` | Notification-Einstellungen |

→ Wenn `deepLink` fehlt oder ungültig: der Tap öffnet nur die App (kein
  Sprung; beim Kaltstart also die Startseite). Bis 17.09.2026 ersetzte die App
  in diesem Fall den aktuellen Bildschirm per `replace` durch die Tabs.

### 6. Senden + Audit
Klick auf **Veröffentlichen** → FCM sendet an alle Tokens. Status sichtbar
unter "Kampagnen" in der Firebase Console. Open-Rates kommen automatisch
in Firebase Analytics.

---

## Was technisch passiert (Quick-Reference, Stand 17.09.2026)

```
Firebase Console / cashback-pipeline (sendCashbackReady)
    │
    │ FCM-Send mit { notification, data: { deepLink, pushId } }
    │ Android: channelId 'cashback' (legt die App beim Start an)
    ▼
Gerät — Tap auf die Nachricht
    │
    │ RNFB: onNotificationOpenedApp (Hintergrund) / getInitialNotification (Kaltstart)
    │ Android zusätzlich: expo-notifications meldet denselben Tap
    ▼
lib/services/fcmDeepLinks.ts → navigateToDeepLink (pushDeepLinks.ts)
    │
    │ Whitelist-Check; derselbe Pfad binnen 5 s nur einmal (Doppelmeldung)
    │ vor der ersten echten Route: nur vormerken — app/index.tsx ersetzt
    │ sonst per replace('/(tabs)') das Ziel wieder
    ▼
router.push(path), sobald Route + Nutzer stehen (PushNotificationProvider)
```

Den Server-Link erzeugt `cashback-pipeline/lib/pushLinks.js`; der Vertrag
mit dem App-Resolver ist per Test festgenagelt
(`lib/services/__tests__/pushDeepLinkVertrag.test.ts`).

Testen im Debug-Client: Der Entwickler-Client startet sich nach einem
Nachrichten-Tap mit seiner eigenen Adresse neu und verwirft dabei die
Nachrichtendaten — der Kaltstart-Weg lässt sich dort nur simulieren
(App-Prozess beenden, dann `am start … --es google.message_id '<id aus
shared_prefs/io.invertase.firebase.xml>'`). „Beenden erzwingen" ist kein
Kaltstart-Test: Android stellt gestoppten Apps keine Nachrichten zu.

---

## Token-Verwaltung (Stand 17.09.2026)

**Maßgeblich ist der FCM-Token** in `users/{uid}/fcmTokens/{id}`
(`token`, `platform`, `addedAt`, `lastSeenAt`) — den liest der Server
(`cashback-pipeline/lib/push.js`) und den nimmt die Firebase Console an.
Geschrieben von `lib/services/fcmTokenService.ts`, und zwar NUR mit
Erlaubnis: beim Start (wenn schon erteilt), nach Zustimmung im erklärenden
Sheet oder auf der Einstellungsseite, und beim Wechsel auf „erlaubt" nach der
Rückkehr aus den Systemeinstellungen. Warum ein Konto keinen Token hat, steht
in `users/{uid}.fcmStatus`.

Android 13+: expo-notifications meldet „nie gefragt" als `denied`. Die App
wertet das über `canAskAgain` als „offen" (`pushPermissionStatus.ts`) — bis
6.0.17 fehlte das, und kein Android-13+-Nutzer wurde je gefragt.

Nebenbei (nur Expo-Weg, vom Server nicht gelesen):
- `users/{uid}.pushToken` — `{ token, platform, deviceName, lastUpdated }`
- `pushTokens/{token}` — Expo-Token mit `active: bool`

Ungültige FCM-Token entfernt der Server beim nächsten Versand
(`pruneInvalidTokens`).

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
