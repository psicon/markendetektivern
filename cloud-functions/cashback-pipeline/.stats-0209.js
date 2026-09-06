'use strict';
/** Live-Stand für die Backlog-Analyse 02.09. (read-only). */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();

async function lauf() {
  const seit = new Date('2026-08-31T22:00:00Z');
  const rs = await db.collection('receipts').where('createdAt', '>=', seit).get();
  const agg = {};
  let noCampaign = 0;
  rs.docs.forEach((d) => {
    const x = d.data();
    const k = `${x.status}${x.rejectReason ? `(${x.rejectReason})` : ''}${x.reviewReason ? `[${x.reviewReason}]` : ''}`;
    agg[k] = (agg[k] || 0) + 1;
    if (x.status === 'no_reward' && x.rejectReason === 'no_active_campaign') noCampaign++;
  });
  console.log(`Bons seit 01.09.: ${rs.size}`);
  Object.entries(agg).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}× ${k}`));
  console.log(`no_active_campaign seit 01.09.: ${noCampaign}`);

  const camps = await db.collection('cashback_campaigns').get();
  camps.docs.forEach((d) => {
    const c = d.data();
    console.log(`Kampagne ${d.id}: active=${c.active} kind=${c.kind || 'receipt'} budget=${c.budgetRemainingCents}/${c.budgetTotalCents}`);
  });

  const cu = await db.collection('crowd_uploads').get();
  const st = {};
  let pendingSeit0901 = 0;
  cu.docs.forEach((d) => {
    const x = d.data();
    st[x.status] = (st[x.status] || 0) + 1;
    const created = x.createdAt?.toDate ? x.createdAt.toDate() : null;
    if (x.status === 'pending' && created && created >= seit) pendingSeit0901++;
  });
  console.log(`crowd_uploads: ${JSON.stringify(st)} | pending seit 01.09.: ${pendingSeit0901}`);

  const rev = await db.collection('receipts').where('status', '==', 'review').get();
  const rr = {};
  rev.docs.forEach((d) => { const r = d.data().reviewReason || '?'; rr[r] = (rr[r] || 0) + 1; });
  console.log(`receipts im Review: ${rev.size} ${JSON.stringify(rr)}`);
  process.exit(0);
}
lauf().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
