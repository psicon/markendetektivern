'use strict';
// DRY: 163 Review-Bons — Kampagnen, Duplikate (im Set + gegen approved), Same-Day-Konflikte, purchased_products-Existenz
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const cfg = (await db.doc('cashback_config/current').get()).data() || {};
  console.log('config:', JSON.stringify({ campaignsEnabled: cfg.campaignsEnabled, dailyCap: cfg.dailyCap, monthlyMaxCents: cfg.monthlyMaxCents, payoutThresholdCents: cfg.payoutThresholdCents }));
  const s = await db.collection('receipts').where('status', '==', 'review').get();
  const docs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  const byCamp = {}; docs.forEach((x) => { byCamp[x.campaignId] = (byCamp[x.campaignId] || 0) + 1; });
  console.log('Kampagnen:', JSON.stringify(byCamp));
  // Duplikate innerhalb des Sets
  const seenHash = new Map(); const dupInSet = [];
  for (const x of docs) { for (const h of [x.contentHash, x.transactionHash, x.itemsHash].filter(Boolean)) { const k = `${x.userId}|${h}`; if (seenHash.has(k)) { dupInSet.push({ id: x.id, of: seenHash.get(k) }); break; } } for (const h of [x.contentHash, x.transactionHash, x.itemsHash].filter(Boolean)) seenHash.set(`${x.userId}|${h}`, x.id); }
  console.log('Duplikate im Review-Set:', JSON.stringify(dupInSet));
  // Duplikate gegen bereits approved (gleicher User, gleicher contentHash)
  let dupApproved = [];
  for (const x of docs) {
    if (!x.contentHash) continue;
    const q = await db.collection('receipts').where('contentHash', '==', x.contentHash).get();
    const other = q.docs.filter((d) => d.id !== x.id && d.data().status === 'approved');
    if (other.length) dupApproved.push({ id: x.id, approved: other.map((d) => d.id) });
  }
  console.log('Review-Bons mit bereits approved Zwilling:', JSON.stringify(dupApproved));
  // Same-Day: gleicher User + gleiches bonDate im Set ODER schon ein earn mit dem bonDate im Ledger
  const sameDayInSet = []; const key = new Set();
  for (const x of docs) { const k = `${x.userId}|${x.bonDate}`; if (key.has(k)) sameDayInSet.push(x.id); key.add(k); }
  console.log('Same-Day-Konflikte im Set:', sameDayInSet.length, JSON.stringify(sameDayInSet));
  let sameDayLedger = 0;
  for (const x of docs) {
    const l = await db.collection(`users/${x.userId}/cashback_ledger`).where('type', '==', 'earn').where('bonDate', '==', x.bonDate).get();
    if (l.size > 0) sameDayLedger++;
  }
  console.log('Review-Bons, deren User am selben Bon-Tag schon ein earn hat:', sameDayLedger);
  // purchased_products vorhanden?
  let pp = 0;
  for (const x of docs.slice(0, 20)) {
    const q = await db.collection(`users/${x.userId}/purchased_products`).where('receiptId', '==', x.id).limit(1).get();
    if (q.size) pp++;
  }
  console.log('purchased_products vorhanden (Stichprobe 20):', pp);
  // Ledger-Feldnamen prüfen
  const anyLedger = await db.collectionGroup('cashback_ledger').where('type', '==', 'earn').limit(1).get();
  console.log('ledger earn keys:', Object.keys(anyLedger.docs[0].data()).sort().join(', '));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
