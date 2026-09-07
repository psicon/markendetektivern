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
const { ortVonEinreichung, ortVonBon, ortsverzeichnisAusBons } = require('./src/ort');

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
    // Woher das Aktionskennzeichen stammt und worauf der Client es stützte
    // (86cbet2nw) — im Prüf-Werkzeug sichtbar, damit ein fehlender Betrag
    // beim Fall selbst auffällt statt erst bei einem Ledger-Abgleich.
    campaignQuelle: x.campaignQuelle ?? null,
    campaignResolve: x.campaignResolve ?? null,
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

// 'reopen' holt eine ABGELEHNTE Einreichung zurück in die Warteschlange —
// die Rücknahme im Prüf-Werkzeug. Bewusst nur aus 'rejected': eine Freigabe
// hat bereits gebucht, die nimmt man nicht per Klick zurück.
const DECISIONS = new Set(['approve', 'reject', 'hold', 'unhold', 'reopen']);

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
  if (decision === 'reopen' && ids.length > 20) throw new HttpsError('invalid-argument', 'Rücknahme nur für einzelne Einreichungen.');
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

        if (decision === 'reopen') {
          if (row.status !== 'rejected') return { id, outcome: 'skipped', reason: `status_${row.status}` };
          tx.update(ref, {
            status: 'pending',
            rejectReason: FieldValue.delete(),
            holdReasons: FieldValue.delete(),
            reviewNote: FieldValue.delete(),
            reviewedAt: FieldValue.delete(),
            updatedAt: ts,
            reviewedBy: adminUid,
            review: { reopenedBy: adminUid, at: ts },
          });
          return { id, outcome: 'reopened' };
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
  // Ergebnis der feldweisen Prüfung — ohne das ist der Beobachtungs-Modus
  // blind: er schriebe ein Feld, das niemand liest.
  'ocrFieldAgreement',
];

function receiptRowOf(d) {
  const x = d.data() || {};
  return {
    id: d.id,
    // Ergebnis der feldweisen Prüfung (86cbet2w1). Im Beobachtungs-Modus steht
    // hier, was das Gate im Dauer-Modus entschieden hätte.
    ocrFieldAgreement: x.ocrFieldAgreement ?? null,
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

// ═══════════════════════════════════════════════════════════════════
// Prüf-Werkzeug (Fokus-Modus) — ein Fall groß, Bilder sofort sichtbar
// ═══════════════════════════════════════════════════════════════════
//
// Warum eigene Callables statt der Listen oben: Prüfen heißt Bilder ansehen,
// nicht Tabellen lesen. Der Prüfer braucht EINEN Fall vollständig und den
// nächsten schon geladen — nicht 200 Zeilen mit Platzhaltern.
//
// Bild-URLs entstehen HIER, nicht im Browser. Firebase-Storage-Objekte tragen
// in ihren Metadaten ein Download-Token; daraus lässt sich die öffentliche
// URL direkt bauen. Das spart pro Bild einen SDK-Aufruf mit Rules-Prüfung im
// Client — bei sieben Fotos je Fall war genau das der Grund, warum die alte
// Ansicht langsam war und Bilder oft gar nicht erschienen.

const REQUIRED_STEPS_ORDER = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
const STEP_LABEL_DE = {
  front: 'Vorderseite', rueckseite: 'Rückseite', hersteller: 'Hersteller',
  ean: 'Barcode', naehrwerte: 'Nährwerte', zutaten: 'Zutaten', preis: 'Preis',
};
let _bucket = null;
function storageBucket() {
  if (!_bucket) _bucket = admin.storage().bucket('markendetektive-895f7.appspot.com');
  return _bucket;
}

/** Storage-Pfad → direkt ladbare URL (Download-Token aus den Metadaten). */
async function imageUrl(path) {
  if (!path) return null;
  try {
    const file = storageBucket().file(path);
    const [md] = await file.getMetadata();
    const token = md.metadata && md.metadata.firebaseStorageDownloadTokens;
    if (!token) return null;
    const t = String(token).split(',')[0];
    return `https://firebasestorage.googleapis.com/v0/b/${storageBucket().name}/o/${encodeURIComponent(path)}?alt=media&token=${t}`;
  } catch (e) {
    return null;
  }
}

/** Warteschlange: alles, was zu entscheiden ist — schlank, für die Seitenleiste. */
/**
 * Verkleinerte Ansicht über die installierte Bild-Extension (invertase/
 * image-processing-api). Die Originale sind ~5 MB — sieben davon je Fall
 * wären 34 MB und genau der Grund, warum die alte Konsole unbenutzbar war.
 * Die Extension liefert ~90 KB und setzt ein Jahr Cache-Control, der zweite
 * Abruf kommt aus dem Browser-Cache. Das Original bleibt für die Lupe.
 */
const IMG_API = 'https://us-central1-markendetektive-895f7.cloudfunctions.net/ext-image-processing-api-handler/process';
function thumbUrl(path, width) {
  if (!path) return null;
  const ops = [
    { operation: 'input', type: 'gcs', source: path },
    { operation: 'resize', width },
    { operation: 'output', format: 'jpeg', quality: 72 },
  ];
  return `${IMG_API}?operations=${encodeURIComponent(JSON.stringify(ops))}`;
}

exports.reviewQueue = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60 }, async (req) => {
  assertAdmin(req);
  const p = req.data || {};
  const type = p.type === 'receipts' ? 'receipts' : 'photos';
  const q = String(p.q || '').trim().toLowerCase();

  if (type === 'receipts') {
    const snap = await db.collection('receipts').where('status', '==', 'review').select(...RECEIPT_LIST_FIELDS).get();
    // Auch Bons brauchen ein Urteil in der Warteschlange — ohne das war dort
    // jeder Punkt grün, egal ob Doppel-Verdacht oder Bildbearbeitung.
    const BON_URTEIL = {
      forensics_software: 'locked',
      duplicate_content_self: 'locked',
      duplicate_content_cross_user: 'locked',
      bon_date_future: 'hold',
      ocr_unavailable: 'hold',
      ocr_confidence_none: 'hold',
      mensch_hat_entschieden: 'hold',
    };
    let rows = snap.docs.map(receiptRowOf).map(({ items, ...r }) => ({
      id: r.id, userId: r.userId, merchantName: r.merchantName, store: r.store, bonDate: r.bonDate,
      bonTotalCents: r.bonTotalCents, eligibleItemCount: r.eligibleItemCount, reviewReason: r.reviewReason,
      ocrConfidence: r.ocrConfidence, reconOk: r.reconOk, createdAt: r.createdAt,
      verdict: BON_URTEIL[r.reviewReason] || (r.reconOk === false ? 'hold' : 'ok'),
    }));
    if (q) rows = rows.filter((r) => [r.id, r.userId, r.merchantName, r.store && r.store.city, r.bonDate].some((v) => v && String(v).toLowerCase().includes(q)));
    if (p.verdict && p.verdict !== 'all') rows = rows.filter((r) => r.verdict === p.verdict);
    rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)); // ältester zuerst — er wartet am längsten
    const counts = rows.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] || 0) + 1), acc), {});
    return { type, rows, total: rows.length, counts };
  }

  // Produktfotos: die Vorprüfung braucht alle Einreichungen derselben EAN.
  // EIN Bestands-Query mit wenigen Feldern ist schneller als viele `in`-Chunks.
  const [openSnap, allSnap] = await Promise.all([
    db.collection(COL).where('status', '==', 'pending').get(),
    db.collection(COL).select('userId', 'ean', 'marketId', 'status', 'createdAt', 'priceOcr', 'manufacturerOcr').get(),
  ]);
  const byEan = new Map();
  for (const d of allSnap.docs) {
    const x = d.data();
    if (!x.ean) continue;
    if (!byEan.has(x.ean)) byEan.set(x.ean, []);
    // WICHTIG: dieselbe Form wie `rowOf` sie liefert, also mit `_policy`.
    // Vorher standen hier flache Objekte ohne dieses Feld — `precheckOf` liest
    // aber genau `_policy`, bekam also eine Liste aus lauter `undefined` und
    // meldete jede Einreichung als unauffällig. Folge: 83 Fälle, die die
    // Doppel-Regel sperrt oder zurückhält, erschienen in der Warteschlange als
    // grün, und der Filter „Sperre" lieferte immer eine leere Liste — während
    // dasselbe Urteil im geöffneten Fall korrekt stand. Zwei Bildschirme, die
    // sich widersprechen.
    const policy = { id: d.id, userId: x.userId ?? null, ean: x.ean ?? null, marketId: x.marketId ?? null, status: safeStatus(x.status), createdAt: ms(x.createdAt), priceOcr: x.priceOcr ?? null, manufacturerOcr: x.manufacturerOcr ?? null };
    byEan.get(x.ean).push({ ...policy, _policy: policy });
  }
  let rows = openSnap.docs.map((d) => {
    const r = rowOf(d);
    const pre = precheckOf(r, byEan.get(r.ean) || []);
    return {
      id: r.id, userId: r.userId, productName: r.productName || r.productNameOcr, ean: r.ean,
      marketName: r.marketName || r.marketId, createdAt: r.createdAt, campaignId: r.campaignId,
      priceCents: r.priceCents, manufacturer: r.manufacturer, priceImageKind: r.priceImageKind,
      stepCount: r.stepCount, verdict: pre.verdict, reasons: pre.reasons,
    };
  });
  if (q) rows = rows.filter((r) => [r.id, r.userId, r.productName, r.ean, r.marketName].some((v) => v && String(v).toLowerCase().includes(q)));
  if (p.verdict && p.verdict !== 'all') rows = rows.filter((r) => r.verdict === p.verdict);
  rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const counts = rows.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] || 0) + 1), acc), {});
  return { type, rows, total: rows.length, counts };
});

/** Bis 6 Fälle vollständig — mit fertigen Bild-URLs, für Anzeige + Vorladen. */
exports.reviewCases = onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 60 }, async (req) => {
  assertAdmin(req);
  const p = req.data || {};
  const type = p.type === 'receipts' ? 'receipts' : 'photos';
  const ids = (Array.isArray(p.ids) ? p.ids : []).slice(0, 6).map(String);
  if (!ids.length) return { cases: [] };

  if (type === 'receipts') {
    const snaps = await db.getAll(...ids.map((id) => db.collection('receipts').doc(id)));
    const vorhanden = snaps.filter((s) => s.exists);

    // Dieselben zwei Angaben, die der Foto-Bildschirm hat und die beim Bon
    // bisher fehlten: wer reicht ein, und was löst die Freigabe aus. Ohne sie
    // drückt man bei einem Bon F, ohne zu wissen, ob acht Cent fließen und ob
    // der Mensch dahinter zum dritten Mal auffällt.
    const bonNutzer = new Map();
    await Promise.all([...new Set(vorhanden.map((s) => s.data().userId).filter(Boolean))].map(async (uid) => {
      const [eigene, user] = await Promise.all([
        db.collection('receipts').where('userId', '==', uid).select('status', 'createdAt').get(),
        db.doc(`users/${uid}`).get(),
      ]);
      let angenommen = 0; let abgelehnt = 0; let erste = null;
      eigene.docs.forEach((d) => {
        const st = String(d.data().status || '');
        if (st === 'approved') angenommen++;
        else if (st === 'rejected') abgelehnt++;
        const t = ms(d.data().createdAt);
        if (t && (erste == null || t < erste)) erste = t;
      });
      const u = user.exists ? user.data() : {};
      bonNutzer.set(uid, {
        einreichungen: eigene.size, angenommen, abgelehnt, seit: erste,
        guthabenCent: u.cashback_balance_cents ?? 0, proAktion: u.cashback_campaign_totals ?? {},
      });
    }));

    const cases = await Promise.all(vorhanden.map(async (s) => {
      const row = receiptRowOf(s);
      const x = s.data();
      const [full, ledger] = await Promise.all([
        imageUrl(row.storagePath),
        row.userId
          ? db.collection(`users/${row.userId}/cashback_ledger`).where('receiptId', '==', s.id).get().then((l) => l.docs.map((d) => ({ type: d.data().type, cents: d.data().cents })))
          : [],
      ]);
      return {
        id: s.id, kind: 'receipt', row: { ...row, items: undefined },
        ort: ortVonBon(x),
        nutzer: bonNutzer.get(row.userId) || null,
        // Der Betrag steht bereits am Bon — die Pipeline hat ihn mit allen
        // Deckeln gerechnet. Ihn hier ein zweites Mal herzuleiten wäre eine
        // Nachbildung, die auseinanderläuft.
        folge: {
          buchtCent: Number(x.cashbackCents) || 0,
          grund: (Number(x.cashbackCents) || 0) > 0 ? null : (x.zeroReason || x.rejectReason || 'kein_betrag'),
        },
        imageUrl: thumbUrl(row.storagePath, 1100), fullUrl: full,
        items: Array.isArray(x.items) ? x.items : [],
        ocr: { parsed: x.ocr?.parsed ?? null, robust: x.ocr?.robust ?? null, reconciliation: x.ocr?.reconciliation ?? null },
        duplicateOf: row.duplicateOf, ledger,
      };
    }));
    return { cases };
  }

  const snaps = await db.getAll(...ids.map((id) => db.collection(COL).doc(id)));
  const present = snaps.filter((s) => s.exists);

  // Was beim Prüfen wirklich zählt und bisher fehlte: Wer reicht da ein, und
  // was löst eine Freigabe aus? Ohne das steht der Prüfer vor einer Feldliste
  // und muss raten, ob der Fall harmlos ist und ob Geld fließt.
  const nutzerInfo = new Map();
  const aktionInfo = new Map();
  await Promise.all([...new Set(present.map((s) => s.data().userId).filter(Boolean))].map(async (uid) => {
    const [eigene, user] = await Promise.all([
      db.collection(COL).where('userId', '==', uid).select('status', 'createdAt').get(),
      db.doc(`users/${uid}`).get(),
    ]);
    let angenommen = 0; let abgelehnt = 0; let erste = null;
    eigene.docs.forEach((d) => {
      const st = safeStatus(d.data().status);
      if (st === 'approved') angenommen++;
      else if (st === 'rejected') abgelehnt++;
      const t = ms(d.data().createdAt);
      if (t && (erste == null || t < erste)) erste = t;
    });
    const u = user.exists ? user.data() : {};
    nutzerInfo.set(uid, {
      einreichungen: eigene.size, angenommen, abgelehnt, seit: erste,
      guthabenCent: u.cashback_balance_cents ?? 0,
      proAktion: u.cashback_campaign_totals ?? {},
    });
  }));
  await Promise.all([...new Set(present.map((s) => s.data().campaignId).filter(Boolean))].map(async (cid) => {
    const c = await db.collection('cashback_campaigns').doc(cid).get();
    if (c.exists) {
      const x = c.data();
      aktionInfo.set(cid, {
        titel: x.title || cid,
        proEinreichungCent: Number(x.cashbackPerBonCents) || 0,
        maxProNutzerCent: Number(x.maxPerUserCents) || 0,
        restbudgetCent: Number(x.budgetRemainingCents) || 0,
      });
    }
  }));
  // EAN-Nachbarn für die Doppel-Regel: nur die betroffenen EANs.
  const eans = [...new Set(present.map((s) => s.data().ean).filter(Boolean))];
  const byEan = eans.length ? await loadByEans(eans) : new Map();
  const cases = await Promise.all(present.map(async (s) => {
    const row = rowOf(s);
    const pre = precheckOf(row, byEan.get(row.ean) || []);
    const bilder = await Promise.all(REQUIRED_STEPS_ORDER.map(async (step) => {
      const path = row.images && row.images[step];
      return {
        step, label: STEP_LABEL_DE[step] || step,
        url: thumbUrl(path, 520),          // Kachel
        full: await imageUrl(path),        // Lupe
        fehlt: !path,
      };
    }));
    const prior = pre.dup && pre.dup.priorId ? (byEan.get(row.ean) || []).find((r) => r.id === pre.dup.priorId) : null;
    const eigene = (byEan.get(row.ean) || []).filter((r) => r.id !== row.id).length;
    const nutzer = nutzerInfo.get(row.userId) || null;
    const aktion = row.campaignId ? aktionInfo.get(row.campaignId) || null : null;
    // Was eine Freigabe auslöst — in Cent, mit Grund, wenn es nichts wird.
    let folge = { buchtCent: 0, grund: 'keine_aktion' };
    if (aktion) {
      const bisher = (nutzer?.proAktion || {})[row.campaignId] || 0;
      const rest = aktion.maxProNutzerCent > 0 ? Math.max(0, aktion.maxProNutzerCent - bisher) : Infinity;
      const zahlbar = Math.min(aktion.proEinreichungCent, rest, aktion.restbudgetCent);
      folge = zahlbar > 0
        ? { buchtCent: zahlbar, grund: null }
        : { buchtCent: 0, grund: rest <= 0 ? 'nutzer_am_limit' : aktion.restbudgetCent <= 0 ? 'budget_leer' : 'kein_betrag' };
    }
    return {
      id: s.id, kind: 'photo', row: stripPolicy(row), bilder, precheck: pre,
      prior: prior ? stripPolicy(prior) : null, gleicheEan: eigene,
      // EINE Ortsangabe statt vier Rohfeldern — siehe src/ort.js.
      ort: ortVonEinreichung(s.data()),
      nutzer, aktion, folge,
    };
  }));
  return { cases };
});


/**
 * Alle Einreichungen und Bons als Kartenpunkte (86cbet2nw / Ortsfrage 07.09.2026).
 *
 * Kompakt als Arrays statt Objekte: 8.000 Punkte wären als Objektliste rund
 * 900 KB, so sind es unter 300 KB. Gefiltert wird im Browser — die Daten sind
 * einmal geladen, jeder Filterwechsel ist dann sofort und kostet keinen Read.
 *
 * Punkt = [typ, lat, lon, zeit, quelle, markt, land, plz, ort, status, id, auffaellig[]]
 *   typ 0 = Produktfoto, 1 = Bon
 *   quelle 0 = Gerätestandort, 1 = Filiale laut Bon, 2 = Angabe des Nutzers
 */
/**
 * Zwischenspeicher für die Kartenpunkte.
 *
 * Jeder Aufruf liest sonst ALLE Einreichungen und Bons — Stand heute rund 8.100
 * Dokumente. Firestore-Reads sind der größte Serverposten des Projekts; die
 * Karte ist ein Werkzeug, das man am Tag mehrfach öffnet und dessen Bild sich
 * dabei kaum ändert. Fünf Minuten Aufbewahrung im Funktionsspeicher fangen die
 * Wiederholungen ab, ohne dass jemand veraltete Punkte zu sehen bekommt. Der
 * Aufrufer kann mit `frisch: true` erzwingen, dass neu gelesen wird.
 */
let kartenCache = null;
const KARTE_TTL_MS = 5 * 60 * 1000;

exports.reviewMapPoints = onCall({ region: REGION, memory: '1GiB', timeoutSeconds: 120 }, async (req) => {
  assertAdmin(req);
  if (!req.data?.frisch && kartenCache && Date.now() - kartenCache.stand < KARTE_TTL_MS) {
    return { ...kartenCache, ausCache: true };
  }
  // Auf die Karte kommen nur BEOBACHTETE Orte. `user_profile_region` (der aus
  // früheren Bons abgeleitete Wohnort) und `market_country` (nur das Land)
  // sagen nichts darüber, wo DIESE Einreichung entstanden ist — ein Wohnort
  // als Einkaufspunkt wäre derselbe Fehler wie die IP-Ortung, nur subtiler.
  const QUELLE = { geraet: 0, filiale: 1, nutzerangabe: 2 };
  const punkte = [];
  // „Ohne Ort" ist keine Erklärung — die Gründe sind verschieden und führen zu
  // verschiedenen Schlüssen: ein Altfall ohne jede Angabe ist etwas anderes als
  // einer, bei dem nur das Land des Marktes bekannt ist.
  const ohneOrt = { fotos: 0, bons: 0, nurLand: 0, wohnort: 0, garNichts: 0, ortNichtAufloesbar: 0, fotosAktuellOhne: 0, fotosAktuell: 0 };
  // Der Ortsschätzer läuft seit dem 15.08.2026. Alles davor kann keinen Ort
  // haben — alles danach schon, und dort ist ein fehlender Ort ein laufendes
  // Thema, kein Altbestand. Die Karte darf beides nicht in einen Topf werfen.
  const SCHAETZER_SEIT = Date.parse('2026-08-15');

  const [uploads, receipts] = await Promise.all([
    db.collection(COL).select('capture', 'priceReceipt', 'probableLocation', 'marketName', 'marketLand', 'status', 'createdAt', 'productName', 'campaignId').get(),
    db.collection('receipts').select('store', 'merchant', 'bonDate', 'status', 'createdAt', 'totalCents', 'campaignId').get(),
  ]);

  // Ortsverzeichnis aus den eigenen Bon-Adressen: das öffentliche Verzeichnis
  // kennt nur Hauptgemeinden, die Bons auch kleine Orte (siehe src/ort.js).
  const verzeichnis = ortsverzeichnisAusBons(
    receipts.docs.map((d) => d.data().store).filter((st) => st && st.city && st.zip),
  );

  for (const d of uploads.docs) {
    const x = d.data();
    const o = ortVonEinreichung(x, verzeichnis);
    const aktuell = (ms(x.createdAt) ?? 0) >= SCHAETZER_SEIT;
    if (aktuell) ohneOrt.fotosAktuell++;
    if (o.lat == null || o.lon == null || QUELLE[o.quelle] === undefined) {
      ohneOrt.fotos++;
      if (aktuell) ohneOrt.fotosAktuellOhne++;
      if (o.quelle === 'land') ohneOrt.nurLand++;
      else if (o.quelle === 'profil') ohneOrt.wohnort++;
      else if (o.quelle == null) ohneOrt.garNichts++;
      else ohneOrt.ortNichtAufloesbar++;
      continue;
    }
    punkte.push([
      0, Math.round(o.lat * 1e4) / 1e4, Math.round(o.lon * 1e4) / 1e4,
      ms(x.createdAt), QUELLE[o.quelle] ?? null,
      x.marketName || null, o.land || null, o.plz || null, o.ort || null,
      safeStatus(x.status), d.id,
      (o.auffaellig || []).map((a) => a.text),
    ]);
  }
  for (const d of receipts.docs) {
    const x = d.data();
    const o = ortVonBon(x, verzeichnis);
    if (o.lat == null || o.lon == null) { ohneOrt.bons++; continue; }
    punkte.push([
      1, Math.round(o.lat * 1e4) / 1e4, Math.round(o.lon * 1e4) / 1e4,
      ms(x.createdAt), QUELLE[o.quelle] ?? null,
      (x.merchant && x.merchant.name) || null, o.land || null, o.plz || null, o.ort || null,
      String(x.status || 'unbekannt'), d.id,
      (o.auffaellig || []).map((a) => a.text),
    ]);
  }

  kartenCache = {
    punkte,
    ohneOrt,
    gesamt: { fotos: uploads.size, bons: receipts.size },
    stand: Date.now(),
  };
  return { ...kartenCache, ausCache: false };
});
