// scripts/test-bg-removal.js
//
// Throwaway-Skript: zieht 50 zufällige Produktbilder aus Firestore
// (Mix aus markenProdukte + produkte), läuft pro Bild eine Heuristik
// (Border-Pixel-Variance) + optional Background-Removal LOKAL via
// @imgly/background-removal-node (ONNX, kein API-Token nötig),
// speichert Original + Cleaned-Variante und schreibt eine HTML-Seite
// `preview.html` zum Side-by-Side-Vergleich.
//
// Ziel: in 2-5 min visuell prüfen, ob die BG-Removal-Quality für
// unsere Produktfotos gut genug ist. KEIN Firestore-Write, KEIN
// Storage-Upload — reiner Test.
//
// ── ENV ────────────────────────────────────────────────────────────
//   FIREBASE_SERVICE_ACCOUNT  JSON-encoded Admin SDK service account
//                             (gleich wie für die anderen Skripte hier).
//
// ── INSTALL ────────────────────────────────────────────────────────
//   cd scripts
//   npm install @imgly/background-removal-node sharp
//
// ── RUN ────────────────────────────────────────────────────────────
//   FIREBASE_SERVICE_ACCOUNT=$(cat path/to/serviceAccountKey.json) \
//     node scripts/test-bg-removal.js
//
// ── OUTPUT ─────────────────────────────────────────────────────────
//   tmp/bg-test/<id>_original.jpg
//   tmp/bg-test/<id>_clean.png      (nur wenn Heuristik AI sagt)
//   tmp/bg-test/preview.html        Side-by-side Vergleich, im Browser
//                                   öffnen.
//
// ── KOSTEN ─────────────────────────────────────────────────────────
//   $0 — komplett lokal. Erste Ausführung lädt einmalig das ~50 MB
//   ONNX-Modell. Danach offline. Quality basiert auf BiRefNet/ISNet,
//   E-Commerce-tauglich. Für Produktiv-Pipeline würden wir denselben
//   Stack auf Cloud Run packen → ~$0.001 pro Bild Compute.

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

// ─── ENV-Checks ────────────────────────────────────────────────────
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ Set FIREBASE_SERVICE_ACCOUNT (siehe Header-Kommentar).');
  process.exit(1);
}

const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '50', 10);
const OUT_DIR = path.join(__dirname, '..', 'tmp', 'bg-test');

// Heuristik-Schwellen — bestimmen, ob ein Bild „schon clean" aussieht
// und wir die AI-Call sparen können.
const VARIANCE_THRESHOLD = 8;   // RGB-Std-Dev über 256-px-Border-Sample
const LIGHTNESS_THRESHOLD = 240; // Mittlere Helligkeit; >240 ≈ weiß

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'markendetektive-895f7',
});
const db = admin.firestore();

// ─── Helpers ───────────────────────────────────────────────────────

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Don't trust the content-type header (Firebase Storage often
  // serves `application/octet-stream`). Instead check the first few
  // bytes for known image-format magic numbers.
  const isJPEG = buf[0] === 0xff && buf[1] === 0xd8;
  const isPNG =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebP =
    buf.length > 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP';
  const isGIF = buf.slice(0, 3).toString('ascii') === 'GIF';
  if (!isJPEG && !isPNG && !isWebP && !isGIF) {
    throw new Error(
      `Not a recognised image (first bytes: ${buf.slice(0, 8).toString('hex')})`,
    );
  }
  return buf;
}

/**
 * Border-Pixel-Heuristik. Sample alle Rand-Pixel, berechne Color-
 * Variance und durchschnittliche Helligkeit. Wenn niedrig + hell →
 * Bild hat schon einen sauberen weißen Hintergrund, AI ist
 * unnötig.
 */
async function analyzeBackground(buffer) {
  const SIZE = 256;
  const pipeline = sharp(buffer)
    .resize(SIZE, SIZE, { fit: 'inside' })
    .removeAlpha()
    .raw();
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const samples = [];
  // Top + Bottom rows
  for (let x = 0; x < width; x++) {
    const top = x * channels;
    const bot = ((height - 1) * width + x) * channels;
    samples.push([data[top], data[top + 1], data[top + 2]]);
    samples.push([data[bot], data[bot + 1], data[bot + 2]]);
  }
  // Left + Right columns
  for (let y = 0; y < height; y++) {
    const left = y * width * channels;
    const right = (y * width + (width - 1)) * channels;
    samples.push([data[left], data[left + 1], data[left + 2]]);
    samples.push([data[right], data[right + 1], data[right + 2]]);
  }

  const n = samples.length;
  let sumR = 0, sumG = 0, sumB = 0;
  for (const [r, g, b] of samples) { sumR += r; sumG += g; sumB += b; }
  const mean = [sumR / n, sumG / n, sumB / n];
  let varSum = 0;
  for (const [r, g, b] of samples) {
    varSum +=
      (r - mean[0]) ** 2 + (g - mean[1]) ** 2 + (b - mean[2]) ** 2;
  }
  const variance = Math.sqrt(varSum / n / 3);
  const lightness = (mean[0] + mean[1] + mean[2]) / 3;
  const isUniform = variance < VARIANCE_THRESHOLD;
  const isWhiteish = lightness > LIGHTNESS_THRESHOLD;
  return {
    variance,
    lightness,
    needsAI: !(isUniform && isWhiteish),
  };
}

async function runRembg(imageBuffer, scratchPath) {
  // @imgly/background-removal-node — läuft komplett lokal mit ONNX
  // (BiRefNet/ISNet). Erste Ausführung lädt das Modell ~50 MB nach
  // node_modules/@imgly cache, danach offline. Output ist ein Blob
  // mit PNG (RGBA, transparenter Hintergrund).
  //
  // Wir schreiben den Buffer als Datei und übergeben den `file://`
  // URL — das ist der zuverlässigste Pfad im Node-Adapter, weil der
  // ImageDecoder in @imgly's Codecs Buffer/Uint8Array nicht durchgehend
  // korrekt erkennt.
  fs.writeFileSync(scratchPath, imageBuffer);
  const fileUrl = `file://${scratchPath}`;
  const blob = await removeBackground(fileUrl);
  const arr = await blob.arrayBuffer();
  return Buffer.from(arr);
}

async function fetchSample() {
  console.log('🔍 Lade Produkte aus Firestore …');
  // Pull a generous batch from each collection so the random sample
  // is well-distributed across the catalog.
  const [markenSnap, noNameSnap] = await Promise.all([
    db.collection('markenProdukte').limit(800).get(),
    db.collection('produkte').limit(800).get(),
  ]);
  const all = [
    ...markenSnap.docs.map((d) => ({
      id: d.id,
      bild: d.data().bild,
      name: d.data().name || d.data().produktName || 'Unbekannt',
      _type: 'marken',
    })),
    ...noNameSnap.docs.map((d) => ({
      id: d.id,
      bild: d.data().bild,
      name: d.data().name || d.data().produktName || 'Unbekannt',
      _type: 'noname',
    })),
  ].filter((p) => typeof p.bild === 'string' && p.bild.startsWith('http'));

  // Knuth-Shuffle und top SAMPLE_SIZE picken.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, SAMPLE_SIZE);
}

function generateHTML(results) {
  const cells = results
    .map((r) => {
      const orig = `${r.baseName}_original.jpg`;
      const clean = r.cleanedFile ? `${r.baseName}_clean.png` : null;
      const tag = r.heuristic.needsAI ? 'AI' : 'SKIP';
      const tagColor = r.heuristic.needsAI ? '#0d8575' : '#999';
      const cleanCell = clean
        ? `<div class="img-wrap"><img src="${clean}" /><div class="lbl">cleaned</div></div>`
        : `<div class="img-wrap skip"><div class="msg">— skip (clean) —</div></div>`;
      return `
<div class="card">
  <div class="head">
    <span class="tag" style="background:${tagColor}">${tag}</span>
    <span class="meta">${r._type} · v=${r.heuristic.variance.toFixed(1)} · L=${r.heuristic.lightness.toFixed(0)}</span>
  </div>
  <div class="title">${escapeHTML(r.name)}</div>
  <div class="row">
    <div class="img-wrap"><img src="${orig}" /><div class="lbl">original</div></div>
    ${cleanCell}
  </div>
  <div class="id">${r.id}</div>
</div>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="de"><head>
<meta charset="utf-8"><title>BG-Removal Test</title>
<style>
  body { font: 14px/1.4 -apple-system, sans-serif; background: #f4f5f7; padding: 24px; color: #191c1d; }
  h1 { margin: 0 0 8px; font-size: 20px; }
  .summary { color: #5c6769; margin-bottom: 24px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  .card { background: #fff; border-radius: 14px; padding: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
  .head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; font-size: 11px; color: #5c6769; }
  .tag { color: #fff; padding: 2px 8px; border-radius: 999px; font-weight: 800; letter-spacing: .04em; }
  .title { font-weight: 700; font-size: 14px; margin-bottom: 8px; line-height: 1.3; }
  .id { font-family: monospace; font-size: 10px; color: #99a; margin-top: 6px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .img-wrap { background: linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, #fff 25%, #fff 75%, #ddd 75%); background-size: 16px 16px; background-position: 0 0, 8px 8px; border-radius: 8px; aspect-ratio: 1; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; }
  .img-wrap img { width: 100%; height: 100%; object-fit: contain; }
  .img-wrap.skip { background: #f5f7f8; }
  .img-wrap .lbl { position: absolute; top: 4px; left: 6px; font-size: 9px; font-weight: 800; color: #fff; background: rgba(0,0,0,.5); padding: 1px 6px; border-radius: 4px; letter-spacing: .04em; text-transform: uppercase; }
  .img-wrap .msg { color: #999; font-size: 11px; font-style: italic; }
</style></head><body>
<h1>BG-Removal Test — ${results.length} Produkte</h1>
<div class="summary">
  AI-cleaned: <b>${results.filter((r) => r.cleanedFile).length}</b> ·
  Skipped (clean detected): <b>${results.filter((r) => !r.cleanedFile && !r.error).length}</b> ·
  Errors: <b>${results.filter((r) => r.error).length}</b>
</div>
<div class="grid">
${cells}
</div>
</body></html>`;
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`📁 Output: ${OUT_DIR}`);

  const sample = await fetchSample();
  console.log(`📦 Selected ${sample.length} products\n`);

  const results = [];
  let aiCalls = 0;
  let errors = 0;
  const t0 = Date.now();

  for (let i = 0; i < sample.length; i++) {
    const p = sample[i];
    const baseName = `${p._type}_${p.id.slice(0, 16)}`;
    const idx = `[${String(i + 1).padStart(2, '0')}/${sample.length}]`;
    process.stdout.write(`${idx} ${p._type}/${p.id.slice(0, 12)} … `);

    const result = { ...p, baseName, cleanedFile: null, heuristic: null };
    try {
      const orig = await downloadImage(p.bild);
      result.heuristic = await analyzeBackground(orig);

      // Always save the original (for the HTML preview)
      fs.writeFileSync(path.join(OUT_DIR, `${baseName}_original.jpg`), orig);

      if (result.heuristic.needsAI) {
        process.stdout.write(
          `v=${result.heuristic.variance.toFixed(1)} → AI … `,
        );
        const scratch = path.join(OUT_DIR, `${baseName}_in.bin`);
        const cleaned = await runRembg(orig, scratch);
        const cleanFile = path.join(OUT_DIR, `${baseName}_clean.png`);
        fs.writeFileSync(cleanFile, cleaned);
        // Drop the scratch file; we keep only the original .jpg + .png
        try { fs.unlinkSync(scratch); } catch { /* ignore */ }
        result.cleanedFile = cleanFile;
        aiCalls++;
        process.stdout.write('ok\n');
      } else {
        process.stdout.write(
          `v=${result.heuristic.variance.toFixed(1)} → SKIP (clean)\n`,
        );
      }
    } catch (err) {
      result.error = err.message;
      errors++;
      process.stdout.write(`FAIL: ${err.message}\n`);
    }
    results.push(result);
  }

  const html = generateHTML(results);
  fs.writeFileSync(path.join(OUT_DIR, 'preview.html'), html);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const cost = aiCalls * 0.0023;
  console.log('\n────────────────────────────────────────');
  console.log(`✅ Fertig in ${elapsed}s`);
  console.log(`   AI-Calls:   ${aiCalls}/${results.length} (skip-rate ${((1 - aiCalls / results.length) * 100).toFixed(0)}%)`);
  console.log(`   Errors:     ${errors}`);
  console.log(`   Geschätzte Kosten: $${cost.toFixed(3)}`);
  console.log(`   Preview:    open ${path.join(OUT_DIR, 'preview.html')}`);
  console.log('────────────────────────────────────────');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
