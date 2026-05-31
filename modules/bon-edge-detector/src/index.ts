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

export default { detectAndCropDocument };
