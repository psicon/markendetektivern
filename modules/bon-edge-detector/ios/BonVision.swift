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

  /// All plausible receipt rectangles on a pixel buffer — used by the
  /// live overlay, which then applies temporal continuity.
  static func detectRectangles(pixelBuffer: CVPixelBuffer, params: RectParams) -> [VNRectangleObservation] {
    let request = makeRectangleRequest(params)
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    do { try handler.perform([request]) } catch { return [] }
    return (request.results as? [VNRectangleObservation]) ?? []
  }

  /// Mean luminance (0..1) inside a normalized bounding box, sampled
  /// cheaply on a grid directly from the BGRA pixel buffer (no Core
  /// Image). Used to bias selection toward bright paper bons and away
  /// from dark high-contrast rectangles (logos, barcodes).
  ///
  /// VNRectangleObservation boundingBox is normalized with origin
  /// BOTTOM-LEFT; buffer rows run TOP-down, so we flip Y.
  static func meanLuma(pixelBuffer: CVPixelBuffer, boundingBox: CGRect) -> CGFloat {
    CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return 0 }
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    let ptr = base.assumingMemoryBound(to: UInt8.self)

    let px0 = max(0, Int(boundingBox.minX * CGFloat(width)))
    let px1 = min(width - 1, Int(boundingBox.maxX * CGFloat(width)))
    let pyTop = max(0, Int((1 - boundingBox.maxY) * CGFloat(height)))
    let pyBot = min(height - 1, Int((1 - boundingBox.minY) * CGFloat(height)))
    guard px1 > px0, pyBot > pyTop else { return 0 }

    let steps = 6
    var sum: CGFloat = 0
    var count = 0
    for i in 0...steps {
      for j in 0...steps {
        let x = px0 + (px1 - px0) * i / steps
        let y = pyTop + (pyBot - pyTop) * j / steps
        let off = y * bytesPerRow + x * 4
        let b = CGFloat(ptr[off])
        let g = CGFloat(ptr[off + 1])
        let r = CGFloat(ptr[off + 2])
        sum += (0.114 * b + 0.587 * g + 0.299 * r) / 255.0
        count += 1
      }
    }
    return count > 0 ? sum / CGFloat(count) : 0
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
