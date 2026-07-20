# Crash-Tiefenanalyse 6.0.11 (versionCode 1222) — Stand 20.07.2026

**Anlass:** Play-Console zeigte für 6.0.11 eine User-perceived-Crash-Rate von **2,30 %**
gegenüber ~0,8 % der Vorversionen (6.0.7/6.0.8). Frage: Hat eine der drei
6.0.11-Änderungen (Kotlin-Boot-Guard, Lottie `renderMode="SOFTWARE"`,
AdMob-Banner-try/catch-Patch) eine Regression verursacht?

**Datenbasis:** Google Play Developer Reporting API v1beta1 (crashRateMetricSet,
anrRateMetricSet, errorCountMetricSet, errorIssues:search, errorReports:search),
Service-Account `markendetektive-895f7-ee3923910ddd.json`, Scope
`playdeveloperreporting`. Daten-Freshness zum Analysezeitpunkt: letzter voller
Tag **18.07.2026** (Zeitzone der API: America/Los_Angeles). Reproduzierbare
Abfragen: siehe Anhang + [`scripts/play-vitals/play_api.py`](../scripts/play-vitals/play_api.py).

---

## TL;DR — Verdict

1. **Keine Regression durch 6.0.11.** Beide Crash-Signaturen, die auf 1222
   auftreten, existieren nachweislich seit **versionCode 1065** (Monate alt,
   Report-Belege auf 1065/1205/1212/1218/1222). **Kein einziges Crash-Issue
   der App hat firstAppVersion = 1222.**
2. **Die 2,30 % sind ein First-Day-Artefakt:** exakt **3 Crash-Reports von
   3 Nutzern bei ~90 Nutzern an einem einzigen Tag** (18.07.). Die Vorversionen
   zeigten an ihrem jeweils ersten Rollout-Tag dasselbe Muster (1218: 1,59 %,
   1207: 1,59 %) und fielen am Folgetag auf ≤0,5 %. Alle Konfidenzintervalle
   schließen 0 ein.
3. **Neuer, wichtiger Fund:** Der größte Crash-Cluster der App überhaupt
   (41 Nutzer / 67 Reports in 7 Wochen) ist ein **nativer Crash beim
   TurboModule-Setup von `react-native-google-mobile-ads`**
   (`JavaTurboModule::setEventEmitterCallback` → `NativeGoogleMobileAdsNativeModuleSpecJSI`),
   ausschließlich auf **armeabi_v7a-(32-bit-)Geräten** (Galaxy A13, M11, …).
   Das ist mit hoher Wahrscheinlichkeit die Crash-Klasse der
   Samsung-A13-Review (Marie Jäger). **Der 6.0.11-AdMob-Banner-Patch deckt
   diesen Pfad NICHT ab** — er härtet die Banner-View-Erstellung, der Crash
   liegt aber im Modul-Bootstrapping. Tritt auf 6.0.11 weiter auf (1 Nutzer, 18.07.).
4. **ANR: durchgehend 0,00 %** auf allen Versionen inkl. 1222 (im Fenster
   08.–18.07. app-weit genau 1 ANR, auf 1214).

---

## 1. Versions-Mapping (aus `eas build:list`)

| versionCode | Version | Build fertig | Anmerkung |
|---|---|---|---|
| 1222 | 6.0.11 | 18.07. | enthält die 3 Fixes; live seit ~18.07. |
| 1221 | 6.0.11 | — | ERRORED (firebaseCrashlytics-Gradle-Block) |
| 1220 | 6.0.10 | 18.07. | praktisch keine Nutzer (sofort von 1222 abgelöst; taucht in keiner Vitals-Zeile auf) |
| 1219 | 6.0.9 | 17.07. | dito, keine Vitals-Zeilen |
| 1218 | 6.0.8 | 17.07. | Haupt-Vergleichsversion |
| 1216/1214 | 6.0.7 | 16./17.07. | 1214 trug den Traffic |
| 1212 | 6.0.5 | 13.07. | |
| 1065 | alt (Vor-6.0-Ära) | — | **immer noch aktiv genutzt** (2 640 User-Tage im Fenster 08.–18.07.) |

---

## 2. Die 2,30 % im Kontext — Tages-Zeitreihe

`userPerceivedCrashRate` (UPCR) | `distinctUsers` (von Google gerundet), DAILY, Zeitzone PT:

| Tag | 1065 | 1207 | 1212 (6.0.5) | 1214 (6.0.7) | 1218 (6.0.8) | 1222 (6.0.11) |
|---|---|---|---|---|---|---|
| 13.07. | 0,00 % (200) | **1,59 % (60)** | **0,84 % (100)** | | | |
| 14.07. | 0,00 % (200) | | 0,31 % (300) | | | |
| 15.07. | 0,00 % (100) | | 0,38 % (300) | | | |
| 16.07. | 0,00 % (80) | | 0,00 % (200) | | | |
| 17.07. | 1,10 % (90) | | 0,88 % (100) | **0,94 % (300)** | **1,59 % (100)** | |
| 18.07. | 0,00 % (70) | | 0,00 % (60) | 0,00 % (50) | 0,49 % (200) | **2,30 % (90)** |

**First-Day-Effekt, konsistent über alle Versionen:** Tag 1 mit kleiner Basis
liegt bei 0,84–1,59 % (1222: 2,30 %), Tag 2 mit mehr Nutzern fällt auf
0,00–0,49 %. Für 1222 existiert schlicht noch kein Folgetag. Das CI des
1222-Werts: **0,00–6,39 %** — statistisch nicht von 0 unterscheidbar.

Absolute Zahlen (errorCountMetricSet, reportType=CRASH, Reports/Nutzer):

| Tag | 1212 | 1214 | 1218 | 1222 |
|---|---|---|---|---|
| 13.07. | 5/4 | | | |
| 14.07. | 6/5 | | | |
| 15.07. | 4/4 | | | |
| 16.07. | 1/1 | 4/2 | | |
| 17.07. | 0 | **12/6** | 7/7 | |
| 18.07. | 0 | 0 | 2/2 | **3/3** |
| **Σ** | **16/14** | **16/8** | **9/9** | **3/3** |

6.0.11 hat mit Abstand die **wenigsten** absoluten Crashes; 1214 (6.0.7) hatte
die schlechteste Wiederhol-Quote (16 Reports auf 8 Nutzer).

*Methodik-Hinweis:* UPCR zählt nur im Vordergrund wahrgenommene Crashes und die
Nutzerzahlen sind gerundet — Rate × Basis stimmt deshalb nicht exakt mit den
errorCount-Zahlen überein (2,30 % × 90 ≈ 2, tatsächlich 3 Crash-Nutzer).

---

## 3. Crash-Signaturen pro Version (Issue-Matrix)

`errorIssues:search`, Intervall 01.–19.07., Nutzer pro Version:

| Issue-ID (Kürzel) | Signatur | 1212 | 1214 | 1218 | 1222 |
|---|---|---|---|---|---|
| `561a7ca7` | **libreactnative `_JNIEnv::CallVoidMethod` SIGSEGV (armeabi_v7a)** = AdMob-TurboModule-Init, s. §5 | 6 | 3 (11 Rep.) | 3 | **1** |
| `4783a8f4` | **Fabric `SurfaceMountingManager.getViewState` RetryableMountingLayerException** („Unable to find viewState for tag …") | – | 2 | 3 | **2** |
| `f43e7a87` | libreactnative CallVoidMethod **SIGABRT** (gleicher Pfad, alter ART/CheckJNI) | – | 1 | 1 | – |
| `42855dda`/`e418683b` | Reanimated `handleNodeRemovals` → `ShadowNode::getFamily` SIGSEGV (arm64) | 1 | – | 1 | – |
| `7239dab2` | `ReactViewGroup.dispatchDraw` NPE | 1 | 1 | – | – |
| `4b14614d`/`6806b7f7` | `ViewGroup.dispatchGetDisplayList` IllegalStateException | 3 | – | – | – |
| `51635697` | `androidx.startup.AppInitializer` StartupException (Boot) | – | – | 1 | – |
| `c5eb65f1` | CallVoidMethod SIGABRT-Variante | 2 | – | – | – |
| ANR (`5162cbb9`) | `MessageQueue.nativePollOnce` | – | 1 | – | – |
| **Σ distinctUsers** | | **13** | **8** | **9** | **3** |

**Lesart:** 6.0.11 zeigt eine **Teilmenge** der Crash-Landschaft der
Vorversionen — dieselben zwei Top-Signaturen, nichts Neues. Mehrere
1212/1214/1218-Crashes sind auf 1222 (bisher) gar nicht mehr aufgetreten.

---

## 4. Regressions-Beweisführung — globale Issue-Historie

Play clustert Issues **versionsübergreifend mit stabiler Issue-ID**. Abfrage
ohne versionCode-Filter, Fenster 01.06.–19.07.2026 **und** Kontrollfenster
01.07.2025–19.07.2026 (identische Ergebnisse):

| Issue | firstAppVersion | lastAppVersion | Nutzer gesamt | Reports |
|---|---|---|---|---|
| `4783a8f4` (Fabric viewState) | **1065** | 1222 | 10 | 10 |
| `561a7ca7` (AdMob-TurboModule) | **1065** | 1222 | 41 (1 J.: 47) | 67 (1 J.: 85) |

Zusatzbeweis auf Report-Ebene (`errorReports:search` mit `errorIssueId`-Filter):

- `4783a8f4`: Reports auf vc **1065** (09.06.), **1205** (12.07.), **1218** (17.07.), **1222** (18.07.)
- `561a7ca7`: Reports auf vc **1065** (25.06. + 15.07.), **1212** (14.07.), **1218** (17.07.), **1222** (18.07.)

Zusätzlich wurden alle **39 Crash/ANR-Issues des 7-Wochen-Fensters** geprüft:
**kein einziges hat firstAppVersion = 1222.**

> ⚠️ Stolperfalle für künftige Analysen: `firstAppVersion`/`lastAppVersion`
> sind **auf das Abfrage-Intervall + Filter bezogen**. Eine mit
> `versionCode = 1222` gefilterte Abfrage zeigt immer first=1222 — das ist
> KEIN Beleg für „neu in 1222". Immer ungefiltert + langes Fenster gegenchecken.

**Fazit:** Kotlin-Boot-Guard, Lottie-SOFTWARE-renderMode und AdMob-Banner-Patch
haben **keine** dieser Crash-Klassen eingeführt. Regression ausgeschlossen.

---

## 5. Neuer Befund: größter Crash der App = AdMob-TurboModule-Init (32-bit)

Der `errorReports`-Tombstone (1222, Samsung Galaxy A13 `a13ve`, API 34,
18.07. 15:00Z, armeabi_v7a-Split, libreactnative BuildId `8672f2968e610e35`):

```
libart CallVoidMethodV
→ libreactnative.so  _JNIEnv::CallVoidMethod
→ facebook::react::JavaTurboModule::setEventEmitterCallback
→ libappmodules.so   NativeGoogleMobileAdsNativeModuleSpecJSI
                     RNGoogleMobileAdsSpec_ModuleProvider
                     autolinking_ModuleProvider
```

- **Identischer Stack** auf 1218 (Galaxy A13 am 18.07. 05:00Z, Galaxy M11 am
  17.07.) — gleiche BuildId, gleicher Pfad.
- Die SIGABRT-Schwester `f43e7a87` (15 Nutzer/27 Reports, 1 Jahr) ist derselbe
  Pfad auf altem ART: CheckJNI-Abort über ungültige `jobject`-Referenz statt
  Segfault. Gesamte CallVoidMethod-Familie: **>60 Nutzer über 12 Monate**, alle
  auf armeabi_v7a, alle firstAppVersion 1065.
- **Betroffene Geräte:** Galaxy A13 (mehrfach!), M11, A13x, Tab A 2016, ZTE —
  klassische 32-bit-Low-End-Geräte. Deckt sich mit der 2-Sterne-Review
  (Marie Jäger, Samsung A13, „grüner Bildschirm dann Absturz").
- **Warum der 6.0.11-Patch nicht greift:** der Patch härtet
  `ReactNativeGoogleMobileAdsBannerAdViewManager.initAdView()` (Banner-View-
  Erstellung). Der Crash passiert früher/woanders: beim Registrieren des
  EventEmitter-Callbacks während des TurboModule-Setups des AdMob-Moduls.

**Handlungsansätze:** → durch die Upstream-Recherche (§9, gleicher Tag)
vollständig aufgelöst: Root-Cause ist ein RN-Core-Bug, **gefixt in RN 0.79.6**;
unser 0.79.5 ist die letzte Version ohne den Fix. Details + Beweise in §9.

---

## 6. ANR + Geräteverteilung

- **ANR-Rate: 0,0000 auf allen Versionen** (DAILY 08.–18.07., user-gewichtet).
  App-weit genau **1 ANR** im Fenster (1214, 17.07., `MessageQueue.nativePollOnce`).
- **1222-Crashes nach Gerät:** 3 Crashes = 3 verschiedene Modelle/API-Level
  (Xiaomi 14T Pro/API 36, Galaxy S10+/API 31, Galaxy A13/API 34) — keine
  Gerätekonzentration, Low-End bis Flagship.
- **1218 zum Vergleich:** 7/7 Reports auf Samsung, stark Low-End-lastig
  (A13, M11, A50, Tab A 2016, A16, Tab A9+, A33).
- Dimension-Slices 1222 (18.07.): API 36 = 1,56 % (60 N.), Brand samsung =
  1,61 % (60 N.). `deviceModel`-Slices liegen komplett unter Googles
  Privacy-Schwelle (0 Zeilen) — bei dieser Nutzerbasis keine Modell-Auflösung
  über die Metrics-API; die Modelle kommen aus `errorReports:search`.

---

## 7. Ehrliche Bilanz der drei 6.0.11-Fixes

| Fix | Ziel-Crash | Status nach Datenlage |
|---|---|---|
| Kotlin-Boot-Guard (`MainApplication.kt`) | SoLoader/DSONotFound-Boot-Crashes | Kein solcher Crash auf 1222 beobachtet (war aber auch vorher selten) — unauffällig, kein Schaden |
| Lottie `renderMode="SOFTWARE"` (Onboarding) | Onboarding-SIGSEGV-Hypothese | Kein Onboarding-Crash auf 1222 — unauffällig, kein Schaden |
| AdMob-Banner-try/catch (patch-package) | Banner-`initAdView`-Crashes | Greift NICHT für den echten Top-Crash `561a7ca7` (TurboModule-Init, nicht Banner-View) — **A13-Klasse besteht fort**, siehe §5 |

Keiner der drei Fixes hat messbar geschadet; der AdMob-Patch adressiert aber
nachweislich nicht die Haupt-Crash-Ursache der Low-End-Geräte.

---

## 8. Empfehlungen (aktualisiert nach §9)

1. **Kein Rollback.** Die 2,30 % sind ein Ein-Tages-/Kleinbasis-Artefakt;
   6.0.11 hat absolut die wenigsten Crashes (3) und 0 ANRs.
2. **RN 0.79.5 → 0.79.6 (besser gleich 0.79.7) bumpen** — eliminiert per
   Upstream-Fix den größten Crash-Cluster der App (`561a7ca7`, §9.1).
   Expo SDK 53 pinnt selbst 0.79.6 → `npx expo install --fix` ist der
   offizielle Weg. Native Änderung ⇒ neuer EAS-Build nötig.
3. **Im selben Build: Crashlytics-Symbol-Upload reaktivieren**
   (`apply plugin: 'com.google.firebase.crashlytics'` VOR den `android{}`-Block
   ziehen — das war der 1221-Build-Fehler).
4. **Re-Messung ~22.–23.07.** der 6.0.11-Rate (Erwartung: ≤1 %, analog
   1218: 1,59 % → 0,49 %); nach dem RN-Bump-Release dann Verifikation, dass
   `561a7ca7` auf der neuen versionCode verschwindet.
5. **Optional, zweiter Schritt:** Reanimated 3.17.4 → 3.19.5 gegen die
   `handleNodeRemovals`-Signatur (§9.3) — verlässt die Expo-Pin-Range,
   ist aber offiziell RN-0.79-kompatibel. Getrennt vom RN-Bump ausrollen,
   um Effekte zuordnen zu können.
6. **Kein armeabi_v7a-Drop, kein Geräte-Ausschluss** — unnötig, da der Fix
   billiger ist und die Community diesen Weg praktisch nie gegangen ist (§9.4).

---

## 9. Upstream-Recherche (20.07.2026) — Root-Cause, Fix-Versionen, Erfahrungswerte

Multi-Agent-Web-Recherche mit adversarialer Verifikation: **54 Quellen-Checks,
alle Kernaussagen an der geöffneten Primärquelle bestätigt** (GitHub-Issues/PRs/
Commits/Release-Notes/Raw-Source, teils per GitHub-API gegengeprüft).

### 9.1 `561a7ca7` (AdMob-TurboModule, 32-bit) = bekannter RN-Core-Bug, gefixt in 0.79.6

**Root-Cause (Meta-bestätigt):** `JavaTurboModule::setEventEmitterCallback`
nutzte den **variadischen JNI-Call `CallVoidMethod`** — auf 32-bit-ABIs werden
Argumente ungeprüft über den Stack übergeben; bei Typ-/Alignment-Differenz
liest JNI falschen Speicher → SIGSEGV (auf altem/strict ART stattdessen
CheckJNI-Abort „invalid jobject" = unsere `f43e7a87`-SIGABRT-Schwester).

- **Bug-Issue:** [facebook/react-native#51628](https://github.com/facebook/react-native/issues/51628)
  — „App Crashes on Android 32bit When emit event from TurboModule";
  reproduzierbar **nur auf 32-bit-Geräten, nur in signierten Release-Builds**
  (erklärt, warum wir es lokal nie sahen). Closed „Resolution: Fixed".
- **Fix:** [PR #51695](https://github.com/facebook/react-native/pull/51695) /
  Commit [`43bc43e`](https://github.com/facebook/react-native/commit/43bc43e5e85519d2924c4fc80765e66d0c48b1a9)
  (merged 02.06.2025): `CallVoidMethod` → **`CallVoidMethodA`** mit explizitem
  jvalue-Array (+ `instance_.get()`). Diff selbst gelesen — geänderte Funktion
  IST `setEventEmitterCallback`.
- **Released in RN 0.79.6** (14.08.2025, [Release-Notes](https://github.com/facebook/react-native/releases/tag/v0.79.6):
  „TurboModule: Fix emitting event from turbo module crashes on 32bit android").
  Per GitHub-Compare-API dreifach verifiziert: **0.79.5 = ohne Fix (letzte
  betroffene Version), 0.79.6 = mit Fix.** Ebenso in 0.80.1+ und 0.81+ (SDK 54).
  Ein zweiter, älterer arm32-Fix an derselben Stelle
  ([PR #50592](https://github.com/facebook/react-native/pull/50592), in 0.80.0)
  wurde von Meta nicht nach 0.79 zurückportiert; die Community-Bestätigungen
  unten zeigen aber, dass 0.79.6 für diese Crash-Klasse in der Praxis reicht.
- **Exakt unser Modul + Gerät ist dokumentiert:**
  [invertase/react-native-google-mobile-ads#754](https://github.com/invertase/react-native-google-mobile-ads/issues/754)
  — identischer Stack (`NativeGoogleMobileAdsNativeModuleSpecJSI` →
  `setEventEmitterCallback`, armeabi_v7a-Split), explizit **Samsung Galaxy A13**.
  Maintainer schloss es als Upstream-RN-Bug. Mehrere unabhängige Bestätigungen,
  dass der 0.79.6-Bump die Crashes beendet — einer **von exakt 0.79.5**:
  > „I had react-native 0.79.5 (bad luck mine...) and after upgrading to
  > react-native 0.79.6 …" (carlosmellado, 25.09.2025)
- **Modul-agnostisch bewiesen:**
  [stripe/stripe-react-native#2091](https://github.com/stripe/stripe-react-native/issues/2091)
  — gleicher Crash, gleiches Gerät (A13), anderes Modul. Jedes Codegen-
  TurboModule mit EventEmitters im Spec triggert ihn; AdMob ist bei uns nur
  das prominenteste, weil es früh im Boot lädt. **Ein AdMob-Lib-Update
  (15.8.0 → 16.x) bringt für diesen Crash nichts** (Changelogs 15.8.x–16.4.0
  lückenlos geprüft: kein entsprechender Fix — der Hebel ist die RN-Version).
- **Warum der Galaxy A13 überhaupt 32-bit läuft:** Exynos 850 ist arm64-fähig,
  aber Googles eigene [Android-12-CDD §7.6.1](https://source.android.com/docs/compatibility/12/android-12-cdd)
  empfiehlt Herstellern bei 2–<4 GB RAM ausdrücklich reinen 32-bit-Userspace
  („STRONGLY RECOMMENDED to support only 32-bit userspace") → Play liefert
  diesen Geräten den armeabi_v7a-Split. Betrifft also aktuelle Budget-Geräte,
  nicht nur Uralt-Hardware.
- **Wichtig für die Umsetzung:** Der Fix liegt in C++ (`libreactnative.so`,
  prebuilt Maven-Artefakt) — **nicht per patch-package nachrüstbar**; nur der
  Versions-Bump zieht das gefixte native Artefakt. Expo SDK 53 pinnt in
  `bundledNativeModules.json` inzwischen selbst `react-native: 0.79.6` →
  `npx expo install --fix` ist der offizielle, minimal-invasive Weg (kein
  SDK-Wechsel, Reanimated bleibt). **0.79.7** (letzte 0.79.x) enthält
  zusätzlich nur noch einen Fabric-Fix („Make missing parent view state in
  updateLayout a soft error") — sinnvoller Endpunkt des Patch-Bumps.

### 9.2 `4783a8f4` (Fabric „Unable to find viewState for tag") = ecosystem-weit, echter Fix erst RN 0.86

- In RN 0.79.5 im Framework-Source hart verdrahtet (Raw-Source der Tags
  geprüft): `addViewAt` → werfendes `getViewState()`; die „Retryable"-Exception
  wird im Batch-Mount-Pfad **nicht** retried.
- Meta selbst maß **~44 700 Crashes / 14 600 Nutzer in 30 Tagen** an dieser
  Signatur und fixte sie per
  [PR #56389](https://github.com/facebook/react-native/pull/56389)
  (Crash → Soft-Exception, merged 10.04.2026) — **erstmals released in
  RN 0.86.0** (Source-Diff 0.85→0.86 verifiziert). Auch RN 0.81 (= Expo
  SDK 54) hat die Signatur noch ([#53916](https://github.com/facebook/react-native/issues/53916)).
- Konsequenz für uns: bleibt bis zu einem künftigen Expo-SDK (RN ≥0.86)
  niedrigvolumig bestehen — bei uns 2–3 Nutzer/Woche, geräteübergreifend.
  0.79.7 entschärft immerhin die verwandte `updateLayout`-Stelle.
  Erwartungsmanagement fürs Monitoring, kein akuter Handlungsbedarf.

### 9.3 Reanimated `handleNodeRemovals` (nur 6.0.8 gesehen) = gefixt in Reanimated 3.19.1

- [software-mansion/react-native-reanimated#8001](https://github.com/software-mansion/react-native-reanimated/issues/8001):
  Thread-Race auf der `removableShadowNodes_`-Map (JS-Thread mutiert während
  der Fabric-Mount-Hook iteriert → Use-after-free in `getFamily()`). Kein
  32-bit-Thema — passt zu unserem arm64-Auftreten.
- Fix [PR #8005](https://github.com/software-mansion/react-native-reanimated/pull/8005)
  (Locking), **released in 3.19.1**; Produktions-Bestätigung des Reporters
  per Sentry über große Android-Audience („all those pesky handleNodeRemovals
  crashes" weg). Code-verifiziert an den Tags: 3.17.4/3.17.5/3.18.2 ungefixt,
  3.19.1–3.19.5 gefixt. Expo 53 pinnt `~3.17.4` — Bump auf 3.19.5 verlässt
  die Pin-Range, ist laut offizieller Kompatibilitätstabelle aber
  RN-0.79/Fabric-supported und läuft nachweislich auf exakt unserer Kombo.

### 9.4 Was andere Teams mit diesen Geräten machen (Community-Reihenfolge)

Aus den Threads (#51628, #754): **Version bumpen > patchen (Build-from-source)
> New Arch deaktivieren > Geräte-Gating zur Laufzeit.** Ein armeabi_v7a-Drop
kam als Antwort auf diesen Bug praktisch nicht vor (ein Team nahm 32-bit
sogar explizit wieder rein). Fakten dazu:
- arm64-only-AAB ⇒ 32-bit-Userspace-Geräte sehen die App im Store schlicht
  nicht mehr (still unsichtbar, Bestandsnutzer ohne Updates) — bei unserer
  Budget-Geräte-Zielgruppe (Cashback!) die falsche Richtung; 32-bit-Anteil
  2025 je nach Zielgruppe grob ~10 %.
- Play Console kann einzelne Modelle/SoCs ausschließen (Device catalog →
  Exclude) — chirurgische Notbremse, hier unnötig.
- Warnung aus rnmapbox/maps#3913: einzelne native Libs können eigene
  arm32-Bugs unter Fabric haben → nach dem RN-Bump den armeabi_v7a-Split
  einmal gezielt testen (`adb install --abi armeabi-v7a` auf arm64-Gerät
  bzw. 32-bit-Testgerät).

### 9.5 Verifikations-Notizen (Abweichungen der Erst-Recherche)

Bei der adversarialen Prüfung flogen 4 von 54 Behauptungen raus bzw. wurden
korrigiert — keine betrifft die Kernaussagen: expo/expo#37350 ist inzwischen
stale-closed (nicht „offen"); eine Workaround-Attribution (User toy0605) war
falsch zugeordnet; der v16.3.1-Ads-Fix ist iOS-only (nicht Android);
rnmapbox#3913-Detailangaben teilkorrigiert. Der Rest: quellenbestätigt.

## Anhang A — Reproduzierbare Abfragen

Helper: [`scripts/play-vitals/play_api.py`](../scripts/play-vitals/play_api.py)
(JWT aus Service-Account, Token-Cache, Retry bei 503).

```bash
# Top-Issues einer Version (GET!):
python3 scripts/play-vitals/play_api.py get 'errorIssues:search?filter=versionCode%20%3D%201222&interval.startTime.year=2026&interval.startTime.month=7&interval.startTime.day=10&interval.endTime.year=2026&interval.endTime.month=7&interval.endTime.day=19&pageSize=50&orderBy=distinctUsers%20desc'

# Einzel-Reports mit Stacktrace/Tombstone + Gerät:
python3 scripts/play-vitals/play_api.py get 'errorReports:search?filter=versionCode%20%3D%201222&interval.startTime.year=2026&...&pageSize=50'

# Tages-Crash-Rate (POST; timeZone ist PFLICHT, sonst still leer!):
python3 scripts/play-vitals/play_api.py post 'crashRateMetricSet:query' '{"metrics":["userPerceivedCrashRate","distinctUsers"],"dimensions":["versionCode"],"timelineSpec":{"aggregationPeriod":"DAILY","startTime":{"year":2026,"month":7,"day":1,"timeZone":{"id":"America/Los_Angeles"}},"endTime":{"year":2026,"month":7,"day":19,"timeZone":{"id":"America/Los_Angeles"}}}}'
```

## Anhang B — API-Fallen (je eine Fehlrunde gekostet)

1. **`errorIssues:search`/`errorReports:search` sind GET** mit URL-Query-Params
   (Filter URL-encoded). Ein POST liefert eine generische **404-HTML-Seite** —
   sieht aus wie „Endpoint nicht freigeschaltet", ist aber nur die falsche
   HTTP-Methode.
2. **DAILY-Metric-Queries ohne `timeZone {id:"America/Los_Angeles"}`** in
   start/endTime liefern **stillschweigend `{}`** (kein Fehler!).
3. **`FULL_RANGE` existiert nicht** für crashRate/anrRate-MetricSets (nur
   HOURLY/DAILY) → selbst aggregieren.
4. **`errorCountMetricSet` verlangt die Dimension `reportType`** (CRASH/ANR).
5. **`firstAppVersion`/`lastAppVersion` sind intervall-/filterbezogen** —
   für „seit wann existiert dieser Crash?" immer ungefiltert + langes Fenster.
6. `distinctUsers` sind gerundet (50/60/90/100/200/…); `errorReports` sind
   **Samples**, nicht 1:1 alle Events (67 Reports gezählt, 4 Samples abrufbar).
7. Endzeitpunkt nie später als die Freshness setzen (400 „end_date should be
   at most …"); GA4-BigQuery-Export enthält **keine** `app_exception`-Events
   (nur Custom-Events) und taugt nicht als Crash-Quelle; Crashlytics-BigQuery-
   Export ist nicht aktiviert.
