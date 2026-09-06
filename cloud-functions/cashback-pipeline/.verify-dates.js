'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const s = await db.collection('receipts').where('repairedAt0209', '>', new Date(0)).get();
  const by = {}; let pending = 0, corrected = 0, approvedCents = 0;
  for (const d of s.docs) {
    const x = d.data();
    const k = x.status + (x.rejectReason ? `(${x.rejectReason})` : '') + (x.reviewReason ? `[${x.reviewReason}]` : '');
    by[k] = (by[k] || 0) + 1;
    if (x.status === 'ocr_pending') pending++;
    if (x.bonDateCorrection) corrected++;
    if (x.status === 'approved') approvedCents += x.cashbackCents || 0;
  }
  console.log(`gesamt=${s.size} pending=${pending} korrigiert=${corrected} approved-Cents=${approvedCents}`);
  Object.entries(by).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}× ${k}`));
  // Selbststorno-Fall: Ledger prüfen
  const led = await db.collection('users/W3sl3UXjQ7bynDkJtk2twm7QIoh2/cashback_ledger').where('receiptId', '==', 'bon_mtacsiesox37yb').get();
  const net = led.docs.reduce((a, d) => a + (d.data().type === 'earn' ? 1 : -1) * (d.data().cents || 0), 0);
  const r = await db.doc('receipts/bon_mtacsiesox37yb').get();
  console.log(`Selbststorno-Fall: status=${r.data().status} ${r.data().rejectReason || ''} | Ledger netto=${net} ct (${led.size} Einträge)`);
  process.exit(pending > 0 ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
