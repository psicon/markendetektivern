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

// reweapify-Produkt in den Katalog übernehmen (dedupe per EAN). Marke vs.
// Eigenmarke wird GETRENNT: eigenmarke → produkte (NoName, discounter=REWE),
// sonst → markenProdukte (Marke). Gibt { productId, targetCol } zurück.
async function promoteReweapify(reweapifyId, kindHint, gtinHint) {
  const rwSnap = await db.collection('reweapify').doc(String(reweapifyId)).get();
  const r = rwSnap.exists ? rwSnap.data() : {};
  const gtin = gtinHint || r.gtin || null;
  let kind = kindHint;
  if (!kind) {
    const bc = String(r.brand_classification || '').toLowerCase();
    kind = bc === 'eigenmarke' ? 'noname' : 'marke';
  }
  const targetCol = kind === 'noname' ? 'produkte' : 'markenProdukte';

  let productId = null;
  if (gtin) {
    const dupe = await db.collection(targetCol).where('EANs', 'array-contains', String(gtin)).limit(1).get();
    if (!dupe.empty) productId = dupe.docs[0].id;
  }
  if (!productId) {
    const doc = {
      name: r.productName || null,
      preis: Number.isFinite(Number(r.price_current)) ? Number(r.price_current) : null,
      EANs: gtin ? [String(gtin)] : [],
      bild: r.image || null,
      attr_ingredientStatement: r.attr_ingredientStatement || null,
      bio: r.bio ?? null,
      promotedFrom: String(reweapifyId),
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
  return { productId, targetCol };
}

// Falls eine Admin-Auswahl ein reweapify-Produkt ist (productSource 'reweapify'),
// erst übernehmen → echte produkte/markenProdukte-Id zurückgeben.
async function resolveSelection(productId, productSource) {
  if (productId && productSource === 'reweapify') {
    const pr = await promoteReweapify(productId);
    return { productId: pr.productId, productSource: pr.targetCol, promoted: true };
  }
  return { productId: productId || null, productSource: productSource || null, promoted: false };
}

// Discounter-Map (norm(name) → {name,land}) zum Auflösen des genauen Markts.
let _discMap = null;
async function discMap() {
  if (_discMap) return _discMap;
  const m = {};
  const s = await db.collection('discounter').get();
  s.forEach((d) => {
    const x = d.data();
    m[norm(x.name)] = { name: x.name || null, land: x.land || null };
  });
  _discMap = m;
  return _discMap;
}
function resolveMarket(marktSlug, bonMarket, dm) {
  if (bonMarket && bonMarket.name) return { name: bonMarket.name, land: bonMarket.land || null, raw: bonMarket.raw || null };
  const r = (dm && dm[norm(marktSlug)]) || {};
  return { name: r.name || marktSlug || null, land: r.land || null, raw: (bonMarket && bonMarket.raw) || null };
}

// EANs mehrerer "Duplikat"-Produkte ins Hauptprodukt mergen (arrayUnion). Die
// Duplikate werden mit mergedInto markiert. reweapify-Quellen liefern ihre gtin.
async function mergeEansIntoMain(mainSource, mainId, mergeList) {
  if (!mainSource || !mainId || !Array.isArray(mergeList) || !mergeList.length) return 0;
  const eans = [];
  for (const mp of mergeList) {
    if (!mp || !mp.id || !mp.source || (String(mp.id) === String(mainId) && mp.source === mainSource)) continue;
    try {
      const d = await db.collection(mp.source).doc(String(mp.id)).get();
      if (!d.exists) continue;
      const x = d.data();
      if (mp.source === 'reweapify') {
        if (x.gtin) eans.push(String(x.gtin));
      } else if (Array.isArray(x.EANs)) {
        eans.push(...x.EANs.map(String));
        await d.ref.set({ mergedInto: String(mainId), mergedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
      } else if (x.gtin) {
        eans.push(String(x.gtin));
      }
    } catch (e) {
      /* ignore */
    }
  }
  const uniq = [...new Set(eans)].filter(Boolean);
  if (uniq.length) await db.collection(mainSource).doc(String(mainId)).set({ EANs: FieldValue.arrayUnion(...uniq) }, { merge: true });
  return uniq.length;
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

  const dm = await discMap();
  review.forEach((r) => (r.market = resolveMarket(r.marktSlug, r.market, dm)));
  promotion.forEach((p) => (p.market = resolveMarket(p.marktSlug, p.market, dm)));

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
  const { reviewId, productId = null, productSource = null, lineType = null, mergeEanFrom = [] } = req.data || {};
  if (!reviewId) throw new HttpsError('invalid-argument', 'reviewId fehlt');
  const ref = db.collection('receiptReviewQueue').doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Review nicht gefunden');
  const r = snap.data();
  const sel = await resolveSelection(productId, productSource); // reweapify → erst übernehmen
  const lt = lineType || (sel.productId ? 'product' : 'nonproduct');
  await db
    .collection('receiptAliases')
    .doc(aliasId(r.marktSlug, r.normKey))
    .set(
      {
        marktSlug: norm(r.marktSlug),
        normKey: r.normKey,
        productId: sel.productId,
        productSource: sel.productSource,
        lineType: lt,
        confidence: 1,
        resolvedBy: 'admin',
        sampleName: r.sampleName || null,
        votes: FieldValue.increment(1),
        lastSeen: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  const rl = await relink(r.marktSlug, r.normKey, sel.productId, sel.productSource, { lineType: lt });
  const mergedEans = sel.productId ? await mergeEansIntoMain(sel.productSource, sel.productId, mergeEanFrom) : 0;
  await ref.set({ status: 'resolved', resolvedBy: 'admin', resolvedProductId: sel.productId, resolvedLineType: lt, resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, relinked: rl.count, relinkError: rl.error || null, promoted: sel.promoted, mergedEans };
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

  const { productId, targetCol } = await promoteReweapify(p.reweapifyId, p.kind, p.gtin);

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

// ─── Zugeordnet (Auto-Matches) anzeigen + korrigieren ────────────────
// Alle gelockten Produkt-Aliase (= auto-/manuell-gematchte Bon-Strings) mit
// aufgelöstem Produkt (Bild/Name/Marke). Zum Prüfen + Korrigieren der KI.
exports.adminGetMatched = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const snap = await db.collection('receiptAliases').where('lineType', '==', 'product').limit(500).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.productId);
  items.sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const top = items.slice(0, 250);
  const refs = top.map((a) => db.collection('productEmbeddings').doc(String(a.productId)));
  const pe = refs.length ? await db.getAll(...refs) : [];
  const peMap = {};
  pe.forEach((d) => (peMap[d.id] = d.exists ? d.data() : {}));
  const cands = top.map((a) => {
    const x = peMap[String(a.productId)] || {};
    return { id: String(a.productId), source: a.productSource || x.sourceCollection || null, name: x.name || null, type: x.type || null, brand: x.brand || null, handelsmarke: x.handelsmarke || null, size: x.size || null, preis: x.preis ?? null, manufacturer: x.manufacturer || null, gtin: x.gtin || null };
  });
  await enrichCandidates(cands);
  const dm = await discMap();
  return {
    matched: top.map((a, i) => ({ aliasId: a.id, sampleName: a.sampleName || null, marktSlug: a.marktSlug || null, market: resolveMarket(a.marktSlug, a.bon && a.bon.market, dm), confidence: a.confidence ?? null, resolvedBy: a.resolvedBy || null, votes: a.votes || 0, bon: a.bon || null, product: cands[i] })),
    total: items.length,
  };
});

// Auto-Match korrigieren: Alias auf ein (anderes) Produkt setzen oder als
// "kein Produkt" markieren + alle betroffenen Bons rückwirkend relinken.
exports.adminCorrectMatch = onCall({ region: REGION }, async (req) => {
  assertAdmin(req);
  const { aliasId: aid, productId = null, productSource = null, lineType = null, mergeEanFrom = [] } = req.data || {};
  if (!aid) throw new HttpsError('invalid-argument', 'aliasId fehlt');
  const ref = db.collection('receiptAliases').doc(aid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Alias nicht gefunden');
  const a = snap.data();
  const sel = await resolveSelection(productId, productSource); // reweapify → erst übernehmen
  const lt = lineType || (sel.productId ? 'product' : 'nonproduct');
  await ref.set({ productId: sel.productId, productSource: sel.productSource, lineType: lt, confidence: 1, resolvedBy: 'admin', lastSeen: FieldValue.serverTimestamp() }, { merge: true });
  const rl = await relink(a.marktSlug, a.normKey, sel.productId, sel.productSource, { lineType: lt });
  const mergedEans = sel.productId ? await mergeEansIntoMain(sel.productSource, sel.productId, mergeEanFrom) : 0;
  return { ok: true, relinked: rl.count, relinkError: rl.error || null, promoted: sel.promoted, mergedEans };
});
