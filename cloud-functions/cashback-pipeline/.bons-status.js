'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const since = new Date(Date.now() - 4 * 86400000);
  const s = await db.collection('receipts').where('createdAt', '>=', since).get();
  const byDay = {}; const pend = [];
  s.docs.forEach((d) => {
    const x = d.data(); const day = x.createdAt.toDate().toISOString().slice(0, 10);
    const k = `${x.status}${x.rejectReason ? `(${x.rejectReason})` : ''}${x.reviewReason ? `[${x.reviewReason}]` : ''}`;
    byDay[day] = byDay[day] || {}; byDay[day][k] = (byDay[day][k] || 0) + 1;
    if (['ocr_pending', 'processing', 'uploading'].includes(x.status)) pend.push({ id: d.id, uid: x.userId, created: x.createdAt.toDate().toISOString(), ageMin: Math.round((Date.now() - x.createdAt.toMillis()) / 60000), attempts: x.attempts || 0, lastError: (x.lastError || '').slice(0, 120), hasOcr: !!x.ocr?.parsed, storage: !!x.storage?.path, updated: x.updatedAt?.toDate?.().toISOString() });
  });
  console.log(`receipts letzte 4 Tage: ${s.size}`);
  Object.keys(byDay).sort().forEach((day) => console.log(day, JSON.stringify(byDay[day])));
  console.log(`\nnoch pending: ${pend.length}`);
  pend.sort((a, b) => b.ageMin - a.ageMin).slice(0, 40).forEach((p) => console.log(`  ${p.id} | ${p.created} | ${p.ageMin} min | attempts=${p.attempts} | ocr=${p.hasOcr} | storage=${p.storage} | ${p.lastError}`));
  // Mirror-Docs ohne receipts-Doc (Upload nie beim Server angekommen) — letzte 4 Tage
  const mir = await db.collectionGroup('cashback_status').where('updatedAt', '>=', since).get().catch((e) => ({ docs: [], err: e.message }));
  if (mir.err) console.log('mirror-query:', mir.err.slice(0, 120));
  else {
    const mst = {}; let orphan = 0; const orphanIds = [];
    for (const d of mir.docs) { const x = d.data(); mst[x.status] = (mst[x.status] || 0) + 1; }
    const pendMirror = mir.docs.filter((d) => ['ocr_pending', 'uploading', 'processing'].includes(d.data().status));
    const snaps = pendMirror.length ? await db.getAll(...pendMirror.slice(0, 300).map((d) => db.doc(`receipts/${d.id}`))) : [];
    snaps.forEach((sn, i) => { if (!sn.exists) { orphan++; orphanIds.push(pendMirror[i].id); } });
    console.log(`\nmirror (cashback_status, updatedAt ≥ 4d): ${mir.docs.length} ${JSON.stringify(mst)} | pending im Mirror: ${pendMirror.length} | davon OHNE receipts-Doc: ${orphan} ${orphanIds.slice(0, 8).join(' ')}`);
  }
  const cu = await db.collection('crowd_uploads').where('status', '==', 'pending').get();
  const byD = {}; cu.docs.forEach((d) => { const x = d.data(); const day = (x.createdAt?.toDate?.() || new Date(0)).toISOString().slice(0, 10); byD[day] = (byD[day] || 0) + 1; });
  console.log(`\ncrowd_uploads pending: ${cu.size}; nach Tag:`, JSON.stringify(Object.fromEntries(Object.entries(byD).sort().slice(-14))));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
