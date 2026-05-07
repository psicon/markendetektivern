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
auf EAS-Servern weiter. Submit zu Play Store / TestFlight
passiert via `production`-Submit-Profile (siehe `eas.json`):
- iOS: appleId `patrick@markendetektive.de`, ascAppId `6471081082`
- Android: serviceAccount `markendetektive-895f7-ee3923910ddd.json`

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

**Obsolete (delete or stub):**
- ❌ `app/leaderboard.tsx` — replaced by the Bestenliste tab on
  `(tabs)/rewards.tsx`. Internal route still exists; nothing
  in the new design points to it.

When marking a screen done, MOVE it from "Open" to "Done" in this
table. If a previously-redesigned screen gets touched and
regresses, move it back. Don't trust memory across sessions.

## Design system rules (apply everywhere, retroactively too)

These are the rules established while building the Belohnungen +
Errungenschaften screens. Every new screen should reuse these
components/values 1:1 — no parallel re-inventing.

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

`lib/firebase.ts` uses `getFirestore(app)` — plain in-memory
cache. **DO NOT** switch to `initializeFirestore` with
`persistentLocalCache` / `persistentSingleTabManager` in this
project. Those are **web-only** APIs (IndexedDB-backed); on React
Native the SDK code path triggers a runtime crash via
`new NativeEventEmitter()` because PushNotificationIOS's native
module no longer exists in modern RN. We learned this the hard
way once — it lost half a day. The in-memory caches in
`services/firestore.ts` (5-min TTL + inflight-promise dedup) +
the manually-cached `getDocumentByReference` are what give us the
revisit speed.

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
</content>
