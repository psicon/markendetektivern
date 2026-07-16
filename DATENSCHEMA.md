# MarkenDetektive — Firestore-Datenschema (Produktivstand)

> **Zielgruppe:** externe Entwickler:innen, die gegen die Produktions-DB arbeiten.
> **Stand:** 16.07.2026 · Firebase-Projekt `markendetektive-895f7`, Datenbank `(default)`.
> Quellen: `firestore.rules` (autoritative Collection-Whitelist), `lib/types/firestore.ts`,
> `lib/services/firestore.ts` (Referenz-Auflösung), `cloud-functions/*` (Server-Writes), `CLAUDE.md`.

---

## 0 · Konventionen & Fallen (zuerst lesen!)

1. **Feldnamen sind deutsch** (`bezeichnung`, `preis`, `gekauft`, `ersparnis`) — historisch gewachsen, nicht ändern.
2. **Verknüpfungen sind echte Firestore-`DocumentReference`s**, keine String-IDs (Ausnahmen sind markiert). Ein `get()` auf das Feld liefert den Pfad; die App löst Referenzen über `FirestoreService.getDocumentByReference()` (mit In-Memory-Cache) auf.
3. ⚠️ **`hersteller` ≠ Hersteller!** Die Collection **`hersteller` enthält MARKEN** (z. B. „Kerrygold"), die Collection **`hersteller_new` enthält die ECHTEN Hersteller** (Firmen). Details in §2 — das ist die wichtigste Falle im ganzen Schema.
4. ⚠️ **`EANs: string[]` ist die Source of Truth** für Barcodes auf `produkte`/`markenProdukte`. Das TS-Interface deklariert zusätzlich ein Legacy-`EAN: string` — **reale Daten tragen nur `EANs[]`**. Neuer Code schreibt NUR `EANs: [gtin]`; gelesen wird defensiv über `extractEans()` (merged Legacy-Varianten). Niemals dem Interface blind trauen.
5. ⚠️ **TS-Interfaces sind unvollständig.** Cloud Functions schreiben Felder, die in `lib/types/firestore.ts` fehlen (z. B. das komplette `nutr_*`-Nährwert-Schema, §4). Das Interface ist ein Ausschnitt, nicht das Schema.
6. **Geld ist server-only.** Alle Cashback-Guthaben-/Ledger-Felder sind per Rules für Clients gesperrt und werden ausschließlich von Cloud Functions (Admin-SDK, Transaktionen) mutiert. **Punkte (`users/*/ledger`) ≠ Geld (`users/*/cashback_ledger`)** — Punkte sind client-schreibbar (shape-validiert), Geld nie.
7. **Markt-ID-Bruch:** `produkte.discounter` referenziert die Collection `discounter` (zufällige Doc-IDs). Die Bon-Pipeline nutzt dagegen **Merchant-Slugs** (`merchants/{slug}`, z. B. `edeka`). Der Merchant-Resolver liefert zusätzlich `discounterId` (echte Doc-ID) zum Übersetzen.
8. **Zeitstempel** sind Firestore-`Timestamp`s (Server-Zeit via `serverTimestamp()`); Bon-Daten (`bonDate`) sind ISO-Strings `YYYY-MM-DD`.

---

## 1 · Der Katalog-Graph (Überblick)

```
                         ┌──────────────┐   herstellerref    ┌────────────────┐
                         │  hersteller  │ ──────────────────▶│ hersteller_new │
                         │  (= MARKEN)  │                    │ (ECHTE Firmen) │
                         └──────▲───────┘                    └───────▲────────┘
                                │ hersteller                         │ hersteller
                     ┌──────────┴─────┐                     ┌────────┴───────┐
                     │ markenProdukte │◀────markenProdukt───│    produkte    │
                     │ (Markenartikel)│    relatedProdukte─▶│ (NoName/Eigen- │
                     └──────┬─────────┘                     │    marken)     │
                            │                               └──┬──┬──┬──┬────┘
              kategorie ────┤                 kategorie ───────┤  │  │  │
              packTyp   ────┘                 packTyp   ───────┘  │  │  │
                                              discounter ─────────┘  │  │
                                              handelsmarke ──────────┘  │
                                              (EANs[], stufe, aiComparison/aiAssessment)
```

**Merksatz (aus der Task-Beschreibung des Gründers):** *Die Sammlung `hersteller` sind Marken, `hersteller_new` sind echte Hersteller. Produkte verknüpfen über `markenProdukte` und/oder `hersteller` bzw. `hersteller_new` Marken- und Konzernstrukturen.*

Die zwei Auflösungs-Ketten:

- **Kette A (NoName → Firma, 1 Schritt):** `produkte.hersteller` → **direkt** `hersteller_new`. Der Maker eines NoName-Produkts ist immer die echte Firma.
- **Kette B (Markenprodukt → Marke → Firma, 2 Schritte):** `markenProdukte.hersteller` → `hersteller` (**Marke**) → `hersteller.herstellerref` → `hersteller_new` (**Firma**). Über `where('herstellerref','==',firmaRef)` auf `hersteller` findet man alle Geschwister-Marken eines Konzerns.
- **Unterscheidungsmerkmal im Doc:** Ein Dokument ist eine **Marke**, wenn es das Feld `herstellerref` trägt; es ist ein **echter Hersteller**, wenn es `herstellername` trägt (so unterscheidet `getMarkenProduktWithDetails` in `lib/services/firestore.ts:2148-2166` — Altbestände in `markenProdukte.hersteller` können vereinzelt direkt auf einen echten Hersteller zeigen).
- Zusätzlich aggregiert die CF `connected-brands-aggregator` die Konzern-Zusammenhänge wöchentlich nach `aggregates/herstellerBrands_v1`.

---

## 2 · Katalog-Collections im Detail

### `produkte` — NoName-/Eigenmarken-Produkte (Kern-Entität)
| Feld | Typ | Bedeutung |
|---|---|---|
| `name`, `beschreibung`, `bild` | string | Anzeige-Basics |
| `preis` | number (€) | aktueller Preis · `preisDatum: Timestamp` |
| `EANs` | **string[]** | Barcodes — Source of Truth (Konvention #4) |
| `stufe` | **string** `"1"…"5"` | Ähnlichkeits-Stufe zum Markenprodukt (§3) |
| `kategorie` | Ref → `kategorien` | |
| `packTyp` | Ref → `packungstypen` | |
| `handelsmarke` | Ref → `handelsmarken` | Eigenmarken-Label (z. B. „Gut & Günstig") |
| `discounter` | Ref → `discounter` | Verkaufsmarkt |
| `markenProdukt` | Ref → `markenProdukte` | das „enttarnte" Original (bei Stufe 3–5) |
| `hersteller` | **Ref → `hersteller_new`** | die ECHTE Firma (Kette A!) |
| `ersparnis`, `ersparnisProz` | number | **admin-kuratierte** Ersparnis vs. Original (⚠️ MANUELL — kein CF-Writer; Client rechnet nur einen Anzeige-Fallback zur Laufzeit, `lib/utils/savings.ts`) |
| `same`, `rating`/`ratingCount`, `averageRating*` | bool/number | Community-Bewertung |
| `bildClean*` | string/number | CF-generierte bereinigte Bilder (WebP ≤512 / PNG ≤1024 / HQ ≤1600, `bildCleanVersion`, `bildCleanSource`) |
| `aiComparison` | **Map** | KI-Vergleich NoName↔Marke: `{score: 1-5, reasoning, model, promptVersion, updatedAt, skipped?}` |
| `aiAssessment` | **Map** | Standalone-KI-Bewertung (Stufe 1/2 ohne Marken-Link): `{healthScore: 1-5 kategorie-relativ, reasoning, …}` |
| `aiComparisonDirtyAt` | Timestamp | Debounce-Flag der KI-Pipeline (Trigger setzen es, Scheduler verarbeitet nach ≥1 h Ruhe) |
| `nutr_*`, `attr_ingredientStatement`, `nutritionSource`, … | s. §4 | Nährwerte/Zutaten (CF-geschrieben, nicht im TS-Interface!) |

**Regel:** `aiComparison` und `aiAssessment` schließen sich gegenseitig aus (die KI-CF löscht das jeweils andere Feld) — die UI sieht nie beide.

### `markenProdukte` — Markenartikel (die „Originale")
Wie `produkte`, aber: **kein** `stufe`, **kein** `aiComparison`/`aiAssessment`, **kein** `discounter`/`handelsmarke`.
Zusätzlich: `relatedProdukte: Ref[] → produkte` (+ redundantes `relatedProdukteIDs: string[]`) — die Rück-Verknüpfung auf alle NoName-Enttarnungen.
`hersteller: Ref → hersteller` (**MARKE**, Kette B!). Gleiche `EANs[]`-, `bildClean*`- und `nutr_*`-Konventionen.

### `hersteller` — **MARKEN** (kein TS-Interface, Felder aus Nutzung)
`name`, `bezeichnung`, `bild` (Marken-Logo), `infos` (kuratierter Text), **`herstellerref: Ref → hersteller_new`** (das Kettenglied), `aiHersteller` (Map, s. u. — Marken werden ebenfalls KI-bewertet, die App zeigt im Produkt-Kontext aber die Firma).
Platzhalter-Docs („z - …", „NoName", „Dummy") existieren und werden beim Lesen gefiltert.

### `hersteller_new` — **ECHTE HERSTELLER** (Firmen)
`name`, `herstellername` (Firmierung), `bild`, `adresse`, `plz`, `stadt`, `land`, `identNummer`,
`aiHersteller: Map = {herkunft (Badge-Einzeiler), summary (2–4 Sätze), model, promptVersion, updatedAt, skipped?}` — **eine** KI-Einschätzung pro Firma (kein Score, reine Info-Karte).

### Stammdaten
| Collection | Kern-Felder |
|---|---|
| `kategorien` | `bezeichnung`, `bild`, `isFree: bool`, `getsFreeAtLevel: number` (0 = frei, 1–10 = Level-Gate; Alkohol zusätzlich App-seitig Age-gated) |
| `discounter` | `name`, `land`, `bild`, `color`, `infos`, `isFree` |
| `handelsmarken` | `bezeichnung`, `name`, `bild` |
| `packungstypen` | `typ`, `typKurz` |
| `merchants/{slug}` | Bon-Pipeline-Händler (Doc-ID = Slug wie `edeka`); Resolver mappt auf `discounterId` |

### Externe Produktdaten (Cache-Schicht)
| Collection | Zweck |
|---|---|
| `external_products/{ean}` | Zentraler EAN-Lookup-Cache für Produkte AUSSERHALB des kuratierten Katalogs (Doc-ID = normalisierte EAN). `source: 'rewe'\|'globus'\|'openfood'\|…`, `productName`, `brandName`, `imageUrl`, `price`, `nutr_*`, `attr_ingredientStatement`, Scores (`scoreNutri/Eco/Nova`), `aiAssessment`. |
| `reweapify/{id}` | Roh-Pipeline REWE (Query per `gtin`); eigenes Feld-Schema (`price_current`, `attr_BrandId`, `attr_ContactName`, `nutr_*`) — **Namensgeber des kanonischen Nährwert-Schemas** (§4) |
| `nutritionscrape/{ean}` | LLM-extrahierte Multi-Shop-Daten der CF `nutrition-scraper` (Suche IMMER per EAN, nie per Name!) · `sourceShop` + `nutr_*`/`attr_*` |
| `scraped_products` | weitere Scraper-Ablage (public-read, CF-write) |
| `ExternalLookupMiss`-Docs | Miss-Tracking: `{ean, status: pending→resolved/no-data, hitCount, triedSources[]}` |

### Historien (server-only, Watcher-CFs)
`pricehistory_produkte` / `pricehistory_markenProdukte` — jede Preisänderung.
`nutritionhistory_produkte` / `nutritionhistory_markenProdukte` — Snapshots bei Nährwert-Änderungen durch untrusted Sources.

---

## 3 · Stufen-System (Kern-Fachlogik)

`produkte.stufe` (String `"1"`–`"5"`, UI-Typ 0–5):

| Stufe | Bedeutung |
|---|---|
| 5 | **Identisch** — gleicher Markenhersteller, gleiches Produkt |
| 4 | **Nahezu identisch** — gleicher Hersteller, minimal abweichend |
| 3 | **Vergleichbar** — gleicher Hersteller, stark angepasste Rezeptur |
| 2 | **Markenhersteller** — von einem Markenhersteller, aber kein vergleichbares Original |
| 1 | **NoName-Hersteller** — Firma produziert ausschließlich Handelsmarken |
| 0 | unbekannt |

Kopplung: Stufe 3–5 haben i. d. R. einen `markenProdukt`-Link → KI schreibt `aiComparison`. Stufe 1–2 (kein Link) → `aiAssessment` (kategorie-relativer Health-Score).

---

## 4 · Nährwerte & Zutaten — das reweapify-Schema (kanonisch)

Liegt auf `produkte/*` **und** `markenProdukte/*` (von CFs geschrieben; **fehlt im TS-Interface** — Konvention #5):

```
attr_ingredientStatement: string        // "Zucker, Glukosesirup, 15% VOLLMILCHPULVER…"
ingredientsSource: 'manual'|'rewe'|'ocr'|'openfood'|'scraper'|'legacy'
ingredientsUpdatedAt: Timestamp

nutr_Energie_val / _unit ('kcal'|'kJ')
nutr_Fett_val / _unit ('g')
nutr_FettdavongesttigteFettsuren_val / _unit   // sic! Tippfehler aus reweapify — NICHT korrigieren
nutr_Kohlenhydrate_val / _unit
nutr_KohlenhydratedavonZucker_val / _unit
nutr_Ballaststoffe_val / _unit
nutr_Eiwei_val / _unit                          // sic! „Eiweiß" ohne ß
nutr_Salz_val / _unit
nutr_serving_size: number · nutr_serving_unit: 'g'
nutritionSource: (wie ingredientsSource) · nutritionUpdatedAt: Timestamp
```

**Trust-Hierarchie** (höhere Quelle wird nie überschrieben): `manual` > `rewe` > `ocr` > (untrusted, newest wins: reweapify-fill → scraper → openfood → legacy). App-Lesepfad: `lib/utils/productNutrition.ts → extractIngredients()/extractNaehrwerte()` (liest auch Legacy-Format `naehrwerte:{}`/`zutaten:""`).

---

## 5 · `users/{uid}` — das User-Dokument

Kein vollständiges TS-Interface; Felder gruppiert (Schreiber in Klammern):

| Gruppe | Felder |
|---|---|
| **Identität** (Client) | `email`, `display_name`, `real_name`, `photo_url`, `uid` · Anon-Platzhalter: `anonymous@markendetektive.app` / „Anonymer Nutzer" |
| **Demografie** (Client) | `age: number` + `ageBucket` (`'16-24'…'65+'`) + `ageReportedYear/At` (Alter wird zum Lesen hochgerechnet) · `gender: 'Männlich'\|'Weiblich'\|'Anderes'` (Legacy-Werte werden beim Lesen normalisiert) · `country: 'DE'\|'AT'\|'CH'` · `location` (Freitext) · Region-Opt-in `bundesland`/`city` + Lazy-Guess `guessedBundesland`/`guessedCity` · `demographicsCapturedAt`/`demographicsSkipped(At)` |
| **Onboarding-Prefs** (Client) | `favoriteMarket` (Discounter-**ID**, String), `favoriteMarketName`, `favoriteMarkets[]` (Markt-Objekte, Custom = `{id:'other', name, isCustom:true}`), `primaryMarket` (Objekt, nur echter Discounter), `weeklyBudgetEur`, `priorities[]` (`preis/qualität/inhaltsstoffe/marke/marktnähe/anderes`), `prioritiesOther`, `onboardingCompletedAt` |
| **Gamification** (Client) | `stats.*` = **Map auf dem Doc** (nicht die Subcollection!): `currentLevel, pointsTotal, currentStreak, longestStreak, conversions, ratingsSubmitted, productsScanned, …` · Top-Level-Spiegel: `level`, `xp`, `totalSavings`, `productsSaved`, `ratingsGiven`, `streakDays` |
| **Cashback/GELD** (**nur CF!**) | `cashback_balance_cents`, `cashback_lifetime_cents`, `cashback_pending_cents`, `cashback_monthly{YYYY-MM: {earnedCents,bonsCount,…}}`, `cashback_campaign_weekly`, `cashback_campaign_totals`, `cashback_last_bon_date`, `trust_score(+components)`, `kyc{}` — Rules blocken jede Client-Mutation |
| **Consent** (Client) | `cashback_consent: {accepted, version, acceptedAt, appVersion}` — bewusste Ausnahme vom Geld-Block |
| **Meta** | `created_time`, `lastLoginAt`, `lastActivityAt`, `updatedAt`, `attribution{source,platform,capturedAt}`, `isPremium`/`premiumUntil` (Anzeige — Wahrheit ist RevenueCat) |

### Subcollections von `users/{uid}`

| Subcollection | Zugriff | Inhalt |
|---|---|---|
| **`einkaufswagen`** | Client r/w | Einkaufszettel. **Deterministische Doc-IDs:** `brand_{markenProduktId}` / `noname_{produktId}`; Custom-Items = Auto-ID. Felder: `markenProdukt?`/`handelsmarkenProdukt?` (Refs!), `customItem?{name,type,marketId,…}`, `gekauft: bool`, `name`, `anzahl`, `timestamp`, Analytics-Snapshot (`priceAtTime`, `savingsAtTime`, `journeyId?` — bei geteilten Listen NIE gesetzt) |
| `favorites` | Client r/w | wie Cart (Refs auf Produkte; externe Produkte via `external_*`-IDs) |
| `purchases` | Client r/w | Kaufhistorie: `{productId, name, productType: 'markenprodukt'\|'noname'\|'external', preis, savings, purchasedAt}` |
| `purchased_products` | **CF-only** write | OCR-Bon-Positionen (pro Bon): `{itemName, priceCents, qty, receiptId, bonDate, merchantId/Name/Land, bonStatus, rewardEligible}` + Matcher-Felder `{matchStatus, productId, productSource, matchConfidence}`. ⚠️ Enthält auch valide-aber-abgelehnte Bons — **für Geld-/B2B-Auswertung auf `rewardEligible===true` filtern!** |
| `ledger` | Client append-only | **Punkte**-Ledger (kein Geld): `{action, points 0–10000, timestamp, metadata?}` — shape-validiert per Rules |
| `cashback_ledger` | **CF-only** | **Geld**-Ledger: `{type: earn\|payout\|reverse\|admin_adjust, cents, receiptId?, payoutId?, balanceAfterCents, createdAt}` — idempotent per `receiptId` |
| `cashback_status` | Client create-Placeholder, CF-Rest | Bon-Status-Mirror (das liest die App): `{status, cashbackCents, tierApplied, merchantId/Name, bonDate, maxAgeDays, items[], rejectReason, …}` |
| `journeys` | Client c/u (kein delete) | Verhaltens-Tracking, §7 |
| `scanHistory` / `searchHistory` | Client r/w | `{ean, productId, isMarke?, timestamp, deleted?}` / `{term, timestamp, resultCount?}` |
| `fcmTokens/{hash}` | Client r/w | `{token, platform, addedAt, lastSeenAt}` |
| `stats` (Subcollection) | Client r/w | ⚠️ Legacy/ungenutzt — die echten Stats sind die `stats`-**Map** auf dem Doc |

---

## 6 · Cashback-Pipeline (Geld-Datenfluss)

```
App: Foto → Storage-Upload → enqueueCashback (HTTPS, Pre-OCR-Dedup: Byte-Hash + dHash)
  → PubSub → processCashback (OCR Gemini → Reconciliation Σ==Total → Gates/Caps → Ledger)
  → receipts/{id} (Volldaten) + users/*/cashback_status/{id} (App-Mirror)
  + users/*/purchased_products/* (Bon-Positionen) → CF receipt-matcher (Alias-Lexikon + Gemini-Pick)
```

| Collection | Zugriff | Kern-Felder |
|---|---|---|
| **`receipts/{id}`** | Client read-own, CF-write | `userId`, `status` (`uploaded→ocr_*→approved/rejected/review/paid`), `capture{hash, perceptualHashServer, source}`, `storage{}`, `ocr{model, parsed, confidence, robust}`, `merchant{id: slug, discounterId, name, matchedScore}`, `bonDate`, `bonTotalCents`, `items[]{raw, qty, priceCents, eligible}`, Dedup: `contentHash`/`transactionHash`/`itemsHash`/`duplicateOf`, `cashbackCents`, `tierApplied`, `fraudSignals`, `attempts` |
| `cashback_campaigns/{slug}` | public-read, CF-write | Aktionen: `{active, kind: receipt\|product_photos\|survey, budgetTotal/RemainingCents, cashbackPerBonCents/tiers, weeklyBonCap, maxPerUserCents, maxAgeDays, minItems}` |
| `cashback_config/v1` | public-read, CF-write | Global: `{tiers[], payoutThresholdCents (nie <100 — Tremendous-Minimum 1 €!), monthlyMaxCents, consentVersion, ocrModel, …}` |
| `cashback_payouts/{id}` | read-own, CF-write | Auszahlungen via Tremendous: `{userId, amountCents, method, status, tremendousOrderId}` |
| `cashback_review_queue`, `cashback_consumption/{month}`, `cashback_webhook_events` | **komplett server-only** | Review-Queue, Monats-Budget-Verbrauch, Webhook-Log |
| `receiptMatches`, `receiptAliases` | **CF-intern** (deny-all) | Matcher-Ergebnisse + selbstlernendes Bon-Zeilen-Alias-Lexikon (`aliasId = f(marktSlug, normKey)`) |
| `crowd_uploads/{id}` | Client create + read-own | Produktfoto-Einreichungen: `{userId, sessionId, marketId/Name, productName, ean, campaignId, images{step→pfad}, status:'pending'}` — Bild-Dateinamen tragen einen eindeutigen Batch-Token |

---

## 7 · Journeys & Telemetrie

| Collection | Inhalt |
|---|---|
| **`users/*/journeys/{id}`** | Session-Verhalten (läuft für ALLE User, unabhängig vom Cashback-Consent): `journeyId`, `startTime` (⚠️ Zeitfenster IMMER hierüber — `lastUpdated` ist bei ~759k Alt-Docs defekt), `app{version, build, os}`, `screenName`, `viewedProducts[]{productId, productType, actions[], qualityEngagement?, aiVerdict?}`, `converted[]`, `scannedcodes`, `searchedproducts`, `customItems`, `filterMetrics{}`, `consumerProfile{favoriteMarket, gender, age, level}` (Snapshot beim Start), `status/completionReason` |
| **`onboardingResultsV5/{sessionId}`** | Onboarding-Funnel-Telemetrie (write-only für Clients, kein read!): `userId`, `status` (`hero_shown/in_progress/completed/abandoned`), `funnelStage` + `stage_{stage}_at`-Stempel, `currentStep`, `country`, `weeklyBudgetEur`, `priorities`, `favoriteMarkets`, `abandonedAtStep`, `version:'v3'` |
| `userfeedback/{uid}_{ts}` | In-App-Rating-Prompt: `{userId, feedback: positive\|negative, timestamp, userLevel}` |
| `polls` / `poll_responses` | Umfragen (RevealyIQ): Katalog public-read; Responses Client-create-own: `{pollId, userId, answers, userContext, journeyId?, consent{}}` · Reward via CF `survey-reward` |
| `productRatings/{id}` | Community-Bewertungen: `{userID, ratingOverall/PriceValue/TasteFunction/Similarity/Content, comment, productID: Ref→produkte, brandProductID: Ref→markenProdukte}` |
| `pushTokens/{token}` | Push-Registry (Doc-ID = Token, Client create/update-own, kein read) |

---

## 8 · Gamification & Bestenlisten

| Collection | Inhalt |
|---|---|
| `gamification/**` (read: eingeloggt) | Config: Levels (`gamification/config/levels`), Actions, Streaks |
| `achievements/{id}` (public-read) | Achievement-Katalog (Definitionen inkl. `trigger.action`, Punkte, Icon) |
| `leaderboards/{uid}` | Pro-User-Zähler (Client schreibt NUR eigenes Doc): `{displayName, photoUrl, stats{points{total,weekly,monthly,yearly}, savings{…}}, weekStartDate, …}` |
| `aggregates/*` (public-read, CF-write) | Vorberechnete Snapshots: `leaderboard_v1` (Top-Listen + Perzentile, nightly), `herstellerBrands_v1` (Konzern-Graph), `topProducts_v1`, `releaseMonitor_v1` (Monitor-Dashboard), `b2b_insights_v1`, KI-Backfill-Cursor |

**Kostenregel:** Clients scannen NIE Collections zur Laufzeit — alles Aggregierte kommt aus `aggregates/*` (1 Read/Session + Cache).

---

## 9 · Geteilte Einkaufszettel (`shared_lists`)

| | |
|---|---|
| `shared_lists/{listId}` | `{name, ownerId, ownerName, memberIds: string[] (Autorisierungs-Kern!), memberNames{uid→name} (denormalisiert — fremde Profile sind nicht lesbar), inviteCode, inviteExpiresAt (48 h), createdAt}` · max 6 Mitglieder |
| `shared_lists/{listId}/items/{itemId}` | **EXAKT das `einkaufswagen`-Schema** (gleiche det-IDs `brand_*`/`noname_*`, gleiche Felder) + `addedBy: uid`, `addedByName` |

**Sicherheitsmodell:** `memberIds` ist client-seitig nur **schrumpfbar** (Self-Leave/Owner-Kick); **Beitritt läuft ausschließlich über die CF `joinSharedList`** (Callable, prüft Invite-Code + Ablauf + Kapazität, lehnt anonyme User ab). Einladungs-Links sind HTTPS (`…web.app/join-list/<code>`), nie Custom-Scheme.

---

## 10 · Zugriffsmodell (Zusammenfassung `firestore.rules`)

**Whitelist-Prinzip** — finaler `match /{document=**} { allow read, write: if false }`. Jede neue Collection braucht einen bewussten Rules-Block.

| Klasse | Collections | Regel |
|---|---|---|
| **Öffentlicher Katalog** | `produkte, markenProdukte, hersteller, hersteller_new, handelsmarken, kategorien, discounter, packungstypen, merchants, external_products, reweapify, nutritionscrape, scraped_products, aggregates, achievements, cashback_config, cashback_campaigns, polls` | `read: true` (bewusst OHNE Auth-Gate — Boot-Reads laufen teils vor dem Anonymous-Sign-In), `write: false` |
| **Owner-only** | `users/{uid}` + Client-Subcollections (`einkaufswagen, favorites, journeys, purchases, scanHistory, searchHistory, fcmTokens, …`) | `isOwner(uid)`; unbekannte neue Subcollections: read-own, write false |
| **GELD server-only** | User-Geldfelder (`touchesMoneyFields`-Guard), `cashback_ledger`, `purchased_products`, `receipts`, `cashback_payouts`, `cashback_review_queue`, `cashback_consumption` | Client maximal read-own, Mutation nur Admin-SDK (CF-Transaktionen) |
| **Owner-Feld-validiert** | `poll_responses, productRatings, userfeedback, pushTokens, crowd_uploads` | create nur mit `userId/userID == auth.uid` |
| **Mitglieder-Modell** | `shared_lists(+items)` | read/write nur `memberIds`; Expansion nur via CF |
| **CF-intern** | `receiptMatches, receiptAliases, pricehistory_*, nutritionhistory_*` | deny-all für Clients |

**Pflicht bei Rules-Änderungen:** `npm run test:rules` (46 Tests, Emulator, Java 21+) — beide Richtungen (Angriffe scheitern UND legitime Flows gehen durch).

---

## 11 · Bekannte Schema-Fallen (Checkliste für Externe)

1. `hersteller` = Marken, `hersteller_new` = Firmen (§1/§2). Marke erkennt man am Feld `herstellerref`, Firma an `herstellername`.
2. `EANs[]` schreiben, nie singuläres `EAN`; lesen über `extractEans()` (existiert 3× kopiert: `lib/utils/productNutrition.ts`, `cloud-functions/nutrition-backfill`, `cloud-functions/nutrition-scraper` — bei Logik-Änderung alle 3 nachziehen).
3. `stufe` ist ein **String**, kein Number.
4. TS-Interfaces ≠ Schema — CFs schreiben mehr Felder (v. a. `nutr_*`). Im Zweifel echte Docs ansehen.
5. `nutr_FettdavongesttigteFettsuren` / `nutr_Eiwei` — Tippfehler sind kanonisch, nicht „korrigieren".
6. `users.stats` ist eine **Map**, die `/stats/`-Subcollection ist Legacy.
7. `purchased_products` enthält auch abgelehnte Bons → bei Geld-/B2B-Metriken `rewardEligible === true` filtern.
8. Journeys: Zeitfenster über `startTime`, nie `lastUpdated` (Alt-Daten defekt).
9. Merchant-Slug (`edeka`) ≠ `discounter`-Doc-ID — Resolver-Feld `discounterId` nutzen.
10. Cart-Doc-IDs sind deterministisch (`brand_*`/`noname_*`) und in persönlichem UND geteiltem Zettel identisch — beim Schreiben immer klarstellen, WELCHE Collection gemeint ist.
11. Firestore-**Indizes** werden NICHT über `firestore.indexes.json` deployt (Console + Staging-DB verwaltet) — nie `deploy --only firestore:indexes`.
12. `payoutThresholdCents` nie unter 100 setzen (Tremendous-Produktminimum 1 €).

---

## 12 · Pflege-Handbuch: Neuanlage & Aktualisierung (manuell vs. automatisch)

> Für alle, die `produkte` / `markenProdukte` / `hersteller` / `hersteller_new` anlegen oder pflegen.
> Faustregel: **Stammdaten + Verknüpfungen + `EANs[]` sind Handarbeit — KI, Bilder-Derivate, Nährwerte und Historien füllen sich selbst.** Aber: die Automatik greift nur, wenn ihre Vorbedingungen (unten fett) erfüllt sind.

### 12.1 Neuanlage-Checklisten (was MANUELL eingetragen werden muss)

**`produkte` (NoName) anlegen:**
| Pflicht | Warum |
|---|---|
| `name`, `beschreibung`, `bild`, `preis` (+`preisDatum`) | Stammdaten — `bild` ist zudem Vorbedingung für Bild-Cleanup + Thumb |
| **`EANs: [gtin]`** | ⚠️ OHNE `EANs[]` greift die komplette Nährwert-/Zutaten-Automatik NICHT (`skip_no_eans`) |
| `stufe` (String `"1"`–`"5"`) | Fachliche Einordnung — steuert auch, ob KI vergleicht oder standalone bewertet |
| Refs: `kategorie`, `packTyp`, `handelsmarke`, `discounter` | Stammverknüpfungen (echte `DocumentReference`s!) |
| `hersteller` → **`hersteller_new`** | die ECHTE Firma (nie auf `hersteller`/Marke zeigen!) |
| `markenProdukt` → `markenProdukte` (bei Stufe 3–5) | ⚠️ Vorbedingung für einen echten `aiComparison`-**Score** — ohne Link gibt's nur `aiAssessment` |
| `ersparnis`, `ersparnisProz` | ⚠️ **MANUELL** (admin-kuratiert) — kein CF berechnet das; Client zeigt sonst nur einen Laufzeit-Fallback |

**`markenProdukte` anlegen:**
| Pflicht | Warum |
|---|---|
| `name`, `beschreibung`, `bild`, `preis`, **`EANs[]`** | wie oben (EANs → Nutrition-Automatik) |
| Refs: `kategorie`, `packTyp` | |
| `hersteller` → **`hersteller` (= MARKE)** | Kette B! Die Marke muss existieren und ihr `herstellerref` gesetzt haben |
| `relatedProdukte[]` + `relatedProdukteIDs[]` | ⚠️ **MANUELL** — kein Writer pflegt die Rück-Verknüpfung automatisch, wenn ein NoName per `markenProdukt` verlinkt wird |
| ⚠️ Bild-Cleanup ist für markenProdukte **NICHT verdrahtet** | `bildClean*` entsteht hier nur per manuellem Backfill (`image-cleanup/backfill.js`) — bewusste Entscheidung |

**`hersteller` (= MARKE) anlegen:**
| Pflicht | Warum |
|---|---|
| `name` (+`bezeichnung`), `bild` (Logo), `infos` | Anzeige im Marken-Sheet |
| **`herstellerref` → `hersteller_new`** | DAS Kettenglied — ohne es ist die Marke vom Konzern-Graph abgehängt (und wird beim Lesen ggf. fälschlich als Firma interpretiert) |
| Namens-Hygiene | Platzhalter-Konventionen („z - …", „NoName", „Dummy", <2 Zeichen) werden von Lesern gefiltert und von der KI übersprungen |

**`hersteller_new` (= FIRMA) anlegen:**
| Pflicht | Warum |
|---|---|
| `name`, **`herstellername`** | `herstellername` ist das Erkennungs-Feld „ich bin eine Firma" — Pflicht! |
| `adresse`, `plz`, `stadt`, `land`, `identNummer` | Stammdaten (Land/Stadt fließen in die KI-Einschätzung) |

### 12.2 Was danach AUTOMATISCH passiert (Trigger-Matrix)

| Automatik (CF) | Feuert auf | Schreibt | Vorbedingung | Timing |
|---|---|---|---|---|
| **image-cleanup** | onCreate `produkte` / onUpdate wenn `bild` geändert | `bildClean`, `bildCleanPng`, `bildCleanHq`, `bildCleanVersion/Source/ProcessedAt` (Fehler → `bildCleanError`) | `bild` gesetzt | sofort · ⚠️ markenProdukte NICHT verdrahtet (nur manueller Backfill) |
| **thumbhash-generator** | onWrite `produkte` UND `markenProdukte` | `bildThumb` (32px-WebP-Data-URI), `bildThumbFor`; räumt Legacy `bildBlurhash*` ab | `bildClean` oder `bild` vorhanden | sofort (läuft typ. 2× — nach Anlage + nach Cleanup) |
| **nutrition-backfill** | onCreate `produkte`/`markenProdukte` + nightly 02:30 + onWrite `nutritionscrape/{ean}` | `nutr_*_val/_unit`, `attr_ingredientStatement`, `nutritionSource`/`ingredientsSource` (+Url/Shop/UpdatedAt) | **`EANs[]` vorhanden**; Trust-Gate: `manual`/`rewe`/`ocr` wird NIE überschrieben | sofort; ohne Treffer stößt es den Scraper an |
| **nutrition-scraper** | nur HTTPS (von backfill angestoßen) | → `nutritionscrape/{ean}` (nicht direkt in Katalog) | EAN (sucht NIE per Name) | async |
| **nutrition-history-watcher** | onWrite `produkte`/`markenProdukte` | `pricehistory_*` (jede `preis`-Änderung) · `nutritionhistory_*` (Nährwert-Änderung durch untrusted Source) · setzt **`preisDatum` automatisch nach**, wenn `preis` ohne Datum geändert wurde | nicht bei Create | sofort |
| **ai-product-comparison** | onCreate/onUpdate `produkte` (nur bei relevanten Feldern: `markenProdukt`, `stufe`, `nutr_*`, Zutaten, Scores) + onUpdate `markenProdukte` (Fan-out auf bis zu 30 verlinkte NoNames) | setzt zunächst nur `aiComparisonDirtyAt`; Scheduler (alle 15 Min) schreibt nach **≥1 h Ruhe** `aiComparison` ODER `aiAssessment` (löscht das jeweils andere) | echter Score braucht `markenProdukt`-Ref + Nährwert-/Zutatendaten auf BEIDEN Seiten, sonst `skipped`/Assessment | **trailing 1 h Debounce** — nicht wundern, dass die KI-Karte nicht sofort erscheint |
| **ai-product-comparison (Hersteller-Teil)** | onCreate/onUpdate `hersteller` UND `hersteller_new` (relevante Felder: name, herstellername, land, stadt) | `aiHersteller{herkunft, summary, …}` auf dem jeweiligen Doc | Name ≥2 Zeichen, kein Platzhalter | **sofort** (kein Debounce) |
| **receipt-matcher (Embeddings)** | onWrite `produkte`/`markenProdukte` | Vektor-Embedding nach **`productEmbeddings/{id}`** (separate Collection, nicht ins Katalog-Doc) | `name` vorhanden; neu nur bei geändertem Namen | sofort |
| **connected-brands-aggregator** | scheduled montags 03:00 | `aggregates/herstellerBrands_v1` (Konzern-Graph) | — | wöchentlich |
| **top-products-aggregator** | scheduled montags 03:30 (+ HTTP) | `aggregates/topProducts_v1` | — | wöchentlich |

### 12.3 ⚠️ Drei Blackboxen / offene Punkte (dem Externen explizit sagen)

1. **Algolia-Suche:** Im Repo existiert **kein** Record-Sync (kein `saveObjects`, keine Firebase-Extension in `firebase.json`; der Client nutzt nur den Search-Key, Scripts pflegen nur Synonyme/Settings). **Neu angelegte Produkte erscheinen NICHT automatisch durch dieses Repo in der Suche** — der Index-Sync läuft außerhalb (Console-Extension o. ä.). Vor Katalog-Arbeiten klären, wie der Sync konkret läuft.
2. **`averageRating*`:** Bewertungen landen in `productRatings`, aber **keine Funktion im Repo schreibt die Aggregate zurück** aufs Produkt-Doc (`adminPromote` initialisiert sie nur auf 0; die App aktualisiert nur optimistisch im Speicher). Entweder existiert ein Aggregator außerhalb des Repos oder die Felder veralten — vor Verlass darauf prüfen.
3. **`relatedProdukte`/`relatedProdukteIDs` + `ersparnis`/`ersparnisProz`:** rein manuelle Pflege — es gibt keine Automatik, die sie konsistent hält (z. B. wird `relatedProdukte` NICHT nachgezogen, wenn ein NoName einen `markenProdukt`-Link bekommt).

### 12.4 Update-Verhalten (Kurzreferenz)

- **`bild` ändern (produkte):** Cleanup + Thumb laufen automatisch neu. Bei **markenProdukte**: Thumb ja, Cleanup nein (Backfill nötig).
- **`preis` ändern:** `pricehistory_*`-Eintrag automatisch; `preisDatum` wird notfalls automatisch nachgesetzt. `ersparnis`/`ersparnisProz` **manuell** nachziehen!
- **Nährwerte/Zutaten manuell pflegen:** `nutritionSource`/`ingredientsSource` auf `'manual'` setzen — dann fasst die Automatik die Felder nie wieder an (Trust-Hierarchie).
- **`markenProdukt`-Link setzen/ändern:** triggert (debounced ~1 h) den KI-Vergleich neu; `relatedProdukte` auf der Marken-Seite manuell spiegeln.
- **`stufe` ändern:** triggert KI neu (relevantes Feld).
- **Hersteller-/Marken-Stammdaten ändern** (name/land/stadt): `aiHersteller` wird sofort neu berechnet.
- **EANs nachtragen bei Bestandsprodukt:** Nutrition-Automatik greift ab dem nächsten Write/Nightly — oder sofort via HTTPS-Backfill anstoßen.
