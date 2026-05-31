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
 * All VNDetectRectangles tuning flows through `RectParams` so the live
 * scanner can expose every knob for in-app tuning while the static path
 * keeps the proven defaults.
 */
enum BonVision {

  /// All tunable rectangle-detection parameters (defaults = the proven
  /// static values).
  struct RectParams {
    var minConfidence: VNConfidence = 0.6
    var minAspect: Float = 0.2
    var maxAspect: Float = 1.0
    var minSize: Float = 0.2
    var quadratureTolerance: Float = 25.0
    var maxObservations: Int = 6
  }

  static func makeRectangleRequest(_ p: RectParams = RectParams()) -> VNDetectRectanglesRequest {
    let request = VNDetectRectanglesRequest()
    request.minimumAspectRatio = p.minAspect
    request.maximumAspectRatio = p.maxAspect
    request.minimumSize = p.minSize
    request.maximumObservations = p.maxObservations
    request.minimumConfidence = p.minConfidence
    request.quadratureTolerance = p.quadratureTolerance
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
  static func detectRectangle(cgImage: CGImage, params: RectParams = RectParams()) -> VNRectangleObservation? {
    let request = makeRectangleRequest(params)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    do { try handler.perform([request]) } catch { return nil }
    guard let results = request.results as? [VNRectangleObservation] else { return nil }
    return pickBestRectangle(results)
  }

  /// Best receipt rectangle directly on a pixel buffer (cheap — no
  /// CGImage render). Buffer must already be upright (.portrait frames).
  static func detectRectangle(pixelBuffer: CVPixelBuffer, params: RectParams = RectParams()) -> VNRectangleObservation? {
    return pickBestRectangle(detectRectangles(pixelBuffer: pixelBuffer, params: params))
  }

  /// All plausible receipt rectangles on a pixel buffer (rectangle
  /// detector — kept as a fallback for the ML document segmenter).
  static func detectRectangles(pixelBuffer: CVPixelBuffer, params: RectParams) -> [VNRectangleObservation] {
    let request = makeRectangleRequest(params)
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    do { try handler.perform([request]) } catch { return [] }
    return (request.results as? [VNRectangleObservation]) ?? []
  }

  // ─── ML document segmentation (primary detector) ──────────────────
  //
  // VNDetectDocumentSegmentationRequest is ML-based (Neural Engine),
  // trained on documents. Unlike VNDetectRectangles (edge-based, CPU),
  // it keys on the whole document REGION — far more robust on
  // low-contrast paper, folds, obscured corners — and returns exactly
  // ONE document with corner points (same VNRectangleObservation shape),
  // so there's no logo/barcode/table false-positive to disambiguate.

  /// Acceptance criteria for a segmented document. The segmenter ALWAYS
  /// returns its best guess (often the whole table) with high confidence,
  /// so confidence alone is a useless gate. We instead require the quad
  /// to look like a bon: a sensible area fraction (not tiny, not nearly
  /// the whole frame) and a tall-ish aspect (receipts are portrait).
  struct DocParams {
    var minConfidence: VNConfidence = 0.2
    var minArea: CGFloat = 0.06   // ≥6% of frame
    var maxArea: CGFloat = 0.90   // <90% (reject "the whole surface")
    var maxWHRatio: CGFloat = 0.85 // width/height — reject wide/square
  }

  private static func accept(_ obs: VNRectangleObservation, _ p: DocParams) -> Bool {
    if obs.confidence < p.minConfidence { return false }
    let bb = obs.boundingBox
    let area = bb.width * bb.height
    if area < p.minArea || area > p.maxArea { return false }
    let wh = bb.height > 0 ? bb.width / bb.height : 999
    if wh > p.maxWHRatio { return false }
    return true
  }

  static func detectDocument(pixelBuffer: CVPixelBuffer, params: DocParams) -> VNRectangleObservation? {
    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    do { try handler.perform([request]) } catch { return nil }
    guard let obs = request.results?.first else { return nil }
    return accept(obs, params) ? obs : nil
  }

  static func detectDocument(cgImage: CGImage, params: DocParams) -> VNRectangleObservation? {
    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    do { try handler.perform([request]) } catch { return nil }
    guard let obs = request.results?.first else { return nil }
    return accept(obs, params) ? obs : nil
  }

  /// Warp the four corners of `observation` flat (axis-aligned) and
  /// write a JPEG to the cache dir. Returns { uri, width, height }.
  ///
  /// VNRectangleObservation corners are normalized 0..1 with origin
  /// BOTTOM-LEFT (Vision), matching CIPerspectiveCorrection's BOTTOM-LEFT
  /// pixel space — so we just multiply by the extent.
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
    // High quality — receipts have fine print; OCR benefits from detail.
    guard let data = image.jpegData(compressionQuality: 0.95) else { return nil }
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
