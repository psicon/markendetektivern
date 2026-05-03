# image-cleanup

Background-removal pipeline for product images. Lives as Firebase
Cloud Functions (live triggers on `markenProdukte` + `produkte`) plus
a one-shot backfill script that reuses the same pipeline module.

## How it works

```
Firestore product doc has `bild` (original URL)
     │
     ▼
┌─ Pipeline (pipeline.js) ────────────────────────────┐
│  1. Download original from Storage                  │
│  2. Border-pixel heuristic                          │
│       clean shot? → skip Gemini, just transcode     │
│       else → Gemini 2.5 Flash Image                 │
│  3. White-to-transparent flood fill (sharp)         │
│  4. Auto-trim alpha borders, resize ≤ 512 px        │
│  5. Encode WebP q82 + alphaQuality 90               │
│  6. Upload to                                       │
│     productimagesclean/brandproducts/{id}.webp       │
│     productimagesclean/nonameproducts/{id}.webp      │
│  7. Set `bildClean` URL on the Firestore doc        │
└─────────────────────────────────────────────────────┘
```

The original `bild` field and Storage file are **never modified**.
A hard guard in the pipeline refuses any write outside
`productimagesclean/`.

The Frontend reads via `getProductImage(p)` (from
`lib/utils/productImage.ts`) which prefers `bildClean` and falls back
to `bild` — so old app versions and new app versions both render
fine, regardless of whether the cleanup ran yet for a given product.

## Deploy (live triggers)

Set the Gemini API key as a Firebase secret (one-time):

```bash
firebase functions:secrets:set GEMINI_API_KEY
# paste your AIza… key when prompted
```

Deploy all six triggers:

```bash
firebase deploy --only functions:image-cleanup
```

This deploys:
- `onMarkenProduktCreate`, `onMarkenProduktUpdate`, `onMarkenProduktDelete`
- `onProduktCreate`, `onProduktUpdate`, `onProduktDelete`

Region: `europe-west1`. Memory: 1 GiB (sharp + Gemini SDK).

After deploy, every new product or `bild`-update is auto-cleaned
within ~10–30 s. Failed cleanups land in `bildCleanError` on the
doc; the original is still served.

## Run the one-shot backfill

For the existing 10k products that have `bild` but no `bildClean`:

```bash
cd cloud-functions/image-cleanup
npm install   # firebase-admin, @google/genai, sharp

FIREBASE_SERVICE_ACCOUNT="$(cat /path/to/serviceAccountKey.json)" \
GEMINI_API_KEY=AIza... \
  node backfill.js
```

Optional env vars:

| Var | Default | Notes |
|---|---|---|
| `COLLECTION` | `all` | `markenProdukte` \| `produkte` \| `all` |
| `CONCURRENCY` | `8` | parallel Gemini calls |
| `LIMIT` | ∞ | stop after N items |
| `FORCE` | unset | re-process even if `bildCleanVersion` matches |
| `MAX_BUDGET_USD` | ∞ | abort cleanly when estimated cost exceeds this |

Live progress is mirrored to Firestore at
`aggregates/imageBackfill_v1` — watch from the console while it runs.

## Cost (snapshots)

10k products, ~50 % heuristic skip-rate, Standard tier ($0.039/call):
- ~5.000 Gemini calls = **~$195** one-time
- Cloud Run compute during backfill: ~$3-5
- Storage forever: < $0.01 / month
- Live triggers (~100/day): ~$60 / month

## Storage rules

`storage.rules` (at the repo root) keeps everything `read: if true`,
`write: if false` — only the Admin SDK / Cloud Functions can write.

## Re-processing

When the pipeline changes shape (prompt, output dims, etc.), bump
`PIPELINE_VERSION` in `pipeline.js`. The backfill script then
re-processes any items whose `bildCleanVersion` is below the current.

The live triggers always run on the latest version.

## Schema

Firestore docs in `markenProdukte/{id}` and `produkte/{id}` get these
additive fields (none are touched by old app builds — the original
`bild` field is left untouched on every write path):

```ts
bildClean?: string;           // public WebP URL
bildCleanVersion?: number;    // pipeline version
bildCleanSource?: 'gemini' | 'heuristic-skip';
bildCleanProcessedAt?: Timestamp;
bildCleanError?: string;      // on failure (e.g. Gemini content filter)
bildCleanErrorAt?: Timestamp;
```

Storage layout:

```
gs://markendetektive-895f7.appspot.com/
└── productimagesclean/
    ├── brandproducts/{productId}.webp
    └── nonameproducts/{productId}.webp
```
