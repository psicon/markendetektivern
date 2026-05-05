/**
 * Cashback / Kassenbon Async Pipeline — Phase 2.
 *
 *   App                                        Cloud Functions
 *   ┌──────────────────┐  cashbackEnqueue   ┌──────────────────────┐
 *   │ /cashback/review │ ──── HTTPS ──────▶ │ enqueueCashback()    │
 *   │ uploads to GCS   │  { storagePath, …} │ • auth + consent gate│
 *   │ + calls function │ ◀──── 200 ──────── │ • idempotency        │
 *   └──────────────────┘  { cashbackId, … } │ • daily cap          │
 *                                            │ • create Firestore   │
 *                                            │ • publish PubSub     │
 *                                            └──────────┬───────────┘
 *                                                       │ async
 *                                                       ▼
 *                                            ┌──────────────────────┐
 *                                            │ processCashback()    │
 *                                            │ • download image     │
 *                                            │ • Gemini OCR         │
 *                                            │ • reconciliation     │
 *                                            │ • tier formula       │
 *                                            │ • write back doc     │
 *                                            │ • FCM push (stub)    │
 *                                            └──────────────────────┘
 *
 * Deploy:
 *   firebase deploy --only functions:cashback-pipeline
 *
 * Env vars (set via `firebase functions:config:set` or Secret Manager):
 *   GEMINI_API_KEY     — for the OCR call
 *   CASHBACK_OCR_MODEL — optional override (default gemini-2.5-flash)
 *
 * Region: europe-west3 (matches existing cashback architecture spec).
 *
 * Phase 2.1 follow-ups:
 *   - Real FCM via admin.messaging() once @react-native-firebase/messaging
 *     lands in the app bundle.
 *   - DocAI Expense Parser fallback when Σ-vs-total reconciliation fails.
 *   - BigQuery cost-event streaming.
 *   - Catalog match (productId / brandId per item) — Phase 3.
 */

'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { logger } = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { PubSub } = require('@google-cloud/pubsub');

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

const { extractReceipt, reconcile, countEligibleItems, tierFor, DEFAULT_MODEL } = require('./lib/ocr');
const { extractReceiptCVHybrid } = require('./lib/ocr_cvhybrid');
const { extractReceiptDocAI, isConfigured: isDocAIConfigured } = require('./lib/ocr_docai');
const { resolveMerchant } = require('./lib/merchant');
const { sendCashbackReady } = require('./lib/push');
const {
  computeDHash,
  hammingDistance,
  readExifMeta,
  deriveForensicFlags,
} = require('./lib/forensics');

// OCR engine selection. Default = cv-hybrid (Cloud Vision + Gemini Flash
// text-parser, validated as the winner in Phase 0). Override per-deploy
// via env var if you want to A/B-test the original Gemini-direct path.
const OCR_ENGINE = (process.env.CASHBACK_OCR_ENGINE || 'cv-hybrid').toLowerCase();

// When the primary OCR fails reconciliation (asymmetric tolerance),
// re-run via DocAI Expense Parser as a fallback. Cost: $0.05/page only
// on the bons that need it. Auto-no-op if DocAI env vars unset.
const ESCALATE_ON_RECON_FAIL = process.env.CASHBACK_ESCALATE_DOCAI !== 'false';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west3';
const PUBSUB_TOPIC = 'cashback-ocr-jobs';
const CONFIG_DOC_PATH = 'cashback_config/v1';

// Bon must be no older than this many days (server-time check, not
// client). Avoids backdated bons + bons forgotten in a drawer for
// months. Configurable via cashback_config.maxBonAgeDays in future.
// Currently effectively disabled for testing — bump back to 5 once
// the dev/test phase is done.
const MAX_BON_AGE_DAYS = 9999;

// Hamming-distance threshold for "near-duplicate" dHash matches.
// 0 = bit-identical (same image, possibly re-encoded at different
// JPEG quality). ≤5 still very likely the same image. We pick a
// conservative ≤3 so we catch obvious re-uploads without false-flagging
// distinct bons that happen to be visually similar (two Aldi bons
// with mostly the same items).
const DHASH_DUPLICATE_THRESHOLD = 3;

// How many recent receipts to load for the near-duplicate scan.
// Bigger = better recall, more cost per upload. 50 covers typical
// power users (50 days @ 1 bon/day, or 50 last bons of any cadence).
const DHASH_DEDUP_LOOKBACK = 50;

// In-memory PubSub publisher (re-used across invocations).
const pubsub = new PubSub();

// ─── Helpers ────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  tiers: [
    { minItems: 4, cents: 5 },
    { minItems: 8, cents: 8 },
  ],
  dailyCap: 1,
  throttleHours: 24,
  minItemsForPayout: 4,
  eligibleMerchants: ['aldi', 'lidl', 'edeka', 'rewe', 'kaufland', 'penny', 'netto', 'dm', 'rossmann'],
  ocrModel: DEFAULT_MODEL,
  ocrPromptVersion: 'v1.0',
  manualReviewThreshold: 0.65,
  autoApproveThreshold: 0.85,
  kycRequiredAt: 2000,
  consentVersion: 'v1.0-2026-05',
};

async function loadConfig() {
  try {
    const snap = await db.doc(CONFIG_DOC_PATH).get();
    if (!snap.exists) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...snap.data() };
  } catch (e) {
    logger.warn('config-load-failed', { err: e.message });
    return DEFAULT_CONFIG;
  }
}

function todayBerlin() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

/**
 * Parse an ISO bon-date (YYYY-MM-DD) at noon-local-Berlin. Returns
 * null if unparseable.
 *
 * Why noon: the bon usually only carries a date, not a time. Anchoring
 * at 12:00 dodges DST + edge-of-day timezone weirdness when computing
 * age in days.
 */
function parseBonDateMs(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  // 12:00 UTC is "today" for any DACH timezone (CET/CEST is UTC+1/+2).
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0);
  return Number.isFinite(ms) ? ms : null;
}

function bonAgeDays(iso) {
  const ms = parseBonDateMs(iso);
  if (ms == null) return null;
  return Math.floor((Date.now() - ms) / (24 * 60 * 60 * 1000));
}

/**
 * Per-user purchased-products trail (architecture §3.2). One doc per
 * (receiptId × item-name-slug) so reprocesses are idempotent (same
 * input → same doc-id → set with merge, no dupes).
 */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function writePurchasedProducts(uid, cashbackId, parsed, merchantInfo) {
  if (!parsed || !Array.isArray(parsed.items)) return;
  const col = db.collection(`users/${uid}/purchased_products`);
  const writes = [];
  for (const it of parsed.items) {
    if (!it || !Number.isFinite(it.priceCents) || it.priceCents <= 0) continue;
    const slug = slugify(it.name);
    if (!slug) continue;
    const id = `${cashbackId}_${slug}`;
    writes.push(
      col.doc(id).set(
        {
          itemName: String(it.name || ''),
          priceCents: it.priceCents,
          qty: Number.isFinite(it.qty) ? it.qty : 1,
          receiptId: cashbackId,
          bonDate: parsed.bonDate || null,
          merchantId: merchantInfo?.id || null,
          merchantName: merchantInfo?.name || null,
          merchantLand: merchantInfo?.land || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    );
  }
  await Promise.all(writes).catch((e) =>
    logger.warn('purchased-products-write-failed', { cashbackId, err: e.message }),
  );
}

/**
 * Idempotent ledger sync: enforce that a receiptId has AT MOST one
 * active 'earn' entry, and that the earn matches the current status.
 *
 * Cases handled:
 *   - First-time approved: write 'earn', bump balance + lifetime.
 *   - Already approved before, status still approved: noop (PubSub
 *     redelivery; previous earn is the source of truth).
 *   - Already approved, status now rejected/review: write 'reverse'
 *     for the prior cents, decrement balance + lifetime.
 *   - Status not approved + no prior earn: noop.
 *
 * Runs in a transaction so concurrent re-publishes can't race.
 */
async function syncLedgerForReceipt(userRef, cashbackId, status, cashbackCents, bonDateIso) {
  const ledgerCol = userRef.collection('cashback_ledger');

  await db.runTransaction(async (tx) => {
    // Fetch all existing earn entries for this receipt.
    const earns = await tx.get(
      ledgerCol.where('receiptId', '==', cashbackId).where('type', '==', 'earn'),
    );
    const reverses = await tx.get(
      ledgerCol.where('receiptId', '==', cashbackId).where('type', '==', 'reverse'),
    );

    const totalEarned = earns.docs.reduce((s, d) => s + (d.data().cents || 0), 0);
    const totalReversed = reverses.docs.reduce((s, d) => s + (d.data().cents || 0), 0);
    const netActive = totalEarned - totalReversed;
    const wantApproved = status === 'approved' && cashbackCents > 0;

    const userSnap = await tx.get(userRef);
    const u = userSnap.exists ? userSnap.data() : {};
    const balance = u.cashback_balance_cents || 0;
    const lifetime = u.cashback_lifetime_cents || 0;

    if (wantApproved && netActive === 0) {
      // First-time approval (or reapproval after a reverse).
      const ref = ledgerCol.doc();
      tx.set(ref, {
        type: 'earn',
        cents: cashbackCents,
        receiptId: cashbackId,
        balanceAfterCents: balance + cashbackCents,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(
        userRef,
        {
          cashback_balance_cents: balance + cashbackCents,
          cashback_lifetime_cents: lifetime + cashbackCents,
          cashback_last_bon_date: bonDateIso || todayBerlin(),
        },
        { merge: true },
      );
    } else if (wantApproved && netActive > 0) {
      // Already credited (PubSub redelivery). Noop unless cents changed.
      if (netActive !== cashbackCents) {
        const delta = cashbackCents - netActive;
        // Adjust to match current cents — write a delta entry.
        const ref = ledgerCol.doc();
        tx.set(ref, {
          type: delta > 0 ? 'earn' : 'reverse',
          cents: Math.abs(delta),
          receiptId: cashbackId,
          balanceAfterCents: balance + delta,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'amount_correction',
        });
        tx.set(
          userRef,
          {
            cashback_balance_cents: balance + delta,
            cashback_lifetime_cents: lifetime + Math.max(0, delta),
          },
          { merge: true },
        );
      }
    } else if (!wantApproved && netActive > 0) {
      // Was approved, now isn't (reprocess flipped to rejected/review).
      // Reverse the active credit.
      const ref = ledgerCol.doc();
      tx.set(ref, {
        type: 'reverse',
        cents: netActive,
        receiptId: cashbackId,
        balanceAfterCents: Math.max(0, balance - netActive),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'reprocess_to_' + status,
      });
      tx.set(
        userRef,
        {
          cashback_balance_cents: Math.max(0, balance - netActive),
          cashback_lifetime_cents: Math.max(0, lifetime - netActive),
        },
        { merge: true },
      );
    }
    // else: not approved + no prior earn — noop.
  });
}

async function verifyAuthFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return decoded;
  } catch (e) {
    logger.warn('verifyIdToken-failed', { err: e.message });
    return null;
  }
}

// ─── enqueueCashback (HTTPS) ────────────────────────────────────────

exports.enqueueCashback = onRequest(
  // 512MiB + 60s: forensics step downloads the bon image, runs sharp
  // (native) for dHash, parses EXIF, scans last 50 receipts for
  // near-duplicates. ~500-800ms typical, headroom for cold-start.
  { region: REGION, timeoutSeconds: 60, memory: '512MiB', cors: true, invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ code: 'method_not_allowed' });
      return;
    }

    const decoded = await verifyAuthFromRequest(req);
    if (!decoded?.uid) {
      res.status(401).json({ code: 'unauthenticated' });
      return;
    }
    const uid = decoded.uid;

    const body = req.body || {};
    const {
      storagePath,
      bytesHash,
      capturedAt,
      perceptualHash,
      source,
      journey,
      clientUploadId, // optional: client's pre-allocated id for the receipt doc
    } = body;
    if (!storagePath || !bytesHash) {
      res.status(400).json({ code: 'invalid_image', message: 'storagePath + bytesHash required' });
      return;
    }
    // Defense-in-depth: storagePath must live under cashback-uploads/{uid}/.
    if (!storagePath.startsWith(`cashback-uploads/${uid}/`)) {
      res.status(403).json({ code: 'invalid_image', message: 'storagePath outside user prefix' });
      return;
    }

    const config = await loadConfig();

    // Consent gate
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const consent = userData.cashback_consent || {};
    if (!consent.accepted || consent.version !== config.consentVersion) {
      res.status(403).json({ code: 'consent_missing' });
      return;
    }

    // Daily cap (Bon-Datum semantics — server only knows upload date here;
    // processCashback re-checks against the OCR'd Bon-Datum once available).
    const today = todayBerlin();
    if (userData.cashback_last_bon_date === today) {
      res.status(429).json({ code: 'rate_limited', message: 'daily cap reached' });
      return;
    }

    // ─── Layer 1: exact-byte duplicate (sha256) ──────────────────────
    // Cheapest check first: caught the trivial "user retry-tapped" case
    // without any image processing.
    const dedupQuery = await db
      .collection('receipts')
      .where('userId', '==', uid)
      .where('capture.hash', '==', bytesHash)
      .limit(1)
      .get();
    if (!dedupQuery.empty) {
      const existing = dedupQuery.docs[0];
      // If the client wrote a placeholder mirror doc with a different
      // id, mark it as superseded so it disappears from the user's
      // history (the canonical existing receipt is the source of truth).
      if (clientUploadId && clientUploadId !== existing.id) {
        await db
          .doc(`users/${uid}/cashback_status/${clientUploadId}`)
          .set(
            {
              status: 'superseded',
              supersededBy: existing.id,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch(() => {});
      }
      res.status(200).json({
        cashbackId: existing.id,
        status: existing.get('status'),
        duplicate: true,
        duplicateMode: 'exact',
      });
      return;
    }

    // ─── Layer 2: server-side image forensics (dHash + EXIF) ─────────
    // This is the meaningful anti-fraud step — catches:
    //   - same bon re-encoded at different JPEG quality (sha256 misses)
    //   - same bon cropped slightly differently (sha256 misses)
    //   - bons photographed weeks ago (EXIF age cross-check)
    //   - bons edited in Photoshop/GIMP (EXIF software flag)
    //
    // Costs ~500-800ms (storage download + sharp resize + Firestore
    // dedup lookup of last 50 receipts). Done BEFORE PubSub publish
    // so we don't waste OCR cents on known-bad uploads.
    let serverDhash = null;
    let exifMeta = null;
    let forensicFlags = null;
    let serverBytesSize = 0;
    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);
      const [bytes] = await file.download();
      serverBytesSize = bytes.length;

      // Compute server-trusted hash + read EXIF in parallel
      const [dHash, exif] = await Promise.all([
        computeDHash(bytes),
        readExifMeta(bytes),
      ]);
      serverDhash = dHash;
      exifMeta = exif;
      forensicFlags = deriveForensicFlags(exif, Date.now(), MAX_BON_AGE_DAYS);

      // Hard reject: EXIF says the photo is too old or future-dated
      if (forensicFlags.exifAgeRejectable) {
        logger.warn('forensics-reject-exif-age', {
          uid,
          exifAgeDays: forensicFlags.exifAgeDays,
          maxBonAgeDays: MAX_BON_AGE_DAYS,
        });
        res.status(422).json({
          code: 'bon_too_old',
          message: forensicFlags.exifAgeDays > 0
            ? `Bon ist ${Math.round(forensicFlags.exifAgeDays)} Tage alt — max. ${MAX_BON_AGE_DAYS} Tage erlaubt.`
            : 'Bon-Aufnahmezeit liegt in der Zukunft — bitte Geräte-Uhr prüfen.',
          exifAgeDays: forensicFlags.exifAgeDays,
        });
        return;
      }

      // Near-duplicate scan: dHash equality first (Firestore exact match,
      // catches the bit-identical pHash case after JPEG re-encoding).
      // Then Hamming-distance scan over the user's recent receipts to
      // catch crop/resave attacks where bits flip a little.
      const exactDhashQuery = await db
        .collection('receipts')
        .where('userId', '==', uid)
        .where('capture.perceptualHashServer', '==', serverDhash)
        .limit(1)
        .get();

      let nearDuplicate = null;
      if (!exactDhashQuery.empty) {
        nearDuplicate = { doc: exactDhashQuery.docs[0], distance: 0, mode: 'dhash_exact' };
      } else {
        // Hamming-distance scan: pull last N receipts that have a
        // server-dHash, compute distance client-side. This is bounded
        // by DHASH_DEDUP_LOOKBACK so cost is predictable.
        const recentSnap = await db
          .collection('receipts')
          .where('userId', '==', uid)
          .orderBy('createdAt', 'desc')
          .limit(DHASH_DEDUP_LOOKBACK)
          .get();
        for (const d of recentSnap.docs) {
          const otherHash = d.get('capture.perceptualHashServer');
          if (typeof otherHash !== 'string' || otherHash.length !== serverDhash.length) continue;
          const dist = hammingDistance(serverDhash, otherHash);
          if (dist >= 0 && dist <= DHASH_DUPLICATE_THRESHOLD) {
            nearDuplicate = { doc: d, distance: dist, mode: 'dhash_near' };
            break;
          }
        }
      }

      if (nearDuplicate) {
        const existing = nearDuplicate.doc;
        if (clientUploadId && clientUploadId !== existing.id) {
          await db
            .doc(`users/${uid}/cashback_status/${clientUploadId}`)
            .set(
              {
                status: 'superseded',
                supersededBy: existing.id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
            .catch(() => {});
        }
        logger.info('forensics-duplicate', {
          uid,
          existingId: existing.id,
          mode: nearDuplicate.mode,
          distance: nearDuplicate.distance,
        });
        res.status(200).json({
          cashbackId: existing.id,
          status: existing.get('status'),
          duplicate: true,
          duplicateMode: nearDuplicate.mode,
          duplicateDistance: nearDuplicate.distance,
        });
        return;
      }
    } catch (e) {
      // Non-fatal: if forensics fail (e.g. storage IAM hiccup), log
      // and continue without the signal. Better to under-flag than to
      // block legit users on infra glitches.
      logger.warn('forensics-failed', { uid, err: e.message });
    }

    // Use the client-provided id (so the placeholder mirror doc and
    // the receipt doc share the id, and the live snapshot keeps working
    // through the entire lifecycle without identity changes).
    const docRef = clientUploadId
      ? db.collection('receipts').doc(clientUploadId)
      : db.collection('receipts').doc();
    const cashbackId = docRef.id;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const estimatedReadyBy = Date.now() + 30_000;

    // Sanitize journey snapshot — strip anything that isn't a primitive
    // or plain object (DocumentReferences from the client would explode
    // here). We only persist what's safe for analytics + audit.
    const safeJourney =
      journey && typeof journey === 'object'
        ? {
            journeyId: journey.journeyId ? String(journey.journeyId) : null,
            discoveryMethod: journey.discoveryMethod ? String(journey.discoveryMethod) : null,
            startedAt: Number.isFinite(journey.startedAt) ? Number(journey.startedAt) : null,
            location:
              journey.location && typeof journey.location === 'object'
                ? {
                    lat: Number(journey.location.lat) || null,
                    lon: Number(journey.location.lon) || null,
                    city: journey.location.city ? String(journey.location.city) : null,
                    geohash5: journey.location.geohash5 ? String(journey.location.geohash5) : null,
                    source: journey.location.source ? String(journey.location.source) : null,
                  }
                : null,
            motivationSignals:
              journey.motivationSignals && typeof journey.motivationSignals === 'object'
                ? {
                    priceSignals: Number(journey.motivationSignals.priceSignals) || 0,
                    brandSignals: Number(journey.motivationSignals.brandSignals) || 0,
                    contentSignals: Number(journey.motivationSignals.contentSignals) || 0,
                    marketSignals: Number(journey.motivationSignals.marketSignals) || 0,
                    searchTerms: Array.isArray(journey.motivationSignals.searchTerms)
                      ? journey.motivationSignals.searchTerms.slice(0, 20).map(String)
                      : [],
                  }
                : null,
            filterMetricsMotivation: journey.filterMetricsMotivation
              ? String(journey.filterMetricsMotivation)
              : null,
            viewedProductsCount: Number(journey.viewedProductsCount) || 0,
          }
        : null;

    await docRef.set({
      userId: uid,
      status: 'ocr_pending',
      capture: {
        source: source || 'live_camera',
        appCheck: false, // wire when the App Check token lands
        deviceAttest: false,
        hash: bytesHash,
        perceptualHash: perceptualHash || null,           // client-provided, untrusted
        perceptualHashServer: serverDhash,                // server-computed, authoritative
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
        // EXIF forensic signals — null when EXIF was missing/unreadable.
        exif: exifMeta
          ? {
              capturedAtMs: exifMeta.capturedAtMs,
              make: exifMeta.make,
              model: exifMeta.model,
              software: exifMeta.software,
              present: exifMeta.present,
            }
          : null,
        forensicFlags: forensicFlags || null,
      },
      storage: {
        bucket: admin.storage().bucket().name,
        path: storagePath,
        contentType: 'image/jpeg',
        sizeBytes: serverBytesSize, // we now know it from the forensics download
      },
      journey: safeJourney,
      createdAt: now,
      updatedAt: now,
    });

    // Update the user-side mirror to ocr_pending. If the client wrote
    // a placeholder mirror earlier ('uploading'), this merges into it;
    // if not, it creates the doc fresh.
    await db.doc(`users/${uid}/cashback_status/${cashbackId}`).set(
      {
        status: 'ocr_pending',
        receiptId: cashbackId,
        cashbackCents: 0,
        isClientPlaceholder: false,
        updatedAt: now,
      },
      { merge: true },
    );

    // Publish PubSub
    try {
      const topic = pubsub.topic(PUBSUB_TOPIC);
      await topic
        .publishMessage({
          json: { cashbackId, uid },
          attributes: { uid, cashbackId },
        })
        .catch(async (e) => {
          if (e.code === 5) {
            // NOT_FOUND — auto-create on first call.
            await pubsub.createTopic(PUBSUB_TOPIC).catch(() => {});
            await pubsub.topic(PUBSUB_TOPIC).publishMessage({
              json: { cashbackId, uid },
              attributes: { uid, cashbackId },
            });
          } else {
            throw e;
          }
        });
    } catch (e) {
      logger.error('pubsub-publish-failed', { err: e.message, cashbackId });
      await docRef.update({ status: 'rejected', updatedAt: now, rejectReason: 'pubsub_publish_failed' });
      res.status(500).json({ code: 'internal' });
      return;
    }

    res.status(200).json({
      cashbackId,
      status: 'ocr_pending',
      estimatedReadyBy,
    });
  },
);

// ─── processCashback (PubSub) ───────────────────────────────────────

exports.processCashback = onMessagePublished(
  {
    region: REGION,
    topic: PUBSUB_TOPIC,
    timeoutSeconds: 120,
    memory: '1GiB',
    secrets: [GEMINI_API_KEY],
  },
  async (event) => {
    const data = event.data.message.json || {};
    const { cashbackId, uid } = data;
    if (!cashbackId || !uid) {
      logger.error('process-bad-payload', { data });
      return;
    }

    const docRef = db.doc(`receipts/${cashbackId}`);
    const snap = await docRef.get();
    if (!snap.exists) {
      logger.warn('process-no-doc', { cashbackId });
      return;
    }
    const receipt = snap.data();
    if (receipt.userId !== uid) {
      logger.warn('process-uid-mismatch', { cashbackId, expected: receipt.userId, got: uid });
      return;
    }

    const config = await loadConfig();
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      // 1) Download image bytes from Storage
      const bucket = admin.storage().bucket(receipt.storage.bucket);
      const file = bucket.file(receipt.storage.path);
      const [bytes] = await file.download();
      const [metadata] = await file.getMetadata();
      const sizeBytes = Number(metadata.size) || bytes.length;
      const mimeType = metadata.contentType || 'image/jpeg';

      // 2) Primary OCR — engine selected via CASHBACK_OCR_ENGINE env var
      //    (default: cv-hybrid, the Phase-0 validated winner).
      let ocr;
      if (OCR_ENGINE === 'cv-hybrid') {
        ocr = await extractReceiptCVHybrid(bytes, mimeType, { model: config.ocrModel });
      } else {
        // Legacy path — direct Gemini-on-image. Less stable, kept for rollback.
        ocr = await extractReceipt(bytes, mimeType, { model: config.ocrModel });
        ocr.engine = ocr.engine || 'gemini-direct';
        ocr.cvLatencyMs = 0;
        ocr.geminiLatencyMs = ocr.latencyMs;
        ocr.ocrText = '';
      }

      // 3) Reconciliation — asymmetric tolerance (Σ < total: ±200¢ for
      //    Pfand; Σ > total: only ±50¢ — that's the suspicious direction).
      let recon = reconcile(ocr.parsed);

      // 3a) Escalation: if primary failed recon AND DocAI is configured,
      //     re-run the bon through DocAI Expense Parser. Take whichever
      //     result has the smaller |signedDelta| (or DocAI if it passes
      //     and primary doesn't).
      let escalation = { fired: false };
      if (
        !recon.ok
        && ESCALATE_ON_RECON_FAIL
        && isDocAIConfigured()
        && ocr.parsed?.isReceipt !== false
      ) {
        try {
          const docai = await extractReceiptDocAI(bytes, mimeType);
          if (docai && docai.parsed) {
            const docaiRecon = reconcile(docai.parsed);
            const primaryAbsDelta = recon.deltaCents == null ? Infinity : recon.deltaCents;
            const docaiAbsDelta = docaiRecon.deltaCents == null ? Infinity : docaiRecon.deltaCents;
            const swap =
              docaiRecon.ok && !recon.ok
                ? true
                : docaiAbsDelta < primaryAbsDelta;
            escalation = {
              fired: true,
              swapped: swap,
              primaryEngine: ocr.engine,
              primaryDeltaCents: recon.deltaCents,
              primaryDirection: recon.direction,
              docaiDeltaCents: docaiRecon.deltaCents,
              docaiDirection: docaiRecon.direction,
              docaiLatencyMs: docai.latencyMs,
            };
            if (swap) {
              ocr = docai;
              recon = docaiRecon;
            }
          } else {
            escalation = { fired: true, swapped: false, reason: 'docai_no_result' };
          }
        } catch (e) {
          logger.warn('escalation-failed', { cashbackId, err: e.message });
          escalation = { fired: true, swapped: false, reason: e.message };
        }
      }

      // 4) Bon-Datum freshness check (server-side, Berlin-anchored).
      // Bons older than MAX_BON_AGE_DAYS are rejected — protects
      // against backdated bons + the "drawer treasure" case where a
      // user submits a 6-month-old bon all at once.
      const ageDays = bonAgeDays(ocr.parsed.bonDate);

      // 5) Merchant resolution against /discounter, country-aware.
      const merchantInfo = await resolveMerchant(
        ocr.parsed.merchant,
        ocr.parsed.bonCountry,
      );

      // 6) Eligibility + tier (only computed if all gates pass)
      const eligibleItemCount = countEligibleItems(ocr.parsed);
      const cashbackCents =
        merchantInfo && recon.ok && (ageDays == null || ageDays <= MAX_BON_AGE_DAYS)
          ? tierFor(eligibleItemCount, config.tiers)
          : 0;

      // 7) Decide status (priority: not-a-receipt > unknown-merchant >
      //                  too-old > recon > below-min)
      let status = 'matched';
      let rejectReason = null;
      if (!ocr.parsed.isReceipt) {
        status = 'rejected';
        rejectReason = ocr.parsed.notReceiptReason || 'not_a_receipt';
      } else if (!merchantInfo) {
        status = 'rejected';
        rejectReason = 'unknown_merchant';
      } else if (ageDays != null && ageDays > MAX_BON_AGE_DAYS) {
        status = 'rejected';
        rejectReason = 'bon_too_old';
      } else if (ageDays == null) {
        // Bon-Datum fehlt komplett → manuell prüfen
        status = 'review';
        rejectReason = 'no_bon_date';
      } else if (!recon.ok) {
        status = 'review';
        rejectReason = 'reconciliation_delta';
      } else if (cashbackCents === 0) {
        status = 'rejected';
        rejectReason = 'below_min_items';
      } else {
        status = 'approved';
      }

      // 6a) Mirror the status into the user sub-collection (so the
      // app's pending screen can listen without top-level rules).
      // Includes items + the bucket+path of the bon image so the
      // client can resolve a download URL via Firebase Storage SDK
      // (storage rules permit the owner to read their own bons —
      // simpler + more reliable than admin-side signed URLs which
      // need iam.serviceAccountTokenCreator on the runtime SA).
      const slimItems = Array.isArray(ocr.parsed.items)
        ? ocr.parsed.items.map((it) => ({
            name: String(it.name ?? ''),
            qty: Number.isFinite(it.qty) ? it.qty : 1,
            priceCents: Number.isFinite(it.priceCents) ? it.priceCents : 0,
            eligible: Number.isFinite(it.priceCents) && it.priceCents > 0,
          }))
        : [];

      await db
        .doc(`users/${uid}/cashback_status/${cashbackId}`)
        .set(
          {
            status,
            receiptId: cashbackId,
            cashbackCents,
            tierApplied: cashbackCents,
            eligibleItemCount,
            merchantRaw: ocr.parsed.merchant ?? null,
            merchantId: merchantInfo?.id ?? null,
            merchantName: merchantInfo?.name ?? null,
            merchantDisplayName: merchantInfo?.displayName ?? null,
            merchantLogoUrl: merchantInfo?.logoUrl ?? null,
            merchantLand: merchantInfo?.land ?? null,
            merchantMatchVia: merchantInfo?.matchVia ?? null,
            bonCountry: ocr.parsed.bonCountry ?? null,
            bonDate: ocr.parsed.bonDate || null,
            bonAgeDays: ageDays,
            bonTotalCents: ocr.parsed.totalCents ?? null,
            items: slimItems,
            storageBucket: receipt.storage?.bucket ?? null,
            storagePath: receipt.storage?.path ?? null,
            reconciliationDeltaCents: recon.deltaCents ?? null,
            reconciliationDirection: recon.direction ?? null,
            ocrEngine: ocr.engine ?? null,
            escalation: escalation?.fired ? escalation : null,
            rejectReason,
            updatedAt: now,
          },
          { merge: true },
        );

      // 7) Write authoritative doc to top-level /receipts/*
      await docRef.update({
        status,
        rejectReason,
        ocr: {
          model: ocr.model,
          engine: ocr.engine ?? null,
          promptVersion: ocr.promptVersion,
          latencyMs: ocr.latencyMs,
          cvLatencyMs: ocr.cvLatencyMs ?? null,
          geminiLatencyMs: ocr.geminiLatencyMs ?? null,
          parsed: ocr.parsed,
          confidence: ocr.parsed.ocrConfidence ?? null,
          escalation: escalation?.fired ? escalation : null,
          reconciliation: {
            ok: recon.ok,
            sumItemsCents: recon.sumItemsCents,
            totalCents: ocr.parsed.totalCents ?? null,
            deltaCents: recon.deltaCents,
            signedDeltaCents: recon.signedDeltaCents,
            direction: recon.direction,
          },
        },
        merchant: merchantInfo
          ? { id: merchantInfo.id, name: merchantInfo.name, raw: ocr.parsed.merchant ?? null, matchedScore: 1 }
          : ocr.parsed.merchant
          ? { id: 'unknown', raw: ocr.parsed.merchant, matchedScore: 0 }
          : null,
        bonDate: ocr.parsed.bonDate || null,
        bonTime: ocr.parsed.bonTime || null,
        bonTotalCents: ocr.parsed.totalCents ?? null,
        items: Array.isArray(ocr.parsed.items)
          ? ocr.parsed.items.map((it) => ({
              raw: it.name,
              qty: it.qty ?? 1,
              priceCents: it.priceCents,
              eligible: Number.isFinite(it.priceCents) && it.priceCents > 0,
            }))
          : [],
        eligibleItemCount,
        tierApplied: cashbackCents,
        cashbackCents,
        'storage.sizeBytes': sizeBytes,
        updatedAt: now,
      });

      // 7) Ledger sync — idempotent on receiptId.
      // PubSub may redeliver, and we may explicitly re-publish for a
      // re-process. Either way: at most ONE active earn per receiptId.
      // If reprocess flips approved→rejected, we reverse the earlier earn.
      const userRef = db.doc(`users/${uid}`);
      await syncLedgerForReceipt(userRef, cashbackId, status, cashbackCents, ocr.parsed.bonDate);

      if (status === 'approved' && cashbackCents > 0) {
        // 7a) Per-user purchased products audit (architecture §3.2).
        // One doc per item-name × bon — gives an at-a-glance "what did
        // I buy here" trail under the user. We use a deterministic
        // doc id so reprocessing doesn't multiply entries.
        await writePurchasedProducts(uid, cashbackId, ocr.parsed, merchantInfo);

        // 8) Push (currently stub-logs)
        await sendCashbackReady(uid, {
          title: '🎉 Cashback bereit!',
          body: `Du hast ${(cashbackCents / 100).toFixed(2).replace('.', ',')} € Cashback erhalten.`,
          cashbackId,
        });
      }

      logger.info('process-done', {
        cashbackId,
        status,
        engine: ocr.engine,
        latencyMs: ocr.latencyMs,
        cvLatencyMs: ocr.cvLatencyMs ?? null,
        geminiLatencyMs: ocr.geminiLatencyMs ?? null,
        cashbackCents,
        eligibleItemCount,
        deltaCents: recon.deltaCents,
        signedDeltaCents: recon.signedDeltaCents,
        direction: recon.direction,
        escalated: escalation?.fired ? escalation.swapped : false,
      });
    } catch (err) {
      logger.error('process-failed', { cashbackId, err: err.message, stack: err.stack });
      await docRef
        .update({
          status: 'rejected',
          rejectReason: err.code || 'process_error',
          updatedAt: now,
        })
        .catch(() => {});
      // Also update the user-side mirror so the app's pending screen
      // and history page reflect the failure (otherwise it stays
      // stuck on "wird geprüft" forever).
      await db
        .doc(`users/${uid}/cashback_status/${cashbackId}`)
        .set(
          {
            status: 'rejected',
            rejectReason: err.code || 'process_error',
            updatedAt: now,
          },
          { merge: true },
        )
        .catch(() => {});
      throw err; // let PubSub retry policy take over
    }
  },
);
