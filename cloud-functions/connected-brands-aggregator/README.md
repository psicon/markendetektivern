# Connected-Brands Aggregator

Pre-computes the "connected brands" list per Hersteller into
`aggregates/herstellerBrands_v1/items/{herstellerNewId}` so the app
needs only a single read per visited Hersteller.

## What it does

For each `hersteller_new` (manufacturer):

1. **Direct brands** — every doc in `hersteller` (= brand) whose
   `herstellerref` points to this manufacturer.
2. **Brands via NoName→Markenprodukt link** — for every NoName
   product (`produkte`) made by this manufacturer that has
   `markenProdukt` set, the linked Markenprodukt's brand
   (`markenProdukte.hersteller`) is also "connected".

Brands are deduped by id. Direct beats via-markenprodukt. Placeholder
brands (`z - …`, `noname`, `dummy`, `test`, `platzhalter`) are filtered
both during the brand scan and at merge time.

Three full collection scans with field projection (`select`):

- `markenProdukte.select('hersteller')` — small (~5k docs)
- `produkte.select('hersteller', 'markenProdukt')` — large (~50k docs)
- `hersteller.select('herstellerref','name','bild','bezeichnung')` — small

Then per manufacturer one batched aggregate write. Whole run usually
< 1 minute.

## Deploy

First deploy:

```bash
nvm use 22
cd cloud-functions/connected-brands-aggregator
npm install
firebase deploy --only functions:aggregateConnectedBrands,functions:aggregateConnectedBrandsHttp
```

Subsequent code-only updates:

```bash
firebase deploy --only functions:aggregateConnectedBrands,functions:aggregateConnectedBrandsHttp
```

## Schedule

Runs **every Monday 03:00 Berlin time** via `pubsub.schedule`. Hersteller↔
Marken-Beziehungen ändern sich nicht stündlich — wöchentlich reicht.
Wenn häufiger gewünscht: `pubsub.schedule('every day 03:00')`.

## Manual trigger (first deploy / ad-hoc rebuilds)

After the very first deploy you'll want to populate the aggregates
immediately rather than wait for next Monday:

```bash
curl https://europe-west1-markendetektive-895f7.cloudfunctions.net/aggregateConnectedBrandsHttp
```

Returns `{"ok":true}` on success, `{"ok":false,"error":"..."}` on
failure.

## Cost

At current scale (~50k produkte, ~5k markenProdukte, ~5k hersteller):

- ~60k reads per run
- ~5k batched writes per run
- ~ 0.02 € per run × 4 runs/month ≈ < 0.10 € / month

Ignorable until 10× scale.

## Client integration

Read via `FirestoreService.getConnectedBrandsForHersteller(ref)`.
30-min in-memory cache + inflight-promise dedup + automatic fallback
to direct-only `getMarkenByHersteller` if the aggregate doc doesn't
exist yet (e.g. a brand-new Hersteller created after the last run).
