import Vision
import CoreImage
import CoreVideo
import UIKit

/**
 * BonVision — shared receipt-rectangle detection + perspective warp.
 *
 * Used by BOTH:
 *   - BonEdgeDetectorModule.detectAndCropDocument (static image / gallery)
 *   - BonScannerView (live camera: per-frame overlay + capture warp)
 *
 * Single source of truth for the VNDetectRectanglesRequest tuning and
 * the CIPerspectiveCorrection warp so the live overlay and the final
 * crop agree, and the gallery path stays identical to before.
 */
enum BonVision {

  /// Receipt-tuned rectangle request. Bons are tall (≈0.25 width:height),
  /// usually fill most of the frame, may be up to 25° off-square.
  ///
  /// `minConfidence` defaults to 0.6 (the proven value for static/capture
  /// frames). The live overlay passes a lower value because per-frame
  /// preview detection on low-contrast scenes (white bon on light wood)
  /// is borderline and would otherwise flicker.
  static func makeRectangleRequest(minConfidence: VNConfidence = 0.6) -> VNDetectRectanglesRequest {
    let request = VNDetectRectanglesRequest()
    request.minimumAspectRatio = 0.2
    request.maximumAspectRatio = 1.0
    request.minimumSize = 0.2
    request.maximumObservations = 6
    request.minimumConfidence = minConfidence
    request.quadratureTolerance = 25.0
    return request
  }

  /// Highest-confidence rectangle; on ties prefer the largest area.
  static func pickBestRectangle(_ list: [VNRectangleObservation]) -> VNRectangleObservation? {
    return list.max(by: { lhs, rhs in
      if abs(lhs.confidence - rhs.confidence) > 0.01 {
        return lhs.confidence < rhs.confidence
      }
      let la = lhs.boundingBox.width * lhs.boundingBox.height
      let ra = rhs.boundingBox.width * rhs.boundingBox.height
      return la < ra
    })
  }

  /// Detect the best receipt rectangle in an upright CGImage (.up).
  static func detectRectangle(cgImage: CGImage) -> VNRectangleObservation? {
    let request = makeRectangleRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    do { try handler.perform([request]) } catch { return nil }
    guard let results = request.results as? [VNRectangleObservation] else { return nil }
    return pickBestRectangle(results)
  }

  /// Detect the best receipt rectangle directly on a pixel buffer
  /// (cheap — no CGImage render). Buffer must already be upright
  /// (we deliver frames in .portrait), so orientation is .up.
  static func detectRectangle(pixelBuffer: CVPixelBuffer) -> VNRectangleObservation? {
    return pickBestRectangle(detectRectangles(pixelBuffer: pixelBuffer, minConfidence: 0.6))
  }

  /// All plausible receipt rectangles on a pixel buffer at a given
  /// confidence floor — used by the live overlay, which then applies
  /// temporal continuity to pick a stable one.
  static func detectRectangles(
    pixelBuffer: CVPixelBuffer,
    minConfidence: VNConfidence
  ) -> [VNRectangleObservation] {
    let request = makeRectangleRequest(minConfidence: minConfidence)
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    do { try handler.perform([request]) } catch { return [] }
    return (request.results as? [VNRectangleObservation]) ?? []
  }

  /// Warp the four corners of `observation` flat (axis-aligned) and
  /// write a JPEG to the cache dir. Returns { uri, width, height }.
  ///
  /// VNRectangleObservation corners are normalized 0..1 with origin
  /// BOTTOM-LEFT (Vision), which matches CIPerspectiveCorrection's
  /// BOTTOM-LEFT pixel space — so we just multiply by the extent.
  static func warpAndWriteJPEG(ciImage: CIImage, observation: VNRectangleObservation) -> [String: Any]? {
    let extent = ciImage.extent
    let toPixel = { (p: CGPoint) -> CGPoint in
      CGPoint(x: p.x * extent.width, y: p.y * extent.height)
    }
    guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { return nil }
    filter.setValue(ciImage, forKey: kCIInputImageKey)
    filter.setValue(CIVector(cgPoint: toPixel(observation.topLeft)), forKey: "inputTopLeft")
    filter.setValue(CIVector(cgPoint: toPixel(observation.topRight)), forKey: "inputTopRight")
    filter.setValue(CIVector(cgPoint: toPixel(observation.bottomLeft)), forKey: "inputBottomLeft")
    filter.setValue(CIVector(cgPoint: toPixel(observation.bottomRight)), forKey: "inputBottomRight")
    guard let output = filter.outputImage else { return nil }
    return renderJPEG(ciImage: output)
  }

  /// Render a CIImage to a JPEG in the cache dir.
  static func renderJPEG(ciImage: CIImage) -> [String: Any]? {
    let context = CIContext()
    guard let cg = context.createCGImage(ciImage, from: ciImage.extent) else { return nil }
    let image = UIImage(cgImage: cg)
    guard let data = image.jpegData(compressionQuality: 0.9) else { return nil }
    let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let outURL = dir.appendingPathComponent("bon-cropped-\(UUID().uuidString).jpg")
    do { try data.write(to: outURL, options: .atomic) } catch { return nil }
    return [
      "uri": outURL.absoluteString,
      "width": Int(cg.width),
      "height": Int(cg.height),
    ]
  }
}
