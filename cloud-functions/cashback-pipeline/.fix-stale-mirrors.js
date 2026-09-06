'use strict';
// Mirror-Docs (users/{uid}/cashback_status) mit App-seitigem Status uploading/upload_failed/ocr_pending,
// deren receipts-Doc längst final ist → Mirror auf den Server-Stand setzen. Read: receipts ≤ 45 Tage.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const DRY = process.env.DRY_RUN === '1';
(async () => {
  const since = new Date(Date.now() - 45 * 86400000);
  const s = await db.collection('receipts').where('createdAt', '>=', since).select('userId').get();
  const uids = [...new Set(s.docs.map((d) => d.get('userId')).filter(Boolean))];
  let fixed = 0; const list = [];
  for (let i = 0; i < uids.length; i += 25) {
    await Promise.all(uids.slice(i, i + 25).map(async (uid) => {
      const q = await db.collection(`users/${uid}/cashback_status`).where('status', 'in', ['uploading', 'upload_failed', 'ocr_pending', 'processing']).get();
      for (const m of q.docs) {
        const r = await db.doc(`receipts/${m.id}`).get();
        if (!r.exists) continue;
        const x = r.data();
        if (['ocr_pending', 'processing'].includes(x.status)) continue;
        const patch = { status: x.status, rejectReason: x.rejectReason ?? null, reviewReason: x.reviewReason ?? null, cashbackCents: x.cashbackCents ?? 0, uploadError: admin.firestore.FieldValue.delete(), mirrorRepairedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        list.push(`${m.id} ${m.data().status} → ${x.status}${x.rejectReason ? '(' + x.rejectReason + ')' : ''}`);
        if (!DRY) await m.ref.set(patch, { merge: true });
        fixed++;
      }
    }));
  }
  console.log(`User: ${uids.length} | Mirror repariert: ${fixed}${DRY ? ' (DRY)' : ''}`); list.forEach((l) => console.log('  ', l));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
