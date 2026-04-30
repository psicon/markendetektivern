/**
 * v6 smoke-test: process 6 markenProdukte (small mix), produce HTML
 * preview that shows each variant on BOTH white and dark backgrounds
 * so the user can verify everything renders correctly.
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: sa.project_id + '.appspot.com' });
const { processProductImage } = require('./pipeline');
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const OUT = '/tmp/v6-preview';
const COLLECTION = process.env.COLLECTION || 'markenProdukte';
const N = parseInt(process.env.N || '6', 10);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const db = admin.firestore();
  const snap = await db.collection(COLLECTION).limit(60).get();
  const candidates = snap.docs
    .filter((d) => typeof d.data().bild === 'string' && d.data().bild.startsWith('http'))
    .map((d) => ({ id: d.id, name: d.data().name || '', bild: d.data().bild }));
  // shuffle + take N
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const sample = candidates.slice(0, N);

  const rows = [];
  for (const { id, name, bild } of sample) {
    process.stdout.write(`[${rows.length + 1}/${N}] ${id} … `);
    const t0 = Date.now();
    const r = await processProductImage({
      db: admin.firestore(),
      bucket: admin.storage().bucket(),
      genAI,
      collection: COLLECTION,
      productId: id,
      options: { force: true },
    });
    const ms = Date.now() - t0;
    process.stdout.write(`${r.status} (${ms}ms)\n`);
    if (r.status === 'cleaned' || r.status === 'heuristic-skip') {
      // download original + 3 variants
      const subfolder = COLLECTION === 'markenProdukte' ? 'brandproducts' : 'nonameproducts';
      const bucket = admin.storage().bucket();
      const fetchFile = async (p) => (await bucket.file(p).download())[0];
      const origBuf = Buffer.from(await (await fetch(bild)).arrayBuffer());
      const hqBuf = await fetchFile(`productimagesclean/${subfolder}/${id}_hq.png`);
      const pngBuf = await fetchFile(`productimagesclean/${subfolder}/${id}.png`);
      const webpBuf = await fetchFile(`productimagesclean/${subfolder}/${id}.webp`);
      fs.writeFileSync(path.join(OUT, `${id}_orig.jpg`), origBuf);
      fs.writeFileSync(path.join(OUT, `${id}_hq.png`), hqBuf);
      fs.writeFileSync(path.join(OUT, `${id}.png`), pngBuf);
      fs.writeFileSync(path.join(OUT, `${id}.webp`), webpBuf);
      const hqMeta = await sharp(hqBuf).metadata();
      const pngMeta = await sharp(pngBuf).metadata();
      const webpMeta = await sharp(webpBuf).metadata();
      rows.push({
        id, name,
        origSize: origBuf.length,
        hqSize: hqBuf.length,
        pngSize: pngBuf.length,
        webpSize: webpBuf.length,
        hqDim: `${hqMeta.width}x${hqMeta.height}`,
        pngDim: `${pngMeta.width}x${pngMeta.height}`,
        webpDim: `${webpMeta.width}x${webpMeta.height}`,
      });
    } else {
      rows.push({ id, name, error: r.reason || r.status });
    }
  }

  // Generate HTML preview
  const fmt = (b) => b ? `${(b/1024).toFixed(0)} KB` : '—';
  const cards = rows.map((r) => {
    if (r.error) {
      return `<div class="card error"><div class="head">${r.id} · ${r.name}</div><div class="err">${r.error}</div></div>`;
    }
    const bg = (cls) => `<div class="cell ${cls}">
      <div class="lbl">${cls === 'orig' ? 'ORIG' : cls === 'hq' ? `HQ ${r.hqDim} ${fmt(r.hqSize)}` : cls === 'png' ? `PNG ${r.pngDim} ${fmt(r.pngSize)}` : `APP webp ${r.webpDim} ${fmt(r.webpSize)}`}</div>
      <img src="${r.id}${cls === 'orig' ? '_orig.jpg' : cls === 'hq' ? '_hq.png' : cls === 'png' ? '.png' : '.webp'}"/>
    </div>`;
    return `
<div class="card">
  <div class="head">${r.id} · ${r.name}</div>
  <div class="row light">
    <div class="bg-label">on white</div>
    ${bg('orig')}${bg('hq')}${bg('png')}${bg('webp')}
  </div>
  <div class="row dark">
    <div class="bg-label">on dark</div>
    ${bg('orig')}${bg('hq')}${bg('png')}${bg('webp')}
  </div>
</div>`;
  }).join('\n');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>v6 preview</title>
<style>
  body { font: 14px/1.4 -apple-system, sans-serif; background: #f4f5f7; padding: 24px; color: #191c1d; }
  .card { background: #fff; border-radius: 14px; padding: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.05); margin-bottom: 18px; }
  .head { font-weight: 700; font-family: monospace; font-size: 12px; color: #5c6769; margin-bottom: 10px; }
  .row { display: grid; grid-template-columns: 60px 1fr 1fr 1fr 1fr; gap: 10px; padding: 10px; border-radius: 10px; margin-bottom: 8px; align-items: center; }
  .row.light { background: #fff; border: 1px solid #e0e0e0; }
  .row.dark  { background: #1a1a1a; }
  .bg-label { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .row.light .bg-label { color: #999; }
  .row.dark .bg-label { color: #aaa; }
  .cell { display: flex; flex-direction: column; gap: 4px; }
  .lbl { font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .row.light .lbl { color: #888; }
  .row.dark .lbl { color: #ccc; }
  .cell img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 4px; }
  .error { background: #fdecea; }
  .err { color: #c00; }
</style></head><body>
<h1>Pipeline v6 — ${COLLECTION} (${rows.length} samples)</h1>
<p>Each row shows the same 4 images on white background (top) and dark background (bottom). v6 outputs are OPAQUE white-BG so they should look identical on both rows.</p>
${cards}
</body></html>`;
  fs.writeFileSync(path.join(OUT, 'preview.html'), html);
  console.log(`\n✅ Preview: open ${path.join(OUT, 'preview.html')}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
