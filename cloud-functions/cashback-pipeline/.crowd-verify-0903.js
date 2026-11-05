'use strict';
// Nachkontrolle Runde 03.09.: approved/rejected heute, Ledger-Buchungen crowd_<id>, rewardSkipped, Budgets
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const since = Date.parse('2026-09-03T00:00:00Z');
  const all = await db.collection('crowd_uploads').get();
  const st = {}; all.docs.forEach((d) => { st[d.data().status] = (st[d.data().status] || 0) + 1; });
  console.log('crowd_uploads gesamt:', JSON.stringify(st));
  const today = all.docs.filter((d) => d.data().reviewedAt?.toMillis?.() >= since);
  const appr = today.filter((d) => d.data().status === 'approved');
  const rej = today.filter((d) => d.data().status === 'rejected');
  const rr = {}; rej.forEach((d) => { const r = d.data().rejectReason || '?'; rr[r] = (rr[r] || 0) + 1; });
  console.log(`heute reviewed: ${today.length} | approved ${appr.length} | rejected ${rej.length} ${JSON.stringify(rr)}`);
  let ledger = 0, skipped = 0, cents = 0, missing = []; const sk = {};
  for (const d of appr) {
    const x = d.data();
    if (x.rewardSkipped) { skipped++; sk[x.rewardSkippedReason || '?'] = (sk[x.rewardSkippedReason || '?'] || 0) + 1; continue; }
    const l = await db.doc(`users/${x.userId}/cashback_ledger/crowd_${d.id}`).get();
    if (l.exists) { ledger++; cents += l.data().cents || 0; } else missing.push(d.id);
  }
  console.log(`Ledger-Buchungen: ${ledger} (${cents} ct) | rewardSkipped: ${skipped} ${JSON.stringify(sk)} | approved ohne Buchung und ohne Skip: ${missing.length} ${missing.slice(0, 5).join(' ')}`);
  for (const cid of ['mai-juni-2026CloneClone', 'produkt-fotos-september-2026']) {
    const c = (await db.doc(`cashback_campaigns/${cid}`).get()).data();
    console.log(`Budget ${cid}: ${c.budgetRemainingCents}/${c.budgetTotalCents} active=${c.active}`);
  }
  const hold = all.docs.filter((d) => d.data().status === 'pending');
  const hr = {}; hold.forEach((d) => { const r = (d.data().holdReasons || ['?'])[0]; hr[r] = (hr[r] || 0) + 1; });
  console.log(`noch pending: ${hold.length} ${JSON.stringify(hr)}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
