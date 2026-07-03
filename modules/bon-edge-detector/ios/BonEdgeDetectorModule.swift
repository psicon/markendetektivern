import ExpoModulesCore
import Vision
import CoreImage
import UIKit

/**
 * BonEdgeDetectorModule
 *
 * Two capabilities, sharing one detection/warp core (BonVision):
 *
 *  1. detectAndCropDocument(uri) — auto-detect the document quad in a
 *     STATIC image (gallery upload / captured still) and return a
 *     perspective-corrected JPEG URI, or null when no quad is found.
 *
 *  2. BonScannerView — a LIVE camera view with per-frame edge overlay
 *     and a manual shutter (see BonScannerView.swift).
 */
public class BonEdgeDetectorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BonEdgeDetector")

    AsyncFunction("detectAndCropDocument") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        // Resolve null (never reject) — caller treats null as "no
        // detection, send raw image", the same fallback as an error.
        promise.resolve(Self.detectAndCrop(uri: uri))
      }
    }

    AsyncFunction("scanBarcodeFromImage") { (uri: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        // Resolve null (never reject) — caller falls back to manual EAN entry.
        promise.resolve(Self.scanBarcode(uri: uri))
      }
    }

    View(BonScannerView.self) {
      Events("onCapture", "onError", "onEdgesDetected", "onQuality", "onSessionStopped")

      Prop("isActive") { (view: BonScannerView, active: Bool) in
        view.setActive(active)
      }
      Prop("torch") { (view: BonScannerView, on: Bool) in
        view.setTorch(on)
      }
      Prop("rawCapture") { (view: BonScannerView, raw: Bool) in
        view.setRawCapture(raw)
      }
      Prop("captureSignal") { (view: BonScannerView, signal: Int) in
        view.requestCapture(signal: signal)
      }
      Prop("tuning") { (view: BonScannerView, tuning: ScannerTuning) in
        view.applyTuning(tuning)
      }
    }
  }

  // MARK: - Static-image detection (gallery / still)

  private static func detectAndCrop(uri: String) -> [String: Any]? {
    guard let inputImage = loadCIImage(from: uri) else { return nil }
    let context = CIContext()
    guard let cg = context.createCGImage(inputImage, from: inputImage.extent) else { return nil }
    // ML document segmenter first (robust on low-contrast paper),
    // rectangle detector as fallback. Lenient gate — a picked/captured
    // still IS a bon, so accept whatever document fills it.
    let lenient = BonVision.DocParams(minConfidence: 0.0, minArea: 0.02, maxArea: 0.99, maxWHRatio: 3.0)
    let rect = BonVision.detectDocument(cgImage: cg, params: lenient)
      ?? BonVision.detectRectangle(cgImage: cg)
    guard let rect = rect else { return nil }
    return BonVision.warpAndWriteJPEG(ciImage: inputImage, observation: rect)
  }

  // MARK: - Barcode scan (static image / gallery)

  /// Read a 1D product barcode (EAN-13/8, UPC-E) from a still image via
  /// Vision (VNDetectBarcodesRequest). expo-camera's scanFromURLAsync is
  /// QR-only on iOS, so this is the path for reading a product EAN out of a
  /// gallery photo. Returns the payload string, or nil when nothing readable
  /// is found — the caller then falls back to manual EAN entry.
  private static func scanBarcode(uri: String) -> String? {
    guard let ciImage = loadCIImage(from: uri) else { return nil }
    let context = CIContext()
    guard let cg = context.createCGImage(ciImage, from: ciImage.extent) else { return nil }

    let request = VNDetectBarcodesRequest()
    // Produkt-Strichcodes: EAN-13/8 + UPC-E. UPC-A liefert Vision als EAN-13
    // (mit führender 0) → von .ean13 mit abgedeckt.
    request.symbologies = [.ean13, .ean8, .upce]

    let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
    do {
      try handler.perform([request])
    } catch {
      return nil
    }

    let observations = (request.results as? [VNBarcodeObservation]) ?? []
    // EAN-13 bevorzugen (übliches Produkt-Format), sonst erster lesbarer Code.
    let ean13 = observations.first { $0.symbology == .ean13 && ($0.payloadStringValue?.isEmpty == false) }
    let chosen = ean13 ?? observations.first { $0.payloadStringValue?.isEmpty == false }
    guard let code = chosen?.payloadStringValue, !code.isEmpty else { return nil }
    return code
  }

  private static func loadCIImage(from uri: String) -> CIImage? {
    if let url = URL(string: uri), let img = CIImage(contentsOf: url) {
      return img
    }
    // Strip "file://" prefix and retry as path
    let path: String
    if uri.hasPrefix("file://") {
      path = String(uri.dropFirst("file://".count))
    } else {
      path = uri
    }
    let url = URL(fileURLWithPath: path)
    return CIImage(contentsOf: url)
  }
}
