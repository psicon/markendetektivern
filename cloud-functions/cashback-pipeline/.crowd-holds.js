'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const fs = require('fs');
const { rows } = JSON.parse(fs.readFileSync(process.env.ROWS_JSON, 'utf8'));
const verdicts = JSON.parse(fs.readFileSync(process.env.VERDICTS_JSON, 'utf8'));
const md5dups = new Set(); const owner = new Map();
for (const r of rows) for (const m of r.md5s) {
  const prev = owner.get(m.md5);
  if (prev && prev !== r.id) { md5dups.add(r.id); md5dups.add(prev); } else owner.set(m.md5, r.id);
}
(async () => {
  let done = 0;
  for (const r of rows) {
    const reasons = [];
    if (!r.eanOk) reasons.push('ean_fehlt');
    if (!r.name) reasons.push('kein_produktname');
    if (r.dupApproved) reasons.push('produkt_bereits_verguetet');
    if (r.dupPending) reasons.push('doppelt_eingereicht');
    if (md5dups.has(r.id)) reasons.push('bilder_wiederverwendet');
    if (verdicts[r.id]?.echt === false) reasons.push('fotos_unpassend: ' + verdicts[r.id].grund);
    if (!reasons.length) continue; // wurde freigegeben
    const ref = db.doc(`crowd_uploads/${r.id}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().status !== 'pending') return;
      tx.update(ref, {
        holdReasons: reasons,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    done++;
  }
  console.log('Halte-Gründe geschrieben:', done);
  process.exit(0);
})().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
