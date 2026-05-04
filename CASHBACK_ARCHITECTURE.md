# Cashback / Kassenbon System — Architecture Lock-In

> **Status:** Planning complete. No app/CF code written yet (only Phase-0 standalone tool).
> **Created:** 2026-05-02 · **Rebuilt on `feat/cashback-foundation`:** 2026-05-03
> **Owner:** Patrick (patrick@markendetektive.de)
> **Sister docs:** `KNOWHOW.md` (lives on `feat/design-implementation-home` — pull when needed), `CLAUDE.md` (design system)
>
> This document is the **single source of truth** for the Cashback work.
> When the next session starts, read this file in full before touching any code.
> If a decision in here changes, **update this file in the same commit**.

---

## 0. Why this doc exists

We spent a long planning session designing the full cashback / kassenbon
loop end-to-end (OCR, fraud protection, dashboard, learning). Context
window was about to fill, so we're committing the plan to disk so the
next session can resume at the same quality bar without re-deriving
decisions.

User instruction (verbatim):
> "wir packen nun das thema kassenbon upload, auslesen, fraud protection,
> cashback taler für user, akzeptieren der bedingungen (alles trackbar
> mit consent) und auszahlung an. mach erstmal nichts. als ersten schritt
> geht es an bonupload und check der bons."

**Hard rule for next session:** No production code, no Firestore writes,
no Cloud Function deploys until the user explicitly says "go". The list
of open confirmations is in §10.

The Phase-0 standalone validation tool in `tools/cashback-ocr-validation/`
is exempt from that rule — it's local-only, doesn't touch the app, and
the user already said "letz fetzz, bau das so dass ich das direkt testen
kann."

---

## 1. Product framing

- **Trigger:** user uploads a Kassenbon photo (or PDF) after a real
  shopping trip.
- **Reward:** cashback in € (not points). Stored as
  `cashback_balance_cents` on the user.
- **Tier rule (locked):**
  - 4–7 eligible items on the bon → **5 ¢** cashback
  - ≥8 eligible items → **8 ¢** cashback
  - <4 → no payout (still ingest for analytics if user consents)
- **Throttle (locked):** **1 bon per user per calendar day** (`Europe/Berlin`).
- **Eligible items:** items the OCR maps to a product we know in our
  catalogue (any Stufe 1–5 NoName-Pendant or Markenprodukt). Unknown
  items count for nothing.
- **Payout:** via **Tremendous API** (PayPal, SEPA, gift cards) — account
  already exists. Tax handling deferred ("kümmern wir uns später drum").
- **Consent:** AGB + cashback-specific consent must be accepted before
  any upload. Consent state is itself trackable (timestamp, version, IP
  city, app version).

---

## 2. Decision Lock-Ins

### 2.1 Locked answers from user

| ID | Question | Answer |
|----|----------|--------|
| F1 | Tier formula (4–7 → 5 ¢, ≥8 → 8 ¢) | **a — confirmed** |
| F2 | Throttle 1 bon/day | **a — confirmed** |
| F3 | Which date determines "today"? | **Bon-Datum** (date printed on receipt), not upload date |
| F4 | Hard cap | **1 bon per day** — no exceptions |

### 2.2 Stack decisions (locked unless §10 forces a change)

- **OCR engine:** **Gemini 2.5 Flash** (Plan B). Cost ≈ **$79/mo OCR** at 1.5 k bons/day, total stack ≈ $1,150/yr. Plan A (Document AI Expense Parser) was rejected at ≈ $450/mo OCR / $5,600/yr — too expensive at scale, and Gemini handles DACH receipts well enough in our prototype experience.
- **Fallback if Gemini quality fails Phase 0:** Gemini 2.5 **Flash-Lite** as cost floor ($17/mo) OR **Hybrid** (Flash-Lite for layout extraction + Document AI when confidence < threshold).
- **Payout rails:** **Tremendous** — already integrated.
- **Storage:** Firestore main DB + Cloud Storage for raw bon images (signed URLs only, never public).
- **Cloud Functions:** Python 3.11, `europe-west3` (matches existing functions in `markendetektive-895f7`).
- **Dashboard:** **Custom-built, integrated into the existing RevealyIQ dashboard** (no Retool, no Looker Studio for MVP). Interim during MVP build = direct Firestore queries + a minimal internal admin route. Full ops UI lands inside RevealyIQ once the cashback flow is live.
- **Manual review:** **No human reviewer available.** Replaced with **AI-Review (LLM-as-judge)** — Gemini 2.5 Pro called on every receipt that lands in `[manualReviewThreshold, autoApproveThreshold]`, given the bon image + parsed OCR + matched items + fraud signals + user history, returns `{ decision, confidence, reasons[] }`. Hard-edge cases (very low trust OR very high payout) still get held for Patrick's eyes when he has time, but they don't block the flow.
- **Analytics export:** Firestore → BigQuery streaming export to existing `revealyiq` project for B2B reporting (already in production for other data). Same export feeds the future custom dashboard.

### 2.3 Cost reference table (1.5 k bons/day, 500 k MAU)

| Component | Plan A (Document AI) | Plan B (Gemini 2.5 Flash) | Plan B-Lite (Flash-Lite) |
|-----------|---------------------|---------------------------|--------------------------|
| OCR per bon | $0.01 | ~$0.00176 | ~$0.0004 |
| OCR /month | ~$450 | ~$79 | ~$17 |
| Storage + GCF + Firestore | ~$15 | ~$15 | ~$15 |
| Payout fees (Tremendous) | passthrough | passthrough | passthrough |
| **Annual stack (excl. payouts)** | **~$5,600** | **~$1,150** | **~$410** |

---

## 3. Data model (Firestore)

### 3.1 New top-level collections

```
cashback_config/v1
  - tiers: [{ minItems: 4, cents: 5 }, { minItems: 8, cents: 8 }]
  - dailyCap: 1
  - throttleHours: 24
  - minItemsForPayout: 4
  - eligibleMerchants: ['aldi', 'lidl', 'edeka', 'rewe', 'kaufland', 'penny', 'netto', ...]
  - ocrModel: 'gemini-2.5-flash'
  - ocrPromptVersion: 'v1.0'
  - manualReviewThreshold: 0.65   // trust score below this → review queue
  - autoApproveThreshold: 0.85
  - kycRequiredAt: 2000           // cents ≈ 20 €

cashback_consumption/{YYYY-MM}
  - month: '2026-05'
  - totalPaidCents: …
  - bonsProcessed: …
  - usersPaid: …
  - avgFraudScore: …
  - top10Merchants: [...]

merchants/{merchantId}
  - canonicalName: 'Aldi Süd'
  - aliases: ['ALDI SUED', 'ALDI Sued GmbH', ...]
  - logoUrl: …
  - country: 'DE' | 'AT' | 'CH'
  - eligible: true
  - ocrFingerprints: [...]   // header tokens we use to identify

receipts/{receiptId}
  - userId
  - status: 'uploaded' | 'ocr_pending' | 'ocr_done' | 'matched' |
            'review' | 'approved' | 'rejected' | 'paid'
  - capture: { source: 'live_camera' | 'upload', deviceAttest, appCheck, exif, hash, perceptualHash }
  - storage: { bucket, path, contentType, sizeBytes }
  - ocr: { model, promptVersion, latencyMs, raw, parsed: {...}, confidence }
  - merchant: { id, matchedScore }
  - bonDate: '2026-05-01'
  - bonTime: '14:32'
  - bonTotalCents: …
  - items: [{ raw, productId?, brandId?, hersteller?, qty, priceCents, eligible, matchScore }]
  - eligibleItemCount: …
  - tierApplied: 5 | 8 | 0
  - cashbackCents: …
  - fraudSignals: { duplicateHash, photoshopRisk, aiGenerated, behavioral, … }
  - trustScore: 0..1
  - reviewerId? reviewedAt? reviewNote?
  - createdAt, updatedAt

cashback_payouts/{payoutId}
  - userId
  - amountCents
  - method: 'paypal' | 'sepa' | 'giftcard'
  - tremendousOrderId
  - status: 'requested' | 'sent' | 'delivered' | 'failed'
  - kycPassed: bool
  - createdAt, completedAt

cashback_review_queue/{queueId}
  - receiptId
  - mode: 'ai' | 'human_holdback'
  - reason: 'low_trust' | 'duplicate_suspect' | 'merchant_unknown' | 'manual_flag'
  - assigneeId?
  - status: 'open' | 'in_progress' | 'resolved'
  - resolution: 'approved' | 'rejected' | 'partial'
  - createdAt, resolvedAt
```

### 3.2 Sub-collections under user

```
users/{uid}/cashback_ledger/{ledgerId}
  - type: 'earn' | 'payout' | 'reverse' | 'admin_adjust'
  - cents
  - receiptId?  payoutId?
  - balanceAfterCents
  - createdAt

users/{uid}/purchased_products/{productId}
  - productId
  - firstPurchasedAt
  - lastPurchasedAt
  - purchaseCount
  - totalSpentCents
  - lastReceiptId
```

### 3.3 New fields on `users/{uid}` doc

```
cashback_balance_cents: number
cashback_lifetime_cents: number
cashback_pending_cents: number
cashback_consent: { accepted: bool, version: string, acceptedAt: ts, ip?: string, appVersion: string }
cashback_monthly: { '2026-05': { earnedCents, bonsCount, lastBonAt } }
cashback_last_bon_date: 'YYYY-MM-DD'   // Bon-Datum, not upload date
trust_score: 0..1   // derived
trust_score_components: { tenure, behavioral, ocrAgreement, reviewHistory }
kyc: { status: 'none' | 'requested' | 'passed' | 'failed', passedAt? }
```

### 3.4 Journey-tracking integration

Existing `JourneyContext` (see `lib/services/journeyTrackingService.ts`)
already carries `geohash5`, `location`, `motivationSignals`,
`viewedProducts`. **Do not duplicate.** When a receipt is approved:

1. Append a journey event `kind: 'receipt_paid'` with
   `{ receiptId, merchantId, eligibleItemCount, cashbackCents, geohash5 }`.
2. For each eligible item, append `kind: 'product_purchased'` with
   `{ productId, brandId?, hersteller?, priceCents, geohash5 }`.

This gives B2B reporting the regional + cohort dimensions for free.

---

## 4. Fraud protection — Layers L0–L6

The user explicitly asked: "doppelter upload, photoshop, KI erstellt,
selbst gemalt — ist das alles abgedeckt und wasserdicht?"
**Honest answer:** *nothing* is wasserdicht — Fetch, Ibotta, Marktguru
all run with 2–5 % fraud loss as cost-of-business. We use **defense
in depth**, capture-side hurdles are the biggest deterrent, and KYC
at payout is the hammer.

### L0 — Capture (most important — kills 80 % of fakes upstream)

- **Live camera only** for first N receipts (configurable). No gallery
  upload until trust_score ≥ threshold.
- **App Check** (Firebase) → only signed app instances can hit the
  upload endpoint.
- **Device Attestation** (Play Integrity / DeviceCheck) → blocks
  emulators + jailbroken devices.
- **EXIF + capture timestamp** server-cross-checked vs upload time.
- **Perceptual hash** computed client-side AND server-side (Sha256 +
  pHash), stored on the receipt.

### L1 — Image forensics (server, on upload)

- Recompute pHash + dHash + aHash → reject on duplicate match across
  all-time receipts (Bloom filter for fast lookup).
- ELA (Error Level Analysis) for Photoshop signs.
- Metadata (software tag, content provenance C2PA when present).
- **AI-generation detector** (Hive AI / SightEngine, or in-house ResNet
  on a curated set when we have data — Sprint 4+).

### L2 — OCR sanity

- Bon total = Σ(items) ± rounding tolerance (€ 0.05).
- Bon-Datum within last 14 days, ≤ today, in `Europe/Berlin`.
- Merchant must match `merchants/*` with score > 0.7.
- Item count, price ranges, vat lines plausible.

### L3 — Catalogue match

- Each item → fuzzy match against our products (NoName + Markenprodukt).
- Match score < threshold → item not eligible (still counted for
  analytics, no fraud penalty unless ALL items unmatched).
- ALL items unmatched → high fraud risk.

### L4 — Behavioral / per-user

- Account age, prior-bon track record, ratio of receipts/payouts,
  velocity (3 receipts in 5 min after install = bot).
- Device-graph clustering (same `androidId`/`idfv` across multiple
  accounts).
- Geohash dispersion (3 accounts uploading from same geohash5 in 1 h).
- IP reputation (proxy/VPN/datacenter via MaxMind).
- All combined into **trust_score** (0–1).

### L5 — AI Review (LLM-as-judge) — no human reviewer in MVP

User decision (locked): **niemand macht manual review, KI übernimmt.**
So L5 becomes an automated AI review step, not a human queue.

- Anything in `[manualReviewThreshold, autoApproveThreshold]` →
  `cashback_review_queue` with `mode: 'ai'`.
- A Cloud Function `aiReviewReceipt` calls **Gemini 2.5 Pro** (more
  capable than the OCR Flash) with:
  - the bon image (signed URL)
  - parsed OCR JSON
  - matched catalogue items + match scores
  - fraud signals (L1–L4 outputs)
  - user trust history (last 30 receipts: approved / rejected /
    reviewer corrections)
  - the same `cashback_config` rules as a system prompt
- Response schema: `{ decision: 'approve' | 'reject' | 'partial',
  confidence: 0..1, reasons: string[], flaggedItems?: number[],
  suggestedTrustDelta: -1..+1 }`.
- **Auto-decision policy:**
  - AI confidence ≥ 0.85 + decision = approve → ledger entry written
  - AI confidence ≥ 0.85 + decision = reject → user notified, no ledger
  - AI confidence < 0.85 OR payout > €5 single-bon OR cumulative pending > €10 → **hold for Patrick's eyes** (queue stays open with `mode: 'human_holdback'`)
- Every AI decision is logged to `learning/labels/{id}` for future
  ML-trust-score training (§6 Layer 4). Critical Sprint 0 work — see §6.
- AI cost: Gemini 2.5 Pro ≈ $0.005–$0.015 per review, only fires on
  ~10–20 % of bons (the borderline band) → ~$1.50/day at 1.5 k bons/day.
  Negligible vs total OCR spend.

**Honesty:** LLM-as-judge is NOT a perfect substitute for a trained
fraud reviewer. We mitigate with: (a) tight `autoApproveThreshold`
that keeps the AI band small, (b) holdback rules for high-€ cases,
(c) cooling period before payout (L6) so Patrick has 7 days to
audit before money leaves, (d) Sprint 0 label collection so we can
train a real ML model once we have ground truth.

### L6 — Payout friction

- 7-day cooling period from bon approval to payout availability
  (configurable).
- KYC required at lifetime ≥ €20 cashback (Tremendous handles parts).
- Manual approval on payouts > €10 in MVP.

### Industry context (cited honestly to user)

| Player | OCR | Fraud approach |
|--------|-----|----------------|
| Fetch Rewards (US) | proprietary, ML-heavy | trust_score + ML duplicates, ~3 % loss |
| Ibotta (US) | dual: scan + offer match | layered, KYC at $20 |
| Marktguru (DACH) | OCR + heavy manual review | DACH receipts harder, strong manual layer |
| Scondoo (DACH) | OCR + product-match | conservative, slower payouts |

---

## 5. Dashboard — Custom build, lands in RevealyIQ

User decision (locked): **eigenes Tool, später ins existierende
RevealyIQ-Dashboard integriert. Kein Retool, kein Looker Studio.**

### 5.1 MVP (interim — while cashback is being built)

Goal: Patrick can see + steer the system without a UI being on the
critical path. Cheap, ugly, functional.

- **Holdback queue:** small internal Next.js / Expo-Web admin route
  (auth-gated to Patrick's UID) that lists `cashback_review_queue`
  entries with `mode: 'human_holdback'`. Side-by-side: image, OCR
  JSON, AI-Review verdict, fraud signals, user history. Buttons:
  Approve / Reject / Adjust trust score. Effort: **1–2 days**.
- **Config edits:** for now done via Firebase console / direct
  Firestore writes on `cashback_config/v1` (audit trail comes
  later). Effort: **0 days**.
- **Daily ops snapshot:** a Cloud Scheduler job emails Patrick a
  daily summary (bons today, AI auto-approved %, holdbacks open,
  paid-out €, top fraud signals). Effort: **0.5 day**.

That's the entire interim. **No fancy dashboard until RevealyIQ
integration.**

### 5.2 Production (post-MVP — RevealyIQ integration)

Once cashback is live and there's real data, the ops + analytics
UI lands as new pages inside the existing **RevealyIQ dashboard**
(separate project, Patrick already runs it for B2B reporting).

Pages to build there:
1. **Operations** — bons today, queue depth, OCR latency, AI-Review
   verdicts, errors.
2. **Health** — match rate, trust-score distribution, fraud-flag
   distribution.
3. **Finance** — paid-out €, pending €, lifetime €, monthly burn
   vs cap.
4. **Fraud** — duplicate hits, AI-flag rate, AI-Review override
   stats, holdback resolutions.
5. **Config editor** — `cashback_config/v1` (tiers, thresholds,
   eligible merchants) with audit trail.
6. **User actions** — adjust balance (admin_adjust ledger entry),
   trigger payout retry, KYC override.
7. **B2B preview** — top brands purchased, regional heatmaps
   (geohash5), already aligned with RevealyIQ's existing data
   model so there's no schema drift.

Source of truth: same BigQuery streaming export from Firestore
that already powers the rest of RevealyIQ.

Effort estimate: **7–10 dev-days inside RevealyIQ** once we have
the data flowing. Phased — Operations + Holdback queue first,
Finance + Fraud second, Config editor third.

---

## 6. Learning system — 8 layers

User asked "wie können wir das system lernen lassen". Roadmap from
day-zero data collection to ML-driven autonomy:

| # | Layer | Sprint | Effort |
|---|-------|--------|--------|
| 1 | **Manual review labels** logged | Sprint 0 (immediate) | hours |
| 2 | **Threshold sweeps** (vary trust threshold, observe fraud-loss vs reviewer-load) | Sprint 1 | days |
| 3 | **BigQuery ML anomaly detection** on receipts, payouts, devices | Sprint 2 | week |
| 4 | **ML trust score** trained on labeled receipts (xgboost / Vertex AI) | Sprint 3 | 1–2 weeks |
| 5 | **AutoML Vision** for AI-generated receipt detection (in-house) | Sprint 4 | 2 weeks |
| 6 | **Product matcher tuning** via reviewer corrections (re-rank) | Sprint 5 | week |
| 7 | **Eligibility optimization** — auto-tune item-count tiers per cohort | Sprint 5 | week |
| 8 | **Custom-tuned Gemini** (LoRA / supervised tuning on hard DACH bons) | Sprint 6+ | weeks |

**Sprint 0 must-have:** every AI/human review writes back the labels
(`reviewer_decision`, `reviewer_corrections`, `reviewer_notes`) to
the receipt doc + a `learning/labels/{id}` doc. Without this we have
no training data later.

---

## 7. Phase plan (~7 weeks to industry-grade MVP)

| Phase | Scope | Days |
|-------|-------|------|
| **Phase 0** | 50-Bon OCR validation: Gemini 2.5 Flash vs Document AI. Standalone Python script in `tools/cashback-ocr-validation/`, no app integration. **Decision gate:** ≥95 % field-match → Plan B locked. **Built — awaiting test bons + run.** | 2 |
| **Phase 1** | Foundation: `cashback_config`, AGB consent flow, user fields, Firestore rules | 3 |
| **Phase 1.5** | Capture hardening: live-camera-only path, App Check wired, Device Attestation | 3 |
| **Phase 2** | Receipt pipeline: upload → Cloud Storage → Gemini Flash OCR → parsed JSON → catalogue match | 7 |
| **Phase 3** | Cashback engine: tier rule, daily cap (Bon-Datum), ledger writes, monthly aggregate | 4 |
| **Phase 4** | Per-user product index (`users/{uid}/purchased_products/*`) + journey events | 2 |
| **Phase 4.5** | Trust score + behavioral signals + device graph + IP reputation | 5 |
| **Phase 5** | **AI Review pipeline** (`aiReviewReceipt` Cloud Function with Gemini 2.5 Pro) + holdback queue + minimal Patrick-only admin route | 4 |
| **Phase 5.5** | Sprint 0 learning data pipeline (label capture for every AI + human decision → `learning/labels/*`) | 0.5 |
| **Phase 6** | Tremendous payout integration (PayPal first, SEPA/Giftcards next) | 5 |
| **Phase 6.5** | Payout friction: cooling period (7d), KYC at €20, hold > €5 single-bon / >€10 cumulative pending for human review | 2 |
| **Phase 7** | RevealyIQ dashboard integration — Operations + Holdback inbox + Finance + Fraud pages (Config editor in a follow-up sprint) | 7 |
| **Phase 8** | BigQuery streaming export → revealyiq project (cashback collections) | 3 |
| **Phase 9** | Polish + E2E tests + soft-launch with internal testers | 3 |
| **Total** | | **~50 dev-days ≈ 7 calendar weeks** (user confirmed: "das packen wir schon") |

---

## 8. App-side surfaces (rough)

- **Onboarding step** for cashback consent (separate from existing AGB).
- **Tab or hero entry** for "Bon hochladen" — likely lives on
  `(tabs)/rewards.tsx` next to the existing redeem hero, NOT a new tab.
- **Camera screen** with live-camera enforcement (reuse `expo-camera`
  config from `app.json`).
- **Status screen** for per-receipt state (uploaded → checking → done).
- **Wallet screen** showing `cashback_balance_cents`, ledger history,
  payout button.
- **Payout flow** — Tremendous redirect / form.

All UI must follow `CLAUDE.md` design system: `DetailHeader`, hero
gradient pattern, `FilterSheet` for any sheet, `Crossfade` skeletons,
no `ActivityIndicator` for page-level loads.

---

## 9. Files to read on next session start

In this order:

1. **`KNOWHOW.md`** — session memory, schema mapping, EAS pipeline,
   known traps, file references. **Lives on `feat/design-implementation-home`**
   (commits `4db2627`, `8557d4d`). NOT on this branch yet — pull when
   needed via `git show feat/design-implementation-home:KNOWHOW.md` or
   cherry-pick when merging cashback work back.
2. **`CASHBACK_ARCHITECTURE.md`** (this file) — cashback decisions.
3. **`CLAUDE.md`** — design system rules.
4. `app.json` — verify Expo config is unchanged.
5. `lib/services/journeyTrackingService.ts` — to wire receipt events
   into journeys.
6. `lib/services/firestore.ts` — for product-match helpers we'll
   reuse (`getProductByBarcode`, fuzzy lookups).
7. `eas.json` — current submit profiles.
8. `tools/cashback-ocr-validation/README.md` — Phase 0 runbook.

Existing relevant code/projects (NOT in this repo):
- Document AI prototype in `markendetektive-895f7` + `revealyiq` GCP
  projects (receipt pipeline already prototyped — reuse where
  applicable, but Plan B replaces Document AI).
- Tremendous account already configured.

---

## 10. Confirmations

### 10.1 Resolved (locked 2026-05-03)

| # | Question | Answer |
|---|----------|--------|
| 5 | Dashboard tooling | **Eigenes Tool, später ins RevealyIQ-Dashboard integriert.** Kein Retool, kein Looker Studio. Interim = minimal Patrick-only Admin-Route (siehe §5.1). |
| 6 | Learning roadmap | **Confirmed.** Sprint 0 ab Tag 1, dann iterativ wie in §6. |
| 7 | 7-Wochen Timeline | **Confirmed.** "das packen wir schon". |
| 8 | Manual review owner | **Niemand. KI macht Review.** L5 = LLM-as-judge mit Gemini 2.5 Pro (siehe §4 L5). Patrick nur für Holdback-Edge-Cases. |
| 9 | Tooling budget | **Kein Retool.** Eigenes Dashboard kommt später in RevealyIQ. |
| – | Phase 0 build | **Built.** `tools/cashback-ocr-validation/` ready zum Testen. |

### 10.2 Still open BEFORE Phase 1 starts

1. **Confirm Plan B (Gemini 2.5 Flash)** as default OCR — Phase 0 ist gebaut, der Run liefert die Daten zur Lock-In-Entscheidung.
2. **Provide 5–10 real DACH receipt photos** (Aldi, Lidl, Edeka, Rewe, Kaufland, Penny, plus 1–2 messy/crumpled) for Phase 0 validation. *(Hard blocker for Phase-0-Run.)*
3. **Tremendous API key** — can come later (Phase 6, ~week 5).
4. **AGB text** — to be drafted (user said "agb text muss noch gemacht werden"). Lawyer review needed before Phase 1.5 launch.

### 10.3 Trigger words for next session

- **"go phase 0 run"** → User hat Bons abgelegt, Tool laufen lassen, Output bringen → ich werte aus + lock-in Entscheidung.
- **"go phase 1"** → start Foundation (config doc, consent flow, user fields, rules). Only requires items 1 + 4 above to be answered.
- **anything else** → re-read this doc + KNOWHOW.md, then ask which of items 1–4 above to lock next.

---

## 11. Hard rules (do not break)

1. **No `await import('react-native')`** anywhere — see `CLAUDE.md` "Never `await import('react-native')`" section. Cashback screens must use static imports only.
2. **No `initializeFirestore` with persistent cache** in this app — see `CLAUDE.md`.
3. **All Firestore reads server-side (Cloud Functions)** for cashback flow — never trust the client to compute eligibility, tier, or payout.
4. **App Check + Device Attestation required** on every cashback Cloud Function endpoint — block unattested calls with 403.
5. **Never log or store** PAN, CVV, full IBAN beyond what Tremendous needs. Mask in all logs.
6. **Receipt images** in Cloud Storage are **never public**. Signed URLs only, expire after 24 h.
7. **EU data residency:** all Cloud Functions in `europe-west3`, BigQuery dataset in `EU` location, Cloud Storage bucket `europe-west3` or `EU` multi-region.
8. **Schema reminder:** "Marke" = `hersteller` collection (`name`, `infos`). "Hersteller" = `hersteller_new` collection (`herstellername`). When mapping receipt items to brands, match against `hersteller` first, fall back to `hersteller_new`.
9. **TDZ trap:** any new screen — declare ALL `useState`s before any `useEffect` that reads them. See KNOWHOW for the production crash story.
10. **No production code without "go" signal** from the user. Phase 0 standalone tool is exempt (already approved).

---

## 12. Glossary

- **Bon** — German for kassenbon / receipt.
- **Stufe** — similarity tier 0–5 between NoName and Markenprodukt (existing schema).
- **NoName-Pendant** — generic / private-label equivalent of a brand product.
- **Detektiv-Punkte** — gamification currency (existing, separate from cashback).
- **Cashback-Taler** — the € cashback currency this system pays.
- **Tremendous** — 3rd-party payout provider (PayPal, SEPA, gift cards).
- **L0–L6** — fraud defense layers in §4.
- **Phase 0–9** — implementation phases in §7.

---

*End of CASHBACK_ARCHITECTURE.md. Update this file in the same commit
as any decision change.*
