/**
 * Targeted retry for items the main backfill couldn't clean.
 *
 * Streams docs in `produkte` (or `markenProdukte`) where
 *   • `bildClean` is empty
 *   • `bildCleanError` is set
 * and re-runs `processProductImage` on each ONE WITH A CUSTOM PROMPT
 * AND/OR MODEL. Items that succeed get their `bildClean*` fields
 * populated like any other; items that still fail retain the (newer)
 * error string so a subsequent strategy can pick them up.
 *
 * USAGE
 *   cd cloud-functions/image-cleanup
 *   STRATEGY=A \
 *   COLLECTION=produkte \
 *   GEMINI_API_KEY=AIza... \
 *   FIREBASE_SERVICE_ACCOUNT="$(cat path/to/sa.json)" \
 *     node retry-failures.js
 *
 * Env vars:
 *   STRATEGY      = A | B    (required — see PROMPT_VARIANTS below)
 *   COLLECTION    = produkte | markenProdukte | all   (default produkte)
 *   CONCURRENCY   = 6        (lower than backfill; Pro is slower)
 *   LIMIT         = 50       (smoke-test cap)
 *
 * Strategies:
 *   A — Same model (gemini-2.5-flash-image), but a REFRAMED prompt
 *       that treats the input as "an editing job for the package
 *       only, treating any human anatomy as backdrop noise to ignore".
 *       Often slips past IMAGE_OTHER for hand-holding photos.
 *   B — Switch to `gemini-3-pro-image-preview` (Nano Banana Pro,
 *       newest tier) with the same B-tuned prompt. Different filter
 *       pipeline; recommended pickup for whatever A leaves behind.
 */

const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const { processProductImage } = require('./pipeline');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ Set FIREBASE_SERVICE_ACCOUNT'); process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Set GEMINI_API_KEY'); process.exit(1);
}
const STRATEGY = (process.env.STRATEGY || '').toUpperCase();
if (!['A', 'B'].includes(STRATEGY)) {
  console.error('❌ Set STRATEGY=A or STRATEGY=B'); process.exit(1);
}
const COLLECTION_FILTER = (process.env.COLLECTION || 'produkte').toLowerCase();
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '6', 10);
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;

// ─── Strategy table ────────────────────────────────────────────────
const PROMPT_VARIANTS = {
  // A — same model, prompt reframed as "package extraction" with a
  //     hard rule that the model must IGNORE anything that isn't the
  //     rectangular grocery package. Phrasing tested to be less likely
  //     to hit `IMAGE_OTHER` than a "remove the hand" framing.
  A: [
    'TASK: Reproduce the rectangular grocery package shown in the input on a pure white #FFFFFF background. The output is a clean studio product shot — like a stock photograph for an online supermarket catalogue.',
    '',
    'WHAT TO RENDER:',
    'Only the rectangular package (box, bag, bottle, can — whatever the product is). Reproduce it pixel-faithfully: same brand text, same colors, same proportions, same camera angle.',
    '',
    'WHAT TO IGNORE:',
    'Anything in the input that is NOT the package — store shelves, floors, ceilings, fingertips at the edge of the frame, surfaces, lighting glare, other products, signage. None of these appear in the output.',
    '',
    'BACKGROUND: pure solid white (#FFFFFF). No gradient, no texture, no shadow.',
    '',
    'FRAMING: package centred, fills ~90 % of the canvas, ~5 % white margin on every side.',
    '',
    'CAMERA: keep the input\'s exact perspective and angle.',
    '',
    'STRICT RULES:',
    '1. Do not modify the package design, text, logo, or shape.',
    '2. Do not add or invent details that aren\'t clearly visible in the input.',
    '3. Do not add stylistic effects, shadows, reflections, or borders.',
    '4. Do not include any object other than the package itself.',
  ].join('\n'),

  // B — same prompt as A but tuned for the Pro model, which seems to
  //     follow detailed output-format hints better.
  B: [
    'TASK: Reproduce the rectangular grocery package shown in the input on a pure white #FFFFFF background. The output is a professional studio product shot — like a high-resolution stock photograph for an online supermarket.',
    '',
    'WHAT TO RENDER:',
    'Only the rectangular package (box, bag, bottle, can — whatever the product is). Reproduce it pixel-faithfully: same brand text, same colors, same proportions, same camera angle.',
    '',
    'WHAT TO IGNORE:',
    'Anything in the input that is NOT the package — store shelves, floors, ceilings, fingertips at the edge of the frame, surfaces, lighting glare, other products, signage. None of these appear in the output.',
    '',
    'BACKGROUND: pure solid white (#FFFFFF). No gradient, no texture, no shadow.',
    '',
    'FRAMING: package centred, fills ~90 % of the canvas, ~5 % white margin on every side.',
    '',
    'CAMERA: keep the input\'s exact perspective and angle.',
    '',
    'STRICT RULES:',
    '1. Do not modify the package design, text, logo, or shape.',
    '2. Do not add or invent details that aren\'t clearly visible in the input.',
    '3. Do not add stylistic effects, shadows, reflections, or borders.',
    '4. Do not include any object other than the package itself.',
    '',
    'OUTPUT FORMAT: photorealistic studio product shot, 1:1 or natural aspect, 1024 px short side or larger, pure white background, package centred.',
  ].join('\n'),
};

const MODELS = {
  A: 'gemini-2.5-flash-image',
  B: 'gemini-3-pro-image-preview', // Nano Banana Pro
};

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: sa.project_id,
  storageBucket: `${sa.project_id}.appspot.com`,
});
const db = admin.firestore();
const bucket = admin.storage().bucket();
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const stats = {
  startedAt: admin.firestore.FieldValue.serverTimestamp(),
  strategy: STRATEGY,
  model: MODELS[STRATEGY],
  total: 0,
  recovered: 0,
  stillFailed: 0,
  costEstimate: 0,
  errors: [],
};

const PROGRESS_DOC = db
  .collection('aggregates')
  .doc(`imageRetry_${STRATEGY}_v1`);

let lastFlush = 0;
async function flushProgress(force) {
  if (!force && Date.now() - lastFlush < 4000) return;
  lastFlush = Date.now();
  await PROGRESS_DOC.set(
    { ...stats,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      errors: stats.errors.slice(-50),
    },
    { merge: true },
  ).catch(() => {});
}

function pLimit(n) {
  let active = 0; const q = [];
  const next = () => {
    if (!q.length || active >= n) return;
    active++;
    const { fn, resolve, reject } = q.shift();
    Promise.resolve().then(fn).then(
      (v) => { active--; resolve(v); next(); },
      (e) => { active--; reject(e); next(); },
    );
  };
  return (fn) => new Promise((resolve, reject) => {
    q.push({ fn, resolve, reject }); next();
  });
}
const limit = pLimit(CONCURRENCY);

// Stream every doc in the collection that has bildCleanError but no
// bildClean. We can't filter `where('bildCleanError', '!=', null)`
// because Firestore needs an index on that — instead we paginate by
// docId and filter client-side.
async function* streamFailedDocs(collectionName) {
  let last = null;
  for (;;) {
    let q = db
      .collection(collectionName)
      .select('bildClean', 'bildCleanError')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const hasClean = !!d.bildClean;
      const hasError = !!d.bildCleanError;
      if (!hasClean && hasError) {
        yield { collection: collectionName, doc };
      }
    }
    last = snap.docs[snap.docs.length - 1];
  }
}

async function retryOne(collection, doc) {
  const productId = doc.id;
  try {
    const result = await processProductImage({
      db, bucket, genAI,
      collection,
      productId,
      options: {
        force: true,
        geminiOverrides: {
          promptText: PROMPT_VARIANTS[STRATEGY],
          model: MODELS[STRATEGY],
        },
      },
    });
    if (result.status === 'cleaned' || result.status === 'heuristic-skip') {
      stats.recovered++;
      // Estimated cost — Pro is roughly the same as 2.5-flash-image
      // ($0.039/img). Update if the docs publish a different number.
      if (result.status === 'cleaned') stats.costEstimate += 0.039;
      return { status: 'ok' };
    }
    stats.stillFailed++;
    stats.errors.push({
      productId,
      reason: (result.reason || 'unknown').slice(0, 200),
      at: new Date().toISOString(),
    });
    return { status: 'still-failed', reason: result.reason };
  } catch (err) {
    stats.stillFailed++;
    const reason = err?.message || String(err);
    stats.errors.push({
      productId,
      reason: reason.slice(0, 200),
      at: new Date().toISOString(),
    });
    return { status: 'error', reason };
  }
}

async function main() {
  console.log('━'.repeat(60));
  console.log(`🔁 Retry failed items — STRATEGY ${STRATEGY}`);
  console.log(`   model:       ${MODELS[STRATEGY]}`);
  console.log(`   collection:  ${COLLECTION_FILTER}`);
  console.log(`   concurrency: ${CONCURRENCY}`);
  console.log(`   limit:       ${LIMIT}`);
  console.log('━'.repeat(60));

  const cols = [];
  if (COLLECTION_FILTER === 'all' || COLLECTION_FILTER === 'markenprodukte') cols.push('markenProdukte');
  if (COLLECTION_FILTER === 'all' || COLLECTION_FILTER === 'produkte') cols.push('produkte');

  await PROGRESS_DOC.set(stats, { merge: true });
  const t0 = Date.now();
  let aborted = false;

  for (const collection of cols) {
    if (aborted) break;
    console.log(`\n📂 Streaming failed ${collection} …`);
    const inflight = [];
    for await (const { doc } of streamFailedDocs(collection)) {
      stats.total++;
      if (stats.recovered + stats.stillFailed >= LIMIT) { aborted = true; break; }

      const p = limit(() => retryOne(collection, doc))
        .then((r) => {
          const tag =
            r.status === 'ok' ? '✓' :
            r.status === 'still-failed' ? '·' :
            '✗';
          console.log(
            `  [${stats.total}] ${tag} ${collection}/${doc.id}` +
              (r.reason ? ` — ${r.reason.slice(0, 80)}` : ''),
          );
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
  console.log(`✅ Retry ${aborted ? 'PARTIAL' : 'COMPLETE'} in ${elapsed}s`);
  console.log(`   total candidates:  ${stats.total}`);
  console.log(`   ├ recovered (✓):   ${stats.recovered}`);
  console.log(`   └ still failed (·):${stats.stillFailed}`);
  console.log(`   cost estimate:     $${stats.costEstimate.toFixed(2)}`);
  console.log('━'.repeat(60));
  process.exit(aborted ? 2 : 0);
}

main().catch((err) => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
