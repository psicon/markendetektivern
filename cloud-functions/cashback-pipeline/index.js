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
const { sendCashbackReady } = require('./lib/push');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west3';
const PUBSUB_TOPIC = 'cashback-ocr-jobs';
const CONFIG_DOC_PATH = 'cashback_config/v1';

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
  { region: REGION, timeoutSeconds: 30, memory: '256MiB', cors: true, invoker: 'public' },
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
    const { storagePath, bytesHash, capturedAt, perceptualHash, source } = body;
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

    // Idempotency: dedup on bytesHash (24h window).
    const dedupQuery = await db
      .collection('receipts')
      .where('userId', '==', uid)
      .where('capture.hash', '==', bytesHash)
      .limit(1)
      .get();
    if (!dedupQuery.empty) {
      const existing = dedupQuery.docs[0];
      res.status(200).json({
        cashbackId: existing.id,
        status: existing.get('status'),
        duplicate: true,
      });
      return;
    }

    const docRef = db.collection('receipts').doc();
    const cashbackId = docRef.id;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const estimatedReadyBy = Date.now() + 30_000;

    await docRef.set({
      userId: uid,
      status: 'ocr_pending',
      capture: {
        source: source || 'live_camera',
        appCheck: false, // wire when the App Check token lands
        deviceAttest: false,
        hash: bytesHash,
        perceptualHash: perceptualHash || null,
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
      },
      storage: {
        bucket: admin.storage().bucket().name,
        path: storagePath,
        contentType: 'image/jpeg',
        sizeBytes: 0, // process step fills the real number
      },
      createdAt: now,
      updatedAt: now,
    });

    // Mirror a slim status doc into the user's sub-collection so the
    // app can subscribe without needing top-level /receipts/* rules.
    await db.doc(`users/${uid}/cashback_status/${cashbackId}`).set({
      status: 'ocr_pending',
      receiptId: cashbackId,
      cashbackCents: 0,
      updatedAt: now,
    });

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

      // 2) Gemini OCR
      const ocr = await extractReceipt(bytes, mimeType, { model: config.ocrModel });

      // 3) Reconciliation
      const recon = reconcile(ocr.parsed);

      // 4) Eligibility + tier
      const eligibleItemCount = countEligibleItems(ocr.parsed);
      const cashbackCents = recon.ok ? tierFor(eligibleItemCount, config.tiers) : 0;

      // 5) Decide status
      let status = 'matched';
      let rejectReason = null;
      if (!ocr.parsed.isReceipt) {
        status = 'rejected';
        rejectReason = ocr.parsed.notReceiptReason || 'not_a_receipt';
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
      // We also include the items list + a signed URL of the bon
      // image (24h TTL) so the detail screen can show "what we
      // saw" without giving the client direct Storage access.
      let imageUrl = null;
      try {
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 24 * 60 * 60 * 1000,
        });
        imageUrl = signedUrl;
      } catch (e) {
        logger.warn('signed-url-failed', { cashbackId, err: e.message });
      }

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
            merchant: ocr.parsed.merchant ?? null,
            bonDate: ocr.parsed.bonDate || null,
            bonTotalCents: ocr.parsed.totalCents ?? null,
            paymentMethod: ocr.parsed.paymentMethod ?? null,
            items: slimItems,
            imageUrl,
            imageUrlExpiresAt: Date.now() + 24 * 60 * 60 * 1000,
            rejectReason,
            updatedAt: now,
          },
          { merge: true },
        );

      // 6) Write authoritative doc to top-level /receipts/*
      await docRef.update({
        status,
        rejectReason,
        ocr: {
          model: ocr.model,
          promptVersion: ocr.promptVersion,
          latencyMs: ocr.latencyMs,
          parsed: ocr.parsed,
          confidence: ocr.parsed.ocrConfidence ?? null,
        },
        merchant: ocr.parsed.merchant
          ? { id: String(ocr.parsed.merchant).toLowerCase(), matchedScore: 1 }
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

      // 7) On approval: ledger + balance + last_bon_date update
      if (status === 'approved' && cashbackCents > 0) {
        const userRef = db.doc(`users/${uid}`);
        await db.runTransaction(async (tx) => {
          const userSnap = await tx.get(userRef);
          const u = userSnap.exists ? userSnap.data() : {};
          const balanceBefore = u.cashback_balance_cents || 0;
          const lifetimeBefore = u.cashback_lifetime_cents || 0;
          const balanceAfter = balanceBefore + cashbackCents;
          const ledgerRef = userRef.collection('cashback_ledger').doc();
          tx.set(ledgerRef, {
            type: 'earn',
            cents: cashbackCents,
            receiptId: cashbackId,
            balanceAfterCents: balanceAfter,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          tx.set(
            userRef,
            {
              cashback_balance_cents: balanceAfter,
              cashback_lifetime_cents: lifetimeBefore + cashbackCents,
              cashback_last_bon_date: ocr.parsed.bonDate || todayBerlin(),
            },
            { merge: true },
          );
        });

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
        latencyMs: ocr.latencyMs,
        cashbackCents,
        eligibleItemCount,
        deltaCents: recon.deltaCents,
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
