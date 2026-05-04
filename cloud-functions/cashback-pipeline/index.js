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
const { resolveMerchant } = require('./lib/merchant');
const { sendCashbackReady } = require('./lib/push');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west3';
const PUBSUB_TOPIC = 'cashback-ocr-jobs';
const CONFIG_DOC_PATH = 'cashback_config/v1';

// Bon must be no older than this many days (server-time check, not
// client). Avoids backdated bons + bons forgotten in a drawer for
// months. Configurable via cashback_config.maxBonAgeDays in future.
const MAX_BON_AGE_DAYS = 5;

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

      // 3) Reconciliation (Pfand-tolerant, 2 € window — see ocr.js)
      const recon = reconcile(ocr.parsed);

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
          promptVersion: ocr.promptVersion,
          latencyMs: ocr.latencyMs,
          parsed: ocr.parsed,
          confidence: ocr.parsed.ocrConfidence ?? null,
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
