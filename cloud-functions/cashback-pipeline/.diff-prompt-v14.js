// Item-Diff für die 2 Bons, deren Einzel-Lesung (v1.4) nicht der gecachten
// Konsens-Lesung (v1.3) entsprach: 2 Lesungen je Bon → ist es Prompt-Drift
// oder normales Lese-Rauschen, das der Robust-Wrapper ohnehin ausgleicht?
'use strict';
const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const { extractReceipt } = require('./lib/ocr');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const storage = new Storage({ projectId: 'markendetektive-895f7' });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
(async () => {
  for (const [m, land] of [['penny','DE'],['hofer','AT']]) {
    const q = await db.collection('receipts').where('status','==','approved').where('merchant.id','==',m).limit(1).get();
    const d = q.docs[0]; const x = d.data();
    const [bytes] = await storage.bucket(x.storage.bucket).file(x.storage.path).download();
    const cached = x.ocr.parsed.items.map(i => [i.name, i.priceCents]);
    for (let k = 0; k < 2; k++) {
      const r = await extractReceipt(bytes, x.storage.contentType || 'image/jpeg');
      const items = r.parsed.items.map(i => [i.name, i.priceCents]);
      const diffs = [];
      for (let i = 0; i < Math.max(items.length, cached.length); i++) {
        const a = cached[i] || ['—', null], b = items[i] || ['—', null];
        if (norm(a[0]) !== norm(b[0]) || a[1] !== b[1]) diffs.push(`${i}: cached "${a[0]}" ${a[1]}  vs new "${b[0]}" ${b[1]}`);
      }
      console.log(m, 'read', k + 1, 'items', items.length, 'vs cached', cached.length, 'total', r.parsed.totalCents, 'vs', x.ocr.parsed.totalCents, 'robust:', x.ocr.robust?.method);
      diffs.forEach(l => console.log('   ', l));
    }
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
