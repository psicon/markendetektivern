/**
 * Image enhancement for OCR escalation.
 *
 * The remaining OCR misses are NOT model-reasoning failures — they're image
 * quality (creases/fade on thermal paper make a single digit ambiguous).
 * Upscaling + sharpening + contrast-normalisation makes faint/creased text
 * crisper for the vision model. Empirically (hard LiDL bon, flash, per-read):
 *   original 2/8  →  2× upscale + grayscale + sharpen + normalize  5/8.
 *
 * Applied ONLY on escalation (when independent reads of the ORIGINAL didn't
 * agree), so clean bons are never altered and we pay the CPU only when needed.
 * Best-effort: returns null on any failure → caller falls back to the original.
 */

'use strict';

const sharp = require('sharp');

const MAX_DIM = 3200; // cap the upscaled long edge so huge inputs don't explode

/**
 * @param {Buffer} imageBytes
 * @returns {Promise<Buffer|null>} enhanced JPEG bytes, or null on failure.
 */
async function enhanceForOcr(imageBytes) {
  try {
    const meta = await sharp(imageBytes).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (!w || !h) return null;

    // Upscale ~2× but keep the long edge under MAX_DIM.
    const longEdge = Math.max(w, h);
    let scale = 2;
    if (longEdge * scale > MAX_DIM) scale = Math.max(1, MAX_DIM / longEdge);

    return await sharp(imageBytes)
      .resize(Math.round(w * scale), Math.round(h * scale), { kernel: 'lanczos3' })
      .grayscale()
      .sharpen({ sigma: 1.5 })
      .normalize()
      .jpeg({ quality: 95 })
      .toBuffer();
  } catch (e) {
    return null;
  }
}

module.exports = { enhanceForOcr };
