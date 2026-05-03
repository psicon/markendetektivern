/**
 * Debug script — runs each stage of the pipeline on a single product
 * and dumps the intermediate buffer to /tmp so we can inspect where
 * alpha is being lost.
 */
const fs = require('fs');
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const sharp = require('sharp');

const sa = JSON.parse(fs.readFileSync('/tmp/_md_sa.json', 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: sa.project_id + '.appspot.com' });

const PROMPT_TEXT = require('./pipeline.js').__getInternalState
  ? '__internal' : 'PURE WHITE BG · same camera angle · same product';

async function main() {
  const productId = process.argv[2] || '02W5i59oiVa4nc4QnJlT';
  const collection = process.argv[3] || 'produkte';
  const out = (n) => `/tmp/dbg_${productId.slice(0, 8)}_${n}`;

  const db = admin.firestore();
  const snap = await db.collection(collection).doc(productId).get();
  const bildUrl = snap.data()?.bild;
  console.log('Original bild URL:', bildUrl);

  // 1. Download original
  const origBuf = Buffer.from(await (await fetch(bildUrl)).arrayBuffer());
  fs.writeFileSync(out('1_original.jpg'), origBuf);
  let meta = await sharp(origBuf).metadata();
  console.log('1. Original:', meta.width + 'x' + meta.height, 'channels=' + meta.channels, 'hasAlpha=' + meta.hasAlpha);

  // 2. Prep PNG ≤1024
  const prepped = await sharp(origBuf).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  fs.writeFileSync(out('2_prepped.png'), prepped);
  meta = await sharp(prepped).metadata();
  console.log('2. Prepped: ', meta.width + 'x' + meta.height, 'channels=' + meta.channels, 'hasAlpha=' + meta.hasAlpha);

  // 3. Gemini call
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const PROMPT = `Output the SAME product on a PURE WHITE background. Same camera angle. Do not change perspective. Pure white #FFFFFF only — never black, never gray.`;
  const r = await genAI.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/png', data: prepped.toString('base64') } }] }],
    config: { responseModalities: ['IMAGE'] },
  });
  const part = (r?.candidates?.[0]?.content?.parts || []).find(p => p?.inlineData?.data);
  if (!part) {
    console.error('Gemini returned no image. finishReason =', r?.candidates?.[0]?.finishReason);
    process.exit(1);
  }
  const gemBuf = Buffer.from(part.inlineData.data, 'base64');
  fs.writeFileSync(out('3_gemini.png'), gemBuf);
  meta = await sharp(gemBuf).metadata();
  console.log('3. Gemini:  ', meta.width + 'x' + meta.height, 'channels=' + meta.channels, 'hasAlpha=' + meta.hasAlpha);

  // Sample corners of Gemini output
  const { data: gd, info: gi } = await sharp(gemBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = gi.width, H = gi.height;
  const corners = [[0,0], [W-1,0], [0,H-1], [W-1,H-1]];
  console.log('   Gemini corners (R,G,B,A):');
  for (const [x, y] of corners) {
    const i = (y * W + x) * 4;
    console.log('     [' + x + ',' + y + ']', gd[i], gd[i+1], gd[i+2], gd[i+3]);
  }

  // 4. Flood-fill (any-uniform-bg → transparent)
  const { uniformBgToTransparent } = require('./pipeline.js');
  const transparent = await uniformBgToTransparent(gemBuf);
  fs.writeFileSync(out('4_flood.png'), transparent);
  meta = await sharp(transparent).metadata();
  console.log('4. Flood:   ', meta.width + 'x' + meta.height, 'channels=' + meta.channels, 'hasAlpha=' + meta.hasAlpha);
  const { data: fd, info: fi } = await sharp(transparent).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W2 = fi.width, H2 = fi.height;
  console.log('   Flood corners (R,G,B,A):');
  for (const [x, y] of [[0,0], [W2-1,0], [0,H2-1], [W2-1,H2-1]]) {
    const i = (y * W2 + x) * 4;
    console.log('     [' + x + ',' + y + ']', fd[i], fd[i+1], fd[i+2], fd[i+3]);
  }

  // 5. trim()
  const trimmed = await sharp(transparent).trim().toBuffer();
  fs.writeFileSync(out('5_trimmed.png'), trimmed);
  meta = await sharp(trimmed).metadata();
  console.log('5. Trimmed: ', meta.width + 'x' + meta.height, 'channels=' + meta.channels, 'hasAlpha=' + meta.hasAlpha);

  // 6. Final WebP
  const finalWebp = await sharp(trimmed).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toBuffer();
  fs.writeFileSync(out('6_final.webp'), finalWebp);
  meta = await sharp(finalWebp).metadata();
  console.log('6. WebP:    ', meta.width + 'x' + meta.height, 'channels=' + meta.channels, 'hasAlpha=' + meta.hasAlpha);

  console.log('\nFiles in /tmp/dbg_' + productId.slice(0, 8) + '_*');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
