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

const crypto = require('crypto');
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { logger } = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { PubSub } = require('@google-cloud/pubsub');

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// Tremendous-API-Key (Sandbox ODER Production — je nach env TREMENDOUS_ENV).
// Secret setzen: firebase functions:secrets:set TREMENDOUS_API_KEY
const TREMENDOUS_API_KEY = defineSecret('TREMENDOUS_API_KEY');
// Webhook-Signing-Key (Tremendous „Private key") für die Signaturprüfung.
const TREMENDOUS_WEBHOOK_SECRET = defineSecret('TREMENDOUS_WEBHOOK_SECRET');

const { extractReceipt, reconcile, countEligibleItems, tierFor, isPfandItem, DEFAULT_MODEL } = require('./lib/ocr');
const { extractReceiptCVHybrid } = require('./lib/ocr_cvhybrid');
const { extractReceiptDocAI, isConfigured: isDocAIConfigured } = require('./lib/ocr_docai');
const { resolveMerchant } = require('./lib/merchant');
const { sendCashbackReady } = require('./lib/push');
const {
  computeDHash,
  hammingDistance,
  readExifMeta,
  deriveForensicFlags,
  computeContentHash,
  computeTransactionHash,
  computeItemsHash,
} = require('./lib/forensics');

// Parse "HH:MM[:SS]" → minutes-of-day, else null.
function parseHHMM(t) {
  if (typeof t !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
// True when two bonTimes are within `maxMinutes`. When either time is
// missing we can't apply the window → block conservatively (same items +
// market + day is already a very strong duplicate signal).
function bonTimesWithin(a, b, maxMinutes) {
  const pa = parseHHMM(a);
  const pb = parseHHMM(b);
  if (pa == null || pb == null) return true;
  return Math.abs(pa - pb) <= maxMinutes;
}

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

// 86ca0wbg7 — B: zusätzlich zur Count-Grenze den Fuzzy-Dedup-Scan auf ein
// ZEITFENSTER bounden (createdAt), damit die Prüfung auch bei Tausenden Bons
// klein bleibt. Großzügig (länger als jedes plausible maxAgeDays), damit die
// Dedup-Abdeckung praktisch nicht leidet — nur unbegrenztes Wachstum verhindert.
const DHASH_DEDUP_LOOKBACK_DAYS = 120;

// 86ca0wbg7 — A: Max. Verarbeitungs-Versuche pro Bon. Nach so vielen
// fehlgeschlagenen Retries wird der Bon endgültig abgelehnt (poison message),
// statt bis zur PubSub-TTL (~7 Tage) immer wieder (teuer) verarbeitet zu werden.
const MAX_PROCESS_ATTEMPTS = 5;

/**
 * 86ca0wbg7 — Baut das `ocr`-Feld fürs Bon-Doc. Einmal definiert, damit der
 * frühe Idempotenz-Persist (nach der OCR) und der finale Write identisch sind.
 */
function buildOcrField(ocr, recon, escalation) {
  return {
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
  };
}

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
  // Auszahlung erst ab diesem Guthaben (Cent). 1000 = 10 €.
  payoutThresholdCents: 1000,
  // Max. Cashback pro Kalendermonat (Cent). 0 = KEIN Limit (Default).
  // >0 aktiviert die serverseitige Monats-Begrenzung (cappt cashbackCents
  // auf die verbleibende Monats-Headroom).
  monthlyMaxCents: 0,
  // Aktions-Modus: true → Cashback NUR während aktiver Kampagne
  // (cashback_campaigns). Keine Aktion → Bon verarbeitet + Produkte
  // getrackt, aber 0 Vergütung. Default false = Dauer-Cashback (kein Change).
  campaignsEnabled: false,
};

const CAMPAIGNS_COL = 'cashback_campaigns';

// Aktuell laufende Aktion laden (active==true UND now in [startAt, endAt]).
// Bei mehreren: die mit dem frühesten Ende (läuft zuerst aus). null = keine.
/** Lade EINE Aktion per Doc-ID (die vom User gewählte). */
async function loadCampaignById(id) {
  if (!id) return null;
  try {
    const snap = await db.collection(CAMPAIGNS_COL).doc(id).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    logger.warn('campaign-by-id-failed', { id, err: e.message });
    return null;
  }
}

/** Timestamp → ms (0 wenn fehlt). */
function toMs(ts) {
  return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
}

/**
 * Brutto-Cashback (Cent) für einen Bon im Kontext EINER Aktion, VOR
 * Wochenlimit / Per-User-Cap / Budget. Spiegel von `campaignReward` in
 * lib/types/cashback.ts — bei Änderung BEIDE anpassen.
 */
function campaignRewardCents(eligibleItemCount, campaign, config) {
  const minItems = Number.isFinite(campaign.minItems) ? campaign.minItems : config.minItemsForPayout;
  if (eligibleItemCount < minItems) return 0;
  if (Array.isArray(campaign.tiers) && campaign.tiers.length > 0) {
    return tierFor(eligibleItemCount, campaign.tiers);
  }
  const flat = Number(campaign.cashbackPerBonCents) || 0;
  return flat > 0 ? flat : 0;
}

/**
 * ISO-Wochen-Key (Mo–So) für ein Bon-Datum 'YYYY-MM-DD' → 'YYYY-Www'.
 * Donnerstag-Regel (ISO-8601). Bon-Datum ist bereits Berlin-Datum.
 */
function isoWeekKey(iso) {
  const base = /^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 10) : todayBerlin();
  const d = new Date(base + 'T12:00:00Z');
  const dayNr = (d.getUTCDay() + 6) % 7; // Mo=0 … So=6
  d.setUTCDate(d.getUTCDate() - dayNr + 3); // Donnerstag dieser Woche
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

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
          // 86ca0wbg7: echte discounter-DocID → direktes Markt-Matching gegen produkte.discounter
          discounterId: merchantInfo?.discounterId || null,
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
async function syncLedgerForReceipt(userRef, cashbackId, status, cashbackCents, bonDateIso, campaignId, campaignMode) {
  const ledgerCol = userRef.collection('cashback_ledger');
  // Tatsächlich gutgeschriebener Betrag — kann durch Budget-Deckelung IN
  // der Transaktion < cashbackCents sein (+ ob das Budget dabei leer war).
  let creditedCents = cashbackCents;
  let budgetExhausted = false;

  await db.runTransaction(async (tx) => {
    // ── Alle Reads ZUERST (Firestore-Transaktions-Regel) ──
    const earns = await tx.get(
      ledgerCol.where('receiptId', '==', cashbackId).where('type', '==', 'earn'),
    );
    const reverses = await tx.get(
      ledgerCol.where('receiptId', '==', cashbackId).where('type', '==', 'reverse'),
    );
    const userSnap = await tx.get(userRef);
    // Aktions-Budget FRISCH in der Transaktion lesen → race-frei cappen.
    const campaignRef = campaignId ? db.collection(CAMPAIGNS_COL).doc(campaignId) : null;
    const campaignSnap = campaignMode && campaignRef ? await tx.get(campaignRef) : null;

    const totalEarned = earns.docs.reduce((s, d) => s + (d.data().cents || 0), 0);
    const totalReversed = reverses.docs.reduce((s, d) => s + (d.data().cents || 0), 0);
    const netActive = totalEarned - totalReversed;
    const wantApproved = status === 'approved' && cashbackCents > 0;

    const u = userSnap.exists ? userSnap.data() : {};
    const balance = u.cashback_balance_cents || 0;
    const lifetime = u.cashback_lifetime_cents || 0;
    // Kalendermonat des Bons → Monats-Zähler (für Monats-Limit + Anzeige).
    const monthKey = (bonDateIso || todayBerlin()).slice(0, 7); // YYYY-MM
    const inc = admin.firestore.FieldValue.increment;
    const monthlyDelta = (cents, bons) => ({
      cashback_monthly: {
        [monthKey]: {
          earnedCents: inc(cents),
          bonsCount: inc(bons),
          lastBonAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
    });
    // Pro-Aktion-Zähler: Wochen-Bons (Mo–So Berlin) + Gesamt-Cents.
    // Treiben das Wochenlimit + den Per-User-Cap der Aktion.
    const weekKey = isoWeekKey(bonDateIso || todayBerlin());
    const campaignDelta = (cid, cents, bons) =>
      cid
        ? {
            cashback_campaign_weekly: { [cid]: { [weekKey]: { count: inc(bons) } } },
            cashback_campaign_totals: { [cid]: inc(cents) },
          }
        : {};
    // Aktions-Budget transaktional anpassen (merge+increment → race-frei,
    // sicher auch wenn Feld fehlt). Negativ = verbraucht, positiv = Refund.
    const adjustBudget = (cid, cents) => {
      if (!cid || !cents) return;
      tx.set(
        db.collection(CAMPAIGNS_COL).doc(cid),
        { budgetRemainingCents: inc(cents) },
        { merge: true },
      );
    };

    if (wantApproved && netActive === 0) {
      // First-time approval (or reapproval after a reverse).
      // Aktions-Modus: Betrag ATOMAR auf das verbleibende Budget cappen —
      // das schließt die Race-Lücke (2 Bons am letzten Budget-Rest).
      let earnCents = cashbackCents;
      if (campaignMode && campaignSnap) {
        const remaining = Number.isFinite(campaignSnap.data()?.budgetRemainingCents)
          ? campaignSnap.data().budgetRemainingCents
          : 0;
        earnCents = Math.max(0, Math.min(cashbackCents, remaining));
      }
      creditedCents = earnCents;
      budgetExhausted = campaignMode && earnCents === 0 && cashbackCents > 0;

      if (earnCents > 0) {
        const ref = ledgerCol.doc();
        tx.set(ref, {
          type: 'earn',
          cents: earnCents,
          receiptId: cashbackId,
          campaignId: campaignId || null, // für Budget-Refund beim Reverse
          balanceAfterCents: balance + earnCents,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(
          userRef,
          {
            cashback_balance_cents: balance + earnCents,
            cashback_lifetime_cents: lifetime + earnCents,
            cashback_last_bon_date: bonDateIso || todayBerlin(),
            ...monthlyDelta(earnCents, 1),
            ...campaignDelta(campaignId, earnCents, 1),
          },
          { merge: true },
        );
        adjustBudget(campaignId, -earnCents);
      }
      // earnCents === 0 → keine Gutschrift; Status wird außen auf
      // no_reward / campaign_budget_exhausted gesetzt.
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
            ...monthlyDelta(delta, 0),
            ...campaignDelta(earns.docs[0]?.data()?.campaignId || campaignId, delta, 0),
          },
          { merge: true },
        );
        adjustBudget(earns.docs[0]?.data()?.campaignId || campaignId, -delta);
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
      const reverseCid = earns.docs[0]?.data()?.campaignId || campaignId;
      tx.set(
        userRef,
        {
          cashback_balance_cents: Math.max(0, balance - netActive),
          cashback_lifetime_cents: Math.max(0, lifetime - netActive),
          ...monthlyDelta(-netActive, -1),
          ...campaignDelta(reverseCid, -netActive, -1),
        },
        { merge: true },
      );
      // Budget zurück an die Kampagne, die ursprünglich gutgeschrieben hat.
      adjustBudget(reverseCid, netActive);
    }
    // else: not approved + no prior earn — noop.
  });

  return { creditedCents, budgetExhausted };
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
      campaignId, // optional: vom User gewählte Aktion (cashback_campaigns/{id})
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
        // 86ca0wbg7 (B): zusätzlich zur Count-Grenze auf ein Zeitfenster bounden
        // (range auf dem ohnehin sortierten createdAt → KEIN neuer Index nötig),
        // damit der Scan auch bei Tausenden Bons pro User klein bleibt.
        const dedupCutoff = admin.firestore.Timestamp.fromMillis(
          Date.now() - DHASH_DEDUP_LOOKBACK_DAYS * 86400000,
        );
        const recentSnap = await db
          .collection('receipts')
          .where('userId', '==', uid)
          .where('createdAt', '>=', dedupCutoff)
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
      // Vom User gewählte Aktion — Quelle der Wahrheit für die Vergütung
      // in processCashback (campaignsEnabled-Modus). null = keine Aktion.
      campaignId: typeof campaignId === 'string' && campaignId ? campaignId : null,
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
      // 86ca0wbg7 (A): Idempotenz — hat ein früherer Versuch die OCR schon
      // gemacht (am Doc gespeichert), wiederverwenden statt erneut (teuer)
      // Gemini/DocAI zu rufen. Spart bei Retries die OCR-Kosten komplett.
      let ocr;
      let recon;
      let escalation = { fired: false };
      const cachedOcr = receipt.ocr && receipt.ocr.parsed ? receipt.ocr : null;
      if (cachedOcr) {
        ocr = {
          parsed: cachedOcr.parsed,
          engine: cachedOcr.engine ?? null,
          model: cachedOcr.model ?? null,
          promptVersion: cachedOcr.promptVersion ?? null,
          latencyMs: cachedOcr.latencyMs ?? null,
          cvLatencyMs: cachedOcr.cvLatencyMs ?? null,
          geminiLatencyMs: cachedOcr.geminiLatencyMs ?? null,
          ocrText: '',
        };
        recon =
          cachedOcr.reconciliation && typeof cachedOcr.reconciliation.ok === 'boolean'
            ? cachedOcr.reconciliation
            : reconcile(ocr.parsed);
        escalation = cachedOcr.escalation || { fired: false };
      } else {
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
        recon = reconcile(ocr.parsed);

        // 3a) Escalation: if primary failed recon AND DocAI is configured,
        //     re-run the bon through DocAI Expense Parser. Take whichever
        //     result has the smaller |signedDelta| (or DocAI if it passes
        //     and primary doesn't).
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

        // 86ca0wbg7 (A): OCR-Ergebnis SOFORT persistieren (vor Gates/Dedup/
        // Merchant). Schlägt ein späterer Schritt fehl, nutzt der Retry diese
        // OCR und ruft Gemini/DocAI NICHT erneut.
        await docRef
          .update({ ocr: buildOcrField(ocr, recon, escalation), updatedAt: now })
          .catch(() => {});
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

      // 5b) Content-based duplicate detection (Layer 1.5).
      //     Catches the case image-forensics can't see: same physical
      //     bon re-photographed via Document Scanner produces different
      //     bytes / dHash / EXIF — but the OCR'd content is identical.
      //
      //     Two layers:
      //       - contentHash      (merchant + date + total)        per-user check
      //       - transactionHash  (merchant + date + time + total) cross-user check
      //
      //     Only counts as a match against a prior receipt that is in
      //     a "live" status (approved | review | matched | ocr_pending).
      //     Rejected/superseded prior receipts don't block — a previously
      //     rejected bon shouldn't lock out a legitimate re-attempt.
      const contentHash = computeContentHash(
        merchantInfo?.id,
        ocr.parsed.bonDate,
        ocr.parsed.totalCents,
      );
      const transactionHash = computeTransactionHash(
        merchantInfo?.id,
        ocr.parsed.bonDate,
        ocr.parsed.bonTime,
        ocr.parsed.totalCents,
      );

      // Jeder bereits ANGENOMMENE Bon blockt ein Re-Submit — egal ob
      // vergütet (approved/paid) oder angenommen-ohne-Vergütung
      // (no_reward, z.B. Aktions-Modus). Nur 'rejected'/'superseded'
      // blocken NICHT (legitimer Neuversuch nach Ablehnung).
      const LIVE_STATUSES = new Set([
        'approved', 'paid', 'no_reward', 'review', 'matched', 'ocr_pending',
      ]);
      const itemsHash = computeItemsHash(
        merchantInfo?.id,
        ocr.parsed.bonDate,
        ocr.parsed.items,
      );
      let duplicateOf = null;

      // Per-user check
      if (contentHash) {
        try {
          const dupQ = await db.collection('receipts')
            .where('userId', '==', uid)
            .where('contentHash', '==', contentHash)
            .limit(5).get();
          for (const doc of dupQ.docs) {
            if (doc.id === cashbackId) continue;
            if (LIVE_STATUSES.has(doc.get('status'))) {
              duplicateOf = {
                receiptId: doc.id,
                sameUser: true,
                priorStatus: doc.get('status'),
              };
              break;
            }
          }
        } catch (e) {
          logger.warn('content-dedup-self-failed', { cashbackId, err: e.message });
        }
      }

      // Cross-user check (only when bonTime present — see helper docstring)
      if (!duplicateOf && transactionHash) {
        try {
          const dupQ = await db.collection('receipts')
            .where('transactionHash', '==', transactionHash)
            .limit(5).get();
          for (const doc of dupQ.docs) {
            if (doc.id === cashbackId) continue;
            if (doc.get('userId') === uid) continue; // already covered above
            if (LIVE_STATUSES.has(doc.get('status'))) {
              duplicateOf = {
                receiptId: doc.id,
                sameUser: false,
                priorStatus: doc.get('status'),
              };
              logger.warn('cross-user-duplicate', {
                cashbackId,
                uid,
                otherUid: doc.get('userId'),
                otherReceiptId: doc.id,
                transactionHash,
              });
              break;
            }
          }
        } catch (e) {
          logger.warn('content-dedup-cross-failed', { cashbackId, err: e.message });
        }
      }

      // Items-Fingerprint (User-Regel 2): gleicher Markt + gleiche
      // Produkte + gleiches Datum, Uhrzeit ≤5min auseinander → Duplikat.
      // Robuster als contentHash, weil unabhängig vom (OCR-schwankenden)
      // Total — fängt Neu-Abfotografieren auch bei Total-Jitter.
      // (userId== + itemsHash== sind zwei Equality-Filter → Firestore
      // bedient das per Zigzag-Merge ohne Composite-Index.)
      if (!duplicateOf && itemsHash) {
        try {
          const dupQ = await db.collection('receipts')
            .where('userId', '==', uid)
            .where('itemsHash', '==', itemsHash)
            .limit(5).get();
          for (const doc of dupQ.docs) {
            if (doc.id === cashbackId) continue;
            if (!LIVE_STATUSES.has(doc.get('status'))) continue;
            if (!bonTimesWithin(ocr.parsed.bonTime, doc.get('bonTime'), 5)) continue;
            duplicateOf = {
              receiptId: doc.id,
              sameUser: true,
              priorStatus: doc.get('status'),
            };
            break;
          }
        } catch (e) {
          logger.warn('items-dedup-failed', { cashbackId, err: e.message });
        }
      }

      // 6) Gates + Vergütung. Zwei Modi:
      //    • campaignsEnabled=false → Dauer-Cashback über globale Tiers
      //      (+ optionales Monats-Limit). Bisheriges Verhalten, unverändert.
      //    • campaignsEnabled=true  → Vergütung NUR im Kontext der vom User
      //      gewählten Aktion (receipt.campaignId). Die Aktion definiert
      //      Tiers/Flat, minItems, Wochenlimit, Per-User-Cap und Budget.
      //      Keine globalen Earning-Regeln mehr.
      const eligibleItemCount = countEligibleItems(ocr.parsed);

      // Aktion FRÜH laden (vor dem Gate), damit ihr `maxAgeDays` bereits im
      // Alters-Gate greift (Config aus cashback_campaigns). 86ca0wbg7.
      const cid = config.campaignsEnabled ? (receipt.campaignId || null) : null;
      let selectedCampaign = cid ? await loadCampaignById(cid) : null;
      // Effektives Max-Bon-Alter in TAGEN (bezogen aufs Bon-Datum): der Aktions-
      // Wert überschreibt den globalen Default; 0/undefined → globaler Default
      // (kein Aktions-Limit).
      const campaignMaxAge = Number(selectedCampaign?.maxAgeDays);
      const effectiveMaxAgeDays =
        Number.isFinite(campaignMaxAge) && campaignMaxAge > 0 ? campaignMaxAge : MAX_BON_AGE_DAYS;

      const gatesOk =
        merchantInfo
        && recon.ok
        && !duplicateOf
        && (ageDays == null || ageDays <= effectiveMaxAgeDays);

      let cashbackCents = 0;
      // no_active_campaign | below_min_items | weekly_cap_reached |
      // per_user_cap_reached | campaign_budget_exhausted | monthly_cap_reached
      let zeroReason = null;

      if (config.campaignsEnabled) {
        // cid + selectedCampaign bereits oben bestimmt (für das Alters-Gate).
        const nowMs = Date.now();
        const inWindow =
          selectedCampaign
          && selectedCampaign.active === true
          && toMs(selectedCampaign.startAt) <= nowMs
          && nowMs <= toMs(selectedCampaign.endAt);

        if (!gatesOk) {
          cashbackCents = 0; // harter Gate (Merchant/recon/dup/alt) → Section 7
        } else if (!cid || !selectedCampaign || !inWindow) {
          cashbackCents = 0;
          zeroReason = 'no_active_campaign';
        } else {
          let reward = campaignRewardCents(eligibleItemCount, selectedCampaign, config);
          if (reward <= 0) {
            zeroReason = 'below_min_items';
          } else {
            // Frische User-Zähler für Wochen-/Per-User-Cap.
            let uData = {};
            try {
              const uSnap = await db.doc(`users/${uid}`).get();
              uData = uSnap.exists ? uSnap.data() : {};
            } catch (e) {
              logger.warn('campaign-counters-read-failed', { cashbackId, err: e.message });
            }
            // Wochenlimit der Aktion (pro User, Mo–So Berlin).
            const weeklyCap = Number(selectedCampaign.weeklyBonCap) || 0;
            if (weeklyCap > 0) {
              const wk = isoWeekKey(ocr.parsed.bonDate || todayBerlin());
              const used = (((uData.cashback_campaign_weekly || {})[cid] || {})[wk] || {}).count || 0;
              if (used >= weeklyCap) {
                reward = 0;
                zeroReason = 'weekly_cap_reached';
              }
            }
            // Per-User-Gesamtdeckel der Aktion (cappt auf Headroom).
            if (reward > 0) {
              const perUserCap = Number(selectedCampaign.maxPerUserCents) || 0;
              if (perUserCap > 0) {
                const earned = (uData.cashback_campaign_totals || {})[cid] || 0;
                const headroom = Math.max(0, perUserCap - earned);
                if (reward > headroom) {
                  reward = headroom;
                  if (reward === 0) zeroReason = 'per_user_cap_reached';
                }
              }
            }
            // Budget-Deckelung passiert NICHT hier (stale read → Race bei
            // 2 parallelen Bons am letzten Budget-Rest), sondern atomar in
            // der Ledger-Transaktion (syncLedgerForReceipt liest das Budget
            // im tx.get und cappt dort). Hier nur der Brutto-Reward nach
            // Wochen-/Per-User-Cap.
            cashbackCents = reward;
          }
        }
      } else {
        // ── Dauer-Cashback (bisheriges Verhalten): globale Tiers ──
        cashbackCents = gatesOk ? tierFor(eligibleItemCount, config.tiers) : 0;

        // Monats-Limit nur im Dauer-Modus (im Aktions-Modus gilt der
        // Per-User-Cap der Aktion statt eines globalen Monatslimits).
        if (config.monthlyMaxCents > 0 && cashbackCents > 0) {
          const month = (ocr.parsed.bonDate || todayBerlin()).slice(0, 7); // YYYY-MM
          let earnedThisMonth = 0;
          try {
            const uSnap = await db.doc(`users/${uid}`).get();
            earnedThisMonth = uSnap.exists
              ? uSnap.data()?.cashback_monthly?.[month]?.earnedCents || 0
              : 0;
          } catch (e) {
            logger.warn('monthly-read-failed', { cashbackId, err: e.message });
          }
          const headroom = Math.max(0, config.monthlyMaxCents - earnedThisMonth);
          if (cashbackCents > headroom) {
            cashbackCents = headroom; // Teilbetrag bleibt approved
            if (cashbackCents === 0) zeroReason = 'monthly_cap_reached';
          }
        }
      }

      // 7) Decide status (priority: not-a-receipt > unknown-merchant >
      //                  too-old > duplicate > recon > below-min)
      let status = 'matched';
      let rejectReason = null;
      if (!ocr.parsed.isReceipt) {
        status = 'rejected';
        rejectReason = ocr.parsed.notReceiptReason || 'not_a_receipt';
      } else if (!merchantInfo) {
        status = 'rejected';
        rejectReason = 'unknown_merchant';
      } else if (ageDays != null && ageDays > effectiveMaxAgeDays) {
        status = 'rejected';
        rejectReason = 'bon_too_old';
      } else if (ageDays == null) {
        // Bon-Datum nicht erkannt → ABLEHNEN (keine manuelle Prüfung).
        status = 'rejected';
        rejectReason = 'no_bon_date';
      } else if (duplicateOf) {
        status = 'rejected';
        rejectReason = duplicateOf.sameUser
          ? 'duplicate_content_self'
          : 'duplicate_content_cross_user';
      } else if (!recon.ok) {
        // Σ Items ≠ Total → ABLEHNEN (nie 'review' / manuelle Prüfung).
        status = 'rejected';
        rejectReason = 'reconciliation_delta';
      } else if (cashbackCents === 0) {
        // Gültiger Bon, aber 0 Vergütung.
        // • Aktions-Modus: IMMER 'no_reward' → Bon wird angenommen +
        //   Positionen getrackt (Ausgabenübersicht), nur ohne Geld.
        // • Dauer-Modus: bisheriges Verhalten (Monats-Cap → no_reward,
        //   sonst below_min_items → rejected).
        if (config.campaignsEnabled) {
          status = 'no_reward';
          rejectReason = zeroReason || 'below_min_items';
        } else if (zeroReason === 'monthly_cap_reached') {
          status = 'no_reward';
          rejectReason = 'monthly_cap_reached';
        } else {
          status = 'rejected';
          rejectReason = 'below_min_items';
        }
      } else {
        status = 'approved';
      }

      // 6z) Ledger + Budget ATOMAR verbuchen — VOR dem Mirror/Receipt-Write,
      // weil die Budget-Deckelung in der Transaktion den Betrag (und damit
      // den Status) noch ändern kann. Idempotent per receiptId.
      const userRef = db.doc(`users/${uid}`);
      const campaignMode = config.campaignsEnabled && !!selectedCampaign;
      const settle = await syncLedgerForReceipt(
        userRef,
        cashbackId,
        status,
        cashbackCents,
        ocr.parsed.bonDate,
        selectedCampaign?.id || null,
        campaignMode,
      );
      // Budget war beim Verbuchen leer → Betrag + Status korrigieren, damit
      // Mirror/Receipt das echte Ergebnis zeigen (kein „approved +X" ohne
      // tatsächliche Gutschrift).
      if (status === 'approved' && settle.creditedCents !== cashbackCents) {
        cashbackCents = settle.creditedCents;
        if (cashbackCents === 0) {
          status = 'no_reward';
          rejectReason = 'campaign_budget_exhausted';
        }
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
            eligible: Number.isFinite(it.priceCents) && it.priceCents > 0 && !isPfandItem(it),
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
            discounterId: merchantInfo?.discounterId ?? null, // 86ca0wbg7
            merchantName: merchantInfo?.name ?? null,
            merchantDisplayName: merchantInfo?.displayName ?? null,
            merchantLogoUrl: merchantInfo?.logoUrl ?? null,
            merchantLand: merchantInfo?.land ?? null,
            merchantMatchVia: merchantInfo?.matchVia ?? null,
            bonCountry: ocr.parsed.bonCountry ?? null,
            bonDate: ocr.parsed.bonDate || null,
            bonAgeDays: ageDays,
            // 86ca0wbg7: angewandte Max-Alter-Grenze (Tage) → die App zeigt die
            // ECHTE Grenze (z.B. 14) statt einer hardcodierten Zahl. null wenn
            // kein effektives Limit greift (globaler 9999-Default).
            maxAgeDays: effectiveMaxAgeDays < MAX_BON_AGE_DAYS ? effectiveMaxAgeDays : null,
            bonTotalCents: ocr.parsed.totalCents ?? null,
            items: slimItems,
            storageBucket: receipt.storage?.bucket ?? null,
            storagePath: receipt.storage?.path ?? null,
            reconciliationDeltaCents: recon.deltaCents ?? null,
            reconciliationDirection: recon.direction ?? null,
            ocrEngine: ocr.engine ?? null,
            escalation: escalation?.fired ? escalation : null,
            // Mirror only carries minimal duplicate info — never the
            // foreign user's id (privacy).
            duplicate: duplicateOf
              ? { sameUser: duplicateOf.sameUser, priorReceiptId: duplicateOf.sameUser ? duplicateOf.receiptId : null }
              : null,
            rejectReason,
            updatedAt: now,
          },
          { merge: true },
        );

      // 7) Write authoritative doc to top-level /receipts/*
      await docRef.update({
        status,
        rejectReason,
        ocr: buildOcrField(ocr, recon, escalation),
        merchant: merchantInfo
          ? {
              id: merchantInfo.id,
              // 86ca0wbg7: echte discounter-DocID (= produkte.discounter) + Land,
              // direkt im merchant-Objekt des Haupt-Bon-Docs.
              discounterId: merchantInfo.discounterId ?? null,
              land: merchantInfo.land ?? null,
              name: merchantInfo.name,
              raw: ocr.parsed.merchant ?? null,
              matchedScore: 1,
            }
          : ocr.parsed.merchant
          ? { id: 'unknown', raw: ocr.parsed.merchant, matchedScore: 0 }
          : null,
        bonDate: ocr.parsed.bonDate || null,
        bonTime: ocr.parsed.bonTime || null,
        bonTotalCents: ocr.parsed.totalCents ?? null,
        contentHash: contentHash ?? null,
        transactionHash: transactionHash ?? null,
        itemsHash: itemsHash ?? null,
        duplicateOf: duplicateOf ?? null,
        items: Array.isArray(ocr.parsed.items)
          ? ocr.parsed.items.map((it) => ({
              raw: it.name,
              qty: it.qty ?? 1,
              priceCents: it.priceCents,
              eligible: Number.isFinite(it.priceCents) && it.priceCents > 0 && !isPfandItem(it),
            }))
          : [],
        eligibleItemCount,
        tierApplied: cashbackCents,
        cashbackCents,
        'storage.sizeBytes': sizeBytes,
        updatedAt: now,
      });

      // 7a) Produkt-Tracking ist UNABHÄNGIG von der Vergütung: jeder gültige
      // Bon (approved ODER no_reward = angenommen, aber keine Aktion/0 €)
      // schreibt seine Positionen — fürs Matching/Tracking. „Einreichung
      // geht immer", auch ohne laufende Aktion.
      if (status === 'approved' || status === 'no_reward') {
        await writePurchasedProducts(uid, cashbackId, ocr.parsed, merchantInfo);
      }

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
        duplicateOfReceiptId: duplicateOf?.receiptId ?? null,
        duplicateSameUser: duplicateOf?.sameUser ?? null,
      });
    } catch (err) {
      // 86ca0wbg7 (A): transienten Fehler NICHT voreilig als 'rejected' zeigen
      // (sonst sieht der User „abgelehnt", obwohl gleich ein Retry läuft). Nur
      // attempts/lastError tracken + werfen → PubSub redelivert; der Retry nutzt
      // die bereits persistierte OCR (kein erneuter Gemini-Call). Erst nach
      // MAX_PROCESS_ATTEMPTS endgültig ablehnen (poison message) → kein weiterer
      // (teurer) Retry bis zur PubSub-TTL.
      const attempts = (receipt.attempts || 0) + 1;
      const lastError = String(err && err.message ? err.message : err).slice(0, 300);
      logger.error('process-failed', { cashbackId, err: err.message, attempts });
      if (attempts >= MAX_PROCESS_ATTEMPTS) {
        await docRef
          .update({ status: 'rejected', rejectReason: 'max_retries_exceeded', attempts, lastError, updatedAt: now })
          .catch(() => {});
        await db
          .doc(`users/${uid}/cashback_status/${cashbackId}`)
          .set({ status: 'rejected', rejectReason: 'max_retries_exceeded', attempts, updatedAt: now }, { merge: true })
          .catch(() => {});
        return; // ack → stoppt den PubSub-Retry (kein throw)
      }
      // Unter dem Limit: in-progress lassen (Mirror NICHT auf 'rejected' setzen,
      // App zeigt weiter „wird geprüft"), nur Zähler/Fehler festhalten, dann
      // werfen → PubSub-Retry.
      await docRef.update({ attempts, lastError, updatedAt: now }).catch(() => {});
      throw err;
    }
  },
);

// ─── requestPayout (HTTPS) ──────────────────────────────────────────
//
// Auszahlungs-Anfrage. Prüft die Schwelle serverseitig, debitiert das
// Guthaben TRANSAKTIONAL (race-/doppel-fest: die Transaktion auf userRef
// serialisiert konkurrierende Anfragen — die zweite liest die schon
// debitierte Balance und fällt unter die Schwelle) und legt an:
//   • cashback_payouts/{id} (status 'requested')
//   • users/{uid}/cashback_ledger/{id} (type 'payout')
// Die eigentliche Tremendous-Order-Erstellung passiert SPÄTER (separater
// Worker, der 'requested' → 'sent'/'delivered' flippt). KYC erledigt
// Tremendous bei der Order-Erstellung. Zahlt immer die GANZE Balance aus.
const VALID_PAYOUT_METHODS = ['paypal', 'giftcard', 'sepa'];

exports.requestPayout = onRequest(
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
    // Methode ist OPTIONAL — die konkrete Auszahlungsart wählt der User auf
    // der Tremendous-Hosted-Page. Kommt doch eine gültige mit, speichern
    // wir sie als Hinweis; sonst null.
    const rawMethod = String((req.body || {}).method || '');
    const method = VALID_PAYOUT_METHODS.includes(rawMethod) ? rawMethod : null;

    const config = await loadConfig();
    const threshold = Number.isFinite(config.payoutThresholdCents) ? config.payoutThresholdCents : 1000;
    // Gewünschter Teil-Betrag (optional). Fehlt/ungültig → ganze Balance.
    const requestedCents = Math.round(Number((req.body || {}).amountCents));

    try {
      const result = await db.runTransaction(async (tx) => {
        const userRef = db.doc(`users/${uid}`);
        const userSnap = await tx.get(userRef);
        const u = userSnap.exists ? userSnap.data() : {};
        const balance = u.cashback_balance_cents || 0;

        if (balance < threshold) {
          return { error: 'below_threshold', balanceCents: balance, thresholdCents: threshold };
        }

        // Betrag: gewünschter Teil-Betrag (auf Balance gedeckelt) oder ganze
        // Balance. Muss >= Schwelle sein. Debit passiert atomar im selben
        // tx → konkurrierende Anfragen werden serialisiert.
        let amountCents =
          Number.isFinite(requestedCents) && requestedCents > 0 ? Math.min(requestedCents, balance) : balance;
        if (amountCents < threshold) {
          return { error: 'below_min_amount', thresholdCents: threshold, balanceCents: balance };
        }
        const payoutRef = db.collection('cashback_payouts').doc();
        const ledgerRef = userRef.collection('cashback_ledger').doc();
        const ts = admin.firestore.FieldValue.serverTimestamp();

        tx.set(payoutRef, {
          userId: uid,
          amountCents,
          method,
          status: 'requested',
          kycPassed: false, // Tremendous übernimmt KYC bei Order-Erstellung
          createdAt: ts,
        });
        tx.set(ledgerRef, {
          type: 'payout',
          cents: amountCents,
          payoutId: payoutRef.id,
          balanceAfterCents: balance - amountCents,
          createdAt: ts,
        });
        tx.set(userRef, { cashback_balance_cents: balance - amountCents }, { merge: true });

        return { ok: true, payoutId: payoutRef.id, amountCents, method };
      });

      if (result.error) {
        res.status(400).json({ code: result.error, ...result });
        return;
      }
      logger.info('payout-requested', { uid, payoutId: result.payoutId, amountCents: result.amountCents, method });
      res.status(200).json(result);
    } catch (e) {
      logger.error('requestPayout-failed', { uid, err: e.message });
      res.status(500).json({ code: 'internal' });
    }
  },
);

// ─── processPayout (Tremendous) ─────────────────────────────────────
//
// Firestore-Trigger auf cashback_payouts/{id}. Erstellt für jede
// 'requested'-Anfrage eine Tremendous-ORDER mit delivery=EMAIL +
// campaign_id → Tremendous mailt dem User die fertige Redeem-Seite
// (User wählt DORT die Auszahlungsart, wir bauen keine UI dafür).
//
// Idempotent: external_id = payoutId → Tremendous dedupt; zusätzlich
// Status-Guard (nur 'requested' wird verarbeitet). Bei Fehler:
// Guthaben transaktional zurückbuchen (refund) + status 'failed'.
//
// env: TREMENDOUS_ENV=production → Live-API; sonst Sandbox (testflight).
//      TREMENDOUS_CAMPAIGN_ID überschreibt die Default-Campaign.
const TREMENDOUS_BASE =
  process.env.TREMENDOUS_ENV === 'production'
    ? 'https://api.tremendous.com/api/v2'
    : 'https://testflight.tremendous.com/api/v2';
const TREMENDOUS_CAMPAIGN_ID = process.env.TREMENDOUS_CAMPAIGN_ID || 'FPJPQK8WTF8O';

/** Fehlgeschlagene Auszahlung → Guthaben transaktional zurückbuchen. */
async function refundFailedPayout(uid, payoutId, amountCents) {
  if (!uid || !amountCents) return;
  const userRef = db.doc(`users/${uid}`);
  await db.runTransaction(async (tx) => {
    // Idempotenz: nur zurückbuchen, wenn für diese payoutId noch kein
    // Refund existiert.
    const existing = await tx.get(
      userRef.collection('cashback_ledger').where('payoutId', '==', payoutId).where('type', '==', 'admin_adjust'),
    );
    if (!existing.empty) return;
    const userSnap = await tx.get(userRef);
    const balance = userSnap.exists ? userSnap.data().cashback_balance_cents || 0 : 0;
    tx.set(userRef.collection('cashback_ledger').doc(), {
      type: 'admin_adjust',
      cents: amountCents,
      payoutId,
      balanceAfterCents: balance + amountCents,
      reason: 'payout_failed_refund',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(userRef, { cashback_balance_cents: balance + amountCents }, { merge: true });
  });
}

exports.processPayout = onDocumentCreated(
  {
    document: 'cashback_payouts/{payoutId}',
    region: REGION,
    timeoutSeconds: 30,
    secrets: [TREMENDOUS_API_KEY],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const payout = snap.data() || {};
    if (payout.status !== 'requested') return; // nur frische Anfragen
    const payoutId = event.params.payoutId;
    const uid = payout.userId;
    const amountCents = Number(payout.amountCents) || 0;

    const apiKey = TREMENDOUS_API_KEY.value();
    if (!apiKey) {
      logger.error('payout-no-api-key', { payoutId });
      await snap.ref.update({ status: 'failed', error: 'no_api_key', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    // Empfänger-E-Mail aus Firebase Auth (für EMAIL-Delivery zwingend).
    let email = null;
    let name = 'MarkenDetektive';
    try {
      const u = await admin.auth().getUser(uid);
      email = u.email || null;
      name = u.displayName || name;
    } catch (e) {
      logger.warn('payout-auth-lookup-failed', { payoutId, err: e.message });
    }
    if (!email) {
      await refundFailedPayout(uid, payoutId, amountCents);
      await snap.ref.update({ status: 'failed', error: 'no_email', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    try {
      // Funding-Source dynamisch holen (Sandbox hat eine Default-Balance).
      const fsRes = await fetch(`${TREMENDOUS_BASE}/funding_sources`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const fsJson = await fsRes.json();
      const sources = fsJson?.funding_sources || [];
      const fundingSourceId = (sources.find((f) => f.method === 'balance') || sources[0])?.id;
      if (!fundingSourceId) {
        await refundFailedPayout(uid, payoutId, amountCents);
        await snap.ref.update({ status: 'failed', error: 'no_funding_source', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        return;
      }

      const orderRes = await fetch(`${TREMENDOUS_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          external_id: payoutId, // Idempotenz gegen Doppel-Order
          payment: { funding_source_id: fundingSourceId },
          rewards: [
            {
              value: { denomination: Number((amountCents / 100).toFixed(2)), currency_code: 'EUR' },
              campaign_id: TREMENDOUS_CAMPAIGN_ID,
              // LINK statt EMAIL: Tremendous liefert den Redemption-Link in
              // der Antwort (delivery.link) → App öffnet ihn direkt in-app +
              // persistiert ihn (Statusseite „Meine Auszahlungen"). EMAIL
              // gäbe keinen API-Link zurück.
              delivery: { method: 'LINK' },
              recipient: { name, email },
            },
          ],
        }),
      });
      const orderJson = await orderRes.json();
      if (!orderRes.ok) {
        logger.error('tremendous-order-failed', { payoutId, status: orderRes.status, body: orderJson });
        await refundFailedPayout(uid, payoutId, amountCents);
        await snap.ref.update({
          status: 'failed',
          error: orderJson?.errors?.message || `tremendous_http_${orderRes.status}`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      const reward = orderJson?.order?.rewards?.[0] || {};
      const orderId = orderJson?.order?.id || null;
      const rewardId = reward?.id || null;
      // Redemption-Link defensiv aus mehreren möglichen Feldern ziehen
      // (Feldname variiert je nach Delivery/Version). Wenn vorhanden,
      // öffnet ihn die App direkt im In-App-Browser; die E-Mail bleibt
      // als Backup-Kanal (delivery: EMAIL).
      const redemptionLink =
        reward?.delivery?.link ||
        reward?.redemption?.link ||
        reward?.redemption_link ||
        reward?.link ||
        null;
      // Sandbox-Diagnose: einmal die Reward-Struktur mitloggen, um das
      // echte Link-Feld zu bestätigen.
      logger.info('tremendous-reward-shape', { payoutId, reward });
      await snap.ref.update({
        status: 'sent',
        tremendousOrderId: orderId,
        tremendousRewardId: rewardId,
        redemptionLink,
        recipientEmail: email,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info('payout-sent', { payoutId, orderId, hasLink: !!redemptionLink, env: TREMENDOUS_BASE });
    } catch (e) {
      logger.error('processPayout-failed', { payoutId, err: e.message });
      await refundFailedPayout(uid, payoutId, amountCents);
      await snap.ref
        .update({ status: 'failed', error: e.message, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        .catch(() => {});
    }
  },
);

// ─── tremendousWebhook (HTTPS) ──────────────────────────────────────
//
// Empfängt Tremendous-Webhook-Events (Redeem-Status). Die GET-API liefert
// den Redeem-Status NICHT — nur Webhooks. URL im Tremendous-Dashboard
// registrieren:
//   https://europe-west3-markendetektive-895f7.cloudfunctions.net/tremendousWebhook
// Bei einem Redeem-Event suchen wir den Payout per tremendousRewardId und
// setzen status 'delivered' + redeemedForm + redeemedAt → die Statusseite
// (Live-Subscription) zieht automatisch nach.
//
// TODO Produktion: Signatur verifizieren (HMAC mit Webhook-Signing-Secret).
// Aktuell (Sandbox) wird das rohe Event geloggt, um die echte Struktur zu
// bestätigen, und ungeprüft verarbeitet (ändert nur Status-Felder, kein Geld).
exports.tremendousWebhook = onRequest(
  { region: REGION, timeoutSeconds: 20, memory: '256MiB', cors: false, invoker: 'public', secrets: [TREMENDOUS_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('method_not_allowed');
      return;
    }
    // ── Signaturprüfung (HMAC-SHA256 über den ROHEN Body mit dem
    // Tremendous „Private key"). Header-Format/Scheme variiert → wir
    // berechnen die Signatur, loggen Treffer/Header zum Bestätigen und
    // LEHNEN bei Mismatch noch NICHT ab (Sandbox-Iteration). Sobald das
    // Scheme bestätigt ist → harte Ablehnung aktivieren.
    const sigHeader =
      req.get('Tremendous-Webhook-Signature') ||
      req.get('tremendous-webhook-signature') ||
      req.get('X-Tremendous-Signature') ||
      null;
    let sigOk = false;
    try {
      const secret = TREMENDOUS_WEBHOOK_SECRET.value();
      const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
      const computedHex = crypto.createHmac('sha256', secret).update(raw).digest('hex');
      const computedB64 = crypto.createHmac('sha256', secret).update(raw).digest('base64');
      sigOk = !!sigHeader && (sigHeader.includes(computedHex) || sigHeader.includes(computedB64));
      logger.info('tremendous-webhook-sig', { sigHeader, computedHex, computedB64, sigOk });
    } catch (e) {
      logger.warn('tremendous-webhook-sig-failed', { err: e.message });
    }

    // Signatur ist bestätigt (sha256=<hex> über rawBody) → unsignierte
    // Events nicht verarbeiten. 200, damit Tremendous nicht endlos retried.
    if (!sigOk) {
      logger.warn('tremendous-webhook-unsigned', { sigHeader });
      res.status(200).send('ignored_unsigned');
      return;
    }

    const body = req.body || {};
    logger.info('tremendous-webhook', { event: body.event || null, keys: Object.keys(body) });
    try {
      const pl = body.payload || {};
      const meta = pl.meta || {};
      const resource = pl.resource || {};
      const reward = pl.reward || (Array.isArray(meta.rewards) ? meta.rewards[0] : null) || {};
      const rewardId = reward.id || (resource.type === 'rewards' ? resource.id : null) || null;
      const orderId =
        meta.id || (resource.type === 'orders' ? resource.id : null) || pl.order_id || null;

      // Redeem-Form defensiv (Feldname unbekannt bis ein echtes Redeem-
      // Event kommt — Tremendous liefert es in diesem Setup aber nicht).
      const redeemedForm =
        reward?.products?.[0]?.name ||
        reward?.redemption?.product?.name ||
        reward?.redemption?.method ||
        pl?.product?.name ||
        null;
      const ev = String(body.event || '').toUpperCase();
      const isRedeem = ev.includes('REDEEM') || !!redeemedForm;

      // Payout per Reward-ID ODER Order-ID finden.
      let doc = null;
      if (rewardId) {
        const qs = await db.collection('cashback_payouts').where('tremendousRewardId', '==', rewardId).limit(1).get();
        if (!qs.empty) doc = qs.docs[0];
      }
      if (!doc && orderId) {
        const qs = await db.collection('cashback_payouts').where('tremendousOrderId', '==', orderId).limit(1).get();
        if (!qs.empty) doc = qs.docs[0];
      }

      if (doc) {
        const cur = doc.data();
        await doc.ref.set(
          {
            status: isRedeem ? 'delivered' : cur.status,
            redeemedForm: redeemedForm || cur.redeemedForm || null,
            redeemedAt: isRedeem ? admin.firestore.FieldValue.serverTimestamp() : cur.redeemedAt || null,
            lastWebhookEvent: body.event || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        logger.info('tremendous-webhook-no-match', { rewardId, orderId, event: body.event });
      }
    } catch (e) {
      logger.error('tremendous-webhook-failed', { err: e.message });
    }
    res.status(200).send('ok');
  },
);
