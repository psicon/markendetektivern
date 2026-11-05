// READ-ONLY: Verteilung robust.confidence + DocAI-Swap ueber die letzten N Bons.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const N = Number(process.env.N || 500);
  const snap = await db.collection('receipts').orderBy('createdAt', 'desc').limit(N)
    .select('status', 'reviewReason', 'rejectReason', 'ocr.robust', 'ocr.escalation').get();
  const c = {}, byStatus = {}, swapped = [], nullConfApproved = [];
  for (const d of snap.docs) {
    const r = d.data();
    const conf = r.ocr?.robust?.confidence ?? 'MISSING';
    const st = r.status || '?';
    c[conf] = (c[conf] || 0) + 1;
    byStatus[`${st}|${conf}`] = (byStatus[`${st}|${conf}`] || 0) + 1;
    if (r.ocr?.escalation?.swapped === true) swapped.push({ id: d.id, st, conf, rr: r.reviewReason || null });
    if (conf === 'MISSING' && ['approved', 'paid'].includes(st)) nullConfApproved.push({ id: d.id, st, esc: r.ocr?.escalation?.swapped ?? null });
  }
  console.log('n =', snap.size);
  console.log('confidence:', c);
  console.log('status|conf:', byStatus);
  console.log('docai swapped:', swapped.length, swapped.slice(0, 10));
  console.log('approved OHNE robust.confidence:', nullConfApproved.length, nullConfApproved.slice(0, 10));
  const cap = snap.docs.filter((d) => d.data().ocr?.robust?.cappedReason).length;
  console.log('escalation-capped:', cap);
  const meth = {};
  for (const d of snap.docs) { const m = d.data().ocr?.robust?.method || 'MISSING'; meth[m] = (meth[m] || 0) + 1; }
  console.log('method:', meth);
})().catch((e) => { console.error(e.message); process.exit(1); });
