'use strict';

/**
 * review-console — Admin-Callables für die Review-Konsole (Web-Back-Office,
 * Hosting-Site md-receipt-admin). Produkt-Einreichungen (`crowd_uploads`)
 * sichten, filtern, suchen und entscheiden — einzeln und im Batch.
 *
 * Grundsätze (docs/REVIEW_CONSOLE_DESIGN.md):
 *  - Admin-only (Custom-Claim `admin:true`), Admin-SDK → keine Rules-Lockerung.
 *  - Das Tool setzt NUR den Status. Geld bucht ausschließlich der Trigger
 *    crowd-upload-reward auf der Flanke pending→approved (Idempotenz dort).
 *  - Die Doppel-Regel (30-Tage-Sperre, außer andere Daten) wird bei JEDER
 *    Freigabe frisch aus den Tatsachen berechnet — nicht aus einem Cache.
 *    `force:true` + Notiz übersteuert bewusst und wird am Doc vermerkt.
 *  - Batch = pro ID eigene Transaktion + Ergebnis pro ID. Kein „alles oder nichts".
 *  - reviewNote immer positiv formuliert (Copy-Ton-Regel, CLAUDE.md).
 */

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { evaluateDuplicate, completenessCheck, REASON, ms } = require('./src/duplicatePolicy');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const COL = 'crowd_uploads';
const REQUIRED_STEPS = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
const MAX_BATCH = 100;
// Werte, die in der Konsole in HTML-Attribute wandern, dürfen NUR aus einer
// bekannten Menge kommen — crowd_uploads ist client-anlegbar (die Rules
// erlauben create mit beliebigen Feldern), ein freier `status` wäre sonst ein
// XSS-Vektor im Admin-Browser.
const UPLOAD_STATUSES = new Set(['pending', 'approved', 'rejected']);
const safeStatus = (v) => (UPLOAD_STATUSES.has(v) ? v : 'unknown');
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function assertAdmin(req) {
  if (!req.auth || !req.auth.token || req.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin-Recht erforderlich.');
  }
  return req.auth.uid;
}

const fmtDate = (msValue) => (msValue ? new Date(msValue).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null);

/** Nutzer-Hinweise je Grund — positiv, vorwärts gewandt (nie „keine Vergütung"). */
function noteFor(reason, ctx = {}) {
  const until = fmtDate(ctx.lockUntil);
  switch (reason) {
    case REASON.SAME_USER:
      return `Dieses Produkt hast du vor Kurzem schon erfasst — danke! Eine neue Einreichung zählt wieder ab ${until || 'in 30 Tagen'}, oder sofort, wenn sich Preis oder Hersteller geändert haben.`;
    case REASON.OTHER_USER:
      return `Dieses Produkt ist bei uns schon frisch erfasst — danke fürs Mitmachen! Ab ${until || 'in 30 Tagen'} zählt es wieder, oder sofort mit neuem Preis oder anderem Hersteller.`;
    case REASON.PENDING_OLDER:
      return 'Doppelt eingereicht — die frühere Einreichung zählt.';
    case 'unvollstaendig':
      return `Es fehlen Fotos (${(ctx.missing || []).join(', ') || 'siehe Liste'}). Mit allen sieben Ansichten klappt es beim nächsten Mal.`;
    case 'ean_fehlt':
      return 'Der Barcode (EAN, 8–14 Ziffern) ordnet das Produkt eindeutig zu — beim nächsten Mal bitte scannen oder eintippen.';
    case 'kein_produktname':
      return 'Der Produktname war nicht erkennbar — Vorderseite gut ausgeleuchtet und ohne Spiegelung, dann passt es.';
    case 'bilder_wiederverwendet':
      return 'Dieselben Fotos wurden schon für eine andere Einreichung verwendet — jedes Produkt braucht eigene Aufnahmen.';
    case 'fotos_unpassend':
      return 'Die Fotos zeigen nicht das erwartete Produkt — bitte alle Ansichten vom selben Artikel.';
    case 'produkt_bereits_verguetet':
      return 'Dieses Produkt hast du schon eingereicht und es wurde bereits vergütet — danke!';
    default:
      return ctx.note || 'Danke fürs Einreichen — beim nächsten Datensatz geht es weiter.';
  }
}

function rowOf(d) {
  const x = d.data() || {};
  // Anzeige = dieselbe Quelle wie die Doppel-Regel: NUR die server-geschriebenen
  // OCR-Felder. Ein client-gesetztes Top-Level-Feld darf weder die Regel noch
  // die Anzeige beeinflussen (crowd_uploads ist client-anlegbar).
  const price = x.priceOcr && Number.isFinite(x.priceOcr.priceCents) ? x.priceOcr.priceCents : null;
  const manufacturer = x.manufacturerOcr && typeof x.manufacturerOcr.name === 'string' ? x.manufacturerOcr.name : null;
  return {
    id: d.id,
    status: safeStatus(x.status),
    statusRaw: typeof x.status === 'string' ? x.status.slice(0, 40) : null,
    userId: x.userId ?? null,
    campaignId: x.campaignId ?? null,
    marketId: x.marketId ?? null,
    marketName: x.marketName ?? null,
    marketLand: x.marketLand ?? null,
    productName: x.productName ?? null,
    productNameOcr: x.productNameOcr ?? null,
    ean: x.ean ?? null,
    images: x.images ?? {},
    stepCount: x.stepCount ?? Object.keys(x.images || {}).length,
    createdAt: ms(x.createdAt),
    updatedAt: ms(x.updatedAt),
    reviewedAt: ms(x.reviewedAt),
    reviewedBy: x.reviewedBy ?? null,
    holdReasons: Array.isArray(x.holdReasons) ? x.holdReasons : [],
    rejectReason: x.rejectReason ?? null,
    reviewNote: x.reviewNote ?? null,
    rewardCents: x.rewardCents ?? null,
    rewardResult: x.rewardResult ?? null,
    rewardNotCreditedReason: x.rewardNotCreditedReason ?? null,
    rewardSkipped: x.rewardSkipped ?? null,
    rewardSkippedReason: x.rewardSkippedReason ?? null,
    rewardLocationRule: x.rewardLocationRule ?? null,
    clientVersion: x.clientVersion ?? null,
    capture: x.capture
      ? { gpsStatus: x.capture.gpsStatus ?? null, confirmedPlace: x.capture.confirmedPlace ?? null, capturedAt: ms(x.capture.capturedAt), hasGps: !!x.capture.gps }
      : null,
    priceCents: Number.isFinite(price) ? price : null,
    manufacturer,
    // Was das „Preis"-Bild zeigt und — falls Kassenbon — dessen Filialadresse.
    priceImageKind: typeof x.priceImageKind === 'string' ? x.priceImageKind : null,
    priceReceipt: x.priceReceipt
      ? { merchant: x.priceReceipt.merchant ?? null, street: x.priceReceipt.street ?? null, zip: x.priceReceipt.zip ?? null, city: x.priceReceipt.city ?? null, bonDate: x.priceReceipt.bonDate ?? null, complete: !!x.priceReceipt.complete }
      : null,
    review: x.review ?? null,
    // Für die Doppel-Regel (nicht im UI nötig, aber im Kandidaten-Vergleich)
    _policy: { id: d.id, userId: x.userId ?? null, ean: x.ean ?? null, marketId: x.marketId ?? null, status: safeStatus(x.status), createdAt: ms(x.createdAt), priceOcr: x.priceOcr ?? null, manufacturerOcr: x.manufacturerOcr ?? null },
  };
}

/** Alle Einreichungen zu einer EAN-Menge (Chunks à 30 für `in`-Queries). */
async function loadByEans(eans) {
  const out = new Map(); // ean → rows
  const list = [...new Set(eans.filter(Boolean))];
  for (let i = 0; i < list.length; i += 30) {
    const chunk = list.slice(i, i + 30);
    const snap = await db.collection(COL).where('ean', 'in', chunk).get();
    for (const d of snap.docs) {
      const r = rowOf(d);
      if (!out.has(r.ean)) out.set(r.ean, []);
      out.get(r.ean).push(r);
    }
  }
  return out;
}

/** Vorprüfung eines Kandidaten gegen die Einreichungen derselben EAN. */
function precheckOf(row, sameEanRows) {
  const completeness = completenessCheck({ images: row.images, ean: row.ean, productName: row.productName, productNameOcr: row.productNameOcr }, REQUIRED_STEPS);
  const others = (sameEanRows || []).filter((r) => r.id !== row.id).map((r) => r._policy);
  const dup = row.ean ? evaluateDuplicate(row._policy, others) : { verdict: 'ok', reason: null, priorId: null, priorUserId: null, sameUser: null, lockUntil: null, updatedFields: [], diff: null };
  const reasons = [...completeness.problems];
  if (dup.verdict === 'locked' || dup.verdict === 'hold') reasons.push(dup.reason);
  const verdict = !completeness.ok ? 'incomplete' : dup.verdict === 'ok' ? 'ok' : dup.verdict;
  return { verdict, reasons, missing: completeness.missing, dup };
}

function stripPolicy(row) {
  const { _policy, ...rest } = row;
  return rest;
}

// ─── Listen + Statistik ─────────────────────────────────────────────

exports.reviewListUploads = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60 }, async (req) => {
  assertAdmin(req);
  const p = req.data || {};
  const status = p.status && p.status !== 'all' ? String(p.status) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(p.offset) || 0);
  const q = String(p.q || '').trim().toLowerCase();
  const from = Number(p.from) || null;
  const to = Number(p.to) || null;

  // Eine Gleichheits-Bedingung serverseitig (Single-Field-Index), Rest im
  // Speicher — 1,6 k Docs, kein Composite-Index nötig (Index-Lehre in CLAUDE.md).
  let query = db.collection(COL);
  if (status) query = query.where('status', '==', status);
  else if (p.userId) query = query.where('userId', '==', String(p.userId));
  const snap = await query.get();
  let rows = snap.docs.map(rowOf);

  if (p.userId) rows = rows.filter((r) => r.userId === String(p.userId));
  if (p.campaignId) rows = rows.filter((r) => (p.campaignId === 'none' ? !r.campaignId : r.campaignId === String(p.campaignId)));
  if (p.marketId) rows = rows.filter((r) => r.marketId === String(p.marketId));
  if (p.ean) rows = rows.filter((r) => String(r.ean || '').includes(String(p.ean).replace(/\D/g, '')));
  if (from) rows = rows.filter((r) => (r.createdAt ?? 0) >= from);
  if (to) rows = rows.filter((r) => (r.createdAt ?? 0) <= to);
  if (p.holdReason) rows = rows.filter((r) => r.holdReasons.some((h) => String(h).startsWith(String(p.holdReason))) || r.rejectReason === p.holdReason);
  if (q) {
    rows = rows.filter((r) =>
      [r.productName, r.productNameOcr, r.ean, r.userId, r.marketName, r.marketId, r.manufacturer, r.id]
        .some((v) => v && String(v).toLowerCase().includes(q)),
    );
  }

  // Vorprüfung für offene Einreichungen — frisch gegen ALLE Einreichungen
  // derselben EAN. Bewusst über ALLE offenen, nicht nur die gefilterte Seite:
  // sonst zeigte der Kopfzeilen-Zähler „davon Sperre" den Ausschnitt neben
  // globalen Werten.
  const allPending = status === 'pending' && !p.userId
    ? rows.filter((r) => r.status === 'pending')
    : (await db.collection(COL).where('status', '==', 'pending').get()).docs.map(rowOf);
  const byEan = allPending.length ? await loadByEans(allPending.map((r) => r.ean)) : new Map();
  const preById = new Map(allPending.map((r) => [r.id, precheckOf(r, byEan.get(r.ean) || [])]));
  let lockedPendingCount = 0;
  for (const pre of preById.values()) if (pre.verdict === 'locked') lockedPendingCount++;
  for (const r of rows) {
    r.precheck = r.status === 'pending' ? preById.get(r.id) ?? precheckOf(r, byEan.get(r.ean) || []) : r.review?.precheck ?? null;
  }
  if (p.precheck && p.precheck !== 'all') rows = rows.filter((r) => r.precheck && r.precheck.verdict === p.precheck);

  rows.sort((a, b) => (p.sort === 'createdAt_asc' ? (a.createdAt ?? 0) - (b.createdAt ?? 0) : (b.createdAt ?? 0) - (a.createdAt ?? 0)));
  const total = rows.length;
  const page = rows.slice(offset, offset + limit).map(stripPolicy);

  // Zähler (Aggregations-Queries, je 1 Read) + Aktionen fürs Filter-Menü.
  const [cPending, cApproved, cRejected, campaignsSnap] = await Promise.all([
    db.collection(COL).where('status', '==', 'pending').count().get(),
    db.collection(COL).where('status', '==', 'approved').count().get(),
    db.collection(COL).where('status', '==', 'rejected').count().get(),
    db.collection('cashback_campaigns').get(),
  ]);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const cToday = await db.collection(COL).where('reviewedAt', '>=', todayStart).count().get().catch(() => null);
  const campaigns = campaignsSnap.docs.map((d) => ({ id: d.id, title: d.data().title || d.id, kind: d.data().kind || 'receipt', active: !!d.data().active, endAt: ms(d.data().endAt) }))
    .filter((c) => c.kind === 'product_photos').sort((a, b) => (b.endAt || 0) - (a.endAt || 0));
  return {
    rows: page, total, offset, limit,
    stats: { pending: cPending.data().count, approved: cApproved.data().count, rejected: cRejected.data().count, reviewedToday: cToday ? cToday.data().count : null, lockedPending: lockedPendingCount },
    campaigns,
  };
});

exports.reviewGetUpload = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const id = String((req.data && req.data.id) || '');
  if (!id) throw new HttpsError('invalid-argument', 'id fehlt.');
  const d = await db.collection(COL).doc(id).get();
  if (!d.exists) throw new HttpsError('not-found', 'Einreichung nicht gefunden.');
  const row = rowOf(d);
  const [sameEanSnap, sameUserSnap] = await Promise.all([
    row.ean ? db.collection(COL).where('ean', '==', row.ean).get() : null,
    row.userId ? db.collection(COL).where('userId', '==', row.userId).get() : null,
  ]);
  const sameEan = sameEanSnap ? sameEanSnap.docs.map(rowOf).filter((r) => r.id !== id) : [];
  const sameUser = sameUserSnap ? sameUserSnap.docs.map(rowOf).filter((r) => r.id !== id).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 30) : [];
  const precheck = row.status === 'pending' ? precheckOf(row, sameEan) : row.review?.precheck ?? precheckOf(row, sameEan);
  const prior = precheck.dup && precheck.dup.priorId ? sameEan.find((r) => r.id === precheck.dup.priorId) : null;
  return { row: stripPolicy(row), precheck, prior: prior ? stripPolicy(prior) : null, sameEan: sameEan.map(stripPolicy), sameUser: sameUser.map(stripPolicy) };
});

// ─── Entscheidungen (einzeln + Batch) ───────────────────────────────

const DECISIONS = new Set(['approve', 'reject', 'hold', 'unhold']);

exports.reviewDecideUploads = onCall({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  const adminUid = assertAdmin(req);
  const p = req.data || {};
  const ids = Array.isArray(p.ids) ? [...new Set(p.ids.map(String))] : [];
  const decision = String(p.decision || '');
  const reason = p.reason ? String(p.reason) : null;
  const note = p.note ? String(p.note).slice(0, 500) : null;
  const force = p.force === true;
  if (!ids.length) throw new HttpsError('invalid-argument', 'ids fehlt.');
  if (ids.length > MAX_BATCH) throw new HttpsError('invalid-argument', `Maximal ${MAX_BATCH} IDs pro Aufruf.`);
  if (!DECISIONS.has(decision)) throw new HttpsError('invalid-argument', 'decision muss approve|reject|hold|unhold sein.');
  if ((decision === 'reject' || decision === 'hold') && !reason) throw new HttpsError('invalid-argument', 'reason fehlt.');
  if (decision === 'approve' && force && !note) throw new HttpsError('invalid-argument', 'force braucht eine Notiz.');

  // Chronologisch verarbeiten (älteste zuerst): sonst sieht bei zwei offenen
  // Einreichungen derselben EAN die NEUERE die ältere noch als `pending` und
  // wird als „doppelt_eingereicht" blockiert, obwohl sie nach Freigabe der
  // älteren regulär entschieden würde. Die Liste im Client ist createdAt DESC.
  let ordered = ids;
  try {
    const snaps = await db.getAll(...ids.map((id) => db.collection(COL).doc(id)), { fieldMask: ['createdAt'] });
    const at = new Map(snaps.map((sn) => [sn.id, ms(sn.data() && sn.data().createdAt) ?? 0]));
    ordered = [...ids].sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
  } catch (e) {
    logger.warn('[review-console] Sortierung fehlgeschlagen, Eingabereihenfolge', { err: e.message });
  }

  const results = [];
  for (const id of ordered) {
    const ref = db.collection(COL).doc(id);
    try {
      const res = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { id, outcome: 'error', reason: 'not_found' };
        const row = rowOf(snap);
        const ts = FieldValue.serverTimestamp();

        if (decision === 'approve') {
          if (row.status !== 'pending') return { id, outcome: 'skipped', reason: `status_${row.status}` };
          // Tatsachen JETZT: alle Einreichungen derselben EAN (Reads in der
          // Transaktion, damit ein paralleler Approve derselben EAN kollidiert).
          let others = [];
          if (row.ean) {
            const same = await tx.get(db.collection(COL).where('ean', '==', row.ean));
            others = same.docs.map(rowOf).filter((r) => r.id !== id);
          }
          const precheck = precheckOf(row, others);
          if (precheck.verdict !== 'ok' && !force) {
            return { id, outcome: 'blocked', reason: precheck.reasons[0] || precheck.verdict, precheck };
          }
          const review = { precheck: { verdict: precheck.verdict, reasons: precheck.reasons, dup: precheck.dup }, decidedBy: adminUid, forced: force, ...(force ? { forcedNote: note } : {}) };
          tx.update(ref, { status: 'approved', reviewedAt: ts, reviewedBy: adminUid, updatedAt: ts, review, holdReasons: FieldValue.delete(), rejectReason: FieldValue.delete(), ...(note && !force ? { reviewNote: note } : {}) });
          return { id, outcome: 'approved', precheck: review.precheck };
        }

        if (decision === 'reject') {
          if (row.status !== 'pending') return { id, outcome: 'skipped', reason: `status_${row.status}` };
          // Für Sperr-Gründe die Frist aus den Tatsachen holen (Notiz nennt das Datum).
          let ctx = { note };
          if (reason === REASON.SAME_USER || reason === REASON.OTHER_USER) {
            const same = row.ean ? await tx.get(db.collection(COL).where('ean', '==', row.ean)) : null;
            const pre = precheckOf(row, same ? same.docs.map(rowOf).filter((r) => r.id !== id) : []);
            ctx = { note, lockUntil: pre.dup && pre.dup.lockUntil };
          }
          tx.update(ref, {
            status: 'rejected', rejectReason: reason, holdReasons: [...new Set([...(row.holdReasons || []), reason])],
            reviewNote: note || noteFor(reason, ctx), reviewedAt: ts, reviewedBy: adminUid, updatedAt: ts,
            review: { decidedBy: adminUid, reason, lockUntil: ctx.lockUntil || null },
          });
          return { id, outcome: 'rejected', reason };
        }

        if (decision === 'hold') {
          if (row.status !== 'pending') return { id, outcome: 'skipped', reason: `status_${row.status}` };
          tx.update(ref, { holdReasons: [...new Set([...(row.holdReasons || []), reason])], reviewNote: note || noteFor(reason, { note }), reviewedAt: ts, reviewedBy: adminUid, updatedAt: ts });
          return { id, outcome: 'held', reason };
        }

        // unhold
        if (row.status !== 'pending') return { id, outcome: 'skipped', reason: `status_${row.status}` };
        tx.update(ref, { holdReasons: FieldValue.delete(), reviewNote: FieldValue.delete(), updatedAt: ts, reviewedBy: adminUid });
        return { id, outcome: 'unheld' };
      });
      results.push(res);
    } catch (e) {
      logger.error('[review-console] decide failed', { id, decision, err: e.message });
      results.push({ id, outcome: 'error', reason: e.message });
    }
  }
  const tally = results.reduce((acc, r) => ((acc[r.outcome] = (acc[r.outcome] || 0) + 1), acc), {});
  logger.info('[review-console] decide', { adminUid, decision, reason, force, n: ids.length, tally });
  return { results, tally };
});

// ═══════════════════════════════════════════════════════════════════
// Bons (receipts) — sichten + Review auflösen über resolveCashbackReview
// ═══════════════════════════════════════════════════════════════════
//
// Geld-Entscheidungen bleiben in der cashback-pipeline (Caps, Ledger-Reverse,
// purchased_products, Push). Die Konsole ruft den bestehenden HTTPS-Resolver
// server-seitig mit dem Admin-Key aus Secret Manager auf — der Key verlässt
// nie den Browser. Nur Bons im Status `review` sind entscheidbar.

const { defineSecret } = require('firebase-functions/params');
const CASHBACK_ADMIN_KEY = defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');
const RESOLVER_URL = process.env.CASHBACK_RESOLVER_URL || 'https://europe-west3-markendetektive-895f7.cloudfunctions.net/resolveCashbackReview';
const RECEIPT_REJECT_REASONS = new Set(['manual_review_rejected', 'duplicate_content_self', 'duplicate_content_cross_user']);
const RECEIPT_NO_REWARD_REASONS = new Set(['daily_cap_reached', 'weekly_cap_reached', 'per_user_cap_reached']);
const RECEIPT_STATUSES = new Set(['ocr_pending', 'review', 'approved', 'no_reward', 'rejected', 'paid', 'matched', 'upload_failed', 'uploading']);
const safeReceiptStatus = (v) => (RECEIPT_STATUSES.has(v) ? v : 'unknown');
const RECEIPT_LIST_FIELDS = [
  'status', 'userId', 'campaignId', 'merchant', 'store', 'bonDate', 'bonTime', 'bonTotalCents', 'eligibleItemCount', 'cashbackCents',
  'rejectReason', 'rejectDetail', 'reviewReason', 'reviewDecision', 'reviewResolvedAt', 'duplicateOf', 'createdAt', 'updatedAt',
  'storage.path', 'ocr.robust.confidence', 'ocr.robust.method', 'ocr.reconciliation.ok', 'ocr.reconciliation.signedDeltaCents',
  'ocr.parsed.merchant', 'bonDateCorrection', 'attempts', 'lastError', 'alreadyCredited',
];

function receiptRowOf(d) {
  const x = d.data() || {};
  return {
    id: d.id,
    status: safeReceiptStatus(x.status),
    userId: x.userId ?? null,
    campaignId: x.campaignId ?? null,
    merchantId: x.merchant?.id ?? null,
    merchantName: x.merchant?.name ?? x.ocr?.parsed?.merchant ?? null,
    merchantLand: x.merchant?.land ?? null,
    store: x.store ? { street: x.store.street ?? null, zip: x.store.zip ?? null, city: x.store.city ?? null } : null,
    bonDate: x.bonDate ?? null,
    bonTime: x.bonTime ?? null,
    bonTotalCents: x.bonTotalCents ?? null,
    eligibleItemCount: x.eligibleItemCount ?? null,
    itemCount: Array.isArray(x.items) ? x.items.length : null,
    cashbackCents: x.cashbackCents ?? null,
    rejectReason: x.rejectReason ?? null,
    rejectDetail: x.rejectDetail ?? null,
    reviewReason: x.reviewReason ?? null,
    reviewDecision: x.reviewDecision ?? null,
    reviewResolvedAt: ms(x.reviewResolvedAt),
    duplicateOf: x.duplicateOf ? { receiptId: x.duplicateOf.receiptId ?? null, sameUser: x.duplicateOf.sameUser ?? null, kind: x.duplicateOf.kind ?? null } : null,
    createdAt: ms(x.createdAt),
    updatedAt: ms(x.updatedAt),
    storagePath: x.storage?.path ?? null,
    ocrConfidence: x.ocr?.robust?.confidence ?? null,
    ocrMethod: x.ocr?.robust?.method ?? null,
    reconOk: x.ocr?.reconciliation?.ok ?? null,
    reconDeltaCents: x.ocr?.reconciliation?.signedDeltaCents ?? null,
    bonDateCorrection: x.bonDateCorrection ?? null,
    attempts: x.attempts ?? null,
    lastError: x.lastError ?? null,
    alreadyCredited: x.alreadyCredited ?? null,
    items: Array.isArray(x.items) ? x.items : undefined,
  };
}

exports.reviewListReceipts = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60 }, async (req) => {
  assertAdmin(req);
  const p = req.data || {};
  const status = p.status && p.status !== 'all' ? String(p.status) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(p.offset) || 0);
  const q = String(p.q || '').trim().toLowerCase();
  const from = Number(p.from) || null;
  const to = Number(p.to) || null;

  // Eine Bedingung serverseitig: Status ODER Nutzer ODER (bei „alle") ein
  // Zeitfenster über createdAt (Default 30 Tage) — kein Composite-Index nötig.
  let query = db.collection('receipts');
  if (status) query = query.where('status', '==', status);
  else if (p.userId) query = query.where('userId', '==', String(p.userId));
  else query = query.where('createdAt', '>=', new Date(from || Date.now() - 30 * 86400000));
  const snap = await query.select(...RECEIPT_LIST_FIELDS).get();
  let rows = snap.docs.map(receiptRowOf).map(({ items, ...r }) => r);

  if (p.userId) rows = rows.filter((r) => r.userId === String(p.userId));
  if (p.merchantId) rows = rows.filter((r) => r.merchantId === String(p.merchantId));
  if (p.campaignId) rows = rows.filter((r) => (p.campaignId === 'none' ? !r.campaignId : r.campaignId === String(p.campaignId)));
  if (p.reason) rows = rows.filter((r) => r.rejectReason === p.reason || r.reviewReason === p.reason);
  if (from) rows = rows.filter((r) => (r.createdAt ?? 0) >= from);
  if (to) rows = rows.filter((r) => (r.createdAt ?? 0) <= to);
  if (q) {
    rows = rows.filter((r) =>
      [r.id, r.userId, r.merchantName, r.merchantId, r.store?.city, r.store?.zip, r.bonDate, r.rejectReason, r.reviewReason]
        .some((v) => v && String(v).toLowerCase().includes(q)),
    );
  }
  rows.sort((a, b) => (p.sort === 'createdAt_asc' ? (a.createdAt ?? 0) - (b.createdAt ?? 0) : (b.createdAt ?? 0) - (a.createdAt ?? 0)));
  const total = rows.length;
  const page = rows.slice(offset, offset + limit);

  const counts = {};
  await Promise.all(['review', 'ocr_pending', 'approved', 'no_reward', 'rejected'].map(async (st) => {
    const c = await db.collection('receipts').where('status', '==', st).count().get().catch(() => null);
    counts[st] = c ? c.data().count : null;
  }));
  return { rows: page, total, offset, limit, stats: counts };
});

exports.reviewGetReceipt = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const id = String((req.data && req.data.id) || '');
  if (!id) throw new HttpsError('invalid-argument', 'id fehlt.');
  const d = await db.collection('receipts').doc(id).get();
  if (!d.exists) throw new HttpsError('not-found', 'Bon nicht gefunden.');
  const row = receiptRowOf(d);
  const x = d.data();
  const dup = row.duplicateOf && row.duplicateOf.receiptId ? await db.collection('receipts').doc(row.duplicateOf.receiptId).select(...RECEIPT_LIST_FIELDS).get() : null;
  const ledger = row.userId
    ? await db.collection(`users/${row.userId}/cashback_ledger`).where('receiptId', '==', id).get().then((s) => s.docs.map((l) => ({ id: l.id, ...l.data(), createdAt: ms(l.data().createdAt) })))
    : [];
  const sameUser = row.userId
    ? await db.collection('receipts').where('userId', '==', row.userId).select(...RECEIPT_LIST_FIELDS).get().then((s) => s.docs.map(receiptRowOf).map(({ items, ...r }) => r).filter((r) => r.id !== id).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 30))
    : [];
  return {
    row,
    ocr: { parsed: x.ocr?.parsed ?? null, robust: x.ocr?.robust ?? null, reconciliation: x.ocr?.reconciliation ?? null, promptVersion: x.ocr?.promptVersion ?? null },
    capture: x.capture ?? null,
    journeyLocation: x.journey?.location ?? null,
    duplicate: dup && dup.exists ? receiptRowOf(dup) : null,
    ledger,
    sameUser,
  };
});

exports.reviewDecideReceipt = onCall({ region: REGION, timeoutSeconds: 90, secrets: [CASHBACK_ADMIN_KEY] }, async (req) => {
  const adminUid = assertAdmin(req);
  const p = req.data || {};
  const receiptId = String(p.receiptId || '');
  const decision = String(p.decision || '');
  const reason = p.reason ? String(p.reason) : '';
  if (!receiptId) throw new HttpsError('invalid-argument', 'receiptId fehlt.');
  const valid =
    decision === 'approve'
    || (decision === 'reject' && (!reason || RECEIPT_REJECT_REASONS.has(reason)))
    || (decision === 'no_reward' && RECEIPT_NO_REWARD_REASONS.has(reason));
  if (!valid) throw new HttpsError('invalid-argument', 'decision=approve|reject[&reason]|no_reward&reason=daily_cap_reached|weekly_cap_reached|per_user_cap_reached');

  const url = new URL(RESOLVER_URL);
  // Key NUR im Header — Query-Parameter landen in den Cloud-Run-Request-Logs.
  url.searchParams.set('receiptId', receiptId);
  url.searchParams.set('decision', decision);
  if (reason) url.searchParams.set('reason', reason);
  if (p.duplicateOf) url.searchParams.set('duplicateOf', String(p.duplicateOf));
  if (p.priorStatus) url.searchParams.set('priorStatus', String(p.priorStatus));
  const res = await fetch(url.toString(), { method: 'POST', headers: { 'x-admin-key': CASHBACK_ADMIN_KEY.value() } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  logger.info('[review-console] receipt decision', { adminUid, receiptId, decision, reason, http: res.status, code: body && body.code });
  if (!res.ok) {
    // 409 = fachlich (nicht in review / campaign_missing / no_cashback_computed) — als Ergebnis zurückgeben, kein Exception-Rauschen.
    return { ok: false, http: res.status, ...body };
  }
  await db.collection('receipts').doc(receiptId).set({ reviewConsole: { decidedBy: adminUid, decision, reason: reason || null, at: FieldValue.serverTimestamp() } }, { merge: true }).catch(() => {});
  return { ok: true, http: res.status, ...body };
});
