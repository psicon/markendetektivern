# Project notes for Claude Code

## Meta-Regel: "merk dir das" → SOFORT in CLAUDE.md

Wenn der User sagt **"merk dir das"**, **"schreib dir das auf"**,
**"mark this down"**, **"speicher dir das"**, oder etwas
sinngemäßes ("du verlierst immer den Kontext", "behalt das"…),
dann ist das eine **direkte Anweisung an dieses File**.

Was tun:
1. Sofort an passender Stelle in `/Users/patricksieber/Documents/src/markendetektivern/CLAUDE.md`
   eine Notiz dazu hinzufügen (eigene Section oder unter
   passendem bestehenden Abschnitt).
2. Konkret + actionable formulieren — nicht "User mag X", sondern
   "tu Y, nicht Z, weil W".
3. Mit committen (`git add CLAUDE.md && git commit`) im selben
   Schwung wie die andere Arbeit, oder als eigener Commit.

**Nicht** auf den nächsten Turn verschieben, **nicht** im
Conversation-Memory parken. Conversation-Memory ist flüchtig,
CLAUDE.md ist persistent über Sessions hinweg.

Diese Regel gilt für jede zukünftige Erinnerungs-Aufforderung.
Wenn unklar ist, wo das hin soll, lieber unter ein neues Heading
am Ende von CLAUDE.md legen als gar nicht.

## Meta-Regel: Sichere Learnings aus Fehlern → SOFORT in CLAUDE.md

Komplement zur "merk dir das"-Regel: User-getriggert vs. selbst-
getriggert. Wenn aus einem Fehler eine **klare, übertragbare
Erkenntnis** entsteht (technische Limitierung verstanden, Pattern
hat reproduzierbar gefailt, Architektur-Entscheidung nach 2× in
dieselbe Falle laufen) → sofort als "Forbidden Pattern" oder
Design-Rule eintragen, im selben Commit wie der Fix. Format:
"tu Y, nicht Z, weil W". NICHT für Preferences ("User mag X
anders") oder Spekulation ("vielleicht wäre Y besser").

## Nutrition-Scraper: NIEMALS Name-Search, NUR EAN

Für die Cloud-Function `nutrition-scraper` (alle Endpoints +
Resolver + Serper-Queries) gilt: **Suche IMMER per GTIN (EAN),
NIEMALS per Produkt-Name**. User-Vorgabe 2026-05-17, mehrfach
bestätigt.

Begründung:
- Name-Search liefert Random-Treffer von ähnlich-genannten
  Produkten anderer Hersteller → Claude extrahiert falsche Daten
  → DB wird kontaminiert.
- EAN ist global-eindeutig → Treffer ist garantiert dasselbe
  Produkt (oder kein Treffer → safe skip).
- Audit hat gezeigt: bei EAN-Search liefert Google für die meisten
  unserer Produkte die echten Shop-Detail-Pages (myTime, Globus,
  etc.) → ist NICHT die Limitierung. Limitierung früherer Tests
  war: Stichprobe zu ALDI-Eigenmarken-lastig (4061464*, 4056489*,
  4337256* — werden NUR bei ALDI verkauft, daher wenig Shop-Coverage).

Was tun:
- Wenn ein Shop nicht über EAN findbar ist → Shop aus Liste raus,
  NICHT auf Name-Search ausweichen.
- Falls neue Source-Adapter (z.B. shop-spezifischer Crawler)
  hinzukommen: input-Parameter MUSS EAN sein, fail-fast wenn nicht
  vorhanden.

## EAN-Storage: `EANs[]` (Array) ist die Source of Truth

Auf `produkte/*` und `markenProdukte/*` ist **`EANs: string[]`** das
kanonische EAN-Feld. Reale Daten tragen NUR `EANs[]` — KEIN singuläres
`EAN: string`. Das TypeScript-Interface (`lib/types/firestore.ts`)
deklariert zwar ein Legacy-`EAN: string`, aber das ist NICHT die
Daten-Konvention. **Niemals dem Type/dem Graph blind trauen — gegen
echte Daten gegenchecken.** (Mai 2026: einmal `EAN: gtin` in Promotion-
Docs reingeschrieben weil der Type es hatte → wieder rausgenommen, weil
reale Docs es nicht nutzen.)

Was tun:
- **Schreiben** (Promotion, Backfill, neue Produkte): NUR `EANs: [gtin]`
  setzen. Kein singuläres `EAN`.
- **Lesen**: über `extractEans(product)` gehen — der merged defensiv
  `EAN, ean, gtin, GTIN` + `EANs[]` + `eans[]` + `moreInformation.EAN`,
  dedupt, filtert auf ≥8 Zeichen. So sind Altdaten mit Legacy-Singles
  abgedeckt OHNE dass neuer Code singuläre Felder schreiben muss.
- Alle Pipelines greifen bereits auf `EANs[]` zu: nutrition-scraper
  (openfood/serper-Suche), nutrition-backfill, receipt-matcher
  (`buildMeta` liest `EANs[0]`), App-Nährwerte. EAN-Suche (Scraper/
  openfood) iteriert ALLE Einträge aus `EANs[]`.
- **Drift-Warnung:** `extractEans` existiert 3× kopiert
  (`lib/utils/productNutrition.ts`, `cloud-functions/nutrition-backfill`,
  `cloud-functions/nutrition-scraper` inline). Wenn die Logik geändert
  werden muss → alle 3 nachziehen, oder zu einem geteilten Helper
  refactoren.

## Meta-Regel: ClickUp-Tasks immer kommentieren + 'In Review' setzen

Wenn ich an einem ClickUp-Task arbeite (egal ob Bug, Feature,
Bug-Fix, Refactor, etc.):

1. **Kommentar im Task pflicht** — direkt nach dem Commit/Push,
   im ClickUp-Task einen Comment hinterlassen mit:
   - was kurz war das Problem
   - was hab ich konkret geändert (Commit-Hash + Pfade)
   - Edge-Cases / Begründungen / wichtige Trade-offs
   Format: technisch + actionable, kein Marketing-Speech. Reader
   ist der User oder ein Future-Me.

2. **Status auf 'In Review' setzen** wenn ich überzeugt bin, dass
   der Task aus meiner Sicht erledigt ist. Status-Wert: `in review`
   (ClickUp-API normalisiert lowercase). NICHT auf 'done' / 'closed'
   selbst setzen — das ist User-Entscheidung nach manueller Prüfung.

3. **Wenn unsicher**: Comment hinterlassen + Status NICHT ändern.
   Der User entscheidet dann ob's reicht.

Tool: `mcp__…__clickup_create_task_comment` für 1, `clickup_update_task`
mit `status: 'in review'` für 2.

## Meta-Regel: User-Wortlaut zweimal lesen, nicht "vereinfachen"

"Selbes Aussehen, aber X" = alles bleibt, ändere NUR X. Keine
eigene Interpretation ("naja, ohne Pille macht raised Button
keinen Sinn → wegnehmen") — das endet in Cancel-Loops. Bei
Unklarheit kurz fragen. Bei Vergleichen ("warum ist X auf Home
anders als Stöbern?") **nicht** raten welche Seite gewinnt — beide
Optionen anbieten oder fragen.

## Meta-Regel: Best Practices — IMMER, ohne Ausnahme

Wir entwickeln **immer nach Best Practices**. Das ist keine
optionale Verbesserung, das ist die Baseline. Wenn ein Pattern
schmerzhaft ist (State-Race, dead code, copy-paste) → fix it,
nicht workaround it.

Konkretes Mindest-Set für jede neue/geänderte Datei:

### Architektur
- **Single Source of Truth pro Domain.** Status der App lebt
  an EINER Stelle (Service, Context, oder Reducer). Wenn ein
  AsyncStorage-Key an >1 Stelle direkt geschrieben wird, ist das
  ein Bug — wickle ihn in einen Service.
- **No dead code.** Bevor du was Neues schreibst: check ob's
  schon existiert. Wenn alter Code (Provider, Service-Methode,
  Komponente) nicht mehr genutzt wird → löschen, nicht parallel
  einen zweiten Pfad aufbauen.
- **State-Race verhindern** (nicht reparieren). Wenn zwei
  setState-Calls im selben Tick + danach ein Read passieren → 
  benutze `useReducer` mit atomaren Updates ODER refactore zu
  einem einzigen state-Objekt. Workaround-Parameter wie
  `overrideXyz` durch drei Funktionen reichen = code smell.
- **Komponenten < 400 Zeilen.** Wenn eine Datei größer wird,
  ist das ein Signal das mehrere Verantwortlichkeiten drin
  stecken. Split: pro Step/Section eigene Komponente, gemeinsamer
  Provider/Context für Daten, dünner Container der orchestriert.
- **Hooks-Regel ist nicht verhandelbar.** Niemals "ALLE useState
  IMMER (keine conditionals!)" als Kommentar — das ist die
  Hooks-Rule, kein Workaround. Wenn du das hinschreibst, ist
  der File zu groß und braucht Refactoring.

### State-Persistenz (Onboarding/Auth/etc.)
- **Storage-Keys NIE direkt schreiben.** Immer durch Service-
  Methode wickeln. Wenn ein Test/Debug-Screen den Key resetten
  will → benutze die `reset*`-Methode des Service. Beispiel:
  `OnboardingService.markCompleted()`, nicht
  `AsyncStorage.setItem('onboarding_v1_completed', 'true')`.
- **Status-Transitionen sind atomar.** Wenn `state=completed`
  bedeutet "User hat Onboarding fertig + Daten in Firestore",
  dann muss der Flag erst gesetzt werden NACHDEM Firestore-Write
  succeeded ist. Andernfalls: User killt App nach Storage-Set
  aber vor Firestore-Write → Onboarding ist "fertig" aber Daten
  fehlen.
- **Semantik der Flags klar trennen.** `completed` ≠ `skipped`
  ≠ `abandoned`. Wenn `hasPassedX()` über zwei Flags ODER-verknüpft,
  ist das ein Hinweis dass das Statussystem unterspezifiziert ist.
  Verwende einen Enum-State (`'pending' | 'in_progress' |
  'completed' | 'skipped'`), nicht zwei Booleans.
- **Resume-State funktionert oder existiert nicht.**
  `saveProgress`/`loadProgress` als Methoden zu haben ohne sie
  jemals aufzurufen ist schlimmer als sie gar nicht zu haben —
  weil's so aussieht als ob's geht. Entweder Resume integrieren
  ODER die Methoden löschen.

### Navigation / Flow
- **Pro Auth/Onboarding-Übergang: GENAU EINE Funktion** die
  alle Side-Effects orchestriert (Firestore-Save, Storage-Flag,
  Premium-Refresh, Route). Keine 3 parallelen Pfade
  (completeOnboarding / completeOnboardingForAuth / skipOnboarding)
  die nur 80% denselben Code teilen — wenn 80% gleich, dann
  refactor zu 1 Funktion mit Parameter.
- **`router.back()` muss immer einen sinnvollen Ziel-State
  haben.** Wenn ein Screen via `router.replace` betreten wurde,
  ist `router.back()` ein No-op oder springt aus der App raus.
  Wenn User den Back-Button sehen darf, dann `router.push` als
  Übergang — sonst Back-Button ausblenden.
- **Auth-Pfad muss alle vorgelagerten Flags setzen.**
  Wenn User durchs Onboarding zu /auth/welcome geleitet wird,
  muss DORT `markOnboardingCompleted` triggern (in jedem Sign-In-
  Handler), nicht im vorherigen Screen — sonst Re-Start-Bug.

### Code-Hygiene
- **Statische Imports oben im File.** Außer wenn ein konkretes
  Performance-/Lazy-Load-Argument greift (Code-Splitting), keine
  `await import(...)` in async-Funktionen. Insbesondere NICHT
  denselben Modul-Pfad an 5 Stellen lazy importieren.
- **Imports aufräumen.** Ungenutzte Imports sind ein Signal dass
  der File geschrumpft ist ohne dass jemand nachgezogen hat.
  Beim Editieren mit-aufräumen.
- **Error-Handling konsistent pro Funktion.** Entweder die
  Funktion ist robust (catch + recover) ODER sie wirft (caller
  fängt). Kein Mix aus "stillen warns" + "Alert.alert" + "kein
  Catch" in derselben Funktion.

Wenn du eine bestehende Datei berührst und siehst dass sie diese
Regeln verletzt → **flag es dem User**, fix es nicht heimlich
mit. Aber das was du SELBER schreibst hält sich an die Regeln.

## Forbidden Patterns

Dinge die mindestens einmal teuer waren und nicht neu probiert
werden sollten. Andere "Don't"-Regeln stehen verteilt im File
(siehe `await import('react-native')`, `persistentLocalCache`,
`USE_FLYING_TABS`-Legacy etc.) — hier nur die Learnings aus
Recent-Sessions.

- **Upload-Bilder (Bon + Produkt) komprimieren/runterskalieren VOR dem Upload.**
  Die Cloud-Pipelines brauchen VOLLE Bildqualität für die Analyse: OCR von
  Nährwert-/Zutaten-Labels, Bon-Text-Erkennung, Produkt-Identifikation,
  EAN-Lesbarkeit. Ein verkleinertes/stark JPEG-komprimiertes Bild macht kleine
  Schrift unleserlich → OCR/Extraktion failt. `prepareForUpload`
  (`lib/utils/cashbackImage.ts`) ist BEWUSST ein Pass-Through;
  `expo-image-manipulator` NICHT zum Verkleinern vor Upload einsetzen — weder
  für Produktfotos (`uploadProductImage`/`uploadQueue`) noch für Bons
  (`uploadBonImage`). User-Vorgabe 2026-06: "volle qualität für die analyse,
  egal ob bon oder produkt". Storage-Kosten sind sekundär; falls nötig
  server-seitig NACH der Analyse archivieren/verkleinern, NIE client-seitig vor
  Upload.

- **Firestore-Write (`setDoc`/`addDoc`/`updateDoc`) im kritischen UI-Pfad
  awaiten.** Die Promise löst erst bei SERVER-Ack auf — **offline hängt sie
  ewig** (der lokale Cache wird optimistisch geupdatet, aber `await` blockt bis
  Reconnect). Symptom: Flugmodus → Submit-Button-Spinner hängt für immer (war
  genau so bei `cashback/review.tsx handleSubmit` → `await createPendingMirror`).
  Regel: **optimistische / Mirror-/Placeholder-Writes fire-and-forget**
  (`void setDoc(...).catch(...)`), der lokale State + der `onSnapshot`-Listener
  (feuert offline sofort aus dem Cache) treiben die UI, und **sofort
  navigieren** statt auf den Write zu warten. Nur das eigentliche Netz-Werk
  (Storage-Upload, Callable/HTTPS-CF) wird versucht und failt offline sauber →
  Error-State + Auto-Resume bei Reconnect (NetInfo). Lokalen Error-State IMMER
  vor einem etwaigen abschließenden Mirror-Write setzen (Z. „setUploadStep
  ('error')" vor „setPendingMirrorError"). Juni 2026.

- **Time-based Debouncing für "wait for async transition to complete"** —
  Wenn ein React-State-Wechsel ein async-Side-Effect-Window hat
  (z.B. `signOut()` → kurze Null-User-Phase → `signInAnonymously()`),
  NICHT mit `setTimeout(action, 600)` werkeln. Stattdessen einen
  expliziten `isXxxing: boolean`-State im Context als Guard nehmen:
  `setIsLoggingOut(true)` am Anfang von `logout()`, `setIsLoggingOut(false)`
  im `finally`. Konsumenten checken `if (isLoggingOut) return;` BEVOR
  sie auf den transienten Null-State reagieren. Deterministisch, kein
  Timing-Glücksspiel. Beispiel: Tabs-Layout-Escape-Hatch zu
  `/auth/welcome` (siehe `app/(tabs)/_layout.tsx` T17.14).

- **Fire-and-forget `void asyncStorageWrite(...)` direkt vor
  `setVisible(false)`/`setState`** — Race-Garantie. Wenn ein Listener
  auf das State-Change wartet und dann den just-geschriebenen Wert
  liest, kommt der Schreib oft NICHT rechtzeitig durch. Repro:
  Coachmark-`dismiss()` mit `setVisible(false); void markSeen(tour)` →
  Demographics-Sheet-Effect feuert sofort wegen visible-Flip, fragt
  `getSeen('home')` → kriegt noch `false` → Sheet wird nie gezeigt.
  Fix: `await CoachmarkService.markSeen(tour); setVisible(false)` —
  Storage erst persistieren, DANN das Signal flippen das Listener
  weckt. 50ms UX-Cost, race weg. Siehe `hooks/useCoachmark.ts`
  T17.14.

- **Meta-App-Auth-Toggles auf "im Client eingebettet" / "Native oder
  Desktop-App".** In Meta-Dashboard → App-Einstellungen → Erweitert →
  "App-Authentifizierung". Wenn EINER dieser Toggles AN ist, schaltet
  Meta die Server-Side-Operations auf dem App-Secret ab. Konsequenz:
  Firebase-Backend's `debug_token`-Call (Teil von `signInWithIdp` für
  Facebook-Provider) failt mit
  `(#100) "You must provide an app access token, or a user access
  token that is an owner or developer of the app"` → Firebase
  retourniert generisches `auth/invalid-credential`, RNFirebase
  maskiert die echte Server-Antwort, Symptom: jeder FB-Login bricht
  ab, egal ob nativer FB-SDK oder Browser-OAuth, egal ob App-ID +
  Secret in Firebase Console korrekt sind. Diagnostik: direkter
  REST-Call zu `identitytoolkit.googleapis.com/v1/accounts:signInWithIdp`
  zeigt die echte `INVALID_IDP_RESPONSE`-Message. Fix:
  **BEIDE Toggles AUS** ("Native oder Desktop-App?" + "Ist der
  App-Geheimcode im Client eingebettet?"). Erst dann darf Firebase
  den Secret server-side verwenden. Wir embed'den den Secret nicht in
  der App; er liegt nur in Firebase Console — die Meta-Settings müssen
  das reflektieren. T17.19 (Mai 2026), nach 3 Tagen Debugging.

- **`BlurView` mit `experimentalBlurMethod="dimezisBlurView"` auf
  Android.** Triggert Surface-Stops / Grey-Screens (Fabric).
  Nur in iOS-Branches verwenden. Für Android-Blur-Look → tinted
  View mit 0.92 Alpha (siehe Header-Pattern).
- **Skia `BackdropBlur` als RN-Backdrop.**
  `@shopify/react-native-skia` 2.6.x sampled nur Skia-Canvas-
  internen Content (`saveLayer` mit kBackdrop-Flag), NICHT RN-
  Views unter dem Canvas. Nicht als BlurView-Ersatz versuchen —
  der Effekt bleibt unsichtbar.
- **Boot-Pfad künstliche Delays.**
  `await new Promise(setTimeout)` oder ähnlich in `app/_layout.tsx`,
  `app/index.tsx`, `FontLoader` → Android-Whitescreen, weil
  Custom-`<SplashScreen>`-Overlay nur iOS mountet. Native splash
  covered den echten Boot. Deferred work → `InteractionManager.
  runAfterInteractions(...)`.
- **Mehrere ScrollViews mit `scrollsToTop=true` gleichzeitig aktiv** —
  iOS blockiert den Status-Bar-Tap (Batterie-Ecke = scroll-to-top)
  KOMPLETT wenn >1 sichtbares UIScrollView den Default
  `scrollsToTop=true` trägt. Kein Fallback, kein "erster gewinnt".
  In einer Tab-App (`(tabs)/*.tsx`) sind nach dem ersten Besuch ALLE
  Tab-Screens gemountet (Expo-Router lazy + freezeOnBlur ist nur
  visuell pausiert) → jeder Root-ScrollView lebt im UIKit-Tree.
  Lösung: pro Tab-Screen `useIsFocused()` aus `@react-navigation/
  native` als Gate auf den Root-ScrollView: `scrollsToTop={isFocused}`.
  Bei Tab-internen Sub-Pages (Stöbern's 3 PagerView-Listen) noch
  `&& tab === 'X'` kombinieren. So ist garantiert genau EIN
  UIScrollView aktiv.
  Plus: für Listen-Wrapper wie `LegendList` zusätzlich
  `renderScrollComponent={plainScrollComponent}` setzen damit iOS
  das native UIScrollView (statt Animated.ScrollView) sauber
  detect'tet — sonst greift `scrollsToTop` auf Lib-Ebene gar nicht.

- **Android + `fontFamily` + `fontWeight` mit custom fonts.**
  React Native + Android wendet `fontWeight` NICHT auf custom Fonts
  an. `{ fontFamily: 'Nunito', fontWeight: '700' }` schickt Android
  auf die Suche nach einer Font NAMENS "Nunito", findet keine
  (weil nur `Nunito_400Regular`, `Nunito_500Medium`,
  `Nunito_600SemiBold`, `Nunito_700Bold` via
  `@expo-google-fonts/nunito` geladen sind) und fällt KOMMENTARLOS
  auf System-Default zurück. iOS dagegen resolvet das nativ
  korrekt — der Bug bleibt also lokal auf Android. Auf iOS-Devices
  sieht alles richtig aus, auf Android renderten dann ~440 Callsites
  (alle die `{ fontFamily, fontWeight: fontWeight.X }` aus
  `@/constants/tokens` nutzen) in System-Sans-Serif statt Nunito.
  Lösung: `lib/utils/androidTextFontPatch.ts` als Side-effect-Import
  in `app/_layout.tsx` ganz oben. Patcht `Text.render` und
  `TextInput.render` auf Android — wenn `fontFamily === 'Nunito'`,
  resolvet zur expliziten Nunito_XXX Variante gemäß fontWeight.
  Separat: in `constants/tokens/typography.ts` gibt's
  `fontFamilyVariants.{regular,medium,semibold,bold,heading,body}`
  und `nunitoFont(weight)` für Code der direkt die explizite
  Variante setzen will (SVG-Text, Skia-Text, andere Stellen die
  nicht durchs Text-Render gehen). NIE wieder
  `{ fontFamily: 'Nunito', fontWeight: X }` einführen ohne sich
  sicher zu sein dass entweder der Patch greift ODER die explizite
  Variante gesetzt ist.

- **KVC `setValue:forKey:` auf undokumentierte iOS-Properties.**
  Im Mai 2026 versucht `VNDocumentCameraViewController.setValue(false,
  forKey: "autoScansEnabled")` einzubauen um Apple's Auto-Shutter
  abzuschalten. Resultat: harter Crash mit `NSUnknownKeyException` —
  die Property ist nicht KVC-compliant deklariert. KVC ist NICHT
  silent fallback, das war Wunschdenken. Apple's private/internal
  Properties sind nicht via KVC erreichbar es sei denn die Klasse
  opted explizit ein. Grundregel: kein KVC-Hack auf iOS-Properties
  die nicht im public Header stehen. Wenn Auto-Shutter o.ä. wirklich
  nötig wäre → eigener Camera-Stack mit `VNDetectRectanglesRequest`,
  nicht KVC-Trickserei.

- **`firebase deploy --only firestore:indexes` wenn `firestore.indexes.json`
  NICHT die Source-of-Truth ist.** In diesem Projekt werden Indizes über die
  Firebase-Console + eine **Staging-DB** (`default-staging`) verwaltet, nicht
  im lokalen File. Das committete `firestore.indexes.json` hatte nur 1 Index.
  Ein `deploy --only firestore:indexes --force` hat daraufhin **75 produktive
  Composite-Indizes auf `(default)` gelöscht** (alles was nicht im File stand) —
  `--force` bestätigt die Löschung ohne Rückfrage. Recovery war nur möglich, weil
  die Staging-DB die Indizes noch hatte:
  `firebase firestore:indexes --database default-staging` exportiert sie im
  exakten File-Format → mergen → wiederherstellen. Regeln:
  (1) NIE `--force` bei `firestore:indexes`. (2) VOR jedem Index-Deploy zuerst
  den Live-Stand exportieren (`firebase firestore:indexes [--database X]`) und
  ins File mergen, damit das File ein Superset ist (Deploy erstellt dann nur,
  löscht nichts). (3) firebase-Deploy bricht bei `409 index already exists` ab,
  wenn Indizes noch `CREATING`/mid-delete sind → für idempotentes Anlegen die
  Firestore-Admin-REST-API nutzen (`POST …/collectionGroups/{cg}/indexes`,
  Bearer aus `gcloud auth print-access-token`, 409 = skip; `__name__`-Felder +
  `density` vorm POST strippen; fieldOverrides via `PATCH …/fields/{fp}
  ?updateMask=indexConfig`). gcloud ist als User-Account authed; Audit-Logs
  (`CreateIndex` = admin activity) wären der letzte Fallback für Definitionen.

## Builds & deploys — niemals automatisch triggern

**Regel**: niemals einen `eas build` oder `eas submit` aus eigener
Initiative starten. Nur wenn der User explizit darum bittet
("build", "neuer build", "test build", "TestFlight", "Play Store",
"submit", "deployen", "rollout" etc.). Default für ein Code-
Change: committen, fertig — nicht builden.

Grund: Builds kosten Zeit (15–25 min) + EAS-Quota + bumpen
Versionsnummern (autoIncrement). User muss kontrollieren wann das
passiert. Wenn unsicher ob ein Build gewollt ist → fragen, nicht
einfach machen.

### Lokale Tests → Metro, NICHT xcodebuild

Wenn User "test mal auf dem sim" sagt → **`expo start`** + Sim mit
Dev-Client öffnen reicht. Metro served das aktuelle JS hot-reload.
KEIN voller `xcodebuild -configuration Release …` für jeden
JS-Change — das kostet 5-10 min pro Iteration für 0 Mehrwert
gegenüber Metro. Lokale Release-Builds nur wenn explizit ein
nativer/Pod-Change drinsteckt der getestet werden muss (z.B.
Plugin-Patch der Info.plist ändert).

User-Hinweis 2026-05-27: "builden musst du nicht immer für solche
tests da wir ja metro haben". Default: Metro. xcodebuild nur bei
nativen Änderungen.

**Metro IMMER via `nohup npx expo start --port 8081 > /tmp/metro.log 2>&1 &`
+ `disown` starten, NIE als run_in_background-Bash-Task.** Background-
Tasks haben ein 10-Minuten-Timeout — Metro stirbt dann mit, die App im
Sim läuft scheinbar weiter (Bundle im Speicher), aber on-demand
geladene Assets (Bilder via require) kommen nicht mehr an → Symptom
"Bilder fehlen", Icons gehen weiter (sind im Bundle). Kostete am
2026-06-10 eine Debugging-Runde. Zweites Learning desselben Abends:
NEUE Asset-Dateien (z.B. assets/rewards/*.png) nimmt ein laufender
Metro nicht auf — nach dem Anlegen neuer Assets Metro neu starten,
Hot-Reload reicht nicht (geänderte Dateiinhalte dagegen schon).

## Android: APK aufs Device — Workflow

Wenn der User „aufs Device packen", „APK installieren" o.ä. sagt:
**NICHT `adb install` ausführen, NICHT `eas build:run`** — das endet
oft in Signatur-Mismatches oder Play-Protect-Blocks. Stattdessen:

1. Aktuellsten EAS-Android-Build holen:
   ```bash
   eas build:list --platform android --limit 1 --json
   ```
   → die `applicationArchiveUrl` rauskopieren.

2. Datei in `~/Downloads` mit Versions-/Build-Naming packen:
   ```bash
   curl -L -o ~/Downloads/markendetektive-<version>-<build>.aab "<url>"
   ```
   Beispiel: `markendetektive-5.0.7-1155.aab`

3. Wenn's eine `.aab` ist (production-Profil): mit `bundletool` zu
   universal-APK konvertieren:
   ```bash
   cd ~/Downloads
   bundletool build-apks --bundle=<file>.aab --output=<file>.apks --mode=universal
   unzip -o -q <file>.apks -d <build-dir>
   cp <build-dir>/universal.apk <file>.apk
   ```
   (`internal`-Profil baut direkt APK, kein bundletool nötig)

4. APK auf den Device-Download-Ordner pushen:
   ```bash
   adb push ~/Downloads/<file>.apk /sdcard/Download/
   ```

5. **Fertig.** User installiert manuell vom Device aus dem Download-
   Ordner. Das umgeht Play-Protect-Restrictions, Signatur-Mismatches,
   und MIUI-Sicherheits-Blocks.

**Niemals stattdessen `adb install` direkt feuern** — das hat zwei
mal in Folge mit `INSTALL_FAILED_USER_RESTRICTED` geendet. User
will's manuell installieren, weil das auf seinem Device der
zuverlässige Weg ist.

## Builds & deploys — ALWAYS via EAS, NEVER local

**Beide Plattformen** werden über EAS Build gebaut, nicht lokal.
Das ist der etablierte Workflow für dieses Projekt — nicht
selbst nachdenken, einfach die Befehle nehmen.

```bash
# Android (Play Store internal/production)
eas build --platform android --profile production --non-interactive --no-wait

# iOS (TestFlight)
eas build --platform ios --profile production --non-interactive --no-wait
```

**NIEMALS** `cd android && ./gradlew assembleRelease` o.ä. lokal
ausführen. Das hat schonmal Java-14-vs-17-Stress + ANDROID_HOME-
Stress + 1 h Zeitverlust verursacht. Lokale Builds sind in diesem
Projekt keine Option.

### versionCode / buildNumber

**PFLICHT-CHECK VOR JEDEM iOS-BUILD (mehrfach in dieselbe Falle gelaufen):**
Die committete/Working-Tree-`buildNumber` ist NICHT die Wahrheit — sie hinkt
hinterher (durch den Entitlements-Hack-Workflow + Branch-Drift bleibt sie
veraltet). Wenn man blind baut, kommt eine NIEDRIGERE Nummer raus als die
zuletzt hochgeladene → **Apple lehnt jeden Build ≤ der letzten ab**. Passiert:
committed stand auf 1190, letzter TestFlight war 1202, Build kam als 1191 raus
= wertlos.

IMMER ZUERST die echte letzte Nummer holen, NICHT der lokalen Datei vertrauen:
```bash
eas build:list --platform ios --limit 5 --non-interactive --json \
  | python3 -c "import sys,json;[print(b.get('appBuildVersion'),b.get('status')) for b in json.load(sys.stdin)]"
```
Höchste FINISHED-Nummer = LATEST. Dann `app.json` → `expo.ios.buildNumber` UND
`Info.plist` → `CFBundleVersion` auf **LATEST** setzen → autoIncrement macht
LATEST+1. (Analog Android: `eas build:list --platform android` → höchste
`appBuildVersion` = versionCode-Stand.)

Nach dem Build die Working-Tree-Nummer NICHT wieder auf eine alte zurückfallen
lassen (z.B. beim Restore des Entitlements-Hacks) — `buildNumber` gehört NICHT
in den Hack; nach Restore sofort wieder auf die aktuelle Nummer setzen.

`eas.json` hat `production.autoIncrement: true` mit
`appVersionSource: "local"`. Das bedeutet:
- EAS liest die Version aus `app.json` + `Info.plist` /
  `android/app/build.gradle`
- **Beim Build-Start** bumped EAS automatisch +1 und committed
  die neuen Werte zurück in die lokalen Dateien

Wenn der User "TestFlight 1063" sagt, ist das die FINALE Nummer,
die im Build laufen soll. Das heißt: lokal auf 1062 setzen, dann
EAS triggern → autoIncrement macht 1063. Oder autoIncrement für
diesen einen Build deaktivieren. NICHT lokal auf 1063 setzen,
weil EAS dann auf 1064 bumped.

Beide Plattformen haben getrennte Zähler:
- iOS: `app.json` → `expo.ios.buildNumber` + `Info.plist` →
  `CFBundleVersion`
- Android: `app.json` → `expo.android.versionCode` +
  `android/app/build.gradle` → `versionCode`

EAS synchronisiert beide Stellen pro Plattform automatisch.

### Build-Ergebnisse

Builds erscheinen unter
`https://expo.dev/accounts/patze1411/projects/markendetektive/builds`.
Beim `--no-wait` Flag returnt der CLI sofort, der Build läuft
auf EAS-Servern weiter.

### WICHTIG: `eas build` ≠ Auto-Submit zu TestFlight / Play Store

Der `eas build`-Befehl baut **nur** und lädt das IPA/AAB als
Artefakt zu EAS hoch. Er pushed **NICHT** automatisch zu
TestFlight oder zum Play-Internal-Track. Wenn der User sagt
"mach ne neue TestFlight-Version", müssen ZWEI Schritte laufen:

```bash
# 1. Bauen
eas build --platform ios --profile production --non-interactive --no-wait

# 2. NACH Build-Finish: Submitten
eas submit --platform ios --profile production --latest --non-interactive
```

Analog für Android:
```bash
eas submit --platform android --profile production --latest --non-interactive
```

Submit-Profile-Konfig steckt in `eas.json` unter `submit.production`:
- iOS: appleId `patrick@markendetektive.de`, ascAppId `6471081082`
- Android: serviceAccount `markendetektive-895f7-ee3923910ddd.json`

**REGEL (User-Wort)**: Wenn der User **TestFlight**, **Play
Store**, **Internal-Track**, oder sinngemäß "in TestFlight haben",
"aufs Device der Tester", "an die Beta-User" sagt → **Submit ist
Pflicht**. Build allein reicht NICHT. Default-Vorgehen:

```bash
# In einem Schritt — Build + Auto-Submit
eas build --platform ios --profile production --auto-submit --non-interactive --no-wait
```

Oder zwei Schritte (wenn der Build schon läuft / fertig ist):
```bash
eas submit --platform ios --profile production --latest --non-interactive
```

Niemals einen iOS-Build als "TestFlight-Version 1063" verkaufen,
solange `eas submit` nicht durch ist und Apple die Verarbeitung
nicht abgeschlossen hat (i.d.R. 5–30 min nach submit). Bis dahin
ist der Build NUR ein IPA-Artefakt auf den EAS-Servern.

### iOS TestFlight: Pflicht-Checkliste VOR jedem Build (Juni 2026)

Jede Zeile hier hat mindestens einen Build/eine TestFlight-Version
gekostet. Alle 4 Checks ausführen, DANN bauen — nie umgekehrt.

**1. Entitlements-Check (Vorfall Build 1211: Apple-Login + Push tot):**
```bash
git diff ios/MarkenDetektive/MarkenDetektive.entitlements
grep -c applesignin ios/MarkenDetektive/MarkenDetektive.entitlements  # muss 1 sein
```
EAS baut den WORKING TREE (inkl. uncommitted Changes). Der
"Entitlements-Hack" (Datei temporär leeren für lokale Dev-Builds)
darf NIE uncommitted liegen bleiben — Build 1211 ging mit leeren
Entitlements zu TestFlight → `com.apple.AuthenticationServices.
AuthorizationError` bei jedem Apple-Login + Push tot (aps-environment
fehlte). Vor jedem Build: Diff muss leer sein, applesignin drin.

**2. buildNumber-Check** (siehe Abschnitt oben — `eas build:list`,
höchste FINISHED-Nummer = lokale Nummer; autoIncrement macht +1).

**3. Image-Check: `eas.json` → `production.ios.image` MUSS ein
konkretes Xcode-Image sein (Stand: `macos-tahoe-26.4-xcode-26.4`).**
- NIE `"latest"`: EAS dreht das Image still weiter (latest sprang
  Juni 2026 auf Xcode 26.4 und brach den fmt-Pod) → Builds brechen
  ohne eigene Code-Änderung.
- NIE `"default"`: war Xcode 15.4 → FirebaseSharedSwift braucht das
  Swift-6-Keyword `sending` → "cannot find type 'sending'".
- Älteres Xcode (16.4) ist KEIN Ausweg mehr: Apple lehnt seit Juni
  2026 alles unter dem iOS-26-SDK ab → **ITMS-90725** ("must be
  built with the iOS 26 SDK"). Xcode 26.x ist Pflicht.
- Gültige Image-Namen: https://docs.expo.dev/build-reference/infrastructure/

**4. fmt-Patch-Check: der `FMT_USE_CONSTEVAL`-Block in
`ios/Podfile` (post_install) darf NICHT entfernt werden.**
fmt 11.0.2 + Xcode-26-Clang = "call to consteval function ... is not
a constant expression" in `Pods/fmt/format-inl.h`. WICHTIG: ein
Compiler-Define `-DFMT_USE_CONSTEVAL=0` ist WIRKUNGSLOS — fmt's
`base.h` setzt das Macro ohne `#ifndef`-Guard hart auf 1, sobald
`__cpp_consteval` existiert, und überschreibt jeden Define. Deshalb
patcht der post_install-Hook die Header-QUELLE nach `pod install`
(gsub `define FMT_USE_CONSTEVAL 1` → `0`). Entfällt erst, wenn
RN/Expo eine fmt-Version mit Xcode-26-Fix einzieht.

**Build + Submit (ein Befehl, Standard):**
```bash
eas build --platform ios --profile production --auto-submit --non-interactive --no-wait
```

**Nachkontrolle (Pflicht, ~20 min nach Start):**
- Build-Status: `eas build:view <id> --json` → FINISHED + ipa-URL.
- Submission: bei Fehlschlag zeigt die CLI nur "Fastlane pilot
  failed" / `SUBMISSION_SERVICE_IOS_UNKNOWN_ERROR` — die ECHTE
  Apple-Begründung (ITMS-Code) steht NUR im EAS-Dashboard unter der
  Submission-URL (die Submission-Logs sind verschlüsselt, lokal
  nicht lesbar). Bei ITMS-Code → Code nachschlagen, nicht raten.
- Erst "in TestFlight" melden, wenn die Submission durch ist.

## Redesign status — what's done, what's left

Check before suggesting "next screen": grep for `DetailHeader |
FilterSheet | HeroPill | useTokens` (new-design markers) vs.
`ThemedView | ThemedText | IconSymbol` (legacy markers). New-
design files use the former and almost none of the latter.

**Done (new design):**
- ✅ `app/(tabs)/index.tsx` — Home
- ✅ `app/(tabs)/explore.tsx` — Stöbern
- ✅ `app/(tabs)/rewards.tsx` — Belohnungen (Einlösen + Bestenliste)
- ✅ `app/noname-detail/[id].tsx` — Produktdetail
- ✅ `app/product-comparison/[id].tsx` — Produktvergleich
- ✅ `app/achievements.tsx` — Errungenschaften & Level
- ✅ `app/profile.tsx` — Profil (consolidated from profile.tsx +
  profile-new.tsx + profile-old.tsx + the deleted Mehr tab —
  identity, level/savings hero, menu, settings toggles, social
  sheet, dev tools all in one)
- ✅ `app/favorites.tsx` — Favoriten (DetailHeader + SegmentedTabs
  + PagerView, FilterSheet for sort/market filters, Crossfade
  skeleton on initial load, sliding gradient bulk-action bar
  when items selected, tap-to-navigate with prefetch +
  explicit-checkbox bulk selection)
- ✅ `app/edit-profile.tsx` — Profil-Editor (DetailHeader + Save
  in right slot, avatar with camera-badge overlay + inline upload
  spinner, two surface cards (Identität + Optionales),
  ClearableInput / SelectRow / SegmentedTabs-style Gender pills,
  Date-Picker im FilterSheet auf iOS / native Dialog auf Android,
  full-width pill Save-CTA am Bottom)
- ✅ `app/history.tsx` — Such- & Scanverlauf (DetailHeader +
  SegmentedTabs + PagerView, Crossfade(fillParent) skeleton,
  shared relative-time formatter, tap-to-navigate with prefetch
  for scan items, "Verlauf löschen"-Pill als Top-Action statt
  floating button)
- ✅ `app/purchase-history.tsx` — Kaufhistorie (DetailHeader +
  SegmentedTabs(Marken/NoNames mit Counts) + PagerView, FlatList
  mit Infinite-Scroll-Pagination + Footer-Spinner, Crossfade
  (fillParent) skeleton beim Initial-Load, PurchaseCard mit
  Eyebrow-Logo + 2-Line-Name + Preis-mit-Gekauft-Datum-Zeile,
  flache Footer-Statusleiste "X von Y Käufen · Chronologisch
  sortiert", tap-to-navigate mit Prefetch je nach Stufe)
- ✅ Suche **inline in Stöbern** (gemerged — kein separates
  `/search-results` mehr). `app/(tabs)/explore.tsx` ist die einzige
  Such+Browse-Page. Drei Tabs: **Alle** (default für Such-Aufrufe
  von außen), Eigenmarken, Marken. Der `Alle`-Tab merged
  Eigenmarken+Marken (alphabetisch im Browse-Modus, Algolia-
  ranking-interleaved im Search-Modus). Such-Submit triggert
  einen Algolia-Call (`AlgoliaService.searchAll`) + Firestore-
  Enrich pro Hit (für `bildClean*` + `packTypInfo`). Active-
  Search-Chip (`Suche: "Bier" ✕`) im Filter-Rail führt zurück
  zum Browse-Modus. Algolia-Calls 24-h-LRU-cached
  (`SEARCH_CACHE_*` in `lib/services/algolia.ts`). Algolia-Index-
  Settings in beiden Indizes: `typoTolerance: 'strict'`,
  `minWordSizefor1Typo: 6`, `removeWordsIfNoResults: 'none'`,
  `searchableAttributes` explizit + 13 Synonym-Gruppen (Bier↔Pils/
  Lager/Weizen, Joghurt↔Skyr, Pasta↔Nudeln, Käse-Familie usw.).
  Externe Aufrufer (`(tabs)/index.tsx`, `history.tsx`) routen via
  `(tabs)/explore?query=…&tab=alle` — Stöbern's Route-Effect feuert
  beim Eintreffen automatisch `runSearch(params.query)`.
- ✅ `app/tipps-und-tricks.tsx` — Tipps & Tricks (DetailHeader,
  zentriertes Hero "Spare bis zu 200 € pro Monat", "Wusstest du
  schon?"-Section mit horizontaler Snap-Scroll-Liste aus Quick-
  Tip-Pill-Cards (78 % Screen-Width), pro Tipp-Kategorie eine
  Surface-Card mit getöntem 44×44-Icon-Kreis + Title +
  Description + Bullet-Liste in Kategorie-Tint, CTA-Card am Ende
  mit gradient Pill-Highlight die zum Stöbern-Tab linkt)
- ✅ `app/shopping-list.tsx` — Einkaufszettel (DetailHeader +
  SegmentedTabs mit DREI Tabs Marken/NoNames/Alle Produkte +
  PagerView, SwipeRow mit Pan-Geste in Reanimated 3 (rechts =
  gekauft, links = löschen), inline RowActions als zweite Eingabe,
  pro Tab unterschiedlicher Gradient-Banner (orange Sparpotenzial /
  green Ersparnis / petrol Gesamt), Crossfade(fillParent) Skeleton
  beim Initial-Load, FilterSheet + OptionList für Sortierung +
  Märkte + Kategorien, FAB ersetzt durch Filter-Pill + Plus-Pill
  im DetailHeader-Right-Slot, sticky Bottom-CTA mit Tab-spezifischer
  Aktion (Marken → Umwandeln, NoNames → Alle gekauft, Alle →
  Einkauf abschließen), BrandCard expandiert NoName-Alternativen
  inline mit Lieblingsmarkt-Bevorzugung, alle bestehenden Handler
  1:1 erhalten: handleConvertSingle/Selected, handleMarkAsPurchased,
  handleMarkAllAsPurchased, handleRemoveFromCart, BatchActionLoader,
  AddCustomItemModal, LevelUpOverlay, Achievement-Tracking,
  Journey-Tracking, Analytics)

**Open (legacy design):**
- ⏳ `app/markets/*`, `app/onboarding/*`, `app/auth/*`

When marking a screen done, MOVE it from "Open" to "Done" in this
table. If a previously-redesigned screen gets touched and
regresses, move it back. Don't trust memory across sessions.

## Design system rules (apply everywhere, retroactively too)

These are the rules established while building the Belohnungen +
Errungenschaften screens. Every new screen should reuse these
components/values 1:1 — no parallel re-inventing.

### Earn-Action-Farben + Icons (Schnellzugriff = Single Source)

Die drei Verdien-/Einreich-Aktionen haben app-weit FESTE Farbe +
Icon, definiert in `buildEarnActions()` (`app/(tabs)/rewards.tsx`).
Überall wo eine dieser Aktionen visuell auftaucht (Schnellzugriff-
Tiles, Cashback-Aktion-Cards mit `campaign.kind`, künftige Stellen)
EXAKT diese Werte nehmen — nicht neu erfinden:

- **Kassenbon scannen** (`receipt`): grün `#0d8575`, Icon `receipt`, dark tile (weiße fg)
- **Produkte einreichen** (`product_photos` / `photo`): lila `#5b4f9c`, Icon `camera-plus-outline`, dark tile (weiße fg)
- **Umfragen** (`survey`): grau `#dde2e4`, Icon `poll`, light tile (dunkle fg `#191c1d`)

User-Vorgabe 2026-05-30. Icon-Kreis + Aktions-Button einer Aktion-
Card spiegeln das Tile: bg = Aktionsfarbe, fg = weiß (dark) bzw.
`#191c1d` (light/Umfrage). NIE eigene Icons/Farben pro Aktion setzen.

### Tab switches → swipeable pills + PagerView

Whenever a screen has internal tabs (Stöbern's Eigenmarken/Marken,
Detail page's Inhaltsstoffe/Nährwerte, Rewards' Einlösen/Bestenliste,
any future page with tab-style selectors):

- Visually: `SegmentedTabs` — pill-style, raised active segment on a
  white card, equal-width segments.
- Mechanically: wired to a `PagerView` (`react-native-pager-view`).
  `onPageSelected` updates the SegmentedTabs `value`, taps call
  `pagerRef.current?.setPage(idx)` so the two stay in sync.
- Animation: the native page-swipe (UIPageViewController on iOS,
  ViewPager2 on Android). NOT a JS crossfade/translate.
- Pages stay mounted (PagerView default) so swiping back is instant.
  Per-page data lazy-loads on first focus when expensive.
- **Reference implementation**: Stöbern (`app/(tabs)/explore.tsx`).
  Use the same `setPage` + shared scroll-handler pattern as a template.

**Ausnahme: embedded Tabs INSIDE einer ScrollView.** PagerView
greift vertikale Drags ab und blockiert den parent-ScrollView —
auf Touch in der PagerView-Region kann die Page nicht mehr nach
oben/unten gescrollt werden. Plus: PagerView constrained die
Pages auf seine eigene Höhe, was bei dynamischem Content (z.B.
unterschiedlich langer Zutaten-Text) zu abgeschnittenem Inhalt
führt (catch-22 wenn die Höhe über onLayout der Pages bestimmt
werden soll). Für solche embedded-Tabs (Beispiel:
`product-comparison/[id].tsx` Inhaltsstoffe/Nährwerte) →
conditional Render: `{tab === 'X' ? <PageA/> : <PageB/>}`. Tap
auf SegmentedTabs switched.

**Swipe ohne PagerView (2026-05-29):** Statt PagerView (das den
Vertical-Scroll blockiert) eine horizontale `Gesture.Pan()` aus
`react-native-gesture-handler`, NUR um den Tab-Content gewickelt
(`<GestureDetector>`), mit `.activeOffsetX([-20,20])` (startet nur bei
klar horizontalem Swipe) + `.failOffsetY([-12,12])` (bei vertikalem Drag
gewinnt der parent-ScrollView). `.onEnd` prüft `translationX` (Schwelle
±40) und ruft `runOnJS(onTabChange)(...)`. Geste via `useMemo([tab])`
damit der im Worklet gelesene tab-Wert frisch bleibt. So funktioniert
Swipe + Vertical-Scroll gleichzeitig, ohne PagerView-Höhen-Bug, und der
Swipe ist exakt auf den Tab-Bereich begrenzt.

PagerView bleibt das richtige Werkzeug wenn die Tabs den ganzen
Screen einnehmen UND die Pages SELBST scrollbare Listen sind
(wie in Stöbern) — dort gibt's keinen Konflikt weil die Listen
die Vertical-Touches behalten.

### Header chrome → `DetailHeader` (stack screens) or BlurView pattern (tab screens)

- **Stack/detail screens** (`achievements`, `noname-detail/[id]`,
  `product-comparison/[id]`, …): use the shared
  `components/design/DetailHeader.tsx` directly. Pass `title`,
  `onBack={() => router.back()}`, optional `right={<...>}` slot for
  trailing actions, optional `scrollY` + `scrolledTitle` for the
  morphing-title behaviour. Native stack header is hidden via
  `navigation.setOptions({ headerShown: false })`.
- **Tab screens** (`rewards`, `index`, `explore`): inline the same
  pattern — BlurView on iOS (`intensity={80}`, scheme-aware tint),
  tinted opaque View on Android (`rgba(245,247,248,0.92)` light /
  `rgba(15,18,20,0.92)` dark) — both `position: 'absolute'` from
  `top: 0` with `paddingTop: insets.top`. The `expo-blur` fallback
  on Android is poor, hence the tinted-View fork.
- Content scrolls under the chrome: ScrollView gets
  `contentContainerStyle.paddingTop = insets.top + <row-height>`.
- Back button: 40×40 round Pressable, `arrow-left` icon (24 px),
  `theme.text` colour. Title: extraBold 20 px (DetailHeader) or 26 px
  (tab title like "Belohnungen") — `letterSpacing: -0.2 to -0.4`.
- **Keine Hairline am Bottom-Edge des Headers.** Der Visual-Cut
  zwischen Header und Content ist durch das Material selbst
  (BlurView iOS / tinted View Android) gegeben. Eine zusätzliche
  `theme.border`-Linie wirkt als grauer Bruch beim Scrollen — hat
  ein User-Bug-Report im Mai 2026 explizit angesprochen. Wenn ein
  Schatten-Hint gewünscht ist, dann nur in der Form, dass der
  Header eine Material-Schicht IST, nicht als separate Linie drauf.

### Tab-Bar — per-Platform Pattern (NICHT vereinheitlichen)

Die Tab-Bar (`app/(tabs)/_layout.tsx`, `FlyingTabBar`) hat
**bewusst zwei verschiedene Umsetzungen** je Plattform. Nicht
"vereinheitlichen" — die Trade-offs sind absichtlich verschieden.

**iOS — floating Pill:**
- `position: 'absolute'`, `left: PILL_MARGIN_X (50)`, `right: PILL_MARGIN_X`,
  `bottom: pillBottom (~insets.bottom + 1)`
- `borderRadius: PILL_RADIUS (18)` an allen vier Ecken
- Höhe `PILL_HEIGHT (58)`
- Raised Stöbern-Mittel-Button bricht oben aus (`top: -RAISED_LIFT (22)`)
- `<GlassBackdrop>` hinter der Pille — MaskedView + BlurView
  (intensity 50, dimezisBlurView OK auf iOS) mit vertikalem Gradient
  (transparent oben → opak unten), Höhe = `pillBottom + PILL_HEIGHT/2`

**Android — full-width Bottom-Bar:**
- `position: 'absolute'`, `left: 0`, `right: 0`, `bottom: 0`
- `borderTopLeftRadius: PILL_RADIUS`, `borderTopRightRadius: PILL_RADIUS`,
  Bottom-Corners flat (= 0)
- Höhe = `PILL_HEIGHT + insets.bottom`, `paddingBottom: insets.bottom`
  (Tabs sitzen oben, Gesture-Bar bleibt safe)
- `paddingHorizontal: 24` — Home/Rewards minimal nach innen, kleben
  nicht an der Edge (Konsistenz mit iOS-Atmung)
- **Raised Stöbern-Button BLEIBT** — bricht aus dem Top-Edge der Bar
  raus, gleicher RaisedMiddleTab wie auf iOS
- **Kein GlassBackdrop** — Bar ist solid `cardBackground`, full-width,
  bottom-flush. Kein Blur nötig.
- `elevation: 14` (Material-Lift), kein iOS-Shadow

**Warum verschieden:** iOS hat homogene Geräte-Landschaft (predictable
safe-area, gleiche Gesture-Bar-Höhe). Auf Android variieren OEM-Skins
(MIUI, Samsung One UI, Pixel-Stock-Gestures) so stark, dass eine
floating Pille auf manchen Devices verloren wirkt oder zu nah am
Gesture-Bar liegt. Full-width + bottom-flush ist platform-konventionell.

### Plattform-spezifische Icons (iOS-Style auf iOS, Android-Style auf Android)

Konventions-/System-Icons IMMER plattform-korrekt rendern — iOS-Nutzer
erwarten das iOS-Glyph, Android-Nutzer das Material-Glyph. Umsetzung via
`Platform.OS === 'ios' ? <iOS-Icon/> : <Android-Icon/>`.

- **Teilen / Share**: iOS = `Ionicons name="share-outline"` (Quadrat + Pfeil
  nach oben, entspricht SF-Symbol `square.and.arrow.up`), Android =
  `MaterialCommunityIcons name="share-variant"` (drei verbundene Punkte =
  Material-Share). Referenz: Einkaufszettel-Header (`app/shopping-list.tsx`).
- Gilt analog für andere konventionsbehaftete Icons. NIE ein und dasselbe Icon
  für beide Plattformen, wenn iOS/Android dafür ein klar unterschiedliches
  System-Glyph haben (Share ist der Paradefall). User-Vorgabe 2026-06: „teilen
  icon auf ios im ios style und auf android im android style".

### Search input → ONE shared style across the app

Every search field in the app — Stöbern (Eigenmarken / Marken),
Search-Results, History-Search, Cart-Search, etc. — uses the same
visual block. Defined inline in `(tabs)/explore.tsx`'s
`renderSearchInput`; treat that as the canonical reference.

```
height:           38
borderRadius:     11
backgroundColor:  theme.surface
borderWidth:      1
borderColor:      theme.border
paddingHorizontal:12
flexDirection:    'row'
gap:              8
inner:
  • magnify icon (16 px, theme.textMuted)
  • TextInput (fontSize 14, fontWeight medium, color theme.text)
  • close-circle clear button (16 px, theme.textMuted) when value
```

When a screen NEEDS a "submit" affordance (i.e. submission is not
done via the keyboard's return key — Stöbern's in-place search is
the example), add a 38×38 pill RIGHT NEXT TO the input, NOT inside it:

```
width:            38
height:           38
borderRadius:     11           // matches the input
backgroundColor:  brand.primary  (active) / theme.borderStrong (disabled)
icon:             magnify, 18 px, white
gap from input:   8 px
```

DON'T introduce a tall (44 + radius 22) "search-bar-on-its-own-row"
pattern, a different placeholder typography, or a separate "Filter
+ search" button. ONE input style. ONE submit pill. Everywhere.

### Bottom sheets → `FilterSheet` ALWAYS

Every bottom sheet in the app uses `components/design/FilterSheet.tsx`:

- Slide-up animation via Reanimated 3 (spring on enter, timing on exit).
- Drag handle (44×5 px pill) at the top.
- Title row with X close button — handled by FilterSheet, do NOT add
  your own header inside the children.
- Backdrop fade + pan-to-dismiss (>100 px translation OR >500 px/s
  velocity closes).
- API: `<FilterSheet visible title onClose>{children}</FilterSheet>`.
- Children render as the sheet body — no padding wrapper, FilterSheet
  applies `paddingHorizontal: 20`.
- DON'T use `FixedAndroidModal`, raw `<Modal>`, or roll your own
  bottom sheet. ONE source of truth.

### Hero card pattern

Big gradient cards used as the visual anchor of a screen. Examples:
Cashback hero (Belohnungen Einlösen), StatusHero (Belohnungen
Bestenliste), CurrentLevelHero (Errungenschaften).

Shared dimensions + style:

- `borderRadius: 18`, `paddingHorizontal: 14`, `paddingVertical: 12`
- Diagonal gradient: `start={{ x: -1, y: 0.34 }} end={{ x: 1, y: -0.34 }}`
- Fixed height (`HERO_HEIGHT = 144`) when the card sits inside a
  PagerView so its sibling cards don't jump heights on tab swap.
  Free height when the card is alone on its screen and richer
  content is desired (CurrentLevelHero).
- Inner layout when fixed-height: `<View flex:1 justifyContent:'space-between'>`
  → top row anchored, bottom (progress bars) anchored.
- Top row layout: `flexDirection: 'row', alignItems: 'stretch', gap: 12, minHeight: 52`.
  Three columns:
    1. 52 px circle (avatar / icon — `borderRadius: 26`,
       `backgroundColor: 'rgba(255,255,255,0.22)'`, 2 px
       `rgba(255,255,255,0.55)` border)
    2. Middle column with `flex: 1, justifyContent: 'space-between'`
       → title at top, status pill at bottom
    3. Right column with `alignItems: 'flex-end', justifyContent: 'space-between'`
       → big number at top, currency pill at bottom
  This guarantees the two pills sit on the same baseline.

### Hero pill (`HeroPill`)

Single pill component used for ALL labels inside hero cards. Defined
inline in `app/achievements.tsx` and `app/(tabs)/rewards.tsx` (eventual
target: extract to `components/design/HeroPill.tsx`).

```
paddingHorizontal: 8
paddingVertical: 3
borderRadius: 10
backgroundColor: 'rgba(255,255,255,0.22)'
icon: MaterialCommunityIcons 11 px gold (#ffd44b)
text: fontSize 10, fontWeight extraBold, letterSpacing 0.4, white
```

Use it for:

- Level chip (`Level X · Name`)
- Currency labels (`DETEKTIV-PUNKTE`, `CASHBACK-TALER`)
- Status chips (`Bereit zur Auszahlung`, `Noch X € bis Auszahlung`)
- Stat chips inline (`X Tage Streak`, `X/2 Freezes`, `Noch X Pkt …`)

NEVER define a one-off pill style inline if the role is the same.

### Progress bar (`ProgressBar`)

Single bar component. Used inside hero cards for level/payout progress.

```
icon left (13 px white, opacity 0.95)
label inline (fontSize 12, bold, white opacity 0.95)
counter right ("X / Y", fontSize 12, extraBold, white)
bar (height 5, borderRadius 3, bg rgba(255,255,255,0.22), fill #fff)
```

### Selectors → `ScopeCard` for everything

Three contexts on the Belohnungen screen, all using the SAME
`ScopeCard` component:

- Outer scope (Overall / Regionenkampf)
- Period switcher (Legendär / Rising Star / On Fire)
- Region geo (Bundesländer / Städte)

`ScopeCard` accepts either an MDI glyph name (rendered in a coloured
icon-circle) OR a short emoji string (rendered as text). Heuristic:
contains a hyphen → MDI, else emoji.

```
flex: 1 (rows are equal-width)
minHeight: 50
borderRadius: 12
paddingHorizontal: 10, paddingVertical: 8
inactive: theme.surface bg, 1 px theme.border
active: theme.primaryContainer bg, 1.5 px theme.primary border, shadows.sm
icon-circle (when MDI): 24×24, primary bg when active, surfaceAlt when inactive
title: extraBold 13 px, theme.text
sub: medium 10 px, theme.textMuted
```

### Card pattern in horizontal scroll

For Levels + Achievements horizontal scrolls (and the Bestenliste
card lists):

- Width 156–168 px, height 168–200 px (fixed in scroll, content
  fills with hierarchy)
- White surface (`theme.surface`)
- Soft shadow (`shadows.sm`)
- Border accent: 1 px `theme.border` default, 1.5–2 px in level/diff
  colour when unlocked/active, primary colour when active
- Inner padding: 12–14
- Top row: icon-circle (40–44 px) + status indicator
- Title: extraBold 15 px, `letterSpacing: -0.2`
- Description: medium 11 px, `theme.textSub`, 3 lines max
- Bottom: progress bar (height 4–5 px, diff/level colour fill) OR
  done state (✓ + points)

### Difficulty (achievements)

Same 4-tier ladder app-wide:

- ≤10 pts → Einfach, `#2196F3` (blue)
- ≤20 pts → Mittel, `#4CAF50` (green)
- ≤25 pts → Schwer, `#FF9800` (orange)
- >25 pts → Meister, `#F44336` (red)

`difficultyFor(points)` returns `{ label, color }`. Used for
achievement card borders, icon-circle bg, difficulty chip, progress
bar fill.

### Level gradient

Level-tinted gradients on hero cards + active level cards. Map
mirrors the legacy `/achievements` screen so users see the same
colour for the same level across screens:

- Lvl 1 → `[level.color, '#9E6B50']` (Braun)
- Lvl 2 → `[level.color, '#FF9800']` (Orange)
- Lvl 3 → `[level.color, '#4CAF50']` (Grün)
- Lvl 4 → `[level.color, '#FFC107']` (Gold)
- Lvl 5 → `[level.color, '#FF5252']` (Rot)
- 6+   → `[level.color, '#9E6B50']`

`levelGradient(levelId, baseColor)` helper — defined inline in
both `achievements.tsx` and `rewards.tsx` (target: shared util).

### Lottie animations

For completed achievements only. `lottieFor(achievement)` maps the
`trigger.action` to a file in `assets/lottie/`:

- `first_action_any` → `rocket.json`
- `daily_streak` (≥7) → `streak-fire.json`, else `streak-bonus.json`
- `view_comparison` → `comparison.json`
- `complete_shopping` / `create_list` → `task.json`
- `search_product` → `search.json`
- `submit_rating` → `ratingsthumbsup.json`
- `convert_product` → `swap.json`
- `share_app` → `review.json`
- `submit_product` → `favorites.json`
- `save_product` → `favorites2.json`
- `savings_total` → `savings.json`
- fallback → `confetti.json`

Auto-play, loop, `speed={0.8}`. In-progress achievements use
`<IconSymbol name={achievement.icon}>` (SF symbol → native icon
mapping, Firestore-driven).

### Loaders → skeletons, never blocking spinners

Page-level / list-level loading states use **shimmer skeletons that
mirror the live layout**, never a centered `ActivityIndicator`. The
header chrome (`DetailHeader` / tab BlurView) stays mounted during
the load — only the body swaps. Reference:
`components/design/Skeletons.tsx` (`Shimmer`, `ProductCardSkeleton`,
`ProductDetailSkeleton`, `AchievementsSkeleton`).

The triage rule:

- ❌ **Don't** use `ActivityIndicator` for: a screen that just
  navigated in, a list that's fetching its first page, a hero card
  that's waiting on data, a modal/sheet whose body is loading.
  → Use a `Shimmer`-based skeleton that matches the eventual
  layout (same row count, same card dimensions) so the
  data-swap is invisible.
- ✅ **Do** use `ActivityIndicator` for: inline button states
  (auth submit, save, delete-while-pressed), pagination footers
  (`onEndReached` "loading more" rows when the list already has
  data), camera/permission init blockers, app-boot before fonts/
  auth are ready.

When adding a skeleton:

- Keep it inside the live page's render tree so the chrome
  doesn't unmount.
- Match dimensions exactly — same card width/height, same hero
  height, same row height — to prevent layout jumps.
- Add the named composite to `Skeletons.tsx` (e.g.
  `AchievementsSkeleton`) when the layout is reused; one-off
  skeletons can stay inline using the `Shimmer` building block.

### Progressive loading (detail screens) — NO POPPING

Detail screens (`noname-detail/[id]`, `product-comparison/[id]`)
use a **shape-matching Crossfade** pattern: skeletons that have the
SAME outer shape as the eventual content, faded into the live
content over 320 ms via a single shared value. Because the
container/chip/pill/button shapes are identical between skeleton
and content, the user perceives "details fill in", not "thing
morphs" — no pop.

We attack popping + slowness at four layers: **Firestore offline
persistence**, **in-memory caches**, **route prefetch on tap**, and
**shape-matching Crossfade for the reveal**.

#### 1. Firestore — in-memory cache only, NEVER persistent

`lib/firebase.ts` uses `getFirestore()`. **Auf Android wird die
native Disk-Persistenz explizit ABGESCHALTET** via
`firestore().settings({ persistence: false })` VOR der ersten
Firestore-Op. Das ist PFLICHT — nicht entfernen.

**Warum (teures Learning, Juni 2026 — Tage gekostet):**
`@react-native-firebase` defaultet auf `persistence: true`
(Disk-Cache). Der intendierte Projekt-Stand war IN-MEMORY (alter
Web-SDK: `getFirestore` ohne `persistentLocalCache`). Die
Native-Migration hat die Disk-Persistenz unbeabsichtigt aktiviert.
Folge NUR auf Android: der native SDK hält den über die Session
gelesenen **Referenz-Graph** (produkte / hersteller_new /
handelsmarken / kategorien / packungstypen / discounter /
markenProdukte — ~170+ Docs via `getDocumentByReference`) als
**persistente Query-Targets** und re-validiert sie bei JEDEM Write.
Ein Cart-Write am Einkaufszettel (gekauft-markieren / löschen)
löste dann einen **WatchStream-RESET-Sturm** + `View.computeDoc
Changes → ObjectValue.equals` über alle re-gelieferten Docs aus →
der gRPC-WatchStream-Worker (`FirestoreWorker`-Thread) drehte
**5+ Min bei 600% CPU** durch und blockierte ALLE weiteren Reads
("alles was nachgeladen wird hängt"). Custom/Freitext-Items hingen
NICHT (kein Referenz-Graph). Produktseite hing NICHT (nur ~1
Produkt aktiv). iOS hing NICHT (handhabt dieselbe Persistenz nativ
sauber). Diagnose-Beweis: SIGQUIT-Thread-Dump auf den
`FirestoreWorker` zeigte `protobuf MapFieldLite/AbstractProtobuf
List.equals`-Rekursion; `firestore().setLogLevel('debug')` →
nativer WatchStream-Log zeigte den RESET + die 172 re-gelieferten
Referenz-Docs.

**Regeln:**
- `persistence: false` auf Android NICHT entfernen. iOS NICHT
  anfassen (läuft mit Default-Persistenz, kein Spin).
- Diagnose-Hebel für künftige native-Firestore-Probleme:
  `(firestoreNamespace as any)().settings(...)` +
  `(firestoreNamespace as any).setLogLevel('debug')` (→ logcat
  `I Firestore:`, NICHT `I/Firestore`) + `adb shell kill -3 <pid>`
  → ANR-Trace `/data/anr/` für den `FirestoreWorker`-Stack.
- **DO NOT** switch to the WEB-SDK `initializeFirestore` with
  `persistentLocalCache` / `persistentSingleTabManager` — those are
  web-only (IndexedDB), and on RN the SDK code path crashes via
  `new NativeEventEmitter()` (PushNotificationIOS lazy getter weg in
  modern RN). Half a day verloren. Die In-Memory-Caches in
  `services/firestore.ts` (5-min TTL + inflight-dedup) + der
  manuell gecachte `getDocumentByReference` geben die Revisit-Speed.

#### Never `await import('react-native')`

Same root cause as above (PushNotificationIOS lazy getter):
`await import('react-native')` triggers metro's `metroImportAll`,
which enumerates **all** RN exports and fires the lazy getter
that runs `new NativeEventEmitter(null)` and crashes. ALL
`react-native` imports must be **static** at the top of the file.
If you need `InteractionManager`, `Keyboard`, `Platform`, etc.
in an `async` block, import them statically:

```tsx
import { InteractionManager } from 'react-native';
// …
useEffect(() => {
  InteractionManager.runAfterInteractions(() => {
    /* deferred work */
  });
}, []);
```

Dynamic imports of *other* packages (`expo-haptics`, internal
services) are fine — only `react-native` itself is poisoned.

#### 2. In-memory product-detail cache

`FirestoreService` keeps a 5-minute TTL cache for
`getProductWithDetails`, `getMarkenProduktWithDetails`, and
`getProductComparisonData`, plus inflight-promise de-duplication.
Cache is module-scoped, RAM-only, no AsyncStorage write.

#### 3. Prefetch on tap

Every `router.push` to a detail screen MUST be preceded by:

```tsx
FirestoreService.prefetchProductDetails(id);   // for /noname-detail/:id
FirestoreService.prefetchComparisonData(id, isMarkenProdukt);  // for /product-comparison/:id
router.push(...)
```

The prefetch fires off the Firestore fetch + image download
synchronously; the navigation animation runs in parallel. By the
time the destination screen mounts and calls `getProductWithDetails`,
the inflight promise (or the cache) hands data back instantly.

`getProductWithDetails` and `getMarkenProduktWithDetails`
internally call `RNImage.prefetch(productData.bild)` the moment
the main getDoc lands, in parallel with the reference fetch. The
hero image is in the OS disk cache by the time the screen renders.

Prefetch sites currently wired: `app/(tabs)/index.tsx`,
`app/(tabs)/explore.tsx` (covers both browse + in-place search),
`app/product-comparison/[id].tsx` (alternatives). Whenever you add
a new entry-point that links to a detail screen, add the prefetch.

#### 4. Shape-matching Crossfade

Two `<Crossfade>` blocks per detail screen, each with a skeleton
that mirrors the live content's shape:

- **`noname-detail`** (Stufe 1, 2): single fetch.
  - Top block (Crossfade #1, delay 0, duration 320 ms):
    skeleton = 240 px rounded surfaceAlt container + Hersteller
    chip placeholder at top-left + price-pill placeholder at
    bottom-left + 3 action-button placeholders at bottom-right.
    Each placeholder uses the SAME background colour, padding,
    radius, and position as the live element.
  - Bottom block (Crossfade #2, delay 150 ms, duration 320 ms):
    skeleton = info-card surface with Hersteller/Kategorie row
    placeholders + tabs pill + body card + stufe-row surfaceAlt
    container with S-letter / dots / text-line placeholders.
- **`product-comparison`** (Stufe 3, 4, 5): two-phase fetch.
  - Top block (Crossfade #1, gated on `mainReady`, delay 0):
    same hero skeleton as noname-detail.
  - Bottom block (Crossfade #2, gated on `nonamesReady`, delay 0):
    section-header placeholder + 2 alternativen-card shapes
    matching `NN_CARD_WIDTH` × the live card layout + tabs
    skeleton. Stagger comes from the natural Firestore round-
    trip delta between `mainReady` and `nonamesReady` — no
    artificial delay needed.

Crossfade implementation (in `components/design/Skeletons.tsx`):
- Single `useSharedValue` `t` drives BOTH layers. Skeleton opacity
  = 1 - t, content opacity = t. They sum to 1 at every frame, so
  perceived brightness is constant (no "muddy double-image" or
  "blank gap" mid-frame).
- Default duration 320 ms, default delay 0.
- **`fillParent` prop:** when wrapping a `flex: 1` child like
  `PagerView`, `ScrollView`, or `FlatList`, you MUST pass
  `fillParent` so both layers are absolute-positioned to inherit
  the parent's dimensions. Without it the inner Animated.View
  collapses to 0 height (it doesn't `flex` by default) and the
  child claims `flex: 1` of `0` → renders empty. Default mode
  (no `fillParent`) keeps content in normal flow — correct for
  inline crossfades and fixed-height blocks (240 px hero card).

`Shimmer` block (the building block inside placeholders):
- 1.4 s pulse between opacity 0.85 → 1.0 (range 0.15). Was 0.65 → 1.0
  (range 0.35) — too aggressive, contrasted too much with live
  content, contributed to the "pop" feeling. Calmer pulse =
  smoother crossfade.

Morph titles use combined `transform + opacity` in one
`useAnimatedStyle` worklet at the same 320 ms tempo:
`morphFade.value = withTiming(product ? 1 : 0, { duration: 320 })`.

#### Rules

- **Skeleton elements MUST match the live element's shape**: same
  container backgroundColor, same paddings, same border radius,
  same absolute position. The skeleton is "the same shape with
  Shimmer fills"; the content is "the same shape with real
  values". Crossfade between them reads as "details fill in",
  not "thing transforms".
- **Always render the chrome on the first frame**: `DetailHeader`
  + ScrollView are outside the Crossfade. Only the body blocks
  swap.
- **Use `<Crossfade>` from `Skeletons.tsx`**, not ad-hoc opacity
  wiring. It runs entirely on the Reanimated 3 UI thread (zero
  JS-thread cost per frame).
- **320 ms duration, ≤200 ms stagger** — slower than 200 ms feels
  "graceful" rather than "snappy". Don't go below 250 ms on
  detail screens; it reads as a pop again. Don't go above 220 ms
  on the stagger; the second wave starts feeling like a separate
  pop instead of a continuous cascade.
- **Action handlers gate on `p`/`mp` non-null**, so taps during
  the fade never see undefined product data.
- **No `LayoutAnimation`, no `Animated.spring` opacity, no JS
  `setTimeout` swap.** Always Reanimated 3 worklets.
- **Don't use the `onBasic` / `onMainBasic` / `onMainResolved`
  service callbacks.** Staged data → multiple skeleton-to-content
  swaps → multiple pops. Wait for full data per block, crossfade
  once.

### Animations → Reanimated 3 only

- `useSharedValue`, `useAnimatedStyle`, `useAnimatedScrollHandler`,
  `withSpring`, `withTiming`, `interpolate(..., Extrapolation.CLAMP)`.
- NO `Animated.Value` / `Animated.timing` from `react-native`. NO
  layout-driven animations (avoid `LayoutAnimation`). Every animated
  value runs on the UI thread.
- Stable per-day randomness (e.g. motivation-line variant rotation)
  uses `Math.floor(Date.now() / 86_400_000)` as a seed — keeps the
  string stable inside a session, fresh next day.

### Section header

Page section titles all use the same shape:

```
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'baseline',
paddingHorizontal: 20,
marginBottom: 10
```

- Title: `extraBold 20 px, letterSpacing -0.2`, `theme.text`
- Sub (right-aligned, optional): `medium 12 px, theme.textMuted`,
  e.g. counts like `5 / 24`, `Level 3 / 16`

### Spacing rules

- Page section vertical gap: `paddingTop: 10–22` between sections
  (10 for related, 18–22 for unrelated)
- Horizontal scroll content padding: `paddingHorizontal: 20, gap: 10`
- Card-inner gaps: 6–8 between icon row + title, 8–10 between
  title + body / progress
- Sheet content: `paddingBottom: 8` inside FilterSheet (safe-area
  is owned by FilterSheet itself)

### Border radii — pick from the token system, do NOT improvise

The radii live in `constants/tokens/radii.ts`:

```
xs:   4    // tiny chips, dots
sm:   8    // small badges, sticker labels
md:   12   // chips, segmented-tab pills, ScopeCard
lg:   16   // small surface cards (use 14 = lg-2 for QuickAccessCards)
xl:   18   // prominent containers — hero cards, MorphingCartButton,
            //                       MorphingHeader, RatingsSheet,
            //                       Floating-Pill Tab-Bar
2xl:  25   // legacy bottom-sheet / old tab-bar curve
full: 9999 // true circle (only buttons / status dots)
```

**Pick rules:**

- **Card-level container?** → `radii.xl` (18). That's hero cards,
  MorphingCartButton, the floating tab pill — anything that's a
  prominent surface holding other things. ONE value across the app
  so neighbouring elements (e.g. cart FAB next to tab pill) match.
- **Smaller surface card** (Schnellzugriff, AchievementCard horizontal
  scroll cards)? → `radii.lg - 2 = 14`. The QuickAccessCard precedent
  is canonical.
- **Pills / chips / badges (selectors, segmented tabs, hero pills)?**
  → `radii.md` (12) or smaller. Inputs use 11 (search-input pattern,
  see "Search input → ONE shared style").
- **Round buttons** (FABs, raised middle tab button, icon-circle
  avatars)? → `radii.full` (or width/2). Buttons are a separate
  category from containers and are allowed to be perfectly round
  even when they sit inside a non-round container.
- **NEVER** use a one-off radius like 22 or 20 just because it
  "looks right". If none of the tokens match, raise a question
  instead of improvising — drift accumulates fast and breaks the
  visual system across screens.

**Why this rule exists:** when the floating tab pill was first
built it used full capsule (PILL_HEIGHT/2 = 29), then an arbitrary
22, both wrong. The cart FAB right next to it uses `radii.xl` =
18. Inconsistent radii on adjacent prominent surfaces read as
"unfinished design", not "intentional variation". Lock to the
token tier, neighbours will match automatically.

### Copy-Ton: NIE Frustration texten (User-Vorgabe, app-weit)

Niemals negativ/abwertend formulieren — keine „ohne Cashback", „ohne
Vergütung", „keine Vergütung", „nachträglich nicht vergütet" o.ä.
Stattdessen IMMER positiv + vorwärts-gewandt: was der User DAVON hat +
was als Nächstes geht. Beispiele:
- ❌ „Dieser Bon wurde ohne aktive Aktion eingereicht … nachträglich
  vergütet wird er nicht." → ✅ „Dein Bon ist gespeichert und zählt zu
  deiner Ausgabenübersicht. Sobald eine Aktion läuft, gibt's beim
  nächsten Mal etwas obendrauf."
- ❌ „Aktuell ohne Cashback." → ✅ Zeile weglassen ODER den Nutzen nennen
  („du hilfst, die Datenbank zu vervollständigen").
- Limits/Caps: nicht „keine Vergütung mehr", sondern „diese Woche schon
  am Ziel — nächste Woche geht's weiter".
Gilt für Bons, Produkt-Einreichung, Umfragen, Payout — überall. Wenn ein
Zustand faktisch 0 € bedeutet, framing auf „gespeichert/zählt/nächstes
Mal", nie auf den Mangel. User-Vorgabe 2026-05-31: „nie frustration
hervorrufen".

### Toasts → ONE library, one helper-set

ALL toasts go through `lib/services/ui/toast.tsx` (built on
`@backpackapp-io/react-native-toast`). It renders a compact
iOS-Dynamic-Island-style pastel pill — pointed-island-style,
auto-width, NOT in-your-face. Every action that mutates state
(add to cart, favorite, mark purchased, delete, error, etc.)
should produce a toast so the user gets confirmation.

**Helper picker:**

| Use case | Helper |
|---|---|
| Reward feedback (Punkte) | `showPointsToast(msg, points, scheme)` |
| Streak day milestone | `showStreakToast(days, bonus, scheme)` |
| Add to cart | `showCartAddedToast(msg, onOpenCart, scheme)` |
| Already in cart (info) | `showAlreadyInCartToast(onOpenCart, scheme)` |
| Cart purchased / removed | `showPurchasedToast(msg, scheme)` |
| Convert success | `showConvertSuccessToast(savings, scheme)` |
| Bulk convert | `showBulkConvertSuccessToast(savings, scheme)` |
| Bulk purchased | `showBulkPurchasedToast(db, custom, savings, scheme)` |
| Favorite add/remove | `showFavoriteAdded/RemovedToast(name, scheme)` |
| Rating success/error | `showRatingToast(msg, type, scheme)` |
| Generic info / error | `showInfoToast(msg, type, scheme)` |
| **Network-fail with retry** | `showRetryableErrorToast(msg, onRetry, opts)` |

**Position auto-routing:** POINTS, STREAK, ANTI_ABUSE land at the
BOTTOM (near the gamification "score zone"). Everything else lands
at the TOP. Don't fight this — it's intentional.

**Don't:**
- Roll your own toast/snackbar component. Always use the helpers.
- Use `Alert.alert` for non-critical confirmations — that's a
  blocking native modal, the toast is non-blocking.
- Show a toast for every render or every Firestore-listener
  update. Toasts confirm USER ACTIONS, not data changes.

**Network-error pattern (U2 from the audit):** any async call in
the critical path (receipt scan, login, withdraw, submit) wraps:

```ts
try { await someApiCall() }
catch (e) {
  console.error('uploadReceipt failed', e);
  showRetryableErrorToast(
    'Bon konnte nicht hochgeladen werden — Verbindung prüfen.',
    () => someApiCall(),
  );
}
```

The action-pill stays for 8 seconds (long) until the user taps or
swipes. Standard errors WITHOUT retry use `showInfoToast(msg,
'error')` instead — short, no action.

### Celebrations → ONE banner, no confetti modal

Achievement-Unlocks and Level-Ups go through ONE component:
`components/ui/AchievementUnlockBanner.tsx`. Slide-up from above
the tab bar, Lottie 72×72 left, title + subtitle middle, optional
points-pill right, gradient-tinted backdrop in the achievement's
tier color. Auto-dismiss after 7 s, swipe-down or tap-body to
dismiss earlier.

There used to be a "tier" system that routed major events to a
big confetti modal (`LevelUpOverlay` / `AchievementUnlockOverlay`).
That's GONE — visually inconsistent, JS-thread Animated.Value,
ugly. Don't reintroduce it.

**Auto-trigger** (achievement earned / level reached): the
`GamificationProvider` listens to `achievementService` callbacks
and calls the banner internally — pages don't need to do anything.

**Manual trigger** (catalog preview taps, e.g. "tap a level/
achievement card to see what it would feel like"): use the context:

```tsx
import {
  bannerDataFromAchievement,
  bannerDataFromLevelUp,
  useGamification,
} from '@/components/ui/GamificationProvider';

const { showBanner } = useGamification();
// onPress level card:
showBanner(bannerDataFromLevelUp(level.id, prev));
// onPress achievement card:
showBanner(bannerDataFromAchievement(a));
```

`bannerDataFromX` helpers handle the lottie selection + tint color
+ tap-target navigation. Don't construct `BannerData` by hand
unless you're adding a new celebration source.

**Never** build a one-off "celebration modal" inline in a screen.
If a new celebration source appears (e.g. cashback payout), add a
new `bannerDataFromPayout` helper and route through the same
banner. ONE celebration component app-wide.

### Number formatting

- pts: `Number.toLocaleString('de-DE')` — German thousand separators
- € amounts: `value.toFixed(2).replace('.', ',') + ' €'` — comma
  decimal, ` €` suffix with space
- Achievement progress: `formatProgress(value, action)` — for
  `savings_total` returns `X,YZ €`, otherwise rounded integer.
  Don't render raw floats — Math.round catches floating-point noise.

### Cost-conscious data

- Pre-aggregate in Cloud Functions, store ONE doc, read once per
  session + cache. The leaderboard aggregator
  (`cloud-functions/leaderboard-aggregator/`) is the reference —
  nightly pubsub.schedule, `.select()` field projection on scans,
  in-memory cache + inflight-promise dedup on the client.
- For period-windowed data that can't be pre-aggregated daily
  (week/month leaderboards), use the existing per-user counters
  (`leaderboards/{uid}.stats.points.weekly`) maintained by
  `leaderboardService.updateUserStats`. Live `orderBy().limit(25)`
  query from the app, ~25 reads per session.
- NEVER scan a collectionGroup at runtime — that pattern doesn't
  scale. Index it with `.select()` at the daily-aggregator level
  or via per-user denormalised counters.

### Nutrition / Zutaten Schema (reweapify-Format)

Wir nutzen das **reweapify-Schema** als kanonisches Format für
Nährwerte und Zutaten auf `produkte/*` und `markenProdukte/*`.
Reweapify ist die Pipeline-Output-Collection von Rewes-API; wir
übernehmen ihr Schema 1:1 damit kein Mapping nötig ist.

```
// Zutaten
attr_ingredientStatement: string  // "Zucker, Glukosesirup, 15% VOLLMILCHPULVER…"
ingredientsSource:        'manual' | 'rewe' | 'ocr' | 'openfood' | 'scraper' | 'legacy'
ingredientsUpdatedAt:     Timestamp

// Nährwerte (per nutr_serving_size, default 100g)
nutr_Energie_val:                          number   nutr_Energie_unit: 'kcal' | 'kJ'
nutr_Fett_val:                             number   nutr_Fett_unit: 'g'
nutr_FettdavongesttigteFettsuren_val:      number   _unit: 'g'   // sic — Tippfehler aus reweapify
nutr_Kohlenhydrate_val:                    number   _unit: 'g'
nutr_KohlenhydratedavonZucker_val:         number   _unit: 'g'
nutr_Ballaststoffe_val:                    number   _unit: 'g'
nutr_Eiwei_val:                            number   _unit: 'g'   // sic — Eiweiß ohne ß
nutr_Salz_val:                             number   _unit: 'g'
nutr_serving_size:                         number   nutr_serving_unit: 'g'
nutritionSource:        'manual' | 'rewe' | 'ocr' | 'openfood' | 'scraper' | 'legacy'
nutritionUpdatedAt:     Timestamp
```

Trust-Hierarchie (höhere Source wird NIE überschrieben):
1. `manual` — eigene Recherche (Admin-UI / manuelle Edits)
2. `rewe`   — aus reweapify oder direkter Rewe-Pipeline
3. `ocr`    — Bilder-Erkennung von Produkt-Etiketten / Kassenbon-Photos
4. (priority chain für untrusted, newest wins within source:)
   reweapify-fill → scraper → openfood → legacy

App-Reading: `lib/utils/productNutrition.ts` `extractIngredients()`/
`extractNaehrwerte()` lesen beide Formate (legacy `naehrwerte: {}` +
`zutaten: ""` + neues `nutr_*`/`attr_ingredientStatement`) — die
Cloud Functions schreiben nur das neue Format. Sobald der Backfill
einmal durchlief sind alle Produkte im neuen Format; die Legacy-
Read-Pfade können später entfernt werden.

History-Collections:
- `nutritionhistory_produkte` / `nutritionhistory_markenProdukte`
  — Watcher schreibt Snapshots wenn untrusted Sources Werte ändern
- `pricehistory_produkte` / `pricehistory_markenProdukte` — Watcher
  schreibt JEDE Preisänderung (keine Source-Exclusion)

Cloud Functions: `cloud-functions/nutrition-history-watcher/`
(onWrite-Trigger), `cloud-functions/nutrition-backfill/` (HTTPS-Trigger
für one-shot reweapify→openfood→scraper Backfill).

### KI-Analyse (ai-product-comparison) — Architektur ab v15

NoName-vs-Markenprodukt-Bewertung (5-Punkte-Skala 1=rot…5=grün) +
faktischer Begründungstext. Liegt in `cloud-functions/ai-product-comparison/`.

**Hybrid-Prinzip (seit v14): Mathematik macht Code, nicht die KI.**
- `src/scorer.js` rechnet Nährwerte + Labels DETERMINISTISCH (0%
  Halluzination, konsistent, gratis). Ein Unterschied zählt nur wenn er
  BEIDE Schwellen reisst: relativ ≥8% UND absolut ≥`minAbs` (gegen das
  Small-Base-Problem: satFat 0,7 vs 0,4g = +75% rel. aber nur 0,3g abs.
  → irrelevant). `combineScore` hat asymmetrischen NoName-Tilt: +2.5
  für "besser", -3.5 für "schlechter" (kleine Original-Vorteile bleiben
  "gleichwertig"). NIE die Score-Mathe wieder ins LLM zurückverlagern.
- Das LLM (`src/comparator.js`, gemini-3.5-flash) liefert NUR noch
  `{ingredientVerdict, reasoning}` — Zutaten-Qualität + Fakten-Text,
  KEINEN Score. Das verhindert die alte v1-v13-Inkonsistenz (Score
  widersprach dem Reasoning).

**Fallback-Kette (nie "skippen wenn irgendwas fehlt"):**
- NoName ohne markenProdukt-Link → Standalone-Assessment
  (`src/assessor.js`, kategorie-relativ → Schoki wird an Schoki gemessen,
  nicht an Salat). Landet in `aiAssessment`.
- NoName MIT Link, aber Marke (noch) ohne Daten → ebenfalls Standalone-
  Assessment des NoName, NICHT skippen. Sobald die Marke gepflegt wird,
  springt der echte Vergleich an und überschreibt es.
- Nur wenn das NoName SELBST keine Daten hat → `aiComparison.skipped`.
- `aiComparison` und `aiAssessment` werden gegenseitig gelöscht
  (FieldValue.delete) → die UI sieht nie beide. Beide Detail-Screens
  (`noname-detail`, `product-comparison`) rendern `AiComparisonScale`
  und fallen auf `AiHealthScale` (aiAssessment) zurück.

**Debounce — trailing, 1h (NICHT sofort triggern):**
- Trigger (onCreate/onUpdate/onMarkenProduktUpdate) bewerten NICHT
  sofort, sondern setzen nur `aiComparisonDirtyAt = serverTimestamp()`.
  Jede relevante Änderung bumpt den Timestamp.
- `processPendingComparisons` (scheduled, alle 15 Min) verarbeitet nur
  Produkte deren letzte Änderung ≥1h her ist. So läuft die KI nicht 5×
  während ein Scraper/Admin mehrere Felder nacheinander pflegt. Flag-
  Clear ist transaktional (löscht nur wenn `dirtyAt` unverändert, sonst
  würde eine Änderung während des Gemini-Calls verschluckt).
- WICHTIG: `aiComparisonDirtyAt` darf NICHT in `RELEVANT_PRODUKTE_FIELDS`
  stehen — sonst triggert das Setzen des Flags einen Re-Trigger-Loop.
- `scheduledComparisonBackfill` (cursor-basiert) macht den Komplett-
  Durchlauf und resettet automatisch bei `PROMPT_VERSION`-Bump → ein
  Versions-Bump = sauberes Re-Backfill aller ~7321 Produkte.
- HTTPS `runComparisonForProduct?key=…&produktId=…&force=1` läuft sofort
  + force (debug/admin). TRIGGER_KEY = Secret `NUTRITION_SCRAPER_TRIGGER_KEY`.

**Hersteller-Einschätzung (`src/manufacturer.js`, ab Mai 2026):**
- PRO HERSTELLER einmal berechnet (`hersteller/{id}.aiHersteller`), NICHT
  pro Produkt — derselbe Hersteller wird nicht 50× bewertet. Die App liest
  es über die `hersteller`-Reference, die im Produkt-Detail eh geladen wird
  (folgt der Marke→Hersteller-Kette, also der echte Maker, kein Platzhalter).
- KEIN Score (User-Vorgabe) — reine Info-Karte `AiManufacturerCard`:
  `{herkunft}` (Badge) + `{summary}` (2-4 Sätze).
- ZWEI Collections (User-Klärung 2026-05-29):
  • `hersteller` = MARKEN (haben `herstellerref` → hersteller_new, `bild`=
    Markenbild). `markenProdukte.hersteller` zeigt hierauf.
  • `hersteller_new` = die ECHTEN Hersteller. `produkte.hersteller` zeigt
    hierauf — DAS liest die NoName-Produktkarte. Beide werden bewertet
    (eigene Trigger + Backfills + State-Docs).
- UI-Platzierung:
  • noname-detail + product-comparison: `AiManufacturerCard` für den
    Hersteller des NoName (`p/picked.hersteller` = hersteller_new) UNTER
    der KI-Analyse.
  • product-comparison Hero: das (i)-Info-Icon am Markenprodukt-Hersteller
    öffnet ein FilterSheet mit: Markenbild + kuratierten `infos` (= die
    MARKE) und GENAU EINER KI-Hersteller-Karte (`mp.hersteller.aiHersteller`
    = hersteller_new). KEINE zweite KI-Karte für die Marke — die wäre
    Hersteller-artig redundant, v.a. wenn Marke = Hersteller (z.B. Bauer /
    J. Bauer GmbH & Co. KG). Die Marke-Bewertung auf collection `hersteller`
    läuft zwar weiter, wird hier aber NICHT als eigene Karte gezeigt.
- Inhalt = Modell-Wissen: neutrale Herkunft/Einordnung + NUR breit
  dokumentierte, unstrittige Kontroversen, DEFENSIV formuliert ("stand in
  der Kritik wegen…"). NIE erfinden; unbekannter Hersteller → nur Herkunft.
  Grund: falsche Skandal-Behauptung = Rufschädigungs-Risiko. Trainingsstand,
  keine Live-News → Transparenz-Hinweis in der Karte.
- Trigger: `onHerstellerCreate/Update` (sofort, ~968 Hersteller = geringes
  Volumen, kein Debounce nötig) + `scheduledManufacturerBackfill` (cursor,
  `aggregates/aiHerstellerBackfill`, Reset bei `MANUFACTURER_PROMPT_VERSION`-
  Bump). Platzhalter ("z - NoName", Single-Char) → `skipped:'no-name'`.
- HTTPS `runManufacturerForHersteller?key=…&herstellerId=…&force=1`.

### Cashback-Pipeline kann schon OCR + Zeilen-Positionen (nicht neu bauen!)

`cloud-functions/cashback-pipeline` (Gemini-OCR, `lib/ocr.js extractReceipt`)
liefert PRO BON bereits: `items[] {name, priceCents, qty}` + `bonDate` +
Total, dazu Merchant-Resolver (→ Discounter, `lib/merchant.js`), Σ-vs-Total-
Reconciliation + DocAI-Fallback. Schreibt `users/{uid}/purchased_products/
{cashbackId_slug}` mit `{itemName, priceCents, qty, receiptId, bonDate,
merchantId/Name/Land}`. → Bon-Rohdaten + Markt + Preis + Datum pro Position
sind PROD-erprobt da. Beim Thema „Bon-Artikel zuordnen / Journey abschließen"
(ClickUp 86ca0wbg7) NICHT die OCR neu bauen. Was FEHLT ist nur: (1) Zuordnung
`itemName` → unsere `produkte`/`markenProdukte`-`productId` (Klassifikation +
KI-Normalisierung + Vektor-Shortlist + KI-Pick + Alias-Lexikon), (2) Preis-
verlauf-Verknüpfung (`pricehistory_*`/`observedPrice` + Einheiten-Norm),
(3) Journey/Zettel-Abschluss (`sourceJourneyId` + Outcome-Resolver Bon+Abhaken,
dedupe), (4) not-in-catalog → ExternalLookupMiss, (5) BigQuery-Export (B2B).
Bonus: Match-Precision lässt sich direkt an den bereits gesammelten
`purchased_products` messen (kein separater OCR-Spike nötig).

## Other notes

- TypeScript strict; `tsc --noEmit -p tsconfig.json` is the
  pre-deploy gate.
- Firebase project: `markendetektive-895f7`. Cloud Functions deploy
  via Node 22 (`nvm use 22`), CLI `firebase-tools` ≥ 15.15.
- Firestore rules: aggregates doc path is `aggregates/leaderboard_v1`,
  `allow read: if true; allow write: if false`. Write is admin-only
  (Cloud Function).
- Achievements + leaderboards data lives at:
    - `users/{uid}.stats.{pointsTotal, currentLevel, currentStreak, …}`
    - `users/{uid}/ledger/{id}` — per-event point ledger
    - `users/{uid}/purchases/{id}` — purchase history with savings
    - `leaderboards/{uid}` — per-user weekly/monthly counters
    - `aggregates/leaderboard_v1` — nightly pre-built top lists +
      percentile thresholds
    - `gamification/config/levels` — Level catalogue (loaded via
      `achievementService.getAllLevels()`)
    - `achievements/*` — Achievement catalogue

## iOS Dev-Client aufs PHYSISCHE iPhone (install + launch + Metro)

Lokale JS-Tests → Metro (siehe oben). Wenn die App auf dem physischen
iPhone NICHT installiert ist ODER ein NATIVE/Swift/Pod-Change getestet
werden muss (mehrfach durchexerziert, sonst 1 h verloren):
1. Device: `xcrun devicectl list devices` → UUID. Bundle-ID
   `de.markendetektive` (Dev + Prod teilen sie → nur EINE gleichzeitig
   installierbar; ein TestFlight-Build überschreibt den Dev-Client).
2. Bauen+installieren (NUR bei Native-Change; JS reicht Metro):
   `npx expo run:ios --device <udid> --configuration Debug`. Build klappt
   meist, aber **Expos Install-Schritt flaket oft mit „Error: null"** →
   dann manuell: `xcrun devicectl device install app --device <id>
   ~/Library/Developer/Xcode/DerivedData/MarkenDetektive-*/Build/Products/Debug-iphoneos/MarkenDetektive.app`.
3. App MIT Metro-Verbindung starten (Dev-Client-Deep-Link):
   `xcrun devicectl device process launch --terminate-existing --device <id>
   --payload-url "markendetektive://expo-development-client/?url=http://<LAN-IP>:8081" de.markendetektive`.
   Scheme: seit Juni 2026 sind BEIDE registriert — `app.json` hat
   `"scheme": ["markendetektive", "markendetektivern"]`. `markendetektive` ist
   der saubere (passt zu slug + bundle `de.markendetektive`); `markendetektivern`
   (mit n, Altlast aus dem RN-Rewrite) bleibt nur für Backward-Compat. Neuer
   Dev-Launch nutzt `markendetektive://…`; der alte rn-Scheme geht weiter.
   Beides greift erst nach einem nativen Rebuild (Scheme → Info.plist /
   AndroidManifest beim Prebuild). LAN-IP via `ipconfig getifaddr en0`.
   **iPhone muss ENTSPERRT sein** (sonst „device was not unlocked").
4. Fehler „[runtime not ready]: Exception in HostFunction … EXDevMenuApp"
   = Dev-Client-Hänger (oft nach Fast-Refresh / Metro mit `--clear` mitten
   im Rebuild), KEIN Bundle-Fehler. Fix: Metro warm neu starten + Launch
   aus Schritt 3 (terminate-existing).
5. JS hot-reloadet über den verbundenen Dev-Client; nur Native (`modules/*`,
   Pods, Info.plist) braucht den Rebuild.

## Admin-SDK / Firestore lokal + CF-Deploy

- Firestore-Admin lokal: `/tmp/sa.json` (Firestore-berechtigter Service-
  Account). Skripte aus einem CF-Ordner MIT `firebase-admin` laufen lassen
  (z.B. `cloud-functions/preference-profile-cf`), `node --check` vorher.
  Die Play-Store-SA `markendetektive-895f7-ee3923910ddd.json` hat KEINE
  Firestore-Rechte.
- CF-Deploy (Node 22, firebase-tools ≥15.15):
  `PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx firebase-tools@15.15.0
  deploy --only "functions:<codebase>" --project markendetektive-895f7 --non-interactive`.
  Bei kombiniertem Multi-Codebase-Deploy flaket Gen1 reproduzierbar beim
  Cold-Load („Function … is not defined") → einzelne Codebase solo redeployen
  geht durch.
- Gemini: Secret `GEMINI_API_KEY` + `@google/genai`, Modell
  `gemini-3.5-flash`, Setup in `cloud-functions/ai-product-comparison`
  (wiederverwendbar). Key lesen: `firebase-tools functions:secrets:access`.

## Cashback-Pipeline — Architektur-Map + Learnings (Task 86ca0wbg7)

Flow: `enqueueCashback` (https.onRequest; billige Pre-OCR-Dedups: Byte-Hash
`capture.hash` + Perceptual-dHash mit count+zeit-bounded Hamming-Scan) →
PubSub → `processCashback` (onMessagePublished; OCR → Reconciliation →
DocAI-Eskalation → Dedup → Gates → Ledger). Region `europe-west3`.

Docs/Collections:
- `receipts/{id}` = Haupt-Bon-Doc (OCR, capture, journey, nested
  `merchant:{id(slug),discounterId,land,name,raw,matchedScore}`).
  **Dedup prüft NUR gegen `receipts`** (contentHash/transactionHash/itemsHash =
  indizierte Equality, schließen sich selbst via `doc.id===cashbackId` aus).
- `users/{uid}/cashback_status/{id}` = schlanker Mirror — **das liest die APP**
  (Meine Bons + Ausgaben).
- `users/{uid}/purchased_products/*` = OCR-Artikel pro Bon (fürs Matching;
  Kategorie liegt unter `productData.kategorie`, Ersparnis `productData.ersparnis`,
  Hersteller `productData.hersteller` — Top-Level ist leer/0/null).
- `users/{uid}/cashback_ledger/*` = Geld-Ledger (earn/reverse/payout),
  idempotent per `receiptId`. Balance `cashback_balance_cents`/
  `cashback_lifetime_cents`; Counter `cashback_monthly`/`cashback_campaign_weekly`/
  `cashback_campaign_totals`.
- `cashback_campaigns/{slug}` = Aktionen. Feld `maxAgeDays` (Bon-Alter-Limit,
  global Default `MAX_BON_AGE_DAYS=9999`), `budgetRemainingCents`/`budgetTotalCents`,
  `cashbackPerBonCents`/`tiers`/`weeklyBonCap`/`maxPerUserCents`.

Gotchas:
- **Markt-ID-Bruch:** `produkte.discounter` = zufällige `discounter`-DocID,
  `merchantId` = Slug („edeka"). Resolver (lib/merchant.js) gibt jetzt
  `discounterId` (echte DocID) zurück → Markt-Matching + App-Logo. Frontend
  löst land-aware auf (discounterId → Slug/Name-Fallback) via
  `FirestoreService.getDiscounter()`.
- **Pfand zählt NICHT** als eligible: `isPfandItem()` in lib/ocr.js
  (`category==='Pfand'` ODER name~pfand/leergut) → in `countEligibleItems`
  + beide per-Item-`eligible`-Flags. Reconciliation UNBERÜHRT.
- **Retry app-level (KEIN PubSub-Dead-Letter):** `MAX_PROCESS_ATTEMPTS=5`;
  transient → NICHT voreilig „rejected" (Mirror bleibt in-progress), nur
  `attempts`/`lastError` + throw; nach Max → `max_retries_exceeded`.
  **OCR-Idempotenz:** OCR sofort am Doc persistieren (`buildOcrField`), Retry
  nutzt sie → kein erneuter Gemini-Call.
- **Test-Reset eines Users:** NUR `receipts` löschen reicht NICHT (→ Doppel-
  Gutschrift, Geister-Historie, Budget-Leck). Sauber = `receipts`(des Users) +
  `cashback_status` + `purchased_products` + `cashback_ledger` löschen +
  User-Cashback-Felder zurücksetzen + `budgetRemainingCents` je Kampagne um den
  vom User verbrauchten Betrag (Ledger `earn`−`reverse` je `campaignId`) zurückgeben.
- **App-Reject-Texte ohne Hardcode:** Pipeline schreibt angewandte `maxAgeDays`
  in den Mirror, App zeigt die echte Zahl (pending/[id].tsx + GamificationProvider).
- **Scanner-Crop** (modules/bon-edge-detector/ios/BonVision.swift,
  `warpAndWriteJPEG`): KEIN uniformes Skalieren um den Schwerpunkt (über-padded
  bei langen schmalen Bons oben/unten). Kanten-spezifisch: `warpLeftPad=0.012`.

## Bon→Produkt-Matching — validierter Ansatz (Task 86ca0wbg7)

KI-Matcher = **markt-gefilterte Shortlist → Gemini-3.5-flash-Pick →
selbstlernendes Alias-Lexikon (`receiptAliases`)**. An 251 echten
`purchased_products`-Zeilen bewiesen: KI löst Eigenmarken-Kürzel (G&G/KLC/GL/
KB) + Markt+Preis brillant (avg conf 0,92), Pfand/Frische-Eligibility
out-of-the-box. **map-rate 26% — Flaschenhals ist NICHT die KI**, sondern
Katalog-Abdeckung (NoName Aldi/Lidl/Kaufland-lastig, EDEKA/Netto/Hofer dünn)
+ Retrieval-Recall. Die Lücken = Nachfrage-Signal für 86ca33pum (bezahlte
Erfassung). **Kosten:** KI pro NEUEM String (alias-gecacht), nicht pro Bon-Zeile
→ ~gratis bei Skalierung. Nächster Bau-Schritt: Production-Matcher-CF
(`receipt-matcher`, Trigger pro Bon → Lexikon-Lookup → Shortlist → Gemini-Pick
→ receiptAlias/receiptMatch + Journey-Closure).
</content>

## Cashback-OCR — Architektur + teure Learnings (Juni 2026)

Bon-OCR läuft **server-seitig** (`cloud-functions/cashback-pipeline`), NICHT
in der App — Metro/TestFlight/App-Version beeinflussen die Erkennung NICHT.

- **Engine-Auswahl kommt aus `.env`, NICHT aus dem Code-Default.**
  `CASHBACK_OCR_ENGINE` in `cloud-functions/cashback-pipeline/.env` überschreibt
  `const OCR_ENGINE = (process.env... || 'default')`. Ich habe einmal nur den
  Code-Default geändert + deployed → wirkungslos, weil `.env=cv-hybrid` gewann.
  **Beim Ändern der Engine IMMER `.env` anfassen, nicht nur den Code.** (Deploy-
  Log zeigt „Loaded environment variables from .env" — das ist der Hinweis.)
- **Default-Engine = `gemini-direct`** (Bild → Gemini, `lib/ocr.js` +
  `lib/prompt.js` v1.3 + `lib/ocr_robust.js`). **`cv-hybrid`** (Cloud Vision
  flat-text → Gemini, `lib/ocr_cvhybrid.js` + `lib/prompt_text.js`) ist NUR
  Rollback: Cloud Vision linearisiert vertikal **versetzte Preis-Spalten**
  falsch interleaved (Namen/Preise vertauscht) → die Geometrie ist im flachen
  Text verloren, kein Text-Prompt rettet das. **Beim OCR-Validieren IMMER die
  ECHTE Prod-Engine testen, nicht den Legacy-Pfad** (ich habe erst `prompt.js`
  gefixt+validiert, während Prod `cv-hybrid` lief → Fix griff nie).
- **Robust-OCR (`lib/ocr_robust.js`):** liest das Bild mehrfach, vertraut dem
  was unabhängige Läufe auf **Sequenz-Ebene** (`name#priceCents`) übereinstimmen
  (fängt Swaps/Kompensation die Σ==Total NICHT sieht). Early-stop bei 2er-
  Agreement; sonst Eskalation auf `gemini-2.5-pro`. `confidence` (high/medium/
  low/none) landet in `receipts/*.ocr.robust`.
- **Σ(items)==totalCents ist KEIN vollständiges Korrektheits-Orakel** (Swaps +
  kompensierende Fehler + Pfand-Toleranz ±200ct bleiben unsichtbar). Auto-
  Freigabe sollte langfristig zusätzlich an `ocr.robust.confidence==='high'`
  hängen + low → User-Tap/Review.
- **Modell:** `gemini-3.5-flash` primär, `gemini-2.5-pro` Eskalation. An echten
  Bons: 3.5-flash 30/42 reconcile-clean vs 2.5-flash 18/42; pro ~33% teurer.
- **Bildqualität ist der eigentliche Engpass** (Knicke durch Ziffern), nicht das
  Modell-Reasoning. 2×-Upscale+Kontrast+Schärfen hebt harte Bons messbar
  (1/6→5/6) — noch NICHT in der Pipeline (bräuchte `sharp`).
- **Testen:** ein NEU fotografierter Bon läuft frisch; exakt dasselbe Bild-File
  trifft per Dedup (`receipts` contentHash) das alte gecachte Ergebnis.
