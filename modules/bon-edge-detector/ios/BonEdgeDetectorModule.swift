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

    View(BonScannerView.self) {
      Events("onCapture", "onError", "onEdgesDetected")

      Prop("isActive") { (view: BonScannerView, active: Bool) in
        view.setActive(active)
      }
      Prop("torch") { (view: BonScannerView, on: Bool) in
        view.setTorch(on)
      }
      Prop("captureSignal") { (view: BonScannerView, signal: Int) in
        view.requestCapture(signal: signal)
      }
    }
  }

  // MARK: - Static-image detection (gallery / still)

  private static func detectAndCrop(uri: String) -> [String: Any]? {
    guard let inputImage = loadCIImage(from: uri) else { return nil }
    let context = CIContext()
    guard let cg = context.createCGImage(inputImage, from: inputImage.extent) else { return nil }
    guard let rect = BonVision.detectRectangle(cgImage: cg) else { return nil }
    return BonVision.warpAndWriteJPEG(ciImage: inputImage, observation: rect)
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
