const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const ts = v => v && v.toDate ? v.toDate() : null;
(async () => {
  const snap = await db.collectionGroup('cashback_ledger').get();
  console.log('ledger docs:', snap.size);
  const keys=new Set(); snap.docs.slice(0,30).forEach(d=>Object.keys(d.data()).forEach(k=>keys.add(k)));
  console.log('fields:',[...keys].sort().join(','));
  const cut=new Date('2026-06-28T00:00:00Z');
  const byType={}, byType28={}; const earnReceipts=new Set();
  snap.forEach(d=>{const x=d.data(); const c=ts(x.createdAt)||ts(x.timestamp);
    byType[x.type||'(none)']=(byType[x.type||'(none)']||0)+1;
    if(c&&c>=cut){byType28[x.type||'(none)']=(byType28[x.type||'(none)']||0)+1; if(x.type==='earn'&&x.receiptId) earnReceipts.add(x.receiptId);}
  });
  console.log('all types:',JSON.stringify(byType));
  console.log('28d types:',JSON.stringify(byType28));
  console.log('distinct receiptIds mit earn (28d):', earnReceipts.size);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
