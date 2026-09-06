'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const s = await db.collection('receipts').where('status', '==', 'review').get();
  const first = s.docs[0].data();
  console.log('top-level keys:', Object.keys(first).sort().join(', '));
  console.log('ocr keys:', Object.keys(first.ocr || {}).join(', '));
  console.log('ocr.robust:', JSON.stringify(first.ocr?.robust || null).slice(0, 300));
  console.log('reconciliation:', JSON.stringify(first.reconciliation ?? first.ocr?.reconciliation ?? null).slice(0, 300));
  console.log('merchant:', JSON.stringify(first.merchant || null).slice(0, 200));
  console.log('forensics:', JSON.stringify(first.forensics || null).slice(0, 200));
  const agg = { reconOk: 0, merchantKnown: 0, hasCampaign: 0, allClean: 0, dupHash: 0 };
  const hashes = new Map();
  for (const d of s.docs) {
    const x = d.data();
    const rec = x.reconciliation ?? x.ocr?.reconciliation ?? {};
    const reconOk = rec.ok === true || rec.status === 'ok' || (typeof rec.deltaCents === 'number' && Math.abs(rec.deltaCents) <= 200);
    const merchantKnown = !!(x.merchant?.id || x.merchant?.discounterId);
    const hasCampaign = !!x.campaignId;
    if (reconOk) agg.reconOk++;
    if (merchantKnown) agg.merchantKnown++;
    if (hasCampaign) agg.hasCampaign++;
    if (reconOk && merchantKnown && hasCampaign) agg.allClean++;
    const h = x.contentHash || x.forensics?.contentHash;
    if (h) { hashes.set(h, (hashes.get(h) || 0) + 1); }
  }
  agg.dupHash = [...hashes.values()].filter((n) => n > 1).length;
  console.log('review-triage:', JSON.stringify(agg), 'von', s.size);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
