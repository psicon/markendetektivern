# KNOWHOW.md — Session-Memory für Claude

Stuff ich gelernt habe, was nicht in CLAUDE.md steht. **Vor jeder
Aufgabe lesen.** Spart Wiederholungen + Frust.

CLAUDE.md = Design-System & Architektur-Konventionen.
KNOWHOW.md (diese Datei) = App-Domain, Workflow, Schmerzhafte Lessons,
Aktueller Stand, Offene Punkte.

---

## 🎯 Was die App macht

**MarkenDetektive** ist eine iOS+Android-App (DACH-Markt, primär DE,
secondary AT) die User dabei hilft **Eigenmarken-Pendants** zu
**Markenprodukten** zu finden — also dieselbe Wurst billiger zu kaufen
weil sie vom gleichen Hersteller produziert wird, nur unter dem
Discounter-Label (z.B. K-Classic, JA!, REWE Bio).

### Value Prop
"Welche Eigenmarke ist eigentlich Marke X?" → User scannt Barcode oder
sucht Produkt → App zeigt Markenprodukt + alle bekannten NoName-
Pendants mit Stufe (wie ähnlich), Preis, Ersparnis.

### Kernfunktionen
- **Produkt-Scan** (Barcode-Cam) → Detail-Page
- **Stöbern** (Browse + Search): Algolia-basierte Suche über NoNames + Markenprodukte, Filter nach Märkten / Stufen / Kategorien / Hersteller
- **Comparison-Page**: Markenprodukt-Hero + horizontaler Carousel der NoName-Alternativen, je mit Stufen-Indikator + Ersparnis-Badge
- **Einkaufszettel**: Marken + NoNames + Custom-Items, swipe-to-bought/delete, "Marken-zu-NoName-konvertieren"-Bulk-Action
- **Bewertungen**: Stern + 4 Sub-Aspekte (Geschmack, Preis, Inhalt, Ähnlichkeit), Comment, ein Rating pro User pro Produkt
- **Gamification**: Level (1-16), Achievements (Stufen-basiert), Streaks, Detektiv-Punkte, Cashback-Taler
- **Cashback**: User scannt Kassenbons (Stufe 5+ konvertierte Käufe), kriegt Geld auf seinen Cashback-Counter, Auszahlung ab Schwelle
- **Bestenliste**: Wöchentlich/Monatlich Top-User nach Punkten, Region (Bundesland/Stadt) oder Overall

### Stufen-Schema (Ähnlichkeit Markenprodukt ↔ NoName)
- **Stufe 5** "Identisch" — gleicher Hersteller, gleiche Rezeptur (nur Label anders)
- **Stufe 4** "Nahezu identisch" — gleicher Hersteller, minimal abweichende Rezeptur
- **Stufe 3** "Vergleichbar" — gleicher Hersteller, stark angepasste Rezeptur
- **Stufe 2** "Markenhersteller" — Hersteller-Name bekannt, kein vergleichbares Produkt
- **Stufe 1** "NoName-Hersteller" — produziert nur Eigenmarken
- **Stufe 0** "Unbekannt" — Hersteller nicht erfasst

User-Lingo: Stufe 5 = "die wahre Marke". Stufe 3 ab da ist die
Comparison-Page "interessant".

---

## 🛠 Tech-Stack

### Frontend
- **Expo SDK 53** + Expo Router (file-based routing, `app/` dir)
- **React Native 0.79.x** (New Architecture aktiv: `newArchEnabled: true`)
- **TypeScript strict** — `tsc --noEmit` ist Pre-Deploy-Gate
- **Reanimated 3** — UI-Thread-Animations (kein `Animated.Value`!)
- **react-native-pager-view** — Tab-Swipe (Stöbern, Einkaufszettel, History)
- **expo-blur** für Header-Chrome auf iOS
- **react-native-google-mobile-ads** für AdMob (iOS+Android Banner+Interstitial)
- **RevenueCat** für IAP/Premium-Subscription
- **Lottie** für Achievement-Celebration-Animations
- **react-native-svg** für Coachmark-Spotlights
- **expo-haptics** für Tactile-Feedback

### Backend (Firebase)
- **Firestore** als Hauptdatenbank (Web SDK, NICHT @react-native-firebase/firestore — historisch gewachsen)
- **Firebase Auth** (anonymous + email + Google + Apple Sign-In)
- **Firebase Storage** (Bilder)
- **Firebase Remote Config** (Web SDK, flaky auf RN — siehe Pitfalls)
- **@react-native-firebase/{analytics,crashlytics,app,firestore}** — installiert aber primär für Analytics+Crashlytics. Firestore-Queries laufen über Web SDK.
- **Cloud Functions** (Node 22, in `cloud-functions/`):
  - `leaderboard-aggregator` — nightly pubsub.schedule, `.select()` field projection auf scans, baut `aggregates/leaderboard_v1`
  - `connected-brands-aggregator` — wöchentlich, baut `aggregates/herstellerBrands_v1` für "Connected Marken pro Hersteller"
  - `image-cleanup` — Gemini-basierte Background-Removal-Pipeline für Produktbilder, schreibt `bildClean*`-Felder
  - Achievement-/Level-Counter-Updates
  - Rating-Aggregation (averageRating-Felder auf Produkten)

### Search
- **Algolia** (zwei Indizes: `produkte` + `markenProdukte`)
- 13 Synonym-Gruppen, `typoTolerance: 'strict'`, `minWordSizefor1Typo: 6`
- 24h-LRU-Cache + Inflight-Promise-Dedup im Client
- Insights-API für Click-Tracking (Learning-to-Rank-vorbereitet)

### CI/CD
- **EAS** (Expo Application Services) für Builds + Submits
- Builds: `eas build --profile production -p {ios|android}`
- Submits: `eas submit --profile {production|openTesting|internalTesting}`
- App-Versionsverwaltung: `appVersionSource: "local"` in `eas.json` (= app.json ist die Quelle)

---

## 🧱 Wichtige Datenmodelle (Firestore Collections)

| Collection | Inhalt | Schema-Highlight |
|---|---|---|
| `produkte` | NoName-Produkte | `markenProdukt`-Ref, `discounter`-Ref, `handelsmarke`-Ref, `hersteller`-Ref → `hersteller_new`, `stufe` (string!), `bild`, `bildClean*` |
| `markenProdukte` | Markenprodukte | `hersteller`-Ref → `hersteller`-Coll (NICHT `_new`!), `relatedProdukte`-Refs |
| `kategorien` | Produkt-Kategorien | `bezeichnung`, `bild`, `isFree`, `getsFreeAtLevel` |
| `discounter` | Discounter (Kaufland, Aldi, Penny, …) | `name`, `bild`, `color`, `land`, **`infos`** (TS-typed!) |
| `handelsmarken` | Eigenmarken (K-Classic, JA!, REWE Bio, …) | `name`, `bezeichnung`, `bild` |
| `hersteller` | **Marken** in User-Lingo | `name`, `bild`, `herstellerref` (→ hersteller_new), **`infos`**, adresse, … |
| `hersteller_new` | **Hersteller** in User-Lingo (Manufacturer) | `herstellername`, `bild`, adresse, plz, stadt, land |
| `packungstypen` | Pack-Type-Info | `typ`, `typKurz` |
| `productRatings` | User-Ratings | `userID`, `productID/brandProductID`-Ref, `ratingOverall`, `ratingTasteFunction`, `ratingPriceValue`, `ratingContent`, `ratingSimilarity`, `comment` |
| `users/{uid}/...` | User-Daten | Subcollections: `favorites`, `einkaufswagen`, `purchases`, `ledger`, `scans` |
| `users/{uid}/stats` | User-Stats | `pointsTotal`, `currentLevel`, `currentStreak`, `cashbackTotal`, … |
| `leaderboards/{uid}` | Per-User-Counter für Leaderboards | weekly/monthly points |
| `aggregates/leaderboard_v1` | Pre-built Top-Listen | nightly aggregator |
| `aggregates/herstellerBrands_v1` | Connected Marken pro Hersteller | weekly aggregator |
| `gamification/config/levels` | Level-Catalog (1-16) | extern editierbar |
| `achievements` | Achievement-Catalog | extern editierbar |

---

## 🔑 Schema-Mapping marken vs hersteller_new (KRITISCH)

User-Sprache mappt **invertiert** zu DB-Collection-Namen.

| User sagt | DB-Collection | Doc-Felder | Bedeutung |
|---|---|---|---|
| **"Marke"** | `hersteller` | `name`, `bild`, `herstellerref`, **`infos`**, `adresse`, `plz`, `stadt`, `land` | Brand-Identity (Markenfamilie). **Hier liegt `infos`!** |
| **"Hersteller"** | `hersteller_new` | **`herstellername`**, `bild`, `adresse`, `plz`, `stadt`, `land` | Tatsächlicher Manufacturer hinter dem Produkt. **Primärer Name ist `herstellername`, NICHT `name`.** |

**Markenprodukt.hersteller-Ref kann auf BEIDE Collections zeigen.** Der
Loader detected via `herstellerref`-Feld:
- Wenn `productData.hersteller`-Doc ein `herstellerref`-Feld hat → es ist eine **Marke** (= "Marken" in User-Lingo)
- Sonst → direkt ein **Hersteller** (= "hersteller_new")

`getMarkenProduktWithDetails` (`lib/services/firestore.ts` ~Z.1755)
splits in `mp.marke` + `mp.hersteller`. Stöbern + shopping-list-Loader
machen dasselbe (analog ergänzt).

**Lese-Pfade in der UI:**
- Marken-Info-Sheet body: `mp.marke?.infos` (NICHT `mp.hersteller?.infos`!)
- NoName-Hersteller-Anzeige: `nn.hersteller?.herstellername ?? nn.hersteller?.name`

**Wenn der User das wieder erwähnt: keine Diskussion, einfach das Schema oben befolgen.**

---

## 💼 Wie wir arbeiten (Workflow)

### Iteration-Pattern
1. User sieht/meldet Issue (oft mit Screenshot)
2. Ich analysiere, gebe Diagnose, schlage Fix vor
3. User OK / Korrektur → ich implementiere
4. TS-Check (`npx tsc --noEmit`)
5. Commit (deutsche Commit-Message + Co-Authored-By Claude)
6. EAS-Build + Auto-Submit-Watcher
7. User testet auf TestFlight / Internal Test → Loop

### Commit-Konventionen
- **Sprache**: Deutsch primär (User schreibt deutsch), aber Code-Kommentare können englisch sein wo's natürlich ist
- **Co-Authored-By**: `Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- **Format**: `type(scope): kurze headline\n\n…body…`
- **Type**: `fix`, `feat`, `perf`, `chore(release)`, `docs`, `revert`
- **Body**: User-Quote oben, dann Root-Cause-Analyse, dann Fix-Beschreibung, dann Auswirkungen / Verkabelung
- **NIE skip-hooks** (`--no-verify`) ohne explizite User-Erlaubnis

### Build-Pipeline-Default
```bash
# Nach jedem Feature/Fix-Commit den den User testen lassen will:
eas build --platform all --profile production --non-interactive --no-wait
# Watcher-Skript für Auto-Submit (siehe unten)
```

### Auto-Submit-Watcher-Pattern
Wenn Build + Submit autonom durchlaufen sollen:
```bash
cat > /tmp/watcher.sh << 'EOF'
#!/usr/bin/env bash
set -uo pipefail
BUILD_ID="<id>"
cd <project>
while true; do
  STATUS=$(eas build:view "$BUILD_ID" --json 2>/dev/null | jq -r '.status' 2>/dev/null)
  case "$STATUS" in
    FINISHED) eas submit -p <ios|android> --profile <profile> --id "$BUILD_ID" --non-interactive 2>&1; exit $?;;
    ERRORED|CANCELED) exit 1;;
    *) sleep 60;;
  esac
done
EOF
chmod +x /tmp/watcher.sh && /tmp/watcher.sh 2>&1
```
Run mit `run_in_background: true`. Watcher pollt alle 60s und feuert
Submit automatisch wenn Build durch ist.

### Cancel-pattern
Wenn ein Build noch läuft aber neuer Commit-Stand drauf soll:
```bash
eas build:cancel <build-id> --non-interactive
# dann fresh build starten
```

---

## 📦 Build- & Release-Pipeline (EAS)

### Profile in `eas.json`
- **production** — App Store / Play Store. `image: "latest"` für Xcode 26 SDK (Apple-Pflicht seit Frühjahr 2026).
- **submit.production.ios** — `appleId: patrick@markendetektive.de`, `appleTeamId: MZD2N2F887`, `ascAppId: 6471081082`. Auth via App Store Connect API Key (in EAS-Servern gespeichert).
- **submit.production.android** — Default track, `serviceAccountKeyPath: ./markendetektive-895f7-ee3923910ddd.json`.
- **submit.openTesting** — `track: beta` (= "Offener Test" in Play Console).
- **submit.internalTesting** — `track: internal` (= "Interner Test").

### Service-Account-Key-Rotation
- Aktueller Key: `markendetektive-895f7-ee3923910ddd.json` (private_key_id `ee3923910ddd...`)
- Vorheriger (kaputt, JWT-invalid): `markendetektive-895f7-58c0a81f4613.json` (gelöscht)
- SA-Email: `flutterflowcodemagic@markendetektive-895f7.iam.gserviceaccount.com`
- Wenn Submit "Authorization failed: invalid_grant - Invalid JWT Signature" wirft → Key wurde rotiert in Google Cloud, neuen aus IAM Console ziehen.
- `.gitignore` patterns: `markendetektive-*.json`, `service-account*.json`, `*-service-account*.json` (NEVER commit Keys!)

### autoIncrement-Verhalten
- `autoIncrement: true` in `production`-Build-Profile → EAS bumpt `buildNumber` / `versionCode` BEFORE dem Build (pre-increment, nicht post).
- Wenn User exakt Nummer X will: `app.json` auf X-1 setzen, EAS bumpt auf X.

### Häufige EAS-Pitfalls
- **iOS-SDK-Reject (ITMS-90725)**: Apple fordert iOS 26 SDK / Xcode 26. EAS-Default-Image ist älter. Lösung: `image: "latest"` in `production.ios`.
- **iOS Submit non-interactive failed**: meist `ascAppId` fehlt. Fix in eas.json + commit, dann retry.
- **Android Submit "duplicate versionCode"**: gleicher Build kann nicht auf zwei Tracks parallel. Entweder neu bauen mit höherem versionCode ODER manuell in Play Console "Release auf anderen Track verschieben".

---

## 🧠 Performance-Lessons (Stöbern + RN)

### Was bei Stöbern Android schief lief (10s-First-Paint-Bug)
- **Firebase Web SDK auf RN ist langsam** (HTTP/2-Connection-Saturation auf langsamem Mobilfunk). Bei mehreren parallelen Reads konkurrieren sie um die Connection.
- **AdMob-BannerAd-Init ist teuer** (dynamic imports + native AdView spawn). 3 BannerAds parallel mounted = 3× das Drama.
- **Reanimated-Worklets pro Card skalieren schlecht** auf Android. Wir hatten temporär `useSharedValue + useAnimatedStyle` pro `FadingImage` — bei 60+ Cards = JS-Bridge-Saturation.

### Solution-Patterns die funktionieren
- **`InteractionManager.runAfterInteractions` für Mount-Loads**: Daten-Fetches starten erst nach dem ersten Render-Frame. Skeleton wird sofort sichtbar, Daten kommen 50-300ms später.
- **BannerAd-Gating auf Daten-da + 2s Buffer**: `dataReady = items.length > 0`, dann setTimeout 2000ms → setAdsReady(true). Banner mountet erst NACH den ersten Karten.
- **Pro Tab nur 1 BannerAd**: `showBannerOn(forTab) = !isPremium && adsReady && tab === forTab`. PagerView mountet 3 Pages, aber Banner ist nur auf der aktiven.
- **Inline-Grid-Banner-Row entfernen**: Banner alle 20 Cards verursachte mid-scroll Layout-Reflows. Auf den Top-Banner pro Tab beschränken.
- **Plain `<Image>` mit `fadeDuration={200}` statt FadingImage in Grid-Cards**: native Android-Fade ohne JS/Worklet-Overhead.
- **`removeClippedSubviews` weg lassen** in ScrollViews mit Reanimated-Children — verursacht Scroll-Stutter.
- **Threshold-Flag für Infinite-Scroll**: `runOnJS` nur einmal beim Eintritt in die "near-bottom"-Zone feuern, nicht 60×/Sekunde.

### Reihenfolge der Aggressivität (für nächstes Stöbern-Perf-Issue)
1. Defer Mount-Loads via InteractionManager
2. Defer Ads via Daten-da + Buffer
3. Remove inline ads
4. Plain Image statt Animated.Image
5. Drop `removeClippedSubviews`
6. Threshold-Flag-Pattern statt per-Frame-runOnJS

---

## 🪤 Häufige Fallen

### Temporal Dead Zone in Production-Builds
TS-Source kann `const x = ...` referenzieren bevor es deklariert ist (z.B.
in einem useEffect der oberhalb des `useState(...)` steht). In Dev-Build
wirft das `ReferenceError`. **Production-Minifier hoistet das als
`undefined`** → `.length of undefined` Crash auf dem TestFlight-Build.

**Regel**: Computed values aus State-Vars (`nonames.length` etc.) IMMER
INSIDE useEffect oder NACH allen useState-Calls platzieren. Plus
`react-hooks/exhaustive-deps` ernst nehmen.

### iOS Status-Bar-Tap-Scroll-to-Top
Auf Screens mit PagerView (Stöbern, Einkaufszettel, Such-/Scanverlauf):
**Default `scrollsToTop=true` auf ALLEN PagerView-Pages → iOS
deaktiviert das Feature für alle**. Fix: `scrollsToTop={activeTab === xxx}`
nur auf der aktiven Page true setzen.

Plus: User erwartet auch **Re-Tap-on-Tab-Icon = Scroll-to-Top**. Das macht
React Navigation NICHT automatisch. Lösung: `navigation.addListener('tabPress', ...)`
in der Component, ScrollView-Refs, manuell scrollen.

### Web SDK Remote Config auf RN
Funktioniert, aber instabil. Werte landen erst nach `fetchAndActivate`
synchron im Cache. Default-Fetch-Intervall in Production = 12h —
explizit `fetchAndActivate()` aufrufen wenn frische Werte gebraucht
werden.

`@/lib/services/remoteConfigService.ts` nutzt `firebase/remote-config`
(Web SDK), NICHT `@react-native-firebase/remote-config`. Fallback
`isExpoGo` springt auf hardcoded Werte zurück. Plus: bei Native-Build
mit `__DEV__=false` ist das Web-SDK trotzdem aktiv.

### Niemals `await import('react-native')`
Triggert metro `metroImportAll` der den lazy `PushNotificationIOS`-Getter
fired → `new NativeEventEmitter(null)` Crash. ALL react-native imports
müssen STATIC at top-of-file sein.

### Niemals `persistentLocalCache` auf Firestore Web SDK
IndexedDB-only API, crasht auf RN via NativeEventEmitter. Wir nutzen
plain `getFirestore(app)` mit in-memory cache + 5-min-TTL +
inflight-promise-dedup in service-Layer (siehe firestore.ts).

---

## 🏗️ Wo wir stehen (Stand letzte Session)

### Aktuelle Branch + Versionen
- **Branch**: `feat/design-implementation-home`
- **Letzte iOS Production buildNumber**: 1043 (Hotfix `63d1c97`)
- **Letzte Android Production versionCode**: 1075 (Hotfix `63d1c97`)
- **Aktuelle App-Version**: 5.0.7
- **Production live**: 5.0.5 (1065)

### Redesign-Status
**Komplett neues Design (Done):**
- Home, Stöbern, Belohnungen, NoName-Detail, Comparison, Achievements,
  Profil, Favoriten, Edit-Profile, History, Purchase-History, Suche
  (gemerged in Stöbern), Tipps & Tricks, Einkaufszettel.

**Alte Design-Markers (noch zu refactoren):**
- `app/markets/*` (Markt-Auswahl-Screens)
- `app/onboarding/*` (9-Step Onboarding)
- `app/auth/*` (Welcome / Login / Register)

**Obsolete:**
- `app/leaderboard.tsx` — durch Bestenliste-Tab in Rewards ersetzt, aber Route lebt noch.

### Was in der laufenden Session passiert ist
Mehrere Schmerz-Iterationen:

1. **Image-Fade + Pop-Themen** (commit `c3bcda8` … `2d77268`)
   FadingImage erst überall, dann wegen Perf nur Hero-Bilder.

2. **Search-Flow Stutter** (`7faf939`, `0e694f2`, `679a44b`)
   Spinner-Overlay weg, Crossfade Skeleton→Cards, Inflight-Cache.

3. **RatingsSheet Re-Design** (`ec0b72f`, `7913601`)
   One-Rating-per-User Server-Dedupe + UI-Prefill mit "Aktualisieren"-CTA.

4. **Stufe Copy aus Remote Config** (`88c89b4`, `25ae7b4`, `49516d0`, `132ebe3`)
   Zentrales `lib/utils/stufeCopy.ts` mit RC-Fetch + Hardcoded-Fallback,
   Per-Card-Stufe-Indikator statt globaler Footer-Row.

5. **Mini-Projekt** (`6ea06a7`)
   4 Items: hersteller-Anzeige, info-sheet, Einkaufszettel-Expand-Fix,
   nav-debounce.

6. **Schema-Bug-Marathon** (`d739509`, `0924109`, `55daa51`, `310903a`, `95f19c3`)
   Multiple Anläufe das marken-vs-hersteller_new Mapping korrekt
   hinzukriegen. **Endgültig**: siehe Schema-Mapping oben.

7. **EAS-Pipeline-Setup** (`db18f9a`, `c7a7392`, `dfae309`, `60f6393`, `8a6fb6d`, `db7a193`, `a655b7c`)
   submit-Profile für Android Open + Internal Testing, iOS-Submit-
   Config mit ascAppId, image: "latest" für Xcode 26, SA-Key-Rotation.

8. **Performance-Round 1** (`962b35a`, `2d77268`)
   FadingImage aus Grid-Cards raus, removeClippedSubviews entfernt.

9. **Performance-Round 2** (`e25d463`, `e5b179a`, `ae473fc`)
   InteractionManager für Mount-Loads, Ads-Lazy-Mount,
   Conditional-scrollsToTop, Inline-Grid-Ad weg.

10. **TDZ-Crash-Hotfix** (`63d1c97`)
    Ad-Gating useEffect war vor State-Deklarationen → Production-Crash.

### 🐛 Aktuell behobene / abgeschlossene Probleme
- ~~Stöbern Android 10s Slow~~
- ~~iOS Status-Bar-Tap-Scroll funktioniert nicht in PagerView-Screens~~
- ~~Anonymous user kann unbegrenzt Ratings abgeben~~
- ~~Marken-Info-Icon zeigt nur Adresse statt infos~~
- ~~Einkaufszettel Marken-Expand zeigt nichts~~
- ~~Such-Flow Spinner-Cascade~~
- ~~Pop bei Bildern in Search-Results~~
- ~~Apple ITMS-90725 Reject (Xcode 26 SDK)~~
- ~~Google Play SA-Key invalid_grant~~
- ~~Stöbern Production-Crash beim Öffnen (TDZ)~~

---

## 📝 Was noch fehlt / Roadmap

### Kurzfristig / Was als Nächstes ansteht (Best-Guess)
- **Android-Performance-Verifizierung** auf Build 1075 — User soll bestätigen dass First-Paint jetzt schnell ist
- **Marken-Info-Sheet** — User soll bestätigen dass `mp.marke.infos` jetzt richtig angezeigt wird (nicht mehr nur Adresse)
- **NoName-Hersteller-Anzeige** — aktuell ENTFERNT (hersteller-Pill war unschön). Wenn User wieder reinwill: andere Form (info-icon-tap? Detail-Page?)

### Mittelfristig (offene Themen aus User-Diskussionen)
- **Auth/Onboarding-Redesign** — die Screens sind noch im alten Design
- **Markets-Screens-Redesign** — `app/markets/*` noch alt
- **Bessere Bildqualität** — image-cleanup-pipeline läuft auf Gemini, aber manche Produkte haben noch white-bg-PNGs
- **Push-Notifications** — historisch im Code aber unklar ob aktiv genutzt
- **Cashback-Auszahlung-Flow** — UI für Auszahlung an PayPal/SEPA, aktueller Stand unklar

### Langfristig / nice-to-have
- **Native Firebase Remote Config** statt Web SDK (würde Native-Rebuild brauchen, aber zuverlässig)
- **Algolia Learning-to-Rank** aktivieren (Insights tracking ist schon drin)
- **iPad-Support** (`supportsTablet: false` aktuell)
- **Apple Watch Companion** (für Scan + Cashback)

### Pending Refactor-Schulden
- `lib/services/firestore.ts` ist >4000 LOC — sollte aufgeteilt werden
- Mehrere "TODO: deaktiviert wegen Firestore 'in' Limits"-Kommentare im Markenfilter-Code
- Test-Coverage praktisch nicht vorhanden (Manual QA via TestFlight/Internal Test)

---

## 📍 Wichtige Dateien (Quick-Reference)

| Datei | Zweck |
|---|---|
| `app/(tabs)/index.tsx` | Home (Top-Rated, "Für dich enttarnt", News, Level-Card) |
| `app/(tabs)/explore.tsx` | Stöbern (Browse + Algolia-Search, 3 Tabs in PagerView) |
| `app/(tabs)/rewards.tsx` | Belohnungen + Bestenliste |
| `app/product-comparison/[id].tsx` | Comparison-Hero + Alt-Card-Carousel + Detektiv-Check |
| `app/noname-detail/[id].tsx` | NoName-Detail (Stufe 1+2) |
| `app/shopping-list.tsx` | Einkaufszettel (3 Tabs Marken/NoNames/Alle) |
| `app/history.tsx` | Such- & Scanverlauf |
| `app/profile.tsx` | Profil (consolidated) |
| `app/achievements.tsx` | Errungenschaften & Level |
| `app/favorites.tsx` | Favoriten |
| `lib/services/firestore.ts` | Hauptdatenzugriff (Web SDK) |
| `lib/services/algolia.ts` | Search (Client + Insights) |
| `lib/services/remoteConfigService.ts` | RC (Web SDK, flaky) |
| `lib/services/achievementService.ts` | Achievement-Tracking |
| `lib/services/leaderboardService.ts` | Leaderboard-Counter |
| `lib/services/adMobService.ts` | AdMob-Init |
| `lib/utils/stufeCopy.ts` | Zentrale Stufe-Copy mit RC + Fallback |
| `lib/utils/savings.ts` | Three-stage savings calculation |
| `lib/utils/productImage.ts` | bildClean → bild Fallback-Chain |
| `components/design/ProductCard.tsx` | NoName-Card (Stöbern, Home) |
| `components/design/BrandCard.tsx` | Markenprodukt-Card (Stöbern Marken-Tab) |
| `components/design/RatingsSheet.tsx` | Rating-Bottom-Sheet |
| `components/design/FilterSheet.tsx` | **Kanonisches** Bottom-Sheet (siehe CLAUDE.md) |
| `components/design/Skeletons.tsx` | Shimmer + Crossfade primitives |
| `components/design/DetailHeader.tsx` | Stack-Screen-Header (back + title + right-slot) |
| `components/design/EnttarnteAlternativesList.tsx` | "Weitere enttarnte Produkte"-Liste am Detail-Page-Bottom |
| `components/coachmarks/*` | Spotlight-Tour-System (Home + Product-Detail) |
| `components/ads/BannerAd.tsx` | AdMob-Banner-Wrapper |
| `cloud-functions/leaderboard-aggregator/` | Nightly Top-Listen-Builder |
| `cloud-functions/connected-brands-aggregator/` | Wöchentlich Marke→Hersteller-Map |
| `cloud-functions/image-cleanup/` | Gemini-Bild-Bereinigungs-Pipeline |

---

## 👤 User-Profil (patrick@markendetektive.de)

### Was er nicht mag
- Wiederholungen des gleichen Fehlers ("bist du behindert?")
- Halb-Lösungen oder Workarounds wenn echter Fix möglich
- Performance-Probleme (top 1 Priorität!)
- Wenn er was klargestellt hat und ich es vergesse
- "TODO" das nie erledigt wird

### Was er gut findet
- Klare Ursache-Analyse vor dem Fix
- Schnelle Iterationen mit Build+Submit-Pipeline
- Diagnose-Logs die ihm Daten liefern statt Vermutungen
- Rollback-Pfade ("ich möchte zurück können wenn ich nicht zufrieden bin")
- Wenn ich einen Mini-Plan vorschlage und er Yes/No sagen kann

### Sein Test-Workflow
- iOS: TestFlight via App Store Connect
- Android: Play Console "Interner Test" (track: internal)
- Beide via "production"-EAS-Profile gebaut

### Kommunikations-Stil
- Kurze, direkte deutsche Messages
- Häufig mit Screenshot
- Listen oft nummeriert (1./2./3.)
- "und?" / "und das auch noch" = "vergiss nicht den anderen offenen Punkt"
- "ok" am Anfang einer Message = "kleiner Korrektur-Push"

---

## 🎨 Design-System-Conventions (siehe CLAUDE.md für volle Details)

- **Type-Scale**: 11 / 13 / 15 / 20 / 22 (5 Stufen, mehr ist Lärm)
- **FilterSheet** ist DAS Sheet-Pattern. Niemals raw `<Modal>` oder neue Sheets.
- **DetailHeader** für Stack-Screens, BlurView-Pattern für Tab-Screens
- **Reanimated 3 only** — kein `Animated.Value` aus react-native
- **Skeleton statt ActivityIndicator** für page-level Loading
- **Crossfade** für skeleton→content Transitions, NIE harten Swap
- **Colors**: `theme.surface` (white light / dark dark), `theme.surfaceAlt` (slightly grey light / slightly lighter dark), `brand.primary` (#0d8575 petrol-green)
- **Stufen-Farben**: 1=red, 2=orange, 3=yellow, 4=light-green, 5=petrol
- **Level-Gradients**: lvl1 brown, lvl2 orange, lvl3 green, lvl4 gold, lvl5 red, 6+ brown

---

## 💾 Wenn du an dieser Datei arbeitest

- Update wenn neue Patterns/Pitfalls auftauchen
- Lese vor jeder neuen Aufgabe (User wartet nicht auf Wiederholungen)
- Wenn der User was klarstellt das ich vergessen hatte → SOFORT hier festhalten
- "Aktuelle Build-Stände" in `git log` cross-checken vor neuen Builds
- Diese Datei ist GIT-tracked → Updates committen mit `docs:` prefix
