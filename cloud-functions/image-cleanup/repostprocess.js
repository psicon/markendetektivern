/**
 * Re-postprocess existing items from a previous pipeline version.
 *
 * Use case: a pipeline version bump that only changes post-processing
 * (e.g. v6 white-BG → v7 transparent-BG via trim+pad+flood-fill).
 * Gemini's expensive output is already cached in `bildCleanHq` —
 * we download THAT, re-run `renderVariants()` locally, and re-upload
 * the three variants. Cost: $0 in Gemini calls.
 *
 * Targets all items in `markenProdukte` + `produkte` whose
 * `bildCleanVersion` is below the current `PIPELINE_VERSION` AND have
 * a usable `bildCleanHq` URL we can re-fetch.
 *
 * USAGE
 *   cd cloud-functions/image-cleanup
 *   FIREBASE_SERVICE_ACCOUNT="$(cat path/to/serviceAccountKey.json)" \
 *     node repostprocess.js
 *
 * Env vars:
 *   COLLECTION=produkte | markenProdukte | all   (default 'all')
 *   CONCURRENCY=12                                (no rate-limit on
 *                                                   Storage; sharp is
 *                                                   CPU-bound, run more)
 *   LIMIT=50                                      (smoke-test cap)
 *   FORCE=1                                       (re-process even when
 *                                                  already at current
 *                                                  version)
 */

const admin = require('firebase-admin');

const {
  PIPELINE_VERSION,
  ALLOWED_STORAGE_PREFIX,
  COLLECTION_TO_SUBFOLDER,
} = require('./pipeline');
// renderVariants is internal; we re-export-import via require since it
// lives in the same file as PIPELINE_VERSION.
const pipelineModule = require('./pipeline');
const renderVariants = pipelineModule.renderVariants || (() => {
  throw new Error('renderVariants not exported from pipeline.js');
});

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ Set FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}

const COLLECTION_FILTER = (process.env.COLLECTION || 'all').toLowerCase();
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '12', 10);
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const FORCE = !!process.env.FORCE;

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: sa.project_id,
  storageBucket: `${sa.project_id}.appspot.com`,
});
const db = admin.firestore();
const bucket = admin.storage().bucket();

const PROGRESS_DOC = db.collection('aggregates').doc('imageBackfill_v1');

const stats = {
  startedAt: admin.firestore.FieldValue.serverTimestamp(),
  pipelineVersion: PIPELINE_VERSION,
  total: 0,
  reprocessed: 0,
  skippedNoHq: 0,
  skippedAlreadyCurrent: 0,
  failed: 0,
  errors: [],
};

let lastFlush = 0;
async function flushProgress(force) {
  if (!force && Date.now() - lastFlush < 4000) return;
  lastFlush = Date.now();
  await PROGRESS_DOC.set(
    {
      ...stats,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      errors: stats.errors.slice(-50),
    },
    { merge: true },
  ).catch(() => {});
}

function pLimit(n) {
  let active = 0;
  const q = [];
  const next = () => {
    if (!q.length || active >= n) return;
    active++;
    const { fn, resolve, reject } = q.shift();
    Promise.resolve()
      .then(fn)
      .then(
        (v) => { active--; resolve(v); next(); },
        (e) => { active--; reject(e); next(); },
      );
  };
  return (fn) => new Promise((resolve, reject) => {
    q.push({ fn, resolve, reject });
    next();
  });
}
const limit = pLimit(CONCURRENCY);

async function* streamCollection(collectionName) {
  let last = null;
  for (;;) {
    let q = db
      .collection(collectionName)
      .select('bildCleanHq', 'bildCleanVersion')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    for (const doc of snap.docs) yield { collection: collectionName, doc };
    last = snap.docs[snap.docs.length - 1];
  }
}

async function uploadVariant(buf, storagePath, contentType) {
  if (!storagePath.startsWith(ALLOWED_STORAGE_PREFIX)) {
    throw new Error(`Refused to write outside ${ALLOWED_STORAGE_PREFIX}: ${storagePath}`);
  }
  const file = bucket.file(storagePath);
  await file.save(buf, {
    contentType,
    public: true,
    metadata: {
      cacheControl: 'public, max-age=31536000, immutable',
      // `optimized: 'true'` blocks the legacy `optimizeImage` Cloud
      // Function from clobbering our transparent PNG/WebP into opaque
      // JPEG q40. See pipeline.js for the long-form note.
      metadata: {
        pipelineVersion: String(PIPELINE_VERSION),
        reprocessed: '1',
        optimized: 'true',
      },
    },
    resumable: false,
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

async function reprocessOne(collection, doc) {
  const productId = doc.id;
  const data = doc.data();
  const subfolder = COLLECTION_TO_SUBFOLDER[collection];
  if (!subfolder) {
    return { status: 'skip-unknown-collection' };
  }

  if (!FORCE && (data?.bildCleanVersion || 0) >= PIPELINE_VERSION) {
    stats.skippedAlreadyCurrent++;
    return { status: 'skip-current' };
  }
  if (!data?.bildCleanHq || typeof data.bildCleanHq !== 'string') {
    stats.skippedNoHq++;
    return { status: 'skip-no-hq' };
  }

  try {
    // Source: download the cached HQ PNG (Gemini's near-raw output).
    // We re-fetch via Storage, NOT the public URL — bypasses the CDN
    // cache so we always read the latest bytes.
    const hqPath = `${ALLOWED_STORAGE_PREFIX}${subfolder}/${productId}_hq.png`;
    const [hqBuf] = await bucket.file(hqPath).download();

    // Run the new post-processing chain.
    const variants = await renderVariants(hqBuf);

    // Upload all three back. Same paths → over-writes the v6 files.
    const base = `${ALLOWED_STORAGE_PREFIX}${subfolder}/${productId}`;
    const [hqUrl, pngUrl, webpUrl] = await Promise.all([
      uploadVariant(variants.hq, `${base}_hq.png`, 'image/png'),
      uploadVariant(variants.png, `${base}.png`, 'image/png'),
      uploadVariant(variants.webp, `${base}.webp`, 'image/webp'),
    ]);

    // Update Firestore (no `bild` write). Version bump signals to the
    // backfill script + live triggers that this item is current.
    await db.collection(collection).doc(productId).update({
      bildClean: webpUrl,
      bildCleanPng: pngUrl,
      bildCleanHq: hqUrl,
      bildCleanVersion: PIPELINE_VERSION,
      bildCleanProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
      bildCleanError: admin.firestore.FieldValue.delete(),
    });

    stats.reprocessed++;
    return { status: 'ok' };
  } catch (err) {
    stats.failed++;
    stats.errors.push({
      collection,
      productId,
      reason: (err?.message || String(err)).slice(0, 200),
      at: new Date().toISOString(),
    });
    return { status: 'error', reason: err?.message || String(err) };
  }
}

async function main() {
  console.log('━'.repeat(60));
  console.log(`🔁 Re-postprocess v→${PIPELINE_VERSION} (no Gemini)`);
  console.log(`   collection:  ${COLLECTION_FILTER}`);
  console.log(`   concurrency: ${CONCURRENCY}`);
  console.log(`   limit:       ${LIMIT}`);
  console.log(`   force:       ${FORCE}`);
  console.log('━'.repeat(60));

  const cols = [];
  if (COLLECTION_FILTER === 'all' || COLLECTION_FILTER === 'markenprodukte') cols.push('markenProdukte');
  if (COLLECTION_FILTER === 'all' || COLLECTION_FILTER === 'produkte') cols.push('produkte');

  await PROGRESS_DOC.set(stats, { merge: true });
  const t0 = Date.now();
  let aborted = false;

  for (const collection of cols) {
    if (aborted) break;
    console.log(`\n📂 Streaming ${collection} …`);
    const inflight = [];
    for await (const { doc } of streamCollection(collection)) {
      stats.total++;
      if (stats.reprocessed >= LIMIT) { aborted = true; break; }

      const p = limit(() => reprocessOne(collection, doc))
        .then((r) => {
          if (stats.total % 100 === 0 || r.status === 'error') {
            const tag =
              r.status === 'ok' ? '✓' :
              r.status === 'skip-current' ? '·' :
              r.status === 'skip-no-hq' ? '∅' :
              '✗';
            console.log(
              `  [${stats.total}] ${tag} ${collection}/${doc.id}` +
                (r.reason ? ` — ${r.reason.slice(0, 80)}` : ''),
            );
          }
          flushProgress(false).catch(() => {});
        })
        .catch(() => {});
      inflight.push(p);
      if (inflight.length > CONCURRENCY * 2) await inflight.shift();
    }
    await Promise.all(inflight);
  }

  await flushProgress(true);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n' + '━'.repeat(60));
  console.log(`✅ Re-postprocess ${aborted ? 'PARTIAL' : 'COMPLETE'} in ${elapsed}s`);
  console.log(`   total seen:           ${stats.total}`);
  console.log(`   ├ reprocessed:        ${stats.reprocessed}`);
  console.log(`   ├ skipped (current):  ${stats.skippedAlreadyCurrent}`);
  console.log(`   ├ skipped (no HQ):    ${stats.skippedNoHq}`);
  console.log(`   └ failed:             ${stats.failed}`);
  console.log('━'.repeat(60));
  process.exit(aborted ? 2 : 0);
}

main().catch((err) => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
