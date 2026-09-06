'use strict';
// Nachkontrolle Money-Ops 02.09.: Lauf A (.review-approve.result.json) + Lauf B (.repair-campaign.ids.json)
const admin = require('firebase-admin');
const fs = require('fs');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const getAll = async (refs) => { const out = []; for (let i = 0; i < refs.length; i += 100) out.push(...(await db.getAll(...refs.slice(i, i + 100)))); return out; };
async function netEarn(uid, rid) {
  const col = db.collection(`users/${uid}/cashback_ledger`);
  const [e, r] = await Promise.all([col.where('receiptId', '==', rid).where('type', '==', 'earn').get(), col.where('receiptId', '==', rid).where('type', '==', 'reverse').get()]);
  const sum = (s) => s.docs.reduce((a, d) => a + (d.data().cents || 0), 0);
  return sum(e) - sum(r);
}
(async () => {
  const A = JSON.parse(fs.readFileSync('.review-approve.result.json', 'utf8'));
  const probs = []; let okA = 0; let credA = 0; let ledgerA = 0;
  const byOutcome = {};
  for (const r of A.results) {
    const key = r.res ? `${r.res.status}${r.res.capReason ? `(${r.res.capReason})` : ''}${r.res.rejectReason ? `(${r.res.rejectReason})` : ''}` : `skip:${r.plan.reason.split(':')[0]}`;
    byOutcome[key] = (byOutcome[key] || 0) + 1;
    if (!r.res) continue;
    const [snap, mirror] = await getAll([db.doc(`receipts/${r.id}`), db.doc(`users/${r.uid}/cashback_status/${r.id}`)]);
    const x = snap.data() || {}; const m = mirror.data() || {};
    const net = await netEarn(r.uid, r.id);
    const exp = r.res.status;
    if (x.status !== exp) probs.push(`${r.id}: receipt.status ${x.status} ≠ ${exp}`);
    if (m.status !== exp) probs.push(`${r.id}: mirror.status ${m.status} ≠ ${exp}`);
    if (exp === 'approved') { credA += r.res.creditedCents || 0; ledgerA += net; if (net !== (r.res.creditedCents || 0)) probs.push(`${r.id}: ledger net ${net} ≠ credited ${r.res.creditedCents}`); }
    else if (net !== 0) probs.push(`${r.id}: ${exp} aber ledger net ${net}`);
    if (exp === 'approved' || exp === 'no_reward') {
      const pp = await db.collection(`users/${r.uid}/purchased_products`).where('receiptId', '==', r.id).limit(1).get();
      if (!pp.size) probs.push(`${r.id}: keine purchased_products`);
      else if (pp.docs[0].data().backfilled !== true) probs.push(`${r.id}: purchased_products ohne backfilled`);
    }
    okA++;
  }
  console.log('Lauf A Ergebnisse:', JSON.stringify(byOutcome));
  console.log(`Lauf A geprüft: ${okA} | credited lt. Resolver ${credA} ct | Ledger netto ${ledgerA} ct`);
  // Journey-Closure-Check: kein einkaufswagen-Item darf per receiptId eines Review-Bons abgehakt sein
  let closed = 0;
  for (const r of A.results.filter((r) => r.res && (r.res.status === 'approved' || r.res.status === 'no_reward'))) {
    const q = await db.collection(`users/${r.uid}/einkaufswagen`).where('receiptId', '==', r.id).limit(1).get();
    if (q.size) { closed++; probs.push(`${r.id}: einkaufswagen-Item per Review-Bon abgehakt!`); }
  }
  console.log(`Journey-Closure durch Review-Bons: ${closed}`);
  // Lauf B
  const idsB = JSON.parse(fs.readFileSync('.repair-campaign.ids.json', 'utf8'));
  const snapsB = await getAll(idsB.map((id) => db.doc(`receipts/${id}`)));
  const tB = {}; let credB = 0; let ledgerB = 0; let noCamp = 0;
  for (const sn of snapsB) {
    const x = sn.data() || {};
    const k = `${x.status}${x.rejectReason ? `(${x.rejectReason})` : ''}${x.reviewReason ? `[${x.reviewReason}]` : ''}`;
    tB[k] = (tB[k] || 0) + 1;
    if (x.campaignId !== 'september-2026') noCamp++;
    const net = await netEarn(x.userId, sn.id);
    if (x.status === 'approved') { credB += x.cashbackCents || 0; ledgerB += net; if (net !== (x.cashbackCents || 0)) probs.push(`B ${sn.id}: ledger net ${net} ≠ ${x.cashbackCents}`); }
    else if (net !== 0) probs.push(`B ${sn.id}: ${x.status} aber ledger net ${net}`);
  }
  console.log('Lauf B Stand:', JSON.stringify(tB), `| campaignId≠september: ${noCamp} | approved ${credB} ct | Ledger netto ${ledgerB} ct`);
  // Kampagnen-Budgets
  for (const cid of ['mai-juni-2026', 'juli-august-2026', 'september-2026']) {
    const c = (await db.doc(`cashback_campaigns/${cid}`).get()).data();
    console.log(`Budget ${cid}: ${c.budgetRemainingCents}/${c.budgetTotalCents}`);
  }
  const rev = await db.collection('receipts').where('status', '==', 'review').get();
  const rr = {}; rev.docs.forEach((d) => { const r = d.data().reviewReason || '?'; rr[r] = (rr[r] || 0) + 1; });
  console.log(`Noch im Review: ${rev.size} ${JSON.stringify(rr)}`);
  console.log(`PROBLEME: ${probs.length}`); probs.slice(0, 30).forEach((p) => console.log('  !', p));
  process.exit(probs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
