// scripts/test-bg-llm.js
//
// Vergleicht zwei generative LLMs für Produkt-BG-Removal:
//   1. OpenAI gpt-image-1 (images.edit, background:'transparent')
//   2. Google Gemini 2.5 Flash Image ("Nano Banana")
//
// Beide bekommen den exakt gleichen Prompt, der explizit
// Halluzinieren verbietet. Output landet als Original / GPT / Gemini
// Side-by-side in einer HTML-Preview.
//
// ── ENV ────────────────────────────────────────────────────────────
//   FIREBASE_SERVICE_ACCOUNT  Admin SDK service account (JSON-encoded)
//   OPENAI_API_KEY            sk-…
//   GEMINI_API_KEY            AIza…
//
// ── INSTALL ────────────────────────────────────────────────────────
//   cd scripts
//   npm install openai sharp
//
// ── RUN ────────────────────────────────────────────────────────────
//   cd scripts
//   FIREBASE_SERVICE_ACCOUNT=… OPENAI_API_KEY=… GEMINI_API_KEY=… \
//     SAMPLE_SIZE=12 node test-bg-llm.js
//
// ── KOSTEN ─────────────────────────────────────────────────────────
//   Pro Sample:
//     gpt-image-1 (1024×1024, transparent):  ~$0,04
//     gemini-2.5-flash-image (1024×1024):    ~$0,039
//     ──────────────────────────────────────────────
//     ~$0,08 pro Vergleich
//
//   12 Samples × $0,08 = ~$1
//   30 Samples × $0,08 = ~$2,40
//
// ── OUTPUT ─────────────────────────────────────────────────────────
//   tmp/bg-llm-test/<id>_original.jpg
//   tmp/bg-llm-test/<id>_gpt.png
//   tmp/bg-llm-test/<id>_gemini.png
//   tmp/bg-llm-test/preview.html

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require('openai');

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('❌ Set FIREBASE_SERVICE_ACCOUNT');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ Set GEMINI_API_KEY');
  process.exit(1);
}
// OPENAI_API_KEY is OPTIONAL — when present we also run GPT-4o
// with the image_generation tool for a side-by-side comparison.
// When the org isn't verified for image generation (which OpenAI
// requires for ALL image-output models), GPT just gets skipped and
// only Gemini runs.
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;

const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '12', 10);
const OUT_DIR = path.join(__dirname, '..', 'tmp', 'bg-llm-test');

// Heuristik-Schwellen — wie im rembg-Test, damit wir nur die
// "schmutzigen" Bilder den teuren LLMs vorlegen.
const VARIANCE_THRESHOLD = 8;
const LIGHTNESS_THRESHOLD = 240;

// ── Firebase Admin init ────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'markendetektive-895f7',
});
const db = admin.firestore();

// ── OpenAI ─────────────────────────────────────────────────────────
const openai = HAS_OPENAI
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ── Gemini (REST) ──────────────────────────────────────────────────
// Public name as of late 2025 — was "Nano Banana" in preview phase.
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

// ── Prompt — IDENTISCH für beide Modelle ───────────────────────────
//
// Strikte Anti-Halluzinations-Anweisung: Pixel des Produkts NICHT
// verändern. Nur Hintergrund + Hände + Regalfetzen entfernen.
//
// Hinweis: GPT akzeptiert `background:'transparent'` → echte Alpha.
// Gemini liefert PNG mit weißem Hintergrund (kein Alpha-Output bei
// generativen Modellen — wir müssten post-processen oder mit dem
// weißen BG leben für den Vergleich; im A/B-Test reicht's allemal,
// weil die Frage „halluziniert es Verpackungsdetails?" und „cuttet
// es Hände/Regal sauber raus?" auch auf weißem BG beantwortbar ist).

const PROMPT_TEXT = [
  'You are a product-photo background-removal tool, NOT a generator.',
  '',
  'TASK: Output the SAME product on a clean white background.',
  '',
  'STRICT RULES — DO NOT VIOLATE:',
  '1. DO NOT modify the product packaging in any way.',
  '2. DO NOT add, remove, alter, redraw, or "improve" any text, logo, font, color, shape, illustration, badge, certification mark, barcode, or design element on the product.',
  '3. DO NOT change the product proportions, perspective, lighting, or material appearance.',
  '4. DO NOT fill in or guess details that are unclear in the input — keep them as-is, even if blurry.',
  '5. DO NOT add shadows, reflections, or stylistic effects.',
  '6. DO NOT crop the product. Keep it fully visible, centered, with a small margin.',
  '7. ONLY remove: hands, fingers, store shelves, floors, other products in the background, price tags that are NOT part of the package, room scenes.',
  '',
  'OUTPUT: photorealistic studio product photo, plain white background, the product is the EXACT same product as in the input — pixel-faithful where possible.',
].join('\n');

// ── Helpers ────────────────────────────────────────────────────────

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const isJPEG = buf[0] === 0xff && buf[1] === 0xd8;
  const isPNG =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebP =
    buf.length > 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP';
  if (!isJPEG && !isPNG && !isWebP) {
    throw new Error(
      `Unrecognised image (first bytes: ${buf.slice(0, 8).toString('hex')})`,
    );
  }
  return { buf, mime: isPNG ? 'image/png' : isWebP ? 'image/webp' : 'image/jpeg' };
}

async function analyzeBackground(buffer) {
  const SIZE = 256;
  const { data, info } = await sharp(buffer)
    .resize(SIZE, SIZE, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const samples = [];
  for (let x = 0; x < width; x++) {
    const t = x * channels;
    const b = ((height - 1) * width + x) * channels;
    samples.push([data[t], data[t + 1], data[t + 2]]);
    samples.push([data[b], data[b + 1], data[b + 2]]);
  }
  for (let y = 0; y < height; y++) {
    const l = y * width * channels;
    const r = (y * width + (width - 1)) * channels;
    samples.push([data[l], data[l + 1], data[l + 2]]);
    samples.push([data[r], data[r + 1], data[r + 2]]);
  }
  const n = samples.length;
  let sR = 0, sG = 0, sB = 0;
  for (const [r, g, b] of samples) { sR += r; sG += g; sB += b; }
  const mean = [sR / n, sG / n, sB / n];
  let varSum = 0;
  for (const [r, g, b] of samples) {
    varSum += (r - mean[0]) ** 2 + (g - mean[1]) ** 2 + (b - mean[2]) ** 2;
  }
  const variance = Math.sqrt(varSum / n / 3);
  const lightness = (mean[0] + mean[1] + mean[2]) / 3;
  return {
    variance,
    lightness,
    needsAI: !(variance < VARIANCE_THRESHOLD && lightness > LIGHTNESS_THRESHOLD),
  };
}

// Ensure GPT-image-1 input dimensions / file size are within limits.
// Resize to max 1024 long-side, JPEG q90 — keeps payload small,
// quality plenty for the model.
async function prepareForLLM(buf, mime) {
  const meta = await sharp(buf).metadata();
  const long = Math.max(meta.width || 0, meta.height || 0);
  const pipeline = sharp(buf).rotate(); // EXIF orient
  if (long > 1024) {
    pipeline.resize(1024, 1024, { fit: 'inside' });
  }
  // Convert to PNG to keep maximum fidelity (no JPEG artefacts that
  // could confuse the model). Keeps size ~under 4 MB which is safe
  // for both APIs.
  const out = await pipeline.png().toBuffer();
  return { buf: out, mime: 'image/png' };
}

async function runGPT(prepBuf) {
  // Responses API mit gpt-4.1 (Vision) + image_generation Tool.
  // Der Klassiker `images.edit` Endpoint akzeptiert kein gpt-image-1
  // ohne Verified-Org und fällt sonst auf dall-e-2 zurück (Quality
  // unbrauchbar). Der modernere Pfad: gpt-4.1 sieht das Bild via
  // Vision, ruft dann das image_generation Tool auf, um eine
  // sauber prozessierte PNG-Variante zurückzugeben.
  const dataUrl = `data:image/png;base64,${prepBuf.toString('base64')}`;
  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: PROMPT_TEXT },
          { type: 'input_image', image_url: dataUrl },
        ],
      },
    ],
    tools: [{ type: 'image_generation' }],
  });
  // Find the image_generation_call output, base64 PNG.
  const out = response.output || [];
  for (const item of out) {
    if (item.type === 'image_generation_call' && item.result) {
      return Buffer.from(item.result, 'base64');
    }
  }
  // Some failure modes return text refusal instead of an image.
  const text = (out.find((o) => o.type === 'message')?.content || [])
    .map((c) => c?.text || '')
    .join(' ')
    .slice(0, 200);
  throw new Error(`No image in GPT response${text ? ` (text: ${text})` : ''}`);
}

/**
 * Post-process Gemini's white-background output → transparent PNG.
 *
 * Strategy: connected-component flood-fill from the image edges,
 * marking only pixels that are white-ish AND connected to the
 * border as alpha=0. This is much safer than a global "RGB > 245
 * → transparent" threshold because it preserves white elements
 * INSIDE the product (logos, white text, white packaging accents)
 * while still cleaning the outer background even when the model
 * leaves slight grey tints / JPEG-style halos.
 *
 * Edge softening: pixels that are just barely "white" get a partial
 * alpha (smooth fade) so the cut doesn't read as a hard sticker
 * outline.
 */
async function whiteToTransparent(pngBuffer) {
  const img = sharp(pngBuffer).ensureAlpha();
  const meta = await img.metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) return pngBuffer;

  const { data } = await img
    .raw()
    .toBuffer({ resolveWithObject: true });
  // RGBA pixel layout
  const N = W * H;

  // Threshold: a pixel counts as "white BG candidate" if all channels
  // are ≥ STRICT (definitely background) OR ≥ SOFT (edge zone, gets
  // partial alpha). Below SOFT it stays fully opaque.
  const STRICT = 248;
  const SOFT = 230;

  // Single-pass flood fill from every border pixel that's white-ish.
  // We use a Uint8Array `mark` (0 = unvisited, 1 = bg) plus a stack.
  const mark = new Uint8Array(N);
  const stack = [];

  const isWhiteish = (idx) => {
    const p = idx * 4;
    return data[p] >= SOFT && data[p + 1] >= SOFT && data[p + 2] >= SOFT;
  };

  const seed = (x, y) => {
    const idx = y * W + x;
    if (!mark[idx] && isWhiteish(idx)) {
      mark[idx] = 1;
      stack.push(idx);
    }
  };
  // Seed all 4 borders
  for (let x = 0; x < W; x++) {
    seed(x, 0);
    seed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    seed(0, y);
    seed(W - 1, y);
  }

  // 4-connectivity flood
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % W;
    const y = (idx - x) / W;
    if (x > 0) {
      const n = idx - 1;
      if (!mark[n] && isWhiteish(n)) { mark[n] = 1; stack.push(n); }
    }
    if (x < W - 1) {
      const n = idx + 1;
      if (!mark[n] && isWhiteish(n)) { mark[n] = 1; stack.push(n); }
    }
    if (y > 0) {
      const n = idx - W;
      if (!mark[n] && isWhiteish(n)) { mark[n] = 1; stack.push(n); }
    }
    if (y < H - 1) {
      const n = idx + W;
      if (!mark[n] && isWhiteish(n)) { mark[n] = 1; stack.push(n); }
    }
  }

  // Apply alpha: marked pixels go transparent; for those in the soft
  // zone (SOFT..STRICT) we use a smooth fade so the cut edges don't
  // read as a sticker outline.
  for (let idx = 0; idx < N; idx++) {
    if (!mark[idx]) continue;
    const p = idx * 4;
    const minRGB = Math.min(data[p], data[p + 1], data[p + 2]);
    if (minRGB >= STRICT) {
      data[p + 3] = 0; // fully transparent
    } else {
      // Linear fade SOFT(opaque) → STRICT(transparent)
      const t = (minRGB - SOFT) / (STRICT - SOFT); // 0..1
      data[p + 3] = Math.round((1 - t) * 255);
    }
  }

  return sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
}

/**
 * Trim transparent borders + render two variants for storage:
 *  • `_hd.png`   — full quality, max 1024 long-side, transparent PNG
 *  • `_app.webp` — app-loadable, max 512 long-side, WebP q82, transparent
 */
async function makeVariants(transparentPng) {
  // Auto-trim alpha-only borders to remove residual white margin.
  const trimmed = await sharp(transparentPng).trim().toBuffer();

  const hd = await sharp(trimmed)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  const app = await sharp(trimmed)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toBuffer();

  return { hd, app };
}

async function runGemini(buf, mime) {
  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT_TEXT },
          {
            inlineData: {
              mimeType: mime,
              data: buf.toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };
  const res = await fetch(GEMINI_URL(GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const json = await res.json();
  const candidates = json?.candidates || [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) {
        return Buffer.from(p.inlineData.data, 'base64');
      }
    }
  }
  // Some prompt-blocks return only text; surface that.
  const promptFeedback = JSON.stringify(json?.promptFeedback || json).slice(0, 300);
  throw new Error(`No inlineData in Gemini response. Feedback: ${promptFeedback}`);
}

async function fetchSample() {
  // PRODUCT_TYPE=marken | noname | all (default 'all')
  const wantType = (process.env.PRODUCT_TYPE || 'all').toLowerCase();
  console.log(`🔍 Lade Produkte aus Firestore (type=${wantType}) …`);

  // Pull a generous batch — enough headroom that even after the
  // heuristic skips most of it we can still find SAMPLE_SIZE
  // candidates that need AI.
  const limit = Math.max(800, Math.ceil(SAMPLE_SIZE * 8));
  const tasks = [];
  if (wantType === 'all' || wantType === 'marken') {
    tasks.push(db.collection('markenProdukte').limit(limit).get());
  } else {
    tasks.push(Promise.resolve({ docs: [] }));
  }
  if (wantType === 'all' || wantType === 'noname') {
    tasks.push(db.collection('produkte').limit(limit).get());
  } else {
    tasks.push(Promise.resolve({ docs: [] }));
  }
  const [markenSnap, noNameSnap] = await Promise.all(tasks);
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
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

function generateHTML(results, opts) {
  const showGPT = !!opts?.showGPT;
  const fmtKB = (b) => `${(b / 1024).toFixed(0)} KB`;
  const cells = results
    .map((r) => {
      const orig = `${r.baseName}_original.jpg`;
      const rawCell = r.gemError
        ? `<div class="img-wrap err"><div class="msg">GEMINI FAIL<br/><small>${escapeHTML(r.gemError)}</small></div></div>`
        : r.gemOk
          ? `<div class="img-wrap"><img src="${r.baseName}_gemini_raw.png"/><div class="lbl">Gemini RAW (weiß)</div></div>`
          : `<div class="img-wrap skip"><div class="msg">— skip —</div></div>`;
      const hdCell = r.gemOk
        ? `<div class="img-wrap"><img src="${r.baseName}_hd.png"/><div class="lbl">HD (PNG, transparent)</div><div class="size">${fmtKB(r.hdSize)}</div></div>`
        : `<div class="img-wrap skip"><div class="msg">— skip —</div></div>`;
      const appCell = r.gemOk
        ? `<div class="img-wrap"><img src="${r.baseName}_app.webp"/><div class="lbl">APP (WebP, transparent, ≤512px)</div><div class="size">${fmtKB(r.appSize)}</div></div>`
        : `<div class="img-wrap skip"><div class="msg">— skip —</div></div>`;
      const gptCell = !showGPT
        ? ''
        : r.gptError
          ? `<div class="img-wrap err"><div class="msg">GPT FAIL<br/><small>${escapeHTML(r.gptError)}</small></div></div>`
          : r.gptOk
            ? `<div class="img-wrap"><img src="${r.baseName}_gpt.png"/><div class="lbl">GPT-4o</div></div>`
            : `<div class="img-wrap skip"><div class="msg">— skip —</div></div>`;
      return `
<div class="card">
  <div class="head">
    <span class="meta">${r._type} · v=${r.heuristic.variance.toFixed(1)} · L=${r.heuristic.lightness.toFixed(0)}</span>
  </div>
  <div class="title">${escapeHTML(r.name)}</div>
  <div class="row row-${showGPT ? 5 : 4}">
    <div class="img-wrap"><img src="${orig}"/><div class="lbl">Original</div></div>
    ${rawCell}
    ${hdCell}
    ${appCell}
    ${gptCell}
  </div>
  <div class="id">${r.id}</div>
</div>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="de"><head>
<meta charset="utf-8"><title>BG-Removal LLM-Vergleich</title>
<style>
  body { font: 14px/1.4 -apple-system, sans-serif; background: #f4f5f7; padding: 24px; color: #191c1d; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .summary { color: #5c6769; margin-bottom: 24px; }
  .grid { display: grid; gap: 18px; grid-template-columns: 1fr; }
  .card { background: #fff; border-radius: 14px; padding: 14px; box-shadow: 0 2px 8px rgba(0,0,0,.05); }
  .head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; font-size: 11px; color: #5c6769; }
  .title { font-weight: 700; font-size: 15px; margin-bottom: 10px; line-height: 1.3; }
  .id { font-family: monospace; font-size: 10px; color: #99a; margin-top: 8px; }
  .row { display: grid; gap: 10px; }
  .row.row-2 { grid-template-columns: 1fr 1fr; }
  .row.row-3 { grid-template-columns: 1fr 1fr 1fr; }
  .row.row-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
  .row.row-5 { grid-template-columns: 1fr 1fr 1fr 1fr 1fr; }
  .img-wrap .size { position: absolute; bottom: 4px; right: 6px; font-size: 9px; font-weight: 700; color: #fff; background: rgba(0,0,0,.6); padding: 1px 6px; border-radius: 4px; letter-spacing: .04em; }
  .img-wrap { background: linear-gradient(45deg, #ddd 25%, transparent 25%, transparent 75%, #ddd 75%), linear-gradient(45deg, #ddd 25%, #fff 25%, #fff 75%, #ddd 75%); background-size: 16px 16px; background-position: 0 0, 8px 8px; border-radius: 8px; aspect-ratio: 1; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; }
  .img-wrap img { width: 100%; height: 100%; object-fit: contain; }
  .img-wrap.skip { background: #f5f7f8; }
  .img-wrap.err { background: #fdecea; border: 1px solid #f5c6cb; }
  .img-wrap .lbl { position: absolute; top: 4px; left: 6px; font-size: 9px; font-weight: 800; color: #fff; background: rgba(0,0,0,.55); padding: 1px 6px; border-radius: 4px; letter-spacing: .04em; text-transform: uppercase; }
  .img-wrap .msg { color: #555; font-size: 11px; padding: 12px; text-align: center; }
  .img-wrap .msg small { color: #c00; font-size: 9px; display: block; margin-top: 4px; }
</style></head><body>
<h1>BG-Removal LLM-Vergleich — ${results.length} Produkte</h1>
<div class="summary">
  GPT-image-1 ok: <b>${results.filter((r) => r.gptOk).length}</b> / fail: <b>${results.filter((r) => r.gptError).length}</b> ·
  Gemini ok: <b>${results.filter((r) => r.gemOk).length}</b> / fail: <b>${results.filter((r) => r.gemError).length}</b>
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

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`📁 Output: ${OUT_DIR}`);
  console.log(`🤖 GPT model: gpt-image-1`);
  console.log(`🤖 Gemini model: ${GEMINI_MODEL}`);

  // Pull a generous random sample, filter to ones the heuristic flags
  // as "needs AI" — and stop once we have SAMPLE_SIZE of them.
  const all = await fetchSample();
  const t0 = Date.now();
  const results = [];

  for (const p of all) {
    if (results.length >= SAMPLE_SIZE) break;
    const baseName = `${p._type}_${p.id.slice(0, 16)}`;
    const result = { ...p, baseName };
    process.stdout.write(`[${String(results.length + 1).padStart(2, '0')}/${SAMPLE_SIZE}] ${p._type}/${p.id.slice(0, 12)} … `);
    try {
      const { buf } = await downloadImage(p.bild);
      result.heuristic = await analyzeBackground(buf);
      if (!result.heuristic.needsAI) {
        process.stdout.write(`v=${result.heuristic.variance.toFixed(1)} → SKIP (clean)\n`);
        continue; // don't waste $ on already-clean images
      }
      // Save the original (for the HTML)
      const origPath = path.join(OUT_DIR, `${baseName}_original.jpg`);
      fs.writeFileSync(origPath, buf);

      // Prepare a normalised PNG for both models (1024 long side)
      const prep = await prepareForLLM(buf, 'image/jpeg');
      const prepPath = path.join(OUT_DIR, `${baseName}_in.png`);
      fs.writeFileSync(prepPath, prep.buf);

      process.stdout.write(`v=${result.heuristic.variance.toFixed(1)} → `);

      // ── GPT (optional, nur wenn OPENAI_API_KEY gesetzt) ──
      if (HAS_OPENAI) {
        try {
          const gptBuf = await runGPT(prep.buf);
          fs.writeFileSync(
            path.join(OUT_DIR, `${baseName}_gpt.png`),
            gptBuf,
          );
          result.gptOk = true;
          process.stdout.write('GPT✓ ');
        } catch (err) {
          result.gptError = err.message;
          process.stdout.write(`GPT✗(${err.message.slice(0, 80)}) `);
        }
      }

      // ── Gemini ──
      try {
        const gemRaw = await runGemini(prep.buf, prep.mime);
        // Save raw model output for debugging — contains the original
        // white background, useful to inspect Gemini's quality before
        // post-processing.
        fs.writeFileSync(
          path.join(OUT_DIR, `${baseName}_gemini_raw.png`),
          gemRaw,
        );
        // Convert white BG → transparent (edge-flood fill)
        const transparent = await whiteToTransparent(gemRaw);
        // Generate HD + app-optimised variants
        const { hd, app } = await makeVariants(transparent);
        fs.writeFileSync(path.join(OUT_DIR, `${baseName}_hd.png`), hd);
        fs.writeFileSync(path.join(OUT_DIR, `${baseName}_app.webp`), app);
        result.gemOk = true;
        result.hdSize = hd.length;
        result.appSize = app.length;
        process.stdout.write(
          `GEM✓ HD=${(hd.length / 1024).toFixed(0)}KB APP=${(app.length / 1024).toFixed(0)}KB\n`,
        );
      } catch (err) {
        result.gemError = err.message;
        process.stdout.write(`GEM✗(${err.message.slice(0, 100)})\n`);
      }

      // Cleanup the prep image
      try { fs.unlinkSync(prepPath); } catch { /* ignore */ }
      results.push(result);
    } catch (err) {
      result.fetchError = err.message;
      process.stdout.write(`FAIL: ${err.message}\n`);
      // don't push items that errored before AI calls
    }
  }

  const html = generateHTML(results, { showGPT: HAS_OPENAI });
  fs.writeFileSync(path.join(OUT_DIR, 'preview.html'), html);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const gptOk = results.filter((r) => r.gptOk).length;
  const gemOk = results.filter((r) => r.gemOk).length;
  const gptCost = gptOk * 0.04;
  const gemCost = gemOk * 0.039;
  console.log('\n────────────────────────────────────────');
  console.log(`✅ Fertig in ${elapsed}s`);
  if (HAS_OPENAI) {
    console.log(`   GPT-4o ok:        ${gptOk}/${results.length}   (~$${gptCost.toFixed(2)})`);
  }
  console.log(`   Gemini 2.5 ok:    ${gemOk}/${results.length}   (~$${gemCost.toFixed(2)})`);
  console.log(`   Preview: open ${path.join(OUT_DIR, 'preview.html')}`);
  console.log('────────────────────────────────────────');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n💥 Fatal:', err);
  process.exit(1);
});
