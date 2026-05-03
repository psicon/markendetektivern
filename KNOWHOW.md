# KNOWHOW.md — Session-Memory für Claude

Stuff ich in dieser Session gelernt habe, was nicht in CLAUDE.md steht.
**Vor jeder Aufgabe lesen.** Spart Wiederholungen + Frust.

---

## 🔑 Schema-Mapping marken vs hersteller_new (KRITISCH — User-Sprache ≠ DB-Sprache)

User-Sprache mappt **invertiert** zu DB-Collection-Namen. Mehrfach falsch
gemacht, war jedes Mal Frust:

| User sagt | DB-Collection | Doc-Felder | Bedeutung |
|---|---|---|---|
| **"Marke"** | `hersteller` | `name`, `bild`, `herstellerref`, **`infos`**, `adresse`, `plz`, `stadt`, `land` | Brand-Identity (Markenfamilie). **Hier liegt `infos`!** |
| **"Hersteller"** | `hersteller_new` | **`herstellername`**, `bild`, `adresse`, `plz`, `stadt`, `land` | Tatsächlicher Manufacturer hinter dem Produkt. **Primärer Name ist `herstellername`, NICHT `name`.** |

**Markenprodukt.hersteller-Ref kann auf BEIDE Collections zeigen.** Der
Loader detected via `herstellerref`-Feld:
- Wenn `productData.hersteller`-Doc ein `herstellerref`-Feld hat → es ist eine **Marke** (= "Marken" in User-Lingo)
- Sonst → direkt ein **Hersteller** (= "hersteller_new")

`getMarkenProduktWithDetails` (`lib/services/firestore.ts` ~Z.1755) splits
in `mp.marke` + `mp.hersteller`. Stöbern + shopping-list-Loader machen
dasselbe (analog ergänzt).

**Lese-Pfade in der UI:**
- Marken-Info-Sheet body: `mp.marke?.infos` (NICHT `mp.hersteller?.infos`!)
- NoName-Hersteller-Anzeige: `nn.hersteller?.herstellername ?? nn.hersteller?.name`

**Wenn der User das wieder erwähnt: kein Diskussion, einfach das Schema oben befolgen.**

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
Run mit `run_in_background: true`.

### Häufige EAS-Pitfalls
- **iOS-SDK-Reject (ITMS-90725)**: Apple fordert iOS 26 SDK / Xcode 26. EAS-Default-Image ist älter. Lösung: `image: "latest"` in `production.ios`.
- **iOS Submit non-interactive failed**: meist `ascAppId` fehlt. Fix in eas.json + commit, dann retry.
- **Android Submit "duplicate versionCode"**: gleicher Build kann nicht auf zwei Tracks parallel. Entweder neu bauen mit höherem versionCode ODER manuell in Play Console "Release auf anderen Track verschieben".
- **`autoIncrement: true` aber Build kommt mit unerwartet höherer Nummer**: war `1037` erwartet, EAS bumped auf 1038 → app.json auf 1037-1=1036 setzen.

---

## 🧠 Performance-Lessons (Stöbern + RN)

### Was bei Stöbern Android schief lief
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

Diagnose-Logs sind dein Freund:
```ts
console.log('📡 RC values:', { tier0header: rc.getValue('tier0header').asString(), ... });
```
Wenn alle Werte `''` zeigen → fetchAndActivate ist nicht durch ODER der
Web-SDK ist auf dem Device kaputt. In Expo Go fallback-mode greift sowieso.

### `remoteConfigService` ist Web-SDK
`@/lib/services/remoteConfigService.ts` nutzt `firebase/remote-config` (Web SDK), NICHT
`@react-native-firebase/remote-config`. Fallback `isExpoGo` springt auf
hardcoded Werte zurück. Plus: bei Native-Build mit `__DEV__=false` ist
das Web-SDK trotzdem aktiv.

### Niemals `await import('react-native')`
Triggert metro `metroImportAll` der den lazy `PushNotificationIOS`-Getter
fired → `new NativeEventEmitter(null)` Crash. ALL react-native imports
müssen STATIC at top-of-file sein.

---

## 📍 Wichtige Dateien

| Datei | Zweck |
|---|---|
| `app/(tabs)/index.tsx` | Home (Top-Rated, "Für dich enttarnt") |
| `app/(tabs)/explore.tsx` | Stöbern (Browse + Algolia-Search, 3 Tabs in PagerView) |
| `app/(tabs)/rewards.tsx` | Belohnungen + Bestenliste |
| `app/product-comparison/[id].tsx` | Comparison-Hero + Alt-Card-Carousel + Detektiv-Check |
| `app/noname-detail/[id].tsx` | NoName-Detail (Stufe 1+2) |
| `app/shopping-list.tsx` | Einkaufszettel (3 Tabs Marken/NoNames/Alle) |
| `app/history.tsx` | Such- & Scanverlauf |
| `app/profile.tsx` | Profil |
| `lib/services/firestore.ts` | Hauptdatenzugriff (Web SDK) |
| `lib/services/remoteConfigService.ts` | RC (Web SDK, flaky) |
| `lib/utils/stufeCopy.ts` | Zentrale Stufe-Copy mit RC + Fallback |
| `lib/utils/savings.ts` | Three-stage savings calculation |
| `components/design/ProductCard.tsx` | NoName-Card (Stöbern, Home) |
| `components/design/BrandCard.tsx` | Markenprodukt-Card (Stöbern Marken-Tab) |
| `components/design/RatingsSheet.tsx` | Rating-Bottom-Sheet |
| `components/design/FilterSheet.tsx` | **Kanonisches** Bottom-Sheet (siehe CLAUDE.md) |
| `components/design/Skeletons.tsx` | Shimmer + Crossfade primitives |

---

## 👤 User-Profil

**patrick@markendetektive.de**, sehr direkt, technisch versiert. Was er nicht mag:
- Wiederholungen des gleichen Fehlers ("bist du behindert?")
- Halb-Lösungen oder Workarounds wenn echter Fix möglich
- Performance-Probleme (top 1 Priorität)
- Wenn er was klargestellt hat und ich es vergesse

Was er gut findet:
- Klare Ursache-Analyse vor dem Fix
- Schnelle Iterationen mit Build+Submit-Pipeline
- Diagnose-Logs die ihm Daten liefern statt Vermutungen
- Rollback-Pfade ("ich möchte zurück können wenn ich nicht zufrieden bin")

Sein Test-Workflow:
- iOS: TestFlight via App Store Connect
- Android: Play Console "Interner Test" (track: internal)
- Beide via "production"-EAS-Profile gebaut

---

## 🔧 Aktuelle Build-Stände (kann veraltet sein — verify)

- **iOS Production buildNumber**: 1043 (zuletzt) — letzter Build `d82ed8f1` mit Hotfix `63d1c97`
- **Android Production versionCode**: 1075 (zuletzt) — letzter Build `ec4745b0` mit Hotfix `63d1c97`
- **Aktuelle Version**: 5.0.7
- **Production live im App Store / Play Store**: 5.0.5 (1065)

In `app.json` aktuelle Werte abgleichen vor neuen Builds.

---

## 🐛 Bekannte offene Bugs (Stand letzte Session)

- ~~Stöbern Android 10s Slow~~ — gefixt durch Ad-Defer + InteractionManager
- ~~iOS Status-Bar-Tap-Scroll funktioniert nicht in Stöbern/Einkaufszettel/History~~ — gefixt durch conditional scrollsToTop
- ~~Anonymous user kann unbegrenzt Ratings abgeben~~ — gefixt durch dedupe in addProductRating
- ~~Marken-Info-Icon zeigt nur Adresse statt infos~~ — gefixt durch korrektes mp.marke.infos-Mapping
- ~~Einkaufszettel Marken-Expand zeigt nichts~~ — gefixt durch SwipeRow-height-clamp-Logic

Alle in den letzten Commits (siehe `git log --oneline`).

---

## 🎨 Design-System-Conventions (siehe CLAUDE.md für Details)

- Type-Scale: 11 / 13 / 15 / 20 / 22 (5 Stufen, mehr ist Lärm)
- FilterSheet ist DAS Sheet-Pattern. Niemals raw `<Modal>` oder neue Sheets.
- DetailHeader für Stack-Screens, BlurView-Pattern für Tab-Screens
- Reanimated 3 only — kein `Animated.Value` aus react-native
- Skeleton statt ActivityIndicator für page-level Loading
- Crossfade für skeleton→content Transitions, NIE harten Swap

---

## 💾 Wenn du an dieser Datei arbeitest

- Update wenn neue Patterns/Pitfalls auftauchen
- Lese vor jeder neuen Aufgabe (User wartet nicht auf Wiederholungen)
- Wenn der User was klarstellt das ich vergessen hatte → SOFORT hier festhalten
