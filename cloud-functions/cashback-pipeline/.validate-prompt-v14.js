// Validiert OCR-Prompt v1.4 (storeAddress) an echten Bons: Items/Preise/Total
// gegen die gecachte v1.3-Lesung, plus was storeAddress liefert. ~12 Flash-Calls.
'use strict';
const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const { extractReceipt } = require('./lib/ocr');
const { sigOf } = require('./lib/ocr_robust');
const { deriveStoreAddress } = require('./lib/storeAddress');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const storage = new Storage({ projectId: 'markendetektive-895f7' });
(async () => {
  const wanted = [['lidl','DE'],['rewe','DE'],['aldi','DE'],['netto','DE'],['kaufland','DE'],['edeka','DE'],['dm','DE'],['penny','DE'],['rossmann','DE'],['hofer','AT'],['spar','AT'],['billa','AT']];
  const picks = [];
  for (const [m, land] of wanted) {
    const q = await db.collection('receipts').where('status','==','approved').where('merchant.id','==',m).where('merchant.land','==',land).orderBy('createdAt','desc').limit(1).get().catch(async () => db.collection('receipts').where('status','==','approved').where('merchant.id','==',m).limit(1).get());
    if (!q.empty) picks.push(q.docs[0]);
  }
  console.log('bons:', picks.length);
  const rows = [];
  for (const d of picks) {
    const x = d.data();
    const [bytes] = await storage.bucket(x.storage.bucket).file(x.storage.path).download();
    const mime = x.storage.contentType || 'image/jpeg';
    const t0 = Date.now();
    let r;
    try { r = await extractReceipt(bytes, mime); } catch (e) { rows.push({ id: d.id, m: x.merchant.id, err: e.message.slice(0,120) }); continue; }
    const cached = x.ocr.parsed;
    const sameItems = sigOf(r.parsed.items) === sigOf(cached.items);
    const sameTotal = r.parsed.totalCents === cached.totalCents;
    const derived = deriveStoreAddress(r.parsed, x.merchant.land);
    rows.push({ id: d.id.slice(0,8), m: x.merchant.id, land: x.merchant.land, ms: Date.now()-t0, itemsCached: cached.items.length, itemsNew: r.parsed.items.length, sameItems, sameTotal, storeAddress: r.parsed.storeAddress, subtitle: r.parsed.merchantSubtitle, derived: derived && { z: derived.zip, c: derived.city, s: derived.street, src: derived.source } });
  }
  for (const row of rows) console.log(JSON.stringify(row));
  const ok = rows.filter(r => !r.err);
  console.log('SUMMARY items-identical', ok.filter(r=>r.sameItems).length+'/'+ok.length, 'total-identical', ok.filter(r=>r.sameTotal).length+'/'+ok.length, 'storeAddress-zip', ok.filter(r=>r.storeAddress?.zip).length+'/'+ok.length, 'derived-complete', ok.filter(r=>r.derived?.z && r.derived?.c).length+'/'+ok.length);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
