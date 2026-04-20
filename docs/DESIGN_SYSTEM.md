# MarkenDetektive Design System

> Living document — update whenever the prototype or implementation diverges.  
> Prototype source: `markendetektive_newdesign/project/` (canonical reference).

---

## 1. Scope & Principles

- **Prototype is law.** Implement pixel-perfect from `markendetektive_newdesign/`. Deviations need explicit approval.
- **Real images first.** Firestore `bild` fields (produkte, markenProdukte, discounter, handelsmarken) are always primary. Gradient + emoji fallback only when no image URL exists.
- **Single icon library.** MaterialCommunityIcons (`@expo/vector-icons/MaterialCommunityIcons`) everywhere. No SF Symbols. No hybrid.
- **Dark mode committed.** All tokens have light + dark values. No exceptions.
- **4 pt grid.** All spacing is a multiple of 4.

---

## 2. Color Tokens

### Brand Constants (`--md-*`) — never theme-swap

| Token | Value | Usage |
|---|---|---|
| `md.primary` | `#0d8575` | Primary actions, FAB, active states |
| `md.primaryDark` | `#0a6560` | Pressed states |
| `md.secondary` | `#42a968` | Secondary accent |
| `md.accent` | `#f5720e` | Highlights, badges, CTAs |
| `md.accentSoft` | `#fff3eb` | Tinted accent backgrounds |
| `md.error` | `#d32f2f` | Errors |
| `md.success` | `#2e7d32` | Success states |
| `md.warning` | `#f57c00` | Warnings |

### Theme Tokens (`--th-*`) — swap light ↔ dark

| Token | Light | Dark | Usage |
|---|---|---|---|
| `th.bg` | `#f5f7f8` | `#0f1214` | Page background |
| `th.surface` | `#ffffff` | `#1a1f23` | Cards, sheets |
| `th.surfaceAlt` | `#f0f4f5` | `#242b30` | Secondary surface |
| `th.border` | `rgba(25,28,29,.08)` | `rgba(255,255,255,.08)` | Dividers, borders |
| `th.borderStrong` | `rgba(25,28,29,.16)` | `rgba(255,255,255,.16)` | Visible borders |
| `th.text` | `#191c1d` | `#e8eced` | Primary text |
| `th.textSub` | `#5c6769` | `#8a9699` | Secondary text |
| `th.textMuted` | `#8fa1a5` | `#5c6769` | Disabled/hint text |
| `th.primary` | `#0d8575` | `#14b39a` | Primary (theme-aware) |
| `th.primaryContainer` | `#e0f5f1` | `#0d3530` | Chip/badge backgrounds |
| `th.onPrimary` | `#ffffff` | `#ffffff` | Text on primary |
| `th.accentContainer` | `#fff3eb` | `#3d2010` | Accent chip backgrounds |
| `th.overlay` | `rgba(25,28,29,.48)` | `rgba(0,0,0,.64)` | Modal scrims |
| `th.shimmer1` | `#e8eced` | `#1a1f23` | Skeleton loading |
| `th.shimmer2` | `#f5f7f8` | `#242b30` | Skeleton highlight |

### Stufen (Similarity Levels)

| Level | Name | Color |
|---|---|---|
| 1 | Sehr ähnlich | `#ef2d1a` (red) |
| 2 | Ähnlich | `#f5720e` (orange) |
| 3 | Teilweise ähnlich | `#fbc801` (yellow) |
| 4 | Wenig ähnlich | `#73c928` (light green) |
| 5 | Kaum ähnlich | `#0d8575` (petrol) |

Stufe color access: `STUFE_COLORS[level]` — used in dots, rings, badges.

---

## 3. Typography

Font family: **Nunito** (variable, weights 200–1000). Load via `expo-font`.

| Scale name | Weight | Size | Line height | Usage |
|---|---|---|---|---|
| `display` | 800 | 32px | 38px | Hero/splash text |
| `h1` | 700 | 28px | 34px | Screen titles |
| `h2` | 700 | 22px | 28px | Section headers |
| `h3` | 700 | 18px | 24px | Card titles |
| `title` | 700 | 16px | 22px | List item titles |
| `body` | 400 | 14px | 20px | Default body copy |
| `caption` | 500 | 12px | 16px | Secondary labels |
| `label` | 500 | 11px | 14px | Tags, chips |
| `price-big` | 800 | 40px | 46px | Price display |

---

## 4. Spacing

All spacing is a multiple of 4.

```
xs:  4
sm:  8
md: 12
lg: 16
xl: 20
2xl: 24
3xl: 32
4xl: 40
```

Page horizontal padding: **16** (lg).  
Section vertical gap: **24** (2xl).

---

## 5. Border Radius

| Token | Value | Usage |
|---|---|---|
| `radius.xs` | 4 | Input fields, small chips |
| `radius.sm` | 8 | Buttons, standard chips |
| `radius.md` | 12 | Cards |
| `radius.lg` | 16 | Large cards, bottom sheets |
| `radius.xl` | 18 | Modals |
| `radius.2xl` | 25 | Hero cards |
| `radius.full` | 9999 | Pills, FAB, avatars |

---

## 6. Shadows

| Token | Value | Usage |
|---|---|---|
| `shadow.sm` | `0 1px 3px rgba(25,28,29,.04)` | Subtle lift |
| `shadow.md` | `0 2px 8px rgba(25,28,29,.08)` | Cards |
| `shadow.lg` | `0 4px 16px rgba(25,28,29,.12)` | Modals, drawers |
| `shadow.fab` | `0 4px 12px rgba(13,133,117,.30)` | FAB (tinted) |

Dark mode: reduce opacity by ~50% on all shadows.

---

## 7. Motion

| Token | Duration | Usage |
|---|---|---|
| `motion.fast` | 120ms | Micro-interactions (tap highlight, checkbox) |
| `motion.default` | 220ms | Standard transitions (sheet open, tab switch) |
| `motion.slow` | 380ms | Complex entrance animations |

Easing: `ease-out` for entrances, `ease-in-out` for morphs.

---

## 8. Component Inventory

### PrimaryButton
- Gradient: `linear-gradient(135deg, #42a968, #0d8575)`
- Height: 52, radius: `full`
- Font: `title` weight 700
- Shadow: `shadow.fab` (tinted green)
- States: normal → pressed (scale 0.97) → loading (spinner)

### SecondaryButton
- Background: `th.surfaceAlt`, border: `th.borderStrong`
- Same sizing as Primary

### Chip
- Background: `th.primaryContainer`, text: `th.primary`
- Padding: 6×12, radius: `full`, font: `label`
- Variant `accent`: background `th.accentContainer`, text `md.accent`

### StufeBadge / StufeDot / StufeRing
- Color from `STUFE_COLORS[level]`
- Badge: pill with level number + optional label
- Dot: 10px circle, filled
- Ring: circular border around product image (3px stroke)

### StufenBar
- Horizontal bar showing all 5 levels with color segments
- Active level highlighted

### MarketPill / MarketBadge
- Shows discounter short code (e.g. "LI", "AL")
- Background: `discounter.color` from Firestore (NOT hardcoded)
- Text: white, font: `label` 700

### ProductCard
- Image (Firestore `bild`) with `StufeRing` overlay
- Title (`title`), brand name (`caption`), price (`body`)
- MarketPill in top-right corner
- Fallback: category gradient + emoji when no image

### BrandLogo
- Circular container, white background
- Image from Firestore markenProdukte `bild`
- Background tinted by brand color (see §12)

### TabBar
Three tabs: **Home** | **Stöbern** (center FAB, raised) | **Rewards**
- Active: `md.primary` fill
- Inactive: `th.textMuted`
- FAB: gradient, 56px, `shadow.fab`, slightly elevated (+8px from bar)
- No text labels on tabs (icons only)

### DetectiveMark (logo SVG)
- Used as watermark on Cashback CTA card (opacity 0.08)
- Available as inline SVG component from `components.jsx`

### Morphing Header
- Scroll 0–30px: logo + app title visible
- Scroll 30–85px: morph transition
- Scroll 85px+: compact search bar
- Used on Home. All other screens use same height/behavior (uniform).

---

## 9. Screen Map

| Prototype file | Current route | Branch target |
|---|---|---|
| `Home.jsx` | `app/(tabs)/index.tsx` | `feat/design-implementation-home` |
| `Search.jsx` | `app/(tabs)/stobern.tsx` | `feat/design-implementation-search` |
| `Rewards.jsx` | `app/(tabs)/rewards.tsx` (new) | `feat/rewards-ui` |
| `ProductDetail.jsx` | `app/product/[id].tsx` | `feat/design-implementation-product` |
| `ProductCompare.jsx` | `app/compare/[id].tsx` | `feat/design-implementation-product` |
| `Profile.jsx` | `app/profile/index.tsx` | `feat/design-implementation-profile` |
| `Scanner` (inline) | `app/scanner.tsx` | `feat/design-implementation-home` |
| Settings/Tipps/Legal | `app/profile/settings.tsx` etc | `feat/design-implementation-profile` |

---

## 10. Icon Policy

**Single source:** `MaterialCommunityIcons` from `@expo/vector-icons/MaterialCommunityIcons`.  
**No SF Symbols.** No `IconSymbol` wrapper.

### Usage
```tsx
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
<MaterialCommunityIcons name="home" size={24} color={color} />
```

### Material Symbols → MDI Mapping (prototype TabBar exceptions)

| Prototype uses (Material Symbols) | MDI equivalent | Notes |
|---|---|---|
| `home` | `home` | Direct match |
| `emoji_events` | `trophy` | Rewards tab |

### Common MDI Names Used in Prototype

| Action | MDI name |
|---|---|
| Search | `magnify` |
| Scanner/Barcode | `barcode-scan` |
| Cart | `cart-outline` |
| Favorites | `heart-outline` / `heart` |
| Share | `share-variant` |
| Back | `arrow-left` |
| Close | `close` |
| Settings/Gear | `cog` |
| Filter | `filter-outline` |
| Camera | `camera` |
| Flash | `flash` / `flash-outline` |
| Sparkle/AI | `auto-fix` |
| Trophy | `trophy` / `trophy-outline` |
| Gift | `gift-outline` / `gift` |
| Euro | `currency-eur` |
| Receipt | `receipt` |
| Refresh | `refresh` |
| Menu | `menu` |
| Info | `information` |
| Check | `check` |
| Star | `star-outline` / `star` |
| Flame/Hot | `fire` |

### Retire List
- `components/ui/IconSymbol.tsx` — delete after full migration
- `components/ui/IconSymbol.ios.tsx` — delete after full migration
- All `import { IconSymbol }` usages must be replaced with direct MDI imports

---

## 11. Image Strategy

### Priority order
1. Firestore `bild` field (URL string) — always render if present
2. Gradient fallback (category color) + emoji placeholder — only when `bild` is null/empty

### Firestore collections with images
| Collection | Field | Usage |
|---|---|---|
| `produkte` | `bild` | Product images in cards |
| `markenProdukte` | `bild` | Brand product images |
| `discounter` | `bild`, `color` | Market logos + badge colors |
| `handelsmarken` | `bild` | Private label logos |

### Category gradient fallback
Use category-specific gradient + emoji. Never use a generic grey placeholder.

---

## 12. Brand Color Strategy

### Discounter colors
- **Source:** `discounter.color` field in Firestore (hex string)
- Use directly for `MarketPill` / `MarketBadge` backgrounds
- Never hardcode discounter colors in app code

### Brand (Marke) colors
- **Not in Firestore** — must be derived from logo image
- **Strategy:** Runtime extraction via `react-native-palette` or `@flyskywhy/react-native-image-colors`
- Extract dominant color from `markenProdukte.bild`
- Cache result in AsyncStorage keyed by `markeId`
- Fallback: `md.primary` until extraction completes
- Future: server-side precomputation into Firestore field `markenProdukte.brandColor`

---

## 13. Tab Structure

### New tab layout (replaces current Home | Stöbern | Mehr)

| Tab | Icon | Route |
|---|---|---|
| Home | `home` (MDI) | `app/(tabs)/index.tsx` |
| Stöbern (FAB center) | gradient FAB with `magnify` or `barcode-scan` | `app/(tabs)/stobern.tsx` |
| Rewards | `trophy` (MDI) | `app/(tabs)/rewards.tsx` |

### Mehr → Rewards migration
- Current `app/(tabs)/mehr.tsx` content moves to Profile submenu
- Settings, Tipps, Legal: move under `app/profile/` as sub-screens
- Profile accessible via avatar icon in Home header (not a tab)

---

## 14. Scanner Access Rules

Scanner is accessible **only** via:
1. Home screen primary CTA button
2. Schnellzugriff quickcard "Kassenbon scannen"

**NOT accessible via:**
- Long-press anywhere
- Dedicated scanner tab
- Any other entry point

---

## 15. Paywall / Access Rules

### RevenueCat — ad-free only
- **Primary entitlement:** `ad_free` (removes banner + interstitial ads)
- **Legacy entitlement (grandfathered):** `MarkenDetektive Premium` — still recognized in
  `isAdFreeCustomer()` so bestehende Abonnenten weiterhin ad-free sind.
- `lib/config/revenueCatConfig.ts` exportiert `AD_FREE_ENTITLEMENTS` (Array) und
  `isAdFreeCustomer(customerInfo)` — überall wo Ad-Free geprüft wird, diesen
  Helper nutzen (nie einzelnen Entitlement-String vergleichen).
- Paywall-Kontexte reduziert auf `ONBOARDING` + `DEFAULT`. Die drei Legacy-Helper
  `showCategoryUnlockPaywall`/`showProfileUpgradePaywall`/`showFeatureGatePaywall`
  bleiben vorhanden (als `@deprecated`) und zeigen jetzt alle die Standard-Paywall.

### Dashboard-Koordination (muss separat erfolgen)
- [ ] In RevenueCat ein Entitlement `ad_free` anlegen
- [ ] Alle bestehenden Produkte (weekly/monthly/annual/lifetime) an `ad_free` binden
- [ ] Bestehende aktive Subs entweder auf beide Entitlements mappen oder via
      RC-Sync auf `ad_free` migrieren
- [ ] Sobald Migration abgeschlossen: `LEGACY_PREMIUM` aus Code entfernen
- [ ] Offering `AdFree` (+ optional `AdFreeOnboarding`) im Dashboard einrichten

### Category access — Gamification gating
- **All categories free** except Alkohol
- **Alkohol**: requires Level 3 (`Produktdetektiv`)
- `categoryAccessService` pflegt eine `GATED_CATEGORIES`-Konstante (derzeit
  `{ alkohol: 3 }`). Firestore-Werte von `getsFreeAtLevel` werden für die
  Gating-Entscheidung ignoriert — App ist Single Source of Truth.
- `isPremium`-Parameter am Service ist `@deprecated` (bleibt aus API-Gründen,
  hat aber keine Wirkung mehr; Premium entsperrt keine Kategorien).
- `LockedCategoryModal` bleibt für das Alkohol-Gate. Die Premium-Kauf-CTA im
  Modal ist obsolet (nicht Teil dieses Commits) und sollte im zugehörigen
  Design-Implementation-Branch entfernt werden — verbleibender Unlock-Pfad:
  Level-Up oder 24-h-Rewarded-Ad-Unlock.
- Optional / separate Migration: In Firestore `getsFreeAtLevel` für alle
  Kategorien außer Alkohol auf 0 setzen, damit DB und App-Regeln matchen.

### Level names
| Level | Name |
|---|---|
| 1 | Sparanfänger |
| 2 | Schnäppchenjäger |
| 3 | Produktdetektiv |
| 4 | Markenkenner |
| 5 | MarkenDetektiv |

---

## 16. Rewards / Cashback Scope (Task 5)

**Frontend-only** — no Firestore writes, no Cloud Functions, no OCR.

### Service: `rewardsMockService`
- Lives in `services/rewardsMockService.ts`
- Returns mock data for all Rewards screen queries
- Simulates: Taler balance, weekly limits, submission history, leaderboard, reward catalogue
- Real backend (fraud protection, OCR, payouts) is a separate future project

### Constants
| Constant | Value |
|---|---|
| `CASHBACK_EUR` | 12.40 |
| `PAYOUT_THRESHOLD` | 15.00 |
| Receipt limit | 6/week @ 0.08€ each |
| Photo limit | 20/week @ 0.10€ each |

### Rewards tabs
1. **Einlösen** — Cashback-Taler balance + redemption catalogue
2. **Bestenliste** — Weekly leaderboard

### Photo wizard steps (frontend simulation only)
1. Produktfront
2. Rückseite
3. EAN/Barcode
4. Zutaten
5. Nährwerte
6. Hersteller
7. Preisschild

---

## 17. Development Branches

| Task | Branch |
|---|---|
| Design tokens + primitives | `feat/design-tokens` |
| Ads-only paywall + category access | `feat/ads-only-paywall` |
| Home screen | `feat/design-implementation-home` |
| Search/Stöbern screen | `feat/design-implementation-search` |
| Product detail + compare | `feat/design-implementation-product` |
| Profile + settings | `feat/design-implementation-profile` |
| Rewards UI | `feat/rewards-ui` |

Docs (`docs/`) may be committed directly to `main`.

---

## 18. Open Items

- [ ] Confirm brand color extraction library (`react-native-image-colors` vs custom)
- [ ] Decide: precompute `brandColor` server-side vs always runtime
- [ ] `ShoppingList` screen — no prototype exists yet; design TBD
- [ ] Onboarding flow — in scope for this redesign or separate task?
- [ ] Push notification permission screen — design needed
- [ ] Deep link handling with new route structure
- [ ] Analytics event names — review against new screen names
- [ ] Splash screen update to match new brand colors
