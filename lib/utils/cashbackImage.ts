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
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image } from 'react-native';

// Storage-Rule-Limit (storage.rules: request.resource.size < 8 MB) minus
// Sicherheitsmarge. Dateien darüber kann der Upload NIE annehmen — sie
// blockierten das Einreichen bisher STUMM (86cb6twnp, Fall Uwe: ~10 Bons
// über 4 Wochen, serverseitig 0 Spuren).
const UPLOAD_SIZE_LIMIT_BYTES = 7_500_000;

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

/** Bild-Dimensionen ermitteln (0/0 wenn nicht lesbar). */
async function getImageDims(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve({ width: 0, height: 0 }),
    );
  });
}

/**
 * Stellt sicher, dass die Datei unters Upload-Limit passt (86cb6twnp).
 *
 * WICHTIG (CLAUDE.md „volle Qualität für die Analyse"): Bilder unterhalb
 * des Limits werden NICHT angefasst — der Default bleibt Pass-Through in
 * Originalqualität. Skaliert wird AUSSCHLIESSLICH, wenn die Datei sonst an
 * der Storage-Rule (8 MB) scheitern würde — dann ist „leicht verkleinert
 * einreichen" strikt besser als „gar nicht einreichbar" (moderne Android-
 * Kameras liefern >8-MB-JPEGs; genau die blockierten bisher stumm).
 * Die Stufen sind bewusst konservativ (3000 px lange Kante zuerst, nicht
 * die 800px/q40-Kaputt-Stufe aus dem optimizeImage-Vorfall), damit die
 * OCR-Lesbarkeit kleiner Bon-Schrift erhalten bleibt.
 */
export async function ensureUploadableSize(
  uri: string,
  width?: number,
  height?: number,
): Promise<{ uri: string; width: number; height: number; sizeBytes: number; resized: boolean }> {
  const sizeBytes = await getFileSize(uri);
  if (sizeBytes > 0 && sizeBytes <= UPLOAD_SIZE_LIMIT_BYTES) {
    return { uri, width: width ?? 0, height: height ?? 0, sizeBytes, resized: false };
  }
  if (sizeBytes === 0) {
    // Größe nicht lesbar → nichts riskieren, Original durchreichen.
    return { uri, width: width ?? 0, height: height ?? 0, sizeBytes, resized: false };
  }

  let dims = { width: width || 0, height: height || 0 };
  if (!dims.width || !dims.height) dims = await getImageDims(uri);
  const longEdge = Math.max(dims.width, dims.height);

  // Konservative Leiter: erst moderat runter, nur bei Bedarf weiter.
  const steps: Array<{ maxLongEdge: number; compress: number }> = [
    { maxLongEdge: 3000, compress: 0.92 },
    { maxLongEdge: 2400, compress: 0.88 },
    { maxLongEdge: 2000, compress: 0.85 },
  ];

  for (const step of steps) {
    try {
      const actions =
        longEdge > 0 && longEdge > step.maxLongEdge
          ? [
              dims.width >= dims.height
                ? { resize: { width: step.maxLongEdge } }
                : { resize: { height: step.maxLongEdge } },
            ]
          : []; // Kante unbekannt/klein → nur re-komprimieren
      const out = await manipulateAsync(uri, actions, {
        compress: step.compress,
        format: SaveFormat.JPEG,
      });
      const outSize = await getFileSize(out.uri);
      if (outSize > 0 && outSize <= UPLOAD_SIZE_LIMIT_BYTES) {
        return { uri: out.uri, width: out.width, height: out.height, sizeBytes: outSize, resized: true };
      }
    } catch (e) {
      console.warn('⚠️ ensureUploadableSize step failed:', e);
      // nächste Stufe probieren
    }
  }

  // Alle Stufen gescheitert → Original zurück; das Größen-Gate in der
  // Review zeigt dem Nutzer dann eine SICHTBARE Erklärung (nie mehr stumm).
  return { uri, width: dims.width, height: dims.height, sizeBytes, resized: false };
}

/**
 * "Prepare for upload" — Sicherheitsnetz in der Upload-Queue: greift nur,
 * wenn ein Job mit Über-Limit-Datei in die Queue gelangt ist (Altbestand,
 * oder die Capture-seitige Verkleinerung schlug fehl). Normalfall =
 * Pass-Through in Originalqualität (siehe ensureUploadableSize).
 */
export async function prepareForUpload(
  uri: string,
  _maxLongEdge = 2000,
  width?: number,
  height?: number,
): Promise<{ uri: string; width: number; height: number; sizeBytes: number; resized: boolean }> {
  return ensureUploadableSize(uri, width, height);
}

/**
 * Build a CapturedBon from a freshly-captured image URI.
 */
export async function buildCapturedBon(
  uri: string,
  width: number,
  height: number,
): Promise<CapturedBon> {
  // 86cb6twnp: ZUERST unters Upload-Limit bringen (Pass-Through im
  // Normalfall), DANN hashen. So ist der Hash konsistent mit den Bytes,
  // die tatsächlich hochgeladen werden (Server-Dedup vergleicht
  // capture.hash), und hashImageFile liest nie eine >8-MB-Datei komplett
  // als Base64 in den JS-Heap (das war Blockier-Ursache Nr. 2).
  const prepared = await ensureUploadableSize(uri, width, height);

  const [bytesHash, sizeBytes] = await Promise.all([
    hashImageFile(prepared.uri),
    prepared.sizeBytes > 0 ? Promise.resolve(prepared.sizeBytes) : getFileSize(prepared.uri),
  ]);

  return {
    uri: prepared.uri,
    width: prepared.width || width,
    height: prepared.height || height,
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
