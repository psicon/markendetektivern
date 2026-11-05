'use strict';
// Ein Topf: Sept-Kampagne wurde am 02.09. mit dem Rest von CloneClone (128890) angelegt. Was CloneClone
// seither ausgezahlt hat, wird von Sept abgezogen; CloneClone auf 0 mit Transfer-Vermerk. DRY_RUN=1.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const DRY = process.env.DRY_RUN === '1';
(async () => {
  const oldRef = db.doc('cashback_campaigns/mai-juni-2026CloneClone'); const newRef = db.doc('cashback_campaigns/produkt-fotos-september-2026');
  const [o, n] = await Promise.all([oldRef.get(), newRef.get()]);
  const oldRem = Number(o.data().budgetRemainingCents) || 0; const newRem = Number(n.data().budgetRemainingCents) || 0;
  const transferredAtCreation = 128890; const paidFromOldSince = transferredAtCreation - oldRem;
  const newAfter = newRem - paidFromOldSince;
  console.log(`CloneClone rem=${oldRem} (seit 02.09. ausgezahlt: ${paidFromOldSince} ct) | Sept rem=${newRem} → ${newAfter}${DRY ? ' (DRY)' : ''}`);
  if (DRY) process.exit(0);
  await db.runTransaction(async (tx) => {
    tx.update(newRef, { budgetRemainingCents: newAfter, budgetNote: `03.09.2026: ${paidFromOldSince} ct abgezogen — von mai-juni-2026CloneClone nach Anlage ausgezahlt (ein Topf)`, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(oldRef, { budgetRemainingCents: 0, budgetTransferredTo: 'produkt-fotos-september-2026', budgetTransferredAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
  console.log('Budgets abgeglichen');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
