'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
async function lauf() {
  const s = await db.collection('receipts').where('repairedAt429', '>', new Date(0)).get();
  const counts = {};
  let pending = 0;
  for (const d of s.docs) {
    const x = d.data();
    const k = x.status + (x.rejectReason ? `(${x.rejectReason})` : '') + (x.zeroReason ? `[${x.zeroReason}]` : '');
    counts[k] = (counts[k] || 0) + 1;
    if (x.status === 'ocr_pending') pending++;
  }
  console.log(`gesamt=${s.size} pending=${pending}`);
  Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}× ${k}`));
  process.exit(pending > 5 ? 1 : 0);
}
lauf().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
