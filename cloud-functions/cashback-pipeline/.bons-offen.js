'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const TAG = 86400000;
(async () => {
  const snap = await db.collection('receipts').where('status', '==', 'review').get();
  const rows = snap.docs.map((d) => { const x = d.data(); return {
    id: d.id, uid: x.userId, grund: x.reviewReason || '?', markt: x.merchant?.name || x.merchantName || null,
    bonDate: x.bonDate || null, total: x.totalCents ?? null,
    items: Array.isArray(x.items) ? x.items.length : 0, eligible: x.eligibleItemCount ?? null,
    conf: x.ocr?.robust?.confidence ?? null, attempts: x.ocr?.robust?.attempts ?? null,
    reconOk: x.ocr?.reconciliation?.ok ?? null, delta: x.ocr?.reconciliation?.deltaCents ?? null,
    created: x.createdAt?.toMillis?.() ?? null, campaign: x.campaignId ?? null,
    alterTage: x.bonDate ? Math.round((Date.now() - new Date(x.bonDate + 'T12:00:00Z').getTime()) / TAG) : null,
    alterEinreichungTage: x.createdAt?.toMillis ? Math.round((Date.now() - x.createdAt.toMillis()) / TAG) : null,
  }; }).sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  console.log(JSON.stringify(rows, null, 1));
  const g = {}; rows.forEach((r) => { g[r.grund] = (g[r.grund] || 0) + 1; });
  console.error('Gründe:', JSON.stringify(g), '| gesamt', rows.length);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
