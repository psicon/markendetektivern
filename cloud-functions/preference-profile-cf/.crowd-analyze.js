'use strict';
/** Read-only-Analyse aller pending crowd_uploads (86ca33pum-Freigaberunde).
 *  Prüft: Vollständigkeit (7 Schritte), EAN-Format, Namer-OCR, User+EAN-
 *  Doppeleinreichung, Storage-Existenz + md5-Duplikate über Einreichungen. */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7', storageBucket: 'markendetektive-895f7.appspot.com' });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const REQUIRED = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];

async function md5Of(path) {
  try {
    const [m] = await bucket.file(path).getMetadata();
    return { md5: m.md5Hash || null, size: Number(m.size) || 0 };
  } catch {
    return { md5: null, size: -1 }; // -1 = existiert nicht
  }
}

async function lauf() {
  const all = await db.collection('crowd_uploads').get();
  const pending = all.docs.filter((d) => d.data().status === 'pending');
  const nonPending = all.docs.filter((d) => d.data().status !== 'pending');
  console.log(`pending: ${pending.length} | andere: ${nonPending.length}`);

  // User+EAN-Kombis, die schon approved sind (Doppel-Vergütungs-Schutz)
  const approvedKey = new Set(
    nonPending
      .filter((d) => d.data().status === 'approved')
      .map((d) => `${d.data().userId}__${d.data().ean}`),
  );

  const rows = [];
  let done = 0;
  const CONC = 24;
  const queue = [...pending];
  async function worker() {
    for (;;) {
      const d = queue.shift();
      if (!d) return;
      const x = d.data();
      const images = x.images || {};
      const missing = REQUIRED.filter((k) => !images[k]);
      const eanOk = /^\d{8,14}$/.test(String(x.ean || ''));
      const name = String(x.productName || x.productNameOcr || '').trim();
      const conf = Number(x.productNameOcrConfidence ?? NaN);
      const dupKey = `${x.userId}__${x.ean}`;
      // Storage: alle vorhandenen Bilder prüfen (md5 + Existenz)
      const metas = await Promise.all(
        Object.entries(images).map(async ([k, p]) => ({ k, p, ...(await md5Of(String(p))) })),
      );
      const broken = metas.filter((m) => m.size <= 0);
      rows.push({
        id: d.id, uid: x.userId, ean: String(x.ean || ''), name, conf,
        missing, eanOk, broken: broken.map((b) => b.k),
        md5s: metas.filter((m) => m.md5).map((m) => ({ k: m.k, md5: m.md5 })),
        dupApproved: approvedKey.has(dupKey), dupKey,
        createdAt: x.createdAt?.toMillis?.() ?? 0,
      });
      done++;
      if (done % 100 === 0) console.log(`  … ${done}/${pending.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));

  // md5-Duplikate ÜBER Einreichungen hinweg (gleiches Bild in 2 Docs)
  const md5Owner = new Map();
  const md5Dupes = new Map(); // docId → Set(fremde docIds)
  for (const r of rows) {
    for (const m of r.md5s) {
      const prev = md5Owner.get(m.md5);
      if (prev && prev !== r.id) {
        if (!md5Dupes.has(r.id)) md5Dupes.set(r.id, new Set());
        md5Dupes.get(r.id).add(prev);
        if (!md5Dupes.has(prev)) md5Dupes.set(prev, new Set());
        md5Dupes.get(prev).add(r.id);
      } else {
        md5Owner.set(m.md5, r.id);
      }
    }
  }

  // User+EAN-Doppel INNERHALB pending: älteste gewinnt
  const seenPendingKey = new Map();
  rows.sort((a, b) => a.createdAt - b.createdAt);
  for (const r of rows) {
    if (seenPendingKey.has(r.dupKey)) r.dupPending = true;
    else seenPendingKey.set(r.dupKey, r.id);
  }

  let ok = 0;
  const fails = { incomplete: 0, brokenImg: 0, badEan: 0, noName: 0, dupApproved: 0, dupPending: 0, md5dup: 0 };
  const failList = [];
  for (const r of rows) {
    const reasons = [];
    if (r.missing.length) reasons.push(`fehlt:${r.missing.join('+')}`);
    if (r.broken.length) reasons.push(`kaputt:${r.broken.join('+')}`);
    if (!r.eanOk) reasons.push('ean');
    if (!r.name) reasons.push('kein-name');
    if (r.dupApproved) reasons.push('schon-approved(user+ean)');
    if (r.dupPending) reasons.push('doppelt-pending(user+ean)');
    if (md5Dupes.has(r.id)) reasons.push(`md5-dup(${[...md5Dupes.get(r.id)].slice(0, 2).join(',')})`);
    if (!reasons.length) { ok++; continue; }
    if (r.missing.length) fails.incomplete++;
    if (r.broken.length) fails.brokenImg++;
    if (!r.eanOk) fails.badEan++;
    if (!r.name) fails.noName++;
    if (r.dupApproved) fails.dupApproved++;
    if (r.dupPending) fails.dupPending++;
    if (md5Dupes.has(r.id)) fails.md5dup++;
    failList.push(`${r.id} | ${r.name.slice(0, 34) || '(ohne Name)'} | ${reasons.join(' ')}`);
  }
  console.log(`\nFREIGABE-FÄHIG (alle Checks bestanden): ${ok}/${rows.length}`);
  console.log('Ausfall-Gründe (Mehrfachnennung möglich):', JSON.stringify(fails));
  console.log('\nConfidence-Verteilung (Namer-OCR):');
  const buckets = { '≥0.9': 0, '0.7-0.9': 0, '<0.7': 0, 'ohne': 0 };
  rows.forEach((r) => {
    if (!Number.isFinite(r.conf)) buckets['ohne']++;
    else if (r.conf >= 0.9) buckets['≥0.9']++;
    else if (r.conf >= 0.7) buckets['0.7-0.9']++;
    else buckets['<0.7']++;
  });
  console.log(' ', JSON.stringify(buckets));
  console.log('\nNicht freigabefähig (' + failList.length + '):');
  failList.forEach((f) => console.log(' ', f));
  require('fs').writeFileSync(
    process.env.OUT_JSON || '/tmp/crowd-rows-0903.json',
    JSON.stringify({ rows, md5Dupes: [...md5Dupes.keys()] }, null, 0),
  );
  process.exit(0);
}
lauf().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
