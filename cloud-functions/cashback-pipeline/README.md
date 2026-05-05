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

### Secret (via Secret Manager)

```bash
firebase functions:secrets:set GEMINI_API_KEY
# Optional override:
firebase functions:secrets:set CASHBACK_OCR_MODEL  # default gemini-2.5-flash
```

### Project-local config (via `.env` file, gitignored)

The function loads `cloud-functions/cashback-pipeline/.env` at deploy
time (firebase-functions v2 native behavior). Current keys:

```
DOCUMENTAI_PROCESSOR_ID=<id of the eu Expense Parser processor>
DOCUMENTAI_LOCATION=eu
CASHBACK_OCR_ENGINE=cv-hybrid          # or 'gemini-direct' for rollback
CASHBACK_ESCALATE_DOCAI=true           # 'false' disables DocAI fallback
```

## DocAI escalation setup (one-time)

The CV-Hybrid OCR primary engine is great but not perfect. When
reconciliation fails (Σ items > total by > 50¢), the pipeline
escalates to Document AI Expense Parser as a fallback.

To create the processor (project `markendetektive-895f7`, region
`europe-west3`, processor location `eu`):

```bash
PROJECT=markendetektive-895f7
TOKEN=$(gcloud auth print-access-token)

curl -s -X POST \
  "https://eu-documentai.googleapis.com/v1/projects/${PROJECT}/locations/eu/processors" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"type":"EXPENSE_PROCESSOR","displayName":"cashback-expense"}'
```

Response includes the processor `name` (the suffix after `processors/`
is the ID). Put that ID in `.env` as `DOCUMENTAI_PROCESSOR_ID`, then
redeploy. Cost: $0.05/page, only on bons that fail recon.

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
