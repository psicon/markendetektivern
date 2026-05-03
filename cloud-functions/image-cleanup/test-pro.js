/**
 * Throwaway A/B test: runs Gemini 3 Pro Image vs the current
 * Gemini 2.5 Flash output on the same products, saves a side-by-side
 * preview HTML in /tmp/bg-pro-test/.
 *
 * Doesn't write to Storage or Firestore — purely local artefacts so
 * we can compare quality before committing to the more expensive
 * model.
 *
 * Run:
 *   cd cloud-functions/image-cleanup
 *   FIREBASE_SERVICE_ACCOUNT=… GEMINI_API_KEY=… node test-pro.js
 *
 * Cost: ~10 items × $0.134 = ~$1.34
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const sharp = require('sharp');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  storageBucket: sa.project_id + '.appspot.com',
});

const { uniformBgToTransparent } = require('./pipeline');

const PRO_MODEL = 'gemini-3-pro-image-preview';
const OUT_DIR = '/tmp/bg-pro-test';

const PROMPT_TEXT = [
  'You are a product-photo background-removal tool, NOT a generator.',
  '',
  'TASK: Output the SAME product, photographed from the SAME angle, on a PURE WHITE (#FFFFFF) background. Studio-quality, high-resolution, e-commerce ready.',
  '',
  'BACKGROUND — MANDATORY:',
  'The output background MUST be pure solid white (#FFFFFF) — flat, no texture, no gradient, no shadows, no patterns. NEVER black, NEVER gray, NEVER coloured, NEVER scenery. White only.',
  '',
  'CAMERA ANGLE — MANDATORY:',
  'Preserve the EXACT camera angle and perspective from the input. If the input is shot from above (top-down / lid view), output is also from above. If shot from the side, output is from the side. Do NOT rotate the product. Do NOT re-photograph from a different perspective.',
  '',
  'PRODUCT — MANDATORY:',
  '1. DO NOT modify the product packaging in any way.',
  '2. DO NOT add, remove, alter, redraw, or "improve" any text, logo, font, color, shape, illustration, badge, certification mark, barcode, or design element on the product.',
  '3. DO NOT change the product proportions, lighting, or material appearance.',
  '4. DO NOT fill in or guess details that are unclear in the input — keep them as-is, even if blurry.',
  '5. DO NOT add shadows, reflections, or stylistic effects.',
  '6. DO NOT crop the product. Keep it fully visible, centered, with a small margin.',
  '',
  'WHAT TO REMOVE: hands, fingers, store shelves, floors, ceilings, other products, price tags NOT on the package, room scenes, signage, walls. Replace whatever you remove with PURE WHITE.',
  '',
  'OUTPUT: photorealistic studio product photo, pure white background, SAME camera angle as input, the product is the EXACT same product as in the input — pixel-faithful.',
].join('\n');

// Curated test set — mix of:
//  • known hard case (Fruchtgurt — top-down yogurt cup that 2.5 mangled)
//  • already-processed NoNames so we have an existing 2.5 result for A/B
//  • a few random NoNames pulled from the catalog
const FIXED_IDS = [
  '02W5i59oiVa4nc4QnJlT',  // Fruchtgurt Erdbeere — der bekannte Fall
  '0280OwFN7gWMFVzyCPsF',  // Kaubo Mix Frucht Kaubonbon
  '022uZ02L6EgMex9uGHGl',  // Family Duschgel Tropic
  '04MoeircZegi8zSaRm0n',  // Schoko-Butterkeks Zartbitter
  '04b3GBXVYmyPdVp9vw4Z',  // Faden Frischeinudeln
  '05N6bvOW4P5I0BNaLnkJ',  // Trauben-Nuss Müsli Vollkorn
  '05fXhdG0UIBPIas9oDCM',  // Allesreiniger Bergfrühling
  '065wA1n7wilKYvrYpq7A',  // Käse für den Ofen
];

async function fetchAdditionalRandom(db, count) {
  const snap = await db.collection('produkte').limit(200).get();
  const all = snap.docs
    .map((d) => d.id)
    .filter((id) => !FIXED_IDS.includes(id));
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function runProGemini(buf, genAI) {
  const r = await genAI.models.generateContent({
    model: PRO_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { text: PROMPT_TEXT },
          {
            inlineData: {
              mimeType: 'image/png',
              data: buf.toString('base64'),
            },
          },
        ],
      },
    ],
    config: { responseModalities: ['IMAGE'] },
  });
  const candidates = r?.candidates || [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) {
        return Buffer.from(p.inlineData.data, 'base64');
      }
    }
  }
  const reason = candidates[0]?.finishReason || 'UNKNOWN';
  throw new Error(`Gemini Pro returned no image (finishReason=${reason})`);
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateHTML(rows) {
  const cards = rows
    .map((r) => {
      const orig = r.origPath ? path.basename(r.origPath) : null;
      const flash = r.flashUrl;
      const pro = r.proPath ? path.basename(r.proPath) : null;
      const proRaw = r.proRawPath ? path.basename(r.proRawPath) : null;
      return `
<div class="card">
  <div class="head">${htmlEscape(r.id)} · ${htmlEscape(r.name || '')}</div>
  <div class="row">
    <div class="cell">
      <div class="lbl">Original</div>
      ${orig ? `<img src="${orig}"/>` : '<div class="missing">no original</div>'}
    </div>
    <div class="cell">
      <div class="lbl">Gemini 2.5 Flash (jetzt im Storage)</div>
      ${flash ? `<img src="${flash}&_=${Date.now()}"/>` : '<div class="missing">no flash result</div>'}
    </div>
    <div class="cell">
      <div class="lbl">Gemini 3 Pro RAW (vor Post-Process)</div>
      ${proRaw ? `<img src="${proRaw}"/>` : `<div class="missing">${htmlEscape(r.proError || 'no pro raw')}</div>`}
    </div>
    <div class="cell">
      <div class="lbl">Gemini 3 Pro + Flood-Fill</div>
      ${pro ? `<img src="${pro}"/>` : `<div class="missing">${htmlEscape(r.proError || 'failed')}</div>`}
    </div>
  </div>
</div>`;
    })
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Gemini 2.5 Flash vs 3 Pro</title>
<style>
  body { font: 14px/1.4 -apple-system, sans-serif; background: #f4f5f7; padding: 24px; color: #191c1d; }
  h1 { margin: 0 0 8px; }
  .summary { color: #5c6769; margin-bottom: 24px; }
  .card { background: #fff; border-radius: 14px; padding: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.05); margin-bottom: 18px; }
  .head { font-weight: 700; font-family: monospace; font-size: 12px; color: #5c6769; margin-bottom: 10px; }
  .row { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; }
  .cell { display: flex; flex-direction: column; gap: 6px; }
  .lbl { font-size: 10px; font-weight: 800; color: #5c6769; text-transform: uppercase; letter-spacing: .04em; }
  .cell img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 8px;
    background: linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, #fff 25%, #fff 75%, #ddd 75%);
    background-size: 16px 16px; background-position: 0 0, 8px 8px; }
  .missing { color: #c00; font-size: 11px; padding: 8px; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: #fdecea; border-radius: 8px; }
</style></head><body>
<h1>Gemini 2.5 Flash vs 3 Pro Image — A/B Vergleich</h1>
<div class="summary">${rows.length} Produkte · gleicher Prompt · gleiche Post-Processing-Pipeline</div>
${cards}
</body></html>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`📁 Output: ${OUT_DIR}`);
  console.log(`🤖 Pro model: ${PRO_MODEL}`);

  const db = admin.firestore();
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const extra = await fetchAdditionalRandom(db, 4);
  const allIds = [...FIXED_IDS, ...extra];
  console.log(`Testing ${allIds.length} products`);

  const rows = [];
  for (let i = 0; i < allIds.length; i++) {
    const id = allIds[i];
    process.stdout.write(`[${i + 1}/${allIds.length}] ${id} … `);
    const snap = await db.collection('produkte').doc(id).get();
    if (!snap.exists) {
      process.stdout.write('NOT FOUND\n');
      continue;
    }
    const data = snap.data();
    const row = {
      id,
      name: data.name || '',
      flashUrl: data.bildClean || null,
      origPath: null,
      proPath: null,
      proRawPath: null,
    };
    try {
      const origBuf = await downloadImage(data.bild);
      row.origPath = path.join(OUT_DIR, `${id}_original.jpg`);
      fs.writeFileSync(row.origPath, origBuf);

      const prepped = await sharp(origBuf)
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

      process.stdout.write('Pro… ');
      const proRaw = await runProGemini(prepped, genAI);
      row.proRawPath = path.join(OUT_DIR, `${id}_pro_raw.png`);
      fs.writeFileSync(row.proRawPath, proRaw);

      const transparent = await uniformBgToTransparent(proRaw);
      const trimmed = await sharp(transparent).trim().toBuffer();
      const finalWebP = await sharp(trimmed)
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, alphaQuality: 90, effort: 6 })
        .toBuffer();
      row.proPath = path.join(OUT_DIR, `${id}_pro_final.webp`);
      fs.writeFileSync(row.proPath, finalWebP);
      process.stdout.write(`ok (${(finalWebP.length / 1024).toFixed(0)} KB)\n`);
    } catch (err) {
      row.proError = err.message;
      process.stdout.write(`FAIL: ${err.message.slice(0, 60)}\n`);
    }
    rows.push(row);
  }

  const html = generateHTML(rows);
  fs.writeFileSync(path.join(OUT_DIR, 'preview.html'), html);
  const ok = rows.filter((r) => r.proPath).length;
  console.log(`\n✅ ${ok}/${rows.length} processed`);
  console.log(`   estimated cost: $${(ok * 0.134).toFixed(2)}`);
  console.log(`   open ${path.join(OUT_DIR, 'preview.html')}`);
  process.exit(0);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
