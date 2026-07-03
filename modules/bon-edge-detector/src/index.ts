/**
 * Auto edge-detection + perspective correction for static images.
 *
 * iOS: Apple VisionKit's `VNDetectRectanglesRequest` finds the bon
 *      quad, `CIPerspectiveCorrection` warps it flat, returns a
 *      cropped JPEG.
 * Android: stub — always returns null so the JS caller falls back
 *          to the manual crop screen. Real impl is a Phase-1.5.3
 *          follow-up.
 *
 * Usage:
 *   const cropped = await BonEdgeDetector.detectAndCropDocument(uri);
 *   if (cropped) { ...use cropped.uri... } else { ...show crop screen... }
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

export interface DetectAndCropResult {
  uri: string;
  width: number;
  height: number;
}

interface BonEdgeDetectorNative {
  detectAndCropDocument(uri: string): Promise<DetectAndCropResult | null>;
  scanBarcodeFromImage(uri: string): Promise<string | null>;
}

const native = requireOptionalNativeModule<BonEdgeDetectorNative>('BonEdgeDetector');

export async function detectAndCropDocument(
  uri: string,
): Promise<DetectAndCropResult | null> {
  if (!native?.detectAndCropDocument) return null;
  try {
    const result = await native.detectAndCropDocument(uri);
    if (
      result &&
      typeof (result as any).uri === 'string' &&
      Number.isFinite((result as any).width) &&
      Number.isFinite((result as any).height)
    ) {
      return result as DetectAndCropResult;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read a 1D product barcode (EAN-13/8, UPC-E) from a STATIC image via Apple
 * Vision (VNDetectBarcodesRequest). iOS only — Android returns null (there the
 * caller uses expo-camera scanFromURLAsync, which reads 1D codes via ML Kit).
 * Returns the payload string, or null when nothing is readable OR the native
 * function isn't in the running binary yet (older build) → caller falls back to
 * manual EAN entry. Never throws.
 */
export async function scanBarcodeFromImage(uri: string): Promise<string | null> {
  if (!native?.scanBarcodeFromImage) return null;
  try {
    const code = await native.scanBarcodeFromImage(uri);
    return typeof code === 'string' && code.trim() ? code.trim() : null;
  } catch {
    return null;
  }
}

// Live scanner (manual shutter + per-frame edge overlay).
export {
  BonScanner,
  isBonScannerAvailable,
  DEFAULT_SCANNER_TUNING,
  type BonScannerHandle,
  type BonScannerProps,
  type BonScannerCaptureResult,
  type BonScannerQuality,
  type ScannerTuning,
} from './BonScannerView';

export default { detectAndCropDocument, scanBarcodeFromImage };
