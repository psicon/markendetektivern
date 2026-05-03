/**
 * One-shot backfill — runs the image-cleanup pipeline against every
 * product in `markenProdukte` and `produkte` that doesn't yet have
 * `bildClean` (or whose `bildCleanVersion` is below the current
 * pipeline version).
 *
 * Idempotent: can be killed and restarted at any time. Already-
 * processed items are skipped on the next run via the version check
 * inside `processProductImage`.
 *
 * USAGE
 * ────────────────────────────────────────────────────────────────
 *   cd cloud-functions/image-cleanup
 *   FIREBASE_SERVICE_ACCOUNT="$(cat path/to/serviceAccountKey.json)" \
 *   GEMINI_API_KEY=AIza... \
 *     node backfill.js
 *
 * Optional env vars:
 *   COLLECTION=markenProdukte | produkte | all   (default 'all')
 *   CONCURRENCY=8                                (parallel pipeline calls)
 *   LIMIT=50                                     (stop after N items, for smoke test)
 *   FORCE=1                                      (re-process even if version matches)
 *   MAX_BUDGET_USD=120                           (abort once estimated cost exceeds this)
 *
 * COST CONTROL
 *   With ~50 % heuristic skip-rate and ~$0.039 per Gemini call (Standard tier):
 *     10.000 products → ~5.000 Gemini calls × $0.039 = ~$195
 *   Set MAX_BUDGET_USD as a hard cap. The script aborts cleanly,
 *   you can resume later — already-processed items don't re-bill.
 */

const fs = require('fs');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');

const {
  processProductImage,
  PIPELINE_VERSION,
} = require('./pipeline');

// ─── ENV ──────────────────────────────────────────────────────────

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ Set FIREBASE_SERVICE_ACCOUNT (JSON-encoded service account)');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Set GEMINI_API_KEY');
  process.exit(1);
}

const COLLECTION_FILTER = (process.env.COLLECTION || 'all').toLowerCase();
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '8', 10);
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const FORCE = !!process.env.FORCE;
const MAX_BUDGET_USD = process.env.MAX_BUDGET_USD
  ? parseFloat(process.env.MAX_BUDGET_USD)
  : Infinity;

const COST_PER_GEMINI_CALL = 0.039; // Standard tier (sync). Set to
                                    // 0.0195 if/when we move backfill
                                    // to the async Batch API.

// Skip products whose discounter name matches any of these (case-
// insensitive). Comma-separated env var overrides the default.
// Example: SKIP_DISCOUNTERS="REWE,Aldi,Lidl"
const SKIP_DISCOUNTERS = (process.env.SKIP_DISCOUNTERS || 'REWE,Aldi')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// ─── Firebase Admin init ──────────────────────────────────────────

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: serviceAccount.project_id,
  storageBucket: `${serviceAccount.project_id}.appspot.com`,
});
const db = admin.firestore();
const bucket = admin.storage().bucket();
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── Aggregate progress doc — written every PROGRESS_FLUSH items ──

const PROGRESS_DOC = db.collection('aggregates').doc('imageBackfill_v1');
const PROGRESS_FLUSH = 25;

const stats = {
  startedAt: admin.firestore.FieldValue.serverTimestamp(),
  pipelineVersion: PIPELINE_VERSION,
  total: 0,
  processed: 0,
  cleaned: 0,         // Gemini calls that succeeded
  heuristicSkip: 0,   // already-clean transcodes
  cached: 0,          // already done on prior run
  noSource: 0,        // missing bild URL
  failed: 0,
  filteredDiscounter: 0, // skipped because discounter is on the SKIP list
  estimatedCostUsd: 0,
  errors: [], // recent failures (last 50)
};

// Discounter IDs that should be skipped — populated at startup by
// resolving SKIP_DISCOUNTERS names against the `discounter` collection.
const skippedDiscounterIds = new Set();

async function loadSkipDiscounterIds() {
  if (!SKIP_DISCOUNTERS.length) return;
  const snap = await db.collection('discounter').get();
  for (const doc of snap.docs) {
    const name = (doc.data().name || '').toLowerCase().trim();
    if (SKIP_DISCOUNTERS.some((s) => name.includes(s))) {
      skippedDiscounterIds.add(doc.id);
      console.log(`   [skip] discounter ${doc.id} = "${doc.data().name}"`);
    }
  }
}

let lastFlushAt = 0;

async function flushProgress(force) {
  const now = Date.now();
  if (!force && now - lastFlushAt < 4000) return;
  lastFlushAt = now;
  await PROGRESS_DOC.set(
    {
      ...stats,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      // Truncate errors array to the last 50 entries — Firestore
      // doc size limit is 1 MB, no point hoarding the full history.
      errors: stats.errors.slice(-50),
    },
    { merge: true },
  );
}

// ─── Tiny in-process p-limit (avoids extra dep) ───────────────────

function pLimit(max) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (!queue.length || active >= max) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(
        (v) => { active--; resolve(v); runNext(); },
        (e) => { active--; reject(e); runNext(); },
      );
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });
}

const limit = pLimit(CONCURRENCY);

// ─── Stream each collection page-by-page (memory-friendly) ────────

async function* streamCollection(collectionName, pageSize = 500) {
  // We also pull the `discounter` field for the skip-filter. For
  // markenProdukte that field doesn't exist — the projection just
  // returns it as undefined, no harm.
  let last = null;
  for (;;) {
    let q = db
      .collection(collectionName)
      .select('bild', 'bildCleanVersion', 'discounter')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    for (const doc of snap.docs) {
      yield { collection: collectionName, doc };
    }
    last = snap.docs[snap.docs.length - 1];
  }
}

// ─── Worker per item ──────────────────────────────────────────────

async function processOne(collection, doc) {
  const productId = doc.id;
  const data = doc.data();

  // ── Discounter filter ──
  // Skip products whose discounter is on the SKIP_DISCOUNTERS list
  // (REWE + Aldi by default). markenProdukte don't have a `discounter`
  // field so they fall through this check.
  if (skippedDiscounterIds.size > 0 && data?.discounter?.id) {
    if (skippedDiscounterIds.has(data.discounter.id)) {
      stats.filteredDiscounter++;
      stats.processed++;
      return { status: 'filtered' };
    }
  }

  // Skip eagerly if already done on the current pipeline version,
  // unless FORCE is set. (processProductImage also has this guard
  // but checking here saves a Firestore round-trip + Gemini cost.)
  if (
    !FORCE &&
    data?.bildCleanVersion === PIPELINE_VERSION &&
    typeof data?.bildClean === 'string' &&
    data.bildClean.length > 0
  ) {
    stats.cached++;
    stats.processed++;
    return { status: 'cached' };
  }

  const result = await processProductImage({
    db,
    bucket,
    genAI,
    collection,
    productId,
    options: { force: FORCE },
  });
  stats.processed++;

  switch (result.status) {
    case 'cleaned':
      stats.cleaned++;
      stats.estimatedCostUsd += COST_PER_GEMINI_CALL;
      break;
    case 'heuristic-skip':
      stats.heuristicSkip++;
      break;
    case 'cached':
      stats.cached++;
      break;
    case 'no-source':
      stats.noSource++;
      break;
    case 'error':
      stats.failed++;
      stats.errors.push({
        collection,
        productId,
        reason: (result.reason || '').slice(0, 200),
        at: new Date().toISOString(),
      });
      break;
  }
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log('━'.repeat(60));
  console.log(`🚀 Image-cleanup BACKFILL — pipeline v${PIPELINE_VERSION}`);
  console.log(`   collection:  ${COLLECTION_FILTER}`);
  console.log(`   concurrency: ${CONCURRENCY}`);
  console.log(`   limit:       ${LIMIT}`);
  console.log(`   force:       ${FORCE}`);
  console.log(`   max budget:  $${MAX_BUDGET_USD}`);
  console.log('━'.repeat(60));

  const collections = [];
  if (COLLECTION_FILTER === 'all' || COLLECTION_FILTER === 'markenprodukte') {
    collections.push('markenProdukte');
  }
  if (COLLECTION_FILTER === 'all' || COLLECTION_FILTER === 'produkte') {
    collections.push('produkte');
  }

  if (SKIP_DISCOUNTERS.length) {
    console.log(`\n🚫 Resolving SKIP_DISCOUNTERS: [${SKIP_DISCOUNTERS.join(', ')}]`);
    await loadSkipDiscounterIds();
    console.log(`   → ${skippedDiscounterIds.size} discounter(s) blacklisted`);
  }

  await PROGRESS_DOC.set(stats, { merge: true });

  const t0 = Date.now();
  let aborted = false;

  for (const collection of collections) {
    if (aborted) break;
    console.log(`\n📂 Streaming ${collection} …`);
    const inflight = [];
    for await (const { doc } of streamCollection(collection)) {
      stats.total++;
      if (stats.processed >= LIMIT) { aborted = true; break; }
      if (stats.estimatedCostUsd >= MAX_BUDGET_USD) {
        console.log(
          `\n🛑 Budget cap reached ($${stats.estimatedCostUsd.toFixed(2)} ≥ $${MAX_BUDGET_USD}). Aborting cleanly.`,
        );
        aborted = true;
        break;
      }

      const p = limit(() => processOne(collection, doc))
        .then((r) => {
          // Per-item live log
          const tag =
            r.status === 'cleaned' ? '✓G' :
            r.status === 'heuristic-skip' ? '✓H' :
            r.status === 'cached' ? '·C' :
            r.status === 'no-source' ? '·N' :
            r.status === 'filtered' ? '·F' :
            '✗E';
          if (stats.processed % 20 === 0 || r.status === 'error') {
            console.log(
              `  [${stats.processed}] ${tag} ${collection}/${doc.id}` +
                (r.status === 'error' ? ` — ${r.reason}` : ''),
            );
          }
          flushProgress(false).catch(() => {});
        })
        .catch((err) => {
          // pipeline.processProductImage normally never throws — but
          // belt and braces.
          stats.failed++;
          stats.errors.push({
            collection,
            productId: doc.id,
            reason: `unexpected: ${err?.message || err}`,
            at: new Date().toISOString(),
          });
        });
      inflight.push(p);

      // Backpressure — keep at most CONCURRENCY × 2 promises queued
      // so we're not buffering the whole 10k-collection in memory.
      if (inflight.length > CONCURRENCY * 2) {
        await inflight.shift();
      }
    }
    await Promise.all(inflight);
  }

  await flushProgress(true);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n' + '━'.repeat(60));
  console.log(`✅ Backfill ${aborted ? 'PARTIAL' : 'COMPLETE'} in ${elapsed}s`);
  console.log(`   total seen:        ${stats.total}`);
  console.log(`   processed:         ${stats.processed}`);
  console.log(`   ├ cleaned (Gemini):    ${stats.cleaned}`);
  console.log(`   ├ heuristic skip:      ${stats.heuristicSkip}`);
  console.log(`   ├ already cached:      ${stats.cached}`);
  console.log(`   ├ filtered discounter: ${stats.filteredDiscounter}`);
  console.log(`   ├ no source bild:      ${stats.noSource}`);
  console.log(`   └ failed:              ${stats.failed}`);
  console.log(`   estimated cost:    $${stats.estimatedCostUsd.toFixed(2)}`);
  console.log('━'.repeat(60));
  process.exit(aborted ? 2 : 0);
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
