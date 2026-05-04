/**
 * Image-helpers for the Cashback capture/review flow.
 *
 * Phase 1.5 ships a dependency-light implementation:
 *  - SHA-256 hash of the image bytes (for server-side de-dup)
 *  - File size lookup
 *
 * Brightness + sharpness gates are NOT computed here in v1 — they
 * would need expo-image-manipulator (native module → dev-client
 * rebuild). The user-self-check in review.tsx covers the same UX
 * goal until Phase 1.5.1 brings ML-Kit Document Scanner with real
 * pixel access.
 *
 * Resize-before-upload is also deferred — expo-camera already
 * compresses to JPEG q0.9 which is small enough for current upload
 * (most receipt photos land around 1-3 MB).
 *
 * All metadata stays client-side; the server re-computes hashes
 * authoritatively on upload (don't trust the client).
 */

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';

export interface CapturedBon {
  uri: string;
  width: number;
  height: number;
  bytesHash: string;
  approxBrightness: number; // 0..255 — currently always 128 (neutral)
  sizeBytes: number;
  capturedAt: number;
}

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
 * Brightness estimate stub — Phase 1.5.1 with ML-Kit will compute a
 * real luminance histogram. For now we return 128 (neutral) so the
 * verdict helper neither warns nor congratulates.
 */
export async function estimateBrightness(_uri: string): Promise<number> {
  return 128;
}

/**
 * Pass-through "prepare for upload" — Phase 1.5 doesn't resize because
 * we don't have expo-image-manipulator installed. expo-camera quality
 * 0.9 produces JPEGs around 1-3 MB which is comfortable for the 8 MB
 * upload limit in the storage rules.
 *
 * Phase 1.5.1 brings native resize via ML-Kit's pipeline; until then
 * Cloud Functions can downscale server-side if size becomes an issue.
 */
export async function prepareForUpload(
  uri: string,
  _maxLongEdge = 2000,
  width?: number,
  height?: number,
): Promise<{ uri: string; width: number; height: number; sizeBytes: number }> {
  const sizeBytes = await getFileSize(uri);
  return {
    uri,
    width: width ?? 0,
    height: height ?? 0,
    sizeBytes,
  };
}

/**
 * Build a CapturedBon from a freshly-captured image URI.
 */
export async function buildCapturedBon(
  uri: string,
  width: number,
  height: number,
): Promise<CapturedBon> {
  const [bytesHash, sizeBytes] = await Promise.all([
    hashImageFile(uri),
    getFileSize(uri),
  ]);

  return {
    uri,
    width,
    height,
    bytesHash,
    approxBrightness: 128,
    sizeBytes,
    capturedAt: Date.now(),
  };
}

/**
 * Quality verdict — used by the review screen to surface basic
 * file-level warnings. Brightness verdict is always "ok" until
 * Phase 1.5.1.
 */
export interface QualityVerdict {
  brightnessOk: boolean;
  brightnessLabel: string;
  sizeOk: boolean;
  sizeLabel: string;
  hashOk: boolean;
}

export function verdictFor(bon: CapturedBon): QualityVerdict {
  const tooSmall = bon.sizeBytes > 0 && bon.sizeBytes < 30 * 1024;
  const tooLarge = bon.sizeBytes > 8 * 1024 * 1024;

  return {
    brightnessOk: true,
    brightnessLabel: 'Bild aufgenommen',
    sizeOk: !tooSmall && !tooLarge,
    sizeLabel: tooSmall
      ? 'Bild sehr klein — bitte nochmal fokussieren'
      : tooLarge
      ? 'Datei zu groß für Upload'
      : 'Bildgröße passt',
    hashOk: bon.bytesHash.length === 64,
  };
}
