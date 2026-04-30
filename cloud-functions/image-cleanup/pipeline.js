/**
 * Image-Cleanup Pipeline — single shared module used by:
 *   • the live Cloud Function triggers (onCreate / onUpdate)
 *   • the one-shot backfill script (./backfill.js)
 *
 * Pipeline steps per product:
 *   1. Read the product doc, get `bild`-URL.
 *   2. Skip if `bildCleanVersion === PIPELINE_VERSION` (already done).
 *   3. Download the original image bytes.
 *   4. Heuristic — border-pixel variance + lightness:
 *        already-clean studio shot → skip Gemini, just transcode.
 *        else → Gemini 2.5 Flash Image cleans the background.
 *   5. Sharp post-processing:
 *        flood-fill white-to-transparent from edges,
 *        auto-trim alpha borders,
 *        resize to ≤ 512 px long-side, encode WebP q82.
 *   6. Upload to:
 *        productimagesclean/brandproducts/{id}.webp     (markenProdukte)
 *        productimagesclean/nonameproducts/{id}.webp    (produkte)
 *   7. Firestore-Update: `bildClean: <url>`,
 *      `bildCleanVersion: PIPELINE_VERSION`, `bildCleanSource: 'gemini'|'heuristic-skip'`.
 *      On failure: `bildCleanError: <reason>` (the original `bild` field is NEVER touched).
 *
 * IMPORTANT — the original image and the original `bild` field are
 * NEVER modified. We only WRITE to:
 *   • Storage path `productimagesclean/...` (a separate folder)
 *   • Firestore field `bildClean*` (additive)
 * A hard guard refuses any write outside `productimagesclean/`.
 */

const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const sharp = require('sharp');
// `heic-convert` is a pure-JS HEIF decoder (libheif-js / wasm) used
// to handle iPhone-sourced HEIC images. Sharp 0.33.x advertises HEIF
// format support but doesn't bundle a decoder on most stacks, so we
// fall back to this when we detect the `....ftyp...heic/heix/mif1`
// magic bytes. Synchronous-style API: pass a buffer, get JPEG back.
const heicConvert = require('heic-convert');

// ─── Constants ─────────────────────────────────────────────────────

/**
 * Bump this when the pipeline changes shape (prompt tweaks, new
 * post-processing steps, different output dimensions). Items whose
 * `bildCleanVersion` is below the current value will be re-processed
 * by the backfill script. Live triggers always run on the latest.
 *
 * Version log:
 *   v1 — initial. Strict-anti-halluzination prompt, white-only flood-fill.
 *   v2 — Stricter prompt + any-color flood-fill for transparency.
 *        Worked technically but Gemini's non-determinism still produced
 *        occasional bad outputs (black BG, side-view of top-down items)
 *        that the flood-fill couldn't always rescue.
 *   v3 — Pragmatic simplification: keep Gemini's white-BG PNG as-is.
 *        No flood-fill, no transparency.
 *   v4 — Combine v2 transparency with tight cropping. After flood-fill
 *        we compute the alpha bounding box manually, then center the
 *        product in a square canvas with a small padding ratio.
 *        BUG: flood-fill bleeds through white product areas (e.g.
 *        Fruchtgurt's white lid connects to the white BG → entire
 *        product gets marked transparent).
 *   v5 — Bounded flood-fill + zoom prompt. Worked technically but
 *        users weren't sure if outputs were transparent (browsers
 *        rendered alpha as dark on dark themes).
 *   v6 — White-BG-only, three variants ({id}_hq.png, .png, .webp).
 *   v7 — Same three variants but TRANSPARENT BG. Solves two problems:
 *          • Excessive white margins (different per Gemini output)
 *          • Dark-mode rendering (white BG looked bad on dark surfaces)
 *        Pipeline addition: after Gemini's white-BG output, we
 *          1. sharp.trim() against pure white → tight bbox of product
 *          2. extend with 4% white padding → controlled "moat"
 *          3. bounded flood-fill (depth 6%) → padding becomes alpha=0
 *          4. resize + encode each variant
 *        The flood-fill is bounded so white ELEMENTS inside the
 *        product (lids, accents) stay opaque.
 *
 *        v6 → v7 conversion is cheap: download bildCleanHq, run
 *        the post-process locally, re-upload. NO new Gemini calls.
 *        See `repostprocess.js`.
 */
const PIPELINE_VERSION = 8;

const ALLOWED_STORAGE_PREFIX = 'productimagesclean/';
const COLLECTION_TO_SUBFOLDER = {
  markenProdukte: 'brandproducts',
  produkte: 'nonameproducts',
};

// Heuristic thresholds — match the ones validated in
// scripts/test-bg-llm.js. ~50 % skip-rate observed on real catalog.
const VARIANCE_THRESHOLD = 8;
const LIGHTNESS_THRESHOLD = 240;

// Uniform-background-to-transparent. Instead of hard-coding "white",
// we sample the mean border colour at runtime and mark any flood-fill
// reachable pixel within the tolerance bands as transparent. This
// correctly handles black, grey, blue, etc. backgrounds that Gemini
// occasionally produces despite the prompt.
const BG_DIST_STRICT = 16;  // pixel within this Euclidean RGB distance from border-mean → fully transparent
const BG_DIST_SOFT   = 36;  // softer band — partial alpha for smooth edges
// Skip flood-fill entirely if the border itself is non-uniform: a
// border with high colour variance means the input doesn't have a
// solid background to remove (e.g. Gemini already gave us a clean
// product on transparent or scene-blended). In that case we trust
// Gemini's output as-is and just transcode.
const BORDER_VARIANCE_MAX = 22; // RGB stddev across 8 sampled border patches

// v5: cap flood-fill propagation depth as a fraction of the SHORTER
// image side. This prevents the fill from "leaking" through white
// product areas (e.g. yogurt-cup lids, white packaging accents) into
// the rest of the product when those areas happen to touch the
// border colour. With Gemini rendering the product ≥ 90 % of the
// frame, the actual BG margin is ≤ 5 % per side anyway, so 6 % gives
// us a comfortable buffer.
const FLOOD_DEPTH_RATIO = 0.06;

// v6: three output variants per product.
const HQ_MAX_PX = 1600;     // hq.png — high-quality reference (lossless PNG)
const PNG_MAX_PX = 1024;    // .png — medium PNG
const APP_MAX_PX = 512;     // .webp — fast-loading app variant
const WEBP_QUALITY = 82;
const WEBP_ALPHA_QUALITY = 90; // unused in v6 (no alpha) but kept for forward-compat

// Gemini config — model overridable via env so we can A/B different
// versions (e.g. gemini-3-pro-image-preview) without redeploying.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';

// Strict anti-hallucination prompt. Tightened in v2 after observing
// Gemini occasionally rendering non-white backgrounds (black, dark
// gray) AND swapping the camera angle (top-down → side view).
//
// NOTE: Gemini 2.5 Flash Image does NOT output true alpha-channel
// transparency — every pixel comes back opaque regardless of what
// we ask for. So we always demand PURE WHITE here and rely on our
// own flood-fill post-process (`uniformBgToTransparent` below) to
// produce the final transparent WebP.
// v6 prompt — restored the v1 "super Bilder" baseline (the prompt
// that produced great results in early tests) + framing instruction
// for zoom/center.
const PROMPT_TEXT = [
  'You are a product-photo background-removal tool, NOT a generator.',
  '',
  'TASK: Output the SAME product on a clean PURE WHITE (#FFFFFF) background. Studio-quality e-commerce product shot, like an Amazon product thumbnail.',
  '',
  'IMPORTANT INPUT CONTEXT:',
  'The input is a real-world snapshot of a grocery package. It commonly includes a HUMAN HAND holding the package, a fingertip touching it, or a hand visible at the edge of the frame. The hand is NOT part of the product. Your job is the SAME job a professional product retoucher would do: erase the hand and reproduce the product clean, on a white studio background. NO PERSON appears in your output. NO body part. NO skin. NO fingers. NO arm.',
  '',
  'FRAMING:',
  '• Center the product in the frame.',
  '• The product fills ~90% of the canvas — minimal white margin (~5% on each side).',
  '• Choose an aspect ratio that fits the product naturally (portrait, landscape, or square — whatever matches the product\'s shape).',
  '• Bring the product CLOSE — no large empty white space around it.',
  '',
  'BACKGROUND — MANDATORY:',
  'Pure solid white (#FFFFFF) only. Flat, no gradient, no texture, no shadow, no pattern. NEVER black, NEVER gray, NEVER coloured.',
  '',
  'CAMERA ANGLE — MANDATORY:',
  'Preserve the EXACT camera angle and perspective from the input. If shot from above, output is also from above. If from the side, from the side. Do NOT rotate or re-photograph.',
  '',
  'STRICT RULES — DO NOT VIOLATE:',
  '1. DO NOT modify the product packaging in any way.',
  '2. DO NOT add, remove, alter, redraw, or "improve" any text, logo, font, color, shape, illustration, badge, certification mark, barcode, or design element on the product.',
  '3. DO NOT change the product proportions, lighting, or material appearance.',
  '4. DO NOT fill in or guess details that are unclear in the input — keep them as-is, even if blurry.',
  '5. DO NOT add shadows, reflections, or stylistic effects.',
  '6. Keep the product fully visible — no cropping into the product itself.',
  '7. DO NOT include any hand, finger, arm, or person in the output. If the input shows a hand holding the package, render the package alone.',
  '',
  'WHAT TO REMOVE: hands, fingers, arms, skin, people, store shelves, floors, ceilings, other products in the background, price tags NOT on the package, room scenes, signage, walls. Replace with pure white.',
  '',
  'OUTPUT: photorealistic studio product photo, pure white background, product centered and filling ~90% of the frame, SAME camera angle as input, the product is the EXACT same product as in the input — pixel-faithful where possible. NO PERSON, NO HAND, NO BODY PART in the output.',
].join('\n');

// ─── Image-format magic-byte sniff ─────────────────────────────────
//
// Firebase Storage occasionally serves `application/octet-stream` for
// product images, so we don't trust the Content-Type header — we
// inspect the first bytes instead.

function isImage(buf) {
  if (buf.length < 12) return false;
  const isJPEG = buf[0] === 0xff && buf[1] === 0xd8;
  const isPNG =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isWebP =
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP';
  const isGIF = buf.slice(0, 3).toString('ascii') === 'GIF';
  return isJPEG || isPNG || isWebP || isGIF || isAppleContainer(buf);
}

// ISOBMFF-container detection (HEIC/HEIF/AVIF). Magic bytes pattern:
// `....ftyp` at offset 4 followed by an ISOBMFF brand at offset 8.
// We further distinguish HEIC vs AVIF because sharp can decode AVIF
// natively but NOT HEIC (HEVC codec missing in libvips builds), so
// the two need different decode paths.
function readFtypBrand(buf) {
  if (buf.length < 12) return null;
  if (buf.slice(4, 8).toString('ascii') !== 'ftyp') return null;
  return buf.slice(8, 12).toString('ascii');
}
function isHeic(buf) {
  // HEIC and friends — HEVC-coded variants only. AVIF has its own path.
  const b = readFtypBrand(buf);
  if (!b) return false;
  return /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1)$/.test(b);
}
function isAvif(buf) {
  return readFtypBrand(buf) === 'avif';
}
function isAppleContainer(buf) {
  return isHeic(buf) || isAvif(buf);
}

// Convert an Apple-camera-output container (HEIC or AVIF) to JPEG so
// the rest of the pipeline can run unchanged. Sharp on the Cloud
// Functions runtime decodes AVIF natively (libvips ships an AV1
// decoder) but NOT HEIC (no HEVC decoder), so we branch:
//   • HEIC → heic-convert (libheif-js + wasm, pure-JS, ~900 ms/image)
//   • AVIF → sharp.toFormat('jpeg').toBuffer() (~50 ms/image)
async function appleContainerToJpeg(buf) {
  if (isAvif(buf)) {
    return sharp(buf).rotate().toFormat('jpeg', { quality: 92 }).toBuffer();
  }
  // Default to HEIC path.
  const out = await heicConvert({
    buffer: buf,
    format: 'JPEG',
    quality: 0.92,
  });
  return Buffer.from(out);
}

// ─── Heuristic: is the source already clean? ───────────────────────

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
    needsAI: !(
      variance < VARIANCE_THRESHOLD && lightness > LIGHTNESS_THRESHOLD
    ),
  };
}

// ─── Gemini call ───────────────────────────────────────────────────

async function runGemini(buffer, geminiClient, overrides = {}) {
  // Per-call overrides used by `retry-failures.js` to swap the
  // prompt and/or the model for items the default config couldn't
  // process (typically hand-in-frame photos that hit IMAGE_OTHER).
  // Passing nothing here keeps the live-trigger behaviour stable.
  const promptText = overrides.promptText || PROMPT_TEXT;
  const model = overrides.model || GEMINI_MODEL;
  const responseModalities = overrides.responseModalities || ['IMAGE'];

  const response = await geminiClient.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: 'image/png',
              data: buffer.toString('base64'),
            },
          },
        ],
      },
    ],
    config: {
      responseModalities,
      // Loosen safety filters as far as the API allows. The default
      // thresholds reject ~10 % of our real-world product photos
      // because the input shows a HAND HOLDING the package — Gemini
      // tags that as person-imagery and bails (`finishReason:
      // IMAGE_OTHER` or `IMAGE_SAFETY`). Setting BLOCK_NONE on all
      // harm categories keeps the model from refusing benign
      // grocery-shelf snapshots while still leaving Google's
      // hard-coded image-output policy in place (CSAM etc., which
      // we don't trigger).
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY',    threshold: 'BLOCK_NONE' },
      ],
    },
  });
  const candidates = response?.candidates || [];
  for (const cand of candidates) {
    const parts = cand?.content?.parts || [];
    for (const p of parts) {
      if (p?.inlineData?.data) {
        return Buffer.from(p.inlineData.data, 'base64');
      }
    }
  }
  const reason = candidates[0]?.finishReason || 'UNKNOWN';
  throw new Error(`Gemini returned no image (finishReason=${reason})`);
}

// ─── Uniform-background-to-transparent flood fill ─────────────────
//
// Strategy: connected-component flood-fill from the image edges,
// using the MEAN BORDER COLOUR as reference. Pixels reachable from
// the border AND within an Euclidean RGB distance threshold of the
// mean border colour become transparent. This handles any uniform
// background colour (white, black, grey, coloured) — which is
// important because Gemini occasionally produces non-white outputs.
//
// Pixels INSIDE the product silhouette stay opaque even if they
// happen to have the same colour as the background (e.g. white text
// on the package), because the flood-fill only reaches them via the
// border.
//
// Safety net: if the border itself is highly varied (no uniform
// background to remove — e.g. Gemini blended with scenery, or input
// already has a non-flat backdrop), we skip the alpha pass entirely
// and trust whatever Gemini gave us.
async function uniformBgToTransparent(pngBuffer) {
  const img = sharp(pngBuffer).ensureAlpha();
  const meta = await img.metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) return pngBuffer;

  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const N = W * H;

  // ── Fast path: already transparent? ──────────────────────────
  // If Gemini delivered alpha-channel transparency directly (which
  // 2.5 Flash Image can do), the four image corners will have
  // alpha=0. Trust the model — skip the flood-fill entirely so we
  // don't risk eating into the product silhouette.
  const cornerAlphas = [
    data[(0 * W + 0) * 4 + 3],
    data[(0 * W + W - 1) * 4 + 3],
    data[((H - 1) * W + 0) * 4 + 3],
    data[((H - 1) * W + W - 1) * 4 + 3],
  ];
  const allCornersTransparent = cornerAlphas.every((a) => a < 16);
  if (allCornersTransparent) {
    return pngBuffer;
  }

  // ── Sample the border ────────────────────────────────────────
  // Take every Nth pixel along all four edges. Compute mean RGB and
  // standard deviation. If the deviation is too high → the border
  // isn't uniform → skip the flood-fill entirely.
  const samples = [];
  const STEP = Math.max(1, Math.floor(Math.min(W, H) / 64));
  for (let x = 0; x < W; x += STEP) {
    const t = x * 4;
    const b = ((H - 1) * W + x) * 4;
    samples.push([data[t], data[t + 1], data[t + 2]]);
    samples.push([data[b], data[b + 1], data[b + 2]]);
  }
  for (let y = 0; y < H; y += STEP) {
    const l = (y * W) * 4;
    const r = (y * W + (W - 1)) * 4;
    samples.push([data[l], data[l + 1], data[l + 2]]);
    samples.push([data[r], data[r + 1], data[r + 2]]);
  }
  const sn = samples.length;
  let sR = 0, sG = 0, sB = 0;
  for (const [r, g, b] of samples) { sR += r; sG += g; sB += b; }
  const meanR = sR / sn, meanG = sG / sn, meanB = sB / sn;
  let varSum = 0;
  for (const [r, g, b] of samples) {
    varSum +=
      (r - meanR) ** 2 + (g - meanG) ** 2 + (b - meanB) ** 2;
  }
  const borderStdDev = Math.sqrt(varSum / sn / 3);
  if (borderStdDev > BORDER_VARIANCE_MAX) {
    // Non-uniform border — don't risk eating into the product.
    // Return as-is (the upstream encoder will emit it as opaque
    // PNG and the consumer sees the un-cropped Gemini output).
    return pngBuffer;
  }

  // ── Bounded flood-fill from the border ─────────────────────
  // Threshold helper: how close is a pixel to the mean border colour?
  const distToBg = (idx) => {
    const p = idx * 4;
    const dr = data[p] - meanR;
    const dg = data[p + 1] - meanG;
    const db = data[p + 2] - meanB;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };
  const isBgish = (idx) => distToBg(idx) <= BG_DIST_SOFT;

  // v5: cap propagation depth so the flood can't leak through white
  // accents inside the product (e.g. yogurt-cup lids that touch the
  // white BG and would otherwise drag the entire interior to alpha=0).
  // Pixels are only considered "background" if they're within
  // `MAX_DEPTH` of the closest border edge.
  const MAX_DEPTH = Math.max(8, Math.round(Math.min(W, H) * FLOOD_DEPTH_RATIO));

  const isWithinDepth = (x, y) =>
    x < MAX_DEPTH || y < MAX_DEPTH ||
    x >= W - MAX_DEPTH || y >= H - MAX_DEPTH;

  const mark = new Uint8Array(N);
  const stack = [];
  const seed = (x, y) => {
    const idx = y * W + x;
    if (!mark[idx] && isBgish(idx)) { mark[idx] = 1; stack.push(idx); }
  };
  for (let x = 0; x < W; x++) {
    seed(x, 0);
    seed(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    seed(0, y);
    seed(W - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % W;
    const y = (idx - x) / W;
    // 4-connectivity, but only propagate into pixels within MAX_DEPTH
    // of an outer edge — this is the depth bound that stops the fill
    // from reaching the centre of the product.
    if (x > 0) {
      const n = idx - 1;
      const nx = x - 1;
      if (!mark[n] && isWithinDepth(nx, y) && isBgish(n)) { mark[n] = 1; stack.push(n); }
    }
    if (x < W - 1) {
      const n = idx + 1;
      const nx = x + 1;
      if (!mark[n] && isWithinDepth(nx, y) && isBgish(n)) { mark[n] = 1; stack.push(n); }
    }
    if (y > 0) {
      const n = idx - W;
      const ny = y - 1;
      if (!mark[n] && isWithinDepth(x, ny) && isBgish(n)) { mark[n] = 1; stack.push(n); }
    }
    if (y < H - 1) {
      const n = idx + W;
      const ny = y + 1;
      if (!mark[n] && isWithinDepth(x, ny) && isBgish(n)) { mark[n] = 1; stack.push(n); }
    }
  }

  // ── Apply alpha with smooth edge fade ───────────────────────
  // Pixels with distance ≤ BG_DIST_STRICT  → fully transparent
  // Pixels with distance ≤ BG_DIST_SOFT   → linear fade
  for (let idx = 0; idx < N; idx++) {
    if (!mark[idx]) continue;
    const d = distToBg(idx);
    if (d <= BG_DIST_STRICT) {
      data[idx * 4 + 3] = 0;
    } else {
      const t = (d - BG_DIST_STRICT) / (BG_DIST_SOFT - BG_DIST_STRICT);
      data[idx * 4 + 3] = Math.round(t * 255);
    }
  }
  return sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
}

// Backwards-compat alias. Old callers (and tests) that imported the
// white-only function still work — but everyone now goes through the
// any-colour version.
const whiteToTransparent = uniformBgToTransparent;

/**
 * v6: Gemini does the framing (centered, fills ~90%, white BG). We
 * just resize and encode three variants — no flood-fill, no trim,
 * no transparency.
 */

async function tightCropAndPad_unused(transparentPng) {
  const img = sharp(transparentPng).ensureAlpha();
  const meta = await img.metadata();
  const W = meta.width || 0;
  const H = meta.height || 0;
  if (!W || !H) return transparentPng;

  const { data } = await img.raw().toBuffer({ resolveWithObject: true });

  // Find bounding box of mostly-opaque pixels (alpha > 16). Walk edges
  // inward — much faster than scanning every pixel.
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    let rowHasOpaque = false;
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        rowHasOpaque = true;
      }
    }
    if (rowHasOpaque) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return transparentPng;

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const longSide = Math.max(cropW, cropH);
  const pad = Math.round(longSide * PADDING_RATIO);
  const target = longSide + pad * 2;
  // Center: fill the difference on the short side equally.
  const offsetX = Math.floor((target - cropW) / 2);
  const offsetY = Math.floor((target - cropH) / 2);

  return sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: cropW, height: cropH })
    .extend({
      top: offsetY,
      bottom: target - cropH - offsetY,
      left: offsetX,
      right: target - cropW - offsetX,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/**
 * v7: produce three transparent-BG variants from a white-BG source.
 *
 * Pipeline:
 *   1. EXIF-rotate the source.
 *   2. sharp.trim() against pure white — gets the tight product bbox.
 *      Threshold 8 means pixels within 8 of pure white count as BG.
 *   3. Extend with WHITE padding (~4% of long side). This creates a
 *      controlled "moat" around the product so the bounded flood-
 *      fill in step 4 has a clean band to work with.
 *   4. uniformBgToTransparent — bounded flood-fill (max 6% depth) from
 *      the border. The 4% padding < 6% depth, so the padding is
 *      reliably reached and turned alpha=0; depth stops before
 *      reaching the actual product.
 *   5. Resize + encode each variant, preserving alpha throughout.
 *
 * Inputs that are already transparent (e.g. re-process pass over a
 * v7 output) are detected by uniformBgToTransparent's "all corners
 * transparent" early-return and pass through untouched.
 */
async function renderVariants(sourcePng) {
  const rotated = await sharp(sourcePng).rotate().toBuffer();

  // Step 2: trim white margins.
  let trimmed;
  try {
    trimmed = await sharp(rotated)
      .trim({ background: { r: 255, g: 255, b: 255 }, threshold: 8 })
      .toBuffer();
  } catch (_e) {
    // sharp.trim() throws if it can't find any non-bg pixel — extremely
    // unlikely in practice, but guard anyway.
    trimmed = rotated;
  }

  // Step 3: add a 4% white padding (the "moat").
  const meta = await sharp(trimmed).metadata();
  const long = Math.max(meta.width || 0, meta.height || 0);
  const pad = Math.max(8, Math.round(long * 0.04));
  const padded = await sharp(trimmed)
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toBuffer();

  // Step 4: turn the moat transparent (bounded flood-fill).
  const transparent = await uniformBgToTransparent(padded);

  // Step 5: encode three variants.
  const hq = await sharp(transparent)
    .resize(HQ_MAX_PX, HQ_MAX_PX, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  const png = await sharp(transparent)
    .resize(PNG_MAX_PX, PNG_MAX_PX, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  const webp = await sharp(transparent)
    .resize(APP_MAX_PX, APP_MAX_PX, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({
      quality: WEBP_QUALITY,
      alphaQuality: WEBP_ALPHA_QUALITY,
      effort: 6,
    })
    .toBuffer();

  return { hq, png, webp };
}

// ─── Storage upload ────────────────────────────────────────────────

/**
 * Uploads a single buffer to Firebase Storage and returns a public
 * download URL. Refuses to write outside `productimagesclean/`.
 */
async function uploadToStorage(buf, storagePath, bucket, contentType) {
  if (!storagePath.startsWith(ALLOWED_STORAGE_PREFIX)) {
    throw new Error(
      `Refused to write outside ${ALLOWED_STORAGE_PREFIX}: ${storagePath}`,
    );
  }
  const file = bucket.file(storagePath);
  await file.save(buf, {
    contentType,
    public: true,
    metadata: {
      // Pipeline-version-tagged so a CDN cache stuck on an old version
      // still reflects the v-bump in HTTP cache keys: re-uploads with
      // the same storagePath replace the file, but the version metadata
      // helps when debugging.
      cacheControl: 'public, max-age=31536000, immutable',
      // `optimized: 'true'` is a sentinel for the legacy
      // `optimizeImage` Cloud Function (deployed June 2024, listens on
      // ALL bucket finalized events). Without it, that function
      // downloads our transparent PNG/WebP, re-encodes to opaque
      // JPEG quality 40, and overwrites the file → all transparency is
      // lost and the user sees a coloured frame around products.
      // Setting the flag here makes optimizeImage skip our outputs.
      metadata: {
        pipelineVersion: String(PIPELINE_VERSION),
        optimized: 'true',
      },
    },
    resumable: false,
  });
  const projectBucket = bucket.name;
  const encoded = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${projectBucket}/o/${encoded}?alt=media`;
}

/**
 * Uploads all three v6 variants in parallel. Returns the three URLs.
 */
async function uploadAllVariants({ hq, png, webp }, basePath, bucket) {
  const [hqUrl, pngUrl, webpUrl] = await Promise.all([
    uploadToStorage(hq, `${basePath}_hq.png`, bucket, 'image/png'),
    uploadToStorage(png, `${basePath}.png`, bucket, 'image/png'),
    uploadToStorage(webp, `${basePath}.webp`, bucket, 'image/webp'),
  ]);
  return { hq: hqUrl, png: pngUrl, webp: webpUrl };
}

// ─── Public entry point ────────────────────────────────────────────

/**
 * Process one product. The caller passes:
 *   • db        — Firestore instance (admin.firestore())
 *   • bucket    — Storage bucket (admin.storage().bucket())
 *   • genAI     — GoogleGenAI client
 *   • collection — 'markenProdukte' or 'produkte'
 *   • productId
 *   • options:
 *       force       — re-process even if version matches
 *       onProgress  — callback(stepName) for backfill logging
 *
 * Returns: {
 *   status: 'cleaned' | 'heuristic-skip' | 'cached' | 'no-source' | 'error',
 *   bildClean?: string,
 *   reason?: string,    // when status === 'error'
 *   variance?: number,  // when heuristic ran
 *   lightness?: number,
 * }
 *
 * NEVER throws on individual processing failures — failures land in
 * Firestore as `bildCleanError` and the original `bild` is left as-is
 * so the app keeps showing it. The function only throws on
 * programmer errors (invalid input, refused storage path).
 */
async function processProductImage({
  db,
  bucket,
  genAI,
  collection,
  productId,
  options = {},
}) {
  if (!COLLECTION_TO_SUBFOLDER[collection]) {
    throw new Error(`Unknown collection: ${collection}`);
  }
  const subfolder = COLLECTION_TO_SUBFOLDER[collection];
  const docRef = db.collection(collection).doc(productId);
  const snap = await docRef.get();
  if (!snap.exists) {
    return { status: 'no-source', reason: 'doc not found' };
  }
  const data = snap.data();
  const bildUrl = data?.bild;
  if (!bildUrl || typeof bildUrl !== 'string' || !bildUrl.startsWith('http')) {
    return { status: 'no-source', reason: 'no bild URL' };
  }

  // Idempotence — already done with the current pipeline version?
  const force = !!options.force;
  if (
    !force &&
    data.bildClean &&
    data.bildCleanVersion === PIPELINE_VERSION
  ) {
    return {
      status: 'cached',
      bildClean: data.bildClean,
      bildCleanHq: data.bildCleanHq,
      bildCleanPng: data.bildCleanPng,
    };
  }

  const onProgress = options.onProgress || (() => {});
  const basePath = `${ALLOWED_STORAGE_PREFIX}${subfolder}/${productId}`;

  try {
    onProgress('download');
    const res = await fetch(bildUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching bild`);
    let original = Buffer.from(await res.arrayBuffer());
    if (!isImage(original)) {
      throw new Error(
        `bild is not a recognised image (first bytes: ${original
          .slice(0, 8)
          .toString('hex')})`,
      );
    }
    // ─── HEIC / AVIF pre-conversion ───────────────────────────────
    // iPhone-sourced product photos come as HEIC (older iOS) or AVIF
    // (newer iOS). Sharp decodes AVIF natively, HEIC needs the wasm
    // libheif fallback — `appleContainerToJpeg` picks the right path.
    // The rest of the pipeline only ever sees plain JPEG.
    if (isAppleContainer(original)) {
      onProgress(isAvif(original) ? 'avif-decode' : 'heic-decode');
      try {
        original = await appleContainerToJpeg(original);
      } catch (err) {
        throw new Error(
          `Apple-container decode failed: ${err?.message || String(err)}`,
        );
      }
    }

    onProgress('analyze');
    const heuristic = await analyzeBackground(original);

    let sourcePng;
    let source;
    if (!heuristic.needsAI) {
      // Already a clean studio shot — feed the original directly into
      // the variant renderer. Skip Gemini.
      sourcePng = original;
      source = 'heuristic-skip';
    } else {
      onProgress('gemini');
      // Normalise to PNG ≤ 1024 long side before sending to Gemini —
      // smaller payload, fewer model artefacts on huge inputs.
      const prepped = await sharp(original)
        .rotate()
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      sourcePng = await runGemini(prepped, genAI, options.geminiOverrides);
      source = 'gemini';
    }

    onProgress('encode');
    const variants = await renderVariants(sourcePng);

    onProgress('upload');
    const urls = await uploadAllVariants(variants, basePath, bucket);

    onProgress('firestore');
    // Three URLs written. The original `bild` field is NEVER touched.
    await docRef.update({
      bildClean: urls.webp,           // app-loadable WebP (small, fast)
      bildCleanPng: urls.png,         // PNG resized to ≤ 1024
      bildCleanHq: urls.hq,           // HQ PNG ≤ 1600 (Gemini near-raw)
      bildCleanVersion: PIPELINE_VERSION,
      bildCleanSource: source,
      bildCleanProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
      bildCleanError: admin.firestore.FieldValue.delete(),
    });

    return {
      status: source === 'gemini' ? 'cleaned' : 'heuristic-skip',
      bildClean: urls.webp,
      bildCleanPng: urls.png,
      bildCleanHq: urls.hq,
      variance: heuristic.variance,
      lightness: heuristic.lightness,
    };
  } catch (err) {
    // Failure: persist the reason on the doc, but DON'T touch `bild`.
    // The app keeps showing the original via the helper's fallback.
    const reason = err?.message || String(err);
    try {
      await docRef.update({
        bildCleanError: reason.slice(0, 500),
        bildCleanErrorAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (_) {
      // If even the error-write fails, swallow — we still want to
      // return the original error to the caller.
    }
    return { status: 'error', reason };
  }
}

// ─── Retry-strategy ladder used by the live triggers ─────────────
// Reframed prompts + alternative model. Same pair we use in the
// backfill-side `retry-failures.js` script (kept in sync — this is
// the canonical source). Each strategy layers on top of the
// previous: the wrapper below tries the default config first, then
// A on Gemini-content-filter rejections, then B (Pro) on still-
// rejections.
const RETRY_STRATEGIES = {
  A: {
    model: GEMINI_MODEL, // default — gemini-2.5-flash-image
    promptText: [
      'TASK: Reproduce the rectangular grocery package shown in the input on a pure white #FFFFFF background. The output is a clean studio product shot — like a stock photograph for an online supermarket catalogue.',
      '',
      'WHAT TO RENDER:',
      'Only the rectangular package (box, bag, bottle, can — whatever the product is). Reproduce it pixel-faithfully: same brand text, same colors, same proportions, same camera angle.',
      '',
      'WHAT TO IGNORE:',
      'Anything in the input that is NOT the package — store shelves, floors, ceilings, fingertips at the edge of the frame, surfaces, lighting glare, other products, signage. None of these appear in the output.',
      '',
      'BACKGROUND: pure solid white (#FFFFFF). No gradient, no texture, no shadow.',
      'FRAMING: package centred, fills ~90 % of the canvas, ~5 % white margin on every side.',
      'CAMERA: keep the input\'s exact perspective and angle.',
      '',
      'STRICT RULES:',
      '1. Do not modify the package design, text, logo, or shape.',
      '2. Do not add or invent details that aren\'t clearly visible in the input.',
      '3. Do not add stylistic effects, shadows, reflections, or borders.',
      '4. Do not include any object other than the package itself.',
    ].join('\n'),
  },
  B: {
    model: 'gemini-3-pro-image-preview', // Nano Banana Pro
    promptText: [
      'TASK: Reproduce the rectangular grocery package shown in the input on a pure white #FFFFFF background. The output is a professional studio product shot — like a high-resolution stock photograph for an online supermarket.',
      '',
      'WHAT TO RENDER:',
      'Only the rectangular package (box, bag, bottle, can — whatever the product is). Reproduce it pixel-faithfully: same brand text, same colors, same proportions, same camera angle.',
      '',
      'WHAT TO IGNORE:',
      'Anything in the input that is NOT the package — store shelves, floors, ceilings, fingertips at the edge of the frame, surfaces, lighting glare, other products, signage. None of these appear in the output.',
      '',
      'BACKGROUND: pure solid white (#FFFFFF). No gradient, no texture, no shadow.',
      'FRAMING: package centred, fills ~90 % of the canvas, ~5 % white margin on every side.',
      'CAMERA: keep the input\'s exact perspective and angle.',
      '',
      'STRICT RULES:',
      '1. Do not modify the package design, text, logo, or shape.',
      '2. Do not add or invent details that aren\'t clearly visible in the input.',
      '3. Do not add stylistic effects, shadows, reflections, or borders.',
      '4. Do not include any object other than the package itself.',
      '',
      'OUTPUT FORMAT: photorealistic studio product shot, 1:1 or natural aspect, 1024 px short side or larger, pure white background, package centred.',
    ].join('\n'),
  },
};

// Errors that look like Gemini's image-output filters fired. These
// often clear with a different prompt or a different model — worth
// retrying. Network errors, 404s, source-decode failures don't
// benefit from prompt change; we accept those after the first try.
function isContentFilterError(reason) {
  if (!reason) return false;
  return /IMAGE_OTHER|IMAGE_RECITATION|IMAGE_SAFETY|finishReason=/i.test(reason);
}

/**
 * Live-trigger entry point with automatic strategy escalation.
 *
 * Mirrors what the backfill scripts do manually: tries the default
 * Gemini config first, then on a content-filter rejection tries
 * Strategy A (reframed "package extraction" prompt, same model),
 * then Strategy B (same prompt on Gemini 3 Pro). Stops as soon as
 * any attempt produces `bildClean` and returns that result.
 *
 * Use this from Cloud Function triggers (`onCreate` / `onUpdate`)
 * so newly-added products get the same recovery treatment we ran
 * over the backfill manually — without us having to re-run the
 * batch retry scripts.
 *
 * For backfill / one-shot scripts, keep using the bare
 * `processProductImage` and orchestrate retries yourself —
 * those scripts already track per-strategy progress docs.
 *
 * Returns the final result. If all attempts fail, the result keeps
 * the LAST `error` reason and the doc carries that `bildCleanError`.
 */
async function processProductImageWithFallbacks(params) {
  // 1. Default strategy.
  const r1 = await processProductImage(params);
  if (r1.status !== 'error' || !isContentFilterError(r1.reason)) {
    return r1;
  }

  console.log(
    `[trigger-fallback] ${params.collection}/${params.productId} → ` +
      `default failed (${r1.reason}); trying strategy A`,
  );

  // 2. Strategy A — reframed prompt, same model.
  const r2 = await processProductImage({
    ...params,
    options: {
      ...(params.options || {}),
      force: true,
      geminiOverrides: RETRY_STRATEGIES.A,
    },
  });
  if (r2.status !== 'error' || !isContentFilterError(r2.reason)) {
    if (r2.status !== 'error') {
      console.log(
        `[trigger-fallback] ${params.collection}/${params.productId} → ` +
          `recovered via strategy A`,
      );
    }
    return r2;
  }

  console.log(
    `[trigger-fallback] ${params.collection}/${params.productId} → ` +
      `A failed (${r2.reason}); trying strategy B (Pro)`,
  );

  // 3. Strategy B — Gemini 3 Pro.
  const r3 = await processProductImage({
    ...params,
    options: {
      ...(params.options || {}),
      force: true,
      geminiOverrides: RETRY_STRATEGIES.B,
    },
  });
  if (r3.status !== 'error') {
    console.log(
      `[trigger-fallback] ${params.collection}/${params.productId} → ` +
        `recovered via strategy B (Pro)`,
    );
  } else {
    console.log(
      `[trigger-fallback] ${params.collection}/${params.productId} → ` +
        `all strategies exhausted; doc has bildCleanError = ${r3.reason}`,
    );
  }
  return r3;
}

/**
 * Cleanup helper used by `onDelete` triggers. Removes the cleaned
 * WebP from Storage when the product itself was removed. Safe to
 * call even if the file doesn't exist.
 */
async function deleteCleanedImage({ bucket, collection, productId }) {
  const subfolder = COLLECTION_TO_SUBFOLDER[collection];
  if (!subfolder) return;
  const base = `${ALLOWED_STORAGE_PREFIX}${subfolder}/${productId}`;
  // Remove all three variants. ignoreNotFound so older docs that only
  // had one variant don't trip over missing siblings.
  const paths = [`${base}.webp`, `${base}.png`, `${base}_hq.png`];
  await Promise.all(
    paths.map((p) =>
      bucket
        .file(p)
        .delete({ ignoreNotFound: true })
        .catch((err) =>
          console.warn(`deleteCleanedImage: ${p} → ${err?.message || err}`),
        ),
    ),
  );
}

module.exports = {
  PIPELINE_VERSION,
  ALLOWED_STORAGE_PREFIX,
  COLLECTION_TO_SUBFOLDER,
  processProductImage,
  // Live-trigger entry point with default → A → B (Pro) escalation.
  // New products get the same recovery treatment as our manual
  // backfill + retry-failures runs.
  processProductImageWithFallbacks,
  deleteCleanedImage,
  // exposed for the backfill script's own progress logging
  analyzeBackground,
  // exposed for debug / unit testing (legacy v2-v5 helpers, unused
  // in v6 but kept for re-postprocessing experiments)
  uniformBgToTransparent,
  renderVariants,
  // exposed for sanity tests + retry-failures.js so the strategy
  // ladder stays in sync between live triggers and one-shot scripts.
  RETRY_STRATEGIES,
  isContentFilterError,
};
