# cashback-pipeline

Async OCR + cashback-engine for the MarkenDetektive Cashback flow.
See `CASHBACK_ARCHITECTURE.md` (repo root) for the full design.

## Functions

- **`enqueueCashback`** — HTTPS, region `europe-west3`. Receives the
  `storagePath` of an already-uploaded image plus client-computed
  hashes, validates auth + consent + idempotency + daily-cap, creates
  the receipt doc with `status: 'ocr_pending'`, and publishes a PubSub
  message to `cashback-ocr-jobs`.
- **`processCashback`** — PubSub-triggered, region `europe-west3`,
  memory 1 GiB, timeout 120s. Downloads the image, runs Gemini 2.5
  Flash OCR, reconciles Σitems vs total, applies the tier formula,
  writes the structured receipt + ledger entry, then triggers the
  push-notification (currently a stub log — Phase 2.1 wires real FCM).

## Environment

```bash
firebase functions:secrets:set GEMINI_API_KEY
# Optional override:
firebase functions:secrets:set CASHBACK_OCR_MODEL  # default gemini-2.5-flash
```

## First deploy

```bash
firebase use markendetektive-895f7
firebase deploy --only functions:cashback-pipeline
```

Creates the PubSub topic `cashback-ocr-jobs` lazily on first publish
(see fallback in `index.js`). For idempotent infra you can pre-create:

```bash
gcloud pubsub topics create cashback-ocr-jobs --project=markendetektive-895f7
```

## Storage bucket

The Cloud Function expects images at `cashback-uploads/{uid}/{file}`
in the project's default bucket. The matching Storage rule is
documented in `firestore-cashback-rules.txt` (repo root). Apply once
in Firebase Console.

## Phase 2.1 follow-ups

- [ ] Real FCM via `admin.messaging()` once the app installs
      `@react-native-firebase/messaging` (requires dev-client rebuild).
- [ ] DocAI Expense Parser fallback when reconciliation fails.
- [ ] BigQuery cost-event streaming (`cashbackId, model, cost, latencyMs`).
- [ ] App Check + Device Attestation enforcement (currently logged but
      not blocking).
- [ ] Catalog-match step (productId / brandId per item) — Phase 3.
