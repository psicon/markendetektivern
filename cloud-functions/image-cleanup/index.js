/**
 * Image-Cleanup — Firebase Cloud Functions (Gen2).
 *
 * Triggers (per Firestore document, both collections):
 *   onCreate      → if `bild` is set, run pipeline + write `bildClean`.
 *   onUpdate      → only if `bild` actually changed; otherwise no-op.
 *   onDelete      → remove the cleaned WebP from Storage.
 *
 * IMPORTANT — by design, the original `bild` field and the original
 * Storage file are NEVER modified. The pipeline only writes
 *   • Storage prefix `productimagesclean/...`
 *   • Firestore fields `bildClean`, `bildCleanVersion`,
 *     `bildCleanSource`, `bildCleanProcessedAt`, `bildCleanError`,
 *     `bildCleanErrorAt`.
 *
 * Deploy:
 *   firebase deploy --only functions:image-cleanup
 *
 * Required secret (set once via Firebase CLI):
 *   firebase functions:secrets:set GEMINI_API_KEY
 *
 * Cost (live, ~100 new products/day, ~50 % AI rate):
 *   • Gemini 2.5 Flash Image (Standard tier): ~$0.039 per image
 *   • Cloud Functions execution: ~$1/month
 *   • Total: ~$60/month
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v2');
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } =
  require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenAI } = require('@google/genai');

const {
  // `processProductImageWithFallbacks` runs the same default-A-B
  // retry ladder we use in the backfill scripts, so newly-added
  // products get full recovery treatment automatically. The bare
  // `processProductImage` is still exported for one-shot scripts
  // that orchestrate their own retry loops.
  processProductImageWithFallbacks,
  deleteCleanedImage,
  COLLECTION_TO_SUBFOLDER,
} = require('./pipeline');

// ─── Init ──────────────────────────────────────────────────────────

admin.initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const REGION = 'europe-west1';
const TIMEOUT_SECONDS = 540; // 9 min — Gemini is fast (~10 s) but
                             // network / Firestore writes can stutter.
const MEMORY = '1GiB';       // sharp + Gemini SDK fit comfortably.

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Lazy-init the Gemini client per-invocation. Cloud Function instances
 * are reused across warm starts, but the client is cheap to create.
 */
function newGenAI() {
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });
}

/**
 * Wraps the pipeline call with the shared admin instances. Logs the
 * outcome for Cloud Logging visibility.
 */
async function runPipeline(collection, productId, source) {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const genAI = newGenAI();
  const t0 = Date.now();
  // `processProductImageWithFallbacks` tries the default config
  // first, then strategy A (reframed prompt, same model), then
  // strategy B (Gemini 3 Pro). It only retries on Gemini-content-
  // filter errors (IMAGE_OTHER / IMAGE_RECITATION / IMAGE_SAFETY)
  // — network / 404 / source-decode failures fall through to the
  // first error so we don't burn Gemini quota on unrelated issues.
  const result = await processProductImageWithFallbacks({
    db,
    bucket,
    genAI,
    collection,
    productId,
  });
  const ms = Date.now() - t0;
  if (result.status === 'error') {
    console.warn(
      `[image-cleanup] ${source} ${collection}/${productId} FAILED in ${ms}ms: ${result.reason}`,
    );
  } else {
    console.log(
      `[image-cleanup] ${source} ${collection}/${productId} → ${result.status} in ${ms}ms`,
    );
  }
  return result;
}

// ─── markenProdukte triggers ───────────────────────────────────────
//
// CREATE / UPDATE are intentionally NOT wired up.
//
// Markenprodukte arrive in the database with curated, near-studio-
// quality manufacturer photos ~99 % of the time, so auto-running
// Gemini on every new doc would burn budget for no perceptible win.
// The 1 % that DO need cleanup gets triggered manually from the
// admin side via:
//
//   cd cloud-functions/image-cleanup
//   COLLECTION=markenProdukte LIMIT=1 \
//     GEMINI_API_KEY=… FIREBASE_SERVICE_ACCOUNT="$(cat …)" \
//     node backfill.js
//
// (or by passing a FORCE=1 + filtering to a specific docId — see
// backfill.js for the full env-var contract). The DELETE trigger
// stays so storage gets cleaned up if a markenProdukt is removed.

exports.onMarkenProduktDelete = onDocumentDeleted(
  {
    document: 'markenProdukte/{productId}',
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event) => {
    const bucket = admin.storage().bucket();
    await deleteCleanedImage({
      bucket,
      collection: 'markenProdukte',
      productId: event.params.productId,
    });
  },
);

// ─── produkte (NoName) triggers ────────────────────────────────────

exports.onProduktCreate = onDocumentCreated(
  {
    document: 'produkte/{productId}',
    region: REGION,
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: TIMEOUT_SECONDS,
    memory: MEMORY,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data?.bild) return;
    await runPipeline('produkte', event.params.productId, 'onCreate');
  },
);

exports.onProduktUpdate = onDocumentUpdated(
  {
    document: 'produkte/{productId}',
    region: REGION,
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: TIMEOUT_SECONDS,
    memory: MEMORY,
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after?.bild) return;
    if (before?.bild === after.bild) return;
    await runPipeline('produkte', event.params.productId, 'onUpdate');
  },
);

exports.onProduktDelete = onDocumentDeleted(
  {
    document: 'produkte/{productId}',
    region: REGION,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (event) => {
    const bucket = admin.storage().bucket();
    await deleteCleanedImage({
      bucket,
      collection: 'produkte',
      productId: event.params.productId,
    });
  },
);
