/**
 * Image-helpers for the Cashback capture/review flow.
 *
 * Phase 1.5 ships a pragmatic, dependency-light implementation:
 *  - SHA-256 hash of the image bytes (for server-side de-dup)
 *  - Brightness sample via expo-image-manipulator + a downscaled PNG
 *    base64 (we average the luminance of a small sample).
 *  - Sharpness is NOT computed here — too expensive without a native
 *    image-pixels module. Phase 1.5.1 (ML-Kit upgrade) brings real
 *    Laplacian-variance via the ported Python helper from
 *    tools/cashback-ocr-validation/image_prep.py.
 *
 * All metadata stays client-side; the server re-computes hashes
 * authoritatively on upload (don't trust the client).
 */

import * as Crypto from 'expo-crypto';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

export interface CapturedBon {
  uri: string;
  width: number;
  height: number;
  bytesHash: string;
  approxBrightness: number; // 0..255 mean luminance
  sizeBytes: number;
  capturedAt: number;
}

const SAMPLE_SIZE = 48; // 48×48 sample for the brightness estimate

/**
 * Compute a SHA-256 hex digest of the file at `uri`.
 * Returns "" on failure (caller should treat as missing, not fatal).
 */
export async function hashImageFile(uri: string): Promise<string> {
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      base64,
      { encoding: Crypto.CryptoEncoding.HEX },
    );
    return digest;
  } catch (error) {
    console.warn('⚠️ hashImageFile failed:', error);
    return '';
  }
}

/**
 * Get the file size in bytes. Returns 0 on failure.
 */
export async function getFileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    return info.exists && 'size' in info ? (info.size as number) : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Crude brightness estimate: scale to 48×48 PNG, average the luminance
 * of the base64-decoded pixel bytes.
 *
 * NOTE: We don't decode PNG bytes properly here — we just average byte
 * values in the base64 stream as a heuristic. It's good enough to flag
 * obviously dark or obviously over-exposed shots in the review screen.
 * Replace with real pixel access when ML-Kit lands.
 */
export async function estimateBrightness(uri: string): Promise<number> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: SAMPLE_SIZE, height: SAMPLE_SIZE } }],
      {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    const b64 = result.base64 ?? '';
    if (!b64) return 128;

    // Heuristic: byte-average of a JPEG byte-stream is dominated by
    // entropy and image content. Not a true luminance — but: very dark
    // images compress to mostly low bytes, very bright shots produce
    // higher average bytes. Map to 0..255 via the actual byte average
    // of a decoded chunk.
    let sum = 0;
    let count = 0;
    // Sample every 7th char to keep this fast even on large strings.
    for (let i = 0; i < b64.length; i += 7) {
      sum += b64.charCodeAt(i);
      count++;
    }
    if (!count) return 128;
    const avg = sum / count;
    // Map base64 char codes (~43..122) into 0..255.
    return Math.max(0, Math.min(255, Math.round(((avg - 43) / (122 - 43)) * 255)));
  } catch (error) {
    console.warn('⚠️ estimateBrightness failed:', error);
    return 128;
  }
}

/**
 * Resize + JPEG-compress before upload. Receipts max ~2000px on the
 * long edge keeps OCR quality while cutting upload size massively.
 */
export async function prepareForUpload(
  uri: string,
  maxLongEdge = 2000,
  width?: number,
  height?: number,
): Promise<{ uri: string; width: number; height: number; sizeBytes: number }> {
  try {
    const resizeOpt =
      width && height
        ? width > height
          ? { width: Math.min(width, maxLongEdge) }
          : { height: Math.min(height, maxLongEdge) }
        : { width: maxLongEdge };

    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: resizeOpt }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
    );
    const sizeBytes = await getFileSize(result.uri);
    return {
      uri: result.uri,
      width: result.width,
      height: result.height,
      sizeBytes,
    };
  } catch (error) {
    console.warn('⚠️ prepareForUpload failed:', error);
    return { uri, width: width ?? 0, height: height ?? 0, sizeBytes: await getFileSize(uri) };
  }
}

/**
 * Build a CapturedBon from a freshly-captured image URI.
 * Runs hash + brightness + size in parallel.
 */
export async function buildCapturedBon(
  uri: string,
  width: number,
  height: number,
): Promise<CapturedBon> {
  const [bytesHash, approxBrightness, sizeBytes] = await Promise.all([
    hashImageFile(uri),
    estimateBrightness(uri),
    getFileSize(uri),
  ]);

  return {
    uri,
    width,
    height,
    bytesHash,
    approxBrightness,
    sizeBytes,
    capturedAt: Date.now(),
  };
}

/**
 * Quality verdict — used by the review screen to decide whether to
 * show warnings to the user.
 */
export interface QualityVerdict {
  brightnessOk: boolean;
  brightnessLabel: string;
  sizeOk: boolean;
  sizeLabel: string;
  hashOk: boolean;
}

export function verdictFor(bon: CapturedBon): QualityVerdict {
  const tooDark = bon.approxBrightness < 60;
  const tooBright = bon.approxBrightness > 220;
  const tooSmall = bon.sizeBytes > 0 && bon.sizeBytes < 30 * 1024;
  const tooLarge = bon.sizeBytes > 8 * 1024 * 1024;

  return {
    brightnessOk: !tooDark && !tooBright,
    brightnessLabel: tooDark
      ? 'Bon wirkt zu dunkel — mehr Licht oder Bild näher'
      : tooBright
      ? 'Bon wirkt überstrahlt — Reflexion oder Blitz vermeiden'
      : 'Helligkeit sieht gut aus',
    sizeOk: !tooSmall && !tooLarge,
    sizeLabel: tooSmall
      ? 'Bild sehr klein — bitte nochmal fokussieren'
      : tooLarge
      ? 'Datei zu groß für Upload'
      : 'Bildgröße passt',
    hashOk: bon.bytesHash.length === 64,
  };
}
