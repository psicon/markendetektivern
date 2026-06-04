/**
 * receipt-matcher — Admin-Callables fürs Web-Back-Office (Review-Queue).
 *
 * Alle Callables sind admin-only (Custom-Claim `admin:true`). Sie laufen
 * mit Admin-SDK (bypass Firestore-Rules) → die Web-UI braucht KEINE
 * Rules-Lockerung, nur Login + Claim.
 *
 *  - adminGetQueue     → Review-Queue + Promotion-Queue + Stats
 *  - adminResolveReview→ Mensch wählt Kandidat/Nonproduct → Alias locken + retroaktiv relinken
 *  - adminPromote      → reweapify-Treffer in den Katalog übernehmen (dedupe per gtin) + locken + relinken
 */

'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

const db = admin.firestore();
const { norm, aliasId, enrichCandidates } = require('./matcher');

const REGION = 'europe-west1';
const REWE_DISCOUNTER_ID = 'GzHmnRRIUbbhuG6b4YmE';

function assertAdmin(req) {
  if (!req.auth || !req.auth.token || req.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin-Recht erforderlich.');
  }
}

/**
 * Retroaktiv: alle vergangenen Bon-Zeilen mit (marktSlug, normKey) auf das
 * Ergebnis setzen. Braucht Collection-Group-Index auf purchased_products.normKey
 * — fehlt der, wird best-effort 0 zurückgegeben (Alias ist trotzdem gelockt →
 * künftige Bons korrekt; ein Backlog-Re-Match holt die Vergangenheit nach).
 */
async function relink(marktSlug, normKey, productId, productSource, receiptMatchMeta) {
  try {
    const snap = await db.collectionGroup('purchased_products').where('normKey', '==', normKey).get();
    let n = 0;
    for (const d of snap.docs) {
      const x = d.data();
      if (norm(x.merchantId) !== norm(marktSlug)) continue;
      const upd = productId
        ? { matchStatus: 'matched', productId, productSource: productSource || null, lineType: 'product', matchSource: 'admin', matchConfidence: 1 }
        : { matchStatus: receiptMatchMeta?.lineType || 'nonproduct', productId: null, lineType: receiptMatchMeta?.lineType || 'nonproduct', matchSource: 'admin' };
      await d.ref.set({ ...upd, matchedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (productId) {
        await db.collection('receiptMatches').add({
          receiptId: x.receiptId || null,
          ppId: d.id,
          userId: d.ref.path.split('/')[1],
          productId,
          productSource: productSource || null,
          confidence: 1,
          source: 'admin',
          itemName: x.itemName || null,
          marktSlug: norm(marktSlug),
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      n++;
    }
    return { count: n };
  } catch (e) {
    return { count: 0, error: e.message };
  }
}

exports.adminGetQueue = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const [rev, promo, aliasCnt] = await Promise.all([
    db.collection('receiptReviewQueue').where('status', '==', 'open').limit(150).get(),
    db.collection('promotionQueue').where('status', '==', 'open').limit(150).get(),
    db.collection('receiptAliases').count().get(),
  ]);
  const byHits = (a, b) => (b.hitCount || 0) - (a.hitCount || 0);
  const review = rev.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: null, updatedAt: null })).sort(byHits);
  const promotion = promo.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: null, updatedAt: null })).sort(byHits);

  // Review-Kandidaten mit Bild + Marke/Handelsmarke anreichern (in-place).
  await enrichCandidates(review.flatMap((r) => r.candidates || []));

  // Promotion-Karten: reweapify-Bild dazuladen.
  const rwIds = promotion.map((p) => String(p.reweapifyId)).filter(Boolean);
  if (rwIds.length) {
    const docs = await db.getAll(...rwIds.map((id) => db.collection('reweapify').doc(id)), { fieldMask: ['image', 'productName', 'brandKey'] }).catch(() => []);
    const map = {};
    docs.forEach((d) => (map[d.id] = d.exists ? d.data() : {}));
    promotion.forEach((p) => {
      const x = map[String(p.reweapifyId)] || {};
      p.image = x.image || null;
      p.brand = x.brandKey || null;
    });
  }

  return {
    review,
    promotion,
    stats: { openReview: rev.size, openPromotion: promo.size, aliases: aliasCnt.data().count },
  };
});

exports.adminResolveReview = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { reviewId, productId = null, productSource = null, lineType = null } = req.data || {};
  if (!reviewId) throw new HttpsError('invalid-argument', 'reviewId fehlt');
  const ref = db.collection('receiptReviewQueue').doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Review nicht gefunden');
  const r = snap.data();
  const lt = lineType || (productId ? 'product' : 'nonproduct');
  await db
    .collection('receiptAliases')
    .doc(aliasId(r.marktSlug, r.normKey))
    .set(
      {
        marktSlug: norm(r.marktSlug),
        normKey: r.normKey,
        productId: productId || null,
        productSource: productSource || null,
        lineType: lt,
        confidence: 1,
        resolvedBy: 'admin',
        sampleName: r.sampleName || null,
        votes: FieldValue.increment(1),
        lastSeen: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  const rl = await relink(r.marktSlug, r.normKey, productId || null, productSource, { lineType: lt });
  await ref.set({ status: 'resolved', resolvedBy: 'admin', resolvedProductId: productId || null, resolvedLineType: lt, resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, relinked: rl.count, relinkError: rl.error || null };
});

exports.adminPromote = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { promotionId, approve = true } = req.data || {};
  if (!promotionId) throw new HttpsError('invalid-argument', 'promotionId fehlt');
  const ref = db.collection('promotionQueue').doc(promotionId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Promotion nicht gefunden');
  const p = snap.data();

  if (!approve) {
    await ref.set({ status: 'rejected', resolvedBy: 'admin', resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, rejected: true };
  }

  const rwSnap = await db.collection('reweapify').doc(String(p.reweapifyId)).get();
  const r = rwSnap.exists ? rwSnap.data() : {};
  const gtin = p.gtin || r.gtin || null;
  const targetCol = p.kind === 'noname' ? 'produkte' : 'markenProdukte';

  // Dedupe: existiert schon ein Katalog-Produkt mit dieser EAN?
  let productId = null;
  if (gtin) {
    const dupe = await db.collection(targetCol).where('EANs', 'array-contains', String(gtin)).limit(1).get();
    if (!dupe.empty) productId = dupe.docs[0].id;
  }

  if (!productId) {
    const doc = {
      name: r.productName || p.name || p.sampleName,
      preis: Number.isFinite(Number(r.price_current)) ? Number(r.price_current) : null,
      EANs: gtin ? [String(gtin)] : [],
      bild: r.image || null,
      attr_ingredientStatement: r.attr_ingredientStatement || null,
      bio: r.bio ?? null,
      promotedFrom: String(p.reweapifyId),
      promotedAt: FieldValue.serverTimestamp(),
      needsCuration: true,
      addedby: 'receipt-matcher-promotion',
      created_at: FieldValue.serverTimestamp(),
    };
    for (const [k, v] of Object.entries(r)) if (k.startsWith('nutr_')) doc[k] = v;
    if (r.attr_ingredientStatement) {
      doc.ingredientsSource = 'rewe';
      doc.ingredientsUpdatedAt = FieldValue.serverTimestamp();
    }
    if (doc.nutr_Energie_val !== undefined) {
      doc.nutritionSource = 'rewe';
      doc.nutritionUpdatedAt = FieldValue.serverTimestamp();
    }
    if (targetCol === 'produkte') doc.discounter = db.collection('discounter').doc(REWE_DISCOUNTER_ID);
    const newRef = await db.collection(targetCol).add(doc);
    productId = newRef.id;
  }

  // Alias auf das (nun) Tier-1-Produkt locken + retroaktiv relinken.
  await db
    .collection('receiptAliases')
    .doc(aliasId(p.marktSlug, p.normKey))
    .set(
      {
        marktSlug: norm(p.marktSlug),
        normKey: p.normKey,
        productId,
        productSource: targetCol,
        lineType: 'product',
        confidence: 1,
        resolvedBy: 'admin-promote',
        sampleName: p.sampleName || null,
        votes: FieldValue.increment(1),
        lastSeen: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  const rl = await relink(p.marktSlug, p.normKey, productId, targetCol);
  await ref.set({ status: 'promoted', productId, targetCol, resolvedBy: 'admin', resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, productId, targetCol, relinked: rl.count, relinkError: rl.error || null };
});
