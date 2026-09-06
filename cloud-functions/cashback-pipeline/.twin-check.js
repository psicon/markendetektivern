'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const s = await db.collection('receipts').where('status', '==', 'review').get();
  let cross = 0, self = 0; const ex = [];
  for (const d of s.docs) {
    const x = d.data();
    const hits = new Map();
    for (const [f, h] of [['contentHash', x.contentHash], ['transactionHash', x.transactionHash], ['itemsHash', x.itemsHash]]) {
      if (!h) continue;
      const q = await db.collection('receipts').where(f, '==', h).get();
      q.docs.forEach((o) => { if (o.id !== d.id) hits.set(o.id, o.data()); });
    }
    for (const [oid, o] of hits) {
      if (!['approved', 'no_reward', 'review', 'ocr_pending', 'processing'].includes(o.status)) continue;
      if (o.userId === x.userId) { self++; ex.push(`SELF ${d.id} ~ ${oid}(${o.status})`); }
      else { cross++; ex.push(`CROSS ${d.id} ~ ${oid}(${o.status}) other-user`); }
    }
  }
  console.log({ self, cross }); ex.forEach((e) => console.log(' ', e));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
