/**
 * Image forensics for the Cashback pipeline.
 *
 * Computes server-trusted signals BEFORE the OCR call so we can reject
 * obvious duplicates and suspicious uploads cheaply (no OCR cost on
 * known-bad images).
 *
 * Two primary signals:
 *
 *   1. **dHash (difference hash)** — a 64-bit perceptual hash that
 *      survives JPEG re-encoding and small crops. Used for duplicate
 *      detection across the user's lifetime receipts. Stored as a
 *      hex string for Firestore equality lookup.
 *
 *      Algorithm: resize to 9×8 grayscale → for each row, compare
 *      adjacent pixels → produce 64 bits where bit_i = 1 if
 *      pixel[i] > pixel[i+1]. Same image at any reasonable JPEG
 *      quality and small crops produces the same hash.
 *
 *   2. **EXIF metadata** — the original capture timestamp + camera
 *      make/model/software fingerprint. Lets us detect:
 *        - bons photographed weeks ago and resubmitted today (capture
 *          timestamp ≪ upload timestamp)
 *        - bons "captured" in the future (clock-tampering attack)
 *        - bons edited in Photoshop / GIMP / online editors
 *        - bons with no EXIF at all (re-saved screenshots, downloaded
 *          off the web, etc — don't auto-reject but flag for review)
 *
 * Future Phase-4.5 layers (not yet here): pHash for higher robustness,
 * ELA (error-level analysis), AI-generation detector. dHash + EXIF
 * gives us the highest-impact 80% with the lowest infra cost.
 */

'use strict';

const crypto = require('crypto');
const sharp = require('sharp');
const exifr = require('exifr');
const { logger } = require('firebase-functions');

// dHash uses a 9-wide × 8-tall thumbnail so each row produces 8 bits
// of difference (one less than the column count). Total = 64 bits.
const DHASH_W = 9;
const DHASH_H = 8;

// Software strings that strongly suggest the image was edited rather
// than captured directly. We don't auto-reject (people legitimately
// crop in Photos.app), but we surface them as a forensic flag so the
// review pipeline can weight them.
const EDITED_SOFTWARE_PATTERNS = [
  /photoshop/i,
  /gimp/i,
  /pixelmator/i,
  /affinity/i,
  /photopea/i,
  /paint\.net/i,
];

/**
 * Compute the 64-bit dHash of an image as a 16-char hex string.
 *
 * @param {Buffer} imageBytes
 * @returns {Promise<string>} 16-char lowercase hex (e.g. "f00f1ea0d3c5b8a1")
 */
async function computeDHash(imageBytes) {
  // Sharp pipeline: rotate by EXIF (so portrait photos hash the same
  // regardless of orientation flag), grayscale, resize to 9x8 with
  // box filter (matches reference dHash implementations).
  const raw = await sharp(imageBytes)
    .rotate() // applies EXIF orientation, then strips it
    .grayscale()
    .resize(DHASH_W, DHASH_H, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();

  if (raw.length !== DHASH_W * DHASH_H) {
    throw new Error(`dhash-resize-mismatch: got ${raw.length} bytes, expected ${DHASH_W * DHASH_H}`);
  }

  // Compare adjacent pixels in each row (8 comparisons per row × 8 rows = 64 bits)
  let bits = 0n;
  for (let row = 0; row < DHASH_H; row += 1) {
    for (let col = 0; col < DHASH_W - 1; col += 1) {
      const left = raw[row * DHASH_W + col];
      const right = raw[row * DHASH_W + col + 1];
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }

  return bits.toString(16).padStart(16, '0');
}

/**
 * Hamming distance between two hex-encoded dHashes.
 * Returns -1 if either input is malformed.
 *
 * Useful threshold: ≤ 5 bits = same image (any reasonable transform).
 * ≤ 10 bits = same image, possibly with crop or color shift. > 10 = different.
 */
function hammingDistance(hexA, hexB) {
  if (typeof hexA !== 'string' || typeof hexB !== 'string') return -1;
  if (hexA.length !== hexB.length) return -1;
  try {
    const a = BigInt(`0x${hexA}`);
    const b = BigInt(`0x${hexB}`);
    let xor = a ^ b;
    let dist = 0;
    while (xor !== 0n) {
      dist += Number(xor & 1n);
      xor >>= 1n;
    }
    return dist;
  } catch {
    return -1;
  }
}

/**
 * Extract EXIF metadata relevant to forensics.
 *
 * Returns null fields when EXIF is missing or unreadable — a missing
 * EXIF is itself a signal (most direct camera captures carry it).
 *
 * @param {Buffer} imageBytes
 * @returns {Promise<{
 *   capturedAtMs: number|null,
 *   make: string|null,
 *   model: string|null,
 *   software: string|null,
 *   present: boolean,
 * }>}
 */
async function readExifMeta(imageBytes) {
  let exif;
  try {
    exif = await exifr.parse(imageBytes, {
      // Only fields we care about — skip the heavy XMP/IPTC sections.
      tiff: true,
      exif: true,
      gps: false,
      interop: false,
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'Make', 'Model', 'Software'],
    });
  } catch (e) {
    logger.debug('exif-parse-failed', { err: e.message });
    return { capturedAtMs: null, make: null, model: null, software: null, present: false };
  }

  if (!exif || typeof exif !== 'object') {
    return { capturedAtMs: null, make: null, model: null, software: null, present: false };
  }

  // Prefer DateTimeOriginal (true capture moment); fall back to
  // CreateDate then ModifyDate. exifr returns Date objects for these.
  const captured = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
  const capturedAtMs = captured instanceof Date && !isNaN(captured.getTime()) ? captured.getTime() : null;

  return {
    capturedAtMs,
    make: typeof exif.Make === 'string' ? exif.Make.trim().slice(0, 64) : null,
    model: typeof exif.Model === 'string' ? exif.Model.trim().slice(0, 64) : null,
    software: typeof exif.Software === 'string' ? exif.Software.trim().slice(0, 128) : null,
    present: true,
  };
}

/**
 * Derive forensic flags from server-computed signals.
 * Each flag is informational unless explicitly reject-worthy.
 *
 * Reject (caller bails out):
 *   - exifAgeRejectable: capture timestamp older than maxBonAgeDays
 *     OR more than 6 hours in the future (clock tamper).
 *
 * Flag-only (stored on receipt for review weighting):
 *   - exifMissing: no readable EXIF at all
 *   - suspiciousSoftware: edited in known image-editor (Photoshop etc)
 *   - exifAgeMismatch: capture-vs-upload gap > 24h but ≤ maxBonAgeDays
 *     (legit case: user offline for a day; suspicious case: stockpiled bons)
 */
function deriveForensicFlags(exif, uploadAtMs, maxBonAgeDays) {
  const flags = {
    exifMissing: !exif.present || exif.capturedAtMs == null,
    suspiciousSoftware: false,
    exifAgeMismatch: false,
    exifAgeRejectable: false,
    exifAgeDays: null,
    softwareMatched: null,
  };

  if (exif.software) {
    for (const re of EDITED_SOFTWARE_PATTERNS) {
      if (re.test(exif.software)) {
        flags.suspiciousSoftware = true;
        flags.softwareMatched = exif.software;
        break;
      }
    }
  }

  if (exif.capturedAtMs != null && Number.isFinite(uploadAtMs)) {
    const ageMs = uploadAtMs - exif.capturedAtMs;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    flags.exifAgeDays = Number(ageDays.toFixed(2));

    // Future-dated by more than 6 hours = clock tampering. Reject.
    if (ageMs < -6 * 60 * 60 * 1000) {
      flags.exifAgeRejectable = true;
    } else if (ageDays > maxBonAgeDays) {
      flags.exifAgeRejectable = true;
    } else if (ageDays > 1) {
      flags.exifAgeMismatch = true;
    }
  }

  return flags;
}

/**
 * Two content-based duplicate fingerprints — both derived from the
 * parsed receipt fields, both designed to catch the case that *image*
 * forensics can't see: when a user re-photographs the same receipt via
 * a Document Scanner, the resulting bytes / dHash / EXIF timestamps all
 * differ — but the OCR'd content is identical.
 *
 * `contentHash` (merchant + date + total) — used for **per-user dedup**.
 *   Same user submitting the same bon twice. Statistically impossible
 *   for one user to legitimately have two purchases at the same shop on
 *   the same day with the same exact total, so a hard reject is safe.
 *
 * `transactionHash` (merchant + date + **time** + total) — used for
 *   **cross-user dedup** (collusion / shared bons). With minute-precision
 *   bonTime included, two different users physically cannot have the
 *   same bon — checkout time of a single transaction is unique.
 *   Returns null when bonTime wasn't extracted (we don't risk false
 *   positives by cross-user-blocking just on date+total).
 *
 * Both return 16-char hex; null when any required input is missing.
 */
function computeContentHash(merchantId, bonDate, totalCents) {
  if (!merchantId || typeof merchantId !== 'string') return null;
  if (!bonDate || typeof bonDate !== 'string') return null;
  if (!Number.isFinite(totalCents) || totalCents <= 0) return null;
  const sig = `${merchantId.toLowerCase()}|${bonDate}|${totalCents}`;
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}

function computeTransactionHash(merchantId, bonDate, bonTime, totalCents) {
  if (!merchantId || typeof merchantId !== 'string') return null;
  if (!bonDate || typeof bonDate !== 'string') return null;
  if (!bonTime || typeof bonTime !== 'string') return null;
  if (!Number.isFinite(totalCents) || totalCents <= 0) return null;
  // Normalize bonTime to HH:MM (in case OCR returned HH:MM:SS).
  const normalizedTime = bonTime.slice(0, 5);
  const sig = `${merchantId.toLowerCase()}|${bonDate}|${normalizedTime}|${totalCents}`;
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}

/**
 * `itemsHash` (merchant + date + normalized item set) — robust against
 * total/merchant OCR jitter that breaks `contentHash`. Catches the same
 * physical bon re-photographed (new scanner → different bytes / dHash /
 * total rounding) as long as the merchant, date and the set of items
 * match.
 *
 * Items are normalized (lowercased, collapsed whitespace) as
 * `name#priceCents#qty`, then sorted so order doesn't matter. The caller
 * additionally guards with a ±N-minute bonTime window so two legitimately
 * identical baskets bought hours apart on the same day aren't blocked.
 *
 * Returns 16-char hex; null when merchant/date missing or no usable items.
 */
function computeItemsHash(merchantId, bonDate, items) {
  if (!merchantId || typeof merchantId !== 'string') return null;
  if (!bonDate || typeof bonDate !== 'string') return null;
  if (!Array.isArray(items) || items.length === 0) return null;
  const norm = items
    .map((it) => {
      const name = String(it && it.name != null ? it.name : '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      const price = Number.isFinite(it && it.priceCents) ? it.priceCents : 0;
      const qty = Number.isFinite(it && it.qty) ? it.qty : 1;
      return `${name}#${price}#${qty}`;
    })
    .filter((s) => s.length > 2)
    .sort();
  if (norm.length === 0) return null;
  const sig = `${merchantId.toLowerCase()}|${bonDate}|${norm.join('~')}`;
  return crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16);
}

module.exports = {
  computeDHash,
  hammingDistance,
  readExifMeta,
  deriveForensicFlags,
  computeContentHash,
  computeTransactionHash,
  computeItemsHash,
};
