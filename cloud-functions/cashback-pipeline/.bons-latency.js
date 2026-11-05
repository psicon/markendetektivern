'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
(async () => {
  const since = new Date(Date.now() - 4 * 86400000);
  const s = await db.collection('receipts').where('createdAt', '>=', since).get();
  const lat = {}; const uids = new Set(); const stillPending = [];
  s.docs.forEach((d) => {
    const x = d.data(); uids.add(x.userId);
    const day = x.createdAt.toDate().toISOString().slice(0, 10);
    if (x.updatedAt?.toMillis && !['ocr_pending', 'processing'].includes(x.status) && !x.repairedAt0209b && !x.repairedAt0209) {
      (lat[day] = lat[day] || []).push((x.updatedAt.toMillis() - x.createdAt.toMillis()) / 60000);
    }
    if (['ocr_pending', 'processing'].includes(x.status)) stillPending.push({ id: d.id, ageMin: Math.round((Date.now() - x.createdAt.toMillis()) / 60000), attempts: x.attempts || 0, lastError: x.lastError || '' });
  });
  console.log('Verarbeitungsdauer createdAt→updatedAt (min), pro Tag: p50 / p90 / max / n');
  Object.keys(lat).sort().forEach((d) => console.log(`  ${d}: ${pct(lat[d], 0.5).toFixed(1)} / ${pct(lat[d], 0.9).toFixed(1)} / ${Math.max(...lat[d]).toFixed(0)} / ${lat[d].length}`));
  console.log('jetzt pending:', JSON.stringify(stillPending));
  // Mirror-Waisen: für alle User mit Bons in den letzten 4 Tagen deren cashback_status mit pending-artigem Status lesen
  let orphans = []; let stale = []; let checkedUsers = 0; let mirrorPending = 0;
  const arr = [...uids];
  for (let i = 0; i < arr.length; i += 20) {
    await Promise.all(arr.slice(i, i + 20).map(async (uid) => {
      checkedUsers++;
      const q = await db.collection(`users/${uid}/cashback_status`).where('status', 'in', ['uploading', 'upload_failed', 'ocr_pending', 'processing', 'ocr_done']).get();
      for (const m of q.docs) {
        mirrorPending++;
        const r = await db.doc(`receipts/${m.id}`).get();
        const md = m.data();
        const upd = md.updatedAt?.toDate?.()?.toISOString() || '?';
        if (!r.exists) orphans.push({ id: m.id, uid: uid.slice(0, 6), status: md.status, updated: upd, err: (md.uploadError || '').slice(0, 80) });
        else if (!['ocr_pending', 'processing'].includes(r.data().status)) stale.push({ id: m.id, mirror: md.status, receipt: r.data().status, updated: upd });
      }
    }));
  }
  console.log(`\nUser geprüft: ${checkedUsers} | Mirror-Docs mit pending-artigem Status: ${mirrorPending}`);
  console.log(`Waisen (Mirror ohne receipts-Doc): ${orphans.length}`); orphans.slice(0, 25).forEach((o) => console.log('  ', JSON.stringify(o)));
  console.log(`Veraltet (Mirror pending, Receipt final): ${stale.length}`); stale.slice(0, 15).forEach((o) => console.log('  ', JSON.stringify(o)));
  const byStatus = {}; orphans.forEach((o) => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
  console.log('Waisen nach Status:', JSON.stringify(byStatus));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
