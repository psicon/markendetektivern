// Backfill Filialadresse (05.09.2026): receipts.store + Mirror storeCity/storeZip
// + purchased_products.storeZip/storeCity/storeStreet — aus der GECACHTEN OCR
// (merchantSubtitle / storeAddress), ohne Gemini-Call. Idempotent.
//
//   node .backfill-store-address.js            → DRY_RUN (liest alles, zählt Kandidaten, schreibt nichts)
//   RUN=1 node .backfill-store-address.js      → schreibt
//   VERIFY=1 node .backfill-store-address.js   → prüft receipts.store UND Mirror gegen die Ableitung (exit 1 bei Abweichung)
//
// Regeln (Rollen-Review 05.09.2026):
// - Besitzer steht auf receipts als `userId` (enqueueCashback), `uid` nur Altlast.
//   Fehlt der Besitzer, wird das gezählt und der Lauf endet mit exit 1.
// - receipts.updatedAt und cashback_status.updatedAt werden NICHT berührt — die
//   App sortiert die Bon-Liste nach updatedAt; ein Backfill darf die Reihenfolge
//   des Nutzers nicht umwerfen. Mirror nur per update() (kein set/merge): fehlt
//   der Mirror (gelöschter Nutzer), wird keiner erzeugt.
// - Reihenfolge je Bon: erst Mirror + purchased_products, ZULETZT receipts.store.
//   Bricht der Lauf dazwischen ab, fehlt `store` noch → der nächste Lauf sieht
//   den Bon wieder. Zusätzlich wird der Mirror IMMER mitverglichen, nicht nur
//   receipts.store (kein stilles Überspringen halb geschriebener Bons).
// - Exit-Code ≠ 0 bei endgültig gescheiterten Writes (nach 3 Versuchen) oder
//   fehlendem Besitzer; gescheiterte Pfade werden ausgegeben.
'use strict';
const admin = require('firebase-admin');
const { deriveStoreAddress } = require('./lib/storeAddress');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const RUN = process.env.RUN === '1';
const VERIFY = process.env.VERIFY === '1';

// Kanonischer Vergleich (Firestore liefert Map-Keys sortiert, unsere Ableitung
// in Einfügereihenfolge — JSON.stringify direkt wäre nie gleich).
function canon(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
const same = (a, b) => canon(a ?? null) === canon(b ?? null);

(async () => {
  const st = {
    receipts: 0, derived: 0, complete: 0, noOwner: 0,
    receiptWrites: 0, mirrorWrites: 0, mirrorMissing: 0, ppReads: 0, ppWrites: 0, skippedSame: 0,
    verifyReceiptMismatch: 0, verifyMirrorMismatch: 0, verifyPpMismatch: 0, errors: 0, failedPaths: [], bySource: {},
  };
  const writer = db.bulkWriter();
  writer.onWriteError((err) => {
    const retry = err.failedAttempts < 3;
    if (!retry) {
      st.errors++;
      st.failedPaths.push(err.documentRef.path);
      console.error('write-failed', err.documentRef.path, err.message);
    }
    return retry;
  });
  const mismatches = [];
  let last = null;
  try {
    for (;;) {
      let q = db.collection('receipts').orderBy(admin.firestore.FieldPath.documentId()).limit(400);
      if (last) q = q.startAfter(last);
      const snap = await q
        .select('userId', 'uid', 'ocr.parsed.merchant', 'ocr.parsed.merchantSubtitle', 'ocr.parsed.storeAddress', 'ocr.parsed.bonCountry', 'merchant.land', 'store', 'status')
        .get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        st.receipts++;
        const x = d.data();
        const parsed = x.ocr?.parsed;
        const target = parsed ? deriveStoreAddress(parsed, x.merchant?.land ?? null) : null;
        if (target) {
          st.derived++;
          if (target.complete) st.complete++;
          st.bySource[target.source] = (st.bySource[target.source] || 0) + 1;
        }
        const owner = x.userId || x.uid || null;
        if (!owner) st.noOwner++;
        const wantMirror = { storeCity: target?.city ?? null, storeZip: target?.zip ?? null };
        const wantPp = { storeZip: target?.zip ?? null, storeCity: target?.city ?? null, storeStreet: target?.street ?? null };

        // Mirror + purchased_products IMMER lesen (auch DRY_RUN/VERIFY), damit
        // Kandidaten sichtbar sind und ein halb geschriebener Bon nie übersprungen wird.
        let mirrorRef = null;
        let mirrorUpdate = null;
        const ppUpdates = [];
        if (owner) {
          mirrorRef = db.doc(`users/${owner}/cashback_status/${d.id}`);
          const mirror = await mirrorRef.get();
          if (mirror.exists) {
            const m = mirror.data();
            if (m.storeCity !== wantMirror.storeCity || m.storeZip !== wantMirror.storeZip) mirrorUpdate = wantMirror;
          } else {
            st.mirrorMissing++;
          }
          const pp = await db.collection(`users/${owner}/purchased_products`).where('receiptId', '==', d.id).select('storeZip', 'storeCity', 'storeStreet').get();
          st.ppReads += pp.size;
          for (const p of pp.docs) {
            const cur = p.data();
            if (cur.storeZip === wantPp.storeZip && cur.storeCity === wantPp.storeCity && cur.storeStreet === wantPp.storeStreet) continue;
            ppUpdates.push(p.ref);
          }
        }
        const receiptSame = same(x.store ?? null, target) || (!target && !('store' in x));

        if (VERIFY) {
          if (!receiptSame) {
            st.verifyReceiptMismatch++;
            if (mismatches.length < 10) mismatches.push({ id: d.id, have: x.store ?? null, want: target });
          }
          if (mirrorUpdate) st.verifyMirrorMismatch++;
          if (ppUpdates.length) st.verifyPpMismatch++;
          continue;
        }
        if (receiptSame && !mirrorUpdate && ppUpdates.length === 0) {
          st.skippedSame++;
          continue;
        }
        if (mirrorUpdate) st.mirrorWrites++;
        st.ppWrites += ppUpdates.length;
        if (!receiptSame) st.receiptWrites++;
        if (!RUN) continue;
        if (mirrorUpdate) writer.update(mirrorRef, mirrorUpdate);
        for (const ref of ppUpdates) writer.update(ref, wantPp);
        if (!receiptSame) writer.update(d.ref, { store: target });
      }
      last = snap.docs[snap.docs.length - 1];
      if (st.receipts % 2000 === 0) console.log('progress', JSON.stringify({ ...st, failedPaths: st.failedPaths.length }));
    }
  } finally {
    await writer.close();
    console.log(JSON.stringify({ mode: VERIFY ? 'VERIFY' : RUN ? 'RUN' : 'DRY_RUN', ...st }, null, 1));
  }
  mismatches.forEach((m) => console.log('MISMATCH', JSON.stringify(m)));
  const bad = st.errors > 0 || st.noOwner > 0 || (VERIFY && (st.verifyReceiptMismatch > 0 || st.verifyMirrorMismatch > 0 || st.verifyPpMismatch > 0));
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
