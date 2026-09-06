'use strict';
/** Nacharbeit 86cb9zuq1 + 86cb7ygjh (02.09.2026), NACH Deploy des Fixes:
 *  (1) Alle bon_too_old-Ablehnungen mit Jahres-Fehllesungs-Fingerabdruck
 *      (Tag+Monat == Upload-Tag, Jahr != Upload-Jahr) neu verarbeiten —
 *      OCR-Cache bleibt (kein Gemini-Call), plausibilizeBonDate korrigiert.
 *  (2) Den Selbststorno-Fall vom 26.08. (bon_mtacsiesox37yb) neu verarbeiten.
 *  DRY_RUN=1 → nur auflisten. */
const admin = require('firebase-admin');
const { PubSub } = require('@google-cloud/pubsub');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const pubsub = new PubSub({ projectId: 'markendetektive-895f7' });
const DRY = process.env.DRY_RUN === '1';
const berlinDay = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

async function lauf() {
  const s = await db.collection('receipts').where('rejectReason', '==', 'bon_too_old').get();
  const kandidaten = s.docs.filter((d) => {
    const x = d.data();
    const bd = x.ocr?.parsed?.bonDate;
    if (x.status !== 'rejected' || typeof bd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(bd)) return false;
    const up = berlinDay(x.createdAt.toDate());
    return bd.slice(5) === up.slice(5) && bd.slice(0, 4) !== up.slice(0, 4);
  });
  const extra = await db.doc('receipts/bon_mtacsiesox37yb').get();
  const liste = [...kandidaten];
  if (extra.exists && extra.data().status === 'no_reward') liste.push(extra);
  console.log(`Jahres-Fehllesungen: ${kandidaten.length} | + Selbststorno-Fall: ${extra.exists ? 1 : 0} | gesamt ${liste.length}${DRY ? ' (DRY RUN)' : ''}`);
  liste.forEach((d) => {
    const x = d.data();
    console.log(`  ${d.id} | bonDate ${x.ocr?.parsed?.bonDate} | upload ${berlinDay(x.createdAt.toDate())} | ${x.status} ${x.rejectReason || ''}`);
  });
  if (DRY) process.exit(0);
  const topic = pubsub.topic('cashback-ocr-jobs');
  let n = 0;
  for (const d of liste) {
    const x = d.data();
    // OCR-Cache BEHALTEN (billig; die Datumskorrektur läuft in index.js
    // nach dem Cache-Read). Nur Status/Reason zurücksetzen + republishen.
    await d.ref.update({
      status: 'ocr_pending',
      rejectReason: admin.firestore.FieldValue.delete(),
      attempts: admin.firestore.FieldValue.delete(),
      repairedAt0209: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.doc(`users/${x.userId}/cashback_status/${d.id}`).set(
      { status: 'ocr_pending', rejectReason: admin.firestore.FieldValue.delete(), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    await topic.publishMessage({ json: { cashbackId: d.id, uid: x.userId }, attributes: { uid: x.userId, cashbackId: d.id } });
    n++;
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.log('Republiziert:', n);
  process.exit(0);
}
lauf().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
