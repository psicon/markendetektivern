'use strict';
/**
 * Reparatur der im 429-Fenster (19.08. ab ~11:40 UTC) fälschlich als
 * "not_a_receipt" abgelehnten Bons.
 *
 * Pro betroffenem Receipt:
 *   1. ocr-Feld löschen (Cache der leeren Fehl-Lesung entfernen)
 *   2. status → 'ocr_pending', rejectReason/attempts/lastError löschen
 *   3. Mirror users/{uid}/cashback_status/{id} → 'ocr_pending'
 *   4. PubSub-Message {cashbackId, uid} auf 'cashback-ocr-jobs' republishen
 *
 * Chronologisch (älteste zuerst), damit bei Doppel-Einreichungen desselben
 * Bons die ERSTE gewinnt und die zweite regulär als Duplikat erkannt wird.
 *
 * DRY_RUN=1 → nur auflisten, nichts schreiben.
 */
const admin = require('firebase-admin');
const { PubSub } = require('@google-cloud/pubsub');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const pubsub = new PubSub({ projectId: 'markendetektive-895f7' });
const DRY = process.env.DRY_RUN === '1';
const FENSTER_START = new Date('2026-08-01T00:00:00Z');

async function lauf() {
  const s = await db
    .collection('receipts')
    .where('createdAt', '>=', FENSTER_START)
    .get();

  const beschaedigt = s.docs
    .filter((d) => {
      const x = d.data();
      const robust = x.ocr && x.ocr.robust ? x.ocr.robust : {};
      // Marker "OCR lief nie": robust.attempts == 0 — trennt Infrastruktur-
      // Ausfall sicher von echten Ablehnungen (Handover 19.08.: alle 53
      // not_a_receipt-Ablehnungen aller Zeiten tragen attempts == 0).
      return (
        x.status === 'rejected' &&
        x.rejectReason === 'not_a_receipt' &&
        (robust.attempts == null || robust.attempts === 0) &&
        (!Array.isArray(x.items) || x.items.length === 0)
      );
    })
    .sort((a, b) => a.data().createdAt.toMillis() - b.data().createdAt.toMillis());

  console.log(`Betroffene Bons: ${beschaedigt.length}${DRY ? ' (DRY RUN — keine Änderung)' : ''}`);

  const topic = pubsub.topic('cashback-ocr-jobs');
  let ok = 0;
  for (const d of beschaedigt) {
    const x = d.data();
    const uid = x.userId;
    const t = x.createdAt.toDate().toISOString().slice(5, 16);
    console.log(`  ${t} | ${d.id.slice(0, 10)}… | uid ${String(uid).slice(0, 8)}…`);
    if (DRY) continue;
    await d.ref.update({
      ocr: admin.firestore.FieldValue.delete(),
      status: 'ocr_pending',
      rejectReason: admin.firestore.FieldValue.delete(),
      attempts: admin.firestore.FieldValue.delete(),
      lastError: admin.firestore.FieldValue.delete(),
      repairedAt429: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.doc(`users/${uid}/cashback_status/${d.id}`).set(
      {
        status: 'ocr_pending',
        receiptId: d.id,
        cashbackCents: 0,
        rejectReason: admin.firestore.FieldValue.delete(),
        isClientPlaceholder: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await topic.publishMessage({
      json: { cashbackId: d.id, uid },
      attributes: { uid, cashbackId: d.id },
    });
    ok++;
    // Sanft: 2s Abstand, damit nicht 56 Gemini-Robust-Läufe gleichzeitig starten
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`\nRepubliziert: ${ok}`);
  process.exit(0);
}
lauf().catch((e) => {
  console.error('ABBRUCH:', e.message);
  process.exit(1);
});
