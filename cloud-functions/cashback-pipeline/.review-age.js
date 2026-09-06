'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const s = await db.collection('receipts').where('status', '==', 'review').get();
  const byMonth = {}; let cents = 0; let users = new Set();
  s.docs.forEach((d) => {
    const x = d.data();
    const m = x.createdAt.toDate().toISOString().slice(0, 7);
    byMonth[m] = (byMonth[m] || 0) + 1;
    cents += x.cashbackCents || 0;
    users.add(x.userId);
  });
  console.log('review nach Monat:', JSON.stringify(byMonth), '| Nutzer:', users.size, '| Σ cashbackCents laut Doc:', cents);
  const sample = s.docs.slice(0, 3).map((d) => { const x = d.data(); return { id: d.id, created: x.createdAt.toDate().toISOString(), reviewReason: x.reviewReason, conf: x.ocr?.robust?.confidence, campaignId: x.campaignId, cashbackCents: x.cashbackCents }; });
  console.log(JSON.stringify(sample, null, 1));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
