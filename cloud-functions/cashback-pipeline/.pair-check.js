'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const [a, b] = await db.getAll(db.doc('receipts/bon_mtfyzitkz5gtcj'), db.doc('receipts/bon_mtfyox0hgb0nga'));
  const A = a.data(), B = b.data();
  for (const f of ['contentHash', 'transactionHash', 'itemsHash', 'bonDate', 'bonTime', 'bonTotalCents', 'status', 'cashbackCents']) console.log(f, A[f] === B[f] ? 'GLEICH' : 'verschieden', String(A[f]).slice(0, 12), String(B[f]).slice(0, 12));
  console.log('merchant', A.merchant?.id, B.merchant?.id, '| items', A.items?.length, B.items?.length, '| created', A.createdAt.toDate().toISOString(), B.createdAt.toDate().toISOString());
  console.log('sameUser', A.userId === B.userId, '| B.duplicateOf', JSON.stringify(B.duplicateOf), '| A.duplicateOf', JSON.stringify(A.duplicateOf));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
